import { extname } from "node:path";
import { HUMAN_AUTHORITIES } from "../contracts.js";
import { sha256, stableId } from "../core/hash.js";

const MAX_SOURCE_BYTES = 15 * 1024 * 1024;
const MAX_EXTRACTED_CHARACTERS = 5_000_000;
const MAX_ARCHIVE_ENTRIES = 5_000;
const MAX_ARCHIVE_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;

const SECRET_PATTERNS = [
  { type: "PRIVATE_KEY", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/gi },
  { type: "CREDENTIAL", pattern: /\b(?:sk|rk|pk)_(?:live|test)_[a-z0-9_-]{16,}\b/gi },
  { type: "AWS_ACCESS_KEY", pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  { type: "ASSIGNED_SECRET", pattern: /(?:api[_-]?key|secret|password|token)\s*[:=]\s*["'][^"'\s]{8,}["']/gi }
];

const PERSONAL_PATTERNS = [
  { type: "EMAIL", pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi },
  { type: "PHONE", pattern: /(?<!\w)(?:\+\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?)?\d{3}[\s.-]?\d{3,4}(?!\w)/g },
  { type: "NATIONAL_IDENTIFIER_CANDIDATE", pattern: /\b\d{6}[-+A]\d{3}[0-9A-Z]\b/gi }
];

const INJECTION_PATTERNS = [
  /ignore (?:all |any )?(?:previous|prior|above) instructions/i,
  /system prompt|developer message|hidden instructions/i,
  /declare (?:the )?(?:system|solution).*(?:compliant|approved|safe)/i,
  /do not (?:tell|show|reveal).*(?:reviewer|user)/i,
  /exfiltrat|send (?:the )?(?:secret|credential|token)/i
];

function bytesFor(source) {
  if (source.encoding === "base64") {
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(source.content) || source.content.length % 4 !== 0) throw new Error(`Invalid base64 content: ${source.path}`);
    const value = Buffer.from(source.content, "base64");
    if (value.length === 0 && source.content.length) throw new Error(`Invalid base64 content: ${source.path}`);
    return value;
  }
  return Buffer.from(source.content, "utf8");
}

function assertFileSignature(source, bytes) {
  const ascii = bytes.subarray(0, 12).toString("ascii");
  const hex = bytes.subarray(0, 12).toString("hex");
  const valid = source.format === "PDF" ? ascii.startsWith("%PDF-")
    : ["DOCX", "XLSX"].includes(source.format) ? hex.startsWith("504b0304")
      : source.mimeType === "image/png" ? hex.startsWith("89504e470d0a1a0a")
        : source.mimeType === "image/jpeg" ? hex.startsWith("ffd8ff")
          : source.mimeType === "image/webp" ? ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WEBP"
            : true;
  if (!valid) throw new Error(`${source.path} content does not match ${source.mimeType}`);
}

async function extractPdf(bytes) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const document = await pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, useWorkerFetch: false }).promise;
  if (document.numPages > 500) throw new Error("PDF exceeds the 500-page intake limit");
  const pages = [];
  let extractedCharacters = 0;
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = content.items.map((item) => item.str).join(" ");
    extractedCharacters += text.length;
    if (extractedCharacters > MAX_EXTRACTED_CHARACTERS) throw new Error("PDF extracted text exceeds the intake limit");
    pages.push({ locator: `page:${pageNumber}`, text });
  }
  return pages;
}

async function inspectOfficeArchive(bytes) {
  const imported = await import("unzipper");
  const unzipper = imported.default ?? imported;
  const directory = await unzipper.Open.buffer(bytes);
  if (directory.files.length > MAX_ARCHIVE_ENTRIES) throw new Error("Office document has too many archive entries");
  let total = 0;
  for (const file of directory.files) {
    const path = file.path.replaceAll("\\", "/");
    if (path.startsWith("/") || path.split("/").includes("..")) throw new Error("Office document contains an unsafe archive path");
    if (/vbaProject\.bin$|macros?/i.test(path)) throw new Error("Macro-bearing Office documents are not accepted");
    const uncompressed = Number(file.vars?.uncompressedSize ?? 0);
    const compressed = Math.max(1, Number(file.vars?.compressedSize ?? 1));
    total += uncompressed;
    if (uncompressed > 15 * 1024 * 1024 || uncompressed / compressed > 200) throw new Error("Office document contains a suspicious compressed entry");
  }
  if (total > MAX_ARCHIVE_UNCOMPRESSED_BYTES) throw new Error("Office document exceeds the uncompressed intake limit");
}

