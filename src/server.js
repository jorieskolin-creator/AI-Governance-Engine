import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadKnowledgeSnapshot, knowledgeManifestView } from "./knowledge/provider.js";
import { SAMPLE_REQUEST } from "./sample.js";
import { validateExecutionApproval } from "./cognitive/contracts.js";
import { confirmPreflightDossier, createPreflight, publicDiscoveryView, publicPreflightView } from "./cognitive/preflight.js";
import { executeCognitiveRun } from "./cognitive/pipeline.js";
import { modelPolicy, publicModelPolicy, requiredGovernanceProviders } from "./cognitive/model-policy.js";
import { createRunStore } from "./cognitive/run-persistence.js";
import { recheckDiscovery } from "./cognitive/discovery-recheck.js";
import { sanitizeRestrictedValue } from "../public/content-policy.js";
import { INTAKE_FIELD_REGISTRY, validateQuestionnaireAgainstRegistry } from "./intake/field-registry.js";
import { validateApprovedIntakeSnapshot } from "./intake/contracts.js";
import { createAcquiredFactSelectionUnit, validateAcquiredFactPackage } from "./intake/acquired-facts.js";
import { createCognitiveStepLedger, prepareInterruptedRunRestart, recoveredExecutionDataUnavailable, RECOVERY_RESTART_PURPOSE } from "./cognitive/orchestration.js";
import { cancellationError, classifyCognitiveFailure } from "./cognitive/failure-policy.js";

const port = Number(process.env.PORT ?? 4174);
const publicDir = fileURLToPath(new URL("../public/", import.meta.url));
const allowedOrigin = process.env.ALLOWED_ORIGIN ?? `http://localhost:${port}`;
const maxBodyBytes = 25 * 1024 * 1024;
const assuranceSummaryEnabled = process.env.ASSURANCE_SUMMARY_ENABLED !== "false";
const cognitiveContractVersion = "3.1.0";
const buildRevision = process.env.RAILWAY_GIT_COMMIT_SHA ?? process.env.GIT_COMMIT_SHA ?? "local";
function positiveEnvNumber(name, fallback) {
  const value = Number(process.env[name] ?? fallback);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
const cognitiveRateLimit = positiveEnvNumber("COGNITIVE_RATE_LIMIT_PER_MINUTE", 10);
const cognitiveMaxActiveRuns = positiveEnvNumber("COGNITIVE_MAX_ACTIVE_RUNS", 2);
const cognitiveQueuePollMs = positiveEnvNumber("COGNITIVE_QUEUE_POLL_MS", 1000);
const contentTypes = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml" };

const knowledge = await loadKnowledgeSnapshot();
validateQuestionnaireAgainstRegistry(knowledge.intakeQuestionnaire);
const runStore = await createRunStore();
const defaultHeartbeatMs = Math.max(1_000, Math.min(30_000, Math.floor((runStore.leaseMs ?? 90_000) / 3)));
const cognitiveRunHeartbeatMs = positiveEnvNumber("COGNITIVE_RUN_HEARTBEAT_MS", defaultHeartbeatMs);
if (runStore.kind === "POSTGRESQL" && cognitiveRunHeartbeatMs >= runStore.leaseMs) throw new Error("COGNITIVE_RUN_HEARTBEAT_MS must be lower than COGNITIVE_RUN_LEASE_MS");
const rateWindows = new Map();
const activeExecutions = new Map();

function sendJson(response, status, value) {
  const body = JSON.stringify(sanitizeRestrictedValue(value));
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body), "Cache-Control": "no-store" });
  response.end(body);
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBodyBytes) throw Object.assign(new Error("Request exceeds 25 MB"), { statusCode: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw Object.assign(new Error("Request body must be valid JSON"), { statusCode: 400 }); }
}

function securityHeaders(response) {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Content-Security-Policy", "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'");
}

