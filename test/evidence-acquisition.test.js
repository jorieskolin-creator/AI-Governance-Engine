import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createPreflight, publicPreflightView } from "../src/cognitive/preflight.js";
import { recheckDiscovery } from "../src/cognitive/discovery-recheck.js";
import { modelPolicy as createModelPolicy } from "../src/cognitive/model-policy.js";
import { ModelBudget, StructuredModelClient } from "../src/cognitive/provider-client.js";
import { EphemeralRunStore } from "../src/cognitive/run-store.js";
import { discoveryRecheckPrompt } from "../src/cognitive/prompts.js";
import { parseAndScreenSources } from "../src/cognitive/source-intake.js";
import { sha256 } from "../src/core/hash.js";
import { validateSourceIngestionManifest } from "../src/core/source-ingestion.js";
import { CODE_EVIDENCE_SUMMARY_VERSION, validateCodeEvidenceSummary } from "../src/intake/code-evidence.js";
import { ACQUIRED_FACT_SELECTION_VERSION, createAcquiredFactSelectionUnit, validateAcquiredFactPackage } from "../src/intake/acquired-facts.js";
import { DOCUMENT_EVIDENCE_SUMMARY_VERSION, validateDocumentEvidenceSummary } from "../src/intake/document-evidence.js";
import { MEDIA_EVIDENCE_SUMMARY_VERSION, validateMediaEvidenceSummary } from "../src/intake/media-evidence.js";
import { createTabularEvidenceUnit, TABULAR_EVIDENCE_SUMMARY_VERSION, validateTabularEvidenceSummary } from "../src/intake/tabular-evidence.js";
import { setAcquisitionGenAiStatus, validateAcquisitionDiagnostics } from "../src/intake/acquisition-diagnostics.js";
import { classifyUploadPath, provisionalIngestionManifest } from "../public/upload-types.js";

const rawMarker = "internal-project-orchid-customer-table";
const modelPolicy = (env) => createModelPolicy(env, { qualificationRequired: false });

