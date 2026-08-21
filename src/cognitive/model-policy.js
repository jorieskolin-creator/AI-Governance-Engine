import { COGNITIVE_PROVIDERS, providerAdapter } from "./provider-adapters.js";

const STAGE_DEFINITIONS = Object.freeze([
  { stage: "ROUTING", operationalRole: "WORKHORSE", effort: "low", maxOutputTokens: 4000 },
  { stage: "EXTRACTION", operationalRole: "WORKHORSE", effort: "high", maxOutputTokens: 16000 },
  { stage: "DOMAIN_ASSESSMENT", operationalRole: "WORKHORSE", effort: "high", maxOutputTokens: 20000 },
  { stage: "SOLUTION_UNDERSTANDING", operationalRole: "REASONER", effort: "high", maxOutputTokens: 16000 },
  { stage: "ADJUDICATION", operationalRole: "REASONER", effort: "high", maxOutputTokens: 8000 },
  { stage: "SYNTHESIS", operationalRole: "REASONER", effort: "high", maxOutputTokens: 16000 },
  { stage: "VERIFICATION", operationalRole: "QUALITY_CHECKER", effort: "high", maxOutputTokens: 6000 },
  { stage: "FACT_CHECK", operationalRole: "QUALITY_CHECKER", effort: "high", maxOutputTokens: 8000 }
]);

const ROLE_DEFAULTS = Object.freeze({
  WORKHORSE: Object.freeze({ PRIMARY: Object.freeze({ provider: "MOONSHOT", model: "kimi-k3" }), FALLBACK: Object.freeze({ provider: "OPENAI", model: "gpt-5.6" }) }),
  REASONER: Object.freeze({ PRIMARY: Object.freeze({ provider: "MOONSHOT", model: "kimi-k3" }), FALLBACK: Object.freeze({ provider: "XAI", model: "grok-4.6" }) }),
  QUALITY_CHECKER: Object.freeze({ PRIMARY: Object.freeze({ provider: "OPENAI", model: "gpt-5.6" }), FALLBACK: Object.freeze({ provider: "XAI", model: "grok-4.6" }) })
});

function configuredRoleSlot(env, operationalRole, slot) {
  const prefix = `${operationalRole}_${slot === "PRIMARY" ? "" : "FALLBACK_"}`;
  const providerValue = env[`${prefix}PROVIDER`];
  const modelValue = env[`${prefix}MODEL`];
  if (Boolean(providerValue) !== Boolean(modelValue)) throw new Error(`${prefix}PROVIDER and ${prefix}MODEL must be configured together`);
  const defaults = ROLE_DEFAULTS[operationalRole][slot];
  const provider = String(providerValue || defaults.provider).trim().toUpperCase();
  const model = String(modelValue || defaults.model).trim();
  providerAdapter(provider);
  if (!model) throw new Error(`${prefix}MODEL is required`);
  return { provider, model };
}

function profileApprovalRef(profile) {
  return `${profile.operationalRole.toLowerCase()}-${profile.routePriority.toLowerCase()}@${profile.provider}:${profile.model}`;
}

function approvedProfileRefs(value = "") {
  return new Set(value.split(",").map((item) => item.trim()).filter(Boolean));
}

export function providerCredentials(env = process.env) {
  return {
    OPENAI: env.OPENAI_API_KEY || env.GPT_API_KEY || null,
    XAI: env.XAI_API_KEY || null,
    MOONSHOT: env.MOONSHOT_API_KEY || null
  };
}

