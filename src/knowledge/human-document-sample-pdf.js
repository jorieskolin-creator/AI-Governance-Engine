import PDFDocument from "pdfkit";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const COLORS = {
  ink: "#0E1B2C",
  ink2: "#1F2D3F",
  muted: "#4A5668",
  forest: "#123A31",
  lime: "#C8EF68",
  paper: "#F7F5F0",
  card: "#FDFCF8",
  rule: "#C9C2B5",
  schema: "#395A7F",
  engine: "#2D5F4E",
  publication: "#8C6D2F",
  accent: "#B5472D"
};

const SCHEMA_VERSION = "2.1.0";
const array = (value) => Array.isArray(value) ? value : [];
const label = (value) => String(value ?? "").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const contentWidth = (doc) => doc.page.width - doc.page.margins.left - doc.page.margins.right;

function ensureSpace(doc, needed = 72) {
  const bottom = doc.page.height - doc.page.margins.bottom - 28;
  if (doc.y + needed > bottom) doc.addPage();
}

function wrapJson(value) {
  return JSON.stringify(value, null, 2);
}

export function compiledRequirementSample(capability) {
  return {
    id: `REQ-${capability.id}`,
    domain: capability.domain,
    title: capability.title,
    authority: capability.runtime_authority,
    applicability: capability.runtime_applicability,
    interpretation: capability.canonical_definition,
    humanAuthority: capability.human_decision_authority,
    authoringObjectId: capability.id,
    authoringVersion: capability.version,
    governancePurpose: capability.governance_purpose,
    findingDefinitions: capability.finding_definitions
  };
}

export function compiledControlSample(capability) {
  const targetStateByLifecycle = Object.fromEntries(array(capability.target_assurance_by_lifecycle_stage).map((item) => [
    item.lifecycle_stage,
    item.required_human_assurance === "NOT_REQUIRED" ? item.minimum_technical_assurance : item.required_human_assurance
  ]));
  return {
    id: `CTRL-${capability.id}`,
    domain: capability.domain,
    title: capability.title,
    requirementIds: [`REQ-${capability.id}`],
    severity: capability.runtime_severity,
    signals: capability.runtime_signals,
    authoringObjectId: capability.id,
    pairedObjectId: capability.paired_object_id,
    questions: capability.primary_questions,
    atomicSubcriteria: capability.atomic_subcriteria,
    indicators: capability.capability_indicators,
    requiredEvidence: capability.required_evidence,
    evidenceRules: capability.evidence_rules,
    falsePositiveGuards: capability.evidence_rules?.false_positive_guards,
    prohibitedInferences: capability.evidence_rules?.prohibited_inferences,
    findingDefinitions: capability.finding_definitions,
    hardGateEffect: capability.hard_gate_effect,
    targetStateByLifecycle,
    candidateTacticRefs: capability.candidate_tactic_refs
  };
}

export function compiledAntipatternSample(antipattern) {
  return {
    id: antipattern.id,
    domain: antipattern.domain,
    title: antipattern.title,
    severity: antipattern.runtime_severity,
    signal: antipattern.runtime_signals?.[0],
    signals: antipattern.runtime_signals,
    relatedControlIds: [`CTRL-${antipattern.paired_object_id}`],
    pairedObjectId: antipattern.paired_object_id,
    failureMechanism: antipattern.failure_mechanism,
    consequences: antipattern.potential_consequences,
    atomicTests: antipattern.atomic_tests,
    indicators: antipattern.antipattern_indicators,
    absenceTestContract: antipattern.absence_test_contract,
    evidenceRules: antipattern.evidence_rules,
    findingDefinitions: antipattern.finding_definitions,
    hardGateEffect: antipattern.hard_gate_effect
  };
}

