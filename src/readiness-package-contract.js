import { HUMAN_AUTHORITIES, READINESS_OUTCOMES, invariant } from "./contracts.js";
import { sha256 } from "./core/hash.js";
import { EVIDENCE_ACQUISITION_VERSION, INGESTION_DISPOSITIONS } from "./core/source-ingestion.js";
import { SOURCE_INGESTION_VERSION } from "../public/upload-types.js";
import { COGNITIVE_CONTRACT_VERSION, COVERAGE_STATES, PUBLICATION_STATES } from "./cognitive/contracts.js";

export const READINESS_PACKAGE_VERSIONS = Object.freeze(["1.4.0", "2.6.0"]);

const COMMON_FIELDS = Object.freeze([
  "actionGroundingRecords", "actions", "adjudicatedClaims", "applicability", "assessmentIntake", "assuranceSummary",
  "coverageMatrix", "derivedSourceUnits", "dimensions", "documentationContradictions", "documentationGate", "domains",
  "documentationReadiness", "engineVersion", "evidence", "findingLockRecords", "generatedAt", "hardGates",
  "humanDecisionRequirements", "knowledge", "packageHash", "packageId", "publicationGate", "reanalysisTrace",
  "reassessmentTriggers", "recommendation", "rulesetVersion", "runId", "schemaVersion", "solution", "solutionProfile",
  "sourceIngestion", "trace", "transitionBoundary", "unresolvedClaims"
]);

const ARRAY_FIELDS = Object.freeze([
  "actionGroundingRecords", "actions", "adjudicatedClaims", "applicability", "derivedSourceUnits", "documentationContradictions", "domains",
  "evidence", "findingLockRecords", "hardGates", "humanDecisionRequirements", "reanalysisTrace", "reassessmentTriggers",
  "unresolvedClaims"
]);

const NULLABLE_OBJECT_FIELDS = Object.freeze(["coverageMatrix", "documentationGate", "publicationGate"]);

const STRING_ARRAY_SCHEMA = Object.freeze({ type: "array", items: { type: "string" } });
const SHA256_SCHEMA = Object.freeze({ type: "string", pattern: "^[a-f0-9]{64}$" });

const EVIDENCE_ITEM_SCHEMA = Object.freeze({
  type: "object", additionalProperties: false,
  required: ["id", "sourceId", "path", "kind", "sha256", "excerpt", "signal", "domainIds", "controlIds", "antiPatternIds", "assuranceState", "polarity", "stale", "capturedAt"],
  properties: {
    id: { type: "string", minLength: 1 }, sourceId: { type: "string", minLength: 1 }, path: { type: "string" }, kind: { type: "string", minLength: 1 },
    sha256: SHA256_SCHEMA, excerpt: { type: "string" }, signal: { type: "string", minLength: 1 },
    domainIds: STRING_ARRAY_SCHEMA, controlIds: STRING_ARRAY_SCHEMA, antiPatternIds: STRING_ARRAY_SCHEMA,
    assuranceState: { type: "string", minLength: 1 }, polarity: { type: "string", minLength: 1 }, stale: { type: "boolean" },
    capturedAt: { type: "string", format: "date-time" }, eligibleForAssurance: { type: "boolean" }, evidenceClass: { type: "string", minLength: 1 }
  }
});

const SOURCE_INGESTION_ITEM_SCHEMA = Object.freeze({
  type: "object", additionalProperties: false,
  required: ["path", "size", "mimeType", "format", "artifactClass", "disposition", "reasonCode", "riskClass"],
  properties: {
    path: { type: "string" }, size: { type: ["number", "null"], minimum: 0 }, mimeType: { type: "string" }, format: { type: ["string", "null"] },
    artifactClass: { type: "string" }, disposition: { type: "string", enum: INGESTION_DISPOSITIONS }, reasonCode: { type: "string" }, riskClass: { type: "string" },
    acquisitionLane: { type: "string" }, rawContentPolicy: { type: "string" }, egressPolicy: { type: "string" },
    derivedUnitIds: STRING_ARRAY_SCHEMA, analyzerVersion: { type: ["string", "null"] }
  }
});

