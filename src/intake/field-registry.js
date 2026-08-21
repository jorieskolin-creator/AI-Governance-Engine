import { BOUNDARY_ENVIRONMENTS, DATA_CATEGORIES, LIFECYCLE_STAGES, USER_ACCESS_MODES, invariant } from "../contracts.js";
import { sha256 } from "../core/hash.js";
import { INTAKE_QUESTIONNAIRE } from "../knowledge/intake-questionnaire.js";

export const INTAKE_FIELD_REGISTRY_VERSION = "intake-field-registry-1.0.0";

const sections = Object.freeze([
  { id: "IDENTITY_AND_PURPOSE", title: "Identity and purpose" },
  { id: "LIFECYCLE_AND_SCOPE", title: "Lifecycle, jurisdiction and users" },
  { id: "OPERATING_BOUNDARY", title: "Operating boundary" },
  { id: "DATA_EXPOSURE_AND_AUTHORITY", title: "Data, exposure and agent authority" },
  ...INTAKE_QUESTIONNAIRE.sections.map((section) => ({ id: `QUESTIONNAIRE_${section.id}`, title: section.title }))
]);

const mainFields = [
  ["name", "name", "IDENTITY_AND_PURPOSE", "STRING", null, true, true],
  ["accountableOwner", "owner", "IDENTITY_AND_PURPOSE", "STRING", null, true, false],
  ["intendedPurpose", "purpose", "IDENTITY_AND_PURPOSE", "STRING", null, true, true],
  ["expectedValue", "value", "IDENTITY_AND_PURPOSE", "STRING", null, true, true],
  ["currentStage", "current-stage", "LIFECYCLE_AND_SCOPE", "ENUM", LIFECYCLE_STAGES, true, false],
  ["targetStage", "target-stage", "LIFECYCLE_AND_SCOPE", "ENUM", LIFECYCLE_STAGES, true, false],
  ["jurisdictions", "jurisdictions", "LIFECYCLE_AND_SCOPE", "STRING_ARRAY", null, true, true],
  ["roles", "roles", "LIFECYCLE_AND_SCOPE", "STRING_ARRAY", null, true, false],
  ["users", "users", "LIFECYCLE_AND_SCOPE", "STRING_ARRAY", null, true, true],
  ["operatingBoundary.allowedUses", "allowed-uses", "OPERATING_BOUNDARY", "STRING_ARRAY", null, true, true],
  ["operatingBoundary.excludedUses", "excluded-uses", "OPERATING_BOUNDARY", "STRING_ARRAY", null, true, true],
  ["operatingBoundary.environment", "boundary-environment", "OPERATING_BOUNDARY", "ENUM", BOUNDARY_ENVIRONMENTS.filter((value) => value !== "UNKNOWN"), true, true],
  ["operatingBoundary.userScope", "boundary-users", "OPERATING_BOUNDARY", "STRING", null, true, true],
  ["operatingBoundary.dataScope", "boundary-data", "OPERATING_BOUNDARY", "STRING", null, true, true],
  ["operatingBoundary.expiresAt", "boundary-expiry", "OPERATING_BOUNDARY", "DATE", null, false, false],
  ["operatingBoundary.integrationScope", "boundary-integrations", "OPERATING_BOUNDARY", "STRING", null, true, true],
  ["operatingBoundary.permissionScope", "boundary-permissions", "OPERATING_BOUNDARY", "STRING", null, true, true],
  ["operatingBoundary.autonomyScope", "boundary-autonomy", "OPERATING_BOUNDARY", "STRING", null, true, true],
  ["operatingBoundary.monitoringOwner", "boundary-monitoring", "OPERATING_BOUNDARY", "STRING", null, true, true],
  ["data.categories", "data-categories", "DATA_EXPOSURE_AND_AUTHORITY", "ENUM_ARRAY", DATA_CATEGORIES, true, true],
  ["exposure.currentUserAccess", "current-user-access", "DATA_EXPOSURE_AND_AUTHORITY", "ENUM", USER_ACCESS_MODES.filter((value) => value !== "UNKNOWN"), true, true],
  ["exposure.intendedUserAccess", "intended-user-access", "DATA_EXPOSURE_AND_AUTHORITY", "ENUM", USER_ACCESS_MODES.filter((value) => value !== "UNKNOWN"), true, true],
  ["exposure.productionAccess", "production-access", "DATA_EXPOSURE_AND_AUTHORITY", "BOOLEAN", null, true, true],
  ["exposure.consequentialDecisions", "consequential", "DATA_EXPOSURE_AND_AUTHORITY", "BOOLEAN", null, true, true],
  ["agent.usesAgents", "uses-agents", "DATA_EXPOSURE_AND_AUTHORITY", "BOOLEAN", null, true, true],
  ["agent.canTakeActions", "takes-actions", "DATA_EXPOSURE_AND_AUTHORITY", "BOOLEAN", null, true, true],
  ["agent.irreversibleActions", "irreversible", "DATA_EXPOSURE_AND_AUTHORITY", "BOOLEAN", null, true, true],
  ["agent.humanOverride", "human-override", "DATA_EXPOSURE_AND_AUTHORITY", "BOOLEAN", null, true, true]
].map(([id, uiControlId, sectionId, dataType, allowedValues, requiredForDeployment, genAiProposalAllowed]) => ({
  id,
  uiControlId,
  sectionId,
  dataType,
  allowedValues,
  requirement: { intake: "RESOLUTION_REQUIRED", deployment: requiredForDeployment ? "VALUE_REQUIRED" : "OPTIONAL" },
  unknownAllowed: true,
  notApplicableAllowed: false,
  applicability: null,
  explanationRequiredFor: [],
  deterministicAcquisition: { supported: true, lane: "DOCUMENT_AND_CONFIGURATION_FACTS", mappings: [id] },
  genAiProposalAllowed,
  humanAuthority: "SOLUTION_OWNER",
  lifecycleConsequence: "UNRESOLVED_BLOCKS_APPROVED_INTAKE"
}));

