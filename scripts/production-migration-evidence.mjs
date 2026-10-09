import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { canonicalSha256 } from "./production-migration-authorization.mjs";
import { evaluateProductionWriterDrain } from "./production-writer-drain.mjs";

async function readJson(filePath) { return JSON.parse(await readFile(filePath, "utf8")); }

export function createPreflightEvidence({ rawReport, preflightResult, restoreResult, snapshotStartedAt, backupBytes, context }) {
  if (preflightResult?.readyForOwnerAuthorization !== true) throw new Error("Cannot attest a blocked production preflight.");
  if (restoreResult?.verified !== true || restoreResult?.postflightReady !== true) throw new Error("Cannot attest an unverified disposable restore or migration rehearsal.");
  if (preflightResult.manifestId !== context.manifestId || preflightResult.identity?.database !== "bodycast") {
    throw new Error("Preflight report does not match the released manifest or expected production database.");
  }
  const writerDrain = evaluateProductionWriterDrain(rawReport);
  if (!writerDrain.ready || preflightResult.writerDrainReady !== true
    || canonicalSha256(rawReport.writerDrain) !== preflightResult.writerDrainDigest) {
    throw new Error("Preflight writer-drain/topology evidence is missing, blocked, or differs from the evaluated result.");
  }
  const backupSnapshot = Date.parse(snapshotStartedAt);
  if (!Number.isFinite(backupSnapshot) || backupSnapshot > Date.now() + 60_000) throw new Error("Production pg_dump start timestamp is invalid.");
  if (!/^[a-f0-9]{64}$/.test(String(restoreResult.postSchemaDigest ?? ""))) throw new Error("Disposable post-migration schema digest is missing.");
  return {
    schemaVersion: 1,
    verified: true,
    repository: "krustallik/body-model",
    workflowPath: ".github/workflows/production-migration-preflight.yml",
    workflowRunId: String(context.workflowRunId),
    workflowRunAttempt: Number(context.workflowRunAttempt),
    releaseSha: context.releaseSha,
    manifestId: context.manifestId,
    pendingMigrationNames: [...preflightResult.pending].sort(),
    pendingSetDigest: canonicalSha256([...preflightResult.pending].sort()),
    preflightResultDigest: canonicalSha256(preflightResult),
    backupFileDigest: createHash("sha256").update(backupBytes).digest("hex"),
    backupSnapshotAt: new Date(backupSnapshot).toISOString(),
    restoreResultDigest: canonicalSha256(restoreResult),
    productionIdentityDigest: canonicalSha256(rawReport.identity),
    writerDrainDigest: canonicalSha256(rawReport.writerDrain),
    writerTopologyDigest: canonicalSha256(rawReport.writerDrain.topology),
    postSchemaDigest: restoreResult.postSchemaDigest,
    createdAt: new Date().toISOString(),
  };
}

async function main() {
  const [rawReportPath, preflightResultPath, restoreResultPath, snapshotPath, backupPath, outputPath] = process.argv.slice(2);
  if (![rawReportPath, preflightResultPath, restoreResultPath, snapshotPath, backupPath, outputPath].every(Boolean)) {
    throw new Error("Usage: production-migration-evidence.mjs <raw-report.json> <preflight-result.json> <restore-result.json> <snapshot-start.txt> <backup.enc> <output.json>");
  }
  const [rawReport, preflightResult, restoreResult, snapshotStartedAt, backupBytes] = await Promise.all([
    readJson(rawReportPath), readJson(preflightResultPath), readJson(restoreResultPath), readFile(snapshotPath, "utf8").then((value) => value.trim()),
    readFile(backupPath),
  ]);
  const evidence = createPreflightEvidence({ rawReport, preflightResult, restoreResult, snapshotStartedAt, backupBytes, context: {
    workflowRunId: process.env.GITHUB_RUN_ID,
    workflowRunAttempt: process.env.GITHUB_RUN_ATTEMPT,
    releaseSha: process.env.RELEASE_SHA,
    manifestId: process.env.MANIFEST_ID,
  } });
  await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  process.stdout.write(JSON.stringify({ preflightResultDigest: evidence.preflightResultDigest, restoreResultDigest: evidence.restoreResultDigest }) + "\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
