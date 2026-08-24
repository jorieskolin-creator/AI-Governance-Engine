import test from "node:test";
import assert from "node:assert/strict";
import { createPreflight } from "../src/cognitive/preflight.js";
import { discoverSolutionProfile } from "../src/core/solution-profile.js";
import { INTAKE_FIELD_REGISTRY } from "../src/intake/field-registry.js";
import { INTAKE_SEARCH_REGISTRY, intakeSearchField } from "../src/intake/search-registry.js";

test("the versioned deterministic search registry covers every canonical Intake field", () => {
  assert.equal(INTAKE_SEARCH_REGISTRY.version, "intake-search-registry-1.1.0");
  assert.equal(INTAKE_SEARCH_REGISTRY.fieldRegistryVersion, INTAKE_FIELD_REGISTRY.version);
  assert.equal(INTAKE_SEARCH_REGISTRY.fieldRegistryHash, INTAKE_FIELD_REGISTRY.hash);
  assert.match(INTAKE_SEARCH_REGISTRY.hash, /^[a-f0-9]{64}$/);
  assert.equal(Object.isFrozen(INTAKE_SEARCH_REGISTRY), true);
  for (const field of INTAKE_FIELD_REGISTRY.fields) {
    const search = intakeSearchField(field.id);
    assert.ok(search, field.id);
    assert.ok(search.labels.length, field.id);
    assert.ok(search.evidenceTypes.length, field.id);
    assert.ok(search.sourcePriorities.length, field.id);
    assert.ok(search.extractionStrategies.length, field.id);
  }
  for (const fieldId of Object.keys(discoverSolutionProfile([]).fields)) assert.ok(intakeSearchField(fieldId), fieldId);
  assert.ok(intakeSearchField("name").extractionStrategies.includes("HTML_ARCHITECTURE_TITLE"));
  assert.equal(intakeSearchField("roles").labels.includes("roles"), false);
  assert.equal(intakeSearchField("intakeAnswers.REGULATORY_ROLES").labels.includes("roles"), false);
  assert.match(INTAKE_SEARCH_REGISTRY.conflictPolicy, /never silently resolves a conflict/i);
});

test("manifests, README content, architecture sections, RACI tables and structured reports are searched deterministically", async () => {
  const run = await createPreflight({ sources: [
    { path: "package.json", mimeType: "application/json", encoding: "utf8", content: JSON.stringify({ name: "synthetic-search-fixture" }) },
    { path: "README.md", mimeType: "text/markdown", encoding: "utf8", content: "# Synthetic Search Fixture" },
    { path: "docs/architecture.html", mimeType: "text/html", encoding: "utf8", content: `<h2>Intended purpose</h2><p>Support bounded synthetic reviews</p><script type="application/json">{"expectedOutcome":"Reduce review latency"}</script>` },
    { path: "governance/raci.html", mimeType: "text/html", encoding: "utf8", content: "<table><tr><th>Responsibility</th><th>Assignment</th></tr><tr><td>Accountable</td><td>Governance Team</td></tr></table>" }
  ] });

  assert.equal(run.solutionProfile.version, "solution-profile-1.3.0");
  assert.equal(run.solutionProfile.searchRegistryVersion, INTAKE_SEARCH_REGISTRY.version);
  assert.equal(run.solutionProfile.searchRegistryHash, INTAKE_SEARCH_REGISTRY.hash);
  assert.equal(run.solutionProfile.suggestedDossier.name, "synthetic-search-fixture");
  assert.equal(run.solutionProfile.suggestedDossier.intendedPurpose, "Support bounded synthetic reviews");
  assert.equal(run.solutionProfile.suggestedDossier.expectedValue, "Reduce review latency");
  assert.equal(run.solutionProfile.suggestedDossier.accountableOwner, "Governance Team");
  for (const field of ["name", "intendedPurpose", "expectedValue", "accountableOwner"]) {
    assert.equal(run.solutionProfile.fields[field].factClass, "OBSERVED", field);
    assert.ok(run.solutionProfile.fields[field].sourceUnitIds.length > 0, field);
  }
  assert.doesNotMatch(JSON.stringify(run.packets), /synthetic-search-fixture|Support bounded synthetic reviews|Reduce review latency|Governance Team/);
});

test("source priority never silently resolves conflicting deterministic candidates", () => {
  const profile = discoverSolutionProfile([
    { id: "declared-owner", sourceId: "declared", path: "case/intended-use-dossier.json", artifactClass: "CONFIGURATION", format: "TEXT", evidenceClass: "DECLARED", locator: "text", content: JSON.stringify({ accountableOwner: "Product Team" }) },
    { id: "raci-owner", sourceId: "raci", path: "governance/raci.html", artifactClass: "DOCUMENTATION", format: "HTML", locator: "html:section:1;table:1;row:2", content: "Accountable | Risk Team" }
  ]);

  assert.equal(profile.suggestedDossier.accountableOwner, "");
  assert.equal(profile.fields.accountableOwner.status, "CONFLICTING");
  assert.deepEqual(profile.fields.accountableOwner.candidates.map((candidate) => candidate.value), ["Product Team", "Risk Team"]);
  assert.deepEqual(profile.fields.accountableOwner.sourceUnitIds, ["declared-owner", "raci-owner"]);
});

test("HTML titles can identify a candidate without confusing operational model roles with regulatory roles", async () => {
  const run = await createPreflight({ sources: [{
    path: "docs/current-architecture.html",
    mimeType: "text/html",
    encoding: "utf8",
    content: "<html><head><title>Orchid Governance Engine — Current Architecture</title></head><body><p>Roles: REASONER · WORKHORSE · QUALITY_CHECKER with explicit primary to fallback provider routing.</p></body></html>"
  }] });

  assert.equal(run.solutionProfile.suggestedDossier.name, "Orchid Governance Engine");
  assert.deepEqual(run.solutionProfile.suggestedDossier.roles, []);
  assert.equal(run.solutionProfile.assessmentIntakeFacts.REGULATORY_ROLES.answerState, "UNKNOWN");
  const name = run.intakeCandidates.candidates.find((candidate) => candidate.fieldId === "name");
  assert.equal(name.sanitizedCandidate, "Orchid Governance Engine");
  assert.equal(name.confidence, "MEDIUM");
  assert.equal(name.sourceRefs[0].extractionMethod, "HTML_ARCHITECTURE_TITLE");
  assert.equal(run.intakeCandidates.candidates.find((candidate) => candidate.fieldId === "roles").sanitizedCandidate, null);
});
