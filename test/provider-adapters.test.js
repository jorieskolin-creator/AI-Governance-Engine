import test from "node:test";
import assert from "node:assert/strict";
import { acquisitionAssistancePolicy, COGNITIVE_PROVIDERS, modelPolicy, modelPolicyReadiness, publicModelRoleSlots, requiredGovernanceProviders, validateGovernanceRouteTopology } from "../src/cognitive/model-policy.js";
import {
  normalizeProviderResponse, providerAdapter, serializeProviderRequest
} from "../src/cognitive/provider-adapters.js";
import { ModelBudget, StructuredModelClient } from "../src/cognitive/provider-client.js";

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["ok"],
  properties: { ok: { type: "boolean" } }
};

const credentials = {
  OPENAI_API_KEY: "openai-test-secret",
  XAI_API_KEY: "xai-test-secret",
  MOONSHOT_API_KEY: "moonshot-test-secret"
};
const candidatePolicy = (env) => modelPolicy(env);

test("the canonical provider catalog contains only OpenAI, xAI and Moonshot", () => {
  assert.deepEqual([...COGNITIVE_PROVIDERS].sort(), ["MOONSHOT", "OPENAI", "XAI"]);
  assert.ok(COGNITIVE_PROVIDERS.every((provider) => providerAdapter(provider).capabilities.imageInput === false));
  assert.throws(() => providerAdapter("LEGACY_PROVIDER"), /unsupported cognitive provider/i);
});

test("role routing is deterministic and model identities are server-configurable", () => {
  const policy = candidatePolicy({
    ...credentials,
    WORKHORSE_PROVIDER: "OPENAI", WORKHORSE_MODEL: "openai-workhorse",
    WORKHORSE_FALLBACK_PROVIDER: "MOONSHOT", WORKHORSE_FALLBACK_MODEL: "moonshot-workhorse",
    REASONER_PROVIDER: "XAI", REASONER_MODEL: "xai-reasoner",
    REASONER_FALLBACK_PROVIDER: "OPENAI", REASONER_FALLBACK_MODEL: "openai-reasoner",
    QUALITY_CHECKER_PROVIDER: "MOONSHOT", QUALITY_CHECKER_MODEL: "moonshot-quality",
    QUALITY_CHECKER_FALLBACK_PROVIDER: "OPENAI", QUALITY_CHECKER_FALLBACK_MODEL: "openai-quality"
  });
  assert.deepEqual([
    policy.choose("ROUTING"),
    policy.choose("DOMAIN_ASSESSMENT"),
    policy.choose("SOLUTION_UNDERSTANDING"),
    policy.choose("SYNTHESIS"),
    policy.choose("VERIFICATION"),
    policy.choose("FACT_CHECK")
  ].map((profile) => [profile.operationalRole, profile.provider, profile.model]), [
    ["WORKHORSE", "OPENAI", "openai-workhorse"],
    ["WORKHORSE", "OPENAI", "openai-workhorse"],
    ["REASONER", "XAI", "xai-reasoner"],
    ["REASONER", "XAI", "xai-reasoner"],
    ["QUALITY_CHECKER", "MOONSHOT", "moonshot-quality"],
    ["QUALITY_CHECKER", "MOONSHOT", "moonshot-quality"]
  ]);
  assert.equal(policy.choose("VERIFICATION", { excludeProviders: ["MOONSHOT"] }).model, "openai-quality");
  assert.ok(policy.candidates("VERIFICATION", { excludeProviders: ["MOONSHOT"] }).every((profile) => profile.provider !== "MOONSHOT"));
  assert.throws(() => modelPolicy({ ...credentials, WORKHORSE_PROVIDER: "OPENAI" }), /configured together/i);
  const slots = publicModelRoleSlots(policy);
  assert.equal(slots.length, 6);
  assert.deepEqual(slots.find((slot) => slot.operationalRole === "WORKHORSE" && slot.routePriority === "PRIMARY").stages, ["DOMAIN_ASSESSMENT", "RETRIEVAL_PLANNING", "ROUTING"]);
  assert.deepEqual(slots.find((slot) => slot.operationalRole === "REASONER" && slot.routePriority === "PRIMARY").stages, ["ADJUDICATION", "SOLUTION_UNDERSTANDING", "SYNTHESIS"]);
  assert.deepEqual(slots.find((slot) => slot.operationalRole === "QUALITY_CHECKER" && slot.routePriority === "PRIMARY").stages, ["FACT_CHECK", "VERIFICATION"]);
});

