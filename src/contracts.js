import { sanitizeRestrictedText, sanitizeRestrictedValue } from "../public/content-policy.js";

export const DOMAINS = Object.freeze({
  A: "Purpose, context, value, roles and AI classification",
  B: "Data, privacy, confidentiality and intellectual property",
  C: "Models, agents, providers, tools and supply chain",
  D: "Architecture, security, robustness, safety and evaluation",
  E: "Human impact, fairness, transparency and meaningful oversight",
  F: "Accountability, compliance evidence, decisions and lifecycle governance"
});

export const LIFECYCLE_STAGES = Object.freeze([
  "QUALIFICATION_AND_REGISTRATION",
  "DESIGN_AND_DEVELOPMENT",
  "VERIFICATION_AND_VALIDATION",
  "DEPLOYMENT",
  "OPERATION_AND_MONITORING",
  "REVIEW_AND_EVALUATION",
  "RETIREMENT"
]);

export const ASSURANCE_STATES = Object.freeze([
  "UNKNOWN",
  "DECLARED",
  "IMPLEMENTED",
  "TESTED",
  "OPERATIONALLY_OBSERVED",
  "HUMAN_VALIDATED",
  "FORMALLY_APPROVED",
  "NOT_APPLICABLE"
]);

export const ANTIPATTERN_STATES = Object.freeze([
  "UNKNOWN",
  "DECLARED_RISK",
  "DETECTED_CANDIDATE",
  "VERIFICATION_REQUIRED",
  "CONFIRMED_PRESENT",
  "PARTIALLY_PRESENT",
  "TESTED_ABSENT"
]);

export const READINESS_OUTCOMES = Object.freeze([
  "READY_FOR_NEXT_STAGE",
  "READY_WITH_CONDITIONS",
  "REMEDIATE_BEFORE_NEXT_STAGE",
  "HUMAN_REVIEW_REQUIRED",
  "BLOCKED_IN_CURRENT_FORM"
]);

export const EVIDENCE_KINDS = Object.freeze([
  "DECLARATION",
  "DOCUMENT",
  "CODE",
  "CONFIGURATION",
  "TEST",
  "SCAN_RESULT",
  "PENETRATION_TEST",
  "OPERATIONAL_LOG",
  "MONITORING_RECORD",
  "HUMAN_REVIEW",
  "FORMAL_APPROVAL"
]);

export const HUMAN_AUTHORITIES = Object.freeze([
  "SOLUTION_OWNER",
  "LEGAL",
  "PRIVACY",
  "SECURITY",
  "GOVERNANCE",
  "AI_FORUM",
  "AI_BOARD"
]);

export const SEVERITIES = Object.freeze(["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"]);

export const BOUNDARY_ENVIRONMENTS = Object.freeze([
  "UNKNOWN",
  "ISOLATED_SANDBOX",
  "CONTROLLED_PILOT",
  "PRODUCTION"
]);

export const USER_ACCESS_MODES = Object.freeze([
  "UNKNOWN",
  "INTERNAL_ONLY",
  "EXTERNAL_WITH_SOLUTION_OWNER",
  "CONTROLLED_EXTERNAL_PILOT",
  "RESTRICTED_CUSTOMER_USE",
  "PUBLIC_ACCESS",
  "EXTERNAL_UNSPECIFIED"
]);

export const DATA_CATEGORIES = Object.freeze([
  "SYNTHETIC",
  "PUBLIC_NON_PERSONAL",
  "ANONYMIZED",
  "PSEUDONYMIZED",
  "CLEANED_APPROVED_PRODUCTION",
  "RAW_PRODUCTION",
  "PERSONAL_DATA",
  "SPECIAL_CATEGORY_DATA",
  "CONFIDENTIAL_OR_PROPRIETARY"
]);

