import { renderAssuranceSummary, standaloneReportHtml } from "/report.js";
import { binaryMimeTypes, classifyUploadPath, provisionalIngestionManifest } from "/upload-types.js";

const STAGES = [
  "QUALIFICATION_AND_REGISTRATION", "DESIGN_AND_DEVELOPMENT", "VERIFICATION_AND_VALIDATION",
  "DEPLOYMENT", "OPERATION_AND_MONITORING", "REVIEW_AND_EVALUATION", "RETIREMENT"
];
const ACCESS_MODES = ["UNKNOWN", "INTERNAL_ONLY", "EXTERNAL_WITH_SOLUTION_OWNER", "CONTROLLED_EXTERNAL_PILOT", "RESTRICTED_CUSTOMER_USE", "PUBLIC_ACCESS", "EXTERNAL_UNSPECIFIED"];
let lastPackage = null;
let sampleSources = [];
let summaryEnabled = true;
let preparedSources = null;

const $ = (id) => document.getElementById(id);
const label = (value) => String(value ?? "").replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
const commaList = (value) => value.split(",").map((entry) => entry.trim()).filter(Boolean);
const lineList = (value) => value.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean);
const triState = (id) => $(id).value === "UNKNOWN" ? null : $(id).value === "YES";
const checkedValues = (id) => [...$(id).querySelectorAll('input[type="checkbox"]:checked')].map((item) => item.value);
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
  for (const select of document.querySelectorAll("select.tri-state")) {
    for (const [value, text] of [["UNKNOWN", "Unknown"], ["NO", "No"], ["YES", "Yes"]]) {
      const option = el("option", "", text); option.value = value; select.append(option);
    }
    select.value = "UNKNOWN";
  }
  for (const select of document.querySelectorAll("select.access-mode")) {
    for (const value of ACCESS_MODES) { const option = el("option", "", label(value)); option.value = value; select.append(option); }
    select.value = "UNKNOWN";
  }
}

function fillDossier(dossier) {
  const boundary = dossier.operatingBoundary ?? {};
  $("name").value = dossier.name ?? ""; $("owner").value = dossier.accountableOwner ?? "";
  $("purpose").value = dossier.intendedPurpose ?? ""; $("value").value = dossier.expectedValue ?? "";
  $("current-stage").value = dossier.currentStage ?? "QUALIFICATION_AND_REGISTRATION"; $("target-stage").value = dossier.targetStage ?? "DESIGN_AND_DEVELOPMENT";
  $("jurisdictions").value = (dossier.jurisdictions ?? []).join(", "); $("roles").value = (dossier.roles ?? []).join(", "); $("users").value = (dossier.users ?? []).join(", ");
  $("allowed-uses").value = (boundary.allowedUses ?? []).join("\n"); $("excluded-uses").value = (boundary.excludedUses ?? []).join("\n");
  $("boundary-environment").value = boundary.environment ?? "UNKNOWN"; $("boundary-users").value = boundary.userScope ?? ""; $("boundary-data").value = boundary.dataScope ?? "";
  $("boundary-integrations").value = boundary.integrationScope ?? ""; $("boundary-permissions").value = boundary.permissionScope ?? ""; $("boundary-autonomy").value = boundary.autonomyScope ?? "";
  $("boundary-monitoring").value = boundary.monitoringOwner ?? ""; $("boundary-expiry").value = boundary.expiresAt?.slice(0, 10) ?? "";
  const setTri = (id, value) => { $(id).value = value === null || value === undefined ? "UNKNOWN" : value ? "YES" : "NO"; };
  const categories = new Set(dossier.data?.categories ?? []); for (const input of $("data-categories").querySelectorAll('input[type="checkbox"]')) input.checked = categories.has(input.value);
  $("current-user-access").value = dossier.exposure?.currentUserAccess ?? (dossier.exposure?.externalUsers === false ? "INTERNAL_ONLY" : "UNKNOWN");
  $("intended-user-access").value = dossier.exposure?.intendedUserAccess ?? (dossier.exposure?.externalUsers === true ? "EXTERNAL_UNSPECIFIED" : dossier.exposure?.externalUsers === false ? "INTERNAL_ONLY" : "UNKNOWN");
  setTri("production-access", dossier.exposure?.productionAccess); setTri("consequential", dossier.exposure?.consequentialDecisions);
  setTri("uses-agents", dossier.agent?.usesAgents); setTri("takes-actions", dossier.agent?.canTakeActions); setTri("irreversible", dossier.agent?.irreversibleActions); setTri("human-override", dossier.agent?.humanOverride);
  setTri("prohibited", dossier.classification?.prohibitedPractice); setTri("high-risk", dossier.classification?.highRiskCandidate);
}

