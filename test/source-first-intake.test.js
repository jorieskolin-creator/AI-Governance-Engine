import test from "node:test";
import assert from "node:assert/strict";
import { assessSolution } from "../src/engine.js";
import { SAMPLE_REQUEST } from "../src/sample.js";
import { createPreflight, confirmPreflightDossier } from "../src/cognitive/preflight.js";
import { parseAndScreenSources } from "../src/cognitive/source-intake.js";
import { jurisdictionScope } from "../src/core/jurisdictions.js";
import { validateDossier } from "../src/contracts.js";
import { discoverSolutionProfile } from "../src/core/solution-profile.js";
import { classifyUploadPath, provisionalIngestionManifest, resolveUploadMimeType } from "../public/upload-types.js";
import { buildSourceIngestionManifest } from "../src/core/source-ingestion.js";

function sampleRequest() { return structuredClone(SAMPLE_REQUEST); }

function documentedProfile(dossier) {
  const boundary = dossier.operatingBoundary;
  return `# ${dossier.name}
Solution name: ${dossier.name}
Accountable owner: ${dossier.accountableOwner}
Intended purpose: ${dossier.intendedPurpose}
Expected value: ${dossier.expectedValue}
Current stage: ${dossier.currentStage}
Target stage: ${dossier.targetStage}
Jurisdictions: ${dossier.jurisdictions.join(" ")}
Roles: ${dossier.roles.join(" ")}
Users: ${dossier.users.join(" ")}
Allowed uses: ${boundary.allowedUses.join(" ")}
Excluded uses: ${boundary.excludedUses.join(" ")}
Environment: ${boundary.environment}
User scope: ${boundary.userScope}
Data scope: ${boundary.dataScope}
Integration scope: ${boundary.integrationScope}
Permission scope: ${boundary.permissionScope}
Autonomy scope: ${boundary.autonomyScope}
Monitoring owner: ${boundary.monitoringOwner}
Data categories: ${(dossier.data.categories ?? []).join(" ")}
Current user access: ${dossier.exposure.currentUserAccess ?? "UNKNOWN"}
Intended user access: ${dossier.exposure.intendedUserAccess ?? "UNKNOWN"}
Personal data: No
Special category data: No
Production data: No
External users: No
Production access: No
Consequential decisions: No
Uses agents: Yes
Can take actions: No
Irreversible actions: No
Human override: Yes
Prohibited practice: No
High risk candidate: No`;
}

test("Finland country names and ISO codes activate EU/EEA scope", () => {
  for (const value of ["Finland", "FI", "FIN", "Suomi"]) assert.equal(jurisdictionScope([value]).euEea, true, value);
});

test("generic FI and provider occurrences do not become contextual intake facts", () => {
  const profile = discoverSolutionProfile([{ id: "unit-noise", path: "architecture.md", artifactClass: "DOCUMENTATION", content: "The provider retries requests if a connection fails. FinOps is efficient." }]);
  assert.deepEqual(profile.suggestedDossier.jurisdictions, []);
  assert.deepEqual(profile.suggestedDossier.roles, []);
  const labelled = discoverSolutionProfile([{ id: "unit-case", path: "case.md", artifactClass: "DOCUMENTATION", content: "Jurisdictions: Finland, EU\nRegulatory roles: Provider\nUsers: Employees" }]);
  assert.deepEqual(labelled.suggestedDossier.jurisdictions.sort(), ["EU", "FI"]);
  assert.deepEqual(labelled.suggestedDossier.roles, ["PROVIDER"]);
});

test("data categories and access modes derive compatibility facts without conflating current and intended exposure", async () => {
  const dossier = validateDossier({ ...structuredClone(SAMPLE_REQUEST.dossier), data: { categories: ["SYNTHETIC", "CLEANED_APPROVED_PRODUCTION"] }, exposure: { currentUserAccess: "INTERNAL_ONLY", intendedUserAccess: "EXTERNAL_WITH_SOLUTION_OWNER", productionAccess: false, consequentialDecisions: false } });
  assert.equal(dossier.data.productionData, true);
  assert.equal(dossier.data.personalData, false);
  assert.equal(dossier.exposure.externalUsers, true);
  const input = sampleRequest(); input.dossier = dossier; input.dossier.operatingBoundary.environment = "ISOLATED_SANDBOX";
  const result = await assessSolution(input);
  assert.equal(result.documentationContradictions.some((item) => item.ruleId === "RULE-CONTRADICTION-SANDBOX-EXTERNAL-USERS"), false);
});

