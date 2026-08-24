import test from "node:test";
import assert from "node:assert/strict";
import { cancellationError, classifyCognitiveFailure } from "../src/cognitive/failure-policy.js";

test("cognitive failures have deterministic retry dispositions", () => {
  assert.deepEqual(classifyCognitiveFailure(cancellationError()), { code: "RUN_CANCELLED", retryDisposition: "DO_NOT_RETRY" });
  assert.deepEqual(classifyCognitiveFailure(Object.assign(new Error("rate limited"), { statusCode: 429 })), { code: "PROVIDER_RATE_LIMITED", retryDisposition: "RETRY_AFTER_PROVIDER_DELAY" });
  assert.deepEqual(classifyCognitiveFailure(new Error("No approved model profile is configured for RETRIEVAL_PLANNING")), { code: "MODEL_ROUTE_UNAVAILABLE", retryDisposition: "REQUIRES_CONFIGURATION" });
  assert.deepEqual(classifyCognitiveFailure(new Error("OpenAI returned malformed structured output")), { code: "STRUCTURED_OUTPUT_INVALID", retryDisposition: "SCHEMA_REPAIR_ONCE" });
  assert.deepEqual(classifyCognitiveFailure(new Error("unknown failure")), { code: "COGNITIVE_RUN_FAILED", retryDisposition: "REVIEW_REQUIRED" });
});
