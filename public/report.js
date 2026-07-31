export const REPORT_VERSION = "assurance-report-1.1.0";

const array = (value) => Array.isArray(value) ? value : [];
const label = (value) => String(value ?? "").replaceAll("_", " ").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;").replaceAll("'", "&#39;");

function solutionName(pkg) {
  return pkg.assessmentIntake?.identity?.name ?? pkg.solution?.name ?? pkg.solution?.declared?.name ?? "AI solution";
}

function displayValue(value) {
  if (value === true) return "Yes";
  if (value === false) return "No";
  if (value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) return "Unknown";
  if (Array.isArray(value)) return value.map((item) => label(item)).join(", ");
  return typeof value === "string" && /^[A-Z][A-Z0-9_]+$/.test(value) ? label(value) : String(value);
}

function shortTrace(item = {}) {
  const values = [...array(item.findingIds), ...array(item.gateIds), ...array(item.controlIds), ...array(item.evidenceIds), ...array(item.ruleIds)];
  if (!values.length) return "Deterministic report rule";
  const visible = values.slice(0, 3);
  return `${visible.join(" · ")}${values.length > 3 ? ` · +${values.length - 3} more in JSON` : ""}`;
}

function status(value) {
  return `<span class="report-status status-${escapeHtml(String(value ?? "unknown").toLowerCase().replaceAll("_", "-"))}">${escapeHtml(label(value ?? "UNKNOWN"))}</span>`;
}

function section(number, eyebrow, title, content) {
  return `<section class="report-section" data-report-section="${escapeHtml(number)}"><header class="report-heading"><p class="report-eyebrow">${escapeHtml(`${number} · ${eyebrow}`)}</p><h2>${escapeHtml(title)}</h2></header>${content}</section>`;
}

function listItems(items, emptyText) {
  if (!items.length) return `<p class="report-empty">${escapeHtml(emptyText)}</p>`;
  return `<div class="report-list">${items.map((item) => `<article class="report-list-item"><p>${escapeHtml(item.text ?? item.statement ?? "")}</p><small class="report-trace">Trace: ${escapeHtml(shortTrace(item.basis ? { ...item, ...item.basis } : item))}</small></article>`).join("")}</div>`;
}

function caseGroup(title, fields) {
  return `<article class="case-group"><h3>${escapeHtml(title)}</h3><dl>${array(fields).map((field) => `<div class="case-row"><dt>${escapeHtml(field.label ?? label(field.field))}</dt><dd><span>${escapeHtml(displayValue(field.value))}</span>${status(field.status ?? "UNKNOWN")}</dd></div>`).join("")}</dl></article>`;
}

function decisionMarkup(pkg, summary) {
  const profile = summary.caseProfile ?? {};
  const owner = array(profile.identityAndIntent).find((item) => item.field === "accountableOwner")?.value;
  const doc = summary.documentationAlignment ?? {};
  const transition = summary.transitionBoundary;
  const heroFacts = [
    ["Accountable owner", displayValue(owner)],
    ["Lifecycle transition", `${label(transition.currentStage)} → ${label(transition.targetStage)}`],
    ["Assessment date", pkg.generatedAt ? new Date(pkg.generatedAt).toISOString().slice(0, 10) : "Unknown"],
    ["Assessment mode", label(summary.assessmentMode)],
    ["Documentation alignment", label(doc.status ?? "UNKNOWN")],
    ["Knowledge status", `${label(pkg.knowledge?.releaseStatus ?? "UNSPECIFIED")} · ${pkg.knowledge?.version ?? "Unknown"}`]
  ];
  const dimensions = [
    ["Indicator coverage", `${summary.dimensions.indicatorCoverage ?? summary.dimensions.evidenceCoverage}%`],
    ["Control assurance", `${summary.dimensions.controlAssurance}%`],
    ["Residual risk", label(summary.dimensions.residualRisk)],
    ["Gate status", label(summary.dimensions.gateStatus)]
  ];
  return `<section class="report-decision-hero" data-report-section="01"><div class="report-decision-top"><div><p class="report-eyebrow report-eyebrow-light">01 · Decision</p><h1>${escapeHtml(solutionName(pkg))}</h1><h2>${escapeHtml(label(summary.decision.outcome))}</h2></div>${status(summary.humanAuthority.formalDecisionStatus)}</div><p class="report-decision-rationale">${escapeHtml(summary.decision.rationale)}</p><div class="hero-case-facts">${heroFacts.map(([name, value]) => `<div><span>${escapeHtml(name)}</span><strong>${escapeHtml(value)}</strong></div>`).join("")}</div><div class="report-metrics">${dimensions.map(([name, value]) => `<div class="report-metric"><span>${escapeHtml(name)}</span><strong>${escapeHtml(value)}</strong></div>`).join("")}</div><p class="report-authority-note">${escapeHtml(summary.humanAuthority.boundary)}</p>${summary.knowledgeNotice ? `<div class="report-pilot-banner">${escapeHtml(summary.knowledgeNotice)}</div>` : ""}</section>`;
}

