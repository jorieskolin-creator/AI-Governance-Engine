import { invariant } from "../contracts.js";
import { sha256, stableId, stableStringify } from "../core/hash.js";
import { INTAKE_FIELD_REGISTRY } from "./field-registry.js";
import { INTAKE_CANDIDATE_PACKAGE_VERSION, PROVIDER_ELIGIBILITY_STATES, validateIntakeCandidatePackage } from "./candidate-contract.js";

export const ACQUIRED_FACT_PACKAGE_VERSION = "acquired-fact-package-1.1.0";
export const ACQUIRED_FACT_SELECTION_VERSION = "acquired-fact-selection-1.0.0";

const ELIGIBILITY_STATES = new Set(PROVIDER_ELIGIBILITY_STATES);
const CONTROLLED_TYPES = new Set(["ENUM", "ENUM_ARRAY", "BOOLEAN"]);

function controlledValueIsValid(field, value) {
  if (field.dataType === "BOOLEAN") return typeof value === "boolean";
  if (field.dataType === "ENUM") return typeof value === "string" && field.allowedValues.includes(value);
  if (field.dataType === "ENUM_ARRAY") return Array.isArray(value) && value.length > 0 && value.every((item) => field.allowedValues.includes(item));
  return false;
}

export function validateAcquiredFactPackage(pkg) {
  invariant(pkg && typeof pkg === "object" && !Array.isArray(pkg), "Acquired fact package is required");
  invariant(pkg.schemaVersion === ACQUIRED_FACT_PACKAGE_VERSION, "Acquired fact package version is unsupported");
  invariant(pkg.fieldRegistryVersion === INTAKE_FIELD_REGISTRY.version && pkg.fieldRegistryHash === INTAKE_FIELD_REGISTRY.hash, "Acquired fact package field registry is unsupported");
  invariant(pkg.candidatePackageVersion === INTAKE_CANDIDATE_PACKAGE_VERSION && /^[a-f0-9]{64}$/.test(pkg.candidatePackageHash), "Acquired fact package candidate source is unsupported");
  invariant(Array.isArray(pkg.facts), "Acquired fact package facts are required");
  invariant(Object.keys(pkg).sort().join(",") === ["candidatePackageHash", "candidatePackageVersion", "facts", "fieldRegistryHash", "fieldRegistryVersion", "packageHash", "schemaVersion"].sort().join(","), "Acquired fact package contains unregistered fields");
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

export function createAcquiredFactPackage(candidatePackage) {
  validateIntakeCandidatePackage(candidatePackage);
  const candidates = new Map(candidatePackage.candidates.map((candidate) => [candidate.fieldId, candidate]));
  const facts = INTAKE_FIELD_REGISTRY.fields.map((field) => {
    const candidate = candidates.get(field.id);
    const record = {
      fieldId: field.id,
      dataType: field.dataType,
      value: candidate.providerCandidate === null ? null : structuredClone(candidate.providerCandidate),
      acquisitionState: candidate.acquisitionState,
      genAiEligibility: candidate.providerEligibility,
      evidenceRefs: candidate.sourceRefs.map((ref) => ref.sourceUnitId),
      limitations: [...candidate.limitations]
    };
    return { id: stableId("acquired-fact", record), ...record };
  });
  const payload = {
    schemaVersion: ACQUIRED_FACT_PACKAGE_VERSION,
    fieldRegistryVersion: INTAKE_FIELD_REGISTRY.version,
    fieldRegistryHash: INTAKE_FIELD_REGISTRY.hash,
    candidatePackageVersion: candidatePackage.schemaVersion,
    candidatePackageHash: candidatePackage.packageHash,
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
