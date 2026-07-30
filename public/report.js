export const REPORT_VERSION = "assurance-report-1.0.0";

const label = (value) => String(value ?? "").replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
const array = (value) => Array.isArray(value) ? value : [];

function node(tag, className, text) {
  const value = document.createElement(tag);
  if (className) value.className = className;
  if (text !== undefined) value.textContent = text;
  return value;
}

function status(value) {
  return node("span", `report-status status-${String(value).toLowerCase().replaceAll("_", "-")}`, label(value));
}

function section(title, eyebrow) {
  const wrapper = node("section", "report-section");
  const heading = node("div", "report-heading");
  heading.append(node("p", "report-eyebrow", eyebrow), node("h2", "", title));
  wrapper.append(heading);
  return wrapper;
}

function referenceLine(item) {
  const references = [
    ...array(item.findingIds), ...array(item.gateIds), ...array(item.controlIds), ...array(item.evidenceIds)
  ];
  return references.length ? `Trace: ${references.join(" · ")}` : "Trace: deterministic report rule";
}

function itemList(items, emptyText) {
  const list = node("div", "report-list");
  if (!items.length) list.append(node("p", "report-empty", emptyText));
  for (const item of items) {
    const card = node("article", "report-list-item");
    card.append(node("p", "", item.text ?? item.statement ?? ""), node("small", "report-trace", referenceLine(item)));
    list.append(card);
  }
  return list;
}

function renderDecision(summary, pkg) {
  const hero = node("section", "report-decision-hero");
  const top = node("div", "report-decision-top");
  const copy = node("div");
  copy.append(node("p", "report-eyebrow report-eyebrow-light", "Decision-ready assurance summary"), node("h1", "", label(summary.decision.outcome)));
  top.append(copy, status(summary.humanAuthority.formalDecisionStatus));
  hero.append(top, node("p", "report-decision-rationale", summary.decision.rationale));
  const metrics = node("div", "report-metrics");
  const values = [
    ["Evidence coverage", `${summary.dimensions.evidenceCoverage}%`],
    ["Control assurance", `${summary.dimensions.controlAssurance}%`],
    ["Residual risk", label(summary.dimensions.residualRisk)],
    ["Gate status", label(summary.dimensions.gateStatus)]
  ];
  for (const [name, value] of values) {
    const metric = node("div", "report-metric");
    metric.append(node("span", "", name), node("strong", "", value));
    metrics.append(metric);
  }
  hero.append(metrics, node("p", "report-authority-note", summary.humanAuthority.boundary));
  if (summary.knowledgeNotice) hero.append(node("div", "report-pilot-banner", summary.knowledgeNotice));
  hero.dataset.packageHash = pkg.packageHash;
  return hero;
}

function renderBoundary(summary) {
  const boundary = summary.transitionBoundary;
  const wrapper = section(boundary.label, "02 · Deterministic decision boundary");
  const card = node("div", "boundary-summary");
  const header = node("div", "boundary-summary-head");
  const title = node("div");
  title.append(node("h3", "", boundary.headline), node("p", "", `${label(boundary.currentStage)} → ${label(boundary.targetStage)}`));
  header.append(title, status(boundary.status));
  card.append(header);
  const columns = node("div", "boundary-columns");
  const groups = [
    ["Allowed now", boundary.permittedUses, "allowed"],
    ["Not allowed", boundary.prohibitedUses, "prohibited"],
    ["Conditions to progress", boundary.conditions, "conditions"]
  ];
  for (const [heading, items, tone] of groups) {
    const column = node("div", `boundary-column ${tone}`);
    column.append(node("h4", "", heading));
    if (!items.length) column.append(node("p", "report-empty", "No additional statement recorded."));
    for (const item of items) {
      const row = node("div", "boundary-item");
      row.append(node("p", "", item.statement), node("small", "report-trace", referenceLine(item.basis ?? {})));
      column.append(row);
    }
    columns.append(column);
  }
  card.append(columns);
  wrapper.append(card);
  return wrapper;
}

function renderInterpretation(summary) {
  const wrapper = section("Evidence Interpretation", "03 · Assurance language");
  const grid = node("div", "interpretation-grid");
  for (const item of summary.evidenceInterpretation) {
    const card = node("article", "interpretation-card");
    card.append(status(item.evidenceClass), node("h3", "", item.title), node("p", "", item.description));
    grid.append(card);
  }
  wrapper.append(grid);
  return wrapper;
}