function rateAllowed(request) {
  const key = request.socket.remoteAddress ?? "unknown";
  const now = Date.now();
  const window = rateWindows.get(key);
  if (!window || now - window.startedAt >= 60_000) {
    rateWindows.set(key, { startedAt: now, count: 1 });
    return true;
  }
  window.count += 1;
  return window.count <= cognitiveRateLimit;
}

function safeFailureCode(error) {
  return classifyCognitiveFailure(error).code;
}

function startLeaseHeartbeat(run, controller) {
  let renewing = false;
  const timer = setInterval(async () => {
    if (renewing || controller.signal.aborted) return;
    renewing = true;
    try {
      if (!await runStore.renewLease(run.id)) controller.abort(cancellationError("Cognitive execution ownership was lost"));
    } catch { controller.abort(cancellationError("Cognitive execution lease renewal failed")); }
    finally { renewing = false; }
  }, cognitiveRunHeartbeatMs);
  timer.unref?.();
  return timer;
}

function automaticApproval(run, policy = modelPolicy()) {
  const providers = requiredGovernanceProviders(policy);
  return validateExecutionApproval({ approvedPackets: run.packets.map((packet) => ({ packetId: packet.id, providers })) }, run);
}

async function enqueueCognitiveRun(run, request) {
  if (!rateAllowed(request)) throw Object.assign(new Error("Cognitive assessment rate limit exceeded"), { statusCode: 429 });
  if (run.status !== "AWAITING_TRANSMISSION_APPROVAL") throw Object.assign(new Error(`Run cannot execute from status ${run.status}`), { statusCode: 409 });
  if (run.stage !== "INTAKE_CONFIRMED" || !run.approvedIntake?.snapshotHash) throw Object.assign(new Error("A user-approved immutable Intake snapshot is required before execution"), { statusCode: 409 });
  try { validateApprovedIntakeSnapshot(run.approvedIntake, { acquisitionManifestHash: run.sourceIngestion.manifestHash }); }
  catch (error) { throw Object.assign(error, { statusCode: 409 }); }
  const blocking = run.dlpFindings.filter((item) => item.blocking);
  if (blocking.length) throw Object.assign(new Error("Preflight contains evidence that cannot be safely transmitted"), { statusCode: 400, blockingFindingIds: blocking.map((item) => item.id) });
  const policy = modelPolicy();
  let approval;
  try { approval = automaticApproval(run, policy); }
  catch (error) {
    error.statusCode ??= 503;
    error.failureCode ??= safeFailureCode(error);
    throw error;
  }
  if (!await runStore.acquireLease(run.id)) throw Object.assign(new Error("Run execution is already owned by another worker"), { statusCode: 409 });
  run.dossier = structuredClone(run.approvedIntake.effectiveDossier);
  run.solutionProfile = structuredClone(run.approvedIntake.solutionProfile);
  run.approval = approval;
  run.stepLedger = createCognitiveStepLedger();
  run.queueAttempt = (run.queueAttempt ?? 0) + 1;
  if (runStore.instanceId && run.localSourceUnits.some((unit) => unit.media?.data)) {
    run.executionDataAffinity = { owner: runStore.instanceId, reason: "MEMORY_ONLY_MEDIA" };
  }
  for (const packet of run.packets) packet.transmissionState = "APPROVED";
  run.status = "QUEUED";
  run.stage = "COGNITIVE_EXECUTION_QUEUED";
  run.trace.push({ stage: run.stage, status: "QUEUED", at: new Date().toISOString() });
  try { await runStore.checkpoint(run, { leaseOwner: runStore.instanceId }); }
  catch (error) { await runStore.releaseLease(run.id); throw error; }
  await runStore.releaseLease(run.id);
}

