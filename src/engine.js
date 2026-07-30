import { validateDossier, validateSources } from "./contracts.js";
import { sha256, newId } from "./core/hash.js";
import { buildSourceRegistry, dossierEvidence, dossierRiskEvidence } from "./core/source-registry.js";
import { evaluateApplicability } from "./core/applicability.js";
import { assessAntiPatterns, assessControls, groupDomainResults } from "./core/assessment.js";
import { evaluateHardGates } from "./core/hard-gates.js";
import { selectPlaybookActions } from "./core/playbook-engine.js";
import { calculateReadiness, humanDecisionRequirements } from "./core/readiness.js";
import { loadKnowledgeSnapshot, knowledgeManifestView } from "./knowledge/provider.js";

const ENGINE_VERSION = "governance-engine-0.1.0";
const RULESET_VERSION = "readiness-rules-1.0.0";

function timed(trace, id, fn) {
  const startedAt = new Date();
  return Promise.resolve().then(fn).then((output) => {
    trace.push({ id, status: "COMPLETED", startedAt: startedAt.toISOString(), completedAt: new Date().toISOString(), outputHash: sha256(output) });
    return output;
  });
}

function solutionUnderstanding(dossier, registry, evidence) {
  const providers = evidence.filter((item) => item.signal === "model-inventory").map((item) => ({ source: item.path, excerpt: item.excerpt }));
  const signals = [...new Set(evidence.map((item) => item.signal))].sort();
  return {
    intendedPurpose: dossier.intendedPurpose,
    expectedValue: dossier.expectedValue,
    currentStage: dossier.currentStage,
    targetStage: dossier.targetStage,
    accountableOwner: dossier.accountableOwner,
    jurisdictions: dossier.jurisdictions,
    roles: dossier.roles,
    users: dossier.users,
    sourceCount: registry.registeredSources.length,
    sourceManifestHash: registry.registryHash,
    detectedProvidersAndModels: providers,
    detectedGovernanceSignals: signals,
    limitations: [
      "Static source evidence cannot prove production configuration or continuing operational effectiveness.",
      "A test file proves only that a test exists unless its execution result is supplied.",
      "Legal applicability, residual-risk acceptance, and formal approval remain human decisions."
    ]
  };
}

export async function assessSolution(input, options = {}) {
  const startedAt = new Date();
  const runId = newId("run");
  const trace = [];
  const dossier = await timed(trace, "validate-dossier", () => validateDossier(input.dossier));
  const sources = await timed(trace, "validate-sources", () => validateSources(input.sources ?? []));
  const knowledge = options.knowledge ?? await timed(trace, "load-knowledge", () => loadKnowledgeSnapshot(options.knowledgeOptions));
  const registry = await timed(trace, "source-registry", () => buildSourceRegistry(sources, startedAt));
  const evidence = [...registry.evidence, ...dossierEvidence(dossier, startedAt), ...dossierRiskEvidence(dossier, startedAt)];
  const applicability = await timed(trace, "applicability", () => evaluateApplicability(knowledge.requirements, dossier, startedAt));
  const controls = await timed(trace, "control-assessment", () => assessControls(knowledge.controls, applicability, evidence, dossier, knowledge.antipatterns));
  const antiPatterns = await timed(trace, "antipattern-assessment", () => assessAntiPatterns(knowledge.antipatterns, evidence, controls));
  const domains = groupDomainResults(controls, antiPatterns);
  const gates = await timed(trace, "hard-gates", () => evaluateHardGates({ dossier, registryFindings: registry.findings, controlAssessments: controls, applicability, evidence }));
  const actions = await timed(trace, "playbook", () => selectPlaybookActions(knowledge.tactics, domains, antiPatterns, dossier));
  const readiness = calculateReadiness(controls, antiPatterns, gates);
  const humanDecisions = humanDecisionRequirements(gates, applicability, dossier);
  const completedAt = new Date();
  const draft = {
    schemaVersion: "1.0.0",
    packageId: newId("readiness-package"),
    runId,
    engineVersion: ENGINE_VERSION,
    rulesetVersion: RULESET_VERSION,
    generatedAt: completedAt.toISOString(),
    knowledge: knowledgeManifestView(knowledge),
    solution: solutionUnderstanding(dossier, registry, evidence),
    recommendation: {
      outcome: readiness.outcome,
      rationale: readiness.outcome === "READY_FOR_NEXT_STAGE"
        ? "No applicable control gap, confirmed anti-pattern, unresolved authority question, or hard gate prevents the declared transition."
        : `${gates.length} gate(s), ${domains.flatMap((item) => item.gaps).length} control gap(s), and ${antiPatterns.filter((item) => item.state === "CONFIRMED_PRESENT").length} confirmed anti-pattern(s) determine this recommendation.`,
      formalApproval: false,
      boundary: "This is decision support. The engine cannot issue legal, privacy, security, governance, AI Forum, or AI Board approval."
    },
    dimensions: readiness.dimensions,
    applicability,
    domains,
    hardGates: gates,
    actions,
    humanDecisionRequirements: humanDecisions,
    evidence: evidence.map((item) => ({ ...item, metadata: undefined })),
    trace: {
      inputHash: sha256({ dossier, sources: registry.registeredSources }),
      evidenceSnapshotHash: sha256(evidence.map(({ id, sha256: hash, assuranceState }) => ({ id, hash, assuranceState }))),
      stages: trace,
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString()
    },
    reassessmentTriggers: ["PURPOSE_CHANGE", "MODEL_CHANGE", "PROVIDER_CHANGE", "DATA_CHANGE", "AUTONOMY_CHANGE", "CODE_CHANGE", "REGULATORY_CHANGE", "INCIDENT", "PERFORMANCE_DRIFT", "LIFECYCLE_CHANGE"]
  };
  return { ...draft, packageHash: sha256(draft) };
}
