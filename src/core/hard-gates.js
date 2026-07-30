import { stableId } from "./hash.js";

function gate({ code, outcome, title, rationale, targetStage, evidenceIds = [], authorities = [], clearanceCriteria = [], requiredEvidenceKinds = [], controlIds = [], requirementIds = [] }) {
  const normalized = {
    code,
    outcome,
    title,
    rationale,
    evidenceIds: [...new Set(evidenceIds)],
    requiredHumanAuthorities: [...new Set(authorities.filter(Boolean))],
    clearanceCriteria: [...new Set(clearanceCriteria)],
    requiredEvidenceKinds: [...new Set(requiredEvidenceKinds)],
    blockedTransition: outcome === "BLOCK" ? targetStage : null,
    reviewRequiredForTransition: outcome === "REVIEW" ? targetStage : null,
    controlIds: [...new Set(controlIds)],
    requirementIds: [...new Set(requirementIds)],
    ruleIds: [`RULE-GATE-${code}`]
  };
  return { id: stableId("gate", normalized), ...normalized };
}

export function evaluateHardGates({ dossier, registryFindings, controlAssessments, applicability, evidence, cognitiveCoverage = null }) {
  const gates = [];
  const control = (id) => controlAssessments.find((item) => item.controlId === id);
  const add = (value) => gates.push(gate({ ...value, targetStage: dossier.targetStage }));

  if (dossier.classification.prohibitedPractice) {
    add({
      code: "PROHIBITED_PRACTICE", outcome: "BLOCK", title: "Declared prohibited practice",
      rationale: "Development cannot proceed in the declared form. Legal and Governance review is required before any reformulation.",
      authorities: ["LEGAL", "GOVERNANCE"],
      clearanceCriteria: ["Stop the declared use or reformulate it outside the prohibited-practice condition", "Record an authorized Legal and Governance determination"],
      requiredEvidenceKinds: ["HUMAN_REVIEW"]
    });
  }
  const secretEvidence = registryFindings.filter((item) => item.code === "SECRET_MATERIAL");
  if (secretEvidence.length) {
    add({
      code: "SECRET_MATERIAL", outcome: "BLOCK", title: "Secret material detected",
      rationale: "Remove and rotate exposed credentials before the source packet can be relied upon.",
      evidenceIds: secretEvidence.map((item) => item.evidenceId), authorities: ["SECURITY"], controlIds: ["CTRL-D-01"],
      clearanceCriteria: ["Remove the exposed value from every submitted and deployed location", "Rotate or revoke the affected credential", "Supply a passed follow-up secret scan"],
      requiredEvidenceKinds: ["SCAN_RESULT", "HUMAN_REVIEW"]
    });
  }
  if (dossier.exposure.productionAccess && ["QUALIFICATION_AND_REGISTRATION", "DESIGN_AND_DEVELOPMENT"].includes(dossier.currentStage)) {
    add({
      code: "UNSAFE_EXPERIMENT_BOUNDARY", outcome: "BLOCK", title: "Production access inside an experiment boundary",
      rationale: "Qualification and development must not have uncontrolled production access.",
      evidenceIds: evidence.filter((item) => item.signal === "unsafe-experiment-boundary").map((item) => item.id), authorities: ["SECURITY"], controlIds: ["CTRL-D-01"],
      clearanceCriteria: ["Remove production routes and credentials from the experiment", "Demonstrate isolation with a passed boundary test"],
      requiredEvidenceKinds: ["CONFIGURATION", "TEST", "HUMAN_REVIEW"]
    });
  }
  if (dossier.agent.irreversibleActions && !dossier.agent.humanOverride) {
    add({
      code: "IRREVERSIBLE_AUTONOMY", outcome: "BLOCK", title: "Irreversible agent actions lack human override",
      rationale: "Prompt instructions are not an adequate authorization control for irreversible actions.",
      evidenceIds: evidence.filter((item) => item.signal === "excessive-agency").map((item) => item.id), authorities: ["SECURITY", "GOVERNANCE"], controlIds: ["CTRL-C-03", "CTRL-E-03"],
      clearanceCriteria: ["Require attributable human confirmation before irreversible actions", "Pass negative authorization and kill-switch tests"],
      requiredEvidenceKinds: ["CONFIGURATION", "TEST", "HUMAN_REVIEW"]
    });
  }
  if ((dossier.data.personalData || dossier.data.specialCategoryData) && !["HUMAN_VALIDATED", "FORMALLY_APPROVED"].includes(control("CTRL-B-02")?.state)) {
    add({
      code: "PRIVACY_REVIEW_REQUIRED", outcome: dossier.data.productionData ? "BLOCK" : "REVIEW", title: "Personal-data basis is not human validated",
      rationale: "Code and declarations cannot establish a lawful basis or complete a DPIA decision.",
      evidenceIds: control("CTRL-B-02")?.evidenceIds ?? [], authorities: ["PRIVACY"], controlIds: ["CTRL-B-02"], requirementIds: ["REQ-B-002"],
      clearanceCriteria: ["Record the applicable processing basis and purpose", "Complete the required DPIA screen and Privacy review"],
      requiredEvidenceKinds: ["DOCUMENT", "HUMAN_REVIEW"]
    });
  }
  if (dossier.classification.highRiskCandidate && !["HUMAN_VALIDATED", "FORMALLY_APPROVED"].includes(control("CTRL-A-02")?.state)) {
    add({
      code: "HIGH_RISK_CLASSIFICATION_REVIEW", outcome: "REVIEW", title: "High-risk candidate requires classification review",
      rationale: "The engine preserves this as a Legal decision rather than making a binding classification.",
      evidenceIds: control("CTRL-A-02")?.evidenceIds ?? [], authorities: ["LEGAL", "GOVERNANCE"], controlIds: ["CTRL-A-02"], requirementIds: ["REQ-A-002"],
      clearanceCriteria: ["Record provider/deployer roles and the case-specific classification", "Resolve every material classification uncertainty through authorized review"],
      requiredEvidenceKinds: ["DOCUMENT", "HUMAN_REVIEW"]
    });
  }
  for (const item of applicability.filter((entry) => entry.needsHumanReview)) {
    add({
      code: `APPLICABILITY_${item.requirementId}`, outcome: "REVIEW", title: "Binding requirement applicability is unresolved", rationale: item.reason,
      authorities: [item.humanAuthority], requirementIds: [item.requirementId],
      clearanceCriteria: ["Record an authorized applicability interpretation and its effective scope"], requiredEvidenceKinds: ["HUMAN_REVIEW"]
    });
  }
  if (dossier.targetStage === "DEPLOYMENT") {
    const missingCritical = controlAssessments.filter((item) => item.gap?.severity === "CRITICAL");
    if (missingCritical.length) {
      add({
        code: "CRITICAL_DEPLOYMENT_CONTROLS", outcome: "BLOCK", title: "Critical deployment controls are not established",
        rationale: "Critical controls cannot be averaged away by otherwise high readiness.",
        evidenceIds: missingCritical.flatMap((item) => item.gap.evidenceIds), authorities: ["SECURITY", "GOVERNANCE"], controlIds: missingCritical.map((item) => item.controlId),
        clearanceCriteria: ["Satisfy or formally route every critical control gap", "Reassess the exact deployment candidate after remediation"],
        requiredEvidenceKinds: ["TEST", "HUMAN_REVIEW"]
      });
    }
    add({
      code: "HUMAN_DEPLOYMENT_DECISION", outcome: "REVIEW", title: "Deployment requires a human decision",
      rationale: "The readiness package is decision support; it cannot issue formal deployment approval.",
      authorities: [dossier.classification.highRiskCandidate ? "AI_BOARD" : "AI_FORUM"],
      clearanceCriteria: ["Record the named decision-maker, decision, scope, conditions, validity and expiry"], requiredEvidenceKinds: ["FORMAL_APPROVAL"]
    });
  }
  if (cognitiveCoverage?.required && !cognitiveCoverage.complete) {
    const failed = cognitiveCoverage.failedStages?.join(", ") || "required cognitive stages";
    add({
      code: "COGNITIVE_ASSESSMENT_INCOMPLETE", outcome: dossier.targetStage === "DEPLOYMENT" ? "BLOCK" : "REVIEW", title: "Cognitive assessment is incomplete",
      rationale: `The evidence-gated assessment did not complete: ${failed}. Missing or failed analysis cannot be treated as evidence of readiness.`,
      authorities: ["GOVERNANCE"], clearanceCriteria: ["Complete the required cognitive stages or record an authorized deterministic-only assessment limitation"],
      requiredEvidenceKinds: ["DOCUMENT", "HUMAN_REVIEW"]
    });
  }
  return gates;
}