async function startClaimedCognitiveRun(run) {
  if (recoveredExecutionDataUnavailable(run)) {
    run.status = "RECOVERY_REQUIRES_REUPLOAD";
    run.stage = "RECOVERY_MEDIA_REUPLOAD_REQUIRED";
    run.failureCode = "RAW_EVIDENCE_REUPLOAD_REQUIRED";
    run.retryDisposition = "REQUIRES_NEW_INTAKE";
    run.error = "The queued run requires memory-only media that is unavailable after recovery. Re-upload evidence to create a new Intake run.";
    await runStore.checkpoint(run, { leaseOwner: runStore.instanceId });
    await runStore.releaseLease(run.id);
    return;
  }
  const policy = modelPolicy();
  run.status = "RUNNING";
  run.stage = "COGNITIVE_EXECUTION_STARTING";
  run.executionStartedAt = new Date().toISOString();
  run.trace.push({ stage: run.stage, status: "RUNNING", at: run.executionStartedAt, queueAttempt: run.queueAttempt });
  try { await runStore.checkpoint(run, { leaseOwner: runStore.instanceId }); }
  catch (error) { await runStore.releaseLease(run.id); throw error; }
  const controller = new AbortController();
  const heartbeat = startLeaseHeartbeat(run, controller);
  activeExecutions.set(run.id, controller);
  void (async () => {
    let cancelled = false;
    try {
      await executeCognitiveRun(run, {
        knowledge,
        policy,
        signal: controller.signal,
        onCheckpoint: async () => {
          if (!await runStore.renewLease(run.id)) throw Object.assign(new Error("Cognitive execution lease could not be renewed"), { failureCode: "ORCHESTRATION_LEASE_LOST", fatal: true });
          await runStore.checkpoint(run, { leaseOwner: runStore.instanceId });
        },
        domainConcurrency: positiveEnvNumber("COGNITIVE_MAX_CONCURRENCY", 3),
        budgets: {
          maxCalls: positiveEnvNumber("COGNITIVE_MAX_CALLS_PER_RUN", 180),
          maxTokens: positiveEnvNumber("COGNITIVE_MAX_TOKENS_PER_RUN", 1500000),
          maxMs: positiveEnvNumber("COGNITIVE_MAX_RUN_MS", 900000)
        }
      });
    } catch (error) {
      const failure = classifyCognitiveFailure(error);
      cancelled = failure.code === "RUN_CANCELLED" || run.cancelled;
      run.status = cancelled ? "CANCELLED" : "FAILED";
      run.stage = run.status;
      run.failureCode = failure.code;
      run.retryDisposition = failure.retryDisposition;
      run.error = cancelled ? "Cognitive analysis was cancelled." : "Cognitive analysis could not complete safely.";
      run.trace.push({ stage: run.stage, status: run.status, at: new Date().toISOString(), failureCode: run.failureCode, retryDisposition: run.retryDisposition, error: run.error });
    }
    try { await runStore.releaseRawEvidence(run, cancelled ? { checkpoint: false } : { leaseOwner: runStore.instanceId }); }
    catch {
      if (!cancelled) {
        run.status = "FAILED"; run.stage = "DURABLE_CHECKPOINT_FAILED"; run.failureCode = "ORCHESTRATION_CHECKPOINT_FAILED";
        run.retryDisposition = "REVIEW_REQUIRED";
        run.error = "The terminal run state could not be durably checkpointed.";
      }
    }
    clearInterval(heartbeat);
    activeExecutions.delete(run.id);
    try { await runStore.releaseLease(run.id); }
    catch { /* The lease expires automatically; terminal state already failed closed above. */ }
  })();
}

let dispatchingQueue = false;
async function dispatchQueuedRuns() {
  if (dispatchingQueue) return;
  dispatchingQueue = true;
  try {
    while (activeExecutions.size < cognitiveMaxActiveRuns) {
      const run = await runStore.claimNextQueued();
      if (!run) break;
      try { await startClaimedCognitiveRun(run); }
      catch (error) {
        try { await runStore.releaseLease(run.id); } catch { /* The lease expires automatically. */ }
        throw error;
      }
    }
  } finally { dispatchingQueue = false; }
}