test("synthetic regression inputs distinguish technical loss from genuine source silence", async () => {
  const fixture = (name) => readFile(new URL(`./fixtures/evidence-acquisition/${name}`, import.meta.url), "utf8");
  const narrative = await fixture("narrative-architecture.html");
  const embedded = await fixture("embedded-data-report.html");
  const sources = [
    { path: "synthetic/narrative-architecture.html", mimeType: "text/html", content: narrative },
    { path: "synthetic/embedded-data-report.html", mimeType: "text/html", content: embedded },
    { path: "synthetic/labelled-intake.txt", mimeType: "text/plain", content: "Solution name: Synthetic Intake Fixture" },
    { path: "synthetic/unreviewed-screen.png", mimeType: "image/png", encoding: "base64", content: Buffer.from("89504e470d0a1a0a00000000", "hex").toString("base64") },
    { path: "synthetic/broken-report.pdf", mimeType: "application/pdf", encoding: "base64", content: Buffer.from("%PDF-not-a-document").toString("base64") }
  ];
  const selected = [
    ...sources.map((source) => ({ ...classifyUploadPath(source.path, source.mimeType), size: source.content.length })),
    { ...classifyUploadPath("synthetic/reference-repository.zip", "application/zip"), size: 512 }
  ];
  const run = await createPreflight({ sources, sourceIngestion: provisionalIngestionManifest(selected, "INDIVIDUAL_FILES") });
  const diagnostics = run.acquisitionDiagnostics;

  assert.deepEqual(diagnostics.counts, {
    SELECTED: 6,
    ACCEPTED: 5,
    PARSED: 4,
    CONTENT_EXTRACTED: 3,
    INTAKE_USEFUL: 1,
    EXCLUDED: 1,
    FAILED: 1,
    PRIVACY_BLOCKED: 1
  });
  assert.deepEqual(diagnostics.technicalLoss, { count: 3, partialSourceCount: 0, unavailableSourceCount: 3, present: true });
  assert.deepEqual(diagnostics.sourceSilence, { count: 2, present: true });
  assert.equal(diagnostics.genAi.status, "BLOCKED_BY_PRIVACY");
  assert.match(diagnostics.diagnosticsHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(diagnostics.items.find((item) => item.path.endsWith("reference-repository.zip")).technicalLossReasonCodes, ["UNSUPPORTED_SOURCE_CONTAINER"]);
  assert.equal(diagnostics.items.find((item) => item.path.endsWith("reference-repository.zip")).technicalLossScope, "SOURCE_UNAVAILABLE");
  assert.deepEqual(diagnostics.items.find((item) => item.path.endsWith("embedded-data-report.html")).technicalLossReasonCodes, []);
  assert.equal(diagnostics.items.find((item) => item.path.endsWith("narrative-architecture.html")).intakeFactCount, 0);
  assert.ok(diagnostics.items.find((item) => item.path.endsWith("labelled-intake.txt")).states.includes("INTAKE_USEFUL"));
  assert.doesNotMatch(JSON.stringify(publicPreflightView(run).acquisitionDiagnostics), /Fixture-only hidden value/);

  const tampered = structuredClone(diagnostics);
  tampered.sourceSilence.count = 99;
  assert.throws(() => validateAcquisitionDiagnostics(tampered), /source-silence summary is inconsistent/i);

  setAcquisitionGenAiStatus(run, "UNAVAILABLE", "MODEL_PROFILES_UNAPPROVED");
  assert.deepEqual(run.acquisitionDiagnostics.genAi, { status: "UNAVAILABLE", failureCode: "MODEL_PROFILES_UNAPPROVED" });
});

test("technical loss distinguishes partial extraction from an unavailable source", async () => {
  const run = await createPreflight({ sources: [{
    path: "docs/partial-report.html",
    mimeType: "text/html",
    content: "<h1>Visible content</h1><script>window.__private_report_state__ = { hidden: true };</script>"
  }] });
  const item = run.acquisitionDiagnostics.items[0];

  assert.equal(item.technicalLossScope, "PARTIAL_SOURCE_EXTRACTION");
  assert.deepEqual(item.technicalLossReasonCodes, ["UNSUPPORTED_EMBEDDED_SCRIPT_CONTENT_SKIPPED"]);
  assert.deepEqual(run.acquisitionDiagnostics.technicalLoss, { count: 1, partialSourceCount: 1, unavailableSourceCount: 0, present: true });
  assert.equal(run.acquisitionDiagnostics.sourceSilence.count, 0);
  assert.doesNotMatch(JSON.stringify(publicPreflightView(run)), /__private_report_state__|hidden/);
});

test("messy deterministic acquisition meets labelled precision and recall acceptance", async () => {
  const run = await createPreflight({ sources: [
    { path: "docs/current-architecture.html", mimeType: "text/html", content: "<title>Atlas Review Assistant — Current Architecture</title><p>Roles: REASONER · WORKHORSE · QUALITY_CHECKER with provider routing.</p>" },
    { path: "governance/raci.html", mimeType: "text/html", content: "<table><tr><th>Accountable</th><th>Risk Team</th></tr></table>" },
    { path: "docs/intake.md", mimeType: "text/markdown", content: "Intended purpose: Support bounded internal governance reviews\nCurrent user access: Internal only" },
    { path: "docs/users-a.md", mimeType: "text/markdown", content: "Users: Employees" },
    { path: "docs/users-b.md", mimeType: "text/markdown", content: "Users: Customers" }
  ] });
  const expectedStates = new Map([
    ["name", "PRESENT"],
    ["accountableOwner", "PRESENT"],
    ["intendedPurpose", "PRESENT"],
    ["users", "CONFLICTING"],
    ["exposure.currentUserAccess", "PRESENT"]
  ]);
  const actualPositive = run.intakeGapAnalysis.fields.filter((field) => field.state !== "MISSING_UNKNOWN");
  const truePositiveCount = actualPositive.filter((field) => expectedStates.get(field.fieldId) === field.state).length;
  const falsePositiveCount = actualPositive.filter((field) => !expectedStates.has(field.fieldId)).length;
  const falseNegativeCount = [...expectedStates].filter(([fieldId, state]) => !actualPositive.some((field) => field.fieldId === fieldId && field.state === state)).length;
  const metrics = {
    labelledFieldCount: expectedStates.size,
    truePositiveCount,
    falsePositiveCount,
    falseNegativeCount,
    precision: truePositiveCount / Math.max(1, truePositiveCount + falsePositiveCount),
    recall: truePositiveCount / Math.max(1, truePositiveCount + falseNegativeCount)
  };

  assert.deepEqual(metrics, { labelledFieldCount: 5, truePositiveCount: 5, falsePositiveCount: 0, falseNegativeCount: 0, precision: 1, recall: 1 });
  assert.equal(run.intakeGapAnalysis.fields.find((field) => field.fieldId === "roles").state, "MISSING_UNKNOWN");
  assert.equal(run.intakeGapAnalysis.fields.find((field) => field.fieldId === "intakeAnswers.REGULATORY_ROLES").state, "MISSING_UNKNOWN");
  assert.deepEqual(run.intakeCandidates.candidates.find((candidate) => candidate.fieldId === "users").conflicts, [["EMPLOYEES"], ["CUSTOMERS"]]);
  assert.doesNotMatch(JSON.stringify(run.packets), /Atlas Review Assistant|Risk Team|bounded internal governance reviews/i);
});

test("raw code stays local while the provider-eligible unit contains only a validated deterministic summary", async () => {
  const screened = await parseAndScreenSources([{
    path: "src/private/orchid-runtime.ts",
    mimeType: "text/typescript",
    format: "CODE",
    encoding: "utf8",
    content: `const internalName = "${rawMarker}";\nconst provider = "OpenAI";\nexport function authorize() { return rateLimit(validate(internalName)); }`,
    metadata: {}
  }]);

  assert.equal(screened.localSourceUnits.length, 1);
  assert.match(screened.localSourceUnits[0].content, new RegExp(rawMarker));
  assert.equal(screened.sourceUnits.length, 1);
  const egressUnit = screened.sourceUnits[0];
  assert.equal(egressUnit.evidenceKind, "CODE_SUMMARY");
  assert.equal(egressUnit.derivation.rawContentIncluded, false);
  assert.doesNotMatch(egressUnit.path, /orchid|private|runtime/i);
  assert.doesNotMatch(egressUnit.content, new RegExp(rawMarker));
  const summary = validateCodeEvidenceSummary(JSON.parse(egressUnit.content));
  assert.equal(summary.schemaVersion, CODE_EVIDENCE_SUMMARY_VERSION);
  assert.deepEqual(summary.capabilitySignals, ["AUTHORIZATION", "RATE_LIMITING", "EXTERNAL_MODEL_PROVIDER", "INPUT_VALIDATION"]);
  assert.ok(summary.limitations.includes("NO_RAW_CODE_OR_CONFIGURATION_INCLUDED"));
  assert.doesNotMatch(egressUnit.content, /openai|anthropic|gemini|grok|kimi/i);
  const providerPrompt = discoveryRecheckPrompt([], [{ sourceUnits: screened.sourceUnits }]);
  assert.doesNotMatch(providerPrompt, new RegExp(rawMarker));
  assert.doesNotMatch(providerPrompt, /orchid-runtime|src\/private/i);
  assert.match(providerPrompt, new RegExp(CODE_EVIDENCE_SUMMARY_VERSION));
});

test("CSS follows the code acquisition lane instead of failing document classification", async () => {
  const run = await createPreflight({ sources: [{
    path: "src/theme.css",
    mimeType: "text/css",
    content: ":root { color-scheme: light; } .review { display: grid; }"
  }] });

  assert.equal(run.sourceIngestion.items[0].disposition, "PARSED");
  assert.equal(run.sourceIngestion.items[0].acquisitionLane, "CODE_CONFIGURATION_LOCAL_ANALYSIS");
  assert.equal(run.packets[0].sourceUnits[0].evidenceKind, "CODE_SUMMARY");
  assert.doesNotMatch(JSON.stringify(run.packets), /color-scheme|display: grid/);
});

test("document text prefills Intake locally while only controlled topic signals enter provider packets", async () => {
  const sensitivePurpose = "Assess Project Orchid customer records for internal governance decisions";
  const run = await createPreflight({ sources: [{
    path: "private/customer-orchid-governance.md",
    mimeType: "text/markdown",
    content: `Solution name: Project Orchid\nIntended purpose: ${sensitivePurpose}\nOwner: private.person@example.com\nHuman oversight and monitoring are required.`
  }] });
  const localContent = run.localSourceUnits.map((unit) => unit.content).join("\n");
  const egress = run.packets[0].sourceUnits[0];
  const summary = validateDocumentEvidenceSummary(JSON.parse(egress.content));

  assert.match(localContent, /Project Orchid/);
  assert.equal(run.solutionProfile.fields.name.value, "Project Orchid");
  assert.equal(egress.evidenceKind, "DOCUMENT_SUMMARY");
  assert.equal(egress.derivation.rawContentIncluded, false);
  assert.equal(summary.schemaVersion, DOCUMENT_EVIDENCE_SUMMARY_VERSION);
  assert.deepEqual(summary.topicSignals, ["PURPOSE_AND_VALUE", "HUMAN_OVERSIGHT", "MONITORING_AND_INCIDENTS", "RISK_AND_COMPLIANCE", "OWNERSHIP_AND_ACCOUNTABILITY"]);
  assert.ok(summary.riskSignals.includes("PERSONAL_DATA_PATTERN"));
  assert.doesNotMatch(egress.content, /Orchid|private\.person|customer records/i);
  assert.doesNotMatch(egress.path, /private|customer|orchid/i);
  assert.equal(run.sourceIngestion.items[0].acquisitionLane, "DOCUMENT_LOCAL_ANALYSIS");
  assert.equal(run.sourceIngestion.items[0].analyzerVersion, DOCUMENT_EVIDENCE_SUMMARY_VERSION);
  const providerPrompt = discoveryRecheckPrompt([], run.packets);
  assert.doesNotMatch(providerPrompt, /Project Orchid|private\.person|customer records/i);
  assert.match(providerPrompt, new RegExp(DOCUMENT_EVIDENCE_SUMMARY_VERSION));

  const inconsistent = structuredClone(run.sourceIngestion);
  inconsistent.items[0].rawContentPolicy = "REDACTED_CONTENT_REQUIRES_APPROVAL";
  const { manifestHash: ignored, ...payload } = inconsistent;
  inconsistent.manifestHash = sha256(payload);
  assert.throws(() => validateSourceIngestionManifest(inconsistent), /document acquisition policy is invalid/i);
});

test("only user-selected controlled acquired facts can enter a GenAI proposal packet", async () => {
  const privatePurpose = "Assess Project Orchid customer records";
  const run = await createPreflight({ sources: [{
    path: "case.md",
    mimeType: "text/markdown",
    content: `Intended purpose: ${privatePurpose}\nData categories: PERSONAL_DATA, SYNTHETIC\nCurrent user access: Internal only\nProduction access: No\nUses agents: Yes`
  }] });
  const pkg = validateAcquiredFactPackage(run.acquiredFacts);
  const purpose = pkg.facts.find((fact) => fact.fieldId === "intendedPurpose");
  const categories = pkg.facts.find((fact) => fact.fieldId === "data.categories");
  const access = pkg.facts.find((fact) => fact.fieldId === "exposure.currentUserAccess");

  assert.equal(purpose.genAiEligibility, "INELIGIBLE_FREE_TEXT");
  assert.equal(purpose.value, null);
  assert.equal(categories.genAiEligibility, "ELIGIBLE_CONTROLLED_VALUE");
  assert.deepEqual(categories.value, ["SYNTHETIC", "PERSONAL_DATA"]);
  const unit = createAcquiredFactSelectionUnit(pkg, [categories.id, access.id]);
  assert.equal(unit.derivation.contractVersion, ACQUIRED_FACT_SELECTION_VERSION);
  assert.deepEqual(Object.keys(JSON.parse(unit.content).facts[0]).sort(), ["dataType", "fieldId", "id", "value"]);
  assert.match(unit.content, /PERSONAL_DATA|INTERNAL_ONLY/);
  assert.doesNotMatch(unit.content, /Project Orchid|customer records/i);
  assert.throws(() => createAcquiredFactSelectionUnit(pkg, [purpose.id]), /not eligible for GenAI/i);

  const tampered = structuredClone(pkg);
  tampered.facts.find((fact) => fact.fieldId === "intendedPurpose").value = privatePurpose;
  assert.throws(() => validateAcquiredFactPackage(tampered), /value disclosure|integrity check/i);
});

test("a blocking screening result withholds every acquired fact from GenAI selection", async () => {
  const run = await createPreflight({ sources: [
    { path: "case.md", mimeType: "text/markdown", content: "Current user access: Internal only" },
    { path: "screen.png", mimeType: "image/png", encoding: "base64", content: Buffer.from("89504e470d0a1a0a00000000", "hex").toString("base64") }
  ] });

  assert.ok(run.dlpFindings.some((finding) => finding.blocking));
  assert.ok(run.acquiredFacts.facts.every((fact) => fact.genAiEligibility === "INELIGIBLE_BLOCKING_SCREENING" && fact.value === null));
});

test("GenAI proposal transmission contains selected acquired facts but not ineligible free text", async () => {
  const privatePurpose = "Assess Project Orchid customer records";
  const run = await createPreflight({ sources: [{
    path: "case.md",
    mimeType: "text/markdown",
    content: `Intended purpose: ${privatePurpose}\nCurrent user access: Internal only`
  }] });
  const access = run.acquiredFacts.facts.find((fact) => fact.fieldId === "exposure.currentUserAccess");
  const acquiredFactUnit = createAcquiredFactSelectionUnit(run.acquiredFacts, [access.id]);
  const policy = modelPolicy({ MOONSHOT_API_KEY: "test" });
  let transmittedPrompt = "";
  const client = new StructuredModelClient({ policy, budget: new ModelBudget({ maxCalls: 2 }), transport: async ({ prompt, profile }) => {
    transmittedPrompt = prompt;
    const start = prompt.indexOf("TARGET_FIELDS\n") + "TARGET_FIELDS\n".length;
    const fields = JSON.parse(prompt.slice(start, prompt.indexOf("\nSOURCE_PACKET", start)));
    return {
      value: { candidates: fields.map(({ field }) => ({ field, status: "NOT_FOUND", recommendation: "PROVIDE_INFORMATION", value: "", sourceUnitIds: [], evidenceQuotes: [], rationale: "No additional supported value was found." })) },
      responseModel: profile.model,
      usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 }
    };
  } });
  const approvedPackets = run.packets.map((packet) => ({ packetId: packet.id, providers: ["MOONSHOT"] }));
  await recheckDiscovery(run, { approvedPackets }, { policy, client, acquiredFactUnit });

  assert.match(transmittedPrompt, new RegExp(ACQUIRED_FACT_SELECTION_VERSION));
  assert.match(transmittedPrompt, /INTERNAL_ONLY/);
  assert.doesNotMatch(transmittedPrompt, /Project Orchid|customer records/i);
  assert.equal(run.transmissionManifest[0].containsRawEvidence, false);
  assert.deepEqual(run.transmissionManifest[0].derivationContracts, [DOCUMENT_EVIDENCE_SUMMARY_VERSION, ACQUIRED_FACT_SELECTION_VERSION]);
});

