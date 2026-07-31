import { STATE_WEIGHT } from "../contracts.js";

const severityRank = { INFO: 0, LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };

export function calculateReadiness(controlAssessments, antiPatternAssessments, gates, evidence = [], documentationReadiness = null) {
  const applicable = controlAssessments.filter((item) => item.state !== "NOT_APPLICABLE");
  const evidenced = applicable.filter((item) => item.state !== "UNKNOWN");
  const coverage = Math.round((evidenced.length / Math.max(1, applicable.length)) * 100);
  const indicatorControls = new Set(evidence.filter((item) => !item.stale).flatMap((item) => item.controlIds ?? []));
  const verifiedControls = new Set(evidence.filter((item) => !item.stale && item.metadata?.lockedFindingId).flatMap((item) => item.controlIds ?? []));
  const indicatorCoverage = Math.round((applicable.filter((item) => indicatorControls.has(item.controlId)).length / Math.max(1, applicable.length)) * 100);
  const verifiedEvidenceCoverage = Math.round((applicable.filter((item) => verifiedControls.has(item.controlId)).length / Math.max(1, applicable.length)) * 100);
  const assessmentCoverage = Math.round((applicable.length / Math.max(1, applicable.length)) * 100);
  const assurance = Math.round((applicable.reduce((sum, item) => sum + (STATE_WEIGHT[item.state] ?? 0), 0) / Math.max(1, applicable.length)) * 100);
  const activeRisks = antiPatternAssessments.filter((item) => ["CONFIRMED_PRESENT", "DECLARED_RISK", "DETECTED_CANDIDATE", "VERIFICATION_REQUIRED", "PARTIALLY_PRESENT"].includes(item.state));
  const gaps = applicable.map((item) => item.gap).filter(Boolean);
  const assuranceDeficitRank = Math.max(0, ...gaps.map((item) => severityRank[item.severity]));
  const riskCandidateRank = Math.max(0, ...activeRisks.map((item) => severityRank[item.severity]));
  const assuranceDeficit = gaps.length ? ["LOW", "LOW", "MEDIUM", "HIGH", "CRITICAL"][assuranceDeficitRank] : "NONE";
  const riskDetermination = activeRisks.length ? `POTENTIAL_${["LOW", "LOW", "MEDIUM", "HIGH", "CRITICAL"][riskCandidateRank]}` : "NO_VERIFIED_RISK_FINDING";
  const residualRisk = "NOT_DETERMINED";
  const riskDrivers = [
    ...(documentationReadiness?.contradictions ?? []).map((item) => ({
      id: item.id,
      type: "DOCUMENTATION_CONTRADICTION",
      title: item.statement,
      severity: item.severity ?? "HIGH",
      basisStatus: "CONFLICTING",
      domain: null,
      controlIds: [],
      findingIds: [item.id],
      ruleIds: item.ruleId ? [item.ruleId] : []
    })),
    ...activeRisks.map((item) => ({ id: item.id, type: "ANTIPATTERN", title: item.title, severity: item.severity, basisStatus: item.state, domain: item.domain, findingIds: [item.id], controlIds: [] })),
    ...gaps.map((item) => ({ id: item.id, type: "CONTROL_GAP", title: item.title, severity: item.severity, basisStatus: item.currentState === "UNKNOWN" ? "UNKNOWN" : "DECLARED_OR_OBSERVED_BELOW_TARGET", domain: item.domain, findingIds: [item.id], controlIds: [item.controlId] }))
  ].sort((a, b) => severityRank[b.severity] - severityRank[a.severity] || a.title.localeCompare(b.title)).slice(0, 3);
  const gateStatus = gates.some((item) => item.outcome === "BLOCK") ? "BLOCK" : gates.some((item) => item.outcome === "REVIEW") ? "HUMAN_REVIEW" : gates.length ? "WARN" : "CLEAR";

  let outcome;
  if (gateStatus === "BLOCK") outcome = "BLOCKED_IN_CURRENT_FORM";
  else if (gateStatus === "HUMAN_REVIEW") outcome = "HUMAN_REVIEW_REQUIRED";
  else if (gaps.some((item) => item.severity === "CRITICAL" || item.severity === "HIGH")) outcome = "REMEDIATE_BEFORE_NEXT_STAGE";
  else if (gaps.length || activeRisks.length) outcome = "READY_WITH_CONDITIONS";
  else outcome = "READY_FOR_NEXT_STAGE";

  return {
    outcome,
    dimensions: {
      indicatorCoverage,
      assessmentCoverage,
      verifiedEvidenceCoverage,
      evidenceCoverage: coverage,
      controlAssurance: assurance,
      documentationAlignment: documentationReadiness?.status ?? "UNKNOWN",
      assuranceDeficit,
      riskDetermination,
      residualRisk,
      riskDrivers,
      gateStatus,
      explanation: "Deterministic control execution, accepted evidence, verified evidence and assurance measures are diagnostic only. Assurance deficit is not residual risk: residual risk remains undetermined until risks, mitigations and remaining exposure are evaluated. Documentation alignment and gates determine progression; scores cannot override a blocker."
    }
  };
}

export function humanDecisionRequirements(gates, applicability, dossier) {
  const map = new Map();
  for (const gate of gates) {
    for (const authority of gate.requiredHumanAuthorities) {
      const item = map.get(authority) ?? { authority, reasons: [], status: "PENDING_HUMAN_DECISION" };
      item.reasons.push(`${gate.code}: ${gate.title}`);
      map.set(authority, item);
    }
  }
  for (const item of applicability.filter((entry) => entry.needsHumanReview)) {
    const decision = map.get(item.humanAuthority) ?? { authority: item.humanAuthority, reasons: [], status: "PENDING_HUMAN_DECISION" };
    decision.reasons.push(`${item.requirementId}: applicability requires authorized interpretation`);
    map.set(item.humanAuthority, decision);
  }
  if (dossier.targetStage === "DEPLOYMENT" && !map.has("GOVERNANCE")) {
    map.set("GOVERNANCE", { authority: "GOVERNANCE", reasons: ["Lifecycle progression to deployment requires a recorded human governance decision."], status: "PENDING_HUMAN_DECISION" });
  }
  return [...map.values()].map((item) => ({ ...item, reasons: [...new Set(item.reasons)] }));
}