function publicRunView(run) {
  const domainProgress = Object.fromEntries(Object.keys({ A: 1, B: 1, C: 1, D: 1, E: 1, F: 1 }).map((domain) => {
    const latest = run.trace.filter((item) => item.stage === `DOMAIN_${domain}`).at(-1);
    return [domain, latest ? { status: latest.status, claimCount: latest.claimCount ?? null, coverage: latest.coverage ?? null, error: latest.error ?? null } : { status: "PENDING", claimCount: null, coverage: null, error: null }];
  }));
  return {
    runId: run.id, status: run.status, stage: run.stage, createdAt: run.createdAt, expiresAt: run.expiresAt,
    completedAt: run.completedAt ?? null, resultAvailable: Boolean(run.result), error: run.error, failureCode: run.failureCode ?? null, retryDisposition: run.retryDisposition ?? null,
    queueAttempt: run.queueAttempt ?? 0,
    recovery: run.status === "INTERRUPTED" ? { restartEligible: !recoveredExecutionDataUnavailable(run), purpose: RECOVERY_RESTART_PURPOSE, requiresExplicitUserAcknowledgement: true } : null,
    solutionProfile: run.solutionProfile,
    stepLedger: run.stepLedger ? {
      schemaVersion: run.stepLedger.schemaVersion,
      records: run.stepLedger.records.map(({ step, sequence, status, attempt, startedAt, completedAt }) => ({ step, sequence, status, attempt, startedAt, completedAt }))
    } : null,
    cognitiveContractVersion: run.result?.cognitive?.contractVersion ?? cognitiveContractVersion,
    domainProgress,
    coverage: run.result?.coverageMatrix?.counts ?? null,
    publicationGate: run.result?.publicationGate?.status ?? null,
    progress: run.trace.map(({ stage, status, at, claimCount, verificationCount, adjudicatedClaimCount, lockedFindingCount, unresolvedClaimCount, coverageComplete }) => ({ stage, status, at, claimCount, verificationCount, adjudicatedClaimCount, lockedFindingCount, unresolvedClaimCount, coverageComplete }))
  };
}

async function serveStatic(pathname, response) {
  const relative = pathname === "/" ? "index.html" : pathname.slice(1);
  if (!/^[a-zA-Z0-9._/-]+$/.test(relative) || relative.includes("..")) return false;
  try {
    const body = await readFile(join(publicDir, relative));
    const cacheControl = [".html", ".js", ".css"].includes(extname(relative)) ? "no-cache" : "public, max-age=300";
    response.writeHead(200, { "Content-Type": contentTypes[extname(relative)] ?? "application/octet-stream", "Cache-Control": cacheControl });
    response.end(body);
    return true;
  } catch { return false; }
}

