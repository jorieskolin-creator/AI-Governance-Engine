import { stableId } from "./hash.js";

const unique = (values) => [...new Set(values.filter(Boolean))];

function mappedObjectIds(tactic) {
  return new Set([...(tactic.assessmentMappings?.capabilities ?? []), ...(tactic.assessmentMappings?.antipatterns ?? [])]);
}

function findingObjectIds(finding) {
  return new Set([...(finding.assessmentObjectIds ?? []), ...(finding.antiPatternIds ?? [])]);
}

export function selectPlaybookActions(tactics, lockedFindings = []) {
  const selected = new Map();
  for (const finding of lockedFindings) {
    const assessmentObjectIds = findingObjectIds(finding);
    if (!assessmentObjectIds.size) continue;
    for (const tactic of tactics) {
      if (tactic.status !== "APPROVED") continue;
      const mapped = mappedObjectIds(tactic);
      const matchedAssessmentObjectIds = [...assessmentObjectIds].filter((id) => mapped.has(id));
      if (!matchedAssessmentObjectIds.length) continue;
      const existing = selected.get(tactic.id);
      if (existing) {
        existing.lockedFindingIds.push(finding.id);
        existing.findingDefinitionIds.push(...(finding.findingDefinitionIds ?? []));
        existing.assessmentObjectIds.push(...matchedAssessmentObjectIds);
        existing.evidenceIds.push(...(finding.evidenceLinks ?? []).map((item) => item.id));
        continue;
      }
      selected.set(tactic.id, {
        id: stableId("action", { tacticId: tactic.id, findingId: finding.id, assessmentObjectIds: matchedAssessmentObjectIds }),
        tacticId: tactic.id,
        tacticVersion: tactic.version,
        title: tactic.title,
        state: "CANDIDATE_ACTION",
        lockedFindingIds: [finding.id],
        findingDefinitionIds: finding.findingDefinitionIds ?? [],
        assessmentObjectIds: matchedAssessmentObjectIds,
        evidenceIds: (finding.evidenceLinks ?? []).map((item) => item.id),
        activationReason: finding.statement,
        ownerRoles: tactic.ownerRoles,
        activities: tactic.activities,
        requiredArtifacts: tactic.requiredArtifacts,
        acceptanceCriteria: tactic.acceptanceCriteria,
        verification: tactic.verification,
        blocksTransition: tactic.blocksTransition,
        completionEffect: tactic.completionEffect,
        warning: "Selecting this action does not close a finding. New evidence and reassessment are required."
      });
    }
  }
  return [...selected.values()].map((item) => ({
    ...item,
    lockedFindingIds: unique(item.lockedFindingIds),
    findingDefinitionIds: unique(item.findingDefinitionIds),
    assessmentObjectIds: unique(item.assessmentObjectIds),
    evidenceIds: unique(item.evidenceIds)
  }));
}

export function buildActionGroundingRecords(actions, lockedFindings, tactics) {
  const findingMap = new Map(lockedFindings.map((item) => [item.id, item]));
  const tacticMap = new Map(tactics.map((item) => [item.id, item]));
  return actions.map((action) => {
    const tactic = tacticMap.get(action.tacticId);
    const findings = action.lockedFindingIds.map((id) => findingMap.get(id)).filter(Boolean);
    const mapped = mappedObjectIds(tactic ?? {});
    const exact = findings.length === action.lockedFindingIds.length && findings.every((finding) => [...findingObjectIds(finding)].some((id) => mapped.has(id)));
    const value = {
      actionId: action.id,
      tacticId: action.tacticId,
      tacticVersion: action.tacticVersion,
      lockedFindingIds: action.lockedFindingIds,
      findingDefinitionIds: action.findingDefinitionIds,
      assessmentObjectIds: action.assessmentObjectIds,
      requiredEvidence: action.requiredArtifacts,
      acceptanceCriteria: action.acceptanceCriteria,
      verificationMethod: action.verification,
      status: tactic?.status === "APPROVED" && exact ? "GROUNDED" : "QUARANTINED",
      reason: !tactic ? "TACTIC_NOT_FOUND" : tactic.status !== "APPROVED" ? "TACTIC_NOT_APPROVED" : !exact ? "PRIMARY_OBJECT_MAPPING_MISSING" : "APPROVED_PRIMARY_OBJECT_MAPPING"
    };
    return { id: stableId("action-grounding", value), ...value };
  });
}