export const INTAKE_ANSWER_STATES = Object.freeze(["YES", "NO", "UNKNOWN", "NOT_APPLICABLE", "HUMAN_REVIEW_REQUIRED"]);
export const INTAKE_FACT_ORIGINS = Object.freeze(["OBSERVED", "AI_CANDIDATE", "USER_DECLARED", "HUMAN_CLASSIFIED"]);
export const INTAKE_SUPPORT_STATUSES = Object.freeze(["SUPPORTED", "PARTIAL", "UNSUPPORTED", "CONFLICTING", "NOT_CHECKED"]);

export const STATE_WEIGHT = Object.freeze({
  UNKNOWN: 0,
  DECLARED: 0.15,
  IMPLEMENTED: 0.45,
  TESTED: 0.7,
  OPERATIONALLY_OBSERVED: 0.82,
  HUMAN_VALIDATED: 0.92,
  FORMALLY_APPROVED: 1,
  NOT_APPLICABLE: 1
});

export function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function enumValue(value, allowed, field) {
  invariant(allowed.includes(value), `${field} must be one of: ${allowed.join(", ")}`);
  return value;
}

function booleanValue(value, field) {
  invariant(value === null || typeof value === "boolean", `${field} must be boolean or null when unknown`);
  return value;
}

function optionalString(value, field) {
  invariant(value === undefined || value === null || typeof value === "string", `${field} must be a string`);
  return typeof value === "string" ? sanitizeRestrictedText(value.trim()) : "";
}

function optionalStringArray(value, field) {
  invariant(value === undefined || (Array.isArray(value) && value.every((item) => typeof item === "string")), `${field} must be an array of strings`);
  return [...new Set((value ?? []).map((item) => sanitizeRestrictedText(item.trim())).filter(Boolean))];
}

function validateIntakeAnswers(value) {
  invariant(value === undefined || (value && typeof value === "object" && !Array.isArray(value)), "dossier.intakeAnswers must be an object");
  const entries = {};
  for (const [questionId, answer] of Object.entries(value ?? {})) {
    invariant(/^[A-Z0-9][A-Z0-9_-]{2,80}$/.test(questionId), `Invalid intake question ID: ${questionId}`);
    invariant(answer && typeof answer === "object" && !Array.isArray(answer), `dossier.intakeAnswers.${questionId} must be an object`);
    const answerState = answer.answerState ?? "UNKNOWN";
    enumValue(answerState, INTAKE_ANSWER_STATES, `dossier.intakeAnswers.${questionId}.answerState`);
    const values = optionalStringArray(answer.values, `dossier.intakeAnswers.${questionId}.values`);
    entries[questionId] = {
      answerState,
      values,
      origin: INTAKE_FACT_ORIGINS.includes(answer.origin) ? answer.origin : "USER_DECLARED",
      supportStatus: INTAKE_SUPPORT_STATUSES.includes(answer.supportStatus) ? answer.supportStatus : "NOT_CHECKED",
      sourceUnitIds: optionalStringArray(answer.sourceUnitIds, `dossier.intakeAnswers.${questionId}.sourceUnitIds`),
      evidenceLinks: Array.isArray(answer.evidenceLinks) ? sanitizeRestrictedValue(structuredClone(answer.evidenceLinks)) : [],
      limitations: optionalStringArray(answer.limitations, `dossier.intakeAnswers.${questionId}.limitations`),
      confirmedBy: optionalString(answer.confirmedBy, `dossier.intakeAnswers.${questionId}.confirmedBy`) || null,
      confirmedAt: optionalString(answer.confirmedAt, `dossier.intakeAnswers.${questionId}.confirmedAt`) || null
    };
  }
  return entries;
}