const DOCUMENT_SECTIONS = [
  { human: "Package / release identity", schema: "id, version, schema_version, release_status, domain, object_type, paired_object_id", engine: "Loaded as authoring identity on REQ-/CTRL- entries; release status is a knowledge-snapshot diagnostic", kind: "SCHEMA" },
  { human: "Cognitive framing", schema: "distinct_claim, failure_mechanism, primary_questions.dimension", engine: "failureMechanism is copied onto the runtime anti-pattern. distinct_claim is authoring-only today", kind: "MIXED" },
  { human: "1. Governance ownership and boundary", schema: "title, canonical_definition, governance_purpose, applicability, runtime_applicability, runtime_authority, runtime_severity, runtime_signals, lifecycle_stages", engine: "requirements.interpretation / governancePurpose; controls.severity, signals, lifecycleStages, applicability", kind: "ENGINE" },
  { human: "2. Primary questions", schema: "primary_questions[3] with fixed dimensions Q1-Q3", engine: "controls.questions. Coverage matrix enumerates each question ID", kind: "ENGINE" },
  { human: "3. Atomic assessment logic", schema: "atomic_subcriteria (capability) or atomic_tests (anti-pattern)", engine: "controls.atomicSubcriteria or antipatterns.atomicTests. Finding lock and coverage use these IDs", kind: "ENGINE" },
  { human: "4. Evidence requirements", schema: "required_evidence[] {id, title, description, minimum_technical_assurance, required_human_assurance}", engine: "controls.requiredEvidence only. Anti-pattern required_evidence stays on the authoring object; atomic_tests keep required_evidence_ids, but the compiler does not emit antipatterns.requiredEvidence", kind: "MIXED" },
  { human: "5. Evidence discipline", schema: "evidence_rules.sufficiency, evidence_ceiling, false_positive_guards, prohibited_inferences", engine: "controls.evidenceRules plus flattened falsePositiveGuards and prohibitedInferences", kind: "ENGINE" },
  { human: "6. Findings and gate effects", schema: "finding_definitions[], hard_gate_effect, human_decision_authority", engine: "findingDefinitions on REQ/CTRL/AP objects; hardGateEffect. Locked findings must cite a published finding ID", kind: "ENGINE" },
  { human: "7. Tested-absence contract", schema: "absence_test_contract (anti-pattern only)", engine: "antipatterns.absenceTestContract. TESTED_ABSENT is not inferred from silence", kind: "ENGINE" },
  { human: "8. Lifecycle assurance targets", schema: "target_assurance_by_lifecycle_stage[]", engine: "minimumTechnicalAssuranceByLifecycle, requiredHumanAssuranceByLifecycle, targetStateByLifecycle", kind: "ENGINE" },
  { human: "9. Normative source mappings", schema: "normative_source_mappings[] resolved against the source register", engine: "requirements.normativeMappings and the normativeSources collection. Links are provenance, not legal conclusions", kind: "ENGINE" },
  { human: "10. Approved tactic mappings", schema: "candidate_tactic_refs[] plus Playbook Primary object / mapping", engine: "Playbook tactics retrieve only after a locked finding carries A1-F5 / AP-A1-AP-F5", kind: "ENGINE" },
  { human: "11. Runtime decision boundary", schema: "Not a schema 2.1.0 object. Encode machine limits in evidence_rules and hard_gate_effect", engine: "The Engine already forbids models from raising assurance, clearing gates or issuing formal approval", kind: "PUBLICATION" },
  { human: "12. Approval record", schema: "approval_record {approved_by_role, approved_on, approval_scope, approved_version, supersedes_version}", engine: "Required before release_status APPROVED or FROZEN. Snapshot diagnostics expose release status", kind: "SCHEMA" }
];

function chip(doc, kind, text) {
  const palette = {
    SCHEMA: { fill: "#E8EEF5", stroke: COLORS.schema, ink: COLORS.schema },
    ENGINE: { fill: "#E7F3EE", stroke: COLORS.engine, ink: COLORS.engine },
    PUBLICATION: { fill: "#F6F0E2", stroke: COLORS.publication, ink: COLORS.publication },
    MIXED: { fill: "#F7EDE8", stroke: COLORS.accent, ink: COLORS.accent }
  }[kind] ?? { fill: "#F3F1EB", stroke: COLORS.rule, ink: COLORS.muted };
  const labelText = text ?? kind;
  const width = Math.min(128, 18 + labelText.length * 5.4);
  const x = doc.x;
  const y = doc.y;
  doc.save();
  doc.roundedRect(x, y, width, 14, 7).fillAndStroke(palette.fill, palette.stroke);
  doc.fillColor(palette.ink).font("Helvetica-Bold").fontSize(7).text(labelText, x, y + 3.5, { width, align: "center" });
  doc.restore();
  doc.x = x + width + 6;
  doc.y = y;
}

function chipsRow(doc, kinds) {
  ensureSpace(doc, 22);
  const startY = doc.y;
  const startX = doc.page.margins.left;
  doc.x = startX;
  doc.y = startY;
  for (const kind of kinds) {
    chip(doc, kind, kind);
  }
  doc.x = startX;
  doc.y = startY + 20;
}

function heading(doc, text, level = 1) {
  ensureSpace(doc, level === 1 ? 56 : 36);
  if (level === 1) {
    doc.moveDown(0.35);
    const kicker = /^(A1|AP-A1|What the Engine)/.test(text) ? "OBJECT / RUNTIME" : "SECTION";
    doc.fillColor(COLORS.accent).font("Helvetica-Bold").fontSize(8).text(kicker);
    doc.fillColor(COLORS.ink).font("Helvetica-Bold").fontSize(16).text(text, { width: contentWidth(doc) });
  } else {
    doc.moveDown(0.2);
    doc.fillColor(COLORS.forest).font("Helvetica-Bold").fontSize(11).text(text, { width: contentWidth(doc) });
  }
  doc.moveDown(0.15);
}

function body(doc, text) {
  ensureSpace(doc, 28);
  doc.fillColor(COLORS.ink2).font("Helvetica").fontSize(9.5).text(text, { width: contentWidth(doc), lineGap: 2, paragraphGap: 6 });
}

function bullets(doc, values) {
  for (const value of array(values)) {
    ensureSpace(doc, 20);
    doc.fillColor(COLORS.ink2).font("Helvetica").fontSize(9).text(`- ${value}`, { width: contentWidth(doc), indent: 8, paragraphGap: 3 });
  }
}

