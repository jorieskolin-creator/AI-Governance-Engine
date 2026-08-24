import test from "node:test";
import assert from "node:assert/strict";
import { createPreflight, publicPreflightView } from "../src/cognitive/preflight.js";
import { modelPolicy } from "../src/cognitive/model-policy.js";
import { ModelBudget, StructuredModelClient } from "../src/cognitive/provider-client.js";
import { serializeDurableRun } from "../src/cognitive/run-persistence.js";
import {
  createRetrievalPlannerContext,
  planIntakeRetrieval,
  RETRIEVAL_PLANNING_PURPOSE,
  validateIntakeRetrievalPlan
} from "../src/cognitive/retrieval-planner.js";

const policy = () => modelPolicy({ MOONSHOT_API_KEY: "test" }, { qualificationRequired: false });

function consent(run) {
  return {
    confirmed: true,
    purpose: RETRIEVAL_PLANNING_PURPOSE,
    gapAnalysisHash: run.intakeGapAnalysis.analysisHash,
    providers: ["MOONSHOT"]
  };
}

test("the WORKHORSE planner receives only safe metrics and returns suggestion-only output", async () => {
  const privateMarker = "synthetic-private-project-orchid";
  const run = await createPreflight({ sources: [{
    path: "private/project-orchid-architecture.html",
    mimeType: "text/html",
    content: `<h1>System overview</h1><p>${privateMarker} uses monitoring, incident handling, human oversight and an operating boundary.</p>`
  }] });
  const before = {
    candidateHash: run.intakeCandidates.packageHash,
    acquiredHash: run.acquiredFacts.packageHash,
    solutionHash: run.solutionProfile.hash
  };
  const context = createRetrievalPlannerContext(run);
  let transmittedPrompt = "";
  const client = new StructuredModelClient({
    policy: policy(),
    budget: new ModelBudget({ maxCalls: 2, maxTokens: 30_000 }),
    transport: async ({ profile, prompt, schemaName }) => {
      transmittedPrompt = prompt;
      assert.equal(profile.operationalRole, "WORKHORSE");
      assert.equal(profile.role, "RETRIEVAL_PLANNING");
      assert.equal(schemaName, "intake_retrieval_planner");
      return {
        value: { suggestions: context.targetFields.map((field) => ({
          fieldId: field.fieldId,
          searchConcepts: ["governance record"],
          labelAliases: ["documented scope"],
          sourcePriorities: [field.registeredEvidenceTypes[0]],
          extractionStrategies: [field.registeredExtractionStrategies[0]]
        })) },
        responseModel: profile.model,
        usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 }
      };
    }
  });

  const result = await planIntakeRetrieval(run, consent(run), { policy: policy(), client });
  const plan = validateIntakeRetrievalPlan(result.plan, run.intakeGapAnalysis);

  assert.equal(plan.plannerRole, "WORKHORSE");
  assert.match(plan.authority, /NO_FACT_VALUE_CLASSIFICATION_FINDING_OR_APPROVAL_AUTHORITY/);
  assert.deepEqual(Object.keys(plan.suggestions[0]).sort(), ["extractionStrategies", "fieldId", "labelAliases", "searchConcepts", "sourcePriorities"]);
  assert.match(transmittedPrompt, /safeMetrics|artifactClasses|attemptedMethods|controlledConceptSignals/);
  assert.doesNotMatch(transmittedPrompt, new RegExp(privateMarker));
  assert.doesNotMatch(transmittedPrompt, /project-orchid-architecture|private\//i);
  assert.deepEqual({ candidateHash: run.intakeCandidates.packageHash, acquiredHash: run.acquiredFacts.packageHash, solutionHash: run.solutionProfile.hash }, before);
  assert.equal(run.transmissionManifest[0].containsRawEvidence, false);
  assert.deepEqual(run.transmissionManifest[0].sourceUnitIds, []);
  assert.equal(publicPreflightView(run).retrievalPlan.plan.planHash, plan.planHash);
  const durable = serializeDurableRun(run);
  assert.equal(durable.run.retrievalPlan.plan.planHash, plan.planHash);
  assert.equal(JSON.stringify(durable).includes(privateMarker), false);

  const tampered = structuredClone(plan);
  tampered.suggestions[0].labelAliases = ["additional record"];
  assert.throws(() => validateIntakeRetrievalPlan(tampered, run.intakeGapAnalysis), /integrity check/i);
  const unsupported = structuredClone(plan);
  unsupported.suggestions[0].sourcePriorities = ["UNREGISTERED_EVIDENCE_TYPE"];
  assert.throws(() => validateIntakeRetrievalPlan(unsupported, run.intakeGapAnalysis), /source priorities/i);
});