export function validateDossier(input) {
  invariant(input && typeof input === "object", "dossier is required");
  for (const field of ["name", "intendedPurpose", "expectedValue", "accountableOwner"]) {
    invariant(input[field] === undefined || typeof input[field] === "string", `dossier.${field} must be a string`);
  }
  const declaredCurrentStage = input.currentStage ?? "UNKNOWN";
  const declaredTargetStage = input.targetStage ?? "UNKNOWN";
  invariant(declaredCurrentStage === "UNKNOWN" || LIFECYCLE_STAGES.includes(declaredCurrentStage), "dossier.currentStage is invalid");
  invariant(declaredTargetStage === "UNKNOWN" || LIFECYCLE_STAGES.includes(declaredTargetStage), "dossier.targetStage is invalid");
  const currentStage = declaredCurrentStage === "UNKNOWN" ? "QUALIFICATION_AND_REGISTRATION" : declaredCurrentStage;
  const targetStage = declaredTargetStage === "UNKNOWN" ? "DESIGN_AND_DEVELOPMENT" : declaredTargetStage;
  if (declaredCurrentStage !== "UNKNOWN" && declaredTargetStage !== "UNKNOWN") invariant(LIFECYCLE_STAGES.indexOf(targetStage) >= LIFECYCLE_STAGES.indexOf(currentStage), "targetStage cannot precede currentStage");
  invariant(input.jurisdictions === undefined || Array.isArray(input.jurisdictions), "dossier.jurisdictions must be an array");
  invariant(input.roles === undefined || Array.isArray(input.roles), "dossier.roles must be an array");
  invariant(input.users === undefined || Array.isArray(input.users), "dossier.users must be an array");
  for (const [group, fields] of Object.entries({
    data: ["personalData", "specialCategoryData", "productionData"],
    exposure: ["externalUsers", "productionAccess", "consequentialDecisions"],
    agent: ["usesAgents", "canTakeActions", "irreversibleActions", "humanOverride"],
    classification: ["prohibitedPractice", "highRiskCandidate"]
  })) {
    invariant(input[group] === undefined || (input[group] && typeof input[group] === "object"), `dossier.${group} must be an object`);
    for (const field of fields) booleanValue(input[group]?.[field] ?? null, `dossier.${group}.${field}`);
  }
  const rawBoundary = input.operatingBoundary ?? {};
  invariant(rawBoundary && typeof rawBoundary === "object", "dossier.operatingBoundary must be an object");
  const environment = rawBoundary.environment ?? "UNKNOWN";
  enumValue(environment, BOUNDARY_ENVIRONMENTS, "dossier.operatingBoundary.environment");
  const expiresAt = optionalString(rawBoundary.expiresAt, "dossier.operatingBoundary.expiresAt");
  if (expiresAt) invariant(!Number.isNaN(Date.parse(expiresAt)), "dossier.operatingBoundary.expiresAt must be an ISO date or date-time");
  const dataCategories = optionalStringArray(input.data?.categories, "dossier.data.categories");
  for (const category of dataCategories) enumValue(category, DATA_CATEGORIES, "dossier.data.categories[]");
  const currentUserAccess = input.exposure?.currentUserAccess ?? (input.exposure?.externalUsers === false ? "INTERNAL_ONLY" : "UNKNOWN");
  const intendedUserAccess = input.exposure?.intendedUserAccess ?? (input.exposure?.externalUsers === true ? "EXTERNAL_UNSPECIFIED" : input.exposure?.externalUsers === false ? "INTERNAL_ONLY" : "UNKNOWN");
  enumValue(currentUserAccess, USER_ACCESS_MODES, "dossier.exposure.currentUserAccess");
  enumValue(intendedUserAccess, USER_ACCESS_MODES, "dossier.exposure.intendedUserAccess");
  const categorizedPersonal = dataCategories.includes("PERSONAL_DATA") || dataCategories.includes("SPECIAL_CATEGORY_DATA") || dataCategories.includes("PSEUDONYMIZED");
  const categorizedProduction = dataCategories.includes("CLEANED_APPROVED_PRODUCTION") || dataCategories.includes("RAW_PRODUCTION");
  const categorizedExternal = !["UNKNOWN", "INTERNAL_ONLY"].includes(intendedUserAccess);
  const intakeAnswers = validateIntakeAnswers(input.intakeAnswers);
  const regulatoryRoleValues = intakeAnswers.REGULATORY_ROLES?.values?.filter((item) => !["UNKNOWN", "NONE_OF_THE_ABOVE", "OTHER"].includes(item)) ?? [];
  const prohibitedAnswer = intakeAnswers.PROHIBITED_PRACTICE_CATEGORIES;
  const highRiskAnswers = [intakeAnswers.ANNEX_III_USE_AREAS, intakeAnswers.PRODUCT_SAFETY_COMPONENT, intakeAnswers.ANNEX_I_PRODUCT, intakeAnswers.THIRD_PARTY_CONFORMITY];
  const derivedProhibited = prohibitedAnswer?.answerState === "YES" ? true : prohibitedAnswer?.answerState === "NO" ? false : null;
  const derivedHighRisk = highRiskAnswers.some((answer) => answer?.answerState === "YES") ? true : highRiskAnswers.every((answer) => answer?.answerState === "NO" || answer?.answerState === "NOT_APPLICABLE") ? false : null;

  return {
    ...structuredClone(input),
    name: optionalString(input.name, "dossier.name"),
    intendedPurpose: optionalString(input.intendedPurpose, "dossier.intendedPurpose"),
    expectedValue: optionalString(input.expectedValue, "dossier.expectedValue"),
    accountableOwner: optionalString(input.accountableOwner, "dossier.accountableOwner"),
    currentStage,
    targetStage,
    lifecycleDeclaration: { currentStage: declaredCurrentStage, targetStage: declaredTargetStage, provisional: declaredCurrentStage === "UNKNOWN" || declaredTargetStage === "UNKNOWN" },
    jurisdictions: optionalStringArray(input.jurisdictions, "dossier.jurisdictions"),
    roles: optionalStringArray(input.roles, "dossier.roles").length ? optionalStringArray(input.roles, "dossier.roles") : regulatoryRoleValues,
    users: optionalStringArray(input.users, "dossier.users"),
    data: {
      categories: dataCategories,
      personalData: input.data?.personalData ?? (dataCategories.length ? categorizedPersonal : null),
      specialCategoryData: input.data?.specialCategoryData ?? (dataCategories.length ? dataCategories.includes("SPECIAL_CATEGORY_DATA") : null),
      productionData: input.data?.productionData ?? (dataCategories.length ? categorizedProduction : null)
    },
    exposure: {
      currentUserAccess,
      intendedUserAccess,
      externalUsers: input.exposure?.externalUsers ?? (intendedUserAccess === "UNKNOWN" ? null : categorizedExternal),
      productionAccess: input.exposure?.productionAccess ?? null,
      consequentialDecisions: input.exposure?.consequentialDecisions ?? null
    },
    agent: Object.fromEntries(["usesAgents", "canTakeActions", "irreversibleActions", "humanOverride"].map((field) => [field, input.agent?.[field] ?? null])),
    classification: {
      prohibitedPractice: input.classification?.prohibitedPractice ?? derivedProhibited,
      highRiskCandidate: input.classification?.highRiskCandidate ?? derivedHighRisk
    },
    intakeAnswers,
    operatingBoundary: {
      allowedUses: optionalStringArray(rawBoundary.allowedUses, "dossier.operatingBoundary.allowedUses"),
      excludedUses: optionalStringArray(rawBoundary.excludedUses, "dossier.operatingBoundary.excludedUses"),
      environment,
      userScope: optionalString(rawBoundary.userScope, "dossier.operatingBoundary.userScope"),
      dataScope: optionalString(rawBoundary.dataScope, "dossier.operatingBoundary.dataScope"),
      integrationScope: optionalString(rawBoundary.integrationScope, "dossier.operatingBoundary.integrationScope"),
      permissionScope: optionalString(rawBoundary.permissionScope, "dossier.operatingBoundary.permissionScope"),
      autonomyScope: optionalString(rawBoundary.autonomyScope, "dossier.operatingBoundary.autonomyScope"),
      monitoringOwner: optionalString(rawBoundary.monitoringOwner, "dossier.operatingBoundary.monitoringOwner"),
      expiresAt: expiresAt || null
    }
  };
}

