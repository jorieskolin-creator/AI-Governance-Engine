import { DOMAINS, LIFECYCLE_STAGES } from "../contracts.js";

const collections = ["normativeSources", "requirements", "controls", "antipatterns", "tactics"];
const unique = (values) => [...new Set(values)];

export function evaluateKnowledgeSnapshot(snapshot) {
  const issues = [];
  const add = (severity, code, message, entryIds = []) => issues.push({ severity, code, message, entryIds: unique(entryIds) });
  const ids = {};
  for (const name of collections) {
    const entries = snapshot[name] ?? [];
    ids[name] = new Set(entries.map((item) => item?.id).filter(Boolean));
    const missing = entries.filter((item) => !item?.id || typeof item.id !== "string");
    if (missing.length) add("ERROR", "MISSING_STABLE_ID", `${name} contains ${missing.length} entry or entries without a stable ID.`);
    const duplicates = entries.map((item) => item?.id).filter((id, index, all) => id && all.indexOf(id) !== index);
    if (duplicates.length) add("ERROR", "DUPLICATE_ID", `${name} contains duplicate IDs.`, duplicates);
  }
  const allIds = collections.flatMap((name) => [...ids[name]]);
  const globalDuplicates = allIds.filter((id, index) => allIds.indexOf(id) !== index);
  if (globalDuplicates.length) add("ERROR", "CROSS_COLLECTION_DUPLICATE_ID", "Knowledge IDs must be unique across document types.", globalDuplicates);

  const domainEntries = [...(snapshot.requirements ?? []), ...(snapshot.controls ?? []), ...(snapshot.antipatterns ?? [])];
  const invalidDomains = domainEntries.filter((item) => !Object.hasOwn(DOMAINS, item.domain)).map((item) => item.id);
  for (const tactic of snapshot.tactics ?? []) if (!Array.isArray(tactic.domains) || tactic.domains.some((domain) => !Object.hasOwn(DOMAINS, domain))) invalidDomains.push(tactic.id);
  if (invalidDomains.length) add("ERROR", "INVALID_DOMAIN", "Entries reference a domain outside A-F.", invalidDomains);

  const lifecycleEntries = [...(snapshot.requirements ?? []), ...(snapshot.controls ?? []), ...(snapshot.tactics ?? [])];
  const invalidLifecycle = lifecycleEntries.filter((item) => !Array.isArray(item.lifecycleStages) || item.lifecycleStages.some((stage) => !LIFECYCLE_STAGES.includes(stage))).map((item) => item.id);
  if (invalidLifecycle.length) add("ERROR", "INVALID_LIFECYCLE_STAGE", "Entries contain missing or unsupported lifecycle stages.", invalidLifecycle);

  const brokenSources = (snapshot.requirements ?? []).filter((item) => !Array.isArray(item.sourceIds) || item.sourceIds.some((id) => !ids.normativeSources.has(id))).map((item) => item.id);
  if (brokenSources.length) add("ERROR", "BROKEN_NORMATIVE_SOURCE_REFERENCE", "Requirements reference missing normative sources.", brokenSources);
  const brokenRequirements = (snapshot.controls ?? []).filter((item) => !Array.isArray(item.requirementIds) || item.requirementIds.some((id) => !ids.requirements.has(id))).map((item) => item.id);
  if (brokenRequirements.length) add("ERROR", "BROKEN_REQUIREMENT_REFERENCE", "Controls reference missing requirements.", brokenRequirements);
  const brokenControls = (snapshot.antipatterns ?? []).filter((item) => !Array.isArray(item.relatedControlIds) || item.relatedControlIds.some((id) => !ids.controls.has(id))).map((item) => item.id);
  if (brokenControls.length) add("ERROR", "BROKEN_CONTROL_REFERENCE", "Anti-patterns reference missing controls.", brokenControls);

  const knownSignals = new Set([...(snapshot.controls ?? []).flatMap((item) => item.signals ?? []), ...(snapshot.antipatterns ?? []).map((item) => item.signal).filter(Boolean)]);
  const unmappedTactics = (snapshot.tactics ?? []).filter((item) => !Array.isArray(item.findingSignals) || !item.findingSignals.some((signal) => knownSignals.has(signal))).map((item) => item.id);
  if (unmappedTactics.length) add("WARNING", "TACTIC_WITHOUT_KNOWN_FINDING_SIGNAL", "Tactics have no exact finding signal in the active controls or anti-patterns.", unmappedTactics);
  if (snapshot.releaseStatus !== "APPROVED") add("WARNING", "KNOWLEDGE_NOT_APPROVED", `Knowledge release status is ${snapshot.releaseStatus ?? "UNSPECIFIED"}; it is not an approved production mapping.`);

  const errorCount = issues.filter((item) => item.severity === "ERROR").length;
  const warningCount = issues.filter((item) => item.severity === "WARNING").length;
  return {
    version: "knowledge-diagnostics-1.0.0",
    status: errorCount ? "FAIL" : warningCount ? "WARN" : "PASS",
    checkedAt: new Date().toISOString(),
    errorCount,
    warningCount,
    issues,
    documentChecks: snapshot.documentChecks ?? [],
    counts: Object.fromEntries(collections.map((name) => [name, snapshot[name]?.length ?? 0]))
  };
}