function renderGates(summary) {
  const wrapper = section("Hard-Gate Matrix", "04 · Deterministic controls");
  if (!summary.gateRows.length) {
    wrapper.append(node("p", "report-empty", "No deterministic hard gate was triggered."));
    return wrapper;
  }
  const scroller = node("div", "report-table-scroll");
  const table = node("table", "report-table");
  const head = node("thead");
  const hr = node("tr");
  ["Gate", "State", "Verified evidence", "Clearance requirement", "Authority"].forEach((name) => hr.append(node("th", "", name)));
  head.append(hr); table.append(head);
  const body = node("tbody");
  for (const gate of summary.gateRows) {
    const row = node("tr");
    const gateCell = node("td"); gateCell.append(node("strong", "", gate.title), node("small", "report-trace", gate.id));
    const evidence = gate.availableEvidence.length ? gate.availableEvidence.map((item) => `${item.path} (${label(item.evidenceClass)})`).join("; ") : "No verified evidence recorded";
    row.append(gateCell, node("td", "", label(gate.state)), node("td", "", evidence), node("td", "", gate.clearanceCriteria.join(" ") || "No additional clearance criterion"), node("td", "", gate.requiredHumanAuthorities.map(label).join(", ") || "Deterministic rule"));
    body.append(row);
  }
  table.append(body); scroller.append(table); wrapper.append(scroller);
  return wrapper;
}

function renderDomains(summary) {
  const wrapper = section("A–F Domain Overview", "05 · Governance assurance model");
  const grid = node("div", "report-domain-grid");
  for (const domain of summary.domainSummaries) {
    const card = node("article", "report-domain-card");
    const head = node("div", "report-domain-head");
    const title = node("div"); title.append(node("span", "report-domain-letter", domain.id), node("h3", "", domain.title));
    head.append(title, status(domain.status)); card.append(head);
    card.append(node("p", "report-domain-score", `${domain.controlsMet} of ${domain.applicableControls} applicable controls meet target · ${domain.unknownCount} unknown`));
    card.append(node("p", "", domain.narrative || "No fact-checked domain narrative is available; consult the deterministic findings."));
    card.append(node("small", "report-trace", `Findings: ${domain.verifiedFindingIds.length} verified · Gaps: ${domain.gapIds.length}`));
    grid.append(card);
  }
  wrapper.append(grid);
  return wrapper;
}

function renderActions(summary) {
  const wrapper = section("Governance Action Playbook", "08 · Approved response patterns");
  const state = node("div", `action-availability ${summary.actionAvailability.status.toLowerCase()}`);
  state.append(status(summary.actionAvailability.status), node("p", "", summary.actionAvailability.message));
  wrapper.append(state);
  for (const action of summary.actions) {
    const card = node("article", "report-action-card");
    card.append(node("h3", "", `${action.tacticId} · ${action.title}`), node("p", "", action.activationReason));
    const list = node("ul"); array(action.activities).forEach((item) => list.append(node("li", "", item))); card.append(list);
    card.append(node("small", "report-trace", `Owners: ${array(action.ownerRoles).map(label).join(", ")} · State: ${label(action.state)}`));
    wrapper.append(card);
  }
  return wrapper;
}

function renderAuthority(summary) {
  const wrapper = section("Human Authority", "09 · Formal decision rights");
  wrapper.append(node("p", "report-lead", summary.humanAuthority.boundary));
  const grid = node("div", "authority-grid");
  if (!summary.humanAuthority.requirements.length) grid.append(node("p", "report-empty", "No additional named authority review was triggered. Formal approval remains external to the Engine."));
  for (const item of summary.humanAuthority.requirements) {
    const card = node("article", "authority-card");
    const head = node("div", "authority-head"); head.append(node("h3", "", label(item.authority)), status(item.status));
    card.append(head, node("p", "", array(item.reasons).join(" · "))); grid.append(card);
  }
  wrapper.append(grid);
  return wrapper;
}