const SOURCE_INGESTION_SCHEMA = Object.freeze({
  type: "object", additionalProperties: false,
  required: ["version", "acquisitionContractVersion", "selectionMode", "selectionCompleteness", "selectedCount", "acceptedCount", "parsedCount", "excludedCount", "failedCount", "unsafeCount", "laneCounts", "coverageStatus", "relevantExclusionCount", "items", "humanCoverageAcceptance", "manifestHash"],
  properties: {
    version: { const: SOURCE_INGESTION_VERSION }, acquisitionContractVersion: { const: EVIDENCE_ACQUISITION_VERSION },
    selectionMode: { type: "string" }, selectionCompleteness: { type: "string" },
    selectedCount: { type: "integer", minimum: 0 }, acceptedCount: { type: "integer", minimum: 0 }, parsedCount: { type: "integer", minimum: 0 },
    excludedCount: { type: "integer", minimum: 0 }, failedCount: { type: "integer", minimum: 0 }, unsafeCount: { type: "integer", minimum: 0 },
    laneCounts: { type: "object", additionalProperties: { type: "integer", minimum: 0 } }, coverageStatus: { type: "string" }, relevantExclusionCount: { type: "integer", minimum: 0 },
    items: { type: "array", items: SOURCE_INGESTION_ITEM_SCHEMA }, humanCoverageAcceptance: { type: ["object", "null"] },
    manifestHash: SHA256_SCHEMA
  }
});

const KNOWLEDGE_SCHEMA = Object.freeze({
  type: "object", additionalProperties: false,
  required: ["version", "source", "releaseStatus", "manifestHash", "manifestUrl", "diagnostics", "counts"],
  properties: {
    version: { type: "string", minLength: 1 },
    source: { type: "string", minLength: 1 },
    releaseStatus: { type: "string", minLength: 1 },
    manifestHash: SHA256_SCHEMA,
    manifestUrl: { type: ["string", "null"] },
    diagnostics: {
      type: "object", additionalProperties: false,
      required: ["version", "status", "errorCount", "warningCount"],
      properties: {
        version: { type: "string", minLength: 1 },
        status: { type: "string", minLength: 1 },
        errorCount: { type: ["integer", "null"], minimum: 0 },
        warningCount: { type: ["integer", "null"], minimum: 0 }
      }
    },
    counts: {
      type: "object", additionalProperties: false,
      required: ["normativeSources", "requirements", "controls", "antipatterns", "tactics", "intakeQuestions"],
      properties: {
        normativeSources: { type: "integer", minimum: 0 },
        requirements: { type: "integer", minimum: 0 },
        controls: { type: "integer", minimum: 0 },
        antipatterns: { type: "integer", minimum: 0 },
        tactics: { type: "integer", minimum: 0 },
        intakeQuestions: { type: "integer", minimum: 0 }
      }
    }
  }
});

const RISK_DRIVER_SCHEMA = Object.freeze({
  type: "object", additionalProperties: false,
  required: ["id", "type", "title", "severity", "basisStatus", "domain", "findingIds", "controlIds"],
  properties: {
    id: { type: "string", minLength: 1 },
    type: { type: "string", minLength: 1 },
    title: { type: "string" },
    severity: { type: "string", minLength: 1 },
    basisStatus: { type: "string", minLength: 1 },
    domain: { type: ["string", "null"] },
    findingIds: STRING_ARRAY_SCHEMA,
    controlIds: STRING_ARRAY_SCHEMA,
    ruleIds: STRING_ARRAY_SCHEMA
  }
});

const DIMENSIONS_SCHEMA = Object.freeze({
  type: "object", additionalProperties: false,
  required: [
    "indicatorCoverage", "assessmentCoverage", "verifiedEvidenceCoverage", "evidenceCoverage", "controlAssurance",
    "documentationAlignment", "assuranceDeficit", "riskDetermination", "residualRisk", "riskDrivers", "gateStatus", "explanation"
  ],
  properties: {
    indicatorCoverage: { type: "integer", minimum: 0, maximum: 100 },
    assessmentCoverage: { type: "integer", minimum: 0, maximum: 100 },
    verifiedEvidenceCoverage: { type: "integer", minimum: 0, maximum: 100 },
    evidenceCoverage: { type: "integer", minimum: 0, maximum: 100 },
    controlAssurance: { type: "integer", minimum: 0, maximum: 100 },
    documentationAlignment: { type: "string", minLength: 1 },
    assuranceDeficit: { type: "string", minLength: 1 },
    riskDetermination: { type: "string", minLength: 1 },
    residualRisk: { type: "string", minLength: 1 },
    riskDrivers: { type: "array", items: RISK_DRIVER_SCHEMA },
    gateStatus: { type: "string", minLength: 1 },
    explanation: { type: "string", minLength: 1 }
  }
});

