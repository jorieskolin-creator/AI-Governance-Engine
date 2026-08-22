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
const editedIntakeFields = new Set();
const acceptedProposalByField = new Map();
const editedProposalByField = new Map();
const declinedProposalByField = new Map();
const intakeControlBaseline = new Map();
let INTAKE_CONTROL_FIELDS = Object.freeze({});

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
        explanation.required = answer.answerState === "NOT_APPLICABLE";
      }
      card.querySelector(".question-evidence-state").textContent = answer.answerState === "UNKNOWN"
        ? "Unknown · no information detected or declared"
        : "Self-Declared · unsupported until documentary evidence is verified";
      const fieldId = `intakeAnswers.${card.dataset.questionId}`;
      const acceptedProposal = acceptedProposalByField.get(fieldId);
      const field = intakeFieldRegistry.fields.find((item) => item.id === fieldId);
      const value = field?.dataType === "ENUM_ARRAY" ? answer.values : answer.answerState;
      if (acceptedProposal && !proposalMatchesValue(acceptedProposal.value, value)) {
        acceptedProposalByField.delete(fieldId);
        editedProposalByField.set(fieldId, acceptedProposal);
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
      explanation.required = currentAnswer.answerState === "NOT_APPLICABLE";
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
  acceptedProposalByField.clear();
  editedProposalByField.clear();
  declinedProposalByField.clear();
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
    const state = acceptedProposalByField.has(field) ? { tone: "review", text: "GenAI proposal selected · editable · becomes a user decision only on final approval" }
      : editedProposalByField.has(field) ? { tone: "self-declared", text: "GenAI proposal edited by user · treated as Self-Declared, not GenAI-authoritative" }
      : declinedProposalByField.has(field) ? { tone: "missing", text: "GenAI proposal declined · provide a value or resolve as Unknown / Not Applicable" }
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
  if (acceptedProposalByField.has(fieldId)) state.textContent = "GenAI proposal selected · editable · becomes a user decision only on final approval";
  else if (editedProposalByField.has(fieldId)) state.textContent = "GenAI proposal edited by user · treated as Self-Declared, not GenAI-authoritative";
  else if (declinedProposalByField.has(fieldId)) state.textContent = "GenAI proposal declined · provide a value or resolve as Unknown / Not Applicable";
}

