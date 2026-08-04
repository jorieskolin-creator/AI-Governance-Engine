const EU_EEA = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "EL", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE", "IS", "LI", "NO"
]);

const ALIASES = Object.freeze({
  EU: "EU", EEA: "EEA", "EUROPEAN UNION": "EU", "EUROPEAN ECONOMIC AREA": "EEA",
  FINLAND: "FI", FINNISH: "FI", FI: "FI", FIN: "FI", SUOMI: "FI",
  SWEDEN: "SE", SE: "SE", SWE: "SE", ESTONIA: "EE", EE: "EE", EST: "EE",
  GERMANY: "DE", DE: "DE", DEU: "DE", FRANCE: "FR", FR: "FR", FRA: "FR",
  NETHERLANDS: "NL", NL: "NL", NLD: "NL", NORWAY: "NO", NO: "NO", NOR: "NO",
  DENMARK: "DK", DK: "DK", DNK: "DK", ICELAND: "IS", IS: "IS", ISL: "IS"
});

export function normalizeJurisdiction(value) {
  const key = String(value ?? "").trim().toUpperCase();
  return ALIASES[key] ?? key;
}

export function jurisdictionScope(values) {
  const normalized = [...new Set((values ?? []).map(normalizeJurisdiction).filter(Boolean))];
  const euEea = normalized.some((item) => item === "EU" || item === "EEA" || EU_EEA.has(item));
  return { normalized, euEea, registerVersion: "jurisdiction-register-1.0.0" };
}
