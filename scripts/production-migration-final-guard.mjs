import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ACTIVE_ENERGY_UNIFIED_MANIFEST, getProductionMigrationManifest } from "./production-migration-manifests.mjs";
import { canonicalSha256, assertSignedAuthorizationRequired, verifyAuthorizationEnvelope } from "./production-migration-authorization.mjs";
import { assertPreMaintenanceStorageHeadroom, assertProductionDatabaseIdentityMatches, evaluateProductionPreflight, verifyPostflightMatchesRestore } from "./production-migration-preflight.mjs";
import { readPackagedMigrationFiles } from "./production-migration-integrity.mjs";
import { assertFreshWriterDrain } from "./production-writer-drain.mjs";
import { matchesPostgresDatabaseIdentityDigest } from "./postgres-database-identity.mjs";
import { assertPinnedOwnerId } from "./github-owner-identity.mjs";

async function readJson(filePath) { return JSON.parse(await readFile(filePath, "utf8")); }

export const SNAPSHOT_READABILITY_TABLES = Object.freeze([
  "Workout", "Profile", "ModelEpisode", "PhysiologyV7Lifecycle", "DailyModelState", "StrengthDiarySession", "ExerciseCatalog",
]);

export function assertLiveDataMatchesBackupReadability(backupReadability, liveReadability) {
  const mismatches = [];
  for (const table of SNAPSHOT_READABILITY_TABLES) {
    const backupCount = backupReadability?.[table]?.rowCount;
    const liveCount = liveReadability?.[table]?.rowCount;
    const valid = Number.isSafeInteger(backupCount) && backupCount >= 0
      && Number.isSafeInteger(liveCount) && liveCount >= 0;
    if (!valid || backupCount !== liveCount) mismatches.push({ id: `snapshot-row-count:${table}`, passed: false });
  }
  if (mismatches.length) {
    throw new Error("Migration blocked: current live data readability differs from the newly restored backup or is unavailable; checks=" + JSON.stringify(mismatches));
  }
  return true;
}

export function assertLiveDataMatchesBackupFingerprint(preflightResult, evidence, restoreResult, liveReport) {
  const expected = preflightResult?.logicalDataFingerprint;
  const restore = restoreResult?.logicalDataFingerprint;
  const attested = evidence?.logicalDataFingerprint;
  const actual = liveReport?.logicalDataFingerprint;
  if (![expected, restore, attested, actual].every((value) => /^[a-f0-9]{64}$/.test(String(value ?? "")))
    || new Set([expected, restore, attested, actual]).size !== 1) {
    throw new Error("Migration blocked: complete logical database contents or sequence state differ from the freshly restored encrypted backup.");
  }
  return expected;
}

export function assertAuthSourceProjectionMatchesRestore({ manifestId, restoreResult, liveFingerprint }) {
  if (manifestId !== "auth-multiuser-v1") return true;
  const expected = restoreResult?.authMultiuserSourceDataFingerprint;
  if (restoreResult?.authMultiuserSourceDataProjection !== "bodycast-auth-multiuser-source-input-fingerprint-v2"
    || !/^[a-f0-9]{64}$/.test(String(expected ?? ""))
    || !/^[a-f0-9]{64}$/.test(String(liveFingerprint ?? ""))
    || liveFingerprint !== expected) {
    throw new Error("Migration blocked: live Auth source-input projection does not match the unchanged isolated migration rehearsal.");
  }
  return true;
}

