import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { ACTIVE_ENERGY_UNIFIED_MANIFEST, getProductionMigrationManifest } from "./production-migration-manifests.mjs";
import { ALL_REVIEWED_OBJECTS } from "./production-migration-preflight.mjs";

export function getExpectedSchemaObjectNames() {
  return [...ALL_REVIEWED_OBJECTS].sort();
}

const DEFAULT_DDL_LOCK_TARGETS = Object.freeze([
  { tableName: "Workout", requiredLockMode: "ShareRowExclusiveLock" },
  { tableName: "Profile", requiredLockMode: "ShareRowExclusiveLock" },
  { tableName: "ModelEpisode", requiredLockMode: "ShareRowExclusiveLock" },
  { tableName: "StrengthDiarySession", requiredLockMode: "AccessExclusiveLock" },
  { tableName: "ExperimentalSkeletalMuscleDeltaShadow", requiredLockMode: "AccessExclusiveLock" },
  { tableName: "ExperimentalCessationDetrainingShadow", requiredLockMode: "AccessExclusiveLock" },
  { tableName: "PhysiologyV7Lifecycle", requiredLockMode: "AccessExclusiveLock" },
  { tableName: "DailyModelState", requiredLockMode: "AccessExclusiveLock" },
]);

function replaceJsonMarker(template, marker, value) {
  if (template.split(marker).length !== 2) throw new Error(`SQL template must contain exactly one ${marker} marker.`);
  return template.replace(marker, JSON.stringify(value).replaceAll("'", "''"));
}

export function renderProductionDbPreflightSql(template, names = getExpectedSchemaObjectNames(), manifestId = ACTIVE_ENERGY_UNIFIED_MANIFEST.id) {
  const manifest = getProductionMigrationManifest(manifestId);
  const ddlLockTargets = manifest.ddlLockTargets ?? DEFAULT_DDL_LOCK_TARGETS;
  const withObjectNames = replaceJsonMarker(template, "__EXPECTED_SCHEMA_OBJECTS_JSON__", names);
  const withBaselineTables = replaceJsonMarker(withObjectNames, "__BASELINE_TABLES_JSON__", manifest.requiredTablesBefore);
  return replaceJsonMarker(withBaselineTables, "__DDL_LOCK_TARGETS_JSON__", ddlLockTargets);
}

async function main() {
  const templatePath = path.resolve("scripts/production-db-preflight.sql");
  const template = await readFile(templatePath, "utf8");
  const args = process.argv.slice(2);
  const manifestIndex = args.indexOf("--manifest");
  const manifestId = manifestIndex < 0 ? ACTIVE_ENERGY_UNIFIED_MANIFEST.id : args[manifestIndex + 1];
  if (manifestIndex >= 0 && (!manifestId || manifestId.startsWith("--"))) {
    throw new Error("--manifest requires a reviewed production migration manifest id.");
  }
  process.stdout.write(renderProductionDbPreflightSql(template, getExpectedSchemaObjectNames(), manifestId));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
