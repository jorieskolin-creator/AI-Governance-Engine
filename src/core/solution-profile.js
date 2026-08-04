import { LIFECYCLE_STAGES } from "../contracts.js";
import { sha256, stableId } from "./hash.js";

export const SOLUTION_FACT_CLASSES = Object.freeze(["OBSERVED", "INFERRED", "USER_DECLARED"]);
export const SOLUTION_FACT_STATUSES = Object.freeze(["CANDIDATE", "CONFIRMED", "CONFLICTING", "UNKNOWN"]);
export const SUPPORT_STRENGTHS = Object.freeze(["EXPLICIT", "DERIVED", "WEAK"]);

const criticalFields = new Set(["name", "intendedPurpose", "accountableOwner", "jurisdictions", "currentStage", "classification.prohibitedPractice"]);
const deployRequiredFields = Object.freeze([
  "name", "accountableOwner", "intendedPurpose", "expectedValue", "currentStage", "targetStage", "jurisdictions", "roles", "users",
  "operatingBoundary.allowedUses", "operatingBoundary.excludedUses", "operatingBoundary.environment", "operatingBoundary.userScope",
  "operatingBoundary.dataScope", "operatingBoundary.integrationScope", "operatingBoundary.permissionScope", "operatingBoundary.autonomyScope",
  "operatingBoundary.monitoringOwner", "data.categories", "data.personalData", "data.specialCategoryData", "data.productionData", "exposure.currentUserAccess", "exposure.intendedUserAccess",
  "exposure.productionAccess", "exposure.consequentialDecisions", "agent.usesAgents", "agent.canTakeActions", "agent.irreversibleActions",
  "agent.humanOverride", "classification.prohibitedPractice", "classification.highRiskCandidate"
]);

export const FIELD_LABELS = Object.freeze({
  name: "Solution name", accountableOwner: "Accountable owner", intendedPurpose: "Intended purpose", expectedValue: "Expected value / outcome",
  currentStage: "Current lifecycle stage", targetStage: "Target lifecycle stage", jurisdictions: "Jurisdictions", roles: "Regulatory roles", users: "Users and affected groups",
  "operatingBoundary.allowedUses": "Allowed uses", "operatingBoundary.excludedUses": "Excluded uses", "operatingBoundary.environment": "Environment",
  "operatingBoundary.userScope": "User scope", "operatingBoundary.dataScope": "Data scope", "operatingBoundary.integrationScope": "Integration scope",
  "operatingBoundary.permissionScope": "Permission scope", "operatingBoundary.autonomyScope": "Autonomy scope", "operatingBoundary.monitoringOwner": "Monitoring owner",
  "operatingBoundary.expiresAt": "Boundary expiry", "data.personalData": "Personal data", "data.specialCategoryData": "Special-category data",
  "data.categories": "Data categories", "data.productionData": "Production data", "exposure.externalUsers": "External users (compatibility)",
  "exposure.currentUserAccess": "Current user access", "exposure.intendedUserAccess": "Intended user access", "exposure.productionAccess": "Production access",
  "exposure.consequentialDecisions": "Consequential decisions", "agent.usesAgents": "Uses agents", "agent.canTakeActions": "Can take actions",
  "agent.irreversibleActions": "Irreversible actions", "agent.humanOverride": "Human override", "classification.prohibitedPractice": "Prohibited-practice candidate",
  "classification.highRiskCandidate": "High-risk candidate"
});

export const fieldLabel = (field) => FIELD_LABELS[field] ?? String(field ?? "").split(".").map((part) => part.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase())).join(" — ");