function callout(doc, kind, title, text) {
  const width = contentWidth(doc);
  const x = doc.page.margins.left;
  const color = kind === "ENGINE" ? COLORS.engine : kind === "SCHEMA" ? COLORS.schema : COLORS.publication;
  const fill = kind === "ENGINE" ? "#F4FAF7" : kind === "SCHEMA" ? "#F5F8FB" : "#FBF7EE";
  const titleHeight = doc.font("Helvetica-Bold").fontSize(8).heightOfString(title, { width: width - 22 });
  const bodyHeight = doc.font("Helvetica").fontSize(8.5).heightOfString(text, { width: width - 22, lineGap: 1.5 });
  const height = 16 + titleHeight + bodyHeight + 10;
  ensureSpace(doc, height + 8);
  const y = doc.y;
  doc.save();
  doc.roundedRect(x, y, width, height, 5).fill(fill);
  doc.rect(x, y, 4, height).fill(color);
  doc.restore();
  doc.fillColor(color).font("Helvetica-Bold").fontSize(8).text(title, x + 12, y + 8, { width: width - 22 });
  doc.fillColor(COLORS.ink2).font("Helvetica").fontSize(8.5).text(text, x + 12, y + 12 + titleHeight, { width: width - 22, lineGap: 1.5 });
  doc.y = y + height + 8;
  doc.x = x;
}

function kvTable(doc, rows) {
  const width = contentWidth(doc);
  const labelW = 148;
  const valueW = width - labelW;
  for (const [field, value] of rows) {
    const text = value == null || value === "" ? "—" : String(value);
    const valueHeight = doc.heightOfString(text, { width: valueW - 16, font: "Helvetica", size: 8.5 });
    const rowHeight = Math.max(22, valueHeight + 12);
    ensureSpace(doc, rowHeight + 4);
    const x = doc.page.margins.left;
    const y = doc.y;
    doc.save();
    doc.rect(x, y, width, rowHeight).strokeColor(COLORS.rule).lineWidth(0.6).stroke();
    doc.rect(x, y, labelW, rowHeight).fillAndStroke("#F4F1EA", COLORS.rule);
    doc.restore();
    doc.fillColor(COLORS.muted).font("Helvetica-Bold").fontSize(7.5).text(field, x + 8, y + 7, { width: labelW - 14 });
    doc.fillColor(COLORS.ink).font("Helvetica").fontSize(8.5).text(text, x + labelW + 8, y + 6, { width: valueW - 16 });
    doc.y = y + rowHeight;
    doc.x = x;
  }
  doc.moveDown(0.35);
}

function jsonBlock(doc, title, value) {
  const text = wrapJson(value);
  const width = contentWidth(doc);
  const textHeight = doc.font("Courier").fontSize(7).heightOfString(text, { width: width - 16 });
  const height = Math.min(280, textHeight + 28);
  ensureSpace(doc, Math.min(height + 24, 160));
  doc.fillColor(COLORS.forest).font("Helvetica-Bold").fontSize(8).text(title, { width });
  const x = doc.page.margins.left;
  const y = doc.y + 4;
  const available = doc.page.height - doc.page.margins.bottom - 36 - y;
  const boxHeight = Math.min(available, height);
  doc.save();
  doc.roundedRect(x, y, width, boxHeight, 6).fill("#F4F7F5");
  doc.roundedRect(x, y, width, boxHeight, 6).strokeColor(COLORS.rule).lineWidth(0.6).stroke();
  doc.restore();
  doc.fillColor(COLORS.ink2).font("Courier").fontSize(7).text(text, x + 8, y + 8, { width: width - 16, height: boxHeight - 14 });
  doc.y = y + boxHeight + 10;
  doc.x = x;
}

function sectionMeta(doc, schemaFields, engineUse, kinds = ["SCHEMA", "ENGINE"]) {
  chipsRow(doc, kinds);
  callout(doc, "SCHEMA", "Canonical JSON", schemaFields);
  callout(doc, "ENGINE", "What the Engine loads after compile", engineUse);
}

function header(doc, title, subtitle) {
  doc.rect(0, 0, doc.page.width, 148).fill(COLORS.forest);
  doc.fillColor(COLORS.lime).font("Helvetica-Bold").fontSize(8).text("AI GOVERNANCE ENGINE  /  KNOWLEDGE BASE SAMPLE", 48, 36);
  doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(20).text(title, 48, 58, { width: 500 });
  doc.fillColor("#DCE8DF").font("Helvetica").fontSize(10).text(subtitle, 48, 108, { width: 500 });
  doc.y = 168;
}

function paintRunningHeader(doc, pageIndex, pageCount, capability, antipattern) {
  if (pageIndex === 0) return;
  doc.switchToPage(pageIndex);
  doc.save();
  doc.fillColor(COLORS.muted).font("Helvetica").fontSize(7.5)
    .text("AI GOVERNANCE ENGINE / KNOWLEDGE BASE SAMPLE", 48, 28, { width: 320, lineBreak: false })
    .text(`${capability.id} / ${antipattern.id}  |  schema ${SCHEMA_VERSION}`, 48, 28, { width: contentWidth(doc), align: "right", lineBreak: false });
  doc.moveTo(48, 42).lineTo(doc.page.width - 48, 42).strokeColor(COLORS.rule).lineWidth(0.6).stroke();
  doc.fillColor(COLORS.muted).fontSize(8)
    .text(`Generated view of canonical JSON  ·  Page ${pageIndex + 1} of ${pageCount}`, 48, 780, { width: contentWidth(doc), align: "center", lineBreak: false });
  doc.restore();
}

function coverFacts(capability, antipattern) {
  return [
    ["Capability", `${capability.id} — ${capability.title}`],
    ["Anti-pattern", `${antipattern.id} — ${antipattern.title}`],
    ["Canonical schema", `AI Governance schema ${SCHEMA_VERSION}`],
    ["Authoring objects", "knowledge-authoring/example/A1_v1.0.json and AP-A1_v1.0.json"],
    ["Release status in sample", `${capability.release_status} (structurally complete example, not a production activation)`],
    ["Engine collections", "normativeSources, requirements, controls, antipatterns, tactics, intakeQuestionnaire"],
    ["Authority", "Canonical JSON is authoritative. This PDF is a generated view for authors."]
  ];
}