function dossierFromForm() {
  return {
    name: $("name").value, intendedPurpose: $("purpose").value, expectedValue: $("value").value,
    currentStage: $("current-stage").value, targetStage: $("target-stage").value,
    jurisdictions: commaList($("jurisdictions").value), roles: commaList($("roles").value), users: commaList($("users").value), accountableOwner: $("owner").value,
    data: { categories: checkedValues("data-categories") },
    exposure: { currentUserAccess: $("current-user-access").value, intendedUserAccess: $("intended-user-access").value, productionAccess: triState("production-access"), consequentialDecisions: triState("consequential") },
    agent: { usesAgents: triState("uses-agents"), canTakeActions: triState("takes-actions"), irreversibleActions: triState("irreversible"), humanOverride: triState("human-override") },
    classification: { prohibitedPractice: triState("prohibited"), highRiskCandidate: triState("high-risk") },
    operatingBoundary: {
      allowedUses: lineList($("allowed-uses").value), excludedUses: lineList($("excluded-uses").value), environment: $("boundary-environment").value,
      userScope: $("boundary-users").value, dataScope: $("boundary-data").value, integrationScope: $("boundary-integrations").value,
      permissionScope: $("boundary-permissions").value, autonomyScope: $("boundary-autonomy").value, monitoringOwner: $("boundary-monitoring").value,
      expiresAt: $("boundary-expiry").value || null
    }
  };
}

