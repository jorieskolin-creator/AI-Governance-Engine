import { renderAssuranceSummary, standaloneReportHtml } from "/report.js";
import { binaryMimeTypes, classifyUploadPath, provisionalIngestionManifest } from "/upload-types.js";
import { sanitizeRestrictedValue } from "/content-policy.js";

const STAGES = [
  "QUALIFICATION_AND_REGISTRATION", "DESIGN_AND_DEVELOPMENT", "VERIFICATION_AND_VALIDATION",
  "DEPLOYMENT", "OPERATION_AND_MONITORING", "REVIEW_AND_EVALUATION", "RETIREMENT"
];
const ACCESS_MODES = ["UNKNOWN", "INTERNAL_ONLY", "EXTERNAL_WITH_SOLUTION_OWNER", "CONTROLLED_EXTERNAL_PILOT", "RESTRICTED_CUSTOMER_USE", "PUBLIC_ACCESS", "EXTERNAL_UNSPECIFIED"];
let lastPackage = null;
let sampleSources = [];
let summaryEnabled = true;
let preparedSources = null;
let activeRunId = null;
let intakeQuestionnaire = { version: "unavailable", sections: [], questions: [] };
let intakeFieldRegistry = { version: "unavailable", fields: [] };
let latestSolutionProfile = null;
let latestDiscoveryRecheck = null;
let latestDiscoveryContext = null;
let retrievalPlanningProviders = [];
let proposalProviders = [];
let modelReadiness = { status: "UNAVAILABLE", issueCodes: ["MODEL_POLICY_UNAVAILABLE"] };
const editedIntakeFields = new Set();
const prefilledProposalByField = new Map();
const processedProposalIds = new Set();
const acceptedAcquiredCandidateByField = new Map();
const editedAcquiredCandidateByField = new Map();
const declinedAcquiredCandidateByField = new Map();
const intakeControlBaseline = new Map();
let INTAKE_CONTROL_FIELDS = Object.freeze({});
let writeAccess = "OPEN";
let writeUnlocked = false;
let writeUnlockInFlight = null;
let resumingGuardedClick = false;

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
const INTAKE_FLOW_STEPS = ["UPLOAD", "DETERMINISTIC", "AI_VERIFICATION", "USER_RESOLUTION", "ASSESSMENT"];

function isGuardedWriteTarget(target) {
  if (!(target instanceof Element)) return false;
  if (target.closest("#write-access-dialog, #knowledge-diagnostics, #results, #progress, #error, #view-switch, .summary-toolbar")) return false;
  const control = target.closest("input, textarea, select, button, label.upload-box");
  if (!control) return false;
  return Boolean(control.closest("#source-intake, #assessment-input, #intake-approval-dialog"));
}

async function promptWriteAccess() {
  if (writeAccess !== "REQUIRED" || writeUnlocked) return true;
  if (writeUnlockInFlight) return writeUnlockInFlight;
  writeUnlockInFlight = (async () => {
    const dialog = $("write-access-dialog");
    const secret = $("write-access-secret");
    const error = $("write-access-error");
    secret.value = "";
    error.textContent = "";
    if (!dialog.open) dialog.showModal();
    secret.focus();
    return await new Promise((resolve) => {
      const form = $("write-access-form");
      const cancel = $("write-access-cancel");
      const onSubmit = async (event) => {
        event.preventDefault();
        error.textContent = "";
        try {
          const response = await fetch("/api/v2/session", {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ secret: secret.value })
          });
          const body = await response.json();
          if (!response.ok) throw new Error(body.error || "The password is incorrect.");
          writeUnlocked = true;
          cleanup();
          dialog.close();
          resolve(true);
        } catch (err) {
          error.textContent = err.message;
          secret.focus();
          secret.select();
        }
      };
      const finish = (allowed) => {
        cleanup();
        if (dialog.open) dialog.close();
        resolve(allowed);
      };
      const onCancel = () => finish(false);
      const onDialogCancel = (event) => {
        event.preventDefault();
        onCancel();
      };
      function cleanup() {
        form.removeEventListener("submit", onSubmit);
        cancel.removeEventListener("click", onCancel);
        dialog.removeEventListener("cancel", onDialogCancel);
      }
      form.addEventListener("submit", onSubmit);
      cancel.addEventListener("click", onCancel);
      dialog.addEventListener("cancel", onDialogCancel);
    });
  })().finally(() => { writeUnlockInFlight = null; });
  return writeUnlockInFlight;
}

async function ensureWriteAccess() {
  if (writeAccess !== "REQUIRED" || writeUnlocked) return true;
  return promptWriteAccess();
}

function setIntakeFlow(activeStep, { limitedSteps = [] } = {}) {
  const activeIndex = activeStep === null ? INTAKE_FLOW_STEPS.length : INTAKE_FLOW_STEPS.indexOf(activeStep);
  for (const node of $("intake-flow")?.querySelectorAll("[data-intake-step]") ?? []) {
    const index = INTAKE_FLOW_STEPS.indexOf(node.dataset.intakeStep);
    node.classList.toggle("complete", index < activeIndex);
    node.classList.toggle("active", index === activeIndex);
    node.classList.toggle("limited", limitedSteps.includes(node.dataset.intakeStep));
  }
}