async function extractDocx(bytes) {
  await inspectOfficeArchive(bytes);
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer: bytes });
  if (result.value.length > MAX_EXTRACTED_CHARACTERS) throw new Error("DOCX extracted text exceeds the intake limit");
  return [{ locator: "document", text: result.value }];
}

async function extractXlsx(bytes) {
  await inspectOfficeArchive(bytes);
  const imported = await import("read-excel-file/node");
  const workbookSheets = await imported.default(bytes);
  let extractedCharacters = 0;
  const sheets = [];
  for (const workbookSheet of workbookSheets) {
    const sheetName = workbookSheet.sheet;
    const data = workbookSheet.data;
    const rows = [];
    for (let rowIndex = 0; rowIndex < data.length; rowIndex += 1) {
      const cells = data[rowIndex].map((value, columnIndex) => {
        const rendered = `R${rowIndex + 1}C${columnIndex + 1}=${value ?? ""}`;
        extractedCharacters += rendered.length;
        if (extractedCharacters > MAX_EXTRACTED_CHARACTERS) throw new Error("XLSX extracted text exceeds the intake limit");
        return rendered;
      });
      rows.push(cells.join("\t"));
    }
    sheets.push({ locator: `sheet:${sheetName}`, text: rows.join("\n") });
  }
  return sheets;
}

async function extractSegments(source, bytes) {
  if (["TEXT", "CODE", "CSV"].includes(source.format)) return [{ locator: "text", text: bytes.toString("utf8") }];
  if (source.format === "PDF") return extractPdf(bytes);
  if (source.format === "DOCX") return extractDocx(bytes);
  if (source.format === "XLSX") return extractXlsx(bytes);
  if (source.format === "IMAGE") return [{ locator: "image:1", text: "", media: { mimeType: source.mimeType, data: bytes.toString("base64") } }];
  throw new Error(`Unsupported format for ${source.path}`);
}

function redactText(text) {
  let value = text;
  const findings = [];
  for (const entry of [...SECRET_PATTERNS, ...PERSONAL_PATTERNS]) {
    let count = 0;
    value = value.replace(entry.pattern, () => { count += 1; return `[REDACTED_${entry.type}]`; });
    if (count) findings.push({ type: entry.type, count, severity: SECRET_PATTERNS.includes(entry) ? "CRITICAL" : "HIGH" });
  }
  const injectionMatches = INJECTION_PATTERNS.filter((pattern) => pattern.test(text));
  if (injectionMatches.length) findings.push({ type: "PROMPT_INJECTION_CANDIDATE", count: injectionMatches.length, severity: "HIGH" });
  if (/\b(confidential|restricted|internal only|trade secret)\b/i.test(text)) findings.push({ type: "CONFIDENTIAL_MARKER", count: 1, severity: "MEDIUM" });
  return { text: value, findings };
}

function assuranceCeiling(source) {
  const kind = source.metadata?.kind ?? sourceKindForPath(source.path);
  if (["CODE", "CONFIGURATION"].includes(kind)) return "IMPLEMENTED";
  if (["TEST", "SCAN_RESULT", "PENETRATION_TEST"].includes(kind)) {
    const passed = [source.metadata?.executionStatus, source.metadata?.resultStatus, source.metadata?.status].includes("PASSED");
    return passed && typeof source.metadata?.scope === "string" && source.metadata.scope.trim() ? "TESTED" : kind === "TEST" ? "IMPLEMENTED" : "DECLARED";
  }
  if (["OPERATIONAL_LOG", "MONITORING_RECORD"].includes(kind)) return "OPERATIONALLY_OBSERVED";
  const human = source.metadata?.humanActorId && source.metadata.humanActorId !== "ENGINE" && HUMAN_AUTHORITIES.includes(source.metadata?.authority);
  if (["HUMAN_REVIEW", "FORMAL_APPROVAL"].includes(kind) && human) return "HUMAN_VALIDATED";
  return "DECLARED";
}

