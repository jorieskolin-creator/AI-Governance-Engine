import { invariant } from "../contracts.js";
import { sha256, stableId, stableStringify } from "../core/hash.js";
import { INTAKE_FIELD_REGISTRY } from "./field-registry.js";
import { INTAKE_EXTRACTION_STRATEGIES, INTAKE_SEARCH_REGISTRY, intakeSearchField } from "./search-registry.js";

export const INTAKE_CANDIDATE_PACKAGE_VERSION = "intake-candidate-package-1.0.0";

export const PROVIDER_ELIGIBILITY_STATES = Object.freeze([
  "ELIGIBLE_CONTROLLED_VALUE",
  "INELIGIBLE_FREE_TEXT",
  "INELIGIBLE_UNKNOWN",
  "INELIGIBLE_CONFLICTING",
  "INELIGIBLE_NOT_OBSERVED",
  "INELIGIBLE_FIELD_POLICY",
  "INELIGIBLE_BLOCKING_SCREENING",
  "INELIGIBLE_UNSAFE_CANDIDATE"
]);

const CONTROLLED_TYPES = new Set(["ENUM", "ENUM_ARRAY", "BOOLEAN"]);
const DISCLOSURE_POLICIES = new Set(["CONTROLLED_VALUE_USER_SELECTION_REQUIRED", "LOCAL_ONLY_SANITIZED_FREE_TEXT", "PROVIDER_DISCLOSURE_PROHIBITED"]);
const CONFIDENCE_STATES = new Set(["HIGH", "MEDIUM", "REVIEW_REQUIRED", "NOT_ASSESSED"]);
const ACQUISITION_STATES = new Set(["CANDIDATE", "CONFIRMED", "CONFLICTING", "UNKNOWN", "SUPPORTED", "PARTIAL", "UNSUPPORTED", "NOT_CHECKED"]);
const EXTRACTION_METHODS = new Set([...INTAKE_EXTRACTION_STRATEGIES, "LOCAL_OCR"]);
const SENSITIVE_TEXT = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b|\b(?:sk|xai|mk)-[a-z0-9_-]{16,}\b/i;

function factFor(profile, field) {
  return field.questionId ? profile.assessmentIntakeFacts?.[field.questionId] : profile.fields?.[field.id];
}

