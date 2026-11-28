import { webcrypto } from "node:crypto";
import { DomUtils, parseDocument } from "htmlparser2";
import {
  DECLARED_DOCUMENTATION_VERSION,
  DECLARED_TOPIC_GROUPS,
  HANDOFF_MAX_BYTES,
  HANDOFF_SCRIPT_ID,
  handoffControlDrafts,
  isDocumentationHandoffJson,
  isNoInformationOffered,
  NON_OVERLAPPING_TOPIC_GROUPS,
  normalizedHandoffAnswer,
  parseDocumentationHandoff,
  readHandoffScript
} from "../../public/documentation-handoff.js";
import { screenSensitiveValue } from "../core/privacy.js";

function handoffError(message) {
  return Object.assign(new Error(message), { statusCode: 422, failureCode: "DOCUMENTATION_HANDOFF_INVALID" });
}

function readFromSource(source) {
  if (!["HTML", "TEXT"].includes(source.format)) return null;
  const isJson = source.mimeType === "application/json";
  if (!isJson && source.format !== "HTML") return null;
  let content = source.content;
  if (source.encoding === "base64") {
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(content) || content.length % 4) return null;
    content = Buffer.from(content, "base64").toString("utf8");
  }
  if (isJson) return isDocumentationHandoffJson(content) ? content : null;
  if (!content.includes(HANDOFF_SCRIPT_ID)) return null;
  const nodes = DomUtils.findAll((node) => node.attribs.id === HANDOFF_SCRIPT_ID, parseDocument(content).children);
  if (!nodes.length) return null;
  if (Buffer.byteLength(content) > HANDOFF_MAX_BYTES) throw handoffError("Choose a Documentation Support handoff within the 15 MB limit.");
  return readHandoffScript(nodes.map((node) => ({
    tagName: node.name,
    getAttribute: (name) => node.attribs[name],
    hasAttribute: (name) => Object.hasOwn(node.attribs, name),
    textContent: DomUtils.textContent(node)
  })));
}

export async function splitDocumentationInput(sources, selectedHandoff) {
  const evidenceSources = [];
  const handoffPaths = new Set();
  let handoff = null;
  async function admit(content) {
    if (typeof content !== "string" || Buffer.byteLength(content) > HANDOFF_MAX_BYTES) throw handoffError("Choose a Documentation Support handoff within the 15 MB limit.");
    const parsed = await parseDocumentationHandoff(content, webcrypto.subtle);
    if (handoff && handoff.payloadHash !== parsed.payloadHash) throw handoffError("Multiple different Documentation Support handoffs were selected. Choose one.");
    handoff = { ...screenSensitiveValue(parsed), schemaVersion: parsed.schemaVersion, payloadHash: parsed.payloadHash };
  }
  try {
    if (selectedHandoff !== undefined) await admit(selectedHandoff);
    for (const source of sources) {
      const content = readFromSource(source);
      if (content === null) evidenceSources.push(source);
      else {
        await admit(content);
        handoffPaths.add(source.path);
      }
    }
  } catch (error) {
    if (error.statusCode === 422) throw error;
    throw handoffError(error.message);
  }
  return { evidenceSources, handoffPaths, handoff };
}

