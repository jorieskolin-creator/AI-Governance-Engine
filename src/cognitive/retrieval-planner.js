import { invariant } from "../contracts.js";
import { sha256 } from "../core/hash.js";
import { setAcquisitionGenAiStatus } from "../intake/acquisition-diagnostics.js";
import { intakeField } from "../intake/field-registry.js";
import { INTAKE_GAP_ANALYSIS_VERSION, validateIntakeGapAnalysis } from "../intake/gap-analysis.js";
import { intakeSearchField } from "../intake/search-registry.js";
import { INTAKE_RETRIEVAL_PLANNER_SCHEMA } from "./contracts.js";
import { classifyCognitiveFailure } from "./failure-policy.js";
import { modelPolicy } from "./model-policy.js";
import { COGNITIVE_PROVIDERS } from "./provider-adapters.js";
import { ModelBudget, StructuredModelClient } from "./provider-client.js";
import { intakeRetrievalPlanningPrompt, PROMPT_VERSIONS } from "./prompts.js";

export const INTAKE_RETRIEVAL_PLAN_VERSION = "intake-retrieval-plan-1.0.0";
export const RETRIEVAL_PLANNING_PURPOSE = "INTAKE_RETRIEVAL_PLANNING_FROM_SAFE_METRICS";

const AUTHORITY = "RETRIEVAL_SUGGESTION_ONLY_NO_FACT_VALUE_CLASSIFICATION_FINDING_OR_APPROVAL_AUTHORITY";
const FIXED_LIMITATIONS = Object.freeze([
  "THE_PLAN_IS_NOT_EVIDENCE_AND_CANNOT_POPULATE_INTAKE",
  "SUGGESTIONS_MUST_BE_EXECUTED_ONLY_BY_A_BOUNDED_LOCAL_REREAD",
  "EVERY_RESULTING_CANDIDATE_MUST_REENTER_DLP_SANITIZATION_AND_VALIDATION"
]);
const SAFE_TERM = /^[\p{L}\p{N}][\p{L}\p{N} _/-]{0,79}$/u;
const ASSERTIVE_TERM = /\b(?:is|are|was|were|has|have|will|must|should|approved|compliant|certified|safe)\b/i;

function validateTerms(values, label, field) {
  invariant(Array.isArray(values) && values.length <= 8, `${label} are invalid`);
  invariant(new Set(values.map((value) => value.toLocaleLowerCase())).size === values.length, `${label} must be unique`);
  const prohibitedValues = new Set([...(field.allowedValues ?? []), "YES", "NO", "TRUE", "FALSE", "UNKNOWN", "NOT_APPLICABLE"].map((value) => String(value).replaceAll("_", " ").toLocaleLowerCase()));
  invariant(values.every((value) => typeof value === "string" && value === value.trim() && SAFE_TERM.test(value) && value.split(/\s+/).length <= 8 && !ASSERTIVE_TERM.test(value) && !prohibitedValues.has(value.replaceAll("_", " ").toLocaleLowerCase())), `${label} contain an unsafe, value-like, or unbounded term`);
}

function artifactClassMetrics(sourceIngestion) {
  return [...new Set(sourceIngestion.items.map((item) => item.artifactClass))].sort().map((artifactClass) => ({
    artifactClass,
    selectedSourceCount: sourceIngestion.items.filter((item) => item.artifactClass === artifactClass).length,
    parsedSourceCount: sourceIngestion.items.filter((item) => item.artifactClass === artifactClass && item.disposition === "PARSED").length
  }));
}

export function createRetrievalPlannerContext(run) {
  const gap = validateIntakeGapAnalysis(run?.intakeGapAnalysis);
  const targetGaps = gap.fields.filter((field) => field.retrievalDisposition === "BOUNDED_LOCAL_REREAD_POSSIBLE");
  invariant(targetGaps.length > 0, "No bounded Intake retrieval opportunity is available");
  return {
    schemaVersion: "intake-retrieval-planner-context-1.0.0",
    gapAnalysisVersion: gap.schemaVersion,
    gapAnalysisHash: gap.analysisHash,
    safeMetrics: structuredClone({ summary: gap.summary, coverage: gap.coverage }),
    artifactClasses: artifactClassMetrics(run.sourceIngestion),
    controlledConceptSignals: structuredClone(gap.safeConceptCoverage),
    targetFields: targetGaps.map((fieldGap) => {
      const field = intakeField(fieldGap.fieldId);
      const search = intakeSearchField(fieldGap.fieldId);
      return {
        fieldId: field.id,
        dataType: field.dataType,
        registeredLabels: [...search.labels],
        registeredEvidenceTypes: [...search.evidenceTypes],
        registeredExtractionStrategies: [...search.extractionStrategies],
        attemptedMethods: [...fieldGap.attemptedMethods],
        coveredEvidenceTypes: [...fieldGap.coveredEvidenceTypes],
        technicalLoss: structuredClone(fieldGap.technicalLoss),
        relevantControlledConceptSignals: [...fieldGap.relevantSafeConceptSignals]
      };
    }),
    authority: AUTHORITY
  };
}

