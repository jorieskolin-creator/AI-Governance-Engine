import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { invariant } from "../contracts.js";

export const OCR_EVIDENCE_VERSION = "local-ocr-evidence-1.0.0";
export const OCR_ENGINE = "TESSERACT_JS";
export const OCR_ENGINE_VERSION = "7.0.0";
export const OCR_LANGUAGE = "eng";

const MIN_QUALIFIED_CONFIDENCE = 75;
const MAX_OCR_PAGES = 25;
const MAX_PIXELS_PER_IMAGE = 4_000_000;
const MAX_TOTAL_PIXELS = 50_000_000;
const MAX_BOUNDING_BOXES = 5_000;
const OCR_TIMEOUT_MS = 20_000;

const require = createRequire(import.meta.url);
const languagePath = join(dirname(require.resolve("@tesseract.js-data/eng/package.json")), "4.0.0_best_int");

function finiteCoordinate(value) {
  return Number.isFinite(value) && value >= 0;
}

export function validateOcrProvenance(provenance) {
  invariant(provenance?.schemaVersion === OCR_EVIDENCE_VERSION, "OCR provenance version is unsupported");
  invariant(provenance.engine === OCR_ENGINE && provenance.engineVersion === OCR_ENGINE_VERSION, "OCR engine provenance is invalid");
  invariant(provenance.language === OCR_LANGUAGE, "OCR language provenance is invalid");
  invariant(typeof provenance.sourceLocator === "string" && provenance.sourceLocator, "OCR source locator is required");
  invariant(provenance.pageNumber === null || Number.isInteger(provenance.pageNumber) && provenance.pageNumber > 0, "OCR page provenance is invalid");
  invariant(Number.isInteger(provenance.pixelWidth) && provenance.pixelWidth > 0 && Number.isInteger(provenance.pixelHeight) && provenance.pixelHeight > 0, "OCR pixel dimensions are invalid");
  invariant(typeof provenance.recognizerVersion === "string" && provenance.recognizerVersion, "OCR recognizer version is invalid");
  invariant(Number.isFinite(provenance.confidence) && provenance.confidence >= 0 && provenance.confidence <= 100, "OCR confidence is invalid");
  invariant(["QUALIFIED", "REVIEW_REQUIRED"].includes(provenance.qualificationState), "OCR qualification state is invalid");
  invariant(Array.isArray(provenance.boundingBoxes) && provenance.boundingBoxes.length <= MAX_BOUNDING_BOXES, "OCR bounding-box provenance is invalid");
  for (const box of provenance.boundingBoxes) {
    invariant(finiteCoordinate(box.x0) && finiteCoordinate(box.y0) && finiteCoordinate(box.x1) && finiteCoordinate(box.y1) && box.x1 >= box.x0 && box.y1 >= box.y0, "OCR bounding box is invalid");
    invariant(Number.isFinite(box.confidence) && box.confidence >= 0 && box.confidence <= 100, "OCR bounding-box confidence is invalid");
    invariant(Object.keys(box).sort().join(",") === ["confidence", "x0", "x1", "y0", "y1"].sort().join(","), "OCR bounding box contains unrestricted fields");
  }
  invariant(Object.keys(provenance).sort().join(",") === ["boundingBoxes", "confidence", "engine", "engineVersion", "language", "pageNumber", "pixelHeight", "pixelWidth", "qualificationState", "recognizerVersion", "schemaVersion", "sourceLocator"].sort().join(","), "OCR provenance contains unregistered fields");
  return provenance;
}

function wordBoxes(blocks = []) {
  const words = blocks.flatMap((block) => block.paragraphs ?? []).flatMap((paragraph) => paragraph.lines ?? []).flatMap((line) => line.words ?? []);
  return words.slice(0, MAX_BOUNDING_BOXES).map((word) => ({
    x0: Number(word.bbox?.x0 ?? 0),
    y0: Number(word.bbox?.y0 ?? 0),
    x1: Number(word.bbox?.x1 ?? 0),
    y1: Number(word.bbox?.y1 ?? 0),
    confidence: Math.max(0, Math.min(100, Number(word.confidence ?? 0)))
  }));
}

async function withTimeout(promise, timeoutMs, onTimeout) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((resolve, reject) => { timer = setTimeout(() => { Promise.resolve(onTimeout()).then(() => reject(new Error("LOCAL_OCR_TIMEOUT")), reject); }, timeoutMs); })
    ]);
  } finally { clearTimeout(timer); }
}

