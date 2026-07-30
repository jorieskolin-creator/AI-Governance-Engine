import { sha256, stableStringify } from "../core/hash.js";

function parseJson(value, label) {
  try { return JSON.parse(value); }
  catch { throw new Error(`${label} returned malformed structured output`); }
}

function openAiOutput(body) {
  const refusal = (body.output ?? []).flatMap((item) => item.content ?? []).find((item) => item.type === "refusal");
  if (refusal) throw Object.assign(new Error("OpenAI refused the structured assessment request"), { refusal: true });
  if (typeof body.output_text === "string") return body.output_text;
  return (body.output ?? []).flatMap((item) => item.content ?? []).filter((item) => item.type === "output_text").map((item) => item.text).join("");
}

function anthropicOutput(body) {
  if (body.stop_reason === "refusal") throw Object.assign(new Error("Anthropic refused the structured assessment request"), { refusal: true });
  return (body.content ?? []).filter((item) => item.type === "text").map((item) => item.text).join("");
}

function geminiOutput(body) {
  if (["SAFETY", "BLOCKLIST", "PROHIBITED_CONTENT"].includes(body.candidates?.[0]?.finishReason)) throw Object.assign(new Error("Gemini refused the structured assessment request"), { refusal: true });
  return (body.candidates?.[0]?.content?.parts ?? []).map((item) => item.text ?? "").join("");
}

function validateSchema(value, schema, path = "$") {
  if (schema.enum && !schema.enum.includes(value)) throw new Error(`${path} is outside the allowed enum`);
  if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${path} must be an object`);
    for (const key of schema.required ?? []) if (!Object.hasOwn(value, key)) throw new Error(`${path}.${key} is required`);
    if (schema.additionalProperties === false) for (const key of Object.keys(value)) if (!Object.hasOwn(schema.properties ?? {}, key)) throw new Error(`${path}.${key} is not allowed`);
    for (const [key, child] of Object.entries(schema.properties ?? {})) if (Object.hasOwn(value, key)) validateSchema(value[key], child, `${path}.${key}`);
  } else if (schema.type === "array") {
    if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
    for (let index = 0; index < value.length; index += 1) validateSchema(value[index], schema.items, `${path}[${index}]`);
  } else if (schema.type === "string" && typeof value !== "string") throw new Error(`${path} must be a string`);
  else if (schema.type === "boolean" && typeof value !== "boolean") throw new Error(`${path} must be a boolean`);
}

async function requestJson(url, init, timeoutMs) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = body?.error?.message ?? body?.message ?? `HTTP ${response.status}`;
    throw Object.assign(new Error(`Provider request failed: ${message}`), { statusCode: response.status });
  }
  return body;
}

function openAiRequest(profile, credential, prompt, schemaName, schema, media = []) {
  return requestJson("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${credential}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: profile.model,
      input: [{ role: "developer", content: [{ type: "input_text", text: prompt }, ...media.map((item) => ({ type: "input_image", image_url: `data:${item.mimeType};base64,${item.data}`, detail: "high" }))] }],
      reasoning: { effort: profile.effort },
      text: { verbosity: "low", format: { type: "json_schema", name: schemaName, strict: true, schema } },
      max_output_tokens: profile.maxOutputTokens,
      store: false
    })
  }, 120_000).then((body) => ({
    value: parseJson(openAiOutput(body), "OpenAI"),
    responseModel: body.model,
    usage: { inputTokens: body.usage?.input_tokens ?? 0, outputTokens: body.usage?.output_tokens ?? 0, totalTokens: body.usage?.total_tokens ?? 0 }
  }));
}

function anthropicRequest(profile, credential, prompt, schemaName, schema, media = []) {
  return requestJson("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": credential, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: profile.model,
      max_tokens: profile.maxOutputTokens,
      thinking: { type: "adaptive" },
      output_config: { effort: profile.effort, format: { type: "json_schema", schema } },
      messages: [{ role: "user", content: [{ type: "text", text: prompt }, ...media.map((item) => ({ type: "image", source: { type: "base64", media_type: item.mimeType, data: item.data } }))] }]
    })
  }, 120_000).then((body) => ({
    value: parseJson(anthropicOutput(body), "Anthropic"),
    responseModel: body.model,
    usage: { inputTokens: body.usage?.input_tokens ?? 0, outputTokens: body.usage?.output_tokens ?? 0, totalTokens: (body.usage?.input_tokens ?? 0) + (body.usage?.output_tokens ?? 0) }
  }));
}

function geminiRequest(profile, credential, prompt, schemaName, schema, media = []) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(profile.model)}:generateContent`;
  return requestJson(url, {
    method: "POST",
    headers: { "x-goog-api-key": credential, "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }, ...media.map((item) => ({ inlineData: { mimeType: item.mimeType, data: item.data } }))] }],
      generationConfig: {
        responseMimeType: "application/json", responseJsonSchema: schema, maxOutputTokens: profile.maxOutputTokens,
        thinkingConfig: { thinkingLevel: profile.thinkingLevel }
      }
    })
  }, 120_000).then((body) => ({
    value: parseJson(geminiOutput(body), "Gemini"),
    responseModel: profile.model,
    usage: { inputTokens: body.usageMetadata?.promptTokenCount ?? 0, outputTokens: body.usageMetadata?.candidatesTokenCount ?? 0, totalTokens: body.usageMetadata?.totalTokenCount ?? 0 }
  }));
}

