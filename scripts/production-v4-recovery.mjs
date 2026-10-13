import { execFileSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { canonicalSha256 } from "./production-migration-authorization.mjs";
import { evaluateProductionPostflight, schemaInventoryDigest } from "./production-migration-preflight.mjs";
import { V4_REPUBLICATION_MANIFEST } from "./production-migration-manifests.mjs";
import { isCanonicalPostgresDatabaseIdentity } from "./postgres-database-identity.mjs";
import { assertPostgresClientCompatibility } from "./postgres-client-versions.mjs";
import { assertFreshWriterDrain } from "./production-writer-drain.mjs";

const DIGEST = /^[a-f0-9]{64}$/;
const SHA = /^[a-f0-9]{40}$/;
const V4_REVISION = "unified-experimental-physiology-state-v4-physical-glycogen-water-2p7-exact-once";

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

export function assertV4RecoverySnapshot(snapshot, {
  releaseSha,
  migrationRun,
  repositoryPath = process.cwd(),
  now = Date.now(),
} = {}) {
  requireValue(SHA.test(String(releaseSha ?? "")), "Recovery snapshot release SHA is invalid.");
  requireValue(snapshot?.schemaVersion === 1 && snapshot.releaseSha === releaseSha
    && snapshot.canonicalMainSha === releaseSha, "Recovery snapshot is not bound to exact current main.");
  requireValue(snapshot.manifestId === V4_REPUBLICATION_MANIFEST.id, "Recovery snapshot manifest is unexpected.");
  requireValue(snapshot.databaseContainerId && /^[a-f0-9]{64}$/.test(snapshot.databaseContainerId), "Production database container identity is malformed.");
  requireValue(DIGEST.test(String(snapshot.databaseImageId ?? "")), "Production PostgreSQL image identity is malformed.");
  requireValue(DIGEST.test(String(snapshot.appImageId ?? "")), "Exact app image identity is missing.");
  requireValue(DIGEST.test(String(snapshot.markerDigest ?? "")), "Release marker digest is malformed.");
  requireValue(DIGEST.test(String(snapshot.routeDigest ?? "")), "Maintenance route digest is malformed.");
  requireValue(DIGEST.test(String(snapshot.v4ReplayInputFingerprint ?? "")), "Raw V4 replay-input fingerprint is malformed.");
  requireValue(DIGEST.test(String(snapshot.report?.logicalDataFingerprint ?? "")), "Full production data fingerprint is malformed.");

  const marker = snapshot.marker;
  requireValue(marker?.schemaVersion === 3 && marker.manifestId === V4_REPUBLICATION_MANIFEST.id
    && marker.state === "app-ready" && marker.deploySha === releaseSha
    && SHA.test(String(marker.migrationOriginSha ?? ""))
    && /^[1-9][0-9]*$/.test(String(marker.workflowRunId ?? ""))
    && /^[1-9][0-9]*$/.test(String(marker.workflowRunAttempt ?? ""))
    && /^[A-Za-z0-9-]{16,80}$/.test(String(marker.authorizationId ?? ""))
    && DIGEST.test(String(marker.lineageDigest ?? ""))
    && DIGEST.test(String(marker.sourceMarkerDigest ?? ""))
    && DIGEST.test(String(marker.compatibilityDigest ?? "")),
  "V4 app-ready marker provenance is incomplete or inconsistent.");
  requireValue(migrationRun && String(migrationRun.id) === marker.workflowRunId
    && String(migrationRun.runAttempt) === marker.workflowRunAttempt
    && migrationRun.headSha === marker.migrationOriginSha
    && migrationRun.workflowPath === ".github/workflows/production-migrate.yml"
    && migrationRun.actorId === "126446430" && migrationRun.conclusion === "success"
    && migrationRun.event === "workflow_dispatch",
  "The marker does not bind to the successful pinned-owner V4 DDL run.");
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", marker.migrationOriginSha, releaseSha], {
      cwd: repositoryPath, stdio: "ignore",
    });
    requireValue(execFileSync("git", ["rev-parse", "HEAD"], { cwd: repositoryPath, encoding: "utf8" }).trim() === releaseSha,
      "Recovery tooling checkout differs from the exact release SHA.");
  } catch {
    throw new Error("Migration-origin SHA is not an ancestor of the exact recovery release.");
  }

  const report = snapshot.report;
  const identity = report?.identity;
  requireValue(isCanonicalPostgresDatabaseIdentity(identity)
    && identity.database === "bodycast" && identity.role === "bodycast"
    && identity.serverPort === 5432 && identity.serverVersion.startsWith("17."),
  "Live production PostgreSQL identity or endpoint is not canonical.");
  const migrationDirectories = snapshot.migrationDirectories;
  requireValue(Array.isArray(migrationDirectories), "Production migration tree inventory is missing.");
  const postflight = evaluateProductionPostflight(report, migrationDirectories, V4_REPUBLICATION_MANIFEST.id);
  requireValue(postflight.ready, "Live production migration history or schema postflight is not clean.");
  requireValue(Array.isArray(report?.conflictingLocks) && report.conflictingLocks.length === 0
    && Array.isArray(report?.preparedTransactions) && report.preparedTransactions.length === 0
    && Array.isArray(report?.longTransactions) && report.longTransactions.length === 0,
  "Production lock, prepared-transaction, or transaction-age inventory is unknown or nonempty.");
  assertFreshWriterDrain(report, { now });

  const lifecycle = snapshot.v4Lifecycle;
  requireValue(lifecycle?.profileId === 1 && lifecycle.unifiedTargetRevision === V4_REVISION
    && lifecycle.unifiedRolloutEpoch === 1 && lifecycle.productionStaleFromDate === null
    && lifecycle.productionPublishedGeneration === lifecycle.invalidationGeneration
    && lifecycle.unifiedPublicationBlockedFromDate === null
    && ((lifecycle.unifiedPublishedRolloutEpoch === null && lifecycle.unifiedPublishedGeneration === null)
      || (lifecycle.unifiedPublishedRolloutEpoch === 1 && lifecycle.unifiedPublishedGeneration === lifecycle.invalidationGeneration)),
  "Live V4 lifecycle is unknown, stale, blocked, or outside epoch-1 resume state.");
  requireValue(snapshot.lifecycleState === (lifecycle.unifiedPublishedRolloutEpoch === null ? "v4-replayable" : "v4-current"),
    "V4 lifecycle command result differs from the live lifecycle row.");
  assertPostgresClientCompatibility(snapshot.pgDumpVersion, snapshot.pgRestoreVersion);
  return {
    verified: true,
    ddlAuthorization: false,
    releaseSha,
    migrationOriginSha: marker.migrationOriginSha,
    migrationRunId: marker.workflowRunId,
    markerDigest: snapshot.markerDigest,
    databaseContainerId: snapshot.databaseContainerId,
    databaseImageId: snapshot.databaseImageId,
    identityDigest: canonicalSha256(identity),
    migrationHistoryDigest: canonicalSha256(report.migrations),
    schemaDigest: schemaInventoryDigest(report.objects),
    logicalDataFingerprint: report.logicalDataFingerprint,
    v4ReplayInputFingerprint: snapshot.v4ReplayInputFingerprint,
    lifecycle: { ...lifecycle },
    appImageId: snapshot.appImageId,
    routeDigest: snapshot.routeDigest,
    pgDumpVersion: snapshot.pgDumpVersion,
    pgRestoreVersion: snapshot.pgRestoreVersion,
  };
}

