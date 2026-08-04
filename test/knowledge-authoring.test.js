import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadAuthoringWorkspace, validateAuthoringWorkspace, compileRuntimeCollections, createRuntimeManifest } from "../src/knowledge/authoring.js";
import { renderCategoryPairPdf, renderTacticPlaybookPdf } from "../src/knowledge/authoring-pdf.js";
import { assessControls } from "../src/core/assessment.js";

const example = path.resolve("knowledge-authoring/example");

test("strict reference category validates with reciprocal mappings", async () => {
  const result = validateAuthoringWorkspace(await loadAuthoringWorkspace(example));
  assert.equal(result.status, "PASS");
  assert.deepEqual(result.counts, { capabilities: 1, antipatterns: 1, pairs: 1, tacticCatalogs: 1, tactics: 1, sourceRegisters: 1, normativeSources: 1 });
});

test("strict validation rejects missing pair and source-only mappings", async () => {
  const workspace = await loadAuthoringWorkspace(example);
  workspace.antipatterns = [];
  workspace.capabilities[0].document.normative_source_mappings = ["SRC-ONLY"];
  const result = validateAuthoringWorkspace(workspace);
  assert.equal(result.status, "FAIL");
  assert.ok(result.issues.some((item) => item.code === "PAIR_MISSING"));
  assert.ok(result.issues.some((item) => item.code === "STRUCTURED_SOURCE_MAPPING_REQUIRED"));
});

test("compatibility mode maps legacy lifecycle labels with visible warnings", async () => {
  const workspace = await loadAuthoringWorkspace(example);
  workspace.capabilities[0].document.lifecycle_stages = ["QUALIFICATION", "CONTROLLED_PILOT", "OPERATION", "MATERIAL_CHANGE"];
  const result = validateAuthoringWorkspace(workspace, { compatibility: true });
  assert.equal(result.status, "PASS");
  assert.deepEqual(result.model.capabilities[0].__canonicalStages, ["QUALIFICATION_AND_REGISTRATION", "DEPLOYMENT", "OPERATION_AND_MONITORING", "REVIEW_AND_EVALUATION"]);
  assert.equal(result.issues.filter((item) => item.code === "LEGACY_LIFECYCLE_MAPPED").length, 4);
});

test("compiler writes only the five runtime collections plus its report", async () => {
  const validation = validateAuthoringWorkspace(await loadAuthoringWorkspace(example));
  const output = await mkdtemp(path.join(tmpdir(), "kb-runtime-"));
  const report = await compileRuntimeCollections(validation, output, { version: "test-1", releaseStatus: "APPROVED" });
  assert.deepEqual(Object.keys(report.files), ["normativeSources", "requirements", "controls", "antipatterns", "tactics"]);
  const controls = JSON.parse(await readFile(path.join(output, "controls.json"), "utf8")).entries;
  assert.equal(controls[0].targetStateByLifecycle.DEPLOYMENT, "HUMAN_VALIDATED");
  assert.equal(controls[0].targetStateByLifecycle.OPERATION_AND_MONITORING, "OPERATIONALLY_OBSERVED");
  const tactics = JSON.parse(await readFile(path.join(output, "tactics.json"), "utf8")).entries;
  assert.equal(tactics[0].completionEffect, "NEW_EVIDENCE_AND_REASSESSMENT_REQUIRED");
});

test("manifest is generated last from exact compiled hashes and immutable URLs", async () => {
  const validation = validateAuthoringWorkspace(await loadAuthoringWorkspace(example));
  const output = await mkdtemp(path.join(tmpdir(), "kb-manifest-"));
  await compileRuntimeCollections(validation, output, { version: "test-1", releaseStatus: "APPROVED" });
  const urls = Object.fromEntries(["normativeSources", "requirements", "controls", "antipatterns", "tactics"].map((type) => [type, `https://blob.vendor.invalid/release/${type}.json`]));
  const manifest = await createRuntimeManifest(output, urls, { version: "test-1", releaseStatus: "APPROVED" });
  assert.equal(manifest.documents.length, 5);
  assert.match(manifest.documents[0].sha256, /^[a-f0-9]{64}$/);
  await assert.rejects(() => createRuntimeManifest(output, { ...urls, controls: "https://example.com/controls.json" }), /immutable HTTPS URL/);
  await writeFile(path.join(output, "controls.json"), "changed", "utf8");
  await assert.rejects(() => createRuntimeManifest(output, urls), /changed after validation/);
});

test("generated PDFs are canonical views with PDF signatures", async () => {
  const workspace = await loadAuthoringWorkspace(example);
  const output = await mkdtemp(path.join(tmpdir(), "kb-pdf-"));
  const pairFile = path.join(output, "pair.pdf");
  const tacticsFile = path.join(output, "tactics.pdf");
  await renderCategoryPairPdf(workspace.capabilities[0].document, workspace.antipatterns[0].document, pairFile);
  await renderTacticPlaybookPdf(workspace.tacticCatalogs[0].document, tacticsFile);
  assert.equal((await readFile(pairFile)).subarray(0, 4).toString(), "%PDF");
  assert.equal((await readFile(tacticsFile)).subarray(0, 4).toString(), "%PDF");
});

test("control assessment selects lifecycle-specific assurance target", () => {
  const controls = [{ id: "CTRL-A1", domain: "A", title: "Purpose", requirementIds: ["REQ-A1"], lifecycleStages: ["DESIGN_AND_DEVELOPMENT", "DEPLOYMENT"], targetState: "TESTED", targetStateByLifecycle: { DEPLOYMENT: "HUMAN_VALIDATED" }, severity: "HIGH", signals: ["purpose"] }];
  const applicability = [{ requirementId: "REQ-A1", state: "APPLICABLE" }];
  const dossier = { currentStage: "DESIGN_AND_DEVELOPMENT", targetStage: "DEPLOYMENT" };
  const result = assessControls(controls, applicability, [], dossier, []);
  assert.equal(result[0].targetState, "HUMAN_VALIDATED");
  assert.equal(result[0].gap.targetState, "HUMAN_VALIDATED");
});
