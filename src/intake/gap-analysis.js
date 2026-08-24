import { invariant } from "../contracts.js";
import { sha256 } from "../core/hash.js";
import { ACQUISITION_DIAGNOSTICS_VERSION, validateAcquisitionDiagnostics } from "./acquisition-diagnostics.js";
import { validateCodeEvidenceSummary } from "./code-evidence.js";
import { INTAKE_CANDIDATE_PACKAGE_VERSION, validateIntakeCandidatePackage } from "./candidate-contract.js";
import { validateDocumentEvidenceSummary } from "./document-evidence.js";
import { INTAKE_FIELD_REGISTRY } from "./field-registry.js";
import { classifyIntakeSearchEvidence, INTAKE_SEARCH_REGISTRY, intakeSearchField } from "./search-registry.js";
import { validateTabularEvidenceSummary } from "./tabular-evidence.js";

export const INTAKE_GAP_ANALYSIS_VERSION = "intake-gap-analysis-1.2.0";

const FIELD_STATES = new Set(["PRESENT", "CONFLICTING", "MISSING_UNKNOWN"]);
const RETRIEVAL_DISPOSITIONS = new Set([
  "NOT_NEEDED_PRESENT",
  "USER_RESOLUTION_REQUIRED",
  "BLOCKED_BY_PRIVACY",
  "TECHNICAL_RECOVERY_REQUIRED",
  "BOUNDED_LOCAL_REREAD_POSSIBLE",
  "UNKNOWN_SOURCE_SILENCE",
  "UNKNOWN_NO_APPLICABLE_SOURCE"
]);
const SIGNAL_TYPES = new Set(["DOCUMENT_TOPIC", "CODE_CAPABILITY", "TABULAR_SEMANTIC"]);

const FIELD_CONCEPTS = Object.freeze([
  [/purpose|expectedValue/i, ["DOCUMENT_TOPIC:PURPOSE_AND_VALUE"]],
  [/accountableOwner|monitoringOwner|owner/i, ["DOCUMENT_TOPIC:OWNERSHIP_AND_ACCOUNTABILITY", "TABULAR_SEMANTIC:OWNER_COLUMNS"]],
  [/currentStage|targetStage|lifecycle/i, ["DOCUMENT_TOPIC:LIFECYCLE"]],
  [/jurisdiction|countries|region/i, ["DOCUMENT_TOPIC:RISK_AND_COMPLIANCE", "TABULAR_SEMANTIC:REGION_COLUMNS"]],
  [/operatingBoundary|allowedUses|excludedUses|userScope|integrationScope|permissionScope|autonomyScope/i, ["DOCUMENT_TOPIC:OPERATING_BOUNDARY"]],
  [/data\.|dataScope|privacy|personal|retention/i, ["DOCUMENT_TOPIC:DATA_AND_PRIVACY", "TABULAR_SEMANTIC:PERSONAL_DATA_COLUMNS"]],
  [/exposure|access|externalUsers/i, ["DOCUMENT_TOPIC:OPERATING_BOUNDARY", "CODE_CAPABILITY:AUTHENTICATION", "CODE_CAPABILITY:AUTHORIZATION"]],
  [/agent|action|autonomy|override/i, ["DOCUMENT_TOPIC:OPERATING_BOUNDARY", "DOCUMENT_TOPIC:HUMAN_OVERSIGHT", "CODE_CAPABILITY:AGENT_OR_TOOL_EXECUTION", "CODE_CAPABILITY:HUMAN_APPROVAL_GATE"]],
  [/monitor|incident|audit/i, ["DOCUMENT_TOPIC:MONITORING_AND_INCIDENTS", "CODE_CAPABILITY:AUDIT_LOGGING", "CODE_CAPABILITY:OBSERVABILITY"]],
  [/role|classification|risk|regulat|prohibited|highRisk/i, ["DOCUMENT_TOPIC:RISK_AND_COMPLIANCE"]],
  [/test|evaluat|validation|benchmark/i, ["DOCUMENT_TOPIC:TESTING_AND_EVALUATION", "TABULAR_SEMANTIC:MODEL_EVALUATION_COLUMNS"]],
  [/model|provider/i, ["DOCUMENT_TOPIC:MODEL_AND_PROVIDER", "CODE_CAPABILITY:EXTERNAL_MODEL_PROVIDER"]],
  [/security|credential/i, ["DOCUMENT_TOPIC:SECURITY"]]
]);

