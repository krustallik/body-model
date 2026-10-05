import { readFile, readdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { STAGE_02_MANIFEST, ACTIVE_ENERGY_UNIFIED_MANIFEST, getProductionMigrationManifest } from "./production-migration-manifests.mjs";
import { verifyManifestBlob, verifyExecutionFileMatchesBlob } from "./production-migration-integrity.mjs";
import { canonicalSha256, verifyAuthorizationEnvelope } from "./production-migration-authorization.mjs";

export const EXPECTED_PENDING_MIGRATIONS = ACTIVE_ENERGY_UNIFIED_MANIFEST.migrations.map(({ name }) => name);
export const EXPECTED_MIGRATION_OBJECTS = Object.freeze([
  "ExerciseCatalog.currentLoadAccountingConfigId", "ExerciseLoadConfiguration", "ExerciseCatalog_currentLoadAccountingConfigId_key",
  "ExerciseLoadConfiguration_exerciseCatalogId_configVersion_key", "ExerciseLoadConfiguration_exerciseCatalogId_createdAt_idx",
  "ExerciseLoadConfiguration_pkey", "ExerciseLoadConfiguration_exerciseCatalogId_fkey", "ExerciseCatalog_currentLoadAccountingConfigId_fkey",
  "ProgramExercise.loadAccountingConfigSnapshot", "StrengthSessionExercise.loadAccountingConfigSnapshot", "StrengthSet.loadAccountingOverride",
  "HealthMetricSample.source", "StrengthAccountingOperationStatus", "StrengthDiarySession.accountingInputRevision",
  "StrengthDiarySession.effectiveAccountingAt", "StrengthDiarySession.accountingTimeZone", "StrengthDiarySession.accountingTimeZoneProvenance",
  "StrengthDiarySession.currentSnapshotRevision", "StrengthDiarySession_accountingInputRevision_positive", "StrengthSessionAccountingSnapshot",
  "StrengthSessionAccountingSnapshot_session_input_revision_idx", "StrengthSessionAccountingSnapshot_session_fingerprint_idx",
  "StrengthSessionAccountingSnapshot_pkey", "StrengthSessionAccountingSnapshot_sessionId_fkey", "StrengthSessionAccountingSnapshot_session_revision_key",
  "StrengthSessionAccountingSnapshot_positive_revisions", "StrengthSessionAccountingSnapshot_fingerprint_hex", "StrengthSessionAccountingOperation",
  "StrengthSessionAccountingOperation_session_status_created_idx", "StrengthSessionAccountingOperation_pkey",
  "StrengthSessionAccountingOperation_sessionId_fkey", "StrengthSessionAccountingOperation_session_key_key",
  "StrengthSessionAccountingOperation_digest_hex", "StrengthSessionAccountingOperation_completed_has_result",
  "StrengthDiarySession_current_snapshot_fkey", "StrengthSessionAccountingOperation_result_snapshot_fkey",
]);

export const ALL_REVIEWED_MIGRATIONS = [...STAGE_02_MANIFEST.migrations, ...ACTIVE_ENERGY_UNIFIED_MANIFEST.migrations];
const ALL_REVIEWED_OBJECTS = [...EXPECTED_MIGRATION_OBJECTS, ...ACTIVE_ENERGY_UNIFIED_MANIFEST.postflightObjects];

function sorted(values) { return [...values].sort(); }
function sameArray(left, right) { return JSON.stringify(sorted(left)) === JSON.stringify(sorted(right)); }
function canonicalHistory(migrations) {
  if (!Array.isArray(migrations)) return null;
  return migrations.map((entry) => ({
    name: entry.name,
    checksum: entry.checksum ?? null,
    startedAt: entry.startedAt ?? null,
    finishedAt: entry.finishedAt ?? null,
    rolledBackAt: entry.rolledBackAt ?? null,
    logsSha256: entry.logsSha256 ?? entry.logsFingerprint ?? null,
  })).sort((a, b) => a.name.localeCompare(b.name) || String(a.startedAt).localeCompare(String(b.startedAt)));
}

export function schemaInventoryDigest(objects) {
  if (!Array.isArray(objects)) throw new Error("Schema inventory is unavailable.");
  const normalized = objects.map((object) => ({
    name: object?.name,
    present: object?.present === true,
    kind: object?.kind ?? null,
    signature: object?.signature ?? null,
  })).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return canonicalSha256(normalized);
}

export function assertProductionDatabaseIdentityMatches(expectedIdentity, actualIdentity) {
  if (!expectedIdentity || typeof expectedIdentity !== "object" || !actualIdentity || typeof actualIdentity !== "object"
    || canonicalSha256(expectedIdentity) !== canonicalSha256(actualIdentity)) {
    throw new Error("Migration blocked: production database identity differs from the signed preflight target.");
  }
  return true;
}

function hasConcretePostgresEndpoint(identity) {
  return identity && typeof identity.database === "string" && identity.database.length > 0
    && typeof identity.role === "string" && identity.role.length > 0
    && typeof identity.serverVersion === "string" && identity.serverVersion.length > 0
    && Number.isSafeInteger(Number(identity.databaseOid)) && Number(identity.databaseOid) > 0
    && typeof identity.serverAddress === "string" && identity.serverAddress.length > 0
    && Number.isInteger(Number(identity.serverPort)) && Number(identity.serverPort) > 0 && Number(identity.serverPort) <= 65535;
}

function migrationState(report, migrationDirectories) {
  const blockers = [];
  const rows = Array.isArray(report?.migrations) ? report.migrations : [];
  const rowGroups = new Map();
  for (const row of rows) {
    if (!row || typeof row.name !== "string" || !row.name) {
      blockers.push("Production migration history contains an invalid row.");
      continue;
    }
    rowGroups.set(row.name, [...(rowGroups.get(row.name) ?? []), row]);
  }

  const releaseNames = sorted(migrationDirectories);
  const releaseSet = new Set(releaseNames);
  const unexpected = sorted([...rowGroups.keys()].filter((name) => !releaseSet.has(name)));
  if (unexpected.length) blockers.push(`Database contains migration rows absent from this release tree: ${unexpected.join(", ")}.`);

  const failed = [];
  const rolledBack = [];
  const duplicate = [];
  const applied = new Set();
  for (const [name, entries] of rowGroups) {
    if (entries.length !== 1) duplicate.push(name);
    if (entries.some((row) => row.rolledBackAt)) rolledBack.push(name);
    if (entries.some((row) => row.startedAt && !row.finishedAt && !row.rolledBackAt)) failed.push(name);
    if (entries.length === 1 && entries[0].finishedAt && !entries[0].rolledBackAt) applied.add(name);
  }
  if (failed.length) blockers.push(`Incomplete/failed migration rows exist: ${sorted(failed).join(", ")}.`);
  if (rolledBack.length) blockers.push(`Rolled-back migration rows require manual review: ${sorted(rolledBack).join(", ")}.`);
  if (duplicate.length) blockers.push(`Duplicate migration history rows require manual review: ${sorted(duplicate).join(", ")}.`);

  for (const migration of STAGE_02_MANIFEST.migrations) {
    const rowsForName = rowGroups.get(migration.name) ?? [];
    if (rowsForName.length !== 1 || !rowsForName[0].finishedAt || rowsForName[0].rolledBackAt) {
      blockers.push(`Required Stage 02 migration ${migration.name} is not recorded exactly once as successful.`);
    } else if (rowsForName[0].checksum !== migration.sha256) {
      blockers.push(`Stage 02 migration ${migration.name} checksum differs from the reviewed Git blob.`);
    }
  }

  const pending = releaseNames.filter((name) => !applied.has(name));
  return { blockers, rows, rowGroups, applied, pending, failed: sorted(failed), rolledBack: sorted(rolledBack), duplicate: sorted(duplicate), unexpected };
}

export function evaluateProductionPreflight(report, migrationDirectories, manifestId = ACTIVE_ENERGY_UNIFIED_MANIFEST.id) {
  const manifest = getProductionMigrationManifest(manifestId);
  const { blockers, rows, pending, failed, rolledBack, duplicate, unexpected } = migrationState(report, migrationDirectories);
  const expectedPending = sorted(manifest.migrations.map(({ name }) => name));
  if (!sameArray(migrationDirectories, [...new Set(migrationDirectories)])) blockers.push("Release tree contains duplicate migration directory names.");
  if (!sameArray(pending, expectedPending)) blockers.push(`Full release-tree pending set differs from manifest ${manifest.id}: ${sorted(pending).join(", ") || "none"}.`);

  const objectRows = Array.isArray(report?.objects) ? report.objects : [];
  const objectNames = objectRows.map((object) => object?.name);
  if (!sameArray(objectNames, ALL_REVIEWED_OBJECTS)) blockers.push("Schema inventory names do not exactly match the reviewed Stage 02 and Active Energy manifests.");
  const objectMap = new Map(objectRows.map((object) => [object?.name, object]));
  if (objectRows.some((object) => object?.present === true && (typeof object.signature !== "string" || !object.signature))) {
    blockers.push("Current schema inventory is missing a signature for an existing reviewed object.");
  }
  const partialObjects = manifest.postflightObjects.filter((name) => objectMap.get(name)?.present === true);
  if (partialObjects.length) blockers.push(`Active Energy migration objects already exist while the migration set is pending: ${partialObjects.join(", ")}.`);
  const missingStage02Objects = EXPECTED_MIGRATION_OBJECTS.filter((name) => objectMap.get(name)?.present !== true);
  if (missingStage02Objects.length) blockers.push(`Required Stage 02 schema objects are missing: ${missingStage02Objects.join(", ")}.`);

  for (const tableName of manifest.requiredTablesBefore) {
    if (report?.tables?.[tableName]?.exists !== true) blockers.push(`Required production baseline table ${tableName} is missing.`);
  }
  if (report?.identity?.database !== "bodycast" || report?.identity?.role !== "bodycast") blockers.push("Connected database/role identity differs from the reviewed production target.");
  if (!String(report?.identity?.serverVersion ?? "").startsWith("17.")) blockers.push("Production PostgreSQL version differs from the reviewed major version 17.");
  if (!hasConcretePostgresEndpoint(report?.identity)) blockers.push("Production database endpoint identity is incomplete.");

  const conflictingLocks = Array.isArray(report?.conflictingLocks) ? report.conflictingLocks : [];
  if (conflictingLocks.length) blockers.push(`${conflictingLocks.length} lock(s) conflict with the exact migration DDL operations.`);
  if (Array.isArray(report?.preparedTransactions) && report.preparedTransactions.some((transaction) => transaction?.blocksMigration === true)) {
    blockers.push("A prepared transaction blocks a migration DDL target.");
  }

  return {
    readyForOwnerAuthorization: blockers.length === 0,
    blockers,
    manifestId: manifest.id,
    expectedPending,
    pending: sorted(pending),
    pendingSetDigest: canonicalSha256(sorted(pending)),
    pendingExactlyExpected: sameArray(pending, expectedPending),
    failed,
    rolledBack,
    duplicate,
    unexpectedMigrations: unexpected,
    partialSchemaObjects: partialObjects,
    migrations: rows,
    objects: objectRows,
    identity: report?.identity ?? null,
    tables: report?.tables ?? {},
    conflictingLocks,
    preparedTransactions: Array.isArray(report?.preparedTransactions) ? report.preparedTransactions : [],
    diagnostics: { longTransactions: Array.isArray(report?.longTransactions) ? report.longTransactions : [] },
  };
}

export function evaluateProductionPostflight(report, migrationDirectories, manifestId = ACTIVE_ENERGY_UNIFIED_MANIFEST.id, options = {}) {
  const manifest = getProductionMigrationManifest(manifestId);
  const state = migrationState(report, migrationDirectories);
  const blockers = [...state.blockers];
  if (state.pending.length) blockers.push(`Pending migrations remain after DDL: ${state.pending.join(", ")}.`);
  const objectRows = Array.isArray(report?.objects) ? report.objects : [];
  const names = objectRows.map((entry) => entry?.name);
  if (!sameArray(names, ALL_REVIEWED_OBJECTS)) blockers.push("Postflight object inventory differs from the reviewed schema manifest.");
  const byName = new Map(objectRows.map((entry) => [entry?.name, entry]));
  const missing = manifest.postflightObjects.filter((name) => byName.get(name)?.present !== true);
  if (missing.length) blockers.push(`Postflight schema objects are missing: ${missing.join(", ")}.`);
  const missingStage02 = EXPECTED_MIGRATION_OBJECTS.filter((name) => byName.get(name)?.present !== true);
  if (missingStage02.length) blockers.push(`Stage 02 schema objects are missing after migration: ${missingStage02.join(", ")}.`);
  const expectedDatabase = options.expectedDatabase ?? "bodycast";
  const expectedRole = options.expectedRole ?? "bodycast";
  if (report?.identity?.database !== expectedDatabase || report?.identity?.role !== expectedRole || !String(report?.identity?.serverVersion ?? "").startsWith("17.")
    || !hasConcretePostgresEndpoint(report?.identity)) {
    blockers.push("Postflight database identity differs from the expected target.");
  }
  if (objectRows.some((entry) => entry?.present === true && (typeof entry.signature !== "string" || !entry.signature))) {
    blockers.push("Postflight schema inventory is missing a required object signature.");
  }
  for (const migration of manifest.migrations) {
    const matches = state.rowGroups.get(migration.name) ?? [];
    if (matches.length !== 1 || !matches[0].finishedAt || matches[0].rolledBackAt) blockers.push(`Migration ${migration.name} is not recorded exactly once as successful.`);
    else if (matches[0].checksum !== migration.sha256) blockers.push(`Migration ${migration.name} checksum differs from the Git blob checksum.`);
  }
  return { ready: blockers.length === 0, blockers, manifestId: manifest.id, pending: state.pending, missingObjects: [...missingStage02, ...missing] };
}

export function verifyRestoredBackup(sourceReport, restoredReport) {
  const blockers = [];
  const sourceHistory = canonicalHistory(sourceReport?.migrations);
  const restoredHistory = canonicalHistory(restoredReport?.migrationHistory ?? restoredReport?.migrations);
  if (!sourceHistory || !restoredHistory) blockers.push("Source or restored migration history is missing.");
  else if (JSON.stringify(sourceHistory) !== JSON.stringify(restoredHistory)) blockers.push("Restored _prisma_migrations rows do not match the source snapshot.");
  if (Array.isArray(sourceReport?.objects) && Array.isArray(restoredReport?.objects)
    && schemaInventoryDigest(sourceReport.objects) !== schemaInventoryDigest(restoredReport.objects)) {
    blockers.push("Restored schema inventory digest differs from the source snapshot.");
  }
  for (const tableName of ["Workout", "Profile", "ModelEpisode", "PhysiologyV7Lifecycle", "DailyModelState", "StrengthDiarySession", "ExerciseCatalog"]) {
    const count = restoredReport?.readability?.[tableName]?.rowCount;
    if (!Number.isSafeInteger(count) || count < 0) blockers.push(`Restored baseline table ${tableName} could not be read.`);
  }
  return { verified: blockers.length === 0, blockers, migrationCount: restoredHistory?.length ?? null };
}

export function verifyPostflightMatchesRestore(report, restoreResult, migrationDirectories, manifestId = ACTIVE_ENERGY_UNIFIED_MANIFEST.id) {
  const result = evaluateProductionPostflight(report, migrationDirectories, manifestId);
  const blockers = [...result.blockers];
  if (restoreResult?.verified !== true || restoreResult?.postflightReady !== true) blockers.push("Disposable restored migration validation is not successful.");
  const expected = restoreResult?.postSchemaDigest;
  if (!/^[a-f0-9]{64}$/.test(String(expected ?? ""))) blockers.push("Disposable post-migration schema digest is missing or invalid.");
  else if (schemaInventoryDigest(report.objects) !== expected) blockers.push("Production post-migration schema signatures differ from the verified disposable restore.");
  return { ready: blockers.length === 0, blockers, expectedSchemaDigest: expected ?? null, actualSchemaDigest: Array.isArray(report?.objects) ? schemaInventoryDigest(report.objects) : null };
}

async function readJsonInput(filePath) {
  const content = filePath ? await readFile(filePath, "utf8") : await new Promise((resolve, reject) => {
    let content = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { content += chunk; });
    process.stdin.on("end", () => resolve(content));
    process.stdin.on("error", reject);
  });
  return JSON.parse(content);
}

