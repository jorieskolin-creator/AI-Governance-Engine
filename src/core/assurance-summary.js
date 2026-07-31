import { DOMAINS } from "../contracts.js";
import { stableId } from "./hash.js";
import { caseProfileView, fieldLabel } from "./solution-profile.js";

const HIGH = new Set(["HIGH", "CRITICAL"]);
const BLOCKING_FINDING_TYPES = new Set(["GAP", "RISK", "ANTIPATTERN", "CONTRADICTION", "UNKNOWN", "EVIDENCE_REQUEST"]);

const label = (value) => String(value ?? "").replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
const unique = (values) => [...new Set(values.filter(Boolean))];

function basis({ gateIds = [], evidenceIds = [], controlIds = [], findingIds = [], ruleIds = [] } = {}) {
  return {
    gateIds: unique(gateIds), evidenceIds: unique(evidenceIds), controlIds: unique(controlIds),
    findingIds: unique(findingIds), ruleIds: unique(ruleIds)
  };
}

function boundaryItem(statement, valueBasis) {
  return { id: stableId("boundary-item", { statement, basis: valueBasis }), statement, basis: valueBasis };
}

function boundaryStatus(readiness, gates) {
  if (gates.some((item) => item.outcome === "BLOCK")) return "PROGRESSION_BLOCKED";
  if (gates.some((item) => item.outcome === "REVIEW")) return "HUMAN_DECISION_REQUIRED";
  if (readiness.outcome === "REMEDIATE_BEFORE_NEXT_STAGE") return "CURRENT_STAGE_ONLY";
  if (readiness.outcome === "READY_WITH_CONDITIONS") return "CONDITIONALLY_ALLOWED";
  return "PROGRESSION_ALLOWED";
}

function boundaryHeadline(status, dossier) {
  const current = label(dossier.currentStage);
  const target = label(dossier.targetStage);
  if (status === "PROGRESSION_BLOCKED") return `${target} is blocked; remain within the declared ${current} boundary.`;
  if (status === "HUMAN_DECISION_REQUIRED") return `${current} to ${target} requires named human decisions.`;
  if (status === "CURRENT_STAGE_ONLY") return `Remediate before progressing from ${current} to ${target}.`;
  if (status === "CONDITIONALLY_ALLOWED") return `${target} is conditionally available after the stated conditions are evidenced.`;
  return `No deterministic blocker prevents progression from ${current} to ${target}.`;
}

