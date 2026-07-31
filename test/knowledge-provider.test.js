import test from "node:test";
import assert from "node:assert/strict";
import { sha256 } from "../src/core/hash.js";
import { loadKnowledgeSnapshot } from "../src/knowledge/provider.js";
import { evaluateKnowledgeSnapshot } from "../src/knowledge/diagnostics.js";

test("production fails closed without a Vercel knowledge manifest", async () => {
  await assert.rejects(() => loadKnowledgeSnapshot({ production: true, manifestUrl: "" }), /VERCEL_KB_MANIFEST_URL is required/);
});

test("knowledge diagnostics identifies broken cross-document references", () => {
  const diagnostics = evaluateKnowledgeSnapshot({
    releaseStatus: "DRAFT", normativeSources: [{ id: "SRC-1" }],
    requirements: [{ id: "REQ-A-1", domain: "A", sourceIds: ["SRC-MISSING"], lifecycleStages: ["DESIGN_AND_DEVELOPMENT"] }],
    controls: [{ id: "CTRL-A-1", domain: "A", requirementIds: ["REQ-MISSING"], lifecycleStages: ["DESIGN_AND_DEVELOPMENT"], signals: [] }],
    antipatterns: [{ id: "AP-A-1", domain: "A", relatedControlIds: ["CTRL-MISSING"], signal: "gap" }],
    tactics: [{ id: "TACTIC-A-1", domains: ["A"], lifecycleStages: ["DESIGN_AND_DEVELOPMENT"], findingSignals: ["unmapped"] }]
  });
  assert.equal(diagnostics.status, "FAIL");
  assert.ok(diagnostics.issues.some((item) => item.code === "BROKEN_NORMATIVE_SOURCE_REFERENCE"));
  assert.ok(diagnostics.issues.some((item) => item.code === "BROKEN_REQUIREMENT_REFERENCE"));
  assert.ok(diagnostics.issues.some((item) => item.code === "BROKEN_CONTROL_REFERENCE"));
});

test("remote knowledge documents require an exact SHA-256 match", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const manifest = {
    schemaVersion: "1.0.0",
    version: "test-1",
    documents: [{ id: "requirements", type: "requirements", url: "https://blob.example/requirements.json", sha256: "0".repeat(64) }]
  };
  globalThis.fetch = async (url) => new Response(JSON.stringify(url.endsWith("manifest.json") ? manifest : [{ id: "REQ" }]), { status: 200 });
  await assert.rejects(() => loadKnowledgeSnapshot({ production: true, manifestUrl: "https://blob.example/manifest.json" }), /hash mismatch/);
});

test("complete hash-pinned Vercel snapshot is accepted", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const entries = {
    normativeSources: [{ id: "SRC-1", title: "Source" }],
    requirements: [{ id: "REQ-A-1", domain: "A", title: "Requirement", sourceIds: ["SRC-1"], lifecycleStages: ["DESIGN_AND_DEVELOPMENT"] }],
    controls: [{ id: "CTRL-A-1", domain: "A", title: "Control", requirementIds: ["REQ-A-1"], lifecycleStages: ["DESIGN_AND_DEVELOPMENT"], signals: ["missing-control"] }],
    antipatterns: [{ id: "AP-A-1", domain: "A", title: "Anti-pattern", signal: "missing-control", relatedControlIds: ["CTRL-A-1"] }],
    tactics: [{ id: "TACTIC-A-1", title: "Tactic", domains: ["A"], lifecycleStages: ["DESIGN_AND_DEVELOPMENT"], findingSignals: ["missing-control"] }]
  };
  const types = Object.keys(entries);
  const documents = Object.fromEntries(types.map((type) => [`https://blob.example/${type}.json`, JSON.stringify(entries[type])]));
  const manifest = {
    schemaVersion: "1.0.0",
    version: "approved-2026-08",
    releaseStatus: "CALIBRATION_TEST_ONLY",
    documents: types.map((type) => ({ id: type, type, url: `https://blob.example/${type}.json`, sha256: sha256(documents[`https://blob.example/${type}.json`]) }))
  };
  globalThis.fetch = async (url) => new Response(url.endsWith("manifest.json") ? JSON.stringify(manifest) : documents[url], { status: 200 });
  const snapshot = await loadKnowledgeSnapshot({ production: true, manifestUrl: "https://blob.example/manifest.json" });
  assert.equal(snapshot.source, "VERCEL_BLOB");
  assert.equal(snapshot.version, "approved-2026-08");
  assert.equal(snapshot.releaseStatus, "CALIBRATION_TEST_ONLY");
  assert.equal(snapshot.diagnostics.status, "WARN");
  assert.equal(snapshot.diagnostics.errorCount, 0);
  for (const type of types) assert.equal(snapshot[type].length, 1);
});