export function validateSources(sources) {
  invariant(Array.isArray(sources), "sources must be an array");
  return sources.map((source, index) => {
    invariant(source && typeof source === "object", `sources[${index}] must be an object`);
    invariant(typeof source.path === "string" && source.path.trim(), `sources[${index}].path is required`);
    invariant(typeof source.content === "string", `sources[${index}].content must be text`);
    const kind = source.kind ?? inferEvidenceKind(source.path);
    enumValue(kind, EVIDENCE_KINDS, `sources[${index}].kind`);
    return { path: normalizePath(source.path), content: source.content, kind, metadata: source.metadata ?? {} };
  });
}

export function inferEvidenceKind(path) {
  const lower = path.toLowerCase();
  if (/test|spec|evaluation|evals/.test(lower)) return "TEST";
  if (/penetration|pentest|red[-_ ]?team/.test(lower)) return "PENETRATION_TEST";
  if (/monitor|telemetry|observability|incident|runtime/.test(lower)) return "MONITORING_RECORD";
  if (/review|assessment|sign[-_ ]?off/.test(lower)) return "HUMAN_REVIEW";
  if (/approval|decision[-_ ]?record/.test(lower)) return "FORMAL_APPROVAL";
  if (/\.env|\.ya?ml$|\.json$|\.toml$|\.ini$|\.xml$|\.(?:properties|conf|cfg|gradle|kts|tf)$|docker|terraform/.test(lower)) return "CONFIGURATION";
  if (/\.(js|mjs|cjs|ts|tsx|jsx|py|java|go|rs|rb|php|cs|sql|sh|bash|zsh|fish|ps1|psm1|bat|cmd|c|cc|cpp|cxx|h|hh|hpp|kt|swift|scala|groovy|graphql|gql|prisma|proto|vue|svelte|astro)$/.test(lower)) return "CODE";
  return "DOCUMENT";
}

