import test from "node:test";
import assert from "node:assert/strict";
import { createPreflight, confirmPreflightDossier } from "../src/cognitive/preflight.js";
import { validateDossier } from "../src/contracts.js";
import { createIntakeResolutionDraft } from "../src/intake/contracts.js";
import { buildDeclarationComparison, validateDeclarationComparison } from "../src/intake/declaration-comparison.js";

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
});