const HARD_GATE_ITEM_SCHEMA = Object.freeze({
  type: "object", additionalProperties: false,
  required: [
    "id", "code", "outcome", "title", "rationale", "basisStatus", "evidenceIds", "requiredHumanAuthorities",
    "clearanceCriteria", "requiredEvidenceKinds", "blockedTransition", "reviewRequiredForTransition", "controlIds", "requirementIds", "ruleIds"
  ],
  properties: {
    id: { type: "string", minLength: 1 },
    code: { type: "string", minLength: 1 },
    outcome: { type: "string", minLength: 1 },
    title: { type: "string", minLength: 1 },
    rationale: { type: "string" },
    basisStatus: { type: "string", minLength: 1 },
    evidenceIds: STRING_ARRAY_SCHEMA,
    requiredHumanAuthorities: { type: "array", items: { type: "string", enum: HUMAN_AUTHORITIES } },
    clearanceCriteria: STRING_ARRAY_SCHEMA,
    requiredEvidenceKinds: STRING_ARRAY_SCHEMA,
    blockedTransition: { type: ["string", "null"] },
    reviewRequiredForTransition: { type: ["string", "null"] },
    controlIds: STRING_ARRAY_SCHEMA,
    requirementIds: STRING_ARRAY_SCHEMA,
    ruleIds: STRING_ARRAY_SCHEMA
  }
});

const HUMAN_DECISION_ITEM_SCHEMA = Object.freeze({
  type: "object", additionalProperties: false,
  required: ["authority", "reasons", "status"],
  properties: {
    authority: { type: "string", enum: HUMAN_AUTHORITIES },
    reasons: STRING_ARRAY_SCHEMA,
    status: { type: "string", minLength: 1 }
  }
});

const ACTION_GROUNDING_ITEM_SCHEMA = Object.freeze({
  type: "object", additionalProperties: false,
  required: [
    "id", "actionId", "tacticId", "tacticVersion", "lockedFindingIds", "findingDefinitionIds", "assessmentObjectIds",
    "requiredEvidence", "acceptanceCriteria", "verificationMethod", "status", "reason"
  ],
  properties: {
    id: { type: "string", minLength: 1 },
    actionId: { type: "string", minLength: 1 },
    tacticId: { type: "string", minLength: 1 },
    tacticVersion: { type: "string", minLength: 1 },
    lockedFindingIds: STRING_ARRAY_SCHEMA,
    findingDefinitionIds: STRING_ARRAY_SCHEMA,
    assessmentObjectIds: STRING_ARRAY_SCHEMA,
    requiredEvidence: STRING_ARRAY_SCHEMA,
    acceptanceCriteria: STRING_ARRAY_SCHEMA,
    verificationMethod: { type: "string" },
    status: { type: "string", minLength: 1 },
    reason: { type: "string", minLength: 1 }
  }
});

const COVERAGE_ENTRY_SCHEMA = Object.freeze({
  type: "object", additionalProperties: false,
  required: ["id", "objectId", "parentId", "kind", "domain", "lifecycleStages", "title", "status", "mandatory", "evidenceStatus"],
  properties: {
    id: { type: "string", minLength: 1 },
    objectId: { type: "string", minLength: 1 },
    parentId: { type: ["string", "null"] },
    kind: { type: "string", minLength: 1 },
    domain: { type: "string", minLength: 1 },
    lifecycleStages: STRING_ARRAY_SCHEMA,
    title: { type: "string" },
    status: { type: "string", enum: COVERAGE_STATES },
    mandatory: { type: "boolean" },
    evidenceStatus: { type: ["string", "null"] }
  }
});

const COVERAGE_MATRIX_SCHEMA = Object.freeze({
  type: ["object", "null"], additionalProperties: false,
  required: ["version", "complete", "entries", "counts", "domainStatus"],
  properties: {
    version: { type: "string", minLength: 1 },
    complete: { type: "boolean" },
    entries: { type: "array", items: COVERAGE_ENTRY_SCHEMA },
    counts: { type: "object", additionalProperties: { type: "integer", minimum: 0 } },
    domainStatus: { type: "object", additionalProperties: { type: "string" } }
  }
});

