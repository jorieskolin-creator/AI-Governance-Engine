import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createPreflight } from "../src/cognitive/preflight.js";
import { validateIntakeGapAnalysis } from "../src/intake/gap-analysis.js";
import { classifyUploadPath, provisionalIngestionManifest } from "../public/upload-types.js";

test("gap analysis separates bounded retrieval opportunity, source silence, and technical loss", async () => {
  const narrative = await readFile(new URL("./fixtures/evidence-acquisition/narrative-architecture.html", import.meta.url), "utf8");
  const sources = [
    { path: "synthetic/narrative-architecture.html", mimeType: "text/html", content: narrative },
    { path: "synthetic/labelled-intake.txt", mimeType: "text/plain", content: "Current user access: Internal only" }
  ];
  const selected = [
    ...sources.map((source) => ({ ...classifyUploadPath(source.path, source.mimeType), size: source.content.length })),
    { ...classifyUploadPath("synthetic/reference-repository.zip", "application/zip"), size: 512 }
  ];
  const run = await createPreflight({ sources, sourceIngestion: provisionalIngestionManifest(selected, "INDIVIDUAL_FILES") });
  const analysis = validateIntakeGapAnalysis(run.intakeGapAnalysis);
  const access = analysis.fields.find((field) => field.fieldId === "exposure.currentUserAccess");
  const monitoring = analysis.fields.find((field) => field.fieldId === "operatingBoundary.monitoringOwner");
  const purpose = analysis.fields.find((field) => field.fieldId === "intendedPurpose");

  assert.equal(access.state, "PRESENT");
  assert.equal(access.retrievalDisposition, "NOT_NEEDED_PRESENT");
  assert.equal(monitoring.state, "MISSING_UNKNOWN");
  assert.equal(monitoring.retrievalDisposition, "BOUNDED_LOCAL_REREAD_POSSIBLE");
  assert.deepEqual(monitoring.relevantSafeConceptSignals, ["DOCUMENT_TOPIC:MONITORING_AND_INCIDENTS"]);
  assert.ok(monitoring.attemptedMethods.includes("LABELLED_VALUE"));
  assert.ok(monitoring.attemptedMethods.includes("HEADING_VALUE"));
  assert.equal(purpose.state, "MISSING_UNKNOWN");
  assert.equal(purpose.retrievalDisposition, "TECHNICAL_RECOVERY_REQUIRED");
  assert.ok(purpose.technicalLossReasonCodes.includes("UNSUPPORTED_SOURCE_CONTAINER"));
  assert.ok(analysis.coverage.sourceEvidenceTypes.includes("ARCHITECTURE_DOCUMENT"));
  assert.ok(analysis.safeConceptCoverage.some((signal) => signal.signalId === "MONITORING_AND_INCIDENTS"));
});

test("genuine extracted-source silence remains unknown and gap diagnostics contain no raw text", async () => {
  const privateMarker = "synthetic-private-project-orchid";
  const run = await createPreflight({ sources: [{
    path: "docs/architecture.html",
    mimeType: "text/html",
    content: `<h1>System overview</h1><p>${privateMarker} has generic descriptive material.</p>`
  }] });
  const analysis = validateIntakeGapAnalysis(run.intakeGapAnalysis);
  const purpose = analysis.fields.find((field) => field.fieldId === "intendedPurpose");

  assert.equal(purpose.state, "MISSING_UNKNOWN");
  assert.equal(purpose.retrievalDisposition, "UNKNOWN_SOURCE_SILENCE");
  assert.match(purpose.limitations.join(" "), /remains UNKNOWN/);
  assert.doesNotMatch(JSON.stringify(analysis), new RegExp(privateMarker));

  const tampered = structuredClone(analysis);
  tampered.summary.missingFieldCount = 0;
  assert.throws(() => validateIntakeGapAnalysis(tampered), /summary is inconsistent|integrity check/i);
});

test("privacy blocks missing-field retrieval while conflicts remain user decisions", async () => {
  const run = await createPreflight({ sources: [
    { path: "purpose-a.md", mimeType: "text/markdown", content: "Intended purpose: Support internal reviews" },
    { path: "purpose-b.md", mimeType: "text/markdown", content: "Intended purpose: Automate external decisions" },
    { path: "screen.png", mimeType: "image/png", encoding: "base64", content: Buffer.from("89504e470d0a1a0a00000000", "hex").toString("base64") }
  ] });
  const analysis = validateIntakeGapAnalysis(run.intakeGapAnalysis);
  const purpose = analysis.fields.find((field) => field.fieldId === "intendedPurpose");
  const owner = analysis.fields.find((field) => field.fieldId === "accountableOwner");

  assert.equal(purpose.state, "CONFLICTING");
  assert.equal(purpose.retrievalDisposition, "USER_RESOLUTION_REQUIRED");
  assert.equal(owner.state, "MISSING_UNKNOWN");
  assert.equal(owner.retrievalDisposition, "BLOCKED_BY_PRIVACY");
  assert.ok(analysis.coverage.privacyBlockedSourceCount > 0);
});
