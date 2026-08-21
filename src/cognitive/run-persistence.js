import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { invariant } from "../contracts.js";
import { sha256 } from "../core/hash.js";
import { EphemeralRunStore } from "./run-store.js";
import { validateCognitiveStepLedger } from "./orchestration.js";

export const DURABLE_RUN_STATE_VERSION = "durable-run-state-1.0.0";

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function assertProviderPacketIsSafe(unit) {
  invariant(!unit.media?.data, `Durable orchestration cannot persist media bytes: ${unit.id}`);
  const derivedSafeSummary = unit.derivation?.rawContentIncluded === false;
  const approvedIntakeDeclaration = unit.evidenceKind === "DECLARATION" && unit.path === "intended-use-dossier.json";
  const purged = unit.transmissionState === "PURGED" && unit.content === "";
  invariant(derivedSafeSummary || approvedIntakeDeclaration || purged, `Durable orchestration cannot persist a non-summary source unit: ${unit.id}`);
}

export function serializeDurableRun(run, now = new Date()) {
  invariant(run?.id && run.createdAt && run.expiresAt, "A valid run is required for durable serialization");
  if (run.stepLedger) validateCognitiveStepLedger(run.stepLedger);
  const durableRun = structuredClone(run);
  durableRun.localSourceUnits = [];
  delete durableRun.persistence;
  for (const packet of durableRun.packets ?? []) {
    for (const unit of packet.sourceUnits ?? []) {
      if (unit.media) unit.media.data = "";
      if (unit.evidenceKind === "DERIVED_MODEL_OUTPUT") {
        unit.content = "";
        unit.transmissionState = "PURGED";
        unit.durableContentState = "MODEL_DERIVED_CONTENT_EXCLUDED";
      }
      assertProviderPacketIsSafe(unit);
    }
  }
  if (run.status === "AWAITING_INTAKE_CONFIRMATION") {
    durableRun.dossier = null;
    durableRun.solutionProfile = null;
    durableRun.discoveryRecheck = null;
    durableRun.registeredSources = [];
    durableRun.dlpFindings = [];
    durableRun.sourceIngestion = {
      version: run.sourceIngestion?.version,
      acquisitionContractVersion: run.sourceIngestion?.acquisitionContractVersion,
      coverageStatus: run.sourceIngestion?.coverageStatus,
      manifestHash: run.sourceIngestion?.manifestHash,
      recoveryState: "RAW_EVIDENCE_REUPLOAD_REQUIRED"
    };
  }
  const payload = {
    schemaVersion: DURABLE_RUN_STATE_VERSION,
    checkpointedAt: now.toISOString(),
    run: durableRun
  };
  return { ...payload, stateHash: sha256(payload) };
}

export function deserializeDurableRun(envelope) {
  invariant(envelope?.schemaVersion === DURABLE_RUN_STATE_VERSION, "Durable run state version is unsupported");
  invariant(typeof envelope.stateHash === "string", "Durable run state hash is required");
  const { stateHash, ...payload } = envelope;
  invariant(sha256(payload) === stateHash, "Durable run state failed its integrity check");
  invariant(payload.run?.id && Array.isArray(payload.run.localSourceUnits) && payload.run.localSourceUnits.length === 0, "Durable run state contains invalid local evidence");
  const run = structuredClone(payload.run);
  if (run.stepLedger) validateCognitiveStepLedger(run.stepLedger);
  if (run.approvedIntake) deepFreeze(run.approvedIntake);
  run.persistence = { recovered: true, checkpointedAt: payload.checkpointedAt, rawEvidenceAvailable: false };
  if (run.status === "AWAITING_INTAKE_CONFIRMATION") {
    run.status = "RECOVERY_REQUIRES_REUPLOAD";
    run.stage = "RAW_EVIDENCE_UNAVAILABLE_AFTER_RECOVERY";
    run.error = "The durable checkpoint excludes raw evidence. Re-upload source material to create a new Intake draft.";
  } else if (run.status === "RUNNING") {
    run.status = "INTERRUPTED";
    run.stage = "RECOVERY_REQUIRES_USER_RESTART";
    run.error = "Execution was interrupted before a terminal checkpoint. It was not resumed automatically to avoid duplicate provider calls.";
  } else if (run.status === "QUEUED" && run.executionDataAffinity?.reason === "MEMORY_ONLY_MEDIA") {
    run.status = "RECOVERY_REQUIRES_REUPLOAD";
    run.stage = "RECOVERY_MEDIA_REUPLOAD_REQUIRED";
    run.failureCode = "RAW_EVIDENCE_REUPLOAD_REQUIRED";
    run.retryDisposition = "REQUIRES_NEW_INTAKE";
    run.error = "The queued run required memory-only media from its original worker. Re-upload evidence to create a new Intake run.";
  }
  return run;
}

