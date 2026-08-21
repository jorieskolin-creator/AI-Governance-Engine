import { extname } from "node:path";
import { invariant } from "../contracts.js";
import { sha256, stableId, stableStringify } from "../core/hash.js";

export const CODE_EVIDENCE_SUMMARY_VERSION = "code-evidence-summary-1.0.0";

const CAPABILITY_PATTERNS = Object.freeze([
  ["AUTHENTICATION", /\b(?:authenticat(?:e|ed|es|ing|ion)|oauth|openid|oidc|jwt|session)\b/i],
  ["AUTHORIZATION", /\b(?:authoriz(?:e|ed|es|ing|ation)|permission|role[-_ ]based|rbac|access control)\b/i],
  ["HUMAN_APPROVAL_GATE", /\b(?:human approval|manual approval|approval gate|requires confirmation)\b/i],
  ["RATE_LIMITING", /\b(?:rate limit|rateLimit|throttl)\b/i],
  ["AUDIT_LOGGING", /\b(?:audit log|auditLog|audit trail)\b/i],
  ["OBSERVABILITY", /\b(?:telemetry|tracing|trace id|metrics|monitoring|observability)\b/i],
  ["PERSISTENCE", /\b(?:postgres|mysql|sqlite|database|repository|persistent store)\b/i],
  ["ENCRYPTION", /\b(?:encrypt|decrypt|kms|key management|cipher)\b/i],
  ["EXTERNAL_MODEL_PROVIDER", /\b(?:openai|anthropic|gemini|bedrock|vertex ai|azure openai)\b/i],
  ["AGENT_OR_TOOL_EXECUTION", /\b(?:agent|tool call|function call|execute tool)\b/i],
  ["INPUT_VALIDATION", /\b(?:validate|validation|schema|saniti[sz])\b/i],
  ["RETRY_OR_TIMEOUT", /\b(?:retry|backoff|timeout|abort signal)\b/i],
  ["DATA_RETENTION", /\b(?:retention|delete after|time to live|ttl|purge)\b/i]
]);

const CAPABILITIES = new Set(CAPABILITY_PATTERNS.map(([id]) => id));
const RISK_SIGNALS = new Set(["SECRET_PATTERN", "PERSONAL_DATA_PATTERN", "PROMPT_INJECTION_TEXT", "CONFIDENTIALITY_MARKER", "RESTRICTED_IDENTIFIER"]);
const ARTIFACT_TYPES = new Set(["CODE", "CONFIGURATION", "TEST_CODE"]);
const LANGUAGES = new Set(["JAVASCRIPT_TYPESCRIPT", "PYTHON", "JVM", "DOTNET", "GO", "RUST", "SHELL", "NATIVE", "WEB_TEMPLATE", "SCHEMA", "INFRASTRUCTURE_CONFIGURATION", "GENERIC_CONFIGURATION", "OTHER"]);
const SIZE_CLASSES = new Set(["EMPTY", "SMALL", "MEDIUM", "LARGE"]);
const LINE_RANGES = new Set(["0", "1_50", "51_250", "251_1000", "OVER_1000"]);
const FIXED_LIMITATIONS = Object.freeze([
  "STATIC_PATTERN_DETECTION_ONLY",
  "NO_RAW_CODE_OR_CONFIGURATION_INCLUDED",
  "NO_RUNTIME_BEHAVIOR_OR_CONTROL_EFFECTIVENESS_ESTABLISHED"
]);

function languageFamily(path) {
  const extension = extname(path).toLowerCase();
  if ([".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx"].includes(extension)) return "JAVASCRIPT_TYPESCRIPT";
  if (extension === ".py") return "PYTHON";
  if ([".java", ".kt", ".kts", ".scala", ".groovy", ".gradle"].includes(extension)) return "JVM";
  if ([".cs", ".ps1", ".psm1"].includes(extension)) return "DOTNET";
  if ([".go", ".mod", ".sum"].includes(extension)) return "GO";
  if (extension === ".rs") return "RUST";
  if ([".sh", ".bash", ".zsh", ".fish", ".bat", ".cmd"].includes(extension)) return "SHELL";
  if ([".c", ".cc", ".cpp", ".cxx", ".h", ".hh", ".hpp", ".swift"].includes(extension)) return "NATIVE";
  if ([".vue", ".svelte", ".astro", ".css"].includes(extension)) return "WEB_TEMPLATE";
  if ([".graphql", ".gql", ".prisma", ".proto"].includes(extension)) return "SCHEMA";
  if ([".tf", ".yaml", ".yml", ".toml"].includes(extension) || /(?:^|\/)(?:dockerfile|makefile|procfile)(?:\.|$)/i.test(path)) return "INFRASTRUCTURE_CONFIGURATION";
  if ([".json", ".xml", ".ini", ".properties", ".conf", ".cfg"].includes(extension) || /(?:^|\/)\.env(?:\.|$)/i.test(path)) return "GENERIC_CONFIGURATION";
  return "OTHER";
}

