import { createHash, createPrivateKey, sign, verify } from "node:crypto";
import { canonicalJson } from "./production-migration-manifests.mjs";

export const AUTHORIZATION_MAX_AGE_MS = 60 * 60 * 1000;
export const AUTHORIZATION_MAX_FUTURE_SKEW_MS = 60 * 1000;
export const REQUIRED_AUTHORIZATION_CLAIMS = Object.freeze([
  "repository", "workflowId", "workflowPath", "workflowRunId", "workflowRunAttempt",
  "releaseSha", "currentMainSha", "manifestId", "pendingMigrationNames", "pendingSetDigest",
  "preflightRunId", "preflightRunAttempt", "preflightRunStartedAt", "preflightResultDigest", "backupArtifactId",
  "backupArtifactDigest", "backupSnapshotAt", "restoreResultDigest", "productionIdentityDigest",
  "writerDrainDigest", "writerTopologyDigest",
  "issuedAt", "expiresAt", "authorizationId", "nonce",
]);

export function canonicalSha256(value) {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

function reject(message) {
  throw new Error(`Migration authorization blocked: ${message}`);
}

export function assertSignedAuthorizationRequired({ envelope, confirmation }) {
  if (typeof envelope !== "string" || envelope.length === 0) {
    reject(confirmation === "migrate" ? "confirmation variable is not a signed authorization envelope." : "signed authorization envelope is required.");
  }
  return true;
}

function parseCanonicalEnvelope(serialized) {
  if (typeof serialized !== "string" || serialized.length === 0) reject("authorization envelope is missing.");
  let parsed;
  try { parsed = JSON.parse(serialized); } catch { reject("authorization envelope is malformed JSON."); }
  if (canonicalJson(parsed) !== serialized) reject("authorization envelope is not canonical JSON (duplicate keys or noncanonical bytes).");
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) reject("authorization envelope must be an object.");
  return parsed;
}

function keyRecordFor(keyId, allowlist) {
  if (!allowlist || !Array.isArray(allowlist.keys)) reject("reviewed public-key allowlist is unavailable.");
  const matches = allowlist.keys.filter((entry) => entry?.keyId === keyId);
  if (matches.length !== 1) reject(matches.length ? "keyId is ambiguous in the public-key allowlist." : "keyId is unknown or revoked.");
  const record = matches[0];
  if (record.status !== "active") reject(`keyId ${keyId} is not active.`);
  return record;
}

function validateClaimsShape(claims) {
  if (!claims || typeof claims !== "object" || Array.isArray(claims)) reject("signed claims are missing.");
  const keys = Object.keys(claims).sort();
  const required = [...REQUIRED_AUTHORIZATION_CLAIMS].sort();
  if (JSON.stringify(keys) !== JSON.stringify(required)) reject("claim set is incomplete or contains unsupported claims.");
  for (const key of REQUIRED_AUTHORIZATION_CLAIMS) {
    const value = claims[key];
    if (value === null || value === undefined || value === "") reject(`required claim ${key} is empty.`);
  }
  if (!Array.isArray(claims.pendingMigrationNames)
    || claims.pendingMigrationNames.some((name) => typeof name !== "string" || !name)
    || [...claims.pendingMigrationNames].sort().join("\0") !== claims.pendingMigrationNames.join("\0")) {
    reject("pendingMigrationNames must be a sorted string array.");
  }
  for (const key of ["workflowRunAttempt", "preflightRunAttempt"]) {
    if (!Number.isSafeInteger(claims[key]) || claims[key] < 1) reject(`${key} must be a positive integer.`);
  }
  for (const key of ["workflowRunId", "preflightRunId", "backupArtifactId"]) {
    if (!/^[1-9][0-9]*$/.test(String(claims[key]))) reject(`${key} must be a positive numeric identifier.`);
  }
  for (const key of ["releaseSha", "currentMainSha"]) {
    if (!/^[a-f0-9]{40}$/.test(claims[key])) reject(`${key} must be a full lowercase commit SHA.`);
  }
  for (const key of ["pendingSetDigest", "preflightResultDigest", "backupArtifactDigest", "restoreResultDigest", "productionIdentityDigest", "writerDrainDigest", "writerTopologyDigest"]) {
    if (!/^[a-f0-9]{64}$/.test(claims[key])) reject(`${key} must be a lowercase SHA-256 digest.`);
  }
  for (const key of ["issuedAt", "expiresAt", "backupSnapshotAt", "preflightRunStartedAt"]) {
    if (typeof claims[key] !== "string" || !Number.isFinite(Date.parse(claims[key]))) reject(`${key} must be an ISO timestamp.`);
  }
  if (typeof claims.nonce !== "string" || !/^[0-9a-f-]{36}$/i.test(claims.nonce)) reject("nonce must be a UUID.");
  if (typeof claims.authorizationId !== "string" || claims.authorizationId.length < 16) reject("authorizationId must be a unique opaque identifier.");
}