export function buildTransitionBoundary({ dossier, gates, domains, readiness, humanDecisions, documentationReadiness = null }) {
  const status = boundaryStatus(readiness, gates);
  const configured = dossier.operatingBoundary;
  const effectiveEnvironment = documentationReadiness?.sandboxRequired ? "ISOLATED_SANDBOX" : configured.environment;
  const permittedUses = (configured.allowedUses.length ? configured.allowedUses : [
    "Continue only within the declared intended purpose and current lifecycle-stage boundary."
  ]).map((statement) => boundaryItem(statement, basis({ ruleIds: ["RULE-BOUNDARY-DECLARED-PURPOSE"] })));

  if (effectiveEnvironment !== "UNKNOWN") {
    permittedUses.push(boundaryItem(`Operating environment: ${label(effectiveEnvironment)}.`, basis({ ruleIds: [documentationReadiness?.sandboxRequired ? "RULE-BOUNDARY-DOCUMENTATION-SANDBOX" : "RULE-BOUNDARY-ENVIRONMENT"] })));
  }
  for (const [key, title] of [
    ["userScope", "User scope"], ["dataScope", "Data scope"], ["integrationScope", "Integration scope"],
    ["permissionScope", "Permission scope"], ["autonomyScope", "Autonomy scope"], ["monitoringOwner", "Monitoring owner"], ["expiresAt", "Boundary expiry"]
  ]) {
    if (configured[key]) permittedUses.push(boundaryItem(`${title}: ${configured[key]}.`, basis({ ruleIds: [`RULE-BOUNDARY-${key.replace(/[A-Z]/g, (letter) => `-${letter}`).toUpperCase()}`] })));
  }

  const prohibitedUses = configured.excludedUses.map((statement) => boundaryItem(statement, basis({ ruleIds: ["RULE-BOUNDARY-DECLARED-EXCLUSION"] })));
  if (documentationReadiness?.sandboxRequired) {
    prohibitedUses.push(boundaryItem("Do not use production access, uncontrolled external users, consequential decisions, or unapproved sensitive data while documentation remains incomplete.", basis({ ruleIds: ["RULE-BOUNDARY-DOCUMENTATION-SANDBOX"] })));
  }
  for (const gate of gates.filter((item) => item.outcome === "BLOCK")) {
    prohibitedUses.push(boundaryItem(`Do not progress until “${gate.title}” is resolved.`, basis({
      gateIds: [gate.id], evidenceIds: gate.evidenceIds, controlIds: gate.controlIds, ruleIds: gate.ruleIds
    })));
  }
  if (!prohibitedUses.length && status !== "PROGRESSION_ALLOWED") {
    prohibitedUses.push(boundaryItem(`Do not enter ${label(dossier.targetStage)} until the stated gaps and decisions are resolved.`, basis({ ruleIds: ["RULE-BOUNDARY-NO-PROGRESSION"] })));
  }

  const conditions = [];
  for (const gate of gates) {
    for (const statement of gate.clearanceCriteria) {
      conditions.push(boundaryItem(statement, basis({ gateIds: [gate.id], evidenceIds: gate.evidenceIds, controlIds: gate.controlIds, ruleIds: gate.ruleIds })));
    }
  }
  if (!conditions.length && status === "CURRENT_STAGE_ONLY") {
    for (const gap of domains.flatMap((domain) => domain.gaps).filter((item) => HIGH.has(item.severity))) {
      conditions.push(boundaryItem(gap.description, basis({ evidenceIds: gap.evidenceIds, controlIds: [gap.controlId], findingIds: [gap.id], ruleIds: ["RULE-BOUNDARY-HIGH-GAP"] })));
    }
  }
  const missingParameters = [
    ["environment", configured.environment === "UNKNOWN"], ["userScope", !configured.userScope], ["dataScope", !configured.dataScope],
    ["integrationScope", !configured.integrationScope], ["permissionScope", !configured.permissionScope], ["autonomyScope", !configured.autonomyScope],
    ["monitoringOwner", !configured.monitoringOwner], ["expiresAt", !configured.expiresAt]
  ].filter(([, missing]) => missing).map(([key]) => key);
  for (const key of missingParameters) {
    conditions.push(boundaryItem(`Declare the ${fieldLabel(`operatingBoundary.${key}`).toLowerCase()} before relying on this operating boundary.`, basis({ ruleIds: ["RULE-BOUNDARY-MISSING-DECLARATION"] })));
  }

  const boundary = {
    currentStage: dossier.currentStage,
    targetStage: dossier.targetStage,
    label: ["DEPLOYMENT", "OPERATION_AND_MONITORING"].includes(dossier.targetStage) ? "Deterministic Production Boundary" : "Deterministic Lifecycle Transition Boundary",
    status,
    headline: boundaryHeadline(status, dossier),
    permittedUses,
    prohibitedUses,
    conditions,
    blockingGateIds: gates.filter((item) => item.outcome === "BLOCK").map((item) => item.id),
    reviewGateIds: gates.filter((item) => item.outcome === "REVIEW").map((item) => item.id),
    requiredAuthorityIds: unique(humanDecisions.map((item) => item.authority)),
    declaredParameters: {
      environment: effectiveEnvironment,
      declaredEnvironment: configured.environment,
      userScope: configured.userScope || null,
      dataScope: configured.dataScope || null,
      integrationScope: configured.integrationScope || null,
      permissionScope: configured.permissionScope || null,
      autonomyScope: configured.autonomyScope || null,
      monitoringOwner: configured.monitoringOwner || null,
      expiresAt: configured.expiresAt
    },
    unknownParameters: missingParameters,
    immutable: true
  };
  return { ...boundary, hash: stableId("transition-boundary", boundary) };
}