function purgeRunMaterial(run, status) {
  run.cancelled = true;
  for (const packet of run.packets ?? []) {
    for (const unit of packet.sourceUnits ?? []) {
      unit.content = "";
      if (unit.media) unit.media.data = "";
      unit.transmissionState = "PURGED";
    }
    packet.transmissionState = "PURGED";
  }
  for (const unit of run.localSourceUnits ?? []) {
    unit.content = "";
    if (unit.media) unit.media.data = "";
    unit.transmissionState = "PURGED";
  }
  run.status = status;
}

export class PostgresRunStore {
  constructor(options) {
    invariant(options?.pool?.query, "PostgresRunStore requires a query pool");
    this.pool = options.pool;
    this.kind = "POSTGRESQL";
    this.ownsPool = options.ownsPool === true;
    this.now = options.now ?? (() => new Date());
    this.instanceId = options.instanceId ?? randomUUID();
    this.leaseMs = options.leaseMs ?? 20 * 60 * 1000;
    this.runs = new Map();
  }

  async initialize() {
    const migration = await readFile(new URL("../../db/migrations/001_governance_runs.sql", import.meta.url), "utf8");
    await this.pool.query(migration);
    return this;
  }

  async create(run) {
    const state = serializeDurableRun(run, this.now());
    await this.pool.query(
      "INSERT INTO governance_runs (id, state, status, stage, expires_at) VALUES ($1, $2::jsonb, $3, $4, $5)",
      [run.id, JSON.stringify(state), run.status, run.stage, run.expiresAt]
    );
    run.persistence = { recovered: false, checkpointedAt: state.checkpointedAt, rawEvidenceAvailable: true, durableVersion: 1 };
    this.runs.set(run.id, run);
    return run;
  }

  async get(id) {
    const active = this.runs.get(id);
    if (active) {
      if (Date.parse(active.expiresAt) <= this.now().getTime()) { await this.purge(id, "EXPIRED"); return null; }
      return active;
    }
    const result = await this.pool.query(
      "SELECT state, version FROM governance_runs WHERE id = $1 AND deleted_at IS NULL AND expires_at > $2",
      [id, this.now().toISOString()]
    );
    if (!result.rows.length) return null;
    const run = deserializeDurableRun(result.rows[0].state);
    run.persistence.durableVersion = Number(result.rows[0].version);
    this.runs.set(id, run);
    return run;
  }

  async checkpoint(run, options = {}) {
    const expectedVersion = run.persistence?.durableVersion;
    invariant(Number.isInteger(expectedVersion) && expectedVersion > 0, `Durable run version is unavailable: ${run.id}`);
    const state = serializeDurableRun(run, this.now());
    const parameters = [run.id, JSON.stringify(state), run.status, run.stage, run.expiresAt, expectedVersion];
    let leaseClause = "";
    if (options.leaseOwner) { parameters.push(options.leaseOwner); leaseClause = ` AND lease_owner = $${parameters.length}`; }
    const result = await this.pool.query(
      `UPDATE governance_runs SET state = $2::jsonb, status = $3, stage = $4, expires_at = $5, version = version + 1, updated_at = NOW() WHERE id = $1 AND deleted_at IS NULL AND version = $6${leaseClause} RETURNING version`,
      parameters
    );
    if (result.rowCount !== 1) this.runs.delete(run.id);
    invariant(result.rowCount === 1, `Durable run checkpoint was rejected: ${run.id}`);
    run.persistence = { ...run.persistence, checkpointedAt: state.checkpointedAt, durableVersion: Number(result.rows[0].version) };
    this.runs.set(run.id, run);
    return run;
  }

