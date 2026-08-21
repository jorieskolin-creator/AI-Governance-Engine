import test from "node:test";
import assert from "node:assert/strict";
import { createGovernanceClaim } from "../src/cognitive/contracts.js";
import {
  buildAssessmentCoverageMatrix, consolidateClaims, createAdjudicatedClaim,
  evaluatePublicationGate, lockAdjudicatedClaim, validateClaimMappings, validateFactCheckCompleteness
} from "../src/cognitive/integrity.js";
import { buildActionGroundingRecords, selectPlaybookActions } from "../src/core/playbook-engine.js";
import { assessAntiPatterns } from "../src/core/assessment.js";
import { ModelBudget, StructuredModelClient } from "../src/cognitive/provider-client.js";
import { modelPolicy, requiredGovernanceProviders } from "../src/cognitive/model-policy.js";
import { cancellationError } from "../src/cognitive/failure-policy.js";

const sourceUnit = {
  id: "unit-1", sourceId: "src-1", path: "src/control.js", locator: "text;lines:1-1", sha256: "source-hash",
  content: "The system validates every privileged action.", evidenceKind: "CODE", evidenceClass: "OBSERVED", assuranceCeiling: "IMPLEMENTED"
};

const knowledge = {
  requirements: [{ id: "REQ-D3", domain: "D", title: "Security requirement", lifecycleStages: ["DESIGN_AND_DEVELOPMENT"], findingDefinitions: [{ id: "FND-D3-REQ" }] }],
  controls: [{ id: "CTRL-D3", domain: "D", title: "Action validation", lifecycleStages: ["DESIGN_AND_DEVELOPMENT"], requirementIds: ["REQ-D3"], questions: [{ id: "Q-D3" }], atomicSubcriteria: [{ id: "SC-D3" }], findingDefinitions: [{ id: "FND-D3-001" }] }],
  antipatterns: [{ id: "AP-D3", domain: "D", title: "Unvalidated action", lifecycleStages: ["DESIGN_AND_DEVELOPMENT"], relatedControlIds: ["CTRL-D3"], atomicTests: [{ id: "AT-D3" }], findingDefinitions: [{ id: "FND-AP-D3-001" }] }]
};

function claim(overrides = {}) {
  return createGovernanceClaim({
    claimType: "CONTROL_SUPPORT", statement: "Privileged actions are validated.", sourceUnitIds: [sourceUnit.id],
    evidenceQuotes: [{ sourceUnitId: sourceUnit.id, quote: "validates every privileged action" }],
    controlIds: ["CTRL-D3"], antiPatternIds: [], requirementIds: ["REQ-D3"], findingDefinitionIds: ["FND-D3-001"], assessmentObjectIds: ["SC-D3"],
    domains: ["D"], severity: "HIGH", proposedAssuranceState: "IMPLEMENTED", proposedFindingState: "NOT_SATISFIED", limitations: [], ...overrides
  }, { provider: "MOONSHOT", model: "extractor", profileId: "extractor", domain: "D" });
}

function verification(value = {}) {
  return {
    id: "verification-1", claimId: "pending", verifierProvider: "OPENAI", verifierModel: "verifier", status: "SUPPORTED",
    rationale: "The quote supports the narrow claim.", checkedSourceUnitIds: [sourceUnit.id], conflictingSourceUnitIds: [], acceptedAssuranceState: "IMPLEMENTED", ...value
  };
}

test("unsupported and unverifiable claims never become locked findings", () => {
  const candidate = claim();
  for (const status of ["UNSUPPORTED", "NOT_VERIFIABLE", "CONFLICTING"]) {
    const adjudicated = createAdjudicatedClaim(candidate, [verification({ status })], [sourceUnit], knowledge);
    const locked = lockAdjudicatedClaim(candidate, adjudicated, [sourceUnit]);
    assert.equal(adjudicated.decisionEligible, false);
    assert.equal(locked.finding, null);
    assert.equal(locked.lockRecord.status, "REJECTED");
  }
});

test("extractor and verifier cannot raise assurance above the lowest accepted ceiling", () => {
  const candidate = claim({ proposedAssuranceState: "HUMAN_VALIDATED" });
  const adjudicated = createAdjudicatedClaim(candidate, [verification({ acceptedAssuranceState: "TESTED" })], [sourceUnit], knowledge);
  const { finding } = lockAdjudicatedClaim(candidate, adjudicated, [sourceUnit]);
  assert.equal(finding.proposedAssuranceState, "IMPLEMENTED");
});

