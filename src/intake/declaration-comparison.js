import { classifyArtifact, invariant } from "../contracts.js";
import { sha256 } from "../core/hash.js";
import { discoverSolutionProfile, flattenDossier } from "../core/solution-profile.js";
import { discoverDeclaredTopics } from "./documentation-input.js";

export const COMPARISON_VERSION = "intake-source-comparison/1.1.0";
export const SAFE_COMPARISON_SUMMARY_VERSION = "intake-comparison-summary-1.0.0";
const SUPPORTED_COMPARISON_VERSIONS = new Set(["intake-source-comparison/1.0.0", COMPARISON_VERSION]);

const booleanFields = {
  "agent.usesAgents": "usesAgents",
  "agent.canTakeActions": "canTakeActions",
  "agent.irreversibleActions": "irreversibleActions",
  "agent.humanOverride": "humanOverride",
  "exposure.productionAccess": "productionAccess"
};

const materialFields = new Set([
  "intendedPurpose",
  "operatingBoundary.allowedUses",
  "operatingBoundary.excludedUses",
  "operatingBoundary.integrationScope",
  ...Object.keys(booleanFields)
]);
const fixtureOrSamplePath = /(?:^|\/)(?:fixtures?|examples?|samples?|mocks?|__mocks__|testdata)(?:\/|$)|(?:^|[._-])(?:example|sample|mock|template|golden)(?:[._-]|$)/i;
const testCodePath = /(?:^|\/)(?:tests?|specs?|__tests__)(?:\/|$)|(?:^|[._-])(?:test|spec)\.[^/]+$/i;
const docsDirPath = /(?:^|\/)(?:documentation|docs)(?:\/|$)/i;
const readme = /(?:^|\/)readme(?:\.[^/]*)?$/i;
const manifestOrDeployConfig = /(?:^|\/)(?:package\.json|pyproject\.toml|cargo\.toml|go\.mod|dockerfile(?:\.[^/]*)?|railway\.json|vercel\.json|\.env\.example)$/i;

const AGENT_EXECUTION_CODE_PATTERN = /\b(?:tool_calls|toolChoice|function_call|executeTool|execute_tool|AgentExecutor|createReactAgent)\b/;
const EXTERNAL_PROVIDER_PATTERN = /\b(?:@anthropic-ai\/sdk|@google\/genai|@google-cloud\/vertexai|@aws-sdk\/client-bedrock|api\.openai\.com|api\.anthropic\.com|generativelanguage\.googleapis\.com|OPENAI_API_KEY|ANTHROPIC_API_KEY|GEMINI_API_KEY)\b/;
const HUMAN_GATE_CODE_PATTERN = /\b(?:humanOverride|manualReview|requiresConfirmation|authorizeWriteAccess|approval\.confirmed|HUMAN_APPROVAL)\b/;
const RETENTION_CODE_PATTERN = /\b(?:expires_at|sweepExpired|retention|purge|delete\s+from|ttl)\b/i;
const OFFLINE_OR_NO_INTEGRATION_DECLARATION = /\b(?:no external|offline[- ]only|local[- ]only|air[- ]gapped|none)\b/i;

const cite = (unit) => ({ sourceUnitId: unit.id, path: unit.path, locator: unit.locator, sha256: unit.sha256 });
const normalizeComparableText = (value) => String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();

function configuredBooleans(unit) {
  if (unit.evidenceClass === "DECLARED" || unit.path === "intended-use-dossier.json" ||
      classifyArtifact(unit.path) !== "CONFIGURATION" || fixtureOrSamplePath.test(unit.path) || docsDirPath.test(unit.path) || !unit.path.endsWith(".json")) return [];
  let config;
  try { config = JSON.parse(unit.content); }
  catch { return []; }
  if (!config || typeof config !== "object" || Array.isArray(config)) return [];
  return Object.entries(booleanFields).flatMap(([field, key]) => {
    const group = field.split(".")[0];
    const values = [config[group]?.[key], config[key]].filter((value) => typeof value === "boolean");
    return [...new Set(values)].map((value) => ({ field, value, citation: cite(unit) }));
  });
}

