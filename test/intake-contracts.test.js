import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validateDossier } from "../src/contracts.js";
import { confirmPreflightDossier, createPreflight } from "../src/cognitive/preflight.js";
import { createIntakeResolutionDraft, validateApprovedIntakeSnapshot } from "../src/intake/contracts.js";
import { INTAKE_FIELD_REGISTRY, validateQuestionnaireAgainstRegistry } from "../src/intake/field-registry.js";
import { INTAKE_QUESTIONNAIRE } from "../src/knowledge/intake-questionnaire.js";

const source = (content = "# Intake case") => [{ path: "case.md", mimeType: "text/markdown", encoding: "utf8", content }];

function approvalInput(run, dossier) {
  return {
    dossier,
    resolutions: createIntakeResolutionDraft(dossier, run.solutionProfile),
    approval: { confirmed: true, actorRef: "TEST_USER" }
  };
}

test("the versioned registry covers every active HTML Intake control and questionnaire field", async () => {
  assert.equal(validateQuestionnaireAgainstRegistry(INTAKE_QUESTIONNAIRE), true);
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const controls = INTAKE_FIELD_REGISTRY.fields.filter((field) => field.uiControlId);
  for (const field of controls) assert.match(html, new RegExp(`id=["']${field.uiControlId}["']`), field.id);
  assert.equal(new Set(controls.map((field) => field.uiControlId)).size, controls.length);
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
    /field resolutions are required/i
  );
  assert.equal(run.status, "AWAITING_INTAKE_CONFIRMATION");
  assert.equal(run.solutionProfile.hash, originalProfileHash);
  assert.equal(run.approvedIntake, undefined);
});

test("Unknown is a final user resolution, conflicts remain blocking, and Not Applicable is field-governed", async () => {
  const conflicting = await createPreflight({ sources: source("Accountable owner: Product Team\nAccountable owner: Risk Team") });
  const conflictingDossier = validateDossier(conflicting.solutionProfile.suggestedDossier);
  await assert.rejects(
    () => confirmPreflightDossier(conflicting, approvalInput(conflicting, conflictingDossier)),
    /accountableOwner is not resolved/i
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
  const missingExplanation = approvalInput(questionnaire, questionnaireDossier);
  missingExplanation.resolutions["intakeAnswers.ROLE_REBRANDING"].explanation = "";
  await assert.rejects(() => confirmPreflightDossier(questionnaire, missingExplanation), /requires an explanation for Not Applicable/i);
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
