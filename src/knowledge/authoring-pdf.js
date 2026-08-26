import PDFDocument from "pdfkit";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const COLORS = { ink: "#15342d", forest: "#123a31", lime: "#c8ef68", muted: "#667a73" };
const array = (value) => Array.isArray(value) ? value : [];
const label = (value) => String(value ?? "").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const contentHash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

function heading(doc, text, level = 1) {
  if (doc.y > 700) doc.addPage();
  doc.moveDown(level === 1 ? 0.7 : 0.35).fillColor(COLORS.ink).font("Helvetica-Bold").fontSize(level === 1 ? 18 : 12).text(text);
  doc.moveDown(0.25);
}

function list(doc, values) {
  for (const value of Array.isArray(values) ? values : values === undefined || values === null ? [] : [values]) {
    if (doc.y > 735) doc.addPage();
    const text = typeof value === "string" ? value : value.tactic_id
      ? `${value.tactic_id}: ${label(value.relationship ?? "Mapped tactic")}`
      : `${value.id ? `${value.id}: ` : ""}${value.question ?? value.text ?? value.title ?? value.description ?? value.item ?? JSON.stringify(value)}`;
    doc.fillColor(COLORS.ink).font("Helvetica").fontSize(9).text(`- ${text}`, { indent: 10, paragraphGap: 3 });
  }
}

function sources(doc, mappings) {
  for (const item of array(mappings)) {
    const source = typeof item === "string" ? { source_id: item } : item;
    const text = `${source.source_id}${source.title ? ` - ${source.title}` : ""}${source.relevant_locator ? ` (${source.relevant_locator})` : ""}`;
    doc.fillColor(COLORS.ink).fontSize(9).text(`- ${text}`, source.official_url ? { link: source.official_url, underline: true, indent: 10 } : { indent: 10 });
    if (source.mapping_rationale) doc.fillColor(COLORS.muted).fontSize(8).text(source.mapping_rationale, { indent: 20, paragraphGap: 3 });
  }
}

function objectValues(doc, value) {
  if (!value) { doc.fillColor(COLORS.muted).fontSize(9).text("Not specified"); return; }
  for (const [key, content] of Object.entries(value)) {
    doc.fillColor(COLORS.ink).font("Helvetica-Bold").fontSize(9).text(`${label(key)}:`);
    if (Array.isArray(content)) list(doc, content);
    else if (content && typeof content === "object") doc.font("Helvetica").fontSize(8).text(JSON.stringify(content, null, 2), { indent: 10 });
    else doc.font("Helvetica").fontSize(9).text(String(content), { indent: 10, paragraphGap: 3 });
  }
}

function header(doc, title, subtitle) {
  doc.rect(0, 0, doc.page.width, 155).fill(COLORS.forest);
  doc.fillColor(COLORS.lime).font("Helvetica-Bold").fontSize(9).text("AI GOVERNANCE KNOWLEDGE BASE", 48, 42);
  doc.fillColor("#ffffff").fontSize(24).text(title, 48, 67, { width: 500 });
  doc.fillColor("#dce8df").font("Helvetica").fontSize(10).text(subtitle, 48, 112, { width: 500 });
  doc.y = 175;
}

function footer(doc) {
  const range = doc.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index++) {
    doc.switchToPage(index);
    doc.fillColor(COLORS.muted).fontSize(8).text(`Generated from canonical JSON - Page ${index + 1} of ${range.count}`, 48, 775, { width: 500, align: "center", lineBreak: false });
  }
}

