import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { webcrypto } from "node:crypto";
import { DomUtils, parseDocument } from "htmlparser2";
import { embeddedDocumentationHandoff, fillEmptyHandoffControls, parseDocumentationHandoff } from "../public/documentation-handoff.js";
import { createPreflight, confirmPreflightDossier } from "../src/cognitive/preflight.js";
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

test("draft handoff suggestions reuse only exact mappings and never overwrite nonempty or conflicting fields", async () => {
  const handoff = await verify(updateFixture(({ release, record }) => {
    release.state = "DRAFT";
    Object.assign(record.answers, { users: "Operators", affectedParties: "Customers, Operators", exclusions: "No external access", outputRole: "DECISION" });
  }));
  assert.equal(handoff.documentationConfirmed, false);
  assert.deepEqual(handoff.suggestions.map(({ controlId }) => controlId), ["name", "purpose", "current-stage", "users", "excluded-uses"]);
  const controls = { name: { value: "Existing name" }, purpose: { value: "" }, "current-stage": { value: "UNKNOWN" }, users: { value: "" }, "excluded-uses": { value: "" } };
  const filled = [];
  assert.equal(fillEmptyHandoffControls(handoff.suggestions, (id) => controls[id], (id) => id === "purpose", (control) => filled.push(control.value)), 3);
  assert.equal(controls.name.value, "Existing name");
  assert.equal(controls.purpose.value, "");
  assert.deepEqual(filled, ["QUALIFICATION_AND_REGISTRATION", "Operators, Customers", "No external access"]);
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
  const fromHandoff = await verify(golden);
  const fields = Object.fromEntries(fromHandoff.suggestions.map(({ controlId, value }) => [controlId, value]));
  const dossier = validateDossier({ ...run.solutionProfile.suggestedDossier, name: fields.name, intendedPurpose: fields.purpose, currentStage: fields["current-stage"] });
  assert.equal(dossier.accountableOwner, "Review service lead");
  const resolutions = createIntakeResolutionDraft(dossier, run.solutionProfile);
  await assert.rejects(confirmPreflightDossier(run, { dossier, resolutions }), /approval/i);
  const confirmed = await confirmPreflightDossier(run, { dossier, resolutions, approval: { confirmed: true, actorRef: "TEST_USER" } });
  const purpose = confirmed.approvedIntake.fields.find(({ fieldId }) => fieldId === "intendedPurpose");
  assert.equal(purpose.origin, "USER_DECLARATION");
  assert.deepEqual(purpose.evidenceRefs, []);
});

test("an invalid or ambiguous handoff produces an explicit error before discovery", async () => {
  const tampered = golden.replace("Incorrect records shown", "Changed records");
  await assert.rejects(createPreflight({ sources: [evidence], documentationHandoff: tampered }), { statusCode: 422, message: /digest does not match/ });
  await assert.rejects(createPreflight({ sources: [{ ...uploadedHandoffs[1], content: script(golden) + script(golden) }, evidence] }), { statusCode: 422, message: /Expected one inert/ });
  const other = updateFixture(({ record }) => { record.answers.solutionName = "Separate solution"; });
  await assert.rejects(createPreflight({ sources: [{ ...uploadedHandoffs[0], content: other }, evidence], documentationHandoff: golden }), { statusCode: 422, message: /Multiple different/ });
});
