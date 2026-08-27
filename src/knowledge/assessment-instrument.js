import { LIFECYCLE_STAGES } from "../contracts.js";

export const ASSESSMENT_INSTRUMENT_VERSION = "assessment-instrument-1.0.0";
export const ASSESSMENT_INSTRUMENT_SOURCE = "AI_Governance_Categories_and_Anti-Patterns_v1.1";

const STAGES = [...LIFECYCLE_STAGES];
const DIM = Object.freeze({
  Q1: "DEFINITION_AND_INTENT",
  Q2: "IMPLEMENTATION_AND_OPERATION",
  Q3: "EVIDENCE_AND_EFFECTIVENESS"
});

function questions(id, q1, q2, q3) {
  return [
    { id: `${id}-Q1`, dimension: DIM.Q1, question: q1 },
    { id: `${id}-Q2`, dimension: DIM.Q2, question: q2 },
    { id: `${id}-Q3`, dimension: DIM.Q3, question: q3 }
  ];
}

function antipatternQuestions(id, title, definition, implementationTheme) {
  return questions(
    id,
    `Does the case exhibit ${title}: ${definition}`,
    `Do implemented workflows, data paths or operations show ${implementationTheme}?`,
    `Does current evidence test presence or scoped absence of ${title}, or does it remain unknown?`
  );
}

const INTERNAL_SOURCE = "SRC-INTERNAL-AI-GOVERNANCE-GUIDELINE-2026";