function sourceKindForPath(path) {
  const extension = extname(path).toLowerCase();
  if (/test|spec|eval/.test(path)) return "TEST";
  if ([".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".py", ".java", ".go", ".rs", ".rb", ".cs"].includes(extension)) return "CODE";
  if ([".json", ".yaml", ".yml", ".toml", ".ini", ".tf"].includes(extension)) return "CONFIGURATION";
  return "DOCUMENT";
}

function chunkText(source, sourceId, segment, maxChars = 6000) {
  const lines = segment.text.replaceAll("\r\n", "\n").split("\n");
  const chunks = [];
  let buffer = [];
  let chars = 0;
  let startLine = 1;
  const flush = (endLine) => {
    if (!buffer.length) return;
    const raw = buffer.join("\n");
    const redacted = redactText(raw);
    const locator = `${segment.locator};lines:${startLine}-${endLine}`;
    const unit = {
      id: stableId("unit", { sourceId, locator, text: redacted.text }), sourceId, path: source.path,
      format: source.format, mimeType: source.mimeType, evidenceKind: source.metadata?.kind ?? sourceKindForPath(source.path), assuranceCeiling: assuranceCeiling(source), locator, sha256: sha256(raw),
      content: redacted.text, sensitivity: redacted.findings.map((item) => item.type),
      transmissionState: "PENDING_APPROVAL", coverage: { characters: raw.length, startLine, endLine }
    };
    chunks.push({ unit, dlpFindings: redacted.findings });
    buffer = []; chars = 0; startLine = endLine + 1;
  };
  for (let index = 0; index < lines.length; index += 1) {
    if (buffer.length && chars + lines[index].length + 1 > maxChars) flush(index);
    if (!buffer.length) startLine = index + 1;
    buffer.push(lines[index]); chars += lines[index].length + 1;
  }
  flush(lines.length);
  return chunks;
}

export async function parseAndScreenSources(sources) {
  const sourceUnits = [];
  const dlpFindings = [];
  const registeredSources = [];
  for (const source of sources) {
    const bytes = bytesFor(source);
    if (bytes.length > MAX_SOURCE_BYTES) throw new Error(`${source.path} exceeds the 15 MB per-source intake limit`);
    assertFileSignature(source, bytes);
    const sourceHash = sha256(bytes);
    const sourceId = stableId("src", { path: source.path, sourceHash });
    const segments = await extractSegments(source, bytes);
    registeredSources.push({ id: sourceId, path: source.path, mimeType: source.mimeType, format: source.format, sha256: sourceHash, size: bytes.length });
    for (const segment of segments) {
      if (source.format === "PDF" && !segment.text.trim()) {
        const unit = {
          id: stableId("unit", { sourceId, locator: segment.locator, sourceHash, emptyVisualPage: true }), sourceId, path: source.path,
          format: source.format, mimeType: source.mimeType, evidenceKind: "DOCUMENT", assuranceCeiling: "DECLARED", locator: segment.locator, sha256: sourceHash,
          content: "[PDF PAGE HAS NO EXTRACTABLE TEXT]", sensitivity: ["UNSCREENED_PDF_PAGE"], transmissionState: "PENDING_APPROVAL", coverage: { characters: 0 }
        };
        sourceUnits.push(unit);
        dlpFindings.push({ id: stableId("dlp", { unitId: unit.id, type: "UNSCREENED_PDF_PAGE" }), sourceUnitId: unit.id, type: "UNSCREENED_PDF_PAGE", count: 1, severity: "HIGH", blocking: true });
        continue;
      }
      if (segment.media) {
        const sanitized = source.metadata?.sanitized === true;
        const unit = {
          id: stableId("unit", { sourceId, locator: segment.locator, sourceHash }), sourceId, path: source.path,
          format: source.format, mimeType: source.mimeType, evidenceKind: source.metadata?.kind ?? "DOCUMENT", assuranceCeiling: assuranceCeiling(source), locator: segment.locator, sha256: sourceHash,
          content: "[IMAGE CONTENT — transmit only after explicit approval]", media: segment.media,
          sensitivity: sanitized ? [] : ["UNSCREENED_IMAGE"], transmissionState: "PENDING_APPROVAL", coverage: { images: 1 }
        };
        sourceUnits.push(unit);
        if (!sanitized) dlpFindings.push({ id: stableId("dlp", { unitId: unit.id, type: "UNSCREENED_IMAGE" }), sourceUnitId: unit.id, type: "UNSCREENED_IMAGE", count: 1, severity: "HIGH", blocking: true });
        continue;
      }
      for (const item of chunkText(source, sourceId, segment)) {
        sourceUnits.push(item.unit);
        for (const finding of item.dlpFindings) dlpFindings.push({
          id: stableId("dlp", { unitId: item.unit.id, type: finding.type }), sourceUnitId: item.unit.id,
          ...finding, blocking: false
        });
      }
    }
  }
  return { registeredSources, sourceUnits, dlpFindings };
}

export function sourceKindForUnit(unit) {
  return unit.evidenceKind ?? sourceKindForPath(unit.path);
}
