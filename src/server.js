import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assessSolution } from "./engine.js";
import { loadKnowledgeSnapshot, knowledgeManifestView } from "./knowledge/provider.js";
import { SAMPLE_REQUEST } from "./sample.js";

const port = Number(process.env.PORT ?? 4174);
const publicDir = fileURLToPath(new URL("../public/", import.meta.url));
const allowedOrigin = process.env.ALLOWED_ORIGIN ?? `http://localhost:${port}`;
const maxBodyBytes = 25 * 1024 * 1024;
const contentTypes = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml" };

const knowledge = await loadKnowledgeSnapshot();

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
  if (request.headers.origin === allowedOrigin) response.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  try {
    if (request.method === "GET" && url.pathname === "/health") {
      return sendJson(response, 200, { status: "ok", knowledge: knowledgeManifestView(knowledge) });
    }
    if (request.method === "GET" && url.pathname === "/api/sample") return sendJson(response, 200, SAMPLE_REQUEST);
    if (request.method === "GET" && url.pathname === "/api/knowledge") return sendJson(response, 200, knowledgeManifestView(knowledge));
    if (request.method === "POST" && url.pathname === "/api/assess") {
      const payload = await readJson(request);
      return sendJson(response, 200, await assessSolution(payload, { knowledge }));
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
  process.on(signal, () => server.close(() => process.exit(0)));
}
