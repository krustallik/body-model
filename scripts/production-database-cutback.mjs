import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { canonicalSha256, verifyHistoricalMigrationAuthorizationEnvelope } from "./production-migration-authorization.mjs";
import { assertProductionDatabaseIdentityMatches, verifyRestoredBackup } from "./production-migration-preflight.mjs";
import { getProductionMigrationManifest } from "./production-migration-manifests.mjs";
import { assertRollbackAppCanReadProgramlessSessions } from "./production-app-capabilities.mjs";
import { productionAppRuntimeDigest } from "./production-app-runtime-digest.mjs";
import { validateAuthMarkerForTrainingMigrationHandoff } from "./production-schema-deploy-handoff.mjs";
import { isCanonicalPostgresDatabaseIdentity, isHistoricalPostgresDatabaseIdentity,
  matchesPostgresDatabaseIdentityDigest, postgresDatabaseIdentityHostProjection, samePostgresDatabaseIdentity } from "./postgres-database-identity.mjs";
import {
  LEGACY_PREVIOUS_APP_PROVENANCE,
  assertPreviousAppProvenanceBoundToPreflight,
  parsePreviousAppProvenance,
  previousAppDatabaseCompatibilityDigests,
  validatePreviousAppProvenance,
  verifyLegacyPreviousAppRestoredCompatibility,
  verifyPreviousAppCaptureMatchesPreflight,
} from "./production-previous-app-provenance.mjs";

const BUNDLE_FILES = Object.freeze([
  "authorization-envelope.json", "artifact-metadata.json", "preflight-evidence.json",
  "preflight-report.json", "preflight-result.json", "restore-result.json",
]);

export function parseCutbackEvidenceBundle(values) {
  if (!Array.isArray(values) || values.length !== BUNDLE_FILES.length || typeof values[0] !== "string" || values[0].length === 0) {
    fail("cutback evidence bundle does not contain its canonical authorization envelope and complete JSON evidence.");
  }
  const [artifactMetadata, preflightEvidence, preflightReport, preflightResult, restoreResult] = values.slice(1).map((value) => JSON.parse(value));
  return { envelope: values[0], artifactMetadata, preflightEvidence, preflightReport, preflightResult, restoreResult };
}

async function readCutbackEvidenceBundle(directory) {
  const values = await Promise.all(BUNDLE_FILES.map((name) => readFile(path.join(directory, name), "utf8")));
  return parseCutbackEvidenceBundle(values);
}

const READABILITY_TABLES = Object.freeze([
  "Workout", "Profile", "ModelEpisode", "PhysiologyV7Lifecycle", "DailyModelState", "StrengthDiarySession", "ExerciseCatalog",
]);

function fail(message) { throw new Error(`Production database cutback blocked: ${message}`); }

