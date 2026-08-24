import { sha256, stableId } from "../core/hash.js";
import { validatePreflightInput } from "./contracts.js";
import { parseAndScreenSources } from "./source-intake.js";
import { validateDossier } from "../contracts.js";
import { discoverSolutionProfile, flattenDossier } from "../core/solution-profile.js";
import { activeIntakeAnswers, INTAKE_QUESTIONNAIRE } from "../knowledge/intake-questionnaire.js";
import { buildSourceIngestionManifest } from "../core/source-ingestion.js";
import { createApprovedIntakeSnapshot } from "../intake/contracts.js";
import { createAcquiredFactPackage } from "../intake/acquired-facts.js";
import { createAcquisitionDiagnostics } from "../intake/acquisition-diagnostics.js";
import { createIntakeCandidatePackage } from "../intake/candidate-contract.js";
import { createIntakeGapAnalysis } from "../intake/gap-analysis.js";

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
    transmissionPolicy: "Only these reviewed packets may be sent to approved providers. Raw documents, code, configuration, tabular values and image pixels remain local; provider packets contain only versioned deterministic summaries and the user-approved Intake.",
    solutionProfile: run.solutionProfile,
    intakeCandidates: run.intakeCandidates,
    acquiredFacts: run.acquiredFacts,
    sourceIngestion: run.sourceIngestion,
    acquisitionDiagnostics: run.acquisitionDiagnostics ?? null,
    intakeGapAnalysis: run.intakeGapAnalysis ?? null,
    discoveryRecheck: run.discoveryRecheck ?? null,
    approvedIntake: run.approvedIntake ? {
      schemaVersion: run.approvedIntake.schemaVersion,
      fieldRegistryVersion: run.approvedIntake.fieldRegistryVersion,
      revision: run.approvedIntake.revision,
      approvedAt: run.approvedIntake.approval.confirmedAt,
      snapshotHash: run.approvedIntake.snapshotHash
    } : null,
    citationIndex: run.packets.flatMap((packet) => packet.sourceUnits.map((unit) => ({ sourceUnitId: unit.id, path: unit.path, locator: unit.locator, sha256: unit.sha256 })))
  };
}

export async function createPreflight(input, options = {}) {
  const validated = validatePreflightInput(input, { dossierOptional: true });
  const screened = await parseAndScreenSources(validated.sources, { continueOnError: true, ...options.sourceIntake });
  const now = options.now ?? new Date();
  const ttlMs = options.ttlMs ?? 60 * 60 * 1000;
  const run = {
    id: stableId("run", { dossier: validated.dossier, manifest: screened.registeredSources, createdAt: now.toISOString() }),
    schemaVersion: "2.6.0", status: "AWAITING_INTAKE_CONFIRMATION", stage: "DETERMINISTIC_DISCOVERY_COMPLETED",
    createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + ttlMs).toISOString(), dossier: validated.dossier,
    registeredSources: screened.registeredSources, dlpFindings: screened.dlpFindings,
    sourceIngestion: buildSourceIngestionManifest({ submitted: input.sourceIngestion, parsedSources: screened.registeredSources.filter((item) => item.path !== "intended-use-dossier.json"), failedSources: screened.failedSources }),
    localSourceUnits: screened.localSourceUnits,
    packets: packetize(screened.sourceUnits, options.maxPacketChars), trace: [], result: null, error: null
  };
  run.solutionProfile = discoverSolutionProfile(screened.localSourceUnits.filter((item) => item.path !== "intended-use-dossier.json" && (!item.ocr || item.ocr.qualificationState === "QUALIFIED")), validated.dossier);
  run.intakeCandidates = createIntakeCandidatePackage(run.solutionProfile, run.localSourceUnits, run.dlpFindings);
  run.acquiredFacts = createAcquiredFactPackage(run.intakeCandidates);
  run.acquisitionDiagnostics = createAcquisitionDiagnostics({
    sourceIngestion: run.sourceIngestion,
    registeredSources: run.registeredSources,
    localSourceUnits: run.localSourceUnits,
    dlpFindings: run.dlpFindings,
    acquiredFacts: run.acquiredFacts
  });
  run.intakeGapAnalysis = createIntakeGapAnalysis({
    candidatePackage: run.intakeCandidates,
    acquisitionDiagnostics: run.acquisitionDiagnostics,
    sourceIngestion: run.sourceIngestion,
    localSourceUnits: run.localSourceUnits,
    providerUnits: run.packets.flatMap((packet) => packet.sourceUnits)
  });
  run.trace.push({ stage: "PREFLIGHT", status: "COMPLETED", at: now.toISOString(), outputHash: sha256({ manifest: run.registeredSources, dlp: run.dlpFindings, packets: run.packets.map((item) => item.hash) }) });
  return run;
}

