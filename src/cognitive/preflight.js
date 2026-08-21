import { sha256, stableId } from "../core/hash.js";
import { validatePreflightInput } from "./contracts.js";
import { parseAndScreenSources } from "./source-intake.js";
import { validateDossier } from "../contracts.js";
import { discoverSolutionProfile, flattenDossier } from "../core/solution-profile.js";
import { activeIntakeAnswers, INTAKE_QUESTIONNAIRE } from "../knowledge/intake-questionnaire.js";
import { buildSourceIngestionManifest } from "../core/source-ingestion.js";

const DEFAULT_PACKET_CHARS = 18_000;

export function packetize(sourceUnits, maxChars = DEFAULT_PACKET_CHARS) {
  const packets = [];
  let units = [];
  let size = 0;
  const flush = () => {
    if (!units.length) return;
    const packetHash = sha256(units.map(({ id, sha256: hash }) => ({ id, hash })));
    packets.push({ id: stableId("packet", packetHash), hash: packetHash, sourceUnits: units, transmissionState: "PENDING_APPROVAL" });
    units = []; size = 0;
  };
  for (const unit of sourceUnits) {
    const unitSize = unit.content.length + (unit.media?.data.length ?? 0);
    if (units.length && size + unitSize > maxChars) flush();
    units.push(unit); size += unitSize;
  }
  flush();
  return packets;
}

export function publicPreflightView(run) {
  return {
    runId: run.id,
    status: run.status,
    stage: run.stage,
    expiresAt: run.expiresAt,
    sourceManifest: run.registeredSources,
    dlpFindings: run.dlpFindings,
    packets: run.packets.map((packet) => ({
      id: packet.id, hash: packet.hash, transmissionState: packet.transmissionState,
      sourceUnitIds: packet.sourceUnits.map((unit) => unit.id),
      preview: packet.sourceUnits.map((unit) => ({ id: unit.id, path: unit.path, locator: unit.locator, sensitivity: unit.sensitivity, excerpt: unit.content.slice(0, 280) }))
    })),
    transmissionPolicy: "Only these redacted packets may be sent, and only to explicitly approved providers. Raw files remain memory-only.",
    solutionProfile: run.solutionProfile,
    sourceIngestion: run.sourceIngestion,
    discoveryRecheck: run.discoveryRecheck ?? null,
    citationIndex: run.packets.flatMap((packet) => packet.sourceUnits.map((unit) => ({ sourceUnitId: unit.id, path: unit.path, locator: unit.locator, sha256: unit.sha256 })))
  };
}

export async function createPreflight(input, options = {}) {
  const validated = validatePreflightInput(input, { dossierOptional: true });
  const screened = await parseAndScreenSources(validated.sources, { continueOnError: true });
  const now = options.now ?? new Date();
  const ttlMs = options.ttlMs ?? 60 * 60 * 1000;
  const run = {
    id: stableId("run", { dossier: validated.dossier, manifest: screened.registeredSources, createdAt: now.toISOString() }),
    schemaVersion: "2.6.0", status: "AWAITING_INTAKE_CONFIRMATION", stage: "DETERMINISTIC_DISCOVERY_COMPLETED",
    createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + ttlMs).toISOString(), dossier: validated.dossier,
    registeredSources: screened.registeredSources, dlpFindings: screened.dlpFindings,
    sourceIngestion: buildSourceIngestionManifest({ submitted: input.sourceIngestion, parsedSources: screened.registeredSources.filter((item) => item.path !== "intended-use-dossier.json"), failedSources: screened.failedSources }),
    packets: packetize(screened.sourceUnits, options.maxPacketChars), trace: [], result: null, error: null
  };
  run.solutionProfile = discoverSolutionProfile(screened.sourceUnits.filter((item) => item.path !== "intended-use-dossier.json"), validated.dossier);
  run.trace.push({ stage: "PREFLIGHT", status: "COMPLETED", at: now.toISOString(), outputHash: sha256({ manifest: run.registeredSources, dlp: run.dlpFindings, packets: run.packets.map((item) => item.hash) }) });
  return run;
}

export function publicDiscoveryView(run) {
  return {
    runId: run.id,
    status: run.status,
    stage: run.stage,
    solutionProfile: run.solutionProfile,
    dlpFindings: run.dlpFindings,
    sourceManifest: run.registeredSources,
    sourceIngestion: run.sourceIngestion,
    discoveryRecheck: run.discoveryRecheck ?? null,
    citationIndex: run.packets.flatMap((packet) => packet.sourceUnits.map((unit) => ({ sourceUnitId: unit.id, path: unit.path, locator: unit.locator, sha256: unit.sha256 })))
  };
}