test("coverage is object-level and cannot be satisfied by one parent claim", () => {
  const dossier = { currentStage: "DESIGN_AND_DEVELOPMENT", targetStage: "DESIGN_AND_DEVELOPMENT" };
  const partial = buildAssessmentCoverageMatrix(knowledge, dossier, [claim({ assessmentObjectIds: [], findingDefinitionIds: [] })], [{ domain: "D", status: "COMPLETED" }]);
  assert.equal(partial.complete, false);
  assert.ok(partial.entries.some((item) => item.objectId === "SC-D3" && item.status === "UNKNOWN"));
  const completeClaim = claim({ antiPatternIds: ["AP-D3"], assessmentObjectIds: ["Q-D3", "SC-D3", "AT-D3"], findingDefinitionIds: ["FND-D3-REQ", "FND-D3-001", "FND-AP-D3-001"] });
  const complete = buildAssessmentCoverageMatrix(knowledge, dossier, [completeClaim], [{ domain: "D", status: "COMPLETED" }]);
  assert.equal(complete.complete, true);
});

test("a searched object with no evidence is assessed but cannot become control support", () => {
  const dossier = { currentStage: "DESIGN_AND_DEVELOPMENT", targetStage: "DESIGN_AND_DEVELOPMENT" };
  const objectIds = ["REQ-D3", "FND-D3-REQ", "CTRL-D3", "Q-D3", "SC-D3", "FND-D3-001", "AP-D3", "AT-D3", "FND-AP-D3-001"];
  const matrix = buildAssessmentCoverageMatrix(knowledge, dossier, [], [{ domain: "D", status: "COMPLETED", assessmentResults: objectIds.map((objectId) => ({ objectId, status: "NO_EVIDENCE_FOUND" })) }]);
  assert.equal(matrix.complete, true);
  assert.ok(matrix.entries.every((item) => item.status === "ASSESSED"));
  assert.ok(matrix.entries.every((item) => item.evidenceStatus === "NO_EVIDENCE_FOUND"));
});

test("the governance route requires all three server-side provider credentials", () => {
  const complete = modelPolicy({ OPENAI_API_KEY: "test", XAI_API_KEY: "test", MOONSHOT_API_KEY: "test" });
  assert.deepEqual(requiredGovernanceProviders(complete).sort(), ["MOONSHOT", "OPENAI", "XAI"]);
  assert.throws(() => requiredGovernanceProviders(modelPolicy({ OPENAI_API_KEY: "test", MOONSHOT_API_KEY: "test" })), /XAI/i);
});

test("cross-domain claim consolidation preserves a contradiction graph", () => {
  const support = claim();
  const risk = claim({ claimType: "RISK", statement: "Privileged actions are not validated.", domains: ["D", "F"] });
  const result = consolidateClaims([support, risk, support]);
  assert.equal(result.claims.length, 2);
  assert.equal(result.contradictionGraph.length, 1);
  assert.deepEqual(result.contradictionGraph[0].domains, ["D", "F"]);
});

test("tactics require exact approved finding-definition mappings", () => {
  const finding = { id: "finding-1", statement: "Action validation is incomplete.", findingDefinitionIds: ["FND-D3-001"], evidenceLinks: [{ id: "link-1" }] };
  const exact = { id: "TACTIC-1", version: "1.0.0", status: "APPROVED", title: "Validate actions", eligibleFindingIds: ["FND-D3-001"], findingSignals: [], ownerRoles: ["SECURITY"], activities: [], requiredArtifacts: [], acceptanceCriteria: [], verification: [], blocksTransition: "DEPLOYMENT", completionEffect: "NEW_EVIDENCE_AND_REASSESSMENT_REQUIRED" };
  const signalOnly = { ...exact, id: "TACTIC-2", eligibleFindingIds: [], findingSignals: ["generic-security-gap"] };
  const actions = selectPlaybookActions([signalOnly, exact], [finding]);
  assert.equal(actions.length, 1);
  assert.equal(actions[0].tacticId, "TACTIC-1");
  assert.equal(buildActionGroundingRecords(actions, [finding], [exact])[0].status, "GROUNDED");
});

test("finding-definition states and prohibited inferences are enforced deterministically", () => {
  const constrained = structuredClone(knowledge);
  constrained.controls[0].authoringObjectId = "D3";
  constrained.controls[0].findingDefinitions[0] = { id: "FND-D3-001", assessment_object_id: "D3", eligible_states: ["NOT_SATISFIED"] };
  constrained.controls[0].prohibitedInferences = ["The provider is certified, therefore the integrated system is resilient."];
  const wrongState = claim({ assessmentObjectIds: ["D3"], proposedFindingState: "SATISFIED" });
  assert.ok(validateClaimMappings(wrongState, constrained).issues.some((item) => /does not permit/i.test(item)));
  const prohibited = claim({ statement: "The provider is certified, therefore the integrated system is resilient.", assessmentObjectIds: ["D3"] });
  assert.ok(validateClaimMappings(prohibited, constrained).issues.some((item) => /prohibited/i.test(item)));
});

