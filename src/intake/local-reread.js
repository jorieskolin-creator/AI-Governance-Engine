import { invariant } from "../contracts.js";
import { discoverSolutionProfile } from "../core/solution-profile.js";
import { sha256, stableId, stableStringify } from "../core/hash.js";
import { redactText } from "../cognitive/source-intake.js";
import { validateIntakeRetrievalPlan } from "../cognitive/retrieval-planner.js";
import { createAcquiredFactPackage } from "./acquired-facts.js";
import { createAcquisitionDiagnostics, setAcquisitionGenAiStatus } from "./acquisition-diagnostics.js";
import { createIntakeCandidatePackage, validateIntakeCandidatePackage } from "./candidate-contract.js";
import { createIntakeGapAnalysis, validateIntakeGapAnalysis } from "./gap-analysis.js";
import { classifyIntakeSearchEvidence, intakeSearchField } from "./search-registry.js";

export const LOCAL_REREAD_VERSION = "local-bounded-reread-1.0.0";
export const LOCAL_REREAD_PURPOSE = "EXECUTE_VALIDATED_RETRIEVAL_PLAN_LOCALLY";
export const LOCAL_REREAD_LIMITS = Object.freeze({ maxIterations: 1, maxSourceUnits: 500, maxCharacters: 1_000_000 });

const AUTHORITY = "LOCAL_EXTRACTION_ONLY_NO_FACT_APPROVAL_OR_INTAKE_DECISION_AUTHORITY";
const FIXED_LIMITATIONS = Object.freeze([
  "REREAD_RESULTS_ARE_CANDIDATES_NOT_APPROVED_INTAKE",
  "RAW_SOURCE_CONTENT_REMAINS_LOCAL_AND_NO_PROVIDER_CALL_IS_PERMITTED",
  "EVERY_CANDIDATE_REENTERS_DLP_SANITIZATION_VALIDATION_AND_HASHING"
]);

function boundedLimits(options = {}) {
  const value = {};
  for (const key of ["maxSourceUnits", "maxCharacters"]) {
    const requested = options[key] ?? LOCAL_REREAD_LIMITS[key];
    invariant(Number.isInteger(requested) && requested > 0 && requested <= LOCAL_REREAD_LIMITS[key], `Local re-read ${key} is invalid`);
    value[key] = requested;
  }
  return { maxIterations: 1, ...value };
}

function packetSetHash(packets) {
  return sha256((packets ?? []).map((packet) => ({ id: packet.id, hash: packet.hash, sourceUnitIds: packet.sourceUnits.map((unit) => unit.id) })));
}

function candidateState(candidate) {
  if (candidate.conflicts.length || candidate.acquisitionState === "CONFLICTING") return "CONFLICTING";
  return candidate.sanitizedCandidate === null ? "UNKNOWN" : "CANDIDATE";
}

function expectedOutcome(beforePackage, afterPackage, targetFieldIds) {
  const before = new Map(beforePackage.candidates.map((candidate) => [candidate.fieldId, candidate]));
  const after = new Map(afterPackage.candidates.map((candidate) => [candidate.fieldId, candidate]));
  const recoveredFieldIds = targetFieldIds.filter((fieldId) => before.get(fieldId).sanitizedCandidate === null && after.get(fieldId).sanitizedCandidate !== null && !after.get(fieldId).conflicts.length);
  const conflictingFieldIds = targetFieldIds.filter((fieldId) => candidateState(after.get(fieldId)) === "CONFLICTING");
  const remainingUnknownFieldIds = targetFieldIds.filter((fieldId) => candidateState(after.get(fieldId)) === "UNKNOWN");
  return { recoveredFieldIds, conflictingFieldIds, remainingUnknownFieldIds };
}

