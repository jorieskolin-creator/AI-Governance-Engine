import { classifyArtifact, normalizePath } from "../contracts.js";
import { classifyUploadPath, ingestionCounts, SOURCE_INGESTION_VERSION } from "../../public/upload-types.js";
import { sha256 } from "./hash.js";

export const INGESTION_DISPOSITIONS = Object.freeze([
  "ACCEPTED", "PARSED", "KNOWN_IRRELEVANT", "UNSUPPORTED_SOURCE_LIKE", "UNSUPPORTED_BINARY", "PARSE_FAILED", "REJECTED_UNSAFE"
]);

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
    riskClass: "RELEVANT"
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
  const manifest = {
    version: SOURCE_INGESTION_VERSION,
    selectionMode: submitted?.selectionMode ?? selectionMode,
    selectionCompleteness: submitted ? "CLIENT_DECLARED" : "SUBMITTED_SCOPE_ONLY",
    ...counts,
    coverageStatus,
    relevantExclusionCount: riskyItems.length,
    items: result.sort((a, b) => a.path.localeCompare(b.path)),
    humanCoverageAcceptance: null
  };
  return { ...manifest, manifestHash: sha256(manifest) };
}

export function sourceCoverageRequiresReview(manifest) {
  return Boolean(manifest?.items?.some((item) => riskyDispositions.has(item.disposition)) && !manifest?.humanCoverageAcceptance);
}