function renderEvidence(summary, pkg) {
  const wrapper = section("Evidence and Trace", "10 · Minimized executive digest");
  const meta = node("div", "trace-meta");
  const values = [
    ["Package hash", pkg.packageHash], ["Ruleset", pkg.rulesetVersion], ["Knowledge", `${pkg.knowledge.version} · ${pkg.knowledge.source}`],
    ["Assessment mode", summary.assessmentMode], ["Schema", pkg.schemaVersion], ["Report", REPORT_VERSION]
  ];
  for (const [name, value] of values) { const item = node("div"); item.append(node("span", "", name), node("code", "", value)); meta.append(item); }
  wrapper.append(meta);
  const details = node("details", "evidence-details");
  const detailTitle = node("summary", "", `Evidence digest (${summary.evidenceDigest.length} of ${summary.evidenceTotal})`);
  details.append(detailTitle);
  const list = node("div", "evidence-digest");
  for (const item of summary.evidenceDigest) {
    const card = node("article", "evidence-item");
    const head = node("div", "evidence-head"); head.append(node("strong", "", item.path), status(item.evidenceClass));
    card.append(head, node("p", "", item.summary), node("small", "report-trace", `${item.id} · ${label(item.kind)} · ${label(item.assuranceState)}`)); list.append(card);
  }
  details.append(list); wrapper.append(details);
  return wrapper;
}

export function renderAssuranceSummary(root, pkg) {
  const summary = pkg.assuranceSummary;
  root.replaceChildren();
  if (!summary) {
    root.append(node("p", "report-empty", "This package predates the Assurance Summary contract. Re-run the assessment to create the decision-ready view."));
    return;
  }
  root.append(renderDecision(summary, pkg), renderBoundary(summary), renderInterpretation(summary), renderGates(summary), renderDomains(summary));
  const strengths = section("Confirmed Strengths", "06 · Independently verified support");
  strengths.append(itemList(summary.strengths, summary.assessmentMode === "DETERMINISTIC_ONLY" ? "Cognitive verification was not run. Automated indicators are not presented as confirmed strengths." : "No independently verified strengths were recorded."));
  const blockers = section("Blocking Gaps and Unknowns", "07 · What prevents confidence or progression");
  blockers.append(itemList(summary.blockingFindings, "No blocking gap or unknown was recorded for the declared transition."));
  root.append(strengths, blockers, renderActions(summary), renderAuthority(summary), renderEvidence(summary, pkg));
  const limitations = section("Limitations", "11 · Scope and interpretation");
  limitations.append(itemList(summary.limitations.map((text) => ({ text })), "No additional limitation was recorded."));
  root.append(limitations);
}

const staticCss = `
:root{--ink:#15342d;--forest:#123a31;--lime:#c8ef68;--cream:#f4f5ef;--paper:#fffef9;--line:#d7dfd4;--muted:#667a73;--red:#8f2d38;--amber:#8a5a00}*{box-sizing:border-box}body{margin:0;background:var(--cream);color:var(--ink);font:14px/1.5 Arial,sans-serif}.report{max-width:1120px;margin:0 auto;padding:32px}.hero{background:var(--forest);color:white;border-radius:20px;padding:30px}.hero h1{font-size:34px;margin:6px 0}.eyebrow{text-transform:uppercase;letter-spacing:.14em;font-size:10px;font-weight:700;color:var(--lime)}.status{display:inline-block;border:1px solid currentColor;border-radius:999px;padding:4px 8px;font-size:10px;font-weight:700;text-transform:uppercase}.metrics,.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.metrics{margin-top:22px}.metric{background:#1f5145;border-radius:12px;padding:12px}.metric span,.meta span{display:block;font-size:10px;text-transform:uppercase;opacity:.8}.metric strong{font-size:18px}.section{background:var(--paper);border:1px solid var(--line);border-radius:18px;padding:24px;margin-top:18px}.section h2{margin:3px 0 18px}.boundary{background:#edf3ee;border-left:5px solid var(--lime);padding:18px;border-radius:12px}.columns{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:14px}.column{border:1px solid var(--line);border-radius:12px;padding:14px}.column h3{font-size:13px}.item{border-top:1px solid var(--line);padding:10px 0}.trace{display:block;color:var(--muted);font-size:10px;word-break:break-word}.card{border:1px solid var(--line);border-radius:12px;padding:14px}.domain-letter{display:inline-grid;place-items:center;width:28px;height:28px;background:var(--lime);border-radius:7px;font-weight:800;margin-right:8px}table{width:100%;border-collapse:collapse}th,td{text-align:left;vertical-align:top;border-bottom:1px solid var(--line);padding:10px;font-size:11px}th{background:#e9eee9;text-transform:uppercase}.meta{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.meta div{border:1px solid var(--line);border-radius:10px;padding:10px}.meta code{word-break:break-all;font-size:10px}.pilot{background:#fff4d7;color:#644600;border-radius:10px;padding:10px;margin-top:14px;font-weight:700}.empty{color:var(--muted);font-style:italic}@media(max-width:760px){.report{padding:14px}.metrics,.grid,.columns,.meta{grid-template-columns:1fr}.hero{border-radius:14px}}@page{size:A4;margin:13mm}@media print{body{background:white}.report{max-width:none;padding:0}.hero,.section{break-inside:avoid;box-shadow:none}.section{border-radius:0}thead{display:table-header-group}tr,.card,.item{break-inside:avoid}}
`;

