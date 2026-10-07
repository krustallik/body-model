import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { ACTIVE_ENERGY_UNIFIED_MANIFEST } from "./production-migration-manifests.mjs";

export async function verifyMigrationImageFiles(repositoryPath) {
  const results = [];
  for (const migration of ACTIVE_ENERGY_UNIFIED_MANIFEST.migrations) {
    const filename = path.join(repositoryPath, "prisma", "migrations", migration.name, "migration.sql");
    const bytes = await readFile(filename);
    const actual = createHash("sha256").update(bytes).digest("hex");
    results.push({ name: migration.name, expected: migration.sha256, actual, matches: actual === migration.sha256 });
  }
  const failed = results.filter((entry) => !entry.matches);
  if (failed.length) throw new Error("Migrator image migration bytes differ from reviewed Git-blob hashes: " + failed.map((item) => item.name).join(", "));
  const rolloutTools = [];
  for (const name of ["unified-v3-postflight.mjs", "unified-v4-activate-replay.mjs", "unified-v4-traffic-check.mjs"]) {
    const filename = path.join(repositoryPath, "scripts", name);
    const bytes = await readFile(filename);
    if (bytes.length < 256) throw new Error(`Migrator image rollout tool is missing or unexpectedly empty: ${name}`);
    rolloutTools.push({ name, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
  }
  const writerDrainPath = path.join(repositoryPath, "scripts", "production-writer-drain.mjs");
  const writerDrainBytes = await readFile(writerDrainPath);
  const writerDrain = await import(pathToFileURL(writerDrainPath).href);
  if (writerDrainBytes.length < 256
    || writerDrain.PRODUCTION_WRITER_TOPOLOGY_CONTRACT !== "bodycast-compose-internal-db-single-writer-v1"
    || typeof writerDrain.evaluateProductionWriterDrain !== "function") {
    throw new Error("Migrator image writer-drain safety module is missing, incomplete, or has an unexpected contract.");
  }
  return {
    migrations: results,
    rolloutTools,
    writerDrainModule: {
      name: "production-writer-drain.mjs",
      bytes: writerDrainBytes.length,
      sha256: createHash("sha256").update(writerDrainBytes).digest("hex"),
      contract: writerDrain.PRODUCTION_WRITER_TOPOLOGY_CONTRACT,
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const repositoryPath = process.argv[2] ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  verifyMigrationImageFiles(repositoryPath).then((result) => process.stdout.write(JSON.stringify(result) + "\n"))
    .catch((error) => { process.stderr.write(error.message + "\n"); process.exitCode = 1; });
}
