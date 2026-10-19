import { readFile, readdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { STAGE_02_MANIFEST, ACTIVE_ENERGY_UNIFIED_MANIFEST, V4_REPUBLICATION_MANIFEST, PRODUCTION_MIGRATION_MANIFESTS, getProductionMigrationManifest } from "./production-migration-manifests.mjs";
import { verifyManifestBlob, verifyExecutionFileMatchesBlob } from "./production-migration-integrity.mjs";
import { canonicalSha256, verifyAuthorizationEnvelope } from "./production-migration-authorization.mjs";
import { evaluateProductionWriterDrain } from "./production-writer-drain.mjs";
import { isCanonicalPostgresDatabaseIdentity, isHistoricalPostgresDatabaseIdentity, samePostgresDatabaseIdentity } from "./postgres-database-identity.mjs";

export const EXPECTED_PENDING_MIGRATIONS = ACTIVE_ENERGY_UNIFIED_MANIFEST.migrations.map(({ name }) => name);
export const EXPECTED_V4_REPUBLICATION_PENDING_MIGRATIONS = V4_REPUBLICATION_MANIFEST.migrations.map(({ name }) => name);
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

export const ALL_REVIEWED_MIGRATIONS = [...new Map([
  ...STAGE_02_MANIFEST.migrations,
  ...Object.values(PRODUCTION_MIGRATION_MANIFESTS).flatMap((manifest) => [
    ...manifest.migrations,
    ...(manifest.requiredAppliedMigrations ?? []),
  ]),
].map((migration) => [migration.name, migration])).values()];
export const ALL_REVIEWED_OBJECTS = [...new Set([
  ...EXPECTED_MIGRATION_OBJECTS,
  ...Object.values(PRODUCTION_MIGRATION_MANIFESTS).flatMap((manifest) => [
    ...manifest.requiredObjectsBefore,
    ...manifest.postflightObjects,
    ...(manifest.partialObjects ?? []),
  ]),
])];

function sorted(values) { return [...values].sort(); }
function sameArray(left, right) { return JSON.stringify(sorted(left)) === JSON.stringify(sorted(right)); }

export function evaluateProductionMigrationTree(migrationDirectories, manifestId = ACTIVE_ENERGY_UNIFIED_MANIFEST.id) {
  const manifest = getProductionMigrationManifest(manifestId);
  const expectedDirectories = [
    ...(manifest.requiredAppliedMigrations ?? []).map(({ name }) => name),
    ...manifest.migrations.map(({ name }) => name),
  ];
  const blockers = [];
  if (!sameArray(migrationDirectories, [...new Set(migrationDirectories)])) {
    blockers.push("Release tree contains duplicate migration directory names.");
  }
  if (manifest.requireCompleteReleaseTree === true
    && (!sameArray(expectedDirectories, [...new Set(expectedDirectories)])
      || !sameArray(expectedDirectories, migrationDirectories))) {
    blockers.push("Reviewed predecessor and pending sets do not cover the complete release migration tree exactly.");
  }
  return {
    manifestId: manifest.id,
    expectedDirectories: sorted(expectedDirectories),
    actualDirectories: sorted(migrationDirectories),
    ready: blockers.length === 0,
    blockers,
  };
}

function isValidPreparedTransactionTimestamp(value) {
  const match = typeof value === "string"
    ? value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/)
    : null;
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , zone] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  if (!daysInMonth || day < 1 || day > daysInMonth || hour > 23 || minute > 59 || second > 59) return false;
  if (zone !== "Z" && (Number(zone.slice(1, 3)) > 15 || Number(zone.slice(4, 6)) > 59)) return false;
  return Number.isFinite(Date.parse(value));
}

const SAFE_BLOCKER_CATEGORIES = Object.freeze([
  ["data-fingerprint", /fingerprint|public-table rows|sequence state/i],
  ["migration-history", /migration|_prisma_migrations/i],
  ["schema-inventory", /schema|object signature|baseline table/i],
  ["database-identity", /database|postgresql|endpoint|role identity/i],
  ["writer-drain", /writer|client backend/i],
  ["database-locks", /lock|prepared transaction/i],
  ["release-integrity", /manifest|release tree|execution-integrity|git blob/i],
]);

