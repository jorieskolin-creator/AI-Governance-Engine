import { invariant } from "../contracts.js";
import { sha256, stableId, stableStringify } from "../core/hash.js";

export const DOCUMENT_EVIDENCE_SUMMARY_VERSION = "document-evidence-summary-1.0.0";

const DOCUMENT_CLASSES = new Set(["GENERAL_DOCUMENT", "DECLARATION", "TEST_EVALUATION_RECORD", "OPERATIONAL_RECORD", "HUMAN_GOVERNANCE_RECORD"]);
const FORMATS = new Set(["TEXT", "HTML", "PDF", "DOCX"]);
const SIZE_CLASSES = new Set(["EMPTY", "SMALL", "MEDIUM", "LARGE"]);
const SEGMENT_RANGES = new Set(["0", "1", "2_10", "11_100", "OVER_100"]);
const TOPIC_PATTERNS = Object.freeze([
  ["PURPOSE_AND_VALUE", /\b(?:purpose|intended use|expected value|success metric)\b/i],
  ["OPERATING_BOUNDARY", /\b(?:operating boundary|allowed use|excluded use|user scope|autonomy|permission)\b/i],
  ["DATA_AND_PRIVACY", /\b(?:personal data|privacy|retention|data categor|dpia|confidential)\b/i],
  ["MODEL_AND_PROVIDER", /\b(?:model|provider|foundation model|language model)\b/i],
  ["SECURITY", /\b(?:security|threat|authentication|authorization|prompt injection)\b/i],
  ["TESTING_AND_EVALUATION", /\b(?:test|evaluation|benchmark|validation|red team)\b/i],
  ["HUMAN_OVERSIGHT", /\b(?:human oversight|human review|approval|appeal|override)\b/i],
  ["MONITORING_AND_INCIDENTS", /\b(?:monitoring|incident|telemetry|audit log|reassessment)\b/i],
  ["RISK_AND_COMPLIANCE", /\b(?:risk|compliance|regulation|governance|control)\b/i],
  ["OWNERSHIP_AND_ACCOUNTABILITY", /\b(?:owner|accountable|responsible|decision authority)\b/i],
  ["LIFECYCLE", /\b(?:discovery|design|development|verification|validation|deployment|operation|retirement)\b/i]
]);
const TOPICS = new Set(TOPIC_PATTERNS.map(([id]) => id));
const RISK_SIGNALS = new Set(["SECRET_PATTERN", "PERSONAL_DATA_PATTERN", "PROMPT_INJECTION_TEXT", "CONFIDENTIALITY_MARKER", "RESTRICTED_IDENTIFIER", "UNSCREENED_PAGE"]);
const FIXED_LIMITATIONS = Object.freeze([
  "STATIC_TOPIC_AND_PATTERN_DETECTION_ONLY",
  "NO_SOURCE_TEXT_NAMES_VALUES_OR_QUOTES_INCLUDED",
  "NO_DOCUMENT_CLAIM_CONTROL_EFFECTIVENESS_OR_APPROVAL_ESTABLISHED"
]);

function documentClass(sourceKind) {
  if (sourceKind === "DECLARATION") return "DECLARATION";
  if (["TEST", "SCAN_RESULT", "PENETRATION_TEST"].includes(sourceKind)) return "TEST_EVALUATION_RECORD";
  if (["OPERATIONAL_LOG", "MONITORING_RECORD"].includes(sourceKind)) return "OPERATIONAL_RECORD";
  if (["HUMAN_REVIEW", "FORMAL_APPROVAL"].includes(sourceKind)) return "HUMAN_GOVERNANCE_RECORD";
  return "GENERAL_DOCUMENT";
}

function sizeClass(characters) {
  if (characters === 0) return "EMPTY";
  if (characters <= 10_000) return "SMALL";
  if (characters <= 100_000) return "MEDIUM";
  return "LARGE";
}

function segmentRange(count) {
  if (count === 0) return "0";
  if (count === 1) return "1";
  if (count <= 10) return "2_10";
  if (count <= 100) return "11_100";
  return "OVER_100";
}