function caseProfileMarkup(summary) {
  const profile = summary.caseProfile ?? {};
  return section("02", "Case identification", "Case Profile and Assessment Scope", `<div class="case-grid">${caseGroup("Identity and intent", profile.identityAndIntent)}${caseGroup("Assessment scope", profile.assessmentScope)}${caseGroup("Declared operating boundary", profile.operatingBoundary)}${caseGroup("Risk-relevant declarations", profile.riskDeclarations)}</div>`);
}

function documentationMarkup(summary) {
  const doc = summary.documentationAlignment ?? {};
  const unknown = array(doc.unknownFields);
  const conflicts = array(doc.conflictingFields);
  const declaredOnly = array(doc.userDeclaredOnlyFields);
  const metrics = [
    ["Overall status", label(doc.status ?? "UNKNOWN")],
    ["Satisfied applicable fields", `${doc.satisfiedFieldCount ?? doc.documentedAndConfirmedCount ?? 0} / ${doc.mandatoryFieldCount ?? 0}`],
    ["Documentation-to-code alignment", label(doc.documentationToCodeAlignment ?? "UNKNOWN")],
    ["Deployment ready", doc.deploymentReady === true ? "Yes" : "No"]
  ];
  const issues = [
    ["Unknown fields", unknown], ["User-declared only", declaredOnly], ["Contradictions", conflicts]
  ];
  return section("03", "Documentation gate", "Documentation Alignment", `<div class="documentation-summary">${metrics.map(([name, value]) => `<div><span>${escapeHtml(name)}</span><strong>${escapeHtml(value)}</strong></div>`).join("")}</div><div class="documentation-issues">${issues.map(([name, values]) => `<article><h3>${escapeHtml(name)}</h3><p>${values.length ? escapeHtml(values.map(label).join(", ")) : "None recorded"}</p></article>`).join("")}</div>${doc.sandboxRequired ? `<p class="boundary-warning"><strong>Effective boundary:</strong> Isolated Sandbox until the critical documentation conditions are resolved.</p>` : ""}`);
}

function boundaryMarkup(summary) {
  const boundary = summary.transitionBoundary;
  const columns = [["Allowed now", boundary.permittedUses], ["Not allowed", boundary.prohibitedUses], ["Conditions to progress", boundary.conditions]];
  return section("04", "Deterministic decision boundary", boundary.label, `<div class="boundary-summary"><div class="boundary-summary-head"><div><h3>${escapeHtml(boundary.headline)}</h3><p>${escapeHtml(`${label(boundary.currentStage)} → ${label(boundary.targetStage)}`)}</p></div>${status(boundary.status)}</div><div class="boundary-columns">${columns.map(([title, items]) => `<div class="boundary-column"><h4>${escapeHtml(title)}</h4>${listItems(array(items), "No additional statement recorded.")}</div>`).join("")}</div></div>`);
}

