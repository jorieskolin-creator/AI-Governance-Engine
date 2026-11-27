import test from "node:test";
import assert from "node:assert/strict";
import { createPreflight, confirmPreflightDossier } from "../src/cognitive/preflight.js";
import { validateDossier } from "../src/contracts.js";
import { createIntakeResolutionDraft } from "../src/intake/contracts.js";
import { buildDeclarationComparison, validateDeclarationComparison } from "../src/intake/declaration-comparison.js";
import { assessVerifiedSolution } from "../src/engine.js";
import { standaloneReportHtml } from "../public/report.js";

test("submitted README and configuration can disagree independently with the approved content", async () => {
  const run = await createPreflight({ sources: [
    { path: "README.md", mimeType: "text/markdown", content: "# Landing case\n\nIntended purpose: Provision cloud changes." },
    { path: "config/permissions.json", mimeType: "application/json", content: "{\"agent\":{\"canTakeActions\":true}}" },
    { path: "examples/permissions.json", mimeType: "application/json", content: "{\"humanOverride\":true}" }
  ] });
  const dossier = validateDossier({
    name: "Landing case", accountableOwner: "Service owner", intendedPurpose: "Read-only assessment.",
    agent: { canTakeActions: false, humanOverride: true }
  });
  await confirmPreflightDossier(run, {
    dossier, resolutions: createIntakeResolutionDraft(dossier, run.solutionProfile),
    approval: { confirmed: true, actorRef: "TEST_USER" }
  });
  const comparison = buildDeclarationComparison(run.approvedIntake, run.localSourceUnits, run.registeredSources);
  validateDeclarationComparison(comparison, run.approvedIntake);
  const readme = comparison.rows.find(({ field }) => field === "intendedPurpose");
  assert.equal(readme.status, "CONTRADICTED");
  assert.equal(readme.observations[0].citations[0].path, "README.md");
  const code = comparison.rows.find(({ field, evidenceTier }) => field === "agent.canTakeActions" && evidenceTier === "STATIC_CONFIGURATION");
  assert.equal(code.status, "CONTRADICTED");
  assert.equal(code.declared, false);
  assert.equal(code.observations[0].value, true);
  assert.equal(code.observations[0].citations[0].path, "config/permissions.json");
  assert.equal(comparison.rows.find(({ field }) => field === "agent.humanOverride").status, "INSUFFICIENT_EVIDENCE");
  assert.throws(() => validateDeclarationComparison({ ...comparison, rows: [] }, run.approvedIntake), /integrity check/);
  const result = await assessVerifiedSolution({
    dossier, runId: run.id, registeredSources: run.registeredSources,
    sourceIngestion: run.sourceIngestion, solutionProfile: run.solutionProfile,
    solutionModel: { facts: [] }, declarationComparison: comparison
  }, { provisional: true });
  assert.equal(result.assuranceSummary.documentationAlignment.sourceComparison.comparisonHash, comparison.comparisonHash);
  assert.equal(result.assuranceSummary.documentationAlignment.documentationToCodeAlignment, "CONFLICTING");
  const html = standaloneReportHtml(result);
  assert.match(html, /Approved Intake compared with submitted sources/);
  assert.match(html, /README\.md/);
  assert.match(html, /config\/permissions\.json/);
});