export async function confirmPreflightDossier(run, input, options = {}) {
  if (!run || run.status !== "AWAITING_INTAKE_CONFIRMATION") throw new Error("Run is not awaiting intake confirmation");
  if (run.stage === "INTAKE_AI_VERIFICATION_IN_PROGRESS") throw new Error("Intake cannot be confirmed while AI verification is in progress");
  const submittedDossier = validateDossier(input?.dossier);
  const allExistingUnits = run.packets.flatMap((packet) => packet.sourceUnits);
  const oldDossierUnitIds = new Set(allExistingUnits.filter((item) => item.path === "intended-use-dossier.json").map((item) => item.id));
  const sourceUnits = allExistingUnits.filter((item) => item.path !== "intended-use-dossier.json");
  const submittedFields = flattenDossier(submittedDossier);
  const comparable = (value) => value === undefined || value === null || value === "" || value === "UNKNOWN" || Array.isArray(value) && value.length === 0 ? null : Array.isArray(value) ? [...value].sort() : value;
  const confirmationTime = new Date().toISOString();
  const confirmations = Object.fromEntries(Object.entries(submittedFields).map(([field, value]) => {
    const priorFact = run.solutionProfile?.fields?.[field];
    const previous = ["currentStage", "targetStage"].includes(field) && priorFact?.status === "UNKNOWN" ? "UNKNOWN" : priorFact?.value;
    const userEdited = JSON.stringify(comparable(previous)) !== JSON.stringify(comparable(value));
    const confirmed = input?.confirmations?.[field]?.confirmed === true && comparable(value) !== null;
    return [field, { confirmed, userEdited, priorFact, confirmedBy: confirmed ? "USER" : null, confirmedAt: confirmed ? confirmationTime : null }];
  }));
  const intakeAnswers = Object.fromEntries(INTAKE_QUESTIONNAIRE.questions.map((question) => {
    const submitted = submittedDossier.intakeAnswers?.[question.id] ?? { answerState: "UNKNOWN", values: [] };
    const previous = run.solutionProfile?.assessmentIntakeFacts?.[question.id];
    const previousValues = previous?.value === previous?.answerState ? [] : previous?.value ?? [];
    const unchanged = previous && previous.answerState === submitted.answerState && JSON.stringify(previousValues) === JSON.stringify(submitted.values ?? []);
    if (unchanged) return [question.id, {
      answerState: previous.answerState, values: previousValues, origin: previous.origin, supportStatus: previous.supportStatus,
      sourceUnitIds: previous.sourceUnitIds, evidenceLinks: previous.evidenceLinks, limitations: previous.limitations,
      confirmedBy: previous.answerState === "UNKNOWN" ? null : "USER", confirmedAt: previous.answerState === "UNKNOWN" ? null : confirmationTime
    }];
    return [question.id, {
      answerState: submitted.answerState, values: submitted.values ?? [], origin: "SELF_DECLARED",
      supportStatus: submitted.answerState === "UNKNOWN" ? "NOT_CHECKED" : "UNSUPPORTED", sourceUnitIds: [], evidenceLinks: [],
      limitations: submitted.answerState === "UNKNOWN" ? ["No answer was detected or declared."] : ["The user changed or added this answer; it is self-declared and not documentary evidence."],
      confirmedBy: submitted.answerState === "UNKNOWN" ? null : "USER", confirmedAt: submitted.answerState === "UNKNOWN" ? null : new Date().toISOString()
    }];
  }));
  const dossier = { ...submittedDossier, intakeAnswers };
  run.solutionProfile = discoverSolutionProfile(sourceUnits, dossier, confirmations, { trustedIntakeProvenance: true });
  const effectiveDossier = { ...dossier, intakeAnswers: activeIntakeAnswers(dossier.intakeAnswers) };
  run.dossier = structuredClone(effectiveDossier);
  run.confirmedIntake = {
    version: "confirmed-intake-1.0.0",
    confirmedAt: confirmationTime,
    dossier: structuredClone(dossier),
    effectiveDossier: structuredClone(effectiveDossier),
    solutionProfile: structuredClone(run.solutionProfile),
    sourceIngestion: structuredClone(run.sourceIngestion)
  };
  run.confirmedIntake.hash = sha256(run.confirmedIntake);
  const dossierSource = await parseAndScreenSources([{
    path: "intended-use-dossier.json", mimeType: "application/json", format: "TEXT", encoding: "utf8",
    content: JSON.stringify(effectiveDossier), metadata: { kind: "DECLARATION" }
  }]);
  run.registeredSources = [...run.registeredSources.filter((item) => item.path !== "intended-use-dossier.json"), ...dossierSource.registeredSources];
  run.dlpFindings = [...run.dlpFindings.filter((item) => !oldDossierUnitIds.has(item.sourceUnitId)), ...dossierSource.dlpFindings];
  run.packets = packetize([...sourceUnits, ...dossierSource.sourceUnits], options.maxPacketChars);
  run.status = "AWAITING_TRANSMISSION_APPROVAL";
  run.stage = "INTAKE_CONFIRMED";
  run.trace.push({ stage: "INTAKE_CONFIRMATION", status: "COMPLETED", at: new Date().toISOString(), outputHash: sha256(run.solutionProfile) });
  return run;
}
