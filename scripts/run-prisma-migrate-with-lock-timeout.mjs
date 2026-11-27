import { spawn as nodeSpawn } from "node:child_process";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { isBackupFresh, withPrismaLockTimeout } from "./production-migration-release.mjs";
import { verifyFinalGuardReceipt } from "./production-migration-final-guard.mjs";
import { canonicalSha256 } from "./production-migration-authorization.mjs";
import { isCanonicalPostgresDatabaseIdentity, matchesPostgresDatabaseIdentityDigest, normalizePostgresDatabaseIdentityRow } from "./postgres-database-identity.mjs";
import { acknowledgePrismaSpawn, readAuthPredecessorMarker, writeDdlStartingMarker } from "./production-release-marker.mjs";

const AUTH_MULTIUSER_MIGRATION_ORIGIN_SHA = "18e67d53856af1f4742bbe9626abbd005b70e8bf";

function reject(message) {
  throw new Error("Refusing Prisma DDL: " + message);
}

export async function readPrismaDatabaseIdentity(databaseUrl) {
  if (typeof databaseUrl !== "string" || !databaseUrl) reject("final DATABASE_URL is missing.");
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
  try {
    const rows = await prisma.$transaction(async (transaction) => {
      await transaction.$queryRawUnsafe("SELECT set_config('application_name', 'bodycast-prisma-ddl-guard', false)");
      return transaction.$queryRawUnsafe(`
      SELECT current_database() AS "database",
        (SELECT oid::text FROM pg_database WHERE datname = current_database()) AS "databaseOid",
        (SELECT system_identifier::text FROM pg_control_system()) AS "clusterSystemIdentifier",
        current_user AS "role",
        current_setting('server_version') AS "serverVersion",
        host(inet_server_addr()) AS "serverAddress",
        inet_server_port() AS "serverPort",
        pg_backend_pid() AS "observerPid",
        current_setting('application_name') AS "observerApplicationName",
        clock_timestamp() AS "observedAt",
        COALESCE((
          SELECT json_agg(json_build_object('present', true))
          FROM pg_stat_activity a
          WHERE a.datname = current_database() AND a.backend_type = 'client backend'
            AND a.pid <> pg_backend_pid() AND a.xact_start IS NOT NULL
        ), '[]'::json) AS "activeClientTransactions"
      `);
    });
    if (!Array.isArray(rows) || rows.length !== 1) reject("identity query returned an unexpected row count.");
    const row = rows[0];
    let identity;
    try {
      identity = normalizePostgresDatabaseIdentityRow(row);
    } catch (error) {
      reject(error?.message ?? "identity query returned an incomplete PostgreSQL endpoint.");
    }
    if (!isCanonicalPostgresDatabaseIdentity(identity)) {
      reject("identity query returned an incomplete PostgreSQL endpoint.");
    }
    const writerDrain = {
      schemaVersion: 1,
      observerPid: Number(row.observerPid),
      observerApplicationName: row.observerApplicationName,
      identityPolicy: "no-other-client-transactions",
      observedAt: row.observedAt instanceof Date ? row.observedAt.toISOString() : String(row.observedAt),
      activeClientTransactions: row.activeClientTransactions,
    };
    return { identity, writerDrain };
  } finally {
    await prisma.$disconnect();
  }
}

