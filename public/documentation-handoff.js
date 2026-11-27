export const HANDOFF_SCRIPT_ID = "doc-support-handoff";
export const HANDOFF_REVIEW_ONLY = "DOCUMENTATION_HANDOFF_REVIEW_ONLY";
export const HANDOFF_REVIEW_INSTRUCTION = "Open Documentation Support exports in the handoff review and upload independent source material separately.";
export const HANDOFF_MAX_BYTES = 15 * 1024 * 1024;
export const HANDOFF_VERSION = "doc-support-handoff/1.0.0";
const REGISTER_VERSION = "failure-mode-register/1.0.0";
const levels = ["LOW", "MEDIUM", "HIGH", "UNKNOWN"];
const referenceStatuses = ["DECLARED_IN_DOC", "OBSERVED_IN_CONFIG", "TEST_EVIDENCE_LINKED", "NOT_RUN", "MISSING_UNKNOWN"];
const stages = new Map([
  ["QUALIFICATION_REGISTRATION", "QUALIFICATION_AND_REGISTRATION"],
  ["DESIGN_DEVELOPMENT", "DESIGN_AND_DEVELOPMENT"],
  ["VERIFICATION_VALIDATION", "VERIFICATION_AND_VALIDATION"],
  ["DEPLOYMENT", "DEPLOYMENT"],
  ["OPERATION_MONITORING", "OPERATION_AND_MONITORING"],
  ["REVIEW_REEVALUATION", "REVIEW_AND_EVALUATION"],
  ["RETIREMENT", "RETIREMENT"]
]);
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value) => typeof value === "string";
const listOf = (value, test) => Array.isArray(value) && value.every(test);
const textOrNull = (value) => value === null || value === undefined || text(value);
const display = (value) => text(value) ? value.trim() : "";

export function isDocumentationHandoff(value) {
  return object(value) && text(value.schema_version) && value.schema_version.startsWith(`${HANDOFF_SCRIPT_ID}/`);
}

export function isDocumentationHandoffJson(source) {
  try { return isDocumentationHandoff(JSON.parse(source)); }
  catch { return false; }
}

function quote(value) {
  if (/[\uD800-\uDFFF]/u.test(value)) throw new Error("The handoff contains invalid Unicode.");
  return JSON.stringify(value);
}

