import { sha256 } from "../core/hash.js";
import { KNOWLEDGE_VERSION, NORMATIVE_SOURCES } from "./normative-sources.js";
import { REQUIREMENTS } from "./requirements.js";
import { CONTROLS } from "./controls.js";
import { ANTIPATTERNS } from "./antipatterns.js";
import { TACTICS } from "./playbook.js";

const DOCUMENT_TYPES = new Set(["normativeSources", "requirements", "controls", "antipatterns", "tactics"]);

function localSnapshot() {
  const snapshot = {
    version: KNOWLEDGE_VERSION,
    source: "LOCAL_BOOTSTRAP",
    manifestUrl: null,
    normativeSources: [...NORMATIVE_SOURCES],
    requirements: [...REQUIREMENTS],
    controls: [...CONTROLS],
    antipatterns: [...ANTIPATTERNS],
    tactics: [...TACTICS]
  };
  return { ...snapshot, manifestHash: sha256(snapshot) };
}

async function fetchBytes(url, token) {
  const response = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    signal: AbortSignal.timeout(20_000)
  });
  if (!response.ok) throw new Error(`Knowledge fetch failed: ${response.status} ${url}`);
  return new Uint8Array(await response.arrayBuffer());
}

function decodeJson(bytes, label) {
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error(`Knowledge document is not valid JSON: ${label}`);
  }
}

function validateManifest(manifest) {
  if (!manifest || manifest.schemaVersion !== "1.0.0" || typeof manifest.version !== "string") {
    throw new Error("Unsupported Vercel knowledge manifest");
  }
  if (!Array.isArray(manifest.documents) || manifest.documents.length === 0) {
    throw new Error("Knowledge manifest has no documents");
  }
  for (const item of manifest.documents) {
    if (!DOCUMENT_TYPES.has(item.type) || typeof item.url !== "string" || !/^[a-f0-9]{64}$/.test(item.sha256 ?? "")) {
      throw new Error(`Invalid knowledge manifest entry: ${item?.id ?? "unknown"}`);
    }
  }
}

export async function loadKnowledgeSnapshot(options = {}) {
  const manifestUrl = options.manifestUrl ?? process.env.VERCEL_KB_MANIFEST_URL;
  const token = options.token ?? process.env.BLOB_READ_WRITE_TOKEN;
  const production = options.production ?? process.env.NODE_ENV === "production";
  if (!manifestUrl) {
    if (production) throw new Error("VERCEL_KB_MANIFEST_URL is required in production");
    return localSnapshot();
  }

  const manifestBytes = await fetchBytes(manifestUrl, token);
  const manifest = decodeJson(manifestBytes, manifestUrl);
  validateManifest(manifest);
  const loaded = { normativeSources: [], requirements: [], controls: [], antipatterns: [], tactics: [] };

  for (const item of manifest.documents) {
    const bytes = await fetchBytes(item.url, token);
    const actualHash = sha256(bytes);
    if (actualHash !== item.sha256) throw new Error(`Knowledge hash mismatch for ${item.id}`);
    const document = decodeJson(bytes, item.id);
    const entries = Array.isArray(document) ? document : document.entries;
    if (!Array.isArray(entries)) throw new Error(`Knowledge document ${item.id} must contain an array or entries[]`);
    loaded[item.type].push(...entries);
  }

  for (const [key, entries] of Object.entries(loaded)) {
    if (entries.length === 0) throw new Error(`Knowledge snapshot is missing ${key}`);
  }
  return {
    version: manifest.version,
    source: "VERCEL_BLOB",
    manifestUrl,
    manifestHash: sha256(manifestBytes),
    ...loaded
  };
}

export function knowledgeManifestView(snapshot) {
  return {
    version: snapshot.version,
    source: snapshot.source,
    manifestHash: snapshot.manifestHash,
    manifestUrl: snapshot.manifestUrl,
    counts: {
      normativeSources: snapshot.normativeSources.length,
      requirements: snapshot.requirements.length,
      controls: snapshot.controls.length,
      antipatterns: snapshot.antipatterns.length,
      tactics: snapshot.tactics.length
    }
  };
}