const server = http.createServer(async (request, response) => {
  securityHeaders(response);
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  if (request.headers.origin === allowedOrigin) {
    response.setHeader("Access-Control-Allow-Origin", allowedOrigin);
    response.setHeader("Vary", "Origin");
  }
  try {
    if (request.method === "OPTIONS" && request.headers.origin === allowedOrigin) {
      response.writeHead(204, { "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Max-Age": "600" });
      return response.end();
    }
    if (request.method === "GET" && url.pathname === "/health") {
      return sendJson(response, 200, { status: "ok", buildRevision, cognitiveContractVersion, runStore: runStore.kind, knowledge: knowledgeManifestView(knowledge) });
    }
    if (request.method === "GET" && url.pathname === "/api/sample") return sendJson(response, 200, SAMPLE_REQUEST);
    if (request.method === "GET" && url.pathname === "/api/config") return sendJson(response, 200, {
      assuranceSummaryEnabled,
      cognitiveMode: "ALWAYS_ON",
      cognitiveContractVersion,
      buildRevision,
      discoveryRecheckAvailable: true
    });
    if (request.method === "GET" && url.pathname === "/api/knowledge") return sendJson(response, 200, knowledgeManifestView(knowledge));
    if (request.method === "GET" && url.pathname === "/api/intake-questionnaire") return sendJson(response, 200, { ...knowledge.intakeQuestionnaire, source: knowledge.intakeQuestionnaireSource ?? "BUNDLED" });
    if (request.method === "GET" && url.pathname === "/api/intake-field-registry") return sendJson(response, 200, INTAKE_FIELD_REGISTRY);
    if (request.method === "GET" && url.pathname === "/api/knowledge/diagnostics") return sendJson(response, 200, knowledge.diagnostics ?? { status: "UNKNOWN", issues: [{ severity: "WARNING", code: "DIAGNOSTICS_UNAVAILABLE", message: "Knowledge diagnostics were not generated at startup.", entryIds: [] }] });
    if (request.method === "POST" && url.pathname === "/api/discover") {
      const payload = await readJson(request);
      const run = await createPreflight({ sources: payload.sources ?? [], sourceIngestion: payload.sourceIngestion });
      await runStore.create(run);
      let discoveryRecheck = { status: "NOT_REQUESTED", policy: "The deterministic Intake is returned without provider transmission. GenAI proposals require a separate explicit user request." };
      if (run.dlpFindings.some((item) => item.blocking)) {
        discoveryRecheck = { status: "BLOCKED_BY_LOCAL_DLP", policy: "AI recheck was not started because source transmission is blocked by local screening." };
        run.stage = "INTAKE_AI_VERIFICATION_BLOCKED";
        await runStore.checkpoint(run);
      }
      return sendJson(response, 200, {
        runId: run.id,
        solutionProfile: run.solutionProfile,
        sourceManifest: run.registeredSources,
        dlpFindings: run.dlpFindings,
        sourceIngestion: run.sourceIngestion,
        discoveryRecheck,
        citationIndex: run.packets.flatMap((packet) => packet.sourceUnits.map((unit) => ({ sourceUnitId: unit.id, path: unit.path, locator: unit.locator, sha256: unit.sha256 })))
      });
    }
    if (request.method === "POST" && url.pathname === "/api/assess") {
      return sendJson(response, 410, { error: "This compatibility endpoint cannot produce a confirmed Intake pipeline result. Use /api/v2/runs/preflight, /confirm and /execute." });
    }
    if (request.method === "GET" && url.pathname === "/api/v2/models") {
      return sendJson(response, 200, { mode: "ALWAYS_ON", profiles: publicModelPolicy(modelPolicy()) });
    }
    if (request.method === "POST" && url.pathname === "/api/v2/runs/preflight") {
      const run = await createPreflight(await readJson(request));
      await runStore.create(run);
      return sendJson(response, 201, publicPreflightView(run));
    }
    const discoverMatch = url.pathname.match(/^\/api\/v2\/runs\/([^/]+)\/discover$/);
    if (request.method === "POST" && discoverMatch) {
      const run = await runStore.get(discoverMatch[1]);
      return run ? sendJson(response, 200, publicDiscoveryView(run)) : sendJson(response, 404, { error: "Run not found or expired" });
    }
    const recheckMatch = url.pathname.match(/^\/api\/v2\/runs\/([^/]+)\/discover-recheck$/);
    if (request.method === "POST" && recheckMatch) {
      const run = await runStore.get(recheckMatch[1]);
      if (!run) return sendJson(response, 404, { error: "Run not found or expired" });
      if (run.status !== "AWAITING_INTAKE_CONFIRMATION" || run.stage !== "DETERMINISTIC_DISCOVERY_COMPLETED" || run.discoveryRecheck) return sendJson(response, 409, { error: "AI Intake verification is not available from the current run state" });
      const consent = await readJson(request);
      if (consent?.confirmed !== true || consent?.purpose !== "INTAKE_PROPOSALS_FROM_SAFE_SUMMARIES") return sendJson(response, 400, { error: "Explicit confirmation is required before requesting GenAI Intake proposals" });
      if (consent.acquiredFactPackageHash !== run.acquiredFacts?.packageHash) return sendJson(response, 409, { error: "The reviewed acquired fact package is no longer current" });
      validateAcquiredFactPackage(run.acquiredFacts);
      const acquiredFactUnit = createAcquiredFactSelectionUnit(run.acquiredFacts, consent.selectedAcquiredFactIds ?? []);
      if (!await runStore.acquireLease(run.id)) return sendJson(response, 409, { error: "Run mutation is already owned by another worker" });
      try {
        const blocking = run.dlpFindings.filter((item) => item.blocking);
        if (blocking.length) {
          run.stage = "INTAKE_AI_VERIFICATION_BLOCKED";
          run.discoveryRecheck = { status: "BLOCKED_BY_LOCAL_DLP", policy: "AI verification was not started because source transmission is blocked by local screening.", blockingFindingIds: blocking.map((item) => item.id) };
          run.trace.push({ stage: "INTAKE_AI_VERIFICATION", status: "BLOCKED", at: new Date().toISOString(), blockingFindingIds: blocking.map((item) => item.id) });
          await runStore.checkpoint(run, { leaseOwner: runStore.instanceId });
          return sendJson(response, 200, run.discoveryRecheck);
        }
        try {
          if (!rateAllowed(request)) throw Object.assign(new Error("Cognitive discovery rate limit exceeded"), { statusCode: 429 });
          run.trace.push({ stage: "INTAKE_AI_PROPOSAL_CONSENT", status: "CONFIRMED", purpose: consent.purpose, acquiredFactPackageHash: run.acquiredFacts.packageHash, selectedAcquiredFactIds: consent.selectedAcquiredFactIds ?? [], at: new Date().toISOString(), packetIds: run.packets.map((packet) => packet.id) });
          const discoveryRecheck = await recheckDiscovery(run, automaticApproval(run), { policy: modelPolicy(), acquiredFactUnit });
          await runStore.checkpoint(run, { leaseOwner: runStore.instanceId });
          return sendJson(response, 200, discoveryRecheck);
        } catch (error) {
          run.stage = "INTAKE_AI_VERIFICATION_UNAVAILABLE";
          run.discoveryRecheck = { status: "UNAVAILABLE", failureCode: safeFailureCode(error), policy: "The deterministic Intake draft remains available. AI candidates were not used." };
          run.trace.push({ stage: "INTAKE_AI_VERIFICATION", status: "UNAVAILABLE", at: new Date().toISOString(), failureCode: run.discoveryRecheck.failureCode });
          await runStore.checkpoint(run, { leaseOwner: runStore.instanceId });
          return sendJson(response, 200, run.discoveryRecheck);
        }
      } finally { await runStore.releaseLease(run.id); }
    }
    const confirmMatch = url.pathname.match(/^\/api\/v2\/runs\/([^/]+)\/confirm$/);
    if (request.method === "POST" && confirmMatch) {
      const run = await runStore.get(confirmMatch[1]);
      if (!run) return sendJson(response, 404, { error: "Run not found or expired" });
      if (!await runStore.acquireLease(run.id)) return sendJson(response, 409, { error: "Run mutation is already owned by another worker" });
      try {
        await confirmPreflightDossier(run, await readJson(request));
        await runStore.checkpoint(run, { leaseOwner: runStore.instanceId });
        return sendJson(response, 200, publicPreflightView(run));
      } finally { await runStore.releaseLease(run.id); }
    }
    const executeMatch = url.pathname.match(/^\/api\/v2\/runs\/([^/]+)\/execute$/);
    if (request.method === "POST" && executeMatch) {
      const run = await runStore.get(executeMatch[1]);
      if (!run) return sendJson(response, 404, { error: "Run not found or expired" });
      await enqueueCognitiveRun(run, request);
      void dispatchQueuedRuns().catch(() => {});
      return sendJson(response, 202, publicRunView(run));
    }
    const restartMatch = url.pathname.match(/^\/api\/v2\/runs\/([^/]+)\/restart$/);
    if (request.method === "POST" && restartMatch) {
      const run = await runStore.get(restartMatch[1]);
      if (!run) return sendJson(response, 404, { error: "Run not found or expired" });
      const input = await readJson(request);
      if (input?.confirmed !== true || input?.purpose !== RECOVERY_RESTART_PURPOSE || !String(input.actorRef ?? "").trim()) return sendJson(response, 400, { error: "Explicit user acknowledgement, purpose and actorRef are required for recovery restart" });
      if (run.status !== "INTERRUPTED" || run.stage !== "RECOVERY_REQUIRES_USER_RESTART") return sendJson(response, 409, { error: "Run is not eligible for controlled recovery restart" });
      if (recoveredExecutionDataUnavailable(run)) return sendJson(response, 409, { error: "Memory-only media is unavailable; re-upload evidence to create a new Intake run" });
      if (!await runStore.acquireLease(run.id)) return sendJson(response, 409, { error: "Run recovery is already owned by another worker" });
      try {
        prepareInterruptedRunRestart(run, input);
        await runStore.checkpoint(run, { leaseOwner: runStore.instanceId });
      } finally { await runStore.releaseLease(run.id); }
      void dispatchQueuedRuns().catch(() => {});
      return sendJson(response, 202, publicRunView(run));
    }
    const resultMatch = url.pathname.match(/^\/api\/v2\/runs\/([^/]+)\/result$/);
    if (request.method === "GET" && resultMatch) {
      const run = await runStore.get(resultMatch[1]);
      if (!run) return sendJson(response, 404, { error: "Run not found or expired" });
      if (!run.result) return sendJson(response, 409, { error: `Result is unavailable while run status is ${run.status}` });
      return sendJson(response, 200, run.result);
    }
    const runMatch = url.pathname.match(/^\/api\/v2\/runs\/([^/]+)$/);
    if (request.method === "GET" && runMatch) {
      const run = await runStore.get(runMatch[1]);
      return run ? sendJson(response, 200, publicRunView(run)) : sendJson(response, 404, { error: "Run not found or expired" });
    }
    if (request.method === "DELETE" && runMatch) {
      activeExecutions.get(runMatch[1])?.abort(cancellationError("Cognitive run was cancelled by the user"));
      return await runStore.purge(runMatch[1], "CANCELLED") ? sendJson(response, 200, { status: "PURGED" }) : sendJson(response, 404, { error: "Run not found or expired" });
    }
    if (request.method === "GET" && await serveStatic(url.pathname, response)) return;
    sendJson(response, 404, { error: "Not found" });
  } catch (error) {
    const status = error.statusCode ?? 500;
    sendJson(response, status, {
      error: status === 500 ? "Assessment failed safely" : error.message,
      failureCode: error.failureCode ?? (status === 500 ? safeFailureCode(error) : undefined),
      detail: process.env.NODE_ENV === "production" ? undefined : error.message
    });
  }
});

server.listen(port, "0.0.0.0", () => console.log(`AI Governance Engine listening on ${port}`));
const queueTimer = setInterval(() => { void dispatchQueuedRuns().catch(() => {}); }, cognitiveQueuePollMs);
queueTimer.unref?.();
void dispatchQueuedRuns().catch(() => {});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    clearInterval(queueTimer);
    for (const controller of activeExecutions.values()) controller.abort(cancellationError(`Cognitive run interrupted by ${signal}`));
    server.close(async () => { await runStore.close(); process.exit(0); });
  });
}
