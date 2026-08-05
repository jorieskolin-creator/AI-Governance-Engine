import { DOMAINS, SEVERITIES, invariant, validateDossier } from "../contracts.js";
import { stableId } from "../core/hash.js";
import { acceptedFormatsByMime } from "../../public/upload-types.js";

export const FACT_CLASSES = Object.freeze(["DECLARED", "OBSERVED", "INFERRED"]);
export const CLAIM_TYPES = Object.freeze(["FACT", "CONTROL_SUPPORT", "GAP", "RISK", "ANTIPATTERN", "ABSENCE_TEST", "CONTRADICTION", "UNKNOWN", "EVIDENCE_REQUEST"]);
export const VERIFICATION_STATES = Object.freeze(["SUPPORTED", "PARTIAL", "UNSUPPORTED", "CONFLICTING", "NOT_VERIFIABLE"]);
export const TRANSMISSION_STATES = Object.freeze(["LOCAL_ONLY", "PENDING_APPROVAL", "APPROVED", "TRANSMITTED", "PURGED"]);
export const NARRATIVE_SECTIONS = Object.freeze(["EXECUTIVE_DECISION", "DOMAIN_NARRATIVE", "CONFIRMED_STRENGTH", "BLOCKING_FINDING", "CONDITION", "HUMAN_QUESTION", "LIMITATION"]);
export const COVERAGE_STATES = Object.freeze(["ASSESSED", "UNKNOWN", "NOT_APPLICABLE", "FAILED", "HUMAN_INTERPRETATION_REQUIRED"]);
export const FACT_CHECK_ISSUES = Object.freeze(["NONE", "NARRATIVE_WORDING_ERROR", "REFERENCE_OR_GROUNDING_ERROR", "DETERMINISTIC_INCONSISTENCY", "TACTIC_GROUNDING_ERROR", "AUTHORITY_OVERREACH"]);
export const PUBLICATION_STATES = Object.freeze(["REPORT_READY", "REPORT_WITH_LIMITATIONS", "REPORT_WITHHELD"]);
export const COGNITIVE_CONTRACT_VERSION = "3.1.0";

export const ACCEPTED_FORMATS = acceptedFormatsByMime;

const stringArray = (value) => Array.isArray(value) && value.every((item) => typeof item === "string");