function boundedSourceUnits(run, plan) {
  const available = run.localSourceUnits.filter((unit) => unit.path !== "intended-use-dossier.json" && !unit.media && (!unit.ocr || unit.ocr.qualificationState === "QUALIFIED"));
  const indexed = available.map((unit, index) => ({ unit, index, evidenceType: classifyIntakeSearchEvidence(unit) }));
  const selectedIndexes = new Set();
  for (const suggestion of plan.suggestions) {
    const registered = intakeSearchField(suggestion.fieldId);
    const evidenceTypes = suggestion.sourcePriorities.length ? suggestion.sourcePriorities : registered.evidenceTypes;
    const terms = [...new Set([...registered.labels, ...suggestion.searchConcepts, ...suggestion.labelAliases].map((term) => term.toLocaleLowerCase()))];
    const eligibleIndexes = indexed.filter(({ evidenceType }) => evidenceTypes.includes(evidenceType)).map(({ index }) => index);
    const matchingIndexes = terms.length ? eligibleIndexes.filter((index) => terms.some((term) => available[index].content.toLocaleLowerCase().includes(term))) : eligibleIndexes;
    for (const index of matchingIndexes) {
      selectedIndexes.add(index);
      const next = available[index + 1];
      if (next && (next.sourceId ? next.sourceId === available[index].sourceId : next.path === available[index].path)) selectedIndexes.add(index + 1);
    }
  }
  return [...selectedIndexes].sort((left, right) => left - right).map((index) => available[index]);
}

export function validateLocalReread(result, { plan, beforePackage, afterPackage, acquiredFacts, gapAnalysis, packets } = {}) {
  invariant(result?.schemaVersion === LOCAL_REREAD_VERSION && result.status === "COMPLETED", "Local re-read version or status is invalid");
  invariant(result.authority === AUTHORITY && JSON.stringify(result.limitations) === JSON.stringify(FIXED_LIMITATIONS), "Local re-read authority is invalid");
  invariant(result.iterationCount === 1 && result.limits?.maxIterations === 1, "Local re-read iteration bound is invalid");
  invariant(Number.isInteger(result.limits.maxSourceUnits) && result.limits.maxSourceUnits > 0 && result.limits.maxSourceUnits <= LOCAL_REREAD_LIMITS.maxSourceUnits, "Local re-read source-unit bound is invalid");
  invariant(Number.isInteger(result.limits.maxCharacters) && result.limits.maxCharacters > 0 && result.limits.maxCharacters <= LOCAL_REREAD_LIMITS.maxCharacters, "Local re-read character bound is invalid");
  invariant(Number.isInteger(result.work.sourceUnitCount) && result.work.sourceUnitCount >= 0 && result.work.sourceUnitCount <= result.limits.maxSourceUnits, "Local re-read source-unit work is invalid");
  invariant(Number.isInteger(result.work.characterCount) && result.work.characterCount >= 0 && result.work.characterCount <= result.limits.maxCharacters, "Local re-read character work is invalid");
  invariant(Number.isInteger(result.screening.findingCount) && result.screening.findingCount >= 0 && Number.isInteger(result.screening.redactionAppliedCount) && result.screening.redactionAppliedCount >= 0, "Local re-read screening metrics are invalid");
  invariant(Object.keys(result.limits).sort().join(",") === "maxCharacters,maxIterations,maxSourceUnits" && Object.keys(result.work).sort().join(",") === "characterCount,sourceUnitCount" && Object.keys(result.screening).sort().join(",") === "findingCount,redactionAppliedCount", "Local re-read metrics contain unregistered fields");
  for (const key of ["targetFieldIds", "recoveredFieldIds", "conflictingFieldIds", "remainingUnknownFieldIds"]) invariant(Array.isArray(result[key]) && new Set(result[key]).size === result[key].length && result[key].every((fieldId) => typeof fieldId === "string" && fieldId), `Local re-read ${key} are invalid`);
  const outcomeIds = [...result.recoveredFieldIds, ...result.conflictingFieldIds, ...result.remainingUnknownFieldIds];
  invariant(new Set(outcomeIds).size === outcomeIds.length && result.targetFieldIds.length === outcomeIds.length && result.targetFieldIds.every((fieldId) => outcomeIds.includes(fieldId)), "Local re-read outcomes do not partition the target fields");
  invariant(["planHash", "inputCandidatePackageHash", "outputCandidatePackageHash", "outputAcquiredFactPackageHash", "outputGapAnalysisHash", "providerPacketSetHash", "passHash"].every((key) => /^[a-f0-9]{64}$/.test(result[key])), "Local re-read hashes are invalid");
  if (plan) {
    invariant(result.planHash === plan.planHash, "Local re-read plan source is stale");
    invariant(JSON.stringify(result.targetFieldIds) === JSON.stringify(plan.suggestions.map((suggestion) => suggestion.fieldId)), "Local re-read targets do not match the plan");
  }
  if (beforePackage && afterPackage) {
    validateIntakeCandidatePackage(beforePackage);
    validateIntakeCandidatePackage(afterPackage);
    invariant(result.inputCandidatePackageHash === beforePackage.packageHash && result.outputCandidatePackageHash === afterPackage.packageHash, "Local re-read candidate lineage is invalid");
    invariant(JSON.stringify(expectedOutcome(beforePackage, afterPackage, result.targetFieldIds)) === JSON.stringify({ recoveredFieldIds: result.recoveredFieldIds, conflictingFieldIds: result.conflictingFieldIds, remainingUnknownFieldIds: result.remainingUnknownFieldIds }), "Local re-read outcome summary is inconsistent");
  }
  if (acquiredFacts) invariant(result.outputAcquiredFactPackageHash === acquiredFacts.packageHash, "Local re-read acquired-fact lineage is invalid");
  if (gapAnalysis) invariant(result.outputGapAnalysisHash === gapAnalysis.analysisHash, "Local re-read gap lineage is invalid");
  if (packets) invariant(result.providerPacketSetHash === packetSetHash(packets), "Local re-read provider packet set changed");
  invariant(Object.keys(result).sort().join(",") === ["authority", "conflictingFieldIds", "inputCandidatePackageHash", "iterationCount", "limitations", "limits", "outputAcquiredFactPackageHash", "outputCandidatePackageHash", "outputGapAnalysisHash", "passHash", "planHash", "providerPacketSetHash", "recoveredFieldIds", "remainingUnknownFieldIds", "schemaVersion", "screening", "status", "targetFieldIds", "work"].sort().join(","), "Local re-read contains unregistered fields");
  const { passHash, ...payload } = result;
  invariant(sha256(payload) === passHash, "Local re-read failed its integrity check");
  return result;
}