export function createLocalOcrSession(options = {}) {
  const budget = options.budget ?? { pages: 0, pixels: 0 };
  let worker = null;
  let terminated = false;
  const ensureWorker = async () => {
    if (terminated) throw new Error("LOCAL_OCR_SESSION_TERMINATED");
    if (!worker) {
      const imported = await import("tesseract.js");
      const Tesseract = imported.default ?? imported;
      worker = await Tesseract.createWorker(OCR_LANGUAGE, 1, { langPath: languagePath, cacheMethod: "none", gzip: true, logger: () => {} });
    }
    return worker;
  };
  const terminate = async () => {
    terminated = true;
    if (worker) await worker.terminate();
    worker = null;
  };
  return {
    async recognize(image, context) {
      const pixels = context.pixelWidth * context.pixelHeight;
      if (++budget.pages > MAX_OCR_PAGES || pixels > MAX_PIXELS_PER_IMAGE || (budget.pixels += pixels) > MAX_TOTAL_PIXELS) throw new Error("LOCAL_OCR_BUDGET_EXCEEDED");
      const activeWorker = await ensureWorker();
      const output = { text: true, blocks: true, hocr: false, tsv: false, pdf: false, unlv: false, box: false, osd: false, imageColor: false, imageGrey: false, imageBinary: false, debug: false };
      const result = await withTimeout(activeWorker.recognize(image, {}, output), options.timeoutMs ?? OCR_TIMEOUT_MS, terminate);
      const text = String(result.data.text ?? "");
      const confidence = Math.max(0, Math.min(100, Number(result.data.confidence ?? 0)));
      const qualificationState = text.trim().length >= 3 && confidence >= MIN_QUALIFIED_CONFIDENCE ? "QUALIFIED" : "REVIEW_REQUIRED";
      const provenance = validateOcrProvenance({
        schemaVersion: OCR_EVIDENCE_VERSION,
        engine: OCR_ENGINE,
        engineVersion: OCR_ENGINE_VERSION,
        recognizerVersion: String(result.data.version ?? "UNKNOWN"),
        language: OCR_LANGUAGE,
        sourceLocator: context.sourceLocator,
        pageNumber: context.pageNumber ?? null,
        pixelWidth: context.pixelWidth,
        pixelHeight: context.pixelHeight,
        confidence,
        qualificationState,
        boundingBoxes: wordBoxes(result.data.blocks ?? [])
      });
      return { text, provenance };
    },
    terminate
  };
}

function jpegDimensions(bytes) {
  let offset = 2;
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) { offset += 1; continue; }
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++];
    if (marker === 0xd9 || marker === 0xda) break;
    if (offset + 2 > bytes.length) break;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) break;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker) && length >= 7) {
      return { pixelHeight: bytes.readUInt16BE(offset + 3), pixelWidth: bytes.readUInt16BE(offset + 5) };
    }
    offset += length;
  }
  return null;
}

export function imageDimensionsForOcr(bytes, mimeType) {
  let dimensions = null;
  if (mimeType === "image/png" && bytes.length >= 24 && bytes.subarray(12, 16).toString("ascii") === "IHDR") {
    dimensions = { pixelWidth: bytes.readUInt32BE(16), pixelHeight: bytes.readUInt32BE(20) };
  } else if (mimeType === "image/jpeg" && bytes.length >= 12) dimensions = jpegDimensions(bytes);
  else if (mimeType === "image/webp" && bytes.length >= 30 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") {
    const kind = bytes.subarray(12, 16).toString("ascii");
    if (kind === "VP8X") dimensions = { pixelWidth: 1 + bytes.readUIntLE(24, 3), pixelHeight: 1 + bytes.readUIntLE(27, 3) };
    else if (kind === "VP8L" && bytes[20] === 0x2f) {
      const bits = bytes.readUInt32LE(21);
      dimensions = { pixelWidth: 1 + (bits & 0x3fff), pixelHeight: 1 + ((bits >>> 14) & 0x3fff) };
    } else if (kind === "VP8 " && bytes.length >= 30 && bytes.subarray(23, 26).toString("hex") === "9d012a") {
      dimensions = { pixelWidth: bytes.readUInt16LE(26) & 0x3fff, pixelHeight: bytes.readUInt16LE(28) & 0x3fff };
    }
  }
  if (!dimensions || !Number.isInteger(dimensions.pixelWidth) || !Number.isInteger(dimensions.pixelHeight) || dimensions.pixelWidth <= 0 || dimensions.pixelHeight <= 0 || dimensions.pixelWidth > 20_000 || dimensions.pixelHeight > 20_000) throw new Error("INVALID_IMAGE_STRUCTURE");
  return dimensions;
}

export async function rasterizePdfPageForOcr(page) {
  const { createCanvas } = await import("@napi-rs/canvas");
  const initial = page.getViewport({ scale: 2 });
  const scale = Math.min(2, 2 * Math.sqrt(MAX_PIXELS_PER_IMAGE / (initial.width * initial.height)));
  const viewport = page.getViewport({ scale });
  const pixelWidth = Math.max(1, Math.ceil(viewport.width));
  const pixelHeight = Math.max(1, Math.ceil(viewport.height));
  const canvas = createCanvas(pixelWidth, pixelHeight);
  await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
  return { image: canvas.toBuffer("image/png"), pixelWidth, pixelHeight };
}
