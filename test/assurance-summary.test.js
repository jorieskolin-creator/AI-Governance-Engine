import test from "node:test";
import assert from "node:assert/strict";
import { assessSolution } from "../src/engine.js";
import { SAMPLE_REQUEST } from "../src/sample.js";
import { standaloneReportHtml, REPORT_VERSION } from "../public/report.js";

function request(overrides = {}) {
  const value = structuredClone(SAMPLE_REQUEST);
  Object.assign(value.dossier, overrides.dossier ?? {});
  if (overrides.sources) value.sources = overrides.sources;
  return value;
}

test("v1 includes complete case context and a deterministic lifecycle boundary", async () => {
  const result = await assessSolution(request());
  assert.equal(result.schemaVersion, "1.3.0");
  assert.equal(result.assuranceSummary.version, "assurance-summary-1.3.0");
  assert.equal(result.transitionBoundary.immutable, true);
  assert.equal(result.transitionBoundary.currentStage, result.solution.currentStage);
  assert.equal(result.transitionBoundary.targetStage, result.solution.targetStage);
  assert.equal(result.assuranceSummary.assessmentMode, "DETERMINISTIC_ONLY");
  assert.equal(result.assessmentIntake.identity.name, result.solution.name);
  assert.equal(result.assessmentIntake.data.personalData, result.solution.data.personalData);
  assert.ok(result.assuranceSummary.caseProfile.identityAndIntent.some((item) => item.field === "accountableOwner"));
  assert.ok(result.assuranceSummary.caseProfile.riskDeclarations.some((item) => item.field === "exposure.currentUserAccess"));
  assert.ok(result.assuranceSummary.caseProfile.riskDeclarations.some((item) => item.field === "exposure.intendedUserAccess"));
  assert.equal(result.assuranceSummary.caseProfile.riskDeclarations.some((item) => item.field === "exposure.externalUsers"), false);
  assert.equal(result.assuranceSummary.auditReference.canonicalJsonPath, "$.evidence");
  assert.equal(Object.hasOwn(result.assuranceSummary, "evidenceDigest"), false);
  assert.deepEqual(result.assuranceSummary.strengths, []);
  assert.ok(result.assuranceSummary.blockingFindings.every((item) => item.supportStatus === "COGNITIVE_VERIFICATION_NOT_RUN"));
  assert.ok(result.assuranceSummary.executiveGapGroups.length <= 8);
  assert.equal(result.assessmentIntake.version, "assessment-intake-1.2.0");
});

test("deployment targets use the production boundary label", async () => {
  const result = await assessSolution(request({ dossier: { targetStage: "DEPLOYMENT" } }));
  assert.equal(result.transitionBoundary.label, "Deterministic Production Boundary");
  assert.ok(["PROGRESSION_BLOCKED", "HUMAN_DECISION_REQUIRED", "CURRENT_STAGE_ONLY", "CONDITIONALLY_ALLOWED", "PROGRESSION_ALLOWED"].includes(result.transitionBoundary.status));
});

test("hard gates expose deterministic clearance and authority contracts", async () => {
  const result = await assessSolution(request({ dossier: { classification: { prohibitedPractice: true, highRiskCandidate: false } } }));
  const gate = result.hardGates.find((item) => item.code === "PROHIBITED_PRACTICE");
  assert.ok(gate.clearanceCriteria.length > 0);
  assert.ok(gate.requiredEvidenceKinds.length > 0);
  assert.ok(gate.ruleIds.length > 0);
  assert.equal(gate.blockedTransition, result.solution.targetStage);
});

test("empty playbook output explains that no exact approved tactic is available", async () => {
  const result = await assessSolution(request({ sources: [] }));
  assert.equal(result.actions.length, 0);
  assert.equal(result.assuranceSummary.actionAvailability.status, "NO_APPROVED_TACTIC_AVAILABLE");
  assert.match(result.assuranceSummary.actionAvailability.message, /no exact approved tactic/i);
});

test("standalone report is escaped, offline, lean and case-identifiable", async () => {
  const result = await assessSolution(request({ dossier: { name: "<script>alert(1)</script>", intendedPurpose: "<img src=x onerror=alert(1)>" } }));
  const html = standaloneReportHtml(result);
  assert.doesNotMatch(html, /<script|<img/i);
  assert.doesNotMatch(html, /https?:\/\//i);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, new RegExp(REPORT_VERSION));
  assert.match(html, new RegExp(result.packageHash));
  assert.doesNotMatch(html, /Evidence Digest|raw evidence excerpt/i);
  assert.doesNotMatch(html, /allowedUses|userScope|monitoringOwner|Userscope|Datascope/);
  assert.match(html, /Deterministic controls evaluated/);
  assert.match(html, /Verified evidence/);
  assert.match(html, /Leading decision drivers/);
  assert.match(html, /Trace:/);
  const ordered = ["01 · Decision", "Case Profile and Assessment Scope", "Documentation Alignment", "Deterministic Lifecycle Transition Boundary", "Evidence Interpretation", "Hard-Gate Matrix", "A–F Domain Overview", "Confirmed Strengths", "Blocking Gaps and Unknowns", "Governance Action Playbook", "Human Authority", "Audit Identity", "Limitations"];
  let cursor = -1;
  for (const heading of ordered) {
    const next = html.indexOf(heading);
    assert.ok(next > cursor, `${heading} must appear in report order`);
    cursor = next;
  }
});

test("standalone report preserves UTF-8 punctuation without mojibake", async () => {
  const html = standaloneReportHtml(await assessSolution(request()));
  const roundTrip = Buffer.from(html, "utf8").toString("utf8");
  assert.match(roundTrip, /— Assurance Summary/);
  assert.match(roundTrip, /01 · Decision/);
  assert.match(roundTrip, /Design And Development → Verification And Validation/);
  assert.doesNotMatch(roundTrip, /â€”|Â·|â†’|Aâ€“F/);
});

test("executive report consolidates detailed gaps while JSON retains them", async () => {
  const result = await assessSolution(request({ sources: [] }));
  const detailed = result.assuranceSummary.blockingFindings.length;
  assert.ok(detailed > result.assuranceSummary.executiveGapGroups.length);
  const html = standaloneReportHtml(result);
  assert.equal((html.match(/No acceptable evidence establishes this control/g) ?? []).length, 0);
  assert.ok(result.domains.flatMap((domain) => domain.gaps).length > 0);
});
