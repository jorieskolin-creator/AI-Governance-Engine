import { validateDossier, validateSources } from "./contracts.js";
import { sha256, newId } from "./core/hash.js";
import { buildSourceRegistry, dossierEvidence, dossierRiskEvidence } from "./core/source-registry.js";
import { evaluateApplicability } from "./core/applicability.js";
import { assessAntiPatterns, assessControls, groupDomainResults } from "./core/assessment.js";
import { evaluateHardGates } from "./core/hard-gates.js";
import { buildActionGroundingRecords, selectPlaybookActions } from "./core/playbook-engine.js";
import { calculateReadiness, humanDecisionRequirements } from "./core/readiness.js";
import { buildAssuranceSummary, buildTransitionBoundary } from "./core/assurance-summary.js";
import { loadKnowledgeSnapshot, knowledgeManifestView } from "./knowledge/provider.js";
import { buildAssessmentIntake, buildDocumentationReadiness, discoverSolutionProfile } from "./core/solution-profile.js";
import { buildSourceIngestionManifest } from "./core/source-ingestion.js";
import { validateReadinessPackage } from "./readiness-package-contract.js";

const ENGINE_VERSION = "governance-engine-0.3.0";
const RULESET_VERSION = "readiness-rules-2.1.0";

function questionnaireHumanDecisions(assessmentIntake) {
  const map = new Map();
  for (const item of assessmentIntake.questionnaire?.answers ?? []) {
    if (item.answerState !== "HUMAN_REVIEW_REQUIRED" && item.supportStatus !== "CONFLICTING" && !(["NO", "NOT_APPLICABLE"].includes(item.answerState) && item.negativeAnswerRequiresEvidence && !["SUPPORTED", "PARTIAL"].includes(item.supportStatus) && item.origin !== "HUMAN_CLASSIFIED")) continue;
    const authorities = String(item.humanDecisionAuthority ?? "GOVERNANCE").split("_AND_").filter((value) => ["LEGAL", "PRIVACY", "SECURITY", "GOVERNANCE"].includes(value));
    for (const authority of authorities.length ? authorities : ["GOVERNANCE"]) {
      const current = map.get(authority) ?? { authority, reasons: [], status: "PENDING_HUMAN_DECISION" };
      current.reasons.push(`${item.questionId}: declared answer requires supported human interpretation`);
      map.set(authority, current);
    }
  }
  return [...map.values()];
}

function timed(trace, id, fn) {
  const startedAt = new Date();
  return Promise.resolve().then(fn).then((output) => {
    trace.push({ id, status: "COMPLETED", startedAt: startedAt.toISOString(), completedAt: new Date().toISOString(), outputHash: sha256(output) });
    return output;
  });
}

function solutionUnderstanding(dossier, registry, evidence, sourceIngestion) {
  const providers = evidence.filter((item) => item.signal === "model-inventory").map((item) => ({ source: item.path, excerpt: item.excerpt }));
  const signals = [...new Set(evidence.map((item) => item.signal))].sort();
  return {
    name: dossier.name,
    intendedPurpose: dossier.intendedPurpose,
    expectedValue: dossier.expectedValue,
    currentStage: dossier.currentStage,
    targetStage: dossier.targetStage,
    accountableOwner: dossier.accountableOwner,
    jurisdictions: dossier.jurisdictions,
    roles: dossier.roles,
    users: dossier.users,
    data: dossier.data,
    exposure: dossier.exposure,
    agent: dossier.agent,
    classification: dossier.classification,
    intakeAnswers: dossier.intakeAnswers,
    operatingBoundary: dossier.operatingBoundary,
    sourceCount: registry.registeredSources.length,
    sourceManifestHash: registry.registryHash,
    sourceIngestion,
    detectedProvidersAndModels: providers,
    detectedGovernanceSignals: signals,
    limitations: [
      "Static source evidence cannot prove production configuration or continuing operational effectiveness.",
      "A test file proves only that a test exists unless successful execution results and adequate scope are supplied.",
      "Legal applicability, residual-risk acceptance, and formal approval remain human decisions."
    ]
  };
}

