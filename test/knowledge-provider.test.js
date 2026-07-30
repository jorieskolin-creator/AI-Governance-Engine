import test from "node:test";
import assert from "node:assert/strict";
import { sha256 } from "../src/core/hash.js";
import { loadKnowledgeSnapshot } from "../src/knowledge/provider.js";

test("production fails closed without a Vercel knowledge manifest", async () => {
  await assert.rejects(() => loadKnowledgeSnapshot({ production: true, manifestUrl: "" }), /VERCEL_KB_MANIFEST_URL is required/);
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
  const types = ["normativeSources", "requirements", "controls", "antipatterns", "tactics"];
  const documents = Object.fromEntries(types.map((type) => [`https://blob.example/${type}.json`, JSON.stringify([{ id: `${type}-1` }])]));
  const manifest = {
    schemaVersion: "1.0.0",
    version: "approved-2026-08",
    documents: types.map((type) => ({ id: type, type, url: `https://blob.example/${type}.json`, sha256: sha256(documents[`https://blob.example/${type}.json`]) }))
  };
  globalThis.fetch = async (url) => new Response(url.endsWith("manifest.json") ? JSON.stringify(manifest) : documents[url], { status: 200 });
  const snapshot = await loadKnowledgeSnapshot({ production: true, manifestUrl: "https://blob.example/manifest.json" });
  assert.equal(snapshot.source, "VERCEL_BLOB");
  assert.equal(snapshot.version, "approved-2026-08");
  for (const type of types) assert.equal(snapshot[type].length, 1);
});
