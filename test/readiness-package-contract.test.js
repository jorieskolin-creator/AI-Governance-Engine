import test from "node:test";
import assert from "node:assert/strict";
import { assessSolution } from "../src/engine.js";
import { validateReadinessPackage } from "../src/readiness-package-contract.js";
import { SAMPLE_REQUEST } from "../src/sample.js";

test("the complete deterministic package passes its versioned runtime contract", async () => {
  const pkg = await assessSolution(structuredClone(SAMPLE_REQUEST));
  assert.strictEqual(validateReadinessPackage(pkg), pkg);
  assert.equal(Object.hasOwn(pkg, "cognitive"), false);
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
