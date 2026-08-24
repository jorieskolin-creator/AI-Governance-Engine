import { invariant } from "../contracts.js";
import { sha256 } from "../core/hash.js";
import { INTAKE_QUESTIONNAIRE } from "../knowledge/intake-questionnaire.js";
import { INTAKE_FIELD_REGISTRY } from "./field-registry.js";

export const INTAKE_SEARCH_REGISTRY_VERSION = "intake-search-registry-1.1.0";

export const INTAKE_SEARCH_EVIDENCE_TYPES = Object.freeze([
  "CANONICAL_DECLARATION",
  "PROJECT_MANIFEST",
  "README",
  "OWNERSHIP_RACI",
  "ARCHITECTURE_DOCUMENT",
  "STRUCTURED_REPORT",
  "DOCUMENTATION"
]);

export const INTAKE_EXTRACTION_STRATEGIES = Object.freeze([
  "HTML_ARCHITECTURE_TITLE",
  "LABELLED_VALUE",
  "HEADING_VALUE",
  "TABLE_KEY_VALUE",
  "STRUCTURED_PROPERTY",
  "MANIFEST_PROPERTY",
  "README_TITLE",
  "LABELLED_ENUM",
  "LABELLED_BOOLEAN",
  "LABELLED_LIST",
  "LABELLED_QUESTION"
]);

const DOCUMENT_EVIDENCE = Object.freeze([
  "CANONICAL_DECLARATION",
  "OWNERSHIP_RACI",
  "ARCHITECTURE_DOCUMENT",
  "STRUCTURED_REPORT",
  "README",
  "DOCUMENTATION"
]);
const STRUCTURED_DOCUMENT_EVIDENCE = Object.freeze(["CANONICAL_DECLARATION", "ARCHITECTURE_DOCUMENT", "STRUCTURED_REPORT", "README", "DOCUMENTATION"]);

