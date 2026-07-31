import { sha256, stableId } from "../core/hash.js";
import { validatePreflightInput } from "./contracts.js";
import { parseAndScreenSources } from "./source-intake.js";
import { validateDossier } from "../contracts.js";
import { discoverSolutionProfile } from "../core/solution-profile.js";
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
    sourceIngestion: run.sourceIngestion
  };
}

export async function createPreflight(input, options = {}) {
  const validated = validatePreflightInput(input, { dossierOptional: true });
  const inputs = [...validated.sources];
  if (validated.dossier) inputs.push({
    path: "intended-use-dossier.json", mimeType: "application/json", format: "TEXT", encoding: "utf8",
    content: JSON.stringify(validated.dossier), metadata: { kind: "DECLARATION" }
  });
  const screened = await parseAndScreenSources(inputs, { continueOnError: true });
  const now = options.now ?? new Date();
  const ttlMs = options.ttlMs ?? 60 * 60 * 1000;
  const run = {
    id: stableId("run", { dossier: validated.dossier, manifest: screened.registeredSources, createdAt: now.toISOString() }),
    schemaVersion: "2.4.0", status: validated.dossier ? "AWAITING_TRANSMISSION_APPROVAL" : "AWAITING_INTAKE_CONFIRMATION", stage: validated.dossier ? "PREFLIGHT" : "DISCOVERY",
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
    discoveryRecheck: run.discoveryRecheck ?? null
  };
}

export async function confirmPreflightDossier(run, input, options = {}) {
  if (!run || !["AWAITING_INTAKE_CONFIRMATION", "AWAITING_TRANSMISSION_APPROVAL"].includes(run.status)) throw new Error("Run is not awaiting intake confirmation");
  const dossier = validateDossier(input?.dossier);
  const allExistingUnits = run.packets.flatMap((packet) => packet.sourceUnits);
  const oldDossierUnitIds = new Set(allExistingUnits.filter((item) => item.path === "intended-use-dossier.json").map((item) => item.id));
  const sourceUnits = allExistingUnits.filter((item) => item.path !== "intended-use-dossier.json");
  run.dossier = dossier;
  run.solutionProfile = discoverSolutionProfile(sourceUnits, dossier, input?.confirmations ?? {});
  const dossierSource = await parseAndScreenSources([{
    path: "intended-use-dossier.json", mimeType: "application/json", format: "TEXT", encoding: "utf8",
    content: JSON.stringify(dossier), metadata: { kind: "DECLARATION" }
  }]);
  run.registeredSources = [...run.registeredSources.filter((item) => item.path !== "intended-use-dossier.json"), ...dossierSource.registeredSources];
  run.dlpFindings = [...run.dlpFindings.filter((item) => !oldDossierUnitIds.has(item.sourceUnitId)), ...dossierSource.dlpFindings];
  run.packets = packetize([...sourceUnits, ...dossierSource.sourceUnits], options.maxPacketChars);
  run.status = "AWAITING_TRANSMISSION_APPROVAL";
  run.stage = "INTAKE_CONFIRMED";
  run.trace.push({ stage: "INTAKE_CONFIRMATION", status: "COMPLETED", at: new Date().toISOString(), outputHash: sha256(run.solutionProfile) });
  return run;
}