function riskSignals(findings) {
  const types = new Set(findings.map((item) => item.type));
  const values = [];
  if (["PRIVATE_KEY", "CREDENTIAL", "AWS_ACCESS_KEY", "ASSIGNED_SECRET"].some((type) => types.has(type))) values.push("SECRET_PATTERN");
  if (["EMAIL", "PHONE", "NATIONAL_IDENTIFIER_CANDIDATE"].some((type) => types.has(type))) values.push("PERSONAL_DATA_PATTERN");
  if (types.has("PROMPT_INJECTION_CANDIDATE")) values.push("PROMPT_INJECTION_TEXT");
  if (types.has("CONFIDENTIAL_MARKER")) values.push("CONFIDENTIALITY_MARKER");
  if (types.has("RESTRICTED_IDENTIFIER")) values.push("RESTRICTED_IDENTIFIER");
  if (types.has("UNSCREENED_PDF_PAGE")) values.push("UNSCREENED_PAGE");
  return values;
}

export function validateDocumentEvidenceSummary(summary) {
  invariant(summary && typeof summary === "object" && !Array.isArray(summary), "Document evidence summary must be an object");
  invariant(summary.schemaVersion === DOCUMENT_EVIDENCE_SUMMARY_VERSION, "Document evidence summary version is unsupported");
  invariant(/^src-[a-f0-9]{24}$/.test(summary.sourceRef), "Document evidence source reference is invalid");
  invariant(DOCUMENT_CLASSES.has(summary.documentClass) && FORMATS.has(summary.artifactFormat), "Document evidence classification is invalid");
  invariant(SIZE_CLASSES.has(summary.sizeClass) && SEGMENT_RANGES.has(summary.segmentCountRange), "Document evidence dimensions are invalid");
  invariant(summary.analysisMethod === "LOCAL_DETERMINISTIC_DOCUMENT_PATTERN_SCAN", "Document evidence analysis method is invalid");
  invariant(Array.isArray(summary.topicSignals) && summary.topicSignals.every((item) => TOPICS.has(item)), "Document evidence topic signals are invalid");
  invariant(Array.isArray(summary.riskSignals) && summary.riskSignals.every((item) => RISK_SIGNALS.has(item)), "Document evidence risk signals are invalid");
  invariant(JSON.stringify(summary.limitations) === JSON.stringify(FIXED_LIMITATIONS), "Document evidence limitations are invalid");
  invariant(Object.keys(summary).sort().join(",") === ["analysisMethod", "artifactFormat", "documentClass", "limitations", "riskSignals", "schemaVersion", "segmentCountRange", "sizeClass", "sourceRef", "topicSignals"].sort().join(","), "Document evidence summary contains unregistered fields");
  return summary;
}

export function createDocumentEvidenceUnit({ sourceId, sourceHash, format, sourceKind, segments, findings = [] }) {
  const text = segments.map((segment) => segment.text ?? "").join("\n");
  const summary = validateDocumentEvidenceSummary({
    schemaVersion: DOCUMENT_EVIDENCE_SUMMARY_VERSION,
    sourceRef: sourceId,
    documentClass: documentClass(sourceKind),
    artifactFormat: format,
    sizeClass: sizeClass(text.length),
    segmentCountRange: segmentRange(segments.length),
    analysisMethod: "LOCAL_DETERMINISTIC_DOCUMENT_PATTERN_SCAN",
    topicSignals: TOPIC_PATTERNS.filter(([, pattern]) => pattern.test(text)).map(([id]) => id),
    riskSignals: riskSignals(findings),
    limitations: [...FIXED_LIMITATIONS]
  });
  const rendered = stableStringify(summary);
  return {
    id: stableId("unit", { sourceId, summary }),
    sourceId,
    parentSourceId: sourceId,
    path: `derived/document-evidence/${stableId("summary", sourceId)}.json`,
    format: "TEXT",
    mimeType: "application/json",
    evidenceKind: "DOCUMENT_SUMMARY",
    evidenceClass: "DERIVED_METADATA",
    assuranceCeiling: "DECLARED",
    locator: "deterministic-summary",
    sha256: sha256(rendered),
    content: rendered,
    sensitivity: [],
    transmissionState: "PENDING_APPROVAL",
    coverage: { sourceHash, method: "FULL_EXTRACTED_TEXT_PATTERN_SCAN" },
    derivation: { contractVersion: DOCUMENT_EVIDENCE_SUMMARY_VERSION, parentSourceId: sourceId, parentSha256: sourceHash, rawContentIncluded: false }
  };
}
