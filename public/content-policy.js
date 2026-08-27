const RESTRICTED_TOKEN_HASHES = new Set([1449870021, 2511368391]);

function normalizedTokenHash(value) {
  let hash = 2166136261;
  for (const character of String(value ?? "").normalize("NFKC").toLowerCase()) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function isRestrictedToken(value) {
  return RESTRICTED_TOKEN_HASHES.has(normalizedTokenHash(value));
}

export function sanitizeRestrictedText(value, replacement = "[REDACTED_IDENTIFIER]") {
  if (typeof value !== "string") return value;
  return value.replace(/[\p{L}\p{N}_]+/gu, (token) => isRestrictedToken(token) ? replacement : token);
}

export function sanitizeRestrictedValue(value) {
  if (typeof value === "string") return sanitizeRestrictedText(value);
  if (Array.isArray(value)) return value.map(sanitizeRestrictedValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [sanitizeRestrictedText(key), sanitizeRestrictedValue(item)]));
  }
  return value;
}

export function publicJsonValue(value) {
  if (value && typeof value === "object" && (typeof value.packageHash === "string" || (typeof value.$schema === "string" && typeof value["x-contract-coverage"] === "string"))) {
    return value;
  }
  return sanitizeRestrictedValue(value);
}

export function restrictedTokenMatches(value) {
  if (typeof value !== "string") return [];
  return [...value.matchAll(/[\p{L}\p{N}_]+/gu)]
    .filter((match) => isRestrictedToken(match[0]))
    .map((match) => ({ index: match.index, length: match[0].length }));
}
