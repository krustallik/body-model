import { spawn as nodeSpawn } from "node:child_process";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { isBackupFresh, withPrismaLockTimeout } from "./production-migration-release.mjs";
import { verifyFinalGuardReceipt } from "./production-migration-final-guard.mjs";
import { canonicalSha256 } from "./production-migration-authorization.mjs";
import { normalizeWorkflowRuns } from "./production-migration-select-preflight.mjs";
import { selectLatestApplicablePreflight } from "./production-migration-release.mjs";
import { isCanonicalPostgresDatabaseIdentity, normalizePostgresDatabaseIdentityRow } from "./postgres-database-identity.mjs";
import { acknowledgePrismaSpawn, readProductionReleaseMarker, writeDdlStartingMarker } from "./production-release-marker.mjs";
import { ARMED_RETRY_FAILED_RUN_ID, ARMED_RETRY_FAILED_SHA } from "./production-forward-resume.mjs";

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
        inet_server_addr()::text AS "serverAddress",
        inet_server_port() AS "serverPort",
        pg_backend_pid() AS "observerPid",
        current_setting('application_name') AS "observerApplicationName",
        clock_timestamp() AS "observedAt",
        COALESCE((
          SELECT json_agg(json_build_object('present', true))
          FROM pg_stat_activity a
          WHERE a.datname = current_database() AND a.backend_type = 'client backend' AND a.pid <> pg_backend_pid()
        ), '[]'::json) AS "activeClientBackends"
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
      identityPolicy: "no-other-client-backends",
      observedAt: row.observedAt instanceof Date ? row.observedAt.toISOString() : String(row.observedAt),
      activeClientBackends: row.activeClientBackends,
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
      && canonicalSha256(identity) === receipt.productionIdentityDigest },
    { id: "writer-drain-schema", passed: writerDrain?.schemaVersion === 1 },
    { id: "writer-drain-observer-pid", passed: Number.isSafeInteger(writerDrain?.observerPid) && writerDrain.observerPid > 0 },
    { id: "fixed-observer-application", passed: writerDrain?.observerApplicationName === "bodycast-prisma-ddl-guard" },
    { id: "zero-other-client-policy", passed: writerDrain?.identityPolicy === "no-other-client-backends" },
    { id: "complete-backend-inventory", passed: Array.isArray(writerDrain?.activeClientBackends) },
    { id: "zero-other-client-backends", passed: Array.isArray(writerDrain?.activeClientBackends)
      && writerDrain.activeClientBackends.length === 0 },
    { id: "fresh-writer-drain-observation", passed: Number.isFinite(ageMs) && ageMs >= -60_000 && ageMs <= 30_000 },
  ];
  if (checks.some((entry) => !entry.passed)) reject("final Prisma DATABASE_URL target differs from the verified production identity or writer-drain predicates failed; checks=" + JSON.stringify(checks));
  return true;
}

export function assertLatestPreflightMatchesExecutionProof(proof, latest) {
  if (!latest || String(latest.id) !== String(proof.preflightRunId)
    || Number(latest.runAttempt) !== Number(proof.preflightRunAttempt)
    || latest.runStartedAt !== proof.preflightRunStartedAt
    || latest.repository !== proof.repository || latest.workflowPath !== proof.preflightWorkflowPath
    || latest.headSha !== proof.releaseSha || latest.status !== "completed" || latest.conclusion !== "success") {
    reject("latest admitted preflight attempt does not match the verified migration authorization.");
  }
  return true;
}

