import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { canonicalSha256 } from "./production-migration-authorization.mjs";
import { isCanonicalPostgresDatabaseIdentity } from "./postgres-database-identity.mjs";
import { schemaInventoryDigest, verifyRestoredBackup } from "./production-migration-preflight.mjs";
import { productionAppRuntimeDigest } from "./production-app-runtime-digest.mjs";

export const PREVIOUS_APP_PROVENANCE_SCHEMA_VERSION = 2;
export const LEGACY_PREVIOUS_APP_PROVENANCE = "legacy-unlabeled-v1";
export const SHA_PREVIOUS_APP_PROVENANCE = "release-sha-v1";
export const LEGACY_UNKNOWN_RELEASE_LABEL = "unknown";

const RELEASE_SHA_LABEL = "org.bodycast.release-sha";
const HEX_256 = /^[a-f0-9]{64}$/;
const IMAGE_ID = /^sha256:[a-f0-9]{64}$/;
const CONTAINER_ID = /^[a-f0-9]{64}$/;
const RELEASE_SHA = /^[a-f0-9]{40}$/;

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

export function capturePreviousAppProvenance({ container, databaseReport, targetSha }) {
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
    if (!RELEASE_SHA.test(String(previousSha ?? ""))) {
      throw new Error("A present previous-app release SHA label is invalid; only a genuinely absent label may use legacy provenance.");
    }
    provenanceKind = SHA_PREVIOUS_APP_PROVENANCE;
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
  } else if (record.provenanceKind === LEGACY_PREVIOUS_APP_PROVENANCE) {
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

export function verifyLegacyPreviousAppRestoredCompatibility({
  record, targetSha, preflightResult, preflightResultDigest, contextVerified, restoredReport, restoreResult, readabilityReport,
}) {
  validatePreviousAppProvenance(record, targetSha);
  if (record.provenanceKind !== LEGACY_PREVIOUS_APP_PROVENANCE || record.previousSha !== "unavailable") {
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

async function main() {
  const [mode, ...args] = process.argv.slice(2);
  if (mode === "capture") {
    const [targetSha] = args;
    const rootDir = process.cwd();
    const containerJson = execFileSync("docker", ["inspect", "bodycast-app-prod"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 4 * 1024 * 1024 });
    const containers = JSON.parse(containerJson);
    if (!Array.isArray(containers) || containers.length !== 1) throw new Error("Previous-app Docker inspection did not return one container.");
    const databaseJson = execFileSync("bash", [path.join(rootDir, "scripts/production-db-target.sh"), "--preflight", "bodycast-db-prod"], {
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 8 * 1024 * 1024, env: process.env,
    });
    const record = capturePreviousAppProvenance({ container: containers[0], databaseReport: JSON.parse(databaseJson), targetSha });
    process.stdout.write(serializePreviousAppProvenance(record));
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
  throw new Error("Usage: production-previous-app-provenance.mjs capture <target-sha>|--verify-preflight <preflight-result.json>");
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
