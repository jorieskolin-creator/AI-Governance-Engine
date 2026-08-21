import test from "node:test";
import assert from "node:assert/strict";
import {
  COGNITIVE_STEP_SEQUENCE,
  completeCognitiveStep,
  createCognitiveStepLedger,
  prepareInterruptedRunRestart,
  recoveredExecutionDataUnavailable,
  RECOVERY_RESTART_PURPOSE,
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

test("interrupted recovery requires explicit acknowledgement and rejects unavailable media", () => {
  const ledger = createCognitiveStepLedger(new Date("2026-08-21T12:00:00.000Z"));
  completeCognitiveStep(ledger, "MULTIMODAL_EXTRACTION", "SKIPPED");
  startCognitiveStep(ledger, "SOLUTION_UNDERSTANDING");
  const run = {
    status: "INTERRUPTED",
    stage: "RECOVERY_REQUIRES_USER_RESTART",
    approvedIntake: { snapshotHash: "approved" },
    persistence: { rawEvidenceAvailable: false },
    packets: [{ transmissionState: "APPROVED", sourceUnits: [{ transmissionState: "APPROVED", content: "safe summary" }] }],
    stepLedger: ledger,
    queueAttempt: 1,
    executionStartedAt: "2026-08-21T12:01:00.000Z",
    transmissionManifest: [{ id: "transmission-1", provider: "OPENAI", packetIds: ["packet-1"] }],
    trace: []
  };
  assert.throws(() => prepareInterruptedRunRestart(structuredClone(run), { confirmed: false }), /acknowledgement/i);
  const mediaRun = structuredClone(run);
  mediaRun.packets[0].sourceUnits[0].media = { mimeType: "image/png", data: "" };
  assert.equal(recoveredExecutionDataUnavailable(mediaRun), true);
  assert.throws(() => prepareInterruptedRunRestart(mediaRun, { confirmed: true, purpose: RECOVERY_RESTART_PURPOSE, actorRef: "user" }), /re-upload/i);

  const restarted = prepareInterruptedRunRestart(run, { confirmed: true, purpose: RECOVERY_RESTART_PURPOSE, actorRef: "USER_1" }, new Date("2026-08-21T12:05:00.000Z"));
  assert.equal(restarted.status, "QUEUED");
  assert.equal(restarted.queueAttempt, 2);
  assert.equal(restarted.executionAttemptHistory[0].interruptedStep, "SOLUTION_UNDERSTANDING");
  assert.equal(restarted.executionAttemptHistory[0].transmissionManifest[0].id, "transmission-1");
  assert.ok(restarted.stepLedger.records.every((record) => record.status === "PENDING"));
  assert.equal(restarted.trace.at(-1).status, "REQUEUED_BY_USER");
});