export function verifyCutbackEvidenceBundle({
  envelope, artifactMetadata, preflightEvidence, preflightReport, preflightResult, restoreResult,
  allowlist, expectedFailedRunId, expectedFailedSha, backupFileBytes,
}) {
  const historical = verifyHistoricalMigrationAuthorizationEnvelope(envelope, {
    allowlist,
    expected: { workflowRunId: expectedFailedRunId, releaseSha: expectedFailedSha, currentMainSha: expectedFailedSha },
  });
  const claims = historical.payload;
  if (preflightResult?.readyForOwnerAuthorization !== true || preflightResult?.blockers?.length
    || preflightResult?.pendingExactlyExpected !== true || preflightResult?.manifestId !== claims.manifestId) {
    fail("signed preflight is not an admitted exact-manifest preflight.");
  }
  if (restoreResult?.verified !== true || restoreResult?.postflightReady !== true) {
    fail("the encrypted backup does not have a successful disposable PostgreSQL restore rehearsal.");
  }
  if (canonicalSha256(preflightResult) !== claims.preflightResultDigest
    || canonicalSha256(restoreResult) !== claims.restoreResultDigest
    || canonicalSha256(preflightReport?.identity) !== claims.productionIdentityDigest) {
    fail("source preflight, restore, or PostgreSQL identity differs from the signed migration envelope.");
  }
  if (canonicalSha256(preflightReport?.identity) !== canonicalSha256(preflightResult?.identity)) {
    fail("preflight result identity differs from the original read-only PostgreSQL report.");
  }
  for (const field of ["migrations", "objects", "tables", "programlessSessionCount"]) {
    if (canonicalSha256(preflightReport?.[field]) !== canonicalSha256(preflightResult?.[field])) {
      fail(`preflight result ${field} differs from the original read-only PostgreSQL report.`);
    }
  }
  if (preflightEvidence?.verified !== true || preflightEvidence.releaseSha !== claims.releaseSha
    || preflightEvidence.manifestId !== claims.manifestId
    || String(preflightEvidence.workflowRunId) !== claims.preflightRunId
    || Number(preflightEvidence.workflowRunAttempt) !== claims.preflightRunAttempt
    || preflightEvidence.preflightResultDigest !== claims.preflightResultDigest
    || canonicalSha256(preflightEvidence.previousAppProvenance) !== canonicalSha256(preflightResult.previousAppProvenance)
    || preflightEvidence.restoreResultDigest !== claims.restoreResultDigest
    || preflightEvidence.productionIdentityDigest !== claims.productionIdentityDigest
    || preflightEvidence.backupSnapshotAt !== claims.backupSnapshotAt
    || !/^[a-f0-9]{64}$/.test(String(preflightEvidence.backupFileDigest ?? ""))) {
    fail("preflight evidence is unsigned, stale, incomplete, or not bound to this migration authorization.");
  }
  if (String(artifactMetadata?.id) !== claims.backupArtifactId
    || String(artifactMetadata?.digest ?? "").replace(/^sha256:/, "") !== claims.backupArtifactDigest
    || String(artifactMetadata?.workflowRunId) !== claims.preflightRunId
    || artifactMetadata?.expired === true) {
    fail("encrypted backup artifact identity, digest, run, or retention state differs from the signed claim.");
  }
  if (!Buffer.isBuffer(backupFileBytes)
    || createHash("sha256").update(backupFileBytes).digest("hex") !== preflightEvidence.backupFileDigest) {
    fail("encrypted backup ciphertext digest differs from the signed preflight evidence.");
  }
  if (!Array.isArray(preflightEvidence.pendingMigrationNames)
    || canonicalSha256(preflightEvidence.pendingMigrationNames) !== claims.pendingSetDigest
    || canonicalSha256(preflightResult.pending) !== claims.pendingSetDigest) {
    fail("the signed migration pending set is inconsistent.");
  }
  return { verified: true, claims, backupFileDigest: preflightEvidence.backupFileDigest,
    preflightResultDigest: claims.preflightResultDigest };
}

export function assertCutbackLiveDatabaseIdentity({ claims, liveReport, preflightReport }) {
  const identity = liveReport?.identity;
  const manifest = getProductionMigrationManifest(claims?.manifestId);
  if (!isCanonicalPostgresDatabaseIdentity(identity)
    || !matchesPostgresDatabaseIdentityDigest(identity, claims.productionIdentityDigest)
    || identity.database !== "bodycast" || identity.role !== "bodycast"
    || !String(identity.serverVersion ?? "").startsWith("17.")
    || !Number.isSafeInteger(identity.databaseOid)) {
    fail("live PostgreSQL cluster/database/role identity differs from the exact signed pre-DDL target.");
  }
  if (manifest.cutbackSupported !== true) fail("the exact migration manifest does not support database cutback.");
  if (liveReport?.writerDrain?.activeClientBackends?.length !== 0
    || liveReport?.writerDrain?.topology?.ready !== true) {
    fail("live writer-drain report is not empty and ready.");
  }
  if (!/^[a-f0-9]{64}$/.test(String(preflightReport?.logicalDataFingerprint ?? ""))
    || liveReport.logicalDataFingerprint !== preflightReport.logicalDataFingerprint) {
    fail("live application data changed after the signed pre-DDL backup; database cutback would discard committed data.");
  }
  if (!Number.isSafeInteger(preflightReport?.programlessSessionCount) || preflightReport.programlessSessionCount < 0
    || !Number.isSafeInteger(liveReport?.programlessSessionCount) || liveReport.programlessSessionCount < 0
    || liveReport.programlessSessionCount !== preflightReport.programlessSessionCount) {
    fail("programless-session state is missing or changed after the signed pre-DDL backup.");
  }
  return { verified: true, identityDigest: canonicalSha256(identity) };
}

