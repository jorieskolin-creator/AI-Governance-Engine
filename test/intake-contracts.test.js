import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validateDossier } from "../src/contracts.js";
import { confirmPreflightDossier, createPreflight } from "../src/cognitive/preflight.js";
import { sha256, stableId } from "../src/core/hash.js";
import { createIntakeResolutionDraft, validateApprovedIntakeSnapshot } from "../src/intake/contracts.js";
import { INTAKE_FIELD_REGISTRY, validateQuestionnaireAgainstRegistry } from "../src/intake/field-registry.js";
import { INTAKE_QUESTIONNAIRE } from "../src/knowledge/intake-questionnaire.js";

function browserShapedDossier({ name, accountableOwner }) {
  return {
    name,
    accountableOwner,
    intendedPurpose: "",
    expectedValue: "",
    currentStage: "UNKNOWN",
    targetStage: "UNKNOWN",
    jurisdictions: [],
    roles: [],
    users: [],
    data: { categories: [] },
    exposure: { currentUserAccess: "UNKNOWN", intendedUserAccess: "UNKNOWN", productionAccess: null, consequentialDecisions: null },
    agent: { usesAgents: null, canTakeActions: null, irreversibleActions: null, humanOverride: null },
    classification: { prohibitedPractice: null, highRiskCandidate: null },
    intakeAnswers: Object.fromEntries(INTAKE_QUESTIONNAIRE.questions.map((question) => [question.id, {
      answerState: "UNKNOWN", values: [], origin: "SELF_DECLARED", supportStatus: "NOT_CHECKED"
    }])),
    operatingBoundary: {
      allowedUses: [], excludedUses: [], environment: "UNKNOWN",
      userScope: "", dataScope: "", integrationScope: "", permissionScope: "", autonomyScope: "",
      monitoringOwner: "", expiresAt: null
    }
  };
}

const source = (content = "# Intake case") => [{ path: "case.md", mimeType: "text/markdown", encoding: "utf8", content }];

function approvalInput(run, dossier) {
  const completedDossier = validateDossier({
    ...dossier,
    name: dossier.name || "Test solution",
    accountableOwner: dossier.accountableOwner || "Test owner"
  });
  return {
    dossier: completedDossier,
    resolutions: createIntakeResolutionDraft(completedDossier, run.solutionProfile),
    approval: { confirmed: true, actorRef: "TEST_USER" }
  };
}

test("the versioned registry covers every active HTML Intake control and questionnaire field", async () => {
  assert.equal(validateQuestionnaireAgainstRegistry(INTAKE_QUESTIONNAIRE), true);
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const controls = INTAKE_FIELD_REGISTRY.fields.filter((field) => field.uiControlId);
  for (const field of controls) assert.match(html, new RegExp(`id=["']${field.uiControlId}["']`), field.id);
  assert.equal(new Set(controls.map((field) => field.uiControlId)).size, controls.length);
  assert.deepEqual(INTAKE_FIELD_REGISTRY.fields.filter((field) => field.requirement.analysis === "VALUE_REQUIRED").map((field) => field.id), ["name", "accountableOwner"]);
  const dossierForm = html.match(/<form id="dossier-form">([\s\S]*?)<\/form>/)?.[1] ?? "";
  const activeHtmlControlIds = [...dossierForm.matchAll(/<(?:input|textarea|select) id="([^"]+)"/g)]
    .map((match) => match[1]).filter((id) => !["prohibited", "high-risk"].includes(id)).sort();
  if (dossierForm.includes('id="data-categories"')) activeHtmlControlIds.push("data-categories");
  activeHtmlControlIds.sort();
  assert.deepEqual(activeHtmlControlIds, controls.map((field) => field.uiControlId).sort());
  assert.equal(INTAKE_FIELD_REGISTRY.fields.filter((field) => field.questionId).length, INTAKE_QUESTIONNAIRE.questions.length);
  assert.match(INTAKE_FIELD_REGISTRY.hash, /^[a-f0-9]{64}$/);
});

test("the canonical dossier drops unregistered material and rejects unregistered questionnaire fields", () => {
  const dossier = validateDossier({ name: "Bounded Intake", unregisteredRawMaterial: "must not cross the boundary" });
  assert.equal(Object.hasOwn(dossier, "unregisteredRawMaterial"), false);
  assert.throws(() => validateDossier({ intakeAnswers: { UNKNOWN_QUESTION: { answerState: "UNKNOWN" } } }), /Unknown intake question ID/);
});