export class ModelBudget {
  constructor(options = {}) {
    this.maxCalls = options.maxCalls ?? 40;
    this.maxTokens = options.maxTokens ?? 500_000;
    this.maxMs = options.maxMs ?? 12 * 60 * 1000;
    this.startedAt = Date.now();
    this.calls = 0;
    this.tokens = 0;
  }

  reserve() {
    if (this.calls >= this.maxCalls) throw new Error("Model-call budget exhausted");
    if (this.tokens >= this.maxTokens) throw new Error("Model-token budget exhausted");
    if (Date.now() - this.startedAt >= this.maxMs) throw new Error("Model-time budget exhausted");
    this.calls += 1;
  }

  record(usage) { this.tokens += usage.totalTokens ?? 0; }
  view() { return { calls: this.calls, tokens: this.tokens, elapsedMs: Date.now() - this.startedAt, maxCalls: this.maxCalls, maxTokens: this.maxTokens, maxMs: this.maxMs }; }
}

export class StructuredModelClient {
  constructor({ policy, budget, transport } = {}) {
    this.policy = policy;
    this.budget = budget ?? new ModelBudget();
    this.transport = transport;
    this.traces = [];
  }

  async generate({ profile, prompt, schemaName, schema, packetHash, promptVersion, media = [] }) {
    const requestHash = sha256({ profile: profile.id, prompt, schemaName, schema, packetHash, promptVersion, media: media.map((item) => ({ mimeType: item.mimeType, sha256: sha256(Buffer.from(item.data, "base64")) })) });
    let lastError;
    for (let retry = 0; retry <= 1; retry += 1) {
      this.budget.reserve();
      const started = Date.now();
      const repairPrompt = retry === 0 ? prompt : `${prompt}\n\nSCHEMA_REPAIR: The previous response was malformed or violated the schema. Return one complete JSON value that exactly matches the supplied schema.`;
      try {
        const response = this.transport
          ? await this.transport({ profile, prompt: repairPrompt, schemaName, schema, media, retry })
          : profile.provider === "OPENAI"
            ? await openAiRequest(profile, this.policy.credentials.OPENAI, repairPrompt, schemaName, schema, media)
            : profile.provider === "ANTHROPIC"
              ? await anthropicRequest(profile, this.policy.credentials.ANTHROPIC, repairPrompt, schemaName, schema, media)
              : await geminiRequest(profile, this.policy.credentials.GEMINI, repairPrompt, schemaName, schema, media);
        validateSchema(response.value, schema);
        this.budget.record(response.usage ?? {});
        const trace = this.trace(profile, promptVersion, schemaName, packetHash, requestHash, started, response, retry, null);
        this.traces.push(trace);
        return { value: response.value, trace };
      } catch (error) {
        lastError = error;
        this.traces.push(this.trace(profile, promptVersion, schemaName, packetHash, requestHash, started, null, retry, error));
        const repairable = !error.statusCode && !error.refusal && (error.message.includes("malformed structured output") || error.message.startsWith("$"));
        if (!repairable) break;
      }
    }
    throw lastError;
  }

  trace(profile, promptVersion, schemaName, packetHash, requestHash, started, response, retry, error) {
    return {
      id: `model-${sha256({ requestHash, retry, started }).slice(0, 24)}`, provider: profile.provider, configuredModel: profile.model,
      responseModel: response?.responseModel ?? null,
      parameters: profile.provider === "GEMINI" ? { thinkingLevel: profile.thinkingLevel } : { effort: profile.effort },
      promptVersion, schemaName, schemaVersion: "2.0.0", packetHash, requestHash,
      usage: response?.usage ?? { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, latencyMs: Date.now() - started,
      retry, refusal: Boolean(error?.refusal), status: error ? "FAILED" : "COMPLETED", error: error ? error.message : null,
      outputHash: response ? sha256(stableStringify(response.value)) : null
    };
  }
}
