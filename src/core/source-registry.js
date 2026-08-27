import { classifyArtifact, HUMAN_AUTHORITIES, productionAccessOnExperimentStage } from "../contracts.js";
import { sha256, stableId } from "./hash.js";
import { activeIntakeAnswers, INTAKE_QUESTIONNAIRE } from "../knowledge/intake-questionnaire.js";

const SECRET_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
  /\b(?:sk|rk|pk)_(?:live|test)_[a-z0-9]{16,}\b/i,
  /\bAKIA[0-9A-Z]{16}\b/,
  /(?:api[_-]?key|secret|password|token)\s*[:=]\s*["'][^"'\s]{12,}["']/i
];

const SIGNAL_PATTERNS = [
  { signal: "threat-model", path: /threat[-_ ]?model/i, text: /threat model|trust boundar|abuse case/i, controls: ["CTRL-D1", "CTRL-D3"], domains: ["D"] },
  { signal: "prompt-injection", path: /security|test|eval/i, text: /prompt injection|indirect injection|instruction hijack/i, controls: ["CTRL-D3"], domains: ["D"] },
  { signal: "data-leakage", path: /security|test|eval/i, text: /data leakage|data exfiltration|sensitive output/i, controls: ["CTRL-D3", "CTRL-B4"], domains: ["B", "D"] },
  { signal: "evaluation", path: /test|spec|eval/i, text: /evaluation|benchmark|assert|expected|pass rate|accuracy|hallucination/i, controls: ["CTRL-A2", "CTRL-D2"], domains: ["A", "D"] },
  { signal: "acceptance-threshold", path: /test|spec|eval|quality/i, text: /threshold|minimum pass|acceptance criteria|error rate|false positive/i, controls: ["CTRL-D2"], domains: ["D"] },
  { signal: "red-team", path: /red[-_ ]?team|pentest|security/i, text: /red team|penetration test|adversarial test|attack simulation/i, controls: ["CTRL-D3"], domains: ["D"] },
  { signal: "audit-log", path: /log|audit|telemetry|observ/i, text: /audit log|trace id|request id|structured log|telemetry/i, controls: ["CTRL-D4", "CTRL-F2"], domains: ["D", "F"] },
  { signal: "rollback", path: /runbook|deploy|operation|readme/i, text: /rollback|roll back|previous version|revert deployment/i, controls: ["CTRL-D5", "CTRL-F5"], domains: ["D", "F"] },
  { signal: "safe-shutdown", path: /runbook|operation|agent|security/i, text: /kill switch|safe shutdown|disable agent|emergency stop/i, controls: ["CTRL-C3", "CTRL-D5"], domains: ["C", "D"] },
  { signal: "model-inventory", path: /package|requirements|model|config|readme/i, text: /openai|anthropic|gemini|azure openai|bedrock|vertex ai|hugging ?face|ollama/i, controls: ["CTRL-C1"], domains: ["C"] },
  { signal: "provider-review", path: /provider|vendor|terms|procurement/i, text: /data retention|subprocessor|provider terms|training data|service region/i, controls: ["CTRL-C4", "CTRL-B5"], domains: ["B", "C"] },
  { signal: "tool-allowlist", path: /agent|tool|permission|security/i, text: /tool allowlist|allowed tools|denylist|least privilege|permission scope/i, controls: ["CTRL-C3"], domains: ["C"] },
  { signal: "human-approval", path: /agent|workflow|oversight|approval/i, text: /human approval|requires confirmation|manual review|approval gate/i, controls: ["CTRL-C3", "CTRL-E4"], domains: ["C", "E"] },
  { signal: "rate-limit", path: /agent|security|config|middleware/i, text: /rate limit|budget limit|max iterations|max steps/i, controls: ["CTRL-C3"], domains: ["C"] },
  { signal: "data-inventory", path: /data|dataset|privacy|inventory/i, text: /data inventory|dataset register|data source|data classification/i, controls: ["CTRL-B1"], domains: ["B"] },
  { signal: "data-flow", path: /data[-_ ]?flow|architecture|privacy/i, text: /data flow|data destination|cross-border|processor|controller/i, controls: ["CTRL-B1"], domains: ["B"] },
  { signal: "retention", path: /privacy|retention|data/i, text: /retention|deletion period|delete after|ttl|data lifecycle/i, controls: ["CTRL-B2"], domains: ["B"] },
  { signal: "privacy-review", path: /privacy|dpia|legal/i, text: /privacy review|data protection|privacy impact|dpia/i, controls: ["CTRL-B3"], domains: ["B"] },
  { signal: "lawful-basis", path: /privacy|dpia|legal/i, text: /lawful basis|legal basis|legitimate interest|consent|contract necessity/i, controls: ["CTRL-B3"], domains: ["B"] },
  { signal: "dpia", path: /dpia|privacy/i, text: /data protection impact assessment|dpia/i, controls: ["CTRL-B3"], domains: ["B"] },
  { signal: "licence", path: /license|licence|package|dependency/i, text: /licen[cs]e|copyright|open source|dependency/i, controls: ["CTRL-B5", "CTRL-C1"], domains: ["B", "C"] },
  { signal: "impact-assessment", path: /impact|fairness|governance/i, text: /impact assessment|affected persons|fundamental rights|harm assessment/i, controls: ["CTRL-E1"], domains: ["E"] },
  { signal: "fairness", path: /fairness|bias|eval|test/i, text: /fairness|bias|discrimination|subgroup|demographic/i, controls: ["CTRL-E2", "CTRL-D2"], domains: ["D", "E"] },
  { signal: "ai-notice", path: /notice|transparency|ui|policy/i, text: /ai-generated|interacting with ai|ai system notice|machine-generated/i, controls: ["CTRL-E3"], domains: ["E"] },
  { signal: "explanation", path: /explain|transparency|ui|policy/i, text: /explanation|why this output|source citation|reason code/i, controls: ["CTRL-E3"], domains: ["E"] },
  { signal: "human-override", path: /oversight|approval|workflow|ui/i, text: /human override|reject output|manual correction|stop action/i, controls: ["CTRL-E4"], domains: ["E"] },
  { signal: "appeal", path: /appeal|contest|oversight|policy/i, text: /appeal|contest|correction request|complaint/i, controls: ["CTRL-E5"], domains: ["E"] },
  { signal: "raci", path: /raci|governance|owner|readme/i, text: /accountable|responsible|consulted|decision rights|system owner/i, controls: ["CTRL-F1"], domains: ["F"] },
  { signal: "risk-register", path: /risk|governance/i, text: /risk register|inherent risk|residual risk|risk owner|mitigation/i, controls: ["CTRL-F3"], domains: ["F"] },
  { signal: "monitoring-plan", path: /monitor|operation|runbook/i, text: /monitoring plan|alert threshold|model drift|quality drift|operational metric/i, controls: ["CTRL-F5"], domains: ["F"] },
  { signal: "incident-response", path: /incident|runbook|security/i, text: /incident response|severity level|escalation path|breach response/i, controls: ["CTRL-F5"], domains: ["F"] },
  { signal: "change-trigger", path: /change|governance|release/i, text: /material change|reassessment trigger|model change|purpose change|data change/i, controls: ["CTRL-F5"], domains: ["F"] },
  { signal: "retirement-plan", path: /retire|decommission|lifecycle/i, text: /retirement plan|decommission|contract termination|archive|data deletion/i, controls: ["CTRL-F5"], domains: ["F"] }
];

