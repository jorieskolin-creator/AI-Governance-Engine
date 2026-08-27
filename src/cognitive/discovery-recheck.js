import { DISCOVERY_RECHECK_SCHEMA, validateExecutionApproval } from "./contracts.js";
import { ModelBudget, StructuredModelClient } from "./provider-client.js";
import { acquisitionAssistancePolicy } from "./model-policy.js";
import { discoveryRecheckPrompt, packetHash, PROMPT_VERSIONS } from "./prompts.js";
import { activeIntakeQuestionIds } from "../knowledge/intake-questionnaire.js";
import { sha256, stableId } from "../core/hash.js";
import { intakeField } from "../intake/field-registry.js";
import { COGNITIVE_PROVIDERS } from "./provider-adapters.js";
import { setAcquisitionGenAiStatus } from "../intake/acquisition-diagnostics.js";
import { semanticIntakeUnitSupportsField } from "../intake/semantic-intake-evidence.js";

const MAX_RECHECK_CHARS = 60_000;

function commonApprovedProviders(approval) {
  const sets = approval.approvedPackets.map((item) => new Set(item.providers));
  return COGNITIVE_PROVIDERS.filter((provider) => sets.every((set) => set.has(provider)));
}

function relevantPackets(run, provider, approval) {
  const approved = new Set(approval.approvedPackets.filter((item) => item.providers.includes(provider)).map((item) => item.packetId));
  let used = 0;
  return run.packets.filter((packet) => approved.has(packet.id)).map((packet) => {
    const sourceUnits = packet.sourceUnits.filter((unit) => {
      if (used >= MAX_RECHECK_CHARS || unit.media) return false;
      const relevant = ["DECLARATION", "CODE_SUMMARY", "TABULAR_SUMMARY", "MEDIA_SUMMARY", "DOCUMENT_SUMMARY", "SEMANTIC_INTAKE_SUMMARY"].includes(unit.evidenceKind);
      if (relevant) used += unit.content.length;
      return relevant && used <= MAX_RECHECK_CHARS;
    });
    return { ...packet, sourceUnits };
  }).filter((packet) => packet.sourceUnits.length);
}

function candidateValueAllowed(fieldId, value) {
  const field = intakeField(fieldId);
  const text = String(value ?? "").trim();
  if (!field?.genAiProposalAllowed || !text) return false;
  if (field.dataType === "BOOLEAN") return /^(?:yes|no|true|false)$/i.test(text);
  if (field.dataType === "ENUM") return field.allowedValues.includes(text);
  if (["ENUM_ARRAY", "STRING_ARRAY"].includes(field.dataType)) {
    const values = text.split(/[,;|\n]/).map((item) => item.trim()).filter(Boolean);
    return values.length > 0 && (field.dataType !== "ENUM_ARRAY" || values.every((item) => field.allowedValues.includes(item)));
  }
  if (field.dataType === "DATE") return /^\d{4}-\d{2}-\d{2}$/.test(text) && !Number.isNaN(Date.parse(text));
  return field.dataType === "STRING";
}

function acquiredFactUnitSupportsField(unit, fieldId) {
  if (unit?.evidenceKind !== "ACQUIRED_FACT_SELECTION") return false;
  const selection = JSON.parse(unit.content);
  return Array.isArray(selection.facts) && selection.facts.some((fact) => fact.fieldId === fieldId);
}