function sizeClass(bytes) {
  if (bytes === 0) return "EMPTY";
  if (bytes <= 10_000) return "SMALL";
  if (bytes <= 100_000) return "MEDIUM";
  return "LARGE";
}

function lineRange(lines) {
  if (lines === 0) return "0";
  if (lines <= 50) return "1_50";
  if (lines <= 250) return "51_250";
  if (lines <= 1000) return "251_1000";
  return "OVER_1000";
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

export function validateCodeEvidenceSummary(summary) {
  invariant(summary && typeof summary === "object" && !Array.isArray(summary), "Code evidence summary must be an object");
  invariant(summary.schemaVersion === CODE_EVIDENCE_SUMMARY_VERSION, "Code evidence summary version is unsupported");
  invariant(/^src-[a-f0-9]{24}$/.test(summary.sourceRef), "Code evidence source reference is invalid");
  invariant(ARTIFACT_TYPES.has(summary.artifactType), "Code evidence artifact type is invalid");
  invariant(LANGUAGES.has(summary.languageFamily), "Code evidence language family is invalid");
  invariant(SIZE_CLASSES.has(summary.sizeClass), "Code evidence size class is invalid");
  invariant(LINE_RANGES.has(summary.lineCountRange), "Code evidence line-count range is invalid");
  invariant(summary.analysisMethod === "LOCAL_DETERMINISTIC_STATIC_PATTERN_SCAN", "Code evidence analysis method is invalid");
  invariant(summary.executionState === "NOT_EXECUTED", "Code evidence execution state is invalid");
  invariant(Array.isArray(summary.capabilitySignals) && summary.capabilitySignals.every((item) => CAPABILITIES.has(item)), "Code evidence capability signals are invalid");
  invariant(Array.isArray(summary.riskSignals) && summary.riskSignals.every((item) => RISK_SIGNALS.has(item)), "Code evidence risk signals are invalid");
  invariant(JSON.stringify(summary.limitations) === JSON.stringify(FIXED_LIMITATIONS), "Code evidence limitations are invalid");
  invariant(Object.keys(summary).sort().join(",") === ["analysisMethod", "artifactType", "capabilitySignals", "executionState", "languageFamily", "limitations", "lineCountRange", "riskSignals", "schemaVersion", "sizeClass", "sourceRef"].sort().join(","), "Code evidence summary contains unregistered fields");
  return summary;
}

export function createCodeEvidenceUnit({ sourceId, sourceHash, path, sourceKind, content, findings = [] }) {
  const bytes = Buffer.byteLength(content, "utf8");
  const lines = content ? content.replaceAll("\r\n", "\n").split("\n").length : 0;
  const artifactType = sourceKind === "CONFIGURATION" ? "CONFIGURATION" : sourceKind === "TEST" ? "TEST_CODE" : "CODE";
  const summary = validateCodeEvidenceSummary({
    schemaVersion: CODE_EVIDENCE_SUMMARY_VERSION,
    sourceRef: sourceId,
    artifactType,
    languageFamily: languageFamily(path),
    sizeClass: sizeClass(bytes),
    lineCountRange: lineRange(lines),
    analysisMethod: "LOCAL_DETERMINISTIC_STATIC_PATTERN_SCAN",
    executionState: "NOT_EXECUTED",
    capabilitySignals: CAPABILITY_PATTERNS.filter(([, pattern]) => pattern.test(content)).map(([id]) => id),
    riskSignals: riskSignals(findings),
    limitations: [...FIXED_LIMITATIONS]
  });
  const rendered = stableStringify(summary);
  return {
    id: stableId("unit", { sourceId, summary }),
    sourceId,
    parentSourceId: sourceId,
    path: `derived/code-evidence/${stableId("summary", sourceId)}.json`,
    format: "TEXT",
    mimeType: "application/json",
    evidenceKind: "CODE_SUMMARY",
    evidenceClass: "DERIVED_OBSERVATION",
    assuranceCeiling: "IMPLEMENTED",
    locator: "deterministic-summary",
    sha256: sha256(rendered),
    content: rendered,
    sensitivity: [],
    transmissionState: "PENDING_APPROVAL",
    coverage: { sourceHash, method: "FULL_SOURCE_STATIC_SCAN" },
    derivation: { contractVersion: CODE_EVIDENCE_SUMMARY_VERSION, parentSourceId: sourceId, parentSha256: sourceHash, rawContentIncluded: false }
  };
}
