import test from "node:test";
import assert from "node:assert/strict";
import {
  allowUnlockAttempt,
  authorizeWriteAccess,
  configuredAdminSecret,
  createSessionToken,
  readCookie,
  secretsMatch,
  sessionCookieHeader,
  sessionTokenIsValid,
  writeAccessMode
} from "../src/access-control.js";

test("an unset ADMIN_SECRET leaves write access open", () => {
  assert.equal(configuredAdminSecret({}), "");
  assert.equal(writeAccessMode({}), "OPEN");
  assert.equal(authorizeWriteAccess({ headers: {} }, {}).ok, true);
});

test("a configured ADMIN_SECRET requires a valid session cookie for writes", () => {
  const env = { ADMIN_SECRET: "correct-horse" };
  assert.equal(writeAccessMode(env), "REQUIRED");
  const denied = authorizeWriteAccess({ headers: {} }, env);
  assert.equal(denied.ok, false);
  assert.equal(denied.code, "WRITE_ACCESS_REQUIRED");
  const token = createSessionToken(env.ADMIN_SECRET);
  const allowed = authorizeWriteAccess({ headers: { cookie: sessionCookieHeader(token) } }, env);
  assert.equal(allowed.ok, true);
});

test("session tokens are bound to the secret and expire", () => {
  const secret = "bound-secret";
  const token = createSessionToken(secret, 1_000);
  assert.equal(sessionTokenIsValid(token, secret, 1_000), true);
  assert.equal(sessionTokenIsValid(token, "other-secret", 1_000), false);
  assert.equal(sessionTokenIsValid(token, secret, 1_000 + 13 * 60 * 60 * 1000), false);
  assert.equal(secretsMatch("bound-secret", secret), true);
  assert.equal(secretsMatch("wrong", secret), false);
});

test("cookie parsing and Set-Cookie attributes stay scoped to the app", () => {
  const header = sessionCookieHeader("abc.def", { secure: true });
  assert.match(header, /^sae_session=abc\.def; Path=\/; HttpOnly; SameSite=Lax; Max-Age=\d+; Secure$/);
  assert.equal(readCookie("other=1; sae_session=abc.def; keep=2"), "abc.def");
});

test("unlock attempts are rate limited per caller key", () => {
  const key = `test-${Date.now()}-${Math.random()}`;
  for (let attempt = 0; attempt < 8; attempt += 1) assert.equal(allowUnlockAttempt(key), true);
  assert.equal(allowUnlockAttempt(key), false);
});