test("acquisition and governance execution use the same configured role contract", () => {
  const assistance = acquisitionAssistancePolicy(credentials);
  assert.equal(assistance.choose("RETRIEVAL_PLANNING").operationalRole, "WORKHORSE");
  assert.equal(assistance.choose("SOLUTION_UNDERSTANDING").operationalRole, "REASONER");
  const governance = modelPolicy(credentials);
  assert.equal(governance.choose("SOLUTION_UNDERSTANDING").id, assistance.choose("SOLUTION_UNDERSTANDING").id);
  assert.deepEqual(requiredGovernanceProviders(governance).sort(), ["MOONSHOT", "OPENAI", "XAI"]);
});

test("runtime readiness depends on credentials and an independent three-provider topology", () => {
  const configured = modelPolicy(credentials);
  assert.deepEqual(modelPolicyReadiness(configured), {
    status: "READY",
    issueCodes: [],
    credentials: { requiredProviderCount: 3, configuredProviderCount: 3 },
    roleSlots: { requiredSlotCount: 6, configuredSlotCount: 6 },
    topologyStatus: "VALID"
  });
  assert.equal(modelPolicy({ ...credentials, NODE_ENV: "development" }).choose("VERIFICATION").id, configured.choose("VERIFICATION").id);
  assert.deepEqual(modelPolicyReadiness(modelPolicy({})), {
    status: "CONFIGURATION_REQUIRED",
    issueCodes: ["MODEL_CREDENTIALS_MISSING"],
    credentials: { requiredProviderCount: 3, configuredProviderCount: 0 },
    roleSlots: { requiredSlotCount: 6, configuredSlotCount: 6 },
    topologyStatus: "NOT_EVALUATED"
  });
});

test("provider execution falls back in route order and reports the actual model used", async () => {
  const policy = candidatePolicy(credentials);
  const profiles = policy.candidates("VERIFICATION");
  const calls = [];
  const client = new StructuredModelClient({
    policy,
    transport: async ({ profile, routeAttempt }) => {
      calls.push([profile.provider, routeAttempt]);
      if (routeAttempt === 0) throw Object.assign(new Error("primary timed out"), { name: "TimeoutError" });
      return { value: { ok: true }, responseModel: profile.model, usage: { totalTokens: 1 } };
    }
  });
  const result = await client.generate({ profile: profiles[0], fallbackProfiles: profiles.slice(1), prompt: "safe packet", schemaName: "result", schema, packetHash: "hash", promptVersion: "1" });
  assert.equal(result.profile.id, profiles[1].id);
  assert.deepEqual(calls, [[profiles[0].provider, 0], [profiles[1].provider, 1]]);
  assert.deepEqual(client.traces.map((trace) => [trace.status, trace.routeAttempt, trace.routePriority]), [["FAILED", 0, "PRIMARY"], ["COMPLETED", 1, "FALLBACK"]]);
});

test("role topology requires independent verification and a third-provider adjudicator", () => {
  const valid = validateGovernanceRouteTopology(candidatePolicy(credentials));
  assert.deepEqual(valid.claimFlow, { workhorse: "MOONSHOT", verifier: "OPENAI", adjudicator: "XAI" });
  assert.notEqual(valid.solutionFlow.reasoner, valid.solutionFlow.verifier);
  assert.notEqual(valid.publicationFlow.reasoner, valid.publicationFlow.qualityChecker);
  const policy = candidatePolicy(credentials);
  const assessor = policy.choose("DOMAIN_ASSESSMENT");
  const verifier = policy.choose("VERIFICATION", { excludeProviders: [assessor.provider] });
  assert.ok(policy.candidates("ADJUDICATION", { excludeProviders: [assessor.provider, verifier.provider] }).every((profile) => ![assessor.provider, verifier.provider].includes(profile.provider)));

  const twoProviderPolicy = candidatePolicy({
    ...credentials,
    WORKHORSE_PROVIDER: "OPENAI", WORKHORSE_MODEL: "workhorse",
    WORKHORSE_FALLBACK_PROVIDER: "XAI", WORKHORSE_FALLBACK_MODEL: "workhorse-fallback",
    REASONER_PROVIDER: "OPENAI", REASONER_MODEL: "reasoner",
    REASONER_FALLBACK_PROVIDER: "XAI", REASONER_FALLBACK_MODEL: "reasoner-fallback",
    QUALITY_CHECKER_PROVIDER: "XAI", QUALITY_CHECKER_MODEL: "quality",
    QUALITY_CHECKER_FALLBACK_PROVIDER: "OPENAI", QUALITY_CHECKER_FALLBACK_MODEL: "quality-fallback"
  });
  assert.throws(() => validateGovernanceRouteTopology(twoProviderPolicy), /independent route for ADJUDICATION/i);
  assert.throws(() => requiredGovernanceProviders(twoProviderPolicy), /independent route for ADJUDICATION/i);
});