export function modelPolicy(env = process.env, options = {}) {
  const credentials = providerCredentials(env);
  const qualificationRequired = options.qualificationRequired !== false;
  const approvals = approvedProfileRefs(env.MODEL_PROFILE_APPROVALS);
  const roleSlots = Object.fromEntries(Object.keys(ROLE_DEFAULTS).map((operationalRole) => [operationalRole, {
    PRIMARY: configuredRoleSlot(env, operationalRole, "PRIMARY"),
    FALLBACK: configuredRoleSlot(env, operationalRole, "FALLBACK")
  }]));
  const profiles = STAGE_DEFINITIONS.flatMap((definition) => ["PRIMARY", "FALLBACK"].map((routePriority) => {
    const configured = roleSlots[definition.operationalRole][routePriority];
    const id = `${configured.provider.toLowerCase()}-${definition.operationalRole.toLowerCase().replaceAll("_", "-")}-${definition.stage.toLowerCase().replaceAll("_", "-")}-${routePriority.toLowerCase()}`;
    const profile = { ...definition, role: definition.stage, ...configured, id, routePriority };
    const approvalRef = profileApprovalRef(profile);
    return {
      ...profile,
      capabilities: providerAdapter(profile.provider).capabilities,
      operationalStatus: routePriority === "PRIMARY" ? "GOVERNANCE_ROUTE" : "FALLBACK_ROUTE",
      credentialAvailable: Boolean(credentials[profile.provider]),
      approvalRef,
      qualificationStatus: approvals.has(approvalRef) ? "APPROVED" : qualificationRequired ? "APPROVAL_REQUIRED" : "QUALIFICATION_CANDIDATE"
    };
  }));
  return {
    profiles,
    credentials,
    choose(stage, options = {}) {
      const excluded = new Set(options.excludeProviders ?? []);
      const allowed = options.allowedProviders ? new Set(options.allowedProviders) : null;
      const stageProfiles = profiles.filter((item) => item.stage === stage);
      const preferred = (options.preferredProfileIds ?? []).map((id) => stageProfiles.find((item) => item.id === id)).filter(Boolean);
      const routeProfiles = [...new Map([...preferred, ...stageProfiles].map((item) => [item.id, item])).values()];
      if (!routeProfiles.length) throw new Error(`No governance route is configured for ${stage}`);
      const profile = routeProfiles.find((item) => item.credentialAvailable && (!qualificationRequired || item.qualificationStatus === "APPROVED") && !excluded.has(item.provider) && (!allowed || allowed.has(item.provider)));
      if (profile) return profile;
      const providers = [...new Set(routeProfiles.map((item) => item.provider))];
      if (routeProfiles.every((item) => !item.credentialAvailable)) throw new Error(`The ${providers.join(" or ")} credential required for ${stage} is unavailable`);
      if (qualificationRequired && routeProfiles.every((item) => item.qualificationStatus !== "APPROVED")) throw new Error(`No approved model profile is configured for ${stage}`);
      if (routeProfiles.every((item) => excluded.has(item.provider))) throw new Error(`The required independent route for ${stage} is unavailable`);
      throw new Error(`The required provider route for ${stage} is not approved for these redacted evidence packets`);
    }
  };
}

export function publicModelPolicy(policy) {
  return policy.profiles.map(({ credentialAvailable, ...profile }) => ({ ...profile, credentialAvailable }));
}

export function validateGovernanceRouteTopology(policy) {
  const workhorse = policy.choose("DOMAIN_ASSESSMENT");
  const verifier = policy.choose("VERIFICATION", { excludeProviders: [workhorse.provider] });
  const adjudicator = policy.choose("ADJUDICATION", { excludeProviders: [workhorse.provider, verifier.provider] });
  const solutionReasoner = policy.choose("SOLUTION_UNDERSTANDING");
  const solutionVerifier = policy.choose("VERIFICATION", { excludeProviders: [solutionReasoner.provider] });
  const synthesisReasoner = policy.choose("SYNTHESIS");
  const factChecker = policy.choose("FACT_CHECK", { excludeProviders: [synthesisReasoner.provider] });
  return {
    claimFlow: { workhorse: workhorse.provider, verifier: verifier.provider, adjudicator: adjudicator.provider },
    solutionFlow: { reasoner: solutionReasoner.provider, verifier: solutionVerifier.provider },
    publicationFlow: { reasoner: synthesisReasoner.provider, qualityChecker: factChecker.provider }
  };
}

export function requiredGovernanceProviders(policy) {
  const required = [...new Map(policy.profiles.map((profile) => [profile.approvalRef, profile])).values()];
  const unavailable = required.filter((item) => !item.credentialAvailable);
  if (unavailable.length) {
    throw new Error(`Cognitive analysis requires configured credentials for ${[...new Set(unavailable.map((item) => item.provider))].join(", ")}`);
  }
  const unapproved = required.filter((item) => item.qualificationStatus === "APPROVAL_REQUIRED");
  if (unapproved.length) {
    throw new Error(`Cognitive analysis requires approved model profiles: ${unapproved.map((item) => item.approvalRef).join(", ")}`);
  }
  validateGovernanceRouteTopology(policy);
  return [...new Set(required.map((item) => item.provider))];
}

export { COGNITIVE_PROVIDERS };