export function assertStableV4RecoverySnapshots(before, after) {
  const stable = (snapshot) => ({
    releaseSha: snapshot.releaseSha,
    databaseContainerId: snapshot.databaseContainerId,
    databaseImageId: snapshot.databaseImageId,
    markerDigest: snapshot.markerDigest,
    routeDigest: snapshot.routeDigest,
    appImageId: snapshot.appImageId,
    identity: snapshot.report?.identity,
    migrations: snapshot.report?.migrations,
    objects: snapshot.report?.objects,
    fullFingerprint: snapshot.report?.logicalDataFingerprint,
    rawFingerprint: snapshot.v4ReplayInputFingerprint,
    lifecycle: snapshot.v4Lifecycle,
  });
  requireValue(canonicalSha256(stable(before)) === canonicalSha256(stable(after)),
    "Production database, schema, lifecycle, image, marker, or route changed across the backup boundary.");
  return true;
}

export function assertV4ReplayRehearsal({
  sourceSnapshot,
  restoreResult,
  postflightResult,
  restoreReport,
  sourceRawFingerprint,
  restoredRawFingerprintBefore,
  restoredRawFingerprintAfter,
  restoredRawFingerprintAfterRetry,
  fullFingerprintBefore,
  fullFingerprintAfter,
  fullFingerprintAfterRetry,
  firstReplay,
  retryReplay,
  lifecycleAfter,
} = {}) {
  const expectedMigrationRows = V4_REPUBLICATION_MANIFEST.migrations;
  const expectedMigrations = expectedMigrationRows.map(({ name }) => name).sort();
  const v4MigrationRows = Array.isArray(restoreReport?.migrations)
    ? restoreReport.migrations.filter(({ name }) => expectedMigrations.includes(name)) : [];
  requireValue(JSON.stringify(v4MigrationRows.map(({ name }) => name).sort()) === JSON.stringify(expectedMigrations)
    && expectedMigrationRows.every((migration) => {
      const matches = v4MigrationRows.filter((row) => row.name === migration.name);
      return matches.length === 1 && matches[0].checksum === migration.sha256
        && typeof matches[0].finishedAt === "string" && matches[0].rolledBackAt === null;
    }), "Isolated backup history does not contain exactly the two reviewed successful V4 migration rows.");
  requireValue(restoreResult?.verified === true && restoreResult?.migrationCount === restoreReport?.migrations?.length
    && postflightResult?.postflightReady === true && Array.isArray(postflightResult.blockers) && postflightResult.blockers.length === 0
    && DIGEST.test(String(postflightResult.postSchemaDigest ?? "")),
    "Encrypted production backup restore or full logical-data parity failed.");
  requireValue(sourceSnapshot?.report?.logicalDataFingerprint === restoreReport?.logicalDataFingerprint,
    "Restored PostgreSQL data fingerprint differs from the production backup source.");
  requireValue(fullFingerprintBefore === restoreReport.logicalDataFingerprint,
    "V4 rehearsal baseline fingerprint does not identify the verified restored backup.");
  requireValue(sourceSnapshot?.v4ReplayInputFingerprint === sourceRawFingerprint,
    "Raw replay-source fingerprint differs from the verified production backup snapshot.");
  const rawFingerprints = [sourceRawFingerprint, restoredRawFingerprintBefore, restoredRawFingerprintAfter, restoredRawFingerprintAfterRetry];
  requireValue(rawFingerprints.every((fingerprint) => DIGEST.test(String(fingerprint ?? "")) && fingerprint === sourceRawFingerprint),
    "Raw replay-source fingerprint changed during V4 rehearsal.");
  requireValue(DIGEST.test(String(fullFingerprintBefore ?? ""))
    && DIGEST.test(String(fullFingerprintAfter ?? ""))
    && fullFingerprintAfter !== fullFingerprintBefore
    && fullFingerprintAfterRetry === fullFingerprintAfter,
  "V4 rehearsal output or retry idempotency fingerprint is invalid.");
  requireValue(firstReplay?.rolloutEpoch === 1 && Number.isSafeInteger(firstReplay?.dayCount) && firstReplay.dayCount > 0
    && retryReplay?.rolloutEpoch === 1 && retryReplay.dayCount === firstReplay.dayCount,
  "Isolated epoch-1 replay or idempotent retry did not complete the same history range.");
  requireValue(lifecycleAfter?.unifiedTargetRevision === V4_REVISION
    && lifecycleAfter.unifiedRolloutEpoch === 1 && lifecycleAfter.unifiedPublishedRolloutEpoch === 1
    && lifecycleAfter.unifiedPublishedGeneration === lifecycleAfter.invalidationGeneration
    && lifecycleAfter.productionPublishedGeneration === lifecycleAfter.invalidationGeneration
    && lifecycleAfter.productionStaleFromDate === null && lifecycleAfter.unifiedPublicationBlockedFromDate === null,
  "Isolated V4 replay lifecycle is not current and published at epoch 1.");
  return {
    verified: true,
    ddlAuthorization: false,
    appliedV4Migrations: expectedMigrations,
    restoreFingerprint: restoreReport.logicalDataFingerprint,
    rawDataFingerprint: sourceRawFingerprint,
    replayEpoch: 1,
    dayCount: firstReplay.dayCount,
    idempotentRetry: true,
  };
}

