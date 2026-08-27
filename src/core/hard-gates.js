import { stableId } from "./hash.js";
import { productionAccessOnExperimentStage } from "../contracts.js";

function gate({ code, outcome, title, rationale, targetStage, basisStatus = "DETERMINISTIC_RULE", evidenceIds = [], authorities = [], clearanceCriteria = [], requiredEvidenceKinds = [], controlIds = [], requirementIds = [] }) {
  const normalized = {
    code,
    outcome,
    title,
    rationale,
    basisStatus,
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

export function evaluateHardGates({ dossier, registryFindings, controlAssessments, applicability, evidence, documentationReadiness = null, sourceIngestion = null, cognitiveCoverage = null }) {
  const gates = [];
  const control = (id) => controlAssessments.find((item) => item.controlId === id);
  const add = (value) => gates.push(gate({ ...value, targetStage: dossier.targetStage }));

  if (dossier.classification.prohibitedPractice) {
    add({
      code: "PROHIBITED_PRACTICE", outcome: "BLOCK", title: "Declared prohibited practice",
      basisStatus: "DECLARED",
      rationale: "Development cannot proceed in the declared form. Legal and Governance review is required before any reformulation.",
      authorities: ["LEGAL", "GOVERNANCE"],
      clearanceCriteria: ["Stop the declared use or reformulate it outside the prohibited-practice condition", "Record an authorized Legal and Governance determination"],
      requiredEvidenceKinds: ["HUMAN_REVIEW"]
    });
  }
  const secretEvidence = registryFindings.filter((item) => ["SECRET_CANDIDATE", "SECRET_MATERIAL"].includes(item.code));
  if (secretEvidence.length) {
    add({
      code: "SECRET_CANDIDATE", outcome: "BLOCK", title: "Potential secret requires verification",
      basisStatus: "DETECTED_CANDIDATE",
      rationale: "A deterministic scanner detected a credential-shaped value. Progression fails safe until Security verifies whether it is real or a synthetic fixture.",
      evidenceIds: secretEvidence.map((item) => item.evidenceId), authorities: ["SECURITY"], controlIds: ["CTRL-D-01"],
      clearanceCriteria: ["Classify the candidate as a verified secret or documented synthetic fixture", "If verified, remove the value and rotate or revoke the affected credential", "Supply a passed follow-up secret scan"],
      requiredEvidenceKinds: ["SCAN_RESULT", "HUMAN_REVIEW"]
    });
  }
  if (productionAccessOnExperimentStage(dossier)) {
    add({
      code: "UNSAFE_EXPERIMENT_BOUNDARY", outcome: "BLOCK", title: "Declared production access conflicts with the experiment boundary",
      basisStatus: "DECLARED",
      rationale: "Qualification and development must not have uncontrolled production access.",
      evidenceIds: evidence.filter((item) => item.signal === "unsafe-experiment-boundary").map((item) => item.id), authorities: ["SECURITY"], controlIds: ["CTRL-D-01"],
      clearanceCriteria: ["Remove production routes and credentials from the experiment", "Demonstrate isolation with a passed boundary test"],
      requiredEvidenceKinds: ["CONFIGURATION", "TEST", "HUMAN_REVIEW"]
    });
  }
  if (dossier.agent.irreversibleActions && !dossier.agent.humanOverride) {
    add({
      code: "IRREVERSIBLE_AUTONOMY", outcome: "BLOCK", title: "Declared irreversible agent actions lack human override",
      basisStatus: "DECLARED",
      rationale: "Prompt instructions are not an adequate authorization control for irreversible actions.",
      evidenceIds: evidence.filter((item) => item.signal === "excessive-agency").map((item) => item.id), authorities: ["SECURITY", "GOVERNANCE"], controlIds: ["CTRL-C-03", "CTRL-E-03"],
      clearanceCriteria: ["Require attributable human confirmation before irreversible actions", "Pass negative authorization and kill-switch tests"],
      requiredEvidenceKinds: ["CONFIGURATION", "TEST", "HUMAN_REVIEW"]
    });
  }
  if ((dossier.data.personalData || dossier.data.specialCategoryData) && !["HUMAN_VALIDATED", "FORMALLY_APPROVED"].includes(control("CTRL-B-02")?.state)) {
    add({
      code: "PRIVACY_REVIEW_REQUIRED", outcome: dossier.data.productionData ? "BLOCK" : "REVIEW", title: "Declared personal-data use lacks human validation",
      basisStatus: "DECLARED",
      rationale: "Code and declarations cannot establish a lawful basis or complete a DPIA decision.",
      evidenceIds: control("CTRL-B-02")?.evidenceIds ?? [], authorities: ["PRIVACY"], controlIds: ["CTRL-B-02"], requirementIds: ["REQ-B-002"],
      clearanceCriteria: ["Record the applicable processing basis and purpose", "Complete the required DPIA screen and Privacy review"],
      requiredEvidenceKinds: ["DOCUMENT", "HUMAN_REVIEW"]
    });
  }
  if (dossier.classification.highRiskCandidate && !["HUMAN_VALIDATED", "FORMALLY_APPROVED"].includes(control("CTRL-A-02")?.state)) {
    add({
      code: "HIGH_RISK_CLASSIFICATION_REVIEW", outcome: "REVIEW", title: "Declared high-risk candidate requires classification review",
      basisStatus: "DECLARED",
      rationale: "The engine preserves this as a Legal decision rather than making a binding classification.",
      evidenceIds: control("CTRL-A-02")?.evidenceIds ?? [], authorities: ["LEGAL", "GOVERNANCE"], controlIds: ["CTRL-A-02"], requirementIds: ["REQ-A-002"],
      clearanceCriteria: ["Record provider/deployer roles and the case-specific classification", "Resolve every material classification uncertainty through authorized review"],
      requiredEvidenceKinds: ["DOCUMENT", "HUMAN_REVIEW"]
    });
  }
  for (const item of applicability.filter((entry) => entry.needsHumanReview)) {
    add({
      code: `APPLICABILITY_${item.requirementId}`, outcome: "REVIEW", title: `${item.requirementId}: binding requirement applicability is unresolved`, rationale: item.reason,
      basisStatus: "UNKNOWN",
      authorities: [item.humanAuthority], requirementIds: [item.requirementId],
      clearanceCriteria: ["Record an authorized applicability interpretation and its effective scope"], requiredEvidenceKinds: ["HUMAN_REVIEW"]
    });
  }
  if (documentationReadiness?.gateRequired) {
    add({
      code: "DOCUMENTATION_ALIGNMENT_REQUIRED", outcome: "BLOCK", title: "Assessment intake is not documented and aligned",
      rationale: "Deployment requires the complete applicable assessment intake to be documented, confirmed, and consistent with the assessed implementation.",
      authorities: ["SOLUTION_OWNER", "GOVERNANCE"],
      clearanceCriteria: ["Document every applicable assessment-intake field", "Include the deployment implementation code or configuration in the assessed source scope", "Resolve documentation-to-code contradictions", "Confirm the updated case profile and reassess the deployment candidate"],
      requiredEvidenceKinds: ["DOCUMENT", "CONFIGURATION", "HUMAN_REVIEW"]
    });
  }
  if (documentationReadiness?.selfDeclarationGateRequired) {
    add({
      code: "SELF_DECLARED_INTAKE_BOUNDARY", outcome: "BLOCK", title: "Self-declared Intake limits lifecycle progression",
      basisStatus: "SELF_DECLARED",
      rationale: "Self-declared Intake information may support work through Verification and Validation, but progression beyond that stage requires source-supported or authorized human-classified information.",
      authorities: ["SOLUTION_OWNER", "GOVERNANCE"],
      clearanceCriteria: ["Provide documentary support for every self-declared Intake field", "Verify the updated Intake and reassess the same solution boundary"],
      requiredEvidenceKinds: ["DOCUMENT", "HUMAN_REVIEW"]
    });
  }
  if (documentationReadiness?.sourceCoverageReviewRequired) {
    const deploymentTarget = ["DEPLOYMENT", "OPERATION_AND_MONITORING", "REVIEW_AND_EVALUATION", "RETIREMENT"].includes(dossier.targetStage);
    const risky = sourceIngestion?.items?.filter((item) => ["UNSUPPORTED_SOURCE_LIKE", "PARSE_FAILED", "REJECTED_UNSAFE"].includes(item.disposition)) ?? [];
    add({
      code: "SOURCE_COVERAGE_INCOMPLETE", outcome: deploymentTarget ? "BLOCK" : "REVIEW", title: "Submitted source coverage is incomplete",
      basisStatus: "DETECTED_CANDIDATE",
      rationale: `${risky.length} selected source file(s) could not be assessed. Known build, dependency and binary exclusions are not counted as governance blind spots.`,
      authorities: ["SOLUTION_OWNER", "GOVERNANCE"],
      clearanceCriteria: ["Convert or resubmit every relevant excluded source in a supported inert format", "Alternatively record a scoped, attributable human source-coverage decision with rationale and expiry", "Reassess the same solution boundary"],
      requiredEvidenceKinds: ["DOCUMENT", "HUMAN_REVIEW"]
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