export function safeBlockerCategories(blockers) {
  const categories = new Set();
  for (const blocker of Array.isArray(blockers) ? blockers : []) {
    if (typeof blocker !== "string") {
      categories.add("unclassified");
      continue;
    }
    const category = SAFE_BLOCKER_CATEGORIES.find(([, pattern]) => pattern.test(blocker))?.[0] ?? "unclassified";
    categories.add(category);
  }
  return [...categories].sort();
}

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

const LIFECYCLE_REVISION_CONSTRAINT = "PhysiologyV7Lifecycle_unifiedTargetRevision_supported";
const LIFECYCLE_REVISION_VALUES = [
  "unified-experimental-physiology-state-v3-relative-muscle-daily-cumulative-diagnostics",
  "unified-experimental-physiology-state-v4-physical-glycogen-water-2p7-exact-once",
];
const LIFECYCLE_REVISION_SIGNATURE_PREFIX = 'c|validated=true|table="PhysiologyV7Lifecycle"|definition=CHECK ("unifiedTargetRevision"::text = ANY (';
const LIFECYCLE_REVISION_SOURCE_SIGNATURE = `${LIFECYCLE_REVISION_SIGNATURE_PREFIX}ARRAY[${LIFECYCLE_REVISION_VALUES.map((value) => `'${value}'::character varying`).join(", ")}]::text[]))`;
const LIFECYCLE_REVISION_RESTORED_SIGNATURE = `${LIFECYCLE_REVISION_SIGNATURE_PREFIX}ARRAY[${LIFECYCLE_REVISION_VALUES.map((value) => `'${value}'::character varying::text`).join(", ")}]))`;
const PUBLICATION_SOURCE_VALUES = ["health", "day", "training", "stepper"];
const PUBLICATION_SOURCE_SIGNATURE_PREFIX = 'c|validated=true|table="UnifiedPublicationBlock"|definition=CHECK (source::text = ANY (';
const PUBLICATION_SOURCE_CHECK_SIGNATURE = `${PUBLICATION_SOURCE_SIGNATURE_PREFIX}ARRAY[${PUBLICATION_SOURCE_VALUES.map((value) => `'${value}'::character varying`).join(", ")}]::text[]))`;
const PUBLICATION_SOURCE_CHECK_RESTORED_SIGNATURE = `${PUBLICATION_SOURCE_SIGNATURE_PREFIX}ARRAY[${PUBLICATION_SOURCE_VALUES.map((value) => `'${value}'::character varying::text`).join(", ")}]))`;

function canonicalInventorySignature(object) {
  // PostgreSQL 17's dump/reparse moves the varchar[] -> text[] cast onto
  // individual literals in this reviewed CHECK. Admit only the complete exact
  // restored form, retaining the original digest used by existing captures.
  // Any other predicate, validation state, table, kind or object stays exact.
  if (object?.name === LIFECYCLE_REVISION_CONSTRAINT && object.present === true
    && object.kind === "constraint" && object.signature === LIFECYCLE_REVISION_RESTORED_SIGNATURE) {
    return LIFECYCLE_REVISION_SOURCE_SIGNATURE;
  }
  // The same PostgreSQL 17 pg_dump/reparse cast movement applies to this
  // reviewed V4 CHECK. Keep the accepted source and restored predicates exact.
  if (object?.name === "UnifiedPublicationBlock_source_check" && object.present === true
    && object.kind === "constraint" && object.signature === PUBLICATION_SOURCE_CHECK_RESTORED_SIGNATURE) {
    return PUBLICATION_SOURCE_CHECK_SIGNATURE;
  }
  return object?.signature ?? null;
}