function applyProposalToIntake(field, value) {
  if (field.questionId) {
    const card = document.querySelector(`.question-card[data-question-id="${field.questionId}"]`);
    if (!card) return false;
    if (field.dataType === "ENUM") {
      const select = card.querySelector("select"); if (!select) return false;
      select.value = value; select.dispatchEvent(new Event("change", { bubbles: true })); select.focus();
    } else {
      const inputs = [...card.querySelectorAll('input[type="checkbox"]')];
      for (const input of inputs) input.checked = value.includes(input.value);
      const changed = inputs.find((input) => input.checked) ?? inputs[0]; if (!changed) return false;
      changed.dispatchEvent(new Event("change", { bubbles: true })); changed.focus();
    }
    return true;
  }
  const control = $(field.uiControlId); if (!control) return false;
  if (field.dataType === "ENUM_ARRAY") {
    for (const input of control.querySelectorAll('input[type="checkbox"]')) input.checked = value.includes(input.value);
  } else if (field.dataType === "BOOLEAN") control.value = value ? "YES" : "NO";
  else control.value = Array.isArray(value) ? value.join(", ") : value;
  control.dispatchEvent(new Event("input", { bubbles: true })); control.focus();
  return true;
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
    const proposal = acceptedProposalByField.get(field.id);
    let resolutionState;
    if (answer?.answerState === "NOT_APPLICABLE") resolutionState = "USER_SELECTED_NOT_APPLICABLE";
    else if (answer?.answerState === "HUMAN_REVIEW_REQUIRED" || (fact?.status === "CONFLICTING" || fact?.supportStatus === "CONFLICTING") && sameIntakeValue(priorFieldValue(field), value)) resolutionState = "CONFLICT_REQUIRES_RESOLUTION";
    else if (value === null) resolutionState = "USER_SELECTED_UNKNOWN";
    else if (proposal && proposalMatchesValue(proposal.value, value)) resolutionState = "USER_ACCEPTED_PROPOSAL";
    else if (sameIntakeValue(priorFieldValue(field), value)) resolutionState = "USER_CONFIRMED";
    else resolutionState = "USER_EDITED";
    decisions[field.id] = {
      resolutionState,
      explanation: answer?.explanation ?? "",
      proposalRef: resolutionState === "USER_ACCEPTED_PROPOSAL" ? proposal.id : null,
      editedProposalRef: editedProposalByField.get(field.id)?.id ?? null,
      declinedProposalRef: declinedProposalByField.get(field.id)?.id ?? null
    };
  }
  return decisions;
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
  const sourceContainerCount = sourceIngestion.items.filter((item) => item.reasonCode === "UNSUPPORTED_SOURCE_CONTAINER").length;
  const sourceContainerNotice = sourceContainerCount ? ` ${sourceContainerCount} ZIP archive(s) must be extracted locally and selected as a folder.` : "";
  if (!sources.length) throw new Error(`No supported source could be prepared. ${sourceIngestion.excludedCount} file(s) were excluded and ${sourceIngestion.failedCount + sourceIngestion.unsafeCount} require review.${sourceContainerNotice}`);
  preparedSources = { sources, sourceIngestion };
  $("discovery-status").textContent = `${sourceIngestion.acceptedCount} supported file(s) prepared · ${sourceIngestion.excludedCount} disclosed exclusion(s) · ${sourceIngestion.failedCount + sourceIngestion.unsafeCount} file(s) require review.${sourceContainerNotice}`;
  return preparedSources;
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
      el("small", "", `Technical loss: ${acquisitionDiagnostics.technicalLoss.count} source(s). Genuine source silence: ${acquisitionDiagnostics.sourceSilence.count} source(s). GenAI: ${label(acquisitionDiagnostics.genAi.status)}.`)
    );
    root.append(diagnostics);
  }
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
  if (latestDiscoveryContext?.packets?.length) {
    const safePackage = el("details", "discovery-candidate-details");
    safePackage.append(el("summary", "", "Review safe package available for optional GenAI proposals"));
    const description = el("p", "field-hint", "Only these deterministic summaries can be sent by the optional proposal action. Raw documents, code, table values and image pixels remain local.");
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
      ? `AI Intake verification completed: ${acceptedCount} current value(s) supported as written; ${actionCandidates.length} field(s) need review or more information. AI proposals do not overwrite the deterministic Intake draft.`
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
        if (actionable) {
          const apply = el("button", "candidate-apply-button", "Accept proposal"); apply.type = "button";
          apply.addEventListener("click", () => {
            editedProposalByField.delete(candidate.field);
            declinedProposalByField.delete(candidate.field);
            acceptedProposalByField.set(candidate.field, candidate);
            if (!applyProposalToIntake(field, proposedValue)) acceptedProposalByField.delete(candidate.field);
          });
          item.append(apply);
        }
        if (actionable) {
          const decline = el("button", "candidate-decline-button", declinedProposalByField.has(candidate.field) ? "Proposal declined" : "Decline proposal"); decline.type = "button";
          decline.disabled = declinedProposalByField.has(candidate.field);
          decline.addEventListener("click", () => {
            acceptedProposalByField.delete(candidate.field);
            editedProposalByField.delete(candidate.field);
            declinedProposalByField.set(candidate.field, candidate);
            decline.textContent = "Proposal declined"; decline.disabled = true;
            renderIntakeWorkspace(latestSolutionProfile, latestDiscoveryRecheck);
          });
          item.append(decline);
        }
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
  root.classList.remove("hidden");
}