function interpretationMarkup(summary) {
  return section("05", "Assurance language", "Evidence Interpretation", `<div class="interpretation-grid">${array(summary.evidenceInterpretation).map((item) => `<article class="interpretation-card">${status(item.evidenceClass)}<h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.description)}</p></article>`).join("")}</div>`);
}

function gatesMarkup(summary) {
  const rows = array(summary.gateRows);
  const content = rows.length ? `<div class="report-table-scroll"><table class="report-table"><thead><tr><th>Gate</th><th>State</th><th>Source references</th><th>Clearance requirement</th><th>Authority</th></tr></thead><tbody>${rows.map((gate) => `<tr><td><strong>${escapeHtml(gate.title)}</strong><small class="report-trace">${escapeHtml(gate.code ?? gate.id)}</small></td><td>${status(gate.state)}</td><td>${escapeHtml(array(gate.availableEvidence).slice(0, 3).map((item) => item.path).join("; ") || "No verified evidence recorded")}</td><td>${escapeHtml(array(gate.clearanceCriteria).join(" ") || "No additional clearance criterion")}</td><td>${escapeHtml(array(gate.requiredHumanAuthorities).map(label).join(", ") || "Deterministic rule")}</td></tr>`).join("")}</tbody></table></div>` : `<p class="report-empty">No deterministic hard gate was triggered.</p>`;
  return section("06", "Deterministic controls", "Hard-Gate Matrix", content);
}

function domainsMarkup(summary) {
  return section("07", "Governance assurance model", "A–F Domain Overview", `<div class="report-domain-grid">${array(summary.domainSummaries).map((domain) => `<article class="report-domain-card"><div class="report-domain-head"><h3><span class="report-domain-letter">${escapeHtml(domain.id)}</span>${escapeHtml(domain.title)}</h3>${status(domain.status)}</div><p><strong>${domain.controlsMet} of ${domain.applicableControls}</strong> applicable controls meet target · ${domain.unknownCount} unknown</p><p>${escapeHtml(domain.narrative || "No fact-checked domain narrative is available; consult the deterministic findings in the audit package.")}</p><small class="report-trace">${escapeHtml(`${array(domain.verifiedFindingIds).length} verified finding(s) · ${array(domain.gapIds).length} gap(s)`)}</small></article>`).join("")}</div>`);
}

function actionsMarkup(summary) {
  const actions = array(summary.actions);
  return section("10", "Approved response patterns", "Governance Action Playbook", `<div class="action-availability">${status(summary.actionAvailability.status)}<p>${escapeHtml(summary.actionAvailability.message)}</p></div>${actions.map((action) => `<article class="report-action-card"><h3>${escapeHtml(`${action.tacticId} · ${action.title}`)}</h3><p>${escapeHtml(action.activationReason)}</p><ul>${array(action.activities).map((activity) => `<li>${escapeHtml(activity)}</li>`).join("")}</ul><small class="report-trace">Owners: ${escapeHtml(array(action.ownerRoles).map(label).join(", ") || "Not assigned")} · State: ${escapeHtml(label(action.state))}</small></article>`).join("")}`);
}

function authorityMarkup(summary) {
  const requirements = array(summary.humanAuthority.requirements);
  return section("11", "Formal decision rights", "Human Authority", `<p class="report-lead">${escapeHtml(summary.humanAuthority.boundary)}</p><div class="authority-grid">${requirements.length ? requirements.map((item) => `<article class="authority-card"><div><h3>${escapeHtml(label(item.authority))}</h3>${status(item.status)}</div><p>${escapeHtml(array(item.reasons).join(" · "))}</p></article>`).join("") : `<p class="report-empty">No additional named authority review was triggered. Formal approval remains external to the Engine.</p>`}</div>`);
}

