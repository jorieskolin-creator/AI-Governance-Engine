import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const COOKIE_NAME = "sae_session";
const SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const UNLOCK_WINDOW_MS = 10 * 60 * 1000;
const UNLOCK_MAX_ATTEMPTS = 8;
const unlockAttempts = new Map();

export function configuredAdminSecret(env = process.env) {
  return String(env.ADMIN_SECRET ?? "").trim();
}

export function writeAccessMode(env = process.env) {
  return configuredAdminSecret(env) ? "REQUIRED" : "OPEN";
}

function hashedEqual(left, right) {
  const a = createHmac("sha256", "sae-write-access").update(String(left)).digest();
  const b = createHmac("sha256", "sae-write-access").update(String(right)).digest();
  return timingSafeEqual(a, b);
}

export function secretsMatch(provided, expected) {
  if (!expected) return false;
  return hashedEqual(provided ?? "", expected);
}

export function createSessionToken(secret, now = Date.now()) {
  const payload = `${now}.${randomBytes(16).toString("hex")}`;
  const signature = createHmac("sha256", secret).update(payload).digest("hex");
  return `${payload}.${signature}`;
}

export function sessionTokenIsValid(token, secret, now = Date.now(), maxAgeMs = SESSION_MAX_AGE_MS) {
  if (!secret || typeof token !== "string") return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [issuedAt, nonce, signature] = parts;
  if (!/^\d+$/.test(issuedAt) || !/^[a-f0-9]{32}$/.test(nonce) || !/^[a-f0-9]{64}$/.test(signature)) return false;
  const payload = `${issuedAt}.${nonce}`;
  const expected = createHmac("sha256", secret).update(payload).digest("hex");
  const actual = Buffer.from(signature, "hex");
  const wanted = Buffer.from(expected, "hex");
  if (actual.length !== wanted.length || !timingSafeEqual(actual, wanted)) return false;
  const age = now - Number(issuedAt);
  return age >= 0 && age <= maxAgeMs;
}

export function readCookie(header, name = COOKIE_NAME) {
  for (const part of String(header ?? "").split(";")) {
    const trimmed = part.trim();
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    if (trimmed.slice(0, separator) === name) return decodeURIComponent(trimmed.slice(separator + 1));
  }
  return "";
}

export function sessionCookieHeader(token, { secure = false, maxAgeSeconds = SESSION_MAX_AGE_MS / 1000 } = {}) {
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.trunc(maxAgeSeconds)}`
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function allowUnlockAttempt(key, now = Date.now()) {
  const recent = (unlockAttempts.get(key) ?? []).filter((at) => now - at < UNLOCK_WINDOW_MS);
  if (recent.length >= UNLOCK_MAX_ATTEMPTS) {
    unlockAttempts.set(key, recent);
    return false;
  }
  recent.push(now);
  unlockAttempts.set(key, recent);
  return true;
}

export function requestIsSecure(request) {
  const forwarded = String(request.headers?.["x-forwarded-proto"] ?? "").split(",")[0].trim().toLowerCase();
  return forwarded === "https";
}

export function authorizeWriteAccess(request, env = process.env) {
  const secret = configuredAdminSecret(env);
  if (!secret) return { ok: true, mode: "OPEN" };
  const token = readCookie(request.headers?.cookie);
  if (sessionTokenIsValid(token, secret)) return { ok: true, mode: "REQUIRED", unlocked: true };
  return {
    ok: false,
    mode: "REQUIRED",
    unlocked: false,
    status: 401,
    code: "WRITE_ACCESS_REQUIRED",
    message: "Password required to add material or change assessment information."
  };
}