const topicIds = new Set(DECLARED_TOPIC_GROUPS.flatMap(([, topics]) => topics.map(([id]) => id)));
const TOPIC_SEARCH_ALIASES = Object.freeze({
  recordOwner: ["record owner", "documentation owner", "documentation record owner"],
  businessUnit: ["business unit", "business context", "customer context", "business or customer context"],
  saidotReference: ["governance system reference", "governance inventory reference"],
  engineReference: ["engine reference", "solution assurance engine reference", "assessment reference"],
  consequences: ["plausible adverse consequences", "adverse consequences", "potential consequences"],
  severity: ["consequence severity", "declared severity"],
  detectability: ["detectability before harm", "declared detectability"],
  scaleBeforeDetection: ["scale before detection", "blast radius"],
  propagation: ["propagation and downstream dependency", "downstream propagation"],
  existingRisk: ["existing risk or classification", "existing solution risk", "existing classification"],
  classificationBasis: ["classification basis and date", "classification basis"],
  permissionStatus: ["current permission status", "declared permission status", "permission status"],
  contractualConstraints: ["contracts and customer commitments", "contractual constraints", "customer commitments"],
  sensitiveDerivedData: ["sensitive and derived data", "derived data"],
  minimization: ["minimisation and retention", "minimization and retention", "data minimization", "retention rules"],
  sourceQuality: ["source quality and provenance", "source quality, provenance and currency", "source quality"],
  openConstraints: ["unresolved permission questions", "open permission constraints", "unresolved constraints"]
});

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function discoverDeclaredTopics(localSourceUnits = []) {
  const docUnits = localSourceUnits.filter((unit) => !unit.media && (!unit.ocr || unit.ocr.qualificationState === "QUALIFIED")
    && unit.path !== "intended-use-dossier.json"
    && (["TEXT", "HTML", "PDF", "DOCX"].includes(unit.format) || unit.evidenceKind === "DOCUMENT"));
  const discovered = {};
  for (const [, fields] of NON_OVERLAPPING_TOPIC_GROUPS) {
    for (const [id, heading] of fields) {
      const aliases = [...new Set([heading.toLowerCase(), ...(TOPIC_SEARCH_ALIASES[id] ?? [])])];
      const labelPattern = new RegExp(`^\\s*(?:[-*]\\s*)?(?:${aliases.map(escapeRegExp).join("|")})\\s*[:=\\-]\\s*(.+?)\\s*$`, "i");
      const headingPattern = new RegExp(`^\\s*#{1,6}\\s+(?:${aliases.map(escapeRegExp).join("|")})\\s*#*\\s*$`, "i");
      let found = null;
      const sourceUnitIds = [];
      for (const unit of docUnits) {
        const lines = String(unit.content ?? "").split(/\r?\n/);
        for (let index = 0; index < lines.length; index += 1) {
          const line = lines[index];
          const labelled = line.match(labelPattern)?.[1]?.trim();
          if (labelled && !isNoInformationOffered(labelled) && labelled.toUpperCase() !== "NOT_DETERMINED") {
            found ??= screenSensitiveValue(labelled);
            sourceUnitIds.push(unit.id);
            break;
          }
          if (headingPattern.test(line)) {
            const next = lines.slice(index + 1).find((candidate) => candidate.trim());
            const clean = next?.replace(/^\s*[-*]\s*/, "").trim();
            if (clean && !/^\s*#/.test(clean) && !isNoInformationOffered(clean)) {
              found ??= screenSensitiveValue(clean);
              sourceUnitIds.push(unit.id);
              break;
            }
          }
        }
        if (/;table:\d+;row:\d+/.test(unit.locator ?? "")) {
          const cells = String(unit.content ?? "").split("|").map((cell) => cell.trim()).filter(Boolean);
          const cellIndex = cells.findIndex((cell) => aliases.includes(cell.toLowerCase()));
          if (cellIndex >= 0 && cells[cellIndex + 1] && !isNoInformationOffered(cells[cellIndex + 1])) {
            found ??= screenSensitiveValue(cells[cellIndex + 1]);
            sourceUnitIds.push(unit.id);
          }
        }
      }
      if (found) discovered[id] = { value: found, sourceUnitIds: [...new Set(sourceUnitIds)] };
    }
  }
  return discovered;
}