export function validatePreflightInput(input, options = {}) {
  invariant(input && typeof input === "object", "request body is required");
  const dossier = input.dossier ? validateDossier(input.dossier) : null;
  if (!options.dossierOptional) invariant(dossier, "dossier is required");
  invariant(Array.isArray(input.sources) && input.sources.length > 0, "sources must contain at least one item");
  const sources = input.sources.map((source, index) => {
    invariant(source && typeof source === "object", `sources[${index}] must be an object`);
    invariant(typeof source.path === "string" && source.path.trim(), `sources[${index}].path is required`);
    invariant(typeof source.mimeType === "string" && ACCEPTED_FORMATS[source.mimeType], `sources[${index}].mimeType is unsupported`);
    invariant(typeof source.content === "string", `sources[${index}].content must be a string`);
    const encoding = source.encoding ?? "utf8";
    invariant(["utf8", "base64"].includes(encoding), `sources[${index}].encoding must be utf8 or base64`);
    if (["PDF", "DOCX", "XLSX", "IMAGE"].includes(ACCEPTED_FORMATS[source.mimeType])) invariant(encoding === "base64", `sources[${index}] binary content must use base64 encoding`);
    invariant(!source.path.replaceAll("\\", "/").split("/").includes(".."), `Unsafe source path: ${source.path}`);
    return {
      path: source.path.replaceAll("\\", "/").replace(/^\.\//, ""),
      mimeType: source.mimeType,
      format: ACCEPTED_FORMATS[source.mimeType],
      encoding,
      content: source.content,
      metadata: source.metadata && typeof source.metadata === "object" ? source.metadata : {}
    };
  });
  return { dossier, sources };
}

export function validateExecutionApproval(input, run) {
  invariant(input && typeof input === "object", "execution approval is required");
  invariant(Array.isArray(input.approvedPackets), "approvedPackets must be an array");
  const packetIds = new Set(run.packets.map((item) => item.id));
  const approvedPackets = input.approvedPackets.map((item, index) => {
    invariant(item && typeof item === "object", `approvedPackets[${index}] must be an object`);
    invariant(packetIds.has(item.packetId), `Unknown packet: ${item.packetId}`);
    invariant(stringArray(item.providers) && item.providers.length > 0, `approvedPackets[${index}].providers is required`);
    invariant(item.providers.every((provider) => ["OPENAI", "ANTHROPIC", "GEMINI"].includes(provider)), `approvedPackets[${index}].providers contains an unsupported provider`);
    return { packetId: item.packetId, providers: [...new Set(item.providers)] };
  });
  invariant(approvedPackets.length === run.packets.length, "Every proposed packet requires an explicit approval entry");
  invariant(new Set(approvedPackets.map((item) => item.packetId)).size === run.packets.length, "Each packet must be approved exactly once");
  return { approvedPackets, approvedAt: new Date().toISOString() };
}

export function createGovernanceClaim(value, extractor) {
  invariant(CLAIM_TYPES.includes(value.claimType), `Invalid claimType: ${value.claimType}`);
  invariant(typeof value.statement === "string" && value.statement.trim(), "claim.statement is required");
  invariant(stringArray(value.sourceUnitIds) && value.sourceUnitIds.length > 0, "claim.sourceUnitIds is required");
  invariant(Array.isArray(value.evidenceQuotes) && value.evidenceQuotes.length > 0, "claim.evidenceQuotes is required");
  for (const quote of value.evidenceQuotes) {
    invariant(quote && typeof quote === "object" && typeof quote.sourceUnitId === "string" && typeof quote.quote === "string" && quote.quote.trim(), "claim.evidenceQuotes entries require sourceUnitId and quote");
    invariant(value.sourceUnitIds.includes(quote.sourceUnitId), "claim evidence quote must reference a claim sourceUnitId");
  }
  invariant(stringArray(value.controlIds), "claim.controlIds must be an array");
  invariant(stringArray(value.antiPatternIds), "claim.antiPatternIds must be an array");
  invariant(stringArray(value.requirementIds), "claim.requirementIds must be an array");
  invariant(stringArray(value.domains) && value.domains.every((item) => Object.hasOwn(DOMAINS, item)), "claim.domains is invalid");
  if (value.claimType === "CONTROL_SUPPORT") invariant(value.controlIds.length > 0, "CONTROL_SUPPORT requires at least one controlId");
  if (value.claimType === "ANTIPATTERN") invariant(value.antiPatternIds.length > 0, "ANTIPATTERN requires at least one antiPatternId");
  const severity = SEVERITIES.includes(value.severity) ? value.severity : "MEDIUM";
  const normalized = {
    claimType: value.claimType,
    statement: value.statement.trim(),
    sourceUnitIds: [...new Set(value.sourceUnitIds)].sort(),
    evidenceQuotes: value.evidenceQuotes.map((item) => ({ sourceUnitId: item.sourceUnitId, quote: item.quote.trim() })),
    controlIds: [...new Set(value.controlIds)].sort(),
    antiPatternIds: [...new Set(value.antiPatternIds)].sort(),
    requirementIds: [...new Set(value.requirementIds)].sort(),
    findingDefinitionIds: stringArray(value.findingDefinitionIds) ? [...new Set(value.findingDefinitionIds)].sort() : [],
    assessmentObjectIds: stringArray(value.assessmentObjectIds) ? [...new Set(value.assessmentObjectIds)].sort() : [],
    domains: [...new Set(value.domains)].sort(),
    severity,
    proposedAssuranceState: value.proposedAssuranceState ?? "UNKNOWN",
    proposedFindingState: typeof value.proposedFindingState === "string" && value.proposedFindingState.trim() ? value.proposedFindingState.trim() : null,
    limitations: stringArray(value.limitations) ? value.limitations : [],
    absenceTest: value.absenceTest && typeof value.absenceTest === "object" ? {
      scope: String(value.absenceTest.scope ?? "").trim(),
      method: String(value.absenceTest.method ?? "").trim(),
      executedAt: String(value.absenceTest.executedAt ?? "").trim(),
      result: String(value.absenceTest.result ?? "").trim(),
      systemVersion: String(value.absenceTest.systemVersion ?? "").trim(),
      limitations: stringArray(value.absenceTest.limitations) ? value.absenceTest.limitations : []
    } : null,
    extractor
  };
  if (value.claimType === "ABSENCE_TEST") {
    invariant(normalized.antiPatternIds.length > 0, "ABSENCE_TEST requires at least one antiPatternId");
    invariant(normalized.absenceTest?.scope && normalized.absenceTest?.method && normalized.absenceTest?.executedAt && normalized.absenceTest?.result && normalized.absenceTest?.systemVersion, "ABSENCE_TEST requires scope, method, executedAt, result, and systemVersion");
  }
  if (normalized.findingDefinitionIds.length) invariant(normalized.proposedFindingState, "Claims mapped to finding definitions require proposedFindingState");
  return { id: stableId("claim", normalized), ...normalized };
}

export const SOLUTION_MODEL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["facts", "contradictions", "unknowns"],
  properties: {
    facts: { type: "array", items: { type: "object", additionalProperties: false, required: ["factClass", "category", "statement", "sourceUnitIds", "evidenceQuotes"], properties: {
      factClass: { type: "string", enum: FACT_CLASSES }, category: { type: "string" }, statement: { type: "string" }, sourceUnitIds: { type: "array", items: { type: "string" } },
      evidenceQuotes: { type: "array", items: { type: "object", additionalProperties: false, required: ["sourceUnitId", "quote"], properties: { sourceUnitId: { type: "string" }, quote: { type: "string" } } } }
    } } },
    contradictions: { type: "array", items: { type: "object", additionalProperties: false, required: ["statement", "sourceUnitIds", "severity"], properties: {
      statement: { type: "string" }, sourceUnitIds: { type: "array", items: { type: "string" } }, severity: { type: "string", enum: SEVERITIES }
    } } },
    unknowns: { type: "array", items: { type: "string" } }
  }
};