export async function recheckDiscovery(run, input, options = {}) {
  if (!run?.solutionProfile) throw new Error("Deterministic discovery must complete before AI recheck");
  if (run.status !== "AWAITING_INTAKE_CONFIRMATION" || run.stage !== "DETERMINISTIC_DISCOVERY_COMPLETED" || run.discoveryRecheck) throw new Error("AI Intake verification is not available from the current run state");
  setAcquisitionGenAiStatus(run, "REQUESTED");
  run.stage = "INTAKE_AI_VERIFICATION_IN_PROGRESS";
  run.trace.push({ stage: "INTAKE_AI_VERIFICATION", status: "RUNNING", at: new Date().toISOString() });
  const approval = validateExecutionApproval(input, run);
  const providers = commonApprovedProviders(approval);
  if (!providers.length) throw new Error("One provider must be explicitly approved for every discovery packet");
  const policy = options.policy ?? acquisitionAssistancePolicy(options.env);
  const profiles = policy.candidates("SOLUTION_UNDERSTANDING", { allowedProviders: providers });
  const packetsFor = (provider) => {
    const selected = relevantPackets(run, provider, approval);
    if (options.acquiredFactUnit && selected.length) selected[0] = { ...selected[0], sourceUnits: [...selected[0].sourceUnits, options.acquiredFactUnit] };
    return selected;
  };
  let packets = packetsFor(profiles[0].provider);
  if (!packets.length) throw new Error("No approved evidence packet is available for discovery recheck");
  const activeQuestionIds = activeIntakeQuestionIds(run.solutionProfile.assessmentIntakeFacts);
  const gapByField = new Map(run.intakeGapAnalysis.fields.map((field) => [field.fieldId, field]));
  const selectedFactFields = new Set(options.acquiredFactUnit ? JSON.parse(options.acquiredFactUnit.content).facts.map((fact) => fact.fieldId) : []);
  const needsProposal = (fieldId) => gapByField.get(fieldId)?.state === "MISSING_UNKNOWN" || selectedFactFields.has(fieldId);
  const targetFields = [
    ...Object.values(run.solutionProfile.fields).filter((item) => intakeField(item.field)?.genAiProposalAllowed && needsProposal(item.field)).map((item) => ({ field: item.field, currentValue: null, valueWithheld: item.status !== "UNKNOWN", status: item.status, factClass: item.factClass })),
    ...Object.values(run.solutionProfile.assessmentIntakeFacts ?? {}).filter((item) => activeQuestionIds.has(item.questionId) && intakeField(`intakeAnswers.${item.questionId}`)?.genAiProposalAllowed && needsProposal(`intakeAnswers.${item.questionId}`)).map((item) => ({ field: `intakeAnswers.${item.questionId}`, currentValue: null, valueWithheld: item.answerState !== "UNKNOWN", status: item.supportStatus, factClass: item.origin }))
  ];
  const client = options.client ?? new StructuredModelClient({ policy, budget: new ModelBudget({ maxCalls: 4, maxTokens: 120_000, maxMs: 360_000 }) });
  const generated = await client.generate({ profile: profiles[0], fallbackProfiles: profiles.slice(1), prompt: discoveryRecheckPrompt(targetFields, packets), schemaName: "discovery_recheck", schema: DISCOVERY_RECHECK_SCHEMA, packetHash: packetHash(packets), promptVersion: PROMPT_VERSIONS.discoveryRecheck });
  const profile = generated.profile;
  packets = packetsFor(profile.provider);
  const units = new Map(packets.flatMap((packet) => packet.sourceUnits).map((unit) => [unit.id, unit]));
  const targets = new Set(targetFields.map((item) => item.field));
  const targetByField = new Map(targetFields.map((item) => [item.field, item]));
  const returnedByField = new Map();
  for (const item of generated.value.candidates.filter((candidate) => targets.has(candidate.field))) {
    returnedByField.set(item.field, [...(returnedByField.get(item.field) ?? []), item]);
  }
  const candidates = targetFields.map(({ field }) => {
    const returned = returnedByField.get(field) ?? [];
    if (returned.length !== 1) return {
      field,
      status: returned.length ? "REJECTED_UNSUPPORTED" : "NOT_FOUND",
      recommendation: "PROVIDE_INFORMATION",
      value: "",
      sourceUnitIds: [],
      evidenceQuotes: [],
      rationale: returned.length ? "The AI verifier returned duplicate results for this field." : "The AI verifier did not return the required field result.",
      limitations: [returned.length ? "Duplicate AI results were rejected and require user resolution." : "No AI result was returned; the information remains unknown until documented or declared by the user."]
    };
    const item = returned[0];
    const exactQuoteIds = new Set();
    const quotesValid = item.status === "NOT_FOUND"
      ? item.evidenceQuotes.length === 0 && item.sourceUnitIds.length === 0
      : item.evidenceQuotes.length > 0 && item.evidenceQuotes.every((quote) => {
        if (!quote.quote.trim() || !units.has(quote.sourceUnitId) || !units.get(quote.sourceUnitId).content.includes(quote.quote)) return false;
        exactQuoteIds.add(quote.sourceUnitId);
        return true;
      });
    const idsValid = item.sourceUnitIds.every((id) => units.has(id));
    const citedIds = new Set(item.sourceUnitIds);
    const citationCoverageValid = citedIds.size === exactQuoteIds.size && [...citedIds].every((id) => exactQuoteIds.has(id));
    const supportedResultHasEvidence = item.status === "NOT_FOUND" || item.sourceUnitIds.length > 0;
    const applicableSupportValid = item.status === "NOT_FOUND" || item.sourceUnitIds.some((id) => semanticIntakeUnitSupportsField(units.get(id), field) || acquiredFactUnitSupportsField(units.get(id), field));
    const target = targetByField.get(field);
    const currentMissing = target.currentValue === null || target.currentValue === undefined || target.currentValue === "" || target.currentValue === "UNKNOWN" || Array.isArray(target.currentValue) && target.currentValue.length === 0;
    const candidateValueValid = item.status === "NOT_FOUND" || item.status === "CONFLICTING" || candidateValueAllowed(field, item.value);
    const recommendationValid = item.status === "NOT_FOUND" ? item.recommendation === "PROVIDE_INFORMATION" && item.value === ""
      : item.status === "CANDIDATE" && item.recommendation === "REVIEW_CANDIDATE" && currentMissing && item.value.trim() !== "";
    const valid = quotesValid && idsValid && citationCoverageValid && supportedResultHasEvidence && applicableSupportValid && candidateValueValid && recommendationValid;
    return valid
      ? { ...item, limitations: ["AI verification is advisory, requires user confirmation and cannot change the deterministic Intake draft."] }
      : { ...item, status: "REJECTED_UNSUPPORTED", recommendation: "PROVIDE_INFORMATION", value: "", sourceUnitIds: [], evidenceQuotes: [], rationale: "The returned item was not eligible for Intake preparation.", limitations: ["The model output failed citation or recommendation validation and was rejected."] };
  }).map((candidate) => ({ id: stableId("intake-proposal", candidate), ...candidate }));
  run.transmissionManifest ??= [];
  const transmittedUnits = packets.flatMap((packet) => packet.sourceUnits);
  run.transmissionManifest.push({
    id: stableId("transmission", { stage: "DISCOVERY_RECHECK", provider: profile.provider, packets: packets.map((packet) => packet.id), sequence: run.transmissionManifest.length }),
    stage: "DISCOVERY_RECHECK",
    provider: profile.provider,
    configuredModel: profile.model,
    packetIds: packets.map((packet) => packet.id),
    packetHash: packetHash(packets),
    packetHashes: packets.map((packet) => sha256(packet.sourceUnits.map((unit) => ({ id: unit.id, sha256: unit.sha256 })))),
    sourceUnitIds: transmittedUnits.map((unit) => unit.id),
    containsRawEvidence: transmittedUnits.some((unit) => unit.derivation?.rawContentIncluded === true),
    derivationContracts: [...new Set(transmittedUnits.map((unit) => unit.derivation?.contractVersion).filter(Boolean))],
    approvedAt: approval.approvedAt,
    transmittedAt: new Date().toISOString()
  });
  run.discoveryRecheck = { status: "COMPLETED", provider: profile.provider, configuredModel: profile.model, targetFields: targetFields.map((item) => item.field), candidates, trace: generated.trace };
  setAcquisitionGenAiStatus(run, "COMPLETED");
  run.stage = "INTAKE_AI_VERIFICATION_COMPLETED";
  run.trace.push({ stage: "DISCOVERY_RECHECK", status: "COMPLETED", at: new Date().toISOString(), candidateCount: candidates.length, outputHash: generated.trace.outputHash });
  return run.discoveryRecheck;
}
