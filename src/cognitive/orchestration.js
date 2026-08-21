import { invariant } from "../contracts.js";
import { sanitizeRestrictedText } from "../../public/content-policy.js";

export const COGNITIVE_STEP_LEDGER_VERSION = "cognitive-step-ledger-1.0.0";
export const RECOVERY_RESTART_PURPOSE = "RESTART_INTERRUPTED_COGNITIVE_RUN_WITH_POSSIBLE_DUPLICATE_CALLS";
export const COGNITIVE_STEP_SEQUENCE = Object.freeze([
  "MULTIMODAL_EXTRACTION",
  "SOLUTION_UNDERSTANDING",
  "PACKET_ROUTING",
  "DOMAIN_ASSESSMENT",
  "EVIDENCE_VERIFICATION",
  "CONTROLLED_SYNTHESIS",
  "FINAL_FACT_CHECK"
]);

const TERMINAL_STEP_STATES = new Set(["COMPLETED", "PARTIAL", "FAILED", "SKIPPED"]);

export function createCognitiveStepLedger(now = new Date()) {
  return {
    schemaVersion: COGNITIVE_STEP_LEDGER_VERSION,
    sequence: [...COGNITIVE_STEP_SEQUENCE],
    createdAt: now.toISOString(),
    records: COGNITIVE_STEP_SEQUENCE.map((step, sequence) => ({
      step,
      sequence,
      status: "PENDING",
      attempt: 0,
      startedAt: null,
      completedAt: null,
      detail: null
    }))
  };
}

export function validateCognitiveStepLedger(ledger) {
  invariant(ledger?.schemaVersion === COGNITIVE_STEP_LEDGER_VERSION, "Cognitive step ledger version is unsupported");
  invariant(JSON.stringify(ledger.sequence) === JSON.stringify(COGNITIVE_STEP_SEQUENCE), "Cognitive step sequence is invalid");
  invariant(Array.isArray(ledger.records) && ledger.records.length === COGNITIVE_STEP_SEQUENCE.length, "Cognitive step records are incomplete");
  for (let index = 0; index < ledger.records.length; index += 1) {
    const record = ledger.records[index];
    invariant(record?.step === COGNITIVE_STEP_SEQUENCE[index] && record.sequence === index, "Cognitive step record order is invalid");
    invariant(["PENDING", "RUNNING", ...TERMINAL_STEP_STATES].includes(record.status), `Cognitive step status is invalid: ${record.step}`);
    invariant(Number.isInteger(record.attempt) && record.attempt >= 0 && record.attempt <= 1, `Cognitive step attempt is invalid: ${record.step}`);
    if (index > 0 && record.status !== "PENDING") invariant(TERMINAL_STEP_STATES.has(ledger.records[index - 1].status), `Cognitive step started out of order: ${record.step}`);
  }
  return ledger;
}

function stepRecord(ledger, step) {
  validateCognitiveStepLedger(ledger);
  const record = ledger.records.find((item) => item.step === step);
  invariant(record, `Unknown cognitive step: ${step}`);
  return record;
}

export function startCognitiveStep(ledger, step, now = new Date()) {
  const record = stepRecord(ledger, step);
  if (record.status === "RUNNING") return record;
  invariant(record.status === "PENDING", `Cognitive step cannot start from ${record.status}: ${step}`);
  if (record.sequence > 0) invariant(TERMINAL_STEP_STATES.has(ledger.records[record.sequence - 1].status), `Cognitive step predecessor is incomplete: ${step}`);
  record.status = "RUNNING";
  record.attempt = 1;
  record.startedAt = now.toISOString();
  return record;
}

export function completeCognitiveStep(ledger, step, status, detail = null, now = new Date()) {
  invariant(TERMINAL_STEP_STATES.has(status), `Cognitive step terminal status is invalid: ${status}`);
  const record = stepRecord(ledger, step);
  if (TERMINAL_STEP_STATES.has(record.status)) {
    invariant(record.status === status, `Cognitive step terminal transition conflicts: ${step}`);
    return record;
  }
  invariant(record.status === "RUNNING" || status === "SKIPPED" && record.status === "PENDING", `Cognitive step cannot complete from ${record.status}: ${step}`);
  record.status = status;
  record.completedAt = now.toISOString();
  record.detail = detail ? structuredClone(detail) : null;
  return record;
}

export function recoveredExecutionDataUnavailable(run) {
  return run.persistence?.rawEvidenceAvailable === false && (
    run.executionDataAffinity?.reason === "MEMORY_ONLY_MEDIA" ||
    run.packets?.some((packet) => packet.sourceUnits.some((unit) => unit.media && !unit.media.data || unit.durableContentState === "MODEL_DERIVED_CONTENT_EXCLUDED"))
  );
}

export function prepareInterruptedRunRestart(run, input, now = new Date()) {
  invariant(run?.status === "INTERRUPTED" && run.stage === "RECOVERY_REQUIRES_USER_RESTART", "Only an interrupted recovered run can be restarted");
  invariant(input?.confirmed === true && input.purpose === RECOVERY_RESTART_PURPOSE, "Explicit acknowledgement of possible duplicate provider calls is required");
  const actorRef = sanitizeRestrictedText(String(input.actorRef ?? "").trim());
  invariant(actorRef, "Recovery restart actorRef is required");
  invariant(run.approvedIntake?.snapshotHash, "Recovery restart requires the previously approved Intake snapshot");
  invariant(!recoveredExecutionDataUnavailable(run), "Recovery restart requires evidence re-upload because memory-only media is unavailable");
  const restartedAt = now.toISOString();
  const priorAttempt = {
    queueAttempt: run.queueAttempt ?? 1,
    executionStartedAt: run.executionStartedAt ?? null,
    interruptedStep: run.stepLedger?.records.find((record) => record.status === "RUNNING")?.step ?? null,
    stepLedger: structuredClone(run.stepLedger ?? null),
    transmissionManifest: structuredClone(run.transmissionManifest ?? [])
  };
  run.status = "QUEUED";
  run.stage = "COGNITIVE_EXECUTION_QUEUED";
  run.error = null;
  run.failureCode = null;
  run.retryDisposition = null;
  run.result = null;
  run.executionStartedAt = null;
  run.queueAttempt = (run.queueAttempt ?? 1) + 1;
  run.stepLedger = createCognitiveStepLedger(now);
  run.executionAttemptHistory = [...(run.executionAttemptHistory ?? []), priorAttempt];
  run.recoveryRestart = { confirmedAt: restartedAt, actorRef, purpose: RECOVERY_RESTART_PURPOSE, priorQueueAttempt: priorAttempt.queueAttempt };
  for (const packet of run.packets) {
    packet.transmissionState = "APPROVED";
    for (const unit of packet.sourceUnits) unit.transmissionState = "APPROVED";
  }
  run.trace.push({ stage: run.stage, status: "REQUEUED_BY_USER", at: restartedAt, actorRef, purpose: RECOVERY_RESTART_PURPOSE, queueAttempt: run.queueAttempt });
  return run;
}
