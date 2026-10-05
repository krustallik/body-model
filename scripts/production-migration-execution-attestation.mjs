import { createPrivateKey, createPublicKey, generateKeyPairSync, randomUUID, sign, verify } from "node:crypto";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { canonicalJson } from "./production-migration-manifests.mjs";
import { canonicalSha256 } from "./production-migration-authorization.mjs";

export const EXECUTION_ATTESTATION_MAX_AGE_MS = 5 * 60 * 1000;
export const EXECUTION_KEY_MAX_AGE_MS = 2 * 60 * 60 * 1000;
const DELEGATION_FIELDS = Object.freeze([
  "schemaVersion", "kind", "repository", "authorizationId", "authorizationEnvelopeDigest",
  "workflowId", "workflowRunId", "workflowRunAttempt", "releaseSha", "currentMainSha", "manifestId",
  "executionKeyId", "executionPublicKeyPem", "issuedAt", "expiresAt",
]);
const ATTESTATION_FIELDS = Object.freeze([
  "schemaVersion", "kind", "repository", "authorizationId", "authorizationEnvelopeDigest",
  "workflowId", "workflowRunId", "workflowRunAttempt", "releaseSha", "currentMainSha", "manifestId",
  "executionKeyId", "executionKeyCertificateDigest", "executionChallenge", "preflightWorkflowId", "preflightRunId",
  "preflightRunAttempt", "preflightHeadSha", "preflightEvent", "preflightBranch", "preflightDisplayTitle",
  "preflightStatus", "preflightConclusion", "preflightCreatedAt", "latestSelectionDigest", "checkedAt",
  "issuedAt", "expiresAt", "attestationId", "nonce",
]);

function reject(message) { throw new Error(`Migration execution attestation blocked: ${message}`); }

function selectionBinding(run) {
  return {
    repository: run.repository,
    workflowPath: run.workflowPath,
    workflowId: String(run.workflowId),
    event: run.event,
    headBranch: run.headBranch,
    headSha: run.headSha,
    displayTitle: run.displayTitle,
    id: String(run.id),
    runAttempt: Number(run.runAttempt),
    createdAt: run.createdAt,
    status: run.status,
    conclusion: run.conclusion,
  };
}

function parseCanonicalEnvelope(serialized, label) {
  let envelope;
  try { envelope = JSON.parse(serialized); } catch { reject(`${label} is malformed JSON.`); }
  if (canonicalJson(envelope) !== serialized.trimEnd()
    || JSON.stringify(Object.keys(envelope ?? {}).sort()) !== JSON.stringify(["algorithm", "keyId", "payload", "signature"])
    || envelope.algorithm !== "Ed25519" || typeof envelope.keyId !== "string"
    || typeof envelope.signature !== "string" || !envelope.payload || typeof envelope.payload !== "object"
    || Array.isArray(envelope.payload)) {
    reject(`${label} is noncanonical or malformed.`);
  }
  return envelope;
}

function parseAuthorization(serialized, allowlist) {
  const envelope = parseCanonicalEnvelope(serialized, "authorization envelope");
  const matches = allowlist?.keys?.filter((item) => item?.keyId === envelope.keyId) ?? [];
  if (matches.length !== 1 || matches[0].status !== "active") reject("authorization key is missing, ambiguous, or revoked.");
  const signature = Buffer.from(envelope.signature, "base64url");
  if (signature.length !== 64 || !verify(null, Buffer.from(canonicalJson(envelope.payload)), matches[0].publicKeyPem, signature)) {
    reject("authorization envelope signature is invalid.");
  }
  return envelope;
}

function assertMigrationAuthorization(envelope) {
  const claims = envelope.payload;
  if (claims.repository !== "krustallik/body-model" || claims.workflowPath !== ".github/workflows/production-migrate.yml") {
    reject("authorization provenance is not the production migration workflow.");
  }
  return claims;
}