export function schemaInventoryDigest(objects) {
  if (!Array.isArray(objects)) throw new Error("Schema inventory is unavailable.");
  const normalized = objects.map((object) => ({
    name: object?.name,
    present: object?.present === true,
    kind: object?.kind ?? null,
    signature: canonicalInventorySignature(object),
  })).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return canonicalSha256(normalized);
}

export function schemaInventoryDifferenceSummary(sourceObjects, restoredObjects, {
  sourceServerVersion = null,
  restoredServerVersion = null,
} = {}) {
  if (!Array.isArray(sourceObjects) || !Array.isArray(restoredObjects)) return null;
  const sourceByName = new Map(sourceObjects.map((object) => [object?.name, object]));
  const restoredByName = new Map(restoredObjects.map((object) => [object?.name, object]));
  const changedObjects = [];

  for (const name of ALL_REVIEWED_OBJECTS) {
    const source = sourceByName.get(name);
    const restored = restoredByName.get(name);
    const changedFields = [];
    if (!source) changedFields.push("missing-from-source");
    if (!restored) changedFields.push("missing-from-restore");
    if (source && restored) {
      if (source.present !== restored.present) changedFields.push("present");
      if ((source.kind ?? null) !== (restored.kind ?? null)) changedFields.push("kind");
      if ((source.signature ?? null) !== (restored.signature ?? null)) changedFields.push("signature");
    }
    if (changedFields.length === 0) continue;

    const sourceHasSignature = typeof source?.signature === "string";
    const restoredHasSignature = typeof restored?.signature === "string";
    changedObjects.push({
      name,
      changedFields,
      ...(changedFields.includes("signature") ? {
        sourceSignatureSha256: sourceHasSignature ? canonicalSha256(source.signature) : null,
        restoredSignatureSha256: restoredHasSignature ? canonicalSha256(restored.signature) : null,
        normalizedSignaturesEqual: sourceHasSignature && restoredHasSignature
          ? normalizeObjectSignature(source.signature) === normalizeObjectSignature(restored.signature)
            || canonicalInventorySignature(source) === canonicalInventorySignature(restored)
          : false,
      } : {}),
    });
  }

  const sourceNames = sourceObjects.map((object) => object?.name).sort((a, b) => String(a).localeCompare(String(b)));
  const restoredNames = restoredObjects.map((object) => object?.name).sort((a, b) => String(a).localeCompare(String(b)));
  return {
    schemaVersion: 1,
    sourceServerVersion: typeof sourceServerVersion === "string" && /^\d+(?:\.\d+){1,2}$/.test(sourceServerVersion) ? sourceServerVersion : null,
    restoredServerVersion: typeof restoredServerVersion === "string" && /^\d+(?:\.\d+){1,2}$/.test(restoredServerVersion) ? restoredServerVersion : null,
    sourceInventorySha256: schemaInventoryDigest(sourceObjects),
    restoredInventorySha256: schemaInventoryDigest(restoredObjects),
    sourceObjectCount: sourceObjects.length,
    restoredObjectCount: restoredObjects.length,
    sourceNameSetSha256: canonicalSha256(sourceNames),
    restoredNameSetSha256: canonicalSha256(restoredNames),
    changedObjectCount: changedObjects.length,
    changedObjects,
  };
}

export function assertProductionDatabaseIdentityMatches(expectedIdentity, actualIdentity) {
  if (!isHistoricalPostgresDatabaseIdentity(expectedIdentity) || !isCanonicalPostgresDatabaseIdentity(actualIdentity)
    || !samePostgresDatabaseIdentity(expectedIdentity, actualIdentity)) {
    throw new Error("Migration blocked: production database identity differs from the signed preflight target.");
  }
  return true;
}

function hasConcretePostgresEndpoint(identity) {
  return isCanonicalPostgresDatabaseIdentity(identity);
}