test("approval requires an explicit final resolution for every applicable field without mutating a rejected run", async () => {
  const run = await createPreflight({ sources: source() });
  const originalProfileHash = run.solutionProfile.hash;
  await assert.rejects(
    () => confirmPreflightDossier(run, { dossier: validateDossier(run.solutionProfile.suggestedDossier), approval: { confirmed: true, actorRef: "TEST_USER" } }),
    (error) => {
      assert.match(error.message, /field resolutions are required/i);
      assert.equal(error.statusCode, 422);
      return true;
    }
  );
  assert.equal(run.status, "AWAITING_INTAKE_CONFIRMATION");
  assert.equal(run.solutionProfile.hash, originalProfileHash);
  assert.equal(run.approvedIntake, undefined);
});

test("only identity fields block analysis; other Unknown and Not Applicable values remain valid limitations", async () => {
  const conflicting = await createPreflight({ sources: source("Accountable owner: Product Team\nAccountable owner: Risk Team") });
  const conflictingDossier = validateDossier(conflicting.solutionProfile.suggestedDossier);
  const missingOwner = approvalInput(conflicting, conflictingDossier);
  missingOwner.dossier.accountableOwner = "";
  missingOwner.resolutions = createIntakeResolutionDraft(missingOwner.dossier, conflicting.solutionProfile);
  await assert.rejects(
    () => confirmPreflightDossier(conflicting, missingOwner),
    /accountableOwner is required before analysis/i
  );

  const unknown = await createPreflight({ sources: source() });
  const unknownDossier = validateDossier(unknown.solutionProfile.suggestedDossier);
  const invalid = approvalInput(unknown, unknownDossier);
  invalid.resolutions.name = { resolutionState: "USER_SELECTED_NOT_APPLICABLE", explanation: "Not relevant" };
  await assert.rejects(() => confirmPreflightDossier(unknown, invalid), /name does not allow Not Applicable/i);

  const questionnaire = await createPreflight({ sources: source() });
  const questionnaireDossier = validateDossier({
    ...questionnaire.solutionProfile.suggestedDossier,
    intakeAnswers: { ROLE_REBRANDING: { answerState: "NOT_APPLICABLE", values: [] } }
  });
  const optionalExplanation = approvalInput(questionnaire, questionnaireDossier);
  optionalExplanation.resolutions["intakeAnswers.ROLE_REBRANDING"].explanation = "";
  await confirmPreflightDossier(questionnaire, optionalExplanation);
  assert.equal(questionnaire.approvedIntake.fields.find((field) => field.fieldId === "intakeAnswers.ROLE_REBRANDING").valueState, "NOT_APPLICABLE");
});

test("the immutable approved snapshot separates observed provenance from user resolution and detects tampering", async () => {
  const run = await createPreflight({ sources: source("Solution name: Evidence Assistant") });
  const dossier = validateDossier(run.solutionProfile.suggestedDossier);
  await confirmPreflightDossier(run, approvalInput(run, dossier));
  const name = run.approvedIntake.fields.find((field) => field.fieldId === "name");
  const purpose = run.approvedIntake.fields.find((field) => field.fieldId === "intendedPurpose");
  assert.deepEqual({ valueState: name.valueState, resolutionState: name.resolutionState, origin: name.origin }, {
    valueState: "OBSERVED", resolutionState: "USER_CONFIRMED", origin: "DETERMINISTIC_ACQUISITION"
  });
  assert.deepEqual({ value: purpose.value, valueState: purpose.valueState, resolutionState: purpose.resolutionState }, {
    value: null, valueState: "UNKNOWN", resolutionState: "USER_SELECTED_UNKNOWN"
  });
  assert.equal(Object.isFrozen(run.approvedIntake), true);
  assert.equal(validateApprovedIntakeSnapshot(run.approvedIntake), run.approvedIntake);
  const tampered = structuredClone(run.approvedIntake);
  tampered.fields.find((field) => field.fieldId === "name").value = "Different Assistant";
  assert.throws(() => validateApprovedIntakeSnapshot(tampered), /integrity check/i);
});