function safeSignals(providerUnits) {
  const signals = new Map();
  const add = (type, values) => {
    for (const value of values) {
      const key = `${type}:${value}`;
      signals.set(key, (signals.get(key) ?? 0) + 1);
    }
  };
  for (const unit of providerUnits) {
    if (!unit.evidenceKind) continue;
    const summary = JSON.parse(unit.content);
    if (unit.evidenceKind === "DOCUMENT_SUMMARY") add("DOCUMENT_TOPIC", validateDocumentEvidenceSummary(summary).topicSignals);
    else if (unit.evidenceKind === "CODE_SUMMARY") add("CODE_CAPABILITY", validateCodeEvidenceSummary(summary).capabilitySignals);
    else if (unit.evidenceKind === "TABULAR_SUMMARY") add("TABULAR_SEMANTIC", validateTabularEvidenceSummary(summary).semanticSignals);
  }
  return [...signals.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([key, sourceCount]) => {
    const separator = key.indexOf(":");
    return { signalType: key.slice(0, separator), signalId: key.slice(separator + 1), sourceCount };
  });
}

function relevantConceptKeys(field) {
  const searchable = `${field.id} ${field.questionnaireFieldId ?? ""}`;
  return [...new Set(FIELD_CONCEPTS.filter(([pattern]) => pattern.test(searchable)).flatMap(([, concepts]) => concepts))];
}

function attemptedMethods(rule, eligibleUnits) {
  if (!eligibleUnits.length) return [];
  return rule.extractionStrategies.filter((method) => {
    if (method === "MANIFEST_PROPERTY") return eligibleUnits.some((unit) => unit.searchEvidenceType === "PROJECT_MANIFEST");
    if (method === "README_TITLE") return eligibleUnits.some((unit) => unit.searchEvidenceType === "README");
    if (method === "TABLE_KEY_VALUE") return eligibleUnits.some((unit) => /;table:\d+;row:\d+/.test(unit.locator ?? ""));
    return true;
  });
}

function technicalLossFor(rule, sourceIngestion, diagnostics) {
  const diagnosticByPath = new Map(diagnostics.items.map((item) => [item.path, item]));
  const relevant = sourceIngestion.items.flatMap((item) => {
    const diagnostic = diagnosticByPath.get(item.path);
    if (!diagnostic?.technicalLossReasonCodes.length) return [];
    const evidenceType = classifyIntakeSearchEvidence(item);
    return evidenceType !== null && rule.evidenceTypes.includes(evidenceType) ? [diagnostic] : [];
  });
  return {
    reasonCodes: [...new Set(relevant.flatMap((item) => item.technicalLossReasonCodes))].sort(),
    partialSourceCount: relevant.filter((item) => item.technicalLossScope === "PARTIAL_SOURCE_EXTRACTION").length,
    unavailableSourceCount: relevant.filter((item) => item.technicalLossScope === "SOURCE_UNAVAILABLE").length
  };
}

function retrievalDisposition({ state, privacyBlocked, technicalLoss, coveredEvidenceTypes, relevantSafeConceptSignals }) {
  if (state === "PRESENT") return "NOT_NEEDED_PRESENT";
  if (state === "CONFLICTING") return "USER_RESOLUTION_REQUIRED";
  if (privacyBlocked) return "BLOCKED_BY_PRIVACY";
  if (technicalLoss.reasonCodes.length && coveredEvidenceTypes.length === 0) return "TECHNICAL_RECOVERY_REQUIRED";
  if (coveredEvidenceTypes.length && relevantSafeConceptSignals.length) return "BOUNDED_LOCAL_REREAD_POSSIBLE";
  if (technicalLoss.reasonCodes.length) return "TECHNICAL_RECOVERY_REQUIRED";
  if (coveredEvidenceTypes.length) return "UNKNOWN_SOURCE_SILENCE";
  return "UNKNOWN_NO_APPLICABLE_SOURCE";
}