export function sourceReleaseMarkerDigest(preflightResult, manifestId) {
  const witness = preflightResult?.sourceReleaseMarker;
  if (manifestId !== "training-session-context-v1") {
    if (witness !== undefined) throw new Error("Migration blocked: a source release-marker witness is not valid for this manifest.");
    return null;
  }
  if (witness === undefined) return null;
  const fields = ["schemaVersion", "manifestId", "migrationOriginSha", "deploySha", "state", "workflowRunId",
    "workflowRunAttempt", "authorizationId", "lineageDigest", "spawnState", "sourceMarkerDigest",
    "compatibilityDigest", "digest", "liveAppSha"].sort();
  if (!witness || typeof witness !== "object" || Array.isArray(witness)
    || JSON.stringify(Object.keys(witness).sort()) !== JSON.stringify(fields)
    || witness.schemaVersion !== 3 || witness.manifestId !== "auth-multiuser-v1"
    || witness.migrationOriginSha !== "18e67d53856af1f4742bbe9626abbd005b70e8bf"
    || witness.state !== "app-ready" || witness.deploySha !== witness.liveAppSha
    || !/^[a-f0-9]{40}$/.test(String(witness.deploySha ?? ""))
    || !/^[a-f0-9]{64}$/.test(String(witness.digest ?? ""))
    || !/^[a-f0-9]{64}$/.test(String(witness.compatibilityDigest ?? ""))
    || !/^[a-f0-9]{64}$/.test(String(witness.sourceMarkerDigest ?? ""))) {
    throw new Error("Migration blocked: Training preflight lacks the exact retained Auth app-ready marker witness.");
  }
  return witness.digest;
}

