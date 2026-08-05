import test from "node:test";
import assert from "node:assert/strict";
import {
  DISCOVERY_RECHECK_SCHEMA,
  DOMAIN_CLAIMS_SCHEMA,
  FACT_CHECK_SCHEMA,
  IMAGE_EXTRACTION_SCHEMA,
  ROUTING_SCHEMA,
  SOLUTION_FACT_VERIFICATION_SCHEMA,
  SOLUTION_MODEL_SCHEMA,
  SYNTHESIS_SCHEMA,
  VERIFICATION_SCHEMA
} from "../src/cognitive/contracts.js";
import { assertOpenAiStrictSchema } from "../src/cognitive/provider-client.js";

test("every model response schema is valid for OpenAI strict structured output", () => {
  for (const schema of [
    DISCOVERY_RECHECK_SCHEMA,
    DOMAIN_CLAIMS_SCHEMA,
    FACT_CHECK_SCHEMA,
    IMAGE_EXTRACTION_SCHEMA,
    ROUTING_SCHEMA,
    SOLUTION_FACT_VERIFICATION_SCHEMA,
    SOLUTION_MODEL_SCHEMA,
    SYNTHESIS_SCHEMA,
    VERIFICATION_SCHEMA
  ]) assert.doesNotThrow(() => assertOpenAiStrictSchema(schema));
});
