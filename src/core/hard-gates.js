import { stableId } from "./hash.js";

function gate(code, outcome, title, rationale, evidenceIds = [], authorities = []) {
  return { id: stableId("gate", { code, outcome, evidenceIds, authorities }), code, outcome, title, rationale, evidenceIds, requiredHumanAuthorities: authorities };
}

export function evaluateHardGates({ dossier, registryFindings, controlAssessments, applicability, evidence, cognitiveCoverage = null }) {
  const gates = [];
  const control = (id) => controlAssessments.find((item) => item.controlId === id);

  if (dossier.classification.prohibitedPractice) {
    gates.push(gate("PROHIBITED_PRACTICE", "BLOCK", "Declared prohibited practice", "Development cannot proceed in the declared form. Legal and Governance review is required before any reformulation.", [], ["LEGAL", "GOVERNANCE"]));
  }
  const secretEvidence = registryFindings.filter((item) => item.code === "SECRET_MATERIAL");
  if (secretEvidence.length) {
    gates.push(gate("SECRET_MATERIAL", "BLOCK", "Secret material detected", "Remove and rotate exposed credentials before the source packet can be relied upon.", secretEvidence.map((item) => item.evidenceId), ["SECURITY"]));
  }
  if (dossier.exposure.productionAccess && ["QUALIFICATION_AND_REGISTRATION", "DESIGN_AND_DEVELOPMENT"].includes(dossier.currentStage)) {
    gates.push(gate("UNSAFE_EXPERIMENT_BOUNDARY", "BLOCK", "Production access inside an experiment boundary", "Qualification and development must not have uncontrolled production access.", evidence.filter((item) => item.signal === "unsafe-experiment-boundary").map((item) => item.id), ["SECURITY"]));
  }
  if (dossier.agent.irreversibleActions && !dossier.agent.humanOverride) {
    gates.push(gate("IRREVERSIBLE_AUTONOMY", "BLOCK", "Irreversible agent actions lack human override", "Prompt instructions are not an adequate authorization control for irreversible actions.", evidence.filter((item) => item.signal === "excessive-agency").map((item) => item.id), ["SECURITY", "GOVERNANCE"]));
  }
  if ((dossier.data.personalData || dossier.data.specialCategoryData) && control("CTRL-B-02")?.state !== "HUMAN_VALIDATED" && control("CTRL-B-02")?.state !== "FORMALLY_APPROVED") {
    gates.push(gate("PRIVACY_REVIEW_REQUIRED", dossier.data.productionData ? "BLOCK" : "REVIEW", "Personal-data basis is not human validated", "Code and declarations cannot establish a lawful basis or complete a DPIA decision.", control("CTRL-B-02")?.evidenceIds ?? [], ["PRIVACY"]));
  }
  if (dossier.classification.highRiskCandidate && !["HUMAN_VALIDATED", "FORMALLY_APPROVED"].includes(control("CTRL-A-02")?.state)) {
    gates.push(gate("HIGH_RISK_CLASSIFICATION_REVIEW", "REVIEW", "High-risk candidate requires classification review", "The engine preserves this as a Legal decision rather than making a binding classification.", control("CTRL-A-02")?.evidenceIds ?? [], ["LEGAL", "GOVERNANCE"]));
  }
  for (const item of applicability.filter((entry) => entry.needsHumanReview)) {
    gates.push(gate(`APPLICABILITY_${item.requirementId}`, "REVIEW", "Binding requirement applicability is unresolved", item.reason, [], [item.humanAuthority]));
  }
  if (dossier.targetStage === "DEPLOYMENT") {
    const missingCritical = controlAssessments.filter((item) => item.gap?.severity === "CRITICAL");
    if (missingCritical.length) gates.push(gate("CRITICAL_DEPLOYMENT_CONTROLS", "BLOCK", "Critical deployment controls are not established", "Critical controls cannot be averaged away by otherwise high readiness.", missingCritical.flatMap((item) => item.gap.evidenceIds), ["SECURITY", "GOVERNANCE"]));
    gates.push(gate("HUMAN_DEPLOYMENT_DECISION", "REVIEW", "Deployment requires a human decision", "The readiness package is decision support; it cannot issue formal deployment approval.", [], [dossier.classification.highRiskCandidate ? "AI_BOARD" : "AI_FORUM"]));
  }
  if (cognitiveCoverage?.required && !cognitiveCoverage.complete) {
    const failed = cognitiveCoverage.failedStages?.join(", ") || "required cognitive stages";
    gates.push(gate(
      "COGNITIVE_ASSESSMENT_INCOMPLETE",
      dossier.targetStage === "DEPLOYMENT" ? "BLOCK" : "REVIEW",
      "Cognitive assessment is incomplete",
      `The evidence-gated assessment did not complete: ${failed}. Missing or failed analysis cannot be treated as evidence of readiness.`,
      [],
      ["GOVERNANCE"]
    ));
  }
  return gates;
}
