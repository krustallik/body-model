import { execFileSync } from "node:child_process";
import { lstat, mkdir, open, readFile, readdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { canonicalSha256 } from "./production-migration-authorization.mjs";
import { isCanonicalPostgresDatabaseIdentity } from "./postgres-database-identity.mjs";
import { schemaInventoryDigest, verifyRestoredBackup } from "./production-migration-preflight.mjs";
import { productionAppRuntimeDigest } from "./production-app-runtime-digest.mjs";
import { renderProductionDbPreflightSql } from "./production-db-preflight.mjs";

export const PREVIOUS_APP_PROVENANCE_SCHEMA_VERSION = 2;
export const LEGACY_PREVIOUS_APP_PROVENANCE = "legacy-unlabeled-v1";
export const CUTBACK_LEGACY_PREVIOUS_APP_PROVENANCE = "legacy-cutback-receipt-v1";
export const SHA_PREVIOUS_APP_PROVENANCE = "release-sha-v1";
export const CUTBACK_RECEIPT_SCHEMA_VERSION = 1;
export const CUTBACK_RECEIPT_PURPOSE = "bodycast-verified-cutback-v1";
export const PREVIOUS_APP_COMPATIBILITY_SNAPSHOT_CONTRACT = "bodycast-previous-app-compatibility-snapshot-v1";
export const LEGACY_UNKNOWN_RELEASE_LABEL = "unknown";

const RELEASE_SHA_LABEL = "org.bodycast.release-sha";
const HEX_256 = /^[a-f0-9]{64}$/;
const IMAGE_ID = /^sha256:[a-f0-9]{64}$/;
const CONTAINER_ID = /^[a-f0-9]{64}$/;
const RELEASE_SHA = /^[a-f0-9]{40}$/;
const RUN_ID = /^[1-9][0-9]*$/;

export function previousAppDatabaseCompatibilityDigests(report) {
  const identity = report?.identity;
  const migrations = report?.migrations;
  const objects = report?.objects;
  if (!isCanonicalPostgresDatabaseIdentity(identity) || !Array.isArray(migrations) || migrations.length === 0 || !Array.isArray(objects)) {
    throw new Error("Previous-app database compatibility evidence is incomplete.");
  }
  if (identity.role !== "bodycast" || !String(identity.serverVersion).startsWith("17.")) {
    throw new Error("Previous-app database compatibility evidence is not from the reviewed PostgreSQL role/version.");
  }

  const seen = new Set();
  for (const migration of migrations) {
    if (!migration || typeof migration.name !== "string" || !migration.name
      || !HEX_256.test(String(migration.checksum ?? ""))
      || !migration.startedAt || !migration.finishedAt || migration.rolledBackAt) {
      throw new Error("Previous-app database migration history is incomplete or invalid.");
    }
    if (seen.has(migration.name)) throw new Error("Previous-app database migration history contains duplicate names.");
    seen.add(migration.name);
  }
  if (!objects.length || objects.some((object) => !object || typeof object.name !== "string" || !object.name
    || typeof object.present !== "boolean"
    || (object.present && (typeof object.signature !== "string" || !object.signature)))) {
    throw new Error("Previous-app database schema inventory is incomplete.");
  }

  const databaseIdentityDigest = canonicalSha256(identity);
  const migrationHistoryDigest = canonicalSha256(migrations);
  const schemaDigest = schemaInventoryDigest(objects);
  const compatibilityDigest = canonicalSha256({ identity, migrations, objects });
  return { databaseIdentityDigest, migrationHistoryDigest, schemaDigest, compatibilityDigest };
}

export function assertPreviousAppCompatibilitySnapshot(report) {
  const drain = report?.writerDrain;
  const topology = drain?.topology;
  const expectedBlocker = "writer drain is not asserted by a previous-app compatibility snapshot";
  if (!drain || drain.schemaVersion !== 1 || !Number.isSafeInteger(drain.observerPid) || drain.observerPid < 1
    || typeof drain.observedAt !== "string" || !Number.isFinite(Date.parse(drain.observedAt))
    || drain.observerApplicationName !== "bodycast-production-preflight"
    || drain.identityPolicy !== "no-other-client-backends" || !Array.isArray(drain.activeClientBackends)
    || topology?.schemaVersion !== 1 || topology.contract !== PREVIOUS_APP_COMPATIBILITY_SNAPSHOT_CONTRACT
    || topology.ready !== false || !Array.isArray(topology.blockers)
    || topology.blockers.length !== 1 || topology.blockers[0] !== expectedBlocker) {
    throw new Error("Previous-app provenance requires the explicit non-admission compatibility snapshot contract.");
  }
  return true;
}

const CUTBACK_RECEIPT_FIELDS = Object.freeze([
  "schemaVersion", "purpose", "cutbackRunId", "cutbackRunAttempt", "releaseSha", "sourceMarkerDigest",
  "previousImageId", "previousContainerId", "previousHealth", "previousRuntimeConfigDigest",
  "databaseIdentityDigest", "migrationHistoryDigest", "schemaDigest", "databaseCompatibilityDigest", "completedAt", "receiptDigest",
]);

export function createVerifiedCutbackReceipt({ container, databaseReport, cutbackRunId, cutbackRunAttempt, releaseSha, sourceMarkerDigest,
  completedAt = new Date().toISOString() }) {
  if (!RUN_ID.test(String(cutbackRunId ?? "")) || !Number.isSafeInteger(cutbackRunAttempt) || cutbackRunAttempt < 1
    || !RELEASE_SHA.test(String(releaseSha ?? "")) || !HEX_256.test(String(sourceMarkerDigest ?? ""))) {
    throw new Error("Cutback receipt workflow and marker lineage are malformed.");
  }
  if (!container || !CONTAINER_ID.test(String(container.Id ?? "")) || !IMAGE_ID.test(String(container.Image ?? ""))
    || container?.State?.Health?.Status !== "healthy" || container?.Config?.Labels?.[RELEASE_SHA_LABEL] !== LEGACY_UNKNOWN_RELEASE_LABEL) {
    throw new Error("Cutback receipt requires the positively healthy immutable legacy app with its explicit unknown release label.");
  }
  const digests = previousAppDatabaseCompatibilityDigests(databaseReport);
  const receipt = {
    schemaVersion: CUTBACK_RECEIPT_SCHEMA_VERSION,
    purpose: CUTBACK_RECEIPT_PURPOSE,
    cutbackRunId: String(cutbackRunId),
    cutbackRunAttempt,
    releaseSha,
    sourceMarkerDigest,
    previousImageId: container.Image,
    previousContainerId: container.Id,
    previousHealth: container.State.Health.Status,
    previousRuntimeConfigDigest: productionAppRuntimeDigest(container),
    databaseIdentityDigest: digests.databaseIdentityDigest,
    migrationHistoryDigest: digests.migrationHistoryDigest,
    schemaDigest: digests.schemaDigest,
    databaseCompatibilityDigest: digests.compatibilityDigest,
    completedAt,
  };
  if (!Number.isFinite(Date.parse(completedAt))) throw new Error("Cutback receipt timestamp is invalid.");
  return Object.freeze({ ...receipt, receiptDigest: canonicalSha256(receipt) });
}

export function validateVerifiedCutbackReceipt(receipt, { container, databaseReport, expectedReleaseSha } = {}) {
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)
    || JSON.stringify(Object.keys(receipt).sort()) !== JSON.stringify([...CUTBACK_RECEIPT_FIELDS].sort())
    || receipt.schemaVersion !== CUTBACK_RECEIPT_SCHEMA_VERSION || receipt.purpose !== CUTBACK_RECEIPT_PURPOSE
    || !RUN_ID.test(String(receipt.cutbackRunId ?? "")) || !Number.isSafeInteger(receipt.cutbackRunAttempt) || receipt.cutbackRunAttempt < 1
    || !RELEASE_SHA.test(String(receipt.releaseSha ?? "")) || (expectedReleaseSha && receipt.releaseSha !== expectedReleaseSha)
    || !HEX_256.test(String(receipt.sourceMarkerDigest ?? "")) || !IMAGE_ID.test(String(receipt.previousImageId ?? ""))
    || !CONTAINER_ID.test(String(receipt.previousContainerId ?? "")) || receipt.previousHealth !== "healthy"
    || !HEX_256.test(String(receipt.previousRuntimeConfigDigest ?? ""))
    || !HEX_256.test(String(receipt.databaseIdentityDigest ?? "")) || !HEX_256.test(String(receipt.migrationHistoryDigest ?? ""))
    || !HEX_256.test(String(receipt.schemaDigest ?? "")) || !HEX_256.test(String(receipt.databaseCompatibilityDigest ?? ""))
    || !Number.isFinite(Date.parse(receipt.completedAt)) || !HEX_256.test(String(receipt.receiptDigest ?? ""))) {
    throw new Error("Verified cutback receipt is missing, malformed, or has unsupported fields.");
  }
  const { receiptDigest, ...body } = receipt;
  if (canonicalSha256(body) !== receiptDigest) throw new Error("Verified cutback receipt digest is invalid.");
  if (!container || container?.Config?.Labels?.[RELEASE_SHA_LABEL] !== LEGACY_UNKNOWN_RELEASE_LABEL
    || container.Id !== receipt.previousContainerId || container.Image !== receipt.previousImageId
    || container?.State?.Health?.Status !== "healthy"
    || productionAppRuntimeDigest(container) !== receipt.previousRuntimeConfigDigest) {
    throw new Error("The current legacy app image, container, runtime configuration, or health differs from the durable cutback receipt.");
  }
  const digests = previousAppDatabaseCompatibilityDigests(databaseReport);
  if (digests.databaseIdentityDigest !== receipt.databaseIdentityDigest
    || digests.migrationHistoryDigest !== receipt.migrationHistoryDigest
    || digests.schemaDigest !== receipt.schemaDigest
    || digests.compatibilityDigest !== receipt.databaseCompatibilityDigest) {
    throw new Error("The current PostgreSQL identity, schema, or migration history differs from the durable cutback receipt.");
  }
  return true;
}

