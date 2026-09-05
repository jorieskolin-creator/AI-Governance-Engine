import { sha256 } from "../core/hash.js";
import { KNOWLEDGE_VERSION, NORMATIVE_SOURCES } from "./normative-sources.js";
import { REQUIREMENTS } from "./requirements.js";
import { CONTROLS } from "./controls.js";
import { ANTIPATTERNS } from "./antipatterns.js";
import { PLAYBOOK_VERSION, TACTICS } from "./playbook.js";
import { evaluateKnowledgeSnapshot } from "./diagnostics.js";
import { INTAKE_QUESTIONNAIRE } from "./intake-questionnaire.js";

const DOCUMENT_TYPES = new Set(["normativeSources", "requirements", "controls", "antipatterns", "tactics", "intakeQuestionnaire"]);
const RELEASE_STATUSES = new Set(["APPROVED", "FROZEN", "PILOT", "DRAFT", "RETIRED", "ASSESSMENT_OBJECTS_NOT_PUBLISHED", "UNSPECIFIED"]);

function derivedInstrumentStatus(snapshot) {
  if (snapshot.instrumentStatus) return snapshot.instrumentStatus;
  const controls = snapshot.controls ?? [];
  const antipatterns = snapshot.antipatterns ?? [];
  const questions = [...controls, ...antipatterns].flatMap((item) => item.questions ?? []);
  if (controls.length === 30 && antipatterns.length === 30 && questions.length === 180) return "LOADED";
  return "NOT_LOADED";
}

function derivedKnowledgeBaseStatus(snapshot) {
  if (snapshot.knowledgeBaseStatus) return snapshot.knowledgeBaseStatus;
  const published = [...(snapshot.controls ?? []), ...(snapshot.antipatterns ?? [])].every((item) => {
    const hasRules = Boolean(item.evidenceRules);
    const hasFindings = Array.isArray(item.findingDefinitions) && item.findingDefinitions.length > 0;
    const hasAtomic = (Array.isArray(item.atomicSubcriteria) && item.atomicSubcriteria.length > 0) || (Array.isArray(item.atomicTests) && item.atomicTests.length > 0);
    return hasRules && hasFindings && hasAtomic;
  });
  return published ? "PUBLISHED" : "NOT_PUBLISHED";
}

function derivedPlaybookStatus(snapshot) {
  if (snapshot.playbookStatus) return snapshot.playbookStatus;
  const tactics = snapshot.tactics ?? [];
  if (tactics.length && tactics.every((item) => item.status === "APPROVED")) return "APPROVED";
  return snapshot.releaseStatus ?? "UNSPECIFIED";
}

function derivedAssessmentObjectsStatus(snapshot) {
  if (snapshot.assessmentObjectsStatus) return snapshot.assessmentObjectsStatus;
  const unpublished = (snapshot.diagnostics?.issues ?? []).some((item) => ["ASSESSMENT_OBJECTS_NOT_PUBLISHED", "TACTIC_WITHOUT_PRIMARY_OBJECT_MAPPING"].includes(item.code));
  if (unpublished) return "NOT_PUBLISHED";
  if (["APPROVED", "FROZEN"].includes(snapshot.releaseStatus)) return "PUBLISHED";
  return "UNSPECIFIED";
}

function localSnapshot() {
  const snapshot = {
    version: KNOWLEDGE_VERSION,
    source: "LOCAL_BOOTSTRAP",
    releaseStatus: "ASSESSMENT_OBJECTS_NOT_PUBLISHED",
    playbookStatus: "APPROVED",
    playbookVersion: PLAYBOOK_VERSION,
    instrumentStatus: "LOADED",
    knowledgeBaseStatus: "NOT_PUBLISHED",
    assessmentObjectsStatus: "NOT_PUBLISHED",
    manifestUrl: null,
    normativeSources: [...NORMATIVE_SOURCES],
    requirements: [...REQUIREMENTS],
    controls: [...CONTROLS],
    antipatterns: [...ANTIPATTERNS],
    tactics: [...TACTICS],
    intakeQuestionnaire: structuredClone(INTAKE_QUESTIONNAIRE)
  };
  const complete = { ...snapshot, manifestHash: sha256(snapshot), documentChecks: [] };
  return { ...complete, diagnostics: evaluateKnowledgeSnapshot(complete) };
}

async function fetchBytes(url, token) {
  const response = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    signal: AbortSignal.timeout(20_000)
  });
  if (!response.ok) throw new Error(`Knowledge fetch failed: ${response.status} ${url}`);
  return new Uint8Array(await response.arrayBuffer());
}

function decodeJson(bytes, label) {
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error(`Knowledge document is not valid JSON: ${label}`);
  }
}

function validateManifest(manifest) {
  if (!manifest || !["1.0.0", "1.1.0"].includes(manifest.schemaVersion) || typeof manifest.version !== "string") {
    throw new Error("Unsupported Vercel knowledge manifest");
  }
  if (!Array.isArray(manifest.documents) || manifest.documents.length === 0) {
    throw new Error("Knowledge manifest has no documents");
  }
  if (manifest.releaseStatus !== undefined && !RELEASE_STATUSES.has(manifest.releaseStatus)) throw new Error("Unsupported knowledge release status");
  for (const item of manifest.documents) {
    if (!DOCUMENT_TYPES.has(item.type) || typeof item.url !== "string" || !/^[a-f0-9]{64}$/.test(item.sha256 ?? "")) {
      throw new Error(`Invalid knowledge manifest entry: ${item?.id ?? "unknown"}`);
    }
  }
}

