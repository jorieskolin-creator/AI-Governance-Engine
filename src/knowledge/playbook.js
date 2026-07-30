export const TACTICS = Object.freeze([
  {
    id: "GOV-ACT-001", version: "1.0.0", status: "PILOT", title: "Lock intended purpose and progression boundary",
    findingSignals: ["undefined-purpose", "prototype-production-drift"], domains: ["A"], lifecycleStages: ["QUALIFICATION_AND_REGISTRATION", "DESIGN_AND_DEVELOPMENT", "REVIEW_AND_EVALUATION"],
    useWhen: "Purpose, scope, prohibited uses, or the intended next lifecycle transition are not supported by a controlled record.",
    doNotUseWhen: "Do not use to legitimize a prohibited practice.", ownerRoles: ["SOLUTION_OWNER", "GOVERNANCE"],
    activities: ["Define intended purpose, users, affected parties, value measures, allowed uses, excluded uses, and lifecycle boundary.", "Review material changes against the locked purpose."],
    requiredArtifacts: ["Versioned intended-use dossier", "Purpose-change trigger list"],
    acceptanceCriteria: ["Purpose and exclusions are human validated", "The technical boundary matches the declared lifecycle stage"],
    verification: "Independent dossier-to-architecture review", blocksTransition: "VERIFICATION_AND_VALIDATION", completionEffect: "Reassess CTRL-A-01 and CTRL-A-02"
  },
  {
    id: "GOV-ACT-002", version: "1.0.0", status: "PILOT", title: "Complete role and regulatory classification",
    findingSignals: ["classification-unknown", "high-risk-review-required"], domains: ["A", "F"], lifecycleStages: ["QUALIFICATION_AND_REGISTRATION", "VERIFICATION_AND_VALIDATION", "DEPLOYMENT"],
    useWhen: "AI Act role, prohibited/high-risk/transparency category, or applicable jurisdiction is unresolved.",
    doNotUseWhen: "The engine must not make the final legal determination.", ownerRoles: ["LEGAL", "GOVERNANCE"],
    activities: ["Document provider/deployer/value-chain roles.", "Complete the approved classification screen and record unresolved legal questions."],
    requiredArtifacts: ["Provision-level applicability record", "Human classification review"],
    acceptanceCriteria: ["Legal reviewer records the classification or an explicit open question", "Applicable controls are regenerated from the approved classification"],
    verification: "Legal review record", blocksTransition: "DEPLOYMENT", completionEffect: "Resolve human legal decision requirement"
  },
  {
    id: "GOV-ACT-003", version: "1.0.0", status: "PILOT", title: "Establish isolated data and experiment boundary",
    findingSignals: ["unapproved-sensitive-data", "unsafe-experiment-boundary", "sensitive-provider-transfer"], domains: ["B", "D"], lifecycleStages: ["QUALIFICATION_AND_REGISTRATION", "DESIGN_AND_DEVELOPMENT"],
    useWhen: "The prototype can reach production systems, credentials, personal/confidential data, or unreviewed external services.",
    doNotUseWhen: "Stop rather than mitigate a prohibited or deliberately harmful use.", ownerRoles: ["SECURITY", "PRIVACY", "SOLUTION_OWNER"],
    activities: ["Remove production credentials and routes.", "Use synthetic or approved test data.", "Enforce egress, deletion, expiry, and cost limits."],
    requiredArtifacts: ["Sandbox configuration", "Data provenance record", "Isolation test"],
    acceptanceCriteria: ["Production resources are technically unreachable", "Test data and deletion are approved", "Isolation test passes"],
    verification: "Security isolation test and Privacy review", blocksTransition: "DESIGN_AND_DEVELOPMENT", completionEffect: "Allow bounded experimentation only"
  },
  {
    id: "GOV-ACT-004", version: "1.0.0", status: "PILOT", title: "Create data, privacy and retention evidence",
    findingSignals: ["unknown-retention", "privacy-evidence-gap", "data-flow-gap"], domains: ["B"], lifecycleStages: ["DESIGN_AND_DEVELOPMENT", "VERIFICATION_AND_VALIDATION", "DEPLOYMENT"],
    useWhen: "Data flows, basis, minimisation, retention, rights, or DPIA screening are incomplete.",
    doNotUseWhen: "Do not infer a lawful basis from code or a developer declaration.", ownerRoles: ["PRIVACY", "SOLUTION_OWNER"],
    activities: ["Map data flows and purposes.", "Complete lawful-basis and DPIA screens.", "Define retention, deletion, access, and rights handling."],
    requiredArtifacts: ["Data inventory", "Data-flow diagram", "Privacy review", "Retention schedule"],
    acceptanceCriteria: ["Every data flow has purpose, owner, destination and retention", "Privacy authority validates applicable obligations"],
    verification: "Privacy evidence review", blocksTransition: "DEPLOYMENT", completionEffect: "Reassess domain B"
  },
  {
    id: "GOV-ACT-005", version: "1.0.0", status: "PILOT", title: "Bound agent identity, tools and autonomy",
    findingSignals: ["excessive-agency"], domains: ["C", "D", "E"], lifecycleStages: ["DESIGN_AND_DEVELOPMENT", "VERIFICATION_AND_VALIDATION", "DEPLOYMENT"],
    useWhen: "An agent can call tools, delegate, retain memory, or create consequential or irreversible effects.",
    doNotUseWhen: "Do not rely on prompt-only restrictions for privileged actions.", ownerRoles: ["SECURITY", "SOLUTION_OWNER"],
    activities: ["Use distinct agent identity and least privilege.", "Implement tool allowlists, argument validation, approval points, budgets and rate limits.", "Test hijacking, delegation and recovery."],
    requiredArtifacts: ["Agent authority matrix", "Tool allowlist", "Adversarial test results", "Kill-switch test"],
    acceptanceCriteria: ["Irreversible actions require human confirmation", "Denied tools are technically unreachable", "Adversarial tests meet thresholds"],
    verification: "Independent security test", blocksTransition: "DEPLOYMENT", completionEffect: "Reassess CTRL-C-03 and CTRL-E-03"
  },
  {
    id: "GOV-ACT-006", version: "1.0.0", status: "PILOT", title: "Run independent AI security and performance evaluation",
    findingSignals: ["missing-adversarial-evaluation", "evaluation-evidence-gap", "aggregate-bias-blindness"], domains: ["D", "E"], lifecycleStages: ["VERIFICATION_AND_VALIDATION", "DEPLOYMENT", "REVIEW_AND_EVALUATION"],
    useWhen: "Representative safety, quality, robustness, security, or fairness results are absent or below threshold.",
    doNotUseWhen: "Do not average away critical subgroup, security, or safety failures.", ownerRoles: ["SECURITY", "GOVERNANCE"],
    activities: ["Approve representative datasets and thresholds.", "Run repeatable functional, robustness, injection, leakage, misuse and subgroup evaluations.", "Retest remediated failures."],
    requiredArtifacts: ["Evaluation protocol", "Versioned test data", "Raw results", "Failure analysis", "Signed interpretation"],
    acceptanceCriteria: ["Tests are reproducible", "Every critical threshold passes or is explicitly escalated", "A qualified human validates interpretation"],
    verification: "Independent evaluation review", blocksTransition: "DEPLOYMENT", completionEffect: "Reassess CTRL-D-02 and CTRL-E-01"
  },
  {
    id: "GOV-ACT-007", version: "1.0.0", status: "PILOT", title: "Implement meaningful oversight and transparency",
    findingSignals: ["rubber-stamp-oversight", "missing-transparency"], domains: ["E"], lifecycleStages: ["VERIFICATION_AND_VALIDATION", "DEPLOYMENT", "OPERATION_AND_MONITORING"],
    useWhen: "People interact with, are affected by, or rely on the AI system without adequate notice, review, correction, or appeal.",
    doNotUseWhen: "Do not label a powerless reviewer as human oversight.", ownerRoles: ["GOVERNANCE", "LEGAL", "SOLUTION_OWNER"],
    activities: ["Design notices and explanations.", "Assign competent reviewers with time, information and override authority.", "Implement correction, appeal and escalation."],
    requiredArtifacts: ["Transparency notice", "Oversight procedure", "Appeal flow", "Oversight effectiveness test"],
    acceptanceCriteria: ["Users receive applicable notices", "Reviewer can detect and reverse representative failures", "Appeals are traceable"],
    verification: "Human-factors and legal review", blocksTransition: "DEPLOYMENT", completionEffect: "Reassess CTRL-E-02 and CTRL-E-03"
  },
  {
    id: "GOV-ACT-008", version: "1.0.0", status: "PILOT", title: "Establish lifecycle monitoring and reassessment",
    findingSignals: ["missing-reassessment", "missing-failsafe", "lifecycle-evidence-gap"], domains: ["D", "F"], lifecycleStages: ["DEPLOYMENT", "OPERATION_AND_MONITORING", "REVIEW_AND_EVALUATION", "RETIREMENT"],
    useWhen: "Monitoring, incidents, model/data/purpose changes, rollback, or retirement are not governed.",
    doNotUseWhen: "Monitoring is not a substitute for pre-deployment testing.", ownerRoles: ["SOLUTION_OWNER", "SECURITY", "GOVERNANCE"],
    activities: ["Define metrics, alerts, feedback and incidents.", "Fingerprint model, data, code, provider and purpose changes.", "Test rollback, shutdown and retirement."],
    requiredArtifacts: ["Monitoring plan", "Material-change rules", "Incident runbook", "Rollback test", "Retirement plan"],
    acceptanceCriteria: ["Material changes trigger targeted reassessment", "Critical incidents route to named authorities", "Rollback and deletion are tested"],
    verification: "Operational readiness review", blocksTransition: "OPERATION_AND_MONITORING", completionEffect: "Reassess CTRL-D-03 and CTRL-F-03"
  }
]);
