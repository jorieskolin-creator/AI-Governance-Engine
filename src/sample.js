export const SAMPLE_REQUEST = {
  dossier: {
    name: "Internal Knowledge Assistant",
    intendedPurpose: "Answer employee process questions using approved internal knowledge while citing the supporting source.",
    expectedValue: "Reduce repeated support handling while preserving authoritative source ownership and escalation.",
    currentStage: "DESIGN_AND_DEVELOPMENT",
    targetStage: "VERIFICATION_AND_VALIDATION",
    jurisdictions: ["EU"],
    roles: ["DEPLOYER"],
    users: ["EMPLOYEES"],
    accountableOwner: "Internal Services Product Owner",
    data: { categories: ["SYNTHETIC", "PUBLIC_NON_PERSONAL"], personalData: false, specialCategoryData: false, productionData: false },
    exposure: { currentUserAccess: "INTERNAL_ONLY", intendedUserAccess: "INTERNAL_ONLY", externalUsers: false, productionAccess: false, consequentialDecisions: false },
    agent: { usesAgents: true, canTakeActions: false, irreversibleActions: false, humanOverride: true },
    classification: { prohibitedPractice: false, highRiskCandidate: false },
    operatingBoundary: {
      allowedUses: ["Internal employee question answering using approved knowledge sources"],
      excludedUses: ["Consequential employment decisions", "Autonomous external communication"],
      environment: "CONTROLLED_PILOT",
      userScope: "Named pilot employees",
      dataScope: "Public, synthetic, or explicitly approved internal content",
      integrationScope: "Read-only approved knowledge connectors",
      permissionScope: "No privileged or irreversible actions",
      autonomyScope: "Human-reviewed answers only",
      monitoringOwner: "Solution owner",
      expiresAt: "2027-01-31"
    }
  },
  sources: [
    {
      path: "governance/intended-purpose-review.md",
      kind: "HUMAN_REVIEW",
      content: "The system owner has validated the intended purpose, employee audience, success metric, excluded uses, and escalation boundary.",
      metadata: { humanActorId: "governance-reviewer-01", authority: "GOVERNANCE", controlIds: ["CTRL-A-01", "CTRL-F-01"], domainIds: ["A", "F"] }
    },
    {
      path: "architecture/model-inventory.json",
      kind: "CONFIGURATION",
      content: "{\"provider\":\"Azure OpenAI\",\"modelVersion\":\"pinned-deployment\",\"tools\":[],\"dataRetention\":\"disabled by enterprise terms\"}",
      metadata: { controlIds: ["CTRL-C-01"], domainIds: ["C"] }
    },
    {
      path: "security/threat-model.md",
      kind: "HUMAN_REVIEW",
      content: "Threat model covers trust boundaries, indirect prompt injection, sensitive output, retrieval poisoning, authorization, audit logs, and safe shutdown.",
      metadata: { humanActorId: "security-reviewer-01", authority: "SECURITY", controlIds: ["CTRL-D-01"], domainIds: ["D"] }
    },
    {
      path: "test/security-evaluation.test.js",
      kind: "TEST",
      content: "// Evaluation acceptance threshold: 100% block rate for prompt injection and data leakage cases. assertPromptInjectionBlocked(); assertSensitiveOutputRedacted();",
      metadata: { controlIds: ["CTRL-D-02"], domainIds: ["D"], testedAbsenceOf: ["AP-D-02"] }
    },
    {
      path: "governance/oversight-review.md",
      kind: "HUMAN_REVIEW",
      content: "A human can reject output, correct answers, escalate to the source owner, and disable the assistant. Employee appeal and correction requests are logged.",
      metadata: { humanActorId: "governance-reviewer-02", authority: "GOVERNANCE", controlIds: ["CTRL-E-03"], domainIds: ["E"] }
    },
    {
      path: "privacy/data-inventory.md",
      kind: "HUMAN_REVIEW",
      content: "Dataset register contains only approved process documents. Data flow, access, retention, deletion, confidentiality and licence ownership are reviewed. No personal data is intended.",
      metadata: { humanActorId: "privacy-reviewer-01", authority: "PRIVACY", controlIds: ["CTRL-B-01", "CTRL-B-03"], domainIds: ["B"] }
    }
  ]
};
