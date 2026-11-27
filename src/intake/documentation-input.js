import { webcrypto } from "node:crypto";
import { DomUtils, parseDocument } from "htmlparser2";
import { DECLARED_DOCUMENTATION_VERSION, DECLARED_TOPIC_GROUPS, HANDOFF_MAX_BYTES, HANDOFF_SCRIPT_ID, isDocumentationHandoffJson, parseDocumentationHandoff, readHandoffScript } from "../../public/documentation-handoff.js";
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
const mappedFields = {
  "name": ["solutionName", (dossier) => dossier.name],
  "purpose": ["intendedPurpose", (dossier) => dossier.intendedPurpose],
  "current-stage": ["lifecycleStage", (dossier) => dossier.currentStage],
  "users": ["users", (dossier) => dossier.users.join(", ")],
  "excluded-uses": ["exclusions", (dossier) => dossier.operatingBoundary.excludedUses.join("\n")]
};

export function approvedDocumentation(handoff, edits, dossier) {
  if (edits !== undefined && (!edits || typeof edits !== "object" || Array.isArray(edits))) throw handoffError("Declared documentation edits must be an object.");
  for (const [id, value] of Object.entries(edits ?? {})) {
    if (!topicIds.has(id) || typeof value !== "string" || value.length > 10_000) throw handoffError("A declared documentation topic is invalid or too long.");
  }
  if (!handoff && !Object.values(edits ?? {}).some((value) => value.trim())) return null;
  const topics = Object.fromEntries([...topicIds].map((id) => {
    const original = handoff?.answers[id]?.trim() || "";
    const value = screenSensitiveValue((edits?.[id] ?? original).trim());
    return [id, { value: value || null, origin: value && value === original ? "DOCUMENTATION_SUPPORT" : value ? "USER_DECLARATION" : "UNKNOWN" }];
  }));
  const mapped = Object.fromEntries((handoff?.suggestions ?? []).map(({ controlId, value }) => {
    const [id, getValue] = mappedFields[controlId];
    const approved = getValue(dossier);
    const selected = approved && approved !== "UNKNOWN" ? screenSensitiveValue(approved) : null;
    return [id, { value: selected, origin: selected && selected === value ? "DOCUMENTATION_SUPPORT" : selected ? "USER_DECLARATION" : "UNKNOWN" }];
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