function factValue(fact, field) {
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

function containsSensitiveText(value) {
  return (Array.isArray(value) ? value : [value]).some((item) => typeof item === "string" && SENSITIVE_TEXT.test(item));
}

function disclosurePolicy(field) {
  if (!field.genAiProposalAllowed) return "PROVIDER_DISCLOSURE_PROHIBITED";
  return CONTROLLED_TYPES.has(field.dataType) ? "CONTROLLED_VALUE_USER_SELECTION_REQUIRED" : "LOCAL_ONLY_SANITIZED_FREE_TEXT";
}

function observedFact(fact, field) {
  return field.questionId ? fact?.origin === "OBSERVED" : fact?.factClass === "OBSERVED";
}

function fallbackExtractionMethod(field) {
  const strategies = intakeSearchField(field.id)?.extractionStrategies ?? [];
  return strategies.find((method) => method.startsWith("LABELLED_")) ?? strategies[0] ?? "UNREGISTERED";
}

function extractionMethod(field, unit) {
  const locator = unit.locator ?? "";
  const path = unit.path?.toLowerCase() ?? "";
  const rule = intakeSearchField(field.id);
  if (unit.ocr) return "LOCAL_OCR";
  if (field.id === "name" && /^html:title(?:;lines:\d+-\d+)?$/.test(locator) && /^.{2,140}?\s*(?:[-—|:]\s*)(?:current\s+)?(?:architecture|system design|solution design)\s*$/i.test(unit.content)) return "HTML_ARCHITECTURE_TITLE";
  if (field.id === "name" && /^page:1;heading:1(?:;lines:\d+-\d+)?$/.test(locator) && unit.format === "PDF") return "PDF_DOCUMENT_TITLE";
  if (field.id === "intendedPurpose" && /^page:1;paragraph:1(?:;lines:\d+-\d+)?$/.test(locator) && unit.format === "PDF" && /(?:purpose|intended[-_ ]?use|overview|solution[-_ ]?brief)/i.test(path)) return "PDF_PURPOSE_LEDE";
  if (field.id === "name" && /(?:^|\/)(?:package\.json|pyproject\.toml|cargo\.toml|go\.mod|composer\.json)$/.test(path)) return "MANIFEST_PROPERTY";
  if (rule?.labels.some((label) => new RegExp(`^\\s*(?:[-*]\\s*)?${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\??\\s*[:=\\-]`, "i").test(unit.content))) return fallbackExtractionMethod(field);
  if (field.id === "name" && /(?:^|\/)readme(?:\.[^/]*)?$/.test(path)) return "README_TITLE";
  if (/;table:\d+;row:\d+/.test(locator)) return "TABLE_KEY_VALUE";
  if (/embedded-json/.test(locator) || unit.evidenceClass === "DECLARED" && /\.json$/.test(path)) return "STRUCTURED_PROPERTY";
  if (/;(?:heading|paragraph):\d+/.test(locator) && rule?.extractionStrategies.includes("HEADING_VALUE")) return "HEADING_VALUE";
  return fallbackExtractionMethod(field);
}

function sourceReferences(field, fact, localUnits) {
  const units = new Map(localUnits.map((unit) => [unit.id, unit]));
  return [...new Set(fact?.sourceUnitIds ?? [])].map((sourceUnitId) => units.get(sourceUnitId)).filter(Boolean).map((unit) => ({
    sourceUnitId: unit.id,
    sourceId: unit.sourceId,
    extractionMethod: extractionMethod(field, unit)
  }));
}

function confidenceFor(sourceRefs, fact, localUnits) {
  if (fact?.status === "CONFLICTING" || fact?.supportStatus === "CONFLICTING") return "REVIEW_REQUIRED";
  if (!sourceRefs.length) return "NOT_ASSESSED";
  const units = new Map(localUnits.map((unit) => [unit.id, unit]));
  if (sourceRefs.some((ref) => ref.extractionMethod === "LOCAL_OCR" && (units.get(ref.sourceUnitId)?.ocr?.confidence ?? 0) < 90)) return "MEDIUM";
  if (sourceRefs.some((ref) => ["HEADING_VALUE", "TABLE_KEY_VALUE", "README_TITLE", "HTML_ARCHITECTURE_TITLE", "PDF_DOCUMENT_TITLE", "PDF_PURPOSE_LEDE"].includes(ref.extractionMethod))) return "MEDIUM";
  return "HIGH";
}

function conflictCandidates(fact, field) {
  if (fact?.status !== "CONFLICTING" && fact?.supportStatus !== "CONFLICTING") return [];
  return (fact.candidates ?? []).map((candidate) => {
    const value = field.questionId
      ? candidate.values?.length ? candidate.values : candidate.answerState ?? candidate.value ?? null
      : candidate.value ?? null;
    return value === null || containsSensitiveText(value) ? null : structuredClone(value);
  }).filter((value) => value !== null);
}

function providerEligibility({ field, fact, candidate, conflicts, policy, transmissionBlocked, unsafe, hasValue }) {
  if (transmissionBlocked) return "INELIGIBLE_BLOCKING_SCREENING";
  if (unsafe) return "INELIGIBLE_UNSAFE_CANDIDATE";
  if (policy === "PROVIDER_DISCLOSURE_PROHIBITED") return "INELIGIBLE_FIELD_POLICY";
  if (!observedFact(fact, field) && hasValue) return "INELIGIBLE_NOT_OBSERVED";
  if (conflicts.length || fact?.status === "CONFLICTING" || fact?.supportStatus === "CONFLICTING") return "INELIGIBLE_CONFLICTING";
  if (candidate === null) return "INELIGIBLE_UNKNOWN";
  if (policy === "LOCAL_ONLY_SANITIZED_FREE_TEXT") return "INELIGIBLE_FREE_TEXT";
  return controlledValueIsValid(field, candidate) ? "ELIGIBLE_CONTROLLED_VALUE" : "INELIGIBLE_UNKNOWN";
}

function validateCandidateValue(field, value, label) {
  if (value === null) return;
  if (["STRING", "DATE"].includes(field.dataType)) invariant(typeof value === "string", `${field.id} ${label} is invalid`);
  else if (field.dataType === "STRING_ARRAY") invariant(Array.isArray(value) && value.every((item) => typeof item === "string"), `${field.id} ${label} is invalid`);
  else if (field.dataType === "ENUM_ARRAY") invariant(Array.isArray(value) && value.every((item) => typeof item === "string" && field.allowedValues.includes(item)), `${field.id} ${label} is invalid`);
  else if (field.dataType === "BOOLEAN") invariant(typeof value === "boolean", `${field.id} ${label} is invalid`);
  else invariant(typeof value === "string" && field.allowedValues.includes(value), `${field.id} ${label} is invalid`);
  invariant(!containsSensitiveText(value), `${field.id} ${label} contains unscreened sensitive text`);
}

export function validateIntakeCandidatePackage(pkg) {
  invariant(pkg?.schemaVersion === INTAKE_CANDIDATE_PACKAGE_VERSION, "Intake candidate package version is unsupported");
  invariant(pkg.fieldRegistryVersion === INTAKE_FIELD_REGISTRY.version && pkg.fieldRegistryHash === INTAKE_FIELD_REGISTRY.hash, "Intake candidate package field registry is unsupported");
  invariant(pkg.searchRegistryVersion === INTAKE_SEARCH_REGISTRY.version && pkg.searchRegistryHash === INTAKE_SEARCH_REGISTRY.hash, "Intake candidate package search registry is unsupported");
  invariant(Array.isArray(pkg.candidates), "Intake candidates are required");
  invariant(Object.keys(pkg).sort().join(",") === ["candidates", "fieldRegistryHash", "fieldRegistryVersion", "packageHash", "schemaVersion", "searchRegistryHash", "searchRegistryVersion"].sort().join(","), "Intake candidate package contains unregistered fields");
  const ids = new Set();
  const fieldIds = new Set();
  for (const candidate of pkg.candidates) {
    const field = INTAKE_FIELD_REGISTRY.fields.find((item) => item.id === candidate.fieldId);
    invariant(field && !fieldIds.has(field.id), `Unknown or duplicate Intake candidate field: ${candidate.fieldId}`); fieldIds.add(field.id);
    invariant(typeof candidate.id === "string" && !ids.has(candidate.id), "Intake candidate IDs must be unique"); ids.add(candidate.id);
    invariant(candidate.dataType === field.dataType, `${field.id} candidate data type is invalid`);
    invariant(ACQUISITION_STATES.has(candidate.acquisitionState), `${field.id} candidate acquisition state is invalid`);
    validateCandidateValue(field, candidate.sanitizedCandidate, "sanitized candidate");
    validateCandidateValue(field, candidate.providerCandidate, "provider candidate");
    invariant(Array.isArray(candidate.sourceRefs) && new Set(candidate.sourceRefs.map((ref) => ref.sourceUnitId)).size === candidate.sourceRefs.length && candidate.sourceRefs.every((ref) => /^unit-[a-f0-9]{24}$/.test(ref.sourceUnitId) && /^src-[a-f0-9]{24}$/.test(ref.sourceId) && EXTRACTION_METHODS.has(ref.extractionMethod) && Object.keys(ref).sort().join(",") === "extractionMethod,sourceId,sourceUnitId"), `${field.id} candidate source references are invalid`);
    invariant(CONFIDENCE_STATES.has(candidate.confidence), `${field.id} candidate confidence is invalid`);
    invariant(Array.isArray(candidate.conflicts), `${field.id} candidate conflicts are invalid`);
    for (const conflict of candidate.conflicts) validateCandidateValue(field, conflict, "conflict");
    invariant(DISCLOSURE_POLICIES.has(candidate.disclosurePolicy), `${field.id} disclosure policy is invalid`);
    invariant(PROVIDER_ELIGIBILITY_STATES.includes(candidate.providerEligibility), `${field.id} provider eligibility is invalid`);
    invariant(Array.isArray(candidate.limitations) && candidate.limitations.every((item) => typeof item === "string"), `${field.id} candidate limitations are invalid`);
    invariant(candidate.providerEligibility === "ELIGIBLE_CONTROLLED_VALUE" ? candidate.providerCandidate !== null && controlledValueIsValid(field, candidate.providerCandidate) : candidate.providerCandidate === null, `${field.id} provider disclosure does not match eligibility`);
    if (candidate.providerEligibility === "ELIGIBLE_CONTROLLED_VALUE") {
      invariant(candidate.disclosurePolicy === "CONTROLLED_VALUE_USER_SELECTION_REQUIRED", `${field.id} provider disclosure policy is invalid`);
      invariant(candidate.sourceRefs.length > 0 && ["CANDIDATE", "CONFIRMED", "SUPPORTED", "PARTIAL"].includes(candidate.acquisitionState), `${field.id} provider candidate is not observed`);
      invariant(candidate.conflicts.length === 0 && stableStringify(candidate.providerCandidate) === stableStringify(candidate.sanitizedCandidate), `${field.id} provider candidate does not match the conflict-free local candidate`);
    }
    invariant(candidate.disclosurePolicy !== "LOCAL_ONLY_SANITIZED_FREE_TEXT" || candidate.providerCandidate === null, `${field.id} local-only free text cannot become provider eligible`);
    invariant(Object.keys(candidate).sort().join(",") === ["acquisitionState", "confidence", "conflicts", "dataType", "disclosurePolicy", "fieldId", "id", "limitations", "providerCandidate", "providerEligibility", "sanitizedCandidate", "sourceRefs"].sort().join(","), `${field.id} contains unregistered candidate fields`);
    const { id, ...record } = candidate;
    invariant(id === stableId("intake-candidate", record), `${field.id} candidate identity is invalid`);
  }
  invariant(fieldIds.size === INTAKE_FIELD_REGISTRY.fields.length, "Intake candidate field set is incomplete");
  const { packageHash, ...payload } = pkg;
  invariant(typeof packageHash === "string" && sha256(payload) === packageHash, "Intake candidate package failed its integrity check");
  return pkg;
}

export function createIntakeCandidatePackage(profile, localUnits = [], dlpFindings = []) {
  const transmissionBlocked = dlpFindings.some((finding) => finding.blocking);
  const candidates = INTAKE_FIELD_REGISTRY.fields.map((field) => {
    const fact = factFor(profile, field);
    const value = factValue(fact, field);
    const rawCandidate = observedFact(fact, field) ? value : null;
    const unsafe = rawCandidate !== null && containsSensitiveText(rawCandidate);
    const sanitizedCandidate = unsafe ? null : rawCandidate === null ? null : structuredClone(rawCandidate);
    const sourceRefs = sourceReferences(field, fact, localUnits);
    const conflicts = conflictCandidates(fact, field);
    const policy = disclosurePolicy(field);
    const eligibility = providerEligibility({ field, fact, candidate: sanitizedCandidate, conflicts, policy, transmissionBlocked, unsafe, hasValue: value !== null });
    const limitations = [...new Set([
      ...(fact?.limitations ?? []),
      "Confidence describes deterministic extraction quality, not factual correctness or approval.",
      ...(policy === "LOCAL_ONLY_SANITIZED_FREE_TEXT" ? ["Sanitized free text remains local and is never provider eligible."] : []),
      ...(conflicts.length ? ["Conflicting candidates require explicit user resolution."] : []),
      ...(unsafe ? ["The candidate was withheld because local screening detected unsanitized sensitive text."] : [])
    ])];
    const record = {
      fieldId: field.id,
      dataType: field.dataType,
      sanitizedCandidate,
      sourceRefs,
      acquisitionState: fact?.status ?? fact?.supportStatus ?? "UNKNOWN",
      confidence: confidenceFor(sourceRefs, fact, localUnits),
      conflicts,
      disclosurePolicy: policy,
      providerEligibility: eligibility,
      providerCandidate: eligibility === "ELIGIBLE_CONTROLLED_VALUE" ? structuredClone(sanitizedCandidate) : null,
      limitations
    };
    return { id: stableId("intake-candidate", record), ...record };
  });
  const payload = {
    schemaVersion: INTAKE_CANDIDATE_PACKAGE_VERSION,
    fieldRegistryVersion: INTAKE_FIELD_REGISTRY.version,
    fieldRegistryHash: INTAKE_FIELD_REGISTRY.hash,
    searchRegistryVersion: INTAKE_SEARCH_REGISTRY.version,
    searchRegistryHash: INTAKE_SEARCH_REGISTRY.hash,
    candidates
  };
  return validateIntakeCandidatePackage({ ...payload, packageHash: sha256(payload) });
}
