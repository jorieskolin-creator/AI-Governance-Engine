import { DOMAINS, SEVERITIES, invariant, validateDossier } from "../contracts.js";
import { stableId } from "../core/hash.js";

export const FACT_CLASSES = Object.freeze(["DECLARED", "OBSERVED", "INFERRED"]);
export const CLAIM_TYPES = Object.freeze(["FACT", "CONTROL_SUPPORT", "GAP", "RISK", "ANTIPATTERN", "CONTRADICTION", "UNKNOWN", "EVIDENCE_REQUEST"]);
export const VERIFICATION_STATES = Object.freeze(["SUPPORTED", "PARTIAL", "UNSUPPORTED", "CONFLICTING", "NOT_VERIFIABLE"]);
export const TRANSMISSION_STATES = Object.freeze(["LOCAL_ONLY", "PENDING_APPROVAL", "APPROVED", "TRANSMITTED", "PURGED"]);
export const NARRATIVE_SECTIONS = Object.freeze(["EXECUTIVE_DECISION", "DOMAIN_NARRATIVE", "CONFIRMED_STRENGTH", "BLOCKING_FINDING", "CONDITION", "HUMAN_QUESTION", "LIMITATION"]);

export const ACCEPTED_FORMATS = Object.freeze({
  "text/plain": "TEXT",
  "text/markdown": "TEXT",
  "text/csv": "CSV",
  "text/html": "HTML",
  "application/json": "TEXT",
  "application/javascript": "CODE",
  "text/javascript": "CODE",
  "text/typescript": "CODE",
  "text/css": "CODE",
  "application/pdf": "PDF",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "DOCX",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "XLSX",
  "image/png": "IMAGE",
  "image/jpeg": "IMAGE",
  "image/webp": "IMAGE"
});

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
  return { approvedPackets };
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
    domains: [...new Set(value.domains)].sort(),
    severity,
    proposedAssuranceState: value.proposedAssuranceState ?? "UNKNOWN",
    limitations: stringArray(value.limitations) ? value.limitations : [],
    extractor
  };
  return { id: stableId("claim", normalized), ...normalized };
}

export const SOLUTION_MODEL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["facts", "contradictions", "unknowns"],
  properties: {
    facts: { type: "array", items: { type: "object", additionalProperties: false, required: ["factClass", "category", "statement", "sourceUnitIds"], properties: {
      factClass: { type: "string", enum: FACT_CLASSES }, category: { type: "string" }, statement: { type: "string" }, sourceUnitIds: { type: "array", items: { type: "string" } }
    } } },
    contradictions: { type: "array", items: { type: "object", additionalProperties: false, required: ["statement", "sourceUnitIds", "severity"], properties: {
      statement: { type: "string" }, sourceUnitIds: { type: "array", items: { type: "string" } }, severity: { type: "string", enum: SEVERITIES }
    } } },
    unknowns: { type: "array", items: { type: "string" } }
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
        required: ["claimType", "statement", "sourceUnitIds", "evidenceQuotes", "controlIds", "antiPatternIds", "requirementIds", "domains", "severity", "proposedAssuranceState", "limitations"],
        properties: {
          claimType: { type: "string", enum: CLAIM_TYPES },
          statement: { type: "string" },
          sourceUnitIds: { type: "array", items: { type: "string" } },
          evidenceQuotes: { type: "array", items: { type: "object", additionalProperties: false, required: ["sourceUnitId", "quote"], properties: { sourceUnitId: { type: "string" }, quote: { type: "string" } } } },
          controlIds: { type: "array", items: { type: "string" } },
          antiPatternIds: { type: "array", items: { type: "string" } },
          requirementIds: { type: "array", items: { type: "string" } },
          domains: { type: "array", items: { type: "string", enum: Object.keys(DOMAINS) } },
          severity: { type: "string", enum: SEVERITIES },
          proposedAssuranceState: { type: "string", enum: ["UNKNOWN", "DECLARED", "IMPLEMENTED", "TESTED", "OPERATIONALLY_OBSERVED", "HUMAN_VALIDATED"] },
          limitations: { type: "array", items: { type: "string" } }
        }
      }
    }
  }
};

export const VERIFICATION_SCHEMA = {
  type: "object", additionalProperties: false, required: ["status", "rationale", "checkedSourceUnitIds", "conflictingSourceUnitIds"], properties: {
    status: { type: "string", enum: VERIFICATION_STATES }, rationale: { type: "string" }, checkedSourceUnitIds: { type: "array", items: { type: "string" } }, conflictingSourceUnitIds: { type: "array", items: { type: "string" } }
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
        required: ["id", "section", "text", "findingIds", "gateIds", "controlIds", "evidenceIds"],
        properties: {
          id: { type: "string" }, section: { type: "string", enum: NARRATIVE_SECTIONS }, text: { type: "string" },
          domain: { type: "string", enum: Object.keys(DOMAINS) }, authority: { type: "string" },
          findingIds: { type: "array", items: { type: "string" } }, gateIds: { type: "array", items: { type: "string" } },
          controlIds: { type: "array", items: { type: "string" } }, evidenceIds: { type: "array", items: { type: "string" } }
        }
      }
    }
  }
};

export const FACT_CHECK_SCHEMA = {
  type: "object", additionalProperties: false, required: ["supported", "itemResults"], properties: {
    supported: { type: "boolean" },
    itemResults: { type: "array", items: { type: "object", additionalProperties: false, required: ["itemId", "status", "rationale", "correctedText"], properties: {
      itemId: { type: "string" }, status: { type: "string", enum: ["SUPPORTED", "PARTIAL", "UNSUPPORTED"] }, rationale: { type: "string" }, correctedText: { type: "string" }
    } } }
  }
};
