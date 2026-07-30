import { DOMAINS } from "../contracts.js";
import { stableId } from "./hash.js";

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

export function buildTransitionBoundary({ dossier, gates, domains, readiness, humanDecisions }) {
  const status = boundaryStatus(readiness, gates);
  const configured = dossier.operatingBoundary;
  const permittedUses = (configured.allowedUses.length ? configured.allowedUses : [
    "Continue only within the declared intended purpose and current lifecycle-stage boundary."
  ]).map((statement) => boundaryItem(statement, basis({ ruleIds: ["RULE-BOUNDARY-DECLARED-PURPOSE"] })));

  if (configured.environment !== "UNKNOWN") {
    permittedUses.push(boundaryItem(`Operating environment: ${label(configured.environment)}.`, basis({ ruleIds: ["RULE-BOUNDARY-ENVIRONMENT"] })));
  }
  for (const [key, title] of [
    ["userScope", "User scope"], ["dataScope", "Data scope"], ["integrationScope", "Integration scope"],
    ["permissionScope", "Permission scope"], ["autonomyScope", "Autonomy scope"], ["monitoringOwner", "Monitoring owner"], ["expiresAt", "Boundary expiry"]
  ]) {
    if (configured[key]) permittedUses.push(boundaryItem(`${title}: ${configured[key]}.`, basis({ ruleIds: [`RULE-BOUNDARY-${key.replace(/[A-Z]/g, (letter) => `-${letter}`).toUpperCase()}`] })));
  }

  const prohibitedUses = configured.excludedUses.map((statement) => boundaryItem(statement, basis({ ruleIds: ["RULE-BOUNDARY-DECLARED-EXCLUSION"] })));
  for (const gate of gates.filter((item) => item.outcome === "BLOCK")) {
    prohibitedUses.push(boundaryItem(`Do not progress while ${gate.title.toLowerCase()} remains unresolved.`, basis({
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
    conditions.push(boundaryItem(`Declare the ${label(key)} before relying on this operating boundary.`, basis({ ruleIds: ["RULE-BOUNDARY-MISSING-DECLARATION"] })));
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
      environment: configured.environment,
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

function domainStatus(domain) {
  const confirmed = domain.antiPatterns.filter((item) => ["CONFIRMED_PRESENT", "PARTIALLY_PRESENT"].includes(item.state));
  if (confirmed.some((item) => item.severity === "CRITICAL") || domain.gaps.some((item) => item.severity === "CRITICAL")) return "BLOCKED";
  if (domain.gaps.some((item) => item.humanReviewRequired)) return "HUMAN_REVIEW";
  if (domain.gaps.some((item) => item.severity === "HIGH")) return "REMEDIATE";
  if (domain.controls.some((item) => item.state === "UNKNOWN")) return "UNKNOWN";
  if (domain.gaps.length || confirmed.length) return "CONDITIONAL";
  return "READY";
}

function evidenceClass(item, mode) {
  if (item.sourceId === "dossier" || item.kind === "DECLARATION") return "DECLARED";
  if (mode === "COGNITIVE_VERIFIED" && item.metadata?.lockedFindingId) return "OBSERVED";
  if (mode === "DEMO") return "SIMULATED";
  return "AUTOMATED_INDICATOR";
}

function evidenceDigest(evidence, mode) {
  return evidence.slice(0, 24).map((item) => ({
    id: item.id,
    evidenceClass: evidenceClass(item, mode),
    path: item.path,
    kind: item.kind,
    assuranceState: item.assuranceState,
    polarity: item.polarity,
    controlIds: item.controlIds,
    domainIds: item.domainIds,
    summary: item.excerpt?.slice(0, 220) ?? "Evidence reference available."
  }));
}

function narrativeItem(section, text, references = {}, supportStatus = "DETERMINISTIC") {
  const value = {
    section,
    text,
    findingIds: unique(references.findingIds ?? []),
    gateIds: unique(references.gateIds ?? []),
    controlIds: unique(references.controlIds ?? []),
    evidenceIds: unique(references.evidenceIds ?? []),
    supportStatus
  };
  return { id: stableId("narrative", value), ...value };
}

export function buildAssuranceSummary({ schemaVersion, recommendation, dimensions, transitionBoundary, gates, domains, actions, humanDecisions, evidence, solution, knowledge, cognitive }) {
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
    id: item.id, code: item.code, title: item.title, state: item.outcome, rationale: item.rationale,
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
    status: domainStatus(domain),
    controlsMet: domain.controls.filter((item) => item.state !== "NOT_APPLICABLE" && item.meetsTarget).length,
    applicableControls: domain.controls.filter((item) => item.state !== "NOT_APPLICABLE").length,
    verifiedFindingIds: mode === "COGNITIVE_VERIFIED" ? locked.filter((item) => item.domains.includes(domain.id) && item.strength === "SUPPORTED").map((item) => item.id) : [],
    gapIds: domain.gaps.map((item) => item.id),
    unknownCount: domain.controls.filter((item) => item.state === "UNKNOWN").length,
    narrative: cognitive?.narrative?.items?.find((item) => item.section === "DOMAIN_NARRATIVE" && item.domain === domain.id)?.text ?? null
  }));

  const narrativeItems = cognitive?.narrative?.items ?? [
    narrativeItem("EXECUTIVE_DECISION", `${recommendation.outcome}. ${recommendation.rationale}`, { gateIds: gates.map((item) => item.id) })
  ];
  const limitations = unique([
    ...(solution.limitations ?? []),
    ...(mode === "DETERMINISTIC_ONLY" ? ["Automated indicators have not passed the cognitive claim-verification pipeline and are not confirmed findings."] : []),
    ...(knowledge.source === "LOCAL_BOOTSTRAP" ? ["The assessment uses pilot bootstrap knowledge rather than an approved production knowledge manifest."] : []),
    ...(cognitive?.coverage && !cognitive.coverage.complete ? [`Cognitive assessment incomplete: ${cognitive.coverage.failedStages.join(", ")}.`] : [])
  ]);

  return {
    version: "assurance-summary-1.0.0",
    assessmentMode: mode,
    decision: recommendation,
    dimensions,
    transitionBoundary,
    evidenceInterpretation: [
      { evidenceClass: "DECLARED", title: "Declared", description: "A dossier assertion that still requires corroboration where the control demands it." },
      { evidenceClass: "OBSERVED", title: "Observed", description: "A source fact independently verified at an exact evidence location." },
      { evidenceClass: "INFERRED", title: "Inferred", description: "A labelled interpretation that cannot establish control assurance by itself." },
      { evidenceClass: "UNKNOWN", title: "Unknown", description: "Required evidence is unavailable or insufficient; silence is not treated as absence." }
    ],
    gateRows,
    domainSummaries,
    strengths,
    blockingFindings: blockers,
    actionAvailability: actions.length ? { status: "APPROVED_ACTIONS_AVAILABLE", count: actions.length, message: `${actions.length} approved action pattern(s) are linked to findings.` } : {
      status: domains.some((item) => item.gaps.length) ? "NO_APPROVED_TACTIC_AVAILABLE" : "NO_ACTION_REQUIRED",
      count: 0,
      message: domains.some((item) => item.gaps.length) ? "Findings exist, but no exact approved tactic is available. Pilot tactics are not presented as authorized remediation." : "No playbook action is required for the declared transition."
    },
    actions,
    humanAuthority: {
      boundary: recommendation.boundary,
      formalDecisionStatus: "PENDING_OR_EXTERNAL",
      requirements: humanDecisions
    },
    narrativeItems,
    evidenceDigest: evidenceDigest(evidence, mode),
    evidenceTotal: evidence.length,
    limitations,
    knowledgeNotice: knowledge.source === "LOCAL_BOOTSTRAP" ? "PILOT KNOWLEDGE — NOT AN APPROVED PRODUCTION NORMATIVE MAPPING" : null
  };
}