function auditMarkup(pkg, summary) {
  const values = [
    ["Package hash", pkg.packageHash], ["Ruleset", pkg.rulesetVersion], ["Knowledge version", pkg.knowledge?.version],
    ["Knowledge release status", pkg.knowledge?.releaseStatus ?? "UNSPECIFIED"], ["Knowledge manifest hash", pkg.knowledge?.manifestHash],
    ["Assessment mode", summary.assessmentMode], ["Package schema", pkg.schemaVersion], ["Summary contract", summary.version],
    ["Report generator", REPORT_VERSION], ["Complete evidence", `${summary.auditReference?.evidenceCount ?? 0} record(s) in canonical JSON ${summary.auditReference?.canonicalJsonPath ?? "$.evidence"}`]
  ];
  return section("12", "Audit reference", "Audit Identity", `<div class="trace-meta">${values.map(([name, value]) => `<div><span>${escapeHtml(name)}</span><code>${escapeHtml(displayValue(value))}</code></div>`).join("")}</div><p class="report-empty">The protected canonical JSON is the complete audit artifact. Raw evidence and full identifiers are intentionally excluded from HTML and PDF.</p>`);
}

function reportBodyMarkup(pkg) {
  const summary = pkg.assuranceSummary;
  if (!summary) throw new Error("Assurance Summary is unavailable for this package");
  const strengths = section("08", "Independently verified support", "Confirmed Strengths", listItems(array(summary.strengths), summary.assessmentMode === "DETERMINISTIC_ONLY" ? "Cognitive verification was not run. Automated indicators are not presented as confirmed strengths." : "No independently verified strengths were recorded."));
  const blockers = section("09", "Confidence and progression conditions", "Blocking Gaps and Unknowns", listItems(array(summary.blockingFindings), "No blocking gap or unknown was recorded for the declared transition."));
  const limitations = section("13", "Scope and interpretation", "Limitations", listItems(array(summary.limitations).map((text) => ({ text })), "No additional limitation was recorded."));
  return `<div class="assurance-report">${decisionMarkup(pkg, summary)}${caseProfileMarkup(summary)}${documentationMarkup(summary)}${boundaryMarkup(summary)}${interpretationMarkup(summary)}${gatesMarkup(summary)}${domainsMarkup(summary)}${strengths}${blockers}${actionsMarkup(summary)}${authorityMarkup(summary)}${auditMarkup(pkg, summary)}${limitations}</div>`;
}

export function renderAssuranceSummary(root, pkg) {
  root.replaceChildren();
  if (!pkg.assuranceSummary) {
    const message = document.createElement("p");
    message.className = "report-empty";
    message.textContent = "This package predates the Assurance Summary contract. Re-run the assessment to create the decision-ready view.";
    root.append(message);
    return;
  }
  root.innerHTML = reportBodyMarkup(pkg);
}