function assertLatestSelectionMatchesAuthorization(latest, claims) {
  if (!latest || latest.repository !== "krustallik/body-model"
    || latest.workflowPath !== ".github/workflows/production-migration-preflight.yml"
    || !/^[1-9][0-9]*$/.test(String(latest.workflowId))
    || latest.event !== "workflow_dispatch" || latest.headBranch !== "main"
    || latest.headSha !== claims.releaseSha
    || latest.displayTitle !== `Preflight ${claims.releaseSha} ${claims.manifestId}`
    || String(latest.id) !== String(claims.preflightRunId)
    || Number(latest.runAttempt) !== Number(claims.preflightRunAttempt)
    || latest.status !== "completed" || latest.conclusion !== "success"
    || !Number.isFinite(Date.parse(latest.createdAt))) {
    reject("latest exact applicable preflight is not the signed successful attempt.");
  }
}

function assertDelegationBinding(delegation, authorization) {
  const claims = authorization.payload;
  if (delegation.schemaVersion !== 1 || delegation.kind !== "bodycast-production-ddl-execution-key"
    || delegation.repository !== claims.repository || delegation.authorizationId !== claims.authorizationId
    || delegation.authorizationEnvelopeDigest !== canonicalSha256(authorization)
    || delegation.workflowId !== claims.workflowId || delegation.workflowRunId !== claims.workflowRunId
    || Number(delegation.workflowRunAttempt) !== Number(claims.workflowRunAttempt)
    || delegation.releaseSha !== claims.releaseSha || delegation.currentMainSha !== claims.currentMainSha
    || delegation.manifestId !== claims.manifestId
    || !/^bodycast-exec-[0-9a-f-]{36}$/i.test(String(delegation.executionKeyId ?? ""))
    || typeof delegation.executionPublicKeyPem !== "string" || !delegation.executionPublicKeyPem.includes("PUBLIC KEY")
    || !Number.isFinite(Date.parse(delegation.issuedAt)) || !Number.isFinite(Date.parse(delegation.expiresAt))) {
    reject("execution-key delegation is not bound to this exact authorization.");
  }
}

export function createExecutionAttestationDelegation({ authorizationEnvelope, allowlist, keyId, privateKeyPem, now = Date.now() }) {
  if (!privateKeyPem || !keyId) reject("trusted signing key is unavailable.");
  const authorization = parseAuthorization(authorizationEnvelope, allowlist);
  const claims = assertMigrationAuthorization(authorization);
  if (authorization.keyId !== keyId) reject("delegation must be signed by the authorization key.");
  const authExpiresAt = Date.parse(claims.expiresAt);
  const expiresAt = Math.min(authExpiresAt, now + EXECUTION_KEY_MAX_AGE_MS);
  if (!Number.isFinite(authExpiresAt) || expiresAt <= now) reject("authorization expires before an execution key can be delegated.");
  const pair = generateKeyPairSync("ed25519");
  const executionPublicKeyPem = pair.publicKey.export({ type: "spki", format: "pem" }).toString();
  const executionPrivateKeyPem = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const payload = {
    schemaVersion: 1,
    kind: "bodycast-production-ddl-execution-key",
    repository: claims.repository,
    authorizationId: claims.authorizationId,
    authorizationEnvelopeDigest: canonicalSha256(authorization),
    workflowId: claims.workflowId,
    workflowRunId: claims.workflowRunId,
    workflowRunAttempt: claims.workflowRunAttempt,
    releaseSha: claims.releaseSha,
    currentMainSha: claims.currentMainSha,
    manifestId: claims.manifestId,
    executionKeyId: `bodycast-exec-${randomUUID()}`,
    executionPublicKeyPem,
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(expiresAt).toISOString(),
  };
  const signature = sign(null, Buffer.from(canonicalJson(payload)), createPrivateKey(privateKeyPem)).toString("base64url");
  const certificate = canonicalJson({ algorithm: "Ed25519", keyId, payload, signature });
  verifyExecutionKeyDelegation(certificate, { authorizationEnvelope, allowlist, now });
  return { certificate, executionPrivateKeyPem, payload };
}

