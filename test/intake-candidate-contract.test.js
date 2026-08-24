import test from "node:test";
import assert from "node:assert/strict";
import { createPreflight, publicPreflightView } from "../src/cognitive/preflight.js";
import { serializeDurableRun } from "../src/cognitive/run-persistence.js";
import { sha256 } from "../src/core/hash.js";
import { validateAcquiredFactPackage } from "../src/intake/acquired-facts.js";
import { INTAKE_CANDIDATE_PACKAGE_VERSION, validateIntakeCandidatePackage } from "../src/intake/candidate-contract.js";

test("the candidate contract keeps screened free text local and projects only controlled values", async () => {
  const privateMarker = "synthetic.person@example.com";
  const run = await createPreflight({ sources: [
    { path: "docs/architecture.html", mimeType: "text/html", encoding: "utf8", content: `<h2>Intended purpose</h2><p>Support reviews for ${privateMarker}</p>` },
    { path: "case.md", mimeType: "text/markdown", encoding: "utf8", content: "Current user access: Internal only" },
    { path: "governance/raci.html", mimeType: "text/html", encoding: "utf8", content: "<table><tr><td>Accountable</td><td>Governance Team</td></tr></table>" }
  ] });
  const pkg = validateIntakeCandidatePackage(run.intakeCandidates);
  const purpose = pkg.candidates.find((candidate) => candidate.fieldId === "intendedPurpose");
  const owner = pkg.candidates.find((candidate) => candidate.fieldId === "accountableOwner");
  const access = pkg.candidates.find((candidate) => candidate.fieldId === "exposure.currentUserAccess");

  assert.equal(pkg.schemaVersion, INTAKE_CANDIDATE_PACKAGE_VERSION);
  assert.match(pkg.packageHash, /^[a-f0-9]{64}$/);
  assert.equal(purpose.sanitizedCandidate, "Support reviews for [REDACTED_EMAIL]");
  assert.equal(purpose.sourceRefs[0].extractionMethod, "HEADING_VALUE");
  assert.equal(purpose.confidence, "MEDIUM");
  assert.equal(purpose.disclosurePolicy, "LOCAL_ONLY_SANITIZED_FREE_TEXT");
  assert.equal(purpose.providerEligibility, "INELIGIBLE_FREE_TEXT");
  assert.equal(purpose.providerCandidate, null);
  assert.equal(owner.sourceRefs[0].extractionMethod, "TABLE_KEY_VALUE");
  assert.equal(owner.providerEligibility, "INELIGIBLE_FIELD_POLICY");
  assert.equal(access.sourceRefs[0].extractionMethod, "LABELLED_ENUM");
  assert.equal(access.confidence, "HIGH");
  assert.equal(access.providerCandidate, "INTERNAL_ONLY");
  assert.doesNotMatch(JSON.stringify(pkg), new RegExp(privateMarker.replaceAll(".", "\\.")));

  const acquired = validateAcquiredFactPackage(run.acquiredFacts);
  assert.equal(acquired.candidatePackageVersion, pkg.schemaVersion);
  assert.equal(acquired.candidatePackageHash, pkg.packageHash);
  assert.equal(acquired.facts.find((fact) => fact.fieldId === "intendedPurpose").value, null);
  assert.equal(acquired.facts.find((fact) => fact.fieldId === "exposure.currentUserAccess").value, "INTERNAL_ONLY");
  assert.equal(publicPreflightView(run).intakeCandidates.packageHash, pkg.packageHash);

  const durable = serializeDurableRun(run);
  assert.equal(durable.run.intakeCandidates, null);
  assert.doesNotMatch(JSON.stringify(durable), /Support reviews|Governance Team|synthetic\.person/);
});

test("conflicting local candidates remain explicit and cannot become provider eligible", async () => {
  const run = await createPreflight({ sources: [
    { path: "purpose-a.md", mimeType: "text/markdown", encoding: "utf8", content: "Intended purpose: Support internal reviews" },
    { path: "purpose-b.md", mimeType: "text/markdown", encoding: "utf8", content: "Intended purpose: Automate external decisions" }
  ] });
  const candidate = validateIntakeCandidatePackage(run.intakeCandidates).candidates.find((item) => item.fieldId === "intendedPurpose");

  assert.equal(candidate.sanitizedCandidate, null);
  assert.deepEqual(candidate.conflicts, ["Support internal reviews", "Automate external decisions"]);
  assert.equal(candidate.confidence, "REVIEW_REQUIRED");
  assert.equal(candidate.providerEligibility, "INELIGIBLE_CONFLICTING");
  assert.equal(candidate.providerCandidate, null);
  assert.equal(candidate.sourceRefs.length, 2);
});

test("candidate contract validation rejects disclosure-policy and sanitization tampering", async () => {
  const run = await createPreflight({ sources: [{ path: "case.md", mimeType: "text/markdown", encoding: "utf8", content: "Intended purpose: Support bounded reviews" }] });
  const disclosed = structuredClone(run.intakeCandidates);
  const purpose = disclosed.candidates.find((candidate) => candidate.fieldId === "intendedPurpose");
  purpose.providerEligibility = "ELIGIBLE_CONTROLLED_VALUE";
  purpose.providerCandidate = purpose.sanitizedCandidate;
  assert.throws(() => validateIntakeCandidatePackage(disclosed), /provider disclosure|local-only free text|integrity check/i);

  const unscreened = structuredClone(run.intakeCandidates);
  unscreened.candidates.find((candidate) => candidate.fieldId === "intendedPurpose").sanitizedCandidate = "synthetic.person@example.com";
  assert.throws(() => validateIntakeCandidatePackage(unscreened), /unscreened sensitive text/i);

  const unobserved = structuredClone(run.intakeCandidates);
  const access = unobserved.candidates.find((candidate) => candidate.fieldId === "exposure.currentUserAccess");
  access.sanitizedCandidate = "INTERNAL_ONLY";
  access.providerEligibility = "ELIGIBLE_CONTROLLED_VALUE";
  access.providerCandidate = "INTERNAL_ONLY";
  access.sourceRefs = [];
  access.acquisitionState = "UNKNOWN";
  const { packageHash: _oldHash, ...payload } = unobserved;
  unobserved.packageHash = sha256(payload);
  assert.throws(() => validateIntakeCandidatePackage(unobserved), /provider candidate is not observed/i);
});
