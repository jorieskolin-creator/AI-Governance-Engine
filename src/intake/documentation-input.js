import { webcrypto } from "node:crypto";
import { DomUtils, parseDocument } from "htmlparser2";
import { HANDOFF_MAX_BYTES, HANDOFF_SCRIPT_ID, isDocumentationHandoffJson, parseDocumentationHandoff, readHandoffScript } from "../../public/documentation-handoff.js";
import { redactText } from "../cognitive/source-intake.js";

function handoffError(message) {
  return Object.assign(new Error(message), { statusCode: 422, failureCode: "DOCUMENTATION_HANDOFF_INVALID" });
}

function readFromSource(source) {
  if (!["HTML", "TEXT"].includes(source.format)) return null;
  const isJson = source.mimeType === "application/json";
  if (!isJson && source.format !== "HTML") return null;
  let content = source.content;
  if (source.encoding === "base64") {
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(content) || content.length % 4) return null;
    content = Buffer.from(content, "base64").toString("utf8");
  }
  if (isJson) return isDocumentationHandoffJson(content) ? content : null;
  if (!content.includes(HANDOFF_SCRIPT_ID)) return null;
  const nodes = DomUtils.findAll((node) => node.attribs.id === HANDOFF_SCRIPT_ID, parseDocument(content).children);
  if (!nodes.length) return null;
  return readHandoffScript(nodes.map((node) => ({
    tagName: node.name,
    getAttribute: (name) => node.attribs[name],
    hasAttribute: (name) => Object.hasOwn(node.attribs, name),
    textContent: DomUtils.textContent(node)
  })));
}

function screened(value) {
  if (typeof value === "string") return redactText(value).text;
  if (Array.isArray(value)) return value.map(screened);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, screened(item)]));
  return value;
}

export async function splitDocumentationInput(sources, selectedHandoff) {
  const evidenceSources = [];
  const handoffPaths = new Set();
  let handoff = null;
  async function admit(content) {
    if (typeof content !== "string" || Buffer.byteLength(content) > HANDOFF_MAX_BYTES) throw handoffError("Choose a Documentation Support handoff within the 15 MB limit.");
    const parsed = await parseDocumentationHandoff(content, webcrypto.subtle);
    if (handoff && handoff.payloadHash !== parsed.payloadHash) throw handoffError("Multiple different Documentation Support handoffs were selected. Choose one.");
    handoff = { ...screened(parsed), schemaVersion: parsed.schemaVersion, payloadHash: parsed.payloadHash };
  }
  try {
    if (selectedHandoff !== undefined) await admit(selectedHandoff);
    for (const source of sources) {
      const content = readFromSource(source);
      if (content === null) evidenceSources.push(source);
      else {
        await admit(content);
        handoffPaths.add(source.path);
      }
    }
  } catch (error) {
    if (error.statusCode === 422) throw error;
    throw handoffError(error.message);
  }
  return { evidenceSources, handoffPaths, handoff };
}