function excerpt(content, matchIndex) {
  const start = Math.max(0, matchIndex - 90);
  const end = Math.min(content.length, matchIndex + 210);
  return content.slice(start, end).replace(/\s+/g, " ").trim();
}

function redactSecrets(content) {
  let redacted = content;
  for (const pattern of SECRET_PATTERNS) redacted = redacted.replace(pattern, "[REDACTED_SECRET]");
  return redacted;
}

function fixtureSecret(path, content, match) {
  const artifact = classifyArtifact(path);
  const value = match?.[0] ?? "";
  const start = Math.max(0, (match?.index ?? 0) - 100);
  const context = content.slice(start, (match?.index ?? 0) + value.length + 140);
  const knownPlaceholder = /AKIA1234567890ABCDEF|(?:sk|rk|pk)_(?:live|test)_[a-z0-9_-]*(?:dummy|example|placeholder|fake)/i.test(value);
  return ["TEST", "FIXTURE_OR_EXAMPLE"].includes(artifact) && (knownPlaceholder || /fixture|example|dummy|fake|placeholder|should never be uploaded|test/i.test(context));
}

function assuranceForKind(kind, metadata = {}) {
  const validHuman = metadata.humanActorId && metadata.humanActorId !== "ENGINE" && HUMAN_AUTHORITIES.includes(metadata.authority);
  // FORMALLY_APPROVED is reserved for a future connector that verifies human identity,
  // authority, signature, and decision scope outside this public assessment API.
  if (kind === "FORMAL_APPROVAL" && validHuman) return "HUMAN_VALIDATED";
  if (kind === "HUMAN_REVIEW" && validHuman) return "HUMAN_VALIDATED";
  if (kind === "OPERATIONAL_LOG" || kind === "MONITORING_RECORD") return "OPERATIONALLY_OBSERVED";
  if (["TEST", "SCAN_RESULT", "PENETRATION_TEST"].includes(kind)) {
    const passed = [metadata.executionStatus, metadata.resultStatus, metadata.status].some((value) => value === "PASSED");
    const scoped = typeof metadata.scope === "string" && metadata.scope.trim().length > 0;
    return passed && scoped ? "TESTED" : kind === "TEST" ? "IMPLEMENTED" : "DECLARED";
  }
  if (["CODE", "CONFIGURATION"].includes(kind)) return "IMPLEMENTED";
  return "DECLARED";
}

