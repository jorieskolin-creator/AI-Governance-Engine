import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { validateDossier } from "../src/contracts.js";
import { createIntakeResolutionDraft } from "../src/intake/contracts.js";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

async function availablePort() {
  const server = createServer();
  await new Promise((resolve, reject) => server.listen(0, "127.0.0.1", resolve).once("error", reject));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function request(baseUrl, path, options = {}) {
  const response = await fetch(new URL(path, baseUrl), {
    ...options,
    headers: options.body ? { "Content-Type": "application/json", ...options.headers } : options.headers,
    signal: AbortSignal.timeout(5000)
  });
  return { status: response.status, body: await response.json() };
}

async function waitUntilHealthy(baseUrl, child) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Test server exited before becoming healthy with code ${child.exitCode}`);
    try {
      const result = await request(baseUrl, "/health");
      if (result.status === 200) return result;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Test server did not become healthy");
}

test("HTTP workflow exposes readiness and fails closed before unapproved provider execution", async () => {
  const port = await availablePort();
  const baseUrl = new URL(`http://127.0.0.1:${port}`);
  const child = spawn(process.execPath, ["src/server.js"], {
    cwd: repositoryRoot,
    env: {
      PATH: process.env.PATH,
      PORT: String(port),
      NODE_ENV: "development",
      ALLOWED_ORIGIN: baseUrl.origin,
      COGNITIVE_QUEUE_POLL_MS: "60000"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk.toString().slice(0, 2000); });
  try {
    const health = await waitUntilHealthy(baseUrl, child);
    assert.equal(health.body.status, "ok");
    assert.equal(health.body.runStore, "MEMORY");
    assert.deepEqual(health.body.cognitiveReadiness, {
      status: "CONFIGURATION_REQUIRED",
      issueCodes: ["MODEL_CREDENTIALS_MISSING", "MODEL_PROFILES_UNAPPROVED"],
      credentials: { requiredProviderCount: 3, configuredProviderCount: 0 },
      qualification: { requiredProfileCount: 6, approvedProfileCount: 0 },
      topologyStatus: "NOT_EVALUATED"
    });

    const models = await request(baseUrl, "/api/v2/models");
    assert.equal(models.status, 200);
    assert.equal(models.body.mode, "ALWAYS_ON");
    assert.deepEqual(models.body.readiness, health.body.cognitiveReadiness);
    assert.equal(models.body.roleSlots.length, 6);
    assert.equal(new Set(models.body.roleSlots.map((slot) => slot.approvalRef)).size, 6);
    assert.ok(models.body.roleSlots.every((slot) => Array.isArray(slot.stages) && slot.stages.length > 0));
    assert.equal(models.body.profiles.length, 16);
    assert.ok(models.body.profiles.every((profile) => !profile.credentialAvailable && profile.qualificationStatus === "APPROVAL_REQUIRED"));

    const preflight = await request(baseUrl, "/api/v2/runs/preflight", {
      method: "POST",
      body: JSON.stringify({ sources: [{ path: "case.md", mimeType: "text/markdown", content: "Solution name: Router integration case" }] })
    });
    assert.equal(preflight.status, 201);
    assert.equal(preflight.body.stage, "DETERMINISTIC_DISCOVERY_COMPLETED");
    const dossier = validateDossier(preflight.body.solutionProfile.suggestedDossier);
    const confirmed = await request(baseUrl, `/api/v2/runs/${encodeURIComponent(preflight.body.runId)}/confirm`, {
      method: "POST",
      body: JSON.stringify({ dossier, resolutions: createIntakeResolutionDraft(dossier, preflight.body.solutionProfile), approval: { confirmed: true, actorRef: "HTTP_TEST_USER" } })
    });
    assert.equal(confirmed.status, 200);
    assert.equal(confirmed.body.stage, "INTAKE_CONFIRMED");

    const execute = await request(baseUrl, `/api/v2/runs/${encodeURIComponent(preflight.body.runId)}/execute`, { method: "POST" });
    assert.equal(execute.status, 503);
    assert.equal(execute.body.failureCode, "MODEL_ROUTE_UNAVAILABLE");
    const unchanged = await request(baseUrl, `/api/v2/runs/${encodeURIComponent(preflight.body.runId)}`);
    assert.equal(unchanged.body.status, "AWAITING_TRANSMISSION_APPROVAL");
    assert.equal(unchanged.body.stage, "INTAKE_CONFIRMED");
  } finally {
    child.kill("SIGTERM");
    if (child.exitCode === null) await once(child, "exit");
  }
  assert.equal(stderr, "");
});