export function assertPrismaTargetMatchesSignedIdentity(receipt, targetState, now = Date.now()) {
  const identity = targetState?.identity;
  const writerDrain = targetState?.writerDrain;
  const observedAt = Date.parse(writerDrain?.observedAt);
  const ageMs = now - observedAt;
  const checks = [
    { id: "signed-database-identity-digest", passed: /^[a-f0-9]{64}$/.test(String(receipt?.productionIdentityDigest ?? "")) },
    { id: "canonical-postgres-identity", passed: isCanonicalPostgresDatabaseIdentity(identity) },
    { id: "exact-database-identity-match", passed: isCanonicalPostgresDatabaseIdentity(identity)
      && /^[a-f0-9]{64}$/.test(String(receipt?.productionIdentityDigest ?? ""))
      && matchesPostgresDatabaseIdentityDigest(identity, receipt.productionIdentityDigest) },
    { id: "writer-drain-schema", passed: writerDrain?.schemaVersion === 1 },
    { id: "writer-drain-observer-pid", passed: Number.isSafeInteger(writerDrain?.observerPid) && writerDrain.observerPid > 0 },
    { id: "fixed-observer-application", passed: writerDrain?.observerApplicationName === "bodycast-prisma-ddl-guard" },
    { id: "zero-other-client-transaction-policy", passed: writerDrain?.identityPolicy === "no-other-client-transactions" },
    { id: "complete-transaction-inventory", passed: Array.isArray(writerDrain?.activeClientTransactions) },
    { id: "zero-other-client-transactions", passed: Array.isArray(writerDrain?.activeClientTransactions)
      && writerDrain.activeClientTransactions.length === 0 },
    { id: "fresh-writer-drain-observation", passed: Number.isFinite(ageMs) && ageMs >= -60_000 && ageMs <= 30_000 },
  ];
  if (checks.some((entry) => !entry.passed)) reject("final Prisma DATABASE_URL target differs from the verified production identity or writer-drain predicates failed; checks=" + JSON.stringify(checks));
  return true;
}

export function assertBackupFreshAtDdlStart(receipt, now = Date.now()) {
  const ddlStartedAt = new Date(now).toISOString();
  if (!isBackupFresh(receipt?.backupSnapshotAt, ddlStartedAt)) reject("production backup snapshot is not fresh at DDL start (maximum 60 minutes).");
  return ddlStartedAt;
}

export async function assertPrismaMigrationAuthorized(environment = process.env, now = Date.now()) {
  const databaseUrl = environment.DATABASE_URL;
  if (!databaseUrl) reject("DATABASE_URL is required for migrations.");
  const receiptPath = environment.BODYCAST_FINAL_GUARD_RECEIPT;
  const envelopePath = environment.BODYCAST_AUTHORIZATION_ENVELOPE;
  const keysPath = environment.BODYCAST_VERIFICATION_KEYS;
  if (!receiptPath || !envelopePath || !keysPath) reject("signed final-guard receipt, owner authorization, and verifier keys are required.");
  for (const filePath of [receiptPath, envelopePath, keysPath]) {
    const details = await lstat(filePath);
    if (!details.isFile() || details.isSymbolicLink()) reject("migration authorization path is not a regular file.");
  }
  const [receipt, envelope, allowlist] = await Promise.all([
    readFile(receiptPath, "utf8").then((value) => JSON.parse(value)),
    readFile(envelopePath, "utf8").then((value) => value.trimEnd()),
    readFile(keysPath, "utf8").then((value) => JSON.parse(value)),
  ]);
  if (environment.BODYCAST_RELEASE_SHA !== environment.BODYCAST_CANONICAL_MAIN_SHA) reject("release SHA is not the freshly checked canonical main tip.");
  const verified = verifyFinalGuardReceipt({
    receipt, envelope, allowlist,
    currentWorkflowId: environment.BODYCAST_AUTHORIZATION_WORKFLOW_ID,
    currentWorkflowRunId: environment.BODYCAST_AUTHORIZATION_RUN_ID,
    currentWorkflowRunAttempt: Number(environment.BODYCAST_AUTHORIZATION_RUN_ATTEMPT),
    currentMainSha: environment.BODYCAST_CANONICAL_MAIN_SHA,
    releaseSha: environment.BODYCAST_RELEASE_SHA,
    now,
  });
  assertBackupFreshAtDdlStart(verified.receipt, now);
  const preflightResultPath = path.join(path.dirname(receiptPath), "preflight-result.json");
  const preflightResult = await readFile(preflightResultPath, "utf8").then((value) => JSON.parse(value));
  if (canonicalSha256(preflightResult) !== verified.receipt.preflightResultDigest) {
    reject("signed preflight result changed before the final DDL marker transition.");
  }
  const sourceReleaseMarker = preflightResult?.sourceReleaseMarker ?? null;
  if (sourceReleaseMarker !== null) {
    if (verified.receipt.manifestId !== "training-session-context-v1"
      || verified.receipt.sourceReleaseMarkerDigest !== sourceReleaseMarker.digest
      || sourceReleaseMarker.schemaVersion !== 3 || sourceReleaseMarker.manifestId !== "auth-multiuser-v1"
      || sourceReleaseMarker.migrationOriginSha !== AUTH_MULTIUSER_MIGRATION_ORIGIN_SHA
      || sourceReleaseMarker.state !== "app-ready" || sourceReleaseMarker.deploySha !== sourceReleaseMarker.liveAppSha
      || !/^[a-f0-9]{40}$/.test(String(sourceReleaseMarker.deploySha ?? ""))
      || !/^[a-f0-9]{64}$/.test(String(sourceReleaseMarker.digest ?? ""))) {
      reject("signed Training preflight does not bind a valid exact Auth predecessor marker.");
    }
    const currentMarker = await readAuthPredecessorMarker(path.join(environment.BODYCAST_RELEASE_MARKER_DIRECTORY, "marker"));
    if (!currentMarker) reject("the live Auth predecessor marker is missing before the Training DDL boundary.");
    const parsedCurrentMarker = currentMarker.marker;
    for (const key of ["schemaVersion", "manifestId", "migrationOriginSha", "deploySha", "state", "workflowRunId",
      "workflowRunAttempt", "authorizationId", "lineageDigest", "spawnState", "sourceMarkerDigest", "compatibilityDigest"]) {
      if (parsedCurrentMarker[key] !== sourceReleaseMarker[key]) reject("the live Auth predecessor marker differs from signed preflight evidence.");
    }
    if (currentMarker.digest !== sourceReleaseMarker.digest) {
      reject("the live Auth predecessor marker digest differs from signed preflight evidence.");
    }
  } else if (verified.receipt.sourceReleaseMarkerDigest !== undefined) {
    reject("final guard receipt contains an unbound Auth predecessor digest.");
  }
  return {
    databaseUrl,
    receipt: verified.receipt,
    envelope,
    allowlist,
    currentWorkflowId: environment.BODYCAST_AUTHORIZATION_WORKFLOW_ID,
    currentWorkflowRunId: environment.BODYCAST_AUTHORIZATION_RUN_ID,
    currentWorkflowRunAttempt: Number(environment.BODYCAST_AUTHORIZATION_RUN_ATTEMPT),
    currentMainSha: environment.BODYCAST_CANONICAL_MAIN_SHA,
    releaseSha: environment.BODYCAST_RELEASE_SHA,
    preflightResult,
  };
}

