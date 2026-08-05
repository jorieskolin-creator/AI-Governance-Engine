import test from "node:test";
import assert from "node:assert/strict";
import { validateDossier } from "../src/contracts.js";
import { discoverSolutionProfile, buildDocumentationReadiness, buildAssessmentIntake } from "../src/core/solution-profile.js";
import { dossierEvidence } from "../src/core/source-registry.js";
import { INTAKE_QUESTIONNAIRE } from "../src/knowledge/intake-questionnaire.js";
import { parseAndScreenSources } from "../src/cognitive/source-intake.js";
import { sanitizeRestrictedValue } from "../public/content-policy.js";
import { standaloneReportHtml } from "../public/report.js";

function completeAnswers() {
  return Object.fromEntries(INTAKE_QUESTIONNAIRE.questions.map((question) => [question.id, {
    answerState: question.id === "AI_SYSTEM_QUALIFICATION" ? "YES" : question.type === "MULTI" ? "NO" : question.options.includes("NOT_APPLICABLE") ? "NOT_APPLICABLE" : "NO",
    values: question.type === "MULTI" ? ["NONE_OF_THE_ABOVE"] : [],
    origin: "HUMAN_CLASSIFIED", supportStatus: "SUPPORTED", sourceUnitIds: [], evidenceLinks: [], limitations: [],
    confirmedBy: "AUTHORIZED_REVIEWER", confirmedAt: "2026-08-05T08:00:00.000Z"
  }]));
}

test("unknown lifecycle input is preserved as unknown while a safe provisional stage is used", () => {
  const dossier = validateDossier({ currentStage: "UNKNOWN", targetStage: "UNKNOWN", intakeAnswers: {} });
  assert.equal(dossier.currentStage, "QUALIFICATION_AND_REGISTRATION");
  assert.equal(dossier.targetStage, "DESIGN_AND_DEVELOPMENT");
  assert.equal(dossier.lifecycleDeclaration.provisional, true);
  const profile = discoverSolutionProfile([], dossier);
  assert.equal(profile.fields.currentStage.status, "UNKNOWN");
  assert.equal(profile.fields.targetStage.status, "UNKNOWN");
});

test("questionnaire defaults remain unknown and unsupported negative answers cannot clear deployment", () => {
  const dossier = validateDossier({ currentStage: "DESIGN_AND_DEVELOPMENT", targetStage: "DEPLOYMENT", intakeAnswers: {
    PROHIBITED_PRACTICE_CATEGORIES: { answerState: "NO", values: ["NONE_OF_THE_ABOVE"], origin: "USER_DECLARED", supportStatus: "UNSUPPORTED" }
  } });
  const profile = discoverSolutionProfile([], dossier);
  assert.equal(profile.assessmentIntakeFacts.AI_SYSTEM_QUALIFICATION.answerState, "UNKNOWN");
  const readiness = buildDocumentationReadiness(profile, dossier.targetStage);
  assert.ok(readiness.unsupportedNegativeAnswers.includes("PROHIBITED_PRACTICE_CATEGORIES"));
  assert.equal(readiness.deploymentReady, false);
});

test("legacy user declarations normalize to Self-Declared provenance", () => {
  const dossier = validateDossier({ intakeAnswers: {
    AI_SYSTEM_QUALIFICATION: { answerState: "YES", origin: "USER_DECLARED", supportStatus: "UNSUPPORTED" }
  } });
  assert.equal(dossier.intakeAnswers.AI_SYSTEM_QUALIFICATION.origin, "SELF_DECLARED");
});

test("Self-Declared Intake deterministically caps progression at Verification and Validation", () => {
  const dossier = validateDossier({ currentStage: "VERIFICATION_AND_VALIDATION", targetStage: "DEPLOYMENT", intakeAnswers: {
    AI_SYSTEM_QUALIFICATION: { answerState: "YES", origin: "SELF_DECLARED", supportStatus: "UNSUPPORTED" }
  } });
  const readiness = buildDocumentationReadiness(discoverSolutionProfile([], dossier), dossier.targetStage);
  assert.equal(readiness.maximumLifecycleStage, "VERIFICATION_AND_VALIDATION");
  assert.equal(readiness.selfDeclarationGateRequired, true);
  assert.ok(readiness.selfDeclaredIntakeFields.includes("intakeAnswers.AI_SYSTEM_QUALIFICATION"));
});