export function verifyFinalMigrationAuthorization({ envelope, preflightResult, evidence, restoreResult, artifactMetadata, liveReport, liveMainSha, releaseSha, manifestId, allowlist, migrationChecksums, currentWorkflowId, currentWorkflowRunId, currentWorkflowRunAttempt, now = Date.now() }) {
  assertSignedAuthorizationRequired({ envelope, confirmation: process.env.CONFIRM_PRODUCTION_MIGRATE });
  const manifest = getProductionMigrationManifest(manifestId);
  assertPreMaintenanceStorageHeadroom(preflightResult?.preMaintenanceStorageHeadroom);
  if (releaseSha !== liveMainSha) throw new Error("Migration blocked: release SHA is not the freshly fetched canonical main tip.");
  if (evidence?.verified !== true || evidence.repository !== "krustallik/body-model"
    || evidence.releaseSha !== releaseSha || evidence.manifestId !== manifest.id) {
    throw new Error("Migration blocked: preflight evidence does not match the release and reviewed manifest.");
  }
  if (preflightResult?.readyForOwnerAuthorization !== true || preflightResult.manifestId !== manifest.id) {
    throw new Error("Migration blocked: signed preflight result is missing or not ready.");
  }
  const previousReleaseMarkerDigest = sourceReleaseMarkerDigest(preflightResult, manifest.id);
  if (canonicalSha256(preflightResult) !== evidence.preflightResultDigest) throw new Error("Migration blocked: preflight result digest differs from verified evidence.");
  if (canonicalSha256(preflightResult?.writerDrain) !== evidence.writerDrainDigest
    || canonicalSha256(preflightResult?.writerDrain?.topology) !== evidence.writerTopologyDigest
    || preflightResult?.writerDrainReady !== true) {
    throw new Error("Migration blocked: signed preflight writer-drain/topology evidence is inconsistent.");
  }
  if (canonicalSha256(restoreResult) !== evidence.restoreResultDigest || restoreResult?.verified !== true || restoreResult?.postflightReady !== true) {
    throw new Error("Migration blocked: isolated restore or disposable migration rehearsal is not verified.");
  }
  assertLiveDataMatchesBackupReadability(restoreResult.readability, liveReport?.readability);
  const snapshotDataFingerprint = assertLiveDataMatchesBackupFingerprint(preflightResult, evidence, restoreResult, liveReport);
  assertAuthSourceProjectionMatchesRestore({
    manifestId: manifest.id,
    restoreResult,
    liveFingerprint: process.env.BODYCAST_AUTH_SOURCE_DATA_FINGERPRINT,
  });
  assertProductionDatabaseIdentityMatches(preflightResult?.identity, liveReport?.identity);
  if (canonicalSha256(preflightResult.identity) !== evidence.productionIdentityDigest) throw new Error("Migration blocked: signed preflight identity digest is inconsistent.");
  if (!matchesPostgresDatabaseIdentityDigest(liveReport?.identity, evidence.productionIdentityDigest)) throw new Error("Migration blocked: production identity changed after preflight.");
  const directories = manifestTreeNames(manifest);
  const readiness = evaluateProductionPreflight(liveReport, directories, manifest.id, { migrationChecksums });
  if (!readiness.readyForOwnerAuthorization) throw new Error("Migration blocked by final live readiness: " + readiness.blockers.join(" "));
  assertFreshWriterDrain(liveReport, { now, maxAgeMs: 30_000 });
  const pending = [...readiness.pending].sort();
  const verified = verifyAuthorizationEnvelope(envelope, {
    allowlist,
    now,
    requireTrustedActorId: false,
    live: {
      repository: "krustallik/body-model",
      workflowId: String(currentWorkflowId ?? ""),
      workflowPath: ".github/workflows/production-migrate.yml",
      workflowRunId: String(currentWorkflowRunId ?? ""),
      workflowRunAttempt: Number(currentWorkflowRunAttempt),
      releaseSha,
      currentMainSha: liveMainSha,
      manifestId: manifest.id,
      pendingMigrationNames: pending,
      pendingSetDigest: canonicalSha256(pending),
      preflightRunId: evidence.workflowRunId,
      preflightRunAttempt: evidence.workflowRunAttempt,
      preflightResultDigest: canonicalSha256(preflightResult),
      backupSnapshotAt: evidence.backupSnapshotAt,
      restoreResultDigest: canonicalSha256(restoreResult),
      // The matcher above binds this signed historical digest to the validated
      // current bare-address identity. Keep the signed projection for the
      // envelope comparison so existing /32 preflight authorizations remain
      // verifiable without changing their claims.
      productionIdentityDigest: evidence.productionIdentityDigest,
      writerDrainDigest: evidence.writerDrainDigest,
      writerTopologyDigest: evidence.writerTopologyDigest,
      snapshotDataFingerprint,
      ...(manifest.id === "auth-multiuser-v1" ? { profileOneOwnershipBackfillAuthorized: true } : {}),
    },
  });
  assertPinnedOwnerId(verified.payload.actorId, "Signed migration owner actor ID");
  if (String(artifactMetadata?.id) !== verified.payload.backupArtifactId
    || String(artifactMetadata?.digest).replace(/^sha256:/, "") !== verified.payload.backupArtifactDigest
    || String(artifactMetadata?.workflowRunId) !== verified.payload.preflightRunId
    || Number(artifactMetadata?.workflowRunAttempt) !== Number(verified.payload.preflightRunAttempt)
    || String(artifactMetadata?.authorizationWorkflowId) !== verified.payload.workflowId
    || String(artifactMetadata?.authorizationRunId) !== verified.payload.workflowRunId
    || Number(artifactMetadata?.authorizationRunAttempt) !== Number(verified.payload.workflowRunAttempt)
    || String(currentWorkflowId) !== verified.payload.workflowId
    || String(currentWorkflowRunId) !== verified.payload.workflowRunId
    || Number(currentWorkflowRunAttempt) !== Number(verified.payload.workflowRunAttempt)
    || String(evidence.workflowRunId) !== verified.payload.preflightRunId
    || Number(evidence.workflowRunAttempt) !== Number(verified.payload.preflightRunAttempt)) {
    throw new Error("Migration blocked: artifact id/digest/run provenance differs from the signed authorization.");
  }
  const receipt = {
    schemaVersion: 1,
    ready: true,
    authorizationId: verified.authorizationId,
    manifestId: manifest.id,
    releaseSha,
    currentMainSha: liveMainSha,
    workflowId: verified.payload.workflowId,
    workflowRunId: verified.payload.workflowRunId,
    workflowRunAttempt: verified.payload.workflowRunAttempt,
    actorId: verified.payload.actorId,
    pending,
    pendingSetDigest: verified.payload.pendingSetDigest,
    preflightRunId: verified.payload.preflightRunId,
    preflightRunAttempt: verified.payload.preflightRunAttempt,
    preflightResultDigest: verified.payload.preflightResultDigest,
    backupArtifactId: verified.payload.backupArtifactId,
    backupArtifactDigest: verified.payload.backupArtifactDigest,
    backupSnapshotAt: verified.payload.backupSnapshotAt,
    restoreResultDigest: verified.payload.restoreResultDigest,
    productionIdentityDigest: verified.payload.productionIdentityDigest,
    preflightWriterDrainDigest: verified.payload.writerDrainDigest,
    preflightWriterTopologyDigest: verified.payload.writerTopologyDigest,
    finalWriterDrainDigest: canonicalSha256(liveReport.writerDrain),
    finalWriterTopologyDigest: canonicalSha256(liveReport.writerDrain.topology),
    finalWriterDrainObservedAt: liveReport.writerDrain.observedAt,
    finalTopologyObservedAt: liveReport.writerDrain.topology.observedAt,
    postSchemaDigest: restoreResult.postSchemaDigest,
    snapshotDataFingerprint,
    ...(previousReleaseMarkerDigest ? { sourceReleaseMarkerDigest: previousReleaseMarkerDigest } : {}),
    verifiedAt: new Date(now).toISOString(),
  };
  return receipt;
}

