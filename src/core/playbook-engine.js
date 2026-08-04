import { stableId } from "./hash.js";

const unique = (values) => [...new Set(values.filter(Boolean))];

function eligibleIds(tactic) {
  return new Set([...(tactic.eligibleFindingIds ?? []), ...(tactic.findingSignals ?? [])]);
}

export function selectPlaybookActions(tactics, lockedFindings = []) {
  const selected = new Map();
  for (const finding of lockedFindings) {
    const findingDefinitionIds = finding.findingDefinitionIds ?? [];
    if (!findingDefinitionIds.length) continue;
    for (const tactic of tactics) {
      if (tactic.status !== "APPROVED") continue;
      const eligible = eligibleIds(tactic);
      const matchedFindingDefinitionIds = findingDefinitionIds.filter((id) => eligible.has(id));
      if (!matchedFindingDefinitionIds.length) continue;
      const existing = selected.get(tactic.id);
      if (existing) {
        existing.lockedFindingIds.push(finding.id);
        existing.findingDefinitionIds.push(...matchedFindingDefinitionIds);
        existing.evidenceIds.push(...(finding.evidenceLinks ?? []).map((item) => item.id));
        continue;
      }
      selected.set(tactic.id, {
        id: stableId("action", { tacticId: tactic.id, findingId: finding.id, findingDefinitionIds: matchedFindingDefinitionIds }),
        tacticId: tactic.id,
        tacticVersion: tactic.version,
        title: tactic.title,
        state: "CANDIDATE_ACTION",
        lockedFindingIds: [finding.id],
        findingDefinitionIds: matchedFindingDefinitionIds,
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
    evidenceIds: unique(item.evidenceIds)
  }));
}

export function buildActionGroundingRecords(actions, lockedFindings, tactics) {
  const findingMap = new Map(lockedFindings.map((item) => [item.id, item]));
  const tacticMap = new Map(tactics.map((item) => [item.id, item]));
  return actions.map((action) => {
    const tactic = tacticMap.get(action.tacticId);
    const findings = action.lockedFindingIds.map((id) => findingMap.get(id)).filter(Boolean);
    const eligible = eligibleIds(tactic ?? {});
    const exact = findings.length === action.lockedFindingIds.length && findings.every((finding) => finding.findingDefinitionIds?.some((id) => eligible.has(id)));
    const value = {
      actionId: action.id,
      tacticId: action.tacticId,
      tacticVersion: action.tacticVersion,
      lockedFindingIds: action.lockedFindingIds,
      findingDefinitionIds: action.findingDefinitionIds,
      requiredEvidence: action.requiredArtifacts,
      acceptanceCriteria: action.acceptanceCriteria,
      verificationMethod: action.verification,
      status: tactic?.status === "APPROVED" && exact ? "GROUNDED" : "QUARANTINED",
      reason: !tactic ? "TACTIC_NOT_FOUND" : tactic.status !== "APPROVED" ? "TACTIC_NOT_APPROVED" : !exact ? "EXACT_FINDING_MAPPING_MISSING" : "EXACT_APPROVED_MAPPING"
    };
    return { id: stableId("action-grounding", value), ...value };
  });
}
