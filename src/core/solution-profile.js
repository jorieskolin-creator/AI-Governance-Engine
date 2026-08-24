import { invariant, LIFECYCLE_STAGES } from "../contracts.js";
import { sha256, stableId } from "./hash.js";
import { activeIntakeQuestionIds, INTAKE_QUESTIONNAIRE } from "../knowledge/intake-questionnaire.js";
import { classifyIntakeSearchEvidence, INTAKE_SEARCH_REGISTRY, intakeSearchField } from "../intake/search-registry.js";

export const SOLUTION_FACT_CLASSES = Object.freeze(["OBSERVED", "INFERRED", "SELF_DECLARED"]);
export const SOLUTION_FACT_STATUSES = Object.freeze(["CANDIDATE", "CONFIRMED", "CONFLICTING", "UNKNOWN"]);
export const SUPPORT_STRENGTHS = Object.freeze(["EXPLICIT", "DERIVED", "WEAK"]);
export const INTAKE_FACT_ORIGINS = Object.freeze(["OBSERVED", "AI_CANDIDATE", "SELF_DECLARED", "HUMAN_CLASSIFIED"]);
export const INTAKE_SUPPORT_STATUSES = Object.freeze(["SUPPORTED", "PARTIAL", "UNSUPPORTED", "CONFLICTING", "NOT_CHECKED"]);

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
    factClass: options.factClass ?? (empty ? "INFERRED" : "SELF_DECLARED"),
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
  return sources.map((source, index) => {
    const item = {
      id: source.id ?? source.sourceUnitId ?? stableId("source-unit", { path: source.path, content: source.content }),
      sourceId: source.sourceId ?? null,
      path: source.path,
      artifactClass: source.artifactClass ?? artifactClass(source.path, source.metadata),
      format: source.format ?? null,
      evidenceKind: source.evidenceKind ?? null,
      evidenceClass: source.evidenceClass ?? null,
      locator: source.locator ?? null,
      content: String(source.content ?? ""),
      index
    };
    return { ...item, searchEvidenceType: classifyIntakeSearchEvidence(item) };
  });
}

function explicitMatches(sources, value, field, searchOverrides) {
  const needles = (Array.isArray(value) ? value : [value]).map(normalize).filter(Boolean);
  if (!needles.length) return [];
  return unique(searchEntries(sources, field, searchOverrides).filter((entry) => needles.every((needle) => normalize(entry.text).includes(needle))).map((entry) => entry.sourceUnitId));
}

function labelledValue(sources, field, searchOverrides) {
  const entry = labelledEntry(sources, field, searchOverrides);
  if (!entry) return null;
  if (entry.conflict) return { value: null, sourceUnitIds: entry.sourceUnitIds, candidates: entry.candidates, conflict: true };
  const candidate = entry.text;
  return candidate && !/^(?:and|or|but|based|because|which|that|if|when|where)\b/i.test(candidate)
    ? { value: candidate, sourceUnitIds: entry.sourceUnitIds }
    : null;
}