export async function startPrismaMigrationAtDdlBoundary({
  authorized,
  environment = process.env,
  now = Date.now,
  spawn = nodeSpawn,
  identityProbe = readPrismaDatabaseIdentity,
  markerWriter = writeDdlStartingMarker,
  spawnAcknowledger = acknowledgePrismaSpawn,
} = {}) {
  if (!authorized?.receipt || !authorized?.envelope || !authorized?.allowlist || !authorized?.databaseUrl) {
    reject("verified signed authorization and final live guard are required.");
  }
  const finalGuard = verifyFinalGuardReceipt({
    receipt: authorized.receipt,
    envelope: authorized.envelope,
    allowlist: authorized.allowlist,
    currentWorkflowId: authorized.currentWorkflowId,
    currentWorkflowRunId: authorized.currentWorkflowRunId,
    currentWorkflowRunAttempt: authorized.currentWorkflowRunAttempt,
    currentMainSha: authorized.currentMainSha,
    releaseSha: authorized.releaseSha,
    now: now(),
  });
  if (finalGuard.verified !== true) reject("signed final live guard could not be verified.");
  assertBackupFreshAtDdlStart(finalGuard.receipt, now());
  const databaseUrl = withPrismaLockTimeout(authorized.databaseUrl, 5000);
  const actualIdentity = await identityProbe(databaseUrl);
  assertPrismaTargetMatchesSignedIdentity(finalGuard.receipt, actualIdentity, now());
  assertBackupFreshAtDdlStart(finalGuard.receipt, now());
  const markerDirectory = environment.BODYCAST_RELEASE_MARKER_DIRECTORY;
  if (typeof markerDirectory !== "string" || markerDirectory !== "/run/bodycast-release-marker") {
    reject("fixed durable release-marker mount is unavailable.");
  }
  const receipt = finalGuard.receipt;
  let expectedPriorDigest = null;
  let expectedPriorMarker = null;
  let expectedPriorMode = null;
  let lineageDigest = canonicalSha256({
    authorizationId: receipt.authorizationId,
    releaseSha: receipt.releaseSha,
    workflowRunId: String(receipt.workflowRunId),
    workflowRunAttempt: Number(receipt.workflowRunAttempt),
  });
  if (authorized.preflightResult?.sourceReleaseMarker) {
    if (receipt.manifestId !== "training-session-context-v1") reject("Auth predecessor handoff is restricted to Training session-context migration.");
    const source = authorized.preflightResult.sourceReleaseMarker;
    if (expectedPriorDigest !== null) reject("multiple prior marker transitions were requested.");
    expectedPriorDigest = source.digest;
    expectedPriorMode = "auth-to-training-session-context";
    expectedPriorMarker = source;
    lineageDigest = canonicalSha256({
      authorizationId: receipt.authorizationId,
      releaseSha: receipt.releaseSha,
      workflowRunId: String(authorized.currentWorkflowRunId),
      workflowRunAttempt: Number(authorized.currentWorkflowRunAttempt),
      sourceMarkerDigest: source.digest,
    });
  }
  const marker = await markerWriter({
    markerDirectory,
    releaseSha: authorized.releaseSha,
    manifestId: receipt.manifestId,
    workflowRunId: authorized.currentWorkflowRunId,
    workflowRunAttempt: authorized.currentWorkflowRunAttempt,
    authorizationId: receipt.authorizationId,
    lineageDigest,
    expectedPriorDigest,
    expectedPriorMarker,
    expectedPriorMode,
  });
  let child;
  try {
    child = spawn("npx", ["prisma", "migrate", "deploy"], {
      stdio: "inherit",
      env: { ...environment, DATABASE_URL: databaseUrl },
      shell: false,
      cwd: path.resolve("/app"),
    });
  } catch (error) {
    reject("Prisma process creation failed before spawn; durable marker remains ddl-starting. " + (error?.message ?? ""));
  }
  return new Promise((resolve, rejectPromise) => {
    let spawnAcknowledged = false;
    let spawnFailure = null;
    let spawnAcknowledgement = Promise.resolve();
    child.once("spawn", async () => {
      spawnAcknowledgement = spawnAcknowledger({ markerPath: marker.markerPath, expectedDigest: marker.digest })
        .then(() => {
          spawnAcknowledged = true;
        })
        .catch((error) => {
        spawnFailure = error;
        child.kill("SIGTERM");
        });
    });
    child.once("error", async (error) => {
      await spawnAcknowledgement;
      const phase = spawnAcknowledged ? "after spawn" : "before a confirmed spawn";
      rejectPromise(new Error(`Refusing Prisma DDL: Prisma process error ${phase}; durable marker remains blocking. ${error?.message ?? ""}`));
    });
    child.once("close", async (status, signal) => {
      await spawnAcknowledgement;
      if (spawnFailure) {
        rejectPromise(new Error("Refusing Prisma DDL: durable spawn acknowledgement failed; durable ddl-starting marker remains blocking."));
        return;
      }
      // The spawn event is delivered before exit. Wait one event-loop turn for its
      // fsync-backed marker acknowledgement to settle before reporting completion.
      setImmediate(() => {
        if (!spawnAcknowledged) {
          rejectPromise(new Error("Refusing Prisma DDL: child exited without a durable spawn acknowledgement; marker remains blocking."));
          return;
        }
        resolve({ status: status ?? 1, signal: signal ?? null });
      });
    });
  });
}

async function main() {
  const authorized = await assertPrismaMigrationAuthorized();
  const result = await startPrismaMigrationAtDdlBoundary({ authorized });
  if (result.error) throw result.error;
  if (result.signal) reject("Prisma migrate deploy terminated by " + result.signal + ".");
  process.exitCode = result.status ?? 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => { process.stderr.write(error.message + "\n"); process.exitCode = 1; });
}
