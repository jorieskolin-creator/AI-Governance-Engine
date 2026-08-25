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

const policy = () => modelPolicy({ MOONSHOT_API_KEY: "test" });

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

  const result = await planIntakeRetrieval(run, consent(run), { env: { MOONSHOT_API_KEY: "test" }, client });
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

test("planner output filters unsafe terms and restores incomplete field coverage from registered defaults", async () => {
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
  const filtered = await planIntakeRetrieval(asserted, consent(asserted), { policy: policy(), client: makeClient((suggestions) => {
    suggestions[0].searchConcepts = ["system is approved"];
    suggestions[0].sourcePriorities = ["UNREGISTERED_EVIDENCE_TYPE"];
    suggestions[0].extractionStrategies = ["UNREGISTERED_STRATEGY"];
  }) });
  assert.equal(filtered.status, "COMPLETED");
  assert.deepEqual(filtered.plan.suggestions[0].searchConcepts, []);
  assert.ok(filtered.plan.suggestions[0].sourcePriorities.every((value) => context.targetFields[0].registeredEvidenceTypes.includes(value)));
  assert.ok(filtered.plan.suggestions[0].extractionStrategies.every((value) => context.targetFields[0].registeredExtractionStrategies.includes(value)));
  assert.ok(filtered.normalization.changedSuggestionCount > 0);

  const incomplete = structuredClone(run);
  const restored = await planIntakeRetrieval(incomplete, consent(incomplete), { policy: policy(), client: makeClient((suggestions) => { suggestions.pop(); }) });
  assert.equal(restored.plan.suggestions.length, context.targetFields.length);
  assert.equal(restored.normalization.defaultedSuggestionCount, 1);
});

test("retrieval planning requires explicit consent and uses only explicitly allowed fallback providers", async () => {
  const run = await createPreflight({ sources: [{ path: "docs/architecture.md", mimeType: "text/markdown", content: "Monitoring and incident response narrative." }] });
  let calls = 0;
  const fallbackPolicy = modelPolicy({ MOONSHOT_API_KEY: "test", OPENAI_API_KEY: "test" });
  const client = new StructuredModelClient({
    policy: fallbackPolicy,
    budget: new ModelBudget({ maxCalls: 4, maxTokens: 60_000 }),
    transport: async ({ profile }) => {
      calls += 1;
      assert.equal(profile.provider, "MOONSHOT");
      throw Object.assign(new Error("Simulated provider timeout"), { name: "TimeoutError" });
    }
  });

  await assert.rejects(() => planIntakeRetrieval(run, { ...consent(run), confirmed: false }, { policy: fallbackPolicy, client }), /explicit retrieval-planning confirmation/i);
  assert.equal(calls, 0);
  await assert.rejects(() => planIntakeRetrieval(run, consent(run), { policy: fallbackPolicy, client }), /timeout/i);
  assert.equal(calls, 1);
  assert.equal(run.retrievalPlan.status, "UNAVAILABLE");
  assert.equal(run.retrievalPlan.failureCode, "PROVIDER_TIMEOUT");
  assert.equal(run.retrievalPlan.failurePhase, "PROVIDER_EXECUTION");
  assert.equal(run.trace.at(-1).failurePhase, "PROVIDER_EXECUTION");
  assert.equal(run.transmissionManifest, undefined);
  assert.doesNotMatch(JSON.stringify(run.retrievalPlan), /Simulated provider timeout/);
});

test("retrieval planning fails closed before transmission when no allowed provider has credentials", async () => {
  const run = await createPreflight({ sources: [{ path: "docs/architecture.md", mimeType: "text/markdown", content: "Monitoring and incident response narrative." }] });
  let calls = 0;
  const unavailablePolicy = modelPolicy({ OPENAI_API_KEY: "test" });
  const client = new StructuredModelClient({
    policy: unavailablePolicy,
    transport: async () => { calls += 1; throw new Error("must not transmit"); }
  });

  await assert.rejects(() => planIntakeRetrieval(run, consent(run), { policy: unavailablePolicy, client }), /provider route.*unavailable/i);
  assert.equal(calls, 0);
  assert.equal(run.retrievalPlan.status, "UNAVAILABLE");
  assert.equal(run.retrievalPlan.failureCode, "MODEL_ROUTE_UNAVAILABLE");
  assert.equal(run.retrievalPlan.failurePhase, "ROUTE_SELECTION");
  assert.deepEqual(run.acquisitionDiagnostics.genAi, { status: "UNAVAILABLE", failureCode: "MODEL_ROUTE_UNAVAILABLE" });
});
