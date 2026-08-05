import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
const server = await readFile(new URL("../src/server.js", import.meta.url), "utf8");

test("the browser assessment workflow starts and waits for the cognitive run", () => {
  assert.match(app, /\/api\/discover/);
  assert.match(app, /\/api\/v2\/runs\/\$\{encodeURIComponent\(activeRunId\)\}\/confirm/);
  assert.match(app, /\/api\/v2\/runs\/\$\{encodeURIComponent\(activeRunId\)\}\/execute/);
  assert.match(app, /waitForRun\(activeRunId\)/);
  assert.doesNotMatch(app, /fetch\("\/api\/assess"/);
});

test("the service exposes an always-on cognitive contract without client credentials", () => {
  assert.match(server, /cognitiveMode: "ALWAYS_ON"/);
  assert.match(server, /function automaticApproval/);
  assert.doesNotMatch(server, /COGNITIVE_PIPELINE_ENABLED/);
  assert.doesNotMatch(server, /COGNITIVE_API_TOKEN/);
});

test("asynchronous provider failures expose a stable limitation instead of provider detail", () => {
  assert.match(server, /run\.failureCode = safeFailureCode\(error\)/);
  assert.match(server, /run\.error = "Cognitive analysis could not complete safely\."/);
  assert.doesNotMatch(server, /run\.error = process\.env\.NODE_ENV/);
});