function domainStatus(domain, gates) {
  const controlIds = new Set(domain.controls.map((item) => item.controlId));
  const relatedGates = gates.filter((item) => item.controlIds.some((id) => controlIds.has(id)));
  if (relatedGates.some((item) => item.outcome === "BLOCK")) return "HARD_GATE_BLOCKED";
  if (relatedGates.some((item) => item.outcome === "REVIEW") || domain.gaps.some((item) => item.humanReviewRequired)) return "HUMAN_REVIEW_REQUIRED";
  const confirmed = domain.antiPatterns.filter((item) => ["CONFIRMED_PRESENT", "DECLARED_RISK", "DETECTED_CANDIDATE", "VERIFICATION_REQUIRED", "PARTIALLY_PRESENT"].includes(item.state));
  const applicable = domain.controls.filter((item) => item.state !== "NOT_APPLICABLE");
  if (applicable.length && applicable.every((item) => item.state === "UNKNOWN")) return "INSUFFICIENT_EVIDENCE";
  if (confirmed.some((item) => item.severity === "CRITICAL") || domain.gaps.some((item) => ["HIGH", "CRITICAL"].includes(item.severity))) return "REMEDIATION_REQUIRED";
  if (domain.controls.some((item) => item.state === "UNKNOWN")) return "INSUFFICIENT_EVIDENCE";
  if (domain.gaps.length || confirmed.length) return "CONDITIONAL";
  return "READY";
}

function deterministicDomainNarrative(domain) {
  const applicable = domain.controls.filter((item) => item.state !== "NOT_APPLICABLE");
  const unknown = applicable.filter((item) => item.state === "UNKNOWN").length;
  const belowTarget = applicable.filter((item) => !item.meetsTarget && item.state !== "UNKNOWN").length;
  if (!applicable.length) return "No control is applicable to the declared lifecycle boundary.";
  if (unknown === applicable.length) return `All ${applicable.length} applicable controls lack acceptable evidence; missing evidence remains unknown.`;
  if (unknown) return `${unknown} of ${applicable.length} applicable controls lack acceptable evidence; ${belowTarget} additional control(s) remain below target.`;
  if (belowTarget) return `${belowTarget} of ${applicable.length} applicable controls have evidence below the required assurance target.`;
  return `All ${applicable.length} applicable controls meet the deterministic assurance target.`;
}

function executiveGapGroups(domains, documentationReadiness, sourceIngestion) {
  const groups = domains.filter((domain) => domain.gaps.length).map((domain) => {
    const unknown = domain.gaps.filter((item) => item.currentState === "UNKNOWN").length;
    const statement = unknown === domain.gaps.length
      ? `${unknown} applicable control(s) lack acceptable evidence; silence is not treated as absence.`
      : `${domain.gaps.length} applicable control(s) remain below target, including ${unknown} with unknown evidence status.`;
    return narrativeItem("EXECUTIVE_GAP_GROUP", `${domain.id} — ${domain.title}: ${statement}`, {
      findingIds: domain.gaps.map((item) => item.id), controlIds: domain.gaps.map((item) => item.controlId), evidenceIds: domain.gaps.flatMap((item) => item.evidenceIds)
    }, "DETERMINISTIC_CONSOLIDATION");
  });
  if (documentationReadiness?.status !== "DOCUMENTED_AND_CONFIRMED") {
    groups.push(narrativeItem("EXECUTIVE_GAP_GROUP", `Documentation alignment: ${documentationReadiness.satisfiedFieldCount} of ${documentationReadiness.mandatoryFieldCount} applicable fields are satisfied; ${documentationReadiness.materialContradictionCount ?? 0} material contradiction(s) require resolution.`, {
      ruleIds: ["RULE-DOCUMENTATION-READINESS"]
    }, "DETERMINISTIC_CONSOLIDATION"));
  }
  if (sourceIngestion?.coverageStatus === "INCOMPLETE_REVIEW_REQUIRED") {
    groups.push(narrativeItem("EXECUTIVE_GAP_GROUP", `Source coverage: ${sourceIngestion.relevantExclusionCount} selected source file(s) could not be assessed and require resolution or attributable review.`, {
      ruleIds: ["RULE-SOURCE-COVERAGE"]
    }, "DETERMINISTIC_CONSOLIDATION"));
  }
  return groups.slice(0, 8);
}