export function assertCutbackRestoredDatabaseIdentity({ sourceIdentity, restoredReport, expectedDatabase = "bodycast" }) {
  const restored = restoredReport?.identity;
  const comparableSource = sourceIdentity && restored ? { ...sourceIdentity, database: restored.database, databaseOid: restored.databaseOid } : null;
  if (!isHistoricalPostgresDatabaseIdentity(sourceIdentity) || !isCanonicalPostgresDatabaseIdentity(restored)
    || restored.database !== expectedDatabase || restored.role !== "bodycast"
    || !Number.isSafeInteger(restored.databaseOid) || restored.databaseOid < 1
    || !samePostgresDatabaseIdentity(comparableSource, restored)) {
    fail("restored target database is not the exact reviewed PostgreSQL cluster/target role.");
  }
  return { verified: true, restoredDatabaseOid: restored.databaseOid };
}

export function verifyCutbackRestoredState({ sourceReport, restoreResult, restoredReport, readabilityReport }) {
  const base = verifyRestoredBackup(sourceReport, {
    ...restoredReport,
    readability: readabilityReport?.readability,
  });
  const blockers = [...base.blockers];
  if (!Number.isSafeInteger(sourceReport?.programlessSessionCount) || sourceReport.programlessSessionCount < 0
    || !Number.isSafeInteger(restoredReport?.programlessSessionCount) || restoredReport.programlessSessionCount < 0
    || sourceReport.programlessSessionCount !== restoredReport.programlessSessionCount) {
    blockers.push("Restored programless-session state differs from the signed pre-DDL snapshot.");
  }
  const expected = restoreResult?.readability;
  const actual = readabilityReport?.readability;
  for (const table of READABILITY_TABLES) {
    const expectedRows = expected?.[table]?.rowCount;
    const actualRows = actual?.[table]?.rowCount;
    if (!Number.isSafeInteger(expectedRows) || !Number.isSafeInteger(actualRows) || expectedRows !== actualRows) {
      blockers.push(`Restored ${table} row count differs from the independently rehearsed encrypted backup restore.`);
    }
  }
  if (sourceReport?.identity && restoredReport?.identity
    && !samePostgresDatabaseIdentity(sourceReport.identity, restoredReport.identity)) {
    // A staged database has a different OID by design. Only database endpoint
    // fields that identify the PostgreSQL cluster are compared by the host gate.
    const source = postgresDatabaseIdentityHostProjection(sourceReport.identity);
    const restored = postgresDatabaseIdentityHostProjection(restoredReport.identity);
    if (!source || !restored) {
      blockers.push("Restored database identity contains a malformed PostgreSQL endpoint.");
      return { verified: false, blockers, migrationCount: base.migrationCount };
    }
    delete source.databaseOid; delete restored.databaseOid; delete source.database; delete restored.database;
    if (canonicalSha256(source) !== canonicalSha256(restored)) blockers.push("Restored database identity is not on the source PostgreSQL cluster.");
  }
  return { verified: blockers.length === 0, blockers, migrationCount: base.migrationCount };
}

export function verifyPreviousReleaseMigrationCompatibility({ repositoryPath, previousSha, restoredHistory }) {
  if (!/^[a-f0-9]{40}$/.test(String(previousSha ?? "")) || !Array.isArray(restoredHistory)) {
    fail("previous app SHA or restored Prisma migration history is unavailable.");
  }
  let names;
  try {
    names = execFileSync("git", ["ls-tree", "-d", "--name-only", `${previousSha}:prisma/migrations`], {
      cwd: repositoryPath, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    }).trim().split(/\r?\n/).filter(Boolean).sort();
  } catch (error) {
    fail(`previous app source is not present in the production Git object database (${error.message}).`);
  }
  const rows = [...restoredHistory].sort((a, b) => String(a?.name).localeCompare(String(b?.name)));
  if (rows.length !== names.length || rows.some((row, index) => row?.name !== names[index]
    || !row.finishedAt || row.rolledBackAt)) {
    fail("restored Prisma migration history is not the exact completed migration tree of the previous app SHA.");
  }
  let blobs;
  try {
    const requests = names.map((name) => `${previousSha}:prisma/migrations/${name}/migration.sql`).join("\n");
    const output = execFileSync("git", ["cat-file", "--batch"], {
      cwd: repositoryPath, input: `${requests}\n`, maxBuffer: 64 * 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
    });
    blobs = [];
    let offset = 0;
    for (const name of names) {
      const headerEnd = output.indexOf(0x0a, offset);
      const header = headerEnd < 0 ? "" : output.toString("ascii", offset, headerEnd);
      const match = /^[a-f0-9]{40,64} blob ([0-9]+)$/.exec(header);
      const size = match ? Number(match[1]) : NaN;
      const start = headerEnd + 1;
      const end = start + size;
      if (!Number.isSafeInteger(size) || size < 0 || end >= output.length || output[end] !== 0x0a) {
        fail(`previous app migration SQL is unavailable or malformed: ${name}.`);
      }
      blobs.push(output.subarray(start, end));
      offset = end + 1;
    }
    if (offset !== output.length) fail("previous app migration SQL batch contains unexpected trailing output.");
  } catch (error) {
    if (error.message.startsWith("Production database cutback blocked:")) throw error;
    fail(`could not read the previous app migration SQL batch (${error.message}).`);
  }
  for (const [index, row] of rows.entries()) {
    const bytes = blobs[index];
    const checksum = createHash("sha256").update(bytes).digest("hex");
    if (checksum !== row.checksum) fail(`restored migration checksum differs from previous app source: ${row.name}.`);
  }
  return { verified: true, migrationCount: rows.length };
}

