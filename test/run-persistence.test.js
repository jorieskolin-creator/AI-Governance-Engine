import test from "node:test";
import assert from "node:assert/strict";
import { validateDossier } from "../src/contracts.js";
import { createPreflight, confirmPreflightDossier, publicPreflightView } from "../src/cognitive/preflight.js";
import { createIntakeResolutionDraft } from "../src/intake/contracts.js";
import { releaseLocalEvidenceForCognitiveExecution } from "../src/cognitive/orchestration.js";
import { deserializeDurableRun, PostgresRunStore, serializeDurableRun } from "../src/cognitive/run-persistence.js";
import { EphemeralRunStore } from "../src/cognitive/run-store.js";

class FakePool {
  constructor(now = () => new Date()) { this.rows = new Map(); this.lease = new Map(); this.now = now; }
  async query(sql, parameters = []) {
    const normalized = sql.replace(/\s+/g, " ").trim();
    if (normalized.startsWith("CREATE ")) return { rowCount: 0, rows: [] };
    if (normalized.startsWith("WITH candidate AS")) {
      const candidate = [...this.rows.entries()]
        .filter(([, row]) => row.status === "QUEUED" && !row.deleted && Date.parse(row.expiresAt) > Date.parse(parameters[2]))
        .filter(([id]) => !this.lease.has(id) || Date.parse(this.lease.get(id).expiresAt) <= Date.parse(parameters[2]))
        .sort(([left], [right]) => left.localeCompare(right))[0];
      if (!candidate) return { rowCount: 0, rows: [] };
      const [id, row] = candidate;
      this.lease.set(id, { owner: parameters[0], expiresAt: parameters[1] });
      return { rowCount: 1, rows: [{ id, state: structuredClone(row.state), version: row.version }] };
    }
    if (normalized.startsWith("INSERT INTO governance_runs")) {
      if (this.rows.has(parameters[0])) throw new Error("duplicate key");
      this.rows.set(parameters[0], { state: JSON.parse(parameters[1]), status: parameters[2], stage: parameters[3], expiresAt: parameters[4], deleted: false, version: 1 });
      return { rowCount: 1, rows: [] };
    }
    if (normalized.startsWith("SELECT state")) {
      const row = this.rows.get(parameters[0]);
      return row && !row.deleted && Date.parse(row.expiresAt) > Date.parse(parameters[1]) ? { rowCount: 1, rows: [{ state: structuredClone(row.state), version: row.version }] } : { rowCount: 0, rows: [] };
    }
    if (normalized.includes("SET state = $2::jsonb")) {
      const row = this.rows.get(parameters[0]);
      const expectedVersion = parameters[5];
      const requiredLease = parameters[6];
      if (!row || row.deleted || row.version !== expectedVersion || requiredLease && this.lease.get(parameters[0])?.owner !== requiredLease) return { rowCount: 0, rows: [] };
      Object.assign(row, { state: JSON.parse(parameters[1]), status: parameters[2], stage: parameters[3], expiresAt: parameters[4], version: row.version + 1 });
      return { rowCount: 1, rows: [{ version: row.version }] };
    }
    if (normalized.includes("SET lease_owner = $2")) {
      const row = this.rows.get(parameters[0]);
      const lease = this.lease.get(parameters[0]);
      const expectedVersion = parameters[4];
      if (!row || row.deleted || Date.parse(row.expiresAt) <= Date.parse(parameters[3]) || expectedVersion !== undefined && row.version !== expectedVersion || lease && lease.owner !== parameters[1] && Date.parse(lease.expiresAt) > Date.parse(parameters[3])) return { rowCount: 0, rows: [] };
      this.lease.set(parameters[0], { owner: parameters[1], expiresAt: parameters[2] });
      return { rowCount: 1, rows: [{ id: parameters[0] }] };
    }
    if (normalized.includes("SET lease_owner = NULL")) {
      if (this.lease.get(parameters[0])?.owner === parameters[1]) this.lease.delete(parameters[0]);
      return { rowCount: 1, rows: [] };
    }
    if (normalized.includes("SET lease_expires_at = $3")) {
      const lease = this.lease.get(parameters[0]);
      if (!lease || lease.owner !== parameters[1]) return { rowCount: 0, rows: [] };
      lease.expiresAt = parameters[2];
      return { rowCount: 1, rows: [{ id: parameters[0] }] };
    }
    if (normalized.includes("SET state = NULL")) {
      const row = this.rows.get(parameters[0]); if (!row || row.deleted) return { rowCount: 0, rows: [] };
      row.deleted = true; row.state = null; row.status = parameters[1]; this.lease.delete(parameters[0]);
      return { rowCount: 1, rows: [] };
    }
    throw new Error(`Unexpected SQL in test: ${normalized}`);
  }
}

