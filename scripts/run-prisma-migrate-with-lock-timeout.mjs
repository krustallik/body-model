import { spawnSync } from "node:child_process";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { isBackupFresh, withPrismaLockTimeout } from "./production-migration-release.mjs";
import { verifyFinalGuardReceipt } from "./production-migration-final-guard.mjs";

export async function assertPrismaMigrationAuthorized(environment = process.env, now = Date.now()) {
  const databaseUrl = environment.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required for migrations.");
  const receiptPath = environment.BODYCAST_FINAL_GUARD_RECEIPT;
  const envelopePath = environment.BODYCAST_AUTHORIZATION_ENVELOPE;
  const keysPath = environment.BODYCAST_VERIFICATION_KEYS;
  if (!receiptPath || !envelopePath || !keysPath) throw new Error("Refusing Prisma DDL without signed final-guard evidence.");
  for (const filePath of [receiptPath, envelopePath, keysPath]) {
    const details = await lstat(filePath);
    if (!details.isFile() || details.isSymbolicLink()) throw new Error("Refusing Prisma DDL: signed final-guard evidence path is not a regular file.");
  }
  const [receipt, envelope, allowlist] = await Promise.all([
    readFile(receiptPath, "utf8").then((value) => JSON.parse(value)),
    readFile(envelopePath, "utf8").then((value) => value.trimEnd()),
    readFile(keysPath, "utf8").then((value) => JSON.parse(value)),
  ]);
  verifyFinalGuardReceipt({
    receipt,
    envelope,
    allowlist,
    currentWorkflowId: environment.BODYCAST_AUTHORIZATION_WORKFLOW_ID,
    currentWorkflowRunId: environment.BODYCAST_AUTHORIZATION_RUN_ID,
    currentWorkflowRunAttempt: Number(environment.BODYCAST_AUTHORIZATION_RUN_ATTEMPT),
    currentMainSha: environment.BODYCAST_CANONICAL_MAIN_SHA,
    releaseSha: environment.BODYCAST_RELEASE_SHA,
    now,
  });
  const ddlStartedAt = new Date(now).toISOString();
  if (!isBackupFresh(receipt.backupSnapshotAt, ddlStartedAt)) {
    throw new Error("Refusing Prisma DDL: the production backup snapshot is not fresh at DDL start (maximum 60 minutes).");
  }
  return { databaseUrl: withPrismaLockTimeout(databaseUrl, 5000), receipt };
}

async function main() {
  const authorized = await assertPrismaMigrationAuthorized();
  const environment = { ...process.env, DATABASE_URL: authorized.databaseUrl };
  const result = spawnSync("npx", ["prisma", "migrate", "deploy"], { stdio: "inherit", env: environment, shell: false, cwd: path.resolve("/app") });
  if (result.error) throw result.error;
  if (result.signal) throw new Error("Prisma migrate deploy terminated by " + result.signal + ".");
  process.exitCode = result.status ?? 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => { process.stderr.write(error.message + "\n"); process.exitCode = 1; });
}