export function normalizeObjectSignature(signature) {
  if (typeof signature !== "string") return "";

  let normalized = "";
  let pendingSpace = false;
  let quote = null;
  let quoteEscapesBackslash = false;
  let dollarTag = null;
  let lineComment = false;
  let blockCommentDepth = 0;

  const appendCode = (character) => {
    if (pendingSpace && normalized && !normalized.endsWith("(") && !normalized.endsWith(",")) {
      normalized += " ";
    }
    pendingSpace = false;
    normalized += character;
  };

  for (let index = 0; index < signature.length; index += 1) {
    const character = signature[index];

    if (lineComment) {
      if (character === "\n" || character === "\r") {
        lineComment = false;
        pendingSpace = true;
      }
      continue;
    }

    if (blockCommentDepth > 0) {
      if (character === "/" && signature[index + 1] === "*") {
        blockCommentDepth += 1;
        index += 1;
      } else if (character === "*" && signature[index + 1] === "/") {
        blockCommentDepth -= 1;
        index += 1;
        if (blockCommentDepth === 0) pendingSpace = true;
      }
      continue;
    }

    if (quote) {
      normalized += character;
      if (character === quote) {
        if (signature[index + 1] === quote) {
          normalized += signature[index + 1];
          index += 1;
        } else {
          quote = null;
          quoteEscapesBackslash = false;
        }
      } else if (quoteEscapesBackslash && character === "\\" && signature[index + 1] !== undefined) {
        normalized += signature[index + 1];
        index += 1;
      }
      continue;
    }

    if (dollarTag && signature.startsWith(dollarTag, index)) {
      normalized += dollarTag;
      index += dollarTag.length - 1;
      dollarTag = null;
      continue;
    }

    if (character === "-" && signature[index + 1] === "-") {
      lineComment = true;
      index += 1;
      continue;
    }

    if (character === "/" && signature[index + 1] === "*") {
      blockCommentDepth = 1;
      index += 1;
      continue;
    }

    if (/\s/.test(character)) {
      pendingSpace = true;
      continue;
    }

    if (character === "'" || character === '"') {
      appendCode(character);
      quote = character;
      quoteEscapesBackslash = character === "'"
        && /^(?:e|E)$/.test(signature[index - 1] ?? "")
        && !/[A-Za-z0-9_$]/.test(signature[index - 2] ?? "");
      continue;
    }

    if (character === "$") {
      const tag = signature.slice(index).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/)?.[0];
      if (tag) {
        appendCode(tag);
        index += tag.length - 1;
        dollarTag = tag;
        continue;
      }
    }

    if (character === "(") {
      normalized = normalized.trimEnd();
      pendingSpace = false;
      normalized += character;
      continue;
    }

    if (character === ")") {
      normalized = normalized.trimEnd();
      pendingSpace = false;
      normalized += character;
      continue;
    }

    if (character === ",") {
      normalized = normalized.trimEnd();
      normalized += character;
      pendingSpace = true;
      continue;
    }

    appendCode(character);
  }

  return normalized.trim();
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
    for (const row of entries) {
      const validTimestamp = (value) => value === null
        || (typeof value === "string" && Number.isFinite(Date.parse(value)));
      const startMs = Date.parse(row.startedAt ?? "");
      const finishMs = Date.parse(row.finishedAt ?? "");
      const rollbackMs = Date.parse(row.rolledBackAt ?? "");
      if (!/^[a-f0-9]{64}$/.test(String(row.checksum ?? ""))
        || !validTimestamp(row.startedAt) || !row.startedAt
        || !validTimestamp(row.finishedAt) || !validTimestamp(row.rolledBackAt)
        || typeof row.hasLogs !== "boolean" || !/^[a-f0-9]{32}$/.test(String(row.logsFingerprint ?? ""))
        || (row.finishedAt && finishMs < startMs)
        || (row.rolledBackAt && (rollbackMs < startMs || row.finishedAt))) {
        blockers.push(`Production migration history row ${name} has an unknown or malformed execution state.`);
      }
    }
    if (entries.some((row) => row.rolledBackAt)) rolledBack.push(name);
    if (entries.some((row) => row.startedAt && !row.finishedAt && !row.rolledBackAt)) failed.push(name);
    if (entries.length === 1 && entries[0].startedAt && entries[0].finishedAt && !entries[0].rolledBackAt) applied.add(name);
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

