import { Parser } from "htmlparser2";

const MAX_EXTRACTED_CHARACTERS = 5_000_000;
const MAX_SEGMENTS = 10_000;
const MAX_EMBEDDED_JSON_BLOCKS = 100;
const MAX_EMBEDDED_JSON_CHARACTERS = 1_000_000;
const MAX_JSON_DEPTH = 25;
const MAX_JSON_NODES = 20_000;

const CAPTURE_TAGS = new Set(["title", "h1", "h2", "h3", "h4", "h5", "h6", "p", "li", "dt", "dd", "pre", "blockquote", "caption", "th", "td"]);
const SECTION_TAGS = new Set(["main", "article", "section"]);
const IGNORED_TAGS = new Set(["style", "iframe", "object", "embed", "noscript", "svg", "canvas"]);
const JSON_SCRIPT_TYPES = new Set(["application/json", "application/ld+json"]);

function cleanText(value) {
  return value.replace(/\s+/g, " ").trim();
}

function validateJsonShape(value, depth = 0, state = { nodes: 0 }) {
  if (depth > MAX_JSON_DEPTH || ++state.nodes > MAX_JSON_NODES) throw new Error("JSON_STRUCTURE_LIMIT");
  if (!value || typeof value !== "object") return;
  for (const child of Array.isArray(value) ? value : Object.values(value)) validateJsonShape(child, depth + 1, state);
}