function renderCover(doc, capability, antipattern) {
  header(doc, "Human-readable Knowledge Base document", "Sample structure and Engine JSON translation for category authors");
  body(doc, "Use this sample when writing the human-readable category PDF. The section order follows the A1 / AP-A1 publication pattern. Every controlled section must be generated from schema 2.1.0 JSON. The Engine never reads the PDF; it compiles the JSON into six runtime collections and hash-pins them in a knowledge manifest.");
  chipsRow(doc, ["SCHEMA", "ENGINE", "PUBLICATION"]);
  doc.fillColor(COLORS.muted).font("Helvetica").fontSize(8).text("SCHEMA = required or optional canonical JSON field.  ENGINE = compiled runtime key the Engine consumes.  PUBLICATION = human-review prose that is not a schema 2.1.0 object unless you encode it in a listed field.", { width: contentWidth(doc), paragraphGap: 10 });
  kvTable(doc, coverFacts(capability, antipattern));
  callout(doc, "PUBLICATION", "Authority boundary", "No model output may raise assurance, clear a hard gate, accept residual risk, define legal compliance or authorize a lifecycle transition. Missing or conflicting evidence remains UNKNOWN. Silence never establishes anti-pattern absence.");
}

function renderGuide(doc) {
  heading(doc, "How authors should use this sample");
  body(doc, "Produce one capability JSON object and one paired anti-pattern JSON object per category. Validate against schemas/capability.schema.json and schemas/antipattern.schema.json, then render the human PDF from those objects. Compile only after the pair, Tactic Catalog mappings and source register pass. Upload the compiled JSON, not this PDF, to the Engine knowledge manifest.");
  bullets(doc, [
    "Keep IDs stable: A1 / AP-A1, A1-Q1, A1-SC-001, EVD-A1-001, FND-A1-001, TAC-PURPOSE-A1-01.",
    "Primary questions are exactly three, in order: DEFINITION_AND_INTENT, IMPLEMENTATION_AND_OPERATION, EVIDENCE_AND_EFFECTIVENESS.",
    "Atomic items must cite required_evidence_ids that exist on the same object.",
    "APPROVED or FROZEN objects require an approval_record. The sample pair is DRAFT, so approval_record is null.",
    "Tactic retrieval is owned by the Playbook Primary object / mapping. candidate_tactic_refs must not invent unmapped tactic IDs."
  ]);
  heading(doc, "Document skeleton", 2);
  body(doc, "The human PDF uses a fixed outline so reviewers can compare categories. The Engine does not parse these headings. It consumes the JSON fields named in the SCHEMA column after compile.");
  for (const section of DOCUMENT_SECTIONS) {
    ensureSpace(doc, 52);
    doc.fillColor(COLORS.ink).font("Helvetica-Bold").fontSize(10).text(section.human, { width: contentWidth(doc) });
    chipsRow(doc, section.kind === "MIXED" ? ["SCHEMA", "ENGINE", "PUBLICATION"] : section.kind === "ENGINE" ? ["SCHEMA", "ENGINE"] : [section.kind]);
    doc.fillColor(COLORS.schema).font("Helvetica-Bold").fontSize(7.5).text("JSON");
    doc.fillColor(COLORS.ink2).font("Helvetica").fontSize(8.5).text(section.schema, { width: contentWidth(doc), paragraphGap: 3 });
    doc.fillColor(COLORS.engine).font("Helvetica-Bold").fontSize(7.5).text("ENGINE");
    doc.fillColor(COLORS.ink2).font("Helvetica").fontSize(8.5).text(section.engine, { width: contentWidth(doc), paragraphGap: 8 });
  }
}