test("validated acquired candidates require an explicit hash-bound user decision", async () => {
  const acceptedRun = await createPreflight({ sources: source("Solution name: Evidence Assistant") });
  const acquired = acceptedRun.intakeCandidates.candidates.find((candidate) => candidate.fieldId === "name");
  const acceptedDossier = validateDossier(acceptedRun.solutionProfile.suggestedDossier);
  const acceptedInput = approvalInput(acceptedRun, acceptedDossier);
  acceptedInput.resolutions.name = { resolutionState: "USER_ACCEPTED_ACQUIRED_CANDIDATE", acquiredCandidateRef: acquired.id, acquiredCandidatePackageHash: acceptedRun.intakeCandidates.packageHash };
  await confirmPreflightDossier(acceptedRun, acceptedInput);

  const accepted = acceptedRun.approvedIntake.fields.find((field) => field.fieldId === "name");
  assert.deepEqual({ valueState: accepted.valueState, resolutionState: accepted.resolutionState, origin: accepted.origin, candidateRef: accepted.acquiredCandidateRef }, {
    valueState: "OBSERVED",
    resolutionState: "USER_ACCEPTED_ACQUIRED_CANDIDATE",
    origin: "DETERMINISTIC_ACQUISITION",
    candidateRef: acquired.id
  });
  assert.equal(acceptedRun.approvedIntake.acquiredCandidatePackageHash, acceptedRun.approvedIntake.acquiredCandidates[0].packageHash);
  assert.deepEqual(acceptedRun.approvedIntake.acquiredCandidateDecisions, [{ candidateRef: acquired.id, fieldId: "name", decision: "ACCEPTED" }]);
  assert.equal(validateApprovedIntakeSnapshot(acceptedRun.approvedIntake), acceptedRun.approvedIntake);

  const forgedRun = await createPreflight({ sources: source("Solution name: Evidence Assistant") });
  const forgedDossier = validateDossier(forgedRun.solutionProfile.suggestedDossier);
  const forgedInput = approvalInput(forgedRun, forgedDossier);
  forgedInput.resolutions.name = { resolutionState: "USER_ACCEPTED_ACQUIRED_CANDIDATE", acquiredCandidateRef: "intake-candidate-forged", acquiredCandidatePackageHash: forgedRun.intakeCandidates.packageHash };
  await assert.rejects(() => confirmPreflightDossier(forgedRun, forgedInput), /acquired candidate reference is invalid/i);

  const staleRun = await createPreflight({ sources: source("Solution name: Evidence Assistant") });
  const staleDossier = validateDossier(staleRun.solutionProfile.suggestedDossier);
  const staleInput = approvalInput(staleRun, staleDossier);
  staleInput.resolutions.name = { resolutionState: "USER_ACCEPTED_ACQUIRED_CANDIDATE", acquiredCandidateRef: staleRun.intakeCandidates.candidates.find((candidate) => candidate.fieldId === "name").id, acquiredCandidatePackageHash: "0".repeat(64) };
  await assert.rejects(() => confirmPreflightDossier(staleRun, staleInput), /package is no longer current/i);

  const tampered = structuredClone(acceptedRun.approvedIntake);
  tampered.acquiredCandidates[0].packageHash = "0".repeat(64);
  const { snapshotHash: ignored, ...payload } = tampered;
  tampered.snapshotHash = sha256(payload);
  assert.throws(() => validateApprovedIntakeSnapshot(tampered), /acquired candidate reference is invalid/i);
});

test("accepted, edited and declined GenAI proposals remain distinct user decisions", async () => {
  const candidateRecord = {
    field: "intendedPurpose",
    status: "CANDIDATE",
    recommendation: "REVIEW_CANDIDATE",
    value: "Support internal governance reviews",
    sourceUnitIds: [],
    limitations: []
  };
  const candidate = { id: stableId("intake-proposal", candidateRecord), ...candidateRecord };

  const declinedRun = await createPreflight({ sources: source() });
  declinedRun.discoveryRecheck = { status: "COMPLETED", candidates: [candidate] };
  const declinedDossier = validateDossier(declinedRun.solutionProfile.suggestedDossier);
  const declinedInput = approvalInput(declinedRun, declinedDossier);
  declinedInput.resolutions.intendedPurpose.declinedProposalRef = candidate.id;
  await confirmPreflightDossier(declinedRun, declinedInput);
  const declinedField = declinedRun.approvedIntake.fields.find((field) => field.fieldId === "intendedPurpose");
  assert.deepEqual({ valueState: declinedField.valueState, resolutionState: declinedField.resolutionState, declinedProposalRef: declinedField.declinedProposalRef }, {
    valueState: "UNKNOWN", resolutionState: "USER_SELECTED_UNKNOWN", declinedProposalRef: candidate.id
  });
  assert.deepEqual(declinedRun.approvedIntake.proposalDecisions, [{ proposalRef: candidate.id, fieldId: "intendedPurpose", decision: "DECLINED" }]);

  const acceptedRun = await createPreflight({ sources: source() });
  acceptedRun.discoveryRecheck = { status: "COMPLETED", candidates: [candidate] };
  const acceptedDossier = validateDossier({ ...acceptedRun.solutionProfile.suggestedDossier, intendedPurpose: candidate.value });
  const acceptedInput = approvalInput(acceptedRun, acceptedDossier);
  acceptedInput.resolutions.intendedPurpose = { resolutionState: "USER_ACCEPTED_PROPOSAL", proposalRef: candidate.id };
  await confirmPreflightDossier(acceptedRun, acceptedInput);
  assert.equal(acceptedRun.approvedIntake.fields.find((field) => field.fieldId === "intendedPurpose").origin, "GENAI_PROPOSAL");
  assert.equal(acceptedRun.approvedIntake.proposalDecisions[0].decision, "ACCEPTED");

  const editedRun = await createPreflight({ sources: source() });
  editedRun.discoveryRecheck = { status: "COMPLETED", candidates: [candidate] };
  const editedDossier = validateDossier({ ...editedRun.solutionProfile.suggestedDossier, intendedPurpose: "User-authored governance purpose" });
  const editedInput = approvalInput(editedRun, editedDossier);
  editedInput.resolutions.intendedPurpose.editedProposalRef = candidate.id;
  await confirmPreflightDossier(editedRun, editedInput);
  const editedField = editedRun.approvedIntake.fields.find((field) => field.fieldId === "intendedPurpose");
  assert.deepEqual({ resolutionState: editedField.resolutionState, origin: editedField.origin, proposalRef: editedField.proposalRef }, {
    resolutionState: "USER_EDITED", origin: "USER_DECLARATION", proposalRef: null
  });
  assert.deepEqual(editedRun.approvedIntake.proposalDecisions, [{ proposalRef: candidate.id, fieldId: "intendedPurpose", decision: "EDITED" }]);

  const forgedRun = await createPreflight({ sources: source() });
  forgedRun.discoveryRecheck = { status: "COMPLETED", candidates: [candidate] };
  const forgedDossier = validateDossier(forgedRun.solutionProfile.suggestedDossier);
  const forgedInput = approvalInput(forgedRun, forgedDossier);
  forgedInput.resolutions.intendedPurpose.declinedProposalRef = "forged-proposal";
  await assert.rejects(() => confirmPreflightDossier(forgedRun, forgedInput), /declined proposal reference is invalid/i);

  const tampered = structuredClone(declinedRun.approvedIntake);
  tampered.fields.find((field) => field.fieldId === "intendedPurpose").declinedProposalRef = "forged-proposal";
  tampered.proposalDecisionRefs[0] = "forged-proposal";
  tampered.proposalDecisions[0].proposalRef = "forged-proposal";
  const { snapshotHash: ignored, ...payload } = tampered;
  tampered.snapshotHash = sha256(payload);
  assert.throws(() => validateApprovedIntakeSnapshot(tampered), /proposal candidate reference is invalid/i);
});