export function validateIntakeRetrievalPlan(plan, gapAnalysis = null) {
  invariant(plan?.schemaVersion === INTAKE_RETRIEVAL_PLAN_VERSION, "Intake retrieval plan version is unsupported");
  invariant(plan.gapAnalysisVersion === INTAKE_GAP_ANALYSIS_VERSION && /^[a-f0-9]{64}$/.test(plan.gapAnalysisHash), "Intake retrieval plan gap source is invalid");
  if (gapAnalysis) {
    validateIntakeGapAnalysis(gapAnalysis);
    invariant(plan.gapAnalysisHash === gapAnalysis.analysisHash, "Intake retrieval plan gap source is stale");
  }
  invariant(plan.plannerRole === "WORKHORSE" && COGNITIVE_PROVIDERS.includes(plan.provider) && typeof plan.configuredModel === "string" && plan.configuredModel, "Intake retrieval planner identity is invalid");
  invariant(plan.authority === AUTHORITY && JSON.stringify(plan.limitations) === JSON.stringify(FIXED_LIMITATIONS), "Intake retrieval plan authority is invalid");
  invariant(Array.isArray(plan.suggestions), "Intake retrieval plan suggestions are required");
  const expectedTargets = gapAnalysis?.fields.filter((field) => field.retrievalDisposition === "BOUNDED_LOCAL_REREAD_POSSIBLE").map((field) => field.fieldId) ?? plan.suggestions.map((item) => item.fieldId);
  invariant(plan.suggestions.length === expectedTargets.length && new Set(plan.suggestions.map((item) => item.fieldId)).size === plan.suggestions.length, "Intake retrieval plan field coverage is incomplete");
  for (const suggestion of plan.suggestions) {
    const field = intakeField(suggestion.fieldId);
    const search = intakeSearchField(suggestion.fieldId);
    invariant(field && search && expectedTargets.includes(suggestion.fieldId), `Intake retrieval plan contains an unsupported field: ${suggestion.fieldId}`);
    validateTerms(suggestion.searchConcepts, `${suggestion.fieldId} search concepts`, field);
    validateTerms(suggestion.labelAliases, `${suggestion.fieldId} label aliases`, field);
    invariant(suggestion.searchConcepts.length + suggestion.labelAliases.length + suggestion.sourcePriorities.length + suggestion.extractionStrategies.length > 0, `${suggestion.fieldId} retrieval suggestion is empty`);
    invariant(Array.isArray(suggestion.sourcePriorities) && new Set(suggestion.sourcePriorities).size === suggestion.sourcePriorities.length && suggestion.sourcePriorities.every((type) => search.evidenceTypes.includes(type)), `${suggestion.fieldId} source priorities are invalid`);
    invariant(Array.isArray(suggestion.extractionStrategies) && new Set(suggestion.extractionStrategies).size === suggestion.extractionStrategies.length && suggestion.extractionStrategies.every((strategy) => search.extractionStrategies.includes(strategy)), `${suggestion.fieldId} extraction strategies are invalid`);
    invariant(Object.keys(suggestion).sort().join(",") === ["extractionStrategies", "fieldId", "labelAliases", "searchConcepts", "sourcePriorities"].sort().join(","), `${suggestion.fieldId} retrieval suggestion contains unregistered fields`);
  }
  invariant(expectedTargets.every((fieldId) => plan.suggestions.some((item) => item.fieldId === fieldId)), "Intake retrieval plan field coverage is incomplete");
  invariant(Object.keys(plan).sort().join(",") === ["authority", "configuredModel", "gapAnalysisHash", "gapAnalysisVersion", "limitations", "planHash", "plannerRole", "provider", "schemaVersion", "suggestions"].sort().join(","), "Intake retrieval plan contains unregistered fields");
  const { planHash, ...payload } = plan;
  invariant(typeof planHash === "string" && sha256(payload) === planHash, "Intake retrieval plan failed its integrity check");
  return plan;
}

