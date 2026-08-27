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

  const knownAssessmentObjects = new Set([...(snapshot.controls ?? []).map((item) => item.authoringObjectId), ...(snapshot.antipatterns ?? []).map((item) => item.id)].filter(Boolean));
  const unmappedTactics = (snapshot.tactics ?? []).filter((item) => {
    const mappings = [...(item.assessmentMappings?.capabilities ?? []), ...(item.assessmentMappings?.antipatterns ?? [])];
    return !mappings.length || mappings.some((id) => !knownAssessmentObjects.has(id));
  }).map((item) => item.id);
  const productionRelease = ["APPROVED", "FROZEN"].includes(snapshot.releaseStatus);
  const playbookApproved = snapshot.playbookStatus === "APPROVED" || (snapshot.tactics ?? []).some((item) => item.status === "APPROVED");
  const objectsUnpublished = snapshot.assessmentObjectsStatus === "NOT_PUBLISHED" || snapshot.releaseStatus === "ASSESSMENT_OBJECTS_NOT_PUBLISHED";
  if (unmappedTactics.length) {
    if (productionRelease) add("ERROR", "TACTIC_WITHOUT_PRIMARY_OBJECT_MAPPING", "Tactics must map to assessment objects present in the active capability and anti-pattern collections.", unmappedTactics);
    else if (objectsUnpublished || playbookApproved) add("WARNING", "ASSESSMENT_OBJECTS_NOT_PUBLISHED", "Approved Playbook tactics are loaded; capability and anti-pattern Knowledge Base objects are not yet published. Tactics appear after locked findings map to those objects.", unmappedTactics);
    else add("WARNING", "TACTIC_WITHOUT_PRIMARY_OBJECT_MAPPING", "Tactics must map to assessment objects present in the active capability and anti-pattern collections.", unmappedTactics);
  }
  if (!productionRelease && !(objectsUnpublished && playbookApproved)) add("WARNING", "KNOWLEDGE_NOT_APPROVED", `Knowledge release status is ${snapshot.releaseStatus ?? "UNSPECIFIED"}; it is not an approved production mapping.`);
  const questionnaire = snapshot.intakeQuestionnaire;
  if (!questionnaire || !Array.isArray(questionnaire.questions) || !questionnaire.questions.length) add("ERROR", "INTAKE_QUESTIONNAIRE_MISSING", "The versioned assessment-intake questionnaire is missing.");
  else {
    const questionIds = questionnaire.questions.map((item) => item?.id).filter(Boolean);
    if (questionIds.length !== new Set(questionIds).size) add("ERROR", "DUPLICATE_INTAKE_QUESTION_ID", "Assessment-intake question IDs must be unique.", questionIds.filter((id, index) => questionIds.indexOf(id) !== index));
    const sourceIds = new Set(snapshot.normativeSources?.map((item) => item.id) ?? []);
    const broken = questionnaire.questions.filter((item) => (item.sourceMappings ?? []).some((mapping) => !sourceIds.has(mapping.sourceId))).map((item) => item.id);
    if (broken.length && snapshot.intakeQuestionnaireSource === "MANIFEST") add("ERROR", "BROKEN_INTAKE_SOURCE_REFERENCE", "Assessment-intake questions reference missing normative sources.", broken);
    if (snapshot.intakeQuestionnaireSource === "BUNDLED_FALLBACK" && snapshot.source !== "LOCAL_BOOTSTRAP") add("WARNING", "INTAKE_QUESTIONNAIRE_NOT_MANIFEST_PINNED", "The remote manifest does not pin the assessment-intake questionnaire; bundled fallback content is active.");
  }

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
