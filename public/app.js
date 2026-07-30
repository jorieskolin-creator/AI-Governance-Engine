const STAGES = [
  "QUALIFICATION_AND_REGISTRATION", "DESIGN_AND_DEVELOPMENT", "VERIFICATION_AND_VALIDATION",
  "DEPLOYMENT", "OPERATION_AND_MONITORING", "REVIEW_AND_EVALUATION", "RETIREMENT"
];
let lastPackage = null;
let sampleSources = [];

const $ = (id) => document.getElementById(id);
const label = (value) => String(value).replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const list = (value) => value.split(",").map((entry) => entry.trim()).filter(Boolean);
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
  $("name").value = dossier.name; $("owner").value = dossier.accountableOwner;
  $("purpose").value = dossier.intendedPurpose; $("value").value = dossier.expectedValue;
  $("current-stage").value = dossier.currentStage; $("target-stage").value = dossier.targetStage;
  $("jurisdictions").value = dossier.jurisdictions.join(", "); $("roles").value = dossier.roles.join(", "); $("users").value = dossier.users.join(", ");
  $("personal-data").checked = dossier.data.personalData; $("special-data").checked = dossier.data.specialCategoryData; $("production-data").checked = dossier.data.productionData;
  $("external-users").checked = dossier.exposure.externalUsers; $("production-access").checked = dossier.exposure.productionAccess; $("consequential").checked = dossier.exposure.consequentialDecisions;
  $("uses-agents").checked = dossier.agent.usesAgents; $("takes-actions").checked = dossier.agent.canTakeActions; $("irreversible").checked = dossier.agent.irreversibleActions; $("human-override").checked = dossier.agent.humanOverride;
  $("prohibited").checked = dossier.classification.prohibitedPractice; $("high-risk").checked = dossier.classification.highRiskCandidate;
}

