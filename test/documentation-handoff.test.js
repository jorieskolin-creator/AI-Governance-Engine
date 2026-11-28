import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { webcrypto } from "node:crypto";
import { DomUtils, parseDocument } from "htmlparser2";
import {
  embeddedDocumentationHandoff,
  handoffControlDrafts,
  NON_OVERLAPPING_TOPIC_GROUPS,
  normalizedHandoffAnswer,
  parseDocumentationHandoff,
  preferredDocumentationDraft,
  PROMOTED_DOCUMENTATION_TOPICS
} from "../public/documentation-handoff.js";
import { createPreflight, confirmPreflightDossier, publicPreflightView } from "../src/cognitive/preflight.js";
import { validateDossier } from "../src/contracts.js";
import { sha256 } from "../src/core/hash.js";
import { createIntakeResolutionDraft } from "../src/intake/contracts.js";

// Unmodified golden fixture exported by Documentation Support.
const golden = await readFile(new URL("./fixtures/doc-support-handoff.golden.json", import.meta.url), "utf8");
const verify = (json) => parseDocumentationHandoff(json, webcrypto.subtle);
const script = (json, type = "application/json") => `<script id="doc-support-handoff" type="${type}">${json}</script>`;
const handoffHtml = `<!doctype html><title>Documentation Support summary</title>${script(golden)}`;
const evidence = { path: "Documentation/validation-notes.md", mimeType: "text/markdown", content: "Accountable owner: Review service lead\n\nIndependent synthetic validation notes." };
const uploadedHandoffs = [
  { path: "handoff.json", mimeType: "application/json", content: golden },
  { path: "handoff.html", mimeType: "text/html", content: handoffHtml }
];

// The browser uses an inert template; the test adapter supplies the same selector API with htmlparser2.
function extract(html) {
  return embeddedDocumentationHandoff(html, {
    set innerHTML(value) { this.document = parseDocument(value); },
    get content() {
      return { querySelectorAll: () => DomUtils.findAll((tag) => tag.name === "script" && tag.attribs.id === "doc-support-handoff", this.document.children)
        .map((tag) => ({ getAttribute: (name) => tag.attribs[name], hasAttribute: (name) => Object.hasOwn(tag.attribs, name), textContent: DomUtils.textContent(tag) })) };
    }
  });
}

function updateFixture(update) {
  const { integrity, ...payload } = JSON.parse(golden);
  update(payload);
  return JSON.stringify({ ...payload, integrity: { ...integrity, payload_sha256: sha256(payload) } });
}

test("Documentation Support HTML and JSON produce the same declaration-only review", async () => {
  const fromJson = await verify(golden);
  assert.deepEqual(await verify(extract(handoffHtml)), fromJson);
  const styledHtml = `<!doctype html><html><head><style>:root{--ink:#0e1b2c}</style></head><body>${script(golden)}</body></html>`;
  const previousDomParser = globalThis.DOMParser;
  let parsedWithDomParser = false;
  globalThis.DOMParser = class {
    parseFromString(value, mimeType) {
      assert.equal(mimeType, "text/html");
      parsedWithDomParser = true;
      const doc = parseDocument(value);
      return {
        querySelectorAll: () => DomUtils.findAll((tag) => tag.attribs?.id === "doc-support-handoff", doc.children)
          .map((tag) => ({ tagName: tag.name, getAttribute: (name) => tag.attribs[name], hasAttribute: (name) => Object.hasOwn(tag.attribs, name), textContent: DomUtils.textContent(tag) }))
      };
    }
  };
  try {
    assert.deepEqual(await verify(embeddedDocumentationHandoff(styledHtml)), fromJson);
    assert.equal(parsedWithDomParser, true);
  } finally {
    globalThis.DOMParser = previousDomParser;
  }
  assert.equal(fromJson.documentationConfirmed, true);
  assert.deepEqual(fromJson.suggestions.map(({ controlId, value }) => [controlId, value]), [
    ["name", "Record review assistant"], ["purpose", "Help the review team find the right records."], ["current-stage", "QUALIFICATION_AND_REGISTRATION"]
  ]);
  assert.match(fromJson.context[0][0], /not necessarily the accountable solution owner/);
  assert.equal(fromJson.context[0][1], "Service team");
  assert.deepEqual(fromJson.entries.map(({ id }) => id), ["FM-03", "FM-06", "FM-07", "FM-CUSTOM-01"]);
  assert.equal(fromJson.entries[0].claimed_mitigations[0].evidence_status_observed, "NOT_RUN");
  assert.equal(fromJson.evidence[0].verification, "UNVERIFIED");
  assert.ok(fromJson.work.some(({ code }) => code === "FM_UNEXECUTED_EVIDENCE_REF"));
});