export function capturePreviousAppProvenance({ container, databaseReport, targetSha, cutbackReceipt = null }) {
  if (!RELEASE_SHA.test(String(targetSha ?? ""))) throw new Error("Previous-app capture requires the exact target release SHA.");
  if (!container || typeof container !== "object" || Array.isArray(container)
    || !CONTAINER_ID.test(String(container.Id ?? "")) || !IMAGE_ID.test(String(container.Image ?? ""))) {
    throw new Error("Previous-app immutable container or image identity is unavailable.");
  }
  if (container?.State?.Health?.Status !== "healthy") throw new Error("Previous app is not positively health-checked.");
  const labels = container?.Config?.Labels;
  if (labels !== null && labels !== undefined && (typeof labels !== "object" || Array.isArray(labels))) {
    throw new Error("Previous-app Docker labels are malformed.");
  }

  const hasReleaseSha = labels !== null && labels !== undefined && Object.hasOwn(labels, RELEASE_SHA_LABEL);
  let provenanceKind = LEGACY_PREVIOUS_APP_PROVENANCE;
  let previousSha = "unavailable";
  if (hasReleaseSha) {
    previousSha = labels[RELEASE_SHA_LABEL];
    if (previousSha === LEGACY_UNKNOWN_RELEASE_LABEL) {
      if (!cutbackReceipt) throw new Error("A present unknown previous-app release label requires a verified durable cutback receipt.");
      validateVerifiedCutbackReceipt(cutbackReceipt, { container, databaseReport });
      provenanceKind = CUTBACK_LEGACY_PREVIOUS_APP_PROVENANCE;
      previousSha = "unavailable";
    } else if (!RELEASE_SHA.test(String(previousSha ?? ""))) {
      throw new Error("A present previous-app release SHA label is invalid; only a genuinely absent label may use legacy provenance.");
    } else {
      provenanceKind = SHA_PREVIOUS_APP_PROVENANCE;
    }
  }

  const digests = previousAppDatabaseCompatibilityDigests(databaseReport);
  return Object.freeze({
    schemaVersion: PREVIOUS_APP_PROVENANCE_SCHEMA_VERSION,
    targetSha,
    provenanceKind,
    previousSha,
    previousImageId: container.Image,
    previousContainerId: container.Id,
    previousHealth: container.State.Health.Status,
    previousRuntimeConfigDigest: productionAppRuntimeDigest(container),
    ...Object.fromEntries(Object.entries(digests).map(([key, value]) => [
      ({ databaseIdentityDigest: "preDdlDatabaseIdentityDigest", migrationHistoryDigest: "preDdlMigrationHistoryDigest",
        schemaDigest: "preDdlSchemaInventoryDigest", compatibilityDigest: "preDdlDatabaseCompatibilityDigest" })[key], value,
    ])),
  });
}

