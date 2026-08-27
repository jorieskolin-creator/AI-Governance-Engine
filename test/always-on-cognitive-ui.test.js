import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
const index = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
const server = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
const railway = JSON.parse(await readFile(new URL("../railway.json", import.meta.url), "utf8"));

test("the browser assessment workflow starts and waits for the cognitive run", () => {
  assert.match(app, /\/api\/v2\/runs\/preflight/);
  assert.match(app, /\/api\/v2\/runs\/\$\{encodeURIComponent\(activeRunId\)\}\/discover-recheck/);
  assert.match(app, /\/api\/v2\/runs\/\$\{encodeURIComponent\(activeRunId\)\}\/confirm/);
  assert.match(app, /\/api\/v2\/runs\/\$\{encodeURIComponent\(activeRunId\)\}\/execute/);
  assert.match(app, /waitForRun\(activeRunId\)/);
  assert.doesNotMatch(app, /fetch\("\/api\/assess"/);
});

test("GenAI Intake proposals are optional and require an explicit safe-summary request", () => {
  assert.match(index, /id="request-ai-proposals"[^>]*>Request GenAI Proposals from Safe Summaries/);
  assert.match(app, /request-ai-proposals[^\n]+addEventListener\("click", requestAiProposals\)/);
  assert.match(app, /purpose: "INTAKE_PROPOSALS_FROM_SAFE_SUMMARIES"/);
  assert.match(app, /acquiredFactPackageHash: latestDiscoveryContext\.acquiredFacts\.packageHash/);
  assert.match(app, /selectedAcquiredFactIds/);
  assert.match(app, /Free text, unknowns, conflicts and unsupported values cannot be selected/);
  assert.match(app, /Review safe package available for optional GenAI proposals/);
  assert.match(app, /GenAI proposal route unavailable/);
  assert.match(app, /no configured Solution Understanding model route has an available credential/);
  assert.match(app, /proposalProviders\.length === 0/);
  assert.match(app, /profile\.stage === "SOLUTION_UNDERSTANDING" && profile\.credentialAvailable/);
  assert.match(app, /profile\.stage === "RETRIEVAL_PLANNING" && profile\.credentialAvailable/);
  assert.match(server, /acquisitionAssistancePolicy\(\)/);
  assert.match(server, /automaticApproval\(run, assistancePolicy, "SOLUTION_UNDERSTANDING"\)/);
  assert.match(app, /Raw documents, code, table values and image pixels remain local/);
  assert.doesNotMatch(app, /Deterministic Intake complete\. Running cited AI verification/);
  assert.match(server, /Explicit confirmation is required before requesting GenAI Intake proposals/);
  assert.match(server, /status: "NOT_REQUESTED"/);
  assert.match(server, /stage: "INTAKE_AI_PROPOSAL_CONSENT", status: "CONFIRMED"/);
});

test("acquisition diagnostics distinguish technical loss from source silence", () => {
  assert.match(app, /Evidence acquisition diagnostics/);
  assert.match(app, /content-extracted/);
  assert.match(app, /Intake-useful/);
  assert.match(app, /Technical loss:/);
  assert.match(app, /partially extracted/);
  assert.match(app, /unavailable/);
  assert.match(app, /Genuine source silence:/);
  assert.match(app, /Review .* source ingestion exception/);
  assert.match(app, /source-level limitations do not automatically apply to every Intake field/);
});

test("retrieval suggestions and local candidates have separate explicit UI authority boundaries", () => {
  assert.match(index, /id="request-retrieval-plan"[^>]*>Request Retrieval Suggestions/);
  assert.match(index, /id="execute-local-reread"[^>]*>Run One Local Re-read/);
  assert.match(app, /window\.confirm\(`Request suggestion-only retrieval planning/);
  assert.match(app, /purpose: "INTAKE_RETRIEVAL_PLANNING_FROM_SAFE_METRICS"/);
  assert.match(app, /window\.confirm\("Run exactly one bounded local re-read/);
  assert.match(app, /purpose: "EXECUTE_VALIDATED_RETRIEVAL_PLAN_LOCALLY"/);
  assert.match(app, /Retrieval suggestions are not evidence, field values, classifications, findings, or approvals/);
  assert.match(server, /lost its process-local evidence during a service restart or worker transition/);
  assert.match(app, /Results are validated candidates—not approved Intake/);
  assert.match(app, /Use candidate/);
  assert.match(app, /Decline candidate/);
  assert.match(app, /No option is preselected/);
  assert.match(app, /USER_ACCEPTED_ACQUIRED_CANDIDATE/);
  assert.match(app, /acquiredCandidateRef/);
  assert.doesNotMatch(app, /latestSolutionProfile\.fields\[[^\]]+\]\.value\s*=/);
});

test("ZIP source containers require explicit local extraction", () => {
  assert.match(index, /ZIP archives are not opened: extract them locally and select the extracted folder/);
  assert.match(app, /ZIP archive\(s\) must be extracted locally and selected as a folder/);
  assert.match(app, /excluded or review-required before submission/);
  assert.match(app, /previewSelectedSources\(\)/);
});

test("the Intake workspace prefills AI proposals without a separate acceptance action", () => {
  assert.match(index, /id="intake-review-summary"/);
  assert.equal((index.match(/class="intake-workspace-section"/g) ?? []).length, 3);
  assert.match(app, /Review exceptions first/);
  assert.match(app, /prefillProposalOnce/);
  assert.match(app, /prefilledProposalByField/);
  assert.match(app, /prefilled only into empty fields/);
  assert.match(app, /editable or removable/);
  assert.match(app, /editedProposalRef/);
  assert.match(app, /declinedProposalRef/);
  assert.match(app, /applyProposalToIntake/);
  assert.match(app, /field\.questionId/);
  assert.match(app, /Self-Declared · changed by user · V&V lifecycle cap applies/);
  assert.doesNotMatch(app, /Accept proposal/);
  assert.doesNotMatch(app, /Decline proposal/);
  assert.doesNotMatch(app, /latestSolutionProfile\.fields\[[^\]]+\]\.value\s*=/);
});

test("final Intake approval requires only solution identity and makes evidence gaps explicit", () => {
  assert.match(index, /Solution name · required/);
  assert.match(index, /Accountable owner · required/);
  assert.match(index, /id="intake-approval-dialog"/);
  assert.match(index, />Go back<\/button>/);
  assert.match(index, />Accept and Continue to Analysis<\/button>/);
  assert.match(app, /field\.requirement\?\.analysis === "VALUE_REQUIRED"/);
  assert.match(app, /remain empty or unresolved/);
  assert.match(app, /Analysis will treat them as evidence limitations/);
  assert.match(app, /All applicable Intake fields are filled/);
  assert.doesNotMatch(app, /explanation\.required/);
  assert.doesNotMatch(app, /resolutionState = "CONFLICT_REQUIRES_RESOLUTION"/);
  assert.match(app, /currentRun\.stage !== "INTAKE_CONFIRMED"/);
  assert.match(app, /Model readiness:/);
});

test("local re-read is hidden once Intake proposals have been requested", () => {
  assert.match(app, /context\?\.stage === "DETERMINISTIC_DISCOVERY_COMPLETED"/);
  assert.match(app, /&& !context\?\.recheck/);
  assert.match(app, /latestDiscoveryContext\?\.recheck \|\| latestDiscoveryContext\?\.stage !== "DETERMINISTIC_DISCOVERY_COMPLETED"/);
  assert.match(server, /Local re-read must be completed before requesting GenAI Intake proposals/);
});

test("the service exposes an always-on cognitive contract without client credentials", () => {
  assert.match(server, /cognitiveMode: "ALWAYS_ON"/);
  assert.match(server, /function automaticApproval/);
  assert.match(server, /A user-approved immutable Intake snapshot is required before execution/);
  assert.match(server, /url\.pathname === "\/api\/assess"[\s\S]*?sendJson\(response, 410/);
  assert.doesNotMatch(server, /COGNITIVE_PIPELINE_ENABLED/);
  assert.doesNotMatch(server, /COGNITIVE_API_TOKEN/);
  assert.match(server, /cognitiveReadiness: modelPolicyReadiness\(policy\)/);
});

test("the Railway deployment always enforces production policy", () => {
  assert.match(railway.deploy.startCommand, /(?:^|\s)NODE_ENV=production(?:\s|$)/);
});

test("asynchronous provider failures expose a stable limitation instead of provider detail", () => {
  assert.match(server, /const failure = classifyCognitiveFailure\(error\)/);
  assert.match(server, /run\.failureCode = failure\.code/);
  assert.match(server, /run\.retryDisposition = failure\.retryDisposition/);
  assert.match(server, /"Cognitive analysis could not complete safely\."/);
  assert.doesNotMatch(server, /run\.error = process\.env\.NODE_ENV/);
});
