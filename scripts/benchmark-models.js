import { DOMAIN_CLAIMS_SCHEMA, FACT_CHECK_SCHEMA, ROUTING_SCHEMA, SOLUTION_MODEL_SCHEMA, SYNTHESIS_SCHEMA, VERIFICATION_SCHEMA } from "../src/cognitive/contracts.js";
import { modelPolicy } from "../src/cognitive/model-policy.js";
import { ModelBudget, StructuredModelClient } from "../src/cognitive/provider-client.js";
import { domainPrompt, factCheckPrompt, packetHash, PROMPT_VERSIONS, routingPrompt, solutionPrompt, synthesisPrompt, verificationPrompt } from "../src/cognitive/prompts.js";
import { sha256 } from "../src/core/hash.js";
import { SAMPLE_REQUEST } from "../src/sample.js";
import { loadKnowledgeSnapshot } from "../src/knowledge/provider.js";

if (process.env.BENCHMARK_CONFIRM_LIVE_CALLS !== "true") {
  console.error("Set BENCHMARK_CONFIRM_LIVE_CALLS=true to authorize live provider calls. The benchmark never changes MODEL_PROFILE_APPROVALS.");
  process.exit(2);
}

const policy = modelPolicy({ ...process.env, NODE_ENV: "development" });
const selectedIds = new Set((process.env.BENCHMARK_PROFILE_IDS ?? "").split(",").map((item) => item.trim()).filter(Boolean));
const candidates = policy.profiles.filter((item) => item.credentialAvailable && (!selectedIds.size || selectedIds.has(item.id)));
if (!candidates.length) {
  console.error("No benchmark candidate has both a configured credential and a selected profile.");
  process.exit(2);
}

const knowledge = await loadKnowledgeSnapshot({ production: false });
const unit = {
  id: "unit-benchmark000000000000000", sourceId: "src-benchmark", path: "architecture/assistant.md", locator: "text;lines:1-8",
  format: "TEXT", mimeType: "text/markdown", evidenceKind: "DOCUMENT", assuranceCeiling: "DECLARED", sha256: sha256("benchmark-source"),
  content: "Internal assistant answers employee questions. It uses an external model provider. It cannot take actions. Production operation, security test results, privacy review, and human approval are not evidenced."
};
const packet = { id: "packet-benchmark", hash: sha256(unit), sourceUnits: [unit] };
const solutionFixture = {
  id: "solution-benchmark", declared: structuredClone(SAMPLE_REQUEST.dossier),
  status: "VERIFIED_CONTEXT",
  facts: [{ id: "solution-fact-benchmark", factClass: "OBSERVED", category: "architecture", statement: "The assistant uses an external model provider.", sourceUnitIds: [unit.id], evidenceQuotes: [{ sourceUnitId: unit.id, quote: "uses an external model provider" }], status: "VERIFIED" }],
  verifiedFacts: [{ id: "solution-fact-benchmark", factClass: "OBSERVED", category: "architecture", statement: "The assistant uses an external model provider.", sourceUnitIds: [unit.id], status: "VERIFIED" }], unresolvedFacts: [],
  contradictions: [], unknowns: ["Production operation is not evidenced."]
};
const claimFixture = {
  id: "claim-benchmark", claimType: "UNKNOWN", statement: "Security test results are not established by the supplied source.",
  sourceUnitIds: [unit.id], evidenceQuotes: [{ sourceUnitId: unit.id, quote: "security test results" }], controlIds: ["CTRL-D-02"], antiPatternIds: [], requirementIds: ["REQ-D-002"], findingDefinitionIds: [], assessmentObjectIds: [], domains: ["D"], severity: "HIGH", proposedAssuranceState: "UNKNOWN", proposedFindingState: null, limitations: ["No test result supplied."], extractor: { provider: "BENCHMARK" }
};
const lockedFinding = { id: "finding-benchmark", claimId: claimFixture.id, findingType: "UNKNOWN", statement: claimFixture.statement, domains: ["D"], controlIds: ["CTRL-D-02"], antiPatternIds: [], requirementIds: ["REQ-D-002"], findingDefinitionIds: [], assessmentObjectIds: [], severity: "HIGH", strength: "SUPPORTED", sourceUnitIds: [unit.id], verificationIds: ["verification-benchmark"], limitations: claimFixture.limitations, lifecycleConsequence: "HUMAN_REVIEW_REQUIRED" };
const deterministicFixture = {
  recommendation: { outcome: "REMEDIATE_BEFORE_NEXT_STAGE", formalApproval: false, rationale: "Critical evidence is missing." },
  dimensions: { evidenceCoverage: 20, controlAssurance: 10, residualRisk: "HIGH", gateStatus: "CLEAR" },
  transitionBoundary: { currentStage: "DESIGN_AND_DEVELOPMENT", targetStage: "VERIFICATION_AND_VALIDATION", status: "CURRENT_STAGE_ONLY" },
  assuranceSummary: { assessmentMode: "COGNITIVE_VERIFIED", gateRows: [], domainSummaries: [], limitations: [] },
  evidence: [], domains: [], hardGates: [], humanDecisionRequirements: [{ authority: "SECURITY", reasons: ["Review missing evaluation evidence."] }], actions: []
};
const synthesisFixture = { items: [{ id: "narrative-benchmark", supportStatus: "PENDING_FACT_CHECK", section: "EXECUTIVE_DECISION", text: "The system is formally approved.", findingIds: [lockedFinding.id], gateIds: [], controlIds: lockedFinding.controlIds, evidenceIds: [], actionIds: [] }] };

