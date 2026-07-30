import http from "node:http";
import { timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assessSolution } from "./engine.js";
import { loadKnowledgeSnapshot, knowledgeManifestView } from "./knowledge/provider.js";
import { SAMPLE_REQUEST } from "./sample.js";
import { validateExecutionApproval } from "./cognitive/contracts.js";
import { createPreflight, publicPreflightView } from "./cognitive/preflight.js";
import { executeCognitiveRun } from "./cognitive/pipeline.js";
import { modelPolicy, publicModelPolicy } from "./cognitive/model-policy.js";
import { EphemeralRunStore } from "./cognitive/run-store.js";

const port = Number(process.env.PORT ?? 4174);
const publicDir = fileURLToPath(new URL("../public/", import.meta.url));
const allowedOrigin = process.env.ALLOWED_ORIGIN ?? `http://localhost:${port}`;
const maxBodyBytes = 25 * 1024 * 1024;
const cognitiveEnabled = process.env.COGNITIVE_PIPELINE_ENABLED === "true";
const assuranceSummaryEnabled = process.env.ASSURANCE_SUMMARY_ENABLED !== "false";
const cognitiveToken = process.env.COGNITIVE_API_TOKEN ?? "";
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

function authorized(request) {
  if (!cognitiveToken) return false;
  const supplied = request.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "";
  const expectedBytes = Buffer.from(cognitiveToken);
  const suppliedBytes = Buffer.from(supplied);
  return expectedBytes.length === suppliedBytes.length && timingSafeEqual(expectedBytes, suppliedBytes);
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

function cognitiveGuard(request, response, mutate = false) {
  if (!cognitiveEnabled) { sendJson(response, 404, { error: "Cognitive pipeline is disabled" }); return false; }
  if (!cognitiveToken) { sendJson(response, 503, { error: "COGNITIVE_API_TOKEN is required before cognitive endpoints can be enabled" }); return false; }
  if (!authorized(request)) { sendJson(response, 401, { error: "Unauthorized" }); return false; }
  if (mutate && !rateAllowed(request)) { sendJson(response, 429, { error: "Cognitive endpoint rate limit exceeded" }); return false; }
  return true;
}

function publicRunView(run) {
  return {
    runId: run.id, status: run.status, stage: run.stage, createdAt: run.createdAt, expiresAt: run.expiresAt,
    completedAt: run.completedAt ?? null, resultAvailable: Boolean(run.result), error: run.error,
    progress: run.trace.map(({ stage, status, at, claimCount, verificationCount, lockedFindingCount }) => ({ stage, status, at, claimCount, verificationCount, lockedFindingCount }))
  };
}

async function serveStatic(pathname, response) {
  const relative = pathname === "/" ? "index.html" : pathname.slice(1);
  if (!/^[a-zA-Z0-9._/-]+$/.test(relative) || relative.includes("..")) return false;
  try {
    const body = await readFile(join(publicDir, relative));
    response.writeHead(200, { "Content-Type": contentTypes[extname(relative)] ?? "application/octet-stream", "Cache-Control": relative === "index.html" ? "no-cache" : "public, max-age=300" });
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
      return sendJson(response, 200, { status: "ok", knowledge: knowledgeManifestView(knowledge) });
    }
    if (request.method === "GET" && url.pathname === "/api/sample") return sendJson(response, 200, SAMPLE_REQUEST);
    if (request.method === "GET" && url.pathname === "/api/config") return sendJson(response, 200, { assuranceSummaryEnabled });
    if (request.method === "GET" && url.pathname === "/api/knowledge") return sendJson(response, 200, knowledgeManifestView(knowledge));
    if (request.method === "POST" && url.pathname === "/api/assess") {
      const payload = await readJson(request);
      return sendJson(response, 200, await assessSolution(payload, { knowledge }));
    }
    if (url.pathname.startsWith("/api/v2/") && !cognitiveGuard(request, response, ["POST", "DELETE"].includes(request.method))) return;
    if (request.method === "GET" && url.pathname === "/api/v2/models") {
      return sendJson(response, 200, { profiles: publicModelPolicy(modelPolicy()) });
    }
    if (request.method === "POST" && url.pathname === "/api/v2/runs/preflight") {
      const run = await createPreflight(await readJson(request));
      runStore.create(run);
      return sendJson(response, 201, publicPreflightView(run));
    }
    const executeMatch = url.pathname.match(/^\/api\/v2\/runs\/([^/]+)\/execute$/);
    if (request.method === "POST" && executeMatch) {
      const run = runStore.get(executeMatch[1]);
      if (!run) return sendJson(response, 404, { error: "Run not found or expired" });
      if (run.status !== "AWAITING_TRANSMISSION_APPROVAL") return sendJson(response, 409, { error: `Run cannot execute from status ${run.status}` });
      const blocking = run.dlpFindings.filter((item) => item.blocking);
      if (blocking.length) return sendJson(response, 400, { error: "Preflight contains evidence that cannot be safely transmitted", blockingFindingIds: blocking.map((item) => item.id) });
      run.approval = validateExecutionApproval(await readJson(request), run);
      for (const packet of run.packets) packet.transmissionState = "APPROVED";
      void executeCognitiveRun(run, {
        knowledge,
        domainConcurrency: positiveEnvNumber("COGNITIVE_MAX_CONCURRENCY", 3),
        budgets: {
          maxCalls: positiveEnvNumber("COGNITIVE_MAX_CALLS_PER_RUN", 60),
          maxTokens: positiveEnvNumber("COGNITIVE_MAX_TOKENS_PER_RUN", 500000),
          maxMs: positiveEnvNumber("COGNITIVE_MAX_RUN_MS", 720000)
        }
      }).then(() => runStore.releaseRawEvidence(run)).catch((error) => {
        run.status = "FAILED"; run.stage = "FAILED"; run.error = process.env.NODE_ENV === "production" ? "Cognitive run failed safely" : error.message;
        run.trace.push({ stage: "FAILED", status: "FAILED", at: new Date().toISOString(), error: run.error });
        runStore.releaseRawEvidence(run);
      });
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
    sendJson(response, status, { error: status === 500 ? "Assessment failed safely" : error.message, detail: process.env.NODE_ENV === "production" ? undefined : error.message });
  }
});

server.listen(port, "0.0.0.0", () => console.log(`AI Governance Engine listening on ${port}`));

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => { runStore.close(); server.close(() => process.exit(0)); });
}