test("tampered, unsupported and ambiguous handoffs cannot populate the review", async () => {
  await assert.rejects(verify(golden.replace("Incorrect records shown", "Changed records")), /digest does not match/);
  await assert.rejects(verify(golden.replace("doc-support-handoff/1.0.0", "doc-support-handoff/2.0.0")), /Only doc-support-handoff\/1.0.0/);
  await assert.rejects(verify(updateFixture((payload) => { payload.failure_mode_register.entries[0].claimed_mitigations[0].evidence_status_observed = "PASS"; })), /invalid or duplicate failure mode/);
  assert.throws(() => extract(script(golden) + script(golden)), /Expected one inert/);
  assert.throws(() => extract(script(golden, "text/javascript")), /Expected one inert/);
  assert.throws(() => extract("<p>Printable draft without machine data</p>"), /Expected one inert/);
});

test("handoff declarations take priority in the draft without replacing the independent source profile", async () => {
  const handoff = await verify(updateFixture(({ release, record }) => {
    release.state = "DRAFT";
    Object.assign(record.answers, { users: "Operators", affectedParties: "Customers, Operators", exclusions: "No external access", outputRole: "DECISION" });
  }));
  assert.equal(handoff.documentationConfirmed, false);
  assert.deepEqual(handoff.suggestions.map(({ controlId }) => controlId), ["name", "purpose", "current-stage", "users", "excluded-uses"]);
  const sourceDossier = validateDossier({ name: "Existing name", accountableOwner: "Evidence owner", intendedPurpose: "Independent purpose" });
  const draft = preferredDocumentationDraft(sourceDossier, handoff);
  assert.equal(draft.name, "Record review assistant");
  assert.equal(draft.intendedPurpose, "Help the review team find the right records.");
  assert.equal(draft.accountableOwner, "Evidence owner");
  assert.deepEqual(draft.users, ["Operators"]);
  assert.equal(handoff.answers.affectedParties, "Customers, Operators");
  assert.deepEqual(draft.operatingBoundary.excludedUses, ["No external access"]);
  assert.equal(sourceDossier.intendedPurpose, "Independent purpose");
  assert.equal(preferredDocumentationDraft(sourceDossier, null), sourceDossier);
});

test("preflight validates both handoff input routes without admitting the handoff as independent evidence", async () => {
  for (const handoff of uploadedHandoffs) {
    const draft = await createPreflight({ sources: [handoff] });
    assert.equal(draft.documentationHandoff.documentationConfirmed, true);
    assert.equal(draft.sourceIngestion.parsedCount, 0);
    assert.deepEqual(draft.packets, []);
    await assert.rejects(confirmPreflightDossier(draft, {}), /At least one parsed evidence source/);
  }
  const run = await createPreflight({ sources: [...uploadedHandoffs, evidence], documentationHandoff: golden });
  assert.equal(run.sourceIngestion.parsedCount, 1);
  assert.deepEqual(run.sourceIngestion.items.map(({ path }) => path), [evidence.path]);
  const evidenceOnly = await createPreflight({ sources: [evidence] });
  assert.deepEqual(run.localSourceUnits, evidenceOnly.localSourceUnits);
  assert.deepEqual(run.packets, evidenceOnly.packets);
  assert.equal(publicPreflightView(run).intakeDraft.name, "Record review assistant");
  assert.notEqual(run.solutionProfile.suggestedDossier.name, "Record review assistant");
  const fromHandoff = await verify(golden);
  const fields = Object.fromEntries(fromHandoff.suggestions.map(({ controlId, value }) => [controlId, value]));
  const dossier = validateDossier({ ...run.solutionProfile.suggestedDossier, name: fields.name, intendedPurpose: fields.purpose, currentStage: fields["current-stage"] });
  assert.equal(dossier.accountableOwner, "Review service lead");
  const resolutions = createIntakeResolutionDraft(dossier, run.solutionProfile);
  await assert.rejects(confirmPreflightDossier(run, { dossier, resolutions }), /approval/i);
  const confirmed = await confirmPreflightDossier(run, {
    dossier, resolutions, documentationEdits: { useContext: "A revised user declaration" },
    approval: { confirmed: true, actorRef: "TEST_USER" }
  });
  const purpose = confirmed.approvedIntake.fields.find(({ fieldId }) => fieldId === "intendedPurpose");
  assert.equal(purpose.origin, "USER_DECLARATION");
  assert.deepEqual(purpose.evidenceRefs, []);
  const documentation = confirmed.approvedIntake.declaredDocumentation;
  assert.equal(documentation.evidenceCeiling, "DECLARED");
  assert.equal(documentation.failureModes.length, 4);
  assert.equal(documentation.failureModes[0].claimed_mitigations[0].evidence_status_observed, "NOT_RUN");
  assert.equal(documentation.handoff.documentationConfirmed, true);
  assert.equal(documentation.topics.useContext.value, "A revised user declaration");
  assert.equal(documentation.topics.useContext.origin, "USER_DECLARATION");
  assert.equal(documentation.mapped.intendedPurpose.origin, "DOCUMENTATION_SUPPORT");
  assert.ok(Object.isFrozen(documentation.failureModes));
});