// RFC 8785 serialization with limits for untrusted files. The digest is not a signature.
function canonicalize(value, depth = 0, budget = { remaining: 100_000 }) {
  if (depth > 32 || --budget.remaining < 0) throw new Error("The handoff exceeds the JSON structure limit.");
  if (value === null || typeof value === "boolean" || Number.isFinite(value)) return JSON.stringify(value);
  if (text(value)) return quote(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalize(item, depth + 1, budget)).join(",")}]`;
  if (object(value)) return `{${Object.keys(value).sort().map((key) => `${quote(key)}:${canonicalize(value[key], depth + 1, budget)}`).join(",")}}`;
  throw new Error("The handoff contains an invalid JSON value.");
}

/** Reads only the exported script text; the template and all of its contents stay detached. */
export function embeddedDocumentationHandoff(html, template) {
  template.innerHTML = html;
  const scripts = template.content.querySelectorAll(`[id="${HANDOFF_SCRIPT_ID}"]`);
  return readHandoffScript(scripts);
}

export function readHandoffScript(scripts) {
  if (scripts.length !== 1 || (scripts[0].tagName && scripts[0].tagName.toLowerCase() !== "script") || scripts[0].getAttribute("type") !== "application/json" || scripts[0].hasAttribute("src")) {
    throw new Error("Expected one inert Documentation Support handoff in the HTML. Try the standalone JSON export if it is missing.");
  }
  return scripts[0].textContent;
}

function validateRegister(register) {
  if (!object(register) || register.schema_version !== REGISTER_VERSION || !Array.isArray(register.entries)) {
    throw new Error("The Failure Mode Register version or structure is not supported.");
  }
  const ids = new Set();
  for (const row of register.entries) {
    if (!object(row) || !text(row.id) || !/^FM-(0[1-9]|1[0-5]|CUSTOM-\d{2,3})$/.test(row.id) || ids.has(row.id) ||
        !["USER_DECLARED", "DOCUMENT_EXTRACTED"].includes(row.source) || ![row.title, row.trigger_or_cause, row.effect_summary].every(text) ||
        ![...levels, "CRITICAL"].includes(row.severity_user) || !levels.includes(row.occurrence_inherent) || !levels.includes(row.detectability_inherent) ||
        !listOf(row.mapped_objects, (value) => text(value) && /^(AP-)?[A-F][1-5]$/.test(value)) ||
        !object(row.provenance) || !listOf(row.provenance.source_unit_ids, text) || !listOf(row.provenance.limitations, text) || !textOrNull(row.provenance.file_path) ||
        !listOf(row.claimed_mitigations, (mitigation) => object(mitigation) && text(mitigation.control) &&
          ["PREVENTIVE", "DETECTIVE", "PROCEDURAL_OR_PROMPT_ONLY", "UNKNOWN"].includes(mitigation.type) &&
          referenceStatuses.includes(mitigation.evidence_status_observed) && textOrNull(mitigation.code_ref) && textOrNull(mitigation.evidence_ref))) {
      throw new Error("The handoff contains an invalid or duplicate failure mode.");
    }
    ids.add(row.id);
  }
}

export async function parseDocumentationHandoff(source, subtle = globalThis.crypto?.subtle) {
  if (source.length > HANDOFF_MAX_BYTES) throw new Error("The handoff exceeds the 15 MB review limit.");
  let handoff;
  try { handoff = JSON.parse(source); }
  catch { throw new Error("The selected file does not contain valid handoff JSON."); }
  if (handoff?.schema_version !== HANDOFF_VERSION || handoff.purpose !== "ASSESSMENT_HANDOFF") {
    throw new Error("Only doc-support-handoff/1.0.0 assessment handoffs are supported.");
  }
  const { integrity, ...payload } = handoff;
  if (integrity?.canonicalization !== "RFC8785" || integrity.algorithm !== "SHA-256" || !text(integrity.payload_sha256) || !/^[a-f0-9]{64}$/.test(integrity.payload_sha256)) {
    throw new Error("The handoff has no supported integrity digest.");
  }
  if (!subtle) throw new Error("Use HTTPS or localhost to verify the handoff digest.");
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(canonicalize(payload)));
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  if (hex !== integrity.payload_sha256) throw new Error("The handoff digest does not match. Export the file again from Documentation Support.");

  const { record, release, failure_mode_register: register, outstanding_work: work } = payload;
  if (!object(record?.answers) || !Object.values(record.answers).every(text) ||
      !listOf(record.evidence, (entry) => object(entry) && [entry.id, entry.title, entry.reference, entry.verification].every(text)) ||
      !listOf(record.dataSources, (entry) => object(entry) && ["id", "name", "owner", "categories", "usageRights", "quality", "restrictions"].every((key) => text(entry[key]))) ||
      !object(record.evidenceRefs) || !Object.values(record.evidenceRefs).every(text) ||
      !object(record.notApplicable) || !Object.values(record.notApplicable).every((entry) => object(entry) && text(entry.rationale) && text(entry.owner)) ||
      !["DRAFT", "DOCUMENTATION_CONFIRMED"].includes(release?.state) ||
      !listOf(work, (item) => object(item) && [item.code, item.title, item.permittedNextAction].every(text))) {
    throw new Error("The handoff record structure is not supported.");
  }
  validateRegister(register);
  const answers = record.answers;
  const suggestions = [
    ["name", "Solution name", display(answers.solutionName)],
    ["purpose", "Intended purpose", display(answers.intendedPurpose)],
    ["current-stage", "Current lifecycle stage", stages.get(answers.lifecycleStage)],
    ["users", "Users and affected groups", [...new Set([answers.users, answers.affectedParties].flatMap((value) => display(value).split(/[,\r\n]+/).map(display)).filter(Boolean))].join(", ")],
    ["excluded-uses", "Excluded uses", display(answers.exclusions)]
  ].filter(([, , value]) => value).map(([controlId, label, value]) => ({ controlId, label, value }));
  const context = [
    ["Documentation record owner (not necessarily the accountable solution owner)", answers.recordOwner],
    ["Process and use context", answers.useContext], ["Output role", answers.outputRole],
    ["Output and downstream use", answers.outputConsumers], ["Human review and acceptance", answers.humanAcceptance],
    ["Plausible adverse consequences", answers.consequences], ["Existing risk or classification", answers.existingRisk],
    ["Classification basis and date", answers.classificationBasis], ["Permission basis and authority", answers.permissionBasis],
    ["Privacy and confidentiality rules", answers.privacyConfidentiality], ["Unresolved permission questions", answers.openConstraints]
  ].filter(([, value]) => display(value));
  return {
    schemaVersion: HANDOFF_VERSION, payloadHash: integrity.payload_sha256,
    documentationConfirmed: release.state === "DOCUMENTATION_CONFIRMED", suggestions, context,
    answers, evidenceRefs: record.evidenceRefs, notApplicable: record.notApplicable,
    entries: register.entries, evidence: record.evidence, dataSources: record.dataSources, work
  };
}

export function fillEmptyHandoffControls(suggestions, getControl, isConflicting, onFill) {
  let filled = 0;
  for (const { controlId, value } of suggestions) {
    const control = getControl(controlId);
    if (!control || isConflicting(controlId)) continue;
    const current = control.value.trim();
    if (current && (controlId !== "current-stage" || current !== "UNKNOWN")) continue;
    control.value = value;
    onFill(control);
    filled++;
  }
  return filled;
}