export function verifyExecutionKeyDelegation(serialized, { authorizationEnvelope, allowlist, now = Date.now() }) {
  const certificate = parseCanonicalEnvelope(serialized, "execution-key delegation");
  const trustedKeys = allowlist?.keys?.filter((item) => item?.keyId === certificate.keyId) ?? [];
  if (trustedKeys.length !== 1 || trustedKeys[0].status !== "active") reject("delegation parent key is missing, ambiguous, or revoked.");
  if (JSON.stringify(Object.keys(certificate.payload).sort()) !== JSON.stringify([...DELEGATION_FIELDS].sort())) {
    reject("delegation has missing or unsupported fields.");
  }
  const signature = Buffer.from(certificate.signature, "base64url");
  if (signature.length !== 64 || !verify(null, Buffer.from(canonicalJson(certificate.payload)), trustedKeys[0].publicKeyPem, signature)) {
    reject("execution-key delegation signature is invalid.");
  }
  const authorization = parseAuthorization(authorizationEnvelope, allowlist);
  assertMigrationAuthorization(authorization);
  assertDelegationBinding(certificate.payload, authorization);
  const issuedAt = Date.parse(certificate.payload.issuedAt);
  const expiresAt = Date.parse(certificate.payload.expiresAt);
  const authExpiresAt = Date.parse(authorization.payload.expiresAt);
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || issuedAt > now + 30_000 || expiresAt <= now
    || expiresAt <= issuedAt || expiresAt - issuedAt > EXECUTION_KEY_MAX_AGE_MS || expiresAt > authExpiresAt) {
    reject("delegated execution key is expired or has an invalid authorization-bounded lifetime.");
  }
  return certificate.payload;
}

export function createExecutionAttestation({ authorizationEnvelope, latestPreflight, allowlist, delegationCertificate, executionPrivateKeyPem, executionChallenge, now = Date.now() }) {
  if (!executionPrivateKeyPem || !delegationCertificate) reject("fresh delegated execution key is unavailable.");
  if (!/^[a-f0-9]{64}$/.test(String(executionChallenge ?? ""))) reject("one-time remote DDL challenge is missing or malformed.");
  const authorization = parseAuthorization(authorizationEnvelope, allowlist);
  const claims = assertMigrationAuthorization(authorization);
  const delegation = verifyExecutionKeyDelegation(delegationCertificate, { authorizationEnvelope, allowlist, now });
  const checkedAt = new Date(now).toISOString();
  assertLatestSelectionMatchesAuthorization(latestPreflight, claims);
  if (Date.parse(latestPreflight.createdAt) > now) reject("latest preflight metadata is from the future.");
  const expiresAt = Math.min(now + EXECUTION_ATTESTATION_MAX_AGE_MS, Date.parse(delegation.expiresAt));
  const payload = {
    schemaVersion: 1,
    kind: "bodycast-production-ddl-execution",
    repository: claims.repository,
    authorizationId: claims.authorizationId,
    authorizationEnvelopeDigest: canonicalSha256(authorization),
    workflowId: claims.workflowId,
    workflowRunId: claims.workflowRunId,
    workflowRunAttempt: claims.workflowRunAttempt,
    releaseSha: claims.releaseSha,
    currentMainSha: claims.currentMainSha,
    manifestId: claims.manifestId,
    executionKeyId: delegation.executionKeyId,
    executionKeyCertificateDigest: canonicalSha256(JSON.parse(delegationCertificate)),
    executionChallenge,
    preflightWorkflowId: String(latestPreflight.workflowId),
    preflightRunId: String(latestPreflight.id),
    preflightRunAttempt: Number(latestPreflight.runAttempt),
    preflightHeadSha: latestPreflight.headSha,
    preflightEvent: latestPreflight.event,
    preflightBranch: latestPreflight.headBranch,
    preflightDisplayTitle: latestPreflight.displayTitle,
    preflightStatus: latestPreflight.status,
    preflightConclusion: latestPreflight.conclusion,
    preflightCreatedAt: latestPreflight.createdAt,
    latestSelectionDigest: canonicalSha256(selectionBinding(latestPreflight)),
    checkedAt,
    issuedAt: checkedAt,
    expiresAt: new Date(expiresAt).toISOString(),
    attestationId: randomUUID(),
    nonce: randomUUID(),
  };
  const signature = sign(null, Buffer.from(canonicalJson(payload)), createPrivateKey(executionPrivateKeyPem)).toString("base64url");
  const serialized = canonicalJson({ algorithm: "Ed25519", keyId: delegation.executionKeyId, payload, signature });
  const publicKey = createPublicKey(delegation.executionPublicKeyPem);
  if (!verify(null, Buffer.from(canonicalJson(payload)), publicKey, Buffer.from(signature, "base64url"))) {
    reject("delegated execution key does not match its signed certificate.");
  }
  return { serialized, payload };
}

