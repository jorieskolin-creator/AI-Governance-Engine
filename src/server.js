import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assessSolution } from "./engine.js";
import { loadKnowledgeSnapshot, knowledgeManifestView } from "./knowledge/provider.js";
import { SAMPLE_REQUEST } from "./sample.js";
import { validateExecutionApproval, validatePreflightInput } from "./cognitive/contracts.js";
import { confirmPreflightDossier, createPreflight, publicDiscoveryView, publicPreflightView } from "./cognitive/preflight.js";
import { parseAndScreenSources } from "./cognitive/source-intake.js";
import { discoverSolutionProfile } from "./core/solution-profile.js";
import { executeCognitiveRun } from "./cognitive/pipeline.js";
import { modelPolicy, publicModelPolicy, requiredGovernanceProviders } from "./cognitive/model-policy.js";
import { EphemeralRunStore } from "./cognitive/run-store.js";
import { buildSourceIngestionManifest } from "./core/source-ingestion.js";
import { recheckDiscovery } from "./cognitive/discovery-recheck.js";

const port = Number(process.env.PORT ?? 4174);
const publicDir = fileURLToPath(new URL("../public/", import.meta.url));
const allowedOrigin = process.env.ALLOWED_ORIGIN ?? `http://localhost:${port}`;
const maxBodyBytes = 25 * 1024 * 1024;
const assuranceSummaryEnabled = process.env.ASSURANCE_SUMMARY_ENABLED !== "false";
const cognitiveContractVersion = "3.0.0";
const buildRevision = process.env.RAILWAY_GIT_COMMIT_SHA ?? process.env.GIT_COMMIT_SHA ?? "local";
function positiveEnvNumber(name, fallback) {
  const value = Number(process.env[name] ?? fallback);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
const cognitiveRateLimit = positiveEnvNumber("COGNITIVE_RATE_LIMIT_PER_MINUTE", 10);
const contentTypes = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml" };

const knowledge = await loadKnowledgeSnapshot();
const runStore = new EphemeralRunStore();
const rateWindows = new Map();

function sendJson(response, status, value) {
  const body = JSON.stringify(value);
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
  const message = String(error?.message ?? "");
  if (/credential|required .*route|governance route/i.test(message)) return "MODEL_ROUTE_UNAVAILABLE";
  if (/budget/i.test(message)) return "COGNITIVE_BUDGET_EXHAUSTED";
  if (/refused/i.test(message)) return "PROVIDER_REFUSAL";
  if (/Provider request failed|HTTP \d+/i.test(message)) return "PROVIDER_REQUEST_FAILED";
  if (/independent|verification|adjudication/i.test(message)) return "INDEPENDENT_VERIFICATION_INCOMPLETE";
  return "COGNITIVE_RUN_FAILED";
}

function automaticApproval(run, policy = modelPolicy()) {
  const providers = requiredGovernanceProviders(policy);
  return validateExecutionApproval({ approvedPackets: run.packets.map((packet) => ({ packetId: packet.id, providers })) }, run);
}

function startCognitiveRun(run, request) {
  if (!rateAllowed(request)) throw Object.assign(new Error("Cognitive assessment rate limit exceeded"), { statusCode: 429 });
  if (run.status !== "AWAITING_TRANSMISSION_APPROVAL") throw Object.assign(new Error(`Run cannot execute from status ${run.status}`), { statusCode: 409 });
  const blocking = run.dlpFindings.filter((item) => item.blocking);
  if (blocking.length) throw Object.assign(new Error("Preflight contains evidence that cannot be safely transmitted"), { statusCode: 400, blockingFindingIds: blocking.map((item) => item.id) });
  const policy = modelPolicy();
  try { run.approval = automaticApproval(run, policy); }
  catch (error) {
    error.statusCode ??= 503;
    error.failureCode ??= safeFailureCode(error);
    throw error;
  }
  for (const packet of run.packets) packet.transmissionState = "APPROVED";
  void executeCognitiveRun(run, {
    knowledge,
    policy,
    domainConcurrency: positiveEnvNumber("COGNITIVE_MAX_CONCURRENCY", 3),
    budgets: {
      maxCalls: positiveEnvNumber("COGNITIVE_MAX_CALLS_PER_RUN", 180),
      maxTokens: positiveEnvNumber("COGNITIVE_MAX_TOKENS_PER_RUN", 1500000),
      maxMs: positiveEnvNumber("COGNITIVE_MAX_RUN_MS", 900000)
    }
  }).then(() => runStore.releaseRawEvidence(run)).catch((error) => {
    run.status = "FAILED"; run.stage = "FAILED"; run.failureCode = safeFailureCode(error);
    run.error = "Cognitive analysis could not complete safely.";
    run.trace.push({ stage: "FAILED", status: "FAILED", at: new Date().toISOString(), failureCode: run.failureCode, error: run.error });
    runStore.releaseRawEvidence(run);
  });
}

function publicRunView(run) {
  const domainProgress = Object.fromEntries(Object.keys({ A: 1, B: 1, C: 1, D: 1, E: 1, F: 1 }).map((domain) => {
    const latest = run.trace.filter((item) => item.stage === `DOMAIN_${domain}`).at(-1);
    return [domain, latest ? { status: latest.status, claimCount: latest.claimCount ?? null, coverage: latest.coverage ?? null, error: latest.error ?? null } : { status: "PENDING", claimCount: null, coverage: null, error: null }];
  }));
  return {
    runId: run.id, status: run.status, stage: run.stage, createdAt: run.createdAt, expiresAt: run.expiresAt,
    completedAt: run.completedAt ?? null, resultAvailable: Boolean(run.result), error: run.error, failureCode: run.failureCode ?? null,
    solutionProfile: run.solutionProfile,
    cognitiveContractVersion: run.result?.cognitive?.contractVersion ?? cognitiveContractVersion,
    domainProgress,
    coverage: run.result?.coverageMatrix?.counts ?? null,
    publicationGate: run.result?.publicationGate?.status ?? null,
    progress: run.trace.map(({ stage, status, at, claimCount, verificationCount, adjudicatedClaimCount, lockedFindingCount, unresolvedClaimCount, coverageComplete }) => ({ stage, status, at, claimCount, verificationCount, adjudicatedClaimCount, lockedFindingCount, unresolvedClaimCount, coverageComplete }))
  };
}

async function parsedAssessmentSources(payload) {
  const values = payload.sources ?? [];
  if (!values.some((item) => item.mimeType)) {
    return {
      sources: values,
      sourceIngestion: buildSourceIngestionManifest({ submitted: payload.sourceIngestion, parsedSources: values, selectionMode: "LEGACY_OR_SAMPLE" })
    };
  }
  const validated = validatePreflightInput({ sources: values }, { dossierOptional: true });
  const screened = await parseAndScreenSources(validated.sources, { continueOnError: true });
  return {
    sources: screened.sourceUnits.map((unit) => ({
      path: `${unit.path}#${unit.locator}`,
      content: unit.media ? "[IMAGE REQUIRES APPROVED MULTIMODAL COGNITIVE DISCOVERY; NO DETERMINISTIC FACT EXTRACTED]" : unit.content,
      kind: unit.evidenceKind,
      metadata: {
        artifactClass: screened.registeredSources.find((item) => item.id === unit.sourceId)?.artifactClass,
        sourceUnitId: unit.id,
        locator: unit.locator,
        originalSource: screened.registeredSources.find((item) => item.id === unit.sourceId)
      }
    })),
    sourceIngestion: buildSourceIngestionManifest({ submitted: payload.sourceIngestion, parsedSources: screened.registeredSources, failedSources: screened.failedSources })
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
      return sendJson(response, 200, { status: "ok", buildRevision, cognitiveContractVersion, knowledge: knowledgeManifestView(knowledge) });
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
    if (request.method === "GET" && url.pathname === "/api/knowledge/diagnostics") return sendJson(response, 200, knowledge.diagnostics ?? { status: "UNKNOWN", issues: [{ severity: "WARNING", code: "DIAGNOSTICS_UNAVAILABLE", message: "Knowledge diagnostics were not generated at startup.", entryIds: [] }] });
    if (request.method === "POST" && url.pathname === "/api/discover") {
      const payload = await readJson(request);
      const run = await createPreflight({ sources: payload.sources ?? [], sourceIngestion: payload.sourceIngestion });
      runStore.create(run);
      let discoveryRecheck = { status: "NOT_RUN", policy: "Cited AI recheck runs automatically after local DLP screening when the configured provider route is available." };
      if (run.dlpFindings.some((item) => item.blocking)) {
        discoveryRecheck = { status: "BLOCKED_BY_LOCAL_DLP", policy: "AI recheck was not started because source transmission is blocked by local screening." };
      } else {
        try {
          if (!rateAllowed(request)) throw Object.assign(new Error("Cognitive discovery rate limit exceeded"), { statusCode: 429 });
          const policy = modelPolicy();
          discoveryRecheck = await recheckDiscovery(run, automaticApproval(run, policy), { policy });
        } catch (error) {
          discoveryRecheck = { status: "UNAVAILABLE", failureCode: safeFailureCode(error), policy: "The deterministic intake draft remains available. AI candidates were not used." };
          run.trace.push({ stage: "DISCOVERY_RECHECK", status: "UNAVAILABLE", at: new Date().toISOString(), failureCode: discoveryRecheck.failureCode });
        }
      }
      return sendJson(response, 200, {
        runId: run.id,
        solutionProfile: run.solutionProfile,
        sourceManifest: run.registeredSources,
        dlpFindings: run.dlpFindings,
        sourceIngestion: run.sourceIngestion,
        discoveryRecheck
      });
    }
    if (request.method === "POST" && url.pathname === "/api/assess") {
      const payload = await readJson(request);
      const parsed = await parsedAssessmentSources(payload);
      return sendJson(response, 200, await assessSolution({ ...payload, ...parsed }, { knowledge }));
    }
    if (request.method === "GET" && url.pathname === "/api/v2/models") {
      return sendJson(response, 200, { mode: "ALWAYS_ON", profiles: publicModelPolicy(modelPolicy()) });
    }
    if (request.method === "POST" && url.pathname === "/api/v2/runs/preflight") {
      const run = await createPreflight(await readJson(request));
      runStore.create(run);
      return sendJson(response, 201, publicPreflightView(run));
    }
    const discoverMatch = url.pathname.match(/^\/api\/v2\/runs\/([^/]+)\/discover$/);
    if (request.method === "POST" && discoverMatch) {
      const run = runStore.get(discoverMatch[1]);
      return run ? sendJson(response, 200, publicDiscoveryView(run)) : sendJson(response, 404, { error: "Run not found or expired" });
    }
    const recheckMatch = url.pathname.match(/^\/api\/v2\/runs\/([^/]+)\/discover-recheck$/);
    if (request.method === "POST" && recheckMatch) {
      const run = runStore.get(recheckMatch[1]);
      if (!run) return sendJson(response, 404, { error: "Run not found or expired" });
      const blocking = run.dlpFindings.filter((item) => item.blocking);
      if (blocking.length) return sendJson(response, 400, { error: "Preflight contains evidence that cannot be safely transmitted", blockingFindingIds: blocking.map((item) => item.id) });
      if (!rateAllowed(request)) return sendJson(response, 429, { error: "Cognitive discovery rate limit exceeded" });
      return sendJson(response, 200, await recheckDiscovery(run, automaticApproval(run), { policy: modelPolicy() }));
    }
    const confirmMatch = url.pathname.match(/^\/api\/v2\/runs\/([^/]+)\/confirm$/);
    if (request.method === "POST" && confirmMatch) {
      const run = runStore.get(confirmMatch[1]);
      if (!run) return sendJson(response, 404, { error: "Run not found or expired" });
      await confirmPreflightDossier(run, await readJson(request));
      return sendJson(response, 200, publicPreflightView(run));
    }
    const executeMatch = url.pathname.match(/^\/api\/v2\/runs\/([^/]+)\/execute$/);
    if (request.method === "POST" && executeMatch) {
      const run = runStore.get(executeMatch[1]);
      if (!run) return sendJson(response, 404, { error: "Run not found or expired" });
      startCognitiveRun(run, request);
      return sendJson(response, 202, publicRunView(run));
    }
    const resultMatch = url.pathname.match(/^\/api\/v2\/runs\/([^/]+)\/result$/);
    if (request.method === "GET" && resultMatch) {
      const run = runStore.get(resultMatch[1]);
      if (!run) return sendJson(response, 404, { error: "Run not found or expired" });
      if (!run.result) return sendJson(response, 409, { error: `Result is unavailable while run status is ${run.status}` });
      return sendJson(response, 200, run.result);
    }
    const runMatch = url.pathname.match(/^\/api\/v2\/runs\/([^/]+)$/);
    if (request.method === "GET" && runMatch) {
      const run = runStore.get(runMatch[1]);
      return run ? sendJson(response, 200, publicRunView(run)) : sendJson(response, 404, { error: "Run not found or expired" });
    }
    if (request.method === "DELETE" && runMatch) {
      return runStore.purge(runMatch[1], "CANCELLED") ? sendJson(response, 200, { status: "PURGED" }) : sendJson(response, 404, { error: "Run not found or expired" });
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

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => { runStore.close(); server.close(() => process.exit(0)); });
}