const PUBLICATION_GATE_SCHEMA = Object.freeze({
  type: ["object", "null"], additionalProperties: false,
  required: ["version", "status", "blockers", "limitations", "readinessIndependent", "statement"],
  properties: {
    version: { type: "string", minLength: 1 },
    status: { type: "string", enum: PUBLICATION_STATES },
    blockers: STRING_ARRAY_SCHEMA,
    limitations: STRING_ARRAY_SCHEMA,
    readinessIndependent: { const: true },
    statement: { type: "string", minLength: 1 }
  }
});

const COGNITIVE_OBJECT_FIELDS = Object.freeze([
  "solutionModel", "coverage", "coverageMatrix", "narrative", "factCheck", "factCheckIntegrity", "publicationGate", "budget"
]);
const COGNITIVE_ARRAY_FIELDS = Object.freeze([
  "claimLedger", "contradictionGraph", "verificationRecords", "adjudicatedClaims", "unresolvedClaims", "lockedFindings",
  "findingLockRecords", "derivedSourceUnits", "reanalysisTrace", "actionGroundingRecords", "transmissionManifest",
  "modelExecutionTrace", "integrityIncidents"
]);

const COGNITIVE_SCHEMA = Object.freeze({
  type: "object", additionalProperties: false,
  required: ["contractVersion", "rolloutMode", "authorityBoundary", ...COGNITIVE_OBJECT_FIELDS, ...COGNITIVE_ARRAY_FIELDS],
  properties: {
    contractVersion: { const: COGNITIVE_CONTRACT_VERSION },
    rolloutMode: { const: "ENABLED" },
    authorityBoundary: { type: "string", minLength: 1 },
    solutionModel: { type: "object" },
    coverage: { type: "object", required: ["complete"], properties: { complete: { type: "boolean" } } },
    coverageMatrix: COVERAGE_MATRIX_SCHEMA,
    narrative: { type: "object" },
    factCheck: { type: "object" },
    factCheckIntegrity: { type: "object" },
    publicationGate: PUBLICATION_GATE_SCHEMA,
    budget: { type: "object" },
    claimLedger: { type: "array" },
    contradictionGraph: { type: "array" },
    verificationRecords: { type: "array" },
    adjudicatedClaims: { type: "array" },
    unresolvedClaims: { type: "array" },
    lockedFindings: { type: "array" },
    findingLockRecords: { type: "array" },
    derivedSourceUnits: { type: "array" },
    reanalysisTrace: { type: "array" },
    actionGroundingRecords: { type: "array", items: ACTION_GROUNDING_ITEM_SCHEMA },
    transmissionManifest: { type: "array" },
    modelExecutionTrace: { type: "array" },
    integrityIncidents: { type: "array" }
  }
});