async function buildPackage({ dossier, knowledge, registry, evidence, registryFindings, solution, solutionProfile, sourceIngestion, trace, startedAt, runId, schemaVersion, cognitiveCoverage, cognitive, lockedFindings = [] }) {
  const documentationReadiness = buildDocumentationReadiness(solutionProfile, dossier.targetStage, sourceIngestion);
  const assessmentIntake = buildAssessmentIntake(dossier, solutionProfile, documentationReadiness, registry.registeredSources, sourceIngestion);
  const applicability = await timed(trace, "applicability", () => evaluateApplicability(knowledge.requirements, dossier, startedAt));
  const controls = await timed(trace, "control-assessment", () => assessControls(knowledge.controls, applicability, evidence, dossier, knowledge.antipatterns));
  const antiPatterns = await timed(trace, "antipattern-assessment", () => assessAntiPatterns(knowledge.antipatterns, evidence, controls));
  const domains = groupDomainResults(controls, antiPatterns);
  const gates = await timed(trace, "hard-gates", () => evaluateHardGates({ dossier, registryFindings, controlAssessments: controls, applicability, evidence, documentationReadiness, sourceIngestion, cognitiveCoverage }));
  const actions = await timed(trace, "playbook", () => selectPlaybookActions(knowledge.tactics, lockedFindings));
  const actionGroundingRecords = buildActionGroundingRecords(actions, lockedFindings, knowledge.tactics);
  const readiness = calculateReadiness(controls, antiPatterns, gates, evidence, documentationReadiness);
  const decisionMap = new Map(humanDecisionRequirements(gates, applicability, dossier).map((item) => [item.authority, item]));
  for (const item of questionnaireHumanDecisions(assessmentIntake)) {
    const current = decisionMap.get(item.authority) ?? { authority: item.authority, reasons: [], status: item.status };
    current.reasons = [...new Set([...current.reasons, ...item.reasons])];
    decisionMap.set(item.authority, current);
  }
  const humanDecisions = [...decisionMap.values()];
  const transitionBoundary = buildTransitionBoundary({ dossier, gates, domains, readiness, humanDecisions, documentationReadiness });
  const knowledgeView = knowledgeManifestView(knowledge);
  const recommendation = {
    outcome: readiness.outcome,
    rationale: readiness.outcome === "READY_FOR_NEXT_STAGE"
      ? "No applicable control gap, confirmed anti-pattern, unresolved authority question, or hard gate prevents the declared transition."
      : `${gates.length} gate(s), ${domains.flatMap((item) => item.gaps).length} control gap(s), and ${antiPatterns.filter((item) => !["UNKNOWN", "TESTED_ABSENT"].includes(item.state)).length} risk indicator(s) determine this recommendation.`,
    formalApproval: false,
    boundary: "This is decision support. The engine cannot issue legal, privacy, security, governance, AI Forum, or AI Board approval."
  };
  const assuranceSummary = buildAssuranceSummary({
    schemaVersion, recommendation, dimensions: readiness.dimensions, transitionBoundary, gates, domains, actions,
    humanDecisions, evidence, solution, assessmentIntake, solutionProfile, documentationReadiness, knowledge: knowledgeView, cognitive
  });
  const completedAt = new Date();
  const draft = {
    schemaVersion,
    packageId: newId("readiness-package"),
    runId,
    engineVersion: ENGINE_VERSION,
    rulesetVersion: RULESET_VERSION,
    generatedAt: completedAt.toISOString(),
    knowledge: knowledgeView,
    solution,
    assessmentIntake,
    solutionProfile,
    documentationReadiness,
    sourceIngestion,
    documentationContradictions: solutionProfile.contradictions,
    documentationGate: gates.find((item) => item.code === "DOCUMENTATION_ALIGNMENT_REQUIRED") ?? null,
    recommendation,
    dimensions: readiness.dimensions,
    transitionBoundary,
    assuranceSummary,
    applicability,
    domains,
    hardGates: gates,
    actions,
    actionGroundingRecords,
    humanDecisionRequirements: humanDecisions,
    evidence: evidence.map(({ metadata: _metadata, ...item }) => item),
    ...(cognitive ? { cognitive } : {}),
    derivedSourceUnits: cognitive?.derivedSourceUnits ?? [],
    adjudicatedClaims: cognitive?.adjudicatedClaims ?? [],
    unresolvedClaims: cognitive?.unresolvedClaims ?? [],
    coverageMatrix: cognitive?.coverageMatrix ?? null,
    findingLockRecords: cognitive?.findingLockRecords ?? [],
    reanalysisTrace: cognitive?.reanalysisTrace ?? [],
    publicationGate: cognitive?.publicationGate ?? null,
    trace: {
      inputHash: sha256({ dossier, sources: registry.registeredSources }),
      evidenceSnapshotHash: sha256(evidence.map(({ id, sha256: hash, assuranceState, polarity }) => ({ id, hash, assuranceState, polarity }))),
      stages: trace,
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString()
    },
    reassessmentTriggers: ["PURPOSE_CHANGE", "MODEL_CHANGE", "PROVIDER_CHANGE", "DATA_CHANGE", "AUTONOMY_CHANGE", "CODE_CHANGE", "REGULATORY_CHANGE", "INCIDENT", "PERFORMANCE_DRIFT", "LIFECYCLE_CHANGE"]
  };
  return { ...draft, packageHash: sha256(draft) };
}

