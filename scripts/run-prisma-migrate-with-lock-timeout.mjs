import { spawnSync } from "node:child_process";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { isBackupFresh, withPrismaLockTimeout } from "./production-migration-release.mjs";
import { verifyFinalGuardReceipt } from "./production-migration-final-guard.mjs";
import { canonicalSha256 } from "./production-migration-authorization.mjs";
import { consumeExecutionAttestationNonce, verifyExecutionAttestation, verifyExecutionKeyDelegation } from "./production-migration-execution-attestation.mjs";
import { normalizeWorkflowRuns } from "./production-migration-select-preflight.mjs";
import { selectLatestApplicablePreflight } from "./production-migration-release.mjs";

const DATABASE_IDENTITY_FIELDS = Object.freeze(["database", "databaseOid", "role", "serverVersion", "serverAddress", "serverPort"]);

export async function readPrismaDatabaseIdentity(databaseUrl) {
  if (typeof databaseUrl !== "string" || !databaseUrl) throw new Error("Refusing Prisma DDL: final DATABASE_URL is missing.");
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
  try {
    const rows = await prisma.$queryRawUnsafe(`
      SELECT current_database() AS "database",
        (SELECT oid::text FROM pg_database WHERE datname = current_database()) AS "databaseOid",
        current_user AS "role",
        current_setting('server_version') AS "serverVersion",
        inet_server_addr()::text AS "serverAddress",
        inet_server_port() AS "serverPort"
    `);
    if (!Array.isArray(rows) || rows.length !== 1) throw new Error("identity query returned an unexpected row count.");
    const identity = { ...rows[0], databaseOid: Number(rows[0].databaseOid), serverPort: Number(rows[0].serverPort) };
    if (Object.keys(identity).sort().join("\0") !== [...DATABASE_IDENTITY_FIELDS].sort().join("\0")
      || typeof identity.database !== "string" || !identity.database
      || !Number.isSafeInteger(identity.databaseOid) || identity.databaseOid < 1
      || typeof identity.role !== "string" || !identity.role
      || typeof identity.serverVersion !== "string" || !identity.serverVersion
      || typeof identity.serverAddress !== "string" || !identity.serverAddress
      || !Number.isInteger(identity.serverPort) || identity.serverPort < 1 || identity.serverPort > 65535) {
      throw new Error("identity query returned an incomplete PostgreSQL endpoint.");
    }
    return identity;
  } finally {
    await prisma.$disconnect();
  }
}

export function assertPrismaTargetMatchesSignedIdentity(receipt, identity) {
  if (!/^[a-f0-9]{64}$/.test(String(receipt?.productionIdentityDigest ?? ""))
    || !identity || Object.keys(identity).sort().join("\0") !== [...DATABASE_IDENTITY_FIELDS].sort().join("\0")
    || canonicalSha256(identity) !== receipt.productionIdentityDigest) {
    throw new Error("Migration blocked: final Prisma DATABASE_URL target differs from the signed production identity.");
  }
  return true;
}

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

export function assertLatestPreflightMatchesExecutionAttestation(attestation, latest) {
  if (!latest || String(latest.id) !== String(attestation.preflightRunId)
    || Number(latest.runAttempt) !== Number(attestation.preflightRunAttempt)
    || canonicalSha256(selectionBinding(latest)) !== attestation.latestSelectionDigest) {
    throw new Error("Refusing Prisma DDL: a newer or changed preflight attempt superseded the signed execution attestation.");
  }
  return true;
}