function renderCapability(doc, capability) {
  heading(doc, `${capability.id} — ${capability.title}`);
  doc.fillColor(COLORS.muted).font("Helvetica").fontSize(8.5).text(`Version ${capability.version}  |  ${capability.release_status}  |  ${capability.object_type}  |  paired ${capability.paired_object_id}`);
  doc.moveDown(0.3);
  heading(doc, "Canonical definition", 2);
  body(doc, capability.canonical_definition);

  heading(doc, "1. Governance ownership and boundary", 2);
  sectionMeta(
    doc,
    "governance_purpose, distinct_claim, applicability.default_state, applicability.conditions, runtime_applicability, runtime_authority, runtime_severity, runtime_signals, lifecycle_stages, paired_object_id",
    "Compiled onto requirements (interpretation, governancePurpose, humanAuthority, applicability) and controls (severity, signals, lifecycleStages, pairedObjectId). runtime_signals become lexical indicators only; they cannot independently establish IMPLEMENTED."
  );
  kvTable(doc, [
    ["governance_purpose", capability.governance_purpose],
    ["distinct_claim", capability.distinct_claim],
    ["applicability.default_state", capability.applicability?.default_state],
    ["runtime_applicability", capability.runtime_applicability],
    ["runtime_authority", capability.runtime_authority],
    ["runtime_severity", capability.runtime_severity],
    ["runtime_signals", array(capability.runtime_signals).join(", ")],
    ["paired_object_id", capability.paired_object_id],
    ["human_decision_authority", capability.human_decision_authority]
  ]);
  heading(doc, "applicability.conditions", 2);
  bullets(doc, capability.applicability?.conditions);
  heading(doc, "lifecycle_stages", 2);
  body(doc, array(capability.lifecycle_stages).map(label).join("  |  "));
  callout(doc, "PUBLICATION", "Optional publication prose", "Exclusions and reassessment-trigger lists in the long-form A1 PDF are reviewer aids. Encode anything the Engine must enforce in applicability.conditions, evidence_rules, hard_gate_effect or finding_definitions.");

  heading(doc, "2. Primary questions", 2);
  sectionMeta(
    doc,
    "primary_questions: exactly three objects {id, dimension, question}. Dimensions are fixed as A1-Q1 DEFINITION_AND_INTENT, A1-Q2 IMPLEMENTATION_AND_OPERATION, A1-Q3 EVIDENCE_AND_EFFECTIVENESS.",
    "Copied to controls.questions. Cognitive coverage enumerates each question ID. The Engine assesses the loaded instrument even before evidence rules are published; atomic IDs and finding IDs are what make locked findings precise."
  );
  kvTable(doc, capability.primary_questions.map((item) => [item.id, `${label(item.dimension)} — ${item.question}`]));

  heading(doc, "3. Atomic assessment logic", 2);
  sectionMeta(
    doc,
    "atomic_subcriteria[] {id, question_id, criterion, required_evidence_ids, minimum_technical_assurance, required_human_assurance}. IDs match ^[A-F][1-5]-SC-[0-9]{3}$.",
    "Copied to controls.atomicSubcriteria. Coverage and claim mapping treat these as assessment objects under the parent capability."
  );
  for (const item of array(capability.atomic_subcriteria)) {
    heading(doc, `${item.id}  |  ${item.question_id}`, 2);
    body(doc, item.criterion);
    kvTable(doc, [
      ["required_evidence_ids", array(item.required_evidence_ids).join(", ")],
      ["minimum_technical_assurance", item.minimum_technical_assurance],
      ["required_human_assurance", item.required_human_assurance]
    ]);
  }

  heading(doc, "4. Evidence requirements", 2);
  sectionMeta(
    doc,
    "required_evidence[] {id, title, description, minimum_technical_assurance, required_human_assurance}. Evidence IDs match ^EVD-(?:AP-)?[A-F][1-5]-[0-9]{3}$.",
    "Copied to controls.requiredEvidence. Schema 2.1.0 does not include evidence class, acceptance conditions or limitations; put those constraints in description and evidence_rules or they stay publication-only."
  );
  for (const item of array(capability.required_evidence)) {
    heading(doc, `${item.id} — ${item.title}`, 2);
    body(doc, item.description);
    kvTable(doc, [
      ["minimum_technical_assurance", item.minimum_technical_assurance],
      ["required_human_assurance", item.required_human_assurance]
    ]);
  }
  heading(doc, "capability_indicators", 2);
  bullets(doc, capability.capability_indicators);

  heading(doc, "5. Evidence discipline", 2);
  sectionMeta(
    doc,
    "evidence_rules {sufficiency[], evidence_ceiling, false_positive_guards[], prohibited_inferences[]}",
    "Copied as controls.evidenceRules. The compiler also flattens falsePositiveGuards and prohibitedInferences onto the control for deterministic assessment."
  );
  kvTable(doc, [["evidence_ceiling", capability.evidence_rules?.evidence_ceiling]]);
  heading(doc, "sufficiency", 2);
  bullets(doc, capability.evidence_rules?.sufficiency);
  heading(doc, "false_positive_guards", 2);
  bullets(doc, capability.evidence_rules?.false_positive_guards);
  heading(doc, "prohibited_inferences", 2);
  bullets(doc, capability.evidence_rules?.prohibited_inferences);

  heading(doc, "6. Findings and gate effects", 2);
  sectionMeta(
    doc,
    "finding_definitions[] {id, assessment_object_id, title, eligible_states, severity, human_decision_authority}; hard_gate_effect {effect, conditions, override_authority}",
    "Copied to controls.findingDefinitions and controls.hardGateEffect, and also onto the paired requirement. A locked cognitive finding must reference a published finding ID such as FND-A1-001 before Playbook tactics retrieve."
  );
  kvTable(doc, [
    ["hard_gate_effect.effect", capability.hard_gate_effect?.effect],
    ["override_authority", capability.hard_gate_effect?.override_authority]
  ]);
  bullets(doc, capability.hard_gate_effect?.conditions);
  for (const item of array(capability.finding_definitions)) {
    heading(doc, `${item.id} — ${item.title}`, 2);
    kvTable(doc, [
      ["assessment_object_id", item.assessment_object_id],
      ["eligible_states", array(item.eligible_states).join(", ")],
      ["severity", item.severity],
      ["human_decision_authority", item.human_decision_authority]
    ]);
  }
  callout(doc, "PUBLICATION", "Richer finding tables in long-form PDFs", "Atomic-item lists, linked evidence IDs, lifecycle consequence and human-lock flags appear in some publication PDFs. Schema 2.1.0 findings do not have those properties. Keep extra reviewer text in the PDF; keep Engine-actionable identity in finding_definitions.");

  heading(doc, "8. Lifecycle assurance targets", 2);
  sectionMeta(
    doc,
    "target_assurance_by_lifecycle_stage[] {lifecycle_stage, minimum_technical_assurance, required_human_assurance}",
    "Compiler splits these into minimumTechnicalAssuranceByLifecycle, requiredHumanAssuranceByLifecycle and a combined targetStateByLifecycle. Control assessment uses the target for the requested transition."
  );
  kvTable(doc, array(capability.target_assurance_by_lifecycle_stage).map((item) => [
    label(item.lifecycle_stage),
    `${item.minimum_technical_assurance} technical  /  ${item.required_human_assurance} human`
  ]));

  heading(doc, "9. Normative source mappings", 2);
  sectionMeta(
    doc,
    "normative_source_mappings[] {source_id, relevant_locator, mapping_rationale, last_verified_on} plus a register entry for that source_id",
    "Copied to requirements.normativeMappings. The Engine treats official locators as provenance. They do not decide legal applicability."
  );
  for (const item of array(capability.normative_source_mappings)) {
    kvTable(doc, [
      ["source_id", item.source_id],
      ["relevant_locator", item.relevant_locator],
      ["mapping_rationale", item.mapping_rationale],
      ["last_verified_on", item.last_verified_on]
    ]);
  }

  heading(doc, "10. Approved tactic mappings", 2);
  sectionMeta(
    doc,
    "candidate_tactic_refs[] {tactic_id, tactic_version, relationship, mapping_status}. tactic_id must match TAC-(PURPOSE|DATA|MODELS|ARCHITECTURE|HUMAN|ACCOUNTABILITY)-(AP-)?[A-F][1-5]-[0-9]{2}",
    "Playbook retrieval is driven by locked finding object IDs and the catalog Primary object / mapping, not by free-text similarity. Empty candidate_tactic_refs is valid; the catalog still maps TAC-PURPOSE-A1-01 to A1 / AP-A1."
  );
  if (array(capability.candidate_tactic_refs).length) {
    kvTable(doc, capability.candidate_tactic_refs.map((item) => [item.tactic_id, `${item.relationship}  |  ${item.mapping_status}  |  ${item.tactic_version}`]));
  } else {
    body(doc, "This sample leaves candidate_tactic_refs empty. Production objects may list approved refs that already exist as Primary object / mapping rows in the Tactic Catalog.");
  }

  heading(doc, "11. Runtime decision boundary", 2);
  chipsRow(doc, ["PUBLICATION"]);
  callout(doc, "PUBLICATION", "Not a schema object", "The long-form publication states what the machine may extract, must not decide, and which acts remain human. Encode the enforceable part in evidence_rules and hard_gate_effect. The Engine already separates locked findings, hard gates, publication integrity and formal approval.");
  heading(doc, "Machine may", 2);
  bullets(doc, [
    "Extract and compare purpose statements, system behavior, use records and change evidence.",
    "Identify missing, conflicting, stale or scope-mismatched evidence.",
    "Apply deterministic evidence ceilings and propose eligible conclusion states for human lock.",
    "Retrieve exact approved tactic mappings after a finding is locked."
  ]);
  heading(doc, "Machine must not", 2);
  bullets(doc, [
    "Define the organization's purpose or risk appetite.",
    "Treat legal vocabulary as a legal-applicability conclusion.",
    "Raise assurance beyond the evidence ceiling.",
    "Clear the hard gate, accept residual risk, authorize a new use or lifecycle transition.",
    "Change or close a locked finding because a tactic was selected."
  ]);

  heading(doc, "12. Approval record", 2);
  sectionMeta(
    doc,
    "approval_record is null for DRAFT/PILOT. APPROVED/FROZEN require {approved_by_role, approved_on, approval_scope, approved_version}.",
    "Production compilation refuses unapproved objects. Engine diagnostics expose knowledgeBaseStatus and releaseStatus; they do not treat this PDF as approval evidence."
  );
  kvTable(doc, [
    ["release_status", capability.release_status],
    ["approval_record", capability.approval_record == null ? "null" : JSON.stringify(capability.approval_record)]
  ]);
}

