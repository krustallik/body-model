import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { canonicalSha256, verifyHistoricalMigrationAuthorizationEnvelope } from "./production-migration-authorization.mjs";
import { verifyRestoredBackup } from "./production-migration-preflight.mjs";

const BUNDLE_FILES = Object.freeze([
  "authorization-envelope.json", "artifact-metadata.json", "preflight-evidence.json",
  "preflight-report.json", "preflight-result.json", "restore-result.json",
]);
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
  if (preflightResult?.readyForOwnerAuthorization !== true || preflightResult?.manifestId !== claims.manifestId) {
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
  if (preflightEvidence?.verified !== true || preflightEvidence.releaseSha !== claims.releaseSha
    || preflightEvidence.manifestId !== claims.manifestId
    || String(preflightEvidence.workflowRunId) !== claims.preflightRunId
    || Number(preflightEvidence.workflowRunAttempt) !== claims.preflightRunAttempt
    || preflightEvidence.preflightResultDigest !== claims.preflightResultDigest
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
  return { verified: true, claims, backupFileDigest: preflightEvidence.backupFileDigest };
}

export function assertCutbackLiveDatabaseIdentity({ claims, liveReport }) {
  const identity = liveReport?.identity;
  if (!identity || canonicalSha256(identity) !== claims.productionIdentityDigest
    || identity.database !== "bodycast" || identity.role !== "bodycast"
    || !String(identity.serverVersion ?? "").startsWith("17.")
    || !Number.isSafeInteger(identity.databaseOid)) {
    fail("live PostgreSQL cluster/database/role identity differs from the exact signed pre-DDL target.");
  }
  if (liveReport?.writerDrain?.activeClientBackends?.length !== 0
    || liveReport?.writerDrain?.topology?.ready !== true) {
    fail("live writer-drain report is not empty and ready.");
  }
  return { verified: true, identityDigest: canonicalSha256(identity) };
}

export function assertCutbackRestoredDatabaseIdentity({ sourceIdentity, restoredReport, expectedDatabase = "bodycast" }) {
  const restored = restoredReport?.identity;
  if (!sourceIdentity || !restored || restored.database !== expectedDatabase || restored.role !== "bodycast"
    || !Number.isSafeInteger(restored.databaseOid) || restored.databaseOid < 1
    || restored.clusterSystemIdentifier !== sourceIdentity.clusterSystemIdentifier
    || restored.serverVersion !== sourceIdentity.serverVersion
    || restored.serverAddress !== sourceIdentity.serverAddress
    || restored.serverPort !== sourceIdentity.serverPort) {
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
    && canonicalSha256(sourceReport.identity) !== canonicalSha256(restoredReport.identity)) {
    // A staged database has a different OID by design. Only database endpoint
    // fields that identify the PostgreSQL cluster are compared by the host gate.
    const source = { ...sourceReport?.identity };
    const restored = { ...restoredReport?.identity };
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
  for (const row of rows) {
    const relative = `prisma/migrations/${row.name}/migration.sql`;
    const bytes = execFileSync("git", ["cat-file", "blob", `${previousSha}:${relative}`], {
      cwd: repositoryPath, encoding: "buffer", stdio: ["ignore", "pipe", "pipe"],
    });
    const checksum = createHash("sha256").update(bytes).digest("hex");
    if (checksum !== row.checksum) fail(`restored migration checksum differs from previous app source: ${row.name}.`);
  }
  return { verified: true, migrationCount: rows.length };
}

async function readJson(filePath) { return JSON.parse(await readFile(filePath, "utf8")); }

async function main() {
  const [mode, ...args] = process.argv.slice(2);
  if (mode === "--verify-context") {
    const [directory, expectedFailedRunId, expectedFailedSha, backupPath] = args;
    if (!directory || !/^[1-9][0-9]*$/.test(expectedFailedRunId ?? "") || !/^[a-f0-9]{40}$/.test(expectedFailedSha ?? "") || !backupPath) {
      fail("usage: --verify-context <bundle-dir> <failed-run-id> <failed-release-sha> <encrypted-backup-file>.");
    }
    const values = await Promise.all(BUNDLE_FILES.map((name) => readFile(path.join(directory, name), "utf8")));
    const [envelope, artifactMetadata, preflightEvidence, preflightReport, preflightResult, restoreResult] = values.map(JSON.parse);
    const backupFileBytes = await readFile(backupPath);
    const allowlist = await readJson(path.resolve("scripts/production-migration-verification-keys.json"));
    const result = verifyCutbackEvidenceBundle({ envelope, artifactMetadata, preflightEvidence, preflightReport,
      preflightResult, restoreResult, allowlist, expectedFailedRunId, expectedFailedSha, backupFileBytes });
    process.stdout.write(JSON.stringify({ verified: result.verified, releaseSha: result.claims.releaseSha,
      preflightRunId: result.claims.preflightRunId, preflightRunAttempt: result.claims.preflightRunAttempt,
      backupArtifactId: result.claims.backupArtifactId, backupArtifactDigest: result.claims.backupArtifactDigest,
      backupFileDigest: result.backupFileDigest, productionIdentityDigest: result.claims.productionIdentityDigest }) + "\n");
    return;
  }
  if (mode === "--verify-live-identity") {
    const [directory, liveReportPath] = args;
    const [envelope, liveReport] = await Promise.all([
      readFile(path.join(directory, "authorization-envelope.json"), "utf8"), readJson(liveReportPath),
    ]);
    const allowlist = await readJson(path.resolve("scripts/production-migration-verification-keys.json"));
    const historical = verifyHistoricalMigrationAuthorizationEnvelope(envelope, { allowlist });
    process.stdout.write(JSON.stringify(assertCutbackLiveDatabaseIdentity({ claims: historical.payload, liveReport })) + "\n");
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
  fail("unsupported fixed verification mode.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