function appendRequiredAppliedMigrationBlockers(manifest, rowGroups, applied, blockers) {
  for (const migration of manifest.requiredAppliedMigrations ?? []) {
    const rowsForName = rowGroups.get(migration.name) ?? [];
    if (rowsForName.length !== 1 || !rowsForName[0].finishedAt || rowsForName[0].rolledBackAt || !applied.has(migration.name)) {
      blockers.push(`Required prior migration ${migration.name} is not recorded exactly once as successful.`);
    } else if (rowsForName[0].checksum !== migration.sha256) {
      blockers.push(`Required prior migration ${migration.name} checksum differs from the reviewed Git blob.`);
    }
  }
}

export function evaluateProductionPreflight(report, migrationDirectories, manifestId = ACTIVE_ENERGY_UNIFIED_MANIFEST.id, options = {}) {
  const manifest = getProductionMigrationManifest(manifestId);
  const { blockers, rows, rowGroups, applied, pending, failed, rolledBack, duplicate, unexpected } = migrationState(report, migrationDirectories);
  const partialPendingManifestRows = manifest.migrations
    .map(({ name }) => name)
    .filter((name) => rowGroups.has(name) && !applied.has(name));
  if (partialPendingManifestRows.length) {
    blockers.push(`Pending manifest migration(s) already have incomplete or unknown history rows: ${sorted(partialPendingManifestRows).join(", ")}.`);
  }
  appendRequiredAppliedMigrationBlockers(manifest, rowGroups, applied, blockers);
  const missingManifestDirectories = manifest.migrations.map(({ name }) => name).filter((name) => !migrationDirectories.includes(name));
  if (missingManifestDirectories.length) blockers.push(`Reviewed manifest migrations are missing from the release tree: ${missingManifestDirectories.join(", ")}.`);
  blockers.push(...evaluateProductionMigrationTree(migrationDirectories, manifestId).blockers);
  const expectedPending = sorted(manifest.migrations.map(({ name }) => name));
  if (!sameArray(pending, expectedPending)) blockers.push(`Full release-tree pending set differs from manifest ${manifest.id}: ${sorted(pending).join(", ") || "none"}.`);

  const objectRows = Array.isArray(report?.objects) ? report.objects : [];
  const objectNames = objectRows.map((object) => object?.name);
  if (!sameArray(objectNames, ALL_REVIEWED_OBJECTS)) blockers.push("Schema inventory names do not exactly match the closed production migration manifests.");
  const objectMap = new Map(objectRows.map((object) => [object?.name, object]));
  if (objectRows.some((object) => object?.present === true && (typeof object.signature !== "string" || !object.signature))) {
    blockers.push("Current schema inventory is missing a signature for an existing reviewed object.");
  }
  const partialObjects = (manifest.partialObjects ?? manifest.postflightObjects).filter((name) => objectMap.get(name)?.present === true);
  if (partialObjects.length) blockers.push(`Migration output objects already exist while the exact migration set is pending: ${partialObjects.join(", ")}.`);
  const presentForbiddenObjects = (manifest.requiredAbsentObjectsBefore ?? []).filter((name) => objectMap.get(name)?.present === true);
  if (presentForbiddenObjects.length) blockers.push(`Prior migration output objects should be absent before this migration set: ${presentForbiddenObjects.join(", ")}.`);
  const missingStage02Objects = EXPECTED_MIGRATION_OBJECTS.filter((name) => objectMap.get(name)?.present !== true);
  if (missingStage02Objects.length) blockers.push(`Required Stage 02 schema objects are missing: ${missingStage02Objects.join(", ")}.`);
  const missingObjectsBefore = manifest.requiredObjectsBefore.filter((name) => objectMap.get(name)?.present !== true);
  if (missingObjectsBefore.length) blockers.push(`Required pre-migration schema objects are missing: ${missingObjectsBefore.join(", ")}.`);
  const wrongObjectsBefore = Object.entries(manifest.requiredObjectSignatureIncludes ?? {}).filter(([name, fragment]) => {
    const object = objectMap.get(name);
    return object?.present !== true || typeof object.signature !== "string"
      || !normalizeObjectSignature(object.signature).includes(normalizeObjectSignature(fragment));
  }).map(([name]) => name);
  if (wrongObjectsBefore.length) blockers.push(`Required pre-migration schema signatures differ from the reviewed baseline: ${wrongObjectsBefore.join(", ")}.`);
  const wrongExactObjectsBefore = Object.entries(manifest.requiredObjectSignatureEquals ?? {}).filter(([name, expected]) => {
    const object = objectMap.get(name);
    return object?.present !== true || typeof object.signature !== "string"
      || normalizeObjectSignature(canonicalInventorySignature(object)) !== normalizeObjectSignature(expected);
  }).map(([name]) => name);
  if (wrongExactObjectsBefore.length) blockers.push(`Required exact pre-migration schema signatures differ from the reviewed baseline: ${wrongExactObjectsBefore.join(", ")}.`);
  const changedObjectsBefore = Object.entries(manifest.requiredObjectSignatureExcludes ?? {}).filter(([name, fragment]) => {
    const object = objectMap.get(name);
    return object?.present !== true || typeof object.signature !== "string"
      || normalizeObjectSignature(object.signature).includes(normalizeObjectSignature(fragment));
  }).map(([name]) => name);
  if (changedObjectsBefore.length) blockers.push(`Required pre-migration schema objects already contain target migration changes: ${changedObjectsBefore.join(", ")}.`);

  for (const tableName of manifest.requiredTablesBefore) {
    if (report?.tables?.[tableName]?.exists !== true) blockers.push(`Required production baseline table ${tableName} is missing.`);
  }
  const expectedDatabase = options.expectedDatabase ?? "bodycast";
  const expectedRole = options.expectedRole ?? "bodycast";
  if (report?.identity?.database !== expectedDatabase || report?.identity?.role !== expectedRole) blockers.push("Connected database/role identity differs from the reviewed production target.");
  if (!String(report?.identity?.serverVersion ?? "").startsWith("17.")) blockers.push("Production PostgreSQL version differs from the reviewed major version 17.");
  if (!hasConcretePostgresEndpoint(report?.identity)) blockers.push("Production database endpoint identity is incomplete.");

  const conflictingLocks = report?.conflictingLocks;
  if (!Array.isArray(conflictingLocks)) {
    blockers.push("DDL-conflicting lock inventory is unknown or malformed.");
  } else if (conflictingLocks.length) {
    blockers.push(`${conflictingLocks.length} lock(s) conflict with the exact migration DDL operations.`);
  }
  const preparedTransactions = report?.preparedTransactions;
  const preparedTransactionIds = new Set();
  const preparedTransactionXids = new Set();
  const preparedTransactionsValid = Array.isArray(preparedTransactions) && preparedTransactions.every((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)
      || typeof entry.gid !== "string" || !entry.gid.trim() || Buffer.byteLength(entry.gid, "utf8") >= 200
      || preparedTransactionIds.has(entry.gid)
      || typeof entry.transaction !== "string" || !/^[1-9]\d{0,9}$/.test(entry.transaction)
      || BigInt(entry.transaction) > 4_294_967_295n || preparedTransactionXids.has(entry.transaction)
      || !isValidPreparedTransactionTimestamp(entry.preparedAt)
      || typeof entry.database !== "string" || !entry.database.trim()) return false;
    preparedTransactionIds.add(entry.gid);
    preparedTransactionXids.add(entry.transaction);
    return true;
  });
  if (!preparedTransactionsValid) {
    blockers.push("Prepared transaction state is unknown or prepared-transaction diagnostics are malformed.");
  }
  const writerDrain = evaluateProductionWriterDrain(report);
  blockers.push(...writerDrain.blockers);
  if (!/^[a-f0-9]{64}$/.test(String(report?.logicalDataFingerprint ?? ""))) {
    blockers.push("The production logical data fingerprint is missing or malformed.");
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
    unexpectedPreflightObjects: presentForbiddenObjects,
    migrations: rows,
    objects: objectRows,
    identity: report?.identity ?? null,
    tables: report?.tables ?? {},
    programlessSessionCount: report?.programlessSessionCount ?? null,
    readability: report?.readability ?? null,
    logicalDataFingerprint: report?.logicalDataFingerprint ?? null,
    conflictingLocks,
    preparedTransactions: Array.isArray(preparedTransactions) ? preparedTransactions : [],
    writerDrain: report?.writerDrain ?? null,
    writerDrainReady: writerDrain.ready,
    writerDrainDigest: report?.writerDrain ? canonicalSha256(report.writerDrain) : null,
    diagnostics: { longTransactions: Array.isArray(report?.longTransactions) ? report.longTransactions : [] },
  };
}

