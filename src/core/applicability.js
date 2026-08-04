import { jurisdictionScope } from "./jurisdictions.js";

const externalAccess = (value) => value && !["UNKNOWN", "INTERNAL_ONLY"].includes(value);

function conditionApplies(condition, dossier) {
  switch (condition) {
    case "ALWAYS": return "APPLICABLE";
    case "EU": return jurisdictionScope(dossier.jurisdictions).euEea ? "POTENTIALLY_APPLICABLE" : "NOT_APPLICABLE";
    case "USES_DATA": return "APPLICABLE";
    case "PERSONAL_DATA": return dossier.data.personalData || dossier.data.specialCategoryData ? "APPLICABLE" : [dossier.data.personalData, dossier.data.specialCategoryData].includes(null) ? "POTENTIALLY_APPLICABLE" : "NOT_APPLICABLE";
    case "THIRD_PARTY_COMPONENTS": return "POTENTIALLY_APPLICABLE";
    case "USES_AGENTS": return dossier.agent.usesAgents === true ? "APPLICABLE" : dossier.agent.usesAgents === null ? "POTENTIALLY_APPLICABLE" : "NOT_APPLICABLE";
    case "PRODUCTION_OR_EXTERNAL": return externalAccess(dossier.exposure.currentUserAccess) || dossier.exposure.productionAccess || dossier.currentStage === "OPERATION_AND_MONITORING" ? "APPLICABLE" : externalAccess(dossier.exposure.intendedUserAccess) || [dossier.exposure.externalUsers, dossier.exposure.productionAccess].includes(null) ? "POTENTIALLY_APPLICABLE" : "NOT_APPLICABLE";
    case "AFFECTS_PEOPLE": return dossier.users.length > 0 ? "APPLICABLE" : "POTENTIALLY_APPLICABLE";
    case "INTERACTS_WITH_PEOPLE": return dossier.users.length > 0 || externalAccess(dossier.exposure.currentUserAccess) || externalAccess(dossier.exposure.intendedUserAccess) ? "POTENTIALLY_APPLICABLE" : dossier.exposure.externalUsers === false ? "NOT_APPLICABLE" : "POTENTIALLY_APPLICABLE";
    default: return "POTENTIALLY_APPLICABLE";
  }
}

export function evaluateApplicability(requirements, dossier, now = new Date()) {
  return requirements.map((requirement) => {
    const euScopedRequirement = ["REQ-A-002", "REQ-B-002", "REQ-E-002"].includes(requirement.id);
    const euInScope = jurisdictionScope(dossier.jurisdictions).euEea;
    const state = euScopedRequirement && !euInScope
      ? "NOT_APPLICABLE"
      : conditionApplies(requirement.applicability, dossier);
    const needsHumanReview = state === "POTENTIALLY_APPLICABLE" && ["BINDING_LAW", "BINDING_LAW_CANDIDATE", "MIXED"].includes(requirement.authority);
    return {
      requirementId: requirement.id,
      state,
      reason: state === "NOT_APPLICABLE"
        ? euScopedRequirement && !euInScope
          ? "No EU/EEA jurisdiction was declared for this EU-scoped bootstrap requirement."
          : `Declared solution context does not activate ${requirement.applicability}.`
        : state === "POTENTIALLY_APPLICABLE"
          ? `The context may activate ${requirement.applicability}; an authorized human must resolve applicability.`
          : `Declared solution context activates ${requirement.applicability}.`,
      needsHumanReview,
      humanAuthority: needsHumanReview ? requirement.humanAuthority : null,
      evaluatedAt: now.toISOString()
    };
  });
}
