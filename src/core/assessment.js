import { ASSURANCE_STATES, DOMAINS, STATE_WEIGHT, lifecycleApplies } from "../contracts.js";
import { stableId } from "./hash.js";

const stateRank = Object.fromEntries(ASSURANCE_STATES.map((state, index) => [state, index]));

function strongestState(artifacts) {
  if (artifacts.length === 0) return "UNKNOWN";
  return artifacts.map((item) => item.assuranceState).sort((a, b) => stateRank[b] - stateRank[a])[0];
}

function requirementStateMap(applicability) {
  return new Map(applicability.map((item) => [item.requirementId, item]));
}

function controlApplicability(control, appMap) {
  const states = control.requirementIds.map((id) => appMap.get(id)?.state ?? "POTENTIALLY_APPLICABLE");
  if (states.every((state) => state === "NOT_APPLICABLE")) return "NOT_APPLICABLE";
  if (states.some((state) => state === "POTENTIALLY_APPLICABLE")) return "POTENTIALLY_APPLICABLE";
  return "APPLICABLE";
}

function controlInScope(control, dossier) {
  return lifecycleApplies(control.lifecycleStages, dossier);
}

export function assessControls(controls, applicability, evidence, dossier, antiPatterns) {
  const appMap = requirementStateMap(applicability);
  return controls.filter((control) => controlInScope(control, dossier)).map((control) => {
    const applicable = controlApplicability(control, appMap);
    const targetState = control.targetStateByLifecycle?.[dossier.targetStage] ?? control.targetState;
    if (applicable === "NOT_APPLICABLE") {
      return { id: stableId("control-assessment", { controlId: control.id, applicable }), controlId: control.id, domain: control.domain, title: control.title, applicability: applicable, state: "NOT_APPLICABLE", targetState, meetsTarget: true, evidenceIds: [], contradictions: [], gap: null };
    }
    const supporting = evidence.filter((item) => item.controlIds.includes(control.id) && item.polarity === "SUPPORT" && !item.stale && item.eligibleForAssurance !== false);
    const risks = evidence.filter((item) => ["RISK", "RISK_PARTIAL"].includes(item.polarity) && (item.controlIds.includes(control.id) || item.antiPatternIds.some((id) => antiPatterns.find((entry) => entry.id === id)?.relatedControlIds.includes(control.id))));
    const state = strongestState(supporting);
    const contradictions = supporting.length && risks.length ? risks.map((item) => item.id) : [];
    const meetsTarget = STATE_WEIGHT[state] >= STATE_WEIGHT[targetState] && contradictions.length === 0;
    const gap = meetsTarget ? null : {
      id: stableId("gap", { controlId: control.id, state, targetState, contradictions }), domain: control.domain, controlId: control.id, title: `${control.title} is not sufficiently established`,
      description: state === "UNKNOWN"
        ? "No acceptable evidence establishes this control. Missing evidence remains unknown, not absent."
        : contradictions.length
          ? `Evidence supports ${state}, but contradictory risk evidence prevents reliance on the control.`
          : `Available evidence establishes ${state}; ${targetState} is required for this lifecycle transition.`,
      severity: control.severity, currentState: state, targetState,
      signal: control.signals[0], evidenceIds: [...supporting, ...risks].map((item) => item.id),
      humanReviewRequired: applicable === "POTENTIALLY_APPLICABLE"
    };
    return {
      id: stableId("control-assessment", { controlId: control.id, applicable, state, contradictions }), controlId: control.id, domain: control.domain, title: control.title,
      applicability: applicable, state, targetState, meetsTarget, evidenceIds: supporting.map((item) => item.id),
      contradictions, gap
    };
  });
}

