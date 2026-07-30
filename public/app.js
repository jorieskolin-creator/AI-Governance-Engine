import { renderAssuranceSummary, standaloneReportHtml } from "/report.js";

const STAGES = [
  "QUALIFICATION_AND_REGISTRATION", "DESIGN_AND_DEVELOPMENT", "VERIFICATION_AND_VALIDATION",
  "DEPLOYMENT", "OPERATION_AND_MONITORING", "REVIEW_AND_EVALUATION", "RETIREMENT"
];
let lastPackage = null;
let sampleSources = [];
let summaryEnabled = true;

const $ = (id) => document.getElementById(id);
const label = (value) => String(value ?? "").replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
const commaList = (value) => value.split(",").map((entry) => entry.trim()).filter(Boolean);
const lineList = (value) => value.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean);
const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const badge = (text, tone = text) => el("span", `badge ${tone}`, label(text));

function stageOptions() {
  for (const id of ["current-stage", "target-stage"]) {
    const select = $(id);
    for (const stage of STAGES) {
      const option = el("option", "", label(stage));
      option.value = stage;
      select.append(option);
    }
  }
  $("current-stage").value = "DESIGN_AND_DEVELOPMENT";
  $("target-stage").value = "VERIFICATION_AND_VALIDATION";
}

function fillDossier(dossier) {
  const boundary = dossier.operatingBoundary ?? {};
  $("name").value = dossier.name; $("owner").value = dossier.accountableOwner;
  $("purpose").value = dossier.intendedPurpose; $("value").value = dossier.expectedValue;
  $("current-stage").value = dossier.currentStage; $("target-stage").value = dossier.targetStage;
  $("jurisdictions").value = dossier.jurisdictions.join(", "); $("roles").value = dossier.roles.join(", "); $("users").value = dossier.users.join(", ");
  $("allowed-uses").value = (boundary.allowedUses ?? []).join("\n"); $("excluded-uses").value = (boundary.excludedUses ?? []).join("\n");
  $("boundary-environment").value = boundary.environment ?? "UNKNOWN"; $("boundary-users").value = boundary.userScope ?? ""; $("boundary-data").value = boundary.dataScope ?? "";
  $("boundary-integrations").value = boundary.integrationScope ?? ""; $("boundary-permissions").value = boundary.permissionScope ?? ""; $("boundary-autonomy").value = boundary.autonomyScope ?? "";
  $("boundary-monitoring").value = boundary.monitoringOwner ?? ""; $("boundary-expiry").value = boundary.expiresAt?.slice(0, 10) ?? "";
  $("personal-data").checked = dossier.data.personalData; $("special-data").checked = dossier.data.specialCategoryData; $("production-data").checked = dossier.data.productionData;
  $("external-users").checked = dossier.exposure.externalUsers; $("production-access").checked = dossier.exposure.productionAccess; $("consequential").checked = dossier.exposure.consequentialDecisions;
  $("uses-agents").checked = dossier.agent.usesAgents; $("takes-actions").checked = dossier.agent.canTakeActions; $("irreversible").checked = dossier.agent.irreversibleActions; $("human-override").checked = dossier.agent.humanOverride;
  $("prohibited").checked = dossier.classification.prohibitedPractice; $("high-risk").checked = dossier.classification.highRiskCandidate;
}

function dossierFromForm() {
  return {
    name: $("name").value, intendedPurpose: $("purpose").value, expectedValue: $("value").value,
    currentStage: $("current-stage").value, targetStage: $("target-stage").value,
    jurisdictions: commaList($("jurisdictions").value), roles: commaList($("roles").value), users: commaList($("users").value), accountableOwner: $("owner").value,
    data: { personalData: $("personal-data").checked, specialCategoryData: $("special-data").checked, productionData: $("production-data").checked },
    exposure: { externalUsers: $("external-users").checked, productionAccess: $("production-access").checked, consequentialDecisions: $("consequential").checked },
    agent: { usesAgents: $("uses-agents").checked, canTakeActions: $("takes-actions").checked, irreversibleActions: $("irreversible").checked, humanOverride: $("human-override").checked },
    classification: { prohibitedPractice: $("prohibited").checked, highRiskCandidate: $("high-risk").checked },
    operatingBoundary: {
      allowedUses: lineList($("allowed-uses").value), excludedUses: lineList($("excluded-uses").value), environment: $("boundary-environment").value,
      userScope: $("boundary-users").value, dataScope: $("boundary-data").value, integrationScope: $("boundary-integrations").value,
      permissionScope: $("boundary-permissions").value, autonomyScope: $("boundary-autonomy").value, monitoringOwner: $("boundary-monitoring").value,
      expiresAt: $("boundary-expiry").value || null
    }
  };
}