function comparison(field, evidenceTier, declared, observations, statusOverride = null, severityOverride = undefined) {
  const different = observations.some((item) => sha256(item.value) !== sha256(declared));
  const status = statusOverride ?? (different ? "CONTRADICTED" : observations.length ? "ALIGNED" : "INSUFFICIENT_EVIDENCE");
  const severity = severityOverride !== undefined ? severityOverride : status === "CONTRADICTED" && (materialFields.has(field) || field.startsWith("failureModes.")) ? "HIGH" : status === "CONTRADICTED" ? "MEDIUM" : status === "UNVERIFIED_IN_CODE" ? "MEDIUM" : null;
  return { field, evidenceTier, declared, observations, status, severity };
}

function compareDocumentTier(tierUnits, evidenceTier, dossier, values) {
  const rows = [];
  if (!tierUnits.length) return rows;
  const profile = discoverSolutionProfile(tierUnits, dossier);
  const citations = new Map(tierUnits.map((unit) => [unit.id, cite(unit)]));
  for (const field of Object.keys(values)) {
    const fact = profile.fields[field];
    const declared = values[field];
    if (declared == null || declared === "" || declared === "UNKNOWN" || Array.isArray(declared) && !declared.length) continue;
    const disagreement = profile.contradictions.find((item) => item.field === field && !item.ruleId && item.sourceUnitIds.some((id) => citations.has(id)));
    if (disagreement) {
      const candidates = disagreement.observedCandidates.length ? disagreement.observedCandidates : [disagreement.observedValue];
      rows.push(comparison(field, evidenceTier, declared, candidates.filter((value) => value != null).map((value) => ({ value, citations: disagreement.sourceUnitIds.map((id) => citations.get(id)).filter(Boolean) }))));
    } else if (fact?.sourceUnitIds?.length) {
      rows.push(comparison(field, evidenceTier, declared, [{ value: declared, citations: fact.sourceUnitIds.map((id) => citations.get(id)).filter(Boolean) }]));
    }
  }
  return rows;
}

function compareDeclaredTopicsWithDocs(snapshot, docUnits) {
  const rows = [];
  const declaredTopics = snapshot.declaredDocumentation?.topics ?? {};
  if (!docUnits.length || !Object.keys(declaredTopics).length) return rows;
  const discovered = discoverDeclaredTopics(docUnits);
  const unitById = new Map(docUnits.map((unit) => [unit.id, cite(unit)]));
  for (const [topicId, record] of Object.entries(declaredTopics)) {
    const declared = record?.value;
    const observed = discovered[topicId];
    if (!declared || !observed?.value) continue;
    const citations = observed.sourceUnitIds.map((id) => unitById.get(id)).filter(Boolean);
    const same = normalizeComparableText(declared) === normalizeComparableText(observed.value);
    rows.push(comparison(
      `declaredTopics.${topicId}`,
      "ADDITIONAL_DOCUMENTATION",
      declared,
      [{ value: same ? declared : observed.value, citations }],
      same ? "ALIGNED" : "CONTRADICTED"
    ));
  }
  return rows;
}

