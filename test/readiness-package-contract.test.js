import test from "node:test";
import assert from "node:assert/strict";
import { assessSolution } from "../src/engine.js";
import { readinessPackageJsonSchema, validateReadinessPackage } from "../src/readiness-package-contract.js";
import { SAMPLE_REQUEST } from "../src/sample.js";

test("the complete deterministic package passes its versioned runtime contract", async () => {
  const pkg = await assessSolution(structuredClone(SAMPLE_REQUEST));
  assert.strictEqual(validateReadinessPackage(pkg), pkg);
  assert.equal(Object.hasOwn(pkg, "cognitive"), false);
});

test("the published package schema closes the top-level contract and authority invariants", async () => {
  const pkg = await assessSolution(structuredClone(SAMPLE_REQUEST));
  const schema = readinessPackageJsonSchema(pkg.schemaVersion);
  assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.equal(schema["x-contract-coverage"], "TOP_LEVEL_AND_GOVERNANCE_INVARIANTS");
  assert.deepEqual([...schema.required].sort(), Object.keys(pkg).sort());
  assert.deepEqual(Object.keys(schema.properties).sort(), Object.keys(pkg).sort());
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.properties.recommendation.properties.formalApproval, { const: false });
  assert.deepEqual(schema.properties.transitionBoundary.properties.immutable, { const: true });

  const cognitiveSchema = readinessPackageJsonSchema("2.6.0");
  assert.equal(cognitiveSchema.properties.cognitive.properties.contractVersion.const, "3.1.0");
  assert.equal(cognitiveSchema.properties.cognitive.properties.rolloutMode.const, "ENABLED");
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
