import { DISCOVERY_RECHECK_SCHEMA, validateExecutionApproval } from "./contracts.js";
import { ModelBudget, StructuredModelClient } from "./provider-client.js";
import { modelPolicy } from "./model-policy.js";
import { discoveryRecheckPrompt, packetHash, PROMPT_VERSIONS } from "./prompts.js";

const MAX_RECHECK_CHARS = 60_000;

function commonApprovedProviders(approval) {
  const sets = approval.approvedPackets.map((item) => new Set(item.providers));
  return ["OPENAI", "ANTHROPIC", "GEMINI"].filter((provider) => sets.every((set) => set.has(provider)));
}

function relevantPackets(run, provider, approval) {
  const approved = new Set(approval.approvedPackets.filter((item) => item.providers.includes(provider)).map((item) => item.packetId));
  let used = 0;
  return run.packets.filter((packet) => approved.has(packet.id)).map((packet) => {
    const sourceUnits = packet.sourceUnits.filter((unit) => {
      if (used >= MAX_RECHECK_CHARS || unit.media) return false;
      const relevant = ["DOCUMENT", "CONFIGURATION", "DECLARATION"].includes(unit.evidenceKind) || /readme|product|architecture|governance|package\.json/i.test(unit.path);
      if (relevant) used += unit.content.length;
      return relevant && used <= MAX_RECHECK_CHARS;
    });
    return { ...packet, sourceUnits };
  }).filter((packet) => packet.sourceUnits.length);
}

export async function recheckDiscovery(run, input, options = {}) {
  if (!run?.solutionProfile) throw new Error("Deterministic discovery must complete before AI recheck");
  const approval = validateExecutionApproval(input, run);
  const providers = commonApprovedProviders(approval);
  if (!providers.length) throw new Error("One provider must be explicitly approved for every discovery packet");
  const policy = options.policy ?? modelPolicy(options.env);
  const profile = policy.choose("SOLUTION_UNDERSTANDING", { allowedProviders: providers });
  const packets = relevantPackets(run, profile.provider, approval);
  if (!packets.length) throw new Error("No approved documentation or configuration packet is available for discovery recheck");
  const targetFields = [
    ...Object.values(run.solutionProfile.fields).filter((item) => item.status !== "CONFIRMED" || item.factClass === "USER_DECLARED").map((item) => ({ field: item.field, currentValue: item.value, status: item.status, factClass: item.factClass })),
    ...Object.values(run.solutionProfile.assessmentIntakeFacts ?? {}).filter((item) => item.answerState === "UNKNOWN" || !["SUPPORTED", "PARTIAL"].includes(item.supportStatus)).map((item) => ({ field: `intakeAnswers.${item.questionId}`, currentValue: item.value, status: item.supportStatus, factClass: item.origin }))
  ];
  const client = options.client ?? new StructuredModelClient({ policy, budget: new ModelBudget({ maxCalls: 2, maxTokens: 60_000, maxMs: 180_000 }) });
  const generated = await client.generate({ profile, prompt: discoveryRecheckPrompt(targetFields, packets), schemaName: "discovery_recheck", schema: DISCOVERY_RECHECK_SCHEMA, packetHash: packetHash(packets), promptVersion: PROMPT_VERSIONS.discoveryRecheck });
  const units = new Map(packets.flatMap((packet) => packet.sourceUnits).map((unit) => [unit.id, unit]));
  const targets = new Set(targetFields.map((item) => item.field));
  const candidates = generated.value.candidates.filter((item) => targets.has(item.field)).map((item) => {
    const quotesValid = item.status === "NOT_FOUND" || item.evidenceQuotes.length > 0 && item.evidenceQuotes.every((quote) => units.has(quote.sourceUnitId) && units.get(quote.sourceUnitId).content.includes(quote.quote));
    const idsValid = item.sourceUnitIds.every((id) => units.has(id));
    return { ...item, status: quotesValid && idsValid ? item.status : "REJECTED_UNSUPPORTED", limitations: quotesValid && idsValid ? ["AI candidate requires user confirmation and does not establish documentary assurance."] : ["The model output did not reproduce an exact approved source quote."] };
  });
  run.transmissionManifest ??= [];
  run.transmissionManifest.push({
    stage: "DISCOVERY_RECHECK",
    provider: profile.provider,
    configuredModel: profile.model,
    packetIds: packets.map((packet) => packet.id),
    packetHash: packetHash(packets),
    approvedAt: approval.approvedAt,
    transmittedAt: new Date().toISOString()
  });
  run.discoveryRecheck = { status: "COMPLETED", provider: profile.provider, configuredModel: profile.model, targetFields: targetFields.map((item) => item.field), candidates, trace: generated.trace };
  run.trace.push({ stage: "DISCOVERY_RECHECK", status: "COMPLETED", at: new Date().toISOString(), candidateCount: candidates.length, outputHash: generated.trace.outputHash });
  return run.discoveryRecheck;
}