export function classifyArtifact(path, metadata = {}) {
  if (metadata.artifactClass) return metadata.artifactClass;
  const lower = normalizePath(path).toLowerCase();
  if (/(^|\/)(?:node_modules|vendor|third_party|dist|build|coverage|generated|outputs?|out|\.next|target)(\/|$)/.test(lower) || /(?:package-lock|pnpm-lock|yarn\.lock)$/.test(lower)) return "DEPENDENCY_OR_GENERATED";
  if (/(^|\/)(?:fixtures?|mocks?|examples?|samples?)(\/|$)/.test(lower)) return "FIXTURE_OR_EXAMPLE";
  if (/(^|\/)(?:test|tests|spec|specs|__tests__)(\/|$)/.test(lower) || /(^|\/)(?:test|spec)[._-][^/]+$/.test(lower) || /(?:^|[._-])(?:test|spec)\.[^.]+$/.test(lower)) return "TEST";
  if (/\.(?:md|txt|html?|pdf|docx?|xlsx?|csv)$/.test(lower)) return "DOCUMENTATION";
  if (/\.(?:json|ya?ml|toml|ini|xml|properties|conf|cfg|gradle|kts|tf)$/.test(lower) || /dockerfile|makefile|procfile|\.env/.test(lower)) return "CONFIGURATION";
  if (/\.(?:js|mjs|cjs|ts|tsx|jsx|py|java|go|rs|rb|php|cs|sql|sh|bash|zsh|fish|ps1|psm1|bat|cmd|c|cc|cpp|cxx|h|hh|hpp|kt|swift|scala|groovy|graphql|gql|prisma|proto|vue|svelte|astro)$/.test(lower)) return "PRODUCTION_CODE";
  return "OTHER";
}

export function normalizePath(path) {
  const normalized = path.replaceAll("\\", "/").replace(/^\.\//, "");
  invariant(!normalized.startsWith("/") && !normalized.split("/").includes(".."), `Unsafe source path: ${path}`);
  return normalized;
}
