export const mimeByExtension = Object.freeze({
  pdf: "application/pdf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv", html: "text/html", htm: "text/html", md: "text/markdown", txt: "text/plain", json: "application/json", yaml: "text/plain", yml: "text/plain", toml: "text/plain", ini: "text/plain",
  js: "application/javascript", mjs: "application/javascript", cjs: "application/javascript", ts: "text/typescript", tsx: "text/typescript", jsx: "application/javascript", css: "text/css", py: "text/plain", java: "text/plain", go: "text/plain", rs: "text/plain", rb: "text/plain", php: "text/plain", cs: "text/plain", sql: "text/plain", tf: "text/plain",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp"
});

export const binaryMimeTypes = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "image/png", "image/jpeg", "image/webp"
]);

const recognizedConfigurationName = /^(?:\.env(?:\..+)?|\.gitignore|\.gitattributes|\.dockerignore|\.npmrc|\.nvmrc|\.editorconfig|dockerfile(?:\..+)?|makefile|procfile)$/i;

export function resolveUploadMimeType(fileName, browserMimeType = "") {
  const normalized = String(fileName ?? "").replaceAll("\\", "/");
  const baseName = normalized.split("/").pop() ?? "";
  if (recognizedConfigurationName.test(baseName)) return "text/plain";
  const extension = baseName.includes(".") ? baseName.split(".").pop().toLowerCase() : "";
  return mimeByExtension[extension] ?? browserMimeType ?? "";
}
