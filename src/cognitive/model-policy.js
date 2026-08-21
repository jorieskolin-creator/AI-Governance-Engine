import { COGNITIVE_PROVIDERS, providerAdapter } from "./provider-adapters.js";

const PROFILE_DEFINITIONS = Object.freeze([
  { id: "moonshot-routing-low", provider: "MOONSHOT", modelEnv: "MOONSHOT_COGNITIVE_MODEL", defaultModel: "kimi-k3", role: "ROUTING", effort: "low", maxOutputTokens: 4000 },
  { id: "moonshot-extraction-high", provider: "MOONSHOT", modelEnv: "MOONSHOT_COGNITIVE_MODEL", defaultModel: "kimi-k3", role: "EXTRACTION", effort: "high", maxOutputTokens: 16000 },
  { id: "moonshot-solution-high", provider: "MOONSHOT", modelEnv: "MOONSHOT_COGNITIVE_MODEL", defaultModel: "kimi-k3", role: "SOLUTION_UNDERSTANDING", effort: "high", maxOutputTokens: 16000 },
  { id: "moonshot-assessment-high", provider: "MOONSHOT", modelEnv: "MOONSHOT_COGNITIVE_MODEL", defaultModel: "kimi-k3", role: "DOMAIN_ASSESSMENT", effort: "high", maxOutputTokens: 20000 },
  { id: "openai-verification-high", provider: "OPENAI", modelEnv: "OPENAI_COGNITIVE_MODEL", defaultModel: "gpt-5.6", role: "VERIFICATION", effort: "high", maxOutputTokens: 6000 },
  { id: "xai-adjudication-high", provider: "XAI", modelEnv: "XAI_COGNITIVE_MODEL", defaultModel: "grok-4.6", role: "ADJUDICATION", effort: "high", maxOutputTokens: 8000 },
  { id: "openai-synthesis-high", provider: "OPENAI", modelEnv: "OPENAI_COGNITIVE_MODEL", defaultModel: "gpt-5.6", role: "SYNTHESIS", effort: "high", maxOutputTokens: 16000 },
  { id: "moonshot-factcheck-high", provider: "MOONSHOT", modelEnv: "MOONSHOT_COGNITIVE_MODEL", defaultModel: "kimi-k3", role: "FACT_CHECK", effort: "high", maxOutputTokens: 8000 },
  { id: "xai-factcheck-high", provider: "XAI", modelEnv: "XAI_COGNITIVE_MODEL", defaultModel: "grok-4.6", role: "FACT_CHECK", effort: "high", maxOutputTokens: 8000 }
]);

const ROUTE_BY_ROLE = Object.freeze({
  ROUTING: "moonshot-routing-low",
  EXTRACTION: "moonshot-extraction-high",
  SOLUTION_UNDERSTANDING: "moonshot-solution-high",
  DOMAIN_ASSESSMENT: "moonshot-assessment-high",
  VERIFICATION: "openai-verification-high",
  ADJUDICATION: "xai-adjudication-high",
  SYNTHESIS: "openai-synthesis-high",
  FACT_CHECK: "moonshot-factcheck-high"
});

const FALLBACKS_BY_ROLE = Object.freeze({ FACT_CHECK: ["xai-factcheck-high"] });

export function providerCredentials(env = process.env) {
  return {
    OPENAI: env.OPENAI_API_KEY || env.GPT_API_KEY || null,
    XAI: env.XAI_API_KEY || null,
    MOONSHOT: env.MOONSHOT_API_KEY || null
  };
}

export function modelPolicy(env = process.env) {
  const credentials = providerCredentials(env);
  const profiles = PROFILE_DEFINITIONS.map(({ modelEnv, defaultModel, ...item }) => ({
    ...item,
    model: env[modelEnv] || defaultModel,
    capabilities: providerAdapter(item.provider).capabilities,
    operationalStatus: ROUTE_BY_ROLE[item.role] === item.id ? "GOVERNANCE_ROUTE" : "BENCHMARK_ONLY",
    credentialAvailable: Boolean(credentials[item.provider])
  }));
  return {
    profiles,
    credentials,
    choose(role, options = {}) {
      const excluded = new Set(options.excludeProviders ?? []);
      const allowed = options.allowedProviders ? new Set(options.allowedProviders) : null;
      const profileIds = [...new Set([...(options.preferredProfileIds ?? []), ROUTE_BY_ROLE[role], ...(FALLBACKS_BY_ROLE[role] ?? [])].filter(Boolean))];
      const routeProfiles = profileIds.map((id) => profiles.find((item) => item.id === id)).filter(Boolean);
      if (!routeProfiles.length) throw new Error(`No governance route is configured for ${role}`);
      const profile = routeProfiles.find((item) => item.credentialAvailable && !excluded.has(item.provider) && (!allowed || allowed.has(item.provider)));
      if (profile) return profile;
      const providers = [...new Set(routeProfiles.map((item) => item.provider))];
      if (routeProfiles.every((item) => !item.credentialAvailable)) throw new Error(`The ${providers.join(" or ")} credential required for ${role} is unavailable`);
      if (routeProfiles.every((item) => excluded.has(item.provider))) throw new Error(`The required independent route for ${role} is unavailable`);
      throw new Error(`The required provider route for ${role} is not approved for these redacted evidence packets`);
    }
  };
}

export function publicModelPolicy(policy) {
  return policy.profiles.map(({ credentialAvailable, ...profile }) => ({ ...profile, credentialAvailable }));
}

export function requiredGovernanceProviders(policy) {
  const required = Object.values(ROUTE_BY_ROLE).map((profileId) => policy.profiles.find((item) => item.id === profileId)).filter(Boolean);
  const unavailable = required.filter((item) => !item.credentialAvailable);
  if (unavailable.length) {
    throw new Error(`Cognitive analysis requires configured credentials for ${[...new Set(unavailable.map((item) => item.provider))].join(", ")}`);
  }
  return [...new Set(required.map((item) => item.provider))];
}

export { COGNITIVE_PROVIDERS };
