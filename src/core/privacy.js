import { sanitizeRestrictedText } from "../../public/content-policy.js";

const SECRET_PATTERNS = [
  { type: "PRIVATE_KEY", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/gi },
  { type: "CREDENTIAL", pattern: /\b(?:sk|rk|pk)_(?:live|test)_[a-z0-9_-]{16,}\b/gi },
  { type: "AWS_ACCESS_KEY", pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  { type: "ASSIGNED_SECRET", pattern: /(?:api[_-]?key|secret|password|token)\s*[:=]\s*["'][^"'\s]{8,}["']/gi }
];

const PERSONAL_PATTERNS = [
  { type: "EMAIL", pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi },
  { type: "PHONE", pattern: /(?<!\w)(?:\+\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?)?\d{3}[\s.-]?\d{3,4}(?!\w)/g },
  { type: "NATIONAL_IDENTIFIER_CANDIDATE", pattern: /\b\d{6}[-+A]\d{3}[0-9A-Z]\b/gi }
];

const INJECTION_PATTERNS = [
  /ignore (?:all |any )?(?:previous|prior|above) instructions/i,
  /system prompt|developer message|hidden instructions/i,
  /declare (?:the )?(?:system|solution).*(?:compliant|approved|safe)/i,
  /do not (?:tell|show|reveal).*(?:reviewer|user)/i,
  /exfiltrat|send (?:the )?(?:secret|credential|token)/i
];

export function redactText(text) {
  let value = sanitizeRestrictedText(text);
  const findings = [];
  if (value !== text) findings.push({ type: "RESTRICTED_IDENTIFIER", count: 1, severity: "HIGH" });
  for (const entry of [...SECRET_PATTERNS, ...PERSONAL_PATTERNS]) {
    let count = 0;
    value = value.replace(entry.pattern, () => { count += 1; return `[REDACTED_${entry.type}]`; });
    if (count) findings.push({ type: entry.type, count, severity: SECRET_PATTERNS.includes(entry) ? "CRITICAL" : "HIGH" });
  }
  const injectionMatches = INJECTION_PATTERNS.filter((pattern) => pattern.test(text));
  if (injectionMatches.length) findings.push({ type: "PROMPT_INJECTION_CANDIDATE", count: injectionMatches.length, severity: "HIGH" });
  if (/\b(confidential|restricted|internal only|trade secret)\b/i.test(text)) findings.push({ type: "CONFIDENTIAL_MARKER", count: 1, severity: "MEDIUM" });
  return { text: value, findings };
}

export function screenSensitiveValue(value) {
  if (typeof value === "string") return redactText(value).text;
  if (Array.isArray(value)) return value.map(screenSensitiveValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, screenSensitiveValue(item)]));
  return value;
}
