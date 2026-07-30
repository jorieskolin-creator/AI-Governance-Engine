import { newId } from "./hash.js";

const CONTROL_SIGNAL_OVERRIDES = {
  "CTRL-A-02": "classification-unknown",
  "CTRL-B-01": "data-flow-gap",
  "CTRL-B-02": "privacy-evidence-gap",
  "CTRL-C-03": "excessive-agency",
  "CTRL-D-02": "evaluation-evidence-gap",
  "CTRL-D-03": "missing-failsafe",
  "CTRL-F-03": "lifecycle-evidence-gap"
};

export function selectPlaybookActions(tactics, domains, antiPatternAssessments, dossier) {
  const findings = [
    ...domains.flatMap((domain) => domain.gaps.map((gap) => ({ id: gap.id, domain: gap.domain, severity: gap.severity, signal: CONTROL_SIGNAL_OVERRIDES[gap.controlId] ?? gap.signal, title: gap.title, evidenceIds: gap.evidenceIds }))),
    ...antiPatternAssessments.filter((item) => item.state === "CONFIRMED_PRESENT").map((item) => ({ id: item.id, domain: item.domain, severity: item.severity, signal: item.antiPatternId === "AP-D-01" ? "unsafe-experiment-boundary" : item.antiPatternId === "AP-B-01" ? "unapproved-sensitive-data" : item.antiPatternId === "AP-C-02" ? "excessive-agency" : "", title: item.title, evidenceIds: item.evidenceIds }))
  ];
  const selected = new Map();
  for (const finding of findings) {
    const tactic = tactics.find((item) => item.findingSignals.includes(finding.signal) && item.domains.includes(finding.domain))
      ?? tactics.find((item) => item.domains.includes(finding.domain) && item.lifecycleStages.includes(dossier.targetStage));
    if (!tactic) continue;
    const existing = selected.get(tactic.id);
    if (existing) {
      existing.lockedFindingIds.push(finding.id);
      existing.evidenceIds.push(...finding.evidenceIds);
      continue;
    }
    selected.set(tactic.id, {
      id: newId("action"), tacticId: tactic.id, tacticVersion: tactic.version, title: tactic.title,
      state: "CANDIDATE_ACTION", lockedFindingIds: [finding.id], evidenceIds: [...finding.evidenceIds],
      activationReason: finding.title, ownerRoles: tactic.ownerRoles, activities: tactic.activities,
      requiredArtifacts: tactic.requiredArtifacts, acceptanceCriteria: tactic.acceptanceCriteria,
      verification: tactic.verification, blocksTransition: tactic.blocksTransition, completionEffect: tactic.completionEffect,
      warning: "Selecting this action does not close a finding. New evidence and reassessment are required."
    });
  }
  return [...selected.values()].map((item) => ({ ...item, lockedFindingIds: [...new Set(item.lockedFindingIds)], evidenceIds: [...new Set(item.evidenceIds)] }));
}

