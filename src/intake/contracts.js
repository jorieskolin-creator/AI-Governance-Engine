import { sanitizeRestrictedText, sanitizeRestrictedValue } from "../../public/content-policy.js";
import { invariant } from "../contracts.js";
import { sha256 } from "../core/hash.js";
import { validateSourceIngestionManifest } from "../core/source-ingestion.js";
import { activeIntakeQuestionIds } from "../knowledge/intake-questionnaire.js";
import { validateIntakeCandidatePackage } from "./candidate-contract.js";
import { INTAKE_FIELD_REGISTRY, INTAKE_FIELD_REGISTRY_VERSION, intakeField } from "./field-registry.js";

export const INTAKE_VALUE_STATES = Object.freeze(["OBSERVED", "DECLARED", "UNKNOWN", "NOT_APPLICABLE"]);
export const INTAKE_RESOLUTION_STATES = Object.freeze([
  "UNREVIEWED",
  "USER_CONFIRMED",
  "USER_EDITED",
  "USER_ACCEPTED_ACQUIRED_CANDIDATE",
  "USER_ACCEPTED_PROPOSAL",
  "USER_DECLINED_PROPOSAL",
  "USER_SELECTED_UNKNOWN",
  "USER_SELECTED_NOT_APPLICABLE",
  "CONFLICT_REQUIRES_RESOLUTION"
]);
export const INTAKE_VALUE_ORIGINS = Object.freeze(["DETERMINISTIC_ACQUISITION", "USER_DECLARATION", "GENAI_PROPOSAL"]);
export const APPROVED_INTAKE_SNAPSHOT_VERSION = "approved-intake-snapshot-1.3.0";

const blockingResolutionStates = new Set(["UNREVIEWED", "USER_DECLINED_PROPOSAL", "CONFLICT_REQUIRES_RESOLUTION"]);

function comparable(value) {
  if (Array.isArray(value)) return [...value].map((item) => String(item).trim()).filter(Boolean).sort();
  return typeof value === "string" ? value.trim() : value;
}

function equalValues(left, right) {
  return JSON.stringify(comparable(left)) === JSON.stringify(comparable(right));
}

function pathValue(object, path) {
  return path.split(".").reduce((value, key) => value?.[key], object);
}

function questionnaireValue(answer, field) {
  const answerState = answer?.answerState ?? "UNKNOWN";
  if (["UNKNOWN", "NOT_APPLICABLE", "HUMAN_REVIEW_REQUIRED"].includes(answerState)) return null;
  return field.dataType === "ENUM_ARRAY" ? [...(answer?.values ?? [])] : answerState;
}

function submittedValue(dossier, field) {
  if (field.questionId) return questionnaireValue(dossier.intakeAnswers?.[field.questionId], field);
  const value = pathValue(dossier, field.id);
  if (value === "UNKNOWN" || value === "" || value === undefined || value === null || Array.isArray(value) && value.length === 0) return null;
  return value;
}

function priorFact(profile, field) {
  return field.questionId ? profile?.assessmentIntakeFacts?.[field.questionId] : profile?.fields?.[field.id];
}

function priorValue(profile, field) {
  const fact = priorFact(profile, field);
  if (!fact) return null;
  if (field.questionId) {
    if (["UNKNOWN", "NOT_APPLICABLE", "HUMAN_REVIEW_REQUIRED"].includes(fact.answerState)) return null;
    return field.dataType === "ENUM_ARRAY" ? fact.value : fact.answerState;
  }
  return fact.value === "UNKNOWN" ? null : fact.value;
}

function activeRegistryFields(dossier) {
  const activeQuestionIds = activeIntakeQuestionIds(dossier.intakeAnswers ?? {});
  return INTAKE_FIELD_REGISTRY.fields.filter((field) => !field.questionId || activeQuestionIds.has(field.questionId));
}

function answerState(dossier, field) {
  return field.questionId ? dossier.intakeAnswers?.[field.questionId]?.answerState ?? "UNKNOWN" : null;
}

