import { createHash } from "node:crypto";
import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export const AUTHORING_SCHEMA_VERSION = "1.0.0";
export const CANONICAL_LIFECYCLE_STAGES = Object.freeze([
  "QUALIFICATION_AND_REGISTRATION", "DESIGN_AND_DEVELOPMENT", "VERIFICATION_AND_VALIDATION",
  "DEPLOYMENT", "OPERATION_AND_MONITORING", "REVIEW_AND_EVALUATION", "RETIREMENT"
]);
export const RUNTIME_APPLICABILITY = Object.freeze([
  "ALWAYS", "EU", "USES_DATA", "PERSONAL_DATA", "THIRD_PARTY_COMPONENTS", "USES_AGENTS",
  "PRODUCTION_OR_EXTERNAL", "AFFECTS_PEOPLE", "INTERACTS_WITH_PEOPLE"
]);
const LEGACY_STAGES = Object.freeze({
  QUALIFICATION: "QUALIFICATION_AND_REGISTRATION", CONTROLLED_PILOT: "DEPLOYMENT",
  OPERATION: "OPERATION_AND_MONITORING", MATERIAL_CHANGE: "REVIEW_AND_EVALUATION"
});
const SEVERITIES = new Set(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
const SOURCE_AUTHORITIES = new Set([
  "BINDING_LAW", "REGULATORY_GUIDANCE", "GOVERNMENT_GUIDANCE", "INTERNAL_PROCESS", "STANDARD",
  "VOLUNTARY_FRAMEWORK", "COMMUNITY_PRACTICE", "INDUSTRY_GUIDANCE", "CONTRACTUAL_REQUIREMENT"
]);
const APPROVED_STATUSES = new Set(["APPROVED", "RELEASED"]);
const RELEASE_STATUSES = new Set(["DRAFT", "CALIBRATION_CANDIDATE", "CALIBRATION_TEST_ONLY", "PILOT", "APPROVED", "RELEASED"]);

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const array = (value) => Array.isArray(value) ? value : [];
const unique = (values) => [...new Set(values)];
const plain = (value) => value && typeof value === "object" && !Array.isArray(value);
const normalize = (value) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

async function walk(dir) {
  const result = [];
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name);
    if (item.isDirectory() && !new Set(["generated", "runtime", "node_modules", ".git"]).has(item.name)) result.push(...await walk(full));
    else if (item.isFile() && item.name.toLowerCase().endsWith(".json") && item.name !== "runtime-manifest.json") result.push(full);
  }
  return result;
}

function classify(document) {
  if (document?.object_type === "CAPABILITY") return "capability";
  if (document?.object_type === "ANTIPATTERN") return "antipattern";
  if (Array.isArray(document?.tactics)) return "tacticCatalog";
  if (Array.isArray(document?.sources) || document?.register_type === "NORMATIVE_SOURCE_REGISTER") return "sourceRegister";
  return null;
}

export async function loadAuthoringWorkspace(directory) {
  const workspace = { directory, capabilities: [], antipatterns: [], tacticCatalogs: [], sourceRegisters: [], ignored: [] };
  for (const file of await walk(directory)) {
    let document;
    try { document = JSON.parse(await readFile(file, "utf8")); }
    catch (error) { workspace.ignored.push({ file, reason: `INVALID_JSON: ${error.message}` }); continue; }
    const type = classify(document);
    if (!type) { workspace.ignored.push({ file, reason: "UNRECOGNIZED_AUTHORING_DOCUMENT" }); continue; }
    const wrapped = { file, document };
    if (type === "capability") workspace.capabilities.push(wrapped);
    if (type === "antipattern") workspace.antipatterns.push(wrapped);
    if (type === "tacticCatalog") workspace.tacticCatalogs.push(wrapped);
    if (type === "sourceRegister") workspace.sourceRegisters.push(wrapped);
  }
  return workspace;
}

function issue(collection, severity, code, message, refs = {}) { collection.push({ severity, code, message, ...refs }); }