test("planner output cannot carry field values, conclusions, or incomplete field coverage", async () => {
  const run = await createPreflight({ sources: [{
    path: "docs/architecture.md",
    mimeType: "text/markdown",
    content: "Monitoring and human oversight are discussed in this generic architecture narrative."
  }] });
  const context = createRetrievalPlannerContext(run);
  const makeClient = (mutate) => new StructuredModelClient({
    policy: policy(),
    budget: new ModelBudget({ maxCalls: 2, maxTokens: 30_000 }),
    transport: async ({ profile }) => {
      const suggestions = context.targetFields.map((field) => ({
        fieldId: field.fieldId,
        searchConcepts: ["governance record"],
        labelAliases: ["oversight record"],
        sourcePriorities: [field.registeredEvidenceTypes[0]],
        extractionStrategies: [field.registeredExtractionStrategies[0]]
      }));
      mutate(suggestions);
      return { value: { suggestions }, responseModel: profile.model, usage: { totalTokens: 10 } };
    }
  });

  const asserted = structuredClone(run);
  await assert.rejects(() => planIntakeRetrieval(asserted, consent(asserted), { policy: policy(), client: makeClient((suggestions) => { suggestions[0].searchConcepts = ["system is approved"]; }) }), /value-like|unsafe/i);
  assert.equal(asserted.retrievalPlan.status, "UNAVAILABLE");

  const incomplete = structuredClone(run);
  await assert.rejects(() => planIntakeRetrieval(incomplete, consent(incomplete), { policy: policy(), client: makeClient((suggestions) => { suggestions.pop(); }) }), /field coverage is incomplete/i);
  assert.equal(incomplete.retrievalPlan.status, "UNAVAILABLE");
});

test("retrieval planning requires explicit consent and never replays a timeout through another provider", async () => {
  const run = await createPreflight({ sources: [{ path: "docs/architecture.md", mimeType: "text/markdown", content: "Monitoring and incident response narrative." }] });
  let calls = 0;
  const client = new StructuredModelClient({
    policy: policy(),
    budget: new ModelBudget({ maxCalls: 2, maxTokens: 30_000 }),
    transport: async ({ profile }) => {
      calls += 1;
      assert.equal(profile.provider, "MOONSHOT");
      throw Object.assign(new Error("Simulated provider timeout"), { name: "TimeoutError" });
    }
  });

  await assert.rejects(() => planIntakeRetrieval(run, { ...consent(run), confirmed: false }, { policy: policy(), client }), /explicit retrieval-planning confirmation/i);
  assert.equal(calls, 0);
  await assert.rejects(() => planIntakeRetrieval(run, consent(run), { policy: policy(), client }), /timeout/i);
  assert.equal(calls, 1);
  assert.equal(run.retrievalPlan.status, "UNAVAILABLE");
  assert.equal(run.retrievalPlan.failureCode, "PROVIDER_TIMEOUT");
  assert.equal(run.transmissionManifest, undefined);
  assert.doesNotMatch(JSON.stringify(run.retrievalPlan), /Simulated provider timeout/);
});

test("an unavailable qualified WORKHORSE route fails closed before transmission", async () => {
  const run = await createPreflight({ sources: [{ path: "docs/architecture.md", mimeType: "text/markdown", content: "Monitoring and incident response narrative." }] });
  let calls = 0;
  const unqualifiedPolicy = modelPolicy({ MOONSHOT_API_KEY: "test" });
  const client = new StructuredModelClient({
    policy: unqualifiedPolicy,
    transport: async () => { calls += 1; throw new Error("must not transmit"); }
  });

  await assert.rejects(() => planIntakeRetrieval(run, consent(run), { policy: unqualifiedPolicy, client }), /approved model profile/i);
  assert.equal(calls, 0);
  assert.equal(run.retrievalPlan.status, "UNAVAILABLE");
  assert.equal(run.retrievalPlan.failureCode, "MODEL_ROUTE_UNAVAILABLE");
  assert.deepEqual(run.acquisitionDiagnostics.genAi, { status: "UNAVAILABLE", failureCode: "MODEL_ROUTE_UNAVAILABLE" });
});
