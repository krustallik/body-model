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

function compareTrustedRunMetadata(left, right) {
  const leftStartedAt = Date.parse(left.runStartedAt);
  const rightStartedAt = Date.parse(right.runStartedAt);
  if (!Number.isFinite(leftStartedAt) || !Number.isFinite(rightStartedAt)) throw new Error("Admitted preflight run has an invalid runStartedAt timestamp.");
  const byAdmission = leftStartedAt - rightStartedAt;
  if (byAdmission) return byAdmission;
  const byId = BigInt(left.id) - BigInt(right.id);
  if (byId) return byId < 0n ? -1 : 1;
  return Number(left.runAttempt) - Number(right.runAttempt);
}

function isAdmittedRun(run) {
  if (run.runStartedAt === null) {
    if (["queued", "pending", "requested", "waiting"].includes(run.status)
      || (run.status === "completed" && run.conclusion === "cancelled")) return false;
    throw new Error("Matching preflight run is missing the trusted admission timestamp.");
  }
  if (typeof run.runStartedAt !== "string" || !Number.isFinite(Date.parse(run.runStartedAt))) {
    throw new Error("Matching preflight run has an invalid trusted admission timestamp.");
  }
  return true;
}

export function selectLatestApplicablePreflight(runs, selection) {
  if (selection.selectedRunId) throw new Error("Preflight run is selected from trusted GitHub metadata; operator-selected older runs are forbidden.");
  const matchingRequests = (Array.isArray(runs) ? runs : []).filter((run) => matchesRun(run, selection));
  if (!matchingRequests.length) throw new Error("No matching production preflight run exists for this release SHA and manifest.");
  for (const run of matchingRequests) {
    if (!/^[1-9][0-9]*$/.test(String(run.id)) || !Number.isSafeInteger(Number(run.runAttempt)) || Number(run.runAttempt) < 1
      || !Number.isFinite(Date.parse(run.createdAt))) {
      throw new Error("Matching preflight run has invalid trusted ordering metadata.");
    }
  }
  const matching = matchingRequests.filter(isAdmittedRun);
  if (!matching.length) throw new Error("No admitted matching production preflight run exists for this release SHA and manifest.");
  matching.sort(compareTrustedRunMetadata);
  const latest = matching.at(-1);
  if (latest.status !== "completed") throw new Error(`Latest matching preflight attempt is ${latest.status}; fail-closed selection blocks older successful runs.`);
  if (latest.conclusion !== "success") throw new Error(`Latest matching preflight attempt concluded ${latest.conclusion}; older success is superseded.`);
  const sameRunAttempts = matching.filter((run) => String(run.id) === String(latest.id));
  const maxAttempt = Math.max(...sameRunAttempts.map((run) => Number(run.runAttempt)));
  if (Number(latest.runAttempt) !== maxAttempt || latest.runAttempt < 1) throw new Error("Latest preflight run attempt metadata is inconsistent.");
  return latest;
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