export function validateIntakeGapAnalysis(analysis) {
  invariant(analysis?.schemaVersion === INTAKE_GAP_ANALYSIS_VERSION, "Intake gap analysis version is unsupported");
  invariant(analysis.fieldRegistryVersion === INTAKE_FIELD_REGISTRY.version && analysis.fieldRegistryHash === INTAKE_FIELD_REGISTRY.hash, "Intake gap analysis field registry is unsupported");
  invariant(analysis.searchRegistryVersion === INTAKE_SEARCH_REGISTRY.version && analysis.searchRegistryHash === INTAKE_SEARCH_REGISTRY.hash, "Intake gap analysis search registry is unsupported");
  invariant(analysis.candidatePackageVersion === INTAKE_CANDIDATE_PACKAGE_VERSION && /^[a-f0-9]{64}$/.test(analysis.candidatePackageHash), "Intake gap analysis candidate source is invalid");
  invariant(analysis.acquisitionDiagnosticsVersion === ACQUISITION_DIAGNOSTICS_VERSION && /^[a-f0-9]{64}$/.test(analysis.acquisitionCoverageHash), "Intake gap analysis diagnostic source is invalid");
  invariant(Array.isArray(analysis.safeConceptCoverage) && new Set(analysis.safeConceptCoverage.map((signal) => `${signal.signalType}:${signal.signalId}`)).size === analysis.safeConceptCoverage.length && analysis.safeConceptCoverage.every((signal) => SIGNAL_TYPES.has(signal.signalType) && typeof signal.signalId === "string" && signal.signalId && Number.isInteger(signal.sourceCount) && signal.sourceCount > 0 && Object.keys(signal).sort().join(",") === "signalId,signalType,sourceCount"), "Intake gap analysis safe concept coverage is invalid");
  invariant(Array.isArray(analysis.fields) && analysis.fields.length === INTAKE_FIELD_REGISTRY.fields.length, "Intake gap analysis fields are incomplete");
  const fieldIds = new Set();
  for (const field of analysis.fields) {
    const rule = intakeSearchField(field.fieldId);
    invariant(rule && !fieldIds.has(field.fieldId), `Unknown or duplicate Intake gap field: ${field.fieldId}`); fieldIds.add(field.fieldId);
    invariant(FIELD_STATES.has(field.state) && RETRIEVAL_DISPOSITIONS.has(field.retrievalDisposition), `${field.fieldId} gap state is invalid`);
    invariant(Array.isArray(field.attemptedMethods) && new Set(field.attemptedMethods).size === field.attemptedMethods.length && field.attemptedMethods.every((method) => rule.extractionStrategies.includes(method)), `${field.fieldId} attempted methods are invalid`);
    invariant(Array.isArray(field.coveredEvidenceTypes) && new Set(field.coveredEvidenceTypes).size === field.coveredEvidenceTypes.length && field.coveredEvidenceTypes.every((type) => rule.evidenceTypes.includes(type)), `${field.fieldId} evidence coverage is invalid`);
    invariant(field.technicalLoss && Array.isArray(field.technicalLoss.reasonCodes) && new Set(field.technicalLoss.reasonCodes).size === field.technicalLoss.reasonCodes.length && field.technicalLoss.reasonCodes.every((code) => typeof code === "string" && code), `${field.fieldId} technical loss is invalid`);
    invariant(Number.isInteger(field.technicalLoss.partialSourceCount) && field.technicalLoss.partialSourceCount >= 0 && Number.isInteger(field.technicalLoss.unavailableSourceCount) && field.technicalLoss.unavailableSourceCount >= 0, `${field.fieldId} technical-loss counts are invalid`);
    invariant((field.technicalLoss.reasonCodes.length === 0) === (field.technicalLoss.partialSourceCount + field.technicalLoss.unavailableSourceCount === 0), `${field.fieldId} technical-loss scope is inconsistent`);
    invariant(Object.keys(field.technicalLoss).sort().join(",") === "partialSourceCount,reasonCodes,unavailableSourceCount", `${field.fieldId} technical loss contains unregistered fields`);
    invariant(Array.isArray(field.relevantSafeConceptSignals) && new Set(field.relevantSafeConceptSignals).size === field.relevantSafeConceptSignals.length && field.relevantSafeConceptSignals.every((key) => typeof key === "string" && analysis.safeConceptCoverage.some((signal) => `${signal.signalType}:${signal.signalId}` === key)), `${field.fieldId} safe concept signals are invalid`);
    invariant(Array.isArray(field.limitations) && field.limitations.every((item) => typeof item === "string"), `${field.fieldId} gap limitations are invalid`);
    invariant(field.state !== "PRESENT" || field.retrievalDisposition === "NOT_NEEDED_PRESENT", `${field.fieldId} present field retrieval is invalid`);
    invariant(field.state !== "CONFLICTING" || field.retrievalDisposition === "USER_RESOLUTION_REQUIRED", `${field.fieldId} conflicting field retrieval is invalid`);
    if (field.state === "MISSING_UNKNOWN") {
      invariant(!["NOT_NEEDED_PRESENT", "USER_RESOLUTION_REQUIRED"].includes(field.retrievalDisposition), `${field.fieldId} missing field retrieval is invalid`);
      if (field.retrievalDisposition === "BLOCKED_BY_PRIVACY") invariant(analysis.coverage.privacyBlockedSourceCount > 0, `${field.fieldId} privacy block is not supported`);
      if (field.retrievalDisposition === "TECHNICAL_RECOVERY_REQUIRED") invariant(field.technicalLoss.reasonCodes.length > 0, `${field.fieldId} technical recovery is not supported`);
      if (field.retrievalDisposition === "BOUNDED_LOCAL_REREAD_POSSIBLE") invariant(field.coveredEvidenceTypes.length > 0 && field.relevantSafeConceptSignals.length > 0, `${field.fieldId} bounded retrieval is not supported`);
      if (field.retrievalDisposition === "UNKNOWN_SOURCE_SILENCE") invariant(field.coveredEvidenceTypes.length > 0 && field.relevantSafeConceptSignals.length === 0 && field.technicalLoss.reasonCodes.length === 0, `${field.fieldId} source silence is not supported`);
      if (field.retrievalDisposition === "UNKNOWN_NO_APPLICABLE_SOURCE") invariant(field.coveredEvidenceTypes.length === 0 && field.technicalLoss.reasonCodes.length === 0, `${field.fieldId} missing source coverage is inconsistent`);
    }
    invariant(Object.keys(field).sort().join(",") === ["attemptedMethods", "coveredEvidenceTypes", "fieldId", "limitations", "relevantSafeConceptSignals", "retrievalDisposition", "state", "technicalLoss"].sort().join(","), `${field.fieldId} gap contains unregistered fields`);
  }
  const expectedSummary = {
    totalFieldCount: analysis.fields.length,
    presentFieldCount: analysis.fields.filter((field) => field.state === "PRESENT").length,
    conflictingFieldCount: analysis.fields.filter((field) => field.state === "CONFLICTING").length,
    missingFieldCount: analysis.fields.filter((field) => field.state === "MISSING_UNKNOWN").length,
    boundedRetrievalFieldCount: analysis.fields.filter((field) => field.retrievalDisposition === "BOUNDED_LOCAL_REREAD_POSSIBLE").length,
    technicalRecoveryFieldCount: analysis.fields.filter((field) => field.retrievalDisposition === "TECHNICAL_RECOVERY_REQUIRED").length
  };
  invariant(JSON.stringify(analysis.summary) === JSON.stringify(expectedSummary), "Intake gap analysis summary is inconsistent");
  invariant(Object.keys(analysis.coverage).sort().join(",") === ["contentExtractedSourceCount", "parsedSourceCount", "privacyBlockedSourceCount", "selectedSourceCount", "sourceEvidenceTypes", "technicalLossSourceCount", "unscopedTechnicalLossSourceCount"].sort().join(","), "Intake gap analysis coverage is invalid");
  invariant(["selectedSourceCount", "parsedSourceCount", "contentExtractedSourceCount", "technicalLossSourceCount", "unscopedTechnicalLossSourceCount", "privacyBlockedSourceCount"].every((key) => Number.isInteger(analysis.coverage[key]) && analysis.coverage[key] >= 0), "Intake gap analysis coverage counts are invalid");
  invariant(analysis.coverage.unscopedTechnicalLossSourceCount <= analysis.coverage.technicalLossSourceCount, "Unscoped technical-loss coverage is invalid");
  invariant(Array.isArray(analysis.coverage.sourceEvidenceTypes) && analysis.coverage.sourceEvidenceTypes.every((type) => INTAKE_SEARCH_REGISTRY.evidenceTypes.includes(type)), "Intake gap analysis source evidence types are invalid");
  invariant(Object.keys(analysis.summary).sort().join(",") === Object.keys(expectedSummary).sort().join(","), "Intake gap analysis summary contains unregistered fields");
  invariant(Object.keys(analysis).sort().join(",") === ["acquisitionCoverageHash", "acquisitionDiagnosticsVersion", "analysisHash", "candidatePackageHash", "candidatePackageVersion", "coverage", "fieldRegistryHash", "fieldRegistryVersion", "fields", "safeConceptCoverage", "schemaVersion", "searchRegistryHash", "searchRegistryVersion", "summary"].sort().join(","), "Intake gap analysis contains unregistered fields");
  const { analysisHash, ...payload } = analysis;
  invariant(typeof analysisHash === "string" && sha256(payload) === analysisHash, "Intake gap analysis failed its integrity check");
  return analysis;
}