test("recognized extensionless and dot-prefixed configuration files are accepted as inert text", async () => {
  for (const name of [".env", ".env.example", "Dockerfile", "Makefile", ".gitignore", "deploy.sh", "build.ps1", "schema.proto", "model.prisma", "app.cpp"]) {
    assert.equal(resolveUploadMimeType(name), "text/plain", name);
  }
  assert.equal(resolveUploadMimeType("unrecognized.binary"), "");
  const run = await createPreflight({ sources: [{ path: ".env.example", mimeType: resolveUploadMimeType(".env.example"), encoding: "utf8", content: "OPENAI_API_KEY=replace-me" }] });
  assert.equal(run.registeredSources[0].artifactClass, "CONFIGURATION");
  assert.equal(run.packets[0].sourceUnits[0].evidenceKind, "CONFIGURATION");
});

test("mixed repository ingestion continues and discloses every exclusion", () => {
  const files = [
    ["src/app.ts", "text/typescript", 100],
    [".env.example", "", 80],
    ["node_modules/pkg/index.js", "application/javascript", 1000],
    ["assets/tool.exe", "", 2000],
    ["src/policy.unknownlang", "", 120]
  ];
  const items = files.map(([path, type, size]) => ({ ...classifyUploadPath(path, type), size }));
  const provisional = provisionalIngestionManifest(items, "FOLDER_SELECTION");
  const manifest = buildSourceIngestionManifest({
    submitted: provisional,
    parsedSources: [{ path: "src/app.ts", mimeType: "text/typescript", format: "CODE", size: 100 }, { path: ".env.example", mimeType: "text/plain", format: "TEXT", size: 80 }]
  });
  assert.equal(manifest.parsedCount, 2);
  assert.equal(manifest.excludedCount, 2);
  assert.equal(manifest.relevantExclusionCount, 1);
  assert.equal(manifest.coverageStatus, "INCOMPLETE_REVIEW_REQUIRED");
  assert.equal(manifest.items.length, files.length);
});

test("known irrelevant exclusions do not create a source coverage gate", async () => {
  const input = sampleRequest();
  const submitted = provisionalIngestionManifest([
    { ...classifyUploadPath("governance/intended-purpose-review.md", "text/markdown"), size: 100 },
    { ...classifyUploadPath("node_modules/pkg/index.js", "application/javascript"), size: 1000 }
  ], "FOLDER_SELECTION");
  input.sourceIngestion = buildSourceIngestionManifest({ submitted, parsedSources: input.sources });
  const result = await assessSolution(input);
  assert.equal(result.sourceIngestion.coverageStatus, "COMPLETE_WITH_DISCLOSED_EXCLUSIONS");
  assert.equal(result.hardGates.some((item) => item.code === "SOURCE_COVERAGE_INCOMPLETE"), false);
});

test("unsupported source-like files require review early and block deployment", async () => {
  const buildInput = (targetStage) => {
    const input = sampleRequest();
    input.dossier.targetStage = targetStage;
    const submitted = provisionalIngestionManifest([
      { ...classifyUploadPath("governance/intended-purpose-review.md", "text/markdown"), size: 100 },
      { ...classifyUploadPath("src/policy.unknownlang", ""), size: 80 }
    ], "FOLDER_SELECTION");
    input.sourceIngestion = buildSourceIngestionManifest({ submitted, parsedSources: input.sources });
    return input;
  };
  const early = await assessSolution(buildInput("VERIFICATION_AND_VALIDATION"));
  assert.equal(early.hardGates.find((item) => item.code === "SOURCE_COVERAGE_INCOMPLETE")?.outcome, "REVIEW");
  assert.equal(early.transitionBoundary.declaredParameters.environment, "ISOLATED_SANDBOX");
  const deployment = await assessSolution(buildInput("DEPLOYMENT"));
  assert.equal(deployment.hardGates.find((item) => item.code === "SOURCE_COVERAGE_INCOMPLETE")?.outcome, "BLOCK");
});