export const SOLUTION_FACT_VERIFICATION_SCHEMA = {
  type: "object", additionalProperties: false, required: ["factResults"], properties: {
    factResults: { type: "array", items: { type: "object", additionalProperties: false, required: ["factId", "status", "rationale", "checkedSourceUnitIds", "conflictingSourceUnitIds"], properties: {
      factId: { type: "string" }, status: { type: "string", enum: VERIFICATION_STATES }, rationale: { type: "string" },
      checkedSourceUnitIds: { type: "array", items: { type: "string" } }, conflictingSourceUnitIds: { type: "array", items: { type: "string" } }
    } } }
  }
};

export const DISCOVERY_RECHECK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["candidates"],
  properties: {
    candidates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["field", "status", "value", "sourceUnitIds", "evidenceQuotes", "rationale"],
        properties: {
          field: { type: "string" },
          status: { type: "string", enum: ["CANDIDATE", "CONFLICTING", "NOT_FOUND"] },
          value: { type: "string" },
          sourceUnitIds: { type: "array", items: { type: "string" } },
          evidenceQuotes: { type: "array", items: { type: "object", additionalProperties: false, required: ["sourceUnitId", "quote"], properties: { sourceUnitId: { type: "string" }, quote: { type: "string" } } } },
          rationale: { type: "string" }
        }
      }
    }
  }
};

export const IMAGE_EXTRACTION_SCHEMA = {
  type: "object", additionalProperties: false, required: ["description", "visibleText", "sensitivityWarnings", "promptInjectionCandidates"], properties: {
    description: { type: "string" }, visibleText: { type: "string" }, sensitivityWarnings: { type: "array", items: { type: "string" } }, promptInjectionCandidates: { type: "array", items: { type: "string" } }
  }
};

export const ROUTING_SCHEMA = {
  type: "object", additionalProperties: false, required: ["routes"], properties: {
    routes: { type: "array", items: { type: "object", additionalProperties: false, required: ["sourceUnitId", "domains", "rationale"], properties: {
      sourceUnitId: { type: "string" }, domains: { type: "array", items: { type: "string", enum: Object.keys(DOMAINS) } }, rationale: { type: "string" }
    } } }
  }
};

