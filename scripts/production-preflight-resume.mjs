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

export function serializePreflightRetryRunIds(runIds) {
  if (!Array.isArray(runIds)) throw new TypeError("Preflight retry run IDs must be an array.");
  const ids = runIds.map((id) => String(id));
  if (ids.some((id) => !/^[1-9][0-9]*$/.test(id)) || new Set(ids).size !== ids.length) {
    throw new Error("Preflight retry run IDs must be unique positive integers.");
  }
  return ids.length === 0 ? "" : `${ids.join("\n")}\n`;
}
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
const MIGRATION_FAILURE_JOB = "Final live guard and authorized migration";
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

function normalizeActionLog(text) {
  return String(text ?? "")
    .replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizeActionLogLabel(value) {
  return String(value ?? "").replace(/[^A-Za-z0-9 .:/_()'-]/g, "?").slice(0, 120);
}

function parseActionLogRecords(text) {
  const records = [];
  const lines = String(text ?? "")
    .replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\r\n?/g, "\n")
    .split("\n");
  const recordPrefix = /^([^\t]+)\t([^\t]+)\t(\d{4}-\d{2}-\d{2}T\S+Z)\s?(.*)$/;
  for (const line of lines) {
    const match = line.match(recordPrefix);
    if (match) {
      records.push({ job: match[1], step: match[2], text: match[4] });
    } else if (records.length > 0) {
      records.at(-1).text += `\n${line}`;
    } else if (line.trim()) {
      records.push({ job: "", step: "", text: line });
    }
  }
  return records;
}

function findAllOccurrences(text, needle) {
  const positions = [];
  for (let from = 0; (from = text.indexOf(needle, from)) !== -1; from += needle.length) positions.push(from);
  return positions;
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

function assertSafeAuthorizationOnlyPreflightRetry(evidence, { preflightWorkflowId, historyRun }) {
  const run = evidence?.run;
  const runId = String(run?.id ?? "");
  if (!/^[1-9][0-9]*$/.test(runId)
    || String(run?.workflow_id) !== String(preflightWorkflowId)
    || workflowPath(run) !== PREFLIGHT_PATH
    || run.status !== "completed" || run.conclusion !== "failure"
    || run.run_attempt !== 1 || run.head_branch !== "main" || run.event !== "workflow_dispatch"
    || String(run.actor?.id) !== BODYCAST_OWNER_ID || String(run.triggering_actor?.id) !== BODYCAST_OWNER_ID
    || !/^[a-f0-9]{40}$/.test(String(run.head_sha ?? ""))
    || evidence.shaIsAncestorOfCurrentMain !== true
    || !historyRun || String(historyRun.id) !== runId
    || historyRun.head_sha !== run.head_sha || historyRun.workflow_id !== run.workflow_id
    || historyRun.path !== run.path || historyRun.event !== run.event
    || historyRun.status !== run.status || historyRun.conclusion !== run.conclusion
    || historyRun.run_attempt !== run.run_attempt || historyRun.head_branch !== run.head_branch) {
    reject("a later failed preflight retry is not a verified owner authorization-only failure on current-main ancestry.");
  }
  try {
    assertTrustedOwnerWorkflowRun(run, {
      actorId: BODYCAST_OWNER_ID, workflowPath: PREFLIGHT_PATH, workflowRunId: runId,
      workflowRunAttempt: 1, ref: "refs/heads/main", sha: run.head_sha,
    });
  } catch (error) {
    reject(error.message);
  }
  const jobs = evidence.jobs;
  if (jobs?.total_count !== 2 || !Array.isArray(jobs.jobs) || jobs.jobs.length !== 2) {
    reject("a failed preflight retry job inventory is incomplete or unexpected.");
  }
  const authorize = jobByName(jobs, "Authorize read-only preflight", {
    conclusion: "failure", headSha: run.head_sha, attempt: 1,
  });
  const failedSteps = (authorize.steps ?? []).filter((step) => step.conclusion === "failure").map((step) => step.name);
  if (failedSteps.length !== 1 || failedSteps[0] !== "Validate canonical repository, exact main, and successful CI") {
    reject("a failed preflight retry did not stop at the read-only authorization gate.");
  }
  const inspect = jobByName(jobs, "Inspect, back up, restore, and rehearse on disposable PostgreSQL", {
    conclusion: "skipped", headSha: run.head_sha, attempt: 1,
  });
  if (!Array.isArray(inspect.steps) || inspect.steps.length !== 0) {
    reject("a failed preflight retry entered the production inspection job.");
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
  laterRuns, safeFailedPreflightRetries, sourceRunId, migrationRunId, blockedCaptureRunId, currentRunId, currentMainSha,
  preflightWorkflowId, migrationWorkflowId, sourceIsAncestor, sourceIsAncestorOfBlockedCapture,
  blockedCaptureIsAncestorOfCurrentMain,
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
  const logRecords = parseActionLogRecords(migrationLogText);
  const evidenceRecords = logRecords.filter((record) => record.job === MIGRATION_FAILURE_JOB && record.step === MIGRATION_FAILURE_STEP);
  const otherRecords = logRecords.filter((record) => record.job !== MIGRATION_FAILURE_JOB || record.step !== MIGRATION_FAILURE_STEP);
  const normalizedEvidenceLog = normalizeActionLog(evidenceRecords.map((record) => record.text).join("\n"));
  const normalizedOtherLogs = normalizeActionLog(otherRecords.map((record) => record.text).join("\n"));
  const importFailure = normalizeActionLog(MIGRATION_PRE_DDL_FAILURE);
  const writerDrainMarker = normalizeActionLog(WRITER_DRAIN_READY_MARKER);
  const failurePositions = findAllOccurrences(normalizedEvidenceLog, importFailure);
  const writerDrainReadyPosition = normalizedEvidenceLog.indexOf(writerDrainMarker);
  const failuresOutsideMigrationStep = findAllOccurrences(normalizedOtherLogs, importFailure).length;
  const writerDrainOutsideMigrationStep = findAllOccurrences(normalizedOtherLogs, writerDrainMarker).length;
  const failedSteps = (migrationExecution.steps ?? []).filter((step) => step.conclusion === "failure").map((step) => step.name);
  if (failurePositions.length !== 3 || failuresOutsideMigrationStep !== 0 || writerDrainOutsideMigrationStep !== 0
    || findAllOccurrences(normalizedEvidenceLog, writerDrainMarker).length !== 1
    || failedSteps.length !== 1 || failedSteps[0] !== MIGRATION_FAILURE_STEP) {
    const observedMarkerRecordLabels = logRecords.flatMap((record) => {
      const normalizedRecord = normalizeActionLog(record.text);
      const importFailureOccurrences = findAllOccurrences(normalizedRecord, importFailure).length;
      const writerDrainOccurrences = findAllOccurrences(normalizedRecord, writerDrainMarker).length;
      if (importFailureOccurrences === 0 && writerDrainOccurrences === 0) return [];
      return [{
        job: sanitizeActionLogLabel(record.job),
        step: sanitizeActionLogLabel(record.step),
        importFailureOccurrences,
        writerDrainOccurrences,
      }];
    }).slice(0, 8);
    const diagnostics = {
      parsedLogRecords: logRecords.length,
      fixedMigrationStepRecords: evidenceRecords.length,
      knownImportFailuresInFixedStep: failurePositions.length,
      knownImportFailuresOutsideFixedStep: failuresOutsideMigrationStep,
      writerDrainMarkersInFixedStep: findAllOccurrences(normalizedEvidenceLog, writerDrainMarker).length,
      writerDrainMarkersOutsideFixedStep: writerDrainOutsideMigrationStep,
      failedMigrationSteps: failedSteps.length,
      onlyExpectedMigrationStepFailed: failedSteps.length === 1 && failedSteps[0] === MIGRATION_FAILURE_STEP,
      observedMarkerRecordLabels,
    };
    reject(`the migration log does not show exactly three known import failures in the fixed migration step (sanitized evidence counts: ${JSON.stringify(diagnostics)}).`);
  }
  if (!(failurePositions[0] < failurePositions[1]
    && failurePositions[1] < writerDrainReadyPosition && writerDrainReadyPosition < failurePositions[2])) {
    reject("the two failed live probes, successful writer-drain observation, and final-guard import failure are not in the reviewed order.");
  }

  const blockedCaptureSha = blockedCaptureRun?.head_sha;
  assertPreflightRun(blockedCaptureRun, {
    runId: blockedCaptureRunId, workflowId: preflightWorkflowId, sha: blockedCaptureSha, conclusion: "failure",
  });
  if (!/^[a-f0-9]{40}$/.test(String(blockedCaptureSha ?? ""))
    || sourceIsAncestorOfBlockedCapture !== true || blockedCaptureIsAncestorOfCurrentMain !== true) {
    reject("the blocked capture retry SHA is not on the verified source-to-current-main ancestry chain.");
  }
  if (blockedCaptureJobs?.total_count !== 2 || !Array.isArray(blockedCaptureJobs.jobs) || blockedCaptureJobs.jobs.length !== 2) {
    reject("the capture-blocked preflight job inventory is incomplete or unexpected.");
  }
  jobByName(blockedCaptureJobs, "Authorize read-only preflight", { conclusion: "success", headSha: blockedCaptureSha, attempt: 1 });
  const blockedInspect = jobByName(blockedCaptureJobs,
    "Inspect, back up, restore, and rehearse on disposable PostgreSQL", { conclusion: "failure", headSha: blockedCaptureSha, attempt: 1 });
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
  const laterRunById = new Map();
  for (const run of laterRuns ?? []) {
    const id = String(run?.id ?? "");
    if (!/^[1-9][0-9]*$/.test(id)) reject("later production workflow history contains a malformed run identifier.");
    if (laterRunById.has(id)) reject("later production workflow history contains a duplicate run.");
    laterRunById.set(id, run);
  }
  const safeRetryById = new Map();
  for (const evidence of safeFailedPreflightRetries ?? []) {
    const id = String(evidence?.run?.id ?? "");
    if (safeRetryById.has(id)) reject("failed preflight retry evidence contains a duplicate run.");
    safeRetryById.set(id, evidence);
  }
  const allowedIds = new Set([String(migrationRunId), String(blockedCaptureRunId)]);
  const verifiedRetryIds = new Set();
  for (const run of laterRuns ?? []) {
    const id = BigInt(String(run.id));
    if (!MUTATION_WORKFLOW_PATHS.has(workflowPath(run)) || id <= sourceId || id === currentId) continue;
    if (allowedIds.delete(String(run.id))) continue;
    if (workflowPath(run) === PREFLIGHT_PATH) {
      const retryEvidence = safeRetryById.get(String(run.id));
      if (!retryEvidence) reject(`an unexpected production mutation workflow exists after source preflight ${sourceRunId}.`);
      assertSafeAuthorizationOnlyPreflightRetry(retryEvidence, {
        preflightWorkflowId, historyRun: laterRunById.get(String(run.id)),
      });
      verifiedRetryIds.add(String(run.id));
      continue;
    }
    reject(`an unexpected production mutation workflow exists after source preflight ${sourceRunId}.`);
  }
  if (allowedIds.size !== 0) reject("one or more verified production workflow runs are absent from the complete history.");
  if (verifiedRetryIds.size !== safeRetryById.size) reject("failed preflight retry evidence does not match the complete workflow history.");

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
  if (mode === "--verify-pre-ddl-migration-failure" && args.length === 19) {
    const [sourceRunPath, sourceJobsPath, sourceArtifactsPath, migrationRunPath, migrationJobsPath, migrationLogPath,
      blockedRunPath, blockedJobsPath, blockedArtifactsPath, blockedLogPath, laterRunsPath, safeRetriesPath, sourceRunId,
      migrationRunId, blockedCaptureRunId, currentRunId, currentMainSha, preflightWorkflowId, migrationWorkflowId] = args;
    const [sourceRun, sourceJobs, sourceArtifacts, migrationRun, migrationJobs, migrationLogText, blockedCaptureRun,
      blockedCaptureJobs, blockedCaptureArtifacts, blockedCaptureLogText, laterRunsText, safeRetriesText] = await Promise.all([
      readJson(sourceRunPath), readJson(sourceJobsPath), readJson(sourceArtifactsPath), readJson(migrationRunPath),
      readJson(migrationJobsPath), readFile(migrationLogPath, "utf8"), readJson(blockedRunPath), readJson(blockedJobsPath),
      readJson(blockedArtifactsPath), readFile(blockedLogPath, "utf8"), readFile(path.resolve(laterRunsPath), "utf8"),
      readFile(path.resolve(safeRetriesPath), "utf8"),
    ]);
    const isAncestor = (ancestor, descendant) => {
      try { execFileSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], { stdio: "ignore" }); return true; } catch { return false; }
    };
    const sourceIsAncestor = isAncestor(sourceRun.head_sha, currentMainSha);
    const sourceIsAncestorOfBlockedCapture = isAncestor(sourceRun.head_sha, blockedCaptureRun.head_sha);
    const blockedCaptureIsAncestorOfCurrentMain = isAncestor(blockedCaptureRun.head_sha, currentMainSha);
    const safeFailedPreflightRetries = parseNdjson(safeRetriesText).map((evidence) => ({
      ...evidence, shaIsAncestorOfCurrentMain: isAncestor(evidence?.run?.head_sha, currentMainSha),
    }));
    const proof = verifyPreDdlMigrationFailureResume({ sourceRun, sourceJobs, sourceArtifacts, migrationRun, migrationJobs,
      migrationLogText, blockedCaptureRun, blockedCaptureJobs, blockedCaptureArtifacts, blockedCaptureLogText,
      laterRuns: parseNdjson(laterRunsText), safeFailedPreflightRetries, sourceRunId, migrationRunId, blockedCaptureRunId, currentRunId,
      currentMainSha, preflightWorkflowId, migrationWorkflowId, sourceIsAncestor,
      sourceIsAncestorOfBlockedCapture, blockedCaptureIsAncestorOfCurrentMain });
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