function compareLiveClaims(claims, live) {
  const fields = [
    "repository", "workflowId", "workflowPath", "workflowRunId", "workflowRunAttempt", "releaseSha",
    "currentMainSha", "manifestId", "pendingMigrationNames", "pendingSetDigest", "preflightRunId",
    "preflightRunAttempt", "preflightRunStartedAt", "preflightResultDigest", "backupArtifactId", "backupArtifactDigest",
    "backupSnapshotAt", "restoreResultDigest", "productionIdentityDigest", "writerDrainDigest", "writerTopologyDigest",
  ];
  for (const field of fields) {
    if (!(field in live)) continue;
    const actual = field === "pendingMigrationNames" ? JSON.stringify(live[field]) : String(live[field]);
    const signed = field === "pendingMigrationNames" ? JSON.stringify(claims[field]) : String(claims[field]);
    if (actual !== signed) reject(`live ${field} does not match the signed claim.`);
  }
  if (!live.currentMainSha || live.currentMainSha !== claims.releaseSha) reject("release SHA is not the current canonical main tip.");
  if (!Array.isArray(live.pendingMigrationNames)) reject("live full pending migration set is unavailable.");
  const livePending = [...live.pendingMigrationNames].sort();
  if (JSON.stringify(livePending) !== JSON.stringify(claims.pendingMigrationNames)) reject("live full pending migration set changed after authorization.");
  if (canonicalSha256(livePending) !== claims.pendingSetDigest) reject("live pending-set digest differs from the signed digest.");
  if (live.productionIdentityDigest && live.productionIdentityDigest !== claims.productionIdentityDigest) reject("live production database identity changed after preflight.");
  if (live.preflightResultDigest && live.preflightResultDigest !== claims.preflightResultDigest) reject("preflight report digest is not the verified artifact result.");
  if (live.restoreResultDigest && live.restoreResultDigest !== claims.restoreResultDigest) reject("restore verification digest is not the verified artifact result.");
}

export function createAuthorizationEnvelope(claims, { keyId, privateKeyPem, allowlist }) {
  validateClaimsShape(claims);
  const record = keyRecordFor(keyId, allowlist);
  if (!privateKeyPem) reject("signing private key is unavailable.");
  const key = createPrivateKey(privateKeyPem);
  const signature = sign(null, Buffer.from(canonicalJson(claims), "utf8"), key).toString("base64url");
  const envelope = { algorithm: "Ed25519", keyId, payload: claims, signature };
  const publicKey = record.publicKeyPem;
  if (!publicKey || !verify(null, Buffer.from(canonicalJson(claims), "utf8"), publicKey, Buffer.from(signature, "base64url"))) {
    reject("signing key does not match the accepted public key for keyId.");
  }
  return canonicalJson(envelope);
}

export function verifyAuthorizationEnvelope(serialized, { allowlist, live, now = Date.now() }) {
  const envelope = parseCanonicalEnvelope(serialized);
  if (JSON.stringify(Object.keys(envelope).sort()) !== JSON.stringify(["algorithm", "keyId", "payload", "signature"])) {
    reject("envelope fields are missing, duplicated, or unsupported.");
  }
  if (envelope.algorithm !== "Ed25519") reject("unsupported signature algorithm.");
  const key = keyRecordFor(envelope.keyId, allowlist);
  validateClaimsShape(envelope.payload);
  if (typeof envelope.signature !== "string" || !/^[A-Za-z0-9_-]+$/.test(envelope.signature)) reject("signature encoding is malformed or missing.");
  let signature;
  try { signature = Buffer.from(envelope.signature, "base64url"); } catch { reject("signature encoding is malformed."); }
  if (signature.length !== 64) reject("signature length is invalid.");
  if (!verify(null, Buffer.from(canonicalJson(envelope.payload), "utf8"), key.publicKeyPem, signature)) reject("signature is invalid.");

  const claims = envelope.payload;
  const issuedAt = Date.parse(claims.issuedAt);
  const expiresAt = Date.parse(claims.expiresAt);
  const snapshotAt = Date.parse(claims.backupSnapshotAt);
  const preflightRunStartedAt = Date.parse(claims.preflightRunStartedAt);
  if (issuedAt > now + AUTHORIZATION_MAX_FUTURE_SKEW_MS) reject("issuedAt is too far in the future.");
  if (expiresAt <= now) reject("authorization envelope has expired.");
  if (expiresAt <= issuedAt || expiresAt - issuedAt > AUTHORIZATION_MAX_AGE_MS) reject("authorization lifetime is invalid or exceeds 60 minutes.");
  if (snapshotAt > now + AUTHORIZATION_MAX_FUTURE_SKEW_MS) reject("backup snapshot timestamp is in the future.");
  if (preflightRunStartedAt > now + AUTHORIZATION_MAX_FUTURE_SKEW_MS || preflightRunStartedAt > issuedAt + AUTHORIZATION_MAX_FUTURE_SKEW_MS) {
    reject("preflight admission timestamp is from the future or after authorization issuance.");
  }
  if (now - snapshotAt > AUTHORIZATION_MAX_AGE_MS) reject("backup snapshot is older than 60 minutes at DDL time.");

  compareLiveClaims(claims, live ?? {});
  return { verified: true, keyId: envelope.keyId, authorizationId: claims.authorizationId, payload: claims };
}

export function createClaimsFromPreflight({
  repository, workflowId, workflowPath, workflowRunId, workflowRunAttempt, releaseSha, currentMainSha,
  manifestId, pendingMigrationNames, preflightRunId, preflightRunAttempt, preflightRunStartedAt, preflightResultDigest,
  backupArtifactId, backupArtifactDigest, backupSnapshotAt, restoreResultDigest, productionIdentityDigest,
  writerDrainDigest, writerTopologyDigest,
  issuedAt, expiresAt, authorizationId, nonce,
}) {
  const names = [...pendingMigrationNames].sort();
  return {
    repository, workflowId, workflowPath, workflowRunId, workflowRunAttempt, releaseSha, currentMainSha,
    manifestId, pendingMigrationNames: names, pendingSetDigest: canonicalSha256(names), preflightRunId,
    preflightRunAttempt, preflightRunStartedAt, preflightResultDigest, backupArtifactId, backupArtifactDigest, backupSnapshotAt,
    restoreResultDigest, productionIdentityDigest, writerDrainDigest, writerTopologyDigest, issuedAt, expiresAt, authorizationId, nonce,
  };
}