const RECORD_FIELDS = Object.freeze([
  ["schemaVersion", "schemaVersion"],
  ["targetSha", "targetSha"],
  ["provenanceKind", "provenanceKind"],
  ["previousSha", "previousSha"],
  ["previousImageId", "previousImageId"],
  ["previousContainerId", "previousContainerId"],
  ["previousHealth", "previousHealth"],
  ["previousRuntimeConfigDigest", "previousRuntimeConfigDigest"],
  ["preDdlDatabaseIdentityDigest", "preDdlDatabaseIdentityDigest"],
  ["preDdlMigrationHistoryDigest", "preDdlMigrationHistoryDigest"],
  ["preDdlSchemaInventoryDigest", "preDdlSchemaInventoryDigest"],
  ["preDdlDatabaseCompatibilityDigest", "preDdlDatabaseCompatibilityDigest"],
]);

export function serializePreviousAppProvenance(record) {
  validatePreviousAppProvenance(record);
  return `${RECORD_FIELDS.map(([field, key]) => `${field}=${record[key]}`).join("\n")}\n`;
}

export function parsePreviousAppProvenance(text) {
  if (typeof text !== "string" || Buffer.byteLength(text, "utf8") > 4096) {
    throw new Error("Previous-app provenance record is missing or exceeds its bound.");
  }
  const lines = text.trimEnd().split(/\r?\n/);
  if (lines.length !== RECORD_FIELDS.length) throw new Error("Previous-app provenance record has an unsupported field count.");
  const record = {};
  for (const [index, [field, key]] of RECORD_FIELDS.entries()) {
    const prefix = `${field}=`;
    if (!lines[index].startsWith(prefix)) throw new Error("Previous-app provenance record fields are not canonical.");
    record[key] = lines[index].slice(prefix.length);
  }
  record.schemaVersion = Number(record.schemaVersion);
  validatePreviousAppProvenance(record);
  return Object.freeze(record);
}

