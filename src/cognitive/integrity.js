import { DOMAINS, LIFECYCLE_STAGES, STATE_WEIGHT, lifecycleApplies } from "../contracts.js";
import { sha256, stableId } from "../core/hash.js";

const STATE_RANK = Object.fromEntries(Object.keys(STATE_WEIGHT).map((state, index) => [state, index]));
const DECISION_ELIGIBLE = new Set(["SUPPORTED", "PARTIAL"]);
const HIGH_INTEGRITY = new Set(["HIGH", "CRITICAL"]);

const array = (value) => Array.isArray(value) ? value : [];
const unique = (values) => [...new Set(values.filter(Boolean))];
const normalizeText = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

export function stampCanonicalObjectIds(claim, knowledge) {
  const index = knowledgeAssessmentIndex(knowledge);
  const extraAssessment = [];
  const extraAntiPatterns = [];
  const extraControls = [];
  for (const id of array(claim.controlIds)) {
    const control = index.controls.get(id);
    if (control?.authoringObjectId) extraAssessment.push(control.authoringObjectId);
  }
  for (const id of array(claim.assessmentObjectIds)) {
    const object = index.assessmentObjects.get(id);
    if (!object?.parentId) continue;
    const control = index.controls.get(object.parentId);
    if (control?.authoringObjectId) {
      extraAssessment.push(control.authoringObjectId);
      extraControls.push(control.id);
    }
    if (index.antiPatterns.has(object.parentId)) extraAntiPatterns.push(object.parentId);
  }
  for (const id of array(claim.antiPatternIds)) extraAntiPatterns.push(id);
  claim.assessmentObjectIds = unique([...array(claim.assessmentObjectIds), ...extraAssessment]);
  claim.antiPatternIds = unique([...array(claim.antiPatternIds), ...extraAntiPatterns]);
  claim.controlIds = unique([...array(claim.controlIds), ...extraControls]);
  return claim;
}

export function evidenceLinksForClaim(claim, sourceUnits) {
  const unitMap = new Map(sourceUnits.map((unit) => [unit.id, unit]));
  return array(claim.evidenceQuotes).map((entry) => {
    const unit = unitMap.get(entry.sourceUnitId);
    const quote = normalizeText(entry.quote);
    const exists = Boolean(unit && !unit.media && normalizeText(unit.content).includes(quote));
    return {
      id: stableId("evidence-link", { claimId: claim.id, sourceUnitId: entry.sourceUnitId, locator: unit?.locator, quote }),
      sourceUnitId: entry.sourceUnitId,
      sourceId: unit?.sourceId ?? null,
      path: unit?.path ?? null,
      locator: unit?.locator ?? null,
      quote: entry.quote,
      quoteHash: sha256(quote),
      sourceUnitHash: unit?.sha256 ?? null,
      evidenceClass: unit?.evidenceClass ?? (unit?.parentSourceUnitId ? "INFERRED" : unit?.path === "intended-use-dossier.json" ? "DECLARED" : "OBSERVED"),
      assuranceCeiling: unit?.assuranceCeiling ?? "UNKNOWN",
      locallyVerified: exists,
      limitations: unit?.parentSourceUnitId ? ["Model-derived description; verify material visual facts against the parent source."] : []
    };
  });
}

