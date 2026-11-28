import test from "node:test";
import assert from "node:assert/strict";
import Ajv2020 from "ajv/dist/2020.js";
import { assessSolution, assessVerifiedSolution } from "../src/engine.js";
import { createPreflight, confirmPreflightDossier } from "../src/cognitive/preflight.js";
import { createIntakeResolutionDraft } from "../src/intake/contracts.js";
import { buildDeclarationComparison } from "../src/intake/declaration-comparison.js";
import { validateDossier } from "../src/contracts.js";
import { readFile } from "node:fs/promises";
import { readinessPackageJsonSchema, validateReadinessPackage } from "../src/readiness-package-contract.js";
import { publicJsonValue } from "../public/content-policy.js";
import { SAMPLE_REQUEST } from "../src/sample.js";

function compilePublishedSchema(schema) {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  ajv.addFormat("date-time", /^\d{4}-\d{2}-\d{2}T/);
  ajv.addKeyword({ keyword: "x-contract-coverage", schemaType: "string" });
  return ajv.compile(schema);
}

test("the complete deterministic package passes its versioned runtime contract", async () => {
  const pkg = await assessSolution(structuredClone(SAMPLE_REQUEST));
  assert.strictEqual(validateReadinessPackage(pkg), pkg);
  assert.equal(Object.hasOwn(pkg, "cognitive"), false);
});

test("the published package schema closes nested ledgers and authority invariants", async () => {
  const pkg = await assessSolution(structuredClone(SAMPLE_REQUEST));
  const schema = readinessPackageJsonSchema(pkg.schemaVersion);
  assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.equal(schema["x-contract-coverage"], "NESTED_LEDGERS_AND_GOVERNANCE_INVARIANTS");
  assert.deepEqual([...schema.required].sort(), Object.keys(pkg).sort());
  assert.deepEqual(Object.keys(schema.properties).sort(), Object.keys(pkg).sort());
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.properties.recommendation.properties.formalApproval, { const: false });
  assert.deepEqual(schema.properties.transitionBoundary.properties.immutable, { const: true });
  assert.equal(schema.properties.knowledge.additionalProperties, false);
  assert.equal(schema.properties.dimensions.additionalProperties, false);
  assert.equal(schema.properties.hardGates.items.additionalProperties, false);
  assert.equal(schema.properties.humanDecisionRequirements.items.additionalProperties, false);
  assert.equal(schema.properties.actionGroundingRecords.items.additionalProperties, false);
  assert.equal(schema.properties.publicationGate.additionalProperties, false);
  assert.equal(schema.properties.coverageMatrix.additionalProperties, false);

  const validate = compilePublishedSchema(schema);
  assert.equal(validate(pkg), true, JSON.stringify(validate.errors, null, 2));
  assert.doesNotThrow(() => validateReadinessPackage(JSON.parse(JSON.stringify(publicJsonValue(pkg)))));

  const cognitiveSchema = readinessPackageJsonSchema("2.6.0");
  assert.equal(cognitiveSchema.properties.cognitive.properties.contractVersion.const, "3.1.0");
  assert.equal(cognitiveSchema.properties.cognitive.properties.rolloutMode.const, "ENABLED");
  assert.equal(cognitiveSchema.properties.cognitive.additionalProperties, false);
  for (const field of ["solutionModel", "coverage", "claimLedger", "transmissionManifest", "actionGroundingRecords", "publicationGate"]) {
    assert.ok(cognitiveSchema.properties.cognitive.required.includes(field));
  }

  const golden = await readFile(new URL("./fixtures/doc-support-handoff.golden.json", import.meta.url), "utf8");
  const preflight = await createPreflight({
    documentationHandoff: golden,
    sources: [{ path: "README.md", mimeType: "text/markdown", content: "# Record review assistant\nAccountable owner: Review Owner" }]
  });
  const approvedDossier = validateDossier({ ...preflight.solutionProfile.suggestedDossier, name: "Record review assistant", accountableOwner: "Review Owner" });
  await confirmPreflightDossier(preflight, {
    dossier: approvedDossier,
    resolutions: createIntakeResolutionDraft(approvedDossier, preflight.solutionProfile),
    approval: { confirmed: true, actorRef: "CONTRACT_TEST" }
  });
  const comparison = buildDeclarationComparison(preflight.approvedIntake, preflight.localSourceUnits, preflight.registeredSources);
  const v2Provisional = await assessVerifiedSolution({
    dossier: preflight.approvedIntake.effectiveDossier,
    runId: preflight.id,
    registeredSources: preflight.registeredSources,
    sourceIngestion: preflight.sourceIngestion,
    solutionProfile: preflight.solutionProfile,
    solutionModel: { facts: [] },
    declaredDocumentation: preflight.approvedIntake.declaredDocumentation,
    declarationComparison: comparison
  }, { provisional: true });
  const validateV1Like = compilePublishedSchema(readinessPackageJsonSchema("1.4.0"));
  const v1Shape = { ...v2Provisional, schemaVersion: "1.4.0" };
  delete v1Shape.cognitive;
  assert.equal(validateV1Like(v1Shape), true, JSON.stringify(validateV1Like.errors, null, 2));
});

