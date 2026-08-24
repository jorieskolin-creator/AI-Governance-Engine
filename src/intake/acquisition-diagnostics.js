import { invariant, normalizePath } from "../contracts.js";
import { sha256 } from "../core/hash.js";

export const ACQUISITION_DIAGNOSTICS_VERSION = "acquisition-diagnostics-1.1.0";

const STATES = Object.freeze([
  "SELECTED",
  "ACCEPTED",
  "PARSED",
  "CONTENT_EXTRACTED",
  "INTAKE_USEFUL",
  "EXCLUDED",
  "FAILED",
  "PRIVACY_BLOCKED"
]);
const GENAI_STATES = new Set(["NOT_REQUESTED", "REQUESTED", "COMPLETED", "BLOCKED_BY_PRIVACY", "UNAVAILABLE"]);
const TECHNICAL_LOSS_SCOPES = new Set(["NONE", "PARTIAL_SOURCE_EXTRACTION", "SOURCE_UNAVAILABLE"]);
const EXCLUDED_DISPOSITIONS = new Set(["KNOWN_IRRELEVANT", "UNSUPPORTED_BINARY"]);
const FAILED_DISPOSITIONS = new Set(["UNSUPPORTED_SOURCE_LIKE", "PARSE_FAILED", "REJECTED_UNSAFE"]);

export function validateAcquisitionDiagnostics(diagnostics) {
  invariant(diagnostics?.schemaVersion === ACQUISITION_DIAGNOSTICS_VERSION, "Acquisition diagnostics version is unsupported");
  invariant(Array.isArray(diagnostics.items), "Acquisition diagnostic items are required");
  invariant(GENAI_STATES.has(diagnostics.genAi.status), "Acquisition GenAI diagnostic status is invalid");
  for (const item of diagnostics.items) {
    invariant(item.states.every((state) => STATES.includes(state)), `Acquisition diagnostic state is invalid for ${item.path}`);
    invariant(item.states[0] === "SELECTED", `Selected acquisition state is missing for ${item.path}`);
    invariant(Array.isArray(item.technicalLossReasonCodes), `Technical-loss diagnostics are invalid for ${item.path}`);
    invariant(TECHNICAL_LOSS_SCOPES.has(item.technicalLossScope), `Technical-loss scope is invalid for ${item.path}`);
    invariant((item.technicalLossScope === "NONE") === (item.technicalLossReasonCodes.length === 0), `Technical-loss scope is inconsistent for ${item.path}`);
    if (item.technicalLossScope === "PARTIAL_SOURCE_EXTRACTION") invariant(item.states.includes("CONTENT_EXTRACTED"), `Partial technical loss requires extracted content for ${item.path}`);
    if (item.technicalLossScope === "SOURCE_UNAVAILABLE") invariant(!item.states.includes("CONTENT_EXTRACTED"), `Unavailable technical loss cannot contain extracted content for ${item.path}`);
    invariant(Object.keys(item).sort().join(",") === ["extractedCharacterCount", "extractedUnitCount", "genAiEligibleFactCount", "intakeFactCount", "path", "privacyBlockingFindingCount", "states", "technicalLossReasonCodes", "technicalLossScope"].sort().join(","), `Acquisition diagnostics contain unregistered fields for ${item.path}`);
  }
  const expected = Object.fromEntries(STATES.map((state) => [state, diagnostics.items.filter((item) => item.states.includes(state)).length]));
  invariant(JSON.stringify(diagnostics.counts) === JSON.stringify(expected), "Acquisition diagnostic counts are inconsistent");
  const expectedTechnicalLoss = {
    count: diagnostics.items.filter((item) => item.technicalLossScope !== "NONE").length,
    partialSourceCount: diagnostics.items.filter((item) => item.technicalLossScope === "PARTIAL_SOURCE_EXTRACTION").length,
    unavailableSourceCount: diagnostics.items.filter((item) => item.technicalLossScope === "SOURCE_UNAVAILABLE").length,
    present: diagnostics.items.some((item) => item.technicalLossScope !== "NONE")
  };
  invariant(JSON.stringify(diagnostics.technicalLoss) === JSON.stringify(expectedTechnicalLoss), "Acquisition technical-loss summary is inconsistent");
  const expectedSourceSilenceCount = diagnostics.items.filter((item) => item.states.includes("CONTENT_EXTRACTED") && !item.states.includes("INTAKE_USEFUL") && !item.states.includes("PRIVACY_BLOCKED") && item.technicalLossScope === "NONE").length;
  invariant(JSON.stringify(diagnostics.sourceSilence) === JSON.stringify({ count: expectedSourceSilenceCount, present: expectedSourceSilenceCount > 0 }), "Acquisition source-silence summary is inconsistent");
  invariant(Object.keys(diagnostics.genAi).sort().join(",") === "failureCode,status", "Acquisition GenAI diagnostics contain unregistered fields");
  invariant(Object.keys(diagnostics).sort().join(",") === ["counts", "diagnosticsHash", "genAi", "items", "schemaVersion", "sourceSilence", "technicalLoss"].sort().join(","), "Acquisition diagnostics contain unregistered fields");
  const { diagnosticsHash, ...payload } = diagnostics;
  invariant(typeof diagnosticsHash === "string" && sha256(payload) === diagnosticsHash, "Acquisition diagnostics failed their integrity check");
  return diagnostics;
}

function finalize(payload) {
  return validateAcquisitionDiagnostics({ ...payload, diagnosticsHash: sha256(payload) });
}