export function normalizeSolutionCandidates(dossier, generated, sourceUnits) {
  const unitMap = new Map(sourceUnits.map((unit) => [unit.id, unit]));
  const invalidCitations = [];
  const suppliedFacts = array(generated.facts);
  const candidateFacts = suppliedFacts.slice(0, 50).map((fact) => {
    const sourceUnitIds = unique(array(fact.sourceUnitIds).filter((id) => unitMap.has(id)));
    const evidenceLinks = evidenceLinksForClaim({ id: stableId("solution-fact-draft", fact), evidenceQuotes: fact.evidenceQuotes }, sourceUnits);
    const citationsValid = sourceUnitIds.length === array(fact.sourceUnitIds).length && evidenceLinks.length > 0 && evidenceLinks.every((item) => item.locallyVerified && sourceUnitIds.includes(item.sourceUnitId));
    const dossierOnly = sourceUnitIds.length > 0 && sourceUnitIds.every((id) => unitMap.get(id)?.path === "intended-use-dossier.json");
    const factClass = dossierOnly ? "DECLARED" : citationsValid ? "OBSERVED" : "INFERRED";
    if (!citationsValid) invalidCitations.push(fact.statement);
    const value = {
      category: String(fact.category ?? "unknown"),
      statement: normalizeText(fact.statement),
      factClass,
      proposedFactClass: fact.factClass,
      sourceUnitIds,
      evidenceLinks,
      localIntegrity: citationsValid ? "PASSED" : "FAILED",
      status: dossierOnly ? "DECLARED" : citationsValid ? "CANDIDATE" : "UNRESOLVED"
    };
    return { id: stableId("solution-fact", value), ...value };
  });
  const contradictions = array(generated.contradictions).map((item) => ({
    ...item,
    id: stableId("solution-contradiction", item),
    sourceUnitIds: unique(array(item.sourceUnitIds).filter((id) => unitMap.has(id))),
    status: "CANDIDATE"
  }));
  return {
    id: stableId("solution-model-candidate", { dossier, candidateFacts, contradictions }),
    status: "CANDIDATE_VERIFICATION_REQUIRED",
    declared: {
      name: dossier.name, intendedPurpose: dossier.intendedPurpose, expectedValue: dossier.expectedValue, users: dossier.users,
      jurisdictions: dossier.jurisdictions, roles: dossier.roles, accountableOwner: dossier.accountableOwner,
      currentStage: dossier.currentStage, targetStage: dossier.targetStage, data: dossier.data, exposure: dossier.exposure,
      agent: dossier.agent, classification: dossier.classification, operatingBoundary: dossier.operatingBoundary
    },
    candidateFacts,
    verifiedFacts: candidateFacts.filter((item) => item.status === "DECLARED"),
    unresolvedFacts: candidateFacts.filter((item) => item.status === "UNRESOLVED"),
    facts: candidateFacts.filter((item) => item.status === "DECLARED"),
    contradictions,
    unknowns: unique([...array(generated.unknowns), ...(suppliedFacts.length > 50 ? [`${suppliedFacts.length - 50} solution facts were excluded by the bounded-context limit.`] : []), ...invalidCitations.map((item) => `Evidence citation could not be verified for: ${item}`)]),
    limitations: [
      "The model cannot change the declared purpose or make a binding legal classification.",
      "Only independently verified semantic facts are shared with domain assessment.",
      "Observed code does not prove deployment configuration or operational effectiveness."
    ]
  };
}

export function applySolutionFactVerification(model, verificationOutput, verifier) {
  const resultMap = new Map(array(verificationOutput?.factResults).map((item) => [item.factId, item]));
  const candidateIds = new Set(model.candidateFacts.map((item) => item.id));
  const duplicateIds = array(verificationOutput?.factResults).map((item) => item.factId).filter((id, index, all) => all.indexOf(id) !== index);
  const unknownIds = array(verificationOutput?.factResults).map((item) => item.factId).filter((id) => !candidateIds.has(id));
  const suppliedIds = new Set(array(verificationOutput?.factResults).map((item) => item.factId));
  const missingIds = model.candidateFacts.filter((item) => item.status === "CANDIDATE" && !suppliedIds.has(item.id)).map((item) => item.id);
  const verifiedFacts = [];
  const unresolvedFacts = [];
  const records = [];
  for (const fact of model.candidateFacts) {
    if (fact.status === "DECLARED") { verifiedFacts.push(fact); continue; }
    const result = resultMap.get(fact.id);
    const sourceIdsValid = result && array(result.checkedSourceUnitIds).every((id) => fact.sourceUnitIds.includes(id));
    const accepted = fact.localIntegrity === "PASSED" && sourceIdsValid && result?.status === "SUPPORTED";
    const record = {
      id: stableId("solution-fact-verification", { factId: fact.id, verifier: verifier?.id, result }),
      factId: fact.id,
      verifierProvider: verifier?.provider ?? "NONE",
      verifierModel: verifier?.model ?? "NONE",
      status: accepted ? "SUPPORTED" : result?.status ?? "NOT_VERIFIABLE",
      rationale: result?.rationale ?? "No independent fact-verification result was returned.",
      checkedSourceUnitIds: sourceIdsValid ? unique(result.checkedSourceUnitIds) : [],
      conflictingSourceUnitIds: unique(array(result?.conflictingSourceUnitIds).filter((id) => fact.sourceUnitIds.includes(id)))
    };
    records.push(record);
    if (accepted) verifiedFacts.push({ ...fact, status: "VERIFIED", verificationId: record.id });
    else unresolvedFacts.push({ ...fact, status: record.status === "CONFLICTING" ? "CONFLICTING" : "UNRESOLVED", verificationId: record.id });
  }
  const integrityIssues = [
    ...duplicateIds.map((id) => ({ code: "DUPLICATE_SOLUTION_FACT_RESULT", factId: id })),
    ...unknownIds.map((id) => ({ code: "UNKNOWN_SOLUTION_FACT_RESULT", factId: id })),
    ...missingIds.map((id) => ({ code: "MISSING_SOLUTION_FACT_RESULT", factId: id }))
  ];
  const locked = {
    ...model,
    status: integrityIssues.length ? "VERIFIED_WITH_INTEGRITY_LIMITATIONS" : "VERIFIED_CONTEXT",
    verifiedFacts,
    unresolvedFacts: uniqueById([...model.unresolvedFacts, ...unresolvedFacts]),
    facts: verifiedFacts,
    factVerificationRecords: records,
    integrityIssues
  };
  return { ...locked, hash: sha256(locked) };
}