export function readinessPackageJsonSchema(schemaVersion = "2.6.0") {
  invariant(READINESS_PACKAGE_VERSIONS.includes(schemaVersion), "ReadinessPackage schemaVersion is unsupported");
  const fields = [...COMMON_FIELDS, ...(schemaVersion === "2.6.0" ? ["cognitive"] : [])];
  const properties = Object.fromEntries(fields.map((field) => {
    if (ARRAY_FIELDS.includes(field)) return [field, { type: "array" }];
    if (NULLABLE_OBJECT_FIELDS.includes(field)) return [field, { type: ["object", "null"] }];
    return [field, { type: "object" }];
  }));
  Object.assign(properties, {
    schemaVersion: { const: schemaVersion },
    packageId: { type: "string", pattern: "^readiness-package-" },
    runId: { type: "string", minLength: 1 },
    engineVersion: { type: "string", minLength: 1 },
    rulesetVersion: { type: "string", minLength: 1 },
    generatedAt: { type: "string", format: "date-time" },
    packageHash: SHA256_SCHEMA,
    knowledge: KNOWLEDGE_SCHEMA,
    evidence: { type: "array", items: EVIDENCE_ITEM_SCHEMA },
    sourceIngestion: SOURCE_INGESTION_SCHEMA,
    dimensions: DIMENSIONS_SCHEMA,
    hardGates: { type: "array", items: HARD_GATE_ITEM_SCHEMA },
    humanDecisionRequirements: { type: "array", items: HUMAN_DECISION_ITEM_SCHEMA },
    actionGroundingRecords: { type: "array", items: ACTION_GROUNDING_ITEM_SCHEMA },
    coverageMatrix: COVERAGE_MATRIX_SCHEMA,
    publicationGate: PUBLICATION_GATE_SCHEMA,
    documentationGate: { ...HARD_GATE_ITEM_SCHEMA, type: ["object", "null"] },
    recommendation: {
      type: "object", additionalProperties: false,
      required: ["outcome", "rationale", "formalApproval", "boundary"],
      properties: {
        outcome: { type: "string", enum: READINESS_OUTCOMES }, rationale: { type: "string" },
        formalApproval: { const: false }, boundary: { type: "string", minLength: 1 }
      }
    },
    transitionBoundary: {
      type: "object", required: ["immutable"], properties: { immutable: { const: true } }
    },
    trace: {
      type: "object", additionalProperties: false,
      required: ["inputHash", "evidenceSnapshotHash", "stages", "startedAt", "completedAt"],
      properties: {
        inputHash: { type: "string", minLength: 1 }, evidenceSnapshotHash: { type: "string", minLength: 1 },
        stages: { type: "array" }, startedAt: { type: "string", format: "date-time" }, completedAt: { type: "string", format: "date-time" }
      }
    }
  });
  if (schemaVersion === "2.6.0") properties.cognitive = COGNITIVE_SCHEMA;
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: `https://ai-governance-engine.invalid/contracts/readiness-package/${schemaVersion}`,
    title: `ReadinessPackage ${schemaVersion}`,
    description: "Nested integration contract for published ledgers and cognitive required keys. Local runtime validation additionally enforces cross-ledger hashes, package integrity, JSON safety, and nested cognitive invariants.",
    "x-contract-coverage": "NESTED_LEDGERS_AND_GOVERNANCE_INVARIANTS",
    type: "object",
    additionalProperties: false,
    required: fields,
    properties
  };
}

function objectValue(value, path) {
  invariant(value && typeof value === "object" && !Array.isArray(value), `${path} must be an object`);
}

function jsonSafe(value, path = "$") {
  invariant(value !== undefined, `${path} must not be undefined`);
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    invariant(Number.isFinite(value), `${path} must be a finite number`);
    return;
  }
  invariant(typeof value === "object", `${path} contains a non-JSON value`);
  if (Array.isArray(value)) {
    value.forEach((item, index) => jsonSafe(item, `${path}[${index}]`));
    return;
  }
  invariant(Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null, `${path} must be a plain object`);
  for (const [key, child] of Object.entries(value)) jsonSafe(child, `${path}.${key}`);
}

function validateCognitiveContract(pkg) {
  if (pkg.schemaVersion === "1.4.0") {
    invariant(!Object.hasOwn(pkg, "cognitive"), "ReadinessPackage 1.4.0 must not contain a cognitive contract");
    return;
  }
  objectValue(pkg.cognitive, "package.cognitive");
  invariant(pkg.cognitive.contractVersion === "3.1.0", "package.cognitive.contractVersion is unsupported");
  invariant(pkg.cognitive.rolloutMode === "ENABLED", "package.cognitive.rolloutMode must be ENABLED");
  for (const field of ["solutionModel", "coverage", "coverageMatrix", "narrative", "factCheck", "factCheckIntegrity", "publicationGate", "budget"]) objectValue(pkg.cognitive[field], `package.cognitive.${field}`);
  for (const field of ["claimLedger", "contradictionGraph", "verificationRecords", "adjudicatedClaims", "unresolvedClaims", "lockedFindings", "findingLockRecords", "derivedSourceUnits", "reanalysisTrace", "actionGroundingRecords", "transmissionManifest", "modelExecutionTrace", "integrityIncidents"]) {
    invariant(Array.isArray(pkg.cognitive[field]), `package.cognitive.${field} must be an array`);
  }
  invariant(typeof pkg.cognitive.coverage.complete === "boolean", "package.cognitive.coverage.complete must be a boolean");
  invariant(typeof pkg.cognitive.authorityBoundary === "string" && pkg.cognitive.authorityBoundary.length > 0, "package.cognitive.authorityBoundary is required");
  invariant(sha256(pkg.coverageMatrix) === sha256(pkg.cognitive.coverageMatrix), "package.coverageMatrix must match the cognitive coverage matrix");
  invariant(sha256(pkg.derivedSourceUnits) === sha256(pkg.cognitive.derivedSourceUnits), "package.derivedSourceUnits must match the cognitive derived-source ledger");
  invariant(sha256(pkg.adjudicatedClaims) === sha256(pkg.cognitive.adjudicatedClaims), "package.adjudicatedClaims must match the cognitive claim ledger");
  invariant(sha256(pkg.unresolvedClaims) === sha256(pkg.cognitive.unresolvedClaims), "package.unresolvedClaims must match the cognitive unresolved ledger");
  invariant(sha256(pkg.findingLockRecords) === sha256(pkg.cognitive.findingLockRecords), "package.findingLockRecords must match the cognitive finding locks");
  invariant(sha256(pkg.reanalysisTrace) === sha256(pkg.cognitive.reanalysisTrace), "package.reanalysisTrace must match the cognitive reanalysis ledger");
  invariant(sha256(pkg.actionGroundingRecords) === sha256(pkg.cognitive.actionGroundingRecords), "package.actionGroundingRecords must match the cognitive action-grounding ledger");
  invariant(sha256(pkg.publicationGate) === sha256(pkg.cognitive.publicationGate), "package.publicationGate must match the cognitive publication gate");
}