const normalize = (value) => String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
function normalizedFieldValue(field, value) {
  if (Array.isArray(value)) return value.map((item) => normalizedFieldValue(field, item)).sort().join("|");
  if (field === "name") {
    const tokens = normalize(value).replace(/^@[^/]+\//, "").replace(/[^a-z0-9]+/g, " ").trim().split(" ");
    const distinctive = tokens.filter((item) => !["assessment", "engine", "system", "application", "app", "platform", "service", "solution"].includes(item));
    return (distinctive.length ? distinctive : tokens).join(" ");
  }
  return normalize(value);
}
const unique = (values) => [...new Set(values.filter((item) => item !== undefined && item !== null && item !== ""))];

function artifactClass(path, metadata = {}) {
  if (metadata.artifactClass) return metadata.artifactClass;
  const value = path.toLowerCase().replaceAll("\\", "/");
  if (/(^|\/)(?:node_modules|vendor|third_party|dist|build|coverage|generated|outputs?|out|\.next|target)(\/|$)/.test(value) || /(?:package-lock|pnpm-lock|yarn\.lock)$/.test(value)) return "DEPENDENCY_OR_GENERATED";
  if (/(^|\/)(?:fixtures?|mocks?|examples?|samples?)(\/|$)/.test(value)) return "FIXTURE_OR_EXAMPLE";
  if (/(^|\/)(?:test|tests|spec|specs|__tests__)(\/|$)/.test(value) || /(^|\/)(?:test|spec)[._-][^/]+$/.test(value) || /(?:^|[._-])(?:test|spec)\.[^.]+$/.test(value)) return "TEST";
  if (/\.(?:md|txt|html?|pdf|docx?|xlsx?|csv)$/.test(value)) return "DOCUMENTATION";
  if (/\.(?:json|ya?ml|toml|ini|xml|properties|conf|cfg|gradle|kts|tf)$/.test(value) || /dockerfile|makefile|procfile|\.env/.test(value)) return "CONFIGURATION";
  if (/\.(?:js|mjs|cjs|ts|tsx|jsx|py|java|go|rs|rb|php|cs|sql|sh|bash|zsh|fish|ps1|psm1|bat|cmd|c|cc|cpp|cxx|h|hh|hpp|kt|swift|scala|groovy|graphql|gql|prisma|proto|vue|svelte|astro)$/.test(value)) return "PRODUCTION_CODE";
  return "OTHER";
}

function fact(field, value, options = {}) {
  const empty = value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);
  const item = {
    id: stableId("solution-fact", { field, value, sourceUnitIds: options.sourceUnitIds ?? [] }),
    field,
    value: empty ? null : value,
    factClass: options.factClass ?? (empty ? "INFERRED" : "USER_DECLARED"),
    status: options.status ?? (empty ? "UNKNOWN" : "CANDIDATE"),
    supportStrength: options.supportStrength ?? (empty ? "WEAK" : "DERIVED"),
    sourceUnitIds: unique(options.sourceUnitIds ?? []),
    limitations: unique(options.limitations ?? []),
    confirmedBy: options.confirmedBy ?? null,
    confirmedAt: options.confirmedAt ?? null
  };
  return { ...item, hash: sha256(item) };
}

function sourceText(sources) {
  return sources.map((source) => ({
    id: source.id ?? source.sourceUnitId ?? stableId("source-unit", { path: source.path, content: source.content }),
    path: source.path,
    artifactClass: source.artifactClass ?? artifactClass(source.path, source.metadata),
    content: String(source.content ?? "")
  }));
}

function explicitMatches(sources, value, field) {
  const needles = (Array.isArray(value) ? value : [value]).map(normalize).filter(Boolean);
  const eligibleClasses = field === "name" ? ["DOCUMENTATION", "CONFIGURATION"] : ["DOCUMENTATION"];
  const eligible = sources.filter((source) => eligibleClasses.includes(source.artifactClass));
  if (!needles.length) return [];
  const aliases = {
    name: ["solution name", "system name", "product name", "package name"], accountableOwner: ["accountable owner", "system owner", "solution owner", "product owner"],
    intendedPurpose: ["intended purpose", "purpose", "mission"], expectedValue: ["expected value", "business value", "expected outcome", "value hypothesis"],
    jurisdictions: ["jurisdictions?", "deployment countries", "operating countries"], roles: ["regulatory roles?", "ai act roles?", "roles"], users: ["users", "affected groups", "user groups"],
    "data.categories": ["data categories", "approved data classes"], "exposure.currentUserAccess": ["current user access"], "exposure.intendedUserAccess": ["intended user access"]
  };
  const fieldAliases = aliases[field] ?? [field.split(".").at(-1).replace(/([a-z])([A-Z])/g, "$1 $2")];
  const labelPattern = `(?:${fieldAliases.join("|")})`;
  if (needles.length === 1 && ["true", "false"].includes(needles[0])) {
    const expected = needles[0] === "true" ? "(?:yes|true)" : "(?:no|false)";
    const pattern = new RegExp(`${labelPattern}\\s*[:=\\-]\\s*${expected}\\b`, "i");
    return eligible.filter((source) => pattern.test(source.content)).map((source) => source.id);
  }
  return eligible.filter((source) => source.content.split(/\r?\n/).some((line) => new RegExp(`${labelPattern}\\s*[:=\\-]`, "i").test(line) && needles.every((needle) => normalize(line).includes(needle)))).map((source) => source.id);
}