test("inactive conditional questions do not create Intake unknowns", () => {
  const answers = completeAnswers();
  answers.GENERAL_PURPOSE_MODEL_PROVIDER = { answerState: "NO", values: [], origin: "HUMAN_CLASSIFIED", supportStatus: "SUPPORTED" };
  delete answers.SYSTEMIC_RISK_MODEL;
  const dossier = validateDossier({ currentStage: "DESIGN_AND_DEVELOPMENT", targetStage: "VERIFICATION_AND_VALIDATION", intakeAnswers: answers });
  const readiness = buildDocumentationReadiness(discoverSolutionProfile([], dossier, {}, { trustedIntakeProvenance: true }), dossier.targetStage);
  assert.equal(readiness.questionnaireUnknowns.includes("SYSTEMIC_RISK_MODEL"), false);
});

test("confirmed questionnaire answers become declared audit evidence without creating assurance", () => {
  const dossier = validateDossier({ currentStage: "DESIGN_AND_DEVELOPMENT", targetStage: "VERIFICATION_AND_VALIDATION", intakeAnswers: completeAnswers() });
  const evidence = dossierEvidence(dossier);
  const intakeEvidence = evidence.filter((item) => item.signal === "intake-declaration");
  assert.equal(intakeEvidence.length, INTAKE_QUESTIONNAIRE.questions.length - 1);
  assert.ok(intakeEvidence.every((item) => item.assuranceState === "DECLARED" && item.eligibleForAssurance === false));
  const profile = discoverSolutionProfile([], dossier);
  const readiness = buildDocumentationReadiness(profile, dossier.targetStage);
  const intake = buildAssessmentIntake(dossier, profile, readiness, []);
  assert.equal(intake.questionnaire.answers.length, INTAKE_QUESTIONNAIRE.questions.length - 1);
  assert.equal(intake.questionnaire.inactiveAnswers[0].questionId, "SYSTEMIC_RISK_MODEL");
});

test("restricted identifiers are removed from evidence packets, persistent values and report HTML", async () => {
  const first = Buffer.from("dml2aWN0YQ==", "base64").toString("utf8");
  const second = Buffer.from("c2FpZG90", "base64").toString("utf8");
  const screened = await parseAndScreenSources([{ path: `${first}-case.md`, mimeType: "text/markdown", format: "TEXT", encoding: "utf8", content: `Owner: ${first}. Connector: ${second}.` }]);
  const serialized = JSON.stringify(screened).toLowerCase();
  assert.doesNotMatch(serialized, new RegExp(first, "i"));
  assert.doesNotMatch(serialized, new RegExp(second, "i"));
  const pkg = sanitizeRestrictedValue({ solution: { name: first }, assuranceSummary: { caseProfile: {}, transitionBoundary: { currentStage: "DESIGN_AND_DEVELOPMENT", targetStage: "DEPLOYMENT", permittedUses: [], prohibitedUses: [], conditions: [], label: "Boundary", headline: "Boundary", status: "PROGRESSION_BLOCKED" }, decision: { outcome: "BLOCKED_IN_CURRENT_FORM", rationale: second }, dimensions: {}, humanAuthority: { formalDecisionStatus: "FORMAL_DECISION_PENDING", boundary: "Human decision", requirements: [] }, documentationAlignment: {}, evidenceInterpretation: [], gateRows: [], domainSummaries: [], strengths: [], blockingFindings: [], executiveGapGroups: [], actionAvailability: { status: "NO_ACTION_REQUIRED", message: "None" }, actions: [], limitations: [], assessmentMode: "DETERMINISTIC_ONLY" }, knowledge: {}, generatedAt: "2026-08-05T08:00:00.000Z" });
  const html = standaloneReportHtml(pkg).toLowerCase();
  assert.doesNotMatch(html, new RegExp(first, "i"));
  assert.doesNotMatch(html, new RegExp(second, "i"));
});