function isStale(metadata, now) {
  if (!metadata?.validUntil) return false;
  const expiry = Date.parse(metadata.validUntil);
  return Number.isFinite(expiry) && expiry < now.getTime();
}

export function buildSourceRegistry(sources, now = new Date()) {
  const registeredSources = [];
  const evidence = [];
  const findings = [];

  for (const source of sources) {
    const sourceHash = sha256(source.content);
    const safeContent = redactSecrets(source.content);
    const sourceId = `src-${sourceHash.slice(0, 16)}`;
    const stale = isStale(source.metadata, now);
    const sourceArtifactClass = classifyArtifact(source.path, source.metadata);
    registeredSources.push({ id: sourceId, path: source.path, kind: source.kind, artifactClass: sourceArtifactClass, sha256: sourceHash, size: source.content.length, originalSource: source.metadata?.originalSource ?? null });
    const assuranceState = assuranceForKind(source.kind, source.metadata);

    if (Array.isArray(source.metadata?.controlIds) && source.metadata.controlIds.length) {
      evidence.push({
        id: stableId("evd", { sourceId, signal: source.metadata.signal ?? "explicit-control-evidence", controlIds: source.metadata.controlIds, excerpt: safeContent.slice(0, 300) }), sourceId, path: source.path, kind: source.kind, sha256: sourceHash,
        excerpt: safeContent.slice(0, 300).replace(/\s+/g, " ").trim(),
        signal: source.metadata.signal ?? "explicit-control-evidence",
        domainIds: source.metadata.domainIds ?? [], controlIds: source.metadata.controlIds,
        antiPatternIds: source.metadata.antiPatternIds ?? [], assuranceState,
        polarity: source.metadata.polarity ?? "SUPPORT", eligibleForAssurance: true, evidenceClass: "EXPLICIT_MAPPING",
        stale, capturedAt: now.toISOString(), metadata: { ...source.metadata, artifactClass: sourceArtifactClass }
      });
    }

    for (const pattern of SECRET_PATTERNS) {
      const match = pattern.exec(source.content);
      if (!match) continue;
      const syntheticFixture = fixtureSecret(source.path, source.content, match);
      const artifact = {
        id: stableId("evd", { sourceId, signal: "hardcoded-secret" }), sourceId, path: source.path, kind: "SCAN_RESULT", sha256: sourceHash,
        excerpt: "Potential secret material detected; value redacted.", signal: "hardcoded-secret", domainIds: ["D"],
        controlIds: ["CTRL-D1"], antiPatternIds: syntheticFixture ? [] : ["AP-D1"], assuranceState: "TESTED",
        polarity: syntheticFixture ? "CANDIDATE_RISK" : "RISK", eligibleForAssurance: false,
        evidenceClass: syntheticFixture ? "TEST_FIXTURE_INDICATOR" : "AUTOMATED_INDICATOR",
        stale: false, capturedAt: now.toISOString(), metadata: { scanner: "built-in-secret-scan", artifactClass: sourceArtifactClass, syntheticFixture }
      };
      evidence.push(artifact);
      findings.push(syntheticFixture
        ? { code: "SECRET_TEST_FIXTURE", severity: "INFO", evidenceId: artifact.id, message: `Synthetic secret fixture detected in ${source.path}`, actionable: false }
        : { code: "SECRET_CANDIDATE", severity: "CRITICAL", evidenceId: artifact.id, message: `Potential secret candidate detected in ${source.path}`, actionable: true });
      break;
    }

    for (const signal of SIGNAL_PATTERNS) {
      const textMatch = signal.text.exec(safeContent);
      if (!textMatch) continue;
      evidence.push({
        id: stableId("evd", { sourceId, signal: signal.signal, index: textMatch.index }), sourceId, path: source.path, kind: source.kind, sha256: sourceHash,
        excerpt: excerpt(safeContent, textMatch.index), signal: signal.signal, domainIds: signal.domains,
        controlIds: signal.controls, antiPatternIds: [], assuranceState: "DECLARED", polarity: "SUPPORT",
        eligibleForAssurance: false, evidenceClass: "AUTOMATED_INDICATOR",
        stale, capturedAt: now.toISOString(), metadata: { ...source.metadata, artifactClass: sourceArtifactClass, assuranceCeiling: assuranceState }
      });
    }

    for (const antiPatternId of source.metadata?.testedAbsenceOf ?? []) {
      evidence.push({
        id: stableId("evd", { sourceId, signal: "tested-absence", antiPatternId }), sourceId, path: source.path, kind: source.kind, sha256: sourceHash,
        excerpt: `Explicit test for absence of ${antiPatternId}`, signal: "tested-absence", domainIds: [], controlIds: [],
        antiPatternIds: [antiPatternId], assuranceState, polarity: "ABSENCE_TEST", eligibleForAssurance: assuranceState === "TESTED",
        evidenceClass: "EXPLICIT_ABSENCE_TEST", stale, capturedAt: now.toISOString(), metadata: { ...source.metadata, artifactClass: sourceArtifactClass }
      });
    }
  }
  return { registeredSources, evidence, findings, registryHash: sha256(registeredSources) };
}

