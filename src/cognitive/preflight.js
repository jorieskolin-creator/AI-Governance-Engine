import { sha256, stableId } from "../core/hash.js";
import { validatePreflightInput } from "./contracts.js";
import { parseAndScreenSources } from "./source-intake.js";

const DEFAULT_PACKET_CHARS = 18_000;

function packetize(sourceUnits, maxChars = DEFAULT_PACKET_CHARS) {
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
    transmissionPolicy: "Only these redacted packets may be sent, and only to explicitly approved providers. Raw files remain memory-only."
  };
}

export async function createPreflight(input, options = {}) {
  const validated = validatePreflightInput(input);
  const screened = await parseAndScreenSources([...validated.sources, {
    path: "intended-use-dossier.json", mimeType: "application/json", format: "TEXT", encoding: "utf8",
    content: JSON.stringify(validated.dossier), metadata: { kind: "DECLARATION" }
  }]);
  const now = options.now ?? new Date();
  const ttlMs = options.ttlMs ?? 60 * 60 * 1000;
  const run = {
    id: stableId("run", { dossier: validated.dossier, manifest: screened.registeredSources, createdAt: now.toISOString() }),
    schemaVersion: "2.0.0", status: "AWAITING_TRANSMISSION_APPROVAL", stage: "PREFLIGHT",
    createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + ttlMs).toISOString(), dossier: validated.dossier,
    registeredSources: screened.registeredSources, dlpFindings: screened.dlpFindings,
    packets: packetize(screened.sourceUnits, options.maxPacketChars), trace: [], result: null, error: null
  };
  run.trace.push({ stage: "PREFLIGHT", status: "COMPLETED", at: now.toISOString(), outputHash: sha256({ manifest: run.registeredSources, dlp: run.dlpFindings, packets: run.packets.map((item) => item.hash) }) });
  return run;
}