function renderAntipattern(doc, antipattern) {
  heading(doc, `${antipattern.id} — ${antipattern.title}`);
  doc.fillColor(COLORS.muted).font("Helvetica").fontSize(8.5).text(`Version ${antipattern.version}  |  ${antipattern.release_status}  |  ${antipattern.object_type}  |  paired ${antipattern.paired_object_id}`);
  doc.moveDown(0.3);
  heading(doc, "Canonical definition", 2);
  body(doc, antipattern.canonical_definition);

  heading(doc, "Failure mechanism and consequences", 2);
  sectionMeta(
    doc,
    "failure_mechanism, potential_consequences[]  (anti-pattern fields; capabilities use governance_purpose / distinct_claim instead)",
    "Copied to antipatterns.failureMechanism and antipatterns.consequences."
  );
  body(doc, antipattern.failure_mechanism);
  bullets(doc, antipattern.potential_consequences);

  heading(doc, "3. Atomic tests", 2);
  sectionMeta(
    doc,
    "atomic_tests[] {id, question_id, test, required_evidence_ids, minimum_technical_assurance, required_human_assurance}. IDs match ^AP-[A-F][1-5]-AT-[0-9]{3}$.",
    "Copied to antipatterns.atomicTests. These are the anti-pattern assessment objects in the coverage matrix."
  );
  for (const item of array(antipattern.atomic_tests)) {
    heading(doc, `${item.id}  |  ${item.question_id}`, 2);
    body(doc, item.test);
    kvTable(doc, [
      ["required_evidence_ids", array(item.required_evidence_ids).join(", ")],
      ["minimum_technical_assurance", item.minimum_technical_assurance],
      ["required_human_assurance", item.required_human_assurance]
    ]);
  }

  heading(doc, "2. Primary questions", 2);
  kvTable(doc, antipattern.primary_questions.map((item) => [item.id, `${label(item.dimension)} — ${item.question}`]));
  callout(doc, "SCHEMA", "Compile note", "Anti-pattern primary_questions are required by schema 2.1.0. The current compiler copies capability questions onto controls.questions; anti-pattern questions remain on the authoring object and should still be written because they are the human and cognitive assessment prompts for AP objects.");

  heading(doc, "4–5. Evidence and discipline", 2);
  callout(doc, "SCHEMA", "Compile note", "Anti-pattern required_evidence is required by schema 2.1.0 so atomic_tests can cite IDs. The compiler does not emit antipatterns.requiredEvidence. Encode Engine-enforceable anti-pattern evidence limits in atomic_tests, evidence_rules and absence_test_contract.");
  for (const item of array(antipattern.required_evidence)) {
    heading(doc, `${item.id} — ${item.title}`, 2);
    body(doc, item.description);
    kvTable(doc, [
      ["minimum_technical_assurance", item.minimum_technical_assurance],
      ["required_human_assurance", item.required_human_assurance]
    ]);
  }
  kvTable(doc, [["evidence_ceiling", antipattern.evidence_rules?.evidence_ceiling]]);
  bullets(doc, antipattern.evidence_rules?.prohibited_inferences);

  heading(doc, "6. Findings and gate effects", 2);
  kvTable(doc, [
    ["hard_gate_effect.effect", antipattern.hard_gate_effect?.effect],
    ["override_authority", antipattern.hard_gate_effect?.override_authority]
  ]);
  bullets(doc, antipattern.hard_gate_effect?.conditions);
  for (const item of array(antipattern.finding_definitions)) {
    heading(doc, `${item.id} — ${item.title}`, 2);
    kvTable(doc, [
      ["eligible_states", array(item.eligible_states).join(", ")],
      ["severity", item.severity]
    ]);
  }

  heading(doc, "7. Tested-absence contract", 2);
  sectionMeta(
    doc,
    "absence_test_contract {scope_defined, executed, successful, current, independently_verified, required_artifacts[]} — all five booleans are const true in schema 2.1.0",
    "Copied to antipatterns.absenceTestContract. The Engine must not promote UNKNOWN or missing incidents to TESTED_ABSENT."
  );
  kvTable(doc, [
    ["scope_defined", String(antipattern.absence_test_contract?.scope_defined)],
    ["executed", String(antipattern.absence_test_contract?.executed)],
    ["successful", String(antipattern.absence_test_contract?.successful)],
    ["current", String(antipattern.absence_test_contract?.current)],
    ["independently_verified", String(antipattern.absence_test_contract?.independently_verified)]
  ]);
  bullets(doc, antipattern.absence_test_contract?.required_artifacts);
}

