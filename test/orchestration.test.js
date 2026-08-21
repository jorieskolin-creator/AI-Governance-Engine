import test from "node:test";
import assert from "node:assert/strict";
import {
  COGNITIVE_STEP_SEQUENCE,
  completeCognitiveStep,
  createCognitiveStepLedger,
  startCognitiveStep,
  validateCognitiveStepLedger
} from "../src/cognitive/orchestration.js";

test("cognitive steps enforce the canonical order and idempotent terminal state", () => {
  const ledger = createCognitiveStepLedger(new Date("2026-08-21T12:00:00.000Z"));
  assert.throws(() => startCognitiveStep(ledger, "PACKET_ROUTING"), /predecessor is incomplete/i);
  completeCognitiveStep(ledger, "MULTIMODAL_EXTRACTION", "SKIPPED", { reason: "NO_MEDIA_UNITS" });
  startCognitiveStep(ledger, "SOLUTION_UNDERSTANDING");
  completeCognitiveStep(ledger, "SOLUTION_UNDERSTANDING", "FAILED");
  assert.equal(completeCognitiveStep(ledger, "SOLUTION_UNDERSTANDING", "FAILED").status, "FAILED");
  assert.throws(() => completeCognitiveStep(ledger, "SOLUTION_UNDERSTANDING", "COMPLETED"), /transition conflicts/i);
  assert.equal(validateCognitiveStepLedger(ledger), ledger);
  assert.deepEqual(ledger.records.map((item) => item.step), COGNITIVE_STEP_SEQUENCE);
});

test("cognitive step ledger validation rejects reordered records", () => {
  const ledger = createCognitiveStepLedger();
  [ledger.records[0], ledger.records[1]] = [ledger.records[1], ledger.records[0]];
  assert.throws(() => validateCognitiveStepLedger(ledger), /record order is invalid/i);
});