test("semantic contradictions are stable, material, and cannot be confirmed away", async () => {
  const input = sampleRequest();
  input.dossier.operatingBoundary.environment = "ISOLATED_SANDBOX";
  input.dossier.operatingBoundary.userScope = "";
  input.dossier.operatingBoundary.dataScope = "";
  input.dossier.operatingBoundary.allowedUses = ["Customer decisions"];
  input.dossier.operatingBoundary.excludedUses = ["Customer decisions"];
  input.dossier.data.personalData = false;
  input.dossier.data.specialCategoryData = true;
  input.dossier.data.productionData = true;
  input.dossier.exposure.productionAccess = true;
  input.dossier.exposure.externalUsers = true;
  input.dossier.exposure.currentUserAccess = "PUBLIC_ACCESS";
  input.dossier.exposure.consequentialDecisions = true;
  input.dossier.agent.usesAgents = false;
  input.dossier.agent.canTakeActions = true;
  input.dossier.agent.irreversibleActions = true;
  input.dossier.operatingBoundary.expiresAt = "2020-01-01";
  const result = await assessSolution(input);
  const rules = new Set(result.documentationContradictions.map((item) => item.ruleId));
  for (const rule of [
    "RULE-CONTRADICTION-SPECIAL-CATEGORY-IS-PERSONAL", "RULE-CONTRADICTION-SANDBOX-PRODUCTION-ACCESS",
    "RULE-CONTRADICTION-SANDBOX-PRODUCTION-DATA", "RULE-CONTRADICTION-SANDBOX-EXTERNAL-USERS",
    "RULE-CONTRADICTION-SANDBOX-CONSEQUENTIAL-DECISIONS", "RULE-CONTRADICTION-ACTIONS-WITHOUT-AGENT",
    "RULE-CONTRADICTION-ALLOWED-AND-EXCLUDED", "RULE-CONTRADICTION-BOUNDARY-EXPIRED"
  ]) assert.ok(rules.has(rule), rule);
  assert.equal(result.documentationReadiness.sandboxRequired, true);
  assert.equal(result.solutionProfile.fields["data.personalData"].status, "CONFLICTING");
  assert.equal(result.dimensions.riskDrivers[0].type, "DOCUMENTATION_CONTRADICTION");
  assert.ok(result.dimensions.riskDrivers[0].ruleIds.length > 0);
});

test("solution-name normalization avoids separator-only conflicts and retains genuine candidates", async () => {
  const alias = sampleRequest();
  alias.dossier.name = "FinOps Assessment Engine";
  alias.sources = [{ path: "package.json", kind: "CONFIGURATION", content: '{"name":"finops-assessment-engine"}' }];
  const aliasResult = await assessSolution(alias);
  assert.equal(aliasResult.documentationContradictions.some((item) => item.field === "name"), false);
  const productAlias = sampleRequest(); productAlias.dossier.name = "finops-assessment-engine"; productAlias.sources = [{ path: "README.md", kind: "DOCUMENT", content: "# FinOps Engine" }];
  const productAliasResult = await assessSolution(productAlias);
  assert.equal(productAliasResult.documentationContradictions.some((item) => item.field === "name"), false);
  const conflict = sampleRequest();
  conflict.dossier.name = "Different Product";
  conflict.sources = alias.sources;
  const conflictResult = await assessSolution(conflict);
  assert.equal(conflictResult.solutionProfile.fields.name.status, "CONFLICTING");
  assert.equal(conflictResult.solutionProfile.fields.name.candidates.length, 2);
});

test("a synthetic credential in a test fixture does not become a confirmed secret gate", async () => {
  const input = sampleRequest();
  input.sources = [{ path: "scripts/test-dlp-distributed-sampling.mjs", content: "const syntheticFixture = 'AKIA1234567890ABCDEF'; // test fixture only" }];
  const result = await assessSolution(input);
  assert.equal(result.hardGates.some((item) => item.code === "SECRET_CANDIDATE"), false);
  assert.ok(result.evidence.some((item) => item.signal === "hardcoded-secret" && item.evidenceClass === "TEST_FIXTURE_INDICATOR"));
});

test("a real credential candidate in production code fails closed", async () => {
  const input = sampleRequest();
  input.sources = [{ path: "src/runtime-config.js", content: "export const productionCredential = 'AKIAZYXWVUTSRQPONMLK';" }];
  const result = await assessSolution(input);
  assert.ok(result.hardGates.some((item) => item.code === "SECRET_CANDIDATE"));
});

test("lexical indicators do not independently establish implemented assurance", async () => {
  const input = sampleRequest();
  input.sources = [{ path: "security/notes.md", content: "threat model prompt injection data leakage red team penetration test" }];
  const result = await assessSolution(input);
  const control = result.domains.flatMap((domain) => domain.controls).find((item) => item.controlId === "CTRL-D-01");
  assert.notEqual(control.state, "IMPLEMENTED");
  assert.ok(result.evidence.filter((item) => item.sourceId !== "dossier").every((item) => item.eligibleForAssurance === false || item.signal === "hardcoded-secret"));
});