function compareCodebaseImplementation(snapshot, units) {
  const rows = [];
  const dossier = snapshot.effectiveDossier;
  const codeUnits = units.filter((unit) => unit.evidenceClass !== "DECLARED"
    && unit.path !== "intended-use-dossier.json"
    && !fixtureOrSamplePath.test(unit.path)
    && !testCodePath.test(unit.path)
    && (classifyArtifact(unit.path) === "PRODUCTION_CODE" || manifestOrDeployConfig.test(unit.path)));
  if (!codeUnits.length) return rows;

  const agentExecUnits = codeUnits.filter((unit) => classifyArtifact(unit.path) === "PRODUCTION_CODE" && AGENT_EXECUTION_CODE_PATTERN.test(unit.content));
  for (const field of ["agent.usesAgents", "agent.canTakeActions"]) {
    const declared = dossier.agent?.[field.split(".")[1]];
    if (declared === false && agentExecUnits.length) {
      rows.push(comparison(field, "CODEBASE_IMPLEMENTATION", false, [{ value: true, citations: agentExecUnits.slice(0, 5).map(cite) }], "CONTRADICTED", "CRITICAL"));
    }
  }

  const providerUnits = codeUnits.filter((unit) => EXTERNAL_PROVIDER_PATTERN.test(unit.content));
  const integrationScope = dossier.operatingBoundary?.integrationScope ?? "";
  if (integrationScope && OFFLINE_OR_NO_INTEGRATION_DECLARATION.test(integrationScope) && providerUnits.length) {
    rows.push(comparison(
      "operatingBoundary.integrationScope",
      "CODEBASE_IMPLEMENTATION",
      integrationScope,
      [{ value: "EXTERNAL_MODEL_PROVIDER_PRESENT", citations: providerUnits.slice(0, 5).map(cite) }],
      "CONTRADICTED",
      "CRITICAL"
    ));
  }

  const humanGateUnits = codeUnits.filter((unit) => classifyArtifact(unit.path) === "PRODUCTION_CODE" && HUMAN_GATE_CODE_PATTERN.test(unit.content));
  if (dossier.agent?.humanOverride === true && agentExecUnits.length) {
    if (humanGateUnits.length) {
      rows.push(comparison("agent.humanOverride", "CODEBASE_IMPLEMENTATION", true, [{ value: true, citations: humanGateUnits.slice(0, 5).map(cite) }], "ALIGNED", null));
    } else {
      rows.push(comparison("agent.humanOverride", "CODEBASE_IMPLEMENTATION", true, [{ value: "NO_HUMAN_OVERRIDE_GATE_LOCATED", citations: agentExecUnits.slice(0, 3).map(cite) }], "UNVERIFIED_IN_CODE", "MEDIUM"));
    }
  }

  const minimization = snapshot.declaredDocumentation?.topics?.minimization?.value ?? "";
  if (minimization && /\b(?:retain|retention|purge|delete|ttl|expire|minimi[sz])\b/i.test(minimization)) {
    const retentionUnits = codeUnits.filter((unit) => RETENTION_CODE_PATTERN.test(unit.content));
    if (retentionUnits.length) {
      rows.push(comparison("declaredTopics.minimization", "CODEBASE_IMPLEMENTATION", minimization, [{ value: minimization, citations: retentionUnits.slice(0, 5).map(cite) }], "ALIGNED", null));
    } else {
      rows.push(comparison("declaredTopics.minimization", "CODEBASE_IMPLEMENTATION", minimization, [], "UNVERIFIED_IN_CODE", "LOW"));
    }
  }
  return rows;
}

