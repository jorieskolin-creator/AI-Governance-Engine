const PROFILES = Object.freeze([
  { id: "gemini-routing-minimal", provider: "GEMINI", model: "gemini-3.6-flash", role: "ROUTING", thinkingLevel: "minimal", maxOutputTokens: 4000 },
  { id: "gemini-extraction-medium", provider: "GEMINI", model: "gemini-3.6-flash", role: "EXTRACTION", thinkingLevel: "medium", maxOutputTokens: 16000 },
  { id: "sonnet-solution-medium", provider: "ANTHROPIC", model: "claude-sonnet-5", role: "SOLUTION_UNDERSTANDING", effort: "medium", maxOutputTokens: 16000 },
  { id: "sonnet-assessment-medium", provider: "ANTHROPIC", model: "claude-sonnet-5", role: "DOMAIN_ASSESSMENT", effort: "medium", maxOutputTokens: 20000 },
  { id: "openai-sol-verification-high", provider: "OPENAI", model: "gpt-5.6-sol", role: "VERIFICATION", effort: "high", maxOutputTokens: 6000 },
  { id: "gemini-adjudication-high", provider: "GEMINI", model: "gemini-3.6-flash", role: "ADJUDICATION", thinkingLevel: "high", maxOutputTokens: 8000 },
  { id: "openai-sol-synthesis-high", provider: "OPENAI", model: "gpt-5.6-sol", role: "SYNTHESIS", effort: "high", maxOutputTokens: 16000 },
  { id: "sonnet-factcheck-high", provider: "ANTHROPIC", model: "claude-sonnet-5", role: "FACT_CHECK", effort: "high", maxOutputTokens: 8000 },
  { id: "openai-sol-factcheck-high", provider: "OPENAI", model: "gpt-5.6-sol", role: "FACT_CHECK", effort: "high", maxOutputTokens: 8000 },
  { id: "gpt-5.4-benchmark", provider: "OPENAI", model: "gpt-5.4", role: "BENCHMARK", effort: "medium", maxOutputTokens: 16000 }
]);

const ROUTE_BY_ROLE = Object.freeze({
  ROUTING: "gemini-routing-minimal",
  EXTRACTION: "gemini-extraction-medium",
  SOLUTION_UNDERSTANDING: "sonnet-solution-medium",
  DOMAIN_ASSESSMENT: "sonnet-assessment-medium",
  VERIFICATION: "openai-sol-verification-high",
  ADJUDICATION: "gemini-adjudication-high",
  SYNTHESIS: "openai-sol-synthesis-high",
  FACT_CHECK: "sonnet-factcheck-high"
});

const FALLBACKS_BY_ROLE = Object.freeze({ FACT_CHECK: ["openai-sol-factcheck-high"] });

export function providerCredentials(env = process.env) {
  return {
    OPENAI: env.OPENAI_API_KEY || env.GPT_API_KEY || null,
    ANTHROPIC: env.ANTHROPIC_API_KEY || null,
    GEMINI: env.GEMINI_API_KEY || null
  };
}

export function modelPolicy(env = process.env) {
  const credentials = providerCredentials(env);
  const profiles = PROFILES.map((item) => ({
    ...item,
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