test("provider adapters translate one canonical schema without changing it", () => {
  const policy = candidatePolicy(credentials);
  const openai = serializeProviderRequest(policy.choose("VERIFICATION"), "safe packet", "result", schema);
  const xai = serializeProviderRequest(policy.choose("ADJUDICATION", { excludeProviders: ["MOONSHOT"] }), "safe packet", "result", schema);
  const moonshot = serializeProviderRequest(policy.choose("SOLUTION_UNDERSTANDING"), "safe packet", "result", schema);

  for (const request of [openai, xai]) {
    assert.equal(request.body.store, false);
    assert.strictEqual(request.body.text.format.schema, schema);
    assert.deepEqual(request.body.input[0].content, [{ type: "input_text", text: "safe packet" }]);
  }
  assert.strictEqual(moonshot.body.response_format.json_schema.schema, schema);
  assert.equal(moonshot.body.messages[0].content, "safe packet");
  assert.equal(moonshot.body.max_completion_tokens, policy.choose("SOLUTION_UNDERSTANDING").maxOutputTokens);
});

test("media bytes fail closed before adapters or custom transports can receive them", async () => {
  const policy = candidatePolicy(credentials);
  const profile = policy.choose("VERIFICATION");
  const media = [{ mimeType: "image/png", data: "AA==" }];
  assert.throws(() => serializeProviderRequest(profile, "safe packet", "result", schema, media), /cannot contain media/i);

  let transportCalled = false;
  const client = new StructuredModelClient({
    policy,
    transport: async () => { transportCalled = true; throw new Error("must not be called"); }
  });
  await assert.rejects(client.generate({ profile, prompt: "safe packet", schemaName: "result", schema, packetHash: "hash", promptVersion: "1", media }), /cannot contain media/i);
  assert.equal(transportCalled, false);
  assert.equal(client.traces.length, 0);
});

test("provider response shapes normalize to the same usage contract", () => {
  const responsesBody = {
    status: "completed", model: "approved-model", output_text: "{\"ok\":true}",
    usage: { input_tokens: 4, output_tokens: 2, total_tokens: 6 }
  };
  const chatBody = {
    model: "approved-model", choices: [{ finish_reason: "stop", message: { content: "{\"ok\":true}" } }],
    usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 }
  };
  assert.deepEqual(normalizeProviderResponse("OPENAI", responsesBody).usage, { inputTokens: 4, outputTokens: 2, totalTokens: 6 });
  assert.deepEqual(normalizeProviderResponse("XAI", responsesBody).usage, { inputTokens: 4, outputTokens: 2, totalTokens: 6 });
  assert.deepEqual(normalizeProviderResponse("MOONSHOT", chatBody).usage, { inputTokens: 4, outputTokens: 2, totalTokens: 6 });
  assert.throws(() => normalizeProviderResponse("MOONSHOT", { ...chatBody, choices: [{ finish_reason: "length", message: { content: "{" } }] }), /incomplete structured output/i);
});

test("strict schema and provider HTTP failures fail closed without exposing response bodies", async () => {
  const profile = candidatePolicy(credentials).choose("VERIFICATION");
  assert.throws(() => serializeProviderRequest(profile, "safe packet", "invalid", {
    type: "object", properties: { ok: { type: "boolean" } }, required: []
  }), /additionalProperties|required every declared/i);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 401,
    json: async () => ({ error: { message: "provider-internal body with endpoint and supplied evidence" } })
  });
  try {
    const client = new StructuredModelClient({ policy: candidatePolicy(credentials), budget: new ModelBudget({ maxCalls: 2, maxTokens: 10000 }) });
    await assert.rejects(
      client.generate({ profile, prompt: "safe packet", schemaName: "result", schema, packetHash: "hash", promptVersion: "1" }),
      (error) => error.message === "Provider request failed with HTTP 401"
    );
    assert.doesNotMatch(JSON.stringify(client.traces), /provider-internal|supplied evidence|api\.openai\.com|test-secret/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