function canonicalStages(stages, compat, issues, objectId) {
  return unique(array(stages).map((stage) => {
    if (CANONICAL_LIFECYCLE_STAGES.includes(stage)) return stage;
    if (compat && LEGACY_STAGES[stage]) {
      issue(issues, "WARNING", "LEGACY_LIFECYCLE_MAPPED", `${objectId}: ${stage} maps to ${LEGACY_STAGES[stage]}; migrate the authoring JSON.`, { objectId });
      return LEGACY_STAGES[stage];
    }
    issue(issues, "ERROR", "INVALID_LIFECYCLE_STAGE", `${objectId}: unsupported lifecycle stage ${stage}.`, { objectId });
    return null;
  }).filter(Boolean));
}

function sourceRecordsFor(object, compat, issues) {
  return array(object.normative_source_mappings).map((mapping) => {
    if (plain(mapping)) return mapping;
    if (typeof mapping === "string" && compat) {
      issue(issues, "WARNING", "SOURCE_ID_ONLY_COMPATIBILITY", `${object.id}: ${mapping} has no inline provenance metadata.`, { objectId: object.id, sourceId: mapping });
      return { source_id: mapping };
    }
    issue(issues, "ERROR", "STRUCTURED_SOURCE_MAPPING_REQUIRED", `${object.id}: normative mappings must be structured records.`, { objectId: object.id });
    return null;
  }).filter(Boolean);
}