const mappedFields = {
  "name": ["solutionName", (dossier) => dossier.name],
  "purpose": ["intendedPurpose", (dossier) => dossier.intendedPurpose],
  "current-stage": ["lifecycleStage", (dossier) => dossier.currentStage],
  "users": ["users", (dossier) => dossier.users.join(", ")],
  "allowed-uses": ["useContext", (dossier) => dossier.operatingBoundary.allowedUses.join("\n")],
  "excluded-uses": ["exclusions", (dossier) => dossier.operatingBoundary.excludedUses.join("\n")],
  "boundary-users": ["affectedParties", (dossier) => dossier.operatingBoundary.userScope],
  "boundary-data": ["privacyConfidentiality", (dossier) => dossier.operatingBoundary.dataScope],
  "boundary-integrations": ["outputConsumers", (dossier) => dossier.operatingBoundary.integrationScope],
  "boundary-permissions": ["permissionBasis", (dossier) => dossier.operatingBoundary.permissionScope],
  "boundary-autonomy": ["humanAcceptance", (dossier) => dossier.operatingBoundary.autonomyScope],
  "consequential": ["outputRole", (dossier) => dossier.exposure?.consequentialDecisions === null || dossier.exposure?.consequentialDecisions === undefined ? "" : dossier.exposure.consequentialDecisions ? "YES" : "NO"],
  "takes-actions": ["actionRole", (dossier) => dossier.agent?.canTakeActions === null || dossier.agent?.canTakeActions === undefined ? "" : dossier.agent.canTakeActions ? "YES" : "NO"],
  "irreversible": ["reversibility", (dossier) => dossier.agent?.irreversibleActions === null || dossier.agent?.irreversibleActions === undefined ? "" : dossier.agent.irreversibleActions ? "YES" : "NO"],
  "human-override": ["humanOverride", (dossier) => dossier.agent?.humanOverride === null || dossier.agent?.humanOverride === undefined ? "" : dossier.agent.humanOverride ? "YES" : "NO"]
};

export function approvedDocumentation(handoff, edits, dossier, discoveredTopics = null) {
  if (edits !== undefined && (!edits || typeof edits !== "object" || Array.isArray(edits))) throw handoffError("Declared documentation edits must be an object.");
  for (const [id, value] of Object.entries(edits ?? {})) {
    if (!topicIds.has(id) || typeof value !== "string" || value.length > 10_000) throw handoffError("A declared documentation topic is invalid or too long.");
  }
  const hasDiscovered = Boolean(discoveredTopics && Object.keys(discoveredTopics).length > 0);
  if (!handoff && !hasDiscovered && !Object.values(edits ?? {}).some((value) => value.trim())) return null;
  const topics = Object.fromEntries([...topicIds].map((id) => {
    const handoffText = normalizedHandoffAnswer(id, handoff?.answers?.[id]);
    const discoveredText = discoveredTopics?.[id]?.value?.trim() || "";
    const baseline = handoffText || discoveredText;
    const rawCandidate = edits && Object.hasOwn(edits, id) ? edits[id] : baseline;
    if (isNoInformationOffered(rawCandidate)) {
      return [id, { value: null, origin: "UNKNOWN", noInformationOffered: true }];
    }
    const value = screenSensitiveValue(String(rawCandidate ?? "").trim());
    const origin = !value ? "UNKNOWN"
      : handoffText && value === screenSensitiveValue(handoffText) ? "DOCUMENTATION_SUPPORT"
        : !handoffText && discoveredText && value === screenSensitiveValue(discoveredText) ? "DETERMINISTIC_DOCUMENTATION"
          : "USER_DECLARATION";
    return [id, { value: value || null, origin }];
  }));
  const mapped = Object.fromEntries([...handoffControlDrafts(handoff).entries()].filter(([controlId]) => mappedFields[controlId]).map(([controlId, value]) => {
    const [id, getValue] = mappedFields[controlId];
    const approved = getValue(dossier);
    const selected = approved && approved !== "UNKNOWN" ? screenSensitiveValue(approved) : null;
    return [id, { value: selected, origin: selected && selected === screenSensitiveValue(value) ? "DOCUMENTATION_SUPPORT" : selected ? "USER_DECLARATION" : "UNKNOWN" }];
  }));
  return {
    schemaVersion: DECLARED_DOCUMENTATION_VERSION,
    evidenceCeiling: "DECLARED",
    handoff: handoff ? { schemaVersion: handoff.schemaVersion, payloadHash: handoff.payloadHash, documentationConfirmed: handoff.documentationConfirmed } : null,
    topics, mapped, evidenceRefs: handoff?.evidenceRefs ?? {}, notApplicable: handoff?.notApplicable ?? {},
    failureModes: handoff?.entries ?? [], evidenceReferences: handoff?.evidence ?? [], dataSources: handoff?.dataSources ?? [],
    outstandingWork: handoff?.work ?? []
  };
}