export function verifyPreviousAppMigrationCompatibility({
  recordText, targetSha, contextVerified, preflightResultDigest, preflightResult, restoredReport, restoreResult, readabilityReport,
  repositoryPath,
}) {
  const record = parsePreviousAppProvenance(recordText);
  validatePreviousAppProvenance(record, targetSha);
  if (contextVerified !== true || preflightResultDigest !== canonicalSha256(preflightResult)) {
    fail("previous-app compatibility is not bound to the verified owner-signed preflight.");
  }
  try {
    verifyPreviousAppCaptureMatchesPreflight(record, preflightResult, targetSha);
    assertPreviousAppProvenanceBoundToPreflight(record, preflightResult);
  } catch (error) {
    fail(error.message);
  }

  if (!Number.isSafeInteger(preflightResult?.programlessSessionCount) || preflightResult.programlessSessionCount < 0
    || !Number.isSafeInteger(restoredReport?.programlessSessionCount) || restoredReport.programlessSessionCount < 0
    || restoredReport.programlessSessionCount !== preflightResult.programlessSessionCount) {
    fail("restored programless-session state differs from the signed pre-DDL baseline.");
  }
  try {
    assertRollbackAppCanReadProgramlessSessions({ repositoryPath, releaseSha: record.previousSha,
      programlessSessionCount: restoredReport.programlessSessionCount });
  } catch (error) {
    fail(error.message);
  }

  if (record.provenanceKind === LEGACY_PREVIOUS_APP_PROVENANCE) {
    try {
      return verifyLegacyPreviousAppRestoredCompatibility({ record, targetSha, preflightResult, preflightResultDigest,
        contextVerified, restoredReport, restoreResult, readabilityReport });
    } catch (error) {
      fail(error.message);
    }
  }

  const baselineRestore = verifyRestoredBackup(preflightResult, {
    ...restoredReport,
    readability: readabilityReport?.readability,
  });
  if (!baselineRestore.verified) fail(`Restored previous-release schema or history differs from the signed baseline: ${baselineRestore.blockers.join(" ")}`);
  const history = readabilityReport?.migrationHistory ?? readabilityReport?.migrations;
  const sourceDigests = previousAppDatabaseCompatibilityDigests(preflightResult);
  if (!Array.isArray(history)) fail("Restored previous-release Prisma migration history is unavailable.");
  const result = verifyPreviousReleaseMigrationCompatibility({ repositoryPath, previousSha: record.previousSha, restoredHistory: history });
  return { ...result, provenanceKind: record.provenanceKind, schemaDigest: sourceDigests.schemaDigest,
    migrationHistoryDigest: sourceDigests.migrationHistoryDigest };
}