function bytesToBase64(buffer) {
  const bytes = new Uint8Array(buffer); let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

async function browserFileSource(file) {
  if (file.size > 15 * 1024 * 1024) throw new Error(`${file.name} exceeds the 15 MB source limit.`);
  const path = file.webkitRelativePath || file.name;
  const mimeType = classifyUploadPath(path, file.type).mimeType;
  const encoding = binaryMimeTypes.has(mimeType) ? "base64" : "utf8";
  const content = encoding === "base64" ? bytesToBase64(await file.arrayBuffer()) : await file.text();
  return { path, mimeType, encoding, content };
}

async function selectedSources() {
  const files = [...$("source-folder").files, ...$("source-files").files];
  if (!files.length) return { sources: sampleSources, sourceIngestion: null };
  if (preparedSources) return preparedSources;
  const sources = [];
  const items = [];
  for (const file of files) {
    const path = file.webkitRelativePath || file.name;
    const classification = classifyUploadPath(path, file.type);
    if (classification.disposition !== "ACCEPTED") {
      items.push({ ...classification, size: file.size });
      continue;
    }
    try {
      sources.push(await browserFileSource(file));
      items.push({ ...classification, size: file.size });
    } catch (error) {
      items.push({ ...classification, size: file.size, disposition: "PARSE_FAILED", reasonCode: /15 MB/.test(error.message) ? "SOURCE_SIZE_LIMIT" : "BROWSER_READ_FAILED", riskClass: "REVIEW_REQUIRED" });
    }
  }
  const selectionMode = $("source-folder").files.length && $("source-files").files.length ? "FOLDER_AND_FILES"
    : $("source-folder").files.length ? "FOLDER_SELECTION" : "INDIVIDUAL_FILES";
  const sourceIngestion = provisionalIngestionManifest(items, selectionMode);
  if (!sources.length) throw new Error(`No supported source could be prepared. ${sourceIngestion.excludedCount} file(s) were excluded and ${sourceIngestion.failedCount + sourceIngestion.unsafeCount} require review.`);
  preparedSources = { sources, sourceIngestion };
  $("discovery-status").textContent = `${sourceIngestion.acceptedCount} supported file(s) prepared · ${sourceIngestion.excludedCount} disclosed exclusion(s) · ${sourceIngestion.failedCount + sourceIngestion.unsafeCount} file(s) require review.`;
  return preparedSources;
}

function renderDiscovery(profile, dlpFindings = [], recheck = null) {
  const root = $("discovery-results"); root.replaceChildren();
  const heading = el("div", "discovery-heading");
  heading.append(el("strong", "", "Detected Assessment Intake draft"), el("span", "", `${profile.sourceCount} parsed source(s) · ${dlpFindings.length} local screening indicator(s)`));
  root.append(heading);
  const fields = ["name", "accountableOwner", "intendedPurpose", "expectedValue", "jurisdictions", "roles", "users"];
  const grid = el("div", "discovery-grid");
  for (const field of fields) {
    const fact = profile.fields[field]; const card = el("article", "discovery-fact");
    card.append(el("span", "", label(field)), el("strong", "", fact?.value === null ? "Unknown" : Array.isArray(fact?.value) ? fact.value.join(", ") || "Unknown" : String(fact?.value ?? "Unknown")));
    card.append(badge(fact?.status ?? "UNKNOWN"), el("small", "", fact?.sourceUnitIds?.length ? `${fact.sourceUnitIds.length} cited source unit(s)` : "No documentary source located"));
    grid.append(card);
  }
  root.append(grid);
  if (recheck) {
    root.append(el("p", "discovery-recheck-note", recheck.status === "AVAILABLE_AFTER_APPROVAL"
      ? "AI semantic recheck is available in the authenticated v2 flow after explicit packet and provider approval. It proposes cited candidates only; it never overwrites this deterministic draft."
      : "AI semantic recheck is disabled. Missing fields remain unknown until documented or declared by the user."));
  }
  root.classList.remove("hidden");
}

async function discoverCaseInformation() {
  $("error").classList.add("hidden"); $("discover-button").disabled = true; $("discovery-status").textContent = "Parsing sources locally on the Engine and building cited facts…";
  try {
    const prepared = await selectedSources();
    if (!prepared.sources.length) throw new Error("Select a folder or one or more supported files first.");
    if (!prepared.sources.some((item) => item.mimeType)) {
      const sample = await fetch("/api/sample").then((response) => response.json());
      fillDossier(sample.dossier); $("discovery-status").textContent = "Controlled sample dossier loaded for deterministic calibration."; return;
    }
    const response = await fetch("/api/discover", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(prepared) });
    const body = await response.json(); if (!response.ok) throw new Error(body.detail || body.error || "Source discovery failed");
    fillDossier(body.solutionProfile.suggestedDossier); renderDiscovery(body.solutionProfile, body.dlpFindings, body.discoveryRecheck);
    const unresolved = Object.values(body.solutionProfile.fields).filter((item) => item.status !== "CONFIRMED").length;
    $("discovery-status").textContent = `Draft ready with ${unresolved} unresolved field(s). Confirm or correct the draft; approved v2 runs may use a cited AI recheck.`;
    $("assessment-input").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    $("discovery-status").textContent = "Discovery could not be completed."; $("error").textContent = error.message; $("error").classList.remove("hidden");
  } finally { $("discover-button").disabled = false; }
}

function renderRecommendation(pkg) {
  const root = $("recommendation"); root.className = `recommendation ${pkg.recommendation.outcome}`; root.replaceChildren();
  root.append(el("p", "eyebrow", "Readiness recommendation"), el("h2", "", label(pkg.recommendation.outcome)), el("p", "", pkg.recommendation.rationale));
  if (pkg.publicationGate?.status) root.append(el("p", "recommendation-boundary", `Report quality: ${label(pkg.publicationGate.status)}. This status is independent from lifecycle readiness.`));
  const boundary = el("p", "recommendation-boundary", pkg.recommendation.boundary); root.append(boundary);
}