export function verifyExecutionAttestation(serialized, { authorizationEnvelope, allowlist, delegationCertificate, expectedChallenge, now = Date.now() }) {
  const envelope = parseCanonicalEnvelope(serialized, "execution attestation");
  const payload = envelope.payload;
  if (JSON.stringify(Object.keys(payload).sort()) !== JSON.stringify([...ATTESTATION_FIELDS].sort())) {
    reject("attestation payload is missing fields or contains unsupported fields.");
  }
  const delegation = verifyExecutionKeyDelegation(delegationCertificate, { authorizationEnvelope, allowlist, now });
  if (envelope.keyId !== delegation.executionKeyId || payload.executionKeyId !== delegation.executionKeyId
    || payload.executionKeyCertificateDigest !== canonicalSha256(JSON.parse(delegationCertificate))
    || !/^[a-f0-9]{64}$/.test(String(payload.executionChallenge ?? ""))
    || (expectedChallenge !== undefined && payload.executionChallenge !== expectedChallenge)) {
    reject("attestation is not bound to its authorized delegated signing key.");
  }
  const signature = Buffer.from(envelope.signature, "base64url");
  if (signature.length !== 64 || !verify(null, Buffer.from(canonicalJson(payload)), createPublicKey(delegation.executionPublicKeyPem), signature)) {
    reject("attestation signature is invalid.");
  }
  const authorization = parseAuthorization(authorizationEnvelope, allowlist);
  const claims = assertMigrationAuthorization(authorization);
  if (payload.schemaVersion !== 1 || payload.kind !== "bodycast-production-ddl-execution"
    || payload.repository !== claims.repository || payload.authorizationId !== claims.authorizationId
    || payload.authorizationEnvelopeDigest !== canonicalSha256(authorization)
    || payload.workflowId !== claims.workflowId || payload.workflowRunId !== claims.workflowRunId
    || Number(payload.workflowRunAttempt) !== Number(claims.workflowRunAttempt)
    || payload.releaseSha !== claims.releaseSha || payload.currentMainSha !== claims.currentMainSha
    || payload.manifestId !== claims.manifestId || payload.preflightRunId !== String(claims.preflightRunId)
    || Number(payload.preflightRunAttempt) !== Number(claims.preflightRunAttempt)
    || payload.preflightHeadSha !== claims.releaseSha || payload.preflightEvent !== "workflow_dispatch"
    || payload.preflightBranch !== "main" || payload.preflightStatus !== "completed"
    || payload.preflightConclusion !== "success"
    || payload.preflightDisplayTitle !== `Preflight ${claims.releaseSha} ${claims.manifestId}`
    || !Number.isFinite(Date.parse(payload.preflightCreatedAt))
    || canonicalSha256(selectionBinding({
      repository: payload.repository,
      workflowPath: ".github/workflows/production-migration-preflight.yml",
      workflowId: payload.preflightWorkflowId,
      event: payload.preflightEvent,
      headBranch: payload.preflightBranch,
      headSha: payload.preflightHeadSha,
      displayTitle: payload.preflightDisplayTitle,
      id: payload.preflightRunId,
      runAttempt: payload.preflightRunAttempt,
      createdAt: payload.preflightCreatedAt,
      status: payload.preflightStatus,
      conclusion: payload.preflightConclusion,
    })) !== payload.latestSelectionDigest) {
    reject("attestation is not bound to the current authorization and exact successful preflight provenance.");
  }
  const issuedAt = Date.parse(payload.issuedAt);
  const checkedAt = Date.parse(payload.checkedAt);
  const expiresAt = Date.parse(payload.expiresAt);
  if (!Number.isFinite(issuedAt) || !Number.isFinite(checkedAt) || !Number.isFinite(expiresAt)
    || checkedAt !== issuedAt || issuedAt > now + 30_000 || expiresAt <= now
    || expiresAt <= issuedAt || expiresAt - issuedAt > EXECUTION_ATTESTATION_MAX_AGE_MS
    || expiresAt > Date.parse(delegation.expiresAt)) {
    reject("attestation is expired or has an invalid freshness window.");
  }
  if (!/^[0-9a-f-]{36}$/i.test(payload.nonce) || !/^[0-9a-f-]{36}$/i.test(payload.attestationId)) {
    reject("attestation replay identifiers are invalid.");
  }
  assertLatestSelectionMatchesAuthorization({
    repository: payload.repository,
    workflowPath: ".github/workflows/production-migration-preflight.yml",
    workflowId: payload.preflightWorkflowId,
    event: payload.preflightEvent,
    headBranch: payload.preflightBranch,
    headSha: payload.preflightHeadSha,
    displayTitle: payload.preflightDisplayTitle,
    id: payload.preflightRunId,
    runAttempt: payload.preflightRunAttempt,
    createdAt: payload.preflightCreatedAt,
    status: payload.preflightStatus,
    conclusion: payload.preflightConclusion,
  }, claims);
  return payload;
}