function validateSourceRecord(record, objectId, issues, compat) {
  if (!record.source_id) issue(issues, "ERROR", "SOURCE_ID_REQUIRED", `${objectId}: source mapping is missing source_id.`, { objectId });
  const complete = record.title && record.official_url && record.authority_type && record.relevant_locator && record.mapping_rationale && array(record.jurisdiction).length && record.effective_status && record.last_verified_on;
  if (!complete && !compat) issue(issues, "ERROR", "SOURCE_MAPPING_INCOMPLETE", `${objectId}: ${record.source_id ?? "unknown source"} is missing required provenance fields.`, { objectId, sourceId: record.source_id });
  if (record.official_url && !/^https:\/\//i.test(record.official_url) && !/^internal:\/\//i.test(record.official_url)) issue(issues, "ERROR", "SOURCE_URL_NOT_OFFICIAL_HTTPS", `${objectId}: ${record.source_id} must use an official HTTPS or internal URL.`, { objectId, sourceId: record.source_id });
  if (record.authority_type && !SOURCE_AUTHORITIES.has(record.authority_type)) issue(issues, "ERROR", "INVALID_SOURCE_AUTHORITY", `${objectId}: unsupported authority ${record.authority_type}.`, { objectId, sourceId: record.source_id });
  if (record.last_verified_on && !/^\d{4}-\d{2}-\d{2}$/.test(record.last_verified_on)) issue(issues, "ERROR", "INVALID_SOURCE_VERIFICATION_DATE", `${objectId}: last_verified_on must be YYYY-MM-DD.`, { objectId, sourceId: record.source_id });
}

function collectIds(objects, field, issues, seen = new Map()) {
  for (const object of objects) for (const item of array(object[field])) {
    if (!item?.id) { issue(issues, "ERROR", "NESTED_ID_REQUIRED", `${object.id}: ${field} contains an item without id.`, { objectId: object.id }); continue; }
    if (seen.has(item.id)) issue(issues, "ERROR", "DUPLICATE_ID", `${item.id} occurs in ${seen.get(item.id)} and ${object.id}.`, { objectId: object.id });
    else seen.set(item.id, object.id);
  }
  return seen;
}

function runtimeSeverity(object, compat, issues) {
  if (SEVERITIES.has(object.runtime_severity)) return object.runtime_severity;
  if (!compat) { issue(issues, "ERROR", "RUNTIME_SEVERITY_REQUIRED", `${object.id}: add runtime_severity (LOW, MEDIUM, HIGH or CRITICAL).`, { objectId: object.id }); return "HIGH"; }
  const text = String(object.severity ?? "").toUpperCase();
  const inferred = text.includes("CRITICAL") ? "CRITICAL" : text.includes("MEDIUM") ? "MEDIUM" : "HIGH";
  issue(issues, "WARNING", "RUNTIME_SEVERITY_INFERRED", `${object.id}: inferred ${inferred}; add runtime_severity.`, { objectId: object.id });
  return inferred;
}

function runtimeSignals(object, compat, issues) {
  if (array(object.runtime_signals).length) return unique(object.runtime_signals);
  const fallback = array(object.finding_definitions).map((item) => item.id);
  if (!compat) issue(issues, "ERROR", "RUNTIME_SIGNALS_REQUIRED", `${object.id}: add runtime_signals for deterministic evidence matching.`, { objectId: object.id });
  else issue(issues, "WARNING", "RUNTIME_SIGNALS_FROM_FINDINGS", `${object.id}: finding IDs are used as compatibility signals.`, { objectId: object.id });
  return fallback;
}

function validateObject(object, expectedType, compat, issues) {
  if (!object.id || !object.version || !object.title) issue(issues, "ERROR", "OBJECT_IDENTITY_INCOMPLETE", `${object.id ?? expectedType}: id, version and title are required.`, { objectId: object.id });
  if (!/^[A-F]$/.test(object.domain ?? "")) issue(issues, "ERROR", "DOMAIN_INVALID", `${object.id}: domain must be A-F.`, { objectId: object.id });
  if (object.object_type !== expectedType) issue(issues, "ERROR", "OBJECT_TYPE_MISMATCH", `${object.id}: expected ${expectedType}.`, { objectId: object.id });
  if (!RELEASE_STATUSES.has(object.release_status)) issue(issues, "ERROR", "RELEASE_STATUS_INVALID", `${object.id}: release_status must be explicit and supported.`, { objectId: object.id });
  object.__canonicalStages = canonicalStages(object.lifecycle_stages, compat, issues, object.id);
  object.__sourceRecords = sourceRecordsFor(object, compat, issues);
  object.__sourceRecords.forEach((record) => validateSourceRecord(record, object.id, issues, compat));
  object.__runtimeSeverity = runtimeSeverity(object, compat, issues);
  object.__runtimeSignals = runtimeSignals(object, compat, issues);
  if (!RUNTIME_APPLICABILITY.includes(object.runtime_applicability)) issue(issues, compat ? "WARNING" : "ERROR", "RUNTIME_APPLICABILITY_REQUIRED", `${object.id}: add a supported runtime_applicability; prose applicability cannot drive deterministic rules.`, { objectId: object.id });
  if (expectedType === "CAPABILITY" && !object.runtime_authority) issue(issues, compat ? "WARNING" : "ERROR", "RUNTIME_AUTHORITY_REQUIRED", `${object.id}: add runtime_authority for the compiled requirement.`, { objectId: object.id });
  if (!plain(object.hard_gate_effect)) issue(issues, compat ? "WARNING" : "ERROR", "HARD_GATE_EFFECT_REQUIRED", `${object.id}: hard_gate_effect must be explicit.`, { objectId: object.id });
  if (!object.human_decision_authority) issue(issues, compat ? "WARNING" : "ERROR", "HUMAN_AUTHORITY_REQUIRED", `${object.id}: human_decision_authority must be explicit.`, { objectId: object.id });
  if (!array(object.primary_questions).length) issue(issues, "ERROR", "PRIMARY_QUESTIONS_REQUIRED", `${object.id}: primary_questions must not be empty.`, { objectId: object.id });
  if (!array(object.required_evidence).length) issue(issues, compat && expectedType === "ANTIPATTERN" ? "WARNING" : "ERROR", "REQUIRED_EVIDENCE_REQUIRED", `${object.id}: required_evidence must not be empty.`, { objectId: object.id });
  if (!array(object.finding_definitions).length) issue(issues, "ERROR", "FINDINGS_REQUIRED", `${object.id}: finding_definitions must not be empty.`, { objectId: object.id });
  if (!array(object.false_positive_guards).length) issue(issues, "ERROR", "FALSE_POSITIVE_GUARDS_REQUIRED", `${object.id}: false_positive_guards must not be empty.`, { objectId: object.id });
  if (!array(object.prohibited_inferences).length) issue(issues, "ERROR", "PROHIBITED_INFERENCES_REQUIRED", `${object.id}: prohibited_inferences must not be empty.`, { objectId: object.id });
  if (expectedType === "CAPABILITY" && !plain(object.target_assurance_by_lifecycle_stage)) issue(issues, "ERROR", "LIFECYCLE_ASSURANCE_TARGETS_REQUIRED", `${object.id}: target_assurance_by_lifecycle_stage must be explicit.`, { objectId: object.id });
  if (expectedType === "ANTIPATTERN" && !array(object.absence_test_requirements).length) issue(issues, "ERROR", "ABSENCE_TEST_REQUIREMENTS_REQUIRED", `${object.id}: absence_test_requirements must not be empty.`, { objectId: object.id });
  for (const finding of array(object.finding_definitions)) {
    if (finding.assessment_object_id !== object.id) issue(issues, "ERROR", "FINDING_OWNER_MISMATCH", `${finding.id}: assessment_object_id must be ${object.id}.`, { objectId: object.id, findingId: finding.id });
    if (!array(finding.eligible_states).length) issue(issues, "ERROR", "FINDING_STATES_REQUIRED", `${finding.id}: eligible_states must not be empty.`, { objectId: object.id, findingId: finding.id });
  }
  const questionIds = new Set(array(object.primary_questions).map((item) => item.id));
  for (const item of [...array(object.atomic_subcriteria), ...array(object.atomic_tests)]) if (item.question_ref && !questionIds.has(item.question_ref)) issue(issues, "ERROR", "QUESTION_REFERENCE_MISSING", `${item.id}: question_ref ${item.question_ref} does not resolve inside ${object.id}.`, { objectId: object.id });
}

function consolidatedSources(workspace, objects, issues) {
  const records = [];
  for (const register of workspace.sourceRegisters) records.push(...array(register.document.sources ?? register.document.entries));
  for (const object of objects) records.push(...object.__sourceRecords.filter((item) => item.title || item.official_url));
  const byId = new Map();
  for (const record of records) {
    const id = record.source_id ?? record.id;
    if (!id) continue;
    const normalized = { ...record, source_id: id };
    if (byId.has(id)) {
      const previous = byId.get(id);
      if (previous.official_url && normalized.official_url && previous.official_url !== normalized.official_url) issue(issues, "ERROR", "SOURCE_URL_CONFLICT", `${id} has conflicting official URLs.`, { sourceId: id });
      if (previous.title && normalized.title && previous.title !== normalized.title) issue(issues, "ERROR", "SOURCE_TITLE_CONFLICT", `${id} has conflicting titles.`, { sourceId: id });
      byId.set(id, { ...normalized, ...previous });
    } else byId.set(id, normalized);
  }
  return byId;
}

export function validateAuthoringWorkspace(workspace, options = {}) {
  const compat = options.compatibility === true;
  const issues = [...workspace.ignored.map((item) => ({ severity: "WARNING", code: "IGNORED_JSON", message: `${item.file}: ${item.reason}`, file: item.file }))];
  const capabilities = workspace.capabilities.map((item) => structuredClone(item.document));
  const antipatterns = workspace.antipatterns.map((item) => structuredClone(item.document));
  const sourceRegisters = workspace.sourceRegisters.map((item) => structuredClone(item.document));
  const tactics = workspace.tacticCatalogs.flatMap((item) => array(item.document.tactics).map((tactic) => ({ ...structuredClone(tactic), __catalog: item.document })));
  capabilities.forEach((object) => validateObject(object, "CAPABILITY", compat, issues));
  antipatterns.forEach((object) => validateObject(object, "ANTIPATTERN", compat, issues));
  const allObjects = [...capabilities, ...antipatterns];
  const objectIds = new Set();
  for (const object of allObjects) {
    if (objectIds.has(object.id)) issue(issues, "ERROR", "DUPLICATE_OBJECT_ID", `${object.id} is duplicated.`, { objectId: object.id });
    objectIds.add(object.id);
  }
  for (const capability of capabilities) {
    const paired = `AP-${capability.id}`;
    if (!objectIds.has(paired)) issue(issues, "ERROR", "PAIR_MISSING", `${capability.id} has no paired ${paired}.`, { objectId: capability.id });
    if (!array(capability.related_antipatterns).includes(paired)) issue(issues, "ERROR", "PAIR_REFERENCE_MISSING", `${capability.id} must reference ${paired}.`, { objectId: capability.id });
  }
  for (const antipattern of antipatterns) {
    const relatedCapability = antipattern.related_capability ?? array(antipattern.related_criteria).find((id) => objectIds.has(id));
    if (!relatedCapability || !objectIds.has(relatedCapability)) issue(issues, "ERROR", "CAPABILITY_REFERENCE_MISSING", `${antipattern.id} must reference its capability.`, { objectId: antipattern.id });
  }
  let nestedIds = new Map();
  for (const field of ["primary_questions", "atomic_subcriteria", "atomic_tests", "required_evidence", "finding_definitions"]) nestedIds = collectIds(allObjects, field, issues, nestedIds);
  const findingIds = new Set(allObjects.flatMap((object) => array(object.finding_definitions).map((item) => item.id)));
  const tacticIds = new Set();
  if (workspace.tacticCatalogs.length !== 1) issue(issues, "ERROR", "GLOBAL_TACTIC_CATALOG_REQUIRED", `Exactly one global Tactic Catalog is required; found ${workspace.tacticCatalogs.length}.`);
  for (const catalog of workspace.tacticCatalogs.map((item) => item.document)) if (!RELEASE_STATUSES.has(catalog.release_status)) issue(issues, "ERROR", "TACTIC_CATALOG_RELEASE_STATUS_INVALID", `${catalog.catalog_id ?? "Tactic Catalog"}: release_status must be explicit and supported.`);
  for (const register of sourceRegisters) if (!RELEASE_STATUSES.has(register.release_status)) issue(issues, "ERROR", "SOURCE_REGISTER_RELEASE_STATUS_INVALID", `Normative Source Register: release_status must be explicit and supported.`);
  for (const tactic of tactics) {
    if (!tactic.id || tacticIds.has(tactic.id)) issue(issues, "ERROR", "TACTIC_ID_INVALID", `${tactic.id ?? "Unknown tactic"} is missing or duplicated.`, { tacticId: tactic.id });
    tacticIds.add(tactic.id);
    for (const id of [...array(tactic.assessment_mappings?.capabilities), ...array(tactic.assessment_mappings?.antipatterns), ...array(tactic.reassessment_targets)]) if (!objectIds.has(id)) issue(issues, compat ? "WARNING" : "ERROR", "TACTIC_OBJECT_REFERENCE_MISSING", `${tactic.id} references missing assessment object ${id}.`, { tacticId: tactic.id, objectId: id });
    for (const id of array(tactic.eligible_finding_ids)) if (!findingIds.has(id)) issue(issues, "ERROR", "TACTIC_FINDING_REFERENCE_MISSING", `${tactic.id} references missing finding ${id}.`, { tacticId: tactic.id, findingId: id });
    for (const field of ["owners", "activities", "artifacts", "acceptance_criteria", "verification", "do_not_use_when"]) if (!array(tactic[field]).length) issue(issues, "ERROR", "TACTIC_FIELD_EMPTY", `${tactic.id}: ${field} must not be empty.`, { tacticId: tactic.id });
    if (!tactic.use_when) issue(issues, compat ? "WARNING" : "ERROR", "TACTIC_USE_WHEN_REQUIRED", `${tactic.id}: use_when must define the activation boundary.`, { tacticId: tactic.id });
    if (!tactic.blocks_transition) issue(issues, compat ? "WARNING" : "ERROR", "TACTIC_BLOCKED_TRANSITION_REQUIRED", `${tactic.id}: blocks_transition must identify what remains blocked.`, { tacticId: tactic.id });
  }
  for (const object of allObjects) {
    const forward = new Set(array(object.candidate_tactic_refs).map((item) => item.tactic_id));
    const reverse = new Set(tactics.filter((tactic) => [...array(tactic.assessment_mappings?.capabilities), ...array(tactic.assessment_mappings?.antipatterns)].includes(object.id)).map((item) => item.id));
    for (const id of forward) if (!tacticIds.has(id)) issue(issues, "ERROR", "OBJECT_TACTIC_REFERENCE_MISSING", `${object.id} references missing tactic ${id}.`, { objectId: object.id, tacticId: id });
    for (const id of new Set([...forward, ...reverse])) if (!forward.has(id) || !reverse.has(id)) issue(issues, "ERROR", "TACTIC_MAPPING_NOT_RECIPROCAL", `${object.id} and ${id} are not mapped in both directions.`, { objectId: object.id, tacticId: id });
  }
  const mechanismKeys = new Map();
  for (const tactic of tactics) {
    const key = normalize(`${tactic.objective} ${array(tactic.artifacts).join(" ")} ${array(tactic.verification).join(" ")}`);
    if (mechanismKeys.has(key)) issue(issues, "WARNING", "POSSIBLE_DUPLICATE_TACTIC_MECHANISM", `${tactic.id} appears equivalent to ${mechanismKeys.get(key)}.`, { tacticId: tactic.id });
    else mechanismKeys.set(key, tactic.id);
  }
  const sources = consolidatedSources(workspace, allObjects, issues);
  for (const source of sources.values()) validateSourceRecord(source, "Normative Source Register", issues, compat);
  for (const object of allObjects) for (const record of object.__sourceRecords) if (!sources.has(record.source_id) && !record.title) issue(issues, compat ? "WARNING" : "ERROR", "SOURCE_REGISTER_ENTRY_MISSING", `${object.id}: ${record.source_id} does not resolve to the source register.`, { objectId: object.id, sourceId: record.source_id });
  const errorCount = issues.filter((item) => item.severity === "ERROR").length;
  return { schemaVersion: AUTHORING_SCHEMA_VERSION, status: errorCount ? "FAIL" : "PASS", errorCount, warningCount: issues.length - errorCount, compatibilityMode: compat, issues, counts: { capabilities: capabilities.length, antipatterns: antipatterns.length, pairs: capabilities.filter((c) => objectIds.has(`AP-${c.id}`)).length, tacticCatalogs: workspace.tacticCatalogs.length, tactics: tactics.length, sourceRegisters: sourceRegisters.length, normativeSources: sources.size }, model: { capabilities, antipatterns, tactics, sourceRegisters, sources: [...sources.values()] } };
}

function targetStates(object) {
  const output = {};
  for (const [rawStage, description] of Object.entries(plain(object.target_assurance_by_lifecycle_stage) ? object.target_assurance_by_lifecycle_stage : {})) {
    const stage = LEGACY_STAGES[rawStage] ?? rawStage;
    const text = String(description).toUpperCase();
    const state = text.includes("FORMALLY_APPROVED") || text.includes("INDEPENDENTLY_VALIDATED") || text.includes("HUMAN_VALIDATED") ? "HUMAN_VALIDATED" : text.includes("OPERATIONALLY_OBSERVED") ? "OPERATIONALLY_OBSERVED" : text.includes("TESTED") ? "TESTED" : text.includes("IMPLEMENTED") ? "IMPLEMENTED" : "DECLARED";
    if (CANONICAL_LIFECYCLE_STAGES.includes(stage)) output[stage] = state;
  }
  return output;
}

function runtimeSource(record) {
  return { id: record.source_id ?? record.id, title: record.title ?? record.source_id ?? record.id, authority: record.authority_type ?? record.authority ?? "UNSPECIFIED", jurisdiction: array(record.jurisdiction).join(", ") || record.jurisdiction || "UNSPECIFIED", officialUrl: record.official_url ?? record.officialUrl, relevantLocator: record.relevant_locator ?? null, mappingRationale: record.mapping_rationale ?? null, effectiveFrom: record.effective_from ?? null, effectiveUntil: record.effective_until ?? null, effectiveStatus: record.effective_status ?? "VERIFY_AT_ASSESSMENT", lastVerifiedOn: record.last_verified_on ?? null, approvalStatus: record.approval_status ?? "PILOT_REVIEW_REQUIRED", ownerAuthority: record.owner_authority ?? "GOVERNANCE", notes: record.notes ?? "Provenance metadata; applicability and interpretation require authorized review." };
}

export async function compileRuntimeCollections(validation, outputDirectory, options = {}) {
  if (validation.status !== "PASS") throw new Error("Authoring validation must pass before compilation");
  const { capabilities, antipatterns, tactics, sourceRegisters, sources } = validation.model;
  if (options.requireApproved !== false) {
    if (sourceRegisters.length !== 1) throw new Error(`Production compilation requires exactly one Normative Source Register; found ${sourceRegisters.length}`);
    const unapproved = [...capabilities, ...antipatterns].filter((item) => !APPROVED_STATUSES.has(item.release_status)).map((item) => item.id);
    const unapprovedTactics = tactics.filter((item) => !APPROVED_STATUSES.has(item.__catalog?.release_status)).map((item) => item.id);
    const unapprovedRegisters = sourceRegisters.filter((item) => !APPROVED_STATUSES.has(item.release_status)).map((item) => item.version ?? "source-register");
    if (unapproved.length || unapprovedTactics.length || unapprovedRegisters.length) throw new Error(`Production compilation requires APPROVED content: ${[...unapproved, ...unapprovedTactics, ...unapprovedRegisters].join(", ")}`);
  }
  const normativeSources = sources.map(runtimeSource).sort((a, b) => a.id.localeCompare(b.id));
  const requirements = capabilities.map((item) => ({ id: `REQ-${item.id}`, domain: item.domain, title: item.title, sourceIds: unique(item.__sourceRecords.map((source) => source.source_id)), authority: item.runtime_authority ?? "MIXED", lifecycleStages: item.__canonicalStages, applicability: RUNTIME_APPLICABILITY.includes(item.runtime_applicability) ? item.runtime_applicability : "ALWAYS", interpretation: item.canonical_definition, humanAuthority: item.human_decision_authority ?? "GOVERNANCE", authoringObjectId: item.id, authoringVersion: item.version, governancePurpose: item.governance_purpose, applicabilityDetail: item.applicability, normativeMappings: item.__sourceRecords, findingDefinitions: item.finding_definitions })).sort((a, b) => a.id.localeCompare(b.id));
  const controls = capabilities.map((item) => { const byLifecycle = targetStates(item); const states = Object.values(byLifecycle); return { id: `CTRL-${item.id}`, domain: item.domain, title: item.title, requirementIds: [`REQ-${item.id}`], lifecycleStages: item.__canonicalStages, targetState: states.at(-1) ?? "TESTED", targetStateByLifecycle: byLifecycle, severity: item.__runtimeSeverity, signals: item.__runtimeSignals, authoringObjectId: item.id, authoringVersion: item.version, questions: item.primary_questions, atomicSubcriteria: item.atomic_subcriteria, indicators: item.capability_indicators, requiredEvidence: item.required_evidence, evidenceRules: item.evidence_rules, falsePositiveGuards: item.false_positive_guards, prohibitedInferences: item.prohibited_inferences, findingDefinitions: item.finding_definitions, hardGateEffect: item.hard_gate_effect, candidateTacticRefs: item.candidate_tactic_refs }; }).sort((a, b) => a.id.localeCompare(b.id));
  const runtimeAntipatterns = antipatterns.map((item) => ({ id: item.id, domain: item.domain, title: item.title, severity: item.__runtimeSeverity, signal: item.__runtimeSignals[0], signals: item.__runtimeSignals, relatedControlIds: unique([item.related_capability, ...array(item.related_criteria)].filter(Boolean).map((id) => `CTRL-${id}`)), lifecycleStages: item.__canonicalStages, authoringVersion: item.version, failureMechanism: item.failure_mechanism, consequences: item.potential_consequences, atomicTests: item.atomic_tests, indicators: item.antipattern_indicators, absenceTestRequirements: item.absence_test_requirements, evidenceRules: item.evidence_rules, falsePositiveGuards: item.false_positive_guards, prohibitedInferences: item.prohibited_inferences, findingDefinitions: item.finding_definitions, hardGateEffect: item.hard_gate_effect, candidateTacticRefs: item.candidate_tactic_refs })).sort((a, b) => a.id.localeCompare(b.id));
  const allObjects = [...capabilities, ...antipatterns];
  const runtimeTactics = tactics.map((item) => ({ id: item.id, version: item.version, status: APPROVED_STATUSES.has(item.__catalog?.release_status) ? "APPROVED" : item.__catalog?.release_status ?? "DRAFT", title: item.title, findingSignals: item.eligible_finding_ids, domains: unique([...array(item.assessment_mappings?.capabilities), ...array(item.assessment_mappings?.antipatterns)].map((id) => id.replace(/^AP-/, "").charAt(0))), lifecycleStages: unique(array(item.reassessment_targets).flatMap((id) => allObjects.find((object) => object.id === id)?.__canonicalStages ?? [])), useWhen: item.use_when ?? item.objective, doNotUseWhen: item.do_not_use_when, ownerRoles: item.owners, activities: item.activities, requiredArtifacts: item.artifacts, acceptanceCriteria: item.acceptance_criteria, verification: item.verification, blocksTransition: item.blocks_transition ?? "Progression remains blocked until acceptance evidence is reassessed.", completionEffect: "NEW_EVIDENCE_AND_REASSESSMENT_REQUIRED", assessmentMappings: item.assessment_mappings, eligibleFindingIds: item.eligible_finding_ids, triggerStates: item.trigger_states, reassessmentTargets: item.reassessment_targets })).sort((a, b) => a.id.localeCompare(b.id));
  await mkdir(outputDirectory, { recursive: true });
  const collections = { normativeSources, requirements, controls, antipatterns: runtimeAntipatterns, tactics: runtimeTactics };
  for (const [type, entries] of Object.entries(collections)) if (!entries.length) throw new Error(`Compilation requires a non-empty ${type} collection`);
  const files = {};
  for (const [type, entries] of Object.entries(collections)) {
    const name = `${type}.json`; const bytes = `${JSON.stringify({ schemaVersion: "1.0.0", type, entries }, null, 2)}\n`;
    await writeFile(path.join(outputDirectory, name), bytes, "utf8"); files[type] = { file: name, sha256: sha256(bytes), entryCount: entries.length };
  }
  const report = { schemaVersion: "1.0.0", version: options.version ?? "authoring-calibration", releaseStatus: options.releaseStatus ?? "CALIBRATION_TEST_ONLY", generatedAt: new Date().toISOString(), validation: { status: validation.status, counts: validation.counts }, files };
  await writeFile(path.join(outputDirectory, "compilation-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}

export async function createRuntimeManifest(runtimeDirectory, urlMap, options = {}) {
  const types = ["normativeSources", "requirements", "controls", "antipatterns", "tactics"];
  const report = JSON.parse(await readFile(path.join(runtimeDirectory, "compilation-report.json"), "utf8"));
  if (report.validation?.status !== "PASS") throw new Error("Compilation report is not valid");
  const documents = [];
  for (const type of types) {
    const file = `${type}.json`; const url = urlMap[type] ?? urlMap[file];
    if (!/^https:\/\//i.test(url ?? "") || /REPLACE_|example\.com/i.test(url)) throw new Error(`Exact immutable HTTPS URL required for ${type}`);
    const bytes = await readFile(path.join(runtimeDirectory, file)); const actual = sha256(bytes);
    if (report.files?.[type]?.sha256 !== actual) throw new Error(`Compiled file changed after validation: ${file}`);
    documents.push({ id: `kb-${type}-${options.version ?? report.version}`, type, url, sha256: actual });
  }
  const manifest = { schemaVersion: "1.0.0", version: options.version ?? report.version, releaseStatus: options.releaseStatus ?? report.releaseStatus, generatedAt: new Date().toISOString(), documents };
  await writeFile(path.join(runtimeDirectory, "runtime-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifest;
}