export function validatePreviousAppProvenance(record, expectedTargetSha) {
  if (!record || typeof record !== "object" || Array.isArray(record)
    || record.schemaVersion !== PREVIOUS_APP_PROVENANCE_SCHEMA_VERSION
    || !RELEASE_SHA.test(String(record.targetSha ?? ""))
    || (expectedTargetSha && record.targetSha !== expectedTargetSha)
    || !IMAGE_ID.test(String(record.previousImageId ?? ""))
    || !CONTAINER_ID.test(String(record.previousContainerId ?? ""))
    || record.previousHealth !== "healthy"
    || !HEX_256.test(String(record.previousRuntimeConfigDigest ?? ""))
    || !HEX_256.test(String(record.preDdlDatabaseIdentityDigest ?? ""))
    || !HEX_256.test(String(record.preDdlMigrationHistoryDigest ?? ""))
    || !HEX_256.test(String(record.preDdlSchemaInventoryDigest ?? ""))
    || !HEX_256.test(String(record.preDdlDatabaseCompatibilityDigest ?? ""))) {
    throw new Error("Previous-app provenance identity or compatibility fields are malformed.");
  }
  if (record.provenanceKind === SHA_PREVIOUS_APP_PROVENANCE) {
    if (!RELEASE_SHA.test(String(record.previousSha ?? ""))) throw new Error("SHA-based previous-app provenance is invalid.");
  } else if (record.provenanceKind === LEGACY_PREVIOUS_APP_PROVENANCE || record.provenanceKind === CUTBACK_LEGACY_PREVIOUS_APP_PROVENANCE) {
    if (record.previousSha !== "unavailable") throw new Error("Legacy previous-app provenance must not invent a source commit SHA.");
  } else {
    throw new Error("Previous-app provenance kind is unknown.");
  }
  return true;
}

