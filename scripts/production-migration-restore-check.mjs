import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ACTIVE_ENERGY_UNIFIED_MANIFEST } from "./production-migration-manifests.mjs";
import { verifyRestoredBackup, evaluateProductionPostflight, schemaInventoryDigest } from "./production-migration-preflight.mjs";

export function verifyBaseRestore(sourceReport, restoredReport, readabilityReport) {
  const result = verifyRestoredBackup(sourceReport, {
    ...restoredReport,
    readability: readabilityReport?.readability,
  });
  return {
    verified: result.verified,
    blockers: result.blockers,
    migrationCount: result.migrationCount,
    schemaDigest: Array.isArray(restoredReport?.objects) ? schemaInventoryDigest(restoredReport.objects) : null,
    readability: readabilityReport?.readability ?? null,
  };
}

export function verifyDisposablePostflight(report, migrationDirectories, manifestId = ACTIVE_ENERGY_UNIFIED_MANIFEST.id) {
  const evaluation = evaluateProductionPostflight(report, migrationDirectories, manifestId, {
    expectedDatabase: "bodycast_restore",
    expectedRole: "bodycast_restore",
  });
  const digest = Array.isArray(report?.objects) ? schemaInventoryDigest(report.objects) : null;
  return { verified: evaluation.ready, postflightReady: evaluation.ready, blockers: evaluation.blockers, pending: evaluation.pending, postSchemaDigest: digest };
}

export function combineRestoreResults(baseResult, postflightResult) {
  const blockers = [...(baseResult?.blockers ?? []), ...(postflightResult?.blockers ?? [])];
  const baseVerified = baseResult?.verified === true;
  const postflightReady = postflightResult?.postflightReady === true && /^[a-f0-9]{64}$/.test(String(postflightResult.postSchemaDigest ?? ""));
  if (!baseVerified) blockers.push("Base backup restore was not verified.");
  if (!postflightReady) blockers.push("Disposable target migration rehearsal was not verified.");
  return {
    verified: baseVerified && postflightReady && blockers.length === 0,
    postflightReady,
    blockers,
    migrationCount: baseResult?.migrationCount ?? null,
    baseSchemaDigest: baseResult?.schemaDigest ?? null,
    postSchemaDigest: postflightResult?.postSchemaDigest ?? null,
    pending: postflightResult?.pending ?? null,
    readability: baseResult?.readability ?? null,
  };
}

async function readJson(pathname) { return JSON.parse(await readFile(pathname, "utf8")); }

async function main() {
  const [mode, ...args] = process.argv.slice(2);
  const value = (name) => { const index = args.indexOf(name); return index < 0 ? null : args[index + 1]; };
  const repository = path.resolve(value("--repository") ?? process.cwd());
  const migrationDirectories = (await readdir(path.join(repository, "prisma/migrations"), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  if (mode === "--base") {
    const [source, restored, readability] = await Promise.all([
      readJson(value("--source")), readJson(value("--restored")), readJson(value("--readability")),
    ]);
    const result = verifyBaseRestore(source, restored, readability);
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    if (!result.verified) process.exitCode = 1;
    return;
  }
  if (mode === "--postflight") {
    const report = await readJson(value("--report"));
    const result = verifyDisposablePostflight(report, migrationDirectories, value("--manifest") ?? ACTIVE_ENERGY_UNIFIED_MANIFEST.id);
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    if (!result.verified) process.exitCode = 1;
    return;
  }
  if (mode === "--combine") {
    const [base, postflight] = await Promise.all([readJson(value("--base")), readJson(value("--postflight"))]);
    const result = combineRestoreResults(base, postflight);
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    if (!result.verified) process.exitCode = 1;
    return;
  }
  throw new Error("Usage: production-migration-restore-check.mjs --base|--postflight|--combine ...");
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => { process.stderr.write(error.message + "\n"); process.exitCode = 1; });
}
