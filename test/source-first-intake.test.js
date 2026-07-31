import test from "node:test";
import assert from "node:assert/strict";
import { assessSolution } from "../src/engine.js";
import { SAMPLE_REQUEST } from "../src/sample.js";
import { createPreflight, confirmPreflightDossier } from "../src/cognitive/preflight.js";
import { parseAndScreenSources } from "../src/cognitive/source-intake.js";
import { jurisdictionScope } from "../src/core/jurisdictions.js";

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