test("the acquisition manifest records the code lane, raw handling, derivation and content hash", async () => {
  const run = await createPreflight({ sources: [{
    path: "package.json",
    mimeType: "application/json",
    encoding: "utf8",
    content: JSON.stringify({ name: "private-governance-product", scripts: { start: "node server.js" } })
  }] });

  const item = run.sourceIngestion.items[0];
  assert.equal(run.sourceIngestion.acquisitionContractVersion, "evidence-acquisition-1.1.0");
  assert.equal(run.sourceIngestion.laneCounts.CODE_CONFIGURATION_LOCAL_ANALYSIS, 1);
  assert.deepEqual({ lane: item.acquisitionLane, raw: item.rawContentPolicy, egress: item.egressPolicy }, {
    lane: "CODE_CONFIGURATION_LOCAL_ANALYSIS",
    raw: "LOCAL_ONLY",
    egress: "DETERMINISTIC_SUMMARY_ONLY"
  });
  assert.equal(item.analyzerVersion, CODE_EVIDENCE_SUMMARY_VERSION);
  assert.deepEqual(item.derivedUnitIds, run.packets.flatMap((packet) => packet.sourceUnits.map((unit) => unit.id)));
  assert.match(run.sourceIngestion.manifestHash, /^[a-f0-9]{64}$/);
  assert.equal(run.solutionProfile.suggestedDossier.name, "private-governance-product");
  assert.doesNotMatch(JSON.stringify(publicPreflightView(run).packets), /private-governance-product/);

  const inconsistent = structuredClone(run.sourceIngestion);
  inconsistent.items[0].egressPolicy = "REDACTED_SOURCE_UNITS";
  const { manifestHash: ignored, ...payload } = inconsistent;
  inconsistent.manifestHash = sha256(payload);
  assert.throws(() => validateSourceIngestionManifest(inconsistent), /acquisition policy is invalid/i);
});

