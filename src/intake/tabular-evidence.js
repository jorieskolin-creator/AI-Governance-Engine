import { invariant } from "../contracts.js";
import { sha256, stableId, stableStringify } from "../core/hash.js";

export const TABULAR_EVIDENCE_SUMMARY_VERSION = "tabular-evidence-summary-1.0.0";

const STRUCTURE_SIGNALS = new Set(["HAS_TEXT", "HAS_NUMERIC", "HAS_DATE", "HAS_BOOLEAN", "HAS_EMPTY_VALUES"]);
const SEMANTIC_SIGNALS = Object.freeze([
  ["IDENTIFIER_COLUMNS", /\b(?:id|identifier|account|customer|employee|user)[-_ ]?(?:id|number|key)?\b/i],
  ["PERSONAL_DATA_COLUMNS", /\b(?:name|email|phone|address|birth|national id|personal data)\b/i],
  ["FINANCIAL_DATA_COLUMNS", /\b(?:amount|price|cost|currency|invoice|budget|spend|revenue)\b/i],
  ["MODEL_EVALUATION_COLUMNS", /\b(?:model|accuracy|precision|recall|score|evaluation|benchmark|hallucination)\b/i],
  ["TIMESTAMP_COLUMNS", /\b(?:date|time|timestamp|created|updated|period)\b/i],
  ["OWNER_COLUMNS", /\b(?:owner|accountable|responsible|approver)\b/i],
  ["REGION_COLUMNS", /\b(?:country|region|jurisdiction|location|zone)\b/i],
  ["STATUS_COLUMNS", /\b(?:status|state|result|outcome|decision)\b/i]
]);
const SEMANTIC_SIGNAL_IDS = new Set(SEMANTIC_SIGNALS.map(([id]) => id));
const RISK_SIGNALS = new Set(["SECRET_PATTERN", "PERSONAL_DATA_PATTERN", "PROMPT_INJECTION_TEXT", "CONFIDENTIALITY_MARKER", "RESTRICTED_IDENTIFIER"]);
const ROW_RANGES = new Set(["0", "1_10", "11_100", "101_1000", "OVER_1000"]);
const COLUMN_RANGES = new Set(["0", "1_10", "11_50", "51_200", "OVER_200"]);
const SHEET_RANGES = new Set(["NOT_APPLICABLE", "1", "2_10", "OVER_10"]);
const FIXED_LIMITATIONS = Object.freeze([
  "STRUCTURE_AND_PATTERN_DETECTION_ONLY",
  "NO_CELL_VALUES_OR_HEADERS_INCLUDED",
  "NO_FORMULAS_LINKS_OR_EMBEDDED_CONTENT_EXECUTED",
  "NO_DATA_QUALITY_OR_GOVERNANCE_EFFECTIVENESS_ESTABLISHED"
]);

function range(value, thresholds, labels) {
  for (let index = 0; index < thresholds.length; index += 1) if (value <= thresholds[index]) return labels[index];
  return labels.at(-1);
}

function columnCount(line, format) {
  if (!line) return 0;
  if (format === "XLSX") return line.split("\t").length;
  const candidates = [",", ";", "\t"].map((delimiter) => line.split(delimiter).length);
  return Math.max(...candidates);
}

function structureSignals(text) {
  const values = [];
  if (/[A-Za-z]{2,}/.test(text)) values.push("HAS_TEXT");
  if (/(?:^|[,;\t=\s])-?\d+(?:[.,]\d+)?(?=$|[,;\t\s])/m.test(text)) values.push("HAS_NUMERIC");
  if (/\b\d{4}-\d{2}-\d{2}(?:[T\s][0-9:.+-Z]+)?\b/.test(text)) values.push("HAS_DATE");
  if (/(?:^|[,;\t=\s])(?:true|false|yes|no)(?=$|[,;\t\s])/im.test(text)) values.push("HAS_BOOLEAN");
  if (/[,;\t](?:[,;\t]|$)|=\s*(?:\t|$)/m.test(text)) values.push("HAS_EMPTY_VALUES");
  return values;
}

function riskSignals(findings) {
  const types = new Set(findings.map((item) => item.type));
  const values = [];
  if (["PRIVATE_KEY", "CREDENTIAL", "AWS_ACCESS_KEY", "ASSIGNED_SECRET"].some((type) => types.has(type))) values.push("SECRET_PATTERN");
  if (["EMAIL", "PHONE", "NATIONAL_IDENTIFIER_CANDIDATE"].some((type) => types.has(type))) values.push("PERSONAL_DATA_PATTERN");
  if (types.has("PROMPT_INJECTION_CANDIDATE")) values.push("PROMPT_INJECTION_TEXT");
  if (types.has("CONFIDENTIAL_MARKER")) values.push("CONFIDENTIALITY_MARKER");
  if (types.has("RESTRICTED_IDENTIFIER")) values.push("RESTRICTED_IDENTIFIER");
  return values;
}

