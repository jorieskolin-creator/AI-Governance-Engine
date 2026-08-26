import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { sha256 } from "../src/core/hash.js";
import { loadKnowledgeSnapshot } from "../src/knowledge/provider.js";
import { evaluateKnowledgeSnapshot } from "../src/knowledge/diagnostics.js";

async function maintainerContractPayload() {
  const fixture = JSON.parse(await readFile(new URL("./fixtures/maintainer-runtime-1.1.0.json", import.meta.url), "utf8"));
  const bodies = {};
  const documents = Object.entries(fixture.collections).map(([type, entries]) => {
    const url = `https://blob.example/runtime/${fixture.version}/${type}.json`;
    const body = `${JSON.stringify({ schemaVersion: fixture.collectionSchemaVersion, type, entries })}\n`;
    bodies[url] = body;
    return { id: `kb-${type}-${fixture.version}`, type, url, sha256: sha256(body) };
  });
  return {
    manifest: { schemaVersion: fixture.manifestSchemaVersion, version: fixture.version, releaseStatus: fixture.releaseStatus, documents },
    bodies,
  };
}

function installRemoteFetch(t, manifest, bodies = {}) {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (url) => {
    const value = String(url);
    const body = value.endsWith("runtime-manifest.json") ? JSON.stringify(manifest) : bodies[value];
    return body === undefined ? new Response("missing", { status: 404 }) : new Response(body, { status: 200 });
  };
}

test("production fails closed without a Vercel knowledge manifest", async () => {
  await assert.rejects(() => loadKnowledgeSnapshot({ production: true, manifestUrl: "" }), /VERCEL_KB_MANIFEST_URL is required/);
});

test("knowledge diagnostics identifies broken cross-document references", () => {
  const diagnostics = evaluateKnowledgeSnapshot({
    releaseStatus: "DRAFT", normativeSources: [{ id: "SRC-1" }],
    requirements: [{ id: "REQ-A-1", domain: "A", sourceIds: ["SRC-MISSING"], lifecycleStages: ["DESIGN_AND_DEVELOPMENT"] }],
    controls: [{ id: "CTRL-A-1", domain: "A", requirementIds: ["REQ-MISSING"], lifecycleStages: ["DESIGN_AND_DEVELOPMENT"], signals: [] }],
    antipatterns: [{ id: "AP-A-1", domain: "A", relatedControlIds: ["CTRL-MISSING"], signal: "gap" }],
    tactics: [{ id: "TACTIC-A-1", domains: ["A"], lifecycleStages: ["DESIGN_AND_DEVELOPMENT"], eligibleFindingIds: ["FND-MISSING"] }]
  });
  assert.equal(diagnostics.status, "FAIL");
  assert.ok(diagnostics.issues.some((item) => item.code === "BROKEN_NORMATIVE_SOURCE_REFERENCE"));
  assert.ok(diagnostics.issues.some((item) => item.code === "BROKEN_REQUIREMENT_REFERENCE"));
  assert.ok(diagnostics.issues.some((item) => item.code === "BROKEN_CONTROL_REFERENCE"));
});

test("remote knowledge documents require an exact SHA-256 match", async (t) => {
  const manifest = {
    schemaVersion: "1.0.0",
    version: "test-1",
    documents: [{ id: "requirements", type: "requirements", url: "https://blob.example/requirements.json", sha256: "0".repeat(64) }]
  };
  installRemoteFetch(t, manifest, { "https://blob.example/requirements.json": JSON.stringify([{ id: "REQ" }]) });
  await assert.rejects(() => loadKnowledgeSnapshot({ production: true, manifestUrl: "https://blob.example/runtime-manifest.json" }), /hash mismatch/);
});

test("malformed and incomplete remote manifests fail closed", async (t) => {
  installRemoteFetch(t, { schemaVersion: "9.0.0", version: "invalid", documents: [] });
  await assert.rejects(() => loadKnowledgeSnapshot({ production: true, manifestUrl: "https://blob.example/runtime-manifest.json" }), /Unsupported Vercel knowledge manifest/);
});

test("a hash-valid manifest missing required collections fails closed", async (t) => {
  const url = "https://blob.example/runtime/missing/requirements.json";
  const body = `${JSON.stringify({ schemaVersion: "1.0.0", type: "requirements", entries: [{ id: "REQ-A2" }] })}\n`;
  const manifest = { schemaVersion: "1.1.0", version: "missing", releaseStatus: "APPROVED", documents: [{ id: "kb-requirements-missing", type: "requirements", url, sha256: sha256(body) }] };
  installRemoteFetch(t, manifest, { [url]: body });
  await assert.rejects(() => loadKnowledgeSnapshot({ production: true, manifestUrl: "https://blob.example/runtime-manifest.json" }), /missing normativeSources/);
});

test("Maintainer manifest 1.1.0 and wrapped collection artifacts are accepted independently", async (t) => {
  const { manifest, bodies } = await maintainerContractPayload();
  installRemoteFetch(t, manifest, bodies);
  const snapshot = await loadKnowledgeSnapshot({ production: true, manifestUrl: "https://blob.example/runtime-manifest.json" });
  assert.equal(snapshot.source, "VERCEL_BLOB");
  assert.equal(snapshot.version, "maintainer-contract-fixture-1");
  assert.equal(snapshot.releaseStatus, "APPROVED");
  assert.equal(snapshot.documentChecks.length, 6);
  assert.equal(snapshot.diagnostics.status, "PASS");
});

test("hash-valid Maintainer artifacts with broken references are rejected", async (t) => {
  const { manifest, bodies } = await maintainerContractPayload();
  const requirement = manifest.documents.find((item) => item.type === "requirements");
  const document = JSON.parse(bodies[requirement.url]);
  document.entries[0].sourceIds = ["SRC-MISSING"];
  bodies[requirement.url] = `${JSON.stringify(document)}\n`;
  requirement.sha256 = sha256(bodies[requirement.url]);
  installRemoteFetch(t, manifest, bodies);
  await assert.rejects(() => loadKnowledgeSnapshot({ production: true, manifestUrl: "https://blob.example/runtime-manifest.json" }), /BROKEN_NORMATIVE_SOURCE_REFERENCE/);
});

test("complete hash-pinned Vercel snapshot is accepted", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const entries = {
    normativeSources: [{ id: "SRC-1", title: "Source" }],
    requirements: [{ id: "REQ-A-1", domain: "A", title: "Requirement", sourceIds: ["SRC-1"], lifecycleStages: ["DESIGN_AND_DEVELOPMENT"] }],
    controls: [{ id: "CTRL-A-1", domain: "A", title: "Control", authoringObjectId: "A1", requirementIds: ["REQ-A-1"], lifecycleStages: ["DESIGN_AND_DEVELOPMENT"], signals: ["missing-control"], findingDefinitions: [{ id: "FND-A1-001" }] }],
    antipatterns: [{ id: "AP-A-1", domain: "A", title: "Anti-pattern", signal: "missing-control", relatedControlIds: ["CTRL-A-1"], findingDefinitions: [] }],
    tactics: [{ id: "TACTIC-A-1", title: "Tactic", domains: ["A"], lifecycleStages: ["DESIGN_AND_DEVELOPMENT"], assessmentMappings: { capabilities: ["A1"], antipatterns: ["AP-A-1"] } }]
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
