import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { assertTrustedOwnerWorkflowRun, BODYCAST_OWNER_ID } from "./github-owner-identity.mjs";

const PREFLIGHT_PATH = ".github/workflows/production-migration-preflight.yml";
const MUTATION_WORKFLOW_PATHS = new Set([
  PREFLIGHT_PATH,
  ".github/workflows/production-migrate.yml",
  ".github/workflows/production-database-cutback.yml",
  ".github/workflows/activate-unified-v4-production.yml",
  ".github/workflows/deploy-production.yml",
]);

const REQUIRED_SOURCE_STEPS = Object.freeze({
  "Enter maintenance and drain the old app before backup": "success",
  "Verify production container and PostgreSQL client versions": "success",
  "Read-only production identity, full migration set, schema signatures, and locks": "success",
  "Capture pg_dump start on production host and create encrypted backup": "success",
  "Restore snapshot, compare source state, and rehearse exact migrations": "failure",
  "Create preflight evidence bundle": "skipped",
  "Upload encrypted production backup artifact": "skipped",
  "Upload immutable preflight and restore evidence artifact": "skipped",
  "Report read-only completion": "skipped",
});

function reject(message) {
  throw new Error(`Previous production preflight cannot be safely resumed: ${message}`);
}

function workflowPath(run) {
  return typeof run?.path === "string" ? run.path.split("@")[0] : "";
}

function parseNdjson(text) {
  return text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

export function verifyResumablePreflightAttempt({
  sourceRun,
  sourceJobs,
  sourceArtifacts,
  laterRuns,
  sourceRunId,
  currentRunId,
  currentMainSha,
  workflowId,
  sourceIsAncestor,
}) {
  if (!/^[1-9][0-9]*$/.test(String(sourceRunId ?? ""))
    || !/^[1-9][0-9]*$/.test(String(currentRunId ?? ""))
    || !/^[a-f0-9]{40}$/.test(String(currentMainSha ?? ""))) {
    reject("run identifiers or current main SHA are malformed.");
  }
  if (String(sourceRun?.id) !== String(sourceRunId)
    || String(sourceRun?.workflow_id) !== String(workflowId)
    || workflowPath(sourceRun) !== PREFLIGHT_PATH
    || sourceRun.status !== "completed"
    || sourceRun.conclusion !== "failure"
    || sourceRun.run_attempt !== 1
    || sourceRun.head_branch !== "main"
    || sourceRun.event !== "workflow_dispatch"
    || !/^[a-f0-9]{40}$/.test(String(sourceRun.head_sha ?? ""))) {
    reject("source must be the original completed owner-dispatched preflight failure on main.");
  }
  try {
    assertTrustedOwnerWorkflowRun(sourceRun, {
      actorId: BODYCAST_OWNER_ID,
      workflowPath: PREFLIGHT_PATH,
      workflowRunId: sourceRunId,
      workflowRunAttempt: 1,
      ref: "refs/heads/main",
      sha: sourceRun.head_sha,
    });
  } catch (error) {
    reject(error.message);
  }
  if (sourceIsAncestor !== true) reject("the failed preflight SHA is not an ancestor of current main.");

  const jobs = sourceJobs?.jobs;
  if (!Array.isArray(jobs) || sourceJobs.total_count !== 2 || jobs.length !== 2) {
    reject("the failed preflight job inventory is incomplete or unexpected.");
  }
  const authorize = jobs.find((job) => job.name === "Authorize read-only preflight");
  const inspect = jobs.find((job) => job.name === "Inspect, back up, restore, and rehearse on disposable PostgreSQL");
  if (!authorize || authorize.conclusion !== "success" || !inspect || inspect.conclusion !== "failure"
    || jobs.some((job) => job.head_sha !== sourceRun.head_sha || job.run_attempt !== 1)) {
    reject("the owner gate or the expected inspection job result does not match.");
  }
  const steps = new Map((inspect.steps ?? []).map((step) => [step.name, step.conclusion]));
  for (const [name, conclusion] of Object.entries(REQUIRED_SOURCE_STEPS)) {
    if (steps.get(name) !== conclusion) reject(`step result differs from the verified pre-DDL restore failure (${name}).`);
  }
  if ((sourceArtifacts?.total_count ?? sourceArtifacts?.artifacts?.length) !== 0
    || (sourceArtifacts?.artifacts ?? []).length !== 0) {
    reject("the failed preflight unexpectedly published an artifact.");
  }

  const sourceId = BigInt(sourceRunId);
  const currentId = BigInt(currentRunId);
  for (const run of laterRuns ?? []) {
    const id = BigInt(String(run.id));
    if (!MUTATION_WORKFLOW_PATHS.has(workflowPath(run))) continue;
    if (id === currentId) continue;
    if (id > sourceId || (run.status === "in_progress" && id !== currentId)) {
      reject(`another release or preflight workflow exists after source run ${sourceRunId}.`);
    }
  }

  return Object.freeze({
    schemaVersion: 1,
    sourceRunId: String(sourceRun.id),
    sourceRunAttempt: 1,
    sourceSha: sourceRun.head_sha,
    targetSha: currentMainSha,
  });
}

async function readJson(file) { return JSON.parse(await readFile(file, "utf8")); }

async function main() {
  const [mode, ...args] = process.argv.slice(2);
  if (mode !== "--verify-source" || args.length !== 8) {
    throw new Error("Usage: production-preflight-resume.mjs --verify-source <run.json> <jobs.json> <artifacts.json> <later-runs.ndjson> <source-run-id> <current-run-id> <current-main-sha> <workflow-id>");
  }
  const [runPath, jobsPath, artifactsPath, laterRunsPath, sourceRunId, currentRunId, currentMainSha, workflowId] = args;
  const [sourceRun, sourceJobs, sourceArtifacts, laterRunsText] = await Promise.all([
    readJson(runPath), readJson(jobsPath), readJson(artifactsPath), readFile(path.resolve(laterRunsPath), "utf8"),
  ]);
  let sourceIsAncestor = false;
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", sourceRun.head_sha, currentMainSha], { stdio: "ignore" });
    sourceIsAncestor = true;
  } catch {}
  const proof = verifyResumablePreflightAttempt({
    sourceRun, sourceJobs, sourceArtifacts, laterRuns: parseNdjson(laterRunsText), sourceRunId, currentRunId,
    currentMainSha, workflowId, sourceIsAncestor,
  });
  process.stdout.write(`${JSON.stringify(proof)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