test("the published evidence contracts allow only privacy-safe ledger fields", async () => {
  const pkg = await assessSolution(structuredClone(SAMPLE_REQUEST));
  const schema = readinessPackageJsonSchema(pkg.schemaVersion);
  const evidenceSchema = schema.properties.evidence.items;
  const ingestionSchema = schema.properties.sourceIngestion;
  const allowedEvidenceFields = new Set(Object.keys(evidenceSchema.properties));
  const allowedIngestionFields = new Set(Object.keys(ingestionSchema.properties));
  const allowedItemFields = new Set(Object.keys(ingestionSchema.properties.items.items.properties));

  assert.equal(evidenceSchema.additionalProperties, false);
  assert.equal(ingestionSchema.additionalProperties, false);
  assert.equal(ingestionSchema.properties.items.items.additionalProperties, false);
  assert.ok(pkg.evidence.every((item) => Object.keys(item).every((field) => allowedEvidenceFields.has(field))));
  assert.ok(pkg.evidence.every((item) => evidenceSchema.required.every((field) => Object.hasOwn(item, field))));
  assert.ok(Object.keys(pkg.sourceIngestion).every((field) => allowedIngestionFields.has(field)));
  assert.ok(ingestionSchema.required.every((field) => Object.hasOwn(pkg.sourceIngestion, field)));
  assert.ok(pkg.sourceIngestion.items.every((item) => Object.keys(item).every((field) => allowedItemFields.has(field))));
  assert.ok(pkg.sourceIngestion.items.every((item) => ingestionSchema.properties.items.items.required.every((field) => Object.hasOwn(item, field))));
  for (const prohibited of ["content", "rawContent", "bytes", "cells", "pixels", "metadata"]) {
    assert.equal(allowedEvidenceFields.has(prohibited), false);
    assert.equal(allowedItemFields.has(prohibited), false);
    assert.equal(Object.hasOwn(schema.properties.knowledge.properties, prohibited), false);
    assert.equal(Object.hasOwn(schema.properties.hardGates.items.properties, prohibited), false);
    assert.equal(Object.hasOwn(schema.properties.actionGroundingRecords.items.properties, prohibited), false);
  }
});

test("the runtime contract rejects drift, authority escalation and hash tampering", async () => {
  const pkg = await assessSolution(structuredClone(SAMPLE_REQUEST));

  const drifted = structuredClone(pkg);
  drifted.unregistered = true;
  assert.throws(() => validateReadinessPackage(drifted), /missing or unregistered fields/i);

  const escalated = structuredClone(pkg);
  escalated.recommendation.formalApproval = true;
  assert.throws(() => validateReadinessPackage(escalated), /formalApproval must remain false/i);

  const tampered = structuredClone(pkg);
  tampered.solution.name = "Changed after package construction";
  assert.throws(() => validateReadinessPackage(tampered), /integrity check/i);
});