export function verifyPreDdlSourceAppRecovery({
  envelope, artifactMetadata, preflightEvidence, preflightReport, preflightResult, restoreResult, allowlist,
  expectedFailedRunId, expectedFailedSha, backupFileBytes, liveReport, recordText, markerText, repositoryPath,
}) {
  const context = verifyCutbackEvidenceBundle({ envelope, artifactMetadata, preflightEvidence, preflightReport,
    preflightResult, restoreResult, allowlist, expectedFailedRunId, expectedFailedSha, backupFileBytes });
  const manifest = getProductionMigrationManifest(context.claims.manifestId);
  if (manifest.id !== "training-session-context-v1") {
    fail("source-app recovery is only supported for the exact Training migration preflight contract.");
  }

  const sourceMarker = preflightResult?.sourceReleaseMarker;
  if (!sourceMarker || sourceMarker.schemaVersion !== 3 || sourceMarker.manifestId !== "auth-multiuser-v1"
    || sourceMarker.state !== "app-ready" || sourceMarker.deploySha !== sourceMarker.liveAppSha
    || !/^[a-f0-9]{40}$/.test(String(sourceMarker.deploySha ?? ""))
    || !/^[a-f0-9]{64}$/.test(String(sourceMarker.digest ?? "")) || typeof markerText !== "string") {
    fail("the signed preflight does not contain a valid Auth app-ready source marker witness.");
  }
  if (createHash("sha256").update(markerText).digest("hex") !== sourceMarker.digest) {
    fail("the current durable Auth marker bytes differ from the exact marker captured by the signed preflight.");
  }
  let validatedMarker;
  try {
    validatedMarker = validateAuthMarkerForTrainingMigrationHandoff(markerText, {
      liveAppSha: sourceMarker.liveAppSha, repositoryPath,
    });
  } catch (error) {
    fail(`the captured Auth source marker is not compatible with the current repository: ${error.message}`);
  }
  const currentWitness = { ...validatedMarker, liveAppSha: sourceMarker.liveAppSha };
  if (canonicalSha256(currentWitness) !== canonicalSha256(sourceMarker)) {
    fail("the durable Auth marker fields differ from the signed preflight source witness.");
  }

  try { assertProductionDatabaseIdentityMatches(preflightResult.identity, liveReport?.identity); }
  catch (error) { fail(`live PostgreSQL identity differs from the exact pre-DDL source: ${error.message}`); }
  if (canonicalSha256(liveReport?.identity) !== context.claims.productionIdentityDigest
    || liveReport?.logicalDataFingerprint !== preflightResult.logicalDataFingerprint
    || liveReport?.programlessSessionCount !== preflightResult.programlessSessionCount) {
    fail("live database identity, full data/sequence fingerprint, or programless-session count changed after preflight.");
  }
  const baseline = verifyRestoredBackup(preflightReport, liveReport);
  if (!baseline.verified) fail(`live schema, migration history, or readable baseline differs from the signed pre-DDL snapshot: ${baseline.blockers.join(" ")}`);
  if (liveReport?.writerDrain?.activeClientBackends?.length !== 0
    || liveReport?.writerDrain?.topology?.ready !== true
    || !Array.isArray(liveReport?.conflictingLocks) || liveReport.conflictingLocks.length !== 0
    || !Array.isArray(liveReport?.preparedTransactions) || liveReport.preparedTransactions.length !== 0) {
    fail("live production has a database writer, conflicting lock, prepared transaction, or incomplete topology observation.");
  }

  let previousApp;
  let previousRecord;
  try {
    previousRecord = parsePreviousAppProvenance(recordText);
    previousApp = verifyPreviousAppMigrationCompatibility({
      recordText, targetSha: expectedFailedSha, contextVerified: context.verified,
      preflightResultDigest: context.preflightResultDigest, preflightResult,
      restoredReport: liveReport, restoreResult, readabilityReport: liveReport, repositoryPath,
    });
  } catch (error) {
    fail(`the captured previous app is not compatible with the unchanged live database: ${error.message}`);
  }
  if (previousRecord.previousSha !== sourceMarker.deploySha) {
    fail("the immutable previous app SHA differs from the signed Auth marker and live app witness.");
  }
  return {
    verified: true,
    manifestId: manifest.id,
    productionIdentityDigest: context.claims.productionIdentityDigest,
    liveDataFingerprint: liveReport.logicalDataFingerprint,
    sourceMarkerDigest: sourceMarker.digest,
    previousAppSha: previousRecord.previousSha,
    previousImageId: previousRecord.previousImageId,
    migrationCount: previousApp.migrationCount ?? previousApp.restoredMigrationCount,
  };
}