export function createAcquisitionDiagnostics({ sourceIngestion, registeredSources, localSourceUnits, dlpFindings, acquiredFacts }) {
  const registeredByPath = new Map(registeredSources.map((source) => [normalizePath(source.path), source]));
  const sourceIdByUnitId = new Map(localSourceUnits.map((unit) => [unit.id, unit.sourceId]));
  const usefulFactsBySourceId = new Map();
  const eligibleFactsBySourceId = new Map();
  for (const fact of acquiredFacts.facts) {
    for (const unitId of fact.evidenceRefs) {
      const sourceId = sourceIdByUnitId.get(unitId);
      if (!sourceId) continue;
      usefulFactsBySourceId.set(sourceId, (usefulFactsBySourceId.get(sourceId) ?? 0) + 1);
      if (fact.genAiEligibility === "ELIGIBLE_CONTROLLED_VALUE") eligibleFactsBySourceId.set(sourceId, (eligibleFactsBySourceId.get(sourceId) ?? 0) + 1);
    }
  }
  const blockingSourceIds = new Set(dlpFindings.filter((finding) => finding.blocking).map((finding) => sourceIdByUnitId.get(finding.sourceUnitId)).filter(Boolean));
  const items = sourceIngestion.items.map((manifestItem) => {
    const registered = registeredByPath.get(manifestItem.path);
    const extraction = registered?.extractionDiagnostics ?? { extractedCharacters: 0, extractedMediaCount: 0, limitationCodes: [] };
    const states = ["SELECTED"];
    if (["ACCEPTED", "PARSED"].includes(manifestItem.disposition) || manifestItem.format && ["PARSE_FAILED", "REJECTED_UNSAFE"].includes(manifestItem.disposition)) states.push("ACCEPTED");
    if (manifestItem.disposition === "PARSED") states.push("PARSED");
    if (extraction.extractedCharacters > 0) states.push("CONTENT_EXTRACTED");
    const intakeFactCount = usefulFactsBySourceId.get(registered?.id) ?? 0;
    if (intakeFactCount > 0) states.push("INTAKE_USEFUL");
    if (EXCLUDED_DISPOSITIONS.has(manifestItem.disposition)) states.push("EXCLUDED");
    if (FAILED_DISPOSITIONS.has(manifestItem.disposition)) states.push("FAILED");
    if (blockingSourceIds.has(registered?.id)) states.push("PRIVACY_BLOCKED");
    const technicalLossReasonCodes = [...new Set([
      ...(FAILED_DISPOSITIONS.has(manifestItem.disposition) || manifestItem.reasonCode === "UNSUPPORTED_SOURCE_CONTAINER" ? [manifestItem.reasonCode] : []),
      ...extraction.limitationCodes,
      ...(states.includes("PARSED") && !states.includes("CONTENT_EXTRACTED") ? ["NO_CONTENT_EXTRACTED"] : [])
    ])];
    const technicalLossScope = technicalLossReasonCodes.length === 0 ? "NONE" : states.includes("CONTENT_EXTRACTED") ? "PARTIAL_SOURCE_EXTRACTION" : "SOURCE_UNAVAILABLE";
    return {
      path: manifestItem.path,
      states,
      technicalLossReasonCodes,
      technicalLossScope,
      extractedUnitCount: extraction.extractedUnitCount ?? 0,
      extractedCharacterCount: extraction.extractedCharacters,
      intakeFactCount,
      genAiEligibleFactCount: eligibleFactsBySourceId.get(registered?.id) ?? 0,
      privacyBlockingFindingCount: blockingSourceIds.has(registered?.id) ? dlpFindings.filter((finding) => finding.blocking && sourceIdByUnitId.get(finding.sourceUnitId) === registered.id).length : 0
    };
  });
  const counts = Object.fromEntries(STATES.map((state) => [state, items.filter((item) => item.states.includes(state)).length]));
  const technicalLossCount = items.filter((item) => item.technicalLossReasonCodes.length > 0).length;
  const partialTechnicalLossCount = items.filter((item) => item.technicalLossScope === "PARTIAL_SOURCE_EXTRACTION").length;
  const unavailableTechnicalLossCount = items.filter((item) => item.technicalLossScope === "SOURCE_UNAVAILABLE").length;
  const sourceSilenceCount = items.filter((item) => item.states.includes("CONTENT_EXTRACTED") && !item.states.includes("INTAKE_USEFUL") && !item.states.includes("PRIVACY_BLOCKED") && item.technicalLossReasonCodes.length === 0).length;
  const payload = {
    schemaVersion: ACQUISITION_DIAGNOSTICS_VERSION,
    counts,
    technicalLoss: { count: technicalLossCount, partialSourceCount: partialTechnicalLossCount, unavailableSourceCount: unavailableTechnicalLossCount, present: technicalLossCount > 0 },
    sourceSilence: { count: sourceSilenceCount, present: sourceSilenceCount > 0 },
    genAi: { status: counts.PRIVACY_BLOCKED ? "BLOCKED_BY_PRIVACY" : "NOT_REQUESTED", failureCode: null },
    items
  };
  return finalize(payload);
}

export function setAcquisitionGenAiStatus(run, status, failureCode = null) {
  invariant(run?.acquisitionDiagnostics, "Acquisition diagnostics are unavailable");
  invariant(GENAI_STATES.has(status), "Acquisition GenAI diagnostic status is invalid");
  const { diagnosticsHash: ignored, ...payload } = run.acquisitionDiagnostics;
  run.acquisitionDiagnostics = finalize({ ...payload, genAi: { status, failureCode } });
  return run.acquisitionDiagnostics;
}