test("an invalid or ambiguous handoff produces an explicit error before discovery", async () => {
  const tampered = golden.replace("Incorrect records shown", "Changed records");
  await assert.rejects(createPreflight({ sources: [evidence], documentationHandoff: tampered }), { statusCode: 422, message: /digest does not match/ });
  await assert.rejects(createPreflight({ sources: [{ ...uploadedHandoffs[1], content: script(golden) + script(golden) }, evidence] }), { statusCode: 422, message: /Expected one inert/ });
  const other = updateFixture(({ record }) => { record.answers.solutionName = "Separate solution"; });
  await assert.rejects(createPreflight({ sources: [{ ...uploadedHandoffs[0], content: other }, evidence], documentationHandoff: golden }), { statusCode: 422, message: /Multiple different/ });
});

test("an Intake edit containing a restricted identifier cannot enter an approved snapshot", async () => {
  const run = await createPreflight({ sources: [evidence], documentationHandoff: golden });
  const dossier = validateDossier({ name: "Local case", accountableOwner: "Service lead", intendedPurpose: "Contact synthetic-review@example.invalid" });
  await assert.rejects(confirmPreflightDossier(run, {
    dossier, resolutions: createIntakeResolutionDraft(dossier, run.solutionProfile),
    approval: { confirmed: true, actorRef: "TEST_USER" }
  }), { statusCode: 422, message: /restricted identifier/ });
  assert.equal(run.approvedIntake, undefined);
  assert.doesNotMatch(JSON.stringify(run), /synthetic-review@example\.invalid/);
});