export const ASSESSMENT_PAIRS = Object.freeze([
  {
    domain: "A", id: "A1",
    title: "Intended purpose and use boundaries",
    definition: "The intended purpose, users, affected persons, operating context, expected outputs, permitted uses, prohibited uses and foreseeable misuse are precise enough to govern design and evaluation.",
    applicability: "ALWAYS", severity: "HIGH",
    signals: ["purpose", "excluded-use", "accountable-owner"],
    indicators: ["Named users and affected persons", "Explicit permitted and prohibited uses", "Measurable output and outcome expectations", "Purpose reflected in architecture and evaluations"],
    questions: questions("A1",
      "Is the intended purpose and decision context specific, bounded and testable?",
      "Are purpose and use boundaries implemented consistently in workflows, data use, access and product behavior?",
      "Does current evidence show that actual and foreseeable use remains within the declared boundary?"
    ),
    antipattern: {
      id: "AP-A1", title: "Undefined or elastic intended purpose",
      definition: "The purpose is vague, technically framed, inconsistent or expands without requalification.",
      severity: "HIGH", signal: "undefined-purpose",
      indicators: ["General-purpose wording without use constraints", "Conflicting purpose statements", "No affected-person boundary", "Prototype features become accepted use without review"],
      questions: questions("AP-A1",
        "Is the declared purpose vague, inconsistent or missing material use boundaries?",
        "Do implemented or operational uses materially diverge from the declared purpose?",
        "Has a scoped current comparison tested declared and actual uses for divergence?"
      )
    }
  },
  {
    domain: "A", id: "A2",
    title: "AI suitability, proportionality and value hypothesis",
    definition: "The organization demonstrates that AI is a proportionate mechanism for a defined problem and that expected value is measurable against cost, alternatives and risk.",
    applicability: "ALWAYS", severity: "HIGH",
    signals: ["value", "success-metric", "non-ai-baseline"],
    indicators: ["Non-AI baseline exists", "Value metrics and owners are named", "Cost and operational consequences are considered", "Continuation and stop criteria are enforced"],
    questions: questions("A2",
      "Is the problem, desired outcome and measurable value hypothesis defined independently of the AI solution?",
      "Has the chosen AI approach been compared with simpler alternatives and implemented with explicit cost-risk trade-offs?",
      "Do representative trials show sufficient value and feasibility to justify progression, with stop criteria applied?"
    ),
    antipattern: {
      id: "AP-A2", title: "AI-first solutionism or value theatre",
      definition: "AI is adopted for novelty, availability or signalling without evidence that it is the best proportionate mechanism.",
      severity: "HIGH", signal: "value-theatre",
      indicators: ["The use case starts with a predetermined AI solution", "No baseline or alternative comparison", "Activity metrics substitute for value", "Progress continues despite poor outcome evidence"],
      questions: antipatternQuestions("AP-A2", "AI-first solutionism or value theatre", "AI is adopted for novelty, availability or signalling without evidence that it is the best proportionate mechanism.", "a predetermined AI solution, missing baseline comparison, or activity metrics substituting for value")
    }
  },
  {
    domain: "A", id: "A3",
    title: "Value-chain roles and responsibility boundaries",
    definition: "Organizational, contractual and regulatory roles across the complete AI value chain are identified and matched to real control and accountability.",
    applicability: "ALWAYS", severity: "HIGH",
    signals: ["provider-role", "deployer-role", "component-owner"],
    indicators: ["System and business owners are named", "Provider and deployer duties are separated", "Contract and operating model agree", "Component responsibility is traceable"],
    questions: questions("A3",
      "Are system, business, provider, deployer, integrator and component roles explicitly determined?",
      "Are responsibilities implemented through contracts, operating procedures, access and ownership assignments?",
      "Does evidence show that each party can and does discharge the responsibilities assigned to it?"
    ),
    antipattern: {
      id: "AP-A3", title: "Role ambiguity and responsibility displacement",
      definition: "Parties assume that governance, compliance or operational control belongs to someone else.",
      severity: "HIGH", signal: "responsibility-displacement",
      indicators: ["Vendor assurance is treated as deployer assurance", "Overlapping or contradictory ownership", "No owner for integrated components", "Responsibility disappears across subcontracting"],
      questions: antipatternQuestions("AP-A3", "Role ambiguity and responsibility displacement", "Parties assume that governance, compliance or operational control belongs to someone else.", "vendor assurance treated as deployer assurance, overlapping ownership, or unowned integrated components")
    }
  },
  {
    domain: "A", id: "A4",
    title: "Risk, legal and regulatory classification",
    definition: "The complete system and actual use are classified through a reviewable applicability analysis covering role, risk, jurisdiction, data, impact and sector obligations.",
    applicability: "ALWAYS", severity: "HIGH", authority: "LEGAL",
    signals: ["classification", "prohibited-use", "reclassification-trigger"],
    indicators: ["System-level classification record", "Uncertainty and dissent are visible", "Adjacent regimes are screened", "Material change triggers reclassification"],
    questions: questions("A4",
      "Are applicable jurisdictions, roles, prohibited-practice screens, risk classes and adjacent legal regimes identified from actual use?",
      "Are classification outcomes implemented as controls, documentation duties, review routes and transition constraints?",
      "Is the rationale current, evidence-backed, independently reviewed where needed and linked to reclassification triggers?"
    ),
    antipattern: {
      id: "AP-A4", title: "Superficial or static classification",
      definition: "Classification is copied, model-centric, overconfident or treated as a one-time formality.",
      severity: "HIGH", signal: "static-classification",
      indicators: ["Vendor category copied without use analysis", "Internal rating confused with legal class", "Unknown legal questions stated as facts", "No reclassification after change"],
      questions: antipatternQuestions("AP-A4", "Superficial or static classification", "Classification is copied, model-centric, overconfident or treated as a one-time formality.", "copied vendor categories, internal ratings treated as legal class, or missing reclassification after change")
    }
  },
  {
    domain: "A", id: "A5",
    title: "Lifecycle stage and transition boundary",
    definition: "The current stage, permitted activities, target stage, acceptance criteria and authorization boundary are explicit from qualification through retirement.",
    applicability: "ALWAYS", severity: "HIGH",
    signals: ["lifecycle-stage", "operating-boundary", "transition-criteria"],
    indicators: ["Stage-specific boundary record", "Experiment and production separation", "Transition acceptance criteria", "Retirement and rollback remain possible"],
    questions: questions("A5",
      "Are current and target lifecycle stages, scope and permitted activities explicitly defined?",
      "Are environment, data, access and user boundaries technically and operationally enforced for the current stage?",
      "Does evidence demonstrate that transition criteria are met and the correct authority has approved progression?"
    ),
    antipattern: {
      id: "AP-A5", title: "Prototype-to-production drift",
      definition: "An experiment accumulates real users, data, integrations or dependency without formal transition and reassessment.",
      severity: "CRITICAL", signal: "prototype-production-drift",
      indicators: ["Temporary prototype runs indefinitely", "Production data or credentials enter an experiment", "Development approval is treated as deployment approval", "Shadow infrastructure becomes business critical"],
      questions: antipatternQuestions("AP-A5", "Prototype-to-production drift", "An experiment accumulates real users, data, integrations or dependency without formal transition and reassessment.", "production data or credentials in an experiment, indefinite prototypes, or development approval treated as deployment approval")
    }
  },
  {
    domain: "B", id: "B1",
    title: "Data inventory, provenance and lineage",
    definition: "Training, tuning, retrieval, prompt, evaluation, operational and output data are separately identifiable from origin through transformation, storage, transfer and deletion.",
    applicability: "USES_DATA", severity: "HIGH",
    signals: ["data-inventory", "data-flow", "lineage"],
    indicators: ["Data-flow and lineage records", "Stable dataset identifiers", "Owners and rights are recorded", "Outputs preserve provenance where material"],
    questions: questions("B1",
      "Are material data classes, sources, owners, destinations and uses inventoried with stable identifiers?",
      "Are lineage, transformation, quality, licensing and transfer controls implemented across the actual data flow?",
      "Can representative outputs and decisions be traced to current, authorized and sufficiently reliable data evidence?"
    ),
    antipattern: {
      id: "AP-B1", title: "Invisible or untraceable data flows",
      definition: "Data origin, ownership, transformation, transmission, retention or reuse cannot be reliably established.",
      severity: "HIGH", signal: "untraceable-data",
      indicators: ["Unknown sources mixed in prompts", "Retrieval stores lack dataset records", "Undocumented fields reach providers", "Outputs are reused without provenance"],
      questions: antipatternQuestions("AP-B1", "Invisible or untraceable data flows", "Data origin, ownership, transformation, transmission, retention or reuse cannot be reliably established.", "unknown prompt sources, undocumented provider fields, or outputs reused without provenance")
    }
  },
  {
    domain: "B", id: "B2",
    title: "Purpose limitation and data minimization",
    definition: "Only data demonstrably necessary and proportionate for the declared purpose and lifecycle stage are processed and retained.",
    applicability: "USES_DATA", severity: "HIGH",
    signals: ["minimization", "retention", "necessity"],
    indicators: ["Field-level necessity record", "Minimized or synthetic prototype data", "Retention tied to purpose", "Scope reassessed after design change"],
    questions: questions("B2",
      "Is necessity defined for each material data category, field and retention period?",
      "Are minimization, abstraction, tokenization, synthetic-data and deletion controls implemented in every relevant store and interface?",
      "Do tests and operational evidence show that unnecessary content is excluded and deletion or scope changes propagate?"
    ),
    antipattern: {
      id: "AP-B2", title: "Convenience-driven data accumulation",
      definition: "Data is collected, transmitted or retained because it may be useful rather than because it is necessary.",
      severity: "HIGH", signal: "data-accumulation",
      indicators: ["Whole databases copied for narrow use", "Full documents sent when fields suffice", "No deletion propagation", "More context is assumed to be inherently better"],
      questions: antipatternQuestions("AP-B2", "Convenience-driven data accumulation", "Data is collected, transmitted or retained because it may be useful rather than because it is necessary.", "whole-database copies, full documents sent when fields suffice, or missing deletion propagation")
    }
  },
  {
    domain: "B", id: "B3",
    title: "Privacy and data-subject governance",
    definition: "Personal-data processing, lawful basis, transparency, rights, privacy risks and impact-assessment duties are operationalized in the system and its lifecycle.",
    applicability: "PERSONAL_DATA", severity: "HIGH", authority: "PRIVACY",
    signals: ["privacy-review", "lawful-basis", "dpia"],
    indicators: ["Data categories are classified", "Context-specific privacy analysis", "Rights can be fulfilled end to end", "Privacy controls are tested"],
    questions: questions("B3",
      "Are personal-data categories, purposes, lawful basis, rights and impact-assessment triggers determined?",
      "Are privacy requirements implemented across architecture, access, logging, retention, providers and user workflows?",
      "Do tests and operational records demonstrate rights fulfilment, deletion, restriction and privacy-control effectiveness?"
    ),
    antipattern: {
      id: "AP-B3", title: "Privacy-by-documentation only",
      definition: "Privacy exists in policy text but is not reflected in actual data flows, controls or operations.",
      severity: "CRITICAL", signal: "privacy-by-documentation",
      indicators: ["Privacy statement without inventory", "Personal data persists in logs or embeddings", "Rights cannot propagate", "Pseudonymization is treated as anonymization"],
      questions: antipatternQuestions("AP-B3", "Privacy-by-documentation only", "Privacy exists in policy text but is not reflected in actual data flows, controls or operations.", "personal data in logs or embeddings, rights that cannot propagate, or pseudonymization treated as anonymization")
    }
  },
  {
    domain: "B", id: "B4",
    title: "Confidentiality and information-boundary control",
    definition: "Confidential, restricted, customer-controlled and security-sensitive information remains within approved identity, tenant, provider, logging and contractual boundaries.",
    applicability: "ALWAYS", severity: "HIGH",
    signals: ["confidentiality", "tenant-isolation", "secrets-isolation"],
    indicators: ["AI inputs follow classification rules", "Secrets are excluded from model-visible context", "Tenant isolation is tested", "Provider retention and training settings are known"],
    questions: questions("B4",
      "Are information classes, confidentiality obligations and prohibited disclosure paths explicitly defined?",
      "Are secrets isolation, least privilege, tenant separation, provider settings and leakage controls technically enforced?",
      "Do leakage, cross-tenant, unauthorized reuse and output-disclosure tests demonstrate effective boundaries?"
    ),
    antipattern: {
      id: "AP-B4", title: "Confidentiality leakage through AI channels",
      definition: "Sensitive information enters or leaves models, prompts, logs, caches, retrieval stores or tools without adequate protection.",
      severity: "CRITICAL", signal: "confidentiality-leakage",
      indicators: ["Secrets embedded in prompts", "Unapproved provider receives restricted data", "Shared retrieval store lacks tenant isolation", "Outputs reveal source-system content"],
      questions: antipatternQuestions("AP-B4", "Confidentiality leakage through AI channels", "Sensitive information enters or leaves models, prompts, logs, caches, retrieval stores or tools without adequate protection.", "secrets in prompts, unapproved provider transfers, or outputs revealing source-system content")
    }
  },
  {
    domain: "B", id: "B5",
    title: "Intellectual property, licensing and content rights",
    definition: "The organization has a defensible and traceable basis to use, transform, train on, retrieve, generate and distribute relevant data, models, code and outputs.",
    applicability: "ALWAYS", severity: "HIGH", authority: "LEGAL",
    signals: ["licence", "content-rights", "output-ownership"],
    indicators: ["Licence and rights inventory", "Restricted content is blocked or permissioned", "Output-use conditions are explicit", "Customer IP boundaries are preserved"],
    questions: questions("B5",
      "Are rights, licences, restrictions, attribution and ownership conditions identified for all material assets and outputs?",
      "Are those conditions implemented in ingestion, training, retrieval, generation, review and distribution workflows?",
      "Does current evidence demonstrate compliance with restrictions and effective detection or review of infringement risk?"
    ),
    antipattern: {
      id: "AP-B5", title: "Unverified rights and output ownership",
      definition: "Accessible content is assumed to be available for AI use, transformation or redistribution without rights analysis.",
      severity: "HIGH", signal: "unverified-rights",
      indicators: ["Scraped material lacks rights review", "Confidential material used for tuning", "Licence conflicts with commercial use", "Generated output is claimed as proprietary without review"],
      questions: antipatternQuestions("AP-B5", "Unverified rights and output ownership", "Accessible content is assumed to be available for AI use, transformation or redistribution without rights analysis.", "scraped material without rights review, confidential tuning data, or generated output claimed as proprietary without review")
    }
  },
  {
    domain: "C", id: "C1",
    title: "Model, agent and component inventory",
    definition: "Models, agents, prompts, tools, APIs, datasets, providers, infrastructure, versions and owners are registered and linked to the assessed system.",
    applicability: "ALWAYS", severity: "HIGH",
    signals: ["model-inventory", "component-manifest", "prompt-version"],
    indicators: ["Component manifest exists", "Model and prompt versions are traceable", "Tools and permissions are visible", "Obsolete components can be identified"],
    questions: questions("C1",
      "Are all material AI and supporting components, versions, configurations, owners and roles inventoried?",
      "Is inventory capture integrated with build, deployment, routing and change processes?",
      "Can a specific run, decision or incident be reconstructed from the component baseline actually used?"
    ),
    antipattern: {
      id: "AP-C1", title: "Shadow AI component usage",
      definition: "Unregistered or uncontrolled models, tools, providers, prompts or agent capabilities are used.",
      severity: "HIGH", signal: "shadow-ai",
      indicators: ["Model selected directly in code", "Unofficial AI service processes data", "Tool set differs from architecture", "No owner for a critical component"],
      questions: antipatternQuestions("AP-C1", "Shadow AI component usage", "Unregistered or uncontrolled models, tools, providers, prompts or agent capabilities are used.", "models selected directly in code, unofficial AI services, or tool sets that differ from architecture")
    }
  },
  {
    domain: "C", id: "C2",
    title: "Model and provider suitability",
    definition: "Model and provider selections are evidence-based for task quality, language, latency, security, privacy, resilience, cost, contract and risk.",
    applicability: "ALWAYS", severity: "HIGH",
    signals: ["model-suitability", "provider-comparison", "fallback"],
    indicators: ["Selection criteria are documented", "Suitability is tied to test results", "Fallbacks are controlled", "Provider limitations are known"],
    questions: questions("C2",
      "Are task-specific model and provider requirements and selection criteria defined?",
      "Are approved choices, routing, fallbacks and contractual constraints implemented in configuration and operation?",
      "Do representative evaluations and provider evidence demonstrate continued suitability against alternatives?"
    ),
    antipattern: {
      id: "AP-C2", title: "Convenience- or brand-driven model selection",
      definition: "Models or providers are selected by familiarity, availability, prestige or generic benchmarks rather than contextual evidence.",
      severity: "HIGH", signal: "brand-driven-selection",
      indicators: ["One model is used for every task", "No provider comparison", "Generic benchmark replaces system testing", "Fallback is untested"],
      questions: antipatternQuestions("AP-C2", "Convenience- or brand-driven model selection", "Models or providers are selected by familiarity, availability, prestige or generic benchmarks rather than contextual evidence.", "one model used for every task, missing provider comparison, or generic benchmarks replacing system testing")
    }
  },
  {
    domain: "C", id: "C3",
    title: "Agent autonomy and tool permissioning",
    definition: "Agent authority is explicit, least-privilege, stage-appropriate, budgeted, observable and bounded by deterministic authorization for consequential actions.",
    applicability: "USES_AGENTS", severity: "CRITICAL",
    signals: ["tool-allowlist", "human-approval", "rate-limit", "kill-switch"],
    indicators: ["Per-tool permission model", "Consequential actions require approval", "Read and write privileges differ", "Kill switch and rollback exist"],
    questions: questions("C3",
      "Are each agent's tools, credentials, data access, action scope, budgets and approval points defined?",
      "Are least privilege, deterministic authorization, reversibility, rate limits and interruption implemented outside model discretion?",
      "Do negative tests and runtime evidence show that unauthorized, recursive or cross-boundary actions are prevented and detected?"
    ),
    antipattern: {
      id: "AP-C3", title: "Unbounded or implicit agent authority",
      definition: "An agent receives broad access and can choose independently how to exercise it without enforceable limits.",
      severity: "CRITICAL", signal: "excessive-agency",
      indicators: ["Shared administrative credentials", "Unrestricted browser or database access", "Model controls authorization", "No approval for external messages or record changes"],
      questions: antipatternQuestions("AP-C3", "Unbounded or implicit agent authority", "An agent receives broad access and can choose independently how to exercise it without enforceable limits.", "shared administrative credentials, unrestricted tool access, or model-controlled authorization")
    }
  },
  {
    domain: "C", id: "C4",
    title: "Provider, vendor and contractual governance",
    definition: "Third-party AI services are evaluated, contractually governed, monitored and replaceable in the context of the actual system.",
    applicability: "THIRD_PARTY_COMPONENTS", severity: "HIGH",
    signals: ["provider-review", "subprocessor", "exit-plan"],
    indicators: ["Approved-vendor status", "Terms and subprocessors are versioned", "Retention and training use are confirmed", "Exit and portability plans exist"],
    questions: questions("C4",
      "Are provider terms, data practices, subprocessors, service limits, audit rights and exit needs defined?",
      "Are contractual controls, approved configurations, monitoring and contingency arrangements implemented?",
      "Does current evidence show that material provider changes and service failures are detected, assessed and acted upon?"
    ),
    antipattern: {
      id: "AP-C4", title: "Vendor assurance substitution",
      definition: "Vendor claims, certifications or marketing are treated as proof that the integrated system is governed.",
      severity: "HIGH", signal: "vendor-assurance-substitution",
      indicators: ["No contract-specific review", "Enterprise-grade is used as evidence", "Provider compliance is assumed to transfer", "No exit plan or term-change monitoring"],
      questions: antipatternQuestions("AP-C4", "Vendor assurance substitution", "Vendor claims, certifications or marketing are treated as proof that the integrated system is governed.", "enterprise-grade used as evidence, assumed transfer of provider compliance, or missing exit plans")
    }
  },
  {
    domain: "C", id: "C5",
    title: "AI supply-chain integrity and change control",
    definition: "AI models, datasets, libraries, tools, services and update channels have verifiable provenance, controlled baselines and risk-based change gates.",
    applicability: "ALWAYS", severity: "HIGH",
    signals: ["supply-chain", "component-baseline", "update-channel"],
    indicators: ["Software/model/data bills of materials", "Controlled baselines and update channels", "Integrity and vulnerability checks", "Tested rollback or replacement"],
    questions: questions("C5",
      "Are component provenance, versions, vulnerabilities, update sources and material-change triggers defined?",
      "Are integrity checks, approved update channels, testing, rollback and replacement processes implemented?",
      "Does evidence show that drift, compromise, deprecation and material change are detected and reauthorized when required?"
    ),
    antipattern: {
      id: "AP-C5", title: "Silent supply-chain drift",
      definition: "Components or dependencies change without the organization understanding or authorizing their effect on behavior and risk.",
      severity: "HIGH", signal: "supply-chain-drift",
      indicators: ["Latest aliases in production", "Automatic updates lack regression tests", "Provider behavior changes silently", "No provenance or component baseline"],
      questions: antipatternQuestions("AP-C5", "Silent supply-chain drift", "Components or dependencies change without the organization understanding or authorizing their effect on behavior and risk.", "latest aliases in production, untested automatic updates, or silent provider behavior changes")
    }
  },
  {
    domain: "D", id: "D1",
    title: "Secure and isolated AI architecture",
    definition: "The system uses defense in depth, explicit trust boundaries and enforced identity, network, environment, tenant, secrets and data-flow controls.",
    applicability: "ALWAYS", severity: "HIGH",
    signals: ["threat-model", "trust-boundary", "environment-isolation"],
    indicators: ["Trust-boundary architecture", "Environment-specific credentials", "Network and identity least privilege", "Tenant and isolation tests"],
    questions: questions("D1",
      "Are assets, identities, data flows, trust boundaries, environments and external connections defined?",
      "Are authentication, authorization, network restriction, secrets isolation and tenant/environment separation enforced?",
      "Do architecture review and technical tests demonstrate that stated boundaries resist unauthorized access and cross-environment movement?"
    ),
    antipattern: {
      id: "AP-D1", title: "Implicit-trust AI architecture",
      definition: "The system relies on prompts, conventions or developer intent instead of enforceable architectural controls.",
      severity: "CRITICAL", signal: "unsafe-experiment-boundary",
      indicators: ["Shared credentials across environments", "System prompt used as security boundary", "Prototype reaches production resources", "No tenant or architecture separation"],
      questions: antipatternQuestions("AP-D1", "Implicit-trust AI architecture", "The system relies on prompts, conventions or developer intent instead of enforceable architectural controls.", "shared credentials across environments, prompts used as security boundaries, or prototypes reaching production resources")
    }
  },
  {
    domain: "D", id: "D2",
    title: "Functional quality, accuracy and reliability",
    definition: "End-to-end performance is evaluated on representative tasks, users, contexts and failure modes against consequence-based acceptance thresholds.",
    applicability: "ALWAYS", severity: "HIGH",
    signals: ["evaluation", "acceptance-threshold", "reliability"],
    indicators: ["Representative evaluation set", "Repeated-run and subgroup analysis", "Risk-based thresholds", "Production performance compared with baseline"],
    questions: questions("D2",
      "Are quality attributes, representative cases, failure classes and acceptance thresholds defined for the intended context?",
      "Are evaluation, fallback, human review and release controls implemented in the delivery lifecycle?",
      "Do repeated, independent where needed, end-to-end tests and operational data demonstrate acceptable performance and reliability?"
    ),
    antipattern: {
      id: "AP-D2", title: "Demo-based quality assurance",
      definition: "Successful examples or generic model benchmarks are treated as proof of end-to-end reliability.",
      severity: "HIGH", signal: "demo-quality",
      indicators: ["Only happy-path examples", "Single successful run", "No domain-expert review", "Average score hides critical failure"],
      questions: antipatternQuestions("AP-D2", "Demo-based quality assurance", "Successful examples or generic model benchmarks are treated as proof of end-to-end reliability.", "happy-path-only examples, a single successful run, or average scores hiding critical failures")
    }
  },
  {
    domain: "D", id: "D3",
    title: "AI-specific security and adversarial resilience",
    definition: "The system identifies and controls attack paths that exploit AI models, prompts, training or retrieval data, generated outputs, tools and feedback loops, and verifies resilience through representative adversarial testing and monitoring.",
    applicability: "ALWAYS", severity: "HIGH",
    signals: ["prompt-injection", "data-leakage", "red-team", "adversarial-test"],
    indicators: ["AI-specific threat model and abuse cases", "Deterministic validation and authorization boundaries", "Representative adversarial regression suite", "AI-security telemetry and response playbook"],
    questions: questions("D3",
      "Does a system-specific threat model cover applicable AI attack surfaces, attacker goals, assets, trust boundaries and consequences?",
      "Are enforceable controls implemented outside model discretion for untrusted inputs, retrieval, outputs, tools, data, models and privileged actions?",
      "Do representative adversarial tests, regression evidence and operational monitoring demonstrate control effectiveness and expose residual limitations?"
    ),
    antipattern: {
      id: "AP-D3", title: "Prompt-only or model-mediated security boundary",
      definition: "Security-critical restrictions depend mainly on instructions, refusals, model behavior or unverified filters instead of enforceable external controls and adversarial evidence.",
      severity: "HIGH", signal: "missing-adversarial-evaluation",
      indicators: ["Safety prompt is the principal control", "Model output reaches tools or interpreters directly", "Untrusted retrieved content can alter privileged behavior", "No representative adversarial testing"],
      questions: antipatternQuestions("AP-D3", "Prompt-only or model-mediated security boundary", "Security-critical restrictions depend mainly on instructions, refusals, model behavior or unverified filters instead of enforceable external controls and adversarial evidence.", "safety prompts as the principal control, model output reaching tools directly, or missing adversarial testing")
    }
  },
  {
    domain: "D", id: "D4",
    title: "Traceability, reproducibility and observability",
    definition: "Material outputs and actions can be reconstructed from evidence, data, component versions, prompts, tools, validations and human decisions with sufficient operational telemetry.",
    applicability: "ALWAYS", severity: "HIGH",
    signals: ["audit-log", "run-manifest", "reproducibility"],
    indicators: ["Run manifest and evidence IDs", "Model, prompt and tool versions recorded", "Material actions logged", "Prior runs can be compared"],
    questions: questions("D4",
      "Are required trace events, identifiers, lineage, retention and reconstruction outcomes defined?",
      "Are run manifests, evidence links, component versions, tool logs and governance events captured with integrity controls?",
      "Can representative outputs, failures and decisions be reconstructed and compared across versions and time?"
    ),
    antipattern: {
      id: "AP-D4", title: "Opaque and non-reproducible execution",
      definition: "The organization cannot determine how a material result or action was produced.",
      severity: "HIGH", signal: "opaque-execution",
      indicators: ["No run history", "Overwritten prompts or mutable aliases", "Evidence is not linked to claims", "Manual steps are undocumented"],
      questions: antipatternQuestions("AP-D4", "Opaque and non-reproducible execution", "The organization cannot determine how a material result or action was produced.", "missing run history, overwritten prompts, or evidence not linked to claims")
    }
  },
  {
    domain: "D", id: "D5",
    title: "Safety, failure handling and recovery",
    definition: "Foreseeable unsafe states are constrained through fail-safe behavior, interruption, fallback, rollback, human takeover, incident response and recovery testing.",
    applicability: "ALWAYS", severity: "HIGH",
    signals: ["rollback", "safe-shutdown", "fail-safe"],
    indicators: ["Defined fail-safe states", "Fallback and interruption controls", "Tested rollback and recovery", "Incident ownership and human takeover"],
    questions: questions("D5",
      "Are failure modes, unsafe states, recovery objectives and control-transfer conditions defined?",
      "Are fail-safe states, interruption, fallback, rollback, human takeover and incident procedures implemented?",
      "Do fault-injection, recovery and operational exercises demonstrate controlled degradation and timely restoration?"
    ),
    antipattern: {
      id: "AP-D5", title: "Fail-open AI operation",
      definition: "When confidence, controls, components or evidence fail, the system continues without safe limitation.",
      severity: "CRITICAL", signal: "missing-failsafe",
      indicators: ["Errors become plausible outputs", "Control outage bypasses validation", "Agent continues after tool failure", "Rollback or manual takeover is undefined"],
      questions: antipatternQuestions("AP-D5", "Fail-open AI operation", "When confidence, controls, components or evidence fail, the system continues without safe limitation.", "errors becoming plausible outputs, control outages bypassing validation, or undefined rollback")
    }
  },
  {
    domain: "E", id: "E1",
    title: "Human and fundamental-rights impact",
    definition: "The organization evaluates direct, indirect and cumulative benefits and harms for users, non-users, affected groups and rights across the actual context.",
    applicability: "AFFECTS_PEOPLE", severity: "HIGH",
    signals: ["impact-assessment", "affected-persons", "harm-scenario"],
    indicators: ["Affected-person map", "Indirect and vulnerable-group impacts", "Harm scenarios and mitigations", "Material change triggers reassessment"],
    questions: questions("E1",
      "Are affected persons, rights, benefit-harm pathways, severity, likelihood, reversibility and vulnerability defined?",
      "Are impact mitigations, stakeholder input, escalation and review integrated into design and operation?",
      "Do evaluation and post-deployment evidence show impacts are monitored, mitigated and reassessed after change?"
    ),
    antipattern: {
      id: "AP-E1", title: "User-only impact framing",
      definition: "The system is evaluated only from the buyer's or operator's perspective while affected non-users and rights are ignored.",
      severity: "HIGH", signal: "user-only-impact",
      indicators: ["Affected non-users omitted", "Efficiency outweighs unassessed harm", "No vulnerable-group analysis", "Rights considered only after complaint"],
      questions: antipatternQuestions("AP-E1", "User-only impact framing", "The system is evaluated only from the buyer's or operator's perspective while affected non-users and rights are ignored.", "omitted non-users, missing vulnerable-group analysis, or rights considered only after complaint")
    }
  },
  {
    domain: "E", id: "E2",
    title: "Fairness and non-discrimination",
    definition: "Contextual fairness objectives, relevant groups, data and decision pathways are defined, measured and governed for unacceptable disparity.",
    applicability: "AFFECTS_PEOPLE", severity: "HIGH",
    signals: ["fairness", "subgroup", "disparity"],
    indicators: ["Contextual fairness objective", "Subgroup and proxy analysis", "Validated mitigations", "Unresolved disparity is escalated"],
    questions: questions("E2",
      "Are context-specific fairness objectives, relevant groups, harms, metrics and unacceptable thresholds defined?",
      "Are data, model, workflow and human-review mitigations implemented without creating new inequities?",
      "Do subgroup, intersectional and operational results demonstrate acceptable disparity and effective mitigation?"
    ),
    antipattern: {
      id: "AP-E2", title: "Aggregate-performance fairness",
      definition: "Overall performance or removal of explicit protected attributes is treated as proof of fairness.",
      severity: "HIGH", signal: "aggregate-bias-blindness",
      indicators: ["No subgroup testing", "Proxy effects are ignored", "Small groups disappear from analysis", "Human override is assumed to remove bias"],
      questions: antipatternQuestions("AP-E2", "Aggregate-performance fairness", "Overall performance or removal of explicit protected attributes is treated as proof of fairness.", "missing subgroup testing, ignored proxy effects, or human override assumed to remove bias")
    }
  },
  {
    domain: "E", id: "E3",
    title: "Transparency and communication",
    definition: "Users and affected persons receive timely, accurate and actionable information about AI use, purpose, limitations, data use, human involvement and relevant consequences.",
    applicability: "INTERACTS_WITH_PEOPLE", severity: "HIGH",
    signals: ["ai-notice", "explanation", "disclosure"],
    indicators: ["AI interaction is disclosed when required", "Purpose and limits are understandable", "Human-review status is clear", "Contact and challenge paths exist"],
    questions: questions("E3",
      "Are audience-specific transparency objectives, content, timing and communication responsibilities defined?",
      "Are disclosures, labels, limitations, contact and correction routes implemented in the actual interaction and workflow?",
      "Do comprehension, accessibility and consistency checks show that people can understand and act on the information?"
    ),
    antipattern: {
      id: "AP-E3", title: "Decorative or incomplete transparency",
      definition: "Generic disclosures exist but do not accurately explain the system or enable informed action.",
      severity: "HIGH", signal: "missing-transparency",
      indicators: ["Vague AI-may-be-used wording", "Disclosure hidden or mistimed", "Consequences and limitations omitted", "Transparency record conflicts with operation"],
      questions: antipatternQuestions("AP-E3", "Decorative or incomplete transparency", "Generic disclosures exist but do not accurately explain the system or enable informed action.", "vague AI-may-be-used wording, hidden or mistimed disclosure, or omitted limitations")
    }
  },
  {
    domain: "E", id: "E4",
    title: "Meaningful human oversight",
    definition: "Competent humans have sufficient information, authority, time and technical ability to review, intervene, override and escalate at material decision points.",
    applicability: "ALWAYS", severity: "CRITICAL",
    signals: ["human-override", "oversight", "automation-bias"],
    indicators: ["Explicit oversight points", "Reviewer sees evidence and uncertainty", "Override is technically possible", "Effectiveness and automation bias are monitored"],
    questions: questions("E4",
      "Are oversight purpose, reviewer competence, information needs, intervention points and authority defined?",
      "Can reviewers actually inspect evidence, pause, correct, override and escalate without undue friction or incentive bias?",
      "Do intervention, disagreement, error and workload data demonstrate that oversight is effective rather than nominal?"
    ),
    antipattern: {
      id: "AP-E4", title: "Rubber-stamp oversight",
      definition: "A human is nominally present but lacks information, capacity, authority or incentive for independent judgment.",
      severity: "CRITICAL", signal: "rubber-stamp-oversight",
      indicators: ["Review volume prevents scrutiny", "AI recommendation is the default", "Evidence cannot be inspected", "Override is discouraged or untracked"],
      questions: antipatternQuestions("AP-E4", "Rubber-stamp oversight", "A human is nominally present but lacks information, capacity, authority or incentive for independent judgment.", "review volume preventing scrutiny, AI recommendation as default, or untracked override")
    }
  },
  {
    domain: "E", id: "E5",
    title: "Contestability, correction, accessibility and AI literacy",
    definition: "Material outcomes can be questioned and corrected through accessible human recourse, while users, reviewers and decision-makers have role-appropriate competence.",
    applicability: "INTERACTS_WITH_PEOPLE", severity: "HIGH",
    signals: ["appeal", "correction", "accessibility"],
    indicators: ["Appeal and correction workflow", "Accessible human review", "Role-specific AI competence", "Errors feed into improvement"],
    questions: questions("E5",
      "Are correction, appeal, accessibility and role-specific competence requirements defined?",
      "Are timely human recourse, accessible interfaces, correction propagation and training implemented?",
      "Do case outcomes, accessibility checks, competence evidence and complaint trends show that recourse works in practice?"
    ),
    antipattern: {
      id: "AP-E5", title: "No practical recourse or competence",
      definition: "Outcomes are functionally final or relevant people lack the means and understanding to question them.",
      severity: "HIGH", signal: "no-recourse",
      indicators: ["No correction channel", "Appeal repeats the same automated logic", "Accessibility barriers", "Training covers tool use but not limits and duties"],
      questions: antipatternQuestions("AP-E5", "No practical recourse or competence", "Outcomes are functionally final or relevant people lack the means and understanding to question them.", "no correction channel, appeals that repeat automated logic, or accessibility barriers")
    }
  },
  {
    domain: "F", id: "F1",
    title: "Ownership and accountable operating model",
    definition: "One accountable system owner and clearly assigned business, technical, data, model, security, privacy, operations and decision roles exercise authority throughout the lifecycle.",
    applicability: "ALWAYS", severity: "HIGH",
    signals: ["accountable-owner", "raci", "ownership-continuity"],
    indicators: ["Accountable system owner", "Current authority/RACI model", "Gaps and decisions have owners", "Ownership persists through retirement"],
    questions: questions("F1",
      "Are accountable ownership, delegated responsibilities, decision rights and continuity obligations defined?",
      "Are ownership and role assignments embedded in work queues, access, reviews, incidents and change processes?",
      "Do records show that named owners act, resolve gaps and remain accountable after deployment?"
    ),
    antipattern: {
      id: "AP-F1", title: "Committee accountability without individual ownership",
      definition: "Governance bodies exist but no identifiable person is operationally accountable for the system.",
      severity: "HIGH", signal: "committee-accountability",
      indicators: ["The board owns it", "Unresolved tasks lack owners", "Business owner is absent", "Incidents expose responsibility confusion"],
      questions: antipatternQuestions("AP-F1", "Committee accountability without individual ownership", "Governance bodies exist but no identifiable person is operationally accountable for the system.", "unowned tasks, absent business owner, or incidents exposing responsibility confusion")
    }
  },
  {
    domain: "F", id: "F2",
    title: "Compliance evidence and documentation integrity",
    definition: "Material claims, requirements, controls and readiness conclusions are linked to current, scoped, attributable and sufficient evidence that matches implementation and operation.",
    applicability: "ALWAYS", severity: "HIGH",
    signals: ["evidence-register", "claim-linking", "evidence-freshness"],
    indicators: ["Requirement-to-evidence mapping", "Declarations separated from observations", "Missing and expired evidence visible", "Decision package is reproducible"],
    questions: questions("F2",
      "Are required evidence types, provenance, scope, freshness, owners and validation rules defined for each material claim?",
      "Are evidence capture, versioning, integrity, expiry, contradiction and claim-linking implemented?",
      "Can the decision package be reproduced and shown to reflect the current implemented and operated system?"
    ),
    antipattern: {
      id: "AP-F2", title: "Compliance by assertion or document volume",
      definition: "Documents and checkboxes create apparent assurance without demonstrating implementation or effectiveness.",
      severity: "CRITICAL", signal: "approval-without-evidence",
      indicators: ["Policy used as implementation proof", "Screenshots lack source or date", "Evidence copied across systems", "Green status despite unresolved controls"],
      questions: antipatternQuestions("AP-F2", "Compliance by assertion or document volume", "Documents and checkboxes create apparent assurance without demonstrating implementation or effectiveness.", "policy used as implementation proof, undated screenshots, or green status despite unresolved controls")
    }
  },
  {
    domain: "F", id: "F3",
    title: "Risk, control and residual-risk management",
    definition: "System-specific risks are linked to controls, evidence, owners, treatment criteria, residual uncertainty and authorized acceptance.",
    applicability: "ALWAYS", severity: "HIGH",
    signals: ["risk-register", "residual-risk", "risk-acceptance"],
    indicators: ["System-specific risk register", "Controls linked to acceptance criteria", "Residual risk and uncertainty visible", "Exceptions expire and acceptance is attributable"],
    questions: questions("F3",
      "Are inherent risk, treatment objectives, residual risk, tolerance and acceptance authority defined?",
      "Are controls, owners, deadlines, exceptions and acceptance criteria implemented and tracked?",
      "Does effectiveness evidence justify residual-risk status and any acceptance by an authorized human?"
    ),
    antipattern: {
      id: "AP-F3", title: "Risk inventory without risk control",
      definition: "Risks are listed but not operationally treated, tested, reassessed or accepted by the correct authority.",
      severity: "HIGH", signal: "risk-inventory-only",
      indicators: ["Generic risk list", "Mitigation is an intention", "Severity drops without evidence", "Expired exceptions remain active"],
      questions: antipatternQuestions("AP-F3", "Risk inventory without risk control", "Risks are listed but not operationally treated, tested, reassessed or accepted by the correct authority.", "generic risk lists, intended-only mitigations, or expired exceptions remaining active")
    }
  },
  {
    domain: "F", id: "F4",
    title: "Decision rights, authorization and escalation",
    definition: "The correct human authority makes timely, proportional and recorded lifecycle decisions, clearly separated from automated recommendations.",
    applicability: "ALWAYS", severity: "HIGH",
    signals: ["decision-rights", "authorization", "escalation"],
    indicators: ["Decision authority matrix", "AI recommendation separated from authorization", "Conditions and dissent are recorded", "Material change expires prior decisions"],
    questions: questions("F4",
      "Are decision types, delegated authority, quorum, escalation, service levels, expiry and separation from AI recommendation defined?",
      "Are asynchronous review, conditions, dissent, reminders, escalation and immutable decision records implemented?",
      "Do decision records show timely review by authorized people and enforcement of conditions before progression?"
    ),
    antipattern: {
      id: "AP-F4", title: "Calendar-driven or ambiguous governance decisions",
      definition: "Progress depends on periodic forums, silent assent or unclear authority, or automated recommendations are mistaken for approval.",
      severity: "HIGH", signal: "calendar-driven-decision",
      indicators: ["Routine decisions wait for a monthly forum", "Green output is treated as authorization", "Silence counts as approval", "Approval conditions are not tracked"],
      questions: antipatternQuestions("AP-F4", "Calendar-driven or ambiguous governance decisions", "Progress depends on periodic forums, silent assent or unclear authority, or automated recommendations are mistaken for approval.", "green output treated as authorization, silence counted as approval, or untracked approval conditions")
    }
  },
  {
    domain: "F", id: "F5",
    title: "Monitoring, incidents, change, re-evaluation and retirement",
    definition: "Quality, risk, security, impact and compliance are monitored; incidents and material changes trigger response, reassessment, reauthorization or controlled retirement.",
    applicability: "ALWAYS", severity: "HIGH",
    signals: ["monitoring-plan", "incident-response", "change-trigger", "retirement-plan"],
    indicators: ["Monitoring spans quality and risk", "Change triggers are codified", "Incidents create governance actions", "Retirement removes access and data while preserving decisions"],
    questions: questions("F5",
      "Are monitoring objectives, incident thresholds, material-change triggers, review cadence and retirement duties defined?",
      "Are telemetry, incident workflows, reassessment, rollback, decommissioning, deletion and vendor exit implemented?",
      "Do operational records show timely detection, response, reauthorization and complete retirement when required?"
    ),
    antipattern: {
      id: "AP-F5", title: "Approval-as-end-state governance",
      definition: "Governance effectively stops after initial approval while operation, change and retirement remain uncontrolled.",
      severity: "HIGH", signal: "missing-reassessment",
      indicators: ["No post-deployment monitoring", "Model changes bypass review", "Incidents are handled only technically", "Retired systems retain access, data or contracts"],
      questions: antipatternQuestions("AP-F5", "Approval-as-end-state governance", "Governance effectively stops after initial approval while operation, change and retirement remain uncontrolled.", "no post-deployment monitoring, model changes bypassing review, or retired systems retaining access")
    }
  }
]);