async function main() {
  const [mode, ...args] = process.argv.slice(2);
  if (mode === "--verify-restore") {
    if (args.length !== 2) throw new Error("Usage: production-migration-preflight.mjs --verify-restore <source.json> <restored.json>");
    const [source, restored] = await Promise.all(args.map(readJsonInput));
    const result = verifyRestoredBackup(source, restored);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.verified) process.exitCode = 1;
    return;
  }
  if (mode === "--verify-authorization") {
    if (args.length !== 3) throw new Error("Usage: production-migration-preflight.mjs --verify-authorization <envelope.json> <live.json> <keys.json>");
    const [envelope, live, allowlist] = await Promise.all([
      readFile(args[0], "utf8").then((value) => value.trimEnd()), readJsonInput(args[1]), readJsonInput(args[2]),
    ]);
    const result = verifyAuthorizationEnvelope(envelope, { live, allowlist });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  if (mode === "--execution-integrity") {
    const repositoryPath = path.resolve(args[args.indexOf("--repository") + 1] ?? process.cwd());
    const releaseSha = args[args.indexOf("--release-sha") + 1];
    const manifest = getProductionMigrationManifest(args[args.indexOf("--manifest") + 1] ?? ACTIVE_ENERGY_UNIFIED_MANIFEST.id);
    const files = [];
    for (const migration of manifest.migrations) {
      const result = await verifyExecutionFileMatchesBlob({ repositoryPath, releaseSha, migration });
      files.push(result);
    }
    const result = { exactExecutionBytes: files.every((item) => item.exactMatch), files };
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.exactExecutionBytes) process.exitCode = 1;
    return;
  }
  if (mode === "--preflight" || mode === "--postflight") {
    const value = (flag) => { const index = args.indexOf(flag); return index < 0 ? null : args[index + 1]; };
    const reportPath = value("--report");
    const manifestId = value("--manifest") ?? ACTIVE_ENERGY_UNIFIED_MANIFEST.id;
    const repositoryPath = value("--repository") ?? process.cwd();
    const report = await readJsonInput(reportPath);
    const migrationDirectories = (await readdir(path.resolve(repositoryPath, "prisma/migrations"), { withFileTypes: true }))
      .filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    let result;
    if (mode === "--preflight") {
      result = evaluateProductionPreflight(report, migrationDirectories, manifestId);
      const manifest = getProductionMigrationManifest(manifestId);
      const integrity = [];
      for (const migration of [...STAGE_02_MANIFEST.migrations, ...manifest.migrations]) {
        const item = await verifyManifestBlob({ repositoryPath, releaseSha: value("--release-sha"), migration });
        integrity.push({ name: item.name, expectedSha256: item.expectedSha256, actualSha256: item.actualSha256, matches: item.matchesManifest, bytes: item.bytes });
        if (!item.matchesManifest) result.blockers.push(`Committed migration blob ${item.name} differs from the reviewed manifest checksum.`);
      }
      result.blobIntegrity = integrity;
      result.readyForOwnerAuthorization = result.blockers.length === 0;
    } else {
      result = evaluateProductionPostflight(report, migrationDirectories, manifestId);
      const integrity = [];
      for (const migration of getProductionMigrationManifest(manifestId).migrations) {
        const item = await verifyExecutionFileMatchesBlob({ repositoryPath, releaseSha: value("--release-sha"), migration });
        integrity.push(item);
        if (!item.exactMatch) result.blockers.push(item.blocker);
      }
      result.executionFileIntegrity = integrity;
      result.ready = result.blockers.length === 0;
    }
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (mode === "--preflight" ? !result.readyForOwnerAuthorization : !result.ready) process.exitCode = 1;
    return;
  }
  throw new Error("Usage: production-migration-preflight.mjs --preflight|--postflight|--execution-integrity|--verify-restore|--verify-authorization ...");
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