test("Accept records a conflicting identity value as edited and does not emit a blocking conflict state", () => {
  const dossier = browserShapedDossier({ name: "Conflict Case", accountableOwner: "Product Team" });
  const profile = {
    fields: {
      name: { value: "Conflict Case", status: "CANDIDATE", sourceUnitIds: ["unit-name"] },
      accountableOwner: { value: "Product Team", status: "CONFLICTING", supportStatus: "CONFLICTING", sourceUnitIds: ["unit-a", "unit-b"], limitations: ["Two owner strings were observed."] }
    },
    assessmentIntakeFacts: {}
  };
  const resolutions = createIntakeResolutionDraft(dossier, profile);
  assert.equal(resolutions.accountableOwner.resolutionState, "USER_EDITED");
  assert.equal(resolutions.currentStage.resolutionState, "USER_SELECTED_UNKNOWN");
  assert.ok(Object.values(resolutions).every((decision) => decision.resolutionState !== "CONFLICT_REQUIRES_RESOLUTION"));
});

test("a browser-shaped Approve payload with unknown stages confirms Intake without a prior validateDossier", async () => {
  const run = await createPreflight({ sources: source("Browser shaped case") });
  const dossier = browserShapedDossier({ name: "Browser Case", accountableOwner: "Case Owner" });
  const resolutions = createIntakeResolutionDraft(dossier, run.solutionProfile);
  assert.equal(resolutions.currentStage.resolutionState, "USER_SELECTED_UNKNOWN");
  assert.equal(resolutions.targetStage.resolutionState, "USER_SELECTED_UNKNOWN");
  assert.equal(resolutions.name.resolutionState, "USER_EDITED");
  await confirmPreflightDossier(run, { dossier, resolutions, approval: { confirmed: true, actorRef: "INTERACTIVE_USER" } });
  assert.equal(run.stage, "INTAKE_CONFIRMED");
  assert.equal(run.status, "AWAITING_TRANSMISSION_APPROVAL");
  assert.equal(run.approvedIntake.effectiveDossier.currentStage, "UNKNOWN");
  assert.equal(run.approvedIntake.effectiveDossier.targetStage, "UNKNOWN");
  const currentStage = run.approvedIntake.fields.find((field) => field.fieldId === "currentStage");
  assert.deepEqual({ value: currentStage.value, valueState: currentStage.valueState, resolutionState: currentStage.resolutionState }, {
    value: null, valueState: "UNKNOWN", resolutionState: "USER_SELECTED_UNKNOWN"
  });
  assert.equal(validateApprovedIntakeSnapshot(run.approvedIntake), run.approvedIntake);
});
