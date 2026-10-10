import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ACTIVE_ENERGY_UNIFIED_MANIFEST, getProductionMigrationManifest } from "./production-migration-manifests.mjs";
import { canonicalSha256, assertSignedAuthorizationRequired, verifyAuthorizationEnvelope } from "./production-migration-authorization.mjs";
import { assertProductionDatabaseIdentityMatches, evaluateProductionPreflight, verifyPostflightMatchesRestore } from "./production-migration-preflight.mjs";
import { assertFreshWriterDrain } from "./production-writer-drain.mjs";
import { assertPinnedOwnerId } from "./github-owner-identity.mjs";
import { assertForwardResumeCurrentSnapshot } from "./production-forward-resume.mjs";

async function readJson(filePath) { return JSON.parse(await readFile(filePath, "utf8")); }

function forwardResumeClaims(context) {
  if (!context) return {};
  return {
    executionMode: "forward-resume",
    forwardResumeProofDigest: context.proofDigest,
    forwardResumeSourceRunId: context.sourceRunId,
    forwardResumeSourceRunAttempt: context.sourceRunAttempt,
    forwardResumeSourceSha: context.sourceSha,
    forwardResumeMarkerDigest: context.markerDigest,
    forwardResumeSourceAuthorizationId: context.sourceAuthorizationId,
    forwardResumeSourcePreflightResultDigest: context.sourcePreflightResultDigest,
    forwardResumeFailureLogDigest: context.failureLogDigest,
    forwardResumeGuardRuntimeDigest: context.sourceGuardRuntimeDigest,
  };
}

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

export function verifyFinalMigrationAuthorization({ envelope, preflightResult, evidence, restoreResult, artifactMetadata, liveReport, liveMainSha, releaseSha, manifestId, allowlist, currentWorkflowId, currentWorkflowRunId, currentWorkflowRunAttempt, now = Date.now() }) {
  assertSignedAuthorizationRequired({ envelope, confirmation: process.env.CONFIRM_PRODUCTION_MIGRATE });
  const manifest = getProductionMigrationManifest(manifestId);
  if (releaseSha !== liveMainSha) throw new Error("Migration blocked: release SHA is not the freshly fetched canonical main tip.");
  if (evidence?.verified !== true || evidence.repository !== "krustallik/body-model"
    || evidence.releaseSha !== releaseSha || evidence.manifestId !== manifest.id) {
    throw new Error("Migration blocked: preflight evidence does not match the release and reviewed manifest.");
  }
  if (preflightResult?.readyForOwnerAuthorization !== true || preflightResult.manifestId !== manifest.id) {
    throw new Error("Migration blocked: signed preflight result is missing or not ready.");
  }
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
  assertProductionDatabaseIdentityMatches(preflightResult?.identity, liveReport?.identity);
  if (canonicalSha256(preflightResult.identity) !== evidence.productionIdentityDigest) throw new Error("Migration blocked: signed preflight identity digest is inconsistent.");
  if (canonicalSha256(liveReport?.identity) !== evidence.productionIdentityDigest) throw new Error("Migration blocked: production identity changed after preflight.");
  const directories = manifestTreeNames(manifest);
  const readiness = evaluateProductionPreflight(liveReport, directories, manifest.id);
  if (!readiness.readyForOwnerAuthorization) throw new Error("Migration blocked by final live readiness: " + readiness.blockers.join(" "));
  assertFreshWriterDrain(liveReport, { now, maxAgeMs: 30_000 });
  const forwardContext = preflightResult.forwardResume ?? null;
  if (forwardContext) {
    assertForwardResumeCurrentSnapshot(forwardContext, {
      preflightResult,
      liveReport,
      evidence,
      restoreResult,
      targetSha: releaseSha,
      preflightRunId: evidence.workflowRunId,
      preflightRunAttempt: Number(evidence.workflowRunAttempt),
    });
  }
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
      productionIdentityDigest: canonicalSha256(liveReport.identity),
      writerDrainDigest: evidence.writerDrainDigest,
      writerTopologyDigest: evidence.writerTopologyDigest,
      snapshotDataFingerprint,
      ...forwardResumeClaims(forwardContext),
    },
  });
  if ((verified.payload.executionMode === "forward-resume") !== Boolean(forwardContext)) {
    throw new Error("Migration blocked: signed execution mode differs from the verified preflight forward-resume context.");
  }
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
    verifiedAt: new Date(now).toISOString(),
  };
  if (forwardContext) Object.assign(receipt, forwardResumeClaims(forwardContext));
  return receipt;
}