function uniqueById(items) {
  return [...new Map(items.map((item) => [item.id, item])).values()];
}

function nestedIds(item) {
  return unique([
    ...array(item.questions).map((entry) => entry?.id),
    ...array(item.atomicSubcriteria).map((entry) => entry?.id),
    ...array(item.atomicTests).map((entry) => entry?.id),
    ...array(item.findingDefinitions).map((entry) => entry?.id)
  ]);
}

export function knowledgeAssessmentIndex(knowledge) {
  const requirements = new Map(knowledge.requirements.map((item) => [item.id, item]));
  const controls = new Map(knowledge.controls.map((item) => [item.id, item]));
  const antiPatterns = new Map(knowledge.antipatterns.map((item) => [item.id, item]));
  const findingDefinitions = new Map();
  const assessmentObjects = new Map();
  for (const entry of [...knowledge.requirements, ...knowledge.controls, ...knowledge.antipatterns]) {
    if (entry.authoringObjectId) assessmentObjects.set(entry.authoringObjectId, { id: entry.authoringObjectId, parentId: entry.id, domain: entry.domain, title: entry.title });
    if (antiPatterns.has(entry.id)) assessmentObjects.set(entry.id, { id: entry.id, parentId: entry.id, domain: entry.domain, title: entry.title });
    for (const nested of [...array(entry.questions), ...array(entry.atomicSubcriteria), ...array(entry.atomicTests)]) if (nested?.id) assessmentObjects.set(nested.id, { ...nested, parentId: entry.id, domain: entry.domain });
    for (const finding of array(entry.findingDefinitions)) if (finding?.id) findingDefinitions.set(finding.id, { ...finding, parentId: entry.id, domain: entry.domain });
  }
  return { requirements, controls, antiPatterns, findingDefinitions, assessmentObjects };
}

export function validateClaimMappings(claim, knowledge) {
  const index = knowledgeAssessmentIndex(knowledge);
  const issues = [];
  for (const id of claim.controlIds) if (!index.controls.has(id)) issues.push(`Unknown control ${id}`);
  for (const id of claim.requirementIds) if (!index.requirements.has(id)) issues.push(`Unknown requirement ${id}`);
  for (const id of claim.antiPatternIds) if (!index.antiPatterns.has(id)) issues.push(`Unknown anti-pattern ${id}`);
  for (const id of claim.findingDefinitionIds) if (!index.findingDefinitions.has(id)) issues.push(`Unknown finding definition ${id}`);
  for (const id of claim.assessmentObjectIds) if (!index.assessmentObjects.has(id)) issues.push(`Unknown assessment object ${id}`);
  for (const id of [...claim.controlIds, ...claim.requirementIds, ...claim.antiPatternIds, ...claim.findingDefinitionIds, ...claim.assessmentObjectIds]) {
    const entry = index.controls.get(id) ?? index.requirements.get(id) ?? index.antiPatterns.get(id) ?? index.findingDefinitions.get(id) ?? index.assessmentObjects.get(id);
    if (entry?.domain && !claim.domains.includes(entry.domain)) issues.push(`${id} is outside the claim domains`);
  }
  for (const controlId of claim.controlIds) {
    const control = index.controls.get(controlId);
    if (claim.requirementIds.some((id) => !control?.requirementIds?.includes(id))) issues.push(`${controlId} does not map to every cited requirement`);
  }
  for (const antiPatternId of claim.antiPatternIds) {
    const antiPattern = index.antiPatterns.get(antiPatternId);
    if (claim.controlIds.length && !claim.controlIds.some((id) => antiPattern?.relatedControlIds?.includes(id))) issues.push(`${antiPatternId} does not map to a cited control`);
  }
  for (const findingDefinitionId of claim.findingDefinitionIds) {
    const definition = index.findingDefinitions.get(findingDefinitionId);
    const eligible = definition?.eligible_states ?? definition?.eligibleStates ?? [];
    if (eligible.length && !eligible.includes(claim.proposedFindingState)) issues.push(`${findingDefinitionId} does not permit finding state ${claim.proposedFindingState ?? "UNKNOWN"}`);
    const assessmentObjectId = definition?.assessment_object_id ?? definition?.assessmentObjectId;
    if (assessmentObjectId && claim.assessmentObjectIds.length && !claim.assessmentObjectIds.includes(assessmentObjectId)) issues.push(`${findingDefinitionId} requires assessment object ${assessmentObjectId}`);
  }
  const mappedEntries = [...claim.controlIds.map((id) => index.controls.get(id)), ...claim.antiPatternIds.map((id) => index.antiPatterns.get(id))].filter(Boolean);
  for (const inference of mappedEntries.flatMap((item) => array(item.prohibitedInferences))) if (semanticOverlap(claim.statement, inference) >= 0.72) issues.push("Claim matches a prohibited Knowledge Base inference");
  return { valid: issues.length === 0, issues, index };
}

