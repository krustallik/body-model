import { createHash, createPublicKey, verify as verifySignature } from "node:crypto";
import { mkdir, lstat, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { canonicalSha256, verifyAuthorizationEnvelope } from "./production-migration-authorization.mjs";
import { assertPinnedOwnerId } from "./github-owner-identity.mjs";

export const EXECUTION_PROOF_MAX_AGE_MS = 5 * 60 * 1000;
export const GITHUB_OIDC_ISSUER = "https://token.actions.githubusercontent.com";
export const GITHUB_OIDC_JWKS_URL = GITHUB_OIDC_ISSUER + "/.well-known/jwks";
export const DDL_PROOF_AUDIENCE_PREFIX = "https://bodycast.invalid/production-migration/ddl";
const EXPECTED_REPOSITORY = "krustallik/body-model";
const EXPECTED_WORKFLOW_PATH = ".github/workflows/production-migrate.yml";
const EXPECTED_EXECUTION_SUBJECT = "repo:krustallik/body-model:environment:production";

function reject(message) { throw new Error("Migration execution proof blocked: " + message); }

function parseJsonPart(encoded, label) {
  try { return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")); }
  catch { reject(label + " is malformed."); }
}

function authorizationClaims(authorizationEnvelope, allowlist, now) {
  let untrusted;
  try { untrusted = JSON.parse(authorizationEnvelope)?.payload; } catch { reject("signed authorization envelope is malformed."); }
  const result = verifyAuthorizationEnvelope(authorizationEnvelope, { allowlist, live: untrusted, now });
  const claims = result.payload;
  assertPinnedOwnerId(claims.actorId, "Signed migration actor ID");
  if (claims.repository !== EXPECTED_REPOSITORY || claims.workflowPath !== EXPECTED_WORKFLOW_PATH
    || !/^[1-9][0-9]*$/.test(String(claims.workflowId))
    || !/^[1-9][0-9]*$/.test(String(claims.workflowRunId))
    || !Number.isSafeInteger(Number(claims.workflowRunAttempt)) || Number(claims.workflowRunAttempt) < 1
    || !/^[a-f0-9]{40}$/.test(String(claims.releaseSha))
    || !/^[1-9][0-9]*$/.test(String(claims.preflightRunId))
    || !Number.isSafeInteger(Number(claims.preflightRunAttempt)) || Number(claims.preflightRunAttempt) < 1
    || !Number.isFinite(Date.parse(claims.preflightRunStartedAt))) {
    reject("signed authorization lacks exact migration/preflight workflow identity.");
  }
  return { claims, authorizationId: result.authorizationId };
}

export function executionProofAudience(authorizationEnvelope, challenge, allowlist, now = Date.now()) {
  if (!/^[a-f0-9]{64}$/.test(String(challenge ?? ""))) reject("one-time remote DDL challenge is missing or malformed.");
  const { claims } = authorizationClaims(authorizationEnvelope, allowlist, now);
  const authorizationDigest = canonicalSha256(JSON.parse(authorizationEnvelope));
  const preflightStartDigest = createHash("sha256").update(claims.preflightRunStartedAt, "utf8").digest("hex");
  return DDL_PROOF_AUDIENCE_PREFIX + "/" + authorizationDigest + "/" + claims.preflightRunId + "/"
    + claims.preflightRunAttempt + "/" + preflightStartDigest + "/" + challenge;
}

export async function readGitHubOidcJwks(fetchImpl = fetch) {
  const response = await fetchImpl(GITHUB_OIDC_JWKS_URL, {
    headers: { accept: "application/json", "user-agent": "BodyCast-production-migration-guard" },
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response?.ok) reject("GitHub OIDC signing-key lookup failed (" + (response?.status ?? "unknown") + ").");
  const body = await response.json();
  if (!Array.isArray(body?.keys) || body.keys.length < 1 || body.keys.length > 32) reject("GitHub OIDC signing-key set is malformed.");
  return body.keys;
}

export async function verifyGitHubExecutionProof(serialized, {
  authorizationEnvelope, allowlist, expectedChallenge, now = Date.now(), jwks, fetchImpl = fetch,
} = {}) {
  if (typeof serialized !== "string" || serialized.length > 32_768 || serialized.trim() !== serialized) reject("OIDC proof is missing, oversized, or noncanonical.");
  const { claims: authClaims, authorizationId } = authorizationClaims(authorizationEnvelope, allowlist, now);
  const parts = serialized.split(".");
  if (parts.length !== 3 || parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) reject("OIDC proof is not a compact JWT.");
  const header = parseJsonPart(parts[0], "OIDC JWT header");
  const payload = parseJsonPart(parts[1], "OIDC JWT claims");
  if (header?.alg !== "RS256" || header?.typ !== "JWT" || typeof header?.kid !== "string" || !header.kid) reject("OIDC JWT algorithm or key id is unsupported.");
  const keys = jwks ?? await readGitHubOidcJwks(fetchImpl);
  const candidates = keys.filter((key) => key?.kid === header.kid && key?.kty === "RSA" && key?.use === "sig"
    && (key?.alg === undefined || key.alg === "RS256"));
  if (candidates.length !== 1) reject("OIDC signing key is missing or ambiguous.");
  let validSignature = false;
  try {
    validSignature = verifySignature("RSA-SHA256", Buffer.from(parts[0] + "." + parts[1]), createPublicKey({ key: candidates[0], format: "jwk" }), Buffer.from(parts[2], "base64url"));
  } catch { reject("OIDC JWT signature could not be verified."); }
  if (!validSignature) reject("OIDC JWT signature is invalid.");

  const expectedAudience = executionProofAudience(authorizationEnvelope, expectedChallenge, allowlist, now);
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  const issuedAt = Number(payload.iat) * 1000;
  const notBefore = payload.nbf === undefined ? issuedAt : Number(payload.nbf) * 1000;
  const expiresAt = Number(payload.exp) * 1000;
  if (payload.iss !== GITHUB_OIDC_ISSUER || aud.length !== 1 || aud[0] !== expectedAudience
    || typeof payload.jti !== "string" || payload.jti.length < 8 || payload.jti.length > 256
    || !Number.isFinite(issuedAt) || !Number.isFinite(notBefore) || !Number.isFinite(expiresAt)
    || issuedAt > now + 30_000 || notBefore > now + 30_000 || expiresAt <= now
    || now - issuedAt > EXECUTION_PROOF_MAX_AGE_MS || expiresAt <= issuedAt
    || expiresAt - issuedAt > EXECUTION_PROOF_MAX_AGE_MS) {
    reject("OIDC proof audience, issuer, replay id, or freshness is invalid.");
  }
  const expectedWorkflowRef = EXPECTED_REPOSITORY + "/" + EXPECTED_WORKFLOW_PATH + "@refs/heads/main";
  if (payload.repository !== EXPECTED_REPOSITORY || String(payload.repository_owner_id) !== String(authClaims.actorId)
    || String(payload.actor_id) !== String(authClaims.actorId)
    || payload.sub !== EXPECTED_EXECUTION_SUBJECT || payload.environment !== "production"
    || payload.workflow_ref !== expectedWorkflowRef
    || payload.ref !== "refs/heads/main" || payload.sha !== authClaims.releaseSha
    || payload.workflow_sha !== authClaims.releaseSha || payload.event_name !== "workflow_dispatch"
    || String(payload.run_id) !== String(authClaims.workflowRunId)
    || Number(payload.run_attempt) !== Number(authClaims.workflowRunAttempt)) {
    reject("OIDC proof is not from the exact authorized repository, workflow, ref, SHA, run, and attempt.");
  }
  return Object.freeze({
    issuer: payload.iss,
    audience: expectedAudience,
    jti: payload.jti,
    issuedAt: new Date(issuedAt).toISOString(),
    expiresAt: new Date(expiresAt).toISOString(),
    repository: payload.repository,
    actorId: String(payload.actor_id),
    workflowRef: payload.workflow_ref,
    workflowPath: EXPECTED_WORKFLOW_PATH,
    ref: payload.ref,
    sha: payload.sha,
    eventName: payload.event_name,
    runId: String(payload.run_id),
    runAttempt: Number(payload.run_attempt),
    workflowId: String(authClaims.workflowId),
    authorizationId,
    authorizationEnvelopeDigest: canonicalSha256(JSON.parse(authorizationEnvelope)),
    releaseSha: authClaims.releaseSha,
    manifestId: authClaims.manifestId,
    preflightRunId: String(authClaims.preflightRunId),
    preflightRunAttempt: Number(authClaims.preflightRunAttempt),
    preflightRunStartedAt: authClaims.preflightRunStartedAt,
    preflightWorkflowPath: ".github/workflows/production-migration-preflight.yml",
  });
}

export function assertCurrentMigrationRunMatchesProof(proof, run, now = Date.now()) {
  const runPath = typeof run?.path === "string" ? run.path.split("@")[0] : "";
  const runStartedAt = Date.parse(run?.run_started_at);
  const proofIssuedAt = Date.parse(proof?.issuedAt);
  if (!run || run.repository?.full_name !== EXPECTED_REPOSITORY
    || runPath !== EXPECTED_WORKFLOW_PATH || String(run.workflow_id) !== proof.workflowId
    || String(run.id) !== proof.runId || Number(run.run_attempt) !== proof.runAttempt
    || run.event !== "workflow_dispatch" || run.head_branch !== "main" || run.head_sha !== proof.releaseSha
    || String(run.actor?.id) !== String(proof.actorId)
    || String(run.triggering_actor?.id) !== String(proof.actorId)
    || run.status !== "in_progress" || run.conclusion !== null
    || typeof run.run_started_at !== "string" || !Number.isFinite(runStartedAt)
    || !Number.isFinite(proofIssuedAt) || runStartedAt > proofIssuedAt + 30_000 || runStartedAt > now + 30_000) {
    reject("GitHub no longer reports the exact OIDC-authenticated migration run as current and admitted.");
  }
  return true;
}

export async function readCurrentMigrationRunForDdl(proof, fetchImpl = fetch) {
  if (!/^[1-9][0-9]*$/.test(String(proof?.runId ?? ""))) reject("OIDC proof lacks a valid current migration run id.");
  const url = new URL("https://api.github.com/repos/" + EXPECTED_REPOSITORY + "/actions/runs/" + proof.runId);
  const response = await fetchImpl(url, {
    headers: { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": "BodyCast-production-migration-guard" },
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response?.ok) reject("current migration run lookup failed (" + (response?.status ?? "unknown") + ").");
  return response.json();
}

export async function consumeExecutionProofNonce(proof, nonceDirectory) {
  if (typeof nonceDirectory !== "string" || !path.isAbsolute(nonceDirectory)) reject("persistent replay ledger directory is required.");
  await mkdir(nonceDirectory, { recursive: true, mode: 0o700 });
  const directory = await lstat(nonceDirectory);
  if (!directory.isDirectory() || directory.isSymbolicLink()) reject("replay ledger directory is not a private regular directory.");
  const nonce = createHash("sha256").update(proof.audience, "utf8").digest("hex");
  const nonceFile = path.join(nonceDirectory, nonce);
  try {
    await writeFile(nonceFile, proof.jti + "\n" + proof.authorizationId + "\n" + proof.expiresAt + "\n" + proof.runId + "\n" + proof.runAttempt + "\n", { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (error?.code === "EEXIST") reject("challenge-bound OIDC proof was already consumed.");
    throw error;
  }
  return nonceFile;
}

export async function requestGitHubOidcExecutionProof({ authorizationEnvelope, challenge, allowlist, requestUrl, requestToken, fetchImpl = fetch, outputPath, now = Date.now() } = {}) {
  if (!requestUrl || !requestToken) reject("GitHub Actions OIDC request capability is unavailable.");
  const audience = executionProofAudience(authorizationEnvelope, challenge, allowlist, now);
  let url;
  try { url = new URL(requestUrl); } catch { reject("GitHub Actions OIDC request URL is malformed."); }
  if (url.protocol !== "https:" || !["pipelines.actions.githubusercontent.com", "token.actions.githubusercontent.com", "actions.githubusercontent.com"].includes(url.hostname)) {
    reject("GitHub Actions OIDC request URL has an unexpected origin.");
  }
  url.searchParams.set("audience", audience);
  const response = await fetchImpl(url, {
    headers: { authorization: "Bearer " + requestToken, accept: "application/json" },
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response?.ok) reject("GitHub Actions OIDC token request failed (" + (response?.status ?? "unknown") + ").");
  const body = await response.json();
  if (typeof body?.value !== "string" || body.value.split(".").length !== 3) reject("GitHub Actions OIDC provider returned a malformed token.");
  if (outputPath) await writeFile(path.resolve(outputPath), body.value + "\n", { flag: "wx", mode: 0o600 });
  return body.value;
}

async function main() {
  const [mode, ...args] = process.argv.slice(2);
  if (mode === "--request-oidc-proof" && args.length === 3) {
    const [authorizationPath, challenge, outputPath] = args;
    const [authorizationEnvelope, allowlist] = await Promise.all([
      readFile(authorizationPath, "utf8").then((value) => value.trimEnd()),
      readFile(new URL("./production-migration-verification-keys.json", import.meta.url), "utf8").then(JSON.parse),
    ]);
    await requestGitHubOidcExecutionProof({
      authorizationEnvelope, challenge, allowlist,
      requestUrl: process.env.ACTIONS_ID_TOKEN_REQUEST_URL,
      requestToken: process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN,
      outputPath,
    });
    return;
  }
  throw new Error("Usage: production-migration-execution-attestation.mjs --request-oidc-proof <authorization-envelope.json> <challenge-hex> <output.jwt>");
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => { process.stderr.write(error.message + "\n"); process.exitCode = 1; });
}
