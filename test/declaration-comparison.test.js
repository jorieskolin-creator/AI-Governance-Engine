import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createPreflight, confirmPreflightDossier } from "../src/cognitive/preflight.js";
import { validateDossier } from "../src/contracts.js";
import { createIntakeResolutionDraft } from "../src/intake/contracts.js";
import { buildDeclarationComparison, createSafeComparisonSummary, validateDeclarationComparison } from "../src/intake/declaration-comparison.js";
import { assessVerifiedSolution } from "../src/engine.js";
import { standaloneReportHtml } from "../public/report.js";
import { serializeDurableRun, deserializeDurableRun } from "../src/cognitive/run-persistence.js";

const goldenHandoff = await readFile(new URL("./fixtures/doc-support-handoff.golden.json", import.meta.url), "utf8");

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

test("multi-tier comparison verifies additional docs, codebase implementation signals, and Documentation Support mitigation references end to end", async () => {
  const run = await createPreflight({
    documentationHandoff: goldenHandoff,
    sources: [
      {
        path: "README.md",
        mimeType: "text/markdown",
        content: "# Record review assistant\n\nIntended purpose: Autonomous external enforcement."
      },
      {
        path: "docs/architecture.md",
        mimeType: "text/markdown",
        content: "# Architecture\n\nRecord owner: Platform Governance Team\nMinimisation and retention: Purge transient uploads after 24 hours"
      },
      {
        path: "src/filter.ts",
        mimeType: "text/typescript",
        content: "const key = process.env.OPENAI_API_KEY;\nexport function runAgent(input: string) { return executeTool(input); }\nexport function sweepExpired() { return true; }"
      }
    ]
  });
  const dossier = validateDossier({
    name: "Record review assistant",
    accountableOwner: "Service Lead",
    intendedPurpose: "Help the review team find the right records.",
    targetStage: "VERIFICATION_AND_VALIDATION",
    agent: { usesAgents: false, canTakeActions: false, humanOverride: true },
    operatingBoundary: {
      allowedUses: ["Internal record search"],
      excludedUses: ["External enforcement"],
      environment: "ISOLATED_SANDBOX",
      integrationScope: "Offline-only local processing with no external integrations"
    }
  });
  await confirmPreflightDossier(run, {
    dossier,
    resolutions: createIntakeResolutionDraft(dossier, run.solutionProfile),
    documentationEdits: { minimization: "Purge transient uploads after 60 minutes" },
    approval: { confirmed: true, actorRef: "TEST_USER" }
  });

  const comparison = buildDeclarationComparison(run.approvedIntake, run.localSourceUnits, run.registeredSources);
  validateDeclarationComparison(comparison, run.approvedIntake);

  assert.equal(comparison.rows.find((row) => row.field === "intendedPurpose" && row.evidenceTier === "README_DOCUMENTATION")?.status, "CONTRADICTED");
  assert.equal(comparison.rows.find((row) => row.field === "declaredTopics.recordOwner" && row.evidenceTier === "ADDITIONAL_DOCUMENTATION")?.status, "CONTRADICTED");
  assert.equal(comparison.rows.find((row) => row.field === "declaredTopics.minimization" && row.evidenceTier === "ADDITIONAL_DOCUMENTATION")?.status, "CONTRADICTED");
  assert.equal(comparison.rows.find((row) => row.field === "declaredTopics.minimization" && row.evidenceTier === "CODEBASE_IMPLEMENTATION")?.status, "ALIGNED");
  assert.equal(comparison.rows.find((row) => row.field === "agent.canTakeActions" && row.evidenceTier === "CODEBASE_IMPLEMENTATION")?.status, "CONTRADICTED");
  assert.equal(comparison.rows.find((row) => row.field === "operatingBoundary.integrationScope" && row.evidenceTier === "CODEBASE_IMPLEMENTATION")?.status, "CONTRADICTED");
  assert.equal(comparison.rows.find((row) => row.field === "agent.humanOverride" && row.evidenceTier === "CODEBASE_IMPLEMENTATION")?.status, "UNVERIFIED_IN_CODE");

  const locatedFilter = comparison.referenceChecks.find((check) => check.ownerId === "FM-03" && check.refKind === "CODE_REF");
  const missingReview = comparison.referenceChecks.find((check) => check.ownerId === "FM-06" && check.refKind === "CODE_REF");
  assert.equal(locatedFilter?.snapshotStatus, "LOCATED_IN_SNAPSHOT");
  assert.equal(missingReview?.snapshotStatus, "MISSING_FROM_SNAPSHOT");
  assert.equal(comparison.rows.find((row) => row.field === "failureModes.FM-06.codeRef")?.status, "CONTRADICTED");

  const safeSummary = createSafeComparisonSummary(comparison);
  assert.equal(safeSummary.rawContentIncluded, false);
  assert.doesNotMatch(JSON.stringify(safeSummary), /src\/filter\.ts|src\/review\.ts|Platform Governance Team|executeTool/);

  run.declarationComparison = comparison;
  const recovered = deserializeDurableRun(serializeDurableRun(run));
  assert.equal(recovered.declarationComparison.comparisonHash, comparison.comparisonHash);

  const pkg = await assessVerifiedSolution({
    dossier: run.approvedIntake.effectiveDossier,
    runId: run.id,
    registeredSources: run.registeredSources,
    sourceIngestion: run.sourceIngestion,
    solutionProfile: run.solutionProfile,
    solutionModel: { facts: [] },
    declaredDocumentation: run.approvedIntake.declaredDocumentation,
    declarationComparison: comparison
  }, { provisional: true });

  assert.equal(pkg.documentationReadiness.documentationToCodeAlignment, "CONFLICTING");
  assert.ok(pkg.dimensions.riskDrivers.some((driver) => driver.type === "DOCUMENTATION_CONTRADICTION"));
  assert.match(pkg.assuranceSummary.executiveGapGroups[0].text, /Intake vs\. codebase comparison:/);
  assert.ok(pkg.evidence.some((item) => item.signal === "declared-topic-minimization" && item.eligibleForAssurance === false));
  assert.ok(pkg.evidence.some((item) => item.signal === "declared-failure-mode-fm-06" && item.evidenceClass === "DECLARED_RISK"));

  const html = standaloneReportHtml(pkg);
  assert.match(html, /Declared reference verification:/);
  assert.match(html, /Located in submitted snapshot|Located In Snapshot/i);
  assert.match(html, /Missing from snapshot|Missing From Snapshot/i);
});
