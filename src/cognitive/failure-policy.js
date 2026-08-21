const FAILURE_RULES = Object.freeze([
  { code: "RUN_CANCELLED", retryDisposition: "DO_NOT_RETRY", test: (error) => error?.failureCode === "RUN_CANCELLED" || error?.name === "AbortError" },
  { code: "ORCHESTRATION_LEASE_LOST", retryDisposition: "DO_NOT_RETRY", test: (error) => error?.failureCode === "ORCHESTRATION_LEASE_LOST" },
  { code: "PROVIDER_TIMEOUT", retryDisposition: "RETRY_WITH_NEW_REQUEST", test: (error) => error?.name === "TimeoutError" || /timed out|timeout/i.test(String(error?.message ?? "")) },
  { code: "MODEL_ROUTE_UNAVAILABLE", retryDisposition: "REQUIRES_CONFIGURATION", test: (error) => /credential|required .*route|governance route/i.test(String(error?.message ?? "")) },
  { code: "COGNITIVE_BUDGET_EXHAUSTED", retryDisposition: "REQUIRES_NEW_BUDGET", test: (error) => /budget/i.test(String(error?.message ?? "")) },
  { code: "PROVIDER_REFUSAL", retryDisposition: "DO_NOT_RETRY", test: (error) => Boolean(error?.refusal) || /refused/i.test(String(error?.message ?? "")) },
  { code: "PROVIDER_RATE_LIMITED", retryDisposition: "RETRY_AFTER_PROVIDER_DELAY", test: (error) => error?.statusCode === 429 },
  { code: "PROVIDER_REQUEST_FAILED", retryDisposition: "RETRY_WITH_NEW_REQUEST", test: (error) => /Provider request failed|HTTP \d+/i.test(String(error?.message ?? "")) },
  { code: "STRUCTURED_OUTPUT_INVALID", retryDisposition: "SCHEMA_REPAIR_ONCE", test: (error) => /malformed structured output/i.test(String(error?.message ?? "")) || String(error?.message ?? "").startsWith("$") },
  { code: "INDEPENDENT_VERIFICATION_INCOMPLETE", retryDisposition: "REQUIRES_ROUTE_REVIEW", test: (error) => /independent|verification|adjudication/i.test(String(error?.message ?? "")) }
]);

export function classifyCognitiveFailure(error) {
  const rule = FAILURE_RULES.find((candidate) => candidate.test(error));
  return rule ? { code: rule.code, retryDisposition: rule.retryDisposition } : { code: "COGNITIVE_RUN_FAILED", retryDisposition: "REVIEW_REQUIRED" };
}

export function cancellationError(message = "Cognitive run was cancelled") {
  return Object.assign(new Error(message), { name: "AbortError", failureCode: "RUN_CANCELLED", fatal: true });
}

export function rethrowFatal(error) {
  if (error?.fatal || error?.failureCode === "RUN_CANCELLED" || error?.name === "AbortError") throw error;
}