test("durable run checkpoints exclude raw evidence and fail closed under tampering", async () => {
  const rawMarker = "private-source-value-must-not-be-persisted";
  const run = await createPreflight({ sources: [{ path: "private.md", mimeType: "text/markdown", content: `Intended purpose: ${rawMarker}` }] });
  assert.match(run.localSourceUnits.map((unit) => unit.content).join("\n"), new RegExp(rawMarker));

  const envelope = serializeDurableRun(run, new Date("2026-08-21T12:00:00.000Z"));
  assert.doesNotMatch(JSON.stringify(envelope), new RegExp(rawMarker));
  assert.deepEqual(envelope.run.localSourceUnits, []);
  assert.equal(envelope.run.dossier, null);
  assert.equal(envelope.run.acquisitionDiagnostics, null);
  assert.ok(envelope.run.packets.flatMap((packet) => packet.sourceUnits).every((unit) => unit.derivation?.rawContentIncluded === false));

  const recovered = deserializeDurableRun(envelope);
  assert.equal(recovered.status, "RECOVERY_REQUIRES_REUPLOAD");
  assert.equal(recovered.persistence.rawEvidenceAvailable, false);
  assert.doesNotThrow(() => publicPreflightView(recovered));
  assert.equal(publicPreflightView(recovered).sourceIngestion.recoveryState, "RAW_EVIDENCE_REUPLOAD_REQUIRED");

  const tampered = structuredClone(envelope); tampered.run.stage = "COMPLETED";
  assert.throws(() => deserializeDurableRun(tampered), /integrity check/i);

  const unsafe = structuredClone(run);
  unsafe.packets[0].sourceUnits[0] = { ...unsafe.packets[0].sourceUnits[0], derivation: undefined, content: rawMarker };
  assert.throws(() => serializeDurableRun(unsafe), /non-summary source unit/i);

  const transientMedia = structuredClone(run);
  transientMedia.packets[0].sourceUnits[0].media = { mimeType: "image/png", data: rawMarker };
  const mediaEnvelope = serializeDurableRun(transientMedia);
  assert.doesNotMatch(JSON.stringify(mediaEnvelope), new RegExp(rawMarker));
  assert.equal(mediaEnvelope.run.packets[0].sourceUnits[0].media.data, "");

  const modelDerived = structuredClone(run.packets[0].sourceUnits[0]);
  modelDerived.id = "derived-model-unit";
  modelDerived.evidenceKind = "DERIVED_MODEL_OUTPUT";
  modelDerived.derivation = { type: "MODEL_MULTIMODAL_EXTRACTION" };
  modelDerived.content = rawMarker;
  transientMedia.packets[0].sourceUnits.push(modelDerived);
  const derivedEnvelope = serializeDurableRun(transientMedia);
  const persistedDerived = derivedEnvelope.run.packets[0].sourceUnits.find((unit) => unit.id === modelDerived.id);
  assert.equal(persistedDerived.content, "");
  assert.equal(persistedDerived.durableContentState, "MODEL_DERIVED_CONTENT_EXCLUDED");
});