function semanticOverlap(left, right) {
  const words = (value) => new Set(normalizeText(value).toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((item) => item.length > 2));
  const a = words(left); const b = words(right);
  if (!a.size || !b.size) return 0;
  const intersection = [...a].filter((item) => b.has(item)).length;
  return intersection / Math.min(a.size, b.size);
}

function canonicalClaimKey(claim) {
  return sha256({
    statement: normalizeText(claim.statement).toLowerCase().replace(/[^a-z0-9 ]/g, ""),
    claimType: claim.claimType,
    controls: claim.controlIds,
    antiPatterns: claim.antiPatternIds,
    findings: claim.findingDefinitionIds
  });
}

export function consolidateClaims(claims) {
  const groups = new Map();
  for (const claim of claims) {
    const key = canonicalClaimKey(claim);
    const existing = groups.get(key);
    if (!existing) groups.set(key, claim);
    else groups.set(key, {
      ...existing,
      sourceUnitIds: unique([...existing.sourceUnitIds, ...claim.sourceUnitIds]).sort(),
      evidenceQuotes: uniqueByQuote([...existing.evidenceQuotes, ...claim.evidenceQuotes]),
      domains: unique([...existing.domains, ...claim.domains]).sort(),
      limitations: unique([...existing.limitations, ...claim.limitations]),
      duplicateClaimIds: unique([...(existing.duplicateClaimIds ?? []), claim.id])
    });
  }
  const consolidated = [...groups.values()];
  const contradictionGraph = [];
  for (let leftIndex = 0; leftIndex < consolidated.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < consolidated.length; rightIndex += 1) {
      const left = consolidated[leftIndex]; const right = consolidated[rightIndex];
      const sameMapping = left.controlIds.some((id) => right.controlIds.includes(id)) || left.antiPatternIds.some((id) => right.antiPatternIds.includes(id));
      const opposite = sameMapping && ((left.claimType === "CONTROL_SUPPORT" && ["GAP", "RISK", "CONTRADICTION"].includes(right.claimType)) || (right.claimType === "CONTROL_SUPPORT" && ["GAP", "RISK", "CONTRADICTION"].includes(left.claimType)));
      if (opposite) contradictionGraph.push({ id: stableId("claim-contradiction", { left: left.id, right: right.id }), claimIds: [left.id, right.id], domains: unique([...left.domains, ...right.domains]), status: "VERIFICATION_REQUIRED" });
    }
  }
  return { claims: consolidated, contradictionGraph };
}

function uniqueByQuote(items) {
  return [...new Map(items.map((item) => [`${item.sourceUnitId}:${normalizeText(item.quote)}`, item])).values()];
}