function validateValue(field, value, valueState) {
  if (["UNKNOWN", "NOT_APPLICABLE"].includes(valueState)) {
    invariant(value === null, `${field.id}.value must be null for ${valueState}`);
    return;
  }
  if (field.dataType === "STRING") invariant(typeof value === "string" && value.trim(), `${field.id}.value must be a non-empty string`);
  else if (field.dataType === "DATE") invariant(typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)), `${field.id}.value must be an ISO date`);
  else if (field.dataType === "BOOLEAN") invariant(typeof value === "boolean", `${field.id}.value must be boolean`);
  else if (field.dataType === "ENUM") invariant(typeof value === "string" && field.allowedValues.includes(value) && !["UNKNOWN", "NOT_APPLICABLE", "HUMAN_REVIEW_REQUIRED"].includes(value), `${field.id}.value is not an allowed resolved value`);
  else if (field.dataType === "STRING_ARRAY") invariant(Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "string" && item.trim()), `${field.id}.value must be a non-empty string array`);
  else if (field.dataType === "ENUM_ARRAY") invariant(Array.isArray(value) && value.length > 0 && value.every((item) => field.allowedValues.includes(item) && !["UNKNOWN", "NOT_APPLICABLE"].includes(item)), `${field.id}.value contains an invalid option`);
  else invariant(false, `Unsupported Intake data type: ${field.dataType}`);
}

function candidateByRef(discoveryRecheck, proposalRef) {
  return (discoveryRecheck?.candidates ?? []).find((candidate) => candidate.id === proposalRef) ?? null;
}

function acquiredCandidateByRef(candidatePackage, candidateRef) {
  return (candidatePackage?.candidates ?? []).find((candidate) => candidate.id === candidateRef) ?? null;
}

function acquiredCandidateIsActionable(candidate, field) {
  return candidate?.fieldId === field.id
    && candidate.sanitizedCandidate !== null
    && candidate.sourceRefs.length > 0
    && candidate.conflicts.length === 0
    && ["CANDIDATE", "CONFIRMED", "SUPPORTED", "PARTIAL"].includes(candidate.acquisitionState);
}

function proposalValueMatches(candidate, value, field) {
  if (!candidate) return false;
  if (field.dataType === "STRING") return equalValues(candidate.value, value);
  if (field.dataType === "STRING_ARRAY" || field.dataType === "ENUM_ARRAY") return equalValues(String(candidate.value ?? "").split(/[,;|\n]/).map((item) => item.trim()).filter(Boolean), value);
  if (field.dataType === "BOOLEAN") return equalValues(/^(?:yes|true)$/i.test(String(candidate.value).trim()), value);
  return equalValues(candidate.value, value);
}

export function createIntakeResolutionDraft(dossier, profile) {
  return Object.fromEntries(activeRegistryFields(dossier).map((field) => {
    const value = submittedValue(dossier, field);
    const state = answerState(dossier, field);
    const prior = priorFact(profile, field);
    let resolutionState;
    if (state === "NOT_APPLICABLE") resolutionState = "USER_SELECTED_NOT_APPLICABLE";
    else if (value === null) resolutionState = "USER_SELECTED_UNKNOWN";
    else if (prior?.status === "CONFLICTING" || prior?.supportStatus === "CONFLICTING") resolutionState = "USER_EDITED";
    else if (equalValues(priorValue(profile, field), value)) resolutionState = "USER_CONFIRMED";
    else resolutionState = "USER_EDITED";
    return [field.id, {
      resolutionState,
      explanation: resolutionState === "USER_SELECTED_NOT_APPLICABLE" ? "Not applicable to the user-confirmed assessed boundary." : ""
    }];
  }));
}