function renderMetrics(pkg) {
  const values = [["Deterministic controls evaluated", `${pkg.dimensions.assessmentCoverage ?? pkg.dimensions.indicatorCoverage ?? pkg.dimensions.evidenceCoverage}%`], ["Verified evidence", `${pkg.dimensions.verifiedEvidenceCoverage ?? 0}%`], ["Control assurance", `${pkg.dimensions.controlAssurance}%`], ["Assurance deficit", pkg.dimensions.assuranceDeficit ?? pkg.dimensions.residualRisk], ["Risk determination", pkg.dimensions.riskDetermination ?? pkg.dimensions.residualRisk], ["Gate status", pkg.dimensions.gateStatus]];
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
  fillDossier(sample.dossier); sampleSources = sample.sources; preparedSources = null;
  $("folder-summary").textContent = `${sample.sources.length} controlled sample evidence files loaded`;
  $("file-summary").textContent = "No individual files selected";
  $("discovery-status").textContent = "Controlled sample and its dossier are ready for deterministic calibration.";
}

async function runAssessment(event) {
  event.preventDefault(); $("error").classList.add("hidden"); $("progress").classList.remove("hidden"); $("assess-button").disabled = true;
  try {
    const prepared = await selectedSources();
    const response = await fetch("/api/assess", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dossier: dossierFromForm(), ...prepared }) });
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
function printReport() {
  if (!lastPackage) return;
  const previousTitle = document.title;
  const name = lastPackage.assessmentIntake?.identity?.name ?? lastPackage.solution?.name ?? "AI solution";
  document.title = `${name} — Assurance Summary`;
  window.addEventListener("afterprint", () => { document.title = previousTitle; }, { once: true });
  window.print();
}

stageOptions();
function renderKnowledgeDiagnostics(kb, diagnostics) {
  const status = diagnostics?.status ?? "UNKNOWN";
  $("knowledge-status").textContent = `${kb.releaseStatus ?? "UNSPECIFIED"} · ${kb.source} · ${status} · ${kb.version}`;
  const content = $("knowledge-diagnostics-content"); content.replaceChildren();
  const summary = el("div", "knowledge-diagnostics-summary");
  summary.append(el("strong", "", `${kb.source} connection: ${status}`), el("span", "", `${diagnostics?.errorCount ?? 0} error(s) · ${diagnostics?.warningCount ?? 0} warning(s) · manifest ${String(kb.manifestHash ?? "not available").slice(0, 12)}`));
  content.append(summary);
  const issues = diagnostics?.issues ?? [];
  if (!issues.length) content.append(el("p", "", "All configured reference and hash checks passed."));
  else {
    const list = el("ul", "knowledge-diagnostics-issues");
    for (const issue of issues.slice(0, 8)) list.append(el("li", "", `${issue.severity}: ${issue.message}`));
    content.append(list);
  }
  content.append(el("p", "knowledge-diagnostics-note", "The runtime fetches the manifest and referenced JSON documents at startup, verifies configured SHA-256 hashes, validates cross-document IDs, and fails closed on integrity errors. Calibration status remains visible and is not production authority."));
}

Promise.all([
  fetch("/api/knowledge").then((response) => response.json()),
  fetch("/api/config").then((response) => response.json()).catch(() => ({ assuranceSummaryEnabled: true })),
  fetch("/api/knowledge/diagnostics").then((response) => response.json()).catch(() => ({ status: "UNKNOWN", issues: [] }))
]).then(([kb, config, diagnostics]) => {
  renderKnowledgeDiagnostics(kb, diagnostics);
  summaryEnabled = config.assuranceSummaryEnabled !== false;
}).catch(() => { $("knowledge-status").textContent = "Knowledge unavailable"; $("knowledge-diagnostics-content").textContent = "Knowledge connection diagnostics are unavailable."; });
$("sample-button").addEventListener("click", loadSample); $("discover-button").addEventListener("click", discoverCaseInformation); $("dossier-form").addEventListener("submit", runAssessment);
$("summary-tab").addEventListener("click", () => selectView("summary")); $("workspace-tab").addEventListener("click", () => selectView("workspace"));
$("print-button").addEventListener("click", printReport); $("html-button").addEventListener("click", downloadHtml); $("download-button").addEventListener("click", downloadPackage);
$("source-files").addEventListener("change", () => { sampleSources = []; preparedSources = null; $("file-summary").textContent = `${$("source-files").files.length} individual file(s) selected`; });
$("source-folder").addEventListener("change", () => { sampleSources = []; preparedSources = null; $("folder-summary").textContent = `${$("source-folder").files.length} folder file(s) selected`; });