export function previousAppProvenanceBinding(record) {
  validatePreviousAppProvenance(record);
  return Object.freeze({
    schemaVersion: record.schemaVersion,
    provenanceKind: record.provenanceKind,
    recordDigest: canonicalSha256(record),
    previousSha: record.previousSha,
    previousImageId: record.previousImageId,
    previousContainerId: record.previousContainerId,
    previousHealth: record.previousHealth,
    previousRuntimeConfigDigest: record.previousRuntimeConfigDigest,
  });
}

export function assertPreviousAppProvenanceBoundToPreflight(record, preflightResult) {
  const expected = previousAppProvenanceBinding(record);
  const binding = preflightResult?.previousAppProvenance;
  if (!binding || typeof binding !== "object" || Array.isArray(binding)
    || canonicalSha256(binding) !== canonicalSha256(expected)) {
    throw new Error("Previous-app image, container, health, runtime, or provenance identity differs from the owner-signed preflight binding.");
  }
  return { verified: true, recordDigest: expected.recordDigest, provenanceKind: expected.provenanceKind };
}

export function verifyPreviousAppCaptureMatchesPreflight(record, preflightResult, expectedTargetSha) {
  validatePreviousAppProvenance(record, expectedTargetSha);
  if (preflightResult?.readyForOwnerAuthorization !== true || preflightResult?.blockers?.length
    || preflightResult?.pendingExactlyExpected !== true) {
    throw new Error("The signed production preflight is not a complete admitted baseline.");
  }
  const digests = previousAppDatabaseCompatibilityDigests(preflightResult);
  if (digests.databaseIdentityDigest !== record.preDdlDatabaseIdentityDigest
    || digests.migrationHistoryDigest !== record.preDdlMigrationHistoryDigest
    || digests.schemaDigest !== record.preDdlSchemaInventoryDigest
    || digests.compatibilityDigest !== record.preDdlDatabaseCompatibilityDigest) {
    throw new Error("Previous-app DB migration history, schema, or identity changed before the signed preflight snapshot.");
  }
  return { verified: true, provenanceKind: record.provenanceKind, compatibilityDigest: digests.compatibilityDigest,
    previousAppProvenance: previousAppProvenanceBinding(record) };
}

export function rebindPreviousAppProvenanceForPreflightResume({
  record, sourceSha, targetSha, sourceRunId, sourceRunAttempt, databaseReport,
}) {
  validatePreviousAppProvenance(record, sourceSha);
  if (!RELEASE_SHA.test(String(targetSha ?? ""))
    || !/^[1-9][0-9]*$/.test(String(sourceRunId ?? ""))
    || !Number.isSafeInteger(sourceRunAttempt) || sourceRunAttempt < 1) {
    throw new Error("Preflight resume identity is malformed.");
  }
  const digests = previousAppDatabaseCompatibilityDigests(databaseReport);
  if (digests.databaseIdentityDigest !== record.preDdlDatabaseIdentityDigest
    || digests.migrationHistoryDigest !== record.preDdlMigrationHistoryDigest
    || digests.schemaDigest !== record.preDdlSchemaInventoryDigest
    || digests.compatibilityDigest !== record.preDdlDatabaseCompatibilityDigest) {
    throw new Error("The current production DB identity, migration history, or schema differs from the durable pre-DDL app capture.");
  }
  const reboundRecord = Object.freeze({ ...record, targetSha });
  validatePreviousAppProvenance(reboundRecord, targetSha);
  const receipt = Object.freeze({
    schemaVersion: 1,
    sourceRunId: String(sourceRunId),
    sourceRunAttempt,
    sourceSha,
    targetSha,
    sourceRecordDigest: canonicalSha256(record),
    currentRecordDigest: canonicalSha256(reboundRecord),
    compatibilityDigest: digests.compatibilityDigest,
  });
  return Object.freeze({ record: reboundRecord, recordText: serializePreviousAppProvenance(reboundRecord), receipt });
}

