import test from "node:test";
import assert from "node:assert/strict";
import { assessSolution } from "../src/engine.js";
import { SAMPLE_REQUEST } from "../src/sample.js";
import { createPreflight, confirmPreflightDossier } from "../src/cognitive/preflight.js";
import { parseAndScreenSources } from "../src/cognitive/source-intake.js";
import { jurisdictionScope } from "../src/core/jurisdictions.js";
import { validateDossier } from "../src/contracts.js";
import { buildDocumentationReadiness, discoverSolutionProfile } from "../src/core/solution-profile.js";
import { classifyUploadPath, provisionalIngestionManifest, resolveUploadMimeType } from "../public/upload-types.js";
import { buildSourceIngestionManifest } from "../src/core/source-ingestion.js";
import { INTAKE_QUESTIONNAIRE } from "../src/knowledge/intake-questionnaire.js";
import { createIntakeResolutionDraft } from "../src/intake/contracts.js";

function sampleRequest() { return structuredClone(SAMPLE_REQUEST); }

function approvedInput(run, dossier) {
  const completedDossier = validateDossier({
    ...dossier,
    name: dossier.name || "Test solution",
    accountableOwner: dossier.accountableOwner || "Test owner"
  });
  return { dossier: completedDossier, resolutions: createIntakeResolutionDraft(completedDossier, run.solutionProfile), approval: { confirmed: true, actorRef: "TEST_USER" } };
}

function completeHumanClassifications() {
  return Object.fromEntries(INTAKE_QUESTIONNAIRE.questions.map((question) => [question.id, {
    answerState: question.id === "AI_SYSTEM_QUALIFICATION" ? "YES" : question.type === "MULTI" ? "NO" : question.options.includes("NOT_APPLICABLE") ? "NOT_APPLICABLE" : "NO",
    values: question.type === "MULTI" ? ["NONE_OF_THE_ABOVE"] : [], origin: "HUMAN_CLASSIFIED", supportStatus: "SUPPORTED",
    confirmedBy: "AUTHORIZED_REVIEWER", confirmedAt: "2026-08-05T08:00:00.000Z"
  }]));
}

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

test("explicitly labelled documentation populates deterministic Intake facts with source provenance", () => {
  const profile = discoverSolutionProfile([{ id: "unit-profile", path: "case-profile.md", artifactClass: "DOCUMENTATION", content: `
Solution name: Claims Assistant
Intended purpose: Help authorized reviewers summarize insurance claims
Current lifecycle stage: Qualification and Registration
Target lifecycle stage: Verification and Validation
Data categories: Synthetic, personal data
Personal data: Yes
Special category data: No
Current user access: Internal only
Intended user access: Controlled external pilot
Production access: No
Uses agents: Yes
Can take actions: No
Human override: Yes
Operating environment: Isolated sandbox
AI system qualification: Yes
Regulatory roles: Provider, Deployer` }]);

  assert.equal(profile.suggestedDossier.name, "Claims Assistant");
  assert.equal(profile.suggestedDossier.currentStage, "QUALIFICATION_AND_REGISTRATION");
  assert.equal(profile.suggestedDossier.targetStage, "VERIFICATION_AND_VALIDATION");
  assert.deepEqual(profile.suggestedDossier.data.categories, ["SYNTHETIC", "PERSONAL_DATA"]);
  assert.equal(profile.suggestedDossier.data.personalData, true);
  assert.equal(profile.suggestedDossier.data.specialCategoryData, false);
  assert.equal(profile.suggestedDossier.exposure.currentUserAccess, "INTERNAL_ONLY");
  assert.equal(profile.suggestedDossier.exposure.intendedUserAccess, "CONTROLLED_EXTERNAL_PILOT");
  assert.equal(profile.suggestedDossier.operatingBoundary.environment, "ISOLATED_SANDBOX");
  for (const field of ["name", "intendedPurpose", "currentStage", "targetStage", "data.categories", "data.personalData", "exposure.currentUserAccess", "agent.usesAgents", "operatingBoundary.environment"]) {
    assert.equal(profile.fields[field].factClass, "OBSERVED", field);
    assert.deepEqual(profile.fields[field].sourceUnitIds, ["unit-profile"], field);
  }
  assert.equal(profile.assessmentIntakeFacts.AI_SYSTEM_QUALIFICATION.origin, "OBSERVED");
  assert.equal(profile.assessmentIntakeFacts.AI_SYSTEM_QUALIFICATION.supportStatus, "PARTIAL");
  assert.deepEqual(profile.assessmentIntakeFacts.REGULATORY_ROLES.sourceUnitIds, ["unit-profile"]);
});