export async function readLatestApplicablePreflightForDdl(proof, fetchImpl = fetch) {
  if (!/^[a-f0-9]{40}$/.test(String(proof?.releaseSha ?? ""))) reject("verified authorization lacks a valid release SHA.");
  const workflowFile = "production-migration-preflight.yml";
  let nextUrl = "https://api.github.com/repos/krustallik/body-model/actions/workflows/" + workflowFile + "/runs?per_page=100";
  const records = [];
  let pages = 0;
  while (nextUrl) {
    const url = new URL(nextUrl);
    if (url.origin !== "https://api.github.com" || !url.pathname.endsWith("/actions/workflows/" + workflowFile + "/runs")) {
      reject("preflight status API returned an unexpected pagination target.");
    }
    const response = await fetchImpl(url, {
      headers: { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": "BodyCast-production-migration-guard" },
      redirect: "error", cache: "no-store", signal: AbortSignal.timeout(15_000),
    });
    if (!response?.ok) reject("live preflight status lookup failed (" + (response?.status ?? "unknown") + ").");
    const body = await response.json();
    if (!Array.isArray(body?.workflow_runs)) reject("preflight status response is malformed.");
    records.push(...body.workflow_runs);
    const nextLink = response.headers?.get("link")?.split(",").map((part) => part.trim())
      .find((part) => /;\s*rel="?next"?/.test(part));
    nextUrl = nextLink?.match(/^<([^>]+)>/)?.[1] ?? null;
    pages += 1;
    if (pages > 100) reject("preflight status history exceeds the safe pagination limit.");
  }
  const normalized = normalizeWorkflowRuns(records);
  const workflowIds = [...new Set(normalized.map((run) => String(run.workflowId)))];
  if (workflowIds.length !== 1 || !/^[1-9][0-9]*$/.test(workflowIds[0])) reject("preflight workflow identity is missing or ambiguous.");
  const selected = selectLatestApplicablePreflight(normalized, {
    repository: "krustallik/body-model", workflowId: workflowIds[0], releaseSha: proof.releaseSha, manifestId: proof.manifestId,
  });
  assertLatestPreflightMatchesExecutionProof(proof, selected);
  return selected;
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
  const lineageDigest = receipt.executionMode === "forward-resume" ? receipt.forwardResumeProofDigest : canonicalSha256({
    authorizationId: receipt.authorizationId,
    executionMode: receipt.executionMode ?? "standard",
    releaseSha: receipt.releaseSha,
    workflowRunId: String(receipt.workflowRunId),
    workflowRunAttempt: Number(receipt.workflowRunAttempt),
  });
  if (receipt.executionMode === "forward-resume") {
    if (!/^[a-f0-9]{64}$/.test(String(receipt.forwardResumeMarkerDigest ?? ""))
      || !/^[a-f0-9]{64}$/.test(String(lineageDigest ?? ""))) {
      reject("forward-resume authorization lacks the signed legacy marker and proof lineage.");
    }
    const armed = await readProductionReleaseMarker(path.join(markerDirectory, "marker"));
    const retryArmed = receipt.forwardResumeSourceRunId === ARMED_RETRY_FAILED_RUN_ID;
    const expectedRunId = retryArmed ? receipt.forwardResumeSourceRunId : String(authorized.currentWorkflowRunId);
    const expectedAttempt = retryArmed ? Number(receipt.forwardResumeSourceRunAttempt)
      : Number(authorized.currentWorkflowRunAttempt);
    const expectedAuthorizationId = retryArmed ? receipt.forwardResumeSourceAuthorizationId : receipt.authorizationId;
    if (!armed || armed.marker.state !== "forward-resume-armed" || armed.marker.schemaVersion !== 2
      || armed.marker.releaseSha !== (retryArmed ? receipt.forwardResumeSourceSha : authorized.releaseSha)
      || armed.marker.spawnState !== "not-started"
      || armed.marker.workflowRunId !== expectedRunId || armed.marker.workflowRunAttempt !== expectedAttempt
      || armed.marker.authorizationId !== expectedAuthorizationId
      || (retryArmed ? (armed.digest !== receipt.forwardResumeMarkerDigest
        || receipt.forwardResumeSourceSha !== ARMED_RETRY_FAILED_SHA
        || armed.marker.workflowRunId === String(authorized.currentWorkflowRunId)
        || armed.marker.authorizationId === receipt.authorizationId)
        : (armed.digest === receipt.forwardResumeMarkerDigest || armed.marker.lineageDigest !== lineageDigest))) {
      reject("the armed forward-resume marker is missing or does not match the signed one-time authorization.");
    }
    expectedPriorDigest = armed.digest;
    if (retryArmed) expectedPriorMarker = {
      releaseSha: receipt.forwardResumeSourceSha,
      workflowRunId: armed.marker.workflowRunId,
      workflowRunAttempt: armed.marker.workflowRunAttempt,
      authorizationId: armed.marker.authorizationId,
      lineageDigest: armed.marker.lineageDigest,
    };
  }
  const marker = await markerWriter({
    markerDirectory,
    releaseSha: authorized.releaseSha,
    workflowRunId: authorized.currentWorkflowRunId,
    workflowRunAttempt: authorized.currentWorkflowRunAttempt,
    authorizationId: receipt.authorizationId,
    lineageDigest,
    expectedPriorDigest,
    expectedPriorMarker,
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
