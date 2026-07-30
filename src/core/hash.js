import { createHash, randomUUID } from "node:crypto";

export function sha256(value) {
  const body = value instanceof Uint8Array || Buffer.isBuffer(value)
    ? value
    : typeof value === "string" ? value : stableStringify(value);
  return createHash("sha256").update(body).digest("hex");
}

export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function newId(prefix) {
  return `${prefix}-${randomUUID()}`;
}

export function stableId(prefix, value, length = 24) {
  return `${prefix}-${sha256(value).slice(0, length)}`;
}