export function createAdjudicatedClaim(claim, verifications, sourceUnits, knowledge) {
  const history = array(verifications);
  const finalVerification = history.at(-1);
  const mapping = validateClaimMappings(claim, knowledge);
  const evidenceLinks = evidenceLinksForClaim(claim, sourceUnits);
  const sourceIds = new Set(claim.sourceUnitIds);
  const verifierIdsValid = finalVerification && array(finalVerification.checkedSourceUnitIds).every((id) => sourceIds.has(id));
  const evidenceValid = evidenceLinks.length > 0 && evidenceLinks.every((item) => item.locallyVerified);
  const integrityPassed = mapping.valid && verifierIdsValid && evidenceValid;
  const status = integrityPassed ? finalVerification.status : "UNSUPPORTED";
  const value = {
    claimId: claim.id,
    status,
    finalVerificationId: finalVerification?.id ?? null,
    acceptedAssuranceState: finalVerification?.acceptedAssuranceState ?? claim.proposedAssuranceState ?? "UNKNOWN",
    verificationIds: history.map((item) => item.id),
    evidenceLinks,
    mappingStatus: mapping.valid ? "VALID" : "INVALID",
    mappingIssues: mapping.issues,
    integrityStatus: integrityPassed ? "PASSED" : "FAILED",
    decisionEligible: DECISION_ELIGIBLE.has(status) && integrityPassed,
    unresolvedHighIntegrity: HIGH_INTEGRITY.has(claim.severity) && !DECISION_ELIGIBLE.has(status)
  };
  return { id: stableId("adjudicated-claim", value), ...value };
}

export function lockAdjudicatedClaim(claim, adjudicated, sourceUnits) {
  const lockIssues = [];
  if (!adjudicated.decisionEligible) lockIssues.push("ADJUDICATED_CLAIM_NOT_DECISION_ELIGIBLE");
  if (adjudicated.integrityStatus !== "PASSED") lockIssues.push("ADJUDICATED_CLAIM_INTEGRITY_FAILED");
  if (claim.claimType === "CONTROL_SUPPORT" && adjudicated.status !== "SUPPORTED") lockIssues.push("PARTIAL_CONTROL_SUPPORT_CANNOT_ESTABLISH_ASSURANCE");
  if (claim.claimType === "ABSENCE_TEST" && !validAbsenceTest(claim.absenceTest)) lockIssues.push("ABSENCE_TEST_CONTRACT_INCOMPLETE");
  const unitMap = new Map(sourceUnits.map((unit) => [unit.id, unit]));
  const units = claim.sourceUnitIds.map((id) => unitMap.get(id)).filter(Boolean);
  const proposedState = lowerState(claim.proposedAssuranceState ?? "UNKNOWN", adjudicated.acceptedAssuranceState ?? "UNKNOWN");
  const acceptedState = capState(proposedState, units);
  const lockRecord = {
    id: stableId("finding-lock", { claimId: claim.id, adjudicatedId: adjudicated.id, lockIssues, acceptedState }),
    claimId: claim.id,
    adjudicatedClaimId: adjudicated.id,
    status: lockIssues.length ? "REJECTED" : "LOCKED",
    issues: lockIssues,
    proposedAssuranceState: claim.proposedAssuranceState,
    acceptedAssuranceState: acceptedState,
    deterministic: true
  };
  if (lockIssues.length) return { lockRecord, finding: null };
  const value = {
    claimId: claim.id,
    adjudicatedClaimId: adjudicated.id,
    findingType: claim.claimType,
    statement: claim.statement,
    domains: claim.domains,
    evidenceLinks: adjudicated.evidenceLinks,
    evidenceQuotes: claim.evidenceQuotes,
    controlIds: claim.controlIds,
    antiPatternIds: claim.antiPatternIds,
    requirementIds: claim.requirementIds,
    findingDefinitionIds: claim.findingDefinitionIds,
    assessmentObjectIds: claim.assessmentObjectIds,
    findingState: claim.proposedFindingState,
    severity: claim.severity,
    strength: adjudicated.status,
    sourceUnitIds: claim.sourceUnitIds,
    verificationIds: adjudicated.verificationIds,
    limitations: claim.limitations,
    proposedAssuranceState: acceptedState,
    absenceTest: claim.absenceTest,
    lifecycleConsequence: "DETERMINISTIC_REASSESSMENT"
  };
  return { lockRecord, finding: { id: stableId("finding", value), ...value } };
}

