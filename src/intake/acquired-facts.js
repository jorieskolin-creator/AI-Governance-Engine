import { invariant } from "../contracts.js";
import { sha256, stableId, stableStringify } from "../core/hash.js";
import { INTAKE_FIELD_REGISTRY } from "./field-registry.js";

export const ACQUIRED_FACT_PACKAGE_VERSION = "acquired-fact-package-1.0.0";
export const ACQUIRED_FACT_SELECTION_VERSION = "acquired-fact-selection-1.0.0";

const ELIGIBILITY_STATES = new Set([
  "ELIGIBLE_CONTROLLED_VALUE",
  "INELIGIBLE_FREE_TEXT",
  "INELIGIBLE_UNKNOWN",
  "INELIGIBLE_CONFLICTING",
  "INELIGIBLE_NOT_OBSERVED",
  "INELIGIBLE_FIELD_POLICY",
  "INELIGIBLE_BLOCKING_SCREENING"
]);
const CONTROLLED_TYPES = new Set(["ENUM", "ENUM_ARRAY", "BOOLEAN"]);

function factFor(profile, field) {
  return field.questionId ? profile.assessmentIntakeFacts?.[field.questionId] : profile.fields?.[field.id];
}

function acquiredValue(fact, field) {
  if (!fact) return null;
  if (field.questionId) {
    if (["UNKNOWN", "NOT_APPLICABLE", "HUMAN_REVIEW_REQUIRED"].includes(fact.answerState)) return null;
    return field.dataType === "ENUM_ARRAY" ? fact.value : fact.answerState;
  }
  const value = fact.value;
  return value === null || value === undefined || value === "" || value === "UNKNOWN" || Array.isArray(value) && !value.length ? null : value;
}

function controlledValueIsValid(field, value) {
  if (field.dataType === "BOOLEAN") return typeof value === "boolean";
  if (field.dataType === "ENUM") return typeof value === "string" && field.allowedValues.includes(value);
  if (field.dataType === "ENUM_ARRAY") return Array.isArray(value) && value.length > 0 && value.every((item) => field.allowedValues.includes(item));
  return false;
}

function eligibility(field, fact, value, transmissionBlocked) {
  if (transmissionBlocked) return "INELIGIBLE_BLOCKING_SCREENING";
  if (!field.genAiProposalAllowed) return "INELIGIBLE_FIELD_POLICY";
  if (!CONTROLLED_TYPES.has(field.dataType)) return "INELIGIBLE_FREE_TEXT";
  if (!fact || value === null || !controlledValueIsValid(field, value)) return "INELIGIBLE_UNKNOWN";
  if (fact.status === "CONFLICTING" || fact.supportStatus === "CONFLICTING") return "INELIGIBLE_CONFLICTING";
  const observed = field.questionId ? fact.origin === "OBSERVED" : fact.factClass === "OBSERVED";
  if (!observed) return "INELIGIBLE_NOT_OBSERVED";
  return "ELIGIBLE_CONTROLLED_VALUE";
}

export function validateAcquiredFactPackage(pkg) {
  invariant(pkg && typeof pkg === "object" && !Array.isArray(pkg), "Acquired fact package is required");
  invariant(pkg.schemaVersion === ACQUIRED_FACT_PACKAGE_VERSION, "Acquired fact package version is unsupported");
  invariant(pkg.fieldRegistryVersion === INTAKE_FIELD_REGISTRY.version && pkg.fieldRegistryHash === INTAKE_FIELD_REGISTRY.hash, "Acquired fact package field registry is unsupported");
  invariant(Array.isArray(pkg.facts), "Acquired fact package facts are required");
  invariant(Object.keys(pkg).sort().join(",") === ["facts", "fieldRegistryHash", "fieldRegistryVersion", "packageHash", "schemaVersion"].sort().join(","), "Acquired fact package contains unregistered fields");
  const ids = new Set();
  const fieldIds = new Set();
  for (const fact of pkg.facts) {
    invariant(fact && typeof fact === "object" && !Array.isArray(fact), "Acquired fact record is invalid");
    invariant(typeof fact.id === "string" && !ids.has(fact.id), "Acquired fact IDs must be unique"); ids.add(fact.id);
    const field = INTAKE_FIELD_REGISTRY.fields.find((item) => item.id === fact.fieldId);
    invariant(field && !fieldIds.has(fact.fieldId), `Unknown or duplicate acquired fact field: ${fact.fieldId}`); fieldIds.add(fact.fieldId);
    invariant(fact.dataType === field.dataType && typeof fact.acquisitionState === "string", `${fact.fieldId} acquisition contract is invalid`);
    invariant(ELIGIBILITY_STATES.has(fact.genAiEligibility), `${fact.fieldId} GenAI eligibility is invalid`);
    invariant(Array.isArray(fact.evidenceRefs) && fact.evidenceRefs.every((item) => typeof item === "string"), `${fact.fieldId} evidence references are invalid`);
    invariant(Array.isArray(fact.limitations) && fact.limitations.every((item) => typeof item === "string"), `${fact.fieldId} limitations are invalid`);
    invariant(fact.genAiEligibility === "ELIGIBLE_CONTROLLED_VALUE" ? fact.value !== null : fact.value === null, `${fact.fieldId} value disclosure does not match eligibility`);
    if (fact.genAiEligibility === "ELIGIBLE_CONTROLLED_VALUE") invariant(controlledValueIsValid(field, fact.value), `${fact.fieldId} controlled value is invalid`);
    invariant(Object.keys(fact).sort().join(",") === ["acquisitionState", "dataType", "evidenceRefs", "fieldId", "genAiEligibility", "id", "limitations", "value"].sort().join(","), `${fact.fieldId} contains unregistered acquired fact fields`);
  }
  invariant(fieldIds.size === INTAKE_FIELD_REGISTRY.fields.length, "Acquired fact package field set is incomplete");
  const { packageHash, ...payload } = pkg;
  invariant(typeof packageHash === "string" && sha256(payload) === packageHash, "Acquired fact package failed its integrity check");
  return pkg;
}