function objectSection(doc, object) {
  heading(doc, `${object.id} - ${object.title}`);
  doc.fillColor(COLORS.muted).fontSize(9).text(`Version ${object.version} | ${label(object.release_status)} | ${label(object.object_type)}`);
  doc.fontSize(7).text(`Canonical JSON SHA-256: ${contentHash(object)}`);
  if (object.canonical_definition) { heading(doc, "Definition", 2); doc.fillColor(COLORS.ink).fontSize(9).text(object.canonical_definition); }
  if (object.governance_purpose) { heading(doc, "Governance purpose", 2); doc.fontSize(9).text(object.governance_purpose); }
  if (object.distinct_claim) { heading(doc, "Distinct claim", 2); doc.fontSize(9).text(object.distinct_claim); }
  if (object.failure_mechanism) { heading(doc, "Failure mechanism", 2); doc.fontSize(9).text(object.failure_mechanism); }
  if (object.potential_consequences) { heading(doc, "Potential consequences", 2); list(doc, object.potential_consequences); }
  heading(doc, "Applicability", 2); list(doc, object.applicability?.conditions ?? []);
  heading(doc, "Lifecycle stages", 2); doc.fontSize(9).text(array(object.lifecycle_stages).map(label).join(" | "));
  heading(doc, "Primary questions", 2); list(doc, object.primary_questions);
  heading(doc, object.object_type === "CAPABILITY" ? "Atomic subcriteria" : "Atomic tests", 2); list(doc, object.atomic_subcriteria ?? object.atomic_tests);
  heading(doc, "Required evidence", 2); list(doc, object.required_evidence);
  heading(doc, "Indicators", 2); list(doc, object.capability_indicators ?? object.antipattern_indicators);
  heading(doc, "Evidence rules", 2); objectValues(doc, object.evidence_rules);
  if (object.absence_test_contract) { heading(doc, "Tested-absent contract", 2); objectValues(doc, object.absence_test_contract); }
  if (object.validation_questions) { heading(doc, "Validation questions", 2); list(doc, object.validation_questions); }
  if (object.detection_heuristics) { heading(doc, "Detection heuristics", 2); list(doc, object.detection_heuristics); }
  if (object.target_assurance_by_lifecycle_stage) { heading(doc, "Lifecycle assurance targets", 2); list(doc, object.target_assurance_by_lifecycle_stage); }
  heading(doc, "Severity and human authority", 2); doc.fontSize(9).text(`${object.runtime_severity ?? object.severity} | ${object.human_decision_authority ?? "Not specified"}`);
  heading(doc, "Hard-gate effect", 2); objectValues(doc, object.hard_gate_effect);
  heading(doc, "Finding definitions", 2); list(doc, object.finding_definitions);
  heading(doc, "Candidate tactic references", 2); list(doc, object.candidate_tactic_refs);
  heading(doc, "Normative mappings", 2); sources(doc, object.normative_source_mappings);
}

function makeDocument(outputFile, render) {
  return new Promise(async (resolve, reject) => {
    await mkdir(path.dirname(outputFile), { recursive: true });
    const doc = new PDFDocument({ size: "A4", margins: { top: 48, bottom: 48, left: 48, right: 48 }, bufferPages: true, info: { Title: path.basename(outputFile) } });
    const stream = createWriteStream(outputFile);
    stream.on("finish", () => resolve(outputFile)); stream.on("error", reject); doc.on("error", reject); doc.pipe(stream);
    render(doc); footer(doc); doc.end();
  });
}

export function renderCategoryPairPdf(capability, antipattern, outputFile) {
  if (!capability || !antipattern) throw new Error("A complete capability and anti-pattern pair is required");
  return makeDocument(outputFile, (doc) => { header(doc, `${capability.id} + ${antipattern.id}`, "Capability and paired anti-pattern - generated human-readable view"); objectSection(doc, capability); doc.addPage(); objectSection(doc, antipattern); });
}

export function renderTacticPlaybookPdf(catalog, outputFile) {
  return makeDocument(outputFile, (doc) => {
    header(doc, catalog.title ?? "Governance Tactic Playbook", `Version ${catalog.version} | ${label(catalog.release_status)}`);
    doc.fillColor(COLORS.muted).fontSize(7).text(`Canonical JSON SHA-256: ${contentHash(catalog)}`);
    for (const tactic of array(catalog.tactics)) {
      heading(doc, `${tactic.id} - ${tactic.title}`);
      doc.fillColor(COLORS.muted).fontSize(8).text(`${label(tactic.release_status)} definition | Exact finding mapping: ${label(tactic.activation_mapping_status)}`);
      heading(doc, "Primary object / mapping", 2); doc.fillColor(COLORS.ink).fontSize(9).text(tactic.primary_mapping_text ?? array(tactic.primary_object_mappings).join(", "));
      heading(doc, "Function", 2); doc.fillColor(COLORS.ink).fontSize(9).text(tactic.function ?? "Not specified");
      heading(doc, "Control purpose", 2); doc.fillColor(COLORS.ink).fontSize(9).text(tactic.control_purpose ?? tactic.objective ?? "Not specified");
      heading(doc, "Principal outputs", 2); list(doc, tactic.principal_outputs ?? tactic.artifacts);
      heading(doc, "Reassessment", 2); doc.fillColor(COLORS.ink).fontSize(9).text(tactic.reassessment_text ?? array(tactic.reassessment_targets).join(", "));
      heading(doc, "Assessment mappings", 2); objectValues(doc, tactic.assessment_mappings);
      for (const [title, field] of [["Eligible findings", "eligible_finding_ids"], ["Trigger states", "trigger_states"], ["Prerequisite tactics", "prerequisite_tactic_ids"], ["Owners", "owners"], ["Use when", "use_when"], ["Activities", "activities"], ["Required artifacts", "artifacts"], ["Acceptance criteria", "acceptance_criteria"], ["Independent verification", "verification"], ["Risks", "risks"], ["Do not use when", "do_not_use_when"], ["Reassessment targets", "reassessment_targets"], ["Completion effect", "completion_effect"]]) { heading(doc, title, 2); list(doc, tactic[field]); }
      doc.moveDown(0.5);
    }
  });
}