export function verifyFinalGuardReceipt({ receipt, envelope, allowlist, currentWorkflowId, currentWorkflowRunId, currentWorkflowRunAttempt, currentMainSha, releaseSha, now = Date.now() }) {
  const fields = [
    "schemaVersion", "ready", "authorizationId", "manifestId", "releaseSha", "currentMainSha", "workflowId",
    "workflowRunId", "workflowRunAttempt", "actorId", "pending", "pendingSetDigest", "preflightRunId", "preflightRunAttempt",
    "preflightResultDigest", "backupArtifactId", "backupArtifactDigest", "backupSnapshotAt", "restoreResultDigest",
    "productionIdentityDigest", "preflightWriterDrainDigest", "preflightWriterTopologyDigest",
    "finalWriterDrainDigest", "finalWriterTopologyDigest", "finalWriterDrainObservedAt", "finalTopologyObservedAt",
    "postSchemaDigest", "snapshotDataFingerprint", "verifiedAt",
    ...(receipt?.sourceReleaseMarkerDigest !== undefined ? ["sourceReleaseMarkerDigest"] : []),
  ].sort();
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)
    || JSON.stringify(Object.keys(receipt).sort()) !== JSON.stringify(fields)) {
    throw new Error("Migration blocked: final guard receipt is missing, malformed, or has unsupported fields.");
  }
  if (receipt.schemaVersion !== 1 || receipt.ready !== true || !Array.isArray(receipt.pending)
    || [...receipt.pending].sort().join("\0") !== receipt.pending.join("\0")
    || !/^[a-f0-9]{64}$/.test(String(receipt.postSchemaDigest ?? ""))
    || !/^[a-f0-9]{64}$/.test(String(receipt.preflightWriterDrainDigest ?? ""))
    || !/^[a-f0-9]{64}$/.test(String(receipt.preflightWriterTopologyDigest ?? ""))
    || !/^[a-f0-9]{64}$/.test(String(receipt.finalWriterDrainDigest ?? ""))
    || !/^[a-f0-9]{64}$/.test(String(receipt.finalWriterTopologyDigest ?? ""))
    || !/^[a-f0-9]{64}$/.test(String(receipt.snapshotDataFingerprint ?? ""))
    || (receipt.sourceReleaseMarkerDigest !== undefined
      && !/^[a-f0-9]{64}$/.test(String(receipt.sourceReleaseMarkerDigest)))) {
    throw new Error("Migration blocked: final guard receipt is incomplete or not ready.");
  }
  for (const [label, value] of [["writer-drain", receipt.finalWriterDrainObservedAt], ["topology", receipt.finalTopologyObservedAt]]) {
    const ageMs = now - Date.parse(value);
    if (!Number.isFinite(ageMs) || ageMs < -60_000 || ageMs > 5 * 60_000) {
      throw new Error(`Migration blocked: final ${label} evidence is stale or from the future.`);
    }
  }
  const verified = verifyAuthorizationEnvelope(envelope, {
    allowlist,
    now,
    requireTrustedActorId: false,
    live: {
      repository: "krustallik/body-model",
      workflowId: String(currentWorkflowId ?? ""),
      workflowPath: ".github/workflows/production-migrate.yml",
      workflowRunId: String(currentWorkflowRunId ?? ""),
      workflowRunAttempt: Number(currentWorkflowRunAttempt),
      releaseSha,
      currentMainSha,
      manifestId: receipt.manifestId,
      pendingMigrationNames: receipt.pending,
      pendingSetDigest: receipt.pendingSetDigest,
      preflightRunId: receipt.preflightRunId,
      preflightRunAttempt: receipt.preflightRunAttempt,
      preflightResultDigest: receipt.preflightResultDigest,
      backupArtifactId: receipt.backupArtifactId,
      backupArtifactDigest: receipt.backupArtifactDigest,
      backupSnapshotAt: receipt.backupSnapshotAt,
      restoreResultDigest: receipt.restoreResultDigest,
      productionIdentityDigest: receipt.productionIdentityDigest,
      writerDrainDigest: receipt.preflightWriterDrainDigest,
      writerTopologyDigest: receipt.preflightWriterTopologyDigest,
      snapshotDataFingerprint: receipt.snapshotDataFingerprint,
    },
  });
  const payload = verified.payload;
  const receiptClaims = {
    authorizationId: payload.authorizationId,
    manifestId: payload.manifestId,
    releaseSha: payload.releaseSha,
    currentMainSha: payload.currentMainSha,
    workflowId: payload.workflowId,
    workflowRunId: payload.workflowRunId,
    workflowRunAttempt: payload.workflowRunAttempt,
    actorId: payload.actorId,
    pending: payload.pendingMigrationNames,
    pendingSetDigest: payload.pendingSetDigest,
    preflightRunId: payload.preflightRunId,
    preflightRunAttempt: payload.preflightRunAttempt,
    preflightResultDigest: payload.preflightResultDigest,
    backupArtifactId: payload.backupArtifactId,
    backupArtifactDigest: payload.backupArtifactDigest,
    backupSnapshotAt: payload.backupSnapshotAt,
    restoreResultDigest: payload.restoreResultDigest,
    productionIdentityDigest: payload.productionIdentityDigest,
    preflightWriterDrainDigest: payload.writerDrainDigest,
    preflightWriterTopologyDigest: payload.writerTopologyDigest,
    snapshotDataFingerprint: payload.snapshotDataFingerprint,
  };
  for (const [field, expected] of Object.entries(receiptClaims)) {
    if (JSON.stringify(receipt[field]) !== JSON.stringify(expected)) throw new Error("Migration blocked: final guard receipt differs from signed claim " + field + ".");
  }
  const verifiedAt = Date.parse(receipt.verifiedAt);
  const issuedAt = Date.parse(payload.issuedAt);
  if (!Number.isFinite(verifiedAt) || verifiedAt < issuedAt || verifiedAt > now + 60_000) {
    throw new Error("Migration blocked: final guard receipt timestamp is invalid.");
  }
  return { verified: true, authorizationId: verified.authorizationId, payload, receipt };
}

