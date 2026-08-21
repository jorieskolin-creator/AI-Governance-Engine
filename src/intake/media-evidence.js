import { invariant } from "../contracts.js";
import { sha256, stableId, stableStringify } from "../core/hash.js";

export const MEDIA_EVIDENCE_SUMMARY_VERSION = "media-evidence-summary-1.0.0";

const MEDIA_TYPES = new Set(["PNG", "JPEG", "WEBP"]);
const SIZE_CLASSES = new Set(["SMALL", "MEDIUM", "LARGE"]);
const FIXED_LIMITATIONS = Object.freeze([
  "METADATA_ONLY",
  "NO_PIXELS_OR_VISIBLE_TEXT_INCLUDED",
  "NO_OCR_OR_VISUAL_INTERPRETATION_PERFORMED",
  "VISUAL_EVIDENCE_REQUIRES_SEPARATE_APPROVED_LOCAL_ANALYSIS"
]);

function mediaType(mimeType) {
  if (mimeType === "image/png") return "PNG";
  if (mimeType === "image/jpeg") return "JPEG";
  if (mimeType === "image/webp") return "WEBP";
  return null;
}

function sizeClass(bytes) {
  if (bytes <= 250_000) return "SMALL";
  if (bytes <= 2_000_000) return "MEDIUM";
  return "LARGE";
}

export function validateMediaEvidenceSummary(summary) {
  invariant(summary && typeof summary === "object" && !Array.isArray(summary), "Media evidence summary must be an object");
  invariant(summary.schemaVersion === MEDIA_EVIDENCE_SUMMARY_VERSION, "Media evidence summary version is unsupported");
  invariant(/^src-[a-f0-9]{24}$/.test(summary.sourceRef), "Media evidence source reference is invalid");
  invariant(MEDIA_TYPES.has(summary.mediaType), "Media evidence type is invalid");
  invariant(SIZE_CLASSES.has(summary.sizeClass), "Media evidence size class is invalid");
  invariant(summary.analysisMethod === "LOCAL_METADATA_CLASSIFICATION", "Media evidence analysis method is invalid");
  invariant(summary.executionState === "NOT_EXECUTED", "Media evidence execution state is invalid");
  invariant(summary.visualContentState === "NOT_ASSESSED", "Media visual-content state is invalid");
  invariant(JSON.stringify(summary.limitations) === JSON.stringify(FIXED_LIMITATIONS), "Media evidence limitations are invalid");
  invariant(Object.keys(summary).sort().join(",") === ["analysisMethod", "executionState", "limitations", "mediaType", "schemaVersion", "sizeClass", "sourceRef", "visualContentState"].sort().join(","), "Media evidence summary contains unregistered fields");
  return summary;
}

export function createMediaEvidenceUnit({ sourceId, sourceHash, mimeType, byteSize }) {
  const summary = validateMediaEvidenceSummary({
    schemaVersion: MEDIA_EVIDENCE_SUMMARY_VERSION,
    sourceRef: sourceId,
    mediaType: mediaType(mimeType),
    sizeClass: sizeClass(byteSize),
    analysisMethod: "LOCAL_METADATA_CLASSIFICATION",
    executionState: "NOT_EXECUTED",
    visualContentState: "NOT_ASSESSED",
    limitations: [...FIXED_LIMITATIONS]
  });
  const rendered = stableStringify(summary);
  return {
    id: stableId("unit", { sourceId, summary }),
    sourceId,
    parentSourceId: sourceId,
    path: `derived/media-evidence/${stableId("summary", sourceId)}.json`,
    format: "TEXT",
    mimeType: "application/json",
    evidenceKind: "MEDIA_SUMMARY",
    evidenceClass: "DERIVED_METADATA",
    assuranceCeiling: "DECLARED",
    locator: "deterministic-summary",
    sha256: sha256(rendered),
    content: rendered,
    sensitivity: [],
    transmissionState: "PENDING_APPROVAL",
    coverage: { sourceHash, method: "METADATA_ONLY" },
    derivation: { contractVersion: MEDIA_EVIDENCE_SUMMARY_VERSION, parentSourceId: sourceId, parentSha256: sourceHash, rawContentIncluded: false }
  };
}
