import { DOMAINS, STATE_WEIGHT } from "../contracts.js";
import { assessVerifiedSolution } from "../engine.js";
import { sha256, stableId } from "../core/hash.js";
import { createGovernanceClaim, DOMAIN_CLAIMS_SCHEMA, FACT_CHECK_SCHEMA, IMAGE_EXTRACTION_SCHEMA, ROUTING_SCHEMA, SOLUTION_MODEL_SCHEMA, SYNTHESIS_SCHEMA, VERIFICATION_SCHEMA } from "./contracts.js";
import { ModelBudget, StructuredModelClient } from "./provider-client.js";
import { modelPolicy } from "./model-policy.js";
import { adjudicationPrompt, domainPrompt, factCheckPrompt, imageExtractionPrompt, packetHash, PROMPT_VERSIONS, rescanPrompt, routingPrompt, solutionPrompt, synthesisPrompt, verificationPrompt } from "./prompts.js";

const STATE_RANK = Object.fromEntries(Object.keys(STATE_WEIGHT).map((state, index) => [state, index]));
const HIGH_INTEGRITY = new Set(["HIGH", "CRITICAL"]);

function stage(run, name, status, detail = {}) {
  if (run.cancelled) throw new Error("Cognitive run was cancelled or expired");
  run.stage = name;
  run.trace.push({ stage: name, status, at: new Date().toISOString(), ...detail });
}

function commonApprovedProviders(run) {
  const sets = run.approval.approvedPackets.map((item) => new Set(item.providers));
  return [...sets[0]].filter((provider) => sets.every((set) => set.has(provider)));
}

function transmittedPackets(run, provider) {
  const approved = new Set(run.approval.approvedPackets.filter((item) => item.providers.includes(provider)).map((item) => item.packetId));
  return run.packets.filter((packet) => approved.has(packet.id));
}

