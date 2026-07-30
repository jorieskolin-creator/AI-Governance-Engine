import { STATE_WEIGHT } from "../contracts.js";

const severityRank = { INFO: 0, LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };

export function calculateReadiness(controlAssessments, antiPatternAssessments, gates) {
  const applicable = controlAssessments.filter((item) => item.state !== "NOT_APPLICABLE");
  const evidenced = applicable.filter((item) => item.state !== "UNKNOWN");
  const coverage = Math.round((evidenced.length / Math.max(1, applicable.length)) * 100);
  const assurance = Math.round((applicable.reduce((sum, item) => sum + (STATE_WEIGHT[item.state] ?? 0), 0) / Math.max(1, applicable.length)) * 100);
  const activeRisks = antiPatternAssessments.filter((item) => item.state === "CONFIRMED_PRESENT" || item.state === "PARTIALLY_PRESENT");
  const gaps = applicable.map((item) => item.gap).filter(Boolean);
  const maxSeverity = Math.max(0, ...activeRisks.map((item) => severityRank[item.severity]), ...gaps.map((item) => severityRank[item.severity]));
  const residualRisk = ["LOW", "LOW", "MEDIUM", "HIGH", "CRITICAL"][maxSeverity];
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
      evidenceCoverage: coverage,
      controlAssurance: assurance,
      residualRisk,
      gateStatus,
      explanation: "Coverage and assurance are diagnostic measures only. Gate status and unresolved risk determine progression; scores cannot override a blocker."
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