const staticCss = `
:root{--ink:#15342d;--forest:#123a31;--forest2:#1f5145;--lime:#c8ef68;--cream:#f4f5ef;--paper:#fffef9;--line:#d7dfd4;--muted:#667a73;--red:#8f2d38;--amber:#8a5a00;--blue:#245a7a}*{box-sizing:border-box}body{margin:0;background:var(--cream);color:var(--ink);font:14px/1.48 Arial,sans-serif}.assurance-report{max-width:1120px;margin:0 auto;padding:30px}.report-decision-hero{background:var(--forest);color:#fff;border-radius:20px;padding:30px}.report-decision-top,.boundary-summary-head,.report-domain-head{display:flex;justify-content:space-between;gap:18px;align-items:flex-start}.report-eyebrow{text-transform:uppercase;letter-spacing:.14em;font-size:10px;font-weight:800;color:var(--forest2);margin:0 0 5px}.report-eyebrow-light{color:var(--lime)}h1{font-size:34px;margin:5px 0 0}h2{margin:3px 0 18px}h3{margin:4px 0 8px}.report-decision-hero h2{font-size:22px;color:var(--lime)}.report-status{display:inline-block;border:1px solid currentColor;border-radius:999px;padding:4px 8px;font-size:9px;font-weight:800;text-transform:uppercase;white-space:nowrap}.hero-case-facts,.report-metrics,.documentation-summary,.trace-meta{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:18px}.report-metrics{grid-template-columns:repeat(4,1fr)}.hero-case-facts>div,.report-metric{background:var(--forest2);border-radius:11px;padding:11px}.hero-case-facts span,.report-metric span,.documentation-summary span,.trace-meta span{display:block;font-size:9px;text-transform:uppercase;opacity:.82}.report-metric strong{font-size:17px}.report-pilot-banner{background:#fff4d7;color:#644600;border-radius:10px;padding:10px;margin-top:14px;font-weight:800}.report-section{background:var(--paper);border:1px solid var(--line);border-radius:18px;padding:24px;margin-top:18px}.case-grid,.interpretation-grid,.report-domain-grid,.documentation-issues,.authority-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}.case-group,.interpretation-card,.report-domain-card,.documentation-issues article,.authority-card,.report-action-card{border:1px solid var(--line);border-radius:12px;padding:14px}.case-group dl{margin:0}.case-row{border-top:1px solid var(--line);padding:9px 0}.case-row:first-of-type{border-top:0}.case-row dt{font-size:10px;text-transform:uppercase;color:var(--muted);font-weight:700}.case-row dd{margin:3px 0 0;display:flex;justify-content:space-between;align-items:flex-start;gap:8px}.case-row dd>span:first-child{overflow-wrap:anywhere}.documentation-summary>div,.trace-meta>div{border:1px solid var(--line);border-radius:10px;padding:10px}.documentation-issues{margin-top:12px;grid-template-columns:repeat(3,1fr)}.boundary-warning{background:#fff4d7;border-left:5px solid var(--amber);padding:12px}.boundary-summary{background:#edf3ee;border-left:5px solid var(--lime);padding:18px;border-radius:12px}.boundary-columns{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:14px}.boundary-column{background:var(--paper);border:1px solid var(--line);border-radius:12px;padding:13px}.report-list-item{border-top:1px solid var(--line);padding:9px 0}.report-list-item:first-child{border-top:0}.report-trace{display:block;color:var(--muted);font-size:9px;overflow-wrap:anywhere}.report-table-scroll{overflow-x:auto}.report-table{width:100%;border-collapse:collapse}.report-table th,.report-table td{text-align:left;vertical-align:top;border-bottom:1px solid var(--line);padding:9px;font-size:10px}.report-table th{background:#e9eee9;text-transform:uppercase}.report-domain-letter{display:inline-grid;place-items:center;width:28px;height:28px;background:var(--lime);border-radius:7px;font-weight:800;margin-right:8px}.action-availability{background:#edf3ee;border-radius:11px;padding:12px;margin-bottom:12px}.trace-meta code{display:block;overflow-wrap:anywhere;font-size:9px}.report-empty{color:var(--muted);font-style:italic}.report-authority-note{font-weight:700}.status-progression-blocked,.status-block,.status-blocked,.status-conflicting{color:var(--red)}.status-conditionally-allowed,.status-review,.status-human-review,.status-incomplete{color:var(--amber)}@media(max-width:760px){.assurance-report{padding:12px}.hero-case-facts,.report-metrics,.documentation-summary,.trace-meta,.case-grid,.interpretation-grid,.report-domain-grid,.documentation-issues,.authority-grid,.boundary-columns{grid-template-columns:1fr}.report-decision-hero{border-radius:14px}.report-decision-top,.boundary-summary-head{display:block}}@page{size:A4;margin:13mm}@media print{body{background:white}.assurance-report{max-width:none;padding:0}.report-decision-hero,.report-section{box-shadow:none;break-inside:auto}.report-section{border-radius:0}.report-heading,.case-group,.interpretation-card,.report-domain-card,.documentation-issues article,.authority-card,.report-action-card,.report-list-item,tr{break-inside:avoid}thead{display:table-header-group}}
`;

export function standaloneReportHtml(pkg) {
  const body = reportBodyMarkup(pkg);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(solutionName(pkg))} — Assurance Summary</title><style>${staticCss}</style></head><body>${body}</body></html>`;
}