export function dossierEvidence(dossier, now = new Date()) {
  const common = { sourceId: "dossier", path: "intended-use-dossier", kind: "DECLARATION", sha256: sha256(dossier), assuranceState: "DECLARED", eligibleForAssurance: true, evidenceClass: "DECLARED", stale: false, capturedAt: now.toISOString(), metadata: {} };
  const entries = [
    { signal: "purpose", excerpt: dossier.intendedPurpose, domains: ["A"], controls: ["CTRL-A1"] },
    { signal: "value", excerpt: dossier.expectedValue, domains: ["A"], controls: ["CTRL-A2"] },
    { signal: "accountable-owner", excerpt: dossier.accountableOwner, domains: ["A", "F"], controls: ["CTRL-A1", "CTRL-F1"] },
    { signal: "classification", excerpt: dossier.classification.prohibitedPractice === null && dossier.classification.highRiskCandidate === null ? "" : `Prohibited=${dossier.classification.prohibitedPractice}; highRiskCandidate=${dossier.classification.highRiskCandidate}`, domains: ["A"], controls: ["CTRL-A4"] }
  ];
  const coreEvidence = entries.filter((entry) => typeof entry.excerpt === "string" && entry.excerpt.trim()).map((entry) => ({
    ...common, id: stableId("evd", { sourceId: "dossier", signal: entry.signal, excerpt: entry.excerpt }), excerpt: entry.excerpt, signal: entry.signal, domainIds: entry.domains,
    controlIds: entry.controls, antiPatternIds: [], polarity: "SUPPORT"
  }));
  const questions = new Map(INTAKE_QUESTIONNAIRE.questions.map((item) => [item.id, item]));
  const sectionDomains = { SYSTEM: ["A", "C"], ACTOR: ["A", "F"], RISK: ["A", "F"], PROHIBITED: ["A", "E", "F"], TRANSPARENCY: ["E", "F"] };
  const intakeEvidence = Object.entries(activeIntakeAnswers(dossier.intakeAnswers ?? {})).filter(([, answer]) => answer.answerState !== "UNKNOWN" || answer.confirmedAt).map(([questionId, answer]) => {
    const question = questions.get(questionId);
    const excerpt = `${question?.prompt ?? questionId}: ${answer.values?.length ? answer.values.join(", ") : answer.answerState}`;
    return {
      ...common,
      id: stableId("evd", { sourceId: "dossier", signal: "intake-declaration", questionId, excerpt }),
      excerpt,
      signal: "intake-declaration",
      domainIds: sectionDomains[question?.sectionId] ?? ["A", "F"],
      controlIds: [], antiPatternIds: [], polarity: answer.answerState === "YES" ? "RISK_OR_APPLICABILITY" : "DECLARATION",
      eligibleForAssurance: false,
      metadata: { questionId, origin: answer.origin, supportStatus: answer.supportStatus, requirementMappings: question?.sourceMappings ?? [] }
    };
  });
  return [...coreEvidence, ...intakeEvidence];
}