async function selectedSources() {
  const files = [...$("source-files").files];
  if (!files.length) return sampleSources;
  const accepted = files.filter((file) => file.size <= 2 * 1024 * 1024 && /\.(?:js|mjs|cjs|ts|tsx|jsx|py|java|go|rs|rb|php|cs|json|ya?ml|toml|ini|tf|sql|md|txt|html|css)$/i.test(file.name));
  return Promise.all(accepted.map(async (file) => ({ path: file.webkitRelativePath || file.name, content: await file.text() })));
}

function renderRecommendation(pkg) {
  const root = $("recommendation"); root.className = `recommendation ${pkg.recommendation.outcome}`; root.replaceChildren();
  root.append(el("p", "eyebrow", "Readiness recommendation"), el("h2", "", label(pkg.recommendation.outcome)), el("p", "", pkg.recommendation.rationale));
  const boundary = el("p", "recommendation-boundary", pkg.recommendation.boundary); root.append(boundary);
}

function renderMetrics(pkg) {
  const values = [["Evidence coverage", `${pkg.dimensions.evidenceCoverage}%`], ["Control assurance", `${pkg.dimensions.controlAssurance}%`], ["Residual risk", pkg.dimensions.residualRisk], ["Gate status", pkg.dimensions.gateStatus]];
  $("metric-grid").replaceChildren(...values.map(([name, value]) => { const card = el("div", "metric"); card.append(el("span", "", name), el("strong", "", label(value))); return card; }));
}

function renderLifecycle(pkg) {
  $("lifecycle").replaceChildren(...STAGES.map((stage) => {
    const item = el("div", `stage ${stage === pkg.solution.currentStage ? "current" : ""} ${stage === pkg.solution.targetStage ? "target" : ""}`, label(stage));
    if (stage === pkg.solution.currentStage) item.append(el("small", "", "Current"));
    if (stage === pkg.solution.targetStage) item.append(el("small", "", "Target"));
    return item;
  }));
}

function renderHumanDecisions(pkg) {
  const root = $("human-decisions"); root.className = "panel human-panel"; root.replaceChildren();
  const heading = el("div", "section-heading"); const title = el("div"); title.append(el("p", "eyebrow", "Protected authority"), el("h2", "", "Human decisions required")); heading.append(title); root.append(heading);
  const grid = el("div", "human-list");
  if (!pkg.humanDecisionRequirements.length) grid.append(el("p", "", "No additional authority decision was triggered. Formal organizational approval remains outside this Engine."));
  for (const decision of pkg.humanDecisionRequirements) {
    const item = el("div", "human-item"); item.append(el("strong", "", label(decision.authority)), badge(decision.status, "HUMAN_REVIEW_REQUIRED"), el("p", "", decision.reasons.join(" · "))); grid.append(item);
  }
  root.append(grid);
}

function renderGates(pkg) {
  const nodes = pkg.hardGates.map((gate) => {
    const item = el("article", "gate"); const head = el("div", "gate-head"); head.append(el("strong", "", gate.title), badge(gate.outcome));
    item.append(head, el("p", "", gate.rationale));
    if (gate.clearanceCriteria?.length) item.append(el("p", "", `Clearance: ${gate.clearanceCriteria.join(" ")}`));
    if (gate.requiredHumanAuthorities.length) item.append(el("p", "", `Authority: ${gate.requiredHumanAuthorities.map(label).join(", ")}`));
    return item;
  });
  $("gates").replaceChildren(...(nodes.length ? nodes : [el("p", "", "No deterministic hard gate was triggered.")]));
}

function renderDomains(pkg) {
  const nodes = pkg.domains.map((domain) => {
    const card = el("article", "domain"); const head = el("div", "domain-header"); head.append(el("span", "domain-letter", domain.id));
    const title = el("div"); title.append(el("h3", "", domain.title), el("p", "", `Evidence coverage ${Math.round(domain.evidenceCoverage * 100)}% · ${domain.gaps.length} gap(s)`)); head.append(title); card.append(head);
    for (const control of domain.controls) {
      const row = el("div", "assessment-row"); const rowHead = el("div", "assessment-title"); rowHead.append(el("strong", "", control.title), badge(control.state)); row.append(rowHead);
      row.append(el("p", "", control.gap?.description ?? `Target ${label(control.targetState)} met; ${control.evidenceIds.length} evidence reference(s).`)); card.append(row);
    }
    for (const anti of domain.antiPatterns) {
      if (anti.state === "UNKNOWN" && domain.antiPatterns.length > 3) continue;
      const row = el("div", "assessment-row"); const rowHead = el("div", "assessment-title"); rowHead.append(el("strong", "", `Anti-pattern · ${anti.title}`), badge(anti.state)); row.append(rowHead, el("p", "", anti.reasoning)); card.append(row);
    }
    return card;
  });
  $("domains").replaceChildren(...nodes);
}

