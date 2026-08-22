import test from "node:test";
import assert from "node:assert/strict";
import { createCanvas } from "@napi-rs/canvas";
import PDFDocument from "pdfkit";
import { createPreflight, publicPreflightView } from "../src/cognitive/preflight.js";
import { serializeDurableRun } from "../src/cognitive/run-persistence.js";
import { validateMediaEvidenceSummary } from "../src/intake/media-evidence.js";
import { OCR_ENGINE, OCR_ENGINE_VERSION, OCR_EVIDENCE_VERSION, validateOcrProvenance } from "../src/intake/ocr-evidence.js";

function textImage(lines) {
  const canvas = createCanvas(1200, 320);
  const context = canvas.getContext("2d");
  context.fillStyle = "white"; context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "black"; context.font = "52px sans-serif";
  lines.forEach((line, index) => context.fillText(line, 40, 100 + index * 90));
  return canvas.toBuffer("image/png");
}

function scannedPdf(image) {
  return new Promise((resolve) => {
    const chunks = [];
    const document = new PDFDocument({ size: [1200, 320], margin: 0, compress: false });
    document.on("data", (chunk) => chunks.push(chunk));
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.image(image, 0, 0, { width: 1200, height: 320 });
    document.end();
  });
}

function provenance({ confidence, qualificationState, pageNumber = null, sourceLocator = "image:1" }) {
  return validateOcrProvenance({
    schemaVersion: OCR_EVIDENCE_VERSION,
    engine: OCR_ENGINE,
    engineVersion: OCR_ENGINE_VERSION,
    recognizerVersion: "synthetic-test-engine",
    language: "eng",
    sourceLocator,
    pageNumber,
    pixelWidth: 1200,
    pixelHeight: 320,
    confidence,
    qualificationState,
    boundingBoxes: [{ x0: 10, y0: 10, x1: 500, y1: 80, confidence }]
  });
}

test("scanned PDFs and images use bounded local OCR with provenance and no raw egress", async () => {
  const marker = "Synthetic OCR Evidence";
  const image = textImage([marker, "Solution name: OCR Fixture"]);
  const pdf = await scannedPdf(image);
  const run = await createPreflight({ sources: [
    { path: "synthetic-screen.png", mimeType: "image/png", encoding: "base64", content: image.toString("base64") },
    { path: "synthetic-scan.pdf", mimeType: "application/pdf", encoding: "base64", content: pdf.toString("base64") }
  ] });

  const imageOcr = run.localSourceUnits.find((unit) => unit.path === "synthetic-screen.png" && unit.ocr);
  const pdfOcr = run.localSourceUnits.find((unit) => unit.path === "synthetic-scan.pdf" && unit.ocr);
  assert.match(imageOcr.content, /Synthetic OCR Evidence/);
  assert.match(pdfOcr.content, /Synthetic OCR Evidence/);
  assert.equal(imageOcr.ocr.qualificationState, "QUALIFIED");
  assert.equal(pdfOcr.ocr.pageNumber, 1);
  assert.ok(pdfOcr.ocr.boundingBoxes.length > 0);
  assert.ok(pdfOcr.ocr.boundingBoxes.every((box) => Object.keys(box).sort().join(",") === "confidence,x0,x1,y0,y1"));
  assert.equal(run.sourceIngestion.laneCounts.MEDIA_LOCAL_OCR_ANALYSIS, 1);
  assert.equal(run.sourceIngestion.laneCounts.DOCUMENT_LOCAL_OCR_ANALYSIS, 1);
  assert.equal(run.registeredSources.find((source) => source.path.endsWith(".pdf")).extractionDiagnostics.ocr.qualifiedCount, 1);

  const packetJson = JSON.stringify(publicPreflightView(run).packets);
  assert.doesNotMatch(packetJson, /Synthetic OCR Evidence|OCR Fixture/);
  assert.doesNotMatch(packetJson, new RegExp(image.toString("base64").slice(0, 80)));
  assert.doesNotMatch(JSON.stringify(serializeDurableRun(run)), /Synthetic OCR Evidence|OCR Fixture/);
  const mediaSummary = validateMediaEvidenceSummary(JSON.parse(run.packets.flatMap((packet) => packet.sourceUnits).find((unit) => unit.evidenceKind === "MEDIA_SUMMARY").content));
  assert.equal(mediaSummary.ocrState, "QUALIFIED");
  assert.equal(mediaSummary.visualContentState, "OCR_TEXT_SCREENED_NON_TEXT_VISUAL_CONTENT_NOT_ASSESSED");
});

test("complete OCR text re-enters DLP while low-confidence text cannot populate Intake", async () => {
  const image = textImage(["Synthetic low confidence fixture"]);
  const privateMarker = "synthetic.person@example.com";
  const ocrSession = {
    async recognize() {
      return {
        text: `Solution name: Must Remain Unknown\nOwner: ${privateMarker}`,
        provenance: provenance({ confidence: 40, qualificationState: "REVIEW_REQUIRED" })
      };
    },
    async terminate() {}
  };
  const run = await createPreflight({ sources: [{ path: "low-confidence.png", mimeType: "image/png", encoding: "base64", content: image.toString("base64"), metadata: { sanitized: true } }] }, { sourceIntake: { ocrSession } });
  const localOcr = run.localSourceUnits.find((unit) => unit.ocr);

  assert.match(localOcr.content, /REDACTED_EMAIL/);
  assert.doesNotMatch(localOcr.content, new RegExp(privateMarker.replace(".", "\\.")));
  assert.ok(run.dlpFindings.some((finding) => finding.type === "EMAIL"));
  assert.equal(run.solutionProfile.fields.name.value, null);
  assert.equal(run.solutionProfile.fields.name.status, "UNKNOWN");
  assert.ok(run.acquisitionDiagnostics.items[0].technicalLossReasonCodes.includes("LOW_CONFIDENCE_OCR_REVIEW_REQUIRED"));
  assert.doesNotMatch(JSON.stringify(run.packets), /Must Remain Unknown|synthetic\.person/);
});

test("local OCR timeout is reported once without replaying or failing the whole source", async () => {
  const image = textImage(["Synthetic timeout fixture"]);
  let attempts = 0;
  const ocrSession = {
    async recognize() { attempts += 1; throw new Error("LOCAL_OCR_TIMEOUT"); },
    async terminate() {}
  };
  const run = await createPreflight({ sources: [{ path: "timeout.png", mimeType: "image/png", encoding: "base64", content: image.toString("base64") }] }, { sourceIntake: { ocrSession } });

  assert.equal(attempts, 1);
  assert.equal(run.sourceIngestion.parsedCount, 1);
  assert.ok(run.acquisitionDiagnostics.items[0].technicalLossReasonCodes.includes("LOCAL_OCR_TIMEOUT"));
  const summary = validateMediaEvidenceSummary(JSON.parse(run.packets[0].sourceUnits[0].content));
  assert.equal(summary.executionState, "FAILED");
  assert.equal(summary.ocrState, "FAILED");
});
