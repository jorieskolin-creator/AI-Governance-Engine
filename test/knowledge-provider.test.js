import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { sha256 } from "../src/core/hash.js";
import { loadKnowledgeSnapshot, knowledgeManifestView } from "../src/knowledge/provider.js";
import { evaluateKnowledgeSnapshot } from "../src/knowledge/diagnostics.js";
import { TACTICS } from "../src/knowledge/playbook.js";
import { selectPlaybookActions } from "../src/core/playbook-engine.js";

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
    releaseStatus: "DRAFT",
    documents: types.map((type) => ({ id: type, type, url: `https://blob.example/${type}.json`, sha256: sha256(documents[`https://blob.example/${type}.json`]) }))
  };
  globalThis.fetch = async (url) => new Response(url.endsWith("manifest.json") ? JSON.stringify(manifest) : documents[url], { status: 200 });
  const snapshot = await loadKnowledgeSnapshot({ production: true, manifestUrl: "https://blob.example/manifest.json" });
  assert.equal(snapshot.source, "VERCEL_BLOB");
  assert.equal(snapshot.version, "approved-2026-08");
  assert.equal(snapshot.releaseStatus, "DRAFT");
  assert.equal(snapshot.diagnostics.status, "WARN");
  assert.equal(snapshot.diagnostics.errorCount, 0);
  for (const type of types) assert.equal(snapshot[type].length, 1);
});

test("local snapshot loads the assessment instrument and approved Playbook, with Knowledge Base unpublished", async () => {
  const snapshot = await loadKnowledgeSnapshot({ production: false, manifestUrl: "" });
  assert.equal(snapshot.source, "LOCAL_BOOTSTRAP");
  assert.equal(snapshot.releaseStatus, "ASSESSMENT_OBJECTS_NOT_PUBLISHED");
  assert.equal(snapshot.playbookStatus, "APPROVED");
  assert.equal(snapshot.instrumentStatus, "LOADED");
  assert.equal(snapshot.knowledgeBaseStatus, "NOT_PUBLISHED");
  assert.equal(snapshot.assessmentObjectsStatus, "NOT_PUBLISHED");
  assert.equal(snapshot.controls.length, 30);
  assert.equal(snapshot.antipatterns.length, 30);
  assert.equal(snapshot.requirements.length, 30);
  assert.ok(snapshot.controls.every((item) => item.authoringObjectId && item.questions?.length === 3 && item.id === `CTRL-${item.authoringObjectId}`));
  assert.ok(snapshot.antipatterns.every((item) => item.id.startsWith("AP-") && item.questions?.length === 3));
  assert.equal(snapshot.controls.flatMap((item) => item.questions).length, 90);
  assert.equal(snapshot.antipatterns.flatMap((item) => item.questions).length, 90);
  assert.equal(snapshot.tactics.length, 119);
  assert.ok(snapshot.tactics.every((item) => item.status === "APPROVED" && item.id.startsWith("TAC-")));
  assert.ok(snapshot.tactics.some((item) => item.id === "TAC-PURPOSE-A1-01"));
  assert.equal(snapshot.diagnostics.status, "WARN");
  assert.equal(snapshot.diagnostics.errorCount, 0);
  assert.ok(snapshot.diagnostics.issues.some((item) => item.code === "ASSESSMENT_OBJECTS_NOT_PUBLISHED"));
  assert.equal(snapshot.diagnostics.issues.some((item) => item.code === "KNOWLEDGE_NOT_APPROVED"), false);
  assert.equal(snapshot.controls.some((item) => item.id === "CTRL-A-01"), false);
  assert.equal(snapshot.antipatterns.some((item) => item.id === "AP-A-01"), false);
  const view = knowledgeManifestView(snapshot);
  assert.equal(view.playbookStatus, "APPROVED");
  assert.equal(view.instrumentStatus, "LOADED");
  assert.equal(view.knowledgeBaseStatus, "NOT_PUBLISHED");
  assert.equal(view.assessmentObjectsStatus, "NOT_PUBLISHED");
  assert.equal(view.counts.tactics, 119);
  assert.equal(view.counts.controls, 30);
  assert.equal(view.counts.antipatterns, 30);
  assert.equal(view.counts.assessmentQuestions, 180);
});

test("approved catalog tactics retrieve from locked findings on published object IDs", () => {
  const finding = {
    id: "finding-a1",
    statement: "The purpose boundary is not locked.",
    findingDefinitionIds: ["FND-A1-001"],
    assessmentObjectIds: ["A1"],
    antiPatternIds: ["AP-A1"],
    evidenceLinks: [{ id: "link-1" }]
  };
  const actions = selectPlaybookActions(TACTICS, [finding]);
  assert.ok(actions.length > 0);
  assert.ok(actions.every((item) => item.tacticId.startsWith("TAC-")));
  assert.ok(actions.some((item) => item.tacticId === "TAC-PURPOSE-A1-01"));
});

test("legacy bootstrap IDs do not retrieve approved Playbook tactics", () => {
  const finding = {
    id: "finding-bootstrap",
    statement: "Purpose is undefined.",
    findingDefinitionIds: [],
    assessmentObjectIds: [],
    antiPatternIds: ["AP-A-01"],
    evidenceLinks: []
  };
  assert.equal(selectPlaybookActions(TACTICS, [finding]).length, 0);
});

test("an APPROVED snapshot still fails when Playbook mappings cannot resolve", () => {
  const diagnostics = evaluateKnowledgeSnapshot({
    releaseStatus: "APPROVED",
    playbookStatus: "APPROVED",
    assessmentObjectsStatus: "PUBLISHED",
    normativeSources: [{ id: "SRC-1" }],
    requirements: [{ id: "REQ-A-1", domain: "A", sourceIds: ["SRC-1"], lifecycleStages: ["DESIGN_AND_DEVELOPMENT"] }],
    controls: [{ id: "CTRL-A-1", domain: "A", requirementIds: ["REQ-A-1"], lifecycleStages: ["DESIGN_AND_DEVELOPMENT"] }],
    antipatterns: [{ id: "AP-A-01", domain: "A", relatedControlIds: ["CTRL-A-1"] }],
    tactics: [{ id: "TAC-PURPOSE-A1-01", status: "APPROVED", domains: ["A"], lifecycleStages: [], assessmentMappings: { capabilities: ["A1"], antipatterns: ["AP-A1"] } }],
    intakeQuestionnaire: { questions: [{ id: "Q1" }] }
  });
  assert.equal(diagnostics.status, "FAIL");
  assert.ok(diagnostics.issues.some((item) => item.code === "TACTIC_WITHOUT_PRIMARY_OBJECT_MAPPING" && item.severity === "ERROR"));
});
