const PROVIDER_ADAPTERS = Object.freeze({
  OPENAI: Object.freeze({
    provider: "OPENAI",
    endpoint: "https://api.openai.com/v1/responses",
    protocol: "RESPONSES",
    capabilities: Object.freeze({ strictJsonSchema: true, imageInput: false, reasoningEffort: true })
  }),
  XAI: Object.freeze({
    provider: "XAI",
    endpoint: "https://api.x.ai/v1/responses",
    protocol: "RESPONSES",
    capabilities: Object.freeze({ strictJsonSchema: true, imageInput: false, reasoningEffort: true })
  }),
  MOONSHOT: Object.freeze({
    provider: "MOONSHOT",
    endpoint: "https://api.moonshot.ai/v1/chat/completions",
    protocol: "CHAT_COMPLETIONS",
    capabilities: Object.freeze({ strictJsonSchema: true, imageInput: false, reasoningEffort: true })
  }),
  ANTHROPIC: Object.freeze({
    provider: "ANTHROPIC",
    endpoint: "https://api.anthropic.com/v1/messages",
    protocol: "MESSAGES",
    capabilities: Object.freeze({ strictJsonSchema: true, imageInput: false, reasoningEffort: true })
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

function responsesRequest(profile, prompt, schemaName, schema) {
  return {
    model: profile.model,
    input: [{
      role: "developer",
      content: [{ type: "input_text", text: prompt }]
    }],
    reasoning: { effort: profile.effort },
    text: { verbosity: "low", format: { type: "json_schema", name: schemaName, strict: true, schema } },
    max_output_tokens: profile.maxOutputTokens,
    store: false
  };
}

function chatCompletionsRequest(profile, prompt, schemaName, schema) {
  return {
    model: profile.model,
    messages: [{ role: "user", content: prompt }],
    reasoning_effort: profile.effort,
    response_format: { type: "json_schema", json_schema: { name: schemaName, strict: true, schema } },
    max_completion_tokens: profile.maxOutputTokens
  };
}

function anthropicSchema(schema) {
  // The client validates the original schema, including bounds excluded by the API.
  const { type, properties, items, maxItems, maxLength, ...annotations } = schema;
  const shape = { ...annotations, type };
  if (properties) shape.properties = Object.fromEntries(Object.entries(properties).map(([key, value]) => [key, anthropicSchema(value)]));
  if (items) shape.items = anthropicSchema(items);
  if (!Array.isArray(type)) return shape;
  const { enum: allowed, ...nonNull } = shape;
  const choices = type.filter((entry) => entry !== "null").map((entry) => ({
    ...nonNull, type: entry, ...(allowed ? { enum: allowed.filter((value) => value !== null) } : {})
  }));
  if (type.includes("null")) choices.push({ type: "null" });
  return { anyOf: choices };
}

export function providerHeaders(provider, credential) {
  const headers = { "Content-Type": "application/json" };
  if (provider === "ANTHROPIC") return { ...headers, "x-api-key": credential, "anthropic-version": "2023-06-01" };
  return { ...headers, Authorization: `Bearer ${credential}` };
}

export function serializeProviderRequest(profile, prompt, schemaName, schema, media = []) {
  const adapter = providerAdapter(profile.provider);
  assertStrictSchema(schema);
  if (media.length) throw new Error("Provider transmission cannot contain media; only local deterministic media summaries are allowed");
  if (adapter.protocol === "MESSAGES") return {
    url: adapter.endpoint,
    body: {
      model: profile.model, max_tokens: profile.maxOutputTokens,
      messages: [{ role: "user", content: prompt }],
      thinking: { type: "adaptive" },
      output_config: { effort: profile.effort, format: { type: "json_schema", schema: anthropicSchema(schema) } }
    }
  };
  return {
    url: adapter.endpoint,
    body: adapter.protocol === "RESPONSES"
      ? responsesRequest(profile, prompt, schemaName, schema)
      : chatCompletionsRequest(profile, prompt, schemaName, schema)
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
  if (adapter.protocol === "MESSAGES") {
    if (body.stop_reason === "refusal") throw Object.assign(new Error(`${provider} refused the structured assessment request`), { refusal: true });
    if (body.stop_reason !== "end_turn") throw new Error(`${provider} returned incomplete structured output`);
    const inputTokens = (body.usage?.input_tokens ?? 0) + (body.usage?.cache_creation_input_tokens ?? 0) + (body.usage?.cache_read_input_tokens ?? 0);
    const outputTokens = body.usage?.output_tokens ?? 0;
    return {
      text: (body.content ?? []).filter((item) => item.type === "text").map((item) => item.text).join(""), responseModel: body.model,
      usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens }
    };
  }
  return adapter.protocol === "RESPONSES" ? responsesOutput(provider, body) : chatCompletionsOutput(provider, body);
}