test("approved Intake checkpoints recover without raw evidence and retain user approval", async () => {
  const run = await createPreflight({ sources: [{ path: "case.md", mimeType: "text/markdown", content: "Solution name: Governance Assistant" }] });
  const dossier = validateDossier(run.solutionProfile.suggestedDossier);
  await confirmPreflightDossier(run, {
    dossier,
    resolutions: createIntakeResolutionDraft(dossier, run.solutionProfile),
    approval: { confirmed: true, actorRef: "TEST_USER" }
  });

  const recovered = deserializeDurableRun(serializeDurableRun(run));
  assert.equal(recovered.status, "AWAITING_TRANSMISSION_APPROVAL");
  assert.equal(recovered.stage, "INTAKE_CONFIRMED");
  assert.equal(recovered.approvedIntake.approval.authority, "USER_ONLY");
  assert.equal(Object.isFrozen(recovered.approvedIntake), true);
  assert.deepEqual(recovered.localSourceUnits, []);
});

test("Postgres run leases are exclusive and recovered in-progress work never auto-resumes", async () => {
  const pool = new FakePool();
  const first = await new PostgresRunStore({ pool, instanceId: "worker-a" }).initialize();
  const run = await createPreflight({ sources: [{ path: "case.md", mimeType: "text/markdown", content: "# Case" }] });
  await first.create(run);
  assert.equal(await first.acquireLease(run.id), true);
  assert.equal(await first.renewLease(run.id), true);

  const second = new PostgresRunStore({ pool, instanceId: "worker-b" });
  await second.get(run.id);
  assert.equal(await second.acquireLease(run.id), false);
  assert.equal(await second.renewLease(run.id), false);
  await first.releaseLease(run.id);
  assert.equal(await second.acquireLease(run.id), true);
  await second.releaseLease(run.id);

  run.status = "RUNNING"; run.stage = "SOLUTION_UNDERSTANDING";
  await first.checkpoint(run);
  first.runs.clear();
  const recovered = await first.get(run.id);
  assert.equal(recovered.status, "INTERRUPTED");
  assert.equal(recovered.stage, "RECOVERY_REQUIRES_USER_RESTART");
  assert.match(recovered.error, /not resumed automatically/i);
});

test("Postgres checkpoints reject stale writers and the stale cache is discarded", async () => {
  const pool = new FakePool();
  const first = await new PostgresRunStore({ pool, instanceId: "worker-a" }).initialize();
  const second = new PostgresRunStore({ pool, instanceId: "worker-b" });
  const run = await createPreflight({ sources: [{ path: "case.md", mimeType: "text/markdown", content: "# Case" }] });
  await first.create(run);
  const stale = await second.get(run.id);

  run.stage = "FIRST_CHECKPOINT";
  await first.checkpoint(run);
  stale.stage = "STALE_CHECKPOINT";
  await assert.rejects(second.checkpoint(stale), /checkpoint was rejected/i);
  assert.equal(second.runs.has(run.id), false);
});

test("Postgres leases reject wrong owners and can be reacquired after expiry", async () => {
  let now = new Date("2026-08-21T12:00:00.000Z");
  const clock = () => new Date(now);
  const pool = new FakePool(clock);
  const first = await new PostgresRunStore({ pool, instanceId: "worker-a", now: clock, leaseMs: 1_000 }).initialize();
  const second = new PostgresRunStore({ pool, instanceId: "worker-b", now: clock, leaseMs: 1_000 });
  const run = await createPreflight({ sources: [{ path: "case.md", mimeType: "text/markdown", content: "# Case" }] }, { now, ttlMs: 60_000 });
  await first.create(run);
  const secondRun = await second.get(run.id);
  assert.equal(await first.acquireLease(run.id), true);
  secondRun.stage = "WRONG_OWNER";
  await assert.rejects(second.checkpoint(secondRun, { leaseOwner: second.instanceId }), /checkpoint was rejected/i);

  now = new Date(now.getTime() + 1_001);
  await second.get(run.id);
  assert.equal(await second.acquireLease(run.id), true);
});