async function readJson(pathname) {
  return JSON.parse(await readFile(pathname, "utf8"));
}

async function main() {
  const [mode, ...args] = process.argv.slice(2);
  if (mode === "--validate-snapshot") {
    const [snapshotPath, migrationPath, outputPath] = args;
    const snapshot = await readJson(snapshotPath);
    snapshot.migrationDirectories = (await readdir(path.resolve(migrationPath), { withFileTypes: true }))
      .filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
    const migrationRun = await readJson(path.join(path.dirname(snapshotPath), "migration-run.json"));
    const result = assertV4RecoverySnapshot(snapshot, {
      releaseSha: snapshot.releaseSha,
      migrationRun,
      repositoryPath: process.cwd(),
    });
    if (outputPath) await import("node:fs/promises").then(({ writeFile }) => writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 }));
    else process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  if (mode === "--verify-rehearsal") {
    const [inputPath, outputPath] = args;
    const result = assertV4ReplayRehearsal(await readJson(inputPath));
    if (outputPath) await import("node:fs/promises").then(({ writeFile }) => writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, { flag: "wx", mode: 0o600 }));
    else process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  throw new Error("Usage: production-v4-recovery.mjs --validate-snapshot <snapshot.json> <migration-dir> [result.json] | --verify-rehearsal <input.json> [result.json]");
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