function manifestTreeNames(manifest) {
  const names = process.env.BODYCAST_MIGRATION_DIRECTORIES;
  if (!names) throw new Error("Migration blocked: full release-tree migration list is unavailable.");
  const parsed = JSON.parse(names);
  if (!Array.isArray(parsed) || !parsed.length
    || parsed.some((name) => typeof name !== "string" || !/^\d{14}_[A-Za-z0-9_]+$/.test(name))
    || new Set(parsed).size !== parsed.length) {
    throw new Error("Migration blocked: release migration tree is missing or malformed.");
  }
  if (manifest.dynamicMigrationSet !== true && !parsed.includes(manifest.migrations[0]?.name)) {
    throw new Error("Migration blocked: release migration tree does not match the manifest.");
  }
  return parsed;
}

export function verifyPostflightResult({ report, restoreResult, migrationDirectories, manifestId = ACTIVE_ENERGY_UNIFIED_MANIFEST.id,
  authSourceDataFingerprint = process.env.BODYCAST_AUTH_SOURCE_DATA_FINGERPRINT, migrationChecksums }) {
  const result = verifyPostflightMatchesRestore(report, restoreResult, migrationDirectories, manifestId, { migrationChecksums });
  if (result.ready) {
    assertAuthSourceProjectionMatchesRestore({ manifestId, restoreResult, liveFingerprint: authSourceDataFingerprint });
  }
  return result;
}