function recordTransmission(run, stageName, profile, packets, containsRawEvidence = true) {
  run.transmissionManifest.push({
    id: stableId("transmission", { stageName, profile: profile.id, packets: packets.map((item) => item.id), at: run.trace.length }),
    stage: stageName, provider: profile.provider, configuredModel: profile.model,
    packetIds: packets.map((item) => item.id), sourceUnitIds: packets.flatMap((item) => item.sourceUnits.map((unit) => unit.id)),
    packetHashes: packets.map((item) => item.hash), containsRawEvidence, transmittedAt: new Date().toISOString()
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
  const routes = new Map();
  const ambiguous = [];
  for (const unit of sourceUnits) {
    const haystack = `${unit.path}\n${unit.content.slice(0, 1200)}`;
    const domains = Object.entries(ROUTE_PATTERNS).filter(([, pattern]) => pattern.test(haystack)).map(([domain]) => domain);
    if (unit.path === "intended-use-dossier.json") domains.push(...Object.keys(DOMAINS));
    const unique = [...new Set(domains)];
    if (unique.length) routes.set(unit.id, unique);
    else ambiguous.push(unit);
  }
  return { routes, ambiguous };
}

function packetsForDomain(run, provider, routes, domain) {
  return transmittedPackets(run, provider).map((packet) => {
    const sourceUnits = packet.sourceUnits.filter((unit) => routes.get(unit.id)?.includes(domain));
    return { ...packet, sourceUnits, hash: sha256(sourceUnits.map((unit) => ({ id: unit.id, sha256: unit.sha256 }))) };
  }).filter((packet) => packet.sourceUnits.length);
}

function assertKnownMappings(candidate, knowledge) {
  const known = {
    controlIds: new Set(knowledge.controls.map((item) => item.id)),
    requirementIds: new Set(knowledge.requirements.map((item) => item.id)),
    antiPatternIds: new Set(knowledge.antipatterns.map((item) => item.id))
  };
  for (const [field, ids] of Object.entries(known)) if (candidate[field].some((id) => !ids.has(id))) throw new Error(`Claim contains an unknown ${field}`);
}

async function mapLimit(items, limit, worker) {
  const output = new Array(items.length);
  let next = 0;
  async function consume() {
    while (next < items.length) {
      const index = next; next += 1;
      output[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, consume));
  return output;
}

function normalizeSolutionModel(dossier, generated, sourceUnits) {
  const validIds = new Set(sourceUnits.map((unit) => unit.id));
  const invalidCitations = [];
  const facts = generated.facts.map((fact) => {
    const sourceUnitIds = fact.sourceUnitIds.filter((id) => validIds.has(id));
    if (sourceUnitIds.length !== fact.sourceUnitIds.length) invalidCitations.push(fact.statement);
    return { ...fact, sourceUnitIds };
  });
  const contradictions = generated.contradictions.map((item) => ({ ...item, sourceUnitIds: item.sourceUnitIds.filter((id) => validIds.has(id)) }));
  const model = {
    id: stableId("solution-model", { dossier, facts, contradictions }),
    status: "LOCKED_FOR_ASSESSMENT",
    declared: {
      intendedPurpose: dossier.intendedPurpose, expectedValue: dossier.expectedValue, users: dossier.users,
      jurisdictions: dossier.jurisdictions, roles: dossier.roles, accountableOwner: dossier.accountableOwner,
      currentStage: dossier.currentStage, targetStage: dossier.targetStage, data: dossier.data, exposure: dossier.exposure,
      agent: dossier.agent, classification: dossier.classification
    },
    facts, contradictions,
    unknowns: [...new Set([...generated.unknowns, ...invalidCitations.map((item) => `Invalid source citation removed from: ${item}`)])],
    limitations: [
      "The model cannot change the declared purpose or make a binding legal classification.",
      "Observed code does not prove deployment configuration or operational effectiveness."
    ]
  };
  return { ...model, hash: sha256(model) };
}

function verificationRecord(claim, profile, result, attempt) {
  const value = {
    claimId: claim.id, verifierProvider: profile?.provider ?? "LOCAL", verifierModel: profile?.model ?? "deterministic-citation-check",
    status: result.status, rationale: result.rationale,
    checkedSourceUnitIds: result.checkedSourceUnitIds, conflictingSourceUnitIds: result.conflictingSourceUnitIds,
    attempt
  };
  return { id: stableId("verification", value), ...value };
}

function localInvalidVerification(claim, sourceUnits) {
  const unitMap = new Map(sourceUnits.map((unit) => [unit.id, unit]));
  const valid = new Set(unitMap.keys());
  const invalid = claim.sourceUnitIds.filter((id) => !valid.has(id));
  const normalize = (value) => value.replace(/\s+/g, " ").trim();
  const invalidQuotes = claim.evidenceQuotes.filter((item) => {
    const unit = unitMap.get(item.sourceUnitId);
    return !unit || !normalize(unit.content).includes(normalize(item.quote));
  });
  if (!invalid.length && !invalidQuotes.length) return null;
  return verificationRecord(claim, null, {
    status: "UNSUPPORTED", rationale: invalid.length ? `Claim cites unknown source-unit IDs: ${invalid.join(", ")}` : "One or more claimed evidence quotes do not exist at the cited source location.",
    checkedSourceUnitIds: claim.sourceUnitIds.filter((id) => valid.has(id)), conflictingSourceUnitIds: []
  }, "LOCAL_CITATION_CHECK");
}

function lockFinding(claim, verification) {
  let findingType = claim.claimType;
  let strength = verification.status;
  if (["PARTIAL", "NOT_VERIFIABLE"].includes(verification.status) && claim.claimType === "CONTROL_SUPPORT") findingType = "UNKNOWN";
  if (verification.status === "CONFLICTING") findingType = "CONTRADICTION";
  const finding = {
    claimId: claim.id, findingType, statement: claim.statement, domains: claim.domains,
    evidenceQuotes: claim.evidenceQuotes,
    controlIds: claim.controlIds, antiPatternIds: claim.antiPatternIds, requirementIds: claim.requirementIds,
    severity: claim.severity, strength, sourceUnitIds: claim.sourceUnitIds,
    verificationIds: [verification.id], limitations: claim.limitations,
    proposedAssuranceState: claim.proposedAssuranceState,
    lifecycleConsequence: HIGH_INTEGRITY.has(claim.severity) && verification.status !== "SUPPORTED" ? "HUMAN_REVIEW_REQUIRED" : "DETERMINISTIC_REASSESSMENT"
  };
  return { id: stableId("finding", finding), ...finding };
}

function capState(proposed, units) {
  const ceilings = units.map((unit) => unit.assuranceCeiling ?? "DECLARED");
  const strongest = ceilings.sort((a, b) => (STATE_RANK[b] ?? 0) - (STATE_RANK[a] ?? 0))[0] ?? "DECLARED";
  return (STATE_RANK[proposed] ?? 0) <= (STATE_RANK[strongest] ?? 0) ? proposed : strongest;
}

function evidenceFromLockedFindings(lockedFindings, sourceUnits, now) {
  const unitMap = new Map(sourceUnits.map((unit) => [unit.id, unit]));
  const evidence = [];
  for (const finding of lockedFindings) {
    const units = finding.sourceUnitIds.map((id) => unitMap.get(id)).filter(Boolean);
    if (!units.length) continue;
    const claimSupported = finding.strength === "SUPPORTED";
    const risk = ["RISK", "ANTIPATTERN", "CONTRADICTION"].includes(finding.findingType);
    const partialRisk = finding.strength === "PARTIAL" && ["RISK", "ANTIPATTERN"].includes(finding.findingType);
    const verifiedConflict = finding.strength === "CONFLICTING" && finding.findingType === "CONTRADICTION";
    if ((!claimSupported && !partialRisk && !verifiedConflict) || (!risk && finding.findingType !== "CONTROL_SUPPORT")) continue;
    const first = units[0];
    evidence.push({
      id: stableId("evd", { findingId: finding.id, units: units.map((unit) => unit.id) }),
      sourceId: first.sourceId, path: first.path, kind: first.evidenceKind, sha256: sha256(units.map((unit) => unit.sha256)),
      excerpt: finding.evidenceQuotes.map((item) => `[${item.sourceUnitId}] ${item.quote}`).join(" ").slice(0, 700),
      signal: risk ? (finding.antiPatternIds[0] ?? "verified-risk") : "verified-control-evidence",
      domainIds: finding.domains, controlIds: finding.controlIds, antiPatternIds: finding.antiPatternIds,
      assuranceState: risk ? "DECLARED" : capState(finding.proposedAssuranceState ?? "UNKNOWN", units),
      polarity: partialRisk ? "RISK_PARTIAL" : risk ? "RISK" : "SUPPORT", stale: false, capturedAt: now.toISOString(),
      metadata: { lockedFindingId: finding.id, verificationIds: finding.verificationIds }
    });
  }
  return evidence;
}

function localScannerArtifacts(run, now) {
  const secretTypes = new Set(["PRIVATE_KEY", "CREDENTIAL", "AWS_ACCESS_KEY", "ASSIGNED_SECRET"]);
  const findings = run.dlpFindings.filter((item) => secretTypes.has(item.type));
  return {
    registryFindings: findings.map((item) => ({ code: "SECRET_MATERIAL", severity: "CRITICAL", evidenceId: stableId("evd", { dlp: item.id }), message: "Potential secret detected and redacted during preflight" })),
    evidence: findings.map((item) => ({
      id: stableId("evd", { dlp: item.id }), sourceId: item.sourceUnitId, path: "preflight-redaction", kind: "SCAN_RESULT", sha256: sha256(item),
      excerpt: "Potential secret material detected; value redacted.", signal: "hardcoded-secret", domainIds: ["D"], controlIds: ["CTRL-D-01"], antiPatternIds: ["AP-D-01"],
      assuranceState: "TESTED", polarity: "RISK", stale: false, capturedAt: now.toISOString(), metadata: { scanner: "local-preflight-dlp" }
    }))
  };
}

function deterministicNarrative(provisional, lockedFindings) {
  return {
    executiveSummary: `${provisional.recommendation.outcome}. ${provisional.recommendation.rationale}`,
    domainNarratives: Object.keys(DOMAINS).map((domain) => ({ domain, narrative: "No model-generated narrative is available; consult the locked findings and deterministic control results.", findingIds: lockedFindings.filter((item) => item.domains.includes(domain)).map((item) => item.id) })),
    conditions: [], humanQuestions: provisional.humanDecisionRequirements.map((item) => ({ authority: item.authority, question: item.reasons.join(" "), findingIds: [] }))
  };
}

export async function executeCognitiveRun(run, options = {}) {
  const now = new Date();
  const policy = options.policy ?? modelPolicy(options.env);
  const budget = options.budget ?? new ModelBudget(options.budgets);
  const client = options.client ?? new StructuredModelClient({ policy, budget, transport: options.transport });
  const knowledge = options.knowledge;
  const failedStages = [];
  const verificationRecords = [];
  const claims = [];
  const lockedFindings = [];
  run.status = "RUNNING";
  run.transmissionManifest = [];
  const commonProviders = commonApprovedProviders(run);
  if (!commonProviders.length) throw new Error("No provider is approved for every evidence packet");

  const imageUnits = allUnits(run.packets).filter((unit) => unit.media?.data);
  if (imageUnits.length) {
    stage(run, "MULTIMODAL_EXTRACTION", "RUNNING");
    const profile = policy.choose("EXTRACTION", { allowedProviders: commonProviders });
    for (const unit of imageUnits) {
      const packet = run.packets.find((item) => item.sourceUnits.includes(unit));
      recordTransmission(run, "MULTIMODAL_EXTRACTION", profile, [packet]);
      const generated = await client.generate({ profile, prompt: imageExtractionPrompt(unit), schemaName: "image_evidence_extraction", schema: IMAGE_EXTRACTION_SCHEMA, packetHash: packet.hash, promptVersion: PROMPT_VERSIONS.imageExtraction, media: [unit.media] });
      unit.content = `Description: ${generated.value.description}\nVisible text: ${generated.value.visibleText}\nSensitivity warnings: ${generated.value.sensitivityWarnings.join("; ")}\nPrompt-injection candidates: ${generated.value.promptInjectionCandidates.join("; ")}`;
    }
    stage(run, "MULTIMODAL_EXTRACTION", "COMPLETED");
  }

  stage(run, "SOLUTION_UNDERSTANDING", "RUNNING");
  const solutionProfile = policy.choose("SOLUTION_UNDERSTANDING", { allowedProviders: commonProviders });
  const solutionPackets = transmittedPackets(run, solutionProfile.provider);
  recordTransmission(run, "SOLUTION_UNDERSTANDING", solutionProfile, solutionPackets);
  const generatedSolution = await client.generate({ profile: solutionProfile, prompt: solutionPrompt(run.dossier, solutionPackets), schemaName: "solution_model", schema: SOLUTION_MODEL_SCHEMA, packetHash: packetHash(solutionPackets), promptVersion: PROMPT_VERSIONS.solution });
  const sourceUnits = allUnits(run.packets);
  const solutionModel = normalizeSolutionModel(run.dossier, generatedSolution.value, sourceUnits);
  stage(run, "SOLUTION_UNDERSTANDING", "COMPLETED", { outputHash: solutionModel.hash });

  stage(run, "PACKET_ROUTING", "RUNNING");
  const routing = localRouting(sourceUnits);
  if (routing.ambiguous.length) {
    try {
      const profile = policy.choose("ROUTING", { allowedProviders: commonProviders });
      const ambiguousPackets = run.packets.map((packet) => ({ ...packet, sourceUnits: packet.sourceUnits.filter((unit) => routing.ambiguous.includes(unit)) })).filter((packet) => packet.sourceUnits.length);
      recordTransmission(run, "PACKET_ROUTING", profile, ambiguousPackets);
      const generated = await client.generate({ profile, prompt: routingPrompt(routing.ambiguous), schemaName: "semantic_packet_routing", schema: ROUTING_SCHEMA, packetHash: sha256(routing.ambiguous.map((unit) => unit.sha256)), promptVersion: PROMPT_VERSIONS.routing });
      const ambiguousIds = new Set(routing.ambiguous.map((unit) => unit.id));
      for (const route of generated.value.routes) if (ambiguousIds.has(route.sourceUnitId) && route.domains.length) routing.routes.set(route.sourceUnitId, [...new Set(route.domains)]);
    } catch (error) {
      run.trace.push({ stage: "PACKET_ROUTING", status: "SEMANTIC_FALLBACK", at: new Date().toISOString(), error: error.message });
    }
    for (const unit of routing.ambiguous) if (!routing.routes.has(unit.id)) routing.routes.set(unit.id, Object.keys(DOMAINS));
  }
  stage(run, "PACKET_ROUTING", "COMPLETED", { ambiguousCount: routing.ambiguous.length });

  stage(run, "DOMAIN_ASSESSMENT", "RUNNING");
  const domainResults = await mapLimit(Object.keys(DOMAINS), options.domainConcurrency ?? 3, async (domain) => {
    const profile = policy.choose("DOMAIN_ASSESSMENT", { allowedProviders: commonProviders });
    const packets = packetsForDomain(run, profile.provider, routing.routes, domain);
    const controls = knowledge.controls.filter((item) => item.domain === domain);
    const requirements = knowledge.requirements.filter((item) => item.domain === domain);
    const antiPatterns = knowledge.antipatterns.filter((item) => item.domain === domain);
    recordTransmission(run, `DOMAIN_${domain}`, profile, packets);
    const output = await client.generate({ profile, prompt: domainPrompt({ domain, dossier: run.dossier, solutionModel, packets, controls, requirements, antiPatterns }), schemaName: `domain_${domain.toLowerCase()}_claims`, schema: DOMAIN_CLAIMS_SCHEMA, packetHash: packetHash(packets), promptVersion: PROMPT_VERSIONS.domain });
    const created = [];
    for (const candidate of output.value.claims) {
      try {
        assertKnownMappings(candidate, knowledge);
        created.push(createGovernanceClaim(candidate, { provider: profile.provider, model: profile.model, profileId: profile.id, domain }));
      }
      catch (error) { run.trace.push({ stage: `DOMAIN_${domain}`, status: "CLAIM_REJECTED", at: new Date().toISOString(), error: error.message }); }
    }
    return { domain, profile, claims: created };
  });
  claims.push(...domainResults.flatMap((item) => item.claims));
  if (claims.length === 0) failedStages.push("DOMAIN_ASSESSMENT:NO_CLAIMS");
  stage(run, "DOMAIN_ASSESSMENT", "COMPLETED", { claimCount: claims.length });

  stage(run, "EVIDENCE_VERIFICATION", "RUNNING");
  for (const originalClaim of claims) {
    let claim = originalClaim;
    const citedUnits = claim.sourceUnitIds.map((id) => sourceUnits.find((unit) => unit.id === id)).filter(Boolean);
    const citedMedia = citedUnits.filter((unit) => unit.media?.data).map((unit) => unit.media);
    const invalid = localInvalidVerification(claim, sourceUnits);
    let verification;
    if (invalid) verification = invalid;
    else {
      let verifierProfile;
      try { verifierProfile = policy.choose("VERIFICATION", { allowedProviders: commonProviders, excludeProviders: [claim.extractor.provider] }); }
      catch (error) {
        verification = verificationRecord(claim, null, { status: "NOT_VERIFIABLE", rationale: error.message, checkedSourceUnitIds: claim.sourceUnitIds, conflictingSourceUnitIds: [] }, "PRIMARY");
        failedStages.push(`CROSS_PROVIDER_VERIFICATION:${claim.id}`);
      }
      if (verifierProfile) {
        const claimPackets = run.packets.filter((packet) => packet.sourceUnits.some((unit) => claim.sourceUnitIds.includes(unit.id)));
        recordTransmission(run, "EVIDENCE_VERIFICATION", verifierProfile, claimPackets);
        const checked = await client.generate({ profile: verifierProfile, prompt: verificationPrompt(claim, citedUnits), schemaName: "claim_verification", schema: VERIFICATION_SCHEMA, packetHash: sha256(citedUnits.map((unit) => unit.sha256)), promptVersion: PROMPT_VERSIONS.verification, media: citedMedia });
        verification = verificationRecord(claim, verifierProfile, checked.value, "PRIMARY");
        if (HIGH_INTEGRITY.has(claim.severity) && verification.status !== "SUPPORTED") {
          const extractorProfile = policy.profiles.find((item) => item.id === claim.extractor.profileId);
          const claimPackets = run.packets.filter((packet) => packet.sourceUnits.some((unit) => claim.sourceUnitIds.includes(unit.id)));
          recordTransmission(run, "TARGETED_RESCAN", extractorProfile, claimPackets);
          const rescanned = await client.generate({ profile: extractorProfile, prompt: rescanPrompt(claim, verification, citedUnits), schemaName: "targeted_rescan", schema: DOMAIN_CLAIMS_SCHEMA, packetHash: sha256(citedUnits.map((unit) => unit.sha256)), promptVersion: PROMPT_VERSIONS.rescan, media: citedMedia });
          if (rescanned.value.claims[0]) {
            try {
              assertKnownMappings(rescanned.value.claims[0], knowledge);
              claim = createGovernanceClaim(rescanned.value.claims[0], { ...claim.extractor, rescanOf: originalClaim.id });
            }
            catch { claim = originalClaim; }
          }
          recordTransmission(run, "TARGETED_RESCAN_VERIFICATION", verifierProfile, claimPackets);
          const rechecked = await client.generate({ profile: verifierProfile, prompt: verificationPrompt(claim, citedUnits), schemaName: "claim_verification", schema: VERIFICATION_SCHEMA, packetHash: sha256(citedUnits.map((unit) => unit.sha256)), promptVersion: PROMPT_VERSIONS.verification, media: citedMedia });
          verificationRecords.push(verification);
          verification = verificationRecord(claim, verifierProfile, rechecked.value, "TARGETED_RESCAN");
          if (!["SUPPORTED", "UNSUPPORTED"].includes(verification.status)) {
            try {
              const adjudicator = policy.choose("ADJUDICATION", { allowedProviders: commonProviders, excludeProviders: [verifierProfile.provider] });
              recordTransmission(run, "ADJUDICATION", adjudicator, claimPackets);
              const adjudicated = await client.generate({ profile: adjudicator, prompt: adjudicationPrompt(claim, [verification], citedUnits), schemaName: "claim_adjudication", schema: VERIFICATION_SCHEMA, packetHash: sha256(citedUnits.map((unit) => unit.sha256)), promptVersion: PROMPT_VERSIONS.adjudication, media: citedMedia });
              verificationRecords.push(verification);
              verification = verificationRecord(claim, adjudicator, adjudicated.value, "ADJUDICATION");
            } catch (error) {
              failedStages.push(`ADJUDICATION:${claim.id}`);
            }
          }
        }
      }
    }
    verificationRecords.push(verification);
    const finding = lockFinding(claim, verification);
    lockedFindings.push(finding);
  }
  stage(run, "EVIDENCE_VERIFICATION", "COMPLETED", { verificationCount: verificationRecords.length, lockedFindingCount: lockedFindings.length });

  const scanner = localScannerArtifacts(run, now);
  const lockedEvidence = [...evidenceFromLockedFindings(lockedFindings, sourceUnits, now), ...scanner.evidence];
  const provisional = await assessVerifiedSolution({
    runId: run.id, dossier: run.dossier, registeredSources: run.registeredSources,
    registryFindings: scanner.registryFindings, solutionModel, lockedEvidence,
    cognitiveCoverage: { required: true, complete: true, failedStages: [] },
    cognitive: { solutionModel, claims, verificationRecords, lockedFindings }
  }, { knowledge });

  let synthesis = deterministicNarrative(provisional, lockedFindings);
  let factCheck = { supported: false, unsupportedStatements: ["Model synthesis was not completed."], correctedExecutiveSummary: synthesis.executiveSummary };
  let synthesisProvider = null;
  try {
    stage(run, "CONTROLLED_SYNTHESIS", "RUNNING");
    const profile = policy.choose("SYNTHESIS", { allowedProviders: commonProviders });
    synthesisProvider = profile.provider;
    recordTransmission(run, "CONTROLLED_SYNTHESIS", profile, [], false);
    const generated = await client.generate({ profile, prompt: synthesisPrompt({ solutionModel, lockedFindings, deterministic: provisional, actions: provisional.actions }), schemaName: "readiness_synthesis", schema: SYNTHESIS_SCHEMA, packetHash: provisional.packageHash, promptVersion: PROMPT_VERSIONS.synthesis });
    synthesis = generated.value;
    stage(run, "CONTROLLED_SYNTHESIS", "COMPLETED");
  } catch (error) {
    failedStages.push("CONTROLLED_SYNTHESIS");
    stage(run, "CONTROLLED_SYNTHESIS", "FAILED", { error: error.message });
  }

  try {
    stage(run, "FINAL_FACT_CHECK", "RUNNING");
    const critical = lockedFindings.some((item) => HIGH_INTEGRITY.has(item.severity));
    const profile = policy.choose("FACT_CHECK", {
      allowedProviders: commonProviders,
      excludeProviders: synthesisProvider ? [synthesisProvider] : [],
      preferredProfileIds: critical ? ["opus-factcheck-high", "sonnet-factcheck-high", "openai-sol-factcheck-high"] : ["sonnet-factcheck-high", "openai-sol-factcheck-high"]
    });
    recordTransmission(run, "FINAL_FACT_CHECK", profile, [], false);
    const checked = await client.generate({ profile, prompt: factCheckPrompt(synthesis, lockedFindings, provisional), schemaName: "narrative_fact_check", schema: FACT_CHECK_SCHEMA, packetHash: sha256({ synthesis, lockedFindings: lockedFindings.map((item) => item.id) }), promptVersion: PROMPT_VERSIONS.factCheck });
    factCheck = checked.value;
    if (!factCheck.supported) synthesis = { ...synthesis, executiveSummary: factCheck.correctedExecutiveSummary, domainNarratives: [], quarantine: { status: "QUARANTINED", unsupportedStatements: factCheck.unsupportedStatements } };
    stage(run, "FINAL_FACT_CHECK", "COMPLETED", { supported: factCheck.supported });
  } catch (error) {
    failedStages.push("FINAL_FACT_CHECK");
    synthesis = { ...deterministicNarrative(provisional, lockedFindings), quarantine: { status: "QUARANTINED", unsupportedStatements: ["Fact-check stage failed; generated prose was discarded."] } };
    stage(run, "FINAL_FACT_CHECK", "FAILED", { error: error.message });
  }

  const cognitiveCoverage = { required: true, complete: failedStages.length === 0, failedStages: [...new Set(failedStages)], domainCount: Object.keys(DOMAINS).length, assessedDomainCount: domainResults.length, claimCount: claims.length, verifiedClaimCount: lockedFindings.length };
  const cognitive = {
    solutionModel, claimLedger: claims, verificationRecords, lockedFindings,
    coverage: cognitiveCoverage, narrative: synthesis, factCheck,
    transmissionManifest: run.transmissionManifest,
    modelExecutionTrace: client.traces,
    budget: budget.view(),
    authorityBoundary: "The Engine recommends readiness and required actions. Authorized humans make formal decisions."
  };
  const result = await assessVerifiedSolution({
    runId: run.id, dossier: run.dossier, registeredSources: run.registeredSources,
    registryFindings: scanner.registryFindings, solutionModel, lockedEvidence,
    cognitiveCoverage, cognitive
  }, { knowledge });
  run.result = result;
  run.status = "COMPLETED";
  run.stage = "COMPLETED";
  run.completedAt = new Date().toISOString();
  stage(run, "COMPLETE", "COMPLETED", { packageHash: result.packageHash });
  return result;
}