export async function consumeExecutionAttestationNonce(payload, nonceDirectory) {
  if (typeof nonceDirectory !== "string" || !path.isAbsolute(nonceDirectory)) reject("persistent replay ledger directory is required.");
  await mkdir(nonceDirectory, { recursive: true, mode: 0o700 });
  const directory = await lstat(nonceDirectory);
  if (!directory.isDirectory() || directory.isSymbolicLink()) reject("replay ledger directory is not a private regular directory.");
  const nonceFile = path.join(nonceDirectory, payload.nonce);
  try {
    await writeFile(nonceFile, `${payload.attestationId}\n${payload.authorizationId}\n${payload.expiresAt}\n`, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (error?.code === "EEXIST") reject("attestation nonce was already consumed.");
    throw error;
  }
  return nonceFile;
}

async function main() {
  const [mode, ...args] = process.argv.slice(2);
  const allowlist = await readFile(new URL("./production-migration-verification-keys.json", import.meta.url), "utf8").then(JSON.parse);
  const keyId = process.env.PRODUCTION_MIGRATION_SIGNING_KEY_ID;
  const privateKeyPem = process.env.PRODUCTION_MIGRATION_ED25519_PRIVATE_KEY;
  if (mode === "--delegate" && args.length === 2) {
    const [authorizationPath, outputPath] = args;
    const authorizationEnvelope = await readFile(authorizationPath, "utf8");
    const result = createExecutionAttestationDelegation({ authorizationEnvelope, allowlist, keyId, privateKeyPem });
    await writeFile(path.resolve(outputPath), `${JSON.stringify({ certificate: result.certificate, executionPrivateKeyPem: result.executionPrivateKeyPem }, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    process.stdout.write(JSON.stringify({ executionKeyId: result.payload.executionKeyId, expiresAt: result.payload.expiresAt }) + "\n");
    return;
  }
  if (mode === "--attest" && args.length === 5) {
    const [authorizationPath, latestPath, delegationPath, executionChallenge, outputPath] = args;
    const [authorizationEnvelope, latestSelection, delegation] = await Promise.all([
      readFile(authorizationPath, "utf8"), readFile(latestPath, "utf8").then(JSON.parse),
      readFile(delegationPath, "utf8").then(JSON.parse),
    ]);
    const latestPreflight = latestSelection?.run ?? latestSelection;
    if (!latestPreflight || typeof latestPreflight !== "object" || Array.isArray(latestPreflight)) {
      reject("latest preflight selection artifact is malformed.");
    }
    const result = createExecutionAttestation({
      authorizationEnvelope,
      latestPreflight,
      allowlist,
      delegationCertificate: delegation.certificate,
      executionPrivateKeyPem: delegation.executionPrivateKeyPem,
      executionChallenge,
    });
    await writeFile(path.resolve(outputPath), `${result.serialized}\n`, { flag: "wx", mode: 0o600 });
    process.stdout.write(JSON.stringify({ attestationId: result.payload.attestationId, expiresAt: result.payload.expiresAt }) + "\n");
    return;
  }
  throw new Error("Usage: production-migration-execution-attestation.mjs --delegate <authorization-envelope.json> <delegation.json> | --attest <authorization-envelope.json> <latest-preflight.json> <delegation.json> <challenge-hex> <output.json>");
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
