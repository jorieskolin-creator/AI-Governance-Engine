export const KNOWLEDGE_VERSION = "ai-governance-instrument-1.0.0-kb-unpublished";

export const NORMATIVE_SOURCES = Object.freeze([
  {
    id: "SRC-EU-AIA-2024-1689",
    title: "Regulation (EU) 2024/1689 - Artificial Intelligence Act",
    authority: "BINDING_LAW",
    jurisdiction: "EU",
    officialUrl: "https://eur-lex.europa.eu/eli/reg/2024/1689/oj/eng",
    effectiveFrom: "2024-08-01",
    effectiveUntil: null,
    approvalStatus: "APPROVED_SOURCE_METADATA",
    ownerAuthority: "LEGAL",
    notes: "Provision-level applicability and legal conclusions remain subject to current-version legal review."
  },
  {
    id: "SRC-EU-AIA-ARTICLE-50-GUIDANCE-2026",
    title: "Commission guidelines on transparency obligations under Article 50",
    authority: "REGULATORY_GUIDANCE",
    jurisdiction: "EU",
    officialUrl: "https://digital-strategy.ec.europa.eu/en/library/guidelines-transparency-obligations-providers-and-deployers-ai-systems",
    effectiveFrom: "2026-07-20",
    effectiveUntil: null,
    approvalStatus: "APPROVED_SOURCE_METADATA",
    ownerAuthority: "LEGAL",
    notes: "Final guidance; it does not replace the binding legal text."
  },
  {
    id: "SRC-EU-AIA-HIGH-RISK-DRAFT-GUIDANCE-2026",
    title: "Draft Commission guidelines on classification of high-risk AI systems",
    authority: "DRAFT_REGULATORY_GUIDANCE",
    jurisdiction: "EU",
    officialUrl: "https://digital-strategy.ec.europa.eu/en/library/draft-commission-guidelines-classification-high-risk-ai-systems",
    effectiveFrom: null,
    effectiveUntil: null,
    approvalStatus: "DRAFT_SOURCE_METADATA",
    ownerAuthority: "LEGAL",
    notes: "Draft guidance must never be represented as final or binding."
  },
  {
    id: "SRC-EU-AI-ACT-2024-1689-OMNIBUS-2026",
    title: "EU Artificial Intelligence Act - operational baseline after AI Omnibus",
    authority: "BINDING_LAW",
    jurisdiction: "EU",
    officialUrl: "https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai",
    effectiveFrom: "2026-07-27",
    effectiveUntil: null,
    approvalStatus: "PILOT_REVIEW_REQUIRED",
    ownerAuthority: "LEGAL",
    notes: "Pilot metadata. Provision-level interpretations require Legal approval."
  },
  {
    id: "SRC-EU-GDPR-2016-679",
    title: "General Data Protection Regulation",
    authority: "BINDING_LAW",
    jurisdiction: "EU",
    officialUrl: "https://eur-lex.europa.eu/eli/reg/2016/679/oj",
    effectiveFrom: "2018-05-25",
    effectiveUntil: null,
    approvalStatus: "PILOT_REVIEW_REQUIRED",
    ownerAuthority: "PRIVACY",
    notes: "Applicability and lawful-basis conclusions require Privacy or Legal validation."
  },
  {
    id: "SRC-INTERNAL-AI-GOVERNANCE-GUIDELINE-2026",
    title: "Internal AI Governance Process",
    authority: "INTERNAL_PROCESS",
    jurisdiction: "INTERNAL",
    officialUrl: "internal://organization/ai-governance-process",
    effectiveFrom: "2026-01-01",
    effectiveUntil: null,
    approvalStatus: "PILOT_REVIEW_REQUIRED",
    ownerAuthority: "GOVERNANCE",
    notes: "Lifecycle and decision-process source; not a substitute for legislation."
  },
  {
    id: "SRC-ISO-IEC-42001-2023",
    title: "ISO/IEC 42001:2023 AI management systems",
    authority: "STANDARD",
    jurisdiction: "INTERNATIONAL",
    officialUrl: "https://www.iso.org/standard/42001",
    effectiveFrom: "2023-12-18",
    effectiveUntil: null,
    approvalStatus: "PILOT_REVIEW_REQUIRED",
    ownerAuthority: "GOVERNANCE",
    notes: "Not binding law unless incorporated by policy or contract."
  },
  {
    id: "SRC-ISO-IEC-23894-2023",
    title: "ISO/IEC 23894:2023 AI risk management guidance",
    authority: "STANDARD",
    jurisdiction: "INTERNATIONAL",
    officialUrl: "https://www.iso.org/standard/77304.html",
    effectiveFrom: "2023-02-06",
    effectiveUntil: null,
    approvalStatus: "PILOT_REVIEW_REQUIRED",
    ownerAuthority: "GOVERNANCE",
    notes: "Risk-management guidance, not binding legislation."
  },
  {
    id: "SRC-NIST-AI-RMF-1-GAI",
    title: "NIST AI RMF and Generative AI Profile",
    authority: "VOLUNTARY_FRAMEWORK",
    jurisdiction: "INTERNATIONAL",
    officialUrl: "https://www.nist.gov/itl/ai-risk-management-framework",
    effectiveFrom: "2024-07-26",
    effectiveUntil: null,
    approvalStatus: "PILOT_REVIEW_REQUIRED",
    ownerAuthority: "GOVERNANCE",
    notes: "Voluntary framework; never report as binding law."
  },
  {
    id: "SRC-OWASP-AGENTIC-2026",
    title: "OWASP Agentic Security Initiative",
    authority: "INDUSTRY_GUIDANCE",
    jurisdiction: "INTERNATIONAL",
    officialUrl: "https://genai.owasp.org/initiatives/agentic-security-initiative/",
    effectiveFrom: "2026-01-01",
    effectiveUntil: null,
    approvalStatus: "PILOT_REVIEW_REQUIRED",
    ownerAuthority: "SECURITY",
    notes: "Security guidance and evaluation input, not legal authority."
  }
]);