function renderEngineTranslation(doc, capability, antipattern) {
  heading(doc, "What the Engine actually loads");
  body(doc, "Authoring JSON is compiled into six runtime collections. Production starts only from a hash-verified manifest of those files. The tables below show the compiled shape for this sample pair — the JSON the Engine uses — not the PDF text.");
    jsonBlock(doc, "Compiled requirement excerpt / requirements.json / Engine applicability and interpretation", {
    id: `REQ-${capability.id}`,
    authoringObjectId: capability.id,
    interpretation: capability.canonical_definition,
    governancePurpose: capability.governance_purpose,
    authority: capability.runtime_authority,
    applicability: capability.runtime_applicability,
    humanAuthority: capability.human_decision_authority,
    findingDefinitions: capability.finding_definitions
  });
  jsonBlock(doc, "Compiled control excerpt / controls.json / Engine assessment, coverage, gates, evidence rules", {
    id: `CTRL-${capability.id}`,
    authoringObjectId: capability.id,
    pairedObjectId: capability.paired_object_id,
    severity: capability.runtime_severity,
    signals: capability.runtime_signals,
    questions: capability.primary_questions.map((item) => item.id),
    atomicSubcriteria: capability.atomic_subcriteria.map((item) => item.id),
    requiredEvidence: capability.required_evidence.map((item) => item.id),
    findingDefinitions: capability.finding_definitions.map((item) => item.id),
    hardGateEffect: capability.hard_gate_effect,
    evidenceRules: {
      evidence_ceiling: capability.evidence_rules.evidence_ceiling,
      false_positive_guards: capability.evidence_rules.false_positive_guards,
      prohibited_inferences: capability.evidence_rules.prohibited_inferences
    }
  });
  jsonBlock(doc, "Compiled anti-pattern excerpt / antipatterns.json / Engine anti-pattern state and absence tests", {
    id: antipattern.id,
    pairedObjectId: antipattern.paired_object_id,
    relatedControlIds: [`CTRL-${antipattern.paired_object_id}`],
    signal: antipattern.runtime_signals[0],
    failureMechanism: antipattern.failure_mechanism,
    atomicTests: antipattern.atomic_tests.map((item) => item.id),
    findingDefinitions: antipattern.finding_definitions.map((item) => item.id),
    absenceTestContract: antipattern.absence_test_contract,
    hardGateEffect: antipattern.hard_gate_effect
  });

  heading(doc, "Field path from human document to Engine", 2);
  const rows = [
    ["Human heading", "Canonical JSON", "Runtime collection / Engine use"],
    ["Canonical definition", "canonical_definition", "requirements.interpretation"],
    ["Governance purpose", "governance_purpose", "requirements.governancePurpose"],
    ["Distinct claim", "distinct_claim", "Authoring/review only in current compiler"],
    ["Signals", "runtime_signals", "controls.signals / antipatterns.signals"],
    ["Questions", "primary_questions", "controls.questions; coverage matrix"],
    ["Atomic logic", "atomic_subcriteria / atomic_tests", "controls.atomicSubcriteria / antipatterns.atomicTests"],
    ["Evidence items", "required_evidence", "controls.requiredEvidence; anti-pattern records are authoring-only"],
    ["Discipline", "evidence_rules", "controls.evidenceRules and flattened guards"],
    ["Findings", "finding_definitions", "findingDefinitions; claim lock IDs"],
    ["Hard gate", "hard_gate_effect", "controls.hardGateEffect / antipatterns.hardGateEffect"],
    ["Lifecycle targets", "target_assurance_by_lifecycle_stage", "targetStateByLifecycle used by assessControls"],
    ["Sources", "normative_source_mappings", "requirements.normativeMappings + normativeSources"],
    ["Tactics", "candidate_tactic_refs + Playbook mapping", "selectPlaybookActions after locked findings"],
    ["Absence contract", "absence_test_contract", "antipatterns.absenceTestContract"],
    ["Approval", "approval_record + release_status", "Compile gate and knowledge diagnostics"]
  ];
  const width = contentWidth(doc);
  const cols = [width * 0.28, width * 0.34, width * 0.38];
  for (const [index, row] of rows.entries()) {
    const x = doc.page.margins.left;
    const height = Math.max(26, ...row.map((cell, col) => (
      doc.font(index === 0 || col === 0 ? "Helvetica-Bold" : "Helvetica").fontSize(7).heightOfString(cell, { width: cols[col] - 10 }) + 12
    )));
    ensureSpace(doc, height + 4);
    const y = doc.y;
    doc.save();
    doc.rect(x, y, width, height).fill(index === 0 ? COLORS.forest : index % 2 === 0 ? "#F7F5F0" : "#FFFFFF");
    doc.rect(x, y, width, height).strokeColor(COLORS.rule).lineWidth(0.4).stroke();
    doc.restore();
    let cursor = x + 6;
    row.forEach((cell, col) => {
      doc.fillColor(index === 0 ? "#FFFFFF" : COLORS.ink).font(index === 0 || col === 0 ? "Helvetica-Bold" : "Helvetica").fontSize(7)
        .text(cell, cursor, y + 6, { width: cols[col] - 10, height: height - 8 });
      cursor += cols[col];
    });
    doc.y = y + height;
    doc.x = x;
  }
  doc.moveDown(0.8);

  heading(doc, "Do not send the PDF to the Engine", 2);
  bullets(doc, [
    "The Engine knowledge provider loads hash-verified JSON collections, never category PDFs.",
    "Human PDFs may be stored beside the Blob objects for reviewers; they are absent from the runtime manifest.",
    "If a sentence must change a gate, finding, evidence ceiling or tactic mapping, put it in canonical JSON first, then regenerate the PDF.",
    "Production activation is a separate Engine step after the Maintainer publishes an APPROVED manifest."
  ]);
}