function evidenceClass(item, mode) {
  if (item.sourceId === "dossier" || item.kind === "DECLARATION") return "DECLARED";
  if (mode === "COGNITIVE_VERIFIED" && item.metadata?.lockedFindingId) return "OBSERVED";
  if (mode === "DEMO") return "SIMULATED";
  return "AUTOMATED_INDICATOR";
}

function narrativeItem(section, text, references = {}, supportStatus = "DETERMINISTIC") {
  const value = {
    section,
    text,
    findingIds: unique(references.findingIds ?? []),
    gateIds: unique(references.gateIds ?? []),
    controlIds: unique(references.controlIds ?? []),
    evidenceIds: unique(references.evidenceIds ?? []),
    ruleIds: unique(references.ruleIds ?? []),
    supportStatus
  };
  return { id: stableId("narrative", value), ...value };
}

export function buildAssuranceSummary({ schemaVersion, recommendation, dimensions, transitionBoundary, gates, domains, actions, humanDecisions, evidence, solution, assessmentIntake, solutionProfile, documentationReadiness, knowledge, cognitive }) {
  const mode = schemaVersion.startsWith("2.") && cognitive?.coverage?.complete ? "COGNITIVE_VERIFIED" : cognitive?.assessmentMode === "DEMO" ? "DEMO" : "DETERMINISTIC_ONLY";
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));
  const locked = cognitive?.lockedFindings ?? [];
  const evidenceIdsByFinding = new Map();
  for (const item of evidence) {
    const findingId = item.metadata?.lockedFindingId;
    if (findingId) evidenceIdsByFinding.set(findingId, [...(evidenceIdsByFinding.get(findingId) ?? []), item.id]);
  }
  const strengths = mode === "COGNITIVE_VERIFIED"
    ? locked.filter((item) => item.findingType === "CONTROL_SUPPORT" && item.strength === "SUPPORTED").map((item) => narrativeItem("CONFIRMED_STRENGTH", item.statement, {
      findingIds: [item.id], controlIds: item.controlIds, evidenceIds: evidenceIdsByFinding.get(item.id) ?? []
    }, "FACT_CHECKED"))
    : [];
  const blockers = mode === "COGNITIVE_VERIFIED"
    ? locked.filter((item) => BLOCKING_FINDING_TYPES.has(item.findingType)).map((item) => narrativeItem("BLOCKING_FINDING", item.statement, {
      findingIds: [item.id], controlIds: item.controlIds
    }, item.strength))
    : domains.flatMap((domain) => domain.gaps).map((gap) => narrativeItem("AUTOMATED_INDICATOR", gap.description, {
      findingIds: [gap.id], controlIds: [gap.controlId], evidenceIds: gap.evidenceIds
    }, "COGNITIVE_VERIFICATION_NOT_RUN"));

  const gateRows = gates.map((item) => ({
    id: item.id, code: item.code, title: item.title, state: item.outcome, rationale: item.rationale, basisStatus: item.basisStatus,
    availableEvidence: item.evidenceIds.map((id) => evidenceById.get(id)).filter(Boolean).slice(0, 3).map((entry) => ({ id: entry.id, path: entry.path, evidenceClass: evidenceClass(entry, mode), assuranceState: entry.assuranceState })),
    clearanceCriteria: item.clearanceCriteria,
    requiredEvidenceKinds: item.requiredEvidenceKinds,
    requiredHumanAuthorities: item.requiredHumanAuthorities,
    controlIds: item.controlIds,
    requirementIds: item.requirementIds
  }));

  const domainSummaries = domains.map((domain) => ({
    id: domain.id,
    title: DOMAINS[domain.id],
    status: domainStatus(domain, gates),
    controlsMet: domain.controls.filter((item) => item.state !== "NOT_APPLICABLE" && item.meetsTarget).length,
    applicableControls: domain.controls.filter((item) => item.state !== "NOT_APPLICABLE").length,
    verifiedFindingIds: mode === "COGNITIVE_VERIFIED" ? locked.filter((item) => item.domains.includes(domain.id) && item.strength === "SUPPORTED").map((item) => item.id) : [],
    gapIds: domain.gaps.map((item) => item.id),
    unknownCount: domain.controls.filter((item) => item.state === "UNKNOWN").length,
    narrative: cognitive?.narrative?.items?.find((item) => item.section === "DOMAIN_NARRATIVE" && item.domain === domain.id)?.text ?? deterministicDomainNarrative(domain)
  }));

  const narrativeItems = cognitive?.narrative?.items ?? [
    narrativeItem("EXECUTIVE_DECISION", `${recommendation.outcome}. ${recommendation.rationale}`, { gateIds: gates.map((item) => item.id) })
  ];
  const limitations = unique([
    ...(solution.limitations ?? []),
    ...(mode === "DETERMINISTIC_ONLY" ? ["Automated indicators have not passed the cognitive claim-verification pipeline and are not confirmed findings."] : []),
    ...(knowledge.releaseStatus !== "APPROVED" ? [`The assessment uses ${knowledge.releaseStatus ?? "UNSPECIFIED"} knowledge rather than an approved production normative mapping.`] : []),
    ...(cognitive?.coverage && !cognitive.coverage.complete ? [`Cognitive assessment incomplete: ${cognitive.coverage.failedStages.join(", ")}.`] : [])
  ]);

  return {
    version: "assurance-summary-1.2.0",
    assessmentMode: mode,
    decision: recommendation,
    dimensions,
    caseProfile: caseProfileView(assessmentIntake, solutionProfile),
    documentationAlignment: documentationReadiness,
    transitionBoundary,
    evidenceInterpretation: [
      { evidenceClass: "DECLARED", title: "Declared", description: "An unverified submitted assertion that requires corroboration where the control demands it." },
      { evidenceClass: "OBSERVED", title: "Observed", description: "A fact mechanically located at a stable source position; observation alone does not establish semantic sufficiency." },
      { evidenceClass: "INFERRED", title: "Inferred", description: "A labelled interpretation that cannot establish control assurance by itself." },
      { evidenceClass: "UNKNOWN", title: "Unknown", description: "Required evidence is unavailable or insufficient; silence is not treated as absence." }
    ],
    gateRows,
    domainSummaries,
    strengths,
    blockingFindings: blockers,
    executiveGapGroups: executiveGapGroups(domains, documentationReadiness, assessmentIntake.sourceIngestion),
    actionAvailability: actions.length ? { status: "APPROVED_ACTIONS_AVAILABLE", count: actions.length, message: `${actions.length} approved action pattern(s) are linked to findings.` } : {
      status: domains.some((item) => item.gaps.length) ? "NO_APPROVED_TACTIC_AVAILABLE" : "NO_ACTION_REQUIRED",
      count: 0,
      message: domains.some((item) => item.gaps.length) ? "Findings exist, but no exact approved tactic is available. Pilot tactics are not presented as authorized remediation." : "No playbook action is required for the declared transition."
    },
    actions,
    humanAuthority: {
      boundary: recommendation.boundary,
      formalDecisionStatus: "FORMAL_DECISION_PENDING",
      requirements: humanDecisions
    },
    narrativeItems,
    auditReference: { evidenceCount: evidence.length, canonicalJsonPath: "$.evidence", evidenceIncludedInExecutiveExports: false },
    limitations,
    knowledgeNotice: knowledge.releaseStatus !== "APPROVED" ? `${knowledge.releaseStatus ?? "UNSPECIFIED"} KNOWLEDGE — NOT AN APPROVED PRODUCTION NORMATIVE MAPPING` : null
  };
}
