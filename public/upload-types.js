export const SOURCE_INGESTION_VERSION = "source-ingestion-1.0.0";

export const acceptedFormatsByMime = Object.freeze({
  "text/plain": "TEXT",
  "text/markdown": "TEXT",
  "text/csv": "CSV",
  "text/html": "HTML",
  "application/xml": "TEXT",
  "text/xml": "TEXT",
  "application/json": "TEXT",
  "application/javascript": "CODE",
  "text/javascript": "CODE",
  "text/typescript": "CODE",
  "text/css": "CODE",
  "application/pdf": "PDF",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "DOCX",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "XLSX",
  "image/png": "IMAGE",
  "image/jpeg": "IMAGE",
  "image/webp": "IMAGE"
});

export const mimeByExtension = Object.freeze({
  pdf: "application/pdf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv", html: "text/html", htm: "text/html", md: "text/markdown", txt: "text/plain", json: "application/json", yaml: "text/plain", yml: "text/plain", toml: "text/plain", ini: "text/plain",
  js: "application/javascript", mjs: "application/javascript", cjs: "application/javascript", ts: "text/typescript", tsx: "text/typescript", jsx: "application/javascript", css: "text/css", py: "text/plain", java: "text/plain", go: "text/plain", rs: "text/plain", rb: "text/plain", php: "text/plain", cs: "text/plain", sql: "text/plain", tf: "text/plain",
  sh: "text/plain", bash: "text/plain", zsh: "text/plain", fish: "text/plain", ps1: "text/plain", psm1: "text/plain", bat: "text/plain", cmd: "text/plain",
  xml: "application/xml", properties: "text/plain", conf: "text/plain", cfg: "text/plain", lock: "text/plain",
  c: "text/plain", cc: "text/plain", cpp: "text/plain", cxx: "text/plain", h: "text/plain", hh: "text/plain", hpp: "text/plain",
  kt: "text/plain", kts: "text/plain", swift: "text/plain", scala: "text/plain", groovy: "text/plain", gradle: "text/plain",
  graphql: "text/plain", gql: "text/plain", prisma: "text/plain", proto: "text/plain", vue: "text/plain", svelte: "text/plain", astro: "text/plain",
  mod: "text/plain", sum: "text/plain", cmake: "text/plain",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp"
});

export const binaryMimeTypes = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "image/png", "image/jpeg", "image/webp"
]);

const recognizedTextName = /^(?:\.env(?:\..+)?|\.gitignore|\.gitattributes|\.dockerignore|\.npmrc|\.nvmrc|\.editorconfig|dockerfile(?:\..+)?|makefile|procfile|gemfile|rakefile|jenkinsfile|vagrantfile|cmakelists\.txt|readme(?:\..+)?|license(?:\..+)?|notice(?:\..+)?|changelog(?:\..+)?)$/i;
const irrelevantPath = /(?:^|\/)(?:\.git|\.svn|\.hg|node_modules|vendor|third_party|dist|build|coverage|generated|outputs?|out|\.next|target|\.cache|__pycache__)(?:\/|$)/i;
const knownBinaryExtension = new Set(["exe", "dll", "so", "dylib", "class", "jar", "war", "bin", "dat", "db", "sqlite", "pdb", "wasm", "zip", "7z", "rar", "tar", "gz", "tgz", "bz2", "xz", "dmg", "iso", "woff", "woff2", "ttf", "otf", "ico", "bmp", "tif", "tiff", "mp3", "mp4", "mov", "avi"]);

function normalizedPath(value) {
  return String(value ?? "").replaceAll("\\", "/").replace(/^\.\//, "");
}

export function resolveUploadMimeType(fileName, browserMimeType = "") {
  const path = normalizedPath(fileName);
  const baseName = path.split("/").pop() ?? "";
  if (recognizedTextName.test(baseName)) return "text/plain";
  const extension = baseName.includes(".") ? baseName.split(".").pop().toLowerCase() : "";
  const detected = mimeByExtension[extension];
  if (detected) return detected;
  return acceptedFormatsByMime[browserMimeType] ? browserMimeType : "";
}

export function classifyUploadPath(fileName, browserMimeType = "") {
  const path = normalizedPath(fileName);
  const baseName = path.split("/").pop() ?? "";
  const extension = baseName.includes(".") ? baseName.split(".").pop().toLowerCase() : "";
  if (irrelevantPath.test(path)) return { path, disposition: "KNOWN_IRRELEVANT", reasonCode: "EXCLUDED_DIRECTORY", riskClass: "IRRELEVANT", mimeType: "", format: null };
  const mimeType = resolveUploadMimeType(path, browserMimeType);
  if (mimeType) return { path, disposition: "ACCEPTED", reasonCode: "SUPPORTED_FORMAT", riskClass: "RELEVANT", mimeType, format: acceptedFormatsByMime[mimeType] };
  if (extension === "zip") return { path, disposition: "UNSUPPORTED_BINARY", reasonCode: "UNSUPPORTED_SOURCE_CONTAINER", riskClass: "IRRELEVANT", mimeType: "", format: null };
  if (knownBinaryExtension.has(extension)) return { path, disposition: "UNSUPPORTED_BINARY", reasonCode: "UNSUPPORTED_BINARY_FORMAT", riskClass: "IRRELEVANT", mimeType: "", format: null };
  return { path, disposition: "UNSUPPORTED_SOURCE_LIKE", reasonCode: "UNSUPPORTED_OR_UNKNOWN_FORMAT", riskClass: "REVIEW_REQUIRED", mimeType: "", format: null };
}

export function ingestionCounts(items) {
  const count = (disposition) => items.filter((item) => item.disposition === disposition).length;
  return {
    selectedCount: items.length,
    acceptedCount: count("ACCEPTED") + count("PARSED"),
    parsedCount: count("PARSED"),
    excludedCount: count("KNOWN_IRRELEVANT") + count("UNSUPPORTED_BINARY"),
    failedCount: count("PARSE_FAILED") + count("UNSUPPORTED_SOURCE_LIKE"),
    unsafeCount: count("REJECTED_UNSAFE")
  };
}

export function provisionalIngestionManifest(items, selectionMode = "UNKNOWN") {
  const risky = items.some((item) => ["UNSUPPORTED_SOURCE_LIKE", "PARSE_FAILED", "REJECTED_UNSAFE"].includes(item.disposition));
  const excluded = items.some((item) => ["KNOWN_IRRELEVANT", "UNSUPPORTED_BINARY"].includes(item.disposition));
  return {
    version: SOURCE_INGESTION_VERSION,
    selectionMode,
    ...ingestionCounts(items),
    coverageStatus: risky ? "INCOMPLETE_REVIEW_REQUIRED" : excluded ? "COMPLETE_WITH_DISCLOSED_EXCLUSIONS" : "COMPLETE",
    items
  };
}