export function validateTabularEvidenceSummary(summary) {
  invariant(summary && typeof summary === "object" && !Array.isArray(summary), "Tabular evidence summary must be an object");
  invariant(summary.schemaVersion === TABULAR_EVIDENCE_SUMMARY_VERSION, "Tabular evidence summary version is unsupported");
  invariant(/^src-[a-f0-9]{24}$/.test(summary.sourceRef), "Tabular evidence source reference is invalid");
  invariant(["CSV", "XLSX"].includes(summary.artifactType), "Tabular evidence artifact type is invalid");
  invariant(ROW_RANGES.has(summary.rowCountRange) && COLUMN_RANGES.has(summary.columnCountRange) && SHEET_RANGES.has(summary.sheetCountRange), "Tabular evidence dimensions are invalid");
  invariant(summary.analysisMethod === "LOCAL_DETERMINISTIC_TABULAR_PROFILE", "Tabular evidence analysis method is invalid");
  invariant(summary.executionState === "NOT_EXECUTED", "Tabular evidence execution state is invalid");
  invariant(Array.isArray(summary.structureSignals) && summary.structureSignals.every((item) => STRUCTURE_SIGNALS.has(item)), "Tabular structure signals are invalid");
  invariant(Array.isArray(summary.semanticSignals) && summary.semanticSignals.every((item) => SEMANTIC_SIGNAL_IDS.has(item)), "Tabular semantic signals are invalid");
  invariant(Array.isArray(summary.riskSignals) && summary.riskSignals.every((item) => RISK_SIGNALS.has(item)), "Tabular risk signals are invalid");
  invariant(JSON.stringify(summary.limitations) === JSON.stringify(FIXED_LIMITATIONS), "Tabular evidence limitations are invalid");
  invariant(Object.keys(summary).sort().join(",") === ["analysisMethod", "artifactType", "columnCountRange", "executionState", "limitations", "riskSignals", "rowCountRange", "schemaVersion", "semanticSignals", "sheetCountRange", "sourceRef", "structureSignals"].sort().join(","), "Tabular evidence summary contains unregistered fields");
  return summary;
}

export function createTabularEvidenceUnit({ sourceId, sourceHash, format, segments, findings = [] }) {
  const text = segments.map((segment) => segment.text ?? "").join("\n");
  const semanticText = text.replace(/[_-]+/g, " ");
  const lines = text ? text.replaceAll("\r\n", "\n").split("\n").filter((line) => line.length > 0) : [];
  const rows = lines.length;
  const columns = lines.reduce((maximum, line) => Math.max(maximum, columnCount(line, format)), 0);
  const sheets = format === "XLSX" ? segments.length : 0;
  const summary = validateTabularEvidenceSummary({
    schemaVersion: TABULAR_EVIDENCE_SUMMARY_VERSION,
    sourceRef: sourceId,
    artifactType: format,
    rowCountRange: range(rows, [0, 10, 100, 1000], ["0", "1_10", "11_100", "101_1000", "OVER_1000"]),
    columnCountRange: range(columns, [0, 10, 50, 200], ["0", "1_10", "11_50", "51_200", "OVER_200"]),
    sheetCountRange: format === "CSV" ? "NOT_APPLICABLE" : range(sheets, [1, 10], ["1", "2_10", "OVER_10"]),
    analysisMethod: "LOCAL_DETERMINISTIC_TABULAR_PROFILE",
    executionState: "NOT_EXECUTED",
    structureSignals: structureSignals(text),
    semanticSignals: SEMANTIC_SIGNALS.filter(([, pattern]) => pattern.test(semanticText)).map(([id]) => id),
    riskSignals: riskSignals(findings),
    limitations: [...FIXED_LIMITATIONS]
  });
  const rendered = stableStringify(summary);
  return {
    id: stableId("unit", { sourceId, summary }),
    sourceId,
    parentSourceId: sourceId,
    path: `derived/tabular-evidence/${stableId("summary", sourceId)}.json`,
    format: "TEXT",
    mimeType: "application/json",
    evidenceKind: "TABULAR_SUMMARY",
    evidenceClass: "DERIVED_OBSERVATION",
    assuranceCeiling: "DECLARED",
    locator: "deterministic-summary",
    sha256: sha256(rendered),
    content: rendered,
    sensitivity: [],
    transmissionState: "PENDING_APPROVAL",
    coverage: { sourceHash, method: "FULL_TABLE_STRUCTURE_SCAN" },
    derivation: { contractVersion: TABULAR_EVIDENCE_SUMMARY_VERSION, parentSourceId: sourceId, parentSha256: sourceHash, rawContentIncluded: false }
  };
}