export function evaluateProductionPostflight(report, migrationDirectories, manifestId = ACTIVE_ENERGY_UNIFIED_MANIFEST.id, options = {}) {
  const manifest = getProductionMigrationManifest(manifestId);
  const state = migrationState(report, migrationDirectories);
  const blockers = [...state.blockers];
  blockers.push(...evaluateProductionMigrationTree(migrationDirectories, manifestId).blockers);
  appendRequiredAppliedMigrationBlockers(manifest, state.rowGroups, state.applied, blockers);
  if (state.pending.length) blockers.push(`Pending migrations remain after DDL: ${state.pending.join(", ")}.`);
  const objectRows = Array.isArray(report?.objects) ? report.objects : [];
  const names = objectRows.map((entry) => entry?.name);
  if (!sameArray(names, ALL_REVIEWED_OBJECTS)) blockers.push("Postflight object inventory differs from the closed production migration manifests.");
  const byName = new Map(objectRows.map((entry) => [entry?.name, entry]));
  const missing = manifest.postflightObjects.filter((name) => byName.get(name)?.present !== true);
  if (missing.length) blockers.push(`Postflight schema objects are missing: ${missing.join(", ")}.`);
  const missingStage02 = EXPECTED_MIGRATION_OBJECTS.filter((name) => byName.get(name)?.present !== true);
  if (missingStage02.length) blockers.push(`Stage 02 schema objects are missing after migration: ${missingStage02.join(", ")}.`);
  const missingManifestDirectories = manifest.migrations.map(({ name }) => name).filter((name) => !migrationDirectories.includes(name));
  if (missingManifestDirectories.length) blockers.push(`Reviewed manifest migrations are missing from the release tree: ${missingManifestDirectories.join(", ")}.`);
  const unexpectedLegacyIndexes = manifest.postflightAbsentObjects.filter((name) => byName.get(name)?.present === true);
  if (unexpectedLegacyIndexes.length) blockers.push(`Legacy Relative Muscle indexes remain after migration: ${unexpectedLegacyIndexes.join(", ")}.`);
  const wrongRelativeMuscleSignatures = Object.entries(manifest.postflightSignatureIncludes).filter(([name, fragment]) => {
    const object = byName.get(name);
    const signature = canonicalInventorySignature(object);
    return object?.present !== true || typeof object.signature !== "string"
      || typeof signature !== "string" || !normalizeObjectSignature(signature).includes(normalizeObjectSignature(fragment));
  }).map(([name]) => name);
  if (wrongRelativeMuscleSignatures.length) blockers.push(`Relative Muscle postflight schema signatures differ from the reviewed contract: ${wrongRelativeMuscleSignatures.join(", ")}.`);
  const wrongExactPostflightSignatures = Object.entries(manifest.postflightSignatureEquals ?? {}).filter(([name, expected]) => {
    const object = byName.get(name);
    const signature = canonicalInventorySignature(object);
    return object?.present !== true || typeof signature !== "string"
      || normalizeObjectSignature(signature) !== normalizeObjectSignature(expected);
  }).map(([name]) => name);
  if (wrongExactPostflightSignatures.length) blockers.push(`Postflight schema signatures differ from the exact reviewed contract: ${wrongExactPostflightSignatures.join(", ")}.`);
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
  const sourceFingerprint = sourceReport?.logicalDataFingerprint;
  const restoredFingerprint = restoredReport?.logicalDataFingerprint;
  if (!/^[a-f0-9]{64}$/.test(String(sourceFingerprint ?? ""))
    || !/^[a-f0-9]{64}$/.test(String(restoredFingerprint ?? ""))) {
    blockers.push("Source or restored full logical data fingerprint is missing or invalid.");
  } else if (sourceFingerprint !== restoredFingerprint) {
    blockers.push("Restored public-table rows or sequence state differ from the source snapshot.");
  }
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
    const reviewedBlobs = [...new Map([
      ...manifest.migrations,
      ...(manifest.requiredAppliedMigrations ?? []),
    ].map((migration) => [migration.name, migration])).values()];
    for (const migration of reviewedBlobs) {
      const result = await verifyExecutionFileMatchesBlob({ repositoryPath, releaseSha, migration });
      files.push(result);
    }
    const result = { exactExecutionBytes: files.every((item) => item.exactMatch), files };
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.exactExecutionBytes) {
      const mismatchCount = files.filter((item) => !item.exactMatch).length;
      process.stderr.write(`Migration execution-integrity check failed (mismatch-count=${mismatchCount}).\n`);
      process.exitCode = 1;
    }
    return;
  }
  if (mode === "--verify-release-tree" || mode === "--preflight" || mode === "--postflight") {
    const value = (flag) => { const index = args.indexOf(flag); return index < 0 ? null : args[index + 1]; };
    const manifestId = value("--manifest") ?? ACTIVE_ENERGY_UNIFIED_MANIFEST.id;
    const repositoryPath = value("--repository") ?? process.cwd();
    const migrationDirectories = (await readdir(path.resolve(repositoryPath, "prisma/migrations"), { withFileTypes: true }))
      .filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    if (mode === "--verify-release-tree") {
      const result = evaluateProductionMigrationTree(migrationDirectories, manifestId);
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      if (!result.ready) {
        process.stderr.write(`Release migration tree verification failed (blocker-count=${result.blockers.length}).\n`);
        process.exitCode = 1;
      }
      return;
    }
    const reportPath = value("--report");
    const report = await readJsonInput(reportPath);
    let result;
    if (mode === "--preflight") {
      result = evaluateProductionPreflight(report, migrationDirectories, manifestId);
      const manifest = getProductionMigrationManifest(manifestId);
      const integrity = [];
      const reviewedMigrations = [...new Map([
        ...STAGE_02_MANIFEST.migrations,
        ...manifest.migrations,
        ...(manifest.requiredAppliedMigrations ?? []),
      ].map((migration) => [migration.name, migration])).values()];
      for (const migration of reviewedMigrations) {
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
    if (mode === "--preflight" ? !result.readyForOwnerAuthorization : !result.ready) {
      const blockers = Array.isArray(result.blockers) ? result.blockers.filter((blocker) => typeof blocker === "string") : [];
      const categories = safeBlockerCategories(blockers);
      const summary = categories.length ? categories.join(",") : "unclassified";
      process.stderr.write(`${mode === "--preflight" ? "Production migration preflight" : "Production migration postflight"} failed (blocker-count=${blockers.length}; categories=${summary}).\n`);
      process.exitCode = 1;
    }
    return;
  }
  throw new Error("Usage: production-migration-preflight.mjs --verify-release-tree|--preflight|--postflight|--execution-integrity|--verify-restore|--verify-authorization ...");
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