const questionnaireFields = INTAKE_QUESTIONNAIRE.questions.map((question) => ({
  id: `intakeAnswers.${question.id}`,
  questionId: question.id,
  questionnaireFieldId: question.fieldId,
  sectionId: `QUESTIONNAIRE_${question.sectionId}`,
  dataType: question.type === "MULTI" ? "ENUM_ARRAY" : "ENUM",
  allowedValues: [...question.options],
  requirement: { intake: "RESOLUTION_REQUIRED", deployment: "VALUE_REQUIRED_WHEN_APPLICABLE" },
  unknownAllowed: question.options.includes("UNKNOWN"),
  notApplicableAllowed: question.options.includes("NOT_APPLICABLE"),
  applicability: question.showWhen ? {
    fieldId: `intakeAnswers.${question.showWhen.questionId}`,
    answerStates: [...(question.showWhen.answerStates ?? [])]
  } : null,
  explanationRequiredFor: question.options.includes("NOT_APPLICABLE") ? ["NOT_APPLICABLE"] : [],
  deterministicAcquisition: { supported: true, lane: "LABELLED_QUESTIONNAIRE_FACTS", mappings: [question.fieldId, question.id] },
  genAiProposalAllowed: question.humanDecisionAuthority === "SOLUTION_OWNER",
  humanAuthority: question.humanDecisionAuthority,
  lifecycleConsequence: "UNRESOLVED_BLOCKS_APPROVED_INTAKE"
}));

function deepFreeze(value) {
  if (!value || typeof value !== "object") return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.isFrozen(value) ? value : Object.freeze(value);
}

const fields = deepFreeze([...mainFields, ...questionnaireFields]);
const fieldIds = new Set(fields.map((field) => field.id));
invariant(fieldIds.size === fields.length, "Intake field registry IDs must be unique");

const registryPayload = deepFreeze({
  version: INTAKE_FIELD_REGISTRY_VERSION,
  questionnaireVersion: INTAKE_QUESTIONNAIRE.version,
  sections,
  fields,
  authorityPolicy: "Acquisition and GenAI may propose values; only an explicit user resolution may create an approved Intake snapshot."
});

export const INTAKE_FIELD_REGISTRY = deepFreeze({ ...registryPayload, hash: sha256(registryPayload) });

export function intakeField(fieldId) {
  return fields.find((field) => field.id === fieldId) ?? null;
}

export function validateQuestionnaireAgainstRegistry(questionnaire) {
  invariant(questionnaire && Array.isArray(questionnaire.questions), "The active Intake questionnaire is invalid");
  invariant(questionnaire.version === INTAKE_FIELD_REGISTRY.questionnaireVersion, "The active Intake questionnaire version does not match the field registry");
  const registered = new Map(questionnaireFields.map((field) => [field.questionId, field]));
  invariant(questionnaire.questions.length === registered.size, "The active Intake questionnaire does not contain every registered question");
  for (const question of questionnaire.questions) {
    const field = registered.get(question.id);
    invariant(field, `The active Intake questionnaire contains an unregistered question: ${question.id}`);
    invariant(field.questionnaireFieldId === question.fieldId, `Questionnaire field mapping differs for ${question.id}`);
    invariant(field.dataType === (question.type === "MULTI" ? "ENUM_ARRAY" : "ENUM"), `Questionnaire type differs for ${question.id}`);
    invariant(JSON.stringify(field.allowedValues) === JSON.stringify(question.options), `Questionnaire options differ for ${question.id}`);
  }
  return true;
}