test("AI Intake recheck transmits the code summary contract and records that raw evidence was excluded", async () => {
  const run = await createPreflight({ sources: [{
    path: "package.json",
    mimeType: "application/json",
    content: JSON.stringify({ name: rawMarker, scripts: { start: "node server.js" } })
  }] });
  const policy = modelPolicy({ MOONSHOT_API_KEY: "test" });
  let transmittedPrompt = "";
  const client = new StructuredModelClient({ policy, budget: new ModelBudget({ maxCalls: 2 }), transport: async ({ prompt, profile }) => {
    transmittedPrompt = prompt;
    const start = prompt.indexOf("TARGET_FIELDS\n") + "TARGET_FIELDS\n".length;
    const fields = JSON.parse(prompt.slice(start, prompt.indexOf("\nSOURCE_PACKET", start)));
    return {
      value: { candidates: fields.map(({ field }) => ({ field, status: "NOT_FOUND", recommendation: "PROVIDE_INFORMATION", value: "", sourceUnitIds: [], evidenceQuotes: [], rationale: "The bounded summary does not establish this Intake field." })) },
      responseModel: profile.model,
      usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 }
    };
  } });
  const approvedPackets = run.packets.map((packet) => ({ packetId: packet.id, providers: ["MOONSHOT"] }));
  await recheckDiscovery(run, { approvedPackets }, { policy, client });

  assert.match(transmittedPrompt, new RegExp(CODE_EVIDENCE_SUMMARY_VERSION));
  assert.doesNotMatch(transmittedPrompt, new RegExp(rawMarker));
  assert.doesNotMatch(transmittedPrompt, /package\.json/i);
  assert.match(transmittedPrompt, /"field":"name"[^}]*"valueWithheld":true/);
  assert.equal(run.transmissionManifest[0].containsRawEvidence, false);
  assert.deepEqual(run.transmissionManifest[0].derivationContracts, [CODE_EVIDENCE_SUMMARY_VERSION]);
});

