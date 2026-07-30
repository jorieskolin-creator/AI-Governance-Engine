export const REQUIREMENTS = Object.freeze([
  {
    id: "REQ-A-001",
    domain: "A",
    title: "Intended purpose and accountable use boundary",
    sourceIds: ["SRC-EU-AI-ACT-2024-1689-OMNIBUS-2026", "SRC-VIVICTA-AI-GOVERNANCE-GUIDELINE-2026"],
    authority: "MIXED",
    lifecycleStages: ["QUALIFICATION_AND_REGISTRATION", "DESIGN_AND_DEVELOPMENT", "REVIEW_AND_EVALUATION"],
    applicability: "ALWAYS",
    interpretation: "The intended purpose, affected users, accountable owner, permitted uses, and excluded uses must be explicit and kept current.",
    humanAuthority: "GOVERNANCE"
  },
  {
    id: "REQ-A-002",
    domain: "A",
    title: "AI Act role and risk-classification screen",
    sourceIds: ["SRC-EU-AI-ACT-2024-1689-OMNIBUS-2026"],
    authority: "BINDING_LAW",
    lifecycleStages: ["QUALIFICATION_AND_REGISTRATION", "VERIFICATION_AND_VALIDATION", "REVIEW_AND_EVALUATION"],
    applicability: "EU",
    interpretation: "Record provider/deployer roles and screen prohibited, high-risk, transparency, GPAI, and value-chain categories. Uncertain classifications require Legal review.",
    humanAuthority: "LEGAL"
  },
  {
    id: "REQ-A-003",
    domain: "A",
    title: "Value and proportionality hypothesis",
    sourceIds: ["SRC-VIVICTA-AI-GOVERNANCE-GUIDELINE-2026", "SRC-NIST-AI-RMF-1-GAI"],
    authority: "INTERNAL_PROCESS",
    lifecycleStages: ["QUALIFICATION_AND_REGISTRATION", "DESIGN_AND_DEVELOPMENT", "REVIEW_AND_EVALUATION"],
    applicability: "ALWAYS",
    interpretation: "The expected value, success measures, non-AI alternative, and proportionality of the AI approach should be testable.",
    humanAuthority: "SOLUTION_OWNER"
  },
  {
    id: "REQ-B-001",
    domain: "B",
    title: "Data inventory, provenance and flow",
    sourceIds: ["SRC-EU-GDPR-2016-679", "SRC-ISO-IEC-42001-2023"],
    authority: "MIXED",
    lifecycleStages: ["DESIGN_AND_DEVELOPMENT", "VERIFICATION_AND_VALIDATION", "DEPLOYMENT", "OPERATION_AND_MONITORING"],
    applicability: "USES_DATA",
    interpretation: "Data sources, classifications, destinations, purposes, retention, access, and cross-border transfers must be traceable.",
    humanAuthority: "PRIVACY"
  },
  {
    id: "REQ-B-002",
    domain: "B",
    title: "Personal-data processing and privacy review",
    sourceIds: ["SRC-EU-GDPR-2016-679"],
    authority: "BINDING_LAW",
    lifecycleStages: ["QUALIFICATION_AND_REGISTRATION", "DESIGN_AND_DEVELOPMENT", "VERIFICATION_AND_VALIDATION", "DEPLOYMENT", "OPERATION_AND_MONITORING"],
    applicability: "PERSONAL_DATA",
    interpretation: "Personal-data processing requires an approved basis, minimisation, retention, rights handling, safeguards, and DPIA screening where applicable.",
    humanAuthority: "PRIVACY"
  },
  {
    id: "REQ-B-003",
    domain: "B",
    title: "Confidentiality, IP and licensing",
    sourceIds: ["SRC-VIVICTA-AI-GOVERNANCE-GUIDELINE-2026", "SRC-ISO-IEC-42001-2023"],
    authority: "INTERNAL_PROCESS",
    lifecycleStages: ["DESIGN_AND_DEVELOPMENT", "VERIFICATION_AND_VALIDATION", "DEPLOYMENT"],
    applicability: "ALWAYS",
    interpretation: "Inputs, outputs, dependencies, training material, and provider terms require confidentiality, copyright, and licence assessment.",
    humanAuthority: "LEGAL"
  },
  {
    id: "REQ-C-001",
    domain: "C",
    title: "Versioned model, agent, provider and tool inventory",
    sourceIds: ["SRC-EU-AI-ACT-2024-1689-OMNIBUS-2026", "SRC-ISO-IEC-42001-2023"],
    authority: "MIXED",
    lifecycleStages: ["DESIGN_AND_DEVELOPMENT", "VERIFICATION_AND_VALIDATION", "DEPLOYMENT", "OPERATION_AND_MONITORING", "REVIEW_AND_EVALUATION"],
    applicability: "ALWAYS",
    interpretation: "Every AI component, provider, version, dependency, tool permission, and contractual boundary must be inventoried.",
    humanAuthority: "GOVERNANCE"
  },
  {
    id: "REQ-C-002",
    domain: "C",
    title: "Provider and supply-chain due diligence",
    sourceIds: ["SRC-ISO-IEC-42001-2023", "SRC-NIST-AI-RMF-1-GAI"],
    authority: "STANDARD_OR_FRAMEWORK",
    lifecycleStages: ["DESIGN_AND_DEVELOPMENT", "VERIFICATION_AND_VALIDATION", "DEPLOYMENT", "REVIEW_AND_EVALUATION"],
    applicability: "THIRD_PARTY_COMPONENTS",
    interpretation: "Provider terms, retention, training use, subprocessors, regions, service changes, vulnerabilities, and exit options require review.",
    humanAuthority: "LEGAL"
  },
  {
    id: "REQ-C-003",
    domain: "C",
    title: "Bounded agent authority",
    sourceIds: ["SRC-OWASP-AGENTIC-2026", "SRC-NIST-AI-RMF-1-GAI"],
    authority: "INDUSTRY_GUIDANCE",
    lifecycleStages: ["DESIGN_AND_DEVELOPMENT", "VERIFICATION_AND_VALIDATION", "DEPLOYMENT", "OPERATION_AND_MONITORING"],
    applicability: "USES_AGENTS",
    interpretation: "Agent identity, tool scopes, delegation, memory, approvals, rate limits, and irreversible actions must be explicitly bounded.",
    humanAuthority: "SECURITY"
  },
  {
    id: "REQ-D-001",
    domain: "D",
    title: "Secure architecture and threat model",
    sourceIds: ["SRC-OWASP-AGENTIC-2026", "SRC-ISO-IEC-23894-2023"],
    authority: "STANDARD_OR_GUIDANCE",
    lifecycleStages: ["DESIGN_AND_DEVELOPMENT", "VERIFICATION_AND_VALIDATION", "DEPLOYMENT", "REVIEW_AND_EVALUATION"],
    applicability: "ALWAYS",
    interpretation: "Threat modelling must address identities, secrets, data leakage, prompt injection, tool misuse, supply chain, trust boundaries, abuse, and recovery.",
    humanAuthority: "SECURITY"
  },
  {
    id: "REQ-D-002",
    domain: "D",
    title: "Versioned safety, security and performance evaluation",
    sourceIds: ["SRC-EU-AI-ACT-2024-1689-OMNIBUS-2026", "SRC-NIST-AI-RMF-1-GAI", "SRC-OWASP-AGENTIC-2026"],
    authority: "MIXED",
    lifecycleStages: ["VERIFICATION_AND_VALIDATION", "DEPLOYMENT", "OPERATION_AND_MONITORING", "REVIEW_AND_EVALUATION"],
    applicability: "ALWAYS",
    interpretation: "Representative evaluations require approved thresholds, raw results, failure analysis, and reproducibility for the intended use.",
    humanAuthority: "SECURITY"
  },
  {
    id: "REQ-D-003",
    domain: "D",
    title: "Logging, rollback and fail-safe operation",
    sourceIds: ["SRC-EU-AI-ACT-2024-1689-OMNIBUS-2026", "SRC-ISO-IEC-42001-2023"],
    authority: "MIXED",
    lifecycleStages: ["VERIFICATION_AND_VALIDATION", "DEPLOYMENT", "OPERATION_AND_MONITORING", "RETIREMENT"],
    applicability: "PRODUCTION_OR_EXTERNAL",
    interpretation: "Material inputs, outputs, versions, decisions, failures, overrides, rollback, and safe shutdown must be traceable and operable.",
    humanAuthority: "SECURITY"
  },
  {
    id: "REQ-E-001",
    domain: "E",
    title: "Human-impact and fairness assessment",
    sourceIds: ["SRC-EU-AI-ACT-2024-1689-OMNIBUS-2026", "SRC-ISO-IEC-23894-2023"],
    authority: "MIXED",
    lifecycleStages: ["DESIGN_AND_DEVELOPMENT", "VERIFICATION_AND_VALIDATION", "DEPLOYMENT", "REVIEW_AND_EVALUATION"],
    applicability: "AFFECTS_PEOPLE",
    interpretation: "Affected groups, harms, differential performance, accessibility, vulnerability, and contestability require context-specific assessment.",
    humanAuthority: "GOVERNANCE"
  },
  {
    id: "REQ-E-002",
    domain: "E",
    title: "Transparency and explainability",
    sourceIds: ["SRC-EU-AI-ACT-2024-1689-OMNIBUS-2026"],
    authority: "BINDING_LAW_CANDIDATE",
    lifecycleStages: ["VERIFICATION_AND_VALIDATION", "DEPLOYMENT", "OPERATION_AND_MONITORING"],
    applicability: "INTERACTS_WITH_PEOPLE",
    interpretation: "Screen Article 50 and context-specific notice, synthetic-content, explanation, and affected-person information duties.",
    humanAuthority: "LEGAL"
  },
  {
    id: "REQ-E-003",
    domain: "E",
    title: "Meaningful human oversight and contestability",
    sourceIds: ["SRC-EU-AI-ACT-2024-1689-OMNIBUS-2026", "SRC-ISO-IEC-42001-2023"],
    authority: "MIXED",
    lifecycleStages: ["DESIGN_AND_DEVELOPMENT", "VERIFICATION_AND_VALIDATION", "DEPLOYMENT", "OPERATION_AND_MONITORING"],
    applicability: "AFFECTS_PEOPLE",
    interpretation: "Oversight must provide competence, time, information, authority, override, escalation, correction, and appeal rather than nominal review.",
    humanAuthority: "GOVERNANCE"
  },
  {
    id: "REQ-F-001",
    domain: "F",
    title: "Accountability and decision rights",
    sourceIds: ["SRC-VIVICTA-AI-GOVERNANCE-GUIDELINE-2026", "SRC-ISO-IEC-42001-2023"],
    authority: "INTERNAL_PROCESS",
    lifecycleStages: ["QUALIFICATION_AND_REGISTRATION", "DESIGN_AND_DEVELOPMENT", "VERIFICATION_AND_VALIDATION", "DEPLOYMENT", "OPERATION_AND_MONITORING", "REVIEW_AND_EVALUATION", "RETIREMENT"],
    applicability: "ALWAYS",
    interpretation: "Accountable owners, reviewers, escalation, segregation of duties, conditional decisions, expiry, and exceptions must be defined.",
    humanAuthority: "GOVERNANCE"
  },
  {
    id: "REQ-F-002",
    domain: "F",
    title: "Risk, control and evidence integrity",
    sourceIds: ["SRC-ISO-IEC-23894-2023", "SRC-NIST-AI-RMF-1-GAI"],
    authority: "STANDARD_OR_FRAMEWORK",
    lifecycleStages: ["DESIGN_AND_DEVELOPMENT", "VERIFICATION_AND_VALIDATION", "DEPLOYMENT", "OPERATION_AND_MONITORING", "REVIEW_AND_EVALUATION"],
    applicability: "ALWAYS",
    interpretation: "Inherent risk, mitigations, residual risk, control evidence, contradictions, unknowns, and acceptance authority must remain traceable.",
    humanAuthority: "GOVERNANCE"
  },
  {
    id: "REQ-F-003",
    domain: "F",
    title: "Monitoring, incidents, material change and retirement",
    sourceIds: ["SRC-EU-AI-ACT-2024-1689-OMNIBUS-2026", "SRC-VIVICTA-AI-GOVERNANCE-GUIDELINE-2026"],
    authority: "MIXED",
    lifecycleStages: ["DEPLOYMENT", "OPERATION_AND_MONITORING", "REVIEW_AND_EVALUATION", "RETIREMENT"],
    applicability: "PRODUCTION_OR_EXTERNAL",
    interpretation: "Monitoring, incident response, feedback, reassessment triggers, documentation updates, deletion, contract termination, and archive duties must be defined.",
    humanAuthority: "GOVERNANCE"
  }
]);