async function main() {
  const [mode, ...args] = process.argv.slice(2);
  const value = (name) => { const index = args.indexOf(name); return index < 0 ? null : args[index + 1]; };
  if (mode === "--before-ddl") {
    const required = ["--envelope", "--preflight", "--evidence", "--restore", "--artifact", "--live-report", "--main-sha", "--release-sha", "--manifest", "--keys", "--repository", "--current-workflow-id", "--current-workflow-run-id", "--current-workflow-run-attempt"];
    for (const key of required) if (!value(key)) throw new Error("Missing required option " + key + ".");
    const [envelope, preflightResult, evidence, restoreResult, artifactMetadata, liveReport, allowlist] = await Promise.all([
      readFile(value("--envelope"), "utf8").then((s) => s.trimEnd()), readJson(value("--preflight")), readJson(value("--evidence")),
      readJson(value("--restore")), readJson(value("--artifact")), readJson(value("--live-report")), readJson(value("--keys")),
    ]);
    const repository = path.resolve(value("--repository"));
    const manifest = getProductionMigrationManifest(value("--manifest"));
    const migrationFiles = manifest.dynamicMigrationSet === true
      ? await readPackagedMigrationFiles(repository, preflightResult.blobIntegrity, preflightResult.migrationLockSha256)
      : null;
    const migrationDirectories = migrationFiles?.map(({ name }) => name)
      ?? (await readdir(path.join(repository, "prisma/migrations"), { withFileTypes: true }))
        .filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    const migrationChecksums = migrationFiles
      ? Object.fromEntries(migrationFiles.map(({ name, sha256 }) => [name, sha256]))
      : undefined;
    process.env.BODYCAST_MIGRATION_DIRECTORIES = JSON.stringify(migrationDirectories);
    const result = verifyFinalMigrationAuthorization({
      envelope, preflightResult, evidence, restoreResult, artifactMetadata, liveReport,
      liveMainSha: value("--main-sha"), releaseSha: value("--release-sha"),
      manifestId: value("--manifest"), allowlist, migrationChecksums,
      currentWorkflowId: value("--current-workflow-id"),
      currentWorkflowRunId: value("--current-workflow-run-id"),
      currentWorkflowRunAttempt: Number(value("--current-workflow-run-attempt")),
    });
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return;
  }
  if (mode === "--after-ddl") {
    const required = ["--report", "--restore", "--preflight", "--manifest", "--repository"];
    for (const key of required) if (!value(key)) throw new Error("Missing required option " + key + ".");
    const [report, restoreResult, preflightResult] = await Promise.all([
      readJson(value("--report")), readJson(value("--restore")), readJson(value("--preflight")),
    ]);
    const repository = path.resolve(value("--repository"));
    const manifestId = value("--manifest");
    const manifest = getProductionMigrationManifest(manifestId);
    const migrationFiles = manifest.dynamicMigrationSet === true
      ? await readPackagedMigrationFiles(repository, preflightResult.blobIntegrity, preflightResult.migrationLockSha256)
      : null;
    const migrationDirectories = migrationFiles?.map(({ name }) => name)
      ?? (await readdir(path.join(repository, "prisma/migrations"), { withFileTypes: true }))
        .filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    const migrationChecksums = migrationFiles
      ? Object.fromEntries(migrationFiles.map(({ name, sha256 }) => [name, sha256]))
      : undefined;
    const result = verifyPostflightResult({ report, restoreResult, migrationDirectories, manifestId, migrationChecksums });
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    if (!result.ready) process.exitCode = 1;
    return;
  }
  throw new Error("Usage: production-migration-final-guard.mjs --before-ddl|--after-ddl ...");
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => { process.stderr.write(error.message + "\n"); process.exitCode = 1; });
}
