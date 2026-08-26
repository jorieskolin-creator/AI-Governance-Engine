import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadAuthoringWorkspace, validateAuthoringWorkspace, compileRuntimeCollections, createRuntimeManifest } from "../src/knowledge/authoring.js";
import { renderCategoryPairPdf, renderTacticPlaybookPdf } from "../src/knowledge/authoring-pdf.js";
import { assessControls } from "../src/core/assessment.js";

const authoring = path.resolve("knowledge-authoring");

test("strict reference category and finalized Playbook validate", async () => {
  const result = validateAuthoringWorkspace(await loadAuthoringWorkspace(authoring));
  assert.equal(result.status, "PASS");
  assert.deepEqual(result.counts, { capabilities: 1, antipatterns: 1, pairs: 1, tacticCatalogs: 1, tactics: 119, sourceRegisters: 1, normativeSources: 1 });
  const counts = Object.fromEntries(["PURPOSE", "DATA", "MODELS", "ARCHITECTURE", "HUMAN", "ACCOUNTABILITY"].map((namespace) => [namespace, result.model.tactics.filter((tactic) => tactic.id.startsWith(`TAC-${namespace}-`)).length]));
  assert.deepEqual(counts, { PURPOSE: 20, DATA: 20, MODELS: 20, ARCHITECTURE: 21, HUMAN: 21, ACCOUNTABILITY: 17 });
  assert.equal(new Set(result.model.tactics.map((tactic) => tactic.id)).size, 119);
  assert.ok(result.model.tactics.every((tactic) => tactic.release_status === "APPROVED" && tactic.primary_object_mappings.length > 0));
  assert.ok(result.issues.some((item) => item.code === "TACTIC_OBJECTS_NOT_LOADED"));
});

test("strict validation rejects missing pair and source-only mappings", async () => {
  const workspace = await loadAuthoringWorkspace(authoring);
  workspace.antipatterns = [];
  workspace.capabilities[0].document.normative_source_mappings = ["SRC-ONLY"];
  const result = validateAuthoringWorkspace(workspace);
  assert.equal(result.status, "FAIL");
  assert.ok(result.issues.some((item) => item.code === "PAIR_MISSING"));
  assert.ok(result.issues.some((item) => item.code === "STRUCTURED_SOURCE_MAPPING_REQUIRED"));
});

test("compatibility mode maps legacy lifecycle labels with visible warnings", async () => {
  const workspace = await loadAuthoringWorkspace(authoring);
  workspace.capabilities[0].document.schema_version = "1.0.0";
  workspace.capabilities[0].document.lifecycle_stages = ["QUALIFICATION", "CONTROLLED_PILOT", "OPERATION", "MATERIAL_CHANGE"];
  const result = validateAuthoringWorkspace(workspace, { compatibility: true });
  assert.equal(result.status, "PASS");
  assert.deepEqual(result.model.capabilities[0].__canonicalStages, ["QUALIFICATION_AND_REGISTRATION", "DEPLOYMENT", "OPERATION_AND_MONITORING", "REVIEW_AND_EVALUATION"]);
  assert.equal(result.issues.filter((item) => item.code === "LEGACY_LIFECYCLE_MAPPED").length, 4);
  assert.ok(result.issues.some((item) => item.code === "LEGACY_SCHEMA_COMPATIBILITY"));
});

test("schema and cross-document validation reject invalid atomic and tactic contracts", async () => {
  const workspace = await loadAuthoringWorkspace(authoring);
  workspace.capabilities[0].document.atomic_subcriteria[0].question_id = "A1-Q3";
  workspace.capabilities[0].document.atomic_subcriteria[0].required_evidence_ids = ["EVD-A1-999"];
  workspace.tacticCatalogs[0].document.tactics[0].completion_effect = "CLOSE_FINDING";
  workspace.tacticCatalogs[0].document.tactics[0].prerequisite_tactic_ids = ["TAC-PURPOSE-A1-99"];
  const result = validateAuthoringWorkspace(workspace);
  assert.equal(result.status, "FAIL");
  assert.ok(result.issues.some((item) => item.code === "JSON_SCHEMA_INVALID" && /completion_effect/.test(item.message)));
  assert.ok(result.issues.some((item) => item.code === "EVIDENCE_REFERENCE_MISSING"));
  assert.ok(result.issues.some((item) => item.code === "TACTIC_PREREQUISITE_MISSING"));
});