function dossierFromForm() {
  return {
    name: $("name").value, intendedPurpose: $("purpose").value, expectedValue: $("value").value,
    currentStage: $("current-stage").value, targetStage: $("target-stage").value,
    jurisdictions: list($("jurisdictions").value), roles: list($("roles").value), users: list($("users").value), accountableOwner: $("owner").value,
    data: { personalData: $("personal-data").checked, specialCategoryData: $("special-data").checked, productionData: $("production-data").checked },
    exposure: { externalUsers: $("external-users").checked, productionAccess: $("production-access").checked, consequentialDecisions: $("consequential").checked },
    agent: { usesAgents: $("uses-agents").checked, canTakeActions: $("takes-actions").checked, irreversibleActions: $("irreversible").checked, humanOverride: $("human-override").checked },
    classification: { prohibitedPractice: $("prohibited").checked, highRiskCandidate: $("high-risk").checked }
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
  const boundary = el("p", ""); boundary.style.marginTop = "12px"; boundary.textContent = pkg.recommendation.boundary; root.append(boundary);
}

function renderMetrics(pkg) {
  const values = [
    ["Evidence coverage", `${pkg.dimensions.evidenceCoverage}%`], ["Control assurance", `${pkg.dimensions.controlAssurance}%`],
    ["Residual risk", pkg.dimensions.residualRisk], ["Gate status", pkg.dimensions.gateStatus]
  ];
  $("metric-grid").replaceChildren(...values.map(([name, value]) => { const card = el("div", "metric"); card.append(el("span", "", name), el("strong", "", label(value))); return card; }));
}

function renderLifecycle(pkg) {
  $("lifecycle").replaceChildren(...STAGES.map((stage) => {
    const node = el("div", `stage ${stage === pkg.solution.currentStage ? "current" : ""} ${stage === pkg.solution.targetStage ? "target" : ""}`, label(stage));
    if (stage === pkg.solution.currentStage) node.append(el("small", "", "Current"));
    if (stage === pkg.solution.targetStage) node.append(el("small", "", "Target"));
    return node;
  }));
}

function renderHumanDecisions(pkg) {
  const root = $("human-decisions"); root.className = "panel human-panel"; root.replaceChildren();
  const heading = el("div", "section-heading"); const title = el("div"); title.append(el("p", "eyebrow", "Annotation 1 · protected authority"), el("h2", "", "Human decisions required")); heading.append(title); root.append(heading);
  const grid = el("div", "human-list");
  if (!pkg.humanDecisionRequirements.length) grid.append(el("p", "", "No additional authority decision was triggered for this transition. Formal organizational approval remains outside this engine."));
  for (const decision of pkg.humanDecisionRequirements) {
    const item = el("div", "human-item"); item.append(el("strong", "", label(decision.authority)), badge(decision.status, "HUMAN_REVIEW_REQUIRED"));
    item.append(el("p", "", decision.reasons.join(" · "))); grid.append(item);
  }
  root.append(grid);
}

function renderGates(pkg) {
  const nodes = pkg.hardGates.map((gate) => {
    const node = el("article", "gate"); const head = el("div", "gate-head"); head.append(el("strong", "", gate.title), badge(gate.outcome));
    node.append(head, el("p", "", gate.rationale));
    if (gate.requiredHumanAuthorities.length) node.append(el("p", "", `Authority: ${gate.requiredHumanAuthorities.map(label).join(", ")}`));
    return node;
  });
  $("gates").replaceChildren(...(nodes.length ? nodes : [el("p", "", "No deterministic hard gate was triggered.")]));
}

function renderDomains(pkg) {
  const nodes = pkg.domains.map((domain) => {
    const card = el("article", "domain"); const head = el("div", "domain-header"); head.append(el("span", "domain-letter", domain.id));
    const title = el("div"); title.append(el("h3", "", domain.title), el("p", "", `Evidence coverage ${Math.round(domain.evidenceCoverage * 100)}% · ${domain.gaps.length} gap(s)`)); head.append(title); card.append(head);
    for (const control of domain.controls) {
      const row = el("div", "assessment-row"); const rowHead = el("div", "assessment-title"); rowHead.append(el("strong", "", control.title), badge(control.state)); row.append(rowHead);
      if (control.gap) row.append(el("p", "", control.gap.description)); else row.append(el("p", "", `Target ${label(control.targetState)} met; ${control.evidenceIds.length} evidence reference(s).`));
      card.append(row);
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
    const node = el("article", "action"); const head = el("div", "action-head"); head.append(el("strong", "", `${action.tacticId} · ${action.title}`), badge(action.state)); node.append(head);
    node.append(el("p", "", action.activationReason)); const ul = el("ul"); action.activities.forEach((item) => ul.append(el("li", "", item))); node.append(ul);
    node.append(el("p", "", `Owners: ${action.ownerRoles.map(label).join(", ")} · Blocks: ${label(action.blocksTransition)}`));
    node.append(el("p", "", `Acceptance: ${action.acceptanceCriteria.join(" · ")}`));
    return node;
  });
  $("actions").replaceChildren(...(nodes.length ? nodes : [el("p", "", "No playbook action was activated.")]));
}

function renderTrace(pkg) {
  const values = [["Package hash", pkg.packageHash], ["Evidence snapshot", pkg.trace.evidenceSnapshotHash], ["Knowledge version", pkg.knowledge.version], ["Knowledge source", pkg.knowledge.source], ["Ruleset", pkg.rulesetVersion], ["Run ID", pkg.runId]];
  const grid = el("div", "trace-grid");
  for (const [name, value] of values) { const node = el("div", "trace-item"); node.append(el("span", "", name), el("code", "", value)); grid.append(node); }
  $("trace").replaceChildren(grid);
}

function renderPackage(pkg) {
  lastPackage = pkg; renderRecommendation(pkg); renderMetrics(pkg); renderLifecycle(pkg); renderHumanDecisions(pkg); renderGates(pkg); renderDomains(pkg); renderActions(pkg); renderTrace(pkg);
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

function downloadPackage() {
  if (!lastPackage) return; const blob = new Blob([JSON.stringify(lastPackage, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = `${lastPackage.solution.intendedPurpose.slice(0, 30).replace(/\W+/g, "-").toLowerCase()}-readiness.json`; link.click(); URL.revokeObjectURL(url);
}

stageOptions();
fetch("/api/knowledge").then((response) => response.json()).then((kb) => { $("knowledge-status").textContent = `${kb.source} · ${kb.version}`; }).catch(() => { $("knowledge-status").textContent = "Knowledge unavailable"; });
$("sample-button").addEventListener("click", loadSample); $("dossier-form").addEventListener("submit", runAssessment); $("download-button").addEventListener("click", downloadPackage);
$("source-files").addEventListener("change", () => { sampleSources = []; $("file-summary").textContent = `${$("source-files").files.length} file(s) selected`; });