export function assessAntiPatterns(antiPatterns, evidence, controlAssessments) {
  return antiPatterns.map((antiPattern) => {
    const riskEvidence = evidence.filter((item) => item.antiPatternIds.includes(antiPattern.id) && item.polarity === "RISK");
    const partialRiskEvidence = evidence.filter((item) => item.antiPatternIds.includes(antiPattern.id) && item.polarity === "RISK_PARTIAL");
    const absenceEvidence = evidence.filter((item) => {
      const test = item.metadata?.absenceTest;
      const explicitTest = test?.scope && test?.method && test?.executedAt && test?.systemVersion && /pass|absent|not found|no occurrence/i.test(test?.result ?? "");
      return item.antiPatternIds.includes(antiPattern.id) && item.polarity === "ABSENCE_TEST" && !item.stale && explicitTest && ["TESTED", "OPERATIONALLY_OBSERVED", "HUMAN_VALIDATED", "FORMALLY_APPROVED"].includes(item.assuranceState);
    });
    const relatedControls = controlAssessments.filter((item) => antiPattern.relatedControlIds.includes(item.controlId));
    const lockedRiskEvidence = riskEvidence.filter((item) => item.metadata?.lockedFindingId);
    const declaredRiskEvidence = riskEvidence.filter((item) => item.sourceId === "dossier" || item.evidenceClass === "DECLARED_RISK");
    let state = "UNKNOWN";
    if (lockedRiskEvidence.length) state = "CONFIRMED_PRESENT";
    else if (declaredRiskEvidence.length) state = "DECLARED_RISK";
    else if (riskEvidence.length) state = "DETECTED_CANDIDATE";
    else if (partialRiskEvidence.length) state = "PARTIALLY_PRESENT";
    else if (absenceEvidence.length && relatedControls.every((item) => item.meetsTarget)) state = "TESTED_ABSENT";
    return {
      id: stableId("antipattern-assessment", { antiPatternId: antiPattern.id, state, evidenceIds: ["CONFIRMED_PRESENT", "DECLARED_RISK", "DETECTED_CANDIDATE"].includes(state) ? riskEvidence.map((item) => item.id) : state === "PARTIALLY_PRESENT" ? partialRiskEvidence.map((item) => item.id) : absenceEvidence.map((item) => item.id) }), antiPatternId: antiPattern.id, domain: antiPattern.domain,
      title: antiPattern.title, severity: antiPattern.severity, state,
      evidenceIds: ["CONFIRMED_PRESENT", "DECLARED_RISK", "DETECTED_CANDIDATE"].includes(state) ? riskEvidence.map((item) => item.id) : state === "PARTIALLY_PRESENT" ? partialRiskEvidence.map((item) => item.id) : absenceEvidence.map((item) => item.id),
      reasoning: state === "UNKNOWN"
        ? "No direct finding and no explicit, sufficient absence test. Silence is not treated as tested absence."
        : state === "TESTED_ABSENT"
          ? "An explicit absence test is present and related controls meet their target assurance state."
          : state === "DECLARED_RISK"
            ? "The dossier declares the risk condition; independent verification has not been run."
            : state === "DETECTED_CANDIDATE"
              ? "A deterministic scanner detected a candidate risk; contextual verification is required."
          : state === "PARTIALLY_PRESENT"
            ? "Verified evidence partially supports the failure condition; it is not treated as confirmed presence or tested absence."
            : "Direct dossier or scanner evidence confirms the failure condition."
    };
  });
}

export function groupDomainResults(controlAssessments, antiPatternAssessments) {
  return Object.entries(DOMAINS).map(([id, title]) => {
    const controls = controlAssessments.filter((item) => item.domain === id);
    const antiPatterns = antiPatternAssessments.filter((item) => item.domain === id);
    return {
      id, title, controls, antiPatterns,
      gaps: controls.map((item) => item.gap).filter(Boolean),
      evidenceCoverage: controls.filter((item) => item.state !== "UNKNOWN" && item.state !== "NOT_APPLICABLE").length / Math.max(1, controls.filter((item) => item.state !== "NOT_APPLICABLE").length)
    };
  });
}