  async acquireLease(id) {
    const now = this.now();
    const leaseExpiresAt = new Date(now.getTime() + this.leaseMs).toISOString();
    const expectedVersion = this.runs.get(id)?.persistence?.durableVersion;
    const versionClause = Number.isInteger(expectedVersion) ? " AND version = $5" : "";
    const parameters = [id, this.instanceId, leaseExpiresAt, now.toISOString()];
    if (versionClause) parameters.push(expectedVersion);
    const result = await this.pool.query(
      `UPDATE governance_runs SET lease_owner = $2, lease_expires_at = $3, updated_at = NOW() WHERE id = $1 AND deleted_at IS NULL AND expires_at > $4${versionClause} AND (lease_owner IS NULL OR lease_expires_at <= $4 OR lease_owner = $2) RETURNING id`,
      parameters
    );
    if (result.rowCount !== 1 && versionClause) this.runs.delete(id);
    return result.rowCount === 1;
  }

  async renewLease(id) {
    const leaseExpiresAt = new Date(this.now().getTime() + this.leaseMs).toISOString();
    const result = await this.pool.query(
      "UPDATE governance_runs SET lease_expires_at = $3, updated_at = NOW() WHERE id = $1 AND deleted_at IS NULL AND lease_owner = $2 RETURNING id",
      [id, this.instanceId, leaseExpiresAt]
    );
    return result.rowCount === 1;
  }

  async releaseLease(id) {
    await this.pool.query(
      "UPDATE governance_runs SET lease_owner = NULL, lease_expires_at = NULL, updated_at = NOW() WHERE id = $1 AND lease_owner = $2",
      [id, this.instanceId]
    );
  }

  async claimNextQueued() {
    const now = this.now();
    const leaseExpiresAt = new Date(now.getTime() + this.leaseMs).toISOString();
    const result = await this.pool.query(
      `WITH candidate AS (
        SELECT id FROM governance_runs
        WHERE status = 'QUEUED' AND deleted_at IS NULL AND expires_at > $3
          AND (lease_owner IS NULL OR lease_expires_at <= $3)
        ORDER BY updated_at, id
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE governance_runs AS runs
      SET lease_owner = $1, lease_expires_at = $2, updated_at = NOW()
      FROM candidate
      WHERE runs.id = candidate.id
      RETURNING runs.id, runs.state, runs.version`,
      [this.instanceId, leaseExpiresAt, now.toISOString()]
    );
    if (!result.rows.length) return null;
    const row = result.rows[0];
    const active = this.runs.get(row.id);
    if (active?.persistence?.durableVersion === Number(row.version)) return active;
    const run = deserializeDurableRun(row.state);
    run.persistence.durableVersion = Number(row.version);
    this.runs.set(run.id, run);
    return run;
  }

  async purge(id, reason = "USER_REQUEST") {
    const run = this.runs.get(id) ?? await this.get(id);
    if (!run) return false;
    purgeRunMaterial(run, reason);
    const result = await this.pool.query(
      "UPDATE governance_runs SET state = NULL, status = $2, stage = $2, deleted_at = NOW(), updated_at = NOW(), lease_owner = NULL, lease_expires_at = NULL WHERE id = $1 AND deleted_at IS NULL",
      [id, reason]
    );
    this.runs.delete(id);
    return result.rowCount === 1;
  }

  async releaseRawEvidence(run, options = {}) {
    purgeRunMaterial(run, run.status);
    run.cancelled = false;
    if (options.checkpoint !== false) await this.checkpoint(run, options);
  }

  async close() { if (this.ownsPool) await this.pool.end(); }
}

export async function createRunStore(options = {}) {
  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL;
  if (!databaseUrl) return new EphemeralRunStore(options);
  const { Pool } = await import("pg");
  const pool = options.pool ?? new Pool({ connectionString: databaseUrl, max: 10 });
  const configuredLeaseMs = Number(process.env.COGNITIVE_RUN_LEASE_MS);
  const leaseMs = options.leaseMs ?? (Number.isFinite(configuredLeaseMs) && configuredLeaseMs > 0 ? configuredLeaseMs : undefined);
  return new PostgresRunStore({ ...options, pool, leaseMs, ownsPool: !options.pool }).initialize();
}