test("deterministic Intake discovery rejects narrative, code labels and non-canonical enum values", () => {
  const profile = discoverSolutionProfile([
    { id: "unit-narrative", path: "overview.md", artifactClass: "DOCUMENTATION", content: "The intended purpose could eventually be public access, but this has not been agreed." },
    { id: "unit-code", path: "src/config.js", artifactClass: "PRODUCTION_CODE", content: "// Intended purpose: Approve customer claims\n// Personal data: Yes\n// Current user access: Public" },
    { id: "unit-invalid", path: "status.md", artifactClass: "DOCUMENTATION", content: "Current user access: Internal only during pilot\nProduction access: Not decided\nAI system qualification: Probably" }
  ]);

  assert.equal(profile.fields.intendedPurpose.status, "UNKNOWN");
  assert.equal(profile.fields["data.personalData"].status, "UNKNOWN");
  assert.equal(profile.fields["exposure.currentUserAccess"].status, "UNKNOWN");
  assert.equal(profile.fields["exposure.productionAccess"].status, "UNKNOWN");
  assert.equal(profile.assessmentIntakeFacts.AI_SYSTEM_QUALIFICATION.answerState, "UNKNOWN");
});

test("conflicting labelled Intake entries remain unresolved and retain all candidates", () => {
  const profile = discoverSolutionProfile([
    { id: "unit-a", path: "owner-a.md", artifactClass: "DOCUMENTATION", content: "Accountable owner: Product Team" },
    { id: "unit-b", path: "owner-b.md", artifactClass: "DOCUMENTATION", content: "Accountable owner: Risk Team" }
  ]);

  assert.equal(profile.suggestedDossier.accountableOwner, "");
  assert.equal(profile.fields.accountableOwner.status, "CONFLICTING");
  assert.deepEqual(profile.fields.accountableOwner.candidates.map((candidate) => candidate.value), ["Product Team", "Risk Team"]);
  assert.deepEqual(profile.contradictions[0].sourceUnitIds, ["unit-a", "unit-b"]);
});

test("ambiguous labelled options and overlapping category names fail closed", () => {
  const profile = discoverSolutionProfile([{ id: "unit-ambiguous", path: "template.md", artifactClass: "DOCUMENTATION", content: `
AI system qualification: YES / NO / UNKNOWN
Prohibited practice categories: NONE_OF_THE_ABOVE, SOCIAL_SCORING
Data categories: public non-personal data` }]);
  assert.equal(profile.assessmentIntakeFacts.AI_SYSTEM_QUALIFICATION.answerState, "HUMAN_REVIEW_REQUIRED");
  assert.equal(profile.assessmentIntakeFacts.AI_SYSTEM_QUALIFICATION.supportStatus, "CONFLICTING");
  assert.equal(profile.assessmentIntakeFacts.PROHIBITED_PRACTICE_CATEGORIES.answerState, "HUMAN_REVIEW_REQUIRED");
  assert.deepEqual(profile.suggestedDossier.data.categories, ["PUBLIC_NON_PERSONAL"]);
  for (const value of ["UNKNOWN, NONE_OF_THE_ABOVE", "UNKNOWN, SOCIAL_SCORING"]) {
    const exclusive = discoverSolutionProfile([{ id: `unit-${value}`, path: "exclusive.md", artifactClass: "DOCUMENTATION", content: `Prohibited practice categories: ${value}` }]);
    assert.equal(exclusive.assessmentIntakeFacts.PROHIBITED_PRACTICE_CATEGORIES.answerState, "HUMAN_REVIEW_REQUIRED", value);
    assert.equal(exclusive.assessmentIntakeFacts.PROHIBITED_PRACTICE_CATEGORIES.supportStatus, "CONFLICTING", value);
  }
});

test("conflicting solution names do not depend on source upload order", () => {
  const sources = [
    { id: "unit-package", path: "packages/worker/package.json", artifactClass: "CONFIGURATION", content: JSON.stringify({ name: "worker-service" }) },
    { id: "unit-readme", path: "README.md", artifactClass: "DOCUMENTATION", content: "# Governance Workspace" }
  ];
  for (const ordered of [sources, [...sources].reverse()]) {
    const profile = discoverSolutionProfile(ordered);
    assert.equal(profile.fields.name.status, "CONFLICTING");
    assert.deepEqual(new Set(profile.fields.name.candidates.map((item) => item.value)), new Set(["worker-service", "Governance Workspace"]));
  }
});

