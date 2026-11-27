import { classifyArtifact, invariant } from "../contracts.js";
import { sha256 } from "../core/hash.js";
import { discoverSolutionProfile, flattenDossier } from "../core/solution-profile.js";

export const COMPARISON_VERSION = "intake-source-comparison/1.0.0";

const booleanFields = {
  "agent.usesAgents": "usesAgents",
  "agent.canTakeActions": "canTakeActions",
  "agent.irreversibleActions": "irreversibleActions",
  "agent.humanOverride": "humanOverride",
  "exposure.productionAccess": "productionAccess"
};

const materialFields = new Set(["intendedPurpose", "operatingBoundary.allowedUses", "operatingBoundary.excludedUses", ...Object.keys(booleanFields)]);
const variants = /(?:^|\/)(?:fixtures?|examples?|samples?|mocks?|documentation|docs)(?:\/|$)|(?:^|[._-])(?:example|sample|mock|template)(?:[._-]|$)/i;
const readme = /(?:^|\/)readme(?:\.[^/]*)?$/i;
const cite = (unit) => ({ sourceUnitId: unit.id, path: unit.path, locator: unit.locator, sha256: unit.sha256 });

function configuredBooleans(unit) {
  if (unit.evidenceClass === "DECLARED" || unit.path === "intended-use-dossier.json" ||
      classifyArtifact(unit.path) !== "CONFIGURATION" || variants.test(unit.path) || !unit.path.endsWith(".json")) return [];
  let config;
  try { config = JSON.parse(unit.content); }
  catch { return []; }
  if (!config || typeof config !== "object" || Array.isArray(config)) return [];
  return Object.entries(booleanFields).flatMap(([field, key]) => {
    const group = field.split(".")[0];
    // These selectors carry exact booleans. Repository names, comments, samples
    // and test specifications are insufficient to establish configured values.
    const values = [config[group]?.[key], config[key]].filter((value) => typeof value === "boolean");
    return [...new Set(values)].map((value) => ({ field, value, citation: cite(unit) }));
  });
}

function comparison(field, evidenceTier, declared, observations) {
  const different = observations.some((item) => sha256(item.value) !== sha256(declared));
  return {
    field, evidenceTier, declared, observations,
    status: different ? "CONTRADICTED" : observations.length ? "ALIGNED" : "INSUFFICIENT_EVIDENCE",
    severity: different && materialFields.has(field) ? "HIGH" : different ? "MEDIUM" : null
  };
}

export function buildDeclarationComparison(snapshot, units, registeredSources = []) {
  const dossier = snapshot.effectiveDossier;
  const values = flattenDossier(dossier);
  const documents = units.filter((unit) => readme.test(unit.path) && !variants.test(unit.path) && unit.evidenceClass !== "DECLARED");
  const configuration = units.flatMap(configuredBooleans);
  const rows = [];
  if (documents.length) {
    const profile = discoverSolutionProfile(documents, dossier);
    const citations = new Map(documents.map((unit) => [unit.id, cite(unit)]));
    for (const field of Object.keys(values)) {
      const fact = profile.fields[field];
      const declared = values[field];
      if (declared == null || declared === "" || declared === "UNKNOWN" || Array.isArray(declared) && !declared.length) continue;
      const disagreement = profile.contradictions.find((item) => item.field === field && !item.ruleId && item.sourceUnitIds.some((id) => citations.has(id)));
      if (disagreement) {
        const candidates = disagreement.observedCandidates.length ? disagreement.observedCandidates : [disagreement.observedValue];
        rows.push(comparison(field, "README_DOCUMENTATION", declared, candidates.filter((value) => value != null).map((value) => ({ value, citations: disagreement.sourceUnitIds.map((id) => citations.get(id)).filter(Boolean) }))));
      } else if (fact?.sourceUnitIds?.length) {
        rows.push(comparison(field, "README_DOCUMENTATION", declared, [{ value: declared, citations: fact.sourceUnitIds.map((id) => citations.get(id)).filter(Boolean) }]));
      }
    }
  }
  for (const field of Object.keys(booleanFields)) {
    const declared = values[field];
    if (typeof declared !== "boolean") continue;
    rows.push(comparison(field, "STATIC_CONFIGURATION", declared, configuration.filter((item) => item.field === field)
      .map(({ value, citation }) => ({ value, citations: [citation] }))));
  }
  const payload = {
    schemaVersion: COMPARISON_VERSION,
    approvedIntakeHash: snapshot.snapshotHash,
    acquisitionManifestHash: snapshot.acquisitionManifest.hash,
    sourceSnapshotHash: sha256(registeredSources.filter((source) => source.path !== "intended-use-dossier.json")
      .map(({ path, sha256: digest }) => ({ path, digest })).sort((left, right) => left.path.localeCompare(right.path) || left.digest.localeCompare(right.digest))),
    status: units.length ? "SCOPED_COMPARISON" : "LOCAL_EVIDENCE_UNAVAILABLE",
    rows,
    limitations: ["Results apply to selected README and configuration fields in the submitted snapshot. Static sources do not establish deployed behavior or executed verification."]
  };
  return { ...payload, comparisonHash: sha256(payload) };
}

export function validateDeclarationComparison(comparison, snapshot) {
  const { comparisonHash, ...payload } = comparison;
  invariant(payload.schemaVersion === COMPARISON_VERSION && sha256(payload) === comparisonHash, "Intake source comparison failed its integrity check");
  invariant(payload.approvedIntakeHash === snapshot.snapshotHash && payload.acquisitionManifestHash === snapshot.acquisitionManifest.hash, "Intake source comparison does not match the approved revision");
  return comparison;
}