export async function readLatestApplicablePreflightForDdl(attestation, fetchImpl = fetch) {
  const workflowId = String(attestation?.preflightWorkflowId ?? "");
  if (!/^[1-9][0-9]*$/.test(workflowId) || !/^[a-f0-9]{40}$/.test(String(attestation?.releaseSha ?? ""))) {
    throw new Error("Refusing Prisma DDL: execution attestation lacks a valid preflight selection identity.");
  }
  let nextUrl = `https://api.github.com/repos/krustallik/body-model/actions/workflows/${workflowId}/runs?per_page=100`;
  const records = [];
  let pages = 0;
  while (nextUrl) {
    const url = new URL(nextUrl);
    if (url.origin !== "https://api.github.com" || !url.pathname.endsWith(`/actions/workflows/${workflowId}/runs`)) {
      throw new Error("Refusing Prisma DDL: preflight status API returned an unexpected pagination target.");
    }
    const response = await fetchImpl(url, {
      headers: { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": "BodyCast-production-migration-guard" },
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response?.ok) throw new Error(`Refusing Prisma DDL: live preflight status lookup failed (${response?.status ?? "unknown"}).`);
    const body = await response.json();
    if (!Array.isArray(body?.workflow_runs)) throw new Error("Refusing Prisma DDL: live preflight status response is malformed.");
    records.push(...body.workflow_runs);
    const nextLink = response.headers?.get("link")?.split(",").map((part) => part.trim())
      .find((part) => /;\s*rel="?next"?/.test(part));
    nextUrl = nextLink?.match(/^<([^>]+)>/)?.[1] ?? null;
    pages += 1;
    if (pages > 100) throw new Error("Refusing Prisma DDL: preflight status history exceeds the safe pagination limit.");
  }
  const selected = selectLatestApplicablePreflight(normalizeWorkflowRuns(records), {
    repository: "krustallik/body-model",
    workflowId,
    releaseSha: attestation.releaseSha,
    manifestId: attestation.manifestId,
  });
  assertLatestPreflightMatchesExecutionAttestation(attestation, selected);
  return selected;
}

export async function assertPrismaMigrationAuthorized(environment = process.env, now = Date.now()) {
  const databaseUrl = environment.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required for migrations.");
  const receiptPath = environment.BODYCAST_FINAL_GUARD_RECEIPT;
  const envelopePath = environment.BODYCAST_AUTHORIZATION_ENVELOPE;
  const keysPath = environment.BODYCAST_VERIFICATION_KEYS;
  const delegationPath = environment.BODYCAST_EXECUTION_KEY_CERTIFICATE;
  const attestationPath = environment.BODYCAST_EXECUTION_ATTESTATION;
  const executionChallenge = environment.BODYCAST_DDL_EXECUTION_CHALLENGE;
  if (!receiptPath || !envelopePath || !keysPath || !delegationPath || !attestationPath
    || !/^[a-f0-9]{64}$/.test(String(executionChallenge ?? ""))) {
    throw new Error("Refusing Prisma DDL without signed final-guard, current-preflight execution evidence, and one-time challenge.");
  }
  for (const filePath of [receiptPath, envelopePath, keysPath, delegationPath, attestationPath]) {
    const details = await lstat(filePath);
    if (!details.isFile() || details.isSymbolicLink()) throw new Error("Refusing Prisma DDL: signed final-guard evidence path is not a regular file.");
  }
  const [receipt, envelope, allowlist, delegation, attestation] = await Promise.all([
    readFile(receiptPath, "utf8").then((value) => JSON.parse(value)),
    readFile(envelopePath, "utf8").then((value) => value.trimEnd()),
    readFile(keysPath, "utf8").then((value) => JSON.parse(value)),
    readFile(delegationPath, "utf8").then((value) => JSON.parse(value).certificate),
    readFile(attestationPath, "utf8").then((value) => value.trimEnd()),
  ]);
  verifyFinalGuardReceipt({
    receipt,
    envelope,
    allowlist,
    currentWorkflowId: environment.BODYCAST_AUTHORIZATION_WORKFLOW_ID,
    currentWorkflowRunId: environment.BODYCAST_AUTHORIZATION_RUN_ID,
    currentWorkflowRunAttempt: Number(environment.BODYCAST_AUTHORIZATION_RUN_ATTEMPT),
    currentMainSha: environment.BODYCAST_CANONICAL_MAIN_SHA,
    releaseSha: environment.BODYCAST_RELEASE_SHA,
    now,
  });
  const verifiedAttestation = verifyExecutionAttestation(attestation, {
    authorizationEnvelope: envelope, allowlist, delegationCertificate: delegation, expectedChallenge: executionChallenge, now,
  });
  verifyExecutionKeyDelegation(delegation, { authorizationEnvelope: envelope, allowlist, now });
  return {
    databaseUrl: withPrismaLockTimeout(databaseUrl, 5000),
    receipt,
    envelope,
    allowlist,
    delegationCertificate: delegation,
    executionAttestation: attestation,
    verifiedAttestation,
    executionChallenge,
  };
}

export function assertBackupFreshAtDdlStart(receipt, now = Date.now()) {
  const ddlStartedAt = new Date(now).toISOString();
  if (!isBackupFresh(receipt?.backupSnapshotAt, ddlStartedAt)) {
    throw new Error("Refusing Prisma DDL: the production backup snapshot is not fresh at DDL start (maximum 60 minutes).");
  }
  return ddlStartedAt;
}

export async function startPrismaMigrationAtDdlBoundary({
  authorized,
  environment = process.env,
  now = Date.now,
  spawn = spawnSync,
  identityProbe = readPrismaDatabaseIdentity,
  latestPreflightProbe = readLatestApplicablePreflightForDdl,
  nonceDirectory = environment.BODYCAST_DDL_ATTESTATION_NONCE_DIR,
} = {}) {
  if (!authorized?.receipt || !authorized?.databaseUrl || !authorized?.envelope || !authorized?.allowlist
    || !authorized?.delegationCertificate || !authorized?.executionAttestation || !authorized?.verifiedAttestation
    || !/^[a-f0-9]{64}$/.test(String(authorized?.executionChallenge ?? "")) || !nonceDirectory) {
    throw new Error("Refusing Prisma DDL without verified migration authorization, latest-preflight attestation, and replay ledger.");
  }
  const initialAttestation = verifyExecutionAttestation(authorized.executionAttestation, {
    authorizationEnvelope: authorized.envelope,
    allowlist: authorized.allowlist,
    delegationCertificate: authorized.delegationCertificate,
    expectedChallenge: authorized.executionChallenge,
    now: now(),
  });
  if (canonicalSha256(initialAttestation) !== canonicalSha256(authorized.verifiedAttestation)) {
    throw new Error("Refusing Prisma DDL: verified execution attestation payload does not match its signed bytes.");
  }
  const actualIdentity = await identityProbe(authorized.databaseUrl);
  assertPrismaTargetMatchesSignedIdentity(authorized.receipt, actualIdentity);
  const ddlStartedAt = now();
  const boundaryAttestation = verifyExecutionAttestation(authorized.executionAttestation, {
    authorizationEnvelope: authorized.envelope,
    allowlist: authorized.allowlist,
    delegationCertificate: authorized.delegationCertificate,
    expectedChallenge: authorized.executionChallenge,
    now: ddlStartedAt,
  });
  if (canonicalSha256(boundaryAttestation) !== canonicalSha256(initialAttestation)) {
    throw new Error("Refusing Prisma DDL: execution attestation changed before the DDL boundary.");
  }
  assertBackupFreshAtDdlStart(authorized.receipt, ddlStartedAt);
  await consumeExecutionAttestationNonce(boundaryAttestation, nonceDirectory);
  const latestPreflight = await latestPreflightProbe(boundaryAttestation);
  assertLatestPreflightMatchesExecutionAttestation(boundaryAttestation, latestPreflight);
  const spawnBoundaryNow = now();
  verifyExecutionAttestation(authorized.executionAttestation, {
    authorizationEnvelope: authorized.envelope,
    allowlist: authorized.allowlist,
    delegationCertificate: authorized.delegationCertificate,
    expectedChallenge: authorized.executionChallenge,
    now: spawnBoundaryNow,
  });
  assertBackupFreshAtDdlStart(authorized.receipt, spawnBoundaryNow);
  return spawn("npx", ["prisma", "migrate", "deploy"], {
    stdio: "inherit",
    env: { ...environment, DATABASE_URL: authorized.databaseUrl },
    shell: false,
    cwd: path.resolve("/app"),
  });
}

async function main() {
  const authorized = await assertPrismaMigrationAuthorized();
  const result = await startPrismaMigrationAtDdlBoundary({ authorized });
  if (result.error) throw result.error;
  if (result.signal) throw new Error("Prisma migrate deploy terminated by " + result.signal + ".");
  process.exitCode = result.status ?? 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => { process.stderr.write(error.message + "\n"); process.exitCode = 1; });
}