const escaped = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const words = (value) => String(value).replaceAll("_", " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/\s+/g, " ").trim();
const BOUNDED_SEARCH_TERM = /^[\p{L}\p{N}][\p{L}\p{N} _/-]{0,79}$/u;

function validatedSearchOverride(fieldId, registeredRule, override) {
  if (!override) return null;
  invariant(registeredRule && override && typeof override === "object" && !Array.isArray(override), `Search override is invalid for ${fieldId}`);
  invariant(Object.keys(override).sort().join(",") === "extractionStrategies,labelAliases,searchConcepts,sourcePriorities", `Search override contains unregistered fields for ${fieldId}`);
  for (const key of ["searchConcepts", "labelAliases"]) {
    invariant(Array.isArray(override[key]) && override[key].length <= 8 && new Set(override[key].map(normalize)).size === override[key].length && override[key].every((term) => typeof term === "string" && term === term.trim() && BOUNDED_SEARCH_TERM.test(term)), `Search override ${key} is invalid for ${fieldId}`);
  }
  invariant(Array.isArray(override.sourcePriorities) && new Set(override.sourcePriorities).size === override.sourcePriorities.length && override.sourcePriorities.every((type) => registeredRule.evidenceTypes.includes(type)), `Search override source priorities are invalid for ${fieldId}`);
  invariant(Array.isArray(override.extractionStrategies) && new Set(override.extractionStrategies).size === override.extractionStrategies.length && override.extractionStrategies.every((strategy) => registeredRule.extractionStrategies.includes(strategy)), `Search override extraction strategies are invalid for ${fieldId}`);
  return override;
}

function searchEntries(sources, fieldId, searchOverrides) {
  const registeredRule = intakeSearchField(fieldId);
  const override = validatedSearchOverride(fieldId, registeredRule, searchOverrides?.[fieldId]);
  const suggestedAliases = unique([...(override?.searchConcepts ?? []), ...(override?.labelAliases ?? [])]);
  const rule = registeredRule && override ? {
    ...registeredRule,
    labels: unique([...registeredRule.labels, ...suggestedAliases]),
    headingAliases: unique([...registeredRule.headingAliases, ...suggestedAliases]),
    tableLabels: unique([...registeredRule.tableLabels, ...suggestedAliases]),
    evidenceTypes: override.sourcePriorities.length ? [...override.sourcePriorities] : [...registeredRule.evidenceTypes],
    sourcePriorities: override.sourcePriorities.length ? [...override.sourcePriorities] : [...registeredRule.sourcePriorities],
    extractionStrategies: override.extractionStrategies.length ? [...override.extractionStrategies] : [...registeredRule.extractionStrategies]
  } : registeredRule;
  if (!rule) return [];
  const strategies = new Set(rule.extractionStrategies);
  const eligible = sources.filter((source) => rule.evidenceTypes.includes(source.searchEvidenceType))
    .sort((a, b) => rule.sourcePriorities.indexOf(a.searchEvidenceType) - rule.sourcePriorities.indexOf(b.searchEvidenceType) || a.index - b.index);
  const entries = [];
  const seen = new Set();
  const add = (text, source) => {
    const value = Array.isArray(text) ? text.join(", ") : typeof text === "boolean" ? String(text) : String(text ?? "").trim();
    if (!value || value.length > 10_000) return;
    const key = `${source.id}:${normalize(value)}`;
    if (seen.has(key)) return;
    seen.add(key);
    entries.push({ text: value, sourceUnitId: source.id, sourcePriority: rule.sourcePriorities.indexOf(source.searchEvidenceType), sourceIndex: source.index });
  };
  const labelPattern = new RegExp(`^\\s*(?:[-*]\\s*)?(?:${rule.labels.map(escaped).join("|")})\\s*\\??\\s*[:=\\-]\\s*(.+?)\\s*$`, "i");
  if (["LABELLED_VALUE", "LABELLED_ENUM", "LABELLED_BOOLEAN", "LABELLED_LIST", "LABELLED_QUESTION"].some((strategy) => strategies.has(strategy))) {
    for (const source of eligible) {
      for (const line of source.content.split(/\r?\n/)) {
        const match = line.match(labelPattern);
        if (match?.[1]?.trim()) add(match[1], source);
      }
    }
  }
  if (strategies.has("HEADING_VALUE")) {
    const headingPattern = new RegExp(`^\\s*#{1,6}\\s+(?:${rule.headingAliases.map(escaped).join("|")})\\s*#*\\s*$`, "i");
    for (const source of eligible) {
      const lines = source.content.split(/\r?\n/);
      for (let index = 0; index < lines.length; index += 1) {
        if (!headingPattern.test(lines[index])) continue;
        const value = lines.slice(index + 1).find((line) => line.trim());
        if (value && !/^\s*#/.test(value)) add(value.replace(/^\s*[-*]\s*/, ""), source);
      }
      if (!/;heading:\d+:h[1-6](?:;lines:\d+-\d+)?$/.test(source.locator ?? "") || !rule.headingAliases.some((label) => normalize(label) === normalize(source.content))) continue;
      const next = eligible.find((candidate) => candidate.index > source.index && (candidate.sourceId ? candidate.sourceId === source.sourceId : candidate.path === source.path));
      if (next && !/;heading:\d+:h[1-6](?:;lines:\d+-\d+)?$/.test(next.locator ?? "")) add(next.content, next);
    }
  }
  if (strategies.has("TABLE_KEY_VALUE")) {
    const tableLabels = new Set(rule.tableLabels.map(normalize));
    for (const source of eligible.filter((item) => /;table:\d+;row:\d+(?:;lines:\d+-\d+)?$/.test(item.locator ?? ""))) {
      const cells = source.content.split("|").map((cell) => cell.trim()).filter(Boolean);
      const index = cells.findIndex((cell) => tableLabels.has(normalize(cell)));
      if (index >= 0 && cells[index + 1]) add(cells[index + 1], source);
    }
  }
  if (strategies.has("STRUCTURED_PROPERTY") || strategies.has("MANIFEST_PROPERTY")) {
    const keys = new Set([...rule.labels, fieldId.split(".").at(-1)].map((label) => normalize(words(label))));
    for (const source of eligible) {
      if (strategies.has("MANIFEST_PROPERTY") && source.searchEvidenceType === "PROJECT_MANIFEST" && fieldId === "name") {
        try { add(JSON.parse(source.content).name, source); } catch {
          const assignment = source.content.match(/^\s*name\s*=\s*["']([^"']+)["']\s*$/m);
          const module = source.content.match(/^\s*module\s+([^\s]+)\s*$/m);
          if (assignment?.[1]) add(assignment[1], source);
          else if (module?.[1]) add(module[1], source);
        }
      }
      if (!strategies.has("STRUCTURED_PROPERTY")) continue;
      try {
        const state = { nodes: 0 };
        const visit = (value, depth = 0) => {
          if (!value || typeof value !== "object") return;
          if (depth > 25 || ++state.nodes > 20_000) throw new Error("Structured search limit exceeded");
          for (const [key, child] of Object.entries(value)) {
            if (keys.has(normalize(words(key))) && (typeof child === "string" || typeof child === "boolean" || Array.isArray(child) && child.every((item) => ["string", "boolean"].includes(typeof item)))) add(child, source);
            if (child && typeof child === "object") visit(child, depth + 1);
          }
        };
        visit(JSON.parse(source.content));
      } catch { /* non-JSON and redaction-invalidated structures use other registered strategies */ }
    }
  }
  if (strategies.has("README_TITLE")) {
    for (const source of eligible.filter((item) => item.searchEvidenceType === "README")) {
      const heading = source.content.match(/^\s*#\s+(.{2,140})$/m);
      if (heading) add(heading[1].trim(), source);
    }
  }
  if (strategies.has("HTML_ARCHITECTURE_TITLE")) {
    for (const source of eligible.filter((item) => item.format === "HTML" && item.searchEvidenceType === "ARCHITECTURE_DOCUMENT" && /^html:title(?:;lines:\d+-\d+)?$/.test(item.locator ?? ""))) {
      const match = source.content.match(/^(.{2,140}?)\s*(?:[-—|:]\s*)(?:current\s+)?(?:architecture|system design|solution design)\s*$/i);
      if (match) add(match[1].trim(), source);
    }
  }
  return entries.sort((a, b) => a.sourcePriority - b.sourcePriority || a.sourceIndex - b.sourceIndex);
}

function labelledEntry(sources, field, searchOverrides) {
  const entries = searchEntries(sources, field, searchOverrides);
  if (!entries.length) return null;
  const candidates = unique(entries.map((entry) => entry.text));
  const normalizedCandidates = unique(candidates.map(normalize));
  return normalizedCandidates.length > 1
    ? { text: null, conflict: true, candidates, sourceUnitIds: unique(entries.map((entry) => entry.sourceUnitId)) }
    : { text: entries[0].text, conflict: false, candidates, sourceUnitIds: unique(entries.map((entry) => entry.sourceUnitId)) };
}

function detectedEnum(sources, field, options, searchOverrides) {
  const entry = labelledEntry(sources, field, searchOverrides);
  if (!entry) return null;
  if (entry.conflict) return { value: null, sourceUnitIds: entry.sourceUnitIds, candidates: entry.candidates, conflict: true };
  const normalized = words(entry.text).toLowerCase();
  const matches = options.map(([canonical, aliases = []]) => [canonical, [canonical, ...aliases].map((item) => words(item).toLowerCase())])
    .filter(([, aliases]) => aliases.some((alias) => normalized === alias))
    .sort((a, b) => Math.max(...b[1].map((item) => item.length)) - Math.max(...a[1].map((item) => item.length)));
  return matches.length ? { value: matches[0][0], sourceUnitIds: entry.sourceUnitIds } : null;
}

function detectedBoolean(sources, field, searchOverrides) {
  return detectedEnum(sources, field, [[true, ["yes", "true"]], [false, ["no", "false"]]], searchOverrides);
}

function detectedQuestionAnswer(sources, question, searchOverrides) {
  const entry = labelledEntry(sources, `intakeAnswers.${question.id}`, searchOverrides);
  if (!entry) return null;
  if (entry.conflict) return { answerState: "HUMAN_REVIEW_REQUIRED", values: [], sourceUnitIds: entry.sourceUnitIds, supportStatus: "CONFLICTING", candidates: entry.candidates };
  const normalized = words(entry.text).toLowerCase();
  const options = [...question.options].sort((a, b) => words(b).length - words(a).length);
  const values = options.filter((option) => {
    const optionText = words(option).toLowerCase();
    return normalized === optionText || new RegExp(`(?:^|[^a-z0-9])${escaped(optionText)}(?:$|[^a-z0-9])`, "i").test(normalized);
  });
  if (question.type === "SINGLE") {
    if (values.length > 1) return { answerState: "HUMAN_REVIEW_REQUIRED", values: [], sourceUnitIds: entry.sourceUnitIds, supportStatus: "CONFLICTING", candidates: values };
    const answerState = values[0] ?? (/^(?:yes|true)$/i.test(normalized) ? "YES" : /^(?:no|false)$/i.test(normalized) ? "NO" : null);
    return answerState ? { answerState, values: [], sourceUnitIds: entry.sourceUnitIds } : null;
  }
  if (!values.length) return null;
  if (values.length > 1 && values.some((item) => ["UNKNOWN", "NONE_OF_THE_ABOVE"].includes(item))) {
    return { answerState: "HUMAN_REVIEW_REQUIRED", values: [], sourceUnitIds: entry.sourceUnitIds, supportStatus: "CONFLICTING", candidates: values };
  }
  const selected = values.includes("NONE_OF_THE_ABOVE") ? ["NONE_OF_THE_ABOVE"] : values.filter((item) => item !== "UNKNOWN");
  return {
    answerState: selected.includes("NONE_OF_THE_ABOVE") ? "NO" : selected.length ? "YES" : "UNKNOWN",
    values: selected.length ? selected : ["UNKNOWN"],
    sourceUnitIds: entry.sourceUnitIds
  };
}

function detectedName(sources, searchOverrides) {
  const candidates = searchEntries(sources, "name", searchOverrides).map((entry) => ({ value: entry.text, sourceUnitId: entry.sourceUnitId }));
  if (!candidates.length) return null;
  const canonical = new Map();
  for (const candidate of candidates) canonical.set(normalizedFieldValue("name", candidate.value), [...(canonical.get(normalizedFieldValue("name", candidate.value)) ?? []), candidate]);
  if (canonical.size > 1) return { value: null, conflict: true, candidates: unique(candidates.map((item) => item.value)), sourceUnitIds: unique(candidates.map((item) => item.sourceUnitId)) };
  return { value: candidates[0].value, sourceUnitIds: unique(candidates.map((item) => item.sourceUnitId)), strength: "EXPLICIT" };
}

function detectedList(sources, field, values, searchOverrides) {
  const entries = searchEntries(sources, field, searchOverrides);
  const candidates = entries.map((entry) => ({
    text: entry.text,
    value: unique(values.filter(([, pattern]) => pattern.test(entry.text)).map(([canonical]) => canonical)),
    sourceUnitId: entry.sourceUnitId
  })).filter((entry) => entry.value.length);
  if (!candidates.length) return { value: [], sourceUnitIds: [] };
  const distinct = unique(candidates.map((entry) => [...entry.value].sort().join("|")));
  if (distinct.length > 1) return { value: null, sourceUnitIds: unique(candidates.map((entry) => entry.sourceUnitId)), candidates: candidates.map((entry) => entry.value), conflict: true };
  return { value: candidates[0].value, sourceUnitIds: unique(candidates.map((entry) => entry.sourceUnitId)) };
}

function provisionalDossier(detected) {
  const detectedRoles = detected.roles?.value ?? [];
  const intakeAnswers = Object.fromEntries(Object.entries(detected.intakeAnswers ?? {}).map(([questionId, answer]) => [questionId, {
    answerState: answer.answerState,
    values: answer.values,
    origin: "OBSERVED",
    supportStatus: "PARTIAL",
    sourceUnitIds: answer.sourceUnitIds,
    evidenceLinks: [],
    limitations: ["The answer was mechanically located in explicitly labelled source content and requires user confirmation."],
    confirmedBy: null,
    confirmedAt: null
  }]));
  if (detectedRoles.length && !intakeAnswers.REGULATORY_ROLES) {
    intakeAnswers.REGULATORY_ROLES = {
      answerState: "YES", values: detectedRoles, origin: "OBSERVED", supportStatus: "PARTIAL",
      sourceUnitIds: detected.roles.sourceUnitIds, evidenceLinks: [], limitations: ["Role terminology was mechanically located and still requires legal or governance confirmation."],
      confirmedBy: null, confirmedAt: null
    };
  }
  return {
    name: detected.name?.value ?? "",
    intendedPurpose: detected.intendedPurpose?.value ?? "",
    expectedValue: detected.expectedValue?.value ?? "",
    currentStage: detected.currentStage?.value ?? "UNKNOWN",
    targetStage: detected.targetStage?.value ?? "UNKNOWN",
    jurisdictions: detected.jurisdictions?.value ?? [],
    roles: detected.roles?.value ?? [],
    users: detected.users?.value ?? [],
    accountableOwner: detected.accountableOwner?.value ?? "",
    data: {
      categories: detected.dataCategories?.value ?? [],
      personalData: detected.personalData?.value ?? null,
      specialCategoryData: detected.specialCategoryData?.value ?? null,
      productionData: detected.productionData?.value ?? null
    },
    exposure: {
      currentUserAccess: detected.currentUserAccess?.value ?? "UNKNOWN",
      intendedUserAccess: detected.intendedUserAccess?.value ?? "UNKNOWN",
      externalUsers: detected.externalUsers?.value ?? null,
      productionAccess: detected.productionAccess?.value ?? null,
      consequentialDecisions: detected.consequentialDecisions?.value ?? null
    },
    agent: {
      usesAgents: detected.usesAgents?.value ?? null,
      canTakeActions: detected.canTakeActions?.value ?? null,
      irreversibleActions: detected.irreversibleActions?.value ?? null,
      humanOverride: detected.humanOverride?.value ?? null
    },
    classification: {
      prohibitedPractice: detected.prohibitedPractice?.value ?? null,
      highRiskCandidate: detected.highRiskCandidate?.value ?? null
    },
    intakeAnswers,
    operatingBoundary: {
      allowedUses: detected.allowedUses?.value ? [detected.allowedUses.value] : [],
      excludedUses: detected.excludedUses?.value ? [detected.excludedUses.value] : [],
      environment: detected.environment?.value ?? "ISOLATED_SANDBOX",
      userScope: detected.userScope?.value ?? "",
      dataScope: detected.dataScope?.value ?? "",
      integrationScope: detected.integrationScope?.value ?? "",
      permissionScope: detected.permissionScope?.value ?? "",
      autonomyScope: detected.autonomyScope?.value ?? "",
      monitoringOwner: detected.monitoringOwner?.value ?? "",
      expiresAt: detected.expiresAt?.value ?? null
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

export function discoverSolutionProfile(rawSources, declaredDossier = null, confirmation = {}, options = {}) {
  const sources = sourceText(rawSources);
  const searchOverrides = options.searchOverrides;
  const discoveryTime = new Date().toISOString();
  const lifecycleOptions = LIFECYCLE_STAGES.map((stage) => [stage, [words(stage)]]);
  const accessOptions = [
    ["INTERNAL_ONLY", ["internal only", "internal users"]],
    ["EXTERNAL_WITH_SOLUTION_OWNER", ["external with solution owner"]],
    ["CONTROLLED_EXTERNAL_PILOT", ["controlled external pilot"]],
    ["RESTRICTED_CUSTOMER_USE", ["restricted customer use"]],
    ["PUBLIC_ACCESS", ["public access", "public"]],
    ["EXTERNAL_UNSPECIFIED", ["external unspecified", "external"]],
    ["UNKNOWN", ["unknown"]]
  ];
  const intakeAnswers = Object.fromEntries(INTAKE_QUESTIONNAIRE.questions.map((question) => [question.id, detectedQuestionAnswer(sources, question, searchOverrides)]).filter(([, answer]) => answer));
  const detected = {
    name: detectedName(sources, searchOverrides),
    intendedPurpose: labelledValue(sources, "intendedPurpose", searchOverrides),
    expectedValue: labelledValue(sources, "expectedValue", searchOverrides),
    accountableOwner: labelledValue(sources, "accountableOwner", searchOverrides),
    currentStage: detectedEnum(sources, "currentStage", lifecycleOptions, searchOverrides),
    targetStage: detectedEnum(sources, "targetStage", lifecycleOptions, searchOverrides),
    jurisdictions: detectedList(sources, "jurisdictions", [["FI", /\b(?:Finland|Finnish|FI|FIN)\b/i], ["EU", /\b(?:European Union|EU|EEA)\b/i]], searchOverrides),
    roles: detectedList(sources, "roles", [["PROVIDER", /\bprovider\b/i], ["DEPLOYER", /\bdeployer\b/i], ["IMPORTER", /\bimporter\b/i], ["DISTRIBUTOR", /\bdistributor\b/i]], searchOverrides),
    users: detectedList(sources, "users", [["EMPLOYEES", /\b(?:employees?|internal users?|staff)\b/i], ["CUSTOMERS", /\b(?:customers?|end users?|consumers?)\b/i]], searchOverrides),
    dataCategories: detectedList(sources, "data.categories", [
      ["SYNTHETIC", /\b(?:synthetic|simulated)\b/i], ["PUBLIC_NON_PERSONAL", /\bpublic[-_ ]non[-_ ]personal(?:[-_ ]data)?\b/i], ["ANONYMIZED", /\banonymi[sz]ed\b/i],
      ["PSEUDONYMIZED", /\bpseudonymi[sz]ed\b/i], ["CLEANED_APPROVED_PRODUCTION", /\bcleaned (?:and )?approved production\b/i], ["RAW_PRODUCTION", /\braw production\b/i],
      ["PERSONAL_DATA", /(?<!non[-_ ])\bpersonal[-_ ]data\b/i], ["SPECIAL_CATEGORY_DATA", /\bspecial[-_ ]category[-_ ]data\b/i], ["CONFIDENTIAL_OR_PROPRIETARY", /\b(?:confidential|proprietary)\b/i]
    ], searchOverrides),
    personalData: detectedBoolean(sources, "data.personalData", searchOverrides),
    specialCategoryData: detectedBoolean(sources, "data.specialCategoryData", searchOverrides),
    productionData: detectedBoolean(sources, "data.productionData", searchOverrides),
    currentUserAccess: detectedEnum(sources, "exposure.currentUserAccess", accessOptions, searchOverrides),
    intendedUserAccess: detectedEnum(sources, "exposure.intendedUserAccess", accessOptions, searchOverrides),
    externalUsers: detectedBoolean(sources, "exposure.externalUsers", searchOverrides),
    productionAccess: detectedBoolean(sources, "exposure.productionAccess", searchOverrides),
    consequentialDecisions: detectedBoolean(sources, "exposure.consequentialDecisions", searchOverrides),
    usesAgents: detectedBoolean(sources, "agent.usesAgents", searchOverrides),
    canTakeActions: detectedBoolean(sources, "agent.canTakeActions", searchOverrides),
    irreversibleActions: detectedBoolean(sources, "agent.irreversibleActions", searchOverrides),
    humanOverride: detectedBoolean(sources, "agent.humanOverride", searchOverrides),
    prohibitedPractice: detectedBoolean(sources, "classification.prohibitedPractice", searchOverrides),
    highRiskCandidate: detectedBoolean(sources, "classification.highRiskCandidate", searchOverrides),
    allowedUses: labelledValue(sources, "operatingBoundary.allowedUses", searchOverrides),
    excludedUses: labelledValue(sources, "operatingBoundary.excludedUses", searchOverrides),
    environment: detectedEnum(sources, "operatingBoundary.environment", [
      ["ISOLATED_SANDBOX", ["isolated sandbox", "sandbox"]], ["CONTROLLED_PILOT", ["controlled pilot", "pilot"]], ["PRODUCTION", ["production"]], ["UNKNOWN", ["unknown"]]
    ], searchOverrides),
    userScope: labelledValue(sources, "operatingBoundary.userScope", searchOverrides),
    dataScope: labelledValue(sources, "operatingBoundary.dataScope", searchOverrides),
    integrationScope: labelledValue(sources, "operatingBoundary.integrationScope", searchOverrides),
    permissionScope: labelledValue(sources, "operatingBoundary.permissionScope", searchOverrides),
    autonomyScope: labelledValue(sources, "operatingBoundary.autonomyScope", searchOverrides),
    monitoringOwner: labelledValue(sources, "operatingBoundary.monitoringOwner", searchOverrides),
    expiresAt: labelledValue(sources, "operatingBoundary.expiresAt", searchOverrides),
    intakeAnswers
  };
  const detectedByField = {
    ...detected,
    "operatingBoundary.allowedUses": detected.allowedUses?.value ? { ...detected.allowedUses, value: [detected.allowedUses.value] } : detected.allowedUses,
    "operatingBoundary.excludedUses": detected.excludedUses?.value ? { ...detected.excludedUses, value: [detected.excludedUses.value] } : detected.excludedUses,
    "operatingBoundary.environment": detected.environment,
    "operatingBoundary.userScope": detected.userScope,
    "operatingBoundary.dataScope": detected.dataScope,
    "operatingBoundary.integrationScope": detected.integrationScope,
    "operatingBoundary.permissionScope": detected.permissionScope,
    "operatingBoundary.autonomyScope": detected.autonomyScope,
    "operatingBoundary.monitoringOwner": detected.monitoringOwner,
    "operatingBoundary.expiresAt": detected.expiresAt,
    "data.categories": detected.dataCategories,
    "data.personalData": detected.personalData,
    "data.specialCategoryData": detected.specialCategoryData,
    "data.productionData": detected.productionData,
    "exposure.currentUserAccess": detected.currentUserAccess,
    "exposure.intendedUserAccess": detected.intendedUserAccess,
    "exposure.externalUsers": detected.externalUsers,
    "exposure.productionAccess": detected.productionAccess,
    "exposure.consequentialDecisions": detected.consequentialDecisions,
    "agent.usesAgents": detected.usesAgents,
    "agent.canTakeActions": detected.canTakeActions,
    "agent.irreversibleActions": detected.irreversibleActions,
    "agent.humanOverride": detected.humanOverride,
    "classification.prohibitedPractice": detected.prohibitedPractice,
    "classification.highRiskCandidate": detected.highRiskCandidate
  };
  const dossier = declaredDossier ?? provisionalDossier(detected);
  const flattened = flattenDossier(dossier);
  const facts = {};
  const contradictions = [];
  const provisionalDefaults = new Set(["currentStage", "targetStage", "operatingBoundary.environment"]);
  for (const [field, value] of Object.entries(flattened)) {
    const direct = explicitMatches(sources, value, field, searchOverrides);
    const discovery = detectedByField[field];
    const discoveredIds = discovery && normalizedFieldValue(field, discovery.value) === normalizedFieldValue(field, value) ? discovery.sourceUnitIds : [];
    const sourceUnitIds = unique([...direct, ...discoveredIds]);
    const userConfirmed = confirmation[field]?.confirmed === true;
    const userEdited = confirmation[field]?.userEdited === true;
    const priorFact = userEdited ? null : confirmation[field]?.priorFact;
    const hasValue = value !== undefined && value !== null && value !== "" && value !== "UNKNOWN" && (!Array.isArray(value) || value.length > 0);
    const conflictingCandidates = discovery?.conflict === true;
    const conflictsWithDetected = conflictingCandidates || Boolean(declaredDossier && !direct.length && discovery && normalizedFieldValue(field, discovery.value) && normalizedFieldValue(field, discovery.value) !== normalizedFieldValue(field, value));
    const lifecycleUnknown = ["currentStage", "targetStage"].includes(field) && dossier.lifecycleDeclaration?.[field] === "UNKNOWN";
    const provisionalUnknown = lifecycleUnknown || (!declaredDossier && provisionalDefaults.has(field) && !sourceUnitIds.length);
    if (conflictsWithDetected) contradictions.push({
      id: stableId("solution-contradiction", { field, declaredValue: value, observedValue: discovery.value, sourceUnitIds: discovery.sourceUnitIds }),
      field, declaredValue: value, observedValue: discovery.value, observedCandidates: discovery.candidates ?? [], sourceUnitIds: discovery.sourceUnitIds,
      severity: criticalFields.has(field) ? "HIGH" : "MEDIUM",
      statement: `${field} differs between the submitted declaration and source evidence.`
    });
    facts[field] = fact(field, value, {
      factClass: userEdited ? "SELF_DECLARED" : priorFact?.factClass ?? (sourceUnitIds.length ? "OBSERVED" : provisionalUnknown || !hasValue ? "INFERRED" : "SELF_DECLARED"),
      status: conflictsWithDetected ? "CONFLICTING" : provisionalUnknown || !hasValue ? "UNKNOWN" : userEdited ? "CANDIDATE" : userConfirmed && priorFact?.factClass === "OBSERVED" ? "CONFIRMED" : priorFact?.status ?? (sourceUnitIds.length && (declaredDossier || userConfirmed) ? "CONFIRMED" : "CANDIDATE"),
      supportStrength: priorFact?.supportStrength ?? (sourceUnitIds.length ? "EXPLICIT" : hasValue ? "DERIVED" : "WEAK"),
      sourceUnitIds: unique([...(priorFact?.sourceUnitIds ?? sourceUnitIds), ...(conflictsWithDetected ? discovery.sourceUnitIds : [])]),
      confirmedBy: userEdited ? confirmation[field].confirmedBy ?? "USER" : userConfirmed ? confirmation[field].confirmedBy ?? "USER" : declaredDossier && sourceUnitIds.length ? "DOSSIER_SUBMISSION" : null,
      confirmedAt: userEdited ? confirmation[field].confirmedAt ?? discoveryTime : userConfirmed ? confirmation[field].confirmedAt ?? discoveryTime : declaredDossier && sourceUnitIds.length ? discoveryTime : null,
      limitations: conflictsWithDetected ? ["User confirmation cannot erase the contradictory observed candidate."] : userEdited ? ["The user changed the discovered value; the resulting value is self-declared even when similar source text exists."] : priorFact?.limitations ?? (sourceUnitIds.length ? [] : hasValue ? ["The value is self-declared but not located in the submitted source material."] : ["No value was detected or declared."])
    });
    if (conflictsWithDetected) facts[field].candidates = conflictingCandidates
      ? discovery.candidates.map((candidate) => ({ value: candidate, factClass: "OBSERVED", sourceUnitIds: discovery.sourceUnitIds }))
      : [{ value, factClass: "SELF_DECLARED" }, { value: discovery.value, factClass: "OBSERVED", sourceUnitIds: discovery.sourceUnitIds }];
  }
  addSemanticContradictions(dossier, facts, contradictions);
  const assessmentIntakeFacts = Object.fromEntries(INTAKE_QUESTIONNAIRE.questions.map((question) => {
    const sourceAnswer = intakeAnswers[question.id];
    const dossierAnswer = dossier.intakeAnswers?.[question.id];
    const sourceMatchesDossier = !declaredDossier || !dossierAnswer || sourceAnswer?.answerState === dossierAnswer.answerState
      && normalizedFieldValue(question.fieldId, sourceAnswer?.values ?? []) === normalizedFieldValue(question.fieldId, dossierAnswer.values ?? []);
    const sourceConflict = Boolean(sourceAnswer && dossierAnswer && !sourceMatchesDossier);
    const discoveredAnswer = sourceMatchesDossier ? sourceAnswer : null;
    const answer = discoveredAnswer && dossierAnswer && options.trustedIntakeProvenance === true
      ? { ...discoveredAnswer, origin: dossierAnswer.origin ?? "OBSERVED", supportStatus: dossierAnswer.supportStatus ?? discoveredAnswer.supportStatus, evidenceLinks: dossierAnswer.evidenceLinks ?? [], limitations: dossierAnswer.limitations ?? [], confirmedBy: dossierAnswer.confirmedBy ?? null, confirmedAt: dossierAnswer.confirmedAt ?? null }
      : discoveredAnswer ?? dossierAnswer ?? {};
    const answerState = answer.answerState ?? "UNKNOWN";
    const values = answer.values ?? [];
    const trustedAnswer = Boolean(discoveredAnswer) || options.trustedIntakeProvenance === true;
    const acceptedSourceUnitIds = sourceConflict ? unique(sourceAnswer.sourceUnitIds ?? []) : trustedAnswer ? unique(answer.sourceUnitIds ?? []) : [];
    const item = {
      id: stableId("assessment-intake-fact", { questionId: question.id, answerState, values, sourceUnitIds: acceptedSourceUnitIds }),
      questionId: question.id,
      fieldId: question.fieldId,
      value: values.length ? values : answerState,
      answerState,
      origin: discoveredAnswer ? "OBSERVED" : trustedAnswer && answer.origin !== "USER_DECLARED" ? answer.origin ?? "SELF_DECLARED" : "SELF_DECLARED",
      supportStatus: sourceConflict ? "CONFLICTING" : trustedAnswer ? answer.supportStatus ?? (discoveredAnswer ? "PARTIAL" : answerState === "UNKNOWN" ? "NOT_CHECKED" : "UNSUPPORTED") : answerState === "UNKNOWN" ? "NOT_CHECKED" : "UNSUPPORTED",
      evidenceLinks: trustedAnswer ? answer.evidenceLinks ?? [] : [],
      sourceUnitIds: acceptedSourceUnitIds,
      requirementMappings: question.sourceMappings ?? [],
      limitations: unique([...(sourceConflict ? ["The user answer differs from explicitly labelled source evidence; both candidates require resolution."] : trustedAnswer ? answer.limitations ?? (discoveredAnswer ? ["The answer was mechanically located in explicitly labelled source content and requires user confirmation."] : []) : ["Client-supplied provenance is not trusted; the answer is treated as self-declared."]), ...(answerState !== "UNKNOWN" && !(trustedAnswer && answer.sourceUnitIds?.length) && !sourceConflict ? ["The answer is declared but is not supported by submitted evidence."] : [])]),
      confirmedBy: trustedAnswer ? answer.confirmedBy ?? null : answerState === "UNKNOWN" ? null : "SUBMITTER",
      confirmedAt: trustedAnswer ? answer.confirmedAt ?? null : null,
      negativeAnswerRequiresEvidence: question.negativeAnswerRequiresEvidence === true,
      humanDecisionAuthority: question.humanDecisionAuthority
    };
    if (sourceConflict) item.candidates = [{ answerState, values, origin: "SELF_DECLARED" }, { answerState: sourceAnswer.answerState, values: sourceAnswer.values, origin: "OBSERVED", sourceUnitIds: sourceAnswer.sourceUnitIds }];
    else if (discoveredAnswer?.candidates?.length) item.candidates = discoveredAnswer.candidates.map((candidate) => ({ value: structuredClone(candidate), origin: "OBSERVED", sourceUnitIds: discoveredAnswer.sourceUnitIds }));
    return [question.id, { ...item, hash: sha256(item) }];
  }));
  const profile = {
    version: "solution-profile-1.3.0",
    searchRegistryVersion: INTAKE_SEARCH_REGISTRY.version,
    searchRegistryHash: INTAKE_SEARCH_REGISTRY.hash,
    fields: facts,
    assessmentIntakeFacts,
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
              : "SELF_DECLARED_ONLY";
  }
  const values = Object.values(statuses);
  const unknownFields = Object.entries(statuses).filter(([, value]) => value === "UNKNOWN").map(([field]) => field);
  const conflictingFields = Object.entries(statuses).filter(([, value]) => value === "CONFLICTING").map(([field]) => field);
  const selfDeclaredOnlyFields = Object.entries(statuses).filter(([, value]) => value === "SELF_DECLARED_ONLY").map(([field]) => field);
  const sourceSupportedFields = Object.entries(statuses).filter(([, value]) => ["DOCUMENTED_AND_CONFIRMED", "OBSERVED"].includes(value)).map(([field]) => field);
  const confirmedFields = Object.entries(statuses).filter(([, value]) => value === "DOCUMENTED_AND_CONFIRMED").map(([field]) => field);
  const notApplicableFields = Object.entries(statuses).filter(([, value]) => value === "NOT_APPLICABLE").map(([field]) => field);
  const deploymentTarget = ["DEPLOYMENT", "OPERATION_AND_MONITORING", "REVIEW_AND_EVALUATION", "RETIREMENT"].includes(targetStage);
  const implementationSourceCount = (profile.artifactCounts?.PRODUCTION_CODE ?? 0) + (profile.artifactCounts?.CONFIGURATION ?? 0);
  const missingImplementationScope = deploymentTarget && implementationSourceCount === 0;
  const sourceCoverageReviewRequired = sourceIngestion?.coverageStatus === "INCOMPLETE_REVIEW_REQUIRED" && !sourceIngestion?.humanCoverageAcceptance;
  const questionFacts = Object.values(profile.assessmentIntakeFacts ?? {});
  const relevantQuestionIds = activeIntakeQuestionIds(profile.assessmentIntakeFacts);
  const questionnaireUnknowns = questionFacts.filter((item) => relevantQuestionIds.has(item.questionId) && ["UNKNOWN", "HUMAN_REVIEW_REQUIRED"].includes(item.answerState)).map((item) => item.questionId);
  const unsupportedNegativeAnswers = questionFacts.filter((item) => relevantQuestionIds.has(item.questionId) && ["NO", "NOT_APPLICABLE"].includes(item.answerState) && item.negativeAnswerRequiresEvidence && !["SUPPORTED", "PARTIAL"].includes(item.supportStatus) && item.origin !== "HUMAN_CLASSIFIED").map((item) => item.questionId);
  const questionnaireConflicts = questionFacts.filter((item) => relevantQuestionIds.has(item.questionId) && item.supportStatus === "CONFLICTING").map((item) => item.questionId);
  const selfDeclaredQuestionIds = questionFacts.filter((item) => relevantQuestionIds.has(item.questionId) && item.answerState !== "UNKNOWN" && item.origin === "SELF_DECLARED").map((item) => item.questionId);
  const selfDeclaredProfileFields = Object.values(profile.fields).filter((item) => item.factClass === "SELF_DECLARED" && item.status !== "UNKNOWN" && item.value !== null).map((item) => item.field);
  const selfDeclaredIntakeFields = unique([...selfDeclaredProfileFields, ...selfDeclaredQuestionIds.map((id) => `intakeAnswers.${id}`)]);
  const maximumLifecycleStage = selfDeclaredIntakeFields.length ? "VERIFICATION_AND_VALIDATION" : null;
  const targetExceedsSelfDeclarationBoundary = maximumLifecycleStage !== null && LIFECYCLE_STAGES.indexOf(targetStage) > LIFECYCLE_STAGES.indexOf(maximumLifecycleStage);
  const incompleteForDeployment = values.some((value) => !["DOCUMENTED_AND_CONFIRMED", "NOT_APPLICABLE"].includes(value)) || missingImplementationScope || sourceCoverageReviewRequired || questionnaireUnknowns.length > 0 || unsupportedNegativeAnswers.length > 0 || questionnaireConflicts.length > 0;
  const materialContradictions = profile.contradictions.filter((item) => ["HIGH", "CRITICAL"].includes(item.severity));
  const criticalQuestionIds = new Set(["AI_SYSTEM_QUALIFICATION", "PROHIBITED_PRACTICE_CATEGORIES", "EU_MARKET_OR_SERVICE", "EU_ESTABLISHED_ACTOR", "EU_OUTPUT_USED", "ANNEX_III_USE_AREAS"]);
  const sandboxRequired = [...unknownFields, ...conflictingFields].some((field) => criticalFields.has(field)) || questionnaireUnknowns.some((id) => criticalQuestionIds.has(id)) || questionnaireConflicts.length > 0 || materialContradictions.length > 0 || sourceCoverageReviewRequired;
  const value = {
    version: "documentation-readiness-1.2.0",
    fieldStatuses: statuses,
    mandatoryFieldCount: deployRequiredFields.length,
    documentedAndConfirmedCount: confirmedFields.length,
    satisfiedFieldCount: confirmedFields.length + notApplicableFields.length,
    sourceSupportedFields, confirmedFields, notApplicableFields, selfDeclaredOnlyFields,
    userDeclaredOnlyFields: selfDeclaredOnlyFields,
    selfDeclaredQuestionIds,
    selfDeclaredIntakeFields,
    maximumLifecycleStage,
    selfDeclarationGateRequired: targetExceedsSelfDeclarationBoundary,
    unknownFields, conflictingFields,
    implementationSourceCount,
    missingImplementationScope,
    contradictions: profile.contradictions,
    materialContradictionCount: materialContradictions.length,
    sourceCoverageStatus: sourceIngestion?.coverageStatus ?? "SUBMITTED_SCOPE_ONLY",
    sourceCoverageReviewRequired,
    questionnaireUnknowns,
    unsupportedNegativeAnswers,
    questionnaireConflicts,
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
  const activeQuestionIds = activeIntakeQuestionIds(profile.assessmentIntakeFacts);
  const allQuestionFacts = Object.values(profile.assessmentIntakeFacts ?? {});
  const activeQuestionFacts = allQuestionFacts.filter((item) => activeQuestionIds.has(item.questionId));
  const intake = {
    version: "assessment-intake-1.3.0",
    identity: { name: dossier.name, accountableOwner: dossier.accountableOwner },
    intendedUse: { intendedPurpose: dossier.intendedPurpose, expectedValue: dossier.expectedValue },
    lifecycle: { currentStage: dossier.currentStage, targetStage: dossier.targetStage },
    jurisdictionsAndRoles: { jurisdictions: dossier.jurisdictions, roles: dossier.roles },
    usersAndAffectedGroups: dossier.users,
    operatingBoundary: structuredClone(dossier.operatingBoundary),
    data: structuredClone(dossier.data), exposure: structuredClone(dossier.exposure),
    agentAuthority: structuredClone(dossier.agent), classification: structuredClone(dossier.classification),
    questionnaire: {
      id: INTAKE_QUESTIONNAIRE.id,
      version: INTAKE_QUESTIONNAIRE.version,
      answers: activeQuestionFacts,
      inactiveAnswers: allQuestionFacts.filter((item) => !activeQuestionIds.has(item.questionId)).map((item) => ({ ...item, active: false })),
      humanClassificationQuestions: activeQuestionFacts.filter((item) => item.answerState === "HUMAN_REVIEW_REQUIRED" || item.supportStatus === "CONFLICTING").map((item) => item.questionId)
    },
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
  const questionById = new Map(INTAKE_QUESTIONNAIRE.questions.map((item) => [item.id, item]));
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
    ],
    classificationScreening: (assessmentIntake.questionnaire?.answers ?? []).map((item) => ({
      field: item.questionId,
      label: questionById.get(item.questionId)?.prompt ?? item.questionId,
      value: item.value,
      status: item.answerState === "UNKNOWN" ? "UNKNOWN" : item.supportStatus
    }))
  };
}

export function validLifecycle(value) { return LIFECYCLE_STAGES.includes(value); }