export function verifyRecreatedPreviousAppRuntime({ recordText, container }) {
  const record = parsePreviousAppProvenance(recordText);
  const labels = container?.Config?.Labels;
  const expectedReleaseLabel = record.provenanceKind === LEGACY_PREVIOUS_APP_PROVENANCE
    ? "unknown"
    : record.previousSha;
  if (!container || typeof container !== "object" || Array.isArray(container)
    || !/^[a-f0-9]{64}$/.test(String(container.Id ?? "")) || container.Id === record.previousContainerId
    || container.Image !== record.previousImageId
    || container?.State?.Health?.Status !== "healthy"
    || !labels || typeof labels !== "object" || Array.isArray(labels)
    || labels["org.bodycast.release-sha"] !== expectedReleaseLabel) {
    fail("recreated previous app is not the new healthy container from the exact captured image and provenance mode.");
  }
  let runtimeDigest;
  try { runtimeDigest = productionAppRuntimeDigest(container); }
  catch (error) { fail(`recreated previous app runtime identity is unavailable: ${error.message}`); }
  if (runtimeDigest !== record.previousRuntimeConfigDigest) {
    fail("recreated previous app runtime configuration differs from the exact captured runtime.");
  }
  return { verified: true, provenanceKind: record.provenanceKind, imageId: record.previousImageId,
    containerId: container.Id, health: container.State.Health.Status, runtimeConfigDigest: runtimeDigest };
}

async function readJson(filePath) { return JSON.parse(await readFile(filePath, "utf8")); }

