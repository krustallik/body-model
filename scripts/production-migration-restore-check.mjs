import { readFile, readdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ACTIVE_ENERGY_UNIFIED_MANIFEST, V4_REPUBLICATION_MANIFEST } from "./production-migration-manifests.mjs";
import { verifyRestoredBackup, evaluateProductionPostflight, schemaInventoryDigest, schemaInventoryDifferenceSummary, safeBlockerCategories } from "./production-migration-preflight.mjs";
import { canonicalSha256 } from "./production-migration-authorization.mjs";
import { verifyExecutionFileMatchesBlob } from "./production-migration-integrity.mjs";
import { isCanonicalPostgresDatabaseIdentity } from "./postgres-database-identity.mjs";

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
    logicalDataFingerprint: restoredReport?.logicalDataFingerprint ?? null,
  };
}

export async function verifyDisposableRehearsalAdmission({
  snapshot, restoredReport, readabilityReport, migrationDirectories, repositoryPath, releaseSha,
  manifestId = V4_REPUBLICATION_MANIFEST.id,
} = {}) {
  const blockers = [];
  const expectedPending = V4_REPUBLICATION_MANIFEST.migrations.map(({ name }) => name).sort();
  const sameSorted = (left, right) => Array.isArray(left)
    && JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
  const sourceReport = snapshot?.report;
  const preflight = snapshot?.preflightResult;
  const preparation = snapshot?.preparationResult;

  if (!/^[a-f0-9]{40}$/.test(String(releaseSha ?? ""))
    || manifestId !== V4_REPUBLICATION_MANIFEST.id
    || snapshot?.schemaVersion !== 1 || snapshot.releaseSha !== releaseSha
    || snapshot.canonicalMainSha !== releaseSha || snapshot.manifestId !== manifestId) {
    blockers.push("No-app host snapshot is not bound to the exact requested V4 release SHA.");
  }
  try {
    const checkedOutSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repositoryPath, encoding: "utf8" }).trim();
    if (checkedOutSha !== releaseSha) blockers.push("Isolated rehearsal checkout is not at the exact snapshot release SHA.");
  } catch {
    blockers.push("Isolated rehearsal checkout SHA could not be verified.");
  }
  if (preparation?.evidenceKind !== "database-only-no-app-v1"
    || preparation.preparationVerified !== true || preparation.releaseSha !== releaseSha
    || preparation.manifestId !== manifestId || preparation.readyForOwnerAuthorization !== false
    || preparation.ddlAuthorization !== false || preparation.appRuntime !== "unavailable"
    || preparation.previousAppProvenance !== null || preparation.rollbackReadiness !== "unverified"
    || !/^[a-f0-9]{64}$/.test(String(preparation.productionDatabaseContainerId ?? ""))
    || !sameSorted(preparation.pendingMigrationNames, expectedPending)
    || preparation.pendingSetDigest !== canonicalSha256(expectedPending)) {
    blockers.push("No-app evidence is missing its preparation-only exact-manifest contract.");
  }
  if (preflight?.manifestId !== manifestId || preflight.readyForOwnerAuthorization !== true
    || preflight.pendingExactlyExpected !== true || !sameSorted(preflight.pending, expectedPending)
    || !sameSorted(preflight.expectedPending, expectedPending)
    || !Array.isArray(preflight.blockers) || preflight.blockers.length !== 0
    || !Array.isArray(preflight.blobIntegrity)
    || preflight.blobIntegrity.some((entry) => entry?.matches !== true)
    || V4_REPUBLICATION_MANIFEST.migrations.some((migration) => {
      const matches = preflight.blobIntegrity.filter((entry) => entry?.name === migration.name);
      return matches.length !== 1 || matches[0].expectedSha256 !== migration.sha256
        || matches[0].actualSha256 !== migration.sha256;
    })
    || !sourceReport || !preflight.identity || !sourceReport.identity
    || canonicalSha256(preflight.identity) !== canonicalSha256(sourceReport.identity)
    || preflight.logicalDataFingerprint !== sourceReport.logicalDataFingerprint
    || !preflight.writerDrain || !sourceReport.writerDrain
    || canonicalSha256(preflight.writerDrain) !== canonicalSha256(sourceReport.writerDrain)
    || preflight.writerDrainReady !== true
    || preparation?.databasePreflightResultDigest !== canonicalSha256(preflight)
    || preparation?.productionIdentityDigest !== canonicalSha256(sourceReport.identity)
    || preparation?.logicalDataFingerprint !== sourceReport.logicalDataFingerprint) {
    blockers.push("Production snapshot does not prove the exact clean V4 pending set and source preflight state.");
  }

  const directories = Array.isArray(migrationDirectories) ? migrationDirectories : [];
  const expectedTree = [...new Set([
    ...(Array.isArray(preflight?.migrations) ? preflight.migrations.map((row) => row?.name) : []),
    ...expectedPending,
  ])].sort();
  if (!sameSorted(directories, expectedTree) || new Set(directories).size !== directories.length) {
    blockers.push("Isolated rehearsal migration tree differs from the exact production snapshot and V4 manifest.");
  }
  if (!Array.isArray(preflight?.migrations) || !Array.isArray(sourceReport?.migrations)
    || canonicalSha256(preflight.migrations) !== canonicalSha256(sourceReport.migrations)) {
    blockers.push("Production preflight migration history is not bound to its source snapshot.");
  }

  const restoredIdentity = restoredReport?.identity;
  if (!isCanonicalPostgresDatabaseIdentity(restoredIdentity)
    || restoredIdentity.database !== "bodycast_restore" || restoredIdentity.role !== "bodycast_restore"
    || !String(restoredIdentity.serverVersion ?? "").startsWith("17.")) {
    blockers.push("Rehearsal target is not the isolated PostgreSQL 17 bodycast_restore database and role.");
  }
  if (!Array.isArray(restoredReport?.conflictingLocks) || restoredReport.conflictingLocks.length !== 0
    || !Array.isArray(restoredReport?.preparedTransactions)
    || restoredReport.preparedTransactions.length !== 0) {
    blockers.push("Isolated rehearsal target has unknown or conflicting DDL locks or prepared transactions.");
  }

  const base = verifyBaseRestore(sourceReport, restoredReport, readabilityReport);
  blockers.push(...base.blockers);
  const executionIntegrity = [];
  for (const migration of V4_REPUBLICATION_MANIFEST.migrations) {
    try {
      const result = await verifyExecutionFileMatchesBlob({ repositoryPath, releaseSha, migration });
      executionIntegrity.push({ name: result.name, expectedSha256: result.expectedSha256, workingTreeSha256: result.workingTreeSha256, exactMatch: result.exactMatch });
      if (!result.exactMatch) blockers.push(`Disposable V4 migration ${migration.name} differs from its exact reviewed Git blob.`);
    } catch {
      executionIntegrity.push({ name: migration.name, expectedSha256: migration.sha256, workingTreeSha256: null, exactMatch: false });
      blockers.push(`Disposable V4 migration ${migration.name} is missing or cannot be verified against the exact release SHA.`);
    }
  }

  const uniqueBlockers = [...new Set(blockers)];
  return {
    ...base,
    verified: uniqueBlockers.length === 0,
    verifiedForIsolatedRehearsal: uniqueBlockers.length === 0,
    readyForIsolatedRehearsal: uniqueBlockers.length === 0,
    ddlAuthorization: false,
    blockers: uniqueBlockers,
    manifestId,
    releaseSha,
    pending: expectedPending,
    pendingSetDigest: canonicalSha256(expectedPending),
    executionIntegrity,
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
    logicalDataFingerprint: baseResult?.logicalDataFingerprint ?? null,
  };
}