test("CSV values and headers remain local while only a bounded tabular profile enters packets", async () => {
  const csv = `customer_email,invoice_amount,period,status\nprivate.person@example.com,91827.45,2026-08-01,${rawMarker}\n,,2026-08-02,pending`;
  const run = await createPreflight({ sources: [{ path: "finance/private-export.csv", mimeType: "text/csv", content: csv }] });
  const localContent = run.localSourceUnits.map((unit) => unit.content).join("\n");
  const egressUnit = run.packets[0].sourceUnits[0];
  const summary = validateTabularEvidenceSummary(JSON.parse(egressUnit.content));

  assert.match(localContent, new RegExp(rawMarker));
  assert.equal(egressUnit.evidenceKind, "TABULAR_SUMMARY");
  assert.equal(egressUnit.derivation.rawContentIncluded, false);
  assert.doesNotMatch(egressUnit.content, new RegExp(rawMarker));
  assert.doesNotMatch(egressUnit.content, /private\.person|customer_email|invoice_amount|91827/);
  assert.deepEqual(summary.semanticSignals, ["IDENTIFIER_COLUMNS", "PERSONAL_DATA_COLUMNS", "FINANCIAL_DATA_COLUMNS", "TIMESTAMP_COLUMNS", "STATUS_COLUMNS"]);
  assert.deepEqual(summary.structureSignals, ["HAS_TEXT", "HAS_NUMERIC", "HAS_DATE", "HAS_EMPTY_VALUES"]);
  assert.equal(run.sourceIngestion.items[0].acquisitionLane, "TABULAR_LOCAL_ANALYSIS");
  assert.equal(run.sourceIngestion.items[0].rawContentPolicy, "LOCAL_ONLY");
  assert.equal(run.sourceIngestion.items[0].analyzerVersion, TABULAR_EVIDENCE_SUMMARY_VERSION);
  assert.doesNotMatch(JSON.stringify(publicPreflightView(run).packets), /private\.person|91827|customer_email/);
});