const definitions = [
  ["name", ["solution name", "system name", "product name"], ["name"], ["MANIFEST_PROPERTY", "README_TITLE", "HTML_ARCHITECTURE_TITLE", "LABELLED_VALUE", "HEADING_VALUE", "STRUCTURED_PROPERTY"], ["CANONICAL_DECLARATION", "PROJECT_MANIFEST", "README", "ARCHITECTURE_DOCUMENT", "STRUCTURED_REPORT", "DOCUMENTATION"]],
  ["accountableOwner", ["accountable owner", "system owner", "solution owner", "product owner"], ["accountable", "owner"], ["LABELLED_VALUE", "HEADING_VALUE", "TABLE_KEY_VALUE", "STRUCTURED_PROPERTY"], ["CANONICAL_DECLARATION", "OWNERSHIP_RACI", "ARCHITECTURE_DOCUMENT", "STRUCTURED_REPORT", "README", "DOCUMENTATION"]],
  ["intendedPurpose", ["intended purpose", "purpose", "mission"], [], ["LABELLED_VALUE", "HEADING_VALUE", "STRUCTURED_PROPERTY"], STRUCTURED_DOCUMENT_EVIDENCE],
  ["expectedValue", ["expected value", "business value", "expected outcome", "outcome", "value hypothesis"], [], ["LABELLED_VALUE", "HEADING_VALUE", "STRUCTURED_PROPERTY"], STRUCTURED_DOCUMENT_EVIDENCE],
  ["currentStage", ["current lifecycle stage", "current stage", "lifecycle stage"], [], ["LABELLED_ENUM", "HEADING_VALUE", "STRUCTURED_PROPERTY"], DOCUMENT_EVIDENCE],
  ["targetStage", ["target lifecycle stage", "target stage", "requested stage"], [], ["LABELLED_ENUM", "HEADING_VALUE", "STRUCTURED_PROPERTY"], DOCUMENT_EVIDENCE],
  ["jurisdictions", ["jurisdiction", "jurisdictions", "deployment countries", "operating countries"], [], ["LABELLED_LIST", "HEADING_VALUE", "STRUCTURED_PROPERTY"], DOCUMENT_EVIDENCE],
  ["roles", ["regulatory role", "regulatory roles", "ai act role", "ai act roles"], [], ["LABELLED_LIST", "HEADING_VALUE", "STRUCTURED_PROPERTY"], DOCUMENT_EVIDENCE],
  ["users", ["users", "affected groups", "user groups"], [], ["LABELLED_LIST", "HEADING_VALUE", "STRUCTURED_PROPERTY"], DOCUMENT_EVIDENCE],
  ["operatingBoundary.allowedUses", ["allowed uses", "approved uses"], [], ["LABELLED_VALUE", "HEADING_VALUE", "STRUCTURED_PROPERTY"], DOCUMENT_EVIDENCE],
  ["operatingBoundary.excludedUses", ["excluded uses", "prohibited uses"], [], ["LABELLED_VALUE", "HEADING_VALUE", "STRUCTURED_PROPERTY"], DOCUMENT_EVIDENCE],
  ["operatingBoundary.environment", ["operating environment", "environment"], [], ["LABELLED_ENUM", "HEADING_VALUE", "STRUCTURED_PROPERTY"], DOCUMENT_EVIDENCE],
  ["operatingBoundary.userScope", ["user scope"], [], ["LABELLED_VALUE", "HEADING_VALUE", "STRUCTURED_PROPERTY"], DOCUMENT_EVIDENCE],
  ["operatingBoundary.dataScope", ["data scope"], [], ["LABELLED_VALUE", "HEADING_VALUE", "STRUCTURED_PROPERTY"], DOCUMENT_EVIDENCE],
  ["operatingBoundary.integrationScope", ["integration scope"], [], ["LABELLED_VALUE", "HEADING_VALUE", "STRUCTURED_PROPERTY"], DOCUMENT_EVIDENCE],
  ["operatingBoundary.permissionScope", ["permission scope"], [], ["LABELLED_VALUE", "HEADING_VALUE", "STRUCTURED_PROPERTY"], DOCUMENT_EVIDENCE],
  ["operatingBoundary.autonomyScope", ["autonomy scope"], [], ["LABELLED_VALUE", "HEADING_VALUE", "STRUCTURED_PROPERTY"], DOCUMENT_EVIDENCE],
  ["operatingBoundary.monitoringOwner", ["monitoring owner"], [], ["LABELLED_VALUE", "HEADING_VALUE", "STRUCTURED_PROPERTY"], DOCUMENT_EVIDENCE],
  ["operatingBoundary.expiresAt", ["boundary expiry", "expires at", "expiry"], [], ["LABELLED_VALUE", "HEADING_VALUE", "STRUCTURED_PROPERTY"], DOCUMENT_EVIDENCE],
  ["data.categories", ["data categories", "approved data classes"], [], ["LABELLED_LIST", "HEADING_VALUE", "STRUCTURED_PROPERTY"], DOCUMENT_EVIDENCE],
  ["data.personalData", ["personal data"], [], ["LABELLED_BOOLEAN", "HEADING_VALUE", "STRUCTURED_PROPERTY"], DOCUMENT_EVIDENCE],
  ["data.specialCategoryData", ["special category data", "special-category data"], [], ["LABELLED_BOOLEAN", "HEADING_VALUE", "STRUCTURED_PROPERTY"], DOCUMENT_EVIDENCE],
  ["data.productionData", ["production data"], [], ["LABELLED_BOOLEAN", "HEADING_VALUE", "STRUCTURED_PROPERTY"], DOCUMENT_EVIDENCE],
  ["exposure.currentUserAccess", ["current user access"], [], ["LABELLED_ENUM", "HEADING_VALUE", "STRUCTURED_PROPERTY"], DOCUMENT_EVIDENCE],
  ["exposure.intendedUserAccess", ["intended user access", "target user access"], [], ["LABELLED_ENUM", "HEADING_VALUE", "STRUCTURED_PROPERTY"], DOCUMENT_EVIDENCE],
  ["exposure.externalUsers", ["external users"], [], ["LABELLED_BOOLEAN", "HEADING_VALUE", "STRUCTURED_PROPERTY"], DOCUMENT_EVIDENCE],
  ["exposure.productionAccess", ["production access"], [], ["LABELLED_BOOLEAN", "HEADING_VALUE", "STRUCTURED_PROPERTY"], DOCUMENT_EVIDENCE],
  ["exposure.consequentialDecisions", ["consequential decisions", "consequential decision support"], [], ["LABELLED_BOOLEAN", "HEADING_VALUE", "STRUCTURED_PROPERTY"], DOCUMENT_EVIDENCE],
  ["agent.usesAgents", ["uses agents", "agent use"], [], ["LABELLED_BOOLEAN", "HEADING_VALUE", "STRUCTURED_PROPERTY"], DOCUMENT_EVIDENCE],
  ["agent.canTakeActions", ["can take actions", "action taking"], [], ["LABELLED_BOOLEAN", "HEADING_VALUE", "STRUCTURED_PROPERTY"], DOCUMENT_EVIDENCE],
  ["agent.irreversibleActions", ["irreversible actions"], [], ["LABELLED_BOOLEAN", "HEADING_VALUE", "STRUCTURED_PROPERTY"], DOCUMENT_EVIDENCE],
  ["agent.humanOverride", ["human override"], [], ["LABELLED_BOOLEAN", "HEADING_VALUE", "STRUCTURED_PROPERTY"], DOCUMENT_EVIDENCE],
  ["classification.prohibitedPractice", ["prohibited practice candidate", "prohibited practice"], [], ["LABELLED_BOOLEAN", "HEADING_VALUE", "STRUCTURED_PROPERTY"], DOCUMENT_EVIDENCE],
  ["classification.highRiskCandidate", ["high risk candidate", "high-risk candidate"], [], ["LABELLED_BOOLEAN", "HEADING_VALUE", "STRUCTURED_PROPERTY"], DOCUMENT_EVIDENCE]
].map(([fieldId, labels, tableLabels, extractionStrategies, sourcePriorities]) => ({
  fieldId,
  labels,
  headingAliases: labels,
  tableLabels,
  evidenceTypes: [...new Set(sourcePriorities)],
  sourcePriorities,
  extractionStrategies
}));