async function readJson(pathname) { return JSON.parse(await readFile(pathname, "utf8")); }

function writeVerificationResult(label, result, safeSchemaDiagnostic = null) {
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  if (safeSchemaDiagnostic) {
    process.stderr.write(`Sanitized schema inventory differences: ${JSON.stringify(safeSchemaDiagnostic)}\n`);
  }
  if (result.verified !== true) {
    const blockers = Array.isArray(result.blockers) ? result.blockers.filter((blocker) => typeof blocker === "string") : [];
    const categories = safeBlockerCategories(blockers);
    const summary = categories.length ? categories.join(",") : "unclassified";
    process.stderr.write(`${label} failed (blocker-count=${blockers.length}; categories=${summary}).\n`);
    process.exitCode = 1;
  }
}

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
    const schemaDiff = Array.isArray(source?.objects) && Array.isArray(restored?.objects)
      && schemaInventoryDigest(source.objects) !== schemaInventoryDigest(restored.objects)
      ? schemaInventoryDifferenceSummary(source.objects, restored.objects, {
        sourceServerVersion: source?.identity?.serverVersion,
        restoredServerVersion: restored?.identity?.serverVersion,
      })
      : null;
    writeVerificationResult("Base backup restore verification", result, schemaDiff);
    return;
  }
  if (mode === "--rehearsal-preflight") {
    const [snapshot, restored, readability] = await Promise.all([
      readJson(value("--snapshot")), readJson(value("--restored")), readJson(value("--readability")),
    ]);
    const result = await verifyDisposableRehearsalAdmission({
      snapshot, restoredReport: restored, readabilityReport: readability, migrationDirectories,
      repositoryPath: repository, releaseSha: value("--release-sha"),
      manifestId: value("--manifest") ?? V4_REPUBLICATION_MANIFEST.id,
    });
    writeVerificationResult("Disposable exact-manifest rehearsal admission", result);
    return;
  }
  if (mode === "--postflight") {
    const report = await readJson(value("--report"));
    const result = verifyDisposablePostflight(report, migrationDirectories, value("--manifest") ?? ACTIVE_ENERGY_UNIFIED_MANIFEST.id);
    writeVerificationResult("Disposable migration postflight", result);
    return;
  }
  if (mode === "--combine") {
    const [base, postflight] = await Promise.all([readJson(value("--base")), readJson(value("--postflight"))]);
    const result = combineRestoreResults(base, postflight);
    writeVerificationResult("Combined disposable restore verification", result);
    return;
  }
  throw new Error("Usage: production-migration-restore-check.mjs --base|--rehearsal-preflight|--postflight|--combine ...");
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => { process.stderr.write(error.message + "\n"); process.exitCode = 1; });
}