test("handoff mapping de-duplicates structured Intake fields, normalizes NOT_DETERMINED, and falls back to uploaded docs when absent", async () => {
  const renderedIds = new Set(NON_OVERLAPPING_TOPIC_GROUPS.flatMap(([, fields]) => fields.map(([id]) => id)));
  for (const promoted of PROMOTED_DOCUMENTATION_TOPICS) assert.equal(renderedIds.has(promoted), false, promoted);
  assert.equal(normalizedHandoffAnswer("severity", "NOT_DETERMINED"), "");
  assert.equal(normalizedHandoffAnswer("permissionStatus", "CONDITIONALLY_PERMITTED"), "Conditionally permitted");

  const richHandoff = await verify(updateFixture(({ record }) => {
    Object.assign(record.answers, {
      users: "Case analysts",
      affectedParties: "Applicants",
      useContext: "Support bounded case review",
      outputRole: "DECISION",
      outputConsumers: "Internal case portal",
      humanAcceptance: "Case lead reviews and signs off before action",
      reversibility: "REVERSIBLE",
      privacyConfidentiality: "Pseudonymised case metadata only",
      permissionBasis: "Internal governance charter",
      usageRights: "Approved internal licence",
      severity: "NOT_DETERMINED",
      permissionStatus: "NOT_DETERMINED"
    });
  }));
  const controls = handoffControlDrafts(richHandoff);
  assert.equal(controls.get("allowed-uses"), "Support bounded case review");
  assert.equal(controls.get("boundary-users"), "Users: Case analysts · Affected parties: Applicants");
  assert.equal(controls.get("boundary-data"), "Pseudonymised case metadata only");
  assert.equal(controls.get("boundary-integrations"), "Internal case portal");
  assert.equal(controls.get("boundary-permissions"), "Internal governance charter · Approved internal licence");
  assert.match(controls.get("boundary-autonomy"), /Decision — determines an outcome/);
  assert.equal(controls.get("consequential"), "YES");
  assert.equal(controls.get("takes-actions"), undefined);
  assert.equal(controls.get("irreversible"), "NO");
  assert.equal(controls.get("human-override"), "YES");
  assert.equal(handoffControlDrafts({ answers: { outputRole: "ACTION" } }).get("takes-actions"), "YES");
  assert.equal(handoffControlDrafts({ answers: { outputRole: "RECOMMENDATION" } }).get("takes-actions"), "NO");

  const draft = preferredDocumentationDraft(validateDossier({ name: "Fallback name", accountableOwner: "Doc owner" }), richHandoff);
  assert.deepEqual(draft.operatingBoundary.allowedUses, ["Support bounded case review"]);
  assert.equal(draft.operatingBoundary.userScope, "Users: Case analysts · Affected parties: Applicants");
  assert.equal(draft.exposure.consequentialDecisions, true);
  assert.equal(draft.agent.irreversibleActions, false);
  assert.equal(draft.agent.humanOverride, true);

  const runWithHandoff = await createPreflight({ sources: [evidence], documentationHandoff: JSON.stringify({ ...JSON.parse(updateFixture(({ record }) => {
    record.answers.severity = "NOT_DETERMINED";
    record.answers.permissionStatus = "CONDITIONALLY_PERMITTED";
  })) }) });
  const approvedDossier = validateDossier({ ...publicPreflightView(runWithHandoff).intakeDraft, accountableOwner: "Review service lead" });
  const confirmed = await confirmPreflightDossier(runWithHandoff, {
    dossier: approvedDossier,
    resolutions: createIntakeResolutionDraft(approvedDossier, runWithHandoff.solutionProfile),
    documentationEdits: { openConstraints: "No information offered" },
    approval: { confirmed: true, actorRef: "TEST_USER" }
  });
  assert.equal(confirmed.approvedIntake.declaredDocumentation.topics.severity.value, null);
  assert.equal(confirmed.approvedIntake.declaredDocumentation.topics.severity.origin, "UNKNOWN");
  assert.equal(confirmed.approvedIntake.declaredDocumentation.topics.permissionStatus.value, "Conditionally permitted");
  assert.equal(confirmed.approvedIntake.declaredDocumentation.topics.permissionStatus.origin, "DOCUMENTATION_SUPPORT");
  assert.equal(confirmed.approvedIntake.declaredDocumentation.topics.openConstraints.value, null);
  assert.equal(confirmed.approvedIntake.declaredDocumentation.topics.openConstraints.noInformationOffered, true);

  const fallbackRun = await createPreflight({
    sources: [{
      path: "docs/governance-record.md",
      mimeType: "text/markdown",
      content: [
        "# Case Triage Workspace",
        "Solution name: Case Triage Workspace",
        "Accountable owner: Triage Lead",
        "Record owner: Documentation Steward",
        "Plausible adverse consequences: Delayed triage queue routing",
        "Minimisation and retention: Purge transient case uploads after 60 minutes"
      ].join("\n")
    }]
  });
  const view = publicPreflightView(fallbackRun);
  assert.equal(view.declaredTopicDraft.recordOwner.value, "Documentation Steward");
  assert.equal(view.declaredTopicDraft.consequences.value, "Delayed triage queue routing");
  assert.equal(view.declaredTopicDraft.minimization.value, "Purge transient case uploads after 60 minutes");
  const fallbackDossier = validateDossier(fallbackRun.solutionProfile.suggestedDossier);
  const fallbackConfirmed = await confirmPreflightDossier(fallbackRun, {
    dossier: fallbackDossier,
    resolutions: createIntakeResolutionDraft(fallbackDossier, fallbackRun.solutionProfile),
    approval: { confirmed: true, actorRef: "TEST_USER" }
  });
  assert.equal(fallbackConfirmed.approvedIntake.declaredDocumentation.topics.minimization.origin, "DETERMINISTIC_DOCUMENTATION");
});