export function verifyLegacyPreviousAppRestoredCompatibility({
  record, targetSha, preflightResult, preflightResultDigest, contextVerified, restoredReport, restoreResult, readabilityReport,
}) {
  validatePreviousAppProvenance(record, targetSha);
  if (![LEGACY_PREVIOUS_APP_PROVENANCE, CUTBACK_LEGACY_PREVIOUS_APP_PROVENANCE].includes(record.provenanceKind) || record.previousSha !== "unavailable") {
    throw new Error("Legacy DB compatibility verification requires explicit legacy-unlabeled provenance.");
  }
  if (contextVerified !== true || preflightResultDigest !== canonicalSha256(preflightResult)) {
    throw new Error("Legacy app compatibility is not bound to the verified owner-signed preflight result.");
  }
  const digests = previousAppDatabaseCompatibilityDigests(preflightResult);
  if (digests.databaseIdentityDigest !== record.preDdlDatabaseIdentityDigest
    || digests.migrationHistoryDigest !== record.preDdlMigrationHistoryDigest
    || digests.schemaDigest !== record.preDdlSchemaInventoryDigest
    || digests.compatibilityDigest !== record.preDdlDatabaseCompatibilityDigest) {
    throw new Error("Legacy app capture does not match the signed pre-DDL database identity, migration history, and schema.");
  }
  const baselineRestore = verifyRestoredBackup(preflightResult, {
    ...restoredReport,
    readability: readabilityReport?.readability,
  });
  if (!baselineRestore.verified) throw new Error(`Restored legacy-app baseline is incompatible: ${baselineRestore.blockers.join(" ")}`);
  const expectedRows = restoreResult?.readability;
  const actualRows = readabilityReport?.readability;
  if (!expectedRows || !actualRows) throw new Error("Legacy-app restored data readability evidence is missing.");
  for (const tableName of ["Workout", "Profile", "ModelEpisode", "PhysiologyV7Lifecycle", "DailyModelState", "StrengthDiarySession", "ExerciseCatalog"]) {
    const expected = expectedRows?.[tableName]?.rowCount;
    const actual = actualRows?.[tableName]?.rowCount;
    if (!Number.isSafeInteger(expected) || !Number.isSafeInteger(actual) || expected !== actual) {
      throw new Error(`Legacy-app restored baseline data differs from the independently rehearsed snapshot (${tableName}).`);
    }
  }
  return { verified: true, provenanceKind: record.provenanceKind, restoredMigrationCount: baselineRestore.migrationCount,
    schemaDigest: digests.schemaDigest, migrationHistoryDigest: digests.migrationHistoryDigest };
}

function readBoundedStdin(maxBytes = 64 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    process.stdin.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        reject(new Error("Previous-app capture input exceeded its bound."));
        process.stdin.destroy();
        return;
      }
      chunks.push(chunk);
    });
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", reject);
  });
}

async function readReceiptFile(receiptPath) {
  const details = await lstat(receiptPath).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
  if (!details) return null;
  if (!details.isFile() || details.isSymbolicLink() || details.size > 16 * 1024) {
    throw new Error("Durable cutback receipt is unsafe or exceeds its bound.");
  }
  return JSON.parse(await readFile(receiptPath, "utf8"));
}

