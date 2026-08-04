const PROFILES = Object.freeze([
  { id: "gemini-routing-minimal", provider: "GEMINI", model: "gemini-3.6-flash", role: "ROUTING", thinkingLevel: "minimal", maxOutputTokens: 4000, status: "PILOT" },
  { id: "gemini-extraction-medium", provider: "GEMINI", model: "gemini-3.6-flash", role: "EXTRACTION", thinkingLevel: "medium", maxOutputTokens: 16000, status: "PILOT" },
  { id: "sonnet-extraction-medium", provider: "ANTHROPIC", model: "claude-sonnet-5", role: "EXTRACTION", effort: "medium", maxOutputTokens: 16000, status: "PILOT" },
  { id: "sonnet-solution-medium", provider: "ANTHROPIC", model: "claude-sonnet-5", role: "SOLUTION_UNDERSTANDING", effort: "medium", maxOutputTokens: 16000, status: "PILOT" },
  { id: "openai-sol-solution-medium", provider: "OPENAI", model: "gpt-5.6-sol", role: "SOLUTION_UNDERSTANDING", effort: "medium", maxOutputTokens: 16000, status: "PILOT" },
  { id: "gemini-solution-high", provider: "GEMINI", model: "gemini-3.6-flash", role: "SOLUTION_UNDERSTANDING", thinkingLevel: "high", maxOutputTokens: 16000, status: "PILOT" },
  { id: "sonnet-assessment-medium", provider: "ANTHROPIC", model: "claude-sonnet-5", role: "DOMAIN_ASSESSMENT", effort: "medium", maxOutputTokens: 20000, status: "PILOT" },
  { id: "openai-terra-assessment-medium", provider: "OPENAI", model: "gpt-5.6-terra", role: "DOMAIN_ASSESSMENT", effort: "medium", maxOutputTokens: 20000, status: "PILOT" },
  { id: "gemini-assessment-medium", provider: "GEMINI", model: "gemini-3.6-flash", role: "DOMAIN_ASSESSMENT", thinkingLevel: "medium", maxOutputTokens: 20000, status: "PILOT" },
  { id: "openai-sol-verification-high", provider: "OPENAI", model: "gpt-5.6-sol", role: "VERIFICATION", effort: "high", maxOutputTokens: 6000, status: "PILOT" },
  { id: "sonnet-verification-high", provider: "ANTHROPIC", model: "claude-sonnet-5", role: "VERIFICATION", effort: "high", maxOutputTokens: 6000, status: "PILOT" },
  { id: "gemini-verification-high", provider: "GEMINI", model: "gemini-3.6-flash", role: "VERIFICATION", thinkingLevel: "high", maxOutputTokens: 6000, status: "PILOT" },
  { id: "openai-sol-adjudication-high", provider: "OPENAI", model: "gpt-5.6-sol", role: "ADJUDICATION", effort: "high", maxOutputTokens: 8000, status: "PILOT" },
  { id: "opus-adjudication-high", provider: "ANTHROPIC", model: "claude-opus-5", role: "ADJUDICATION", effort: "high", maxOutputTokens: 8000, status: "PILOT" },
  { id: "openai-sol-synthesis-high", provider: "OPENAI", model: "gpt-5.6-sol", role: "SYNTHESIS", effort: "high", maxOutputTokens: 16000, status: "PILOT" },
  { id: "opus-synthesis-high", provider: "ANTHROPIC", model: "claude-opus-5", role: "SYNTHESIS", effort: "high", maxOutputTokens: 16000, status: "PILOT" },
  { id: "opus-factcheck-high", provider: "ANTHROPIC", model: "claude-opus-5", role: "FACT_CHECK", effort: "high", maxOutputTokens: 8000, status: "PILOT" },
  { id: "sonnet-factcheck-high", provider: "ANTHROPIC", model: "claude-sonnet-5", role: "FACT_CHECK", effort: "high", maxOutputTokens: 8000, status: "PILOT" },
  { id: "openai-sol-factcheck-high", provider: "OPENAI", model: "gpt-5.6-sol", role: "FACT_CHECK", effort: "high", maxOutputTokens: 8000, status: "PILOT" },
  { id: "gpt-5.4-benchmark", provider: "OPENAI", model: "gpt-5.4", role: "BENCHMARK", effort: "medium", maxOutputTokens: 16000, status: "BASELINE" }
]);

export function providerCredentials(env = process.env) {
  return {
    OPENAI: env.OPENAI_API_KEY || env.GPT_API_KEY || null,
    ANTHROPIC: env.ANTHROPIC_API_KEY || null,
    GEMINI: env.GEMINI_API_KEY || null
  };
}

export function modelPolicy(env = process.env) {
  const approvals = new Set((env.MODEL_PROFILE_APPROVALS ?? "").split(",").map((item) => item.trim()).filter(Boolean));
  const production = env.NODE_ENV === "production";
  const credentials = providerCredentials(env);
  const profiles = PROFILES.map((item) => ({
    ...item,
    operationalStatus: approvals.has(item.id) ? "APPROVED" : item.status,
    credentialAvailable: Boolean(credentials[item.provider])
  }));
  return {
    profiles,
    credentials,
    production,
    choose(role, options = {}) {
      const excluded = new Set(options.excludeProviders ?? []);
      const allowed = options.allowedProviders ? new Set(options.allowedProviders) : null;
      let candidates = profiles.filter((item) => item.role === role && item.credentialAvailable && !excluded.has(item.provider) && (!allowed || allowed.has(item.provider)));
      if (options.preferredProfileIds?.length) {
        const order = new Map(options.preferredProfileIds.map((id, index) => [id, index]));
        candidates = candidates.sort((a, b) => (order.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.id) ?? Number.MAX_SAFE_INTEGER));
      }
      const eligible = production ? candidates.filter((item) => item.operationalStatus === "APPROVED") : candidates;
      if (!eligible.length) throw new Error(`No eligible model profile for ${role}${production ? "; production profiles require MODEL_PROFILE_APPROVALS" : ""}`);
      return eligible[0];
    }
  };
}

export function publicModelPolicy(policy) {
  return policy.profiles.map(({ credentialAvailable, ...profile }) => ({ ...profile, credentialAvailable }));
}