function validateConsent(input, run) {
  invariant(input?.confirmed === true && input.purpose === RETRIEVAL_PLANNING_PURPOSE, "Explicit retrieval-planning confirmation is required");
  invariant(input.gapAnalysisHash === run.intakeGapAnalysis?.analysisHash, "The reviewed Intake gap analysis is no longer current");
  invariant(Array.isArray(input.providers) && input.providers.length > 0 && new Set(input.providers).size === input.providers.length && input.providers.every((provider) => COGNITIVE_PROVIDERS.includes(provider)), "Retrieval-planning providers are invalid");
}

export async function planIntakeRetrieval(run, input, options = {}) {
  invariant(run?.status === "AWAITING_INTAKE_CONFIRMATION" && run.stage === "DETERMINISTIC_DISCOVERY_COMPLETED" && !run.retrievalPlan, "Intake retrieval planning is not available from the current run state");
  validateConsent(input, run);
  const context = createRetrievalPlannerContext(run);
  const contextHash = sha256(context);
  const policy = options.policy ?? modelPolicy(options.env);
  setAcquisitionGenAiStatus(run, "REQUESTED");
  run.trace.push({ stage: "INTAKE_RETRIEVAL_PLANNING", status: "RUNNING", at: new Date().toISOString(), contextHash });
  try {
    const profile = policy.choose("RETRIEVAL_PLANNING", { allowedProviders: input.providers });
    invariant(profile.operationalRole === "WORKHORSE", "Retrieval planning requires the WORKHORSE role");
    const client = options.client ?? new StructuredModelClient({ policy, budget: new ModelBudget({ maxCalls: 2, maxTokens: 30_000, maxMs: 120_000 }) });
    const generated = await client.generate({
      profile,
      prompt: intakeRetrievalPlanningPrompt(context),
      schemaName: "intake_retrieval_planner",
      schema: INTAKE_RETRIEVAL_PLANNER_SCHEMA,
      packetHash: contextHash,
      promptVersion: PROMPT_VERSIONS.retrievalPlanning
    });
    const payload = {
      schemaVersion: INTAKE_RETRIEVAL_PLAN_VERSION,
      gapAnalysisVersion: run.intakeGapAnalysis.schemaVersion,
      gapAnalysisHash: run.intakeGapAnalysis.analysisHash,
      plannerRole: profile.operationalRole,
      provider: profile.provider,
      configuredModel: profile.model,
      authority: AUTHORITY,
      suggestions: generated.value.suggestions.map((suggestion) => structuredClone(suggestion)),
      limitations: [...FIXED_LIMITATIONS]
    };
    const plan = validateIntakeRetrievalPlan({ ...payload, planHash: sha256(payload) }, run.intakeGapAnalysis);
    run.transmissionManifest ??= [];
    run.transmissionManifest.push({
      stage: "RETRIEVAL_PLANNING",
      provider: profile.provider,
      configuredModel: profile.model,
      packetIds: [],
      sourceUnitIds: [],
      contextHash,
      containsRawEvidence: false,
      derivationContracts: [run.intakeGapAnalysis.schemaVersion],
      approvalPurpose: input.purpose,
      approvedAt: new Date().toISOString(),
      transmittedAt: new Date().toISOString()
    });
    run.retrievalPlan = { status: "COMPLETED", plan, trace: generated.trace };
    setAcquisitionGenAiStatus(run, "COMPLETED");
    run.trace.push({ stage: "INTAKE_RETRIEVAL_PLANNING", status: "COMPLETED", at: new Date().toISOString(), contextHash, outputHash: generated.trace.outputHash });
    return run.retrievalPlan;
  } catch (error) {
    const failure = classifyCognitiveFailure(error);
    run.retrievalPlan = { status: "UNAVAILABLE", failureCode: failure.code, retryDisposition: failure.retryDisposition, policy: "Deterministic Intake gaps remain unchanged; no retrieval suggestion was executed." };
    setAcquisitionGenAiStatus(run, "UNAVAILABLE", failure.code);
    run.trace.push({ stage: "INTAKE_RETRIEVAL_PLANNING", status: "UNAVAILABLE", at: new Date().toISOString(), contextHash, failureCode: failure.code, retryDisposition: failure.retryDisposition });
    throw error;
  }
}