const questionnaireDefinitions = INTAKE_QUESTIONNAIRE.questions.map((question) => ({
  fieldId: `intakeAnswers.${question.id}`,
  labels: [...new Set([
    question.id.replaceAll("_", " "),
    ...(question.id === "REGULATORY_ROLES" ? [] : [question.fieldId.split(".").at(-1).replace(/([a-z])([A-Z])/g, "$1 $2")]),
    question.prompt.replace(/\?$/, "")
  ])],
  headingAliases: [],
  tableLabels: [],
  evidenceTypes: [...DOCUMENT_EVIDENCE],
  sourcePriorities: [...DOCUMENT_EVIDENCE],
  extractionStrategies: ["LABELLED_QUESTION", "STRUCTURED_PROPERTY"]
}));

function deepFreeze(value) {
  if (!value || typeof value !== "object") return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.isFrozen(value) ? value : Object.freeze(value);
}

const fields = deepFreeze([...definitions, ...questionnaireDefinitions]);
const fieldIds = new Set(fields.map((field) => field.fieldId));
invariant(fieldIds.size === fields.length, "Intake search registry field IDs must be unique");
for (const field of INTAKE_FIELD_REGISTRY.fields) invariant(fieldIds.has(field.id), `Intake search registry is missing ${field.id}`);
for (const field of fields) {
  invariant(field.labels.length > 0 && field.labels.every((label) => typeof label === "string" && label.trim()), `${field.fieldId} search labels are invalid`);
  invariant(field.evidenceTypes.length > 0 && field.evidenceTypes.every((type) => INTAKE_SEARCH_EVIDENCE_TYPES.includes(type)), `${field.fieldId} evidence types are invalid`);
  invariant(new Set(field.sourcePriorities).size === field.evidenceTypes.length && field.evidenceTypes.every((type) => field.sourcePriorities.includes(type)), `${field.fieldId} source priorities are invalid`);
  invariant(field.extractionStrategies.length > 0 && field.extractionStrategies.every((strategy) => INTAKE_EXTRACTION_STRATEGIES.includes(strategy)), `${field.fieldId} extraction strategies are invalid`);
}

const payload = deepFreeze({
  version: INTAKE_SEARCH_REGISTRY_VERSION,
  fieldRegistryVersion: INTAKE_FIELD_REGISTRY.version,
  fieldRegistryHash: INTAKE_FIELD_REGISTRY.hash,
  questionnaireVersion: INTAKE_QUESTIONNAIRE.version,
  evidenceTypes: INTAKE_SEARCH_EVIDENCE_TYPES,
  extractionStrategies: INTAKE_EXTRACTION_STRATEGIES,
  fields,
  conflictPolicy: "All distinct deterministic candidates are retained for user resolution; source priority never silently resolves a conflict."
});

export const INTAKE_SEARCH_REGISTRY = deepFreeze({ ...payload, hash: sha256(payload) });

export function intakeSearchField(fieldId) {
  return fields.find((field) => field.fieldId === fieldId) ?? null;
}

export function classifyIntakeSearchEvidence(source) {
  const path = String(source.path ?? "").toLowerCase().replaceAll("\\", "/");
  if (source.evidenceClass === "DECLARED" || /(?:^|\/)intended-use-dossier\.json$/.test(path)) return "CANONICAL_DECLARATION";
  if (/(?:^|\/)(?:package\.json|pyproject\.toml|cargo\.toml|go\.mod|composer\.json)$/.test(path)) return "PROJECT_MANIFEST";
  if (/(?:^|\/)readme(?:\.[^/]*)?$/.test(path)) return "README";
  if (/(?:ownership|owners?|raci|responsibility|accountability)/.test(path)) return "OWNERSHIP_RACI";
  if (/(?:architecture|system-design|solution-design)/.test(path)) return "ARCHITECTURE_DOCUMENT";
  if (source.format === "HTML" || /(?:report|assessment|inventory|register)/.test(path)) return "STRUCTURED_REPORT";
  return source.artifactClass === "DOCUMENTATION" ? "DOCUMENTATION" : null;
}