function startMajorSection(doc) {
  const remaining = doc.page.height - doc.page.margins.bottom - doc.y;
  if (remaining < 420) doc.addPage();
  else doc.moveDown(1.1);
}

function makeDocument(outputFile, render, capability, antipattern) {
  return new Promise(async (resolve, reject) => {
    await mkdir(path.dirname(outputFile), { recursive: true });
    const doc = new PDFDocument({
      size: "A4",
      margins: { top: 56, bottom: 48, left: 48, right: 48 },
      bufferPages: true,
      info: {
        Title: "AI Governance Knowledge Base — human-readable document sample",
        Author: "AI Governance Engine",
        Subject: `Schema ${SCHEMA_VERSION} category document structure and Engine JSON translation`
      }
    });
    const stream = createWriteStream(outputFile);
    stream.on("finish", () => resolve(outputFile));
    stream.on("error", reject);
    doc.on("error", reject);
    doc.pipe(stream);
    render(doc);
    const range = doc.bufferedPageRange();
    for (let index = range.start; index < range.start + range.count; index += 1) {
      paintRunningHeader(doc, index, range.count, capability, antipattern);
    }
    doc.end();
  });
}

export function renderHumanDocumentSamplePdf(capability, antipattern, outputFile) {
  if (!capability || !antipattern) throw new Error("A complete capability and anti-pattern pair is required");
  if (capability.schema_version !== SCHEMA_VERSION || antipattern.schema_version !== SCHEMA_VERSION) {
    throw new Error(`Sample PDF requires schema ${SCHEMA_VERSION}`);
  }
  return makeDocument(outputFile, (doc) => {
    renderCover(doc, capability, antipattern);
    doc.addPage();
    renderGuide(doc);
    startMajorSection(doc);
    renderCapability(doc, capability);
    startMajorSection(doc);
    renderAntipattern(doc, antipattern);
    startMajorSection(doc);
    renderEngineTranslation(doc, capability, antipattern);
  }, capability, antipattern);
}
