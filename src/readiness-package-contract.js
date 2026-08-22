import { READINESS_OUTCOMES, invariant } from "./contracts.js";
import { sha256 } from "./core/hash.js";
import { EVIDENCE_ACQUISITION_VERSION, INGESTION_DISPOSITIONS } from "./core/source-ingestion.js";
import { SOURCE_INGESTION_VERSION } from "../public/upload-types.js";

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

const EVIDENCE_ITEM_SCHEMA = Object.freeze({
  type: "object", additionalProperties: false,
  required: ["id", "sourceId", "path", "kind", "sha256", "excerpt", "signal", "domainIds", "controlIds", "antiPatternIds", "assuranceState", "polarity", "stale", "capturedAt"],
  properties: {
    id: { type: "string", minLength: 1 }, sourceId: { type: "string", minLength: 1 }, path: { type: "string" }, kind: { type: "string", minLength: 1 },
    sha256: { type: "string", pattern: "^[a-f0-9]{64}$" }, excerpt: { type: "string" }, signal: { type: "string", minLength: 1 },
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
    manifestHash: { type: "string", pattern: "^[a-f0-9]{64}$" }
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
    packageHash: { type: "string", pattern: "^[a-f0-9]{64}$" },
    evidence: { type: "array", items: EVIDENCE_ITEM_SCHEMA },
    sourceIngestion: SOURCE_INGESTION_SCHEMA,
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
  if (schemaVersion === "2.6.0") {
    properties.cognitive = {
      type: "object", required: ["contractVersion", "rolloutMode", "authorityBoundary"],
      properties: {
        contractVersion: { const: "3.1.0" }, rolloutMode: { const: "ENABLED" },
        authorityBoundary: { type: "string", minLength: 1 }
      }
    };
  }
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: `https://ai-governance-engine.invalid/contracts/readiness-package/${schemaVersion}`,
    title: `ReadinessPackage ${schemaVersion}`,
    description: "Strict top-level integration contract. Local runtime validation additionally enforces cross-ledger hashes, package integrity, JSON safety, and nested cognitive invariants.",
    "x-contract-coverage": "TOP_LEVEL_AND_GOVERNANCE_INVARIANTS",
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