function capState(proposed, units) {
  const ceilings = units.map((unit) => unit.assuranceCeiling ?? "DECLARED");
  const strongest = ceilings.sort((a, b) => (STATE_RANK[b] ?? 0) - (STATE_RANK[a] ?? 0))[0] ?? "DECLARED";
  return (STATE_RANK[proposed] ?? 0) <= (STATE_RANK[strongest] ?? 0) ? proposed : strongest;
}

function lowerState(left, right) {
  return (STATE_RANK[left] ?? 0) <= (STATE_RANK[right] ?? 0) ? left : right;
}

export function validAbsenceTest(test) {
  if (!test || !test.scope || !test.method || !test.executedAt || !test.systemVersion) return false;
  if (Number.isNaN(Date.parse(test.executedAt))) return false;
  return /pass|absent|not found|no occurrence/i.test(test.result ?? "");
}

function inLifecycle(entry, dossier) {
  return lifecycleApplies(array(entry.lifecycleStages), dossier);
}

function coverageObjects(knowledge, dossier) {
  const entries = [];
  const add = (kind, item, parentId = null) => {
    entries.push({
      id: stableId("coverage", { kind, objectId: item.id, parentId }), objectId: item.id, parentId, kind: kind.toUpperCase(), domain: item.domain,
      lifecycleApplicable: inLifecycle(item, dossier), lifecycleStages: item.lifecycleStages ?? [], title: item.title ?? item.question ?? item.test ?? item.id,
      humanInterpretationRequired: Boolean(item.humanInterpretationRequired)
    });
  };
  for (const requirement of knowledge.requirements) { add("requirement", requirement); for (const finding of array(requirement.findingDefinitions)) add("finding", { ...finding, domain: requirement.domain, lifecycleStages: requirement.lifecycleStages }, requirement.id); }
  for (const control of knowledge.controls) {
    add("control", control);
    for (const object of [...array(control.questions), ...array(control.atomicSubcriteria)]) add("assessment", { ...object, domain: control.domain, lifecycleStages: control.lifecycleStages }, control.id);
    for (const finding of array(control.findingDefinitions)) add("finding", { ...finding, domain: control.domain, lifecycleStages: control.lifecycleStages }, control.id);
  }
  for (const antiPattern of knowledge.antipatterns) {
    add("antipattern", antiPattern);
    for (const object of [...array(antiPattern.questions), ...array(antiPattern.atomicTests)]) add("assessment", { ...object, domain: antiPattern.domain, lifecycleStages: antiPattern.lifecycleStages }, antiPattern.id);
    for (const finding of array(antiPattern.findingDefinitions)) add("finding", { ...finding, domain: antiPattern.domain, lifecycleStages: antiPattern.lifecycleStages }, antiPattern.id);
  }
  return entries;
}

export function assessmentWorkItems(knowledge, dossier, domain) {
  const index = knowledgeAssessmentIndex(knowledge);
  return coverageObjects(knowledge, dossier)
    .filter((item) => item.domain === domain && item.lifecycleApplicable && !item.humanInterpretationRequired)
    .map(({ objectId, parentId, kind, domain: itemDomain, title }) => {
      const nested = index.assessmentObjects.get(objectId);
      const item = { id: objectId, objectId, parentId, kind, domain: itemDomain, title };
      if (nested?.question) item.question = nested.question;
      if (nested?.dimension) item.dimension = nested.dimension;
      return item;
    });
}

