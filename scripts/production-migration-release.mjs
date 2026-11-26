import { createHash } from "node:crypto";
import { canonicalJson } from "./production-migration-manifests.mjs";

export const PREFLIGHT_WORKFLOW_PATH = ".github/workflows/production-migration-preflight.yml";
export const PREFLIGHT_WORKFLOW_IDENTITY = "production-migration-preflight";
export const PRODUCTION_MIGRATION_CONCURRENCY_GROUP = "bodycast-production-migration";

export function canonicalDigest(value) {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

function exactRunLabel(releaseSha, manifestId) {
  return `Preflight ${releaseSha} ${manifestId}`;
}

function matchesRun(run, { repository, releaseSha, manifestId, workflowId = PREFLIGHT_WORKFLOW_IDENTITY }) {
  return run?.repository === repository
    && run?.workflowPath === PREFLIGHT_WORKFLOW_PATH
    && String(run?.workflowId) === String(workflowId)
    && run?.event === "workflow_dispatch"
    && run?.headBranch === "main"
    && run?.headSha === releaseSha
    && run?.displayTitle === exactRunLabel(releaseSha, manifestId);
}

export function selectLatestApplicablePreflight(runs, selection) {
  const successful = (Array.isArray(runs) ? runs : []).filter((run) => matchesRun(run, selection)
    && run.status === "completed" && run.conclusion === "success");
  if (!successful.length) throw new Error("No successful production preflight exists for this release SHA and manifest.");
  for (const run of successful) {
    if (!/^[1-9][0-9]*$/.test(String(run.id)) || !Number.isSafeInteger(Number(run.runAttempt)) || Number(run.runAttempt) < 1
      || !Number.isFinite(Date.parse(run.runStartedAt)) || !Number.isFinite(Date.parse(run.createdAt))) {
      throw new Error("Successful preflight run metadata is invalid.");
    }
  }
  successful.sort((left, right) => {
    const byStart = Date.parse(left.runStartedAt) - Date.parse(right.runStartedAt);
    if (byStart) return byStart;
    const byId = BigInt(left.id) - BigInt(right.id);
    return byId < 0n ? -1 : byId > 0n ? 1 : Number(left.runAttempt) - Number(right.runAttempt);
  });
  return successful.at(-1);
}

export function verifyPreflightArtifactMetadata(artifact, run) {
  if (!artifact || !run) throw new Error("Preflight artifact or run metadata is missing.");
  if (String(artifact.workflowRunId) !== String(run.id)) throw new Error("Preflight artifact belongs to a different workflow run.");
  if (Number(artifact.workflowRunAttempt) !== Number(run.runAttempt)) throw new Error("Preflight artifact belongs to a different workflow attempt.");
  if (artifact.headSha !== run.headSha || artifact.expired === true) throw new Error("Preflight artifact SHA mismatch or artifact expired.");
  if (!/^[1-9][0-9]*$/.test(String(artifact.id)) || !/^sha256:[a-f0-9]{64}$/.test(artifact.digest)) {
    throw new Error("Preflight artifact identifier or GitHub artifact digest is invalid.");
  }
  return true;
}

export function isBackupFresh(snapshotStartedAt, ddlStartedAt) {
  const snapshot = Date.parse(snapshotStartedAt);
  const ddl = Date.parse(ddlStartedAt);
  if (!Number.isFinite(snapshot) || !Number.isFinite(ddl) || ddl < snapshot) return false;
  return ddl - snapshot <= 60 * 60 * 1000;
}

export function withPrismaLockTimeout(databaseUrl, lockTimeoutMs = 5000) {
  if (!Number.isSafeInteger(lockTimeoutMs) || lockTimeoutMs < 1 || lockTimeoutMs > 5000) {
    throw new Error("Migration lock_timeout must be a positive integer no greater than 5000ms.");
  }
  const url = new URL(databaseUrl);
  if (!["postgres:", "postgresql:"].includes(url.protocol)) throw new Error("Prisma migration DATABASE_URL must use PostgreSQL.");
  const current = url.searchParams.get("options")?.trim() ?? "";
  const options = `${current} -c lock_timeout=${lockTimeoutMs}`.trim();
  url.searchParams.set("options", options);
  return url.toString();
}
