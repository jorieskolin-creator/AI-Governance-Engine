import { classifyArtifact, invariant, normalizePath } from "../contracts.js";
import { CODE_EVIDENCE_SUMMARY_VERSION } from "../intake/code-evidence.js";
import { classifyUploadPath, ingestionCounts, SOURCE_INGESTION_VERSION } from "../../public/upload-types.js";
import { sha256 } from "./hash.js";

export const INGESTION_DISPOSITIONS = Object.freeze([
  "ACCEPTED", "PARSED", "KNOWN_IRRELEVANT", "UNSUPPORTED_SOURCE_LIKE", "UNSUPPORTED_BINARY", "PARSE_FAILED", "REJECTED_UNSAFE"
]);
export const EVIDENCE_ACQUISITION_VERSION = "evidence-acquisition-1.0.0";

const riskyDispositions = new Set(["UNSUPPORTED_SOURCE_LIKE", "PARSE_FAILED", "REJECTED_UNSAFE"]);

function safeItem(raw) {
  const path = normalizePath(String(raw?.path ?? ""));
  const classified = classifyUploadPath(path, raw?.mimeType ?? "");
  let disposition = INGESTION_DISPOSITIONS.includes(raw?.disposition) ? raw.disposition : classified.disposition;
  if (disposition === "KNOWN_IRRELEVANT" && classified.disposition !== "KNOWN_IRRELEVANT") disposition = classified.disposition === "ACCEPTED" ? "UNSUPPORTED_SOURCE_LIKE" : classified.disposition;
  const value = {
    path,
    size: Number.isFinite(Number(raw?.size)) && Number(raw.size) >= 0 ? Number(raw.size) : null,
    mimeType: classified.mimeType || (typeof raw?.mimeType === "string" ? raw.mimeType : ""),
    format: classified.format ?? (typeof raw?.format === "string" ? raw.format : null),
    artifactClass: classifyArtifact(path),
    disposition,
    reasonCode: typeof raw?.reasonCode === "string" ? raw.reasonCode : classified.reasonCode,
    riskClass: riskyDispositions.has(disposition) ? "REVIEW_REQUIRED" : disposition === "PARSED" || disposition === "ACCEPTED" ? "RELEVANT" : "IRRELEVANT"
  };
  return value;
}

function acceptedItem(source) {
  const path = normalizePath(source.path);
  return {
    path,
    size: Number.isFinite(Number(source.size)) ? Number(source.size) : typeof source.content === "string" ? source.content.length : null,
    mimeType: source.mimeType ?? "text/plain",
    format: source.format ?? null,
    artifactClass: source.artifactClass ?? classifyArtifact(path, source.metadata),
    disposition: "PARSED",
    reasonCode: "PARSED_SUCCESSFULLY",
    riskClass: "RELEVANT",
    acquisitionLane: source.acquisitionLane ?? "DOCUMENT_MEDIA_SCREENING",
    rawContentPolicy: source.rawContentPolicy ?? "REDACTED_CONTENT_REQUIRES_APPROVAL",
    egressPolicy: source.egressPolicy ?? "REDACTED_SOURCE_UNITS",
    derivedUnitIds: Array.isArray(source.derivedUnitIds) ? [...source.derivedUnitIds] : [],
    analyzerVersion: source.analyzerVersion ?? null
  };
}