function configuredManifestUrl(options) {
  if (Object.hasOwn(options, "manifestUrl")) {
    return typeof options.manifestUrl === "string" ? options.manifestUrl.trim() : "";
  }
  if (process.env.NODE_TEST_CONTEXT) return "";
  return String(process.env.VERCEL_KB_MANIFEST_URL ?? "").trim();
}

export async function loadKnowledgeSnapshot(options = {}) {
  const manifestUrl = configuredManifestUrl(options);
  const token = options.token ?? process.env.BLOB_READ_WRITE_TOKEN;
  if (!manifestUrl) return localSnapshot();

  const manifestBytes = await fetchBytes(manifestUrl, token);
  const manifest = decodeJson(manifestBytes, manifestUrl);
  validateManifest(manifest);
  const loaded = { normativeSources: [], requirements: [], controls: [], antipatterns: [], tactics: [], intakeQuestionnaire: [] };
  const documentChecks = [];

  for (const item of manifest.documents) {
    const bytes = await fetchBytes(item.url, token);
    const actualHash = sha256(bytes);
    if (actualHash !== item.sha256) throw new Error(`Knowledge hash mismatch for ${item.id}`);
    const document = decodeJson(bytes, item.id);
    const entries = Array.isArray(document) ? document : document.entries;
    if (!Array.isArray(entries)) throw new Error(`Knowledge document ${item.id} must contain an array or entries[]`);
    loaded[item.type].push(...entries);
    documentChecks.push({ id: item.id, type: item.type, status: "HASH_VERIFIED", expectedHash: item.sha256, actualHash, entryCount: entries.length });
  }

  for (const [key, entries] of Object.entries(loaded)) {
    if (key !== "intakeQuestionnaire" && entries.length === 0) throw new Error(`Knowledge snapshot is missing ${key}`);
  }
  const questionnaireEntries = loaded.intakeQuestionnaire;
  loaded.intakeQuestionnaire = questionnaireEntries[0] ?? structuredClone(INTAKE_QUESTIONNAIRE);
  const intakeQuestionnaireSource = questionnaireEntries.length ? "MANIFEST" : "BUNDLED_FALLBACK";
  const snapshot = {
    version: manifest.version,
    source: "VERCEL_BLOB",
    releaseStatus: manifest.releaseStatus ?? "UNSPECIFIED",
    playbookStatus: manifest.playbookStatus,
    playbookVersion: manifest.playbookVersion,
    assessmentObjectsStatus: manifest.assessmentObjectsStatus,
    manifestUrl,
    manifestHash: sha256(manifestBytes),
    documentChecks,
    intakeQuestionnaireSource,
    ...loaded
  };
  const diagnostics = evaluateKnowledgeSnapshot(snapshot);
  if (diagnostics.status === "FAIL") throw new Error(`Knowledge structural integrity failed: ${diagnostics.issues.filter((item) => item.severity === "ERROR").map((item) => item.code).join(", ")}`);
  return { ...snapshot, diagnostics };
}

export function knowledgeManifestView(snapshot) {
  let manifestUrl = snapshot.manifestUrl;
  if (manifestUrl) {
    try { const parsed = new URL(manifestUrl); parsed.search = ""; parsed.hash = ""; manifestUrl = parsed.toString(); }
    catch { manifestUrl = null; }
  }
  const withDiagnostics = snapshot.diagnostics ? snapshot : { ...snapshot, diagnostics: evaluateKnowledgeSnapshot(snapshot) };
  return {
    version: snapshot.version,
    source: snapshot.source,
    releaseStatus: snapshot.releaseStatus ?? "UNSPECIFIED",
    playbookStatus: derivedPlaybookStatus(withDiagnostics),
    playbookVersion: snapshot.playbookVersion ?? null,
    instrumentStatus: derivedInstrumentStatus(withDiagnostics),
    knowledgeBaseStatus: derivedKnowledgeBaseStatus(withDiagnostics),
    assessmentObjectsStatus: derivedAssessmentObjectsStatus(withDiagnostics),
    manifestHash: snapshot.manifestHash,
    manifestUrl,
    diagnostics: {
      version: snapshot.diagnostics?.version ?? "knowledge-diagnostics-unavailable",
      status: snapshot.diagnostics?.status ?? "UNKNOWN",
      errorCount: snapshot.diagnostics?.errorCount ?? null,
      warningCount: snapshot.diagnostics?.warningCount ?? null
    },
    counts: {
      normativeSources: snapshot.normativeSources.length,
      requirements: snapshot.requirements.length,
      controls: snapshot.controls.length,
      antipatterns: snapshot.antipatterns.length,
      tactics: snapshot.tactics.length,
      intakeQuestions: snapshot.intakeQuestionnaire?.questions?.length ?? 0,
      assessmentQuestions: [...snapshot.controls, ...snapshot.antipatterns].flatMap((item) => item.questions ?? []).length
    }
  };
}
