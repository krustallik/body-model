import { createHash, sign, verify } from "node:crypto";

function normalizeJsonValue(value, location = "$") {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error("Canonical JSON only accepts safe integer numbers at " + location + ".");
    return value;
  }
  if (Array.isArray(value)) return value.map((entry, index) => normalizeJsonValue(entry, location + "[" + index + "]"));
  if (typeof value !== "object" || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    throw new Error("Canonical JSON accepts only plain JSON values at " + location + ".");
  }
  const result = {};
  for (const key of Object.keys(value).sort()) {
    if (value[key] === undefined) throw new Error("Canonical JSON does not allow undefined values at " + location + "." + key + ".");
    result[key] = normalizeJsonValue(value[key], location + "." + key);
  }
  return result;
}

export function canonicalJson(value) {
  return JSON.stringify(normalizeJsonValue(value));
}

export function sha256Hex(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value), "utf8");
  return createHash("sha256").update(bytes).digest("hex");
}

export function canonicalDigest(value) {
  return sha256Hex(canonicalJson(value));
}

export function omitFields(value, fields) {
  const omitted = new Set(fields);
  return Object.fromEntries(Object.entries(value).filter(([key]) => !omitted.has(key)));
}

export function signCanonical(value, privateKey) {
  return sign(null, Buffer.from(canonicalJson(value), "utf8"), privateKey).toString("base64url");
}

export function verifyCanonical(value, signature, publicKey) {
  if (typeof signature !== "string" || signature.length === 0) return false;
  try {
    return verify(null, Buffer.from(canonicalJson(value), "utf8"), publicKey, Buffer.from(signature, "base64url"));
  } catch {
    return false;
  }
}

export function assertExactKeys(value, keys, label = "object") {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(label + " must be an object.");
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    const missing = expected.filter((key) => !Object.hasOwn(value, key));
    const extra = actual.filter((key) => !expected.includes(key));
    throw new Error(label + " has an invalid closed schema (missing: " + (missing.join(",") || "none") + "; extra: " + (extra.join(",") || "none") + ").");
  }
}

export function assertNonEmptyString(value, name) {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) {
    throw new Error(name + " must be a non-empty, trimmed string.");
  }
}

export function assertSha256(value, name) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw new Error(name + " must be a lowercase SHA-256 digest.");
}

export function assertGitSha(value, name) {
  if (typeof value !== "string" || !/^[a-f0-9]{40}$/.test(value)) throw new Error(name + " must be a full lowercase Git SHA.");
}

export function assertUtcTimestamp(value, name) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new Error(name + " must be a UTC RFC 3339 timestamp.");
  }
}