async function main() {
  const [mode, ...args] = process.argv.slice(2);
  if (mode === "--verify-context") {
    const [directory, expectedFailedRunId, expectedFailedSha, backupPath] = args;
    if (!directory || !/^[1-9][0-9]*$/.test(expectedFailedRunId ?? "") || !/^[a-f0-9]{40}$/.test(expectedFailedSha ?? "") || !backupPath) {
      fail("usage: --verify-context <bundle-dir> <failed-run-id> <failed-release-sha> <encrypted-backup-file>.");
    }
    const bundle = await readCutbackEvidenceBundle(directory);
    const backupFileBytes = await readFile(backupPath);
    const allowlist = await readJson(path.resolve("scripts/production-migration-verification-keys.json"));
    const result = verifyCutbackEvidenceBundle({ ...bundle, allowlist, expectedFailedRunId, expectedFailedSha, backupFileBytes });
    process.stdout.write(JSON.stringify({ verified: result.verified, releaseSha: result.claims.releaseSha,
      preflightRunId: result.claims.preflightRunId, preflightRunAttempt: result.claims.preflightRunAttempt,
      backupArtifactId: result.claims.backupArtifactId, backupArtifactDigest: result.claims.backupArtifactDigest,
      backupFileDigest: result.backupFileDigest, productionIdentityDigest: result.claims.productionIdentityDigest,
      preflightResultDigest: result.preflightResultDigest }) + "\n");
    return;
  }
  if (mode === "--verify-pre-ddl-source-app-recovery") {
    const [directory, expectedFailedRunId, expectedFailedSha, backupPath, liveReportPath, capturePath, markerPath] = args;
    if (!directory || !/^[1-9][0-9]*$/.test(expectedFailedRunId ?? "")
      || !/^[a-f0-9]{40}$/.test(expectedFailedSha ?? "") || !backupPath || !liveReportPath || !capturePath || !markerPath) {
      fail("usage: --verify-pre-ddl-source-app-recovery <bundle-dir> <failed-run-id> <failed-sha> <encrypted-backup> <live-report> <capture-record> <source-marker>.");
    }
    const [bundle, backupFileBytes, liveReport, recordText, markerText, allowlist] = await Promise.all([
      readCutbackEvidenceBundle(directory), readFile(backupPath), readJson(liveReportPath), readFile(capturePath, "utf8"), readFile(markerPath, "utf8"),
      readJson(path.resolve("scripts/production-migration-verification-keys.json")),
    ]);
    const result = verifyPreDdlSourceAppRecovery({
      ...bundle, allowlist, expectedFailedRunId, expectedFailedSha, backupFileBytes, liveReport, recordText, markerText,
      repositoryPath: process.cwd(),
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  if (mode === "--verify-live-identity") {
    const [directory, liveReportPath] = args;
    const [envelope, liveReport, preflightReport] = await Promise.all([
      readFile(path.join(directory, "authorization-envelope.json"), "utf8"), readJson(liveReportPath),
      readJson(path.join(directory, "preflight-report.json")),
    ]);
    const allowlist = await readJson(path.resolve("scripts/production-migration-verification-keys.json"));
    const historical = verifyHistoricalMigrationAuthorizationEnvelope(envelope, { allowlist });
    process.stdout.write(JSON.stringify(assertCutbackLiveDatabaseIdentity({ claims: historical.payload, liveReport, preflightReport })) + "\n");
    return;
  }
  if (mode === "--verify-restored-identity" || mode === "--verify-staged-identity") {
    const [directory, restoredReportPath, expectedDatabase = "bodycast"] = args;
    const [sourceReport, restoredReport] = await Promise.all([
      readJson(path.join(directory, "preflight-report.json")), readJson(restoredReportPath),
    ]);
    process.stdout.write(JSON.stringify(assertCutbackRestoredDatabaseIdentity({
      sourceIdentity: sourceReport?.identity, restoredReport, expectedDatabase,
    })) + "\n");
    return;
  }
  if (mode === "--verify-restored") {
    const [directory, restoredReportPath, readabilityPath] = args;
    const [sourceReport, restoreResult, restoredReport, readabilityReport] = await Promise.all([
      readJson(path.join(directory, "preflight-report.json")), readJson(path.join(directory, "restore-result.json")),
      readJson(restoredReportPath), readJson(readabilityPath),
    ]);
    const result = verifyCutbackRestoredState({ sourceReport, restoreResult, restoredReport, readabilityReport });
    process.stdout.write(JSON.stringify(result) + "\n");
    if (!result.verified) process.exitCode = 1;
    return;
  }
  if (mode === "--verify-previous-release") {
    const [previousSha, historyPath] = args;
    const history = await readJson(historyPath);
    const result = verifyPreviousReleaseMigrationCompatibility({ repositoryPath: process.cwd(), previousSha,
      restoredHistory: history.migrationHistory ?? history.migrations });
    process.stdout.write(JSON.stringify(result) + "\n");
    return;
  }
  if (mode === "--verify-previous-app") {
    const [directory, expectedFailedRunId, expectedFailedSha, backupPath, capturePath, restoredReportPath, readabilityPath] = args;
    if (!directory || !/^[1-9][0-9]*$/.test(expectedFailedRunId ?? "")
      || !/^[a-f0-9]{40}$/.test(expectedFailedSha ?? "") || !backupPath || !capturePath || !restoredReportPath || !readabilityPath) {
      fail("usage: --verify-previous-app <bundle-dir> <failed-run-id> <failed-sha> <encrypted-backup> <capture-record> <restored-report> <readability-report>.");
    }
    const [bundle, backupFileBytes] = await Promise.all([readCutbackEvidenceBundle(directory), readFile(backupPath)]);
    const allowlist = await readJson(path.resolve("scripts/production-migration-verification-keys.json"));
    const context = verifyCutbackEvidenceBundle({ ...bundle, allowlist, expectedFailedRunId, expectedFailedSha, backupFileBytes });
    const [recordText, restoredReport, readabilityReport] = await Promise.all([
      readFile(capturePath, "utf8"), readJson(restoredReportPath), readJson(readabilityPath),
    ]);
    const result = verifyPreviousAppMigrationCompatibility({ recordText, targetSha: expectedFailedSha, contextVerified: context.verified,
      preflightResultDigest: context.preflightResultDigest, preflightResult, restoredReport, restoreResult, readabilityReport,
      repositoryPath: process.cwd() });
    process.stdout.write(JSON.stringify({ verified: true, provenanceKind: result.provenanceKind,
      restoredMigrationCount: result.migrationCount ?? result.restoredMigrationCount }) + "\n");
    return;
  }
  if (mode === "--verify-previous-app-runtime") {
    const [capturePath] = args;
    if (!capturePath) fail("usage: --verify-previous-app-runtime <capture-record> (Docker inspect JSON on stdin).");
    let text = "";
    for await (const chunk of process.stdin) {
      text += chunk;
      if (Buffer.byteLength(text, "utf8") > 4 * 1024 * 1024) fail("previous-app Docker inspection exceeds its bound.");
    }
    const containers = JSON.parse(text);
    if (!Array.isArray(containers) || containers.length !== 1) fail("previous-app Docker inspection must contain exactly one container.");
    const recordText = await readFile(capturePath, "utf8");
    process.stdout.write(JSON.stringify(verifyRecreatedPreviousAppRuntime({ recordText, container: containers[0] })) + "\n");
    return;
  }
  fail("unsupported fixed verification mode.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
