import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { EXPECTED_MIGRATION_OBJECTS } from "./production-migration-preflight.mjs";
import { ACTIVE_ENERGY_UNIFIED_MANIFEST } from "./production-migration-manifests.mjs";

export function getExpectedSchemaObjectNames() {
  return [...new Set([...EXPECTED_MIGRATION_OBJECTS, ...ACTIVE_ENERGY_UNIFIED_MANIFEST.postflightObjects])].sort();
}

export function renderProductionDbPreflightSql(template, names = getExpectedSchemaObjectNames()) {
  const marker = "__EXPECTED_SCHEMA_OBJECTS_JSON__";
  if (template.split(marker).length !== 2) throw new Error("SQL template must contain exactly one schema inventory marker.");
  const json = JSON.stringify(names);
  return template.replace(marker, json.replaceAll("'", "''"));
}

async function main() {
  const templatePath = path.resolve("scripts/production-db-preflight.sql");
  const template = await readFile(templatePath, "utf8");
  process.stdout.write(renderProductionDbPreflightSql(template));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
