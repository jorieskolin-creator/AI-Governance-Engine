import { DOMAINS } from "../contracts.js";
import { assessVerifiedSolution } from "../engine.js";
import { sha256, stableId } from "../core/hash.js";
import {
  COGNITIVE_CONTRACT_VERSION, createGovernanceClaim, DOMAIN_CLAIMS_SCHEMA, FACT_CHECK_SCHEMA,
  IMAGE_EXTRACTION_SCHEMA, ROUTING_SCHEMA, SOLUTION_FACT_VERIFICATION_SCHEMA, SOLUTION_MODEL_SCHEMA,
  SYNTHESIS_SCHEMA, VERIFICATION_SCHEMA
} from "./contracts.js";
import { ModelBudget, StructuredModelClient } from "./provider-client.js";
import { modelPolicy } from "./model-policy.js";
import { redactText } from "./source-intake.js";
import {
  adjudicationPrompt, domainPrompt, factCheckPrompt, imageExtractionPrompt, packetHash, PROMPT_VERSIONS,
  rescanPrompt, routingPrompt, solutionFactVerificationPrompt, solutionPrompt, synthesisPrompt, verificationPrompt
} from "./prompts.js";
import {
  applySolutionFactVerification, buildAssessmentCoverageMatrix, consolidateClaims, createAdjudicatedClaim,
  createDerivedSourceUnit, evaluatePublicationGate, evidenceLinksForClaim, lockAdjudicatedClaim, assessmentWorkItems,
  normalizeSolutionCandidates, validateClaimMappings, validateFactCheckCompleteness
} from "./integrity.js";
import { completeCognitiveStep, createCognitiveStepLedger, startCognitiveStep } from "./orchestration.js";
import { rethrowFatal } from "./failure-policy.js";

const HIGH_INTEGRITY = new Set(["HIGH", "CRITICAL"]);
const unique = (values) => [...new Set(values.filter(Boolean))];
const ASSESSMENT_WORK_ITEM_BATCH_SIZE = 12;

function batches(values, size = ASSESSMENT_WORK_ITEM_BATCH_SIZE) {
  const output = [];
  for (let index = 0; index < values.length; index += size) output.push(values.slice(index, index + size));
  return output;
}

function knowledgeForWorkItems(knowledge, domain, workItems) {
  const parents = new Set(workItems.flatMap((item) => [item.objectId, item.parentId]).filter(Boolean));
  return {
    controls: knowledge.controls.filter((item) => item.domain === domain && parents.has(item.id)),
    requirements: knowledge.requirements.filter((item) => item.domain === domain && parents.has(item.id)),
    antiPatterns: knowledge.antipatterns.filter((item) => item.domain === domain && parents.has(item.id))
  };
}

function claimMapsWorkItem(claim, workItem) {
  return [
    ...claim.requirementIds, ...claim.controlIds, ...claim.antiPatternIds,
    ...claim.assessmentObjectIds, ...claim.findingDefinitionIds
  ].includes(workItem.objectId);
}

function stage(run, name, status, detail = {}) {
  if (run.cancelled) throw new Error("Cognitive run was cancelled or expired");
  run.stage = name;
  run.trace.push({ stage: name, status, at: new Date().toISOString(), ...detail });
}

async function beginOrchestrationStep(run, step, onCheckpoint) {
  startCognitiveStep(run.stepLedger, step);
  await onCheckpoint({ step, status: "RUNNING" });
}

async function finishOrchestrationStep(run, step, status, detail, onCheckpoint) {
  completeCognitiveStep(run.stepLedger, step, status, detail);
  await onCheckpoint({ step, status });
}

function approvedProviderSet(run, packets = []) {
  const selected = packets.length ? packets : run.packets;
  const approvals = new Map(run.approval.approvedPackets.map((item) => [item.packetId, new Set(item.providers)]));
  const sets = selected.map((packet) => approvals.get(packet.id) ?? new Set());
  if (!sets.length) return new Set(run.approval.approvedPackets.flatMap((item) => item.providers));
  return new Set([...sets[0]].filter((provider) => sets.every((set) => set.has(provider))));
}

function providersApprovedForAny(run, packets = []) {
  const packetIds = new Set((packets.length ? packets : run.packets).map((item) => item.id));
  return unique(run.approval.approvedPackets.filter((item) => packetIds.has(item.packetId)).flatMap((item) => item.providers));
}

function transmittedPackets(run, provider, candidatePackets = run.packets) {
  const approved = new Set(run.approval.approvedPackets.filter((item) => item.providers.includes(provider)).map((item) => item.packetId));
  return candidatePackets.filter((packet) => approved.has(packet.id));
}

function chooseForPackets(policy, role, run, packets, options = {}) {
  const requireAll = options.requireAll !== false;
  const allowed = requireAll ? [...approvedProviderSet(run, packets)] : providersApprovedForAny(run, packets);
  return policy.choose(role, { ...options, allowedProviders: allowed });
}

function recordTransmission(run, stageName, profile, packets, containsRawEvidence = true) {
  const transmittedUnits = packets.flatMap((item) => item.sourceUnits);
  run.transmissionManifest.push({
    id: stableId("transmission", { stageName, profile: profile.id, packets: packets.map((item) => item.id), sequence: run.transmissionManifest.length }),
    stage: stageName, provider: profile.provider, configuredModel: profile.model,
    packetIds: packets.map((item) => item.id), sourceUnitIds: transmittedUnits.map((unit) => unit.id),
    packetHashes: packets.map((item) => sha256(item.sourceUnits.map((unit) => ({ id: unit.id, sha256: unit.sha256 })))),
    approvedPacketHashes: packets.map((item) => item.approvedHash ?? item.hash),
    containsRawEvidence: containsRawEvidence && transmittedUnits.some((unit) => unit.derivation?.rawContentIncluded !== false),
    derivationContracts: unique(transmittedUnits.map((unit) => unit.derivation?.contractVersion)),
    transmittedAt: new Date().toISOString()
  });
}

function allUnits(packets) { return packets.flatMap((packet) => packet.sourceUnits); }

const ROUTE_PATTERNS = {
  A: /purpose|value|classification|intended use|success metric|customer need|owner/i,
  B: /data|privacy|retention|licen[cs]e|copyright|confidential|dpia/i,
  C: /model|provider|agent|tool|dependency|package|permission|supply chain/i,
  D: /security|threat|test|evaluation|robust|safety|prompt injection|architecture|\.js$|\.ts$|\.py$/i,
  E: /fairness|bias|impact|oversight|appeal|transparen|explanation|accessib|user interface/i,
  F: /governance|risk|decision|monitor|incident|reassess|retire|accountab|audit/i
};