export function dossierRiskEvidence(dossier, now = new Date()) {
  const base = { sourceId: "dossier", path: "intended-use-dossier", kind: "DECLARATION", sha256: sha256(dossier), assuranceState: "DECLARED", eligibleForAssurance: true, evidenceClass: "DECLARED_RISK", stale: false, capturedAt: now.toISOString(), polarity: "RISK", metadata: {} };
  const risks = [];
  const push = (signal, excerpt, domainIds, controlIds, antiPatternIds) => risks.push({ ...base, id: stableId("evd", { sourceId: "dossier", signal, excerpt }), signal, excerpt, domainIds, controlIds, antiPatternIds });
  if ((dossier.data.personalData || dossier.data.specialCategoryData) && dossier.data.productionData) {
    push("unapproved-sensitive-data", "The dossier declares use of production personal or special-category data.", ["B"], ["CTRL-B1", "CTRL-B3"], ["AP-B3"]);
  }
  if (productionAccessOnExperimentStage(dossier)) {
    push("unsafe-experiment-boundary", "The dossier declares production access during qualification or development.", ["A", "D"], ["CTRL-A5", "CTRL-D1"], ["AP-A5", "AP-D1"]);
  }
  if (dossier.agent.usesAgents && dossier.agent.canTakeActions && (!dossier.agent.humanOverride || dossier.agent.irreversibleActions)) {
    push("excessive-agency", "The agent can take actions without an adequate reversible human-override boundary.", ["C", "E"], ["CTRL-C3", "CTRL-E4"], ["AP-C3"]);
  }
  return risks;
}