test("XLSX summaries expose coarse dimensions and controlled signals without cells", () => {
  const unit = createTabularEvidenceUnit({
    sourceId: "src-0123456789abcdef01234567",
    sourceHash: "a".repeat(64),
    format: "XLSX",
    segments: [
      { locator: "sheet:Customers", text: `R1C1=employee_id\tR1C2=amount\nR2C1=${rawMarker}\tR2C2=1000` },
      { locator: "sheet:Results", text: "R1C1=model\tR1C2=accuracy\nR2C1=private-model\tR2C2=0.91" }
    ]
  });
  const summary = validateTabularEvidenceSummary(JSON.parse(unit.content));
  assert.equal(summary.sheetCountRange, "2_10");
  assert.equal(summary.rowCountRange, "1_10");
  assert.equal(summary.columnCountRange, "1_10");
  assert.ok(summary.semanticSignals.includes("MODEL_EVALUATION_COLUMNS"));
  assert.doesNotMatch(unit.content, new RegExp(rawMarker));
  assert.doesNotMatch(unit.content, /private-model|Customers|Results|employee_id/);
});

test("image pixels remain local even when the client labels the image sanitized", async () => {
  const pixels = Buffer.from("89504e470d0a1a0a00000000", "hex");
  const encodedPixels = pixels.toString("base64");
  const run = await createPreflight({ sources: [{
    path: "screenshots/private-customer-screen.png",
    mimeType: "image/png",
    encoding: "base64",
    content: encodedPixels,
    metadata: { sanitized: true }
  }] });
  const local = run.localSourceUnits[0];
  const egress = run.packets[0].sourceUnits[0];
  const summary = validateMediaEvidenceSummary(JSON.parse(egress.content));

  assert.equal(local.media.data, encodedPixels);
  assert.equal(egress.media, undefined);
  assert.equal(egress.evidenceKind, "MEDIA_SUMMARY");
  assert.equal(egress.derivation.rawContentIncluded, false);
  assert.equal(summary.schemaVersion, MEDIA_EVIDENCE_SUMMARY_VERSION);
  assert.equal(summary.visualContentState, "OCR_NOT_COMPLETED_VISUAL_CONTENT_NOT_ASSESSED");
  assert.doesNotMatch(egress.path, /private|customer|screen/i);
  assert.equal(run.sourceIngestion.items[0].acquisitionLane, "MEDIA_LOCAL_OCR_ANALYSIS");
  assert.equal(run.sourceIngestion.items[0].rawContentPolicy, "LOCAL_ONLY");
  assert.equal(run.sourceIngestion.items[0].analyzerVersion, MEDIA_EVIDENCE_SUMMARY_VERSION);

  const providerPrompt = discoveryRecheckPrompt([], run.packets);
  assert.match(providerPrompt, new RegExp(MEDIA_EVIDENCE_SUMMARY_VERSION));
  assert.doesNotMatch(providerPrompt, new RegExp(encodedPixels));
  assert.doesNotMatch(providerPrompt, /private-customer-screen|screenshots\//i);
  assert.doesNotMatch(JSON.stringify(publicPreflightView(run).packets), new RegExp(encodedPixels));

  const inconsistent = structuredClone(run.sourceIngestion);
  inconsistent.items[0].egressPolicy = "REDACTED_SOURCE_UNITS";
  const { manifestHash: ignored, ...payload } = inconsistent;
  inconsistent.manifestHash = sha256(payload);
  assert.throws(() => validateSourceIngestionManifest(inconsistent), /media acquisition policy is invalid/i);
});

test("purging a run clears both local raw material and provider-eligible summaries", async () => {
  const encodedPixels = Buffer.from("89504e470d0a1a0a00000000", "hex").toString("base64");
  const run = await createPreflight({ sources: [{
    path: "private-screen.png",
    mimeType: "image/png",
    encoding: "base64",
    content: encodedPixels
  }] });
  const store = new EphemeralRunStore();
  store.create(run);
  assert.equal(store.purge(run.id), true);
  assert.ok(run.localSourceUnits.every((unit) => unit.content === "" && unit.transmissionState === "PURGED"));
  assert.ok(run.localSourceUnits.every((unit) => !unit.media || unit.media.data === ""));
  assert.ok(run.packets.every((packet) => packet.transmissionState === "PURGED" && packet.sourceUnits.every((unit) => unit.content === "")));
  store.close();
});