export async function readVerifiedCutbackReceiptFromGitDir(gitDir, { container, databaseReport } = {}) {
  const candidates = [];
  const legacyPath = path.join(gitDir, "bodycast-production-cutback-receipt.json");
  const legacyReceipt = await readReceiptFile(legacyPath);
  if (legacyReceipt) candidates.push(legacyReceipt);

  const receiptDir = path.join(gitDir, "bodycast-production-cutback-receipts");
  const dirDetails = await lstat(receiptDir).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
  if (dirDetails) {
    if (!dirDetails.isDirectory() || dirDetails.isSymbolicLink() || (dirDetails.mode & 0o077) !== 0) {
      throw new Error("Durable cutback receipt directory is unsafe or not private.");
    }
    const names = await readdir(receiptDir);
    if (names.length > 256 || names.some((name) => !/^[1-9][0-9]*-[1-9][0-9]*\.json$/.test(name))) {
      throw new Error("Durable cutback receipt inventory is malformed or exceeds its bound.");
    }
    for (const name of names) {
      const receipt = await readReceiptFile(path.join(receiptDir, name));
      if (receipt) candidates.push(receipt);
    }
  }

  if (!candidates.length) return null;
  const liveDigests = previousAppDatabaseCompatibilityDigests(databaseReport);
  const matches = [];
  for (const receipt of candidates) {
    if (receipt?.previousContainerId !== container?.Id || receipt?.previousImageId !== container?.Image
      || receipt?.previousRuntimeConfigDigest !== productionAppRuntimeDigest(container)
      || receipt?.databaseIdentityDigest !== liveDigests.databaseIdentityDigest
      || receipt?.migrationHistoryDigest !== liveDigests.migrationHistoryDigest
      || receipt?.schemaDigest !== liveDigests.schemaDigest
      || receipt?.databaseCompatibilityDigest !== liveDigests.compatibilityDigest) continue;
    validateVerifiedCutbackReceipt(receipt, { container, databaseReport });
    matches.push(receipt);
  }
  if (matches.length > 1) throw new Error("Multiple durable cutback receipts match the current legacy app and database state.");
  return matches[0] ?? null;
}

export async function persistVerifiedCutbackReceipt(gitDir, receipt) {
  const receiptDir = path.join(gitDir, "bodycast-production-cutback-receipts");
  await mkdir(receiptDir, { mode: 0o700 }).catch((error) => {
    if (error?.code !== "EEXIST") throw error;
  });
  const dirDetails = await lstat(receiptDir);
  if (!dirDetails.isDirectory() || dirDetails.isSymbolicLink() || (dirDetails.mode & 0o077) !== 0) {
    throw new Error("Durable cutback receipt directory is unsafe or not private.");
  }
  const receiptPath = path.join(receiptDir, `${receipt.cutbackRunId}-${receipt.cutbackRunAttempt}.json`);
  const handle = await open(receiptPath, "wx", 0o600);
  try { await handle.writeFile(`${JSON.stringify(receipt)}\n`, "utf8"); await handle.sync(); } finally { await handle.close(); }
  const directory = await open(receiptDir, "r");
  try { await directory.sync(); } finally { await directory.close(); }
  return receiptPath;
}

async function readCurrentPreviousAppDatabaseReport(rootDir) {
  const preflightSql = renderProductionDbPreflightSql(await readFile(path.join(rootDir, "scripts/production-db-preflight.sql"), "utf8"));
  const databaseJson = execFileSync("bash", [path.join(rootDir, "scripts/production-db-target.sh"), "--previous-app-compatibility-snapshot", "bodycast-db-prod"], {
    encoding: "utf8", input: preflightSql, maxBuffer: 8 * 1024 * 1024, env: process.env,
  });
  const databaseReport = JSON.parse(databaseJson);
  assertPreviousAppCompatibilitySnapshot(databaseReport);
  return databaseReport;
}