function validateRequest(input, run, plan) {
  invariant(input?.confirmed === true && input.purpose === LOCAL_REREAD_PURPOSE, "Explicit local re-read confirmation is required");
  invariant(input.planHash === plan.planHash && run.retrievalPlan?.plan?.planHash === plan.planHash, "The reviewed retrieval plan is no longer current");
}

export function executeLocalReread(run, input, options = {}) {
  invariant(run?.status === "AWAITING_INTAKE_CONFIRMATION" && run.stage === "DETERMINISTIC_DISCOVERY_COMPLETED" && !run.localReread, "Local re-read is not available from the current run state");
  invariant(run.retrievalPlan?.status === "COMPLETED", "A completed retrieval plan is required for local re-read");
  const plan = validateIntakeRetrievalPlan(run.retrievalPlan.plan, run.intakeGapAnalysis);
  validateRequest(input, run, plan);
  const beforePackage = validateIntakeCandidatePackage(run.intakeCandidates);
  invariant(plan.gapAnalysisHash === run.intakeGapAnalysis.analysisHash && run.intakeGapAnalysis.candidatePackageHash === beforePackage.packageHash, "Local re-read inputs are stale");
  const limits = boundedLimits(options);
  const sourceUnits = boundedSourceUnits(run, plan);
  const characterCount = sourceUnits.reduce((total, unit) => total + unit.content.length, 0);
  invariant(sourceUnits.length <= limits.maxSourceUnits && characterCount <= limits.maxCharacters, "Local re-read work limit exceeded; no source was re-read");

  const passFindings = [];
  let redactionAppliedCount = 0;
  const screenedUnits = sourceUnits.map((unit) => {
    const screened = redactText(unit.content);
    if (screened.text !== unit.content) redactionAppliedCount += 1;
    for (const finding of screened.findings) passFindings.push({ id: stableId("local-reread-dlp", { sourceUnitId: unit.id, type: finding.type }), sourceUnitId: unit.id, ...finding, blocking: false });
    return { ...unit, content: screened.text };
  });
  const searchOverrides = Object.fromEntries(plan.suggestions.map(({ fieldId, ...suggestion }) => [fieldId, structuredClone(suggestion)]));
  const rereadProfile = discoverSolutionProfile(screenedUnits, null, {}, { searchOverrides });
  const afterPackage = createIntakeCandidatePackage(rereadProfile, run.localSourceUnits, [...run.dlpFindings, ...passFindings]);
  const targetFieldIds = plan.suggestions.map((suggestion) => suggestion.fieldId);
  const targets = new Set(targetFieldIds);
  const beforeByField = new Map(beforePackage.candidates.map((candidate) => [candidate.fieldId, candidate]));
  for (const candidate of afterPackage.candidates) {
    if (!targets.has(candidate.fieldId)) invariant(stableStringify(candidate) === stableStringify(beforeByField.get(candidate.fieldId)), `Local re-read changed non-target field ${candidate.fieldId}`);
  }
  const acquiredFacts = createAcquiredFactPackage(afterPackage);
  let acquisitionDiagnostics = createAcquisitionDiagnostics({
    sourceIngestion: run.sourceIngestion,
    registeredSources: run.registeredSources,
    localSourceUnits: run.localSourceUnits,
    dlpFindings: [...run.dlpFindings, ...passFindings],
    acquiredFacts
  });
  const diagnosticState = { acquisitionDiagnostics };
  setAcquisitionGenAiStatus(diagnosticState, "COMPLETED");
  acquisitionDiagnostics = diagnosticState.acquisitionDiagnostics;
  const gapAnalysis = createIntakeGapAnalysis({
    candidatePackage: afterPackage,
    acquisitionDiagnostics,
    sourceIngestion: run.sourceIngestion,
    localSourceUnits: run.localSourceUnits,
    providerUnits: run.packets.flatMap((packet) => packet.sourceUnits)
  });
  validateIntakeGapAnalysis(gapAnalysis);
  const outcome = expectedOutcome(beforePackage, afterPackage, targetFieldIds);
  const payload = {
    schemaVersion: LOCAL_REREAD_VERSION,
    status: "COMPLETED",
    planHash: plan.planHash,
    iterationCount: 1,
    limits,
    work: { sourceUnitCount: sourceUnits.length, characterCount },
    screening: { findingCount: passFindings.length, redactionAppliedCount },
    targetFieldIds,
    ...outcome,
    inputCandidatePackageHash: beforePackage.packageHash,
    outputCandidatePackageHash: afterPackage.packageHash,
    outputAcquiredFactPackageHash: acquiredFacts.packageHash,
    outputGapAnalysisHash: gapAnalysis.analysisHash,
    providerPacketSetHash: packetSetHash(run.packets),
    authority: AUTHORITY,
    limitations: [...FIXED_LIMITATIONS]
  };
  const result = validateLocalReread({ ...payload, passHash: sha256(payload) }, { plan, beforePackage, afterPackage, acquiredFacts, gapAnalysis, packets: run.packets });
  run.intakeCandidates = afterPackage;
  run.acquiredFacts = acquiredFacts;
  run.acquisitionDiagnostics = acquisitionDiagnostics;
  run.intakeGapAnalysis = gapAnalysis;
  run.localReread = result;
  run.trace.push({ stage: "LOCAL_BOUNDED_REREAD", status: "COMPLETED", at: new Date().toISOString(), planHash: plan.planHash, outputHash: result.passHash });
  return result;
}