export function buildAssessmentCoverageMatrix(knowledge, dossier, claims, domainResults) {
  const domainStatus = new Map(domainResults.map((item) => [item.domain, item.status]));
  const claimed = {
    requirement: new Set(claims.flatMap((item) => item.requirementIds)),
    control: new Set(claims.flatMap((item) => item.controlIds)),
    antipattern: new Set(claims.flatMap((item) => item.antiPatternIds)),
    assessment: new Set(claims.flatMap((item) => item.assessmentObjectIds)),
    finding: new Set(claims.flatMap((item) => item.findingDefinitionIds))
  };
  const assessed = new Set(domainResults.flatMap((item) => item.assessmentResults ?? []).filter((item) => item.status === "ASSESSED" || item.status === "NO_EVIDENCE_FOUND").map((item) => item.objectId));
  const entries = coverageObjects(knowledge, dossier).map((item) => {
    const { lifecycleApplicable, humanInterpretationRequired, ...publicItem } = item;
    const status = !item.lifecycleApplicable ? "NOT_APPLICABLE"
      : domainStatus.get(item.domain) === "FAILED" ? "FAILED"
        : item.humanInterpretationRequired ? "HUMAN_INTERPRETATION_REQUIRED"
          : assessed.has(item.objectId) || claimed[item.kind.toLowerCase()]?.has(item.objectId) ? "ASSESSED" : "UNKNOWN";
    const evidenceStatus = status === "ASSESSED" ? (claimed[item.kind.toLowerCase()]?.has(item.objectId) ? "CLAIM_PROPOSED" : "NO_EVIDENCE_FOUND") : null;
    return { ...publicItem, status, mandatory: lifecycleApplicable, evidenceStatus };
  });
  const mandatory = entries.filter((item) => item.mandatory && item.status !== "NOT_APPLICABLE");
  const complete = mandatory.every((item) => ["ASSESSED", "HUMAN_INTERPRETATION_REQUIRED"].includes(item.status));
  return {
    version: "assessment-coverage-1.0.0",
    complete,
    entries,
    counts: Object.fromEntries(["ASSESSED", "UNKNOWN", "NOT_APPLICABLE", "FAILED", "HUMAN_INTERPRETATION_REQUIRED"].map((status) => [status, entries.filter((item) => item.status === status).length])),
    domainStatus: Object.fromEntries(Object.keys(DOMAINS).map((domain) => [domain, domainStatus.get(domain) ?? "FAILED"]))
  };
}

export function validateFactCheckCompleteness(synthesis, checked) {
  const expected = synthesis.items.filter((item) => item.supportStatus !== "DETERMINISTIC").map((item) => item.id);
  const supplied = array(checked?.itemResults).map((item) => item.itemId);
  const duplicates = supplied.filter((id, index) => supplied.indexOf(id) !== index);
  const missing = expected.filter((id) => !supplied.includes(id));
  const unknown = supplied.filter((id) => !expected.includes(id));
  const supportedValueConsistent = Boolean(checked?.supported) === array(checked?.itemResults).every((item) => item.status === "SUPPORTED");
  return { valid: !duplicates.length && !missing.length && !unknown.length && supportedValueConsistent, duplicates: unique(duplicates), missing, unknown, supportedValueConsistent };
}

export function evaluatePublicationGate({ coverageMatrix, findingLockRecords, unresolvedClaims, factCheckIntegrity, narrative, actionGroundingRecords, integrityIncidents, reanalysisTrace }) {
  const blockers = [];
  const limitations = [];
  if (findingLockRecords.some((item) => item.status === "REJECTED" && item.issues.some((issue) => issue !== "ADJUDICATED_CLAIM_NOT_DECISION_ELIGIBLE"))) blockers.push("LOCKED_FINDING_INTEGRITY_FAILED");
  if (!factCheckIntegrity?.valid) blockers.push("FACT_CHECK_INCOMPLETE_OR_INCONSISTENT");
  if (array(integrityIncidents).some((item) => item.severity === "CRITICAL")) blockers.push("CRITICAL_PIPELINE_INTEGRITY_INCIDENT");
  if (!coverageMatrix.complete) limitations.push("ASSESSMENT_COVERAGE_INCOMPLETE");
  if (unresolvedClaims.some((item) => HIGH_INTEGRITY.has(item.severity))) limitations.push("UNRESOLVED_HIGH_INTEGRITY_CLAIMS");
  if (narrative?.quarantine?.items?.length || narrative?.quarantine?.rejectedItemIds?.length) limitations.push("NARRATIVE_ITEMS_QUARANTINED");
  if (actionGroundingRecords.some((item) => item.status !== "GROUNDED")) limitations.push("ACTION_GROUNDING_INCOMPLETE");
  if (array(reanalysisTrace).some((item) => item.status !== "RESOLVED")) limitations.push("REANALYSIS_LIMITATIONS_REMAIN");
  const status = blockers.length ? "REPORT_WITHHELD" : limitations.length ? "REPORT_WITH_LIMITATIONS" : "REPORT_READY";
  return {
    version: "publication-gate-1.0.0",
    status,
    blockers: unique(blockers),
    limitations: unique(limitations),
    readinessIndependent: true,
    statement: status === "REPORT_READY" ? "The assurance narrative passed publication integrity checks."
      : status === "REPORT_WITH_LIMITATIONS" ? "The deterministic package may be used with the listed cognitive limitations."
        : "Generated assurance narrative is withheld; use the deterministic package and audit ledger only."
  };
}

export function lifecycleOrder(stage) { return LIFECYCLE_STAGES.indexOf(stage); }
