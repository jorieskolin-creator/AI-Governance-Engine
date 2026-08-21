import { extname } from "node:path";
import { classifyArtifact, HUMAN_AUTHORITIES } from "../contracts.js";
import { sha256, stableId } from "../core/hash.js";
import { sanitizeRestrictedText } from "../../public/content-policy.js";
import { CODE_EVIDENCE_SUMMARY_VERSION, createCodeEvidenceUnit } from "../intake/code-evidence.js";
import { createMediaEvidenceUnit, MEDIA_EVIDENCE_SUMMARY_VERSION } from "../intake/media-evidence.js";
import { createTabularEvidenceUnit, TABULAR_EVIDENCE_SUMMARY_VERSION } from "../intake/tabular-evidence.js";

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
  if (source.format === "HTML") {
    const inert = bytes.toString("utf8")
      .replace(/<(?:script|style|form|iframe|object|embed)\b[\s\S]*?<\/(?:script|style|form|iframe|object|embed)>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&(?:nbsp|amp|lt|gt|quot|#39);/gi, " ");
    return [{ locator: "document", text: inert }];
  }
  if (source.format === "PDF") return extractPdf(bytes);
  if (source.format === "DOCX") return extractDocx(bytes);
  if (source.format === "XLSX") return extractXlsx(bytes);
  if (source.format === "IMAGE") return [{ locator: "image:1", text: "", media: { mimeType: source.mimeType, data: bytes.toString("base64") } }];
  throw new Error(`Unsupported format for ${source.path}`);
}

export function redactText(text) {
  let value = sanitizeRestrictedText(text);
  const findings = [];
  if (value !== text) findings.push({ type: "RESTRICTED_IDENTIFIER", count: 1, severity: "HIGH" });
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
  if ([".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".py", ".java", ".go", ".rs", ".rb", ".cs", ".sh", ".bash", ".zsh", ".fish", ".ps1", ".psm1", ".bat", ".cmd", ".c", ".cc", ".cpp", ".cxx", ".h", ".hh", ".hpp", ".kt", ".swift", ".scala", ".groovy", ".graphql", ".gql", ".prisma", ".proto", ".vue", ".svelte", ".astro"].includes(extension)) return "CODE";
  if ([".json", ".yaml", ".yml", ".toml", ".ini", ".xml", ".properties", ".conf", ".cfg", ".gradle", ".kts", ".tf"].includes(extension) || /(?:^|[\\/])(?:\.env(?:\.[^\\/]+)?|dockerfile(?:\.[^\\/]+)?|makefile|procfile)$/i.test(path)) return "CONFIGURATION";
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
      id: stableId("unit", { sourceId, locator, text: redacted.text }), sourceId, path: sanitizeRestrictedText(source.path),
      format: source.format, mimeType: source.mimeType, evidenceKind: source.metadata?.kind ?? sourceKindForPath(source.path), evidenceClass: source.metadata?.kind === "DECLARATION" ? "DECLARED" : "OBSERVED", assuranceCeiling: assuranceCeiling(source), locator, sha256: sha256(raw),
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

function parseFailure(error, source) {
  const message = String(error?.message ?? "Source parsing failed");
  const unsafe = /macro|unsafe archive|suspicious compressed|does not match|invalid base64/i.test(message);
  return {
    path: sanitizeRestrictedText(source.path),
    mimeType: source.mimeType,
    format: source.format,
    size: source.encoding === "base64" ? null : String(source.content ?? "").length,
    disposition: unsafe ? "REJECTED_UNSAFE" : "PARSE_FAILED",
    reasonCode: unsafe ? "UNSAFE_OR_MISMATCHED_SOURCE" : "SOURCE_PARSE_FAILED",
    error: message.slice(0, 240)
  };
}

export async function parseAndScreenSources(sources, options = {}) {
  const sourceUnits = [];
  const localSourceUnits = [];
  const dlpFindings = [];
  const registeredSources = [];
  const failedSources = [];
  for (const source of sources) {
    try {
      const bytes = bytesFor(source);
      if (bytes.length > MAX_SOURCE_BYTES) throw new Error(`${source.path} exceeds the 15 MB per-source intake limit`);
      assertFileSignature(source, bytes);
      const sourceHash = sha256(bytes);
      const safePath = sanitizeRestrictedText(source.path);
      const sourceId = stableId("src", { path: source.path, sourceHash });
      const segments = await extractSegments(source, bytes);
      const artifactClass = classifyArtifact(source.path, source.metadata);
      const sourceKind = source.metadata?.kind ?? sourceKindForPath(source.path);
      const localUnits = [];
      const sourceFindings = [];
      for (const segment of segments) {
        if (source.format === "PDF" && !segment.text.trim()) {
          const unit = {
            id: stableId("unit", { sourceId, locator: segment.locator, sourceHash, emptyVisualPage: true }), sourceId, path: safePath,
            format: source.format, mimeType: source.mimeType, evidenceKind: "DOCUMENT", evidenceClass: "OBSERVED", assuranceCeiling: "DECLARED", locator: segment.locator, sha256: sourceHash,
            content: "[PDF PAGE HAS NO EXTRACTABLE TEXT]", sensitivity: ["UNSCREENED_PDF_PAGE"], transmissionState: "PENDING_APPROVAL", coverage: { characters: 0 }
          };
          localUnits.push(unit);
          const finding = { id: stableId("dlp", { unitId: unit.id, type: "UNSCREENED_PDF_PAGE" }), sourceUnitId: unit.id, type: "UNSCREENED_PDF_PAGE", count: 1, severity: "HIGH", blocking: true };
          dlpFindings.push(finding); sourceFindings.push(finding);
          continue;
        }
        if (segment.media) {
          const sanitized = source.metadata?.sanitized === true;
          const unit = {
            id: stableId("unit", { sourceId, locator: segment.locator, sourceHash }), sourceId, path: safePath,
            format: source.format, mimeType: source.mimeType, evidenceKind: source.metadata?.kind ?? "DOCUMENT", evidenceClass: source.metadata?.kind === "DECLARATION" ? "DECLARED" : "OBSERVED", assuranceCeiling: assuranceCeiling(source), locator: segment.locator, sha256: sourceHash,
            content: "[IMAGE CONTENT — transmit only after explicit approval]", media: segment.media,
            sensitivity: sanitized ? [] : ["UNSCREENED_IMAGE"], transmissionState: "PENDING_APPROVAL", coverage: { images: 1 }
          };
          localUnits.push(unit);
          if (!sanitized) {
            const finding = { id: stableId("dlp", { unitId: unit.id, type: "UNSCREENED_IMAGE" }), sourceUnitId: unit.id, type: "UNSCREENED_IMAGE", count: 1, severity: "HIGH", blocking: true };
            dlpFindings.push(finding); sourceFindings.push(finding);
          }
          continue;
        }
        for (const item of chunkText(source, sourceId, segment)) {
          localUnits.push(item.unit);
          for (const finding of item.dlpFindings) {
            const record = { id: stableId("dlp", { unitId: item.unit.id, type: finding.type }), sourceUnitId: item.unit.id, ...finding, blocking: false };
            dlpFindings.push(record); sourceFindings.push(record);
          }
        }
      }
      const testCode = artifactClass === "TEST" && !/\.(?:md|txt|html?|pdf|docx?|xlsx?|csv)$/i.test(source.path);
      const codeOrConfiguration = ["PRODUCTION_CODE", "CONFIGURATION"].includes(artifactClass) || testCode;
      const tabular = ["CSV", "XLSX"].includes(source.format);
      const media = source.format === "IMAGE";
      const egressUnits = media
        ? [createMediaEvidenceUnit({ sourceId, sourceHash, mimeType: source.mimeType, byteSize: bytes.length })]
        : tabular
          ? [createTabularEvidenceUnit({ sourceId, sourceHash, format: source.format, segments, findings: sourceFindings })]
          : codeOrConfiguration
            ? [createCodeEvidenceUnit({ sourceId, sourceHash, path: source.path, sourceKind, content: bytes.toString("utf8"), findings: sourceFindings })]
            : localUnits;
      const acquisitionLane = media ? "MEDIA_LOCAL_METADATA" : tabular ? "TABULAR_LOCAL_ANALYSIS" : codeOrConfiguration ? "CODE_CONFIGURATION_LOCAL_ANALYSIS" : "DOCUMENT_MEDIA_SCREENING";
      const localOnly = media || tabular || codeOrConfiguration;
      localSourceUnits.push(...localUnits);
      sourceUnits.push(...egressUnits);
      registeredSources.push({
        id: sourceId, path: safePath, mimeType: source.mimeType, format: source.format, artifactClass, sha256: sourceHash, size: bytes.length, metadata: source.metadata,
        acquisitionLane,
        rawContentPolicy: localOnly ? "LOCAL_ONLY" : "REDACTED_CONTENT_REQUIRES_APPROVAL",
        egressPolicy: localOnly ? "DETERMINISTIC_SUMMARY_ONLY" : "REDACTED_SOURCE_UNITS",
        derivedUnitIds: localOnly ? egressUnits.map((unit) => unit.id) : [],
        analyzerVersion: media ? MEDIA_EVIDENCE_SUMMARY_VERSION : tabular ? TABULAR_EVIDENCE_SUMMARY_VERSION : codeOrConfiguration ? CODE_EVIDENCE_SUMMARY_VERSION : null
      });
    } catch (error) {
      if (!options.continueOnError) throw error;
      failedSources.push(parseFailure(error, source));
    }
  }
  if (!sourceUnits.length && !registeredSources.length) throw new Error("No supported source could be parsed. Review the disclosed exclusions and provide at least one supported source.");
  return { registeredSources, sourceUnits, localSourceUnits, dlpFindings, failedSources };
}

export function sourceKindForUnit(unit) {
  return unit.evidenceKind ?? sourceKindForPath(unit.path);
}