export function createAcquiredFactPackage(profile, dlpFindings = []) {
  const blockedUnitIds = new Set(dlpFindings.filter((finding) => finding.blocking).map((finding) => finding.sourceUnitId));
  const transmissionBlocked = blockedUnitIds.size > 0;
  const facts = INTAKE_FIELD_REGISTRY.fields.map((field) => {
    const fact = factFor(profile, field);
    const value = acquiredValue(fact, field);
    const genAiEligibility = eligibility(field, fact, value, transmissionBlocked);
    const record = {
      fieldId: field.id,
      dataType: field.dataType,
      value: genAiEligibility === "ELIGIBLE_CONTROLLED_VALUE" ? structuredClone(value) : null,
      acquisitionState: fact?.status ?? fact?.supportStatus ?? "UNKNOWN",
      genAiEligibility,
      evidenceRefs: [...new Set(fact?.sourceUnitIds ?? [])],
      limitations: [...new Set(fact?.limitations ?? [])]
    };
    return { id: stableId("acquired-fact", record), ...record };
  });
  const payload = {
    schemaVersion: ACQUIRED_FACT_PACKAGE_VERSION,
    fieldRegistryVersion: INTAKE_FIELD_REGISTRY.version,
    fieldRegistryHash: INTAKE_FIELD_REGISTRY.hash,
    facts
  };
  return validateAcquiredFactPackage({ ...payload, packageHash: sha256(payload) });
}

export function createAcquiredFactSelectionUnit(pkg, selectedFactIds = []) {
  validateAcquiredFactPackage(pkg);
  invariant(Array.isArray(selectedFactIds) && selectedFactIds.every((id) => typeof id === "string"), "Selected acquired fact IDs must be an array");
  const selected = new Set(selectedFactIds);
  invariant(selected.size === selectedFactIds.length, "Selected acquired fact IDs must be unique");
  const factsById = new Map(pkg.facts.map((fact) => [fact.id, fact]));
  for (const id of selected) invariant(factsById.get(id)?.genAiEligibility === "ELIGIBLE_CONTROLLED_VALUE", `Acquired fact is not eligible for GenAI: ${id}`);
  const facts = selectedFactIds.map((id) => factsById.get(id)).map(({ id, fieldId, dataType, value }) => ({ id, fieldId, dataType, value }));
  if (!facts.length) return null;
  const selection = { schemaVersion: ACQUIRED_FACT_SELECTION_VERSION, packageHash: pkg.packageHash, facts };
  const content = stableStringify(selection);
  return {
    id: stableId("unit", selection),
    sourceId: stableId("src", pkg.packageHash),
    path: `derived/acquired-facts/${stableId("selection", selection)}.json`,
    format: "TEXT",
    mimeType: "application/json",
    evidenceKind: "ACQUIRED_FACT_SELECTION",
    evidenceClass: "DERIVED_OBSERVATION",
    assuranceCeiling: "DECLARED",
    locator: "user-selected-safe-facts",
    sha256: sha256(content),
    content,
    sensitivity: [],
    transmissionState: "APPROVED",
    coverage: { selectedFactCount: facts.length },
    derivation: { contractVersion: ACQUIRED_FACT_SELECTION_VERSION, parentSourceId: null, parentSha256: pkg.packageHash, rawContentIncluded: false }
  };
}