export function extractStructuredHtml(html) {
  const segments = [];
  const limitationCodes = new Set();
  const captures = [];
  const sectionStack = [];
  const tableStack = [];
  const pendingDts = [];
  let lastDefinitionTerm = null;
  let ignoredDepth = 0;
  let sectionCount = 0;
  let headingCount = 0;
  let paragraphCount = 0;
  let listItemCount = 0;
  let blockCount = 0;
  let textCount = 0;
  let tableCount = 0;
  let definitionCount = 0;
  let embeddedJsonCount = 0;
  let embeddedJsonBlockCount = 0;
  let extractedCharacters = 0;
  let activeScript = null;
  let activeRow = null;

  const currentSection = () => sectionStack.at(-1) ?? "document";
  const emit = (locator, text, options = {}) => {
    const normalized = options.preserveWhitespace ? text.trim() : cleanText(text);
    if (!normalized) return;
    extractedCharacters += normalized.length;
    if (extractedCharacters > MAX_EXTRACTED_CHARACTERS) throw new Error("HTML extracted text exceeds the intake limit");
    if (segments.length >= MAX_SEGMENTS) throw new Error("HTML contains too many structural segments");
    segments.push({ locator, text: normalized });
  };
  const locatorFor = (tag) => {
    const section = `html:section:${currentSection()}`;
    if (tag === "title") return "html:title";
    if (/^h[1-6]$/.test(tag)) return `${section};heading:${++headingCount}:${tag}`;
    if (tag === "p") return `${section};paragraph:${++paragraphCount}`;
    if (tag === "li") return `${section};list-item:${++listItemCount}`;
    return `${section};block:${++blockCount}:${tag}`;
  };
  const flushDefinitionTerms = () => {
    pendingDts.length = 0;
    lastDefinitionTerm = null;
  };
  const closeScript = () => {
    if (!activeScript) return;
    const script = activeScript;
    activeScript = null;
    if (!script.supported) {
      if (script.hasContent) limitationCodes.add("UNSUPPORTED_EMBEDDED_SCRIPT_CONTENT_SKIPPED");
      return;
    }
    if (script.tooLarge) {
      limitationCodes.add("EMBEDDED_JSON_LIMIT_EXCEEDED");
      return;
    }
    try {
      const parsed = JSON.parse(script.content);
      if (!parsed || typeof parsed !== "object") throw new Error("JSON_ROOT_NOT_STRUCTURED");
      validateJsonShape(parsed);
      const rendered = script.content.trim();
      if (rendered.length > MAX_EMBEDDED_JSON_CHARACTERS) throw new Error("JSON_STRUCTURE_LIMIT");
      emit(`html:embedded-json:${++embeddedJsonCount}`, rendered, { preserveWhitespace: true });
    } catch (error) {
      limitationCodes.add(String(error?.message).includes("LIMIT") ? "EMBEDDED_JSON_LIMIT_EXCEEDED" : "EMBEDDED_JSON_PARSE_FAILED");
    }
  };

  const parser = new Parser({
    onopentag(name, attributes) {
      if (name === "script") {
        const type = String(attributes.type ?? "").split(";")[0].trim().toLowerCase();
        const supportedType = JSON_SCRIPT_TYPES.has(type);
        if (supportedType) embeddedJsonBlockCount += 1;
        const supported = supportedType && embeddedJsonBlockCount <= MAX_EMBEDDED_JSON_BLOCKS;
        if (JSON_SCRIPT_TYPES.has(type) && !supported) limitationCodes.add("EMBEDDED_JSON_LIMIT_EXCEEDED");
        activeScript = { supported, content: "", hasContent: false, tooLarge: false };
        return;
      }
      if (activeScript) return;
      if (IGNORED_TAGS.has(name)) { ignoredDepth += 1; return; }
      if (ignoredDepth) return;
      if (SECTION_TAGS.has(name)) sectionStack.push(++sectionCount);
      if (name === "table") tableStack.push({ id: ++tableCount, row: 0 });
      if (name === "tr") activeRow = { table: tableStack.at(-1), cells: [] };
      if (CAPTURE_TAGS.has(name)) captures.push({ tag: name, text: "", locator: locatorFor(name) });
    },
    ontext(text) {
      if (activeScript) {
        if (text.trim()) activeScript.hasContent = true;
        if (activeScript.supported && !activeScript.tooLarge) {
          activeScript.content += text;
          if (activeScript.content.length > MAX_EMBEDDED_JSON_CHARACTERS) activeScript.tooLarge = true;
        }
        return;
      }
      if (!ignoredDepth && captures.length) captures.at(-1).text += text;
      else if (!ignoredDepth && text.trim()) emit(`html:section:${currentSection()};text:${++textCount}`, text);
    },
    onclosetag(name) {
      if (name === "script") { closeScript(); return; }
      if (activeScript) return;
      if (IGNORED_TAGS.has(name)) { ignoredDepth = Math.max(0, ignoredDepth - 1); return; }
      if (ignoredDepth) return;
      if (CAPTURE_TAGS.has(name)) {
        const capture = captures.pop();
        if (capture?.tag === name) {
          if (name === "dt") {
            const term = cleanText(capture.text);
            if (term) pendingDts.push(term);
          } else if (name === "dd") {
            const value = cleanText(capture.text);
            const term = pendingDts.shift() ?? lastDefinitionTerm;
            if (term && value) {
              lastDefinitionTerm = term;
              emit(`html:section:${currentSection()};definition:${++definitionCount}`, `${term}: ${value}`);
            } else if (value) {
              emit(capture.locator, capture.text);
            }
          } else if (["th", "td"].includes(name) && activeRow) {
            activeRow.cells.push(cleanText(capture.text));
          } else {
            emit(capture.locator, capture.text, { preserveWhitespace: name === "pre" });
          }
        }
      }
      if (name === "tr" && activeRow) {
        const table = activeRow.table;
        if (table) emit(`html:section:${currentSection()};table:${table.id};row:${++table.row}`, activeRow.cells.join(" | "));
        activeRow = null;
      }
      if (name === "table") tableStack.pop();
      if (name === "dl") flushDefinitionTerms();
      if (SECTION_TAGS.has(name)) {
        flushDefinitionTerms();
        sectionStack.pop();
      }
    },
    onerror(error) { throw error; }
  }, { decodeEntities: true, lowerCaseTags: true, lowerCaseAttributeNames: true, recognizeSelfClosing: true });
  parser.end(html);
  flushDefinitionTerms();
  return { segments, limitationCodes: [...limitationCodes] };
}
