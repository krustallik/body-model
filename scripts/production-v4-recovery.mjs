import { execFileSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { canonicalSha256, verifyHistoricalMigrationAuthorizationEnvelope } from "./production-migration-authorization.mjs";
import { evaluateProductionPostflight, schemaInventoryDigest } from "./production-migration-preflight.mjs";
import { V4_REPUBLICATION_MANIFEST } from "./production-migration-manifests.mjs";
import { isCanonicalPostgresDatabaseIdentity } from "./postgres-database-identity.mjs";
import { assertPostgresClientCompatibility } from "./postgres-client-versions.mjs";
import { assertFreshWriterDrain } from "./production-writer-drain.mjs";

const DIGEST = /^[a-f0-9]{64}$/;
const SHA = /^[a-f0-9]{40}$/;
const V4_REVISION = "unified-experimental-physiology-state-v4-physical-glycogen-water-2p7-exact-once";
const V4_DDL_RUN_ID = "38447647403";
const V4_DDL_ORIGIN_SHA = "8b4a195e8afb67c0a913d0175a030e01cc665732";
const MIGRATION_WORKFLOW = ".github/workflows/production-migrate.yml";
const PREFLIGHT_WORKFLOW = ".github/workflows/production-migration-preflight.yml";
const V4_HOST_FAILURE_PHASES = Object.freeze({
  remote: new Set(["arguments", "checkout", "git-fetch", "app-health", "backup-host"]),
  cutover: new Set(["arguments", "route-setup", "release-lock-setup", "app-host-validation", "mode-validation", "release-lock", "route-primitives", "backup-host"]),
  backup: new Set([
    "arguments", "release-lock", "migration-run", "repository-main", "release-marker", "maintenance-route",
    "app-identity", "migrator-build", "lifecycle-inspection", "app-stop", "writer-drain",
    "snapshot-invalid-label", "snapshot-before-start", "snapshot-after-start", "snapshot-before-database", "snapshot-before-client-compatibility",
    "snapshot-before-fingerprints", "snapshot-before-writer-and-target", "snapshot-before-database-preflight",
    "snapshot-before-migration-postflight", "snapshot-before-lifecycle", "snapshot-before-snapshot-build", "snapshot-before-schema-validation",
    "snapshot-before-final-route-integrity", "pre-dump-boundary", "pg-dump", "snapshot-after-database",
    "snapshot-after-client-compatibility", "snapshot-after-fingerprints", "snapshot-after-writer-and-target",
    "snapshot-after-database-preflight", "snapshot-after-migration-postflight", "snapshot-after-lifecycle",
    "snapshot-after-snapshot-build", "snapshot-after-schema-validation", "snapshot-after-final-route-integrity",
    "snapshot-boundary-database", "snapshot-boundary-client-compatibility", "snapshot-boundary-fingerprints",
    "snapshot-boundary-writer-and-target", "snapshot-boundary-database-preflight",
    "snapshot-boundary-migration-postflight", "snapshot-boundary-lifecycle", "snapshot-boundary-schema-validation",
    "snapshot-boundary-snapshot-build", "snapshot-boundary-final-route-integrity", "snapshot-output", "backup-stability-check", "app-restart", "app-final-verification", "backup-evidence-output",
  ]),
  recovery: new Set(["app-restart"]),
});

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

/** Return only allowlisted phase codes from private remote stderr; never return raw log text. */
export function summarizeV4HostFailureDiagnostics(stderrText) {
  const found = { remote: [], cutover: [], backup: [], recovery: [] };
  let malformed = false;
  for (const line of String(stderrText ?? "").split(/\r?\n/)) {
    const kind = line.startsWith("BODYCAST_V4_REMOTE_FAILURE ") ? "remote"
      : line.startsWith("BODYCAST_V4_CUTOVER_FAILURE ") ? "cutover"
        : line.startsWith("BODYCAST_V4_BACKUP_FAILURE ") ? "backup"
          : line.startsWith("BODYCAST_V4_BACKUP_RECOVERY_FAILURE ") ? "recovery" : null;
    if (!kind) continue;
    const markerKind = kind === "remote" ? "REMOTE" : kind === "cutover" ? "CUTOVER" : kind === "backup" ? "BACKUP" : "BACKUP_RECOVERY";
    const marker = new RegExp(`^BODYCAST_V4_${markerKind}_FAILURE phase=([a-z-]+) status=([1-9][0-9]{0,2})$`).exec(line);
    const status = marker ? Number(marker[2]) : NaN;
    if (!marker || !V4_HOST_FAILURE_PHASES[kind].has(marker[1]) || status > 255 || found[kind].length > 0) {
      malformed = true;
      continue;
    }
    found[kind].push({ phase: marker[1], status });
  }
  if (malformed) return "diagnostic=ambiguous";
  const parts = [];
  for (const kind of ["backup", "recovery", "cutover", "remote"]) {
    const item = found[kind][0];
    if (item) parts.push(`${kind}=${item.phase}/exit-${item.status}`);
  }
  return parts.length ? parts.join(" ") : "diagnostic=unavailable";
}

function v4LifecycleFingerprint(state, lifecycle) {
  const fields = [
    "profileId", "invalidationGeneration", "productionPublishedGeneration", "productionStaleFromDate",
    "unifiedTargetRevision", "unifiedRolloutEpoch", "unifiedPublishedRolloutEpoch",
    "unifiedPublishedGeneration", "unifiedPublicationBlockedFromDate",
  ];
  const stableLifecycle = Object.fromEntries(fields.map((field) => [field, lifecycle?.[field]]));
  return canonicalSha256({ state, lifecycle: stableLifecycle });
}

export function createV4RecoveryBinding(snapshot) {
  const report = snapshot?.report;
  const lifecycle = snapshot?.v4Lifecycle;
  requireValue(snapshot?.schemaVersion === 1 && snapshot.canonicalMainSha === snapshot.releaseSha
    && SHA.test(String(snapshot.releaseSha ?? "")) && snapshot.manifestId === V4_REPUBLICATION_MANIFEST.id
    && isCanonicalPostgresDatabaseIdentity(report?.identity)
    && DIGEST.test(String(report?.logicalDataFingerprint ?? ""))
    && DIGEST.test(String(snapshot.v4ReplayInputFingerprint ?? ""))
    && DIGEST.test(String(snapshot.v4ReplayStableStateFingerprint ?? ""))
    && snapshot.preDdlReplayInputFingerprint === snapshot.v4ReplayInputFingerprint,
  "Cannot create a V4 recovery binding from incomplete or inconsistent snapshot evidence.");
  const binding = {
    schemaVersion: 1,
    verified: true,
    ddlAuthorization: false,
    releaseSha: snapshot?.releaseSha,
    manifestId: snapshot?.manifestId,
    migrationOriginSha: snapshot?.marker?.migrationOriginSha,
    migrationRunId: snapshot?.marker?.workflowRunId,
    migrationRunAttempt: snapshot?.marker?.workflowRunAttempt,
    databaseContainerId: snapshot?.databaseContainerId,
    databaseImageId: `sha256:${String(snapshot?.databaseImageId ?? "").replace(/^sha256:/, "")}`,
    appImageId: `sha256:${String(snapshot?.appImageId ?? "").replace(/^sha256:/, "")}`,
    markerDigest: snapshot?.markerDigest,
    routeDigest: snapshot?.routeDigest,
    identityDigest: canonicalSha256(report?.identity),
    migrationHistoryDigest: canonicalSha256(report?.migrations),
    schemaDigest: schemaInventoryDigest(report?.objects),
    rawReplayInputFingerprint: snapshot?.v4ReplayInputFingerprint,
    v4ReplayStableStateFingerprint: snapshot?.v4ReplayStableStateFingerprint,
    preDdlReplayInputFingerprint: snapshot?.preDdlReplayInputFingerprint,
    logicalDataFingerprint: report?.logicalDataFingerprint,
    lifecycleState: snapshot?.lifecycleState,
    lifecycleDigest: v4LifecycleFingerprint(snapshot?.lifecycleState, lifecycle),
    pgDumpVersion: snapshot?.pgDumpVersion,
    pgRestoreVersion: snapshot?.pgRestoreVersion,
  };
  const immutable = Object.fromEntries(Object.entries(binding).filter(([key]) =>
    !["logicalDataFingerprint", "v4ReplayStableStateFingerprint", "lifecycleState", "lifecycleDigest"].includes(key)));
  return { ...binding, immutableDigest: canonicalSha256(immutable) };
}

export function assertV4ReplayBoundary(expected, observed, {
  phase,
  expectedReplayStableStateFingerprint,
  expectedReplayLifecycleDigest,
} = {}) {
  const assertBinding = (binding) => {
    const expectedKeys = [
      "schemaVersion", "verified", "ddlAuthorization", "releaseSha", "manifestId", "migrationOriginSha",
      "migrationRunId", "migrationRunAttempt", "databaseContainerId", "databaseImageId", "appImageId",
      "markerDigest", "routeDigest", "identityDigest", "migrationHistoryDigest", "schemaDigest",
      "rawReplayInputFingerprint", "preDdlReplayInputFingerprint", "logicalDataFingerprint", "v4ReplayStableStateFingerprint",
      "lifecycleState", "lifecycleDigest", "pgDumpVersion", "pgRestoreVersion", "immutableDigest",
    ].sort();
    requireValue(binding && JSON.stringify(Object.keys(binding).sort()) === JSON.stringify(expectedKeys)
      && binding.schemaVersion === 1 && binding.verified === true && binding.ddlAuthorization === false
      && SHA.test(String(binding.releaseSha ?? "")) && binding.manifestId === V4_REPUBLICATION_MANIFEST.id
      && SHA.test(String(binding.migrationOriginSha ?? ""))
      && /^[1-9][0-9]*$/.test(String(binding.migrationRunId ?? ""))
      && /^[1-9][0-9]*$/.test(String(binding.migrationRunAttempt ?? ""))
      && /^[a-f0-9]{64}$/.test(String(binding.databaseContainerId ?? ""))
      && [binding.databaseImageId, binding.appImageId].every((value) => /^sha256:[a-f0-9]{64}$/.test(String(value ?? "")))
      && ["markerDigest", "routeDigest", "identityDigest", "migrationHistoryDigest", "schemaDigest",
        "rawReplayInputFingerprint", "preDdlReplayInputFingerprint", "logicalDataFingerprint", "v4ReplayStableStateFingerprint",
        "lifecycleDigest", "immutableDigest"]
        .every((key) => DIGEST.test(String(binding[key] ?? "")))
      && binding.rawReplayInputFingerprint === binding.preDdlReplayInputFingerprint
      && ["v4-replayable", "v4-current"].includes(binding.lifecycleState)
      && typeof binding.pgDumpVersion === "string" && typeof binding.pgRestoreVersion === "string",
    "V4 recovery boundary binding is incomplete, malformed, or has unknown fields.");
    const immutable = Object.fromEntries(Object.entries(binding).filter(([key]) =>
      !["logicalDataFingerprint", "v4ReplayStableStateFingerprint", "lifecycleState", "lifecycleDigest", "immutableDigest"].includes(key)));
    requireValue(canonicalSha256(immutable) === binding.immutableDigest,
      "V4 recovery boundary immutable digest does not match its fields.");
  };
  assertBinding(expected);
  assertBinding(observed);
  requireValue(expected?.schemaVersion === 1 && expected.verified === true && expected.ddlAuthorization === false
    && DIGEST.test(String(expected.immutableDigest ?? "")),
  "Verified V4 backup/rehearsal binding is malformed or authorizes DDL.");
  requireValue(observed?.verified === true && observed.ddlAuthorization === false
    && observed.immutableDigest === expected.immutableDigest,
  "Fresh production V4 replay boundary differs from the verified backup identity, schema, history, route, or raw-data binding.");
  if (phase === "before-replay") {
    requireValue(observed.logicalDataFingerprint === expected.logicalDataFingerprint
      && observed.v4ReplayStableStateFingerprint === expected.v4ReplayStableStateFingerprint
      && observed.lifecycleState === expected.lifecycleState
      && observed.lifecycleDigest === expected.lifecycleDigest,
    "Fresh pre-replay production state differs from the rehearsed backup baseline.");
    return true;
  }
  if (phase === "after-replay") {
    requireValue(DIGEST.test(String(expectedReplayStableStateFingerprint ?? ""))
      && observed.v4ReplayStableStateFingerprint === expectedReplayStableStateFingerprint
      && DIGEST.test(String(expectedReplayLifecycleDigest ?? ""))
      && observed.lifecycleDigest === expectedReplayLifecycleDigest
      && observed.lifecycleState === "v4-current"
      && DIGEST.test(String(observed.lifecycleDigest ?? "")),
    "Fresh post-replay production state differs from the isolated V4 rehearsal result.");
    return true;
  }
  throw new Error("Unknown V4 replay boundary phase.");
}

export function assertPreDdlRecoverySource({
  authorizationEnvelope,
  preflightEvidence,
  preflightResult,
  restoreResult,
  backupArtifactMetadata,
  migrationRun,
  allowlist,
} = {}) {
  requireValue(migrationRun && String(migrationRun.id) === V4_DDL_RUN_ID
    && String(migrationRun.runAttempt) === "1" && migrationRun.actorId === "126446430"
    && migrationRun.workflowId && migrationRun.workflowPath === MIGRATION_WORKFLOW
    && migrationRun.headSha === V4_DDL_ORIGIN_SHA
    && migrationRun.conclusion === "success" && migrationRun.event === "workflow_dispatch",
  "Pre-DDL baseline is not bound to the successful pinned-owner V4 migration run.");
  const verified = verifyHistoricalMigrationAuthorizationEnvelope(authorizationEnvelope, {
    allowlist,
    expected: {
      repository: "krustallik/body-model",
      workflowId: String(migrationRun.workflowId),
      workflowPath: MIGRATION_WORKFLOW,
      workflowRunId: V4_DDL_RUN_ID,
      workflowRunAttempt: 1,
      actorId: "126446430",
      releaseSha: V4_DDL_ORIGIN_SHA,
      currentMainSha: V4_DDL_ORIGIN_SHA,
      manifestId: V4_REPUBLICATION_MANIFEST.id,
    },
  });
  const claims = verified.payload;
  const expectedPending = V4_REPUBLICATION_MANIFEST.migrations.map(({ name }) => name).sort();
  requireValue(JSON.stringify(claims.pendingMigrationNames) === JSON.stringify(expectedPending),
    "Signed DDL authorization does not bind exactly the two reviewed V4 migrations.");
  requireValue(preflightEvidence?.verified === true && preflightEvidence.repository === "krustallik/body-model"
    && preflightEvidence.workflowPath === PREFLIGHT_WORKFLOW
    && String(preflightEvidence.workflowRunId) === claims.preflightRunId
    && Number(preflightEvidence.workflowRunAttempt) === claims.preflightRunAttempt
    && preflightEvidence.releaseSha === claims.releaseSha
    && preflightEvidence.manifestId === claims.manifestId
    && preflightEvidence.preflightResultDigest === claims.preflightResultDigest
    && preflightEvidence.restoreResultDigest === claims.restoreResultDigest
    && preflightEvidence.logicalDataFingerprint === claims.snapshotDataFingerprint,
  "Signed DDL authorization does not match its successful preflight evidence.");
  requireValue(preflightResult?.readyForOwnerAuthorization === true
    && preflightResult.manifestId === claims.manifestId
    && JSON.stringify(preflightResult.pending) === JSON.stringify(expectedPending)
    && canonicalSha256(preflightResult) === claims.preflightResultDigest
    && preflightResult.logicalDataFingerprint === claims.snapshotDataFingerprint,
  "Signed pre-DDL snapshot fingerprint does not match the verified preflight result.");
  requireValue(restoreResult?.verified === true
    && canonicalSha256(restoreResult) === claims.restoreResultDigest
    && restoreResult.logicalDataFingerprint === claims.snapshotDataFingerprint,
  "Signed pre-DDL snapshot fingerprint does not match the verified isolated restore.");
  const expectedBackupName = `bodycast-backup-${claims.releaseSha}-${claims.manifestId}-${claims.preflightRunId}-${claims.preflightRunAttempt}`;
  requireValue(backupArtifactMetadata && String(backupArtifactMetadata.id) === claims.backupArtifactId
    && backupArtifactMetadata.digest === `sha256:${claims.backupArtifactDigest}`
    && backupArtifactMetadata.expired === false
    && backupArtifactMetadata.name === expectedBackupName
    && String(backupArtifactMetadata.workflowRunId) === claims.preflightRunId
    && Number(backupArtifactMetadata.workflowRunAttempt) === claims.preflightRunAttempt
    && backupArtifactMetadata.headSha === claims.releaseSha
    && String(backupArtifactMetadata.authorizationRunId) === claims.workflowRunId
    && Number(backupArtifactMetadata.authorizationRunAttempt) === claims.workflowRunAttempt
    && String(backupArtifactMetadata.authorizationWorkflowId) === claims.workflowId,
  "Signed pre-DDL backup artifact identity or digest does not match the selected owner-authorized preflight.");
  requireValue(DIGEST.test(String(claims.snapshotDataFingerprint ?? "")),
    "Signed pre-DDL logical data fingerprint is malformed.");
  return {
    verified: true,
    ddlAuthorization: false,
    migrationRunId: V4_DDL_RUN_ID,
    migrationRunAttempt: 1,
    migrationOriginSha: claims.releaseSha,
    preflightRunId: claims.preflightRunId,
    preflightRunAttempt: claims.preflightRunAttempt,
    backupArtifactId: claims.backupArtifactId,
    backupArtifactDigest: backupArtifactMetadata.digest,
    backupArtifactName: expectedBackupName,
    preDdlLogicalDataFingerprint: claims.snapshotDataFingerprint,
  };
}

export function assertPreDdlBackupArtifactMetadata(binding, artifact, run) {
  requireValue(binding?.verified === true && binding.ddlAuthorization === false,
    "Pre-DDL backup binding is missing or unexpectedly authorizes DDL.");
  requireValue(run && String(run.id) === binding.preflightRunId
    && Number(run.run_attempt) === binding.preflightRunAttempt
    && String(run.workflow_id) && (run.path ?? "").split("@")[0] === PREFLIGHT_WORKFLOW
    && run.event === "workflow_dispatch" && run.head_branch === "main"
    && run.head_sha === binding.migrationOriginSha && run.status === "completed"
    && run.conclusion === "success" && String(run.actor?.id) === "126446430"
    && run.repository?.full_name === "krustallik/body-model",
  "Pre-DDL backup run metadata is not the exact successful owner-authorized preflight.");
  requireValue(artifact && String(artifact.id) === binding.backupArtifactId
    && artifact.name === binding.backupArtifactName
    && artifact.digest === binding.backupArtifactDigest && artifact.expired === false
    && String(artifact.workflow_run?.id) === binding.preflightRunId
    && artifact.workflow_run?.head_branch === "main"
    && artifact.workflow_run?.head_sha === binding.migrationOriginSha
    && artifact.workflow_run?.repository_id === run.repository?.id,
  "Pre-DDL encrypted backup artifact metadata is missing, expired, or substituted.");
  return true;
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
  requireValue(DIGEST.test(String(snapshot.preDdlReplayInputFingerprint ?? ""))
    && snapshot.preDdlReplayInputFingerprint === snapshot.v4ReplayInputFingerprint,
  "Post-DDL raw data no longer matches the signed pre-DDL encrypted-backup baseline.");
  requireValue(DIGEST.test(String(snapshot.report?.logicalDataFingerprint ?? "")), "Full production data fingerprint is malformed.");
  requireValue(DIGEST.test(String(snapshot.v4ReplayStableStateFingerprint ?? "")), "V4 replay stable-state fingerprint is malformed.");

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
    && Number.isSafeInteger(lifecycle.invalidationGeneration) && lifecycle.invalidationGeneration >= 0
    && Number.isSafeInteger(lifecycle.productionPublishedGeneration)
    && (lifecycle.unifiedPublishedGeneration === null || Number.isSafeInteger(lifecycle.unifiedPublishedGeneration))
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
    v4ReplayStableStateFingerprint: snapshot.v4ReplayStableStateFingerprint,
    lifecycle: { ...lifecycle },
    appImageId: snapshot.appImageId,
    routeDigest: snapshot.routeDigest,
    pgDumpVersion: snapshot.pgDumpVersion,
    pgRestoreVersion: snapshot.pgRestoreVersion,
    recoveryBinding: createV4RecoveryBinding(snapshot),
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
    replayStableStateFingerprint: snapshot.v4ReplayStableStateFingerprint,
    preDdlRawFingerprint: snapshot.preDdlReplayInputFingerprint,
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
  replayStableStateFingerprintBefore,
  replayStableStateFingerprintAfter,
  replayStableStateFingerprintAfterRetry,
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
  requireValue(sourceSnapshot?.preDdlReplayInputFingerprint === sourceRawFingerprint,
    "Production raw replay-source fingerprint differs from the signed pre-DDL backup baseline.");
  requireValue(sourceSnapshot?.v4ReplayStableStateFingerprint === replayStableStateFingerprintBefore,
    "Isolated V4 rehearsal output baseline differs from the verified production backup snapshot.");
  requireValue(restoreReport?.v4ReplayStableStateFingerprint === replayStableStateFingerprintBefore,
    "Restored V4 replay stable-state baseline differs from the verified encrypted backup snapshot.");
  const rawFingerprints = [sourceRawFingerprint, restoredRawFingerprintBefore, restoredRawFingerprintAfter, restoredRawFingerprintAfterRetry];
  requireValue(rawFingerprints.every((fingerprint) => DIGEST.test(String(fingerprint ?? "")) && fingerprint === sourceRawFingerprint),
    "Raw replay-source fingerprint changed during V4 rehearsal.");
  requireValue(DIGEST.test(String(replayStableStateFingerprintBefore ?? ""))
    && DIGEST.test(String(replayStableStateFingerprintAfter ?? ""))
    && replayStableStateFingerprintAfter !== replayStableStateFingerprintBefore
    && replayStableStateFingerprintAfterRetry === replayStableStateFingerprintAfter,
  "V4 model stable-state fingerprint or retry idempotency fingerprint is invalid.");
  requireValue(DIGEST.test(String(fullFingerprintBefore ?? ""))
    && DIGEST.test(String(fullFingerprintAfter ?? ""))
    && fullFingerprintAfter !== fullFingerprintBefore
    && DIGEST.test(String(fullFingerprintAfterRetry ?? "")),
  "V4 rehearsal full data fingerprints are invalid.");
  requireValue(firstReplay?.rolloutEpoch === 1 && Number.isSafeInteger(firstReplay?.dayCount) && firstReplay.dayCount > 0
    && retryReplay?.rolloutEpoch === 1 && retryReplay.dayCount === firstReplay.dayCount,
  "Isolated epoch-1 replay or idempotent retry did not complete the same history range.");
  requireValue(lifecycleAfter?.profileId === 1 && lifecycleAfter?.unifiedTargetRevision === V4_REVISION
    && Number.isSafeInteger(lifecycleAfter.invalidationGeneration) && lifecycleAfter.invalidationGeneration >= 0
    && Number.isSafeInteger(lifecycleAfter.productionPublishedGeneration)
    && Number.isSafeInteger(lifecycleAfter.unifiedPublishedGeneration)
    && lifecycleAfter.unifiedRolloutEpoch === 1 && lifecycleAfter.unifiedPublishedRolloutEpoch === 1
    && lifecycleAfter.unifiedPublishedGeneration === lifecycleAfter.invalidationGeneration
    && lifecycleAfter.productionPublishedGeneration === lifecycleAfter.invalidationGeneration
    && lifecycleAfter.productionStaleFromDate === null && lifecycleAfter.unifiedPublicationBlockedFromDate === null,
  "Isolated V4 replay lifecycle is not current and published at epoch 1.");
  const replayLifecycleDigest = v4LifecycleFingerprint("v4-current", lifecycleAfter);
  return {
    verified: true,
    ddlAuthorization: false,
    appliedV4Migrations: expectedMigrations,
    restoreFingerprint: restoreReport.logicalDataFingerprint,
    rawDataFingerprint: sourceRawFingerprint,
    replayEpoch: 1,
    dayCount: firstReplay.dayCount,
    idempotentRetry: true,
    replayStableStateFingerprintAfter,
    replayLifecycleDigest,
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
  if (mode === "--assert-replay-boundary") {
    const [expectedPath, observedPath, phase, expectedReplayStableStateFingerprint, expectedReplayLifecycleDigest] = args;
    const expected = await readJson(expectedPath);
    const observed = await readJson(observedPath);
    assertV4ReplayBoundary(expected, observed.recoveryBinding, {
      phase, expectedReplayStableStateFingerprint, expectedReplayLifecycleDigest,
    });
    process.stdout.write(JSON.stringify({ verified: true, ddlAuthorization: false, phase }) + "\n");
    return;
  }
  if (mode === "--verify-ddl-source") {
    const [bundleDirectory, migrationRunPath, outputPath] = args;
    const [authorizationEnvelope, preflightEvidence, preflightResult, restoreResult, backupArtifactMetadata, migrationRun, allowlist] = await Promise.all([
      readFile(path.join(bundleDirectory, "authorization-envelope.json"), "utf8"),
      readJson(path.join(bundleDirectory, "preflight-evidence.json")),
      readJson(path.join(bundleDirectory, "preflight-result.json")),
      readJson(path.join(bundleDirectory, "restore-result.json")),
      readJson(path.join(bundleDirectory, "artifact-metadata.json")),
      readJson(migrationRunPath),
      readJson(path.resolve("scripts/production-migration-verification-keys.json")),
    ]);
    const binding = assertPreDdlRecoverySource({
      authorizationEnvelope: authorizationEnvelope.trimEnd(), preflightEvidence, preflightResult,
      restoreResult, backupArtifactMetadata, migrationRun, allowlist,
    });
    await import("node:fs/promises").then(({ writeFile }) => writeFile(outputPath,
      `${JSON.stringify(binding, null, 2)}\n`, { flag: "wx", mode: 0o600 }));
    process.stdout.write(JSON.stringify({ verified: true, ddlAuthorization: false, backupArtifactId: binding.backupArtifactId }) + "\n");
    return;
  }
  throw new Error("Usage: production-v4-recovery.mjs --validate-snapshot <snapshot.json> <migration-dir> [result.json] | --verify-rehearsal <input.json> [result.json] | --assert-replay-boundary <expected.json> <observed.json> <before-replay|after-replay> [expected-stable-state-fingerprint] [expected-lifecycle-digest] | --verify-ddl-source <bundle-dir> <migration-run.json> <output.json>");
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
