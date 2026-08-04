export const ANTIPATTERNS = Object.freeze([
  { id: "AP-A-01", domain: "A", title: "Undefined or drifting intended purpose", severity: "HIGH", signal: "undefined-purpose", relatedControlIds: ["CTRL-A-01"] },
  { id: "AP-A-02", domain: "A", title: "Prototype silently becoming production", severity: "CRITICAL", signal: "prototype-production-drift", relatedControlIds: ["CTRL-A-01", "CTRL-A-02"] },
  { id: "AP-B-01", domain: "B", title: "Production or personal data used without an approved basis", severity: "CRITICAL", signal: "unapproved-sensitive-data", relatedControlIds: ["CTRL-B-01", "CTRL-B-02"] },
  { id: "AP-B-02", domain: "B", title: "Sensitive data sent to an unreviewed provider", severity: "CRITICAL", signal: "sensitive-provider-transfer", relatedControlIds: ["CTRL-B-02", "CTRL-C-02"] },
  { id: "AP-B-03", domain: "B", title: "Unknown retention or deletion behavior", severity: "HIGH", signal: "unknown-retention", relatedControlIds: ["CTRL-B-01"] },
  { id: "AP-C-01", domain: "C", title: "Untracked model, provider, or dependency change", severity: "HIGH", signal: "untracked-component", relatedControlIds: ["CTRL-C-01", "CTRL-F-03"] },
  { id: "AP-C-02", domain: "C", title: "Agent has unrestricted or excessive tool authority", severity: "CRITICAL", signal: "excessive-agency", relatedControlIds: ["CTRL-C-03", "CTRL-E-03"] },
  { id: "AP-D-01", domain: "D", title: "Production credentials or unrestricted network access in experimentation", severity: "CRITICAL", signal: "unsafe-experiment-boundary", relatedControlIds: ["CTRL-D-01"] },
  { id: "AP-D-02", domain: "D", title: "No adversarial or misuse evaluation", severity: "HIGH", signal: "missing-adversarial-evaluation", relatedControlIds: ["CTRL-D-01", "CTRL-D-02"] },
  { id: "AP-D-03", domain: "D", title: "No rollback, safe shutdown, or recovery path", severity: "HIGH", signal: "missing-failsafe", relatedControlIds: ["CTRL-D-03"] },
  { id: "AP-E-01", domain: "E", title: "Human oversight exists only nominally", severity: "CRITICAL", signal: "rubber-stamp-oversight", relatedControlIds: ["CTRL-E-03"] },
  { id: "AP-E-02", domain: "E", title: "AI interaction or synthetic output is hidden", severity: "HIGH", signal: "missing-transparency", relatedControlIds: ["CTRL-E-02"] },
  { id: "AP-E-03", domain: "E", title: "Aggregate performance conceals affected-group failures", severity: "HIGH", signal: "aggregate-bias-blindness", relatedControlIds: ["CTRL-E-01", "CTRL-D-02"] },
  { id: "AP-F-01", domain: "F", title: "Approval or readiness claim without evidence", severity: "CRITICAL", signal: "approval-without-evidence", relatedControlIds: ["CTRL-F-01", "CTRL-F-02"] },
  { id: "AP-F-02", domain: "F", title: "No material-change reassessment", severity: "HIGH", signal: "missing-reassessment", relatedControlIds: ["CTRL-F-03"] }
]);