export function verifyFinalGuardReceipt({ receipt, envelope, allowlist, currentWorkflowId, currentWorkflowRunId, currentWorkflowRunAttempt, currentMainSha, releaseSha, now = Date.now() }) {
  const isForwardResume = receipt?.executionMode === "forward-resume";
  const fields = [
    "schemaVersion", "ready", "authorizationId", "manifestId", "releaseSha", "currentMainSha", "workflowId",
    "workflowRunId", "workflowRunAttempt", "actorId", "pending", "pendingSetDigest", "preflightRunId", "preflightRunAttempt",
    "preflightResultDigest", "backupArtifactId", "backupArtifactDigest", "backupSnapshotAt", "restoreResultDigest",
    "productionIdentityDigest", "preflightWriterDrainDigest", "preflightWriterTopologyDigest",
    "finalWriterDrainDigest", "finalWriterTopologyDigest", "finalWriterDrainObservedAt", "finalTopologyObservedAt",
    "postSchemaDigest", "snapshotDataFingerprint", "verifiedAt",
    ...(isForwardResume ? ["executionMode", "forwardResumeProofDigest", "forwardResumeSourceRunId", "forwardResumeSourceRunAttempt",
      "forwardResumeSourceSha", "forwardResumeMarkerDigest", "forwardResumeSourceAuthorizationId",
      "forwardResumeSourcePreflightResultDigest", "forwardResumeFailureLogDigest", "forwardResumeGuardRuntimeDigest"] : []),
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
    || !/^[a-f0-9]{64}$/.test(String(receipt.snapshotDataFingerprint ?? ""))) {
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
      ...(isForwardResume ? forwardResumeClaims({
        proofDigest: receipt.forwardResumeProofDigest,
        sourceRunId: receipt.forwardResumeSourceRunId,
        sourceRunAttempt: receipt.forwardResumeSourceRunAttempt,
        sourceSha: receipt.forwardResumeSourceSha,
        markerDigest: receipt.forwardResumeMarkerDigest,
        sourceAuthorizationId: receipt.forwardResumeSourceAuthorizationId,
        sourcePreflightResultDigest: receipt.forwardResumeSourcePreflightResultDigest,
        failureLogDigest: receipt.forwardResumeFailureLogDigest,
        sourceGuardRuntimeDigest: receipt.forwardResumeGuardRuntimeDigest,
      }) : {}),
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
    ...(isForwardResume ? forwardResumeClaims({
      proofDigest: payload.forwardResumeProofDigest,
      sourceRunId: payload.forwardResumeSourceRunId,
      sourceRunAttempt: payload.forwardResumeSourceRunAttempt,
      sourceSha: payload.forwardResumeSourceSha,
      markerDigest: payload.forwardResumeMarkerDigest,
      sourceAuthorizationId: payload.forwardResumeSourceAuthorizationId,
      sourcePreflightResultDigest: payload.forwardResumeSourcePreflightResultDigest,
      failureLogDigest: payload.forwardResumeFailureLogDigest,
      sourceGuardRuntimeDigest: payload.forwardResumeGuardRuntimeDigest,
    }) : {}),
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
  if (!Array.isArray(parsed) || !parsed.includes(manifest.migrations[0].name)) throw new Error("Migration blocked: release migration tree does not match the manifest.");
  return parsed;
}

export function verifyPostflightResult({ report, restoreResult, migrationDirectories, manifestId = ACTIVE_ENERGY_UNIFIED_MANIFEST.id }) {
  return verifyPostflightMatchesRestore(report, restoreResult, migrationDirectories, manifestId);
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
    const migrationDirectories = (await readdir(path.join(repository, "prisma/migrations"), { withFileTypes: true }))
      .filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    process.env.BODYCAST_MIGRATION_DIRECTORIES = JSON.stringify(migrationDirectories);
    const result = verifyFinalMigrationAuthorization({
      envelope, preflightResult, evidence, restoreResult, artifactMetadata, liveReport,
      liveMainSha: value("--main-sha"), releaseSha: value("--release-sha"),
      manifestId: value("--manifest"), allowlist,
      currentWorkflowId: value("--current-workflow-id"),
      currentWorkflowRunId: value("--current-workflow-run-id"),
      currentWorkflowRunAttempt: Number(value("--current-workflow-run-attempt")),
    });
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return;
  }
  if (mode === "--after-ddl") {
    const required = ["--report", "--restore", "--manifest", "--repository"];
    for (const key of required) if (!value(key)) throw new Error("Missing required option " + key + ".");
    const [report, restoreResult] = await Promise.all([readJson(value("--report")), readJson(value("--restore"))]);
    const repository = path.resolve(value("--repository"));
    const migrationDirectories = (await readdir(path.join(repository, "prisma/migrations"), { withFileTypes: true }))
      .filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    const result = verifyPostflightResult({ report, restoreResult, migrationDirectories, manifestId: value("--manifest") });
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    if (!result.ready) process.exitCode = 1;
    return;
  }
  throw new Error("Usage: production-migration-final-guard.mjs --before-ddl|--after-ddl ...");
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => { process.stderr.write(error.message + "\n"); process.exitCode = 1; });
}
