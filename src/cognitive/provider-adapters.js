const PROVIDER_ADAPTERS = Object.freeze({
  OPENAI: Object.freeze({
    provider: "OPENAI",
    endpoint: "https://api.openai.com/v1/responses",
    protocol: "RESPONSES",
    capabilities: Object.freeze({ strictJsonSchema: true, imageInput: true, reasoningEffort: true })
  }),
  XAI: Object.freeze({
    provider: "XAI",
    endpoint: "https://api.x.ai/v1/responses",
    protocol: "RESPONSES",
    capabilities: Object.freeze({ strictJsonSchema: true, imageInput: true, reasoningEffort: true })
  }),
  MOONSHOT: Object.freeze({
    provider: "MOONSHOT",
    endpoint: "https://api.moonshot.ai/v1/chat/completions",
    protocol: "CHAT_COMPLETIONS",
    capabilities: Object.freeze({ strictJsonSchema: true, imageInput: true, reasoningEffort: true })
  })
});

export const COGNITIVE_PROVIDERS = Object.freeze(Object.keys(PROVIDER_ADAPTERS));

export function providerAdapter(provider) {
  const adapter = PROVIDER_ADAPTERS[provider];
  if (!adapter) throw new Error(`Unsupported cognitive provider: ${provider}`);
  return adapter;
}

export function assertStrictSchema(schema, path = "$") {
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  if (path === "$" && !types.includes("object")) throw new Error("$ must be an object for strict structured output");
  if (types.includes("object")) {
    const propertyNames = Object.keys(schema.properties ?? {}).sort();
    const requiredNames = [...(schema.required ?? [])].sort();
    if (schema.additionalProperties !== false) throw new Error(`${path} must set additionalProperties to false for strict structured output`);
    if (propertyNames.join("|") !== requiredNames.join("|")) throw new Error(`${path} must require every declared object property for strict structured output`);
    for (const [name, child] of Object.entries(schema.properties ?? {})) assertStrictSchema(child, `${path}.${name}`);
  }
  if (types.includes("array")) {
    if (!schema.items) throw new Error(`${path} must declare array items for strict structured output`);
    assertStrictSchema(schema.items, `${path}[]`);
  }
}

function dataUrl(item) {
  return `data:${item.mimeType};base64,${item.data}`;
}

function responsesRequest(profile, prompt, schemaName, schema, media) {
  return {
    model: profile.model,
    input: [{
      role: "developer",
      content: [
        { type: "input_text", text: prompt },
        ...media.map((item) => ({ type: "input_image", image_url: dataUrl(item), detail: "high" }))
      ]
    }],
    reasoning: { effort: profile.effort },
    text: { verbosity: "low", format: { type: "json_schema", name: schemaName, strict: true, schema } },
    max_output_tokens: profile.maxOutputTokens,
    store: false
  };
}

function chatCompletionsRequest(profile, prompt, schemaName, schema, media) {
  const content = media.length
    ? [{ type: "text", text: prompt }, ...media.map((item) => ({ type: "image_url", image_url: { url: dataUrl(item) } }))]
    : prompt;
  return {
    model: profile.model,
    messages: [{ role: "user", content }],
    reasoning_effort: profile.effort,
    response_format: { type: "json_schema", json_schema: { name: schemaName, strict: true, schema } },
    max_completion_tokens: profile.maxOutputTokens
  };
}

export function serializeProviderRequest(profile, prompt, schemaName, schema, media = []) {
  const adapter = providerAdapter(profile.provider);
  assertStrictSchema(schema);
  if (media.length && !adapter.capabilities.imageInput) throw new Error(`${profile.provider} profile ${profile.id} is not approved for image input`);
  return {
    url: adapter.endpoint,
    body: adapter.protocol === "RESPONSES"
      ? responsesRequest(profile, prompt, schemaName, schema, media)
      : chatCompletionsRequest(profile, prompt, schemaName, schema, media)
  };
}

function responsesOutput(provider, body) {
  if (body.status === "incomplete") throw new Error(`${provider} returned incomplete structured output`);
  const content = (body.output ?? []).flatMap((item) => item.content ?? []);
  if (content.some((item) => item.type === "refusal")) throw Object.assign(new Error(`${provider} refused the structured assessment request`), { refusal: true });
  const text = typeof body.output_text === "string"
    ? body.output_text
    : content.filter((item) => item.type === "output_text").map((item) => item.text).join("");
  return {
    text,
    responseModel: body.model,
    usage: {
      inputTokens: body.usage?.input_tokens ?? 0,
      outputTokens: body.usage?.output_tokens ?? 0,
      totalTokens: body.usage?.total_tokens ?? 0
    }
  };
}

function chatCompletionsOutput(provider, body) {
  const choice = body.choices?.[0];
  if (choice?.finish_reason === "length") throw new Error(`${provider} returned incomplete structured output`);
  if (choice?.message?.refusal) throw Object.assign(new Error(`${provider} refused the structured assessment request`), { refusal: true });
  return {
    text: choice?.message?.content ?? "",
    responseModel: body.model,
    usage: {
      inputTokens: body.usage?.prompt_tokens ?? 0,
      outputTokens: body.usage?.completion_tokens ?? 0,
      totalTokens: body.usage?.total_tokens ?? 0
    }
  };
}

export function normalizeProviderResponse(provider, body) {
  const adapter = providerAdapter(provider);
  return adapter.protocol === "RESPONSES" ? responsesOutput(provider, body) : chatCompletionsOutput(provider, body);
}