async function main() {
  const [mode, ...args] = process.argv.slice(2);
  if (mode === "capture") {
    const [targetSha] = args;
    const rootDir = process.cwd();
    const containerJson = execFileSync("bash", ["--noprofile", "--norc", "-c", "exec docker inspect bodycast-app-prod"], {
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 4 * 1024 * 1024,
    });
    const containers = JSON.parse(containerJson);
    if (!Array.isArray(containers) || containers.length !== 1) throw new Error("Previous-app Docker inspection did not return one container.");
    const databaseReport = await readCurrentPreviousAppDatabaseReport(rootDir);
    const gitDir = execFileSync("git", ["rev-parse", "--absolute-git-dir"], { cwd: rootDir, encoding: "utf8" }).trim();
    const cutbackReceipt = await readVerifiedCutbackReceiptFromGitDir(gitDir, { container: containers[0], databaseReport });
    const record = capturePreviousAppProvenance({ container: containers[0], databaseReport, targetSha, cutbackReceipt });
    process.stdout.write(serializePreviousAppProvenance(record));
    return;
  }
  if (mode === "--create-cutback-receipt") {
    if (args.length !== 5) throw new Error("Usage: --create-cutback-receipt <live-report.json> <cutback-run-id> <cutback-run-attempt> <release-sha> <source-marker-digest> (Docker inspect JSON on stdin)");
    const [reportPath, runId, attemptText, releaseSha, sourceMarkerDigest] = args;
    if (!RUN_ID.test(attemptText)) throw new Error("Cutback workflow attempt is malformed.");
    const containers = JSON.parse(await readBoundedStdin(4 * 1024 * 1024));
    if (!Array.isArray(containers) || containers.length !== 1) throw new Error("Cutback app inspection did not return exactly one container.");
    const databaseReport = JSON.parse(await readFile(reportPath, "utf8"));
    const receipt = createVerifiedCutbackReceipt({ container: containers[0], databaseReport, cutbackRunId: runId,
      cutbackRunAttempt: Number(attemptText), releaseSha, sourceMarkerDigest });
    const gitDir = execFileSync("git", ["rev-parse", "--absolute-git-dir"], { cwd: process.cwd(), encoding: "utf8" }).trim();
    await persistVerifiedCutbackReceipt(gitDir, receipt);
    process.stdout.write(`${JSON.stringify({ receiptDigest: receipt.receiptDigest, schemaVersion: receipt.schemaVersion })}\n`);
    return;
  }
  if (mode === "--resume-capture") {
    if (args.length !== 4) throw new Error("Usage: --resume-capture <source-sha> <target-sha> <source-run-id> <source-run-attempt> (capture record on stdin)");
    const [sourceSha, targetSha, sourceRunId, sourceAttemptText] = args;
    if (!/^[1-9][0-9]*$/.test(sourceAttemptText)) throw new Error("Preflight resume source attempt is invalid.");
    const record = parsePreviousAppProvenance(await readBoundedStdin());
    const databaseReport = await readCurrentPreviousAppDatabaseReport(process.cwd());
    const result = rebindPreviousAppProvenanceForPreflightResume({
      record, sourceSha, targetSha, sourceRunId, sourceRunAttempt: Number(sourceAttemptText), databaseReport,
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  if (mode === "--verify-preflight") {
    if (args.length !== 2) throw new Error("Usage: --verify-preflight <preflight-result.json> <exact-release-sha> (capture record on stdin)");
    const [reportPath, targetSha] = args;
    const record = parsePreviousAppProvenance(await readBoundedStdin());
    const preflightResult = JSON.parse(await readFile(reportPath, "utf8"));
    const result = verifyPreviousAppCaptureMatchesPreflight(record, preflightResult, targetSha);
    process.stdout.write(`${JSON.stringify({ verified: true, previousAppProvenance: result.previousAppProvenance })}\n`);
    return;
  }
  throw new Error("Usage: production-previous-app-provenance.mjs capture <target-sha>|--resume-capture <source-sha> <target-sha> <source-run-id> <source-run-attempt>|--verify-preflight <preflight-result.json>");
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