async function discoverCaseInformation() {
  $("error").classList.add("hidden"); $("discover-button").disabled = true; $("assess-button").disabled = true;
  $("request-ai-proposals").classList.add("hidden");
  setIntakeFlow("DETERMINISTIC");
  $("discovery-status").textContent = "Stage 2 of 5 · Parsing sources locally and building deterministic cited facts…";
  try {
    const prepared = await selectedSources();
    if (!prepared.sources.length) throw new Error("Select a folder or one or more supported files first.");
    const preflight = await postJson("/api/v2/runs/preflight", prepared);
    activeRunId = preflight.runId;
    latestSolutionProfile = preflight.solutionProfile;
    latestDiscoveryContext = { profile: preflight.solutionProfile, dlpFindings: preflight.dlpFindings, citationIndex: preflight.citationIndex, packets: preflight.packets, acquiredFacts: preflight.acquiredFacts, acquisitionDiagnostics: preflight.acquisitionDiagnostics, selectedAcquiredFactIds: [] };
    fillDossier(preflight.solutionProfile.suggestedDossier);
    renderDiscovery(preflight.solutionProfile, preflight.dlpFindings, null, preflight.citationIndex, preflight.acquisitionDiagnostics);
    const blocked = preflight.dlpFindings.some((item) => item.blocking);
    $("request-ai-proposals").classList.toggle("hidden", blocked);
    $("request-ai-proposals").disabled = false;
    setIntakeFlow("USER_RESOLUTION", { limitedSteps: ["AI_VERIFICATION"] });
    const unresolved = Object.values(preflight.solutionProfile.fields).filter((item) => item.status !== "CONFIRMED").length;
    $("discovery-status").textContent = blocked
      ? `Stage 4 of 5 · Deterministic draft ready with ${unresolved} unresolved field(s). Local screening blocks GenAI transmission; resolve the Intake manually.`
      : `Stage 4 of 5 · Deterministic draft ready with ${unresolved} unresolved field(s). Resolve it manually or explicitly request optional GenAI proposals from safe summaries.`;
    $("assess-button").disabled = false;
    $("assessment-input").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    $("discovery-status").textContent = "Discovery could not be completed."; $("error").textContent = error.message; $("error").classList.remove("hidden");
  } finally { $("discover-button").disabled = false; }
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
  renderDiscovery(latestDiscoveryContext.profile, latestDiscoveryContext.dlpFindings, recheck, latestDiscoveryContext.citationIndex, latestDiscoveryContext.acquisitionDiagnostics);
  const completed = recheck.status === "COMPLETED";
  setIntakeFlow("USER_RESOLUTION", { limitedSteps: completed ? [] : ["AI_VERIFICATION"] });
  $("request-ai-proposals").classList.add("hidden");
  $("discovery-status").textContent = completed
    ? "Stage 4 of 5 · Optional GenAI proposals are ready for review. They remain editable and have not changed or approved any Intake value."
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
  latestDiscoveryContext = null; $("request-ai-proposals").classList.add("hidden");
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

async function postJson(path, body = undefined) {
  const response = await fetch(path, {
    method: "POST", headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const value = await response.json();
  if (!response.ok) throw new Error(`${value.detail || value.error || "Cognitive assessment failed"}${value.failureCode ? ` (${label(value.failureCode)})` : ""}`);
  return value;
}

async function waitForRun(runId) {
  for (let attempt = 0; attempt < 750; attempt += 1) {
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
  event.preventDefault(); $("error").classList.add("hidden"); $("progress").classList.remove("hidden"); $("assess-button").disabled = true;
  try {
    if (!activeRunId) throw new Error("Complete deterministic discovery before starting the A–F assessment.");
    await selectedSources();
    const dossier = dossierFromForm();
    setProgress("Preparing AI analysis", "Local screening is complete. Redacted evidence will be analysed by the Engine’s configured providers.");
    await postJson(`/api/v2/runs/${encodeURIComponent(activeRunId)}/confirm`, {
      dossier,
      resolutions: intakeResolutions(dossier),
      approval: { confirmed: true, actorRef: "INTERACTIVE_USER" }
    });
    setIntakeFlow("ASSESSMENT");
    await postJson(`/api/v2/runs/${encodeURIComponent(activeRunId)}/execute`);
    await waitForRun(activeRunId);
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
  fetch("/api/knowledge/diagnostics").then((response) => response.json()).catch(() => ({ status: "UNKNOWN", issues: [] })),
  fetch("/api/intake-questionnaire").then((response) => response.json()).catch(() => ({ version: "unavailable", sections: [], questions: [] })),
  fetch("/api/intake-field-registry").then((response) => {
    if (!response.ok) throw new Error("Intake field registry is unavailable");
    return response.json();
  })
]).then(([kb, config, diagnostics, questionnaire, registry]) => {
  renderKnowledgeDiagnostics(kb, diagnostics);
  summaryEnabled = config.assuranceSummaryEnabled !== false;
  intakeQuestionnaire = questionnaire;
  intakeFieldRegistry = registry;
  INTAKE_CONTROL_FIELDS = Object.freeze(Object.fromEntries(registry.fields.filter((field) => field.uiControlId).map((field) => {
    if (!$(field.uiControlId)) throw new Error(`Registered Intake control is missing: ${field.uiControlId}`);
    return [field.uiControlId, field.id];
  })));
  renderQuestionnaire();
}).catch(() => { $("knowledge-status").textContent = "Knowledge unavailable"; $("knowledge-diagnostics-content").textContent = "Knowledge connection diagnostics are unavailable."; });
$("sample-button").addEventListener("click", loadSample); $("discover-button").addEventListener("click", discoverCaseInformation); $("request-ai-proposals").addEventListener("click", requestAiProposals); $("dossier-form").addEventListener("submit", runAssessment);
$("dossier-form").addEventListener("input", (event) => {
  const controlId = event.target.id || event.target.closest("#data-categories")?.id;
  const field = INTAKE_CONTROL_FIELDS[controlId];
  if (field && latestSolutionProfile) {
    const acceptedProposal = acceptedProposalByField.get(field);
    const currentValue = dossierPathValue(dossierFromForm(), field);
    if (acceptedProposal && !proposalMatchesValue(acceptedProposal.value, currentValue)) {
      acceptedProposalByField.delete(field);
      editedProposalByField.set(field, acceptedProposal);
    }
    if (intakeControlValue(controlId) === intakeControlBaseline.get(controlId)) editedIntakeFields.delete(field);
    else editedIntakeFields.add(field);
    renderIntakeWorkspace(latestSolutionProfile, latestDiscoveryRecheck);
  }
});
$("summary-tab").addEventListener("click", () => selectView("summary")); $("workspace-tab").addEventListener("click", () => selectView("workspace"));
$("print-button").addEventListener("click", printReport); $("html-button").addEventListener("click", downloadHtml); $("download-button").addEventListener("click", downloadPackage);
$("source-files").addEventListener("change", () => { sampleSources = []; preparedSources = null; activeRunId = null; latestDiscoveryContext = null; $("request-ai-proposals").classList.add("hidden"); $("assess-button").disabled = true; setIntakeFlow("UPLOAD"); $("file-summary").textContent = `${$("source-files").files.length} individual file(s) selected`; });
$("source-folder").addEventListener("change", () => { sampleSources = []; preparedSources = null; activeRunId = null; latestDiscoveryContext = null; $("request-ai-proposals").classList.add("hidden"); $("assess-button").disabled = true; setIntakeFlow("UPLOAD"); $("folder-summary").textContent = `${$("source-folder").files.length} folder file(s) selected`; });