function fieldRecord(field, decision, dossier, sourceProfile, discoveryRecheck, candidatePackage) {
  invariant(decision && typeof decision === "object" && !Array.isArray(decision), `A resolution is required for ${field.id}`);
  invariant(INTAKE_RESOLUTION_STATES.includes(decision.resolutionState), `${field.id}.resolutionState is invalid`);
  invariant(!blockingResolutionStates.has(decision.resolutionState), `${field.id} is not resolved and cannot enter an approved Intake snapshot`);
  const value = submittedValue(dossier, field);
  const state = answerState(dossier, field);
  const prior = priorFact(sourceProfile, field);
  const previousValue = priorValue(sourceProfile, field);
  const explanation = sanitizeRestrictedText(String(decision.explanation ?? "").trim());
  let valueState;
  let origin;
  let evidenceRefs = [...new Set(prior?.sourceUnitIds ?? [])];
  let limitations = [...new Set(prior?.limitations ?? [])];
  let proposalRef = null;
  let declinedProposalRef = null;
  let editedProposalRef = null;
  let acquiredCandidateRef = null;
  let declinedAcquiredCandidateRef = null;
  let editedAcquiredCandidateRef = null;
  invariant(!decision.proposalRef || decision.resolutionState === "USER_ACCEPTED_PROPOSAL", `${field.id} proposal reference requires proposal acceptance`);
  invariant(!decision.acquiredCandidateRef || decision.resolutionState === "USER_ACCEPTED_ACQUIRED_CANDIDATE", `${field.id} acquired candidate reference requires acquired candidate acceptance`);
  const hasAcquiredCandidateDecision = decision.acquiredCandidateRef || decision.declinedAcquiredCandidateRef || decision.editedAcquiredCandidateRef;
  if (hasAcquiredCandidateDecision) invariant(decision.acquiredCandidatePackageHash === candidatePackage.packageHash, `${field.id} acquired candidate package is no longer current`);
  if (decision.declinedAcquiredCandidateRef) {
    const declined = acquiredCandidateByRef(candidatePackage, decision.declinedAcquiredCandidateRef);
    invariant(acquiredCandidateIsActionable(declined, field), `${field.id} declined acquired candidate reference is invalid`);
    declinedAcquiredCandidateRef = declined.id;
  }
  if (decision.editedAcquiredCandidateRef) {
    const edited = acquiredCandidateByRef(candidatePackage, decision.editedAcquiredCandidateRef);
    invariant(acquiredCandidateIsActionable(edited, field), `${field.id} edited acquired candidate reference is invalid`);
    invariant(!declinedAcquiredCandidateRef, `${field.id} cannot edit and decline the same acquired candidate`);
    editedAcquiredCandidateRef = edited.id;
  }
  if (decision.declinedProposalRef) {
    const declined = candidateByRef(discoveryRecheck, decision.declinedProposalRef);
    invariant(field.genAiProposalAllowed && declined?.field === field.id, `${field.id} declined proposal reference is invalid`);
    invariant(declined.status === "CANDIDATE" && ["REVIEW_REWRITE", "REVIEW_CANDIDATE"].includes(declined.recommendation), `${field.id} declined proposal is not actionable`);
    declinedProposalRef = declined.id;
  }
  if (decision.editedProposalRef) {
    const edited = candidateByRef(discoveryRecheck, decision.editedProposalRef);
    invariant(field.genAiProposalAllowed && edited?.field === field.id, `${field.id} edited proposal reference is invalid`);
    invariant(edited.status === "CANDIDATE" && ["REVIEW_REWRITE", "REVIEW_CANDIDATE"].includes(edited.recommendation), `${field.id} edited proposal is not actionable`);
    invariant(!declinedProposalRef, `${field.id} cannot edit and decline the same proposal`);
    editedProposalRef = edited.id;
  }
  invariant(!editedProposalRef || decision.resolutionState === "USER_EDITED", `${field.id} edited proposal reference requires a user-edited resolution`);
  invariant(!editedAcquiredCandidateRef || decision.resolutionState === "USER_EDITED", `${field.id} edited acquired candidate reference requires a user-edited resolution`);

  if (decision.resolutionState === "USER_SELECTED_UNKNOWN") {
    invariant(field.unknownAllowed, `${field.id} does not allow Unknown`);
    invariant(value === null && state !== "NOT_APPLICABLE", `${field.id} must not contain a value when Unknown is selected`);
    valueState = "UNKNOWN";
    origin = "USER_DECLARATION";
  } else if (decision.resolutionState === "USER_SELECTED_NOT_APPLICABLE") {
    invariant(field.notApplicableAllowed, `${field.id} does not allow Not Applicable`);
    invariant(state === "NOT_APPLICABLE" || !field.questionId && value === null, `${field.id} must be Not Applicable in the submitted Intake`);
    invariant(!field.explanationRequiredFor.includes("NOT_APPLICABLE") || explanation, `${field.id} requires an explanation for Not Applicable`);
    valueState = "NOT_APPLICABLE";
    origin = "USER_DECLARATION";
  } else if (decision.resolutionState === "USER_ACCEPTED_ACQUIRED_CANDIDATE") {
    invariant(!declinedAcquiredCandidateRef && !editedAcquiredCandidateRef, `${field.id} cannot accept and also edit or decline the same acquired candidate`);
    invariant(!declinedProposalRef && !editedProposalRef, `${field.id} cannot accept an acquired candidate while recording a GenAI proposal decision`);
    const candidate = acquiredCandidateByRef(candidatePackage, decision.acquiredCandidateRef);
    invariant(acquiredCandidateIsActionable(candidate, field), `${field.id} acquired candidate reference is invalid`);
    invariant(value !== null && equalValues(candidate.sanitizedCandidate, value), `${field.id} does not match the accepted acquired candidate`);
    valueState = "OBSERVED";
    origin = "DETERMINISTIC_ACQUISITION";
    evidenceRefs = [...new Set(candidate.sourceRefs.map((ref) => ref.sourceUnitId))];
    limitations = [...new Set([...candidate.limitations, "The deterministic candidate entered Intake only through explicit user selection and final approval."])];
    acquiredCandidateRef = candidate.id;
  } else if (decision.resolutionState === "USER_ACCEPTED_PROPOSAL") {
    invariant(!declinedAcquiredCandidateRef && !editedAcquiredCandidateRef, `${field.id} cannot accept a GenAI proposal while recording an acquired candidate decision`);
    invariant(!declinedProposalRef && !editedProposalRef, `${field.id} cannot accept and also edit or decline the same proposal`);
    invariant(field.genAiProposalAllowed, `${field.id} does not allow GenAI proposals`);
    const candidate = candidateByRef(discoveryRecheck, decision.proposalRef);
    invariant(candidate && candidate.field === field.id, `${field.id} proposal reference is invalid`);
    invariant(["REVIEW_REWRITE", "REVIEW_CANDIDATE"].includes(candidate.recommendation) && candidate.status === "CANDIDATE", `${field.id} proposal is not eligible for acceptance`);
    invariant(value !== null && proposalValueMatches(candidate, value, field), `${field.id} does not match the accepted proposal`);
    valueState = "DECLARED";
    origin = "GENAI_PROPOSAL";
    evidenceRefs = [...new Set(candidate.sourceUnitIds ?? [])];
    limitations = [...new Set([...(candidate.limitations ?? []), "The value originated as a GenAI proposal and entered Intake only through explicit user acceptance."])];
    proposalRef = candidate.id;
  } else if (decision.resolutionState === "USER_CONFIRMED") {
    invariant(!editedProposalRef && !editedAcquiredCandidateRef, `${field.id} edited reference requires a user-edited value`);
    invariant(value !== null, `${field.id} cannot confirm an unknown value`);
    invariant(prior && prior.status !== "CONFLICTING" && prior.supportStatus !== "CONFLICTING" && equalValues(previousValue, value), `${field.id} does not match a non-conflicting acquired value`);
    const observed = field.questionId ? prior.origin === "OBSERVED" : prior.factClass === "OBSERVED";
    valueState = observed ? "OBSERVED" : "DECLARED";
    origin = observed ? "DETERMINISTIC_ACQUISITION" : "USER_DECLARATION";
  } else {
    invariant(decision.resolutionState === "USER_EDITED", `${field.id} resolution is unsupported`);
    invariant(value !== null, `${field.id} edited value cannot be empty`);
    invariant(!equalValues(previousValue, value) || prior?.status === "CONFLICTING" || prior?.supportStatus === "CONFLICTING", `${field.id} was not edited; use USER_CONFIRMED`);
    if (editedProposalRef) invariant(!proposalValueMatches(candidateByRef(discoveryRecheck, editedProposalRef), value, field), `${field.id} still matches the proposal; use USER_ACCEPTED_PROPOSAL`);
    if (editedAcquiredCandidateRef) invariant(!equalValues(acquiredCandidateByRef(candidatePackage, editedAcquiredCandidateRef).sanitizedCandidate, value), `${field.id} still matches the acquired candidate; use USER_ACCEPTED_ACQUIRED_CANDIDATE`);
    valueState = "DECLARED";
    origin = "USER_DECLARATION";
    limitations = [...new Set([...limitations, "The user selected or edited this value; conflicting source observations, if any, remain in provenance."])];
  }

  validateValue(field, value, valueState);
  return {
    fieldId: field.id,
    value: valueState === "NOT_APPLICABLE" || valueState === "UNKNOWN" ? null : sanitizeRestrictedValue(structuredClone(value)),
    valueState,
    resolutionState: decision.resolutionState,
    origin,
    evidenceRefs,
    limitations: limitations.map((item) => sanitizeRestrictedText(String(item))).filter(Boolean),
    explanation: explanation || null,
    proposalRef,
    declinedProposalRef,
    editedProposalRef,
    acquiredCandidateRef,
    declinedAcquiredCandidateRef,
    editedAcquiredCandidateRef
  };
}