function compilePair(pair) {
  const requirement = {
    id: `REQ-${pair.id}`,
    domain: pair.domain,
    title: pair.title,
    sourceIds: [INTERNAL_SOURCE],
    authority: pair.authority === "LEGAL" || pair.authority === "PRIVACY" ? "MIXED" : "INTERNAL_PROCESS",
    lifecycleStages: STAGES,
    applicability: pair.applicability,
    interpretation: pair.definition,
    humanAuthority: pair.authority ?? "GOVERNANCE",
    authoringObjectId: pair.id,
    instrumentStatus: "LOADED",
    knowledgeBaseStatus: "NOT_PUBLISHED"
  };
  const control = {
    id: `CTRL-${pair.id}`,
    domain: pair.domain,
    title: pair.title,
    requirementIds: [`REQ-${pair.id}`],
    lifecycleStages: STAGES,
    targetState: "HUMAN_VALIDATED",
    severity: pair.severity,
    signals: pair.signals,
    authoringObjectId: pair.id,
    pairedObjectId: pair.antipattern.id,
    questions: pair.questions,
    indicators: pair.indicators,
    definition: pair.definition,
    instrumentStatus: "LOADED",
    knowledgeBaseStatus: "NOT_PUBLISHED",
    findingDefinitions: [],
    atomicSubcriteria: [],
    evidenceRules: null
  };
  const antipattern = {
    id: pair.antipattern.id,
    domain: pair.domain,
    title: pair.antipattern.title,
    severity: pair.antipattern.severity,
    signal: pair.antipattern.signal,
    signals: [pair.antipattern.signal],
    relatedControlIds: [`CTRL-${pair.id}`],
    lifecycleStages: STAGES,
    pairedObjectId: pair.id,
    definition: pair.antipattern.definition,
    questions: pair.antipattern.questions,
    indicators: pair.antipattern.indicators,
    instrumentStatus: "LOADED",
    knowledgeBaseStatus: "NOT_PUBLISHED",
    atomicTests: [],
    findingDefinitions: [],
    evidenceRules: null
  };
  return { requirement, control, antipattern };
}

export function compileAssessmentInstrument(pairs = ASSESSMENT_PAIRS) {
  const compiled = pairs.map(compilePair);
  return {
    version: ASSESSMENT_INSTRUMENT_VERSION,
    source: ASSESSMENT_INSTRUMENT_SOURCE,
    instrumentStatus: "LOADED",
    knowledgeBaseStatus: "NOT_PUBLISHED",
    requirements: Object.freeze(compiled.map((item) => item.requirement)),
    controls: Object.freeze(compiled.map((item) => item.control)),
    antipatterns: Object.freeze(compiled.map((item) => item.antipattern)),
    counts: {
      pairs: pairs.length,
      capabilities: compiled.length,
      antipatterns: compiled.length,
      questions: compiled.reduce((sum, item) => sum + item.control.questions.length + item.antipattern.questions.length, 0)
    }
  };
}

export const ASSESSMENT_INSTRUMENT = compileAssessmentInstrument();
export const REQUIREMENTS = ASSESSMENT_INSTRUMENT.requirements;
export const CONTROLS = ASSESSMENT_INSTRUMENT.controls;
export const ANTIPATTERNS = ASSESSMENT_INSTRUMENT.antipatterns;