export function publicDiscoveryView(run) {
  return {
    runId: run.id,
    status: run.status,
    stage: run.stage,
    solutionProfile: run.solutionProfile,
    intakeCandidates: run.intakeCandidates,
    acquiredFacts: run.acquiredFacts,
    dlpFindings: run.dlpFindings,
    sourceManifest: run.registeredSources,
    sourceIngestion: run.sourceIngestion,
    acquisitionDiagnostics: run.acquisitionDiagnostics ?? null,
    intakeGapAnalysis: run.intakeGapAnalysis ?? null,
    discoveryRecheck: run.discoveryRecheck ?? null,
    citationIndex: run.packets.flatMap((packet) => packet.sourceUnits.map((unit) => ({ sourceUnitId: unit.id, path: unit.path, locator: unit.locator, sha256: unit.sha256 })))
  };
}

export async function confirmPreflightDossier(run, input, options = {}) {
  if (!run || run.status !== "AWAITING_INTAKE_CONFIRMATION") throw new Error("Run is not awaiting intake confirmation");
  if (run.stage === "INTAKE_AI_VERIFICATION_IN_PROGRESS") throw new Error("Intake cannot be confirmed while AI verification is in progress");
  const submittedDossier = validateDossier(input?.dossier);
  const sourceProfile = run.solutionProfile;
  const allTransmissionUnits = run.packets.flatMap((packet) => packet.sourceUnits);
  const allLocalUnits = run.localSourceUnits ?? allTransmissionUnits;
  const oldDossierUnitIds = new Set([...allTransmissionUnits, ...allLocalUnits].filter((item) => item.path === "intended-use-dossier.json").map((item) => item.id));
  const transmissionUnits = allTransmissionUnits.filter((item) => item.path !== "intended-use-dossier.json");
  const sourceUnits = allLocalUnits.filter((item) => item.path !== "intended-use-dossier.json");
  const submittedFields = flattenDossier(submittedDossier);
  const comparable = (value) => value === undefined || value === null || value === "" || value === "UNKNOWN" || Array.isArray(value) && value.length === 0 ? null : Array.isArray(value) ? [...value].sort() : value;
  const confirmationTime = new Date().toISOString();
  const confirmations = Object.fromEntries(Object.entries(submittedFields).map(([field, value]) => {
    const priorFact = run.solutionProfile?.fields?.[field];
    const previous = ["currentStage", "targetStage"].includes(field) && priorFact?.status === "UNKNOWN" ? "UNKNOWN" : priorFact?.value;
    const userEdited = JSON.stringify(comparable(previous)) !== JSON.stringify(comparable(value));
    const resolutionState = input?.resolutions?.[field]?.resolutionState;
    const confirmed = ["USER_CONFIRMED", "USER_EDITED", "USER_ACCEPTED_PROPOSAL"].includes(resolutionState) && comparable(value) !== null;
    return [field, { confirmed, userEdited, priorFact, confirmedBy: confirmed ? "USER" : null, confirmedAt: confirmed ? confirmationTime : null }];
  }));
  const intakeAnswers = Object.fromEntries(INTAKE_QUESTIONNAIRE.questions.map((question) => {
    const submitted = submittedDossier.intakeAnswers?.[question.id] ?? { answerState: "UNKNOWN", values: [] };
    const previous = run.solutionProfile?.assessmentIntakeFacts?.[question.id];
    const resolution = input?.resolutions?.[`intakeAnswers.${question.id}`];
    const previousValues = previous?.value === previous?.answerState ? [] : previous?.value ?? [];
    const unchanged = previous && previous.answerState === submitted.answerState && JSON.stringify(previousValues) === JSON.stringify(submitted.values ?? []);
    if (unchanged && resolution?.resolutionState === "USER_CONFIRMED") return [question.id, {
      answerState: previous.answerState, values: previousValues, origin: previous.origin, supportStatus: previous.supportStatus,
      sourceUnitIds: previous.sourceUnitIds, evidenceLinks: previous.evidenceLinks, limitations: previous.limitations,
      explanation: submitted.explanation ?? null,
      confirmedBy: previous.answerState === "UNKNOWN" ? null : "USER", confirmedAt: previous.answerState === "UNKNOWN" ? null : confirmationTime
    }];
    if (resolution?.resolutionState === "USER_ACCEPTED_PROPOSAL") {
      const proposal = (run.discoveryRecheck?.candidates ?? []).find((candidate) => candidate.id === resolution.proposalRef);
      return [question.id, {
        answerState: submitted.answerState, values: submitted.values ?? [], origin: "AI_CANDIDATE", supportStatus: "PARTIAL",
        sourceUnitIds: proposal?.sourceUnitIds ?? [], evidenceLinks: proposal?.evidenceQuotes ?? [],
        limitations: ["The user accepted a source-grounded GenAI proposal; the resulting Intake value remains a user decision."],
        explanation: submitted.explanation ?? null,
        confirmedBy: "USER", confirmedAt: confirmationTime
      }];
    }
    return [question.id, {
      answerState: submitted.answerState, values: submitted.values ?? [], origin: "SELF_DECLARED",
      supportStatus: submitted.answerState === "UNKNOWN" ? "NOT_CHECKED" : "UNSUPPORTED", sourceUnitIds: [], evidenceLinks: [],
      limitations: submitted.answerState === "UNKNOWN" ? ["No answer was detected or declared."] : ["The user changed or added this answer; it is self-declared and not documentary evidence."],
      explanation: submitted.explanation ?? null,
      confirmedBy: submitted.answerState === "UNKNOWN" ? null : "USER", confirmedAt: submitted.answerState === "UNKNOWN" ? null : new Date().toISOString()
    }];
  }));
  const dossier = { ...submittedDossier, intakeAnswers };
  const solutionProfile = discoverSolutionProfile(sourceUnits, dossier, confirmations, { trustedIntakeProvenance: true });
  const effectiveDossier = { ...dossier, intakeAnswers: activeIntakeAnswers(dossier.intakeAnswers) };
  const approvedIntake = createApprovedIntakeSnapshot({
    run,
    dossier,
    effectiveDossier,
    solutionProfile,
    sourceProfile,
    resolutions: input?.resolutions,
    approval: input?.approval,
    priorRevisionRef: input?.priorRevisionRef
  });
  const dossierSource = await parseAndScreenSources([{
    path: "intended-use-dossier.json", mimeType: "application/json", format: "TEXT", encoding: "utf8",
    content: JSON.stringify(effectiveDossier), metadata: { kind: "DECLARATION" }
  }]);
  run.solutionProfile = solutionProfile;
  run.intakeCandidates = null;
  run.dossier = structuredClone(effectiveDossier);
  run.approvedIntake = approvedIntake;
  run.registeredSources = [...run.registeredSources.filter((item) => item.path !== "intended-use-dossier.json"), ...dossierSource.registeredSources];
  run.dlpFindings = [...run.dlpFindings.filter((item) => !oldDossierUnitIds.has(item.sourceUnitId)), ...dossierSource.dlpFindings];
  run.localSourceUnits = [...sourceUnits, ...dossierSource.localSourceUnits];
  run.packets = packetize([...transmissionUnits, ...dossierSource.sourceUnits], options.maxPacketChars);
  run.status = "AWAITING_TRANSMISSION_APPROVAL";
  run.stage = "INTAKE_CONFIRMED";
  run.trace.push({ stage: "INTAKE_CONFIRMATION", status: "COMPLETED", at: confirmationTime, outputHash: run.approvedIntake.snapshotHash });
  return run;
}
