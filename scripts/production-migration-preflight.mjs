import { readFile, readdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";

export const EXPECTED_PENDING_MIGRATIONS = [
  "20260929170000_training_load_accounting_v1",
  "20260929190000_persist_strength_accounting_v1",
];

export const EXPECTED_MIGRATION_OBJECTS = [
  "ExerciseCatalog.currentLoadAccountingConfigId",
  "ExerciseLoadConfiguration",
  "ExerciseCatalog_currentLoadAccountingConfigId_key",
  "ExerciseLoadConfiguration_exerciseCatalogId_configVersion_key",
  "ExerciseLoadConfiguration_exerciseCatalogId_createdAt_idx",
  "ExerciseLoadConfiguration_pkey",
  "ExerciseLoadConfiguration_exerciseCatalogId_fkey",
  "ExerciseCatalog_currentLoadAccountingConfigId_fkey",
  "ProgramExercise.loadAccountingConfigSnapshot",
  "StrengthSessionExercise.loadAccountingConfigSnapshot",
  "StrengthSet.loadAccountingOverride",
  "HealthMetricSample.source",
  "StrengthAccountingOperationStatus",
  "StrengthDiarySession.accountingInputRevision",
  "StrengthDiarySession.effectiveAccountingAt",
  "StrengthDiarySession.accountingTimeZone",
  "StrengthDiarySession.accountingTimeZoneProvenance",
  "StrengthDiarySession.currentSnapshotRevision",
  "StrengthDiarySession_accountingInputRevision_positive",
  "StrengthSessionAccountingSnapshot",
  "StrengthSessionAccountingSnapshot_session_input_revision_idx",
  "StrengthSessionAccountingSnapshot_session_fingerprint_idx",
  "StrengthSessionAccountingSnapshot_pkey",
  "StrengthSessionAccountingSnapshot_sessionId_fkey",
  "StrengthSessionAccountingSnapshot_session_revision_key",
  "StrengthSessionAccountingSnapshot_positive_revisions",
  "StrengthSessionAccountingSnapshot_fingerprint_hex",
  "StrengthSessionAccountingOperation",
  "StrengthSessionAccountingOperation_session_status_created_idx",
  "StrengthSessionAccountingOperation_pkey",
  "StrengthSessionAccountingOperation_sessionId_fkey",
  "StrengthSessionAccountingOperation_session_key_key",
  "StrengthSessionAccountingOperation_digest_hex",
  "StrengthSessionAccountingOperation_completed_has_result",
  "StrengthDiarySession_current_snapshot_fkey",
  "StrengthSessionAccountingOperation_result_snapshot_fkey",
];

export function evaluateProductionPreflight(report, migrationDirectories) {
  const blockers = [];
  const rows = Array.isArray(report?.migrations) ? report.migrations : [];
  const migrationsByName = new Map();

  for (const row of rows) {
    if (!row || typeof row.name !== "string") {
      blockers.push("Production migration history contains an invalid row.");
      continue;
    }
    const entries = migrationsByName.get(row.name) ?? [];
    entries.push(row);
    migrationsByName.set(row.name, entries);
  }

  const applied = new Set();
  const failed = [];
  const rolledBack = [];
  for (const [name, entries] of migrationsByName) {
    if (entries.some((entry) => entry.finishedAt && !entry.rolledBackAt)) applied.add(name);
    if (entries.some((entry) => entry.startedAt && !entry.finishedAt && !entry.rolledBackAt)) failed.push(name);
    if (entries.some((entry) => entry.rolledBackAt)) rolledBack.push(name);
  }

  const expectedMigrations = [...migrationDirectories].sort();
  const unexpectedMigrations = [...migrationsByName.keys()].filter((name) => !expectedMigrations.includes(name)).sort();
  const pending = expectedMigrations.filter((name) => !applied.has(name));
  const expectedPending = [...EXPECTED_PENDING_MIGRATIONS].sort();
  if (JSON.stringify(pending) !== JSON.stringify(expectedPending)) {
    blockers.push(`Pending migrations differ from the expected Stage 02 pair: ${pending.join(", ") || "none"}.`);
  }
  if (failed.length) blockers.push(`Incomplete/failed migration rows exist: ${failed.sort().join(", ")}.`);
  if (rolledBack.length) blockers.push(`Rolled-back migration records require owner review: ${[...new Set(rolledBack)].sort().join(", ")}.`);
  if (unexpectedMigrations.length) blockers.push(`Database contains migration rows absent from this release tree: ${unexpectedMigrations.join(", ")}.`);

  const objects = Array.isArray(report?.objects) ? report.objects : [];
  const actualObjectNames = objects.map((object) => object?.name).sort();
  const expectedObjectNames = [...EXPECTED_MIGRATION_OBJECTS].sort();
  if (JSON.stringify(actualObjectNames) !== JSON.stringify(expectedObjectNames)) {
    blockers.push("Stage 02 migration object inventory does not match this release's reviewed manifest.");
  }
  const presentObjects = objects.filter((object) => object?.present === true).map((object) => object.name).sort();
  if (presentObjects.length) {
    blockers.push(`Stage 02 migration objects already exist while their migrations are pending: ${presentObjects.join(", ")}.`);
  }

  for (const tableName of ["StrengthDiarySession", "ExerciseCatalog"]) {
    if (report?.tables?.[tableName]?.exists !== true) {
      blockers.push(`Expected production table ${tableName} is missing.`);
    }
  }
  if (!report?.identity?.database || !report?.identity?.role || !report?.identity?.serverVersion) {
    blockers.push("Production database identity is incomplete.");
  }
  if (report?.identity?.database !== "bodycast" || report?.identity?.role !== "bodycast") {
    blockers.push("Connected database/role identity differs from the documented production target.");
  }
  if (!String(report?.identity?.serverVersion ?? "").startsWith("17.")) {
    blockers.push("Production PostgreSQL version differs from the expected major version 17.");
  }

  const longTransactions = Array.isArray(report?.longTransactions) ? report.longTransactions : [];
  const relevantLocks = Array.isArray(report?.relevantLocks) ? report.relevantLocks : [];
  if (longTransactions.length) blockers.push(`${longTransactions.length} transaction(s) have been open for more than five minutes.`);
  if (relevantLocks.length) blockers.push(`${relevantLocks.length} relevant DDL-conflicting relation lock(s) were observed.`);

  return {
    readyForOwnerAuthorization: blockers.length === 0,
    blockers,
    pendingExactlyExpected: JSON.stringify(pending) === JSON.stringify(expectedPending),
    failedRowsPresent: failed.length > 0,
    rolledBackRowsPresent: rolledBack.length > 0,
    partialSchemaObjectsPresent: presentObjects.length > 0,
    expectedPending,
    pending,
    migrations: rows.map((row) => ({
      name: row.name,
      checksum: row.checksum ?? null,
      startedAt: row.startedAt ?? null,
      finishedAt: row.finishedAt ?? null,
      rolledBackAt: row.rolledBackAt ?? null,
      hasLogs: row.hasLogs === true,
      logsFingerprint: row.logsFingerprint ?? null,
    })),
    failed: [...new Set(failed)].sort(),
    rolledBack: [...new Set(rolledBack)].sort(),
    unexpectedMigrations,
    presentObjects,
    identity: report?.identity ?? null,
    tables: report?.tables ?? {},
    longTransactions,
    preparedTransactions: Array.isArray(report?.preparedTransactions) ? report.preparedTransactions : [],
    relevantLocks,
  };
}

function normalizedMigrationHistory(migrations) {
  if (!Array.isArray(migrations)) return null;
  return migrations
    .map((entry) => ({
      name: entry.name,
      checksum: entry.checksum ?? null,
      startedAt: entry.startedAt ?? null,
      finishedAt: entry.finishedAt ?? null,
      rolledBackAt: entry.rolledBackAt ?? null,
      hasLogs: entry.hasLogs === true,
      logsFingerprint: entry.logsFingerprint ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name) || String(a.startedAt).localeCompare(String(b.startedAt)));
}

export function verifyRestoredBackup(sourceReport, restoredReport) {
  const blockers = [];
  const sourceHistory = normalizedMigrationHistory(sourceReport?.migrations);
  const restoredHistory = normalizedMigrationHistory(restoredReport?.migrationHistory);
  if (!sourceHistory || !restoredHistory) {
    blockers.push("Source or restored migration history is missing.");
  } else if (JSON.stringify(sourceHistory) !== JSON.stringify(restoredHistory)) {
    blockers.push("Restored _prisma_migrations rows do not match the preflight source report.");
  }

  for (const tableName of ["StrengthDiarySession", "ExerciseCatalog"]) {
    if (!Number.isSafeInteger(restoredReport?.readability?.[tableName]?.rowCount)
      || restoredReport.readability[tableName].rowCount < 0) {
      blockers.push(`Restored ${tableName} table could not be read.`);
    }
  }

  return { verified: blockers.length === 0, blockers, migrationCount: restoredHistory?.length ?? null };
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
    const [sourcePath, restoredPath] = args;
    const [source, restored] = await Promise.all([readJsonInput(sourcePath), readJsonInput(restoredPath)]);
    const result = verifyRestoredBackup(source, restored);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.verified) process.exitCode = 1;
    return;
  }

  if (mode !== "--preflight") throw new Error("Usage: production-migration-preflight.mjs --preflight <optional-report.json>");
  const reportPath = args[0] ? path.resolve(args[0]) : null;
  const report = await readJsonInput(reportPath);
  const migrationsPath = path.resolve("prisma/migrations");
  const migrationDirectories = (await readdir(migrationsPath, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  const result = evaluateProductionPreflight(report, migrationDirectories);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.readyForOwnerAuthorization) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