test("compiler writes the governance collections and versioned intake questionnaire", async () => {
  const validation = validateAuthoringWorkspace(await loadAuthoringWorkspace(authoring));
  const output = await mkdtemp(path.join(tmpdir(), "kb-runtime-"));
  const report = await compileRuntimeCollections(validation, output, { version: "test-1", releaseStatus: "DRAFT", requireApproved: false });
  assert.deepEqual(Object.keys(report.files), ["normativeSources", "requirements", "controls", "antipatterns", "tactics", "intakeQuestionnaire"]);
  const controls = JSON.parse(await readFile(path.join(output, "controls.json"), "utf8")).entries;
  assert.equal(controls[0].targetStateByLifecycle.DEPLOYMENT, "FORMALLY_APPROVED");
  assert.equal(controls[0].targetStateByLifecycle.OPERATION_AND_MONITORING, "HUMAN_VALIDATED");
  assert.equal(controls[0].minimumTechnicalAssuranceByLifecycle.OPERATION_AND_MONITORING, "OPERATIONALLY_OBSERVED");
  assert.equal(controls[0].minimumTechnicalAssuranceByLifecycle.DEPLOYMENT, "TESTED");
  assert.equal(controls[0].requiredHumanAssuranceByLifecycle.DEPLOYMENT, "FORMALLY_APPROVED");
  const tactics = JSON.parse(await readFile(path.join(output, "tactics.json"), "utf8")).entries;
  assert.equal(tactics[0].completionEffect, "NEW_EVIDENCE_AND_REASSESSMENT_REQUIRED");
  assert.deepEqual(tactics[0].findingSignals, []);
  assert.equal(tactics.length, 119);
  assert.deepEqual(tactics.find((item) => item.id === "TAC-PURPOSE-A1-01").assessmentMappings, { capabilities: ["A1"], antipatterns: ["AP-A1"], question_ids: [] });
  assert.deepEqual(tactics.find((item) => item.id === "TAC-PURPOSE-A1-01").requiredArtifacts, ["Purpose & Use Boundary Specification", "User / affected-person matrix", "Permitted / prohibited-use register", "Approval and version record"]);
});

test("manifest is generated last from exact compiled hashes and immutable URLs", async () => {
  const validation = validateAuthoringWorkspace(await loadAuthoringWorkspace(authoring));
  const output = await mkdtemp(path.join(tmpdir(), "kb-manifest-"));
  await compileRuntimeCollections(validation, output, { version: "test-1", releaseStatus: "DRAFT", requireApproved: false });
  const urls = Object.fromEntries(["normativeSources", "requirements", "controls", "antipatterns", "tactics", "intakeQuestionnaire"].map((type) => [type, `https://blob.vendor.invalid/release/${type}.json`]));
  const manifest = await createRuntimeManifest(output, urls, { version: "test-1", releaseStatus: "APPROVED" });
  assert.equal(manifest.schemaVersion, "1.1.0");
  assert.equal(manifest.documents.length, 6);
  assert.match(manifest.documents[0].sha256, /^[a-f0-9]{64}$/);
  await assert.rejects(() => createRuntimeManifest(output, { ...urls, controls: "https://example.com/controls.json" }), /immutable HTTPS URL/);
  await writeFile(path.join(output, "controls.json"), "changed", "utf8");
  await assert.rejects(() => createRuntimeManifest(output, urls), /changed after validation/);
});

test("generated PDFs are canonical views with PDF signatures", async () => {
  const workspace = await loadAuthoringWorkspace(authoring);
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
