const ACT_SOURCE = "SRC-EU-AIA-2024-1689";
const TRANSPARENCY_SOURCE = "SRC-EU-AIA-ARTICLE-50-GUIDANCE-2026";
const HIGH_RISK_GUIDANCE = "SRC-EU-AIA-HIGH-RISK-DRAFT-GUIDANCE-2026";

const act = (locator, rationale) => ({ sourceId: ACT_SOURCE, locator, authorityType: "BINDING_LAW", effectiveStatus: "IN_FORCE", rationale });
const transparency = (locator, rationale) => ({ sourceId: TRANSPARENCY_SOURCE, locator, authorityType: "REGULATORY_GUIDANCE", effectiveStatus: "FINAL", rationale });
const highRisk = (locator, rationale) => ({ sourceId: HIGH_RISK_GUIDANCE, locator, authorityType: "DRAFT_REGULATORY_GUIDANCE", effectiveStatus: "DRAFT", rationale });

export const INTAKE_QUESTIONNAIRE_VERSION = "intake-questionnaire-1.0.0";

export const INTAKE_QUESTIONNAIRE = Object.freeze({
  id: "QUESTIONNAIRE-EU-AI-SCOPE-1",
  version: INTAKE_QUESTIONNAIRE_VERSION,
  releaseStatus: "APPROVED_STRUCTURE_OFFICIAL_SOURCES_REQUIRE_CURRENT_LEGAL_REVIEW",
  defaultAnswerState: "UNKNOWN",
  negativeAnswerPolicy: "A negative declaration does not clear applicability or a gate without supporting evidence or a named human classification.",
  sections: [
    { id: "SYSTEM", title: "AI system and solution boundary", description: "Establish what is being assessed before determining regulatory scope." },
    { id: "ACTOR", title: "Regulatory role and territorial scope", description: "Identify every role and scope trigger; one organization may hold several roles." },
    { id: "RISK", title: "Risk-classification screening", description: "Screen product routes, listed use areas and exception conditions without issuing a legal classification." },
    { id: "PROHIBITED", title: "Prohibited-practice screening", description: "Select every potentially relevant practice. Silence is Unknown, not absence." },
    { id: "TRANSPARENCY", title: "Transparency and public-impact screening", description: "Identify transparency and fundamental-rights assessment triggers." }
  ],
  questions: [
    {
      id: "AI_SYSTEM_QUALIFICATION", sectionId: "SYSTEM", fieldId: "qualification.aiSystem", type: "SINGLE",
      prompt: "Does the assessed solution potentially meet the definition of an AI system?", help: "Choose Human review required if the system boundary or definition remains ambiguous.",
      options: ["YES", "NO", "UNKNOWN", "HUMAN_REVIEW_REQUIRED"], humanDecisionAuthority: "LEGAL_AND_GOVERNANCE", negativeAnswerRequiresEvidence: true,
      sourceMappings: [act("Article 3(1)", "Defines an AI system.")]
    },
    {
      id: "SYSTEM_TYPES", sectionId: "SYSTEM", fieldId: "qualification.systemTypes", type: "MULTI",
      prompt: "Which technical modes are inside the assessed boundary?", options: ["PREDICTIVE", "GENERATIVE", "AGENTIC", "RULE_BASED_COMPONENT", "GENERAL_PURPOSE_MODEL", "OTHER", "NONE_OF_THE_ABOVE", "UNKNOWN"],
      humanDecisionAuthority: "SOLUTION_OWNER", negativeAnswerRequiresEvidence: false, sourceMappings: []
    },
    {
      id: "REGULATORY_ROLES", sectionId: "ACTOR", fieldId: "roles", type: "MULTI",
      prompt: "Which regulatory roles may apply to the organization for this solution?", options: ["PROVIDER", "DEPLOYER", "IMPORTER", "DISTRIBUTOR", "PRODUCT_MANUFACTURER", "AUTHORISED_REPRESENTATIVE", "GENERAL_PURPOSE_MODEL_PROVIDER", "OTHER", "NONE_OF_THE_ABOVE", "UNKNOWN"],
      humanDecisionAuthority: "LEGAL_AND_GOVERNANCE", negativeAnswerRequiresEvidence: true, sourceMappings: [act("Article 3; Articles 16-27; Articles 51-55", "Defines operators and their role-specific obligations.")]
    },
    ...[
      ["ROLE_REBRANDING", "roleChange.rebranding", "Will the system be placed on the market or put into service under a different name or trademark?"],
      ["ROLE_CHANGED_PURPOSE", "roleChange.changedPurpose", "Has another party changed, or will it change, the intended purpose?"],
      ["ROLE_SUBSTANTIAL_MODIFICATION", "roleChange.substantialModification", "Has another party made, or will it make, a substantial modification?"]
    ].map(([id, fieldId, prompt]) => ({ id, sectionId: "ACTOR", fieldId, type: "SINGLE", prompt, options: ["YES", "NO", "UNKNOWN", "NOT_APPLICABLE", "HUMAN_REVIEW_REQUIRED"], humanDecisionAuthority: "LEGAL_AND_GOVERNANCE", negativeAnswerRequiresEvidence: true, sourceMappings: [act("Article 25", "Identifies circumstances in which responsibilities may transfer.")] })),
    ...[
      ["EU_MARKET_OR_SERVICE", "territorialScope.euMarketOrService", "Will the system be placed on the market or put into service in the EU?"],
      ["EU_ESTABLISHED_ACTOR", "territorialScope.euEstablishedActor", "Is a relevant provider or deployer established or located in the EU?"],
      ["EU_OUTPUT_USED", "territorialScope.euOutputUsed", "Will output produced by the system be used in the EU?"],
      ["EU_IMPORT_TRIGGER", "territorialScope.euImportTrigger", "Is an importer or other EU operator placing a non-EU system on the EU market?"]
    ].map(([id, fieldId, prompt]) => ({ id, sectionId: "ACTOR", fieldId, type: "SINGLE", prompt, options: ["YES", "NO", "UNKNOWN", "NOT_APPLICABLE", "HUMAN_REVIEW_REQUIRED"], humanDecisionAuthority: "LEGAL", negativeAnswerRequiresEvidence: true, sourceMappings: [act("Article 2", "Defines territorial and material scope.")] })),
    {
      id: "SCOPE_EXCLUSIONS", sectionId: "ACTOR", fieldId: "territorialScope.exclusions", type: "MULTI",
      prompt: "Is any limited scope exclusion potentially relevant?", options: ["MILITARY_DEFENCE_OR_NATIONAL_SECURITY", "RESEARCH_DEVELOPMENT_BEFORE_MARKET", "PERSONAL_NON_PROFESSIONAL_ACTIVITY", "QUALIFYING_FREE_OPEN_SOURCE", "THIRD_COUNTRY_PUBLIC_AUTHORITY_COOPERATION", "OTHER", "NONE_OF_THE_ABOVE", "UNKNOWN"],
      humanDecisionAuthority: "LEGAL", negativeAnswerRequiresEvidence: true, sourceMappings: [act("Article 2", "Contains limited scope exclusions and conditions.")]
    },
    ...[
      ["PRODUCT_SAFETY_COMPONENT", "risk.productSafetyComponent", "Is the AI system a safety component of a regulated product?"],
      ["ANNEX_I_PRODUCT", "risk.annexIProduct", "Is the system itself, or the product containing it, covered by the product-safety legislation listed in Annex I?"],
      ["THIRD_PARTY_CONFORMITY", "risk.thirdPartyConformity", "Does the relevant product require third-party conformity assessment?"]
    ].map(([id, fieldId, prompt]) => ({ id, sectionId: "RISK", fieldId, type: "SINGLE", prompt, options: ["YES", "NO", "UNKNOWN", "NOT_APPLICABLE", "HUMAN_REVIEW_REQUIRED"], humanDecisionAuthority: "LEGAL_AND_GOVERNANCE", negativeAnswerRequiresEvidence: true, sourceMappings: [act("Article 6(1) and Annex I", "Defines one route into high-risk classification.")] })),
    {
      id: "ANNEX_III_USE_AREAS", sectionId: "RISK", fieldId: "risk.annexIIIUseAreas", type: "MULTI",
      prompt: "Does the intended use fall within any listed high-risk use area?", options: ["BIOMETRICS", "CRITICAL_INFRASTRUCTURE", "EDUCATION_OR_VOCATIONAL_TRAINING", "EMPLOYMENT_AND_WORKER_MANAGEMENT", "ESSENTIAL_SERVICES_OR_BENEFITS", "LAW_ENFORCEMENT", "MIGRATION_ASYLUM_OR_BORDER_CONTROL", "JUSTICE_OR_DEMOCRATIC_PROCESSES", "OTHER", "NONE_OF_THE_ABOVE", "UNKNOWN"],
      humanDecisionAuthority: "LEGAL_AND_GOVERNANCE", negativeAnswerRequiresEvidence: true, sourceMappings: [act("Article 6(2) and Annex III", "Lists high-risk use areas."), highRisk("Classification analysis", "Provides non-binding draft interpretation that must be version-labelled.")]
    },
    {
      id: "HIGH_RISK_EXCEPTION_INDICATORS", sectionId: "RISK", fieldId: "risk.exceptionIndicators", type: "MULTI",
      prompt: "Is an Article 6(3) exception indicator being considered?", options: ["NARROW_PROCEDURAL_TASK", "IMPROVES_COMPLETED_HUMAN_ACTIVITY", "PATTERN_DETECTION_WITHOUT_REPLACEMENT_OR_INFLUENCE", "PREPARATORY_TASK", "NONE_OF_THE_ABOVE", "UNKNOWN"],
      humanDecisionAuthority: "LEGAL_AND_GOVERNANCE", negativeAnswerRequiresEvidence: true, sourceMappings: [act("Article 6(3)", "Defines limited conditions relevant to certain Annex III systems.")]
    },
    {
      id: "NATURAL_PERSON_PROFILING", sectionId: "RISK", fieldId: "risk.naturalPersonProfiling", type: "SINGLE",
      prompt: "Does the system perform profiling of natural persons in a listed high-risk context?", options: ["YES", "NO", "UNKNOWN", "NOT_APPLICABLE", "HUMAN_REVIEW_REQUIRED"],
      humanDecisionAuthority: "LEGAL_AND_PRIVACY", negativeAnswerRequiresEvidence: true, sourceMappings: [act("Article 6(3)", "Profiling affects the availability of the limited exception.")]
    },
    {
      id: "PROHIBITED_PRACTICE_CATEGORIES", sectionId: "PROHIBITED", fieldId: "classification.prohibitedPracticeCategories", type: "MULTI",
      prompt: "Could the intended or technically reachable use involve any prohibited-practice category?", options: ["HARMFUL_MANIPULATION_OR_DECEPTION", "EXPLOITATION_OF_VULNERABILITY", "SOCIAL_SCORING", "PREDICTIVE_POLICING_BASED_ONLY_ON_PROFILING_OR_TRAITS", "UNTARGETED_FACIAL_IMAGE_SCRAPING", "EMOTION_INFERENCE_AT_WORK_OR_EDUCATION", "SENSITIVE_BIOMETRIC_CATEGORISATION", "REAL_TIME_REMOTE_BIOMETRIC_IDENTIFICATION", "OTHER", "NONE_OF_THE_ABOVE", "UNKNOWN"],
      humanDecisionAuthority: "LEGAL_AND_GOVERNANCE", negativeAnswerRequiresEvidence: true, sourceMappings: [act("Article 5", "Lists prohibited AI practices and limited exceptions.")]
    },
    {
      id: "TRANSPARENCY_TRIGGERS", sectionId: "TRANSPARENCY", fieldId: "transparency.triggers", type: "MULTI",
      prompt: "Which transparency triggers may apply?", options: ["DIRECT_HUMAN_INTERACTION", "SYNTHETIC_AUDIO_IMAGE_VIDEO_OR_TEXT", "DEEPFAKE", "PUBLIC_INTEREST_TEXT", "EMOTION_RECOGNITION", "BIOMETRIC_CATEGORISATION", "OTHER", "NONE_OF_THE_ABOVE", "UNKNOWN"],
      humanDecisionAuthority: "LEGAL_AND_GOVERNANCE", negativeAnswerRequiresEvidence: true, sourceMappings: [act("Article 50", "Defines transparency obligations for specified systems and content."), transparency("Article 50 guidance", "Provides final implementation guidance and examples.")]
    },
    ...[
      ["PUBLIC_AUTHORITY_OR_BODY", "publicImpact.publicAuthority", "Will the system be deployed by, or on behalf of, a public-law body?"],
      ["PUBLIC_SERVICE_DELIVERY", "publicImpact.publicService", "Will the system support delivery of public services or other decisions materially affecting fundamental rights?"],
      ["FRIA_CANDIDATE", "publicImpact.friaCandidate", "Could a fundamental-rights impact assessment be required before deployment?"]
    ].map(([id, fieldId, prompt]) => ({ id, sectionId: "TRANSPARENCY", fieldId, type: "SINGLE", prompt, options: ["YES", "NO", "UNKNOWN", "NOT_APPLICABLE", "HUMAN_REVIEW_REQUIRED"], humanDecisionAuthority: "LEGAL_AND_GOVERNANCE", negativeAnswerRequiresEvidence: true, sourceMappings: [act("Article 27", "Defines fundamental-rights impact assessment requirements for specified deployers and systems.")] })),
    ...[
      ["GENERAL_PURPOSE_MODEL_PROVIDER", "generalPurpose.provider", "Does the assessed organization place or provide a general-purpose AI model?"],
      ["SYSTEMIC_RISK_MODEL", "generalPurpose.systemicRisk", "Could the general-purpose model meet the systemic-risk conditions?"]
    ].map(([id, fieldId, prompt], index) => ({ id, sectionId: "RISK", fieldId, type: "SINGLE", prompt, options: ["YES", "NO", "UNKNOWN", "NOT_APPLICABLE", "HUMAN_REVIEW_REQUIRED"], showWhen: index ? { questionId: "GENERAL_PURPOSE_MODEL_PROVIDER", answerStates: ["YES", "HUMAN_REVIEW_REQUIRED"] } : undefined, humanDecisionAuthority: "LEGAL_AND_GOVERNANCE", negativeAnswerRequiresEvidence: true, sourceMappings: [act("Articles 51-55", "Defines classification and obligations for general-purpose models, including systemic risk.")] }))
  ]
});