function labelledValue(sources, labels) {
  const pattern = new RegExp(`(?:${labels.join("|")})\\s*[:=\\-]\\s*([^\\n\\r|]{2,180})`, "i");
  for (const source of sources.filter((item) => item.artifactClass === "DOCUMENTATION")) {
    const match = source.content.match(pattern);
    const candidate = match?.[1]?.trim();
    if (candidate && !/^(?:and|or|but|based|because|which|that|if|when|where)\b/i.test(candidate) && candidate.split(/\s+/).length >= 3) return { value: candidate, sourceUnitIds: [source.id] };
  }
  return null;
}

function detectedName(sources) {
  for (const source of sources) {
    if (/package\.json$/i.test(source.path)) {
      try {
        const parsed = JSON.parse(source.content);
        if (typeof parsed.name === "string" && parsed.name.trim()) return { value: parsed.name.trim(), sourceUnitIds: [source.id], strength: "EXPLICIT" };
      } catch { /* malformed configuration remains ordinary source evidence */ }
    }
  }
  for (const source of sources.filter((item) => /readme|overview|product/i.test(item.path))) {
    const heading = source.content.match(/^\s*#\s+(.{2,140})$/m);
    if (heading) return { value: heading[1].trim(), sourceUnitIds: [source.id], strength: "EXPLICIT" };
  }
  return labelledValue(sources, ["solution name", "system name", "product name"]);
}

function detectedList(sources, labels, values) {
  const found = [];
  const ids = [];
  const labelled = sources.flatMap((source) => source.content.split(/\r?\n/).filter((line) => new RegExp(`(?:${labels.join("|")})\\s*[:=\\-]`, "i").test(line)).map((line) => ({ source, line })));
  for (const [canonical, pattern] of values) {
    for (const item of labelled) if (pattern.test(item.line)) { found.push(canonical); ids.push(item.source.id); break; }
  }
  return { value: unique(found), sourceUnitIds: unique(ids) };
}

function provisionalDossier(detected) {
  return {
    name: detected.name?.value ?? "",
    intendedPurpose: detected.intendedPurpose?.value ?? "",
    expectedValue: detected.expectedValue?.value ?? "",
    currentStage: "QUALIFICATION_AND_REGISTRATION",
    targetStage: "DESIGN_AND_DEVELOPMENT",
    jurisdictions: detected.jurisdictions?.value ?? [],
    roles: detected.roles?.value ?? [],
    users: detected.users?.value ?? [],
    accountableOwner: detected.accountableOwner?.value ?? "",
    data: { categories: [], personalData: null, specialCategoryData: null, productionData: null },
    exposure: { currentUserAccess: "UNKNOWN", intendedUserAccess: "UNKNOWN", externalUsers: null, productionAccess: null, consequentialDecisions: null },
    agent: { usesAgents: null, canTakeActions: null, irreversibleActions: null, humanOverride: null },
    classification: { prohibitedPractice: null, highRiskCandidate: null },
    operatingBoundary: {
      allowedUses: [], excludedUses: [], environment: "ISOLATED_SANDBOX", userScope: "", dataScope: "", integrationScope: "",
      permissionScope: "", autonomyScope: "", monitoringOwner: "", expiresAt: null
    }
  };
}

function addSemanticContradictions(dossier, facts, contradictions) {
  const add = (ruleId, fields, severity, statement) => {
    const sourceUnitIds = unique(fields.flatMap((field) => facts[field]?.sourceUnitIds ?? []));
    const value = {
      id: stableId("solution-contradiction", { ruleId, fields, values: fields.map((field) => facts[field]?.value), sourceUnitIds }),
      ruleId, field: fields[0], fields, severity, statement, sourceUnitIds,
      declaredValues: Object.fromEntries(fields.map((field) => [field, facts[field]?.value ?? null]))
    };
    contradictions.push(value);
    for (const field of fields) {
      if (!facts[field]) continue;
      facts[field].status = "CONFLICTING";
      facts[field].limitations = unique([...(facts[field].limitations ?? []), `Contradiction ${ruleId} must be resolved; confirmation cannot erase it.`]);
    }
  };
  const sandbox = dossier.operatingBoundary.environment === "ISOLATED_SANDBOX";
  const approvedScope = (value) => /approved|named|bounded|synthetic|non-production|test/i.test(String(value ?? ""));
  if (dossier.data.specialCategoryData === true && dossier.data.personalData === false) {
    add("RULE-CONTRADICTION-SPECIAL-CATEGORY-IS-PERSONAL", ["data.personalData", "data.specialCategoryData"], "CRITICAL", "Special-category data is declared while personal-data processing is denied.");
  }
  if (sandbox && dossier.exposure.productionAccess === true) {
    add("RULE-CONTRADICTION-SANDBOX-PRODUCTION-ACCESS", ["operatingBoundary.environment", "exposure.productionAccess"], "CRITICAL", "An isolated sandbox is declared together with production access.");
  }
  if (sandbox && dossier.data.productionData === true && !approvedScope(dossier.operatingBoundary.dataScope)) {
    add("RULE-CONTRADICTION-SANDBOX-PRODUCTION-DATA", ["operatingBoundary.environment", "data.productionData", "operatingBoundary.dataScope"], "HIGH", "Production data is declared in an isolated sandbox without an explicit approved data scope.");
  }
  const currentExternal = !["UNKNOWN", "INTERNAL_ONLY"].includes(dossier.exposure.currentUserAccess);
  if (sandbox && currentExternal && !approvedScope(dossier.operatingBoundary.userScope)) {
    add("RULE-CONTRADICTION-SANDBOX-EXTERNAL-USERS", ["operatingBoundary.environment", "exposure.currentUserAccess", "operatingBoundary.userScope"], "HIGH", "Current external access is declared in an isolated sandbox without an explicit bounded user scope.");
  }
  if (sandbox && dossier.exposure.consequentialDecisions === true && !/(simulation|shadow|no operational effect|non-consequential)/i.test(dossier.operatingBoundary.allowedUses.join(" "))) {
    add("RULE-CONTRADICTION-SANDBOX-CONSEQUENTIAL-DECISIONS", ["operatingBoundary.environment", "exposure.consequentialDecisions", "operatingBoundary.allowedUses"], "CRITICAL", "Consequential decisions are declared in an isolated sandbox without an explicit non-operational simulation boundary.");
  }
  if (dossier.agent.usesAgents === false && dossier.agent.canTakeActions === true) {
    add("RULE-CONTRADICTION-ACTIONS-WITHOUT-AGENT", ["agent.usesAgents", "agent.canTakeActions"], "HIGH", "Action-taking capability is declared while agent use is denied.");
  }
  if (dossier.agent.canTakeActions === false && dossier.agent.irreversibleActions === true) {
    add("RULE-CONTRADICTION-IRREVERSIBLE-WITHOUT-ACTIONS", ["agent.canTakeActions", "agent.irreversibleActions"], "CRITICAL", "Irreversible actions are declared while action-taking capability is denied.");
  }
  const allowed = new Map(dossier.operatingBoundary.allowedUses.map((item) => [normalize(item), item]));
  const overlap = dossier.operatingBoundary.excludedUses.filter((item) => allowed.has(normalize(item)));
  if (overlap.length) add("RULE-CONTRADICTION-ALLOWED-AND-EXCLUDED", ["operatingBoundary.allowedUses", "operatingBoundary.excludedUses"], "HIGH", `The same use is both allowed and excluded: ${overlap.join(", ")}.`);
  if (dossier.operatingBoundary.expiresAt && Date.parse(dossier.operatingBoundary.expiresAt) < Date.now()) {
    add("RULE-CONTRADICTION-BOUNDARY-EXPIRED", ["operatingBoundary.expiresAt"], "HIGH", "The declared operating boundary has expired.");
  }
}

export function discoverSolutionProfile(rawSources, declaredDossier = null, confirmation = {}) {
  const sources = sourceText(rawSources);
  const discoveryTime = new Date().toISOString();
  const detected = {
    name: detectedName(sources),
    intendedPurpose: labelledValue(sources, ["intended purpose", "purpose", "mission"]),
    expectedValue: labelledValue(sources, ["expected value", "business value", "expected outcome", "outcome"]),
    accountableOwner: labelledValue(sources, ["accountable owner", "system owner", "solution owner", "product owner"]),
    jurisdictions: detectedList(sources, ["jurisdictions?", "deployment countries", "operating countries"], [["FI", /\b(?:Finland|Finnish|FI|FIN)\b/i], ["EU", /\b(?:European Union|EU|EEA)\b/i]]),
    roles: detectedList(sources, ["regulatory roles?", "ai act roles?", "roles"], [["PROVIDER", /\bprovider\b/i], ["DEPLOYER", /\bdeployer\b/i], ["IMPORTER", /\bimporter\b/i], ["DISTRIBUTOR", /\bdistributor\b/i]]),
    users: detectedList(sources, ["users", "affected groups", "user groups"], [["EMPLOYEES", /\b(?:employees?|internal users?|staff)\b/i], ["CUSTOMERS", /\b(?:customers?|end users?|consumers?)\b/i]])
  };
  const dossier = declaredDossier ?? provisionalDossier(detected);
  const flattened = flattenDossier(dossier);
  const facts = {};
  const contradictions = [];
  const provisionalDefaults = new Set(["currentStage", "targetStage", "operatingBoundary.environment"]);
  for (const [field, value] of Object.entries(flattened)) {
    const direct = explicitMatches(sources, value, field);
    const discovery = detected[field];
    const discoveredIds = discovery && normalizedFieldValue(field, discovery.value) === normalizedFieldValue(field, value) ? discovery.sourceUnitIds : [];
    const sourceUnitIds = unique([...direct, ...discoveredIds]);
    const userConfirmed = confirmation[field]?.confirmed === true;
    const hasValue = value !== undefined && value !== null && value !== "" && (!Array.isArray(value) || value.length > 0);
    const conflictsWithDetected = Boolean(declaredDossier && discovery && normalizedFieldValue(field, discovery.value) && normalizedFieldValue(field, discovery.value) !== normalizedFieldValue(field, value));
    const provisionalUnknown = !declaredDossier && provisionalDefaults.has(field) && !sourceUnitIds.length;
    if (conflictsWithDetected) contradictions.push({
      id: stableId("solution-contradiction", { field, declaredValue: value, observedValue: discovery.value, sourceUnitIds: discovery.sourceUnitIds }),
      field, declaredValue: value, observedValue: discovery.value, sourceUnitIds: discovery.sourceUnitIds,
      severity: criticalFields.has(field) ? "HIGH" : "MEDIUM",
      statement: `${field} differs between the submitted declaration and source evidence.`
    });
    facts[field] = fact(field, value, {
      factClass: sourceUnitIds.length ? "OBSERVED" : provisionalUnknown ? "INFERRED" : hasValue ? "USER_DECLARED" : "INFERRED",
      status: conflictsWithDetected ? "CONFLICTING" : provisionalUnknown ? "UNKNOWN" : sourceUnitIds.length && (declaredDossier || userConfirmed) ? "CONFIRMED" : sourceUnitIds.length || hasValue ? "CANDIDATE" : "UNKNOWN",
      supportStrength: sourceUnitIds.length ? "EXPLICIT" : hasValue ? "DERIVED" : "WEAK",
      sourceUnitIds: unique([...sourceUnitIds, ...(conflictsWithDetected ? discovery.sourceUnitIds : [])]),
      confirmedBy: userConfirmed ? confirmation[field].confirmedBy ?? "USER" : declaredDossier && sourceUnitIds.length ? "DOSSIER_SUBMISSION" : null,
      confirmedAt: userConfirmed ? confirmation[field].confirmedAt ?? discoveryTime : declaredDossier && sourceUnitIds.length ? discoveryTime : null,
      limitations: conflictsWithDetected ? ["User confirmation cannot erase the contradictory observed candidate."] : sourceUnitIds.length ? [] : hasValue ? ["The value is declared but not located in the submitted source material."] : ["No value was detected or declared."]
    });
    if (conflictsWithDetected) facts[field].candidates = [{ value, factClass: "USER_DECLARED" }, { value: discovery.value, factClass: "OBSERVED", sourceUnitIds: discovery.sourceUnitIds }];
  }
  addSemanticContradictions(dossier, facts, contradictions);
  const profile = {
    version: "solution-profile-1.0.0",
    fields: facts,
    contradictions,
    suggestedDossier: dossier,
    sourceCount: sources.length,
    artifactCounts: Object.fromEntries([...new Set(sources.map((item) => item.artifactClass))].sort().map((classification) => [classification, sources.filter((item) => item.artifactClass === classification).length])),
    sourceHash: sha256(sources.map(({ id, path, artifactClass }) => ({ id, path, artifactClass })))
  };
  return { ...profile, hash: sha256(profile) };
}

export function flattenDossier(dossier) {
  return {
    name: dossier.name, accountableOwner: dossier.accountableOwner, intendedPurpose: dossier.intendedPurpose, expectedValue: dossier.expectedValue,
    currentStage: dossier.currentStage, targetStage: dossier.targetStage, jurisdictions: dossier.jurisdictions, roles: dossier.roles, users: dossier.users,
    "operatingBoundary.allowedUses": dossier.operatingBoundary?.allowedUses ?? [], "operatingBoundary.excludedUses": dossier.operatingBoundary?.excludedUses ?? [],
    "operatingBoundary.environment": dossier.operatingBoundary?.environment ?? "UNKNOWN", "operatingBoundary.userScope": dossier.operatingBoundary?.userScope ?? "",
    "operatingBoundary.dataScope": dossier.operatingBoundary?.dataScope ?? "", "operatingBoundary.integrationScope": dossier.operatingBoundary?.integrationScope ?? "",
    "operatingBoundary.permissionScope": dossier.operatingBoundary?.permissionScope ?? "", "operatingBoundary.autonomyScope": dossier.operatingBoundary?.autonomyScope ?? "",
    "operatingBoundary.monitoringOwner": dossier.operatingBoundary?.monitoringOwner ?? "", "operatingBoundary.expiresAt": dossier.operatingBoundary?.expiresAt ?? null,
    "data.categories": dossier.data?.categories ?? [], "data.personalData": dossier.data?.personalData, "data.specialCategoryData": dossier.data?.specialCategoryData, "data.productionData": dossier.data?.productionData,
    "exposure.currentUserAccess": dossier.exposure?.currentUserAccess ?? "UNKNOWN", "exposure.intendedUserAccess": dossier.exposure?.intendedUserAccess ?? "UNKNOWN", "exposure.externalUsers": dossier.exposure?.externalUsers, "exposure.productionAccess": dossier.exposure?.productionAccess,
    "exposure.consequentialDecisions": dossier.exposure?.consequentialDecisions, "agent.usesAgents": dossier.agent?.usesAgents,
    "agent.canTakeActions": dossier.agent?.canTakeActions, "agent.irreversibleActions": dossier.agent?.irreversibleActions,
    "agent.humanOverride": dossier.agent?.humanOverride, "classification.prohibitedPractice": dossier.classification?.prohibitedPractice,
    "classification.highRiskCandidate": dossier.classification?.highRiskCandidate
  };
}

export function buildDocumentationReadiness(profile, targetStage, sourceIngestion = null) {
  const statuses = {};
  for (const field of deployRequiredFields) {
    const item = profile.fields[field];
    const agentsExplicitlyExcluded = profile.fields["agent.usesAgents"]?.value === false && profile.fields["agent.usesAgents"]?.status === "CONFIRMED";
    const actionsExplicitlyExcluded = profile.fields["agent.canTakeActions"]?.value === false && profile.fields["agent.canTakeActions"]?.status === "CONFIRMED";
    const legacyDataDocumented = ["data.personalData", "data.specialCategoryData", "data.productionData"].every((key) => profile.fields[key]?.status === "CONFIRMED");
    const legacyExposureDocumented = profile.fields["exposure.externalUsers"]?.status === "CONFIRMED";
    const notApplicable = agentsExplicitlyExcluded && ["agent.canTakeActions", "agent.irreversibleActions", "agent.humanOverride"].includes(field)
      || actionsExplicitlyExcluded && field === "agent.irreversibleActions"
      || field === "data.categories" && (!Array.isArray(profile.fields[field]?.value) || profile.fields[field].value.length === 0) && legacyDataDocumented
      || ["exposure.currentUserAccess", "exposure.intendedUserAccess"].includes(field) && legacyExposureDocumented && profile.fields[field]?.factClass !== "OBSERVED";
    statuses[field] = notApplicable ? "NOT_APPLICABLE"
      : !item || item.status === "UNKNOWN" ? "UNKNOWN"
      : item.status === "CONFLICTING" ? "CONFLICTING"
        : item.factClass === "OBSERVED" && item.status === "CONFIRMED" ? "DOCUMENTED_AND_CONFIRMED"
          : item.factClass === "OBSERVED" ? "OBSERVED"
            : item.factClass === "INFERRED" ? "INFERRED"
              : "USER_DECLARED_ONLY";
  }
  const values = Object.values(statuses);
  const unknownFields = Object.entries(statuses).filter(([, value]) => value === "UNKNOWN").map(([field]) => field);
  const conflictingFields = Object.entries(statuses).filter(([, value]) => value === "CONFLICTING").map(([field]) => field);
  const userDeclaredOnlyFields = Object.entries(statuses).filter(([, value]) => value === "USER_DECLARED_ONLY").map(([field]) => field);
  const sourceSupportedFields = Object.entries(statuses).filter(([, value]) => ["DOCUMENTED_AND_CONFIRMED", "OBSERVED"].includes(value)).map(([field]) => field);
  const confirmedFields = Object.entries(statuses).filter(([, value]) => value === "DOCUMENTED_AND_CONFIRMED").map(([field]) => field);
  const notApplicableFields = Object.entries(statuses).filter(([, value]) => value === "NOT_APPLICABLE").map(([field]) => field);
  const deploymentTarget = ["DEPLOYMENT", "OPERATION_AND_MONITORING", "REVIEW_AND_EVALUATION", "RETIREMENT"].includes(targetStage);
  const implementationSourceCount = (profile.artifactCounts?.PRODUCTION_CODE ?? 0) + (profile.artifactCounts?.CONFIGURATION ?? 0);
  const missingImplementationScope = deploymentTarget && implementationSourceCount === 0;
  const sourceCoverageReviewRequired = sourceIngestion?.coverageStatus === "INCOMPLETE_REVIEW_REQUIRED" && !sourceIngestion?.humanCoverageAcceptance;
  const incompleteForDeployment = values.some((value) => !["DOCUMENTED_AND_CONFIRMED", "NOT_APPLICABLE"].includes(value)) || missingImplementationScope || sourceCoverageReviewRequired;
  const materialContradictions = profile.contradictions.filter((item) => ["HIGH", "CRITICAL"].includes(item.severity));
  const sandboxRequired = [...unknownFields, ...conflictingFields].some((field) => criticalFields.has(field)) || materialContradictions.length > 0 || sourceCoverageReviewRequired;
  const value = {
    version: "documentation-readiness-1.1.0",
    fieldStatuses: statuses,
    mandatoryFieldCount: deployRequiredFields.length,
    documentedAndConfirmedCount: confirmedFields.length,
    satisfiedFieldCount: confirmedFields.length + notApplicableFields.length,
    sourceSupportedFields, confirmedFields, notApplicableFields, userDeclaredOnlyFields, unknownFields, conflictingFields,
    implementationSourceCount,
    missingImplementationScope,
    contradictions: profile.contradictions,
    materialContradictionCount: materialContradictions.length,
    sourceCoverageStatus: sourceIngestion?.coverageStatus ?? "SUBMITTED_SCOPE_ONLY",
    sourceCoverageReviewRequired,
    documentationToCodeAlignment: conflictingFields.length ? "CONFLICTING" : missingImplementationScope ? "NOT_ASSESSED" : incompleteForDeployment ? "INCOMPLETE" : "ALIGNED",
    sandboxRequired,
    deploymentReady: !incompleteForDeployment,
    gateRequired: deploymentTarget && incompleteForDeployment,
    status: conflictingFields.length ? "CONFLICTING" : !incompleteForDeployment ? "DOCUMENTED_AND_CONFIRMED" : "INCOMPLETE"
  };
  return { ...value, hash: sha256(value) };
}

export function buildAssessmentIntake(dossier, profile, documentationReadiness, registeredSources, sourceIngestion = null) {
  const provenance = [];
  const seenSources = new Set();
  for (const item of registeredSources) {
    const original = item.originalSource;
    const entry = original ? { id: original.id, path: original.path, sha256: original.sha256, artifactClass: original.artifactClass }
      : { id: item.id, path: item.path, sha256: item.sha256, artifactClass: item.artifactClass ?? artifactClass(item.path) };
    const key = `${entry.id}:${entry.sha256}`;
    if (!seenSources.has(key)) { seenSources.add(key); provenance.push(entry); }
  }
  const intake = {
    version: "assessment-intake-1.2.0",
    identity: { name: dossier.name, accountableOwner: dossier.accountableOwner },
    intendedUse: { intendedPurpose: dossier.intendedPurpose, expectedValue: dossier.expectedValue },
    lifecycle: { currentStage: dossier.currentStage, targetStage: dossier.targetStage },
    jurisdictionsAndRoles: { jurisdictions: dossier.jurisdictions, roles: dossier.roles },
    usersAndAffectedGroups: dossier.users,
    operatingBoundary: structuredClone(dossier.operatingBoundary),
    data: structuredClone(dossier.data), exposure: structuredClone(dossier.exposure),
    agentAuthority: structuredClone(dossier.agent), classification: structuredClone(dossier.classification),
    sourceProvenance: provenance,
    sourceIngestion,
    sourceManifestHash: sha256(provenance.map(({ id, path, sha256: hash, artifactClass: classification }) => ({ id, path, hash, classification }))),
    fieldConfirmations: Object.values(profile.fields).filter((item) => item.confirmedBy).map((item) => ({ field: item.field, confirmedBy: item.confirmedBy, confirmedAt: item.confirmedAt, sourceUnitIds: item.sourceUnitIds })),
    documentationAlignment: documentationReadiness,
    immutable: true
  };
  return { ...intake, hash: sha256(intake) };
}

export function caseProfileView(assessmentIntake, profile) {
  const statusFor = (field) => assessmentIntake.documentationAlignment.fieldStatuses[field] ?? "UNKNOWN";
  const exposureEntries = Object.entries(assessmentIntake.exposure).filter(([field]) => field !== "externalUsers"
    || !("currentUserAccess" in assessmentIntake.exposure || "intendedUserAccess" in assessmentIntake.exposure));
  return {
    identityAndIntent: [
      { field: "name", label: "Solution name", value: assessmentIntake.identity.name, status: statusFor("name") },
      { field: "accountableOwner", label: "Accountable owner", value: assessmentIntake.identity.accountableOwner, status: statusFor("accountableOwner") },
      { field: "intendedPurpose", label: "Intended purpose", value: assessmentIntake.intendedUse.intendedPurpose, status: statusFor("intendedPurpose") },
      { field: "expectedValue", label: "Expected value / outcome", value: assessmentIntake.intendedUse.expectedValue, status: statusFor("expectedValue") }
    ],
    assessmentScope: [
      { field: "currentStage", label: "Current lifecycle stage", value: assessmentIntake.lifecycle.currentStage, status: statusFor("currentStage") },
      { field: "targetStage", label: "Target lifecycle stage", value: assessmentIntake.lifecycle.targetStage, status: statusFor("targetStage") },
      { field: "jurisdictions", label: "Jurisdictions", value: assessmentIntake.jurisdictionsAndRoles.jurisdictions, status: statusFor("jurisdictions") },
      { field: "roles", label: "Regulatory roles", value: assessmentIntake.jurisdictionsAndRoles.roles, status: statusFor("roles") },
      { field: "users", label: "Users and affected groups", value: assessmentIntake.usersAndAffectedGroups, status: statusFor("users") },
      { field: "sourceCount", label: "Assessed sources", value: assessmentIntake.sourceProvenance.length, status: "OBSERVED" },
      { field: "sourceHash", label: "Source manifest hash", value: assessmentIntake.sourceManifestHash, status: "OBSERVED" },
      { field: "sourceCoverage", label: "Source-ingestion coverage", value: assessmentIntake.sourceIngestion?.coverageStatus ?? "SUBMITTED_SCOPE_ONLY", status: assessmentIntake.sourceIngestion?.coverageStatus === "INCOMPLETE_REVIEW_REQUIRED" ? "CONFLICTING" : "OBSERVED" }
    ],
    operatingBoundary: Object.entries(assessmentIntake.operatingBoundary).map(([field, value]) => ({ field: `operatingBoundary.${field}`, label: fieldLabel(`operatingBoundary.${field}`), value, status: statusFor(`operatingBoundary.${field}`) })),
    riskDeclarations: [
      ...Object.entries(assessmentIntake.data).map(([field, value]) => ({ field: `data.${field}`, label: fieldLabel(`data.${field}`), value, status: statusFor(`data.${field}`) })),
      ...exposureEntries.map(([field, value]) => ({ field: `exposure.${field}`, label: fieldLabel(`exposure.${field}`), value, status: statusFor(`exposure.${field}`) })),
      ...Object.entries(assessmentIntake.agentAuthority).map(([field, value]) => ({ field: `agent.${field}`, label: fieldLabel(`agent.${field}`), value, status: statusFor(`agent.${field}`) })),
      ...Object.entries(assessmentIntake.classification).map(([field, value]) => ({ field: `classification.${field}`, label: fieldLabel(`classification.${field}`), value, status: statusFor(`classification.${field}`) }))
    ]
  };
}

export function validLifecycle(value) { return LIFECYCLE_STAGES.includes(value); }