function renderActions(pkg) {
  const nodes = pkg.actions.map((action) => {
    const item = el("article", "action"); const head = el("div", "action-head"); head.append(el("strong", "", `${action.tacticId} · ${action.title}`), badge(action.state)); item.append(head, el("p", "", action.activationReason));
    const list = el("ul"); action.activities.forEach((activity) => list.append(el("li", "", activity))); item.append(list);
    item.append(el("p", "", `Owners: ${action.ownerRoles.map(label).join(", ")} · Blocks: ${label(action.blocksTransition)}`), el("p", "", `Acceptance: ${action.acceptanceCriteria.join(" · ")}`));
    return item;
  });
  const emptyMessage = pkg.assuranceSummary?.actionAvailability?.message ?? "No playbook action was activated.";
  $("actions").replaceChildren(...(nodes.length ? nodes : [el("p", "", emptyMessage)]));
}

function renderTrace(pkg) {
  const values = [["Package hash", pkg.packageHash], ["Evidence snapshot", pkg.trace.evidenceSnapshotHash], ["Knowledge version", pkg.knowledge.version], ["Knowledge source", pkg.knowledge.source], ["Ruleset", pkg.rulesetVersion], ["Run ID", pkg.runId]];
  const grid = el("div", "trace-grid");
  for (const [name, value] of values) { const item = el("div", "trace-item"); item.append(el("span", "", name), el("code", "", value)); grid.append(item); }
  $("trace").replaceChildren(grid);
}

function selectView(view) {
  const summary = view === "summary";
  $("summary-view").classList.toggle("hidden", !summary); $("workspace-view").classList.toggle("hidden", summary);
  $("summary-tab").classList.toggle("active", summary); $("workspace-tab").classList.toggle("active", !summary);
  $("summary-tab").setAttribute("aria-selected", String(summary)); $("workspace-tab").setAttribute("aria-selected", String(!summary));
}

function renderPackage(pkg) {
  lastPackage = pkg;
  renderAssuranceSummary($("assurance-summary"), pkg);
  renderRecommendation(pkg); renderMetrics(pkg); renderLifecycle(pkg); renderHumanDecisions(pkg); renderGates(pkg); renderDomains(pkg); renderActions(pkg); renderTrace(pkg);
  $("view-switch").classList.toggle("summary-disabled", !summaryEnabled);
  $("summary-tab").disabled = !summaryEnabled;
  selectView(summaryEnabled ? "summary" : "workspace");
  $("results").classList.remove("hidden"); $("results").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function loadSample() {
  const response = await fetch("/api/sample"); const sample = await response.json();
  fillDossier(sample.dossier); sampleSources = sample.sources; $("file-summary").textContent = `${sample.sources.length} controlled sample evidence files loaded`;
}

async function runAssessment(event) {
  event.preventDefault(); $("error").classList.add("hidden"); $("progress").classList.remove("hidden"); $("assess-button").disabled = true;
  try {
    const response = await fetch("/api/assess", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dossier: dossierFromForm(), sources: await selectedSources() }) });
    const body = await response.json(); if (!response.ok) throw new Error(body.detail || body.error || "Assessment failed"); renderPackage(body);
  } catch (error) { $("error").textContent = error.message; $("error").classList.remove("hidden"); }
  finally { $("progress").classList.add("hidden"); $("assess-button").disabled = false; }
}

function download(content, type, suffix) {
  if (!lastPackage) return;
  const blob = new Blob([content], { type }); const url = URL.createObjectURL(blob); const link = document.createElement("a");
  const solutionName = lastPackage.solution.name ?? lastPackage.solution.declared?.name ?? lastPackage.solution.intendedPurpose ?? lastPackage.solution.declared?.intendedPurpose ?? "ai-governance";
  const base = solutionName.slice(0, 42).replace(/\W+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "ai-governance";
  link.href = url; link.download = `${base}-${suffix}`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 0);
}

function downloadPackage() { download(JSON.stringify(lastPackage, null, 2), "application/json", "readiness.json"); }
function downloadHtml() { download(standaloneReportHtml(lastPackage), "text/html;charset=utf-8", "assurance-summary.html"); }

stageOptions();
Promise.all([
  fetch("/api/knowledge").then((response) => response.json()),
  fetch("/api/config").then((response) => response.json()).catch(() => ({ assuranceSummaryEnabled: true }))
]).then(([kb, config]) => {
  $("knowledge-status").textContent = `${kb.source} · ${kb.version}`;
  summaryEnabled = config.assuranceSummaryEnabled !== false;
}).catch(() => { $("knowledge-status").textContent = "Knowledge unavailable"; });
$("sample-button").addEventListener("click", loadSample); $("dossier-form").addEventListener("submit", runAssessment);
$("summary-tab").addEventListener("click", () => selectView("summary")); $("workspace-tab").addEventListener("click", () => selectView("workspace"));
$("print-button").addEventListener("click", () => window.print()); $("html-button").addEventListener("click", downloadHtml); $("download-button").addEventListener("click", downloadPackage);
$("source-files").addEventListener("change", () => { sampleSources = []; $("file-summary").textContent = `${$("source-files").files.length} file(s) selected`; });