export const DOMAIN_CLAIMS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["claims"],
  properties: {
    claims: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["claimType", "statement", "sourceUnitIds", "evidenceQuotes", "controlIds", "antiPatternIds", "requirementIds", "findingDefinitionIds", "assessmentObjectIds", "domains", "severity", "proposedAssuranceState", "limitations", "proposedFindingState", "absenceTest"],
        properties: {
          claimType: { type: "string", enum: CLAIM_TYPES },
          statement: { type: "string" },
          sourceUnitIds: { type: "array", items: { type: "string" } },
          evidenceQuotes: { type: "array", items: { type: "object", additionalProperties: false, required: ["sourceUnitId", "quote"], properties: { sourceUnitId: { type: "string" }, quote: { type: "string" } } } },
          controlIds: { type: "array", items: { type: "string" } },
          antiPatternIds: { type: "array", items: { type: "string" } },
          requirementIds: { type: "array", items: { type: "string" } },
          findingDefinitionIds: { type: "array", items: { type: "string" } },
          assessmentObjectIds: { type: "array", items: { type: "string" } },
          domains: { type: "array", items: { type: "string", enum: Object.keys(DOMAINS) } },
          severity: { type: "string", enum: SEVERITIES },
          proposedAssuranceState: { type: "string", enum: ["UNKNOWN", "DECLARED", "IMPLEMENTED", "TESTED", "OPERATIONALLY_OBSERVED", "HUMAN_VALIDATED"] },
          limitations: { type: "array", items: { type: "string" } }, proposedFindingState: { type: ["string", "null"] },
          absenceTest: { type: ["object", "null"], additionalProperties: false, required: ["scope", "method", "executedAt", "result", "systemVersion", "limitations"], properties: {
            scope: { type: "string" }, method: { type: "string" }, executedAt: { type: "string" }, result: { type: "string" }, systemVersion: { type: "string" }, limitations: { type: "array", items: { type: "string" } }
          } }
        }
      }
    }
  }
};

export const VERIFICATION_SCHEMA = {
  type: "object", additionalProperties: false, required: ["status", "rationale", "checkedSourceUnitIds", "conflictingSourceUnitIds", "acceptedAssuranceState", "mappingStatus", "scopeStatus", "quoteStatus"], properties: {
    status: { type: "string", enum: VERIFICATION_STATES }, rationale: { type: "string" }, checkedSourceUnitIds: { type: "array", items: { type: "string" } }, conflictingSourceUnitIds: { type: "array", items: { type: "string" } },
    acceptedAssuranceState: { type: "string", enum: ["UNKNOWN", "DECLARED", "IMPLEMENTED", "TESTED", "OPERATIONALLY_OBSERVED", "HUMAN_VALIDATED"] },
    mappingStatus: { type: "string", enum: ["SUPPORTED", "PARTIAL", "UNSUPPORTED", "NOT_CHECKED"] },
    scopeStatus: { type: "string", enum: ["SUPPORTED", "PARTIAL", "OVERSTATED", "NOT_CHECKED"] },
    quoteStatus: { type: "string", enum: ["SUPPORTED", "PARTIAL", "UNSUPPORTED", "NOT_CHECKED"] }
  }
};

export const SYNTHESIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["items"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["id", "section", "text", "domain", "authority", "findingIds", "gateIds", "controlIds", "evidenceIds", "actionIds"],
        properties: {
          id: { type: "string" }, section: { type: "string", enum: NARRATIVE_SECTIONS }, text: { type: "string" },
          domain: { type: ["string", "null"], enum: [...Object.keys(DOMAINS), null] }, authority: { type: ["string", "null"] },
          findingIds: { type: "array", items: { type: "string" } }, gateIds: { type: "array", items: { type: "string" } },
          controlIds: { type: "array", items: { type: "string" } }, evidenceIds: { type: "array", items: { type: "string" } }, actionIds: { type: "array", items: { type: "string" } }
        }
      }
    }
  }
};

export const FACT_CHECK_SCHEMA = {
  type: "object", additionalProperties: false, required: ["supported", "itemResults"], properties: {
    supported: { type: "boolean" },
    itemResults: { type: "array", items: { type: "object", additionalProperties: false, required: ["itemId", "status", "rationale", "correctedText", "issueType", "affectedFindingIds", "affectedActionIds"], properties: {
      itemId: { type: "string" }, status: { type: "string", enum: ["SUPPORTED", "PARTIAL", "UNSUPPORTED"] }, rationale: { type: "string" }, correctedText: { type: "string" },
      issueType: { type: ["string", "null"], enum: [...FACT_CHECK_ISSUES, null] }, affectedFindingIds: { type: "array", items: { type: "string" } }, affectedActionIds: { type: "array", items: { type: "string" } }
    } } }
  }
};