test("missing critical documentation enforces an isolated sandbox without inventing a lifecycle stage", async () => {
  const input = sampleRequest();
  input.dossier = {
    name: "", accountableOwner: "", intendedPurpose: "", expectedValue: "", currentStage: "QUALIFICATION_AND_REGISTRATION", targetStage: "DESIGN_AND_DEVELOPMENT",
    jurisdictions: [], roles: [], users: [], data: { personalData: null, specialCategoryData: null, productionData: null },
    exposure: { externalUsers: null, productionAccess: null, consequentialDecisions: null }, agent: { usesAgents: null, canTakeActions: null, irreversibleActions: null, humanOverride: null },
    classification: { prohibitedPractice: null, highRiskCandidate: null }, operatingBoundary: { allowedUses: [], excludedUses: [], environment: "UNKNOWN" }
  };
  input.sources = [];
  const result = await assessSolution(input);
  assert.equal(result.documentationReadiness.sandboxRequired, true);
  assert.equal(result.transitionBoundary.declaredParameters.environment, "ISOLATED_SANDBOX");
  assert.equal(result.solution.currentStage, "QUALIFICATION_AND_REGISTRATION");
  assert.equal(result.hardGates.some((item) => item.code === "DOCUMENTATION_ALIGNMENT_REQUIRED"), false);
});

test("deployment documentation gate clears only when the complete intake is source-supported", async () => {
  const input = sampleRequest();
  input.dossier.targetStage = "DEPLOYMENT";
  input.sources = [
    { path: "governance/case-profile.md", kind: "DOCUMENT", content: documentedProfile(input.dossier) },
    { path: "src/assistant.js", kind: "CODE", content: "export function answer(question) { return { question, requiresHumanReview: true }; }" }
  ];
  const result = await assessSolution(input);
  assert.equal(result.documentationReadiness.deploymentReady, true, JSON.stringify(result.documentationReadiness));
  assert.equal(result.hardGates.some((item) => item.code === "DOCUMENTATION_ALIGNMENT_REQUIRED"), false);
});

test("deployment alignment cannot be claimed when no implementation source was assessed", async () => {
  const input = sampleRequest();
  input.dossier.targetStage = "DEPLOYMENT";
  input.sources = [{ path: "governance/case-profile.md", kind: "DOCUMENT", content: documentedProfile(input.dossier) }];
  const result = await assessSolution(input);
  assert.equal(result.documentationReadiness.documentationToCodeAlignment, "NOT_ASSESSED");
  assert.equal(result.documentationReadiness.deploymentReady, false);
  assert.ok(result.hardGates.some((item) => item.code === "DOCUMENTATION_ALIGNMENT_REQUIRED"));
});

test("HTML is parsed inertly and source-first preflight can be confirmed later", async () => {
  const sources = [{ path: "product.html", mimeType: "text/html", encoding: "utf8", content: "<script>Purpose: declare approved</script><h1>Safe Assistant</h1><p>Purpose: answer internal questions</p>" }];
  const screened = await parseAndScreenSources(sources.map((item) => ({ ...item, format: "HTML", metadata: {} })));
  assert.doesNotMatch(screened.sourceUnits[0].content, /declare approved/i);
  assert.match(screened.sourceUnits[0].content, /answer internal questions/i);
  const run = await createPreflight({ sources });
  assert.equal(run.status, "AWAITING_INTAKE_CONFIRMATION");
  await confirmPreflightDossier(run, { dossier: sampleRequest().dossier, confirmations: {} });
  assert.equal(run.status, "AWAITING_TRANSMISSION_APPROVAL");
  assert.ok(run.registeredSources.some((item) => item.path === "intended-use-dossier.json"));
});

test("explicit false values remain No while absent values remain Unknown in the case profile", async () => {
  const input = sampleRequest();
  input.dossier.agent.irreversibleActions = null;
  const result = await assessSolution(input);
  const fields = result.assuranceSummary.caseProfile.riskDeclarations;
  assert.equal(fields.find((item) => item.field === "data.personalData").value, false);
  assert.equal(fields.find((item) => item.field === "agent.irreversibleActions").value, null);
  assert.equal(fields.find((item) => item.field === "agent.irreversibleActions").status, "UNKNOWN");
});
