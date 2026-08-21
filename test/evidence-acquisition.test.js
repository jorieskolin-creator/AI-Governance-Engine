import test from "node:test";
import assert from "node:assert/strict";
import { createPreflight, publicPreflightView } from "../src/cognitive/preflight.js";
import { recheckDiscovery } from "../src/cognitive/discovery-recheck.js";
import { modelPolicy } from "../src/cognitive/model-policy.js";
import { ModelBudget, StructuredModelClient } from "../src/cognitive/provider-client.js";
import { EphemeralRunStore } from "../src/cognitive/run-store.js";
import { discoveryRecheckPrompt } from "../src/cognitive/prompts.js";
import { parseAndScreenSources } from "../src/cognitive/source-intake.js";
import { sha256 } from "../src/core/hash.js";
import { validateSourceIngestionManifest } from "../src/core/source-ingestion.js";
import { CODE_EVIDENCE_SUMMARY_VERSION, validateCodeEvidenceSummary } from "../src/intake/code-evidence.js";
import { createTabularEvidenceUnit, TABULAR_EVIDENCE_SUMMARY_VERSION, validateTabularEvidenceSummary } from "../src/intake/tabular-evidence.js";

const rawMarker = "internal-project-orchid-customer-table";

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

test("the acquisition manifest records the code lane, raw handling, derivation and content hash", async () => {
  const run = await createPreflight({ sources: [{
    path: "package.json",
    mimeType: "application/json",
    encoding: "utf8",
    content: JSON.stringify({ name: "private-governance-product", scripts: { start: "node server.js" } })
  }] });

  const item = run.sourceIngestion.items[0];
  assert.equal(run.sourceIngestion.acquisitionContractVersion, "evidence-acquisition-1.0.0");
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
  const policy = modelPolicy({ ANTHROPIC_API_KEY: "test", NODE_ENV: "development" });
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
  const approvedPackets = run.packets.map((packet) => ({ packetId: packet.id, providers: ["ANTHROPIC"] }));
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

test("purging a run clears both local raw material and provider-eligible summaries", async () => {
  const run = await createPreflight({ sources: [{
    path: "src/runtime.js",
    mimeType: "application/javascript",
    content: `export const internalValue = "${rawMarker}";`
  }] });
  const store = new EphemeralRunStore();
  store.create(run);
  assert.equal(store.purge(run.id), true);
  assert.ok(run.localSourceUnits.every((unit) => unit.content === "" && unit.transmissionState === "PURGED"));
  assert.ok(run.packets.every((packet) => packet.transmissionState === "PURGED" && packet.sourceUnits.every((unit) => unit.content === "")));
  store.close();
});