function localRouting(sourceUnits) {
  const routes = new Map(); const ambiguous = [];
  for (const unit of sourceUnits) {
    const haystack = `${unit.path}\n${unit.content.slice(0, 1200)}`;
    const domains = Object.entries(ROUTE_PATTERNS).filter(([, pattern]) => pattern.test(haystack)).map(([domain]) => domain);
    if (unit.path === "intended-use-dossier.json") domains.push(...Object.keys(DOMAINS));
    const values = unique(domains);
    if (values.length) routes.set(unit.id, values); else ambiguous.push(unit);
  }
  return { routes, ambiguous };
}

function rawPacketsForDomain(run, routes, domain) {
  return run.packets.map((packet) => {
    const sourceUnits = packet.sourceUnits.filter((unit) => routes.get(unit.id)?.includes(domain));
    return { ...packet, approvedHash: packet.hash, sourceUnits, hash: sha256(sourceUnits.map((unit) => ({ id: unit.id, sha256: unit.sha256 }))) };
  }).filter((packet) => packet.sourceUnits.length);
}

function packetsForDomain(run, provider, routes, domain) {
  return transmittedPackets(run, provider, rawPacketsForDomain(run, routes, domain));
}

async function mapLimitSettled(items, limit, worker) {
  const output = new Array(items.length); let next = 0;
  async function consume() {
    while (next < items.length) {
      const index = next; next += 1;
      try { output[index] = await worker(items[index], index); }
      catch (error) { rethrowFatal(error); output[index] = { domain: items[index], status: "FAILED", claims: [], error: error.message }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, consume));
  return output;
}

function localInvalidVerification(claim, sourceUnits) {
  const links = evidenceLinksForClaim(claim, sourceUnits);
  const unknown = claim.sourceUnitIds.filter((id) => !sourceUnits.some((unit) => unit.id === id));
  const invalidLinks = links.filter((item) => !item.locallyVerified);
  if (!unknown.length && links.length === claim.evidenceQuotes.length && !invalidLinks.length) return null;
  return {
    status: "UNSUPPORTED",
    rationale: unknown.length ? `Claim cites unknown source-unit IDs: ${unknown.join(", ")}` : "One or more claimed evidence quotes do not exist at the cited source location.",
    checkedSourceUnitIds: claim.sourceUnitIds.filter((id) => !unknown.includes(id)), conflictingSourceUnitIds: [],
    quoteStatus: "UNSUPPORTED", mappingStatus: "NOT_CHECKED", scopeStatus: "NOT_CHECKED"
  };
}

function verificationRecord(claim, profile, result, attempt, allowedSourceUnitIds = claim.sourceUnitIds) {
  const allowed = new Set(allowedSourceUnitIds);
  const invalidCheckedIds = (result.checkedSourceUnitIds ?? []).filter((id) => !allowed.has(id));
  const invalidConflictIds = (result.conflictingSourceUnitIds ?? []).filter((id) => !allowed.has(id));
  const status = invalidCheckedIds.length || invalidConflictIds.length ? "UNSUPPORTED" : result.status;
  const value = {
    claimId: claim.id, verifierProvider: profile?.provider ?? "LOCAL", verifierModel: profile?.model ?? "deterministic-integrity-check",
    status, rationale: invalidCheckedIds.length || invalidConflictIds.length ? "Verifier returned source IDs outside the approved claim evidence packet." : result.rationale,
    checkedSourceUnitIds: unique((result.checkedSourceUnitIds ?? []).filter((id) => allowed.has(id))),
    conflictingSourceUnitIds: unique((result.conflictingSourceUnitIds ?? []).filter((id) => allowed.has(id))),
    acceptedAssuranceState: result.acceptedAssuranceState ?? null,
    mappingStatus: result.mappingStatus ?? "NOT_CHECKED", scopeStatus: result.scopeStatus ?? "NOT_CHECKED", quoteStatus: result.quoteStatus ?? "NOT_CHECKED",
    attempt
  };
  return { id: stableId("verification", value), ...value };
}

function shouldRescan(claim, verification, contradictionGraph, sourceUnits) {
  if (verification.status === "SUPPORTED") return false;
  const gateRelevant = HIGH_INTEGRITY.has(claim.severity) || claim.findingDefinitionIds.length > 0 || ["RISK", "ANTIPATTERN", "CONTRADICTION", "ABSENCE_TEST"].includes(claim.claimType);
  const contradictory = contradictionGraph.some((item) => item.claimIds.includes(claim.id));
  const unitMap = new Map(sourceUnits.map((unit) => [unit.id, unit]));
  const proposedRank = ["UNKNOWN", "DECLARED", "IMPLEMENTED", "TESTED", "OPERATIONALLY_OBSERVED", "HUMAN_VALIDATED"].indexOf(claim.proposedAssuranceState);
  const maximumRank = Math.max(...claim.sourceUnitIds.map((id) => ["UNKNOWN", "DECLARED", "IMPLEMENTED", "TESTED", "OPERATIONALLY_OBSERVED", "HUMAN_VALIDATED"].indexOf(unitMap.get(id)?.assuranceCeiling ?? "DECLARED")));
  return gateRelevant || contradictory || proposedRank > maximumRank;
}

function evidenceFromLockedFindings(lockedFindings, sourceUnits, now) {
  const unitMap = new Map(sourceUnits.map((unit) => [unit.id, unit])); const evidence = [];
  for (const finding of lockedFindings) {
    const units = finding.sourceUnitIds.map((id) => unitMap.get(id)).filter(Boolean);
    if (!units.length) continue;
    const risk = ["RISK", "ANTIPATTERN", "CONTRADICTION"].includes(finding.findingType);
    const partialRisk = finding.strength === "PARTIAL" && risk;
    const absence = finding.findingType === "ABSENCE_TEST";
    if (!risk && !absence && finding.findingType !== "CONTROL_SUPPORT") continue;
    const first = units[0];
    evidence.push({
      id: stableId("evd", { findingId: finding.id, units: units.map((unit) => unit.id) }),
      sourceId: first.sourceId, path: first.path, kind: first.evidenceKind, sha256: sha256(units.map((unit) => unit.sha256)),
      excerpt: finding.evidenceQuotes.map((item) => `[${item.sourceUnitId}] ${item.quote}`).join(" ").slice(0, 700),
      signal: absence ? "verified-absence-test" : risk ? (finding.antiPatternIds[0] ?? "verified-risk") : "verified-control-evidence",
      domainIds: finding.domains, controlIds: finding.controlIds, antiPatternIds: finding.antiPatternIds,
      assuranceState: absence ? "TESTED" : risk ? "DECLARED" : finding.proposedAssuranceState,
      polarity: absence ? "ABSENCE_TEST" : partialRisk ? "RISK_PARTIAL" : risk ? "RISK" : "SUPPORT",
      stale: false, capturedAt: now.toISOString(), eligibleForAssurance: finding.strength === "SUPPORTED",
      metadata: { lockedFindingId: finding.id, verificationIds: finding.verificationIds, findingDefinitionIds: finding.findingDefinitionIds, absenceTest: finding.absenceTest }
    });
  }
  return evidence;
}

function localScannerArtifacts(run, now) {
  const secretTypes = new Set(["PRIVATE_KEY", "CREDENTIAL", "AWS_ACCESS_KEY", "ASSIGNED_SECRET"]);
  const findings = run.dlpFindings.filter((item) => secretTypes.has(item.type));
  return {
    registryFindings: findings.map((item) => ({ code: "SECRET_CANDIDATE", severity: "CRITICAL", evidenceId: stableId("evd", { dlp: item.id }), message: "Potential secret candidate detected and redacted during preflight" })),
    evidence: findings.map((item) => ({
      id: stableId("evd", { dlp: item.id }), sourceId: item.sourceUnitId, path: "preflight-redaction", kind: "SCAN_RESULT", sha256: sha256(item),
      excerpt: "Potential secret material detected; value redacted.", signal: "hardcoded-secret", domainIds: ["D"], controlIds: ["CTRL-D-01"], antiPatternIds: ["AP-D-01"],
      assuranceState: "TESTED", polarity: "RISK", stale: false, capturedAt: now.toISOString(), metadata: { scanner: "local-preflight-dlp" }
    }))
  };
}

function deterministicNarrative(provisional, lockedFindings) {
  const items = []; const add = (value) => items.push({ id: stableId("narrative", value), supportStatus: "DETERMINISTIC", ...value });
  add({ section: "EXECUTIVE_DECISION", text: `${provisional.recommendation.outcome}. ${provisional.recommendation.rationale}`, findingIds: [], gateIds: provisional.hardGates.map((item) => item.id), controlIds: [], evidenceIds: [], actionIds: [] });
  for (const domain of Object.keys(DOMAINS)) add({
    section: "DOMAIN_NARRATIVE", domain, text: "No fact-checked model narrative is available; consult the locked findings and deterministic control results.",
    findingIds: lockedFindings.filter((item) => item.domains.includes(domain)).map((item) => item.id), gateIds: [], controlIds: [], evidenceIds: [], actionIds: []
  });
  for (const item of provisional.humanDecisionRequirements) add({ section: "HUMAN_QUESTION", authority: item.authority, text: item.reasons.join(" "), findingIds: [], gateIds: provisional.hardGates.filter((gate) => gate.requiredHumanAuthorities.includes(item.authority)).map((gate) => gate.id), controlIds: [], evidenceIds: [], actionIds: [] });
  return { items };
}

function sanitizeSynthesis(value, provisional, lockedFindings) {
  const allowed = {
    findings: new Set(lockedFindings.map((item) => item.id)), gates: new Set(provisional.hardGates.map((item) => item.id)),
    controls: new Set(provisional.domains.flatMap((domain) => domain.controls.map((item) => item.controlId))),
    evidence: new Set(provisional.evidence.map((item) => item.id)), actions: new Set(provisional.actions.map((item) => item.id))
  };
  const rejected = []; const integrityIncidents = []; const items = [];
  for (const candidate of value?.items ?? []) {
    const rawIds = { findingIds: candidate.findingIds ?? [], gateIds: candidate.gateIds ?? [], controlIds: candidate.controlIds ?? [], evidenceIds: candidate.evidenceIds ?? [], actionIds: candidate.actionIds ?? [] };
    const normalized = {
      section: candidate.section, text: String(candidate.text ?? "").trim(), domain: candidate.domain, authority: candidate.authority,
      findingIds: unique(rawIds.findingIds.filter((id) => allowed.findings.has(id))), gateIds: unique(rawIds.gateIds.filter((id) => allowed.gates.has(id))),
      controlIds: unique(rawIds.controlIds.filter((id) => allowed.controls.has(id))), evidenceIds: unique(rawIds.evidenceIds.filter((id) => allowed.evidence.has(id))), actionIds: unique(rawIds.actionIds.filter((id) => allowed.actions.has(id)))
    };
    const unknownReference = normalized.findingIds.length !== rawIds.findingIds.length || normalized.gateIds.length !== rawIds.gateIds.length || normalized.controlIds.length !== rawIds.controlIds.length || normalized.evidenceIds.length !== rawIds.evidenceIds.length || normalized.actionIds.length !== rawIds.actionIds.length;
    const hasBasis = normalized.findingIds.length || normalized.gateIds.length || normalized.controlIds.length || normalized.evidenceIds.length || normalized.actionIds.length;
    const sectionValid = candidate.section !== "DOMAIN_NARRATIVE" || Object.hasOwn(DOMAINS, candidate.domain);
    const authorityValid = candidate.section !== "HUMAN_QUESTION" || typeof candidate.authority === "string" && candidate.authority;
    const authorityOverreach = /\b(formally approved|legally compliant|certified|authorized for deployment)\b/i.test(normalized.text);
    if (!normalized.text || !hasBasis || !sectionValid || !authorityValid || unknownReference || authorityOverreach) {
      rejected.push(candidate.id ?? "unknown-item");
      if (unknownReference || authorityOverreach) integrityIncidents.push({ code: authorityOverreach ? "MODEL_AUTHORITY_OVERREACH" : "MODEL_UNKNOWN_REFERENCE", severity: authorityOverreach ? "CRITICAL" : "HIGH", itemId: candidate.id ?? null });
      continue;
    }
    items.push({ id: stableId("narrative", normalized), supportStatus: "PENDING_FACT_CHECK", ...normalized });
  }
  if (!items.some((item) => item.section === "EXECUTIVE_DECISION")) items.unshift(deterministicNarrative(provisional, lockedFindings).items[0]);
  return { items, integrityIncidents, ...(rejected.length ? { quarantine: { status: "QUARANTINED", rejectedItemIds: rejected, items: [] } } : {}) };
}

function applyFactCheck(synthesis, checked, allowCorrections) {
  const integrity = validateFactCheckCompleteness(synthesis, checked);
  if (!integrity.valid) return {
    synthesis: {
      items: synthesis.items.filter((item) => item.supportStatus === "DETERMINISTIC"),
      quarantine: { status: "QUARANTINED", rejectedItemIds: synthesis.quarantine?.rejectedItemIds ?? [], items: synthesis.items.filter((item) => item.supportStatus !== "DETERMINISTIC").map((item) => ({ itemId: item.id, text: item.text, reason: "Fact-check integrity failed." })) }
    },
    integrity, triggers: [], repairsPending: false
  };
  const results = new Map(checked.itemResults.map((item) => [item.itemId, item]));
  const items = []; const quarantined = [...(synthesis.quarantine?.items ?? [])]; const triggers = [];
  for (const item of synthesis.items) {
    if (item.supportStatus === "DETERMINISTIC") { items.push(item); continue; }
    const result = results.get(item.id);
    if (result.issueType && result.issueType !== "NONE") triggers.push({ itemId: item.id, issueType: result.issueType, affectedFindingIds: unique(result.affectedFindingIds ?? []), affectedActionIds: unique(result.affectedActionIds ?? []), rationale: result.rationale });
    if (result.status === "SUPPORTED") { items.push({ ...item, supportStatus: "FACT_CHECKED" }); continue; }
    quarantined.push({ itemId: item.id, text: item.text, reason: result.rationale });
    const repairable = allowCorrections && ["NARRATIVE_WORDING_ERROR", "REFERENCE_OR_GROUNDING_ERROR"].includes(result.issueType ?? "NARRATIVE_WORDING_ERROR") && result.correctedText?.trim();
    if (repairable) items.push({ ...item, text: result.correctedText.trim(), supportStatus: "REPAIR_PENDING" });
  }
  return {
    synthesis: { ...synthesis, items, ...(quarantined.length || synthesis.quarantine ? { quarantine: { status: "QUARANTINED", items: quarantined, rejectedItemIds: synthesis.quarantine?.rejectedItemIds ?? [] } } : {}) },
    integrity, triggers, repairsPending: items.some((item) => item.supportStatus === "REPAIR_PENDING")
  };
}

async function runFactCheck({ client, policy, run, synthesis, lockedFindings, provisional, excludeProviders = [] }) {
  const profile = chooseForPackets(policy, "FACT_CHECK", run, [], { excludeProviders, requireAll: false });
  recordTransmission(run, "FINAL_FACT_CHECK", profile, [], false);
  const checked = await client.generate({ profile, prompt: factCheckPrompt(synthesis, lockedFindings, provisional), schemaName: "narrative_fact_check", schema: FACT_CHECK_SCHEMA, packetHash: sha256({ synthesis, lockedFindings: lockedFindings.map((item) => item.id) }), promptVersion: PROMPT_VERSIONS.factCheck });
  return { profile, value: checked.value };
}

export async function executeCognitiveRun(run, options = {}) {
  const now = new Date(); const policy = options.policy ?? modelPolicy(options.env); const budget = options.budget ?? new ModelBudget(options.budgets);
  const client = options.client ?? new StructuredModelClient({ policy, budget, transport: options.transport, signal: options.signal }); const knowledge = options.knowledge;
  const failedStages = []; const verificationRecords = []; const findingLockRecords = []; const adjudicatedClaims = []; const unresolvedClaims = []; const reanalysisTrace = []; const integrityIncidents = [];
  const claimRecords = new Map(); let claims = []; let lockedFindings = []; let derivedSourceUnits = [];
  run.status = "RUNNING"; run.transmissionManifest = [];
  run.stepLedger ??= createCognitiveStepLedger();
  const onCheckpoint = options.onCheckpoint ?? (async () => {});

  const imageUnits = allUnits(run.packets).filter((unit) => unit.media?.data);
  if (imageUnits.length) {
    stage(run, "MULTIMODAL_EXTRACTION", "RUNNING");
    await beginOrchestrationStep(run, "MULTIMODAL_EXTRACTION", onCheckpoint);
    for (const unit of imageUnits) {
      const packet = run.packets.find((item) => item.sourceUnits.includes(unit));
      try {
        const profile = chooseForPackets(policy, "EXTRACTION", run, [packet]); recordTransmission(run, "MULTIMODAL_EXTRACTION", profile, [packet]);
        const generated = await client.generate({ profile, prompt: imageExtractionPrompt(unit), schemaName: "image_evidence_extraction", schema: IMAGE_EXTRACTION_SCHEMA, packetHash: packet.hash, promptVersion: PROMPT_VERSIONS.imageExtraction, media: [unit.media] });
        const derived = createDerivedSourceUnit(unit, generated.value, profile);
        const screened = redactText(derived.content); derived.content = screened.text; derived.sha256 = sha256(screened.text); derived.sensitivity = unique([...derived.sensitivity, ...screened.findings.map((item) => item.type)]);
        for (const finding of screened.findings) run.dlpFindings.push({ id: stableId("dlp", { unitId: derived.id, type: finding.type }), sourceUnitId: derived.id, ...finding, blocking: false });
        derivedSourceUnits.push(derived); packet.sourceUnits.push(derived);
      } catch (error) { rethrowFatal(error); failedStages.push(`MULTIMODAL_EXTRACTION:${unit.id}`); run.trace.push({ stage: "MULTIMODAL_EXTRACTION", status: "UNIT_FAILED", at: new Date().toISOString(), sourceUnitId: unit.id, error: error.message }); }
    }
    const multimodalStatus = failedStages.some((item) => item.startsWith("MULTIMODAL")) ? "PARTIAL" : "COMPLETED";
    const multimodalDetail = { derivedSourceUnitCount: derivedSourceUnits.length };
    stage(run, "MULTIMODAL_EXTRACTION", multimodalStatus, multimodalDetail);
    await finishOrchestrationStep(run, "MULTIMODAL_EXTRACTION", multimodalStatus, multimodalDetail, onCheckpoint);
  } else await finishOrchestrationStep(run, "MULTIMODAL_EXTRACTION", "SKIPPED", { reason: "NO_MEDIA_UNITS" }, onCheckpoint);

  const sourceUnits = allUnits(run.packets);
  stage(run, "SOLUTION_UNDERSTANDING", "RUNNING");
  await beginOrchestrationStep(run, "SOLUTION_UNDERSTANDING", onCheckpoint);
  let solutionModel;
  let solutionStepStatus;
  try {
    const solutionProfile = chooseForPackets(policy, "SOLUTION_UNDERSTANDING", run, run.packets, { requireAll: false });
    const solutionPackets = transmittedPackets(run, solutionProfile.provider); recordTransmission(run, "SOLUTION_UNDERSTANDING", solutionProfile, solutionPackets);
    const generated = await client.generate({ profile: solutionProfile, prompt: solutionPrompt(run.dossier, solutionPackets), schemaName: "solution_model", schema: SOLUTION_MODEL_SCHEMA, packetHash: packetHash(solutionPackets), promptVersion: PROMPT_VERSIONS.solution });
    const candidate = normalizeSolutionCandidates(run.dossier, generated.value, sourceUnits);
    const observed = candidate.candidateFacts.filter((item) => item.status === "CANDIDATE");
    if (observed.length) {
      const citedIds = new Set(observed.flatMap((item) => item.sourceUnitIds)); const factPackets = run.packets.filter((packet) => packet.sourceUnits.some((unit) => citedIds.has(unit.id)));
      try {
        const verifier = chooseForPackets(policy, "VERIFICATION", run, factPackets, { excludeProviders: [solutionProfile.provider] });
        const approvedPackets = transmittedPackets(run, verifier.provider, factPackets); recordTransmission(run, "SOLUTION_FACT_VERIFICATION", verifier, approvedPackets);
        const factUnits = [...new Map(observed.flatMap((fact) => fact.sourceUnitIds.map((id) => sourceUnits.find((unit) => unit.id === id))).filter(Boolean).map((unit) => [unit.id, unit])).values()];
        const checked = await client.generate({ profile: verifier, prompt: solutionFactVerificationPrompt(candidate, factUnits), schemaName: "solution_fact_verification", schema: SOLUTION_FACT_VERIFICATION_SCHEMA, packetHash: packetHash(approvedPackets), promptVersion: PROMPT_VERSIONS.solutionVerification });
        solutionModel = applySolutionFactVerification(candidate, checked.value, verifier);
        if (solutionModel.integrityIssues.length) failedStages.push("SOLUTION_FACT_VERIFICATION_INCOMPLETE");
      } catch (error) {
        rethrowFatal(error);
        failedStages.push("SOLUTION_FACT_VERIFICATION"); solutionModel = applySolutionFactVerification(candidate, { factResults: [] }, null);
      }
    } else solutionModel = applySolutionFactVerification(candidate, { factResults: [] }, null);
    stage(run, "SOLUTION_UNDERSTANDING", "COMPLETED", { outputHash: solutionModel.hash, verifiedFactCount: solutionModel.verifiedFacts.length, unresolvedFactCount: solutionModel.unresolvedFacts.length });
    solutionStepStatus = "COMPLETED";
  } catch (error) {
    rethrowFatal(error);
    failedStages.push("SOLUTION_UNDERSTANDING");
    solutionModel = { id: stableId("solution-model", run.dossier), status: "DETERMINISTIC_DOSSIER_ONLY", declared: run.dossier, candidateFacts: [], verifiedFacts: [], unresolvedFacts: [], facts: [], contradictions: [], unknowns: ["Cognitive solution understanding failed."], limitations: [error.message], hash: sha256(run.dossier) };
    stage(run, "SOLUTION_UNDERSTANDING", "FAILED", { error: error.message });
    solutionStepStatus = "FAILED";
  }
  await finishOrchestrationStep(run, "SOLUTION_UNDERSTANDING", solutionStepStatus, { outputHash: solutionModel.hash }, onCheckpoint);

  stage(run, "PACKET_ROUTING", "RUNNING"); const routing = localRouting(sourceUnits);
  await beginOrchestrationStep(run, "PACKET_ROUTING", onCheckpoint);
  if (routing.ambiguous.length) {
    try {
      const ambiguousPackets = run.packets.map((packet) => ({ ...packet, sourceUnits: packet.sourceUnits.filter((unit) => routing.ambiguous.includes(unit)) })).filter((packet) => packet.sourceUnits.length);
      const profile = chooseForPackets(policy, "ROUTING", run, ambiguousPackets, { requireAll: false }); const approvedPackets = transmittedPackets(run, profile.provider, ambiguousPackets);
      recordTransmission(run, "PACKET_ROUTING", profile, approvedPackets);
      const generated = await client.generate({ profile, prompt: routingPrompt(approvedPackets.flatMap((item) => item.sourceUnits)), schemaName: "semantic_packet_routing", schema: ROUTING_SCHEMA, packetHash: packetHash(approvedPackets), promptVersion: PROMPT_VERSIONS.routing });
      const ambiguousIds = new Set(routing.ambiguous.map((unit) => unit.id));
      for (const route of generated.value.routes) if (ambiguousIds.has(route.sourceUnitId) && route.domains.length) routing.routes.set(route.sourceUnitId, unique(route.domains));
    } catch (error) { rethrowFatal(error); run.trace.push({ stage: "PACKET_ROUTING", status: "SEMANTIC_FALLBACK", at: new Date().toISOString(), error: error.message }); }
    for (const unit of routing.ambiguous) if (!routing.routes.has(unit.id)) routing.routes.set(unit.id, Object.keys(DOMAINS));
  }
  stage(run, "PACKET_ROUTING", "COMPLETED", { ambiguousCount: routing.ambiguous.length });
  await finishOrchestrationStep(run, "PACKET_ROUTING", "COMPLETED", { ambiguousCount: routing.ambiguous.length }, onCheckpoint);

  stage(run, "DOMAIN_ASSESSMENT", "RUNNING");
  await beginOrchestrationStep(run, "DOMAIN_ASSESSMENT", onCheckpoint);
  const domainResults = await mapLimitSettled(Object.keys(DOMAINS), options.domainConcurrency ?? 3, async (domain) => {
    stage(run, `DOMAIN_${domain}`, "RUNNING");
    const workItems = assessmentWorkItems(knowledge, run.dossier, domain);
    const rawPackets = rawPacketsForDomain(run, routing.routes, domain);
    if (!rawPackets.length) {
      const assessmentResults = workItems.map((item) => ({ objectId: item.objectId, status: "NO_EVIDENCE_FOUND", scope: "NO_RELEVANT_EVIDENCE_PACKET" }));
      stage(run, `DOMAIN_${domain}`, "COMPLETED", { claimCount: 0, coverage: "NO_RELEVANT_PACKET", assessedObjectCount: assessmentResults.length });
      return { domain, status: "COMPLETED", claims: [], assessmentResults };
    }
    const profile = chooseForPackets(policy, "DOMAIN_ASSESSMENT", run, rawPackets, { requireAll: false });
    const packets = packetsForDomain(run, profile.provider, routing.routes, domain);
    if (!packets.length) throw new Error(`No approved evidence packet is available to the selected ${domain} assessor`);
    const created = [];
    for (const batch of batches(workItems)) {
      const scopedKnowledge = knowledgeForWorkItems(knowledge, domain, batch);
      recordTransmission(run, `DOMAIN_${domain}`, profile, packets);
      const output = await client.generate({
        profile,
        prompt: domainPrompt({ domain, dossier: run.dossier, solutionModel, packets, ...scopedKnowledge, assessmentWorkItems: batch }),
        schemaName: `domain_${domain.toLowerCase()}_claims`, schema: DOMAIN_CLAIMS_SCHEMA,
        packetHash: packetHash(packets), promptVersion: PROMPT_VERSIONS.domain
      });
      for (const candidate of output.value.claims) {
        try {
          const claim = createGovernanceClaim(candidate, { provider: profile.provider, model: profile.model, profileId: profile.id, domain });
          const mapping = validateClaimMappings(claim, knowledge); if (!mapping.valid) throw new Error(mapping.issues.join("; "));
          created.push(claim);
        } catch (error) { run.trace.push({ stage: `DOMAIN_${domain}`, status: "CLAIM_REJECTED", at: new Date().toISOString(), error: error.message }); }
      }
    }
    const assessmentResults = workItems.map((item) => ({ objectId: item.objectId, status: created.some((claim) => claimMapsWorkItem(claim, item)) ? "ASSESSED" : "NO_EVIDENCE_FOUND", scope: "BOUNDED_EVIDENCE_BATCH" }));
    stage(run, `DOMAIN_${domain}`, "COMPLETED", { claimCount: created.length, assessedObjectCount: assessmentResults.length });
    return { domain, status: "COMPLETED", profile, claims: created, assessmentResults };
  });
  for (const result of domainResults.filter((item) => item.status === "FAILED")) { failedStages.push(`DOMAIN_ASSESSMENT:${result.domain}`); stage(run, `DOMAIN_${result.domain}`, "FAILED", { error: result.error }); }
  const consolidated = consolidateClaims(domainResults.flatMap((item) => item.claims)); claims = consolidated.claims;
  for (const claim of claims) claimRecords.set(claim.id, claim);
  const coverageMatrix = buildAssessmentCoverageMatrix(knowledge, run.dossier, claims, domainResults);
  if (!coverageMatrix.complete) failedStages.push("ASSESSMENT_COVERAGE_INCOMPLETE");
  const domainStepStatus = domainResults.some((item) => item.status === "FAILED") ? "PARTIAL" : "COMPLETED";
  const domainStepDetail = { claimCount: claims.length, coverageComplete: coverageMatrix.complete };
  stage(run, "DOMAIN_ASSESSMENT", domainStepStatus, domainStepDetail);
  await finishOrchestrationStep(run, "DOMAIN_ASSESSMENT", domainStepStatus, domainStepDetail, onCheckpoint);

  stage(run, "EVIDENCE_VERIFICATION", "RUNNING");
  await beginOrchestrationStep(run, "EVIDENCE_VERIFICATION", onCheckpoint);
  for (const originalClaim of claims) {
    let claim = originalClaim; const history = []; const citedUnits = () => claim.sourceUnitIds.map((id) => sourceUnits.find((unit) => unit.id === id)).filter(Boolean);
    const localInvalid = localInvalidVerification(claim, sourceUnits);
    if (localInvalid) history.push(verificationRecord(claim, null, localInvalid, "LOCAL_EVIDENCE_INTEGRITY"));
    else {
      const claimPackets = run.packets.filter((packet) => packet.sourceUnits.some((unit) => claim.sourceUnitIds.includes(unit.id)));
      let verifierProfile;
      try { verifierProfile = chooseForPackets(policy, "VERIFICATION", run, claimPackets, { excludeProviders: [claim.extractor.provider] }); }
      catch (error) { history.push(verificationRecord(claim, null, { status: "NOT_VERIFIABLE", rationale: error.message, checkedSourceUnitIds: [], conflictingSourceUnitIds: [] }, "PRIMARY")); failedStages.push(`CROSS_PROVIDER_VERIFICATION:${claim.id}`); }
      if (verifierProfile) {
        const approvedPackets = transmittedPackets(run, verifierProfile.provider, claimPackets); recordTransmission(run, "EVIDENCE_VERIFICATION", verifierProfile, approvedPackets);
        const checked = await client.generate({ profile: verifierProfile, prompt: verificationPrompt(claim, citedUnits()), schemaName: "claim_verification", schema: VERIFICATION_SCHEMA, packetHash: sha256(citedUnits().map((unit) => unit.sha256)), promptVersion: PROMPT_VERSIONS.verification, media: citedUnits().filter((unit) => unit.media?.data).map((unit) => unit.media) });
        let verification = verificationRecord(claim, verifierProfile, checked.value, "PRIMARY"); history.push(verification);
        if (shouldRescan(claim, verification, consolidated.contradictionGraph, sourceUnits)) {
          const extractorProfile = policy.profiles.find((item) => item.id === claim.extractor.profileId);
          if (extractorProfile) {
            recordTransmission(run, "TARGETED_RESCAN", extractorProfile, transmittedPackets(run, extractorProfile.provider, claimPackets));
            const rescanned = await client.generate({ profile: extractorProfile, prompt: rescanPrompt(claim, verification, citedUnits()), schemaName: "targeted_rescan", schema: DOMAIN_CLAIMS_SCHEMA, packetHash: sha256(citedUnits().map((unit) => unit.sha256)), promptVersion: PROMPT_VERSIONS.rescan, media: citedUnits().filter((unit) => unit.media?.data).map((unit) => unit.media) });
            if (rescanned.value.claims[0]) {
              try {
                const revised = createGovernanceClaim(rescanned.value.claims[0], { ...claim.extractor, rescanOf: originalClaim.id });
                if (!validateClaimMappings(revised, knowledge).valid) throw new Error("Rescanned claim mapping failed deterministic validation");
                claim = revised; claimRecords.set(revised.id, revised);
              } catch { claim = originalClaim; }
            }
            const rechecked = await client.generate({ profile: verifierProfile, prompt: verificationPrompt(claim, citedUnits()), schemaName: "claim_verification", schema: VERIFICATION_SCHEMA, packetHash: sha256(citedUnits().map((unit) => unit.sha256)), promptVersion: PROMPT_VERSIONS.verification });
            verification = verificationRecord(claim, verifierProfile, rechecked.value, "TARGETED_RESCAN"); history.push(verification);
            if (!["SUPPORTED", "UNSUPPORTED"].includes(verification.status)) {
              try {
                const adjudicator = chooseForPackets(policy, "ADJUDICATION", run, claimPackets, { excludeProviders: [claim.extractor.provider, verifierProfile.provider] });
                recordTransmission(run, "ADJUDICATION", adjudicator, transmittedPackets(run, adjudicator.provider, claimPackets));
                const adjudicated = await client.generate({ profile: adjudicator, prompt: adjudicationPrompt(claim, history, citedUnits()), schemaName: "claim_adjudication", schema: VERIFICATION_SCHEMA, packetHash: sha256(citedUnits().map((unit) => unit.sha256)), promptVersion: PROMPT_VERSIONS.adjudication });
                history.push(verificationRecord(claim, adjudicator, adjudicated.value, "ADJUDICATION"));
              } catch (error) { rethrowFatal(error); failedStages.push(`ADJUDICATION:${claim.id}`); }
            }
          }
        }
      }
    }
    verificationRecords.push(...history);
    const adjudicated = createAdjudicatedClaim(claim, history, sourceUnits, knowledge); adjudicatedClaims.push(adjudicated);
    const { lockRecord, finding } = lockAdjudicatedClaim(claim, adjudicated, sourceUnits); findingLockRecords.push(lockRecord);
    if (finding) lockedFindings.push(finding); else unresolvedClaims.push({ id: stableId("unresolved-claim", { claimId: claim.id, adjudicatedId: adjudicated.id }), claimId: claim.id, adjudicatedClaimId: adjudicated.id, statement: claim.statement, severity: claim.severity, domains: claim.domains, status: adjudicated.status, reasons: unique([...adjudicated.mappingIssues, ...lockRecord.issues]) });
  }
  const verificationDetail = { verificationCount: verificationRecords.length, adjudicatedClaimCount: adjudicatedClaims.length, lockedFindingCount: lockedFindings.length, unresolvedClaimCount: unresolvedClaims.length };
  stage(run, "EVIDENCE_VERIFICATION", "COMPLETED", verificationDetail);
  await finishOrchestrationStep(run, "EVIDENCE_VERIFICATION", "COMPLETED", verificationDetail, onCheckpoint);

  const scanner = localScannerArtifacts(run, now);
  const buildProvisional = async () => {
    const lockedEvidence = [...evidenceFromLockedFindings(lockedFindings, sourceUnits, now), ...scanner.evidence];
    const cognitiveCoverage = { required: true, complete: failedStages.length === 0 && coverageMatrix.complete, failedStages: unique(failedStages), domainCount: Object.keys(DOMAINS).length, assessedDomainCount: domainResults.filter((item) => item.status === "COMPLETED").length, claimCount: claimRecords.size, verifiedClaimCount: lockedFindings.length, coverageMatrix };
    return assessVerifiedSolution({ runId: run.id, dossier: run.dossier, registeredSources: run.registeredSources, sourceIngestion: run.sourceIngestion, registryFindings: scanner.registryFindings, solutionModel, solutionProfile: run.solutionProfile, lockedEvidence, lockedFindings, cognitiveCoverage, cognitive: { solutionModel, claims: [...claimRecords.values()], verificationRecords, adjudicatedClaims, unresolvedClaims, lockedFindings, findingLockRecords, coverageMatrix } }, { knowledge, provisional: true });
  };
  let provisional = await buildProvisional(); let synthesis = deterministicNarrative(provisional, lockedFindings); let factCheck = { supported: false, itemResults: [], limitation: "Model synthesis was not completed." }; let factCheckIntegrity = { valid: false }; let synthesisProvider = null;

  stage(run, "CONTROLLED_SYNTHESIS", "RUNNING");
  await beginOrchestrationStep(run, "CONTROLLED_SYNTHESIS", onCheckpoint);
  let synthesisStepStatus;
  try {
    const profile = chooseForPackets(policy, "SYNTHESIS", run, [], { requireAll: false }); synthesisProvider = profile.provider; recordTransmission(run, "CONTROLLED_SYNTHESIS", profile, [], false);
    const generated = await client.generate({ profile, prompt: synthesisPrompt({ solutionModel, lockedFindings, deterministic: provisional, actions: provisional.actions }), schemaName: "readiness_synthesis", schema: SYNTHESIS_SCHEMA, packetHash: provisional.packageHash, promptVersion: PROMPT_VERSIONS.synthesis });
    const sanitized = sanitizeSynthesis(generated.value, provisional, lockedFindings); synthesis = sanitized; integrityIncidents.push(...sanitized.integrityIncidents); stage(run, "CONTROLLED_SYNTHESIS", "COMPLETED"); synthesisStepStatus = "COMPLETED";
  } catch (error) { rethrowFatal(error); failedStages.push("CONTROLLED_SYNTHESIS"); stage(run, "CONTROLLED_SYNTHESIS", "FAILED", { error: error.message }); synthesisStepStatus = "FAILED"; }
  await finishOrchestrationStep(run, "CONTROLLED_SYNTHESIS", synthesisStepStatus, null, onCheckpoint);

  stage(run, "FINAL_FACT_CHECK", "RUNNING");
  await beginOrchestrationStep(run, "FINAL_FACT_CHECK", onCheckpoint);
  let factCheckStepStatus;
  try {
    const checked = await runFactCheck({ client, policy, run, synthesis, lockedFindings, provisional, excludeProviders: synthesisProvider ? [synthesisProvider] : [] }); factCheck = checked.value;
    let applied = applyFactCheck(synthesis, factCheck, true); synthesis = applied.synthesis; factCheckIntegrity = applied.integrity;
    const groundingTriggers = applied.triggers.filter((item) => item.issueType === "REFERENCE_OR_GROUNDING_ERROR" && item.affectedFindingIds.length);
    if (groundingTriggers.length) {
      const affected = new Set(groundingTriggers.flatMap((item) => item.affectedFindingIds));
      for (const findingId of affected) {
        const existing = lockedFindings.find((item) => item.id === findingId); const claim = existing ? claimRecords.get(existing.claimId) : null;
        let replacement = null; let outcome = "UNLOCKED_NOT_VERIFIABLE"; let rationale = "The challenged finding could not be reopened because its claim record was unavailable.";
        if (existing && claim) {
          const claimPackets = run.packets.filter((packet) => packet.sourceUnits.some((unit) => claim.sourceUnitIds.includes(unit.id)));
          const citedUnits = claim.sourceUnitIds.map((id) => sourceUnits.find((unit) => unit.id === id)).filter(Boolean);
          const previous = verificationRecords.filter((item) => item.claimId === claim.id);
          const challenge = { id: stableId("verification-challenge", { findingId, triggers: groundingTriggers }), claimId: claim.id, verifierProvider: checked.profile.provider, verifierModel: checked.profile.model, status: "CONFLICTING", rationale: groundingTriggers.filter((item) => item.affectedFindingIds.includes(findingId)).map((item) => item.rationale).join(" "), checkedSourceUnitIds: claim.sourceUnitIds, conflictingSourceUnitIds: [], attempt: "FACT_CHECK_GROUNDING_CHALLENGE" };
          try {
            const adjudicator = chooseForPackets(policy, "ADJUDICATION", run, claimPackets, { excludeProviders: unique([claim.extractor.provider, checked.profile.provider]) });
            recordTransmission(run, "FACT_CHECK_CLAIM_REANALYSIS", adjudicator, transmittedPackets(run, adjudicator.provider, claimPackets));
            const rechecked = await client.generate({ profile: adjudicator, prompt: adjudicationPrompt(claim, [...previous, challenge], citedUnits), schemaName: "claim_adjudication", schema: VERIFICATION_SCHEMA, packetHash: sha256(citedUnits.map((unit) => unit.sha256)), promptVersion: PROMPT_VERSIONS.adjudication });
            const record = verificationRecord(claim, adjudicator, rechecked.value, "FACT_CHECK_REANALYSIS"); verificationRecords.push(challenge, record);
            const adjudicated = createAdjudicatedClaim(claim, [...previous, challenge, record], sourceUnits, knowledge); adjudicatedClaims.push(adjudicated);
            const locked = lockAdjudicatedClaim(claim, adjudicated, sourceUnits); findingLockRecords.push(locked.lockRecord); replacement = locked.finding;
            outcome = replacement ? "RESOLVED" : "UNLOCKED_AFTER_REANALYSIS"; rationale = record.rationale;
          } catch (error) { rethrowFatal(error); verificationRecords.push(challenge); rationale = error.message; }
        }
        lockedFindings = lockedFindings.filter((item) => item.id !== findingId); if (replacement) lockedFindings.push(replacement);
        reanalysisTrace.push({ id: stableId("reanalysis", { findingId, outcome, rationale }), trigger: "FACT_CHECK_GROUNDING_CHALLENGE", findingId, replacementFindingId: replacement?.id ?? null, status: outcome, rationale, consequence: "The deterministic package was recomputed from the re-adjudicated finding set." });
      }
      provisional = await buildProvisional();
    }
    if (applied.repairsPending) {
      const repairedCheck = await runFactCheck({ client, policy, run, synthesis, lockedFindings, provisional, excludeProviders: [checked.profile.provider] });
      factCheck = repairedCheck.value; applied = applyFactCheck(synthesis, factCheck, false); synthesis = applied.synthesis; factCheckIntegrity = applied.integrity;
      for (const trigger of applied.triggers) reanalysisTrace.push({ id: stableId("reanalysis", trigger), trigger: trigger.issueType, itemId: trigger.itemId, status: trigger.issueType === "NARRATIVE_WORDING_ERROR" && factCheckIntegrity.valid ? "RESOLVED" : "QUARANTINED", rationale: trigger.rationale });
    }
    stage(run, "FINAL_FACT_CHECK", "COMPLETED", { supported: factCheck.supported, integrityValid: factCheckIntegrity.valid }); factCheckStepStatus = "COMPLETED";
  } catch (error) {
    rethrowFatal(error);
    failedStages.push("FINAL_FACT_CHECK"); synthesis = { ...deterministicNarrative(provisional, lockedFindings), quarantine: { status: "QUARANTINED", items: [{ text: "Generated prose was discarded because the fact-check stage failed.", reason: error.message }] } }; factCheckIntegrity = { valid: false, error: error.message }; stage(run, "FINAL_FACT_CHECK", "FAILED", { error: error.message }); factCheckStepStatus = "FAILED";
  }
  await finishOrchestrationStep(run, "FINAL_FACT_CHECK", factCheckStepStatus, { supported: factCheck.supported, integrityValid: factCheckIntegrity.valid }, onCheckpoint);

  const cognitiveCoverage = { required: true, complete: failedStages.length === 0 && coverageMatrix.complete, failedStages: unique(failedStages), domainCount: Object.keys(DOMAINS).length, assessedDomainCount: domainResults.filter((item) => item.status === "COMPLETED").length, claimCount: claimRecords.size, verifiedClaimCount: lockedFindings.length, coverageMatrix };
  const publicationGate = evaluatePublicationGate({ coverageMatrix, findingLockRecords, unresolvedClaims, factCheckIntegrity, narrative: synthesis, actionGroundingRecords: provisional.actionGroundingRecords, integrityIncidents, reanalysisTrace });
  const cognitive = {
    contractVersion: COGNITIVE_CONTRACT_VERSION, rolloutMode: "ENABLED", solutionModel, derivedSourceUnits: derivedSourceUnits.map(({ content, ...item }) => ({ ...item, contentHash: sha256(content) })),
    claimLedger: [...claimRecords.values()], contradictionGraph: consolidated.contradictionGraph, verificationRecords, adjudicatedClaims, unresolvedClaims, lockedFindings, findingLockRecords,
    coverage: cognitiveCoverage, coverageMatrix, narrative: publicationGate.status === "REPORT_WITHHELD" ? deterministicNarrative(provisional, lockedFindings) : synthesis, factCheck, factCheckIntegrity,
    reanalysisTrace, publicationGate, actionGroundingRecords: provisional.actionGroundingRecords, integrityIncidents,
    transmissionManifest: run.transmissionManifest, modelExecutionTrace: client.traces, budget: budget.view(),
    authorityBoundary: "The Engine recommends readiness and required actions. Authorized humans make formal decisions."
  };
  const lockedEvidence = [...evidenceFromLockedFindings(lockedFindings, sourceUnits, now), ...scanner.evidence];
  const result = await assessVerifiedSolution({ runId: run.id, dossier: run.dossier, registeredSources: run.registeredSources, sourceIngestion: run.sourceIngestion, registryFindings: scanner.registryFindings, solutionModel, solutionProfile: run.solutionProfile, lockedEvidence, lockedFindings, cognitiveCoverage, cognitive }, { knowledge });
  run.result = result; run.status = "COMPLETED"; run.stage = "COMPLETED"; run.completedAt = new Date().toISOString();
  return result;
}
