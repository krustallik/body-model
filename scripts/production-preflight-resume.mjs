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
const SUCCESSFUL_PREFLIGHT_STEPS = Object.freeze({
  "Enter maintenance and drain the old app before backup": "success",
  "Verify production container and PostgreSQL client versions": "success",
  "Read-only production identity, full migration set, schema signatures, and locks": "success",
  "Capture pg_dump start on production host and create encrypted backup": "success",
  "Restore snapshot, compare source state, and rehearse exact migrations": "success",
  "Create preflight evidence bundle": "success",
  "Upload encrypted production backup artifact": "success",
  "Upload immutable preflight and restore evidence artifact": "success",
  "Report read-only completion": "success",
});
const BLOCKED_CAPTURE_PREFLIGHT_STEPS = Object.freeze({
  "Enter maintenance and drain the old app before backup": "failure",
  "Verify production container and PostgreSQL client versions": "skipped",
  "Read-only production identity, full migration set, schema signatures, and locks": "skipped",
  "Capture pg_dump start on production host and create encrypted backup": "skipped",
  "Restore snapshot, compare source state, and rehearse exact migrations": "skipped",
  "Create preflight evidence bundle": "skipped",
  "Upload encrypted production backup artifact": "skipped",
  "Upload immutable preflight and restore evidence artifact": "skipped",
  "Report read-only completion": "skipped",
});
const MIGRATION_PRE_DDL_FAILURE = "Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/app/scripts/github-owner-identity.mjs' imported from /app/scripts/production-migration-authorization.mjs";
const MIGRATION_FAILURE_STEP = "Run the fixed guarded migration script over SSH";
const WRITER_DRAIN_READY_MARKER = '"contract":"bodycast-compose-internal-db-single-writer-v1","ready":true';
const PRIOR_CAPTURE_FAILURE = "An earlier pre-DDL release capture exists; operator review is required before another migration attempt.";
const MIGRATION_PATH = ".github/workflows/production-migrate.yml";
const MIGRATION_PRE_DDL_STEPS = Object.freeze({
  "Checkout exact authorized release SHA": "success",
  "Set up Node runtime": "success",
  "Recheck current canonical main before production SSH": "success",
  "Download only the signed context artifact": "success",
  "Validate protected production SSH and pin host key": "success",
  "Trust only the SSH key matching the pinned fingerprint": "success",
  "Stream signed evidence files to private remote temporary context": "success",
  "Run the fixed guarded migration script over SSH": "failure",
  "Remove temporary runner credentials": "success",
  "Post Set up Node runtime": "skipped",
  "Post Checkout exact authorized release SHA": "success",
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

function jobByName(jobsPayload, name, { conclusion, headSha, attempt }) {
  const job = jobsPayload?.jobs?.find((item) => item.name === name);
  if (!job || job.conclusion !== conclusion || job.head_sha !== headSha || job.run_attempt !== attempt) {
    reject(`the expected job result does not match (${name}).`);
  }
  return job;
}

function assertStepResults(job, expected, description) {
  const steps = new Map((job.steps ?? []).map((step) => [step.name, step.conclusion]));
  for (const [name, conclusion] of Object.entries(expected)) {
    if (steps.get(name) !== conclusion) reject(`${description} step result differs (${name}).`);
  }
}

function assertPreflightRun(run, { runId, workflowId, sha, conclusion }) {
  if (String(run?.id) !== String(runId) || String(run?.workflow_id) !== String(workflowId)
    || workflowPath(run) !== PREFLIGHT_PATH || run.status !== "completed" || run.conclusion !== conclusion
    || run.run_attempt !== 1 || run.head_branch !== "main" || run.event !== "workflow_dispatch"
    || run.head_sha !== sha) {
    reject("a preflight run identity, result, SHA, or original attempt does not match.");
  }
  try {
    assertTrustedOwnerWorkflowRun(run, {
      actorId: BODYCAST_OWNER_ID, workflowPath: PREFLIGHT_PATH, workflowRunId: runId,
      workflowRunAttempt: 1, ref: "refs/heads/main", sha,
    });
  } catch (error) {
    reject(error.message);
  }
}

function assertMigrationRun(run, { runId, workflowId, sha }) {
  if (String(run?.id) !== String(runId) || String(run?.workflow_id) !== String(workflowId)
    || workflowPath(run) !== MIGRATION_PATH || run.status !== "completed" || run.conclusion !== "failure"
    || run.run_attempt !== 1 || run.head_branch !== "main" || run.event !== "workflow_dispatch"
    || run.head_sha !== sha) {
    reject("the migration attempt identity, failed result, SHA, or original attempt does not match.");
  }
  try {
    assertTrustedOwnerWorkflowRun(run, {
      actorId: BODYCAST_OWNER_ID, workflowPath: MIGRATION_PATH, workflowRunId: runId,
      workflowRunAttempt: 1, ref: "refs/heads/main", sha,
    });
  } catch (error) {
    reject(error.message);
  }
}

function assertSuccessfulPreflightArtifacts(artifacts, sha, runId) {
  const expected = new Set([
    `bodycast-backup-${sha}-active-energy-unified-v2-${runId}-1`,
    `bodycast-preflight-evidence-${sha}-active-energy-unified-v2-${runId}-1`,
  ]);
  const actual = artifacts?.artifacts ?? [];
  if (artifacts?.total_count !== expected.size || actual.length !== expected.size
    || actual.some((artifact) => !expected.delete(artifact.name)
      || artifact.expired !== false || !Number.isSafeInteger(artifact.size_in_bytes) || artifact.size_in_bytes <= 0
      || !/^sha256:[a-f0-9]{64}$/.test(String(artifact.digest ?? ""))) || expected.size !== 0) {
    reject("the successful source preflight backup/evidence artifacts are missing, expired, or malformed.");
  }
}

/**
 * Resume a durable previous-app capture only for the narrowly verified incident
 * where a successful owner preflight was followed by the known final-guard
 * import failure before the DDL marker, then a retry stopped at the existing
 * capture guard. The host still performs fresh marker, maintenance, app,
 * writer-drain, DB identity/history/schema, and immutable-image checks before
 * rebinding. This proof does not reuse the old backup; the current preflight
 * must create a new backup and pass a new isolated restore rehearsal.
 */
export function verifyPreDdlMigrationFailureResume({
  sourceRun, sourceJobs, sourceArtifacts,
  migrationRun, migrationJobs, migrationLogText,
  blockedCaptureRun, blockedCaptureJobs, blockedCaptureArtifacts, blockedCaptureLogText,
  laterRuns, sourceRunId, migrationRunId, blockedCaptureRunId, currentRunId, currentMainSha,
  preflightWorkflowId, migrationWorkflowId, sourceIsAncestor,
}) {
  if (!/^[1-9][0-9]*$/.test(String(currentRunId ?? ""))
    || !/^[a-f0-9]{40}$/.test(String(currentMainSha ?? ""))) {
    reject("run identifiers or current main SHA are malformed.");
  }
  const sourceSha = sourceRun?.head_sha;
  assertPreflightRun(sourceRun, { runId: sourceRunId, workflowId: preflightWorkflowId, sha: sourceSha, conclusion: "success" });
  if (!/^[a-f0-9]{40}$/.test(String(sourceSha ?? "")) || sourceIsAncestor !== true) {
    reject("the successful source preflight SHA is malformed or is not an ancestor of current main.");
  }
  const sourceJobInventory = sourceJobs?.jobs;
  if (sourceJobs?.total_count !== 2 || !Array.isArray(sourceJobInventory) || sourceJobInventory.length !== 2) {
    reject("the successful source preflight job inventory is incomplete or unexpected.");
  }
  jobByName(sourceJobs, "Authorize read-only preflight", { conclusion: "success", headSha: sourceSha, attempt: 1 });
  const sourceInspect = jobByName(sourceJobs,
    "Inspect, back up, restore, and rehearse on disposable PostgreSQL", { conclusion: "success", headSha: sourceSha, attempt: 1 });
  assertStepResults(sourceInspect, SUCCESSFUL_PREFLIGHT_STEPS, "source preflight");
  assertSuccessfulPreflightArtifacts(sourceArtifacts, sourceSha, String(sourceRunId));

  assertMigrationRun(migrationRun, { runId: migrationRunId, workflowId: migrationWorkflowId, sha: sourceSha });
  if (!Number.isSafeInteger(migrationRun?.run_attempt) || migrationRun.run_attempt !== 1) reject("migration attempt reruns cannot support capture resumption.");
  if (migrationJobs?.total_count !== 3 || !Array.isArray(migrationJobs.jobs) || migrationJobs.jobs.length !== 3) {
    reject("the failed migration job inventory is incomplete or unexpected.");
  }
  jobByName(migrationJobs, "Select latest exact preflight evidence", { conclusion: "success", headSha: sourceSha, attempt: 1 });
  jobByName(migrationJobs, "Sign migration authorization envelope", { conclusion: "success", headSha: sourceSha, attempt: 1 });
  const migrationExecution = jobByName(migrationJobs, "Final live guard and authorized migration", {
    conclusion: "failure", headSha: sourceSha, attempt: 1,
  });
  assertStepResults(migrationExecution, MIGRATION_PRE_DDL_STEPS, "migration execution");
  const migrationLog = String(migrationLogText ?? "");
  const migrationLogLines = migrationLog.split(/\r?\n/);
  const failureLines = migrationLogLines.map((line, index) => line.includes(MIGRATION_PRE_DDL_FAILURE) ? index : -1).filter((index) => index >= 0);
  const writerDrainReadyLine = migrationLogLines.findIndex((line) => line.includes(WRITER_DRAIN_READY_MARKER));
  if (failureLines.length !== 3 || failureLines.some((index) => !migrationLogLines[index].includes(MIGRATION_FAILURE_STEP))) {
    reject("the migration log does not show exactly three known import failures in the fixed migration step.");
  }
  if (!(failureLines[0] < failureLines[1] && failureLines[1] < writerDrainReadyLine && writerDrainReadyLine < failureLines[2])) {
    reject("the two failed live probes, successful writer-drain observation, and final-guard import failure are not in the reviewed order.");
  }

  assertPreflightRun(blockedCaptureRun, {
    runId: blockedCaptureRunId, workflowId: preflightWorkflowId, sha: currentMainSha, conclusion: "failure",
  });
  if (blockedCaptureJobs?.total_count !== 2 || !Array.isArray(blockedCaptureJobs.jobs) || blockedCaptureJobs.jobs.length !== 2) {
    reject("the capture-blocked preflight job inventory is incomplete or unexpected.");
  }
  jobByName(blockedCaptureJobs, "Authorize read-only preflight", { conclusion: "success", headSha: currentMainSha, attempt: 1 });
  const blockedInspect = jobByName(blockedCaptureJobs,
    "Inspect, back up, restore, and rehearse on disposable PostgreSQL", { conclusion: "failure", headSha: currentMainSha, attempt: 1 });
  assertStepResults(blockedInspect, BLOCKED_CAPTURE_PREFLIGHT_STEPS, "capture-blocked preflight");
  if (blockedCaptureArtifacts?.total_count !== 0 || (blockedCaptureArtifacts?.artifacts ?? []).length !== 0
    || !String(blockedCaptureLogText ?? "").includes(PRIOR_CAPTURE_FAILURE)) {
    reject("the later preflight did not stop at the existing capture guard without publishing artifacts.");
  }

  const sourceId = BigInt(String(sourceRunId));
  const migrationId = BigInt(String(migrationRunId));
  const blockedId = BigInt(String(blockedCaptureRunId));
  const currentId = BigInt(String(currentRunId));
  if (!(sourceId < migrationId && migrationId < blockedId && blockedId < currentId)) {
    reject("the verified workflow runs are not in the expected source → failed migration → blocked retry order.");
  }
  const allowedIds = new Set([String(migrationRunId), String(blockedCaptureRunId)]);
  for (const run of laterRuns ?? []) {
    const id = BigInt(String(run.id));
    if (!MUTATION_WORKFLOW_PATHS.has(workflowPath(run)) || id <= sourceId || id === currentId) continue;
    if (!allowedIds.delete(String(run.id))) {
      reject(`an unexpected production mutation workflow exists after source preflight ${sourceRunId}.`);
    }
  }
  if (allowedIds.size !== 0) reject("one or more verified production workflow runs are absent from the complete history.");

  return Object.freeze({
    schemaVersion: 2,
    resumeKind: "verified-pre-ddl-migration-failure",
    sourceRunId: String(sourceRun.id),
    sourceRunAttempt: 1,
    sourceSha,
    targetSha: currentMainSha,
    migrationFailureRunId: String(migrationRun.id),
    blockedCaptureRunId: String(blockedCaptureRun.id),
  });
}

async function readJson(file) { return JSON.parse(await readFile(file, "utf8")); }

async function main() {
  const [mode, ...args] = process.argv.slice(2);
  if (mode === "--verify-pre-ddl-migration-failure" && args.length === 18) {
    const [sourceRunPath, sourceJobsPath, sourceArtifactsPath, migrationRunPath, migrationJobsPath, migrationLogPath,
      blockedRunPath, blockedJobsPath, blockedArtifactsPath, blockedLogPath, laterRunsPath, sourceRunId,
      migrationRunId, blockedCaptureRunId, currentRunId, currentMainSha, preflightWorkflowId, migrationWorkflowId] = args;
    const [sourceRun, sourceJobs, sourceArtifacts, migrationRun, migrationJobs, migrationLogText, blockedCaptureRun,
      blockedCaptureJobs, blockedCaptureArtifacts, blockedCaptureLogText, laterRunsText] = await Promise.all([
      readJson(sourceRunPath), readJson(sourceJobsPath), readJson(sourceArtifactsPath), readJson(migrationRunPath),
      readJson(migrationJobsPath), readFile(migrationLogPath, "utf8"), readJson(blockedRunPath), readJson(blockedJobsPath),
      readJson(blockedArtifactsPath), readFile(blockedLogPath, "utf8"), readFile(path.resolve(laterRunsPath), "utf8"),
    ]);
    let sourceIsAncestor = false;
    try { execFileSync("git", ["merge-base", "--is-ancestor", sourceRun.head_sha, currentMainSha], { stdio: "ignore" }); sourceIsAncestor = true; } catch {}
    const proof = verifyPreDdlMigrationFailureResume({ sourceRun, sourceJobs, sourceArtifacts, migrationRun, migrationJobs,
      migrationLogText, blockedCaptureRun, blockedCaptureJobs, blockedCaptureArtifacts, blockedCaptureLogText,
      laterRuns: parseNdjson(laterRunsText), sourceRunId, migrationRunId, blockedCaptureRunId, currentRunId,
      currentMainSha, preflightWorkflowId, migrationWorkflowId, sourceIsAncestor });
    process.stdout.write(`${JSON.stringify(proof)}\n`);
    return;
  }
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