test("expired and purged PostgreSQL runs are unavailable", async () => {
  let now = new Date("2026-08-21T12:00:00.000Z");
  const clock = () => new Date(now);
  const pool = new FakePool(clock);
  const store = await new PostgresRunStore({ pool, now: clock }).initialize();
  const expired = await createPreflight({ sources: [{ path: "expired.md", mimeType: "text/markdown", content: "# Case" }] }, { now, ttlMs: 1_000 });
  await store.create(expired);
  now = new Date(now.getTime() + 1_001);
  assert.equal(await store.get(expired.id), null);

  const active = await createPreflight({ sources: [{ path: "active.md", mimeType: "text/markdown", content: "# Case" }] }, { now, ttlMs: 60_000 });
  await store.create(active);
  assert.equal(await store.purge(active.id, "CANCELLED"), true);
  assert.equal(await store.get(active.id), null);
});

test("memory leases serialize mutation and are released by purge", async () => {
  const store = new EphemeralRunStore();
  const run = await createPreflight({ sources: [{ path: "case.md", mimeType: "text/markdown", content: "# Case" }] });
  store.create(run);
  assert.equal(store.acquireLease(run.id), true);
  assert.equal(store.acquireLease(run.id), false);
  assert.equal(store.purge(run.id), true);
  assert.equal(store.acquireLease(run.id), false);
  store.close();
});

test("queued runs are claimed once by memory and PostgreSQL workers", async () => {
  const memory = new EphemeralRunStore();
  const memoryRun = await createPreflight({ sources: [{ path: "memory.md", mimeType: "text/markdown", content: "# Case" }] });
  memoryRun.status = "QUEUED";
  memory.create(memoryRun);
  assert.equal(memory.claimNextQueued(), memoryRun);
  assert.equal(memory.claimNextQueued(), null);
  memory.releaseLease(memoryRun.id);
  memory.close();

  const pool = new FakePool();
  const first = await new PostgresRunStore({ pool, instanceId: "worker-a" }).initialize();
  const second = new PostgresRunStore({ pool, instanceId: "worker-b" });
  const run = await createPreflight({ sources: [{ path: "postgres.md", mimeType: "text/markdown", content: "# Case" }] });
  await first.create(run);
  run.status = "QUEUED";
  await first.checkpoint(run);
  const recoveredQueued = deserializeDurableRun(serializeDurableRun(run));
  assert.equal(recoveredQueued.status, "QUEUED");
  assert.equal((await first.claimNextQueued()).id, run.id);
  assert.equal(await second.claimNextQueued(), null);
});

test("approved image-summary work releases pixels and can be claimed by another worker", async () => {
  const pool = new FakePool();
  const first = await new PostgresRunStore({ pool, instanceId: "worker-a" }).initialize();
  const second = new PostgresRunStore({ pool, instanceId: "worker-b" });
  const rawPixels = Buffer.from("89504e470d0a1a0a00000000", "hex").toString("base64");
  const run = await createPreflight({ sources: [
    { path: "case.md", mimeType: "text/markdown", content: "# Case" },
    { path: "diagram.png", mimeType: "image/png", encoding: "base64", content: rawPixels }
  ] });
  assert.ok(run.localSourceUnits.some((unit) => unit.media?.data));
  const dossier = validateDossier(run.solutionProfile.suggestedDossier);
  await confirmPreflightDossier(run, {
    dossier,
    resolutions: createIntakeResolutionDraft(dossier, run.solutionProfile),
    approval: { confirmed: true, actorRef: "TEST_USER" }
  });
  releaseLocalEvidenceForCognitiveExecution(run, new Date("2026-08-21T12:00:00.000Z"));
  run.status = "QUEUED";
  run.stage = "COGNITIVE_EXECUTION_QUEUED";
  await first.create(run);
  assert.equal(JSON.stringify(pool.rows.get(run.id).state).includes(rawPixels), false);

  const claimed = await second.claimNextQueued();
  assert.equal(claimed.id, run.id);
  assert.equal(claimed.status, "QUEUED");
  assert.deepEqual(claimed.localSourceUnits, []);
  assert.equal(claimed.localEvidenceRelease.state, "PURGED_AFTER_INTAKE_APPROVAL");
  assert.equal(await first.claimNextQueued(), null);
});