test("TESTED_ABSENT requires an explicit scoped successful test record", () => {
  const antiPatterns = [{ id: "AP-D3", domain: "D", title: "Unsafe action", severity: "HIGH", relatedControlIds: ["CTRL-D3"] }];
  const base = { id: "evidence-1", antiPatternIds: ["AP-D3"], polarity: "ABSENCE_TEST", stale: false, assuranceState: "TESTED", metadata: {} };
  const controls = [{ controlId: "CTRL-D3", meetsTarget: true }];
  assert.equal(assessAntiPatterns(antiPatterns, [base], controls)[0].state, "UNKNOWN");
  const explicit = { ...base, metadata: { absenceTest: { scope: "All action endpoints", method: "Negative authorization suite", executedAt: "2026-07-31", systemVersion: "abc123", result: "PASSED", limitations: ["Staging only"] } } };
  assert.equal(assessAntiPatterns(antiPatterns, [explicit], controls)[0].state, "TESTED_ABSENT");
});

test("fact-check completeness rejects missing, duplicate, unknown and inconsistent results", () => {
  const synthesis = { items: [{ id: "n1", supportStatus: "PENDING_FACT_CHECK" }, { id: "n2", supportStatus: "PENDING_FACT_CHECK" }] };
  const invalid = validateFactCheckCompleteness(synthesis, { supported: true, itemResults: [{ itemId: "n1", status: "SUPPORTED" }, { itemId: "n1", status: "SUPPORTED" }, { itemId: "other", status: "SUPPORTED" }] });
  assert.equal(invalid.valid, false);
  assert.deepEqual(invalid.missing, ["n2"]);
  const valid = validateFactCheckCompleteness(synthesis, { supported: true, itemResults: [{ itemId: "n1", status: "SUPPORTED" }, { itemId: "n2", status: "SUPPORTED" }] });
  assert.equal(valid.valid, true);
});

test("publication quality remains independent from readiness", () => {
  const gate = evaluatePublicationGate({ coverageMatrix: { complete: false }, findingLockRecords: [], unresolvedClaims: [{ severity: "HIGH" }], factCheckIntegrity: { valid: true }, narrative: { items: [] }, actionGroundingRecords: [], integrityIncidents: [], reanalysisTrace: [] });
  assert.equal(gate.status, "REPORT_WITH_LIMITATIONS");
  assert.equal(gate.readinessIndependent, true);
});

test("provider responses from an unapproved model are rejected and traced", async () => {
  const policy = modelPolicy({ OPENAI_API_KEY: "test", NODE_ENV: "development" });
  const profile = policy.choose("VERIFICATION");
  const schema = { type: "object", additionalProperties: false, required: ["ok"], properties: { ok: { type: "boolean" } } };
  const client = new StructuredModelClient({ policy, budget: new ModelBudget({ maxCalls: 2, maxTokens: 100000 }), transport: async () => ({ value: { ok: true }, responseModel: "different-unapproved-model", usage: { totalTokens: 1 } }) });
  await assert.rejects(() => client.generate({ profile, prompt: "test", schemaName: "model_identity", schema, packetHash: "hash", promptVersion: "1" }), /unapproved model/i);
  assert.equal(client.traces[0].status, "FAILED");
  assert.match(client.traces[0].requestId, /^model-request-/);
});

test("provider cancellation is propagated and classified without retry", async () => {
  const policy = modelPolicy({ OPENAI_API_KEY: "test", NODE_ENV: "development" });
  const profile = policy.choose("VERIFICATION");
  const schema = { type: "object", additionalProperties: false, required: ["ok"], properties: { ok: { type: "boolean" } } };
  const controller = new AbortController();
  let calls = 0;
  const client = new StructuredModelClient({
    policy,
    signal: controller.signal,
    budget: new ModelBudget({ maxCalls: 2, maxTokens: 100000 }),
    transport: async () => {
      calls += 1;
      controller.abort(cancellationError("cancel test"));
      return { value: { ok: true }, responseModel: profile.model, usage: { totalTokens: 1 } };
    }
  });
  await assert.rejects(client.generate({ profile, prompt: "test", schemaName: "cancel", schema, packetHash: "hash", promptVersion: "1" }), /cancel test/i);
  assert.equal(calls, 1);
  assert.equal(client.traces[0].failureCode, "RUN_CANCELLED");
  assert.equal(client.traces[0].retryDisposition, "DO_NOT_RETRY");
});

test("per-stage model-call budgets fail closed", async () => {
  const policy = modelPolicy({ OPENAI_API_KEY: "test", NODE_ENV: "development" });
  const profile = policy.choose("VERIFICATION");
  const schema = { type: "object", additionalProperties: false, required: ["ok"], properties: { ok: { type: "boolean" } } };
  const budget = new ModelBudget({ maxCalls: 5, maxTokens: 100000, maxCallsByStage: { VERIFICATION: 1 } });
  const client = new StructuredModelClient({ policy, budget, transport: async () => ({ value: { ok: true }, responseModel: profile.model, usage: { totalTokens: 1 } }) });
  await client.generate({ profile, prompt: "first", schemaName: "budget", schema, packetHash: "1", promptVersion: "1" });
  await assert.rejects(() => client.generate({ profile, prompt: "second", schemaName: "budget", schema, packetHash: "2", promptVersion: "1" }), /budget exhausted for VERIFICATION/i);
  assert.equal(budget.view().callsByStage.VERIFICATION, 1);
});