export function createIntakeGapAnalysis({ candidatePackage, acquisitionDiagnostics, sourceIngestion, localSourceUnits, providerUnits }) {
  validateIntakeCandidatePackage(candidatePackage);
  validateAcquisitionDiagnostics(acquisitionDiagnostics);
  const safeConceptCoverage = safeSignals(providerUnits);
  const safeSignalKeys = new Set(safeConceptCoverage.map((signal) => `${signal.signalType}:${signal.signalId}`));
  const searchableUnits = localSourceUnits.filter((unit) => !unit.ocr || unit.ocr.qualificationState === "QUALIFIED").map((unit) => ({ ...unit, searchEvidenceType: classifyIntakeSearchEvidence(unit) }));
  const availableEvidenceTypes = [...new Set(searchableUnits.map((unit) => unit.searchEvidenceType).filter(Boolean))].sort();
  const diagnosticByPath = new Map(acquisitionDiagnostics.items.map((item) => [item.path, item]));
  const unscopedTechnicalLossSourceCount = sourceIngestion.items.filter((item) => diagnosticByPath.get(item.path)?.technicalLossScope !== "NONE" && classifyIntakeSearchEvidence(item) === null).length;
  const privacyBlocked = acquisitionDiagnostics.counts.PRIVACY_BLOCKED > 0;
  const candidates = new Map(candidatePackage.candidates.map((candidate) => [candidate.fieldId, candidate]));
  const fields = INTAKE_FIELD_REGISTRY.fields.map((field) => {
    const rule = intakeSearchField(field.id);
    const candidate = candidates.get(field.id);
    const state = candidate.conflicts.length || candidate.acquisitionState === "CONFLICTING" ? "CONFLICTING" : candidate.sanitizedCandidate !== null ? "PRESENT" : "MISSING_UNKNOWN";
    const eligibleUnits = searchableUnits.filter((unit) => rule.evidenceTypes.includes(unit.searchEvidenceType));
    const coveredEvidenceTypes = rule.evidenceTypes.filter((type) => availableEvidenceTypes.includes(type));
    const technicalLoss = technicalLossFor(rule, sourceIngestion, acquisitionDiagnostics);
    const relevantSafeConceptSignals = relevantConceptKeys(field).filter((key) => safeSignalKeys.has(key));
    const disposition = retrievalDisposition({ state, privacyBlocked, technicalLoss, coveredEvidenceTypes, relevantSafeConceptSignals });
    return {
      fieldId: field.id,
      state,
      attemptedMethods: attemptedMethods(rule, eligibleUnits),
      coveredEvidenceTypes,
      technicalLoss,
      relevantSafeConceptSignals,
      retrievalDisposition: disposition,
      limitations: [
        "Gap analysis records search coverage and retrieval opportunity only; it does not establish a field value or factual absence.",
        ...(technicalLoss.partialSourceCount ? [`${technicalLoss.partialSourceCount} applicable source(s) were only partially extracted; available content was still searched.`] : []),
        ...(technicalLoss.unavailableSourceCount ? [`${technicalLoss.unavailableSourceCount} applicable source(s) were unavailable to deterministic extraction.`] : []),
        ...(disposition === "UNKNOWN_SOURCE_SILENCE" ? ["Applicable extracted sources produced no candidate or relevant controlled concept signal; the field remains UNKNOWN."] : []),
        ...(disposition === "BOUNDED_LOCAL_REREAD_POSSIBLE" ? ["Controlled concept signals justify only a bounded local re-read; they are not evidence of the missing field value."] : [])
      ]
    };
  });
  const summary = {
    totalFieldCount: fields.length,
    presentFieldCount: fields.filter((field) => field.state === "PRESENT").length,
    conflictingFieldCount: fields.filter((field) => field.state === "CONFLICTING").length,
    missingFieldCount: fields.filter((field) => field.state === "MISSING_UNKNOWN").length,
    boundedRetrievalFieldCount: fields.filter((field) => field.retrievalDisposition === "BOUNDED_LOCAL_REREAD_POSSIBLE").length,
    technicalRecoveryFieldCount: fields.filter((field) => field.retrievalDisposition === "TECHNICAL_RECOVERY_REQUIRED").length
  };
  const payload = {
    schemaVersion: INTAKE_GAP_ANALYSIS_VERSION,
    fieldRegistryVersion: INTAKE_FIELD_REGISTRY.version,
    fieldRegistryHash: INTAKE_FIELD_REGISTRY.hash,
    searchRegistryVersion: INTAKE_SEARCH_REGISTRY.version,
    searchRegistryHash: INTAKE_SEARCH_REGISTRY.hash,
    candidatePackageVersion: candidatePackage.schemaVersion,
    candidatePackageHash: candidatePackage.packageHash,
    acquisitionDiagnosticsVersion: acquisitionDiagnostics.schemaVersion,
    acquisitionCoverageHash: sha256({
      counts: acquisitionDiagnostics.counts,
      technicalLoss: acquisitionDiagnostics.technicalLoss,
      sourceSilence: acquisitionDiagnostics.sourceSilence,
      items: acquisitionDiagnostics.items
    }),
    coverage: {
      selectedSourceCount: acquisitionDiagnostics.counts.SELECTED,
      parsedSourceCount: acquisitionDiagnostics.counts.PARSED,
      contentExtractedSourceCount: acquisitionDiagnostics.counts.CONTENT_EXTRACTED,
      technicalLossSourceCount: acquisitionDiagnostics.technicalLoss.count,
      unscopedTechnicalLossSourceCount,
      privacyBlockedSourceCount: acquisitionDiagnostics.counts.PRIVACY_BLOCKED,
      sourceEvidenceTypes: availableEvidenceTypes
    },
    safeConceptCoverage,
    summary,
    fields
  };
  return validateIntakeGapAnalysis({ ...payload, analysisHash: sha256(payload) });
}