function stageOptions() {
  for (const id of ["current-stage", "target-stage"]) {
    const select = $(id);
    const unknown = el("option", "", "Unknown"); unknown.value = "UNKNOWN"; select.append(unknown);
    for (const stage of STAGES) {
      const option = el("option", "", label(stage));
      option.value = stage;
      select.append(option);
    }
  }
  $("current-stage").value = "UNKNOWN";
  $("target-stage").value = "UNKNOWN";
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

function renderQuestionnaire() {
  const root = $("intake-questionnaire"); root.replaceChildren();
  $("questionnaire-version").textContent = intakeQuestionnaire.version ?? "Unknown version";
  for (const section of intakeQuestionnaire.sections ?? []) {
    const details = el("details", "questionnaire-section");
    details.dataset.sectionTitle = section.title;
    details.append(el("summary", "", section.title), el("p", "questionnaire-section-description", section.description));
    const grid = el("div", "questionnaire-grid");
    for (const question of (intakeQuestionnaire.questions ?? []).filter((item) => item.sectionId === section.id)) {
      const card = el("article", "question-card"); card.dataset.questionId = question.id;
      card.append(el("span", "question-prompt", question.prompt));
      if (question.help) card.append(el("span", "question-help", question.help));
      if (question.type === "SINGLE") {
        const select = el("select", "question-answer"); select.dataset.questionId = question.id;
        for (const value of question.options) { const option = el("option", "", label(value)); option.value = value; select.append(option); }
        select.value = "UNKNOWN"; card.append(select);
      } else {
        const options = el("div", "question-options");
        for (const value of question.options) {
          const input = document.createElement("input"); input.type = "checkbox"; input.value = value; input.dataset.questionId = question.id;
          const optionLabel = document.createElement("label"); optionLabel.append(input, document.createTextNode(label(value))); options.append(optionLabel);
        }
        card.append(options);
      }
      if (question.options.includes("NOT_APPLICABLE")) {
        const explanation = el("input", "question-explanation");
        explanation.dataset.questionId = question.id;
        explanation.placeholder = "Explain why this item does not apply to the assessed boundary";
        explanation.setAttribute("aria-label", `${question.prompt} — Not Applicable explanation`);
        explanation.classList.add("hidden");
        card.append(explanation);
      }
      card.append(el("span", "question-evidence-state", "Unknown · no documentary support confirmed"));
      grid.append(card);
    }
    details.append(grid); root.append(details);
  }
  root.addEventListener("change", (event) => {
    if (event.target.type === "checkbox") {
      const card = event.target.closest(".question-card");
      const exclusive = ["UNKNOWN", "NONE_OF_THE_ABOVE"];
      if (event.target.checked && exclusive.includes(event.target.value)) for (const input of card.querySelectorAll('input[type="checkbox"]')) if (input !== event.target) input.checked = false;
      else if (event.target.checked) for (const input of card.querySelectorAll('input[type="checkbox"]')) if (exclusive.includes(input.value)) input.checked = false;
    }
    const card = event.target.closest(".question-card");
    if (card) {
      const question = (intakeQuestionnaire.questions ?? []).find((item) => item.id === card.dataset.questionId);
      const answer = question ? collectedQuestionAnswer(question) : { answerState: "UNKNOWN" };
      const explanation = card.querySelector(".question-explanation");
      if (explanation) {
        explanation.classList.toggle("hidden", answer.answerState !== "NOT_APPLICABLE");
      }
      card.querySelector(".question-evidence-state").textContent = answer.answerState === "UNKNOWN"
        ? "Unknown · no information detected or declared"
        : "Self-Declared · unsupported until documentary evidence is verified";
      const fieldId = `intakeAnswers.${card.dataset.questionId}`;
      const acceptedAcquired = acceptedAcquiredCandidateByField.get(fieldId);
      const field = intakeFieldRegistry.fields.find((item) => item.id === fieldId);
      const value = field?.dataType === "ENUM_ARRAY" ? answer.values : answer.answerState;
      if (acceptedAcquired && !sameIntakeValue(acceptedAcquired.sanitizedCandidate, value)) {
        acceptedAcquiredCandidateByField.delete(fieldId);
        editedAcquiredCandidateByField.set(fieldId, acceptedAcquired);
      }
      renderQuestionProposalDecision(fieldId);
    }
    updateQuestionnaireConditions();
  });
  updateQuestionnaireConditions();
}

function collectedQuestionAnswer(question) {
  const card = document.querySelector(`.question-card[data-question-id="${question.id}"]`);
  if (!card) return { answerState: "UNKNOWN", values: [], explanation: null };
  const explanation = card.querySelector(".question-explanation")?.value.trim() || null;
  if (question.type === "SINGLE") return { answerState: card.querySelector("select")?.value ?? "UNKNOWN", values: [], explanation };
  const values = [...card.querySelectorAll('input[type="checkbox"]:checked')].map((item) => item.value);
  if (!values.length || values.includes("UNKNOWN")) return { answerState: "UNKNOWN", values: values.length ? ["UNKNOWN"] : [], explanation };
  if (values.includes("NONE_OF_THE_ABOVE")) return { answerState: "NO", values: ["NONE_OF_THE_ABOVE"], explanation };
  return { answerState: "YES", values, explanation };
}

function questionnaireAnswerRecord(question, now = new Date().toISOString()) {
  const answer = collectedQuestionAnswer(question);
  const previous = latestSolutionProfile?.assessmentIntakeFacts?.[question.id];
  const unchanged = previous && previous.answerState === answer.answerState && JSON.stringify(previous.value === previous.answerState ? [] : previous.value) === JSON.stringify(answer.values);
  return {
    ...answer,
    origin: unchanged ? previous.origin : "SELF_DECLARED",
    supportStatus: unchanged ? previous.supportStatus : answer.answerState === "UNKNOWN" ? "NOT_CHECKED" : "UNSUPPORTED",
    sourceUnitIds: unchanged ? previous.sourceUnitIds : [], evidenceLinks: unchanged ? previous.evidenceLinks : [],
    limitations: answer.answerState === "UNKNOWN" ? ["No answer was detected or declared."] : unchanged ? previous.limitations : ["Self-Declared information is not documentary evidence."],
    explanation: answer.explanation,
    confirmedBy: answer.answerState === "UNKNOWN" ? null : "USER", confirmedAt: answer.answerState === "UNKNOWN" ? null : now
  };
}

function updateQuestionnaireConditions() {
  for (const question of intakeQuestionnaire.questions ?? []) {
    const card = document.querySelector(`.question-card[data-question-id="${question.id}"]`);
    if (!card) continue;
    const currentAnswer = collectedQuestionAnswer(question);
    const explanation = card.querySelector(".question-explanation");
    if (explanation) {
      explanation.classList.toggle("hidden", currentAnswer.answerState !== "NOT_APPLICABLE");
    }
    if (!question.showWhen) continue;
    const parent = (intakeQuestionnaire.questions ?? []).find((item) => item.id === question.showWhen.questionId);
    const answer = parent ? collectedQuestionAnswer(parent) : { answerState: "UNKNOWN", values: [] };
    const visible = !question.showWhen.answerStates || question.showWhen.answerStates.includes(answer.answerState);
    card.classList.toggle("is-conditional-hidden", !visible);
    if (!visible) {
      card.dataset.conditionAutoHidden = "true";
      const select = card.querySelector("select"); if (select) select.value = "NOT_APPLICABLE";
      for (const input of card.querySelectorAll('input[type="checkbox"]')) input.checked = false;
    } else if (card.dataset.conditionAutoHidden === "true") {
      delete card.dataset.conditionAutoHidden;
      const select = card.querySelector("select"); if (select) select.value = "UNKNOWN";
      card.querySelector(".question-evidence-state").textContent = "Unknown · no information detected or declared";
    }
  }
  for (const details of document.querySelectorAll(".questionnaire-section")) {
    const cards = [...details.querySelectorAll(".question-card:not(.is-conditional-hidden)")];
    const actionCount = cards.filter((card) => {
      const question = (intakeQuestionnaire.questions ?? []).find((item) => item.id === card.dataset.questionId);
      const answer = question ? questionnaireAnswerRecord(question) : { answerState: "UNKNOWN", supportStatus: "NOT_CHECKED" };
      return answer.answerState === "UNKNOWN" || ["UNSUPPORTED", "CONFLICTING", "NOT_CHECKED"].includes(answer.supportStatus);
    }).length;
    const summary = details.querySelector("summary");
    if (summary) summary.textContent = `${details.dataset.sectionTitle} · ${actionCount ? `${actionCount} action${actionCount === 1 ? "" : "s"}` : "complete"}`;
  }
}

function questionnaireAnswers() {
  const now = new Date().toISOString();
  return Object.fromEntries((intakeQuestionnaire.questions ?? []).map((question) => [question.id, questionnaireAnswerRecord(question, now)]));
}

function fillQuestionnaire(answers = {}) {
  for (const question of intakeQuestionnaire.questions ?? []) {
    const answer = answers[question.id]; if (!answer) continue;
    const card = document.querySelector(`.question-card[data-question-id="${question.id}"]`); if (!card) continue;
    if (question.type === "SINGLE") card.querySelector("select").value = answer.answerState ?? "UNKNOWN";
    else for (const input of card.querySelectorAll('input[type="checkbox"]')) input.checked = (answer.values ?? []).includes(input.value);
    const explanation = card.querySelector(".question-explanation");
    if (explanation) explanation.value = answer.explanation ?? "";
    card.querySelector(".question-evidence-state").textContent = `${label(answer.origin ?? "SELF_DECLARED")} · ${label(answer.supportStatus ?? "NOT_CHECKED")} · ${answer.sourceUnitIds?.length ?? 0} cited source unit(s)`;
  }
  updateQuestionnaireConditions();
}

function fillDossier(dossier) {
  editedIntakeFields.clear();
  prefilledProposalByField.clear();
  processedProposalIds.clear();
  acceptedAcquiredCandidateByField.clear();
  editedAcquiredCandidateByField.clear();
  declinedAcquiredCandidateByField.clear();
  latestDiscoveryRecheck = null;
  const boundary = dossier.operatingBoundary ?? {};
  $("name").value = dossier.name ?? ""; $("owner").value = dossier.accountableOwner ?? "";
  $("purpose").value = dossier.intendedPurpose ?? ""; $("value").value = dossier.expectedValue ?? "";
  $("current-stage").value = dossier.lifecycleDeclaration?.currentStage ?? dossier.currentStage ?? "UNKNOWN"; $("target-stage").value = dossier.lifecycleDeclaration?.targetStage ?? dossier.targetStage ?? "UNKNOWN";
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
  fillQuestionnaire(dossier.intakeAnswers ?? {});
  intakeControlBaseline.clear();
  for (const controlId of Object.keys(INTAKE_CONTROL_FIELDS)) intakeControlBaseline.set(controlId, intakeControlValue(controlId));
}

function intakeControlValue(controlId) {
  if (controlId === "data-categories") return JSON.stringify(checkedValues(controlId).sort());
  return String($(controlId)?.value ?? "");
}

function renderIntakeWorkspace(profile, recheck = null) {
  if (!profile) return;
  latestDiscoveryRecheck = recheck ?? latestDiscoveryRecheck;
  const aiByField = new Map((latestDiscoveryRecheck?.candidates ?? []).map((item) => [item.field, item]));
  for (const [controlId, field] of Object.entries(INTAKE_CONTROL_FIELDS)) {
    const control = $(controlId); if (!control) continue;
    const host = control.closest("label") ?? control.closest("fieldset"); if (!host) continue;
    host.querySelector(`.field-provenance[data-field="${field}"]`)?.remove();
    const fact = profile.fields[field];
    const ai = aiByField.get(field);
    const edited = editedIntakeFields.has(field);
    const state = acceptedAcquiredCandidateByField.has(field) ? { tone: "observed", text: "Recovered deterministic candidate selected · editable · enters Intake only on final approval" }
      : editedAcquiredCandidateByField.has(field) ? { tone: "self-declared", text: "Recovered candidate edited by user · treated as Self-Declared" }
        : declinedAcquiredCandidateByField.has(field) ? { tone: "missing", text: "Recovered candidate declined · provide a value or resolve as Unknown / Not Applicable" }
          : prefilledProposalByField.has(field) ? { tone: "review", text: "GenAI proposal prefilled · editable or removable · becomes a user decision only on final approval" }
      : edited ? { tone: "self-declared", text: "Self-Declared · changed by user · V&V lifecycle cap applies" }
      : fact?.status === "CONFLICTING" ? { tone: "conflicting", text: "Conflict · source values require resolution" }
        : ai?.recommendation === "REVIEW_REWRITE" ? { tone: "review", text: "AI wording proposal available · accepting it becomes Self-Declared" }
          : ai?.recommendation === "REVIEW_CANDIDATE" ? { tone: "review", text: "AI source-grounded candidate available · user decision required" }
            : !fact || fact.status === "UNKNOWN" ? { tone: "missing", text: "Missing · submitted material did not establish this information" }
              : fact.factClass === "OBSERVED" ? { tone: "observed", text: `Source-derived · ${fact.sourceUnitIds?.length ?? 0} cited unit(s) · user confirmation required` }
                : fact.factClass === "SELF_DECLARED" ? { tone: "self-declared", text: "Self-Declared · documentary support not established" }
                  : { tone: "missing", text: "Provisional default · verify or provide information" };
    const note = el("span", `field-provenance ${state.tone}`, state.text); note.dataset.field = field; host.append(note);
  }
  const facts = Object.values(profile.fields);
  const declaredFields = new Set(facts.filter((item) => item.factClass === "SELF_DECLARED").map((item) => item.field));
  for (const field of editedIntakeFields) declaredFields.add(field);
  const counts = {
    observed: facts.filter((item) => item.factClass === "OBSERVED" && item.status !== "CONFLICTING").length,
    missing: facts.filter((item) => item.status === "UNKNOWN" && !editedIntakeFields.has(item.field)).length,
    conflicting: facts.filter((item) => item.status === "CONFLICTING").length,
    declared: declaredFields.size
  };
  const summary = $("intake-review-summary"); summary.replaceChildren(
    el("strong", "", "Review exceptions first"),
    el("span", "observed", `${counts.observed} source-derived`),
    el("span", "missing", `${counts.missing} missing`),
    el("span", "conflicting", `${counts.conflicting} conflicting`),
    el("span", "self-declared", `${counts.declared} Self-Declared`)
  );
  for (const question of intakeQuestionnaire.questions ?? []) renderQuestionProposalDecision(`intakeAnswers.${question.id}`);
}

function dossierFromForm() {
  const intakeAnswers = questionnaireAnswers();
  const rolesAnswer = intakeAnswers.REGULATORY_ROLES;
  const prohibitedAnswer = intakeAnswers.PROHIBITED_PRACTICE_CATEGORIES;
  const highRiskAnswerIds = ["ANNEX_III_USE_AREAS", "PRODUCT_SAFETY_COMPONENT", "ANNEX_I_PRODUCT", "THIRD_PARTY_CONFORMITY"];
  const highRiskAnswers = highRiskAnswerIds.map((id) => intakeAnswers[id]).filter(Boolean);
  return {
    name: $("name").value, intendedPurpose: $("purpose").value, expectedValue: $("value").value,
    currentStage: $("current-stage").value, targetStage: $("target-stage").value,
    jurisdictions: commaList($("jurisdictions").value), roles: rolesAnswer?.answerState === "YES" ? rolesAnswer.values.filter((item) => !["OTHER", "NONE_OF_THE_ABOVE", "UNKNOWN"].includes(item)) : commaList($("roles").value), users: commaList($("users").value), accountableOwner: $("owner").value,
    data: { categories: checkedValues("data-categories") },
    exposure: { currentUserAccess: $("current-user-access").value, intendedUserAccess: $("intended-user-access").value, productionAccess: triState("production-access"), consequentialDecisions: triState("consequential") },
    agent: { usesAgents: triState("uses-agents"), canTakeActions: triState("takes-actions"), irreversibleActions: triState("irreversible"), humanOverride: triState("human-override") },
    classification: { prohibitedPractice: prohibitedAnswer?.answerState === "YES" ? true : prohibitedAnswer?.answerState === "NO" ? false : null, highRiskCandidate: highRiskAnswers.some((item) => item.answerState === "YES") ? true : highRiskAnswers.length && highRiskAnswers.every((item) => ["NO", "NOT_APPLICABLE"].includes(item.answerState)) ? false : null },
    intakeAnswers,
    operatingBoundary: {
      allowedUses: lineList($("allowed-uses").value), excludedUses: lineList($("excluded-uses").value), environment: $("boundary-environment").value,
      userScope: $("boundary-users").value, dataScope: $("boundary-data").value, integrationScope: $("boundary-integrations").value,
      permissionScope: $("boundary-permissions").value, autonomyScope: $("boundary-autonomy").value, monitoringOwner: $("boundary-monitoring").value,
      expiresAt: $("boundary-expiry").value || null
    }
  };
}

function comparableIntakeValue(value) {
  if (Array.isArray(value)) return [...value].map((item) => String(item).trim()).filter(Boolean).sort();
  return typeof value === "string" ? value.trim() : value;
}

function sameIntakeValue(left, right) {
  return JSON.stringify(comparableIntakeValue(left)) === JSON.stringify(comparableIntakeValue(right));
}

function proposalMatchesValue(proposalValue, value) {
  if (Array.isArray(value)) return sameIntakeValue(String(proposalValue ?? "").split(/[,;|\n]/).map((item) => item.trim()).filter(Boolean), value);
  if (typeof value === "boolean") return value ? /^(?:yes|true)$/i.test(String(proposalValue).trim()) : /^(?:no|false)$/i.test(String(proposalValue).trim());
  return sameIntakeValue(proposalValue, value);
}

function proposalFieldValue(field, value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (field.dataType === "BOOLEAN") {
    if (/^(?:yes|true)$/i.test(text)) return true;
    if (/^(?:no|false)$/i.test(text)) return false;
    return null;
  }
  if (field.dataType === "ENUM") return field.allowedValues.includes(text) ? text : null;
  if (["ENUM_ARRAY", "STRING_ARRAY"].includes(field.dataType)) {
    const values = text.split(/[,;|\n]/).map((item) => item.trim()).filter(Boolean);
    return values.length && (field.dataType !== "ENUM_ARRAY" || values.every((item) => field.allowedValues.includes(item))) ? values : null;
  }
  return field.dataType === "STRING" ? text : null;
}

function renderQuestionProposalDecision(fieldId) {
  const questionId = fieldId.startsWith("intakeAnswers.") ? fieldId.slice("intakeAnswers.".length) : null;
  const state = questionId ? document.querySelector(`.question-card[data-question-id="${questionId}"] .question-evidence-state`) : null;
  if (!state) return;
  if (acceptedAcquiredCandidateByField.has(fieldId)) state.textContent = "Recovered deterministic candidate selected · editable · enters Intake only on final approval";
  else if (editedAcquiredCandidateByField.has(fieldId)) state.textContent = "Recovered candidate edited by user · treated as Self-Declared";
  else if (declinedAcquiredCandidateByField.has(fieldId)) state.textContent = "Recovered candidate declined · provide a value or resolve as Unknown / Not Applicable";
  else if (prefilledProposalByField.has(fieldId)) state.textContent = "GenAI proposal prefilled · editable or removable · becomes a user decision only on final approval";
}

function applyProposalToIntake(field, value, { focus = true } = {}) {
  if (field.questionId) {
    const card = document.querySelector(`.question-card[data-question-id="${field.questionId}"]`);
    if (!card) return false;
    if (field.dataType === "ENUM") {
      const select = card.querySelector("select"); if (!select) return false;
      select.value = value; select.dispatchEvent(new Event("change", { bubbles: true })); if (focus) select.focus();
    } else {
      const inputs = [...card.querySelectorAll('input[type="checkbox"]')];
      for (const input of inputs) input.checked = value.includes(input.value);
      const changed = inputs.find((input) => input.checked) ?? inputs[0]; if (!changed) return false;
      changed.dispatchEvent(new Event("change", { bubbles: true })); if (focus) changed.focus();
    }
    return true;
  }
  const control = $(field.uiControlId); if (!control) return false;
  if (field.dataType === "ENUM_ARRAY") {
    for (const input of control.querySelectorAll('input[type="checkbox"]')) input.checked = value.includes(input.value);
  } else if (field.dataType === "BOOLEAN") control.value = value ? "YES" : "NO";
  else control.value = Array.isArray(value) ? value.join(", ") : value;
  control.dispatchEvent(new Event("input", { bubbles: true })); if (focus) control.focus();
  return true;
}

function prefillProposalOnce(candidate, field, proposedValue) {
  if (processedProposalIds.has(candidate.id)) return;
  processedProposalIds.add(candidate.id);
  const dossier = dossierFromForm();
  const currentValue = field.questionId ? questionnaireFieldValue(dossier, field) : dossierPathValue(dossier, field.id);
  if (currentValue !== null) return;
  prefilledProposalByField.set(field.id, candidate);
  if (!applyProposalToIntake(field, proposedValue, { focus: false })) prefilledProposalByField.delete(field.id);
}

function dossierPathValue(dossier, path) {
  const value = path.split(".").reduce((item, key) => item?.[key], dossier);
  return value === "UNKNOWN" || value === "" || value === undefined || value === null || Array.isArray(value) && !value.length ? null : value;
}

function questionnaireFieldValue(dossier, field) {
  const answer = dossier.intakeAnswers?.[field.questionId] ?? { answerState: "UNKNOWN", values: [] };
  if (["UNKNOWN", "NOT_APPLICABLE", "HUMAN_REVIEW_REQUIRED"].includes(answer.answerState)) return null;
  return field.dataType === "ENUM_ARRAY" ? answer.values : answer.answerState;
}

function priorFieldValue(field) {
  const fact = field.questionId ? latestSolutionProfile?.assessmentIntakeFacts?.[field.questionId] : latestSolutionProfile?.fields?.[field.id];
  if (!fact) return null;
  if (field.questionId) {
    if (["UNKNOWN", "NOT_APPLICABLE", "HUMAN_REVIEW_REQUIRED"].includes(fact.answerState)) return null;
    return field.dataType === "ENUM_ARRAY" ? fact.value : fact.answerState;
  }
  return fact.value === "UNKNOWN" ? null : fact.value;
}

function fieldIsApplicable(field, dossier) {
  if (!field.applicability) return true;
  const parentId = field.applicability.fieldId.slice("intakeAnswers.".length);
  return field.applicability.answerStates.includes(dossier.intakeAnswers?.[parentId]?.answerState ?? "UNKNOWN");
}

function intakeResolutions(dossier) {
  const decisions = {};
  for (const field of intakeFieldRegistry.fields.filter((item) => fieldIsApplicable(item, dossier))) {
    const fact = field.questionId ? latestSolutionProfile?.assessmentIntakeFacts?.[field.questionId] : latestSolutionProfile?.fields?.[field.id];
    const answer = field.questionId ? dossier.intakeAnswers?.[field.questionId] : null;
    const value = field.questionId ? questionnaireFieldValue(dossier, field) : dossierPathValue(dossier, field.id);
    const proposal = prefilledProposalByField.get(field.id);
    const acquiredCandidate = acceptedAcquiredCandidateByField.get(field.id);
    let resolutionState;
    if (answer?.answerState === "NOT_APPLICABLE") resolutionState = "USER_SELECTED_NOT_APPLICABLE";
    else if (value === null) resolutionState = "USER_SELECTED_UNKNOWN";
    else if ((fact?.status === "CONFLICTING" || fact?.supportStatus === "CONFLICTING") && sameIntakeValue(priorFieldValue(field), value)) resolutionState = "USER_EDITED";
    else if (acquiredCandidate && sameIntakeValue(acquiredCandidate.sanitizedCandidate, value)) resolutionState = "USER_ACCEPTED_ACQUIRED_CANDIDATE";
    else if (proposal && proposalMatchesValue(proposal.value, value)) resolutionState = "USER_ACCEPTED_PROPOSAL";
    else if (sameIntakeValue(priorFieldValue(field), value)) resolutionState = "USER_CONFIRMED";
    else resolutionState = "USER_EDITED";
    decisions[field.id] = {
      resolutionState,
      explanation: answer?.explanation ?? "",
      proposalRef: resolutionState === "USER_ACCEPTED_PROPOSAL" ? proposal.id : null,
      editedProposalRef: proposal && resolutionState === "USER_EDITED" ? proposal.id : null,
      declinedProposalRef: proposal && ["USER_SELECTED_UNKNOWN", "USER_SELECTED_NOT_APPLICABLE"].includes(resolutionState) ? proposal.id : null,
      acquiredCandidateRef: resolutionState === "USER_ACCEPTED_ACQUIRED_CANDIDATE" ? acquiredCandidate.id : null,
      editedAcquiredCandidateRef: editedAcquiredCandidateByField.get(field.id)?.id ?? null,
      declinedAcquiredCandidateRef: declinedAcquiredCandidateByField.get(field.id)?.id ?? null,
      acquiredCandidatePackageHash: acquiredCandidate || editedAcquiredCandidateByField.has(field.id) || declinedAcquiredCandidateByField.has(field.id) ? latestDiscoveryContext.intakeCandidates.packageHash : null
    };
  }
  return decisions;
}

function missingAnalysisFields(dossier) {
  return intakeFieldRegistry.fields
    .filter((field) => field.requirement?.analysis === "VALUE_REQUIRED" && dossierPathValue(dossier, field.id) === null);
}

function requestIntakeApproval(resolutions) {
  const unresolvedCount = Object.values(resolutions).filter((decision) => ["USER_SELECTED_UNKNOWN", "CONFLICT_REQUIRES_RESOLUTION"].includes(decision.resolutionState)).length;
  $("intake-approval-message").textContent = unresolvedCount
    ? `${unresolvedCount} applicable Intake field(s) remain empty or unresolved. You may go back and add information, or accept the gaps and continue. Analysis will treat them as evidence limitations and may produce a lower-readiness outcome.`
    : "All applicable Intake fields are filled. Continue when you are ready to start Analysis.";
  $("confirm-analysis-button").textContent = unresolvedCount ? "Accept and Continue to Analysis" : "Continue to Analysis";
  const dialog = $("intake-approval-dialog");
  dialog.returnValue = "";
  dialog.showModal();
  return new Promise((resolve) => dialog.addEventListener("close", () => resolve(dialog.returnValue === "continue"), { once: true }));
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

function previewSelectedSources() {
  const files = [...$("source-folder").files, ...$("source-files").files];
  const classified = files.map((file) => classifyUploadPath(file.webkitRelativePath || file.name, file.type));
  const accepted = classified.filter((item) => item.disposition === "ACCEPTED").length;
  const exceptions = classified.filter((item) => item.disposition !== "ACCEPTED");
  const details = exceptions.slice(0, 8).map((item) => `${item.path}: ${label(item.reasonCode)}`).join("; ");
  $("discovery-status").textContent = `${files.length} selected · ${accepted} supported · ${exceptions.length} excluded or review-required before submission.${details ? ` ${details}${exceptions.length > 8 ? `; and ${exceptions.length - 8} more` : ""}.` : ""}`;
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
  const sourceContainerCount = sourceIngestion.items.filter((item) => item.reasonCode === "UNSUPPORTED_SOURCE_CONTAINER").length;
  const sourceContainerNotice = sourceContainerCount ? ` ${sourceContainerCount} ZIP archive(s) must be extracted locally and selected as a folder.` : "";
  if (!sources.length) throw new Error(`No supported source could be prepared. ${sourceIngestion.excludedCount} file(s) were excluded and ${sourceIngestion.failedCount + sourceIngestion.unsafeCount} require review.${sourceContainerNotice}`);
  preparedSources = { sources, sourceIngestion };
  $("discovery-status").textContent = `${sourceIngestion.acceptedCount} supported file(s) prepared · ${sourceIngestion.excludedCount} disclosed exclusion(s) · ${sourceIngestion.failedCount + sourceIngestion.unsafeCount} file(s) require review.${sourceContainerNotice}`;
  return preparedSources;
}

function displayIntakeValue(value) {
  if (value === null || value === undefined || value === "" || Array.isArray(value) && !value.length) return "Unknown";
  if (Array.isArray(value)) return value.map(label).join(", ");
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

function applyAcquiredCandidate(candidate) {
  const field = intakeFieldRegistry.fields.find((entry) => entry.id === candidate.fieldId);
  if (!field) return;
  prefilledProposalByField.delete(field.id);
  editedAcquiredCandidateByField.delete(field.id);
  declinedAcquiredCandidateByField.delete(field.id);
  acceptedAcquiredCandidateByField.set(field.id, candidate);
  if (!applyProposalToIntake(field, structuredClone(candidate.sanitizedCandidate))) acceptedAcquiredCandidateByField.delete(field.id);
}

function renderAcquisitionStages(root) {
  const context = latestDiscoveryContext;
  if (!context?.intakeGapAnalysis || !context.intakeCandidates) return;
  const gap = context.intakeGapAnalysis;
  const gapDetails = el("details", "discovery-candidate-details");
  gapDetails.append(el("summary", "", `Deterministic acquisition status · ${gap.summary.presentFieldCount} present · ${gap.summary.conflictingFieldCount} conflicting · ${gap.summary.missingFieldCount} unknown`));
  gapDetails.append(el("p", "field-hint", "These are deterministic search-coverage states, not governance conclusions. Unknown does not mean absent, and a retrieval opportunity does not establish a value."));
  const gapList = el("ul", "discovery-candidates");
  for (const field of gap.fields.filter((item) => item.state !== "PRESENT")) gapList.append(el("li", "", `${label(field.fieldId)} · ${label(field.state)} · ${label(field.retrievalDisposition)}`));
  gapDetails.append(gapList); root.append(gapDetails);

  const retrieval = context.retrievalPlan;
  if (retrieval) {
    const details = el("details", "discovery-candidate-details");
    details.open = retrieval.status === "COMPLETED" && !context.localReread;
    details.append(el("summary", "", `GenAI retrieval suggestions · ${label(retrieval.status)}`));
    details.append(el("p", "field-hint", "Retrieval suggestions are not evidence, field values, classifications, findings, or approvals. They can only guide one separately confirmed local re-read."));
    const list = el("ul", "discovery-candidates");
    for (const suggestion of retrieval.plan?.suggestions ?? []) list.append(el("li", "", `${label(suggestion.fieldId)} · concepts: ${suggestion.searchConcepts.join(", ") || "none"} · aliases: ${suggestion.labelAliases.join(", ") || "none"} · local strategies: ${suggestion.extractionStrategies.map(label).join(", ") || "none"}`));
    if (retrieval.failureCode) list.append(el("li", "", `Unavailable: ${label(retrieval.failureCode)}. No suggestion was executed and deterministic gaps remain unchanged.`));
    details.append(list); root.append(details);
  }

  const reread = context.localReread;
  if (!reread) return;
  const candidateByField = new Map(context.intakeCandidates.candidates.map((candidate) => [candidate.fieldId, candidate]));
  const details = el("details", "discovery-candidate-details"); details.open = true;
  details.append(el("summary", "", `Local re-read candidates · ${reread.recoveredFieldIds.length} recovered · ${reread.conflictingFieldIds.length} conflicting · ${reread.remainingUnknownFieldIds.length} still unknown`));
  details.append(el("p", "field-hint", "This bounded pass stayed local. Results are validated candidates—not approved Intake—and require an explicit selection below plus final user approval."));
  const list = el("ul", "discovery-candidates acquisition-results");
  for (const fieldId of reread.recoveredFieldIds) {
    const candidate = candidateByField.get(fieldId);
    if (!candidate) continue;
    const item = el("li", "", `${label(fieldId)} · Recovered deterministic candidate · ${displayIntakeValue(candidate.sanitizedCandidate)} · ${label(candidate.confidence)} confidence · ${candidate.sourceRefs.length} local source reference(s).`);
    const apply = el("button", "candidate-apply-button", acceptedAcquiredCandidateByField.has(fieldId) ? "Candidate selected" : "Use candidate"); apply.type = "button";
    apply.disabled = acceptedAcquiredCandidateByField.has(fieldId);
    apply.addEventListener("click", () => { applyAcquiredCandidate(candidate); renderDiscovery(context.profile, context.dlpFindings, context.recheck, context.citationIndex, context.acquisitionDiagnostics); });
    const decline = el("button", "candidate-decline-button", declinedAcquiredCandidateByField.has(fieldId) ? "Candidate declined" : "Decline candidate"); decline.type = "button";
    decline.disabled = declinedAcquiredCandidateByField.has(fieldId);
    decline.addEventListener("click", () => {
      acceptedAcquiredCandidateByField.delete(fieldId);
      editedAcquiredCandidateByField.delete(fieldId);
      declinedAcquiredCandidateByField.set(fieldId, candidate);
      renderDiscovery(context.profile, context.dlpFindings, context.recheck, context.citationIndex, context.acquisitionDiagnostics);
    });
    item.append(apply, decline); list.append(item);
  }
  for (const fieldId of reread.conflictingFieldIds) {
    const candidate = candidateByField.get(fieldId);
    const field = intakeFieldRegistry.fields.find((entry) => entry.id === fieldId);
    const item = el("li", "", `${label(fieldId)} · Conflict · ${candidate?.conflicts.length ?? 0} source-derived options require user resolution. No option is preselected.`);
    for (const value of candidate?.conflicts ?? []) {
      const use = el("button", "candidate-decline-button", `Use ${displayIntakeValue(value)}`); use.type = "button";
      use.addEventListener("click", () => {
        acceptedAcquiredCandidateByField.delete(fieldId);
        if (field) applyProposalToIntake(field, structuredClone(value));
      });
      item.append(use);
    }
    list.append(item);
  }
  if (reread.remainingUnknownFieldIds.length) list.append(el("li", "", `${reread.remainingUnknownFieldIds.map(label).join(", ")} · remain Unknown; the bounded pass did not establish values.`));
  details.append(list); root.append(details);
}

function updateAcquisitionActions() {
  const context = latestDiscoveryContext;
  const privacyBlocked = context?.dlpFindings?.some((item) => item.blocking) ?? true;
  const planAvailable = !privacyBlocked && !context?.retrievalPlan && (context?.intakeGapAnalysis?.summary?.boundedRetrievalFieldCount ?? 0) > 0 && retrievalPlanningProviders.length > 0;
  $("request-retrieval-plan").classList.toggle("hidden", !planAvailable);
  $("request-retrieval-plan").disabled = false;
  const rereadAvailable = context?.status === "AWAITING_INTAKE_CONFIRMATION"
    && context?.stage === "DETERMINISTIC_DISCOVERY_COMPLETED"
    && context?.retrievalPlan?.status === "COMPLETED"
    && !context?.localReread
    && !context?.recheck;
  $("execute-local-reread").classList.toggle("hidden", !rereadAvailable);
  $("execute-local-reread").disabled = false;
}

function renderSourceIngestionExceptions(root) {
  const exceptions = latestDiscoveryContext?.sourceIngestion?.items?.filter((item) => item.disposition !== "PARSED") ?? [];
  if (!exceptions.length) return;
  const details = el("details", "discovery-candidate-details");
  details.append(el("summary", "", `Review ${exceptions.length} source ingestion exception(s)`));
  details.append(el("p", "field-hint", "These files were not parsed into evidence. Their source-level limitations do not automatically apply to every Intake field."));
  const list = el("ul", "discovery-candidates");
  for (const item of exceptions) list.append(el("li", "", `${item.path} · ${label(item.disposition)} · ${label(item.reasonCode)}`));
  details.append(list); root.append(details);
}

function renderDiscovery(profile, dlpFindings = [], recheck = null, citationIndex = [], acquisitionDiagnostics = null) {
  latestSolutionProfile = profile;
  const citations = new Map(citationIndex.map((item) => [item.sourceUnitId, item]));
  const root = $("discovery-results"); root.replaceChildren();
  const heading = el("div", "discovery-heading");
  heading.append(el("strong", "", "Detected Assessment Intake draft"), el("span", "", `${profile.sourceCount} parsed source(s) · ${dlpFindings.length} local screening indicator(s)`));
  root.append(heading);
  if (acquisitionDiagnostics) {
    const counts = acquisitionDiagnostics.counts;
    const diagnostics = el("div", "discovery-fact");
    diagnostics.append(
      el("strong", "", "Evidence acquisition diagnostics"),
      el("span", "", `${counts.SELECTED} selected · ${counts.ACCEPTED} accepted · ${counts.PARSED} parsed · ${counts.CONTENT_EXTRACTED} content-extracted · ${counts.INTAKE_USEFUL} Intake-useful · ${counts.EXCLUDED} excluded · ${counts.FAILED} failed · ${counts.PRIVACY_BLOCKED} privacy-blocked`),
      el("small", "", `Technical loss: ${acquisitionDiagnostics.technicalLoss.count} source(s) (${acquisitionDiagnostics.technicalLoss.partialSourceCount} partially extracted, ${acquisitionDiagnostics.technicalLoss.unavailableSourceCount} unavailable). Genuine source silence: ${acquisitionDiagnostics.sourceSilence.count} source(s). GenAI: ${label(acquisitionDiagnostics.genAi.status)}.`)
    );
    root.append(diagnostics);
  }
  renderSourceIngestionExceptions(root);
  const fields = ["name", "accountableOwner", "intendedPurpose", "expectedValue", "jurisdictions", "roles", "users"];
  const grid = el("div", "discovery-grid");
  for (const field of fields) {
    const fact = profile.fields[field]; const card = el("article", "discovery-fact");
    card.append(el("span", "", label(field)), el("strong", "", fact?.value === null ? "Unknown" : Array.isArray(fact?.value) ? fact.value.join(", ") || "Unknown" : String(fact?.value ?? "Unknown")));
    const sourceText = fact?.sourceUnitIds?.length ? fact.sourceUnitIds.map((id) => citations.get(id)).filter(Boolean).map((item) => `${item.path} · ${item.locator}`).join("; ") || `${fact.sourceUnitIds.length} cited source unit(s)` : "No documentary source located";
    card.append(badge(fact?.status ?? "UNKNOWN"), el("small", "", sourceText));
    grid.append(card);
  }
  root.append(grid);
  renderAcquisitionStages(root);
  if (latestDiscoveryContext?.packets?.length) {
    const safePackage = el("details", "discovery-candidate-details");
    const modelRouteAvailable = proposalProviders.length > 0;
    safePackage.append(el("summary", "", modelRouteAvailable ? "Review safe package available for optional GenAI proposals" : "Review safe package · GenAI proposal route unavailable"));
    const description = el("p", "field-hint", modelRouteAvailable
      ? "Only these deterministic summaries can be sent by the optional proposal action. Raw documents, code, table values and image pixels remain local."
      : `The privacy-safe package is ready, but no configured Solution Understanding model route has an available credential (${(modelReadiness.issueCodes ?? [modelReadiness.status]).map(label).join(", ")}). No provider call can be made. Raw documents, code, table values and image pixels remain local.`);
    const units = el("ul", "discovery-candidates");
    for (const packet of latestDiscoveryContext.packets) for (const unit of packet.preview ?? []) units.append(el("li", "", `${unit.path} · ${unit.locator}: ${unit.excerpt}`));
    safePackage.append(description, units);
    const eligibleFacts = latestDiscoveryContext.acquiredFacts?.facts?.filter((fact) => fact.genAiEligibility === "ELIGIBLE_CONTROLLED_VALUE") ?? [];
    if (eligibleFacts.length) {
      safePackage.append(el("p", "field-hint", "Optional controlled facts are excluded unless you select them below. Free text, unknowns, conflicts and unsupported values cannot be selected."));
      const selections = el("div", "acquired-fact-selections");
      for (const fact of eligibleFacts) {
        const input = document.createElement("input"); input.type = "checkbox"; input.value = fact.id; input.dataset.acquiredFactId = fact.id;
        input.checked = latestDiscoveryContext.selectedAcquiredFactIds?.includes(fact.id) ?? false;
        const value = Array.isArray(fact.value) ? fact.value.map(label).join(", ") : typeof fact.value === "boolean" ? (fact.value ? "Yes" : "No") : label(fact.value);
        const option = document.createElement("label"); option.append(input, document.createTextNode(`${label(fact.fieldId)}: ${value}`)); selections.append(option);
      }
      safePackage.append(selections);
    }
    root.append(safePackage);
  }
  if (recheck) {
    const acceptedCount = recheck.candidates?.filter((item) => item.recommendation === "ACCEPT_CURRENT").length ?? 0;
    const actionCandidates = recheck.candidates?.filter((item) => item.recommendation !== "ACCEPT_CURRENT") ?? [];
    const message = recheck.status === "COMPLETED"
      ? `AI Intake proposals completed: ${acceptedCount} current value(s) supported as written; ${actionCandidates.length} field(s) need review or more information. Supported proposals are prefilled only into empty fields and remain editable or removable until final approval.`
      : recheck.status === "BLOCKED_BY_LOCAL_DLP"
        ? "AI semantic recheck was blocked by local source screening. Missing fields remain unknown until documented or declared by the user."
        : `AI semantic recheck is unavailable: ${label(recheck.failureCode ?? recheck.status)}. The deterministic intake draft remains available.`;
    root.append(el("p", "discovery-recheck-note", message));
    if (actionCandidates.length) {
      const details = el("details", "discovery-candidate-details");
      details.append(el("summary", "", `Review ${actionCandidates.length} AI verification exception(s)`));
      const candidates = el("ul", "discovery-candidates");
      for (const candidate of actionCandidates) {
        const displayedValue = candidate.value || (candidate.recommendation === "PROVIDE_INFORMATION" ? "Information not found in submitted material" : "No usable proposal");
        const item = el("li", "", `${label(candidate.field)} · ${label(candidate.recommendation)}: ${displayedValue}. ${candidate.rationale}`);
        const field = intakeFieldRegistry.fields.find((entry) => entry.id === candidate.field);
        const proposedValue = field ? proposalFieldValue(field, candidate.value) : null;
        const actionable = field?.genAiProposalAllowed === true && candidate.status === "CANDIDATE" && ["REVIEW_REWRITE", "REVIEW_CANDIDATE"].includes(candidate.recommendation) && proposedValue !== null;
        if (actionable) prefillProposalOnce(candidate, field, proposedValue);
        candidates.append(item);
        if (candidate.field?.startsWith("intakeAnswers.")) {
          const questionId = candidate.field.slice("intakeAnswers.".length);
          const card = document.querySelector(`.question-card[data-question-id="${questionId}"]`);
          if (card) {
            card.querySelector(".question-candidate")?.remove();
            const note = el("div", "question-candidate", `AI verification: ${label(candidate.recommendation)} · ${displayedValue} · ${candidate.sourceUnitIds?.length ?? 0} cited unit(s). Review and select the answer yourself.`);
            card.append(note);
          }
        }
      }
      details.append(candidates);
      root.append(details);
    }
  }
  renderIntakeWorkspace(profile, recheck);
  updateAcquisitionActions();
  root.classList.remove("hidden");
}

async function discoverCaseInformation() {
  $("error").classList.add("hidden"); $("discover-button").disabled = true; $("assess-button").disabled = true;
  for (const id of ["request-retrieval-plan", "execute-local-reread", "request-ai-proposals"]) $(id).classList.add("hidden");
  setIntakeFlow("DETERMINISTIC");
  $("discovery-status").textContent = "Stage 2 of 5 · Parsing sources locally and building deterministic cited facts…";
  try {
    const prepared = await selectedSources();
    if (!prepared.sources.length) throw new Error("Select a folder or one or more supported files first.");
    const preflight = await postJson("/api/v2/runs/preflight", prepared);
    activeRunId = preflight.runId;
    latestSolutionProfile = preflight.solutionProfile;
    latestDiscoveryContext = {
      profile: preflight.solutionProfile,
      status: preflight.status,
      stage: preflight.stage,
      dlpFindings: preflight.dlpFindings,
      citationIndex: preflight.citationIndex,
      packets: preflight.packets,
      intakeCandidates: preflight.intakeCandidates,
      acquiredFacts: preflight.acquiredFacts,
      sourceIngestion: preflight.sourceIngestion,
      acquisitionDiagnostics: preflight.acquisitionDiagnostics,
      intakeGapAnalysis: preflight.intakeGapAnalysis,
      retrievalPlan: preflight.retrievalPlan,
      localReread: preflight.localReread,
      recheck: preflight.discoveryRecheck,
      selectedAcquiredFactIds: []
    };
    fillDossier(preflight.solutionProfile.suggestedDossier);
    renderDiscovery(preflight.solutionProfile, preflight.dlpFindings, null, preflight.citationIndex, preflight.acquisitionDiagnostics);
    const blocked = preflight.dlpFindings.some((item) => item.blocking);
    $("request-ai-proposals").classList.toggle("hidden", blocked || proposalProviders.length === 0);
    $("request-ai-proposals").disabled = blocked || proposalProviders.length === 0;
    setIntakeFlow("USER_RESOLUTION", { limitedSteps: ["AI_VERIFICATION"] });
    const unresolved = Object.values(preflight.solutionProfile.fields).filter((item) => item.status !== "CONFIRMED").length;
    $("discovery-status").textContent = blocked
      ? `Stage 4 of 5 · Deterministic draft ready with ${unresolved} unresolved field(s). Local screening blocks GenAI transmission; resolve the Intake manually.`
      : proposalProviders.length
        ? `Stage 4 of 5 · Deterministic draft ready with ${unresolved} unresolved field(s). Resolve it manually or explicitly request optional GenAI proposals from safe summaries.`
        : `Stage 4 of 5 · Deterministic draft ready with ${unresolved} unresolved field(s). GenAI proposals are unavailable because no configured Reasoner route has an available credential; resolve the Intake manually.`;
    $("assess-button").disabled = false;
    $("assessment-input").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    $("discovery-status").textContent = "Discovery could not be completed."; $("error").textContent = error.message; $("error").classList.remove("hidden");
  } finally { $("discover-button").disabled = false; }
}

async function refreshDiscoveryContext() {
  const view = await postJson(`/api/v2/runs/${encodeURIComponent(activeRunId)}/discover`);
  latestDiscoveryContext = {
    ...latestDiscoveryContext,
    profile: view.solutionProfile,
    status: view.status,
    stage: view.stage,
    dlpFindings: view.dlpFindings,
    citationIndex: view.citationIndex,
    intakeCandidates: view.intakeCandidates,
    acquiredFacts: view.acquiredFacts,
    acquisitionDiagnostics: view.acquisitionDiagnostics,
    intakeGapAnalysis: view.intakeGapAnalysis,
    retrievalPlan: view.retrievalPlan,
    localReread: view.localReread,
    recheck: view.discoveryRecheck
  };
  return latestDiscoveryContext;
}

async function requestRetrievalPlan() {
  if (!activeRunId || !latestDiscoveryContext || !retrievalPlanningProviders.length) return;
  const providers = [...retrievalPlanningProviders];
  if (!window.confirm(`Request suggestion-only retrieval planning from the configured ${providers.map(label).join(", ")} Workhorse route(s)? Only safe metrics, field definitions, artifact classes and controlled topic signals will be sent. No source content or candidate value will be sent.`)) return;
  $("error").classList.add("hidden"); $("request-retrieval-plan").disabled = true;
  $("discovery-status").textContent = "Requesting bounded retrieval suggestions from safe metrics only…";
  try {
    await postJson(`/api/v2/runs/${encodeURIComponent(activeRunId)}/retrieval-plan`, {
      confirmed: true,
      purpose: "INTAKE_RETRIEVAL_PLANNING_FROM_SAFE_METRICS",
      gapAnalysisHash: latestDiscoveryContext.intakeGapAnalysis.analysisHash,
      providers
    });
    const context = await refreshDiscoveryContext();
    renderDiscovery(context.profile, context.dlpFindings, context.recheck, context.citationIndex, context.acquisitionDiagnostics);
    $("discovery-status").textContent = context.retrievalPlan?.status === "COMPLETED"
      ? "Retrieval suggestions are ready for review. They are not evidence and have not been executed."
      : `Retrieval planning is ${label(context.retrievalPlan?.status ?? "UNAVAILABLE").toLowerCase()}; deterministic gaps remain unchanged.`;
  } catch (error) {
    $("error").textContent = error.message; $("error").classList.remove("hidden");
  } finally { $("request-retrieval-plan").disabled = false; }
}

async function executeLocalReread() {
  const plan = latestDiscoveryContext?.retrievalPlan?.plan;
  if (!activeRunId || !plan || latestDiscoveryContext?.recheck || latestDiscoveryContext?.stage !== "DETERMINISTIC_DISCOVERY_COMPLETED") {
    $("execute-local-reread").classList.add("hidden");
    return;
  }
  if (!window.confirm("Run exactly one bounded local re-read using the reviewed suggestions? Raw sources stay local, no provider call is permitted, and every result re-enters screening, validation, and hashing.")) return;
  $("error").classList.add("hidden"); $("execute-local-reread").disabled = true;
  $("discovery-status").textContent = "Running one bounded local re-read and rebuilding validated candidate diagnostics…";
  try {
    await postJson(`/api/v2/runs/${encodeURIComponent(activeRunId)}/retrieval-plan/execute`, {
      confirmed: true,
      purpose: "EXECUTE_VALIDATED_RETRIEVAL_PLAN_LOCALLY",
      planHash: plan.planHash
    });
    const context = await refreshDiscoveryContext();
    renderDiscovery(context.profile, context.dlpFindings, context.recheck, context.citationIndex, context.acquisitionDiagnostics);
    $("discovery-status").textContent = `Local re-read complete: ${context.localReread.recoveredFieldIds.length} recovered candidate(s), ${context.localReread.conflictingFieldIds.length} conflict(s), ${context.localReread.remainingUnknownFieldIds.length} remaining unknown(s). No value was selected or approved automatically.`;
  } catch (error) {
    $("error").textContent = error.message; $("error").classList.remove("hidden");
  } finally { $("execute-local-reread").disabled = false; }
}

async function requestAiProposals() {
  if (!activeRunId || !latestDiscoveryContext) return;
  $("error").classList.add("hidden");
  $("request-ai-proposals").disabled = true;
  setIntakeFlow("AI_VERIFICATION");
  $("discovery-status").textContent = "Stage 3 of 5 · Sending only the reviewable safe summaries for optional GenAI proposals…";
  let recheck;
  try {
    const selectedAcquiredFactIds = [...document.querySelectorAll("[data-acquired-fact-id]:checked")].map((input) => input.value);
    latestDiscoveryContext.selectedAcquiredFactIds = selectedAcquiredFactIds;
    recheck = await postJson(`/api/v2/runs/${encodeURIComponent(activeRunId)}/discover-recheck`, {
      confirmed: true,
      purpose: "INTAKE_PROPOSALS_FROM_SAFE_SUMMARIES",
      acquiredFactPackageHash: latestDiscoveryContext.acquiredFacts.packageHash,
      selectedAcquiredFactIds
    });
  } catch {
    recheck = { status: "UNAVAILABLE", failureCode: "INTAKE_AI_VERIFICATION_REQUEST_FAILED" };
  }
  latestDiscoveryContext.recheck = recheck;
  renderDiscovery(latestDiscoveryContext.profile, latestDiscoveryContext.dlpFindings, recheck, latestDiscoveryContext.citationIndex, latestDiscoveryContext.acquisitionDiagnostics);
  const completed = recheck.status === "COMPLETED";
  setIntakeFlow("USER_RESOLUTION", { limitedSteps: completed ? [] : ["AI_VERIFICATION"] });
  $("request-ai-proposals").classList.add("hidden");
  $("discovery-status").textContent = completed
    ? "Stage 4 of 5 · Supported GenAI proposals were prefilled into empty Intake fields. Edit or remove them as needed; only final approval accepts the filled information and starts analysis."
    : `Stage 4 of 5 · GenAI proposals were ${label(recheck.status).toLowerCase()}. Continue resolving the deterministic Intake manually.`;
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
  pkg = sanitizeRestrictedValue(pkg);
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
  fillDossier(sample.dossier);
  latestSolutionProfile = null;
  sampleSources = sample.sources.map((source) => ({
    ...source,
    mimeType: source.path.endsWith(".json") ? "application/json" : source.path.endsWith(".js") ? "application/javascript" : "text/markdown",
    encoding: "utf8"
  }));
  preparedSources = null; activeRunId = null;
  latestDiscoveryContext = null;
  for (const id of ["request-retrieval-plan", "execute-local-reread", "request-ai-proposals"]) $(id).classList.add("hidden");
  $("assess-button").disabled = true; setIntakeFlow("UPLOAD");
  $("folder-summary").textContent = `${sample.sources.length} controlled sample evidence files loaded`;
  $("file-summary").textContent = "No individual files selected";
  $("discovery-status").textContent = "Controlled sample loaded. Discover case information to run the same source-first AI workflow.";
}

function setProgress(title, detail) {
  $("progress-title").textContent = title;
  $("progress-detail").textContent = detail;
}

function progressText(run) {
  const domain = Object.entries(run.domainProgress ?? {}).find(([, value]) => value.status === "RUNNING")?.[0];
  if (domain) return `Assessing governance domain ${domain}.`;
  return {
    PREFLIGHT: "Screening sources and creating redacted evidence packets.",
    INTAKE_CONFIRMED: "Preparing verified solution understanding.",
    COGNITIVE_EXECUTION_QUEUED: "Waiting for an available cognitive execution worker.",
    COGNITIVE_EXECUTION_STARTING: "Starting the claimed cognitive execution attempt.",
    SOLUTION_UNDERSTANDING: "Building and independently verifying solution understanding.",
    PACKET_ROUTING: "Routing redacted evidence to governance domains.",
    DOMAIN_ASSESSMENT: "Assessing A–F governance evidence.",
    EVIDENCE_VERIFICATION: "Independently verifying candidate claims.",
    CONTROLLED_SYNTHESIS: "Writing a summary from locked findings only.",
    FINAL_FACT_CHECK: "Fact-checking the decision-ready narrative.",
    COMPLETED: "Cognitive assessment completed."
  }[run.stage] ?? "Processing the evidence-gated assessment.";
}

async function postJson(path, body = undefined, retried = false) {
  const response = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const value = await response.json();
  if (!retried && response.status === 401 && value.failureCode === "WRITE_ACCESS_REQUIRED" && await ensureWriteAccess()) {
    return postJson(path, body, true);
  }
  if (!response.ok) throw new Error(requestFailureMessage(value));
  return value;
}

function requestFailureMessage(value) {
  const message = value.detail || value.error || "Cognitive assessment failed";
  const code = value.failureCode ? ` (${label(value.failureCode)})` : "";
  const readiness = value.readiness ?? (value.failureCode === "MODEL_ROUTE_UNAVAILABLE" ? modelReadiness : null);
  if (!readiness || readiness.status === "READY") return `${message}${code}`;
  const issues = (readiness.issueCodes ?? []).map(label).join(", ");
  return `${message}${code} Model readiness: ${label(readiness.status)}${issues ? ` (${issues})` : ""}.`;
}

async function waitForRun(runId) {
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const response = await fetch(`/api/v2/runs/${encodeURIComponent(runId)}`);
    const run = await response.json();
    if (!response.ok) throw new Error(run.detail || run.error || "Cognitive run status is unavailable");
    setProgress("Evidence-gated AI analysis", progressText(run));
    if (run.status === "COMPLETED") return run;
    if (["FAILED", "PURGED", "CANCELLED", "INTERRUPTED", "RECOVERY_REQUIRES_REUPLOAD"].includes(run.status)) throw new Error(`${run.error || "Cognitive analysis did not complete."}${run.failureCode ? ` (${label(run.failureCode)})` : ""}`);
    await new Promise((resolve) => window.setTimeout(resolve, 1200));
  }
  throw new Error("Cognitive analysis exceeded the browser waiting limit. The server may still be processing the run.");
}

async function runAssessment(event) {
  event.preventDefault(); $("error").classList.add("hidden"); $("assess-button").disabled = true;
  try {
    if (!activeRunId) throw new Error("Complete deterministic discovery before starting the A–F assessment.");
    await selectedSources();
    const dossier = dossierFromForm();
    for (const id of ["name", "owner"]) $(id).removeAttribute("aria-invalid");
    const missing = missingAnalysisFields(dossier);
    if (missing.length) {
      for (const field of missing) $(field.uiControlId)?.setAttribute("aria-invalid", "true");
      const first = $(missing[0].uiControlId);
      first?.focus(); first?.scrollIntoView({ behavior: "smooth", block: "center" });
      throw new Error(`Complete the two required Intake fields before analysis: ${missing.map((field) => label(field.id)).join(", ")}.`);
    }
    const resolutions = intakeResolutions(dossier);
    if (!await requestIntakeApproval(resolutions)) return;
    $("progress").classList.remove("hidden");
    setProgress("Preparing AI analysis", "Local screening is complete. Redacted evidence will be analysed by the Engine’s configured providers.");
    const currentRunResponse = await fetch(`/api/v2/runs/${encodeURIComponent(activeRunId)}`);
    const currentRun = await currentRunResponse.json();
    if (!currentRunResponse.ok) throw new Error(requestFailureMessage(currentRun));
    if (currentRun.status === "RECOVERY_REQUIRES_REUPLOAD" || currentRun.recovery?.requiresReupload) {
      throw new Error(currentRun.error || "Raw evidence is unavailable after recovery. Re-upload source material to create a new Intake draft.");
    }
    const postApproval = currentRun.status === "AWAITING_TRANSMISSION_APPROVAL" || ["QUEUED", "RUNNING", "COMPLETED"].includes(currentRun.status);
    if (currentRun.stage !== "INTAKE_CONFIRMED" && !postApproval) {
      await postJson(`/api/v2/runs/${encodeURIComponent(activeRunId)}/confirm`, {
        dossier,
        resolutions,
        approval: { confirmed: true, actorRef: "INTERACTIVE_USER" }
      });
    }
    setIntakeFlow("ASSESSMENT");
    if (["QUEUED", "RUNNING"].includes(currentRun.status)) {
      await waitForRun(activeRunId);
    } else if (currentRun.status !== "COMPLETED") {
      await postJson(`/api/v2/runs/${encodeURIComponent(activeRunId)}/execute`);
      await waitForRun(activeRunId);
    }
    const response = await fetch(`/api/v2/runs/${encodeURIComponent(activeRunId)}/result`);
    const body = await response.json(); if (!response.ok) throw new Error(body.detail || body.error || "Cognitive result is unavailable");
    renderPackage(body);
    setIntakeFlow(null);
    activeRunId = null;
  } catch (error) { $("error").textContent = error.message; $("error").classList.remove("hidden"); }
  finally { $("progress").classList.add("hidden"); $("assess-button").disabled = activeRunId === null; }
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
  $("knowledge-status").textContent = `${kb.playbookStatus === "APPROVED" && kb.assessmentObjectsStatus === "NOT_PUBLISHED" ? "Playbook approved · objects unpublished" : (kb.releaseStatus ?? "UNSPECIFIED")} · ${kb.source} · ${status} · ${kb.version}`;
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
  content.append(el("p", "knowledge-diagnostics-note", "The runtime fetches the manifest and referenced JSON documents at startup, verifies configured SHA-256 hashes, validates cross-document IDs, and fails closed on integrity errors. The approved Playbook is loaded; capability and anti-pattern Knowledge Base objects remain the unpublished gap."));
}

Promise.all([
  fetch("/api/knowledge").then((response) => response.json()),
  fetch("/api/config").then((response) => response.json()).catch(() => ({ assuranceSummaryEnabled: true })),
  fetch("/api/knowledge/diagnostics").then((response) => response.json()).catch(() => ({ status: "UNKNOWN", issues: [] })),
  fetch("/api/intake-questionnaire").then((response) => response.json()).catch(() => ({ version: "unavailable", sections: [], questions: [] })),
  fetch("/api/intake-field-registry").then((response) => {
    if (!response.ok) throw new Error("Intake field registry is unavailable");
    return response.json();
  }),
  fetch("/api/v2/models").then((response) => response.ok ? response.json() : { profiles: [] }).catch(() => ({ profiles: [] })),
  fetch("/api/v2/session").then((response) => response.ok ? response.json() : { writeAccess: "OPEN", unlocked: true }).catch(() => ({ writeAccess: "OPEN", unlocked: true }))
]).then(([kb, config, diagnostics, questionnaire, registry, models, session]) => {
  renderKnowledgeDiagnostics(kb, diagnostics);
  summaryEnabled = config.assuranceSummaryEnabled !== false;
  writeAccess = session.writeAccess === "REQUIRED" || config.writeAccess === "REQUIRED" ? "REQUIRED" : "OPEN";
  writeUnlocked = writeAccess === "OPEN" || session.unlocked === true;
  intakeQuestionnaire = questionnaire;
  intakeFieldRegistry = registry;
  modelReadiness = models.readiness ?? modelReadiness;
  retrievalPlanningProviders = [...new Set((models.profiles ?? []).filter((profile) => profile.stage === "RETRIEVAL_PLANNING" && profile.credentialAvailable).map((profile) => profile.provider))];
  proposalProviders = [...new Set((models.profiles ?? []).filter((profile) => profile.stage === "SOLUTION_UNDERSTANDING" && profile.credentialAvailable).map((profile) => profile.provider))];
  INTAKE_CONTROL_FIELDS = Object.freeze(Object.fromEntries(registry.fields.filter((field) => field.uiControlId).map((field) => {
    if (!$(field.uiControlId)) throw new Error(`Registered Intake control is missing: ${field.uiControlId}`);
    return [field.uiControlId, field.id];
  })));
  renderQuestionnaire();
}).catch(() => { $("knowledge-status").textContent = "Knowledge unavailable"; $("knowledge-diagnostics-content").textContent = "Knowledge connection diagnostics are unavailable."; });
$("sample-button").addEventListener("click", loadSample); $("discover-button").addEventListener("click", discoverCaseInformation); $("request-retrieval-plan").addEventListener("click", requestRetrievalPlan); $("execute-local-reread").addEventListener("click", executeLocalReread); $("request-ai-proposals").addEventListener("click", requestAiProposals); $("dossier-form").addEventListener("submit", runAssessment);
$("dossier-form").addEventListener("input", (event) => {
  const controlId = event.target.id || event.target.closest("#data-categories")?.id;
  const field = INTAKE_CONTROL_FIELDS[controlId];
  if (field && latestSolutionProfile) {
    const acceptedAcquired = acceptedAcquiredCandidateByField.get(field);
    const currentValue = dossierPathValue(dossierFromForm(), field);
    if (acceptedAcquired && !sameIntakeValue(acceptedAcquired.sanitizedCandidate, currentValue)) {
      acceptedAcquiredCandidateByField.delete(field);
      editedAcquiredCandidateByField.set(field, acceptedAcquired);
    }
    if (acceptedAcquiredCandidateByField.has(field) || intakeControlValue(controlId) === intakeControlBaseline.get(controlId)) editedIntakeFields.delete(field);
    else editedIntakeFields.add(field);
    renderIntakeWorkspace(latestSolutionProfile, latestDiscoveryRecheck);
  }
});
$("summary-tab").addEventListener("click", () => selectView("summary")); $("workspace-tab").addEventListener("click", () => selectView("workspace"));
$("print-button").addEventListener("click", printReport); $("html-button").addEventListener("click", downloadHtml); $("download-button").addEventListener("click", downloadPackage);
$("source-files").addEventListener("change", () => { sampleSources = []; preparedSources = null; activeRunId = null; latestDiscoveryContext = null; for (const id of ["request-retrieval-plan", "execute-local-reread", "request-ai-proposals"]) $(id).classList.add("hidden"); $("assess-button").disabled = true; setIntakeFlow("UPLOAD"); $("file-summary").textContent = `${$("source-files").files.length} individual file(s) selected`; previewSelectedSources(); });
$("source-folder").addEventListener("change", () => { sampleSources = []; preparedSources = null; activeRunId = null; latestDiscoveryContext = null; for (const id of ["request-retrieval-plan", "execute-local-reread", "request-ai-proposals"]) $(id).classList.add("hidden"); $("assess-button").disabled = true; setIntakeFlow("UPLOAD"); $("folder-summary").textContent = `${$("source-folder").files.length} folder file(s) selected`; previewSelectedSources(); });
document.addEventListener("click", async (event) => {
  if (writeAccess !== "REQUIRED" || writeUnlocked || resumingGuardedClick) return;
  if (!isGuardedWriteTarget(event.target)) return;
  event.preventDefault();
  event.stopPropagation();
  const resume = event.target.closest("input, textarea, select, button, label.upload-box");
  if (await ensureWriteAccess() && resume) {
    resumingGuardedClick = true;
    resume.click();
    resumingGuardedClick = false;
  }
}, true);
document.addEventListener("focusin", async (event) => {
  if (writeAccess !== "REQUIRED" || writeUnlocked) return;
  if (event.target.matches?.('input[type="file"]')) return;
  if (!isGuardedWriteTarget(event.target)) return;
  event.target.blur();
  if (await ensureWriteAccess()) event.target.focus();
}, true);
document.addEventListener("keydown", async (event) => {
  if (writeAccess !== "REQUIRED" || writeUnlocked) return;
  if (!isGuardedWriteTarget(event.target)) return;
  event.preventDefault();
  await ensureWriteAccess();
}, true);