function matchRegisteredSource(rawRef, sources) {
  const ref = String(rawRef ?? "").trim().replaceAll("\\", "/").replace(/^\.\//, "");
  if (!ref || /^https?:\/\//i.test(ref)) return { kind: "EXTERNAL_OR_UNSPECIFIED", matched: null, normalizedRef: ref };
  const lower = ref.toLowerCase();
  const matched = sources.find((source) => {
    const path = String(source.path ?? "").replaceAll("\\", "/").replace(/^\.\//, "").toLowerCase();
    return path === lower || path.endsWith(`/${lower}`);
  }) ?? null;
  return { kind: matched ? "LOCATED_IN_SNAPSHOT" : "MISSING_FROM_SNAPSHOT", matched, normalizedRef: ref };
}

function verifyDeclaredReferences(snapshot, registeredSources) {
  const sources = registeredSources.filter((source) => source.path !== "intended-use-dossier.json");
  const documentation = snapshot.declaredDocumentation;
  const referenceChecks = [];
  const rows = [];
  if (!documentation || !sources.length) return { referenceChecks, rows };

  for (const row of documentation.failureModes ?? []) {
    if (row.provenance?.file_path) {
      const check = matchRegisteredSource(row.provenance.file_path, sources);
      referenceChecks.push({
        ownerType: "FAILURE_MODE_PROVENANCE",
        ownerId: row.id,
        refKind: "FILE_PATH",
        reference: check.normalizedRef,
        declaredStatus: "DECLARED_IN_DOC",
        snapshotStatus: check.kind,
        matchedSourceId: check.matched?.id ?? null,
        matchedPath: check.matched?.path ?? null,
        artifactClass: check.matched?.artifactClass ?? null
      });
    }
    for (const [index, mitigation] of (row.claimed_mitigations ?? []).entries()) {
      for (const [refKind, rawRef] of [["CODE_REF", mitigation.code_ref], ["EVIDENCE_REF", mitigation.evidence_ref]]) {
        if (!rawRef || !String(rawRef).trim()) continue;
        const check = matchRegisteredSource(rawRef, sources);
        referenceChecks.push({
          ownerType: "FAILURE_MODE_MITIGATION",
          ownerId: row.id,
          mitigationIndex: index,
          control: mitigation.control,
          mitigationType: mitigation.type,
          refKind,
          reference: check.normalizedRef,
          declaredStatus: mitigation.evidence_status_observed,
          snapshotStatus: check.kind,
          matchedSourceId: check.matched?.id ?? null,
          matchedPath: check.matched?.path ?? null,
          artifactClass: check.matched?.artifactClass ?? null
        });
        if (check.kind === "MISSING_FROM_SNAPSHOT") {
          const highRisk = ["HIGH", "CRITICAL"].includes(row.severity_user);
          rows.push(comparison(
            `failureModes.${row.id}.${refKind === "CODE_REF" ? "codeRef" : "evidenceRef"}`,
            "DECLARED_REFERENCE_VERIFICATION",
            check.normalizedRef,
            [{ value: "MISSING_FROM_SNAPSHOT", citations: [] }],
            "CONTRADICTED",
            highRisk ? "HIGH" : "MEDIUM"
          ));
        }
      }
    }
  }

  for (const item of documentation.evidenceReferences ?? []) {
    if (!item.reference || !String(item.reference).trim()) continue;
    const looksLikeRepoPath = !/^https?:\/\//i.test(item.reference) && /[/.]/.test(item.reference);
    if (!looksLikeRepoPath) continue;
    const check = matchRegisteredSource(item.reference, sources);
    referenceChecks.push({
      ownerType: "EVIDENCE_INDEX",
      ownerId: item.id,
      refKind: "EVIDENCE_REF",
      reference: check.normalizedRef,
      declaredStatus: item.verification || "UNVERIFIED",
      snapshotStatus: check.kind,
      matchedSourceId: check.matched?.id ?? null,
      matchedPath: check.matched?.path ?? null,
      artifactClass: check.matched?.artifactClass ?? null
    });
  }

  return { referenceChecks, rows };
}

export function buildDeclarationComparison(snapshot, units, registeredSources = []) {
  const dossier = snapshot.effectiveDossier;
  const values = flattenDossier(dossier);
  const readmeUnits = units.filter((unit) => readme.test(unit.path) && !fixtureOrSamplePath.test(unit.path) && !docsDirPath.test(unit.path) && unit.evidenceClass !== "DECLARED");
  const additionalDocUnits = units.filter((unit) => unit.path !== "intended-use-dossier.json"
    && unit.evidenceClass !== "DECLARED"
    && !readme.test(unit.path)
    && !fixtureOrSamplePath.test(unit.path)
    && !testCodePath.test(unit.path)
    && classifyArtifact(unit.path) === "DOCUMENTATION");
  const configuration = units.flatMap(configuredBooleans);
  const rows = [
    ...compareDocumentTier(readmeUnits, "README_DOCUMENTATION", dossier, values),
    ...compareDocumentTier(additionalDocUnits, "ADDITIONAL_DOCUMENTATION", dossier, values),
    ...compareDeclaredTopicsWithDocs(snapshot, [...readmeUnits, ...additionalDocUnits])
  ];
  for (const field of Object.keys(booleanFields)) {
    const declared = values[field];
    if (typeof declared !== "boolean") continue;
    rows.push(comparison(field, "STATIC_CONFIGURATION", declared, configuration.filter((item) => item.field === field)
      .map(({ value, citation }) => ({ value, citations: [citation] }))));
  }
  rows.push(...compareCodebaseImplementation(snapshot, units));
  const { referenceChecks, rows: referenceRows } = verifyDeclaredReferences(snapshot, registeredSources);
  rows.push(...referenceRows);

  const payload = {
    schemaVersion: COMPARISON_VERSION,
    approvedIntakeHash: snapshot.snapshotHash,
    acquisitionManifestHash: snapshot.acquisitionManifest.hash,
    sourceSnapshotHash: sha256(registeredSources.filter((source) => source.path !== "intended-use-dossier.json")
      .map(({ path, sha256: digest }) => ({ path, digest })).sort((left, right) => left.path.localeCompare(right.path) || left.digest.localeCompare(right.digest))),
    status: units.length ? "SCOPED_COMPARISON" : "LOCAL_EVIDENCE_UNAVAILABLE",
    rows,
    referenceChecks,
    limitations: [
      "Results compare approved Intake and Documentation Support declarations against submitted README, documentation, configuration, codebase patterns, and repository-relative reference paths.",
      "Static sources and located file paths do not establish deployed runtime behavior or passed test execution."
    ]
  };
  return { ...payload, comparisonHash: sha256(payload) };
}

export function validateDeclarationComparison(comparisonRecord, snapshot) {
  const { comparisonHash, ...payload } = comparisonRecord ?? {};
  invariant(SUPPORTED_COMPARISON_VERSIONS.has(payload.schemaVersion) && sha256(payload) === comparisonHash, "Intake source comparison failed its integrity check");
  invariant(payload.approvedIntakeHash === snapshot.snapshotHash && payload.acquisitionManifestHash === snapshot.acquisitionManifest.hash, "Intake source comparison does not match the approved revision");
  invariant(Array.isArray(payload.rows), "Intake source comparison rows must be an array");
  invariant(payload.referenceChecks === undefined || Array.isArray(payload.referenceChecks), "Intake source comparison referenceChecks must be an array");
  return comparisonRecord;
}

export function createSafeComparisonSummary(comparisonRecord) {
  if (!comparisonRecord) return null;
  return {
    schemaVersion: SAFE_COMPARISON_SUMMARY_VERSION,
    comparisonHash: comparisonRecord.comparisonHash,
    status: comparisonRecord.status,
    findings: (comparisonRecord.rows ?? [])
      .filter((row) => ["CONTRADICTED", "UNVERIFIED_IN_CODE", "ALIGNED"].includes(row.status))
      .map((row) => ({
        field: row.field,
        evidenceTier: row.evidenceTier,
        status: row.status,
        severity: row.severity ?? null,
        sourceUnitIds: [...new Set((row.observations ?? []).flatMap((obs) => (obs.citations ?? []).map((item) => item.sourceUnitId)).filter(Boolean))]
      })),
    referenceChecks: (comparisonRecord.referenceChecks ?? []).map((check) => ({
      ownerType: check.ownerType,
      ownerId: check.ownerId,
      refKind: check.refKind,
      declaredStatus: check.declaredStatus,
      snapshotStatus: check.snapshotStatus,
      artifactClass: check.artifactClass ?? null
    })),
    rawContentIncluded: false
  };
}