export function buildSourceIngestionManifest({ submitted = null, parsedSources = [], failedSources = [], selectionMode = "API_SUBMISSION" } = {}) {
  const parsedByPath = new Map(parsedSources.map((item) => [normalizePath(item.path), acceptedItem(item)]));
  const submittedItems = Array.isArray(submitted?.items) ? submitted.items.map(safeItem) : [];
  const result = [];
  const seen = new Set();
  for (const item of submittedItems) {
    const parsed = parsedByPath.get(item.path);
    const value = parsed ?? item;
    result.push(value); seen.add(item.path);
  }
  for (const item of parsedByPath.values()) if (!seen.has(item.path)) { result.push(item); seen.add(item.path); }
  for (const failure of failedSources) {
    const path = normalizePath(failure.path);
    const disposition = failure.disposition === "REJECTED_UNSAFE" ? "REJECTED_UNSAFE" : "PARSE_FAILED";
    const value = safeItem({ ...failure, path, disposition, reasonCode: failure.reasonCode ?? disposition });
    const index = result.findIndex((item) => item.path === path);
    if (index >= 0) result[index] = value; else result.push(value);
  }
  const counts = ingestionCounts(result);
  const riskyItems = result.filter((item) => riskyDispositions.has(item.disposition));
  const disclosedExclusions = result.filter((item) => ["KNOWN_IRRELEVANT", "UNSUPPORTED_BINARY"].includes(item.disposition));
  const coverageStatus = riskyItems.length ? "INCOMPLETE_REVIEW_REQUIRED" : disclosedExclusions.length ? "COMPLETE_WITH_DISCLOSED_EXCLUSIONS" : "COMPLETE";
  const laneCounts = Object.fromEntries([...new Set(result.map((item) => item.acquisitionLane).filter(Boolean))].sort()
    .map((lane) => [lane, result.filter((item) => item.acquisitionLane === lane).length]));
  const manifest = {
    version: SOURCE_INGESTION_VERSION,
    acquisitionContractVersion: EVIDENCE_ACQUISITION_VERSION,
    selectionMode: submitted?.selectionMode ?? selectionMode,
    selectionCompleteness: submitted ? "CLIENT_DECLARED" : "SUBMITTED_SCOPE_ONLY",
    ...counts,
    laneCounts,
    coverageStatus,
    relevantExclusionCount: riskyItems.length,
    items: result.sort((a, b) => a.path.localeCompare(b.path)),
    humanCoverageAcceptance: null
  };
  return validateSourceIngestionManifest({ ...manifest, manifestHash: sha256(manifest) });
}

export function validateSourceIngestionManifest(manifest) {
  invariant(manifest && typeof manifest === "object" && !Array.isArray(manifest), "Source ingestion manifest is required");
  invariant(manifest.version === SOURCE_INGESTION_VERSION, "Source ingestion manifest version is unsupported");
  invariant(manifest.acquisitionContractVersion === EVIDENCE_ACQUISITION_VERSION, "Evidence acquisition contract version is unsupported");
  invariant(Array.isArray(manifest.items), "Source ingestion manifest items are required");
  for (const item of manifest.items.filter((entry) => entry.disposition === "PARSED")) {
    invariant(Array.isArray(item.derivedUnitIds), `Acquisition lineage is required for ${item.path}`);
    if (item.acquisitionLane === "CODE_CONFIGURATION_LOCAL_ANALYSIS") {
      invariant(item.rawContentPolicy === "LOCAL_ONLY" && item.egressPolicy === "DETERMINISTIC_SUMMARY_ONLY", `Code/configuration acquisition policy is invalid for ${item.path}`);
      invariant(item.analyzerVersion === CODE_EVIDENCE_SUMMARY_VERSION && item.derivedUnitIds.length === 1, `Code/configuration derivation is invalid for ${item.path}`);
    } else {
      invariant(item.acquisitionLane === "DOCUMENT_MEDIA_SCREENING", `Acquisition lane is invalid for ${item.path}`);
      invariant(item.rawContentPolicy === "REDACTED_CONTENT_REQUIRES_APPROVAL" && item.egressPolicy === "REDACTED_SOURCE_UNITS", `Document/media acquisition policy is invalid for ${item.path}`);
      invariant(item.analyzerVersion === null && item.derivedUnitIds.length === 0, `Document/media derivation is invalid for ${item.path}`);
    }
  }
  const expectedLaneCounts = Object.fromEntries([...new Set(manifest.items.map((item) => item.acquisitionLane).filter(Boolean))].sort()
    .map((lane) => [lane, manifest.items.filter((item) => item.acquisitionLane === lane).length]));
  invariant(JSON.stringify(manifest.laneCounts) === JSON.stringify(expectedLaneCounts), "Source ingestion lane counts are inconsistent");
  const { manifestHash, ...payload } = manifest;
  invariant(typeof manifestHash === "string" && sha256(payload) === manifestHash, "Source ingestion manifest failed its integrity check");
  return manifest;
}

export function sourceCoverageRequiresReview(manifest) {
  return Boolean(manifest?.items?.some((item) => riskyDispositions.has(item.disposition)) && !manifest?.humanCoverageAcceptance);
}
