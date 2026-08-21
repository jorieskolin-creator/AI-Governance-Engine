import test from "node:test";
import assert from "node:assert/strict";
import { COGNITIVE_PROVIDERS, modelPolicy } from "../src/cognitive/model-policy.js";
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

test("the canonical provider catalog contains only OpenAI, xAI and Moonshot", () => {
  assert.deepEqual([...COGNITIVE_PROVIDERS].sort(), ["MOONSHOT", "OPENAI", "XAI"]);
  assert.throws(() => providerAdapter("LEGACY_PROVIDER"), /unsupported cognitive provider/i);
});

test("role routing is deterministic and model identities are server-configurable", () => {
  const policy = modelPolicy({
    ...credentials,
    OPENAI_COGNITIVE_MODEL: "openai-qualified",
    XAI_COGNITIVE_MODEL: "xai-qualified",
    MOONSHOT_COGNITIVE_MODEL: "moonshot-qualified"
  });
  assert.deepEqual([
    policy.choose("SOLUTION_UNDERSTANDING"),
    policy.choose("VERIFICATION"),
    policy.choose("ADJUDICATION")
  ].map((profile) => [profile.provider, profile.model]), [
    ["MOONSHOT", "moonshot-qualified"],
    ["OPENAI", "openai-qualified"],
    ["XAI", "xai-qualified"]
  ]);
});

test("provider adapters translate one canonical schema without changing it", () => {
  const policy = modelPolicy(credentials);
  const media = [{ mimeType: "image/png", data: "AA==" }];
  const openai = serializeProviderRequest(policy.choose("VERIFICATION"), "safe packet", "result", schema, media);
  const xai = serializeProviderRequest(policy.choose("ADJUDICATION"), "safe packet", "result", schema, media);
  const moonshot = serializeProviderRequest(policy.choose("SOLUTION_UNDERSTANDING"), "safe packet", "result", schema, media);

  for (const request of [openai, xai]) {
    assert.equal(request.body.store, false);
    assert.strictEqual(request.body.text.format.schema, schema);
    assert.match(request.body.input[0].content[1].image_url, /^data:image\/png;base64,/);
  }
  assert.strictEqual(moonshot.body.response_format.json_schema.schema, schema);
  assert.match(moonshot.body.messages[0].content[1].image_url.url, /^data:image\/png;base64,/);
  assert.equal(moonshot.body.max_completion_tokens, policy.choose("SOLUTION_UNDERSTANDING").maxOutputTokens);
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
  const profile = modelPolicy(credentials).choose("VERIFICATION");
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
    const client = new StructuredModelClient({ policy: modelPolicy(credentials), budget: new ModelBudget({ maxCalls: 2, maxTokens: 10000 }) });
    await assert.rejects(
      client.generate({ profile, prompt: "safe packet", schemaName: "result", schema, packetHash: "hash", promptVersion: "1" }),
      (error) => error.message === "Provider request failed with HTTP 401"
    );
    assert.doesNotMatch(JSON.stringify(client.traces), /provider-internal|supplied evidence|api\.openai\.com|test-secret/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