export function validateReadinessPackage(pkg) {
  objectValue(pkg, "package");
  invariant(READINESS_PACKAGE_VERSIONS.includes(pkg.schemaVersion), "ReadinessPackage schemaVersion is unsupported");
  const expectedFields = [...COMMON_FIELDS, ...(pkg.schemaVersion === "2.6.0" ? ["cognitive"] : [])].sort();
  invariant(Object.keys(pkg).sort().join("|") === expectedFields.join("|"), `ReadinessPackage ${pkg.schemaVersion} contains missing or unregistered fields`);
  jsonSafe(pkg);

  invariant(typeof pkg.packageId === "string" && pkg.packageId.startsWith("readiness-package-"), "package.packageId is invalid");
  invariant(typeof pkg.runId === "string" && pkg.runId.length > 0, "package.runId is required");
  invariant(typeof pkg.engineVersion === "string" && pkg.engineVersion.length > 0, "package.engineVersion is required");
  invariant(typeof pkg.rulesetVersion === "string" && pkg.rulesetVersion.length > 0, "package.rulesetVersion is required");
  invariant(typeof pkg.generatedAt === "string" && !Number.isNaN(Date.parse(pkg.generatedAt)), "package.generatedAt must be an ISO date-time");
  for (const field of ["knowledge", "solution", "assessmentIntake", "solutionProfile", "documentationReadiness", "sourceIngestion", "recommendation", "dimensions", "transitionBoundary", "assuranceSummary", "trace"]) objectValue(pkg[field], `package.${field}`);
  for (const field of ARRAY_FIELDS) invariant(Array.isArray(pkg[field]), `package.${field} must be an array`);
  invariant(pkg.documentationGate === null || (pkg.documentationGate && typeof pkg.documentationGate === "object" && !Array.isArray(pkg.documentationGate)), "package.documentationGate must be an object or null");
  invariant(pkg.publicationGate === null || (pkg.publicationGate && typeof pkg.publicationGate === "object" && !Array.isArray(pkg.publicationGate)), "package.publicationGate must be an object or null");
  invariant(pkg.coverageMatrix === null || (pkg.coverageMatrix && typeof pkg.coverageMatrix === "object" && !Array.isArray(pkg.coverageMatrix)), "package.coverageMatrix must be an object or null");
  invariant(READINESS_OUTCOMES.includes(pkg.recommendation.outcome), "package.recommendation.outcome is invalid");
  invariant(pkg.recommendation.formalApproval === false, "package.recommendation.formalApproval must remain false");
  invariant(pkg.transitionBoundary.immutable === true, "package.transitionBoundary must be immutable");
  invariant(Array.isArray(pkg.trace.stages), "package.trace.stages must be an array");
  invariant(typeof pkg.trace.inputHash === "string" && typeof pkg.trace.evidenceSnapshotHash === "string", "package trace hashes are required");
  validateCognitiveContract(pkg);

  const { packageHash, ...payload } = pkg;
  invariant(typeof packageHash === "string" && packageHash === sha256(payload), "ReadinessPackage failed its integrity check");
  return pkg;
}