function staticStatus(value) { return `<span class="status">${escapeHtml(label(value))}</span>`; }
function staticItems(items, empty) {
  return items.length ? items.map((item) => `<div class="item"><p>${escapeHtml(item.text ?? item.statement)}</p><small class="trace">${escapeHtml(referenceLine(item))}</small></div>`).join("") : `<p class="empty">${escapeHtml(empty)}</p>`;
}
function staticSection(number, title, content) { return `<section class="section"><p class="eyebrow" style="color:#1f5145">${escapeHtml(number)}</p><h2>${escapeHtml(title)}</h2>${content}</section>`; }

export function standaloneReportHtml(pkg) {
  const s = pkg.assuranceSummary;
  if (!s) throw new Error("Assurance Summary is unavailable for this package");
  const solutionName = pkg.solution.name ?? pkg.solution.declared?.name ?? pkg.solution.intendedPurpose ?? pkg.solution.declared?.intendedPurpose ?? "AI solution";
  const b = s.transitionBoundary;
  const boundaryColumns = [["Allowed now", b.permittedUses], ["Not allowed", b.prohibitedUses], ["Conditions to progress", b.conditions]].map(([title, items]) => `<div class="column"><h3>${escapeHtml(title)}</h3>${staticItems(items.map((item) => ({ ...item, ...item.basis })), "No additional statement recorded.")}</div>`).join("");
  const gateRows = s.gateRows.map((g) => `<tr><td><strong>${escapeHtml(g.title)}</strong><small class="trace">${escapeHtml(g.id)}</small></td><td>${escapeHtml(label(g.state))}</td><td>${escapeHtml(g.availableEvidence.map((e) => `${e.path} (${label(e.evidenceClass)})`).join("; ") || "No verified evidence recorded")}</td><td>${escapeHtml(g.clearanceCriteria.join(" ") || "No additional criterion")}</td><td>${escapeHtml(g.requiredHumanAuthorities.map(label).join(", ") || "Deterministic rule")}</td></tr>`).join("");
  const domains = s.domainSummaries.map((d) => `<article class="card"><h3><span class="domain-letter">${escapeHtml(d.id)}</span>${escapeHtml(d.title)}</h3>${staticStatus(d.status)}<p>${escapeHtml(`${d.controlsMet} of ${d.applicableControls} applicable controls meet target · ${d.unknownCount} unknown`)}</p><p>${escapeHtml(d.narrative || "No fact-checked domain narrative is available; consult deterministic findings.")}</p><small class="trace">${escapeHtml(`Findings: ${d.verifiedFindingIds.length} verified · Gaps: ${d.gapIds.length}`)}</small></article>`).join("");
  const actions = `<p>${staticStatus(s.actionAvailability.status)} ${escapeHtml(s.actionAvailability.message)}</p>` + s.actions.map((a) => `<article class="card"><h3>${escapeHtml(`${a.tacticId} · ${a.title}`)}</h3><p>${escapeHtml(a.activationReason)}</p><ul>${array(a.activities).map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul></article>`).join("");
  const authority = `<p>${escapeHtml(s.humanAuthority.boundary)}</p>` + (s.humanAuthority.requirements.length ? s.humanAuthority.requirements.map((a) => `<article class="card"><h3>${escapeHtml(label(a.authority))} ${staticStatus(a.status)}</h3><p>${escapeHtml(array(a.reasons).join(" · "))}</p></article>`).join("") : `<p class="empty">No additional named authority review was triggered. Formal approval remains external to the Engine.</p>`);
  const digest = s.evidenceDigest.map((e) => `<article class="item"><strong>${escapeHtml(e.path)}</strong> ${staticStatus(e.evidenceClass)}<p>${escapeHtml(e.summary)}</p><small class="trace">${escapeHtml(`${e.id} · ${label(e.kind)} · ${label(e.assuranceState)}`)}</small></article>`).join("");
  const meta = [["Package hash", pkg.packageHash], ["Ruleset", pkg.rulesetVersion], ["Knowledge", `${pkg.knowledge.version} · ${pkg.knowledge.source}`], ["Assessment mode", s.assessmentMode], ["Schema", pkg.schemaVersion], ["Report", REPORT_VERSION]].map(([k,v]) => `<div><span>${escapeHtml(k)}</span><code>${escapeHtml(v)}</code></div>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(solutionName)} — Assurance Summary</title><style>${staticCss}</style></head><body><main class="report"><section class="hero"><p class="eyebrow">Decision-ready assurance summary</p><h1>${escapeHtml(label(s.decision.outcome))}</h1><p>${escapeHtml(s.decision.rationale)}</p><div class="metrics">${[["Evidence coverage",`${s.dimensions.evidenceCoverage}%`],["Control assurance",`${s.dimensions.controlAssurance}%`],["Residual risk",label(s.dimensions.residualRisk)],["Gate status",label(s.dimensions.gateStatus)]].map(([k,v])=>`<div class="metric"><span>${escapeHtml(k)}</span><strong>${escapeHtml(v)}</strong></div>`).join("")}</div><p>${escapeHtml(s.humanAuthority.boundary)}</p>${s.knowledgeNotice ? `<div class="pilot">${escapeHtml(s.knowledgeNotice)}</div>` : ""}</section>${staticSection("02 · Deterministic decision boundary", b.label, `<div class="boundary"><h3>${escapeHtml(b.headline)} ${staticStatus(b.status)}</h3><p>${escapeHtml(`${label(b.currentStage)} → ${label(b.targetStage)}`)}</p><div class="columns">${boundaryColumns}</div></div>`)}${staticSection("03 · Assurance language", "Evidence Interpretation", `<div class="grid">${s.evidenceInterpretation.map((i)=>`<article class="card">${staticStatus(i.evidenceClass)}<h3>${escapeHtml(i.title)}</h3><p>${escapeHtml(i.description)}</p></article>`).join("")}</div>`)}${staticSection("04 · Deterministic controls", "Hard-Gate Matrix", gateRows ? `<table><thead><tr><th>Gate</th><th>State</th><th>Verified evidence</th><th>Clearance requirement</th><th>Authority</th></tr></thead><tbody>${gateRows}</tbody></table>` : `<p class="empty">No deterministic hard gate was triggered.</p>`)}${staticSection("05 · Governance assurance model", "A–F Domain Overview", `<div class="grid" style="grid-template-columns:repeat(2,1fr)">${domains}</div>`)}${staticSection("06 · Independently verified support", "Confirmed Strengths", staticItems(s.strengths, s.assessmentMode === "DETERMINISTIC_ONLY" ? "Cognitive verification was not run. Automated indicators are not confirmed strengths." : "No independently verified strength was recorded."))}${staticSection("07 · What prevents confidence or progression", "Blocking Gaps and Unknowns", staticItems(s.blockingFindings, "No blocking gap or unknown was recorded."))}${staticSection("08 · Approved response patterns", "Governance Action Playbook", actions)}${staticSection("09 · Formal decision rights", "Human Authority", authority)}${staticSection("10 · Minimized executive digest", "Evidence and Trace", `<div class="meta">${meta}</div><h3>Evidence digest (${s.evidenceDigest.length} of ${s.evidenceTotal})</h3>${digest}`)}${staticSection("11 · Scope and interpretation", "Limitations", staticItems(s.limitations.map((text)=>({text})), "No additional limitation was recorded."))}</main></body></html>`;
}