test("a Self-Declared boundary expiry activates the Verification and Validation cap", () => {
  const dossier = validateDossier({ ...structuredClone(SAMPLE_REQUEST.dossier), targetStage: "DEPLOYMENT", operatingBoundary: { ...structuredClone(SAMPLE_REQUEST.dossier.operatingBoundary), expiresAt: "2027-12-31" } });
  const profile = discoverSolutionProfile([], dossier, { "operatingBoundary.expiresAt": { userEdited: true } });
  const readiness = buildDocumentationReadiness(profile, dossier.targetStage);
  assert.ok(readiness.selfDeclaredIntakeFields.includes("operatingBoundary.expiresAt"));
  assert.equal(readiness.maximumLifecycleStage, "VERIFICATION_AND_VALIDATION");
  assert.equal(readiness.selfDeclarationGateRequired, true);
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
  assert.equal(run.localSourceUnits[0].evidenceKind, "CONFIGURATION");
  assert.equal(run.packets[0].sourceUnits[0].evidenceKind, "CODE_SUMMARY");
  assert.equal(run.sourceIngestion.items[0].egressPolicy, "DETERMINISTIC_SUMMARY_ONLY");
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
  const control = result.domains.flatMap((domain) => domain.controls).find((item) => item.controlId === "CTRL-D3");
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

test("client-asserted questionnaire provenance cannot clear the deployment boundary", async () => {
  const input = sampleRequest();
  input.dossier.targetStage = "DEPLOYMENT";
  input.dossier.intakeAnswers = completeHumanClassifications();
  input.sources = [
    { path: "governance/case-profile.md", kind: "DOCUMENT", content: documentedProfile(input.dossier) },
    { path: "src/assistant.js", kind: "CODE", content: "export function answer(question) { return { question, requiresHumanReview: true }; }" }
  ];
  const result = await assessSolution(input);
  assert.equal(result.documentationReadiness.deploymentReady, false);
  assert.ok(result.documentationReadiness.selfDeclaredQuestionIds.length > 0);
  assert.ok(result.hardGates.some((item) => item.code === "SELF_DECLARED_INTAKE_BOUNDARY"));
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
  assert.doesNotMatch(screened.sourceUnits[0].content, /answer internal questions/i);
  assert.match(screened.localSourceUnits.map((unit) => unit.content).join("\n"), /answer internal questions/i);
  const run = await createPreflight({ sources });
  assert.equal(run.status, "AWAITING_INTAKE_CONFIRMATION");
  await confirmPreflightDossier(run, approvedInput(run, sampleRequest().dossier));
  assert.equal(run.status, "AWAITING_TRANSMISSION_APPROVAL");
  assert.ok(run.registeredSources.some((item) => item.path === "intended-use-dossier.json"));
});

test("confirming empty Intake defaults does not manufacture Self-Declared edits", async () => {
  const run = await createPreflight({ sources: [{ path: "case.md", mimeType: "text/markdown", encoding: "utf8", content: "# Intake case" }] });
  const dossier = validateDossier(run.solutionProfile.suggestedDossier);
  await confirmPreflightDossier(run, approvedInput(run, dossier));
  assert.notEqual(run.solutionProfile.fields["operatingBoundary.allowedUses"].factClass, "SELF_DECLARED");
  assert.notEqual(run.solutionProfile.fields["data.categories"].factClass, "SELF_DECLARED");
  assert.notEqual(run.solutionProfile.fields["operatingBoundary.environment"].factClass, "SELF_DECLARED");
  assert.notEqual(run.solutionProfile.fields["exposure.currentUserAccess"].factClass, "SELF_DECLARED");
  assert.equal(run.solutionProfile.fields["exposure.currentUserAccess"].status, "UNKNOWN");
});

test("a changed questionnaire answer cannot retain observed provenance from the client", async () => {
  const run = await createPreflight({ sources: [{ path: "case.md", mimeType: "text/markdown", encoding: "utf8", content: "Regulatory roles: Provider" }] });
  const dossier = validateDossier(run.solutionProfile.suggestedDossier);
  dossier.intakeAnswers.REGULATORY_ROLES = {
    ...dossier.intakeAnswers.REGULATORY_ROLES,
    answerState: "YES", values: ["DEPLOYER"], origin: "OBSERVED", supportStatus: "SUPPORTED"
  };
  await confirmPreflightDossier(run, approvedInput(run, dossier));
  const answer = run.solutionProfile.assessmentIntakeFacts.REGULATORY_ROLES;
  assert.equal(answer.origin, "SELF_DECLARED");
  assert.equal(answer.supportStatus, "CONFLICTING");
  assert.ok(answer.sourceUnitIds.length > 0);
  assert.deepEqual(answer.candidates.map((item) => item.values), [["DEPLOYER"], ["PROVIDER"]]);
});

test("confirmation stamps an unchanged observed questionnaire answer on the server", async () => {
  const run = await createPreflight({ sources: [{ path: "case.md", mimeType: "text/markdown", encoding: "utf8", content: "AI system qualification: Yes" }] });
  const dossier = validateDossier(run.solutionProfile.suggestedDossier);
  await confirmPreflightDossier(run, approvedInput(run, dossier));
  const answer = run.solutionProfile.assessmentIntakeFacts.AI_SYSTEM_QUALIFICATION;
  assert.equal(answer.origin, "OBSERVED");
  assert.equal(answer.confirmedBy, "USER");
  assert.ok(answer.confirmedAt);
});

test("Intake confirmation cannot race an in-progress AI verification", async () => {
  const run = await createPreflight({ sources: [{ path: "case.md", mimeType: "text/markdown", encoding: "utf8", content: "# Intake case" }] });
  run.stage = "INTAKE_AI_VERIFICATION_IN_PROGRESS";
  await assert.rejects(() => confirmPreflightDossier(run, { dossier: run.solutionProfile.suggestedDossier }), /verification is in progress/i);
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