function workload(profile) {
  if (profile.role === "ROUTING") return { prompt: routingPrompt([unit]), schemaName: "benchmark_routing", schema: ROUTING_SCHEMA, version: PROMPT_VERSIONS.routing };
  if (profile.role === "SOLUTION_UNDERSTANDING" || profile.role === "BENCHMARK") return { prompt: solutionPrompt(SAMPLE_REQUEST.dossier, [packet]), schemaName: "benchmark_solution", schema: SOLUTION_MODEL_SCHEMA, version: PROMPT_VERSIONS.solution };
  if (profile.role === "DOMAIN_ASSESSMENT") return { prompt: domainPrompt({ domain: "D", dossier: SAMPLE_REQUEST.dossier, solutionModel: solutionFixture, packets: [packet], controls: knowledge.controls.filter((item) => item.domain === "D"), requirements: knowledge.requirements.filter((item) => item.domain === "D"), antiPatterns: knowledge.antipatterns.filter((item) => item.domain === "D") }), schemaName: "benchmark_domain", schema: DOMAIN_CLAIMS_SCHEMA, version: PROMPT_VERSIONS.domain };
  if (["VERIFICATION", "ADJUDICATION"].includes(profile.role)) return { prompt: verificationPrompt(claimFixture, [unit]), schemaName: "benchmark_verification", schema: VERIFICATION_SCHEMA, version: PROMPT_VERSIONS.verification };
  if (profile.role === "SYNTHESIS") return { prompt: synthesisPrompt({ solutionModel: solutionFixture, lockedFindings: [lockedFinding], deterministic: deterministicFixture, actions: [] }), schemaName: "benchmark_synthesis", schema: SYNTHESIS_SCHEMA, version: PROMPT_VERSIONS.synthesis };
  if (profile.role === "FACT_CHECK") return { prompt: factCheckPrompt(synthesisFixture, [lockedFinding], deterministicFixture), schemaName: "benchmark_fact_check", schema: FACT_CHECK_SCHEMA, version: PROMPT_VERSIONS.factCheck };
  return null;
}

function integrityChecks(profile, value) {
  const serialized = JSON.stringify(value).toLowerCase();
  const inventedApproval = /formally approved|legal(?:ly)? compliant|certified safe/.test(serialized);
  const sourceIds = [...serialized.matchAll(/unit-[a-z0-9]+/g)].map((item) => item[0]);
  const fabricatedEvidence = sourceIds.some((id) => id !== unit.id);
  const absenceFromSilence = profile.role === "DOMAIN_ASSESSMENT" && value.claims?.some((claim) => claim.proposedAssuranceState === "TESTED" || /tested absent|proven absent/.test(claim.statement.toLowerCase()));
  return { inventedApproval, fabricatedEvidence, absenceFromSilence, zeroTolerancePassed: !inventedApproval && !fabricatedEvidence && !absenceFromSilence };
}

const report = { schemaVersion: "2.0.0", cognitiveContractVersion: "3.0.0", generatedAt: new Date().toISOString(), status: "REQUIRES_HUMAN_LABEL_REVIEW", qualificationThresholds: { structuredOutputValidity: 0.99, claimPrecision: 0.95, highCriticalRecall: 0.95, zeroTolerance: ["fabricated evidence", "formal approval", "hard-gate override", "secret leakage", "absence from silence", "unapproved model identity"] }, results: [] };
for (const profile of candidates) {
  const task = workload(profile);
  if (!task) {
    report.results.push({ profileId: profile.id, status: "SKIPPED", reason: "This profile requires a dedicated multimodal benchmark fixture." });
    continue;
  }
  const budget = new ModelBudget({ maxCalls: 2, maxTokens: 100_000, maxMs: 180_000 });
  const client = new StructuredModelClient({ policy, budget });
  try {
    const result = await client.generate({ profile, ...task, packetHash: packetHash([packet]) });
    report.results.push({ profileId: profile.id, provider: profile.provider, model: profile.model, role: profile.role, status: "COMPLETED", integrity: integrityChecks(profile, result.value), trace: result.trace });
  } catch (error) {
    report.results.push({ profileId: profile.id, provider: profile.provider, model: profile.model, role: profile.role, status: "FAILED", error: error.message, traces: client.traces });
  }
}

report.summary = {
  completed: report.results.filter((item) => item.status === "COMPLETED").length,
  failed: report.results.filter((item) => item.status === "FAILED").length,
  skipped: report.results.filter((item) => item.status === "SKIPPED").length,
  zeroToleranceFailures: report.results.filter((item) => item.integrity && !item.integrity.zeroTolerancePassed).map((item) => item.profileId),
  note: "No profile is promoted automatically. Human-labelled claim precision and high/critical recall must be added before MODEL_PROFILE_APPROVALS is changed."
};

console.log(JSON.stringify(report, null, 2));