export function createApprovedIntakeSnapshot({ run, dossier, effectiveDossier, solutionProfile, sourceProfile, resolutions, approval, priorRevisionRef = null }) {
  invariant(resolutions && typeof resolutions === "object" && !Array.isArray(resolutions), "Explicit Intake field resolutions are required");
  invariant(approval && typeof approval === "object", "Explicit user approval is required");
  const actorRef = sanitizeRestrictedText(String(approval.actorRef ?? "").trim());
  invariant(actorRef, "approval.actorRef is required");
  invariant(approval.confirmed === true, "Only an explicit user approval may create the approved Intake snapshot");
  const activeFields = activeRegistryFields(dossier);
  for (const field of activeFields.filter((item) => item.requirement.analysis === "VALUE_REQUIRED")) {
    invariant(submittedValue(dossier, field) !== null, `${field.id} is required before analysis`);
  }
  const activeIds = new Set(activeFields.map((field) => field.id));
  for (const fieldId of Object.keys(resolutions)) invariant(activeIds.has(fieldId), `Resolution supplied for unknown or inactive field: ${fieldId}`);
  invariant(Object.keys(resolutions).length === activeFields.length, "Every active Intake field requires exactly one explicit resolution");
  const candidatePackage = validateIntakeCandidatePackage(run.intakeCandidates);
  const fields = activeFields.map((field) => fieldRecord(field, resolutions[field.id], dossier, sourceProfile, run.discoveryRecheck, candidatePackage));
  const proposalRefs = fields.flatMap((field) => [field.proposalRef, field.editedProposalRef, field.declinedProposalRef]).filter(Boolean);
  const proposalCandidates = proposalRefs.map((proposalRef) => {
    const candidate = candidateByRef(run.discoveryRecheck, proposalRef);
    invariant(candidate, `Approved Intake proposal candidate is unavailable: ${proposalRef}`);
    return { id: candidate.id, fieldId: candidate.field, status: candidate.status, recommendation: candidate.recommendation, proposalHash: sha256(candidate) };
  });
  const acquiredCandidateDecisions = fields.flatMap((field) => [
    field.acquiredCandidateRef ? { candidateRef: field.acquiredCandidateRef, fieldId: field.fieldId, decision: "ACCEPTED" } : null,
    field.editedAcquiredCandidateRef ? { candidateRef: field.editedAcquiredCandidateRef, fieldId: field.fieldId, decision: "EDITED" } : null,
    field.declinedAcquiredCandidateRef ? { candidateRef: field.declinedAcquiredCandidateRef, fieldId: field.fieldId, decision: "DECLINED" } : null
  ].filter(Boolean));
  const acquiredCandidates = acquiredCandidateDecisions.map((decision) => {
    const candidate = acquiredCandidateByRef(candidatePackage, decision.candidateRef);
    invariant(candidate, `Approved Intake acquired candidate is unavailable: ${decision.candidateRef}`);
    return { id: candidate.id, fieldId: candidate.fieldId, acquisitionState: candidate.acquisitionState, candidateHash: sha256(candidate), packageHash: candidatePackage.packageHash };
  });
  const approvedAt = new Date().toISOString();
  const warnings = [];
  if (run.sourceIngestion?.coverageStatus === "INCOMPLETE_REVIEW_REQUIRED") warnings.push("Source-ingestion coverage is incomplete and remains a downstream governance limitation.");
  const payload = {
    schemaVersion: APPROVED_INTAKE_SNAPSHOT_VERSION,
    fieldRegistryVersion: INTAKE_FIELD_REGISTRY_VERSION,
    fieldRegistryHash: INTAKE_FIELD_REGISTRY.hash,
    revision: priorRevisionRef ? 2 : 1,
    priorRevisionRef: priorRevisionRef ? sanitizeRestrictedText(String(priorRevisionRef)) : null,
    acquisitionManifest: { reference: `run:${run.id}:source-ingestion`, hash: run.sourceIngestion.manifestHash },
    fields,
    proposalDecisionRefs: proposalRefs,
    proposalCandidates,
    proposalDecisions: fields.flatMap((field) => [
      field.proposalRef ? { proposalRef: field.proposalRef, fieldId: field.fieldId, decision: "ACCEPTED" } : null,
      field.editedProposalRef ? { proposalRef: field.editedProposalRef, fieldId: field.fieldId, decision: "EDITED" } : null,
      field.declinedProposalRef ? { proposalRef: field.declinedProposalRef, fieldId: field.fieldId, decision: "DECLINED" } : null
    ].filter(Boolean)),
    acquiredCandidatePackageHash: candidatePackage.packageHash,
    acquiredCandidateDecisions,
    acquiredCandidates,
    warnings,
    limitations: [...new Set(fields.flatMap((field) => field.limitations))],
    approval: { actorRef, confirmedAt: approvedAt, authority: "USER_ONLY" },
    dossier: structuredClone(dossier),
    effectiveDossier: structuredClone(effectiveDossier),
    solutionProfile: structuredClone(solutionProfile),
    sourceIngestion: structuredClone(run.sourceIngestion)
  };
  const snapshot = { ...payload, snapshotHash: sha256(payload) };
  return deepFreeze(snapshot);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export function validateApprovedIntakeSnapshot(snapshot, options = {}) {
  invariant(snapshot && typeof snapshot === "object", "An approved Intake snapshot is required");
  invariant(snapshot.schemaVersion === APPROVED_INTAKE_SNAPSHOT_VERSION, "The approved Intake snapshot schema version is unsupported");
  invariant(snapshot.fieldRegistryVersion === INTAKE_FIELD_REGISTRY_VERSION && snapshot.fieldRegistryHash === INTAKE_FIELD_REGISTRY.hash, "The approved Intake snapshot field registry is unsupported");
  invariant(typeof snapshot.snapshotHash === "string", "The approved Intake snapshot hash is required");
  const { snapshotHash, ...payload } = snapshot;
  invariant(sha256(payload) === snapshotHash, "The approved Intake snapshot failed its integrity check");
  invariant(!options.acquisitionManifestHash || snapshot.acquisitionManifest?.hash === options.acquisitionManifestHash, "The approved Intake snapshot does not reference the active acquisition manifest");
  invariant(snapshot.approval?.authority === "USER_ONLY" && snapshot.approval.actorRef && !Number.isNaN(Date.parse(snapshot.approval.confirmedAt)), "The approved Intake snapshot lacks valid user approval");
  invariant(Number.isInteger(snapshot.revision) && snapshot.revision >= 1, "The approved Intake revision is invalid");
  invariant(snapshot.revision === 1 ? snapshot.priorRevisionRef === null : typeof snapshot.priorRevisionRef === "string" && snapshot.priorRevisionRef, "The approved Intake prior revision reference is invalid");
  invariant(snapshot.sourceIngestion?.manifestHash === snapshot.acquisitionManifest?.hash, "The approved Intake acquisition references are inconsistent");
  validateSourceIngestionManifest(snapshot.sourceIngestion);
  const activeFields = activeRegistryFields(snapshot.dossier);
  invariant(snapshot.fields.length === activeFields.length, "The approved Intake snapshot field set is incomplete");
  const records = new Map(snapshot.fields.map((record) => [record.fieldId, record]));
  invariant(records.size === snapshot.fields.length, "The approved Intake snapshot contains duplicate fields");
  for (const field of activeFields) {
    const record = records.get(field.id);
    invariant(record && intakeField(record.fieldId), `The approved Intake snapshot is missing ${field.id}`);
    invariant(INTAKE_VALUE_STATES.includes(record.valueState), `${field.id}.valueState is invalid`);
    invariant(INTAKE_RESOLUTION_STATES.includes(record.resolutionState) && !blockingResolutionStates.has(record.resolutionState), `${field.id} is not finally resolved`);
    invariant(INTAKE_VALUE_ORIGINS.includes(record.origin), `${field.id}.origin is invalid`);
    invariant(Array.isArray(record.evidenceRefs) && record.evidenceRefs.every((item) => typeof item === "string"), `${field.id}.evidenceRefs is invalid`);
    invariant(Array.isArray(record.limitations) && record.limitations.every((item) => typeof item === "string"), `${field.id}.limitations is invalid`);
    const expectedValue = submittedValue(snapshot.dossier, field);
    const state = answerState(snapshot.dossier, field);
    if (field.requirement.analysis === "VALUE_REQUIRED") invariant(expectedValue !== null, `${field.id} is required before analysis`);
    if (record.valueState === "UNKNOWN") {
      invariant(field.unknownAllowed && record.resolutionState === "USER_SELECTED_UNKNOWN" && record.origin === "USER_DECLARATION", `${field.id} has an invalid Unknown resolution`);
      invariant(expectedValue === null && state !== "NOT_APPLICABLE", `${field.id} Unknown does not match the approved dossier`);
    } else if (record.valueState === "NOT_APPLICABLE") {
      invariant(field.notApplicableAllowed && record.resolutionState === "USER_SELECTED_NOT_APPLICABLE" && record.origin === "USER_DECLARATION", `${field.id} has an invalid Not Applicable resolution`);
      invariant(state === "NOT_APPLICABLE" || !field.questionId && expectedValue === null, `${field.id} Not Applicable does not match the approved dossier`);
      invariant(!field.explanationRequiredFor.includes("NOT_APPLICABLE") || typeof record.explanation === "string" && record.explanation, `${field.id} lacks its required Not Applicable explanation`);
    } else {
      invariant(equalValues(record.value, expectedValue), `${field.id} does not match the approved dossier`);
    }
    if (record.valueState === "OBSERVED") invariant(["USER_CONFIRMED", "USER_ACCEPTED_ACQUIRED_CANDIDATE"].includes(record.resolutionState) && record.origin === "DETERMINISTIC_ACQUISITION", `${field.id} has invalid observed provenance`);
    if (record.resolutionState === "USER_ACCEPTED_ACQUIRED_CANDIDATE") invariant(typeof record.acquiredCandidateRef === "string" && record.acquiredCandidateRef && record.declinedAcquiredCandidateRef === null && record.editedAcquiredCandidateRef === null, `${field.id} has invalid acquired candidate provenance`);
    else invariant(record.acquiredCandidateRef === null, `${field.id} has an unexpected acquired candidate reference`);
    invariant(record.declinedAcquiredCandidateRef === null || typeof record.declinedAcquiredCandidateRef === "string" && record.declinedAcquiredCandidateRef, `${field.id} has an invalid declined acquired candidate reference`);
    invariant(record.editedAcquiredCandidateRef === null || record.resolutionState === "USER_EDITED" && record.origin === "USER_DECLARATION" && typeof record.editedAcquiredCandidateRef === "string" && record.editedAcquiredCandidateRef, `${field.id} has an invalid edited acquired candidate reference`);
    if (record.resolutionState === "USER_ACCEPTED_PROPOSAL") invariant(record.origin === "GENAI_PROPOSAL" && typeof record.proposalRef === "string" && record.proposalRef && record.declinedProposalRef === null && record.editedProposalRef === null, `${field.id} has invalid proposal provenance`);
    else invariant(record.origin !== "GENAI_PROPOSAL" && record.proposalRef === null, `${field.id} has an unexpected proposal reference`);
    invariant(record.declinedProposalRef === null || typeof record.declinedProposalRef === "string" && record.declinedProposalRef, `${field.id} has an invalid declined proposal reference`);
    invariant(record.editedProposalRef === null || record.resolutionState === "USER_EDITED" && record.origin === "USER_DECLARATION" && typeof record.editedProposalRef === "string" && record.editedProposalRef, `${field.id} has an invalid edited proposal reference`);
    validateValue(field, record.value, record.valueState);
  }
  const proposalDecisions = snapshot.fields.flatMap((record) => [
    record.proposalRef ? { proposalRef: record.proposalRef, fieldId: record.fieldId, decision: "ACCEPTED" } : null,
    record.editedProposalRef ? { proposalRef: record.editedProposalRef, fieldId: record.fieldId, decision: "EDITED" } : null,
    record.declinedProposalRef ? { proposalRef: record.declinedProposalRef, fieldId: record.fieldId, decision: "DECLINED" } : null
  ].filter(Boolean));
  const proposalRefs = proposalDecisions.map((decision) => decision.proposalRef);
  invariant(JSON.stringify(snapshot.proposalDecisionRefs) === JSON.stringify(proposalRefs), "The approved Intake proposal decision references are inconsistent");
  invariant(JSON.stringify(snapshot.proposalDecisions) === JSON.stringify(proposalDecisions), "The approved Intake proposal decisions are inconsistent");
  invariant(Array.isArray(snapshot.proposalCandidates) && snapshot.proposalCandidates.length === proposalRefs.length, "The approved Intake proposal candidate ledger is inconsistent");
  for (const [index, proposalRef] of proposalRefs.entries()) {
    const candidate = snapshot.proposalCandidates[index];
    const decision = proposalDecisions[index];
    invariant(candidate?.id === proposalRef && candidate.fieldId === decision.fieldId && candidate.status === "CANDIDATE" && ["REVIEW_REWRITE", "REVIEW_CANDIDATE"].includes(candidate.recommendation) && /^[a-f0-9]{64}$/.test(candidate.proposalHash), "The approved Intake proposal candidate reference is invalid");
  }
  const acquiredCandidateDecisions = snapshot.fields.flatMap((record) => [
    record.acquiredCandidateRef ? { candidateRef: record.acquiredCandidateRef, fieldId: record.fieldId, decision: "ACCEPTED" } : null,
    record.editedAcquiredCandidateRef ? { candidateRef: record.editedAcquiredCandidateRef, fieldId: record.fieldId, decision: "EDITED" } : null,
    record.declinedAcquiredCandidateRef ? { candidateRef: record.declinedAcquiredCandidateRef, fieldId: record.fieldId, decision: "DECLINED" } : null
  ].filter(Boolean));
  invariant(/^[a-f0-9]{64}$/.test(snapshot.acquiredCandidatePackageHash), "The approved Intake acquired candidate package reference is invalid");
  invariant(JSON.stringify(snapshot.acquiredCandidateDecisions) === JSON.stringify(acquiredCandidateDecisions), "The approved Intake acquired candidate decisions are inconsistent");
  invariant(Array.isArray(snapshot.acquiredCandidates) && snapshot.acquiredCandidates.length === acquiredCandidateDecisions.length, "The approved Intake acquired candidate ledger is inconsistent");
  for (const [index, decision] of acquiredCandidateDecisions.entries()) {
    const candidate = snapshot.acquiredCandidates[index];
    invariant(candidate?.id === decision.candidateRef && candidate.fieldId === decision.fieldId && ["CANDIDATE", "CONFIRMED", "SUPPORTED", "PARTIAL"].includes(candidate.acquisitionState) && /^[a-f0-9]{64}$/.test(candidate.candidateHash) && candidate.packageHash === snapshot.acquiredCandidatePackageHash, "The approved Intake acquired candidate reference is invalid");
  }
  return snapshot;
}
