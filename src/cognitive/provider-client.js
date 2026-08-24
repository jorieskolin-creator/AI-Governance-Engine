import { sha256, stableStringify } from "../core/hash.js";
import { classifyCognitiveFailure } from "./failure-policy.js";
import { assertStrictSchema, normalizeProviderResponse, serializeProviderRequest } from "./provider-adapters.js";

function parseJson(value, label) {
  try { return JSON.parse(value); }
  catch { throw new Error(`${label} returned malformed structured output`); }
}

function validateSchema(value, schema, path = "$") {
  if (schema.enum && !schema.enum.includes(value)) throw new Error(`${path} is outside the allowed enum`);
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  if (value === null && types.includes("null")) return;
  if (types.includes("object")) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${path} must be an object`);
    for (const key of schema.required ?? []) if (!Object.hasOwn(value, key)) throw new Error(`${path}.${key} is required`);
    if (schema.additionalProperties === false) for (const key of Object.keys(value)) if (!Object.hasOwn(schema.properties ?? {}, key)) throw new Error(`${path}.${key} is not allowed`);
    for (const [key, child] of Object.entries(schema.properties ?? {})) if (Object.hasOwn(value, key)) validateSchema(value[key], child, `${path}.${key}`);
  } else if (types.includes("array")) {
    if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
    for (let index = 0; index < value.length; index += 1) validateSchema(value[index], schema.items, `${path}[${index}]`);
  } else if (types.includes("string") && typeof value !== "string") throw new Error(`${path} must be a string`);
  else if (types.includes("boolean") && typeof value !== "boolean") throw new Error(`${path} must be a boolean`);
  else if (types.includes("integer") && (!Number.isInteger(value))) throw new Error(`${path} must be an integer`);
  else if (types.includes("number") && (typeof value !== "number" || !Number.isFinite(value))) throw new Error(`${path} must be a number`);
}

export const assertOpenAiStrictSchema = assertStrictSchema;

async function requestJson(url, init, timeoutMs, signal) {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const response = await fetch(url, { ...init, signal: signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Object.assign(new Error(`Provider request failed with HTTP ${response.status}`), { statusCode: response.status });
  }
  return body;
}

function providerRequest(profile, credential, prompt, schemaName, schema, signal) {
  if (!credential) throw new Error(`The server credential required for ${profile.provider} is unavailable`);
  const request = serializeProviderRequest(profile, prompt, schemaName, schema);
  return requestJson(request.url, {
    method: "POST",
    headers: { Authorization: `Bearer ${credential}`, "Content-Type": "application/json" },
    body: JSON.stringify(request.body)
  }, 120_000, signal).then((body) => {
    const normalized = normalizeProviderResponse(profile.provider, body);
    return { ...normalized, value: parseJson(normalized.text, profile.provider) };
  });
}

export class ModelBudget {
  constructor(options = {}) {
    this.maxCalls = options.maxCalls ?? 180;
    this.maxTokens = options.maxTokens ?? 1_500_000;
    this.maxMs = options.maxMs ?? 15 * 60 * 1000;
    this.startedAt = Date.now();
    this.calls = 0;
    this.tokens = 0;
    this.callsByStage = new Map();
    this.tokensByStage = new Map();
    this.startedAtByStage = new Map();
    this.maxCallsByStage = options.maxCallsByStage ?? { ROUTING: 4, RETRIEVAL_PLANNING: 2, EXTRACTION: 20, SOLUTION_UNDERSTANDING: 2, DOMAIN_ASSESSMENT: 48, VERIFICATION: 160, ADJUDICATION: 32, SYNTHESIS: 3, FACT_CHECK: 4 };
    this.maxTokensByStage = options.maxTokensByStage ?? { ROUTING: 40000, RETRIEVAL_PLANNING: 30000, EXTRACTION: 200000, SOLUTION_UNDERSTANDING: 100000, DOMAIN_ASSESSMENT: 700000, VERIFICATION: 500000, ADJUDICATION: 200000, SYNTHESIS: 150000, FACT_CHECK: 100000 };
    this.maxMsByStage = options.maxMsByStage ?? { ROUTING: 120000, RETRIEVAL_PLANNING: 120000, EXTRACTION: 300000, SOLUTION_UNDERSTANDING: 240000, DOMAIN_ASSESSMENT: 600000, VERIFICATION: 600000, ADJUDICATION: 300000, SYNTHESIS: 240000, FACT_CHECK: 240000 };
  }

  reserve(stage = "UNKNOWN", expectedOutputTokens = 0) {
    if (this.calls >= this.maxCalls) throw new Error("Model-call budget exhausted");
    if (this.tokens + expectedOutputTokens > this.maxTokens) throw new Error("Model-token budget cannot safely reserve the requested output");
    if (Date.now() - this.startedAt >= this.maxMs) throw new Error("Model-time budget exhausted");
    const stageCalls = this.callsByStage.get(stage) ?? 0;
    const stageLimit = this.maxCallsByStage[stage];
    if (stageLimit && stageCalls >= stageLimit) throw new Error(`Model-call budget exhausted for ${stage}`);
    const stageTokens = this.tokensByStage.get(stage) ?? 0;
    const stageTokenLimit = this.maxTokensByStage[stage];
    if (stageTokenLimit && stageTokens + expectedOutputTokens > stageTokenLimit) throw new Error(`Model-token budget cannot safely reserve the requested output for ${stage}`);
    const stageStartedAt = this.startedAtByStage.get(stage) ?? Date.now();
    this.startedAtByStage.set(stage, stageStartedAt);
    const stageTimeLimit = this.maxMsByStage[stage];
    if (stageTimeLimit && Date.now() - stageStartedAt >= stageTimeLimit) throw new Error(`Model-time budget exhausted for ${stage}`);
    this.calls += 1;
    this.callsByStage.set(stage, stageCalls + 1);
  }

  record(usage, stage = "UNKNOWN") {
    const tokens = usage.totalTokens ?? 0;
    this.tokens += tokens;
    this.tokensByStage.set(stage, (this.tokensByStage.get(stage) ?? 0) + tokens);
    if (this.tokens > this.maxTokens) throw new Error("Model-token budget exhausted");
    if (this.maxTokensByStage[stage] && this.tokensByStage.get(stage) > this.maxTokensByStage[stage]) throw new Error(`Model-token budget exhausted for ${stage}`);
  }
  view() {
    return {
      calls: this.calls, tokens: this.tokens, elapsedMs: Date.now() - this.startedAt,
      maxCalls: this.maxCalls, maxTokens: this.maxTokens, maxMs: this.maxMs,
      callsByStage: Object.fromEntries(this.callsByStage), tokensByStage: Object.fromEntries(this.tokensByStage),
      maxCallsByStage: this.maxCallsByStage, maxTokensByStage: this.maxTokensByStage, maxMsByStage: this.maxMsByStage
    };
  }
}

function responseModelMatches(configured, returned) {
  if (!returned) return false;
  return returned === configured || returned.startsWith(`${configured}-`);
}

export class StructuredModelClient {
  constructor({ policy, budget, transport, signal } = {}) {
    this.policy = policy;
    this.budget = budget ?? new ModelBudget();
    this.transport = transport;
    this.signal = signal;
    this.traces = [];
  }

  async generate({ profile, prompt, schemaName, schema, packetHash, promptVersion, media = [] }) {
    if (media.length) throw new Error("Provider transmission cannot contain media; only local deterministic media summaries are allowed");
    const requestHash = sha256({ profile: profile.id, prompt, schemaName, schema, packetHash, promptVersion });
    let lastError;
    for (let retry = 0; retry <= 1; retry += 1) {
      this.signal?.throwIfAborted();
      this.budget.reserve(profile.role, profile.maxOutputTokens ?? 0);
      const started = Date.now();
      const repairPrompt = retry === 0 ? prompt : `${prompt}\n\nSCHEMA_REPAIR: The previous response was malformed or violated the schema. Return one complete JSON value that exactly matches the supplied schema.`;
      try {
        const response = this.transport
          ? await this.transport({ profile, prompt: repairPrompt, schemaName, schema, media: [], retry, signal: this.signal })
          : await providerRequest(profile, this.policy.credentials[profile.provider], repairPrompt, schemaName, schema, this.signal);
        this.signal?.throwIfAborted();
        if (!responseModelMatches(profile.model, response.responseModel)) throw new Error(`Provider returned unapproved model ${response.responseModel ?? "UNKNOWN"}; expected ${profile.model}`);
        validateSchema(response.value, schema);
        this.budget.record(response.usage ?? {}, profile.role);
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
    const failure = error ? classifyCognitiveFailure(error) : null;
    return {
      id: `model-event-${sha256({ requestHash, retry, started }).slice(0, 24)}`,
      requestId: `model-request-${requestHash.slice(0, 24)}`, provider: profile.provider, configuredModel: profile.model,
      responseModel: response?.responseModel ?? null,
      parameters: { effort: profile.effort },
      promptVersion, schemaName, schemaVersion: "3.1.0", packetHash, requestHash,
      usage: response?.usage ?? { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, latencyMs: Date.now() - started,
      retry, refusal: Boolean(error?.refusal), status: error ? "FAILED" : "COMPLETED", error: error ? error.message : null,
      failureCode: failure?.code ?? null,
      retryDisposition: failure?.code === "STRUCTURED_OUTPUT_INVALID" && retry > 0 ? "REVIEW_REQUIRED" : failure?.retryDisposition ?? null,
      outputHash: response ? sha256(stableStringify(response.value)) : null
    };
  }
}
