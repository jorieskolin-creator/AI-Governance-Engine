import { invariant } from "../contracts.js";
import { sha256, stableId, stableStringify } from "../core/hash.js";
import { intakeField } from "./field-registry.js";

export const SEMANTIC_INTAKE_EVIDENCE_VERSION = "semantic-intake-evidence-1.0.0";

const SOURCE_REPRESENTATIONS = new Set(["DOCUMENT_STATEMENT", "CODE_LITERAL_OR_STRUCTURE", "CONFIGURATION_DECLARATION"]);
const LIMITATIONS = Object.freeze([
  "CONTROLLED_VOCABULARY_ONLY",
  "NO_RAW_TEXT_NAMES_VALUES_QUOTES_OR_CODE_INCLUDED",
  "SOURCE_REPRESENTATION_ONLY",
  "USER_REVIEW_REQUIRED_FOR_INTAKE_USE"
]);

const RULES = Object.freeze([
  ["SOLUTION_KIND", "CONVERSATIONAL_ASSISTANT", ["intendedPurpose", "expectedValue"], [/\bconversational (?:assistant|interface|experience)\b/i, /\b(?:chatbot|chat assistant)\b/i]],
  ["SOLUTION_KIND", "INTERACTIVE_PORTFOLIO", ["intendedPurpose", "expectedValue"], [/\binteractive (?:cv|resume|résumé|portfolio)\b/i, /\bprofessional portfolio\b/i]],
  ["INTENDED_AUDIENCE", "RECRUITER", ["users", "operatingBoundary.userScope"], [/\brecruiters?\b/i]],
  ["INTENDED_AUDIENCE", "HIRING_MANAGER", ["users", "operatingBoundary.userScope"], [/\bhiring managers?\b/i]],
  ["INTENDED_AUDIENCE", "POTENTIAL_CLIENT", ["users", "operatingBoundary.userScope"], [/\b(?:potential|prospective) clients?\b/i]],
  ["ALLOWED_USE", "PROFESSIONAL_EXPERIENCE_QA", ["operatingBoundary.allowedUses", "expectedValue"], [/\bprofessional experience\b[^\n]{0,100}\b(?:questions?|answers?|q\s*&\s*a)\b/i, /\b(?:questions?|answers?|q\s*&\s*a)\b[^\n]{0,100}\b(?:career|professional experience)\b/i]],
  ["ALLOWED_USE", "TAILORED_PITCH_GENERATION", ["operatingBoundary.allowedUses", "expectedValue"], [/\b(?:tailored?|personalized?) (?:pitch|introduction)\b/i, /\bpitch generator\b/i]],
  ["ALLOWED_USE", "CHALLENGE_SIMULATION", ["operatingBoundary.allowedUses", "expectedValue"], [/\bchallenge simulator\b/i, /\bsimulat(?:e|es|ed|ing|ion)\b[^\n]{0,60}\b(?:challenge|scenario)\b/i]],
  ["ALLOWED_USE", "REVERSE_INTERVIEW", ["operatingBoundary.allowedUses", "expectedValue"], [/\breverse interview\b/i]],
  ["ALLOWED_USE", "EXPERIENCE_DOCUMENT_MANAGEMENT", ["operatingBoundary.allowedUses"], [/\bexperience (?:and|&) document management\b/i, /\bmanage (?:professional )?(?:experience|documents?)\b/i]],
  ["EXCLUDED_USE", "OUT_OF_SCOPE_TOPICS", ["operatingBoundary.excludedUses"], [/(?:reject|refus|declin|not answer)[^\n]{0,100}\b(?:unrelated|out[- ]of[- ]scope)\b/i]],
  ["EXCLUDED_USE", "HARMFUL_OR_ILLEGAL_REQUESTS", ["operatingBoundary.excludedUses"], [/(?:reject|refus|declin|block)[^\n]{0,100}\b(?:harmful|illegal)\b/i]],
  ["EXCLUDED_USE", "PROMPT_OVERRIDE_REQUESTS", ["operatingBoundary.excludedUses"], [/(?:reject|refus|declin|block|guard)[^\n]{0,120}\b(?:prompt override|ignore (?:previous|prior) instructions|system prompt)\b/i]],
  ["DATA_INPUT", "USER_QUESTION", ["operatingBoundary.dataScope"], [/\buser questions?\b/i, /\bquestions? (?:submitted|asked) by (?:a )?users?\b/i]],
  ["DATA_INPUT", "JOB_DESCRIPTION", ["operatingBoundary.dataScope"], [/\bjob descriptions?\b/i]],
  ["DATA_INPUT", "PROFESSIONAL_EXPERIENCE_MATERIAL", ["operatingBoundary.dataScope"], [/\bprofessional experience (?:material|content|data|documents?)\b/i, /\b(?:cv|resume|résumé) (?:content|data|documents?)\b/i]],
  ["DATA_INPUT", "UPLOADED_DOCUMENT", ["operatingBoundary.dataScope"], [/\bupload(?:ed|ing)? (?:files?|documents?)\b/i, /\bdocument uploads?\b/i]],
  ["EXTERNAL_INTEGRATION", "EXTERNAL_GENERATIVE_AI", ["operatingBoundary.integrationScope"], [/\bexternal generative ai\b/i, /\b(?:openai|xai|grok|moonshot|kimi)\b/i]],
  ["EXTERNAL_INTEGRATION", "DOCUMENT_STORAGE", ["operatingBoundary.integrationScope"], [/\b(?:vercel )?blob (?:storage|store)\b/i, /\bexternal document storage\b/i]],
  ["SECURITY_MECHANISM", "INPUT_VALIDATION", ["operatingBoundary.permissionScope"], [/\binput validation\b/i, /\bvalidat(?:e|es|ed|ing|ion)\s*\(/i]],
  ["SECURITY_MECHANISM", "RATE_LIMITING", ["operatingBoundary.permissionScope"], [/\brate limit(?:ing|er)?\b/i, /\brateLimit\s*\(/]],
  ["SECURITY_MECHANISM", "SECURITY_HEADERS", ["operatingBoundary.permissionScope"], [/\bsecurity headers?\b/i, /\bhelmet\s*\(/i]],
  ["SECURITY_MECHANISM", "ADMIN_AUTHENTICATION", ["operatingBoundary.permissionScope"], [/\badmin(?:istrator)? authentication\b/i, /\bauthenticat(?:e|es|ed|ing|ion)\b[^\n]{0,50}\badmin/i]],
  ["SECURITY_MECHANISM", "PROMPT_INJECTION_GUARDRAIL", ["operatingBoundary.permissionScope"], [/\bprompt injection (?:guardrail|protection|filter|defen[cs]e)\b/i, /\b(?:guard|filter|block)[^\n]{0,80}\bprompt injection\b/i]],
  ["DEPLOYMENT_INSTRUCTION", "LOCAL_RUN_INSTRUCTIONS", [], [/\blocal (?:development|run|setup)\b/i, /\bnpm run (?:dev|start)\b/i]],
  ["DEPLOYMENT_INSTRUCTION", "PRODUCTION_BUILD_INSTRUCTIONS", [], [/\bproduction build\b/i, /\bnpm run build\b/i]],
  ["DEPLOYMENT_INSTRUCTION", "HOSTED_DEPLOYMENT_INSTRUCTIONS", [], [/\bdeploy(?:ment|ing)? (?:to|on) (?:vercel|railway)\b/i]],
  ["SOLUTION_KIND", "INTERNAL_ASSISTANT", ["intendedPurpose", "expectedValue"], [/\binternal (?:assistant|copilot|chatbot)\b/i, /\bbounded internal assistant\b/i]],
  ["SOLUTION_KIND", "DOCUMENT_REVIEW_ASSISTANT", ["intendedPurpose", "expectedValue", "operatingBoundary.allowedUses"], [/\bdocument[- ]review (?:assistant|tool|system|support)\b/i]],
  ["INTENDED_AUDIENCE", "INTERNAL_EMPLOYEE", ["users", "operatingBoundary.userScope"], [/\binternal employees?\b/i, /\bemployee[- ]only\b/i]],
  ["INTENDED_AUDIENCE", "GOVERNANCE_REVIEWER", ["users", "operatingBoundary.userScope"], [/\bgovernance (?:reviewers?|teams?|officers?|analysts?)\b/i]],
  ["ALLOWED_USE", "GOVERNANCE_REVIEW_SUPPORT", ["operatingBoundary.allowedUses", "expectedValue", "intendedPurpose"], [/\bgovernance reviews?\b/i, /\bprepare review material\b/i]],
  ["EXCLUDED_USE", "AUTONOMOUS_EXTERNAL_COMMUNICATION", ["operatingBoundary.excludedUses", "operatingBoundary.autonomyScope"], [/\bautonomous (?:external )?communications?\b/i]],
  ["DECISION_CONTEXT", "CONSEQUENTIAL_EMPLOYMENT_DECISIONS", ["exposure.consequentialDecisions"], [/\bconsequential (?:employment|hiring) decisions?\b/i]],
  ["DATA_INPUT", "APPROVED_INTERNAL_CONTENT", ["operatingBoundary.dataScope"], [/\bapproved internal (?:content|documents?|material)\b/i]],
  ["OVERSIGHT", "HUMAN_REVIEWED_OUTPUT", ["agent.humanOverride", "operatingBoundary.autonomyScope"], [/\bhuman[- ]reviewed (?:output|content|responses?)\b/i, /\bhuman (?:review|oversight) before (?:output|publication|release)\b/i]],
  ["OPERATING_ENVIRONMENT", "ISOLATED_SANDBOX", ["operatingBoundary.environment"], [/\bisolated sandbox\b/i]],
  ["OPERATING_ENVIRONMENT", "CONTROLLED_PILOT", ["operatingBoundary.environment", "exposure.intendedUserAccess"], [/\bcontrolled (?:external )?pilot\b/i]],
  ["AGENT_CAPABILITY", "TOOL_OR_AGENT_EXECUTION", ["agent.usesAgents", "agent.canTakeActions", "operatingBoundary.autonomyScope"], [/\b(?:tool|agent) execution\b/i, /\bagentic (?:tools?|actions?|execution)\b/i]]
]);

const CONCEPTS = new Map(RULES.map(([type, id]) => [`${type}:${id}`, { type, id }]));

function ignoredPath(path) {
  const normalized = String(path ?? "").toLowerCase().replaceAll("\\", "/");
  return /(?:^|\/)(?:node_modules|vendor|dist|build|coverage)(?:\/|$)/.test(normalized)
    || /(?:^|\/)(?:package-lock\.json|pnpm-lock\.ya?ml|yarn\.lock|composer\.lock|poetry\.lock|pipfile\.lock|cargo\.lock|go\.sum)$/.test(normalized);
}

function sourceRepresentation(sourceKind) {
  if (sourceKind === "CODE" || sourceKind === "TEST") return "CODE_LITERAL_OR_STRUCTURE";
  if (sourceKind === "CONFIGURATION") return "CONFIGURATION_DECLARATION";
  return "DOCUMENT_STATEMENT";
}

export function validateSemanticIntakeEvidence(summary) {
  invariant(summary && typeof summary === "object" && !Array.isArray(summary), "Semantic Intake evidence must be an object");
  invariant(summary.schemaVersion === SEMANTIC_INTAKE_EVIDENCE_VERSION, "Semantic Intake evidence version is unsupported");
  invariant(/^src-[a-f0-9]{24}$/.test(summary.sourceRef), "Semantic Intake source reference is invalid");
  invariant(summary.derivationMethod === "LOCAL_DETERMINISTIC_CONTROLLED_VOCABULARY_PROJECTION", "Semantic Intake derivation method is invalid");
  invariant(summary.authority === "INTAKE_DRAFTING_SUPPORT_ONLY", "Semantic Intake authority is invalid");
  invariant(Array.isArray(summary.observations) && summary.observations.length > 0, "Semantic Intake observations are required");
  const ids = new Set();
  for (const observation of summary.observations) {
    const key = `${observation.conceptType}:${observation.conceptId}`;
    invariant(CONCEPTS.has(key) && !ids.has(key), "Semantic Intake observation is unknown or duplicated");
    ids.add(key);
    invariant(SOURCE_REPRESENTATIONS.has(observation.sourceRepresentation), "Semantic Intake source representation is invalid");
    invariant(Array.isArray(observation.applicableIntakeFields) && observation.applicableIntakeFields.every((fieldId) => intakeField(fieldId)), "Semantic Intake field mapping is invalid");
    invariant(Object.keys(observation).sort().join(",") === "applicableIntakeFields,conceptId,conceptType,sourceRepresentation", "Semantic Intake observation contains unregistered fields");
  }
  invariant(JSON.stringify(summary.limitations) === JSON.stringify(LIMITATIONS), "Semantic Intake limitations are invalid");
  invariant(Object.keys(summary).sort().join(",") === ["authority", "derivationMethod", "limitations", "observations", "schemaVersion", "sourceRef"].sort().join(","), "Semantic Intake evidence contains unregistered fields");
  return summary;
}

export function createSemanticIntakeEvidenceUnit({ sourceId, sourceHash, path, sourceKind, localUnits }) {
  if (ignoredPath(path)) return null;
  const text = localUnits
    .filter((unit) => !unit.media && (!unit.ocr || unit.ocr.qualificationState === "QUALIFIED"))
    .map((unit) => unit.content)
    .join("\n");
  if (!text.trim()) return null;
  const representation = sourceRepresentation(sourceKind);
  const observations = RULES.filter(([, , , patterns]) => patterns.some((pattern) => pattern.test(text))).map(([conceptType, conceptId, applicableIntakeFields]) => ({
    conceptType,
    conceptId,
    applicableIntakeFields: [...applicableIntakeFields],
    sourceRepresentation: representation
  }));
  if (!observations.length) return null;
  const summary = validateSemanticIntakeEvidence({
    schemaVersion: SEMANTIC_INTAKE_EVIDENCE_VERSION,
    sourceRef: sourceId,
    derivationMethod: "LOCAL_DETERMINISTIC_CONTROLLED_VOCABULARY_PROJECTION",
    authority: "INTAKE_DRAFTING_SUPPORT_ONLY",
    observations,
    limitations: [...LIMITATIONS]
  });
  const content = stableStringify(summary);
  return {
    id: stableId("unit", { sourceId, summary }),
    sourceId,
    parentSourceId: sourceId,
    path: `derived/semantic-intake/${stableId("summary", sourceId)}.json`,
    format: "TEXT",
    mimeType: "application/json",
    evidenceKind: "SEMANTIC_INTAKE_SUMMARY",
    evidenceClass: "DERIVED_OBSERVATION",
    assuranceCeiling: representation === "DOCUMENT_STATEMENT" ? "DECLARED" : "IMPLEMENTED",
    locator: "controlled-semantic-projection",
    sha256: sha256(content),
    content,
    sensitivity: [],
    transmissionState: "PENDING_APPROVAL",
    coverage: { sourceHash, method: "FULL_LOCAL_EXTRACTED_CONTENT_CONTROLLED_PROJECTION" },
    derivation: { contractVersion: SEMANTIC_INTAKE_EVIDENCE_VERSION, parentSourceId: sourceId, parentSha256: sourceHash, rawContentIncluded: false }
  };
}

export function semanticIntakeUnitSupportsField(unit, fieldId) {
  if (unit?.evidenceKind !== "SEMANTIC_INTAKE_SUMMARY") return false;
  const summary = validateSemanticIntakeEvidence(JSON.parse(unit.content));
  return summary.observations.some((observation) => observation.applicableIntakeFields.includes(fieldId));
}