export async function assessSolution(input, options = {}) {
  const startedAt = new Date();
  const runId = newId("run");
  const trace = [];
  const dossier = await timed(trace, "validate-dossier", () => validateDossier(input.dossier));
  const sources = await timed(trace, "validate-sources", () => validateSources(input.sources ?? []));
  const knowledge = options.knowledge ?? await timed(trace, "load-knowledge", () => loadKnowledgeSnapshot(options.knowledgeOptions));
  const registry = await timed(trace, "source-registry", () => buildSourceRegistry(sources, startedAt));
  const sourceIngestion = input.sourceIngestion?.manifestHash ? input.sourceIngestion : buildSourceIngestionManifest({ submitted: input.sourceIngestion, parsedSources: sources });
  const solutionProfile = await timed(trace, "solution-profile", () => discoverSolutionProfile(sources, dossier));
  const evidence = [...registry.evidence, ...dossierEvidence(dossier, startedAt), ...dossierRiskEvidence(dossier, startedAt)];
  return validateReadinessPackage(await buildPackage({
    dossier, knowledge, registry, evidence, registryFindings: registry.findings,
    solution: solutionUnderstanding(dossier, registry, evidence, sourceIngestion), solutionProfile, sourceIngestion, trace, startedAt, runId,
    schemaVersion: "1.4.0", cognitiveCoverage: null, cognitive: null, lockedFindings: []
  }));
}

export async function assessVerifiedSolution(input, options = {}) {
  const startedAt = options.startedAt ?? new Date();
  const trace = options.trace ?? [];
  const dossier = validateDossier(input.dossier);
  const knowledge = options.knowledge ?? await loadKnowledgeSnapshot(options.knowledgeOptions);
  const registry = {
    registeredSources: input.registeredSources ?? [],
    registryHash: sha256(input.registeredSources ?? []),
    evidence: [], findings: input.registryFindings ?? []
  };
  const evidence = [...dossierEvidence(dossier, startedAt), ...dossierRiskEvidence(dossier, startedAt), ...(input.lockedEvidence ?? [])];
  const solutionProfile = input.solutionProfile ?? discoverSolutionProfile([], dossier, input.fieldConfirmations ?? {});
  const sourceIngestion = input.sourceIngestion?.manifestHash ? input.sourceIngestion : buildSourceIngestionManifest({ submitted: input.sourceIngestion, parsedSources: input.registeredSources ?? [] });
  const pkg = await buildPackage({
    dossier, knowledge, registry, evidence, registryFindings: registry.findings,
    solution: { ...input.solutionModel, sourceIngestion }, solutionProfile, sourceIngestion, trace, startedAt, runId: input.runId,
    schemaVersion: "2.6.0", cognitiveCoverage: input.cognitiveCoverage,
    cognitive: input.cognitive, lockedFindings: input.lockedFindings ?? input.cognitive?.lockedFindings ?? []
  });
  return options.provisional ? pkg : validateReadinessPackage(pkg);
}
