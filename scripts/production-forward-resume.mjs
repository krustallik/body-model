import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { assertTrustedOwnerWorkflowRun, BODYCAST_OWNER_ID } from "./github-owner-identity.mjs";
import { canonicalSha256, verifyHistoricalMigrationAuthorizationEnvelope } from "./production-migration-authorization.mjs";
import { schemaInventoryDigest } from "./production-migration-preflight.mjs";
import { readProductionReleaseMarker } from "./production-release-marker.mjs";

export const FORWARD_RESUME_FAILED_RUN_ID = "38022978032";
export const FORWARD_RESUME_FAILED_SHA = "3cbf47ef73b83cdc9cd2ad548dbb36ca2b65bf74";
export const FORWARD_RESUME_PURPOSE = "bodycast-forward-resume-after-verified-pre-spawn-failure-v1";
export const ARMED_RETRY_FAILED_RUN_ID = "38062632284";
export const ARMED_RETRY_FAILED_SHA = "b0a31fb6e6552d6ea5419939c96ee42ca7d6ffca";
export const ARMED_RETRY_PURPOSE = "bodycast-forward-resume-armed-pre-spawn-retry-v1";
const DIGEST = /^[a-f0-9]{64}$/;
export const MIGRATION_FAILURE_JOB = "Final live guard and authorized migration";
export const MIGRATION_FAILURE_STEP = "Run the fixed guarded migration script over SSH";
export const MIGRATION_GUARD_FAILURE = "Refusing Prisma DDL: final Prisma writer-drain observation is missing, stale, or has active/unknown client backends.";
export const MUTATION_WORKFLOW_PATHS = new Set([
  ".github/workflows/production-migration-preflight.yml",
  ".github/workflows/production-migrate.yml",
  ".github/workflows/production-database-cutback.yml",
  ".github/workflows/activate-unified-v4-production.yml",
  ".github/workflows/deploy-production.yml",
]);

function reject(message) { throw new Error(`Forward-resume blocked: ${message}`); }
function workflowPath(run) { return typeof run?.path === "string" ? run.path.split("@")[0] : ""; }
function sha256(bytes) { return createHash("sha256").update(bytes).digest("hex"); }

export const DIAGNOSTIC_PATH = ".github/workflows/production-checkout-diagnostic.yml";
// Historical diagnostics used this exact reviewed implementation before the
// workflow added fixed runtime metadata and a public maintenance probe.
export const DIAGNOSTIC_LEGACY_REVIEWED_SHA = "b693be7d7b7103e263d35bd67b542f77114c5dca";
export const DIAGNOSTIC_FILES = Object.freeze([DIAGNOSTIC_PATH, "scripts/production-checkout-diagnostic.sh",
  "scripts/github-owner-identity.mjs", "scripts/filter-ssh-known-hosts.mjs"]);
function assertMatchingHistoryRun(run, historyRun) {
  if (!historyRun || ["id", "workflow_id", "path", "event", "head_branch", "head_sha", "status", "conclusion", "run_attempt"]
    .some((field) => historyRun[field] !== run[field])
    || String(historyRun.actor?.id) !== String(run.actor?.id)
    || String(historyRun.triggering_actor?.id) !== String(run.triggering_actor?.id)) reject("run metadata differs from the complete history.");
}
function verifyReadOnlyDiagnostic({ run, jobsPayload, historyRun, workflowId, shaIsAncestorOfCurrentMain,
  sourceFiles, reviewedFiles, legacyReviewedFiles, currentMainSha }) {
  assertMatchingHistoryRun(run, historyRun);
  assertTrustedOwnerWorkflowRun(run, { actorId: BODYCAST_OWNER_ID, workflowPath: DIAGNOSTIC_PATH,
    workflowRunId: String(run.id), workflowRunAttempt: 1, sha: run.head_sha });
  if (run.status !== "completed" || run.conclusion !== "success" || run.run_attempt !== 1
    || String(run.workflow_id) !== String(workflowId) || shaIsAncestorOfCurrentMain !== true
    || !/^[a-f0-9]{40}$/.test(run.head_sha ?? "") || !/^[a-f0-9]{40}$/.test(currentMainSha ?? "")
    || !sourceFiles || !reviewedFiles || !legacyReviewedFiles || Object.keys(sourceFiles).length !== DIAGNOSTIC_FILES.length
    || Object.keys(reviewedFiles).length !== DIAGNOSTIC_FILES.length
    || Object.keys(legacyReviewedFiles).length !== DIAGNOSTIC_FILES.length) reject("diagnostic source inspection is incomplete.");
  const matchesImplementation = (approvedFiles) => DIAGNOSTIC_FILES.every((file) =>
    Buffer.isBuffer(sourceFiles[file]) && Buffer.isBuffer(approvedFiles[file]) && sourceFiles[file].equals(approvedFiles[file]));
  const implementation = matchesImplementation(reviewedFiles) ? "current" : matchesImplementation(legacyReviewedFiles) ? "legacy-reviewed" : null;
  if (!implementation) reject("diagnostic code differs from all reviewed read-only implementations.");
  const expectedJobs = [
    ["Authorize owner-requested exact-main diagnostic", ["Set up job", "Checkout current main gate helpers",
      "Verify owner, exact current-main SHA, confirmation, and green CI", "Post Checkout current main gate helpers", "Complete job"]],
    ["Inspect production checkout without mutation", ["Set up job", "Checkout exact current-main diagnostic script",
      "Recheck owner run identity and current main before production credentials", "Validate SSH inputs and pin the production host",
      "Inspect checkout metadata read-only", "Remove temporary SSH credentials", "Post Checkout exact current-main diagnostic script", "Complete job"]],
  ];
  const jobs = jobsPayload?.jobs;
  if (jobsPayload?.total_count !== 2 || !Array.isArray(jobs) || jobs.length !== 2
    || new Set(jobs.map((job) => job.id)).size !== 2) reject("diagnostic job inventory incomplete.");
  for (const [name, steps] of expectedJobs) {
    const job = jobs.find((item) => item.name === name);
    if (!job || !/^[1-9][0-9]*$/.test(String(job.id)) || String(job.run_id) !== String(run.id)
      || job.head_sha !== run.head_sha || job.run_attempt !== 1
      || job.status !== "completed" || job.conclusion !== "success" || job.steps?.length !== steps.length
      || job.steps.some((step, index) => step.name !== steps[index] || step.status !== "completed" || step.conclusion !== "success")) {
      reject("diagnostic did not complete the reviewed read-only job/step sequence.");
    }
  }
  return { purpose: "verified-read-only-checkout-diagnostic-v1", runId: String(run.id), runAttempt: 1,
    sha: run.head_sha, reviewedSha: implementation === "current" ? currentMainSha : DIAGNOSTIC_LEGACY_REVIEWED_SHA,
    implementation,
    fileDigests: Object.fromEntries(DIAGNOSTIC_FILES.map((file) => [file, sha256(sourceFiles[file])])) };
}

function verifyAuthorizationOnlyForwardResumePreflightRetry({ run, jobsPayload, workflowId, currentMainSha,
  shaIsAncestorOfCurrentMain, historyRun }) {
  const runId = String(run?.id ?? "");
  const expectedSha = run?.head_sha;
  const expectedPath = ".github/workflows/production-migration-preflight.yml";
  if (!/^[1-9][0-9]*$/.test(runId) || !/^[a-f0-9]{40}$/.test(expectedSha ?? "")
    || String(run?.workflow_id) !== String(workflowId)
    || workflowPath(run) !== expectedPath
    || run?.event !== "workflow_dispatch" || run?.head_branch !== "main"
    || run?.status !== "completed" || run?.conclusion !== "failure" || run?.run_attempt !== 1
    || String(run?.actor?.id) !== BODYCAST_OWNER_ID || String(run?.triggering_actor?.id) !== BODYCAST_OWNER_ID
    || shaIsAncestorOfCurrentMain !== true || !/^[a-f0-9]{40}$/.test(String(currentMainSha ?? ""))
    || !historyRun || String(historyRun.id) !== runId
    || ["workflow_id", "path", "event", "head_branch", "head_sha", "status", "conclusion", "run_attempt"]
      .some((field) => historyRun[field] !== run[field])
    || String(historyRun.actor?.id) !== BODYCAST_OWNER_ID || String(historyRun.triggering_actor?.id) !== BODYCAST_OWNER_ID) {
    reject("the intervening preflight is not the exact owner-authorized failed read-only gate attempt.");
  }
  try {
    assertTrustedOwnerWorkflowRun(run, {
      actorId: BODYCAST_OWNER_ID, workflowPath: expectedPath, workflowRunId: runId,
      workflowRunAttempt: 1, ref: "refs/heads/main", sha: expectedSha,
    });
  } catch (error) { reject(error.message); }

  const jobs = jobsPayload?.jobs;
  if (jobsPayload?.total_count !== 2 || !Array.isArray(jobs) || jobs.length !== 2
    || new Set(jobs.map((job) => String(job.id))).size !== 2
    || jobs.some((job) => !/^[1-9][0-9]*$/.test(String(job.id)) || String(job.run_id) !== runId
      || job.status !== "completed" || job.head_sha !== expectedSha || job.run_attempt !== 1)) {
    reject("the intervening preflight job inventory is incomplete or unexpected.");
  }
  const authorize = jobs.find((job) => job.name === "Authorize read-only preflight");
  const production = jobs.find((job) => job.name === "Inspect, back up, restore, and rehearse on disposable PostgreSQL");
  const expectedAuthorizationSteps = [
    ["Set up job", "success"],
    ["Checkout current main tooling", "success"],
    ["Validate canonical repository, exact main, and successful CI", "failure"],
    ["Post Checkout current main tooling", "success"],
    ["Complete job", "success"],
  ];
  if (authorize?.status !== "completed" || authorize?.conclusion !== "failure"
    || production?.status !== "completed" || production?.conclusion !== "skipped"
    || !Array.isArray(production.steps) || production.steps.length !== 0
    || !Array.isArray(authorize.steps) || authorize.steps.length !== expectedAuthorizationSteps.length
    || authorize.steps.some((step, index) => step.name !== expectedAuthorizationSteps[index][0]
      || step.status !== "completed" || step.conclusion !== expectedAuthorizationSteps[index][1])) {
    reject("the intervening preflight did not fail only in authorization before the production job started.");
  }
  return Object.freeze({
    schemaVersion: 1,
    purpose: "bodycast-forward-resume-authorization-only-preflight-retry-v1",
    runId,
    runAttempt: 1,
    sha: expectedSha,
    currentMainSha,
    ownerId: BODYCAST_OWNER_ID,
    authorizationJobId: String(authorize.id),
    productionJobId: String(production.id),
    productionJobStarted: false,
  });
}

export function selectForwardResumeMigrationContextArtifact(payload, sourceRunId = FORWARD_RESUME_FAILED_RUN_ID) {
  const armedRetry = String(sourceRunId) === ARMED_RETRY_FAILED_RUN_ID;
  const expectedRunId = armedRetry ? ARMED_RETRY_FAILED_RUN_ID : FORWARD_RESUME_FAILED_RUN_ID;
  const expectedSha = armedRetry ? ARMED_RETRY_FAILED_SHA : FORWARD_RESUME_FAILED_SHA;
  if (String(sourceRunId) !== expectedRunId) reject("the source artifact run is not admitted.");
  const expectedName = `bodycast-migration-auth-${expectedRunId}-1`;
  const artifacts = payload?.artifacts;
  if (!Array.isArray(artifacts)) reject("the original signed migration context artifact inventory is malformed.");
  const matches = artifacts.filter((artifact) => artifact?.name === expectedName);
  if (matches.length !== 1) reject("the exact original signed migration context artifact is missing or ambiguous.");

  const artifact = matches[0];
  const workflowRun = artifact.workflow_run;
  const reportedAttempt = workflowRun?.run_attempt;
  // GitHub's artifact-list API omits workflow_run.run_attempt. The exact attempt is
  // bound by the artifact name here and by the signed authorization claims below.
  // If GitHub does return the field, it must agree with that attempt.
  const attemptMatches = reportedAttempt === undefined || reportedAttempt === null
    || (Number.isSafeInteger(reportedAttempt) && reportedAttempt === 1);
  if (!/^[1-9][0-9]*$/.test(String(artifact.id ?? ""))
    || artifact.expired !== false
    || !Number.isSafeInteger(artifact.size_in_bytes) || artifact.size_in_bytes < 1
    || !/^sha256:[a-f0-9]{64}$/.test(String(artifact.digest ?? ""))
    || String(workflowRun?.id) !== expectedRunId
    || workflowRun?.head_branch !== "main" || workflowRun?.head_sha !== expectedSha
    || !attemptMatches) {
    reject("the original signed migration context artifact metadata does not match the exact source run and attempt.");
  }

  return Object.freeze({
    id: String(artifact.id),
    name: artifact.name,
    digest: artifact.digest,
    workflowRunId: String(workflowRun.id),
    workflowRunAttempt: 1,
    headSha: workflowRun.head_sha,
  });
}

function parseJobLog(text) {
  const records = [];
  let previous = -1n;
  for (const line of String(text ?? "").replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "").replace(/\r\n?/g, "\n").split("\n")) {
    const timestampAndMessage = line.replace(/^\uFEFF/, "");
    const match = timestampAndMessage.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z) ([\s\S]*)$/);
    if (!match) {
      if (timestampAndMessage.trim()) reject("raw job log contains an unframed record.");
      continue;
    }
    const [, timestamp, message] = match;
    const time = Date.parse(timestamp);
    const fraction = timestamp.match(/\.(\d+)Z$/)?.[1] ?? "";
    const precise = Number.isFinite(time) ? BigInt(Math.floor(time / 1000)) * 1_000_000_000n
      + BigInt(fraction.slice(0, 9).padEnd(9, "0")) : -1n;
    if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 19) !== timestamp.slice(0, 19)
      || fraction.length > 9 || precise < previous || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(message)) {
      reject("raw job log timestamps or control characters are invalid or out of order.");
    }
    previous = precise;
    records.push({ timestamp, message });
  }
  return records;
}

function selectRawFailedStepLog(records, actualSteps, failedStepIndex) {
  const failedStep = actualSteps[failedStepIndex];
  const nextStep = actualSteps[failedStepIndex + 1];
  const startedAt = Date.parse(failedStep?.started_at ?? "");
  const completedAt = Date.parse(failedStep?.completed_at ?? "");
  const nextStartedAt = Date.parse(nextStep?.started_at ?? "");
  if (![startedAt, completedAt, nextStartedAt].every(Number.isFinite)
    || completedAt < startedAt || nextStartedAt < completedAt) {
    reject("the failed migration step lacks a valid ordered GitHub timestamp boundary.");
  }

  const groupMarkers = records.flatMap((record, index) => record.message.startsWith("##[group]Run ")
    ? [{ index, timestamp: Date.parse(record.timestamp) }] : []);
  const failedStepMarkers = groupMarkers.filter((marker) => marker.timestamp >= startedAt
    && marker.timestamp < nextStartedAt);
  if (failedStepMarkers.length !== 1) {
    reject("raw GitHub job logs do not identify one unambiguous failed-step boundary.");
  }
  const failedStepMarker = failedStepMarkers[0];
  const nextStepMarker = groupMarkers.find((marker) => marker.index > failedStepMarker.index
    && marker.timestamp >= nextStartedAt);
  if (!nextStepMarker) reject("raw GitHub job logs do not identify the following step boundary.");

  return {
    failedStepRecords: records.slice(failedStepMarker.index, nextStepMarker.index),
    fromFailedStepRecords: records.slice(failedStepMarker.index),
  };
}

function validateNoSpawnSource(sourceBytes, loggedRuntime) {
  const source = Buffer.from(sourceBytes);
  const digest = sha256(source);
  if (!loggedRuntime || loggedRuntime.sha256 !== digest || loggedRuntime.bytes !== source.length) {
    reject("the migrator runtime guard bytes do not match the exact failed-run Git blob.");
  }
  const text = source.toString("utf8");
  const guard = text.indexOf("assertPrismaTargetMatchesSignedIdentity(finalGuard.receipt, actualIdentity, now());");
  const prismaSpawn = text.indexOf('return spawn("npx", ["prisma", "migrate", "deploy"]');
  const failedPredicate = text.indexOf("writerDrain.activeClientBackends.length > 0");
  const rejection = text.indexOf("final Prisma writer-drain observation is missing, stale, or has active/unknown client backends.");
  if (guard < 0 || prismaSpawn <= guard || failedPredicate < 0 || rejection < failedPredicate || rejection > prismaSpawn) {
    reject("the exact failed-run source does not prove the failed writer-drain assertion precedes the Prisma spawn site.");
  }
  return { sourceSha256: digest, sourceBytes: source.length };
}

function validateArmedRetryNoSpawnSource(sourceBytes, loggedRuntime) {
  const source = Buffer.from(sourceBytes);
  const digest = sha256(source);
  if (!loggedRuntime || loggedRuntime.sha256 !== digest || loggedRuntime.bytes !== source.length) {
    reject("the armed retry guard bytes do not match the failed-run image attestation.");
  }
  const text = source.toString("utf8");
  const failedCheck = text.indexOf('id: "zero-other-client-backends"');
  const guard = text.indexOf("assertPrismaTargetMatchesSignedIdentity(finalGuard.receipt, actualIdentity, now());");
  const marker = text.indexOf("const marker = await markerWriter({", guard);
  const prismaSpawn = text.indexOf('child = spawn("npx", ["prisma", "migrate", "deploy"]', marker);
  if (failedCheck < 0 || guard < 0 || marker <= guard || prismaSpawn <= marker) {
    reject("the exact armed retry guard source does not prove rejection before marker transition and Prisma spawn.");
  }
  return { sourceSha256: digest, sourceBytes: source.length };
}

function verifyArmedRetryGuardFailure(records) {
  const prefix = "Refusing Prisma DDL: final Prisma DATABASE_URL target differs from the verified production identity or writer-drain predicates failed; checks=";
  const matches = records.filter((entry) => entry.message.startsWith(prefix));
  if (matches.length !== 1) reject("the armed retry failure log lacks one exact final Prisma guard rejection.");
  let checks;
  try { checks = JSON.parse(matches[0].message.slice(prefix.length)); } catch { reject("the armed retry guard diagnostics are malformed."); }
  const expected = ["signed-database-identity-digest", "canonical-postgres-identity", "exact-database-identity-match",
    "writer-drain-schema", "writer-drain-observer-pid", "fixed-observer-application", "zero-other-client-policy",
    "complete-backend-inventory", "zero-other-client-backends", "fresh-writer-drain-observation"];
  if (!Array.isArray(checks) || checks.length !== expected.length || checks.some((entry, index) =>
    entry?.id !== expected[index] || entry.passed !== (entry.id !== "zero-other-client-backends")
      || Object.keys(entry).sort().join(",") !== "id,passed")) {
    reject("the armed retry did not stop solely on the zero-other-client predicate.");
  }
}

export function verifyForwardResumeNoSpawnEvidence({ run, jobsPayload, logText, sourceGuardBytes,
  workflowId, sourceIsAncestor, sourceRunId = FORWARD_RESUME_FAILED_RUN_ID }) {
  const armedRetry = String(sourceRunId) === ARMED_RETRY_FAILED_RUN_ID;
  const expectedRunId = armedRetry ? ARMED_RETRY_FAILED_RUN_ID : FORWARD_RESUME_FAILED_RUN_ID;
  const expectedSha = armedRetry ? ARMED_RETRY_FAILED_SHA : FORWARD_RESUME_FAILED_SHA;
  const purpose = armedRetry ? ARMED_RETRY_PURPOSE : FORWARD_RESUME_PURPOSE;
  if (String(sourceRunId) !== expectedRunId || String(run?.id) !== expectedRunId || String(run?.workflow_id) !== String(workflowId)
    || workflowPath(run) !== ".github/workflows/production-migrate.yml"
    || run?.event !== "workflow_dispatch" || run?.head_branch !== "main"
    || run?.head_sha !== expectedSha || run?.status !== "completed" || run?.conclusion !== "failure"
    || run?.run_attempt !== 1 || sourceIsAncestor !== true) {
    reject("the named source is not the original completed owner migration failure on the expected main SHA.");
  }
  try {
    assertTrustedOwnerWorkflowRun(run, { actorId: BODYCAST_OWNER_ID,
      workflowPath: ".github/workflows/production-migrate.yml", workflowRunId: expectedRunId,
      workflowRunAttempt: 1, ref: "refs/heads/main", sha: expectedSha });
  } catch (error) { reject(error.message); }

  const jobs = jobsPayload?.jobs;
  if (jobsPayload?.total_count !== 3 || !Array.isArray(jobs) || jobs.length !== 3
    || new Set(jobs.map((job) => String(job.id))).size !== 3
    || jobs.some((job) => !/^[1-9][0-9]*$/.test(String(job.id)) || String(job.run_id) !== expectedRunId
      || job.status !== "completed" || job.head_sha !== expectedSha || job.run_attempt !== 1)) {
    reject("the original migration run job inventory is incomplete or unexpected.");
  }
  const authorize = jobs.find((job) => job.name === "Select latest exact preflight evidence");
  const sign = jobs.find((job) => job.name === "Sign migration authorization envelope");
  const execution = jobs.find((job) => job.name === MIGRATION_FAILURE_JOB);
  if (authorize?.conclusion !== "success" || sign?.conclusion !== "success" || execution?.conclusion !== "failure") {
    reject("owner authorization/signing did not succeed before the single failed execution job.");
  }
  const expectedSteps = [
    ["Set up job", "success"],
    ["Checkout exact authorized release SHA", "success"],
    ["Set up Node runtime", "success"],
    ["Recheck current canonical main before production SSH", "success"],
    ["Download only the signed context artifact", "success"],
    ["Validate protected production SSH and pin host key", "success"],
    ["Trust only the SSH key matching the pinned fingerprint", "success"],
    ["Stream signed evidence files to private remote temporary context", "success"],
    [MIGRATION_FAILURE_STEP, "failure"],
    ["Remove temporary runner credentials", "success"],
    ["Post Set up Node runtime", "skipped"],
    ["Post Checkout exact authorized release SHA", "success"],
    ["Complete job", "success"],
  ];
  const actualSteps = execution.steps ?? [];
  if (actualSteps.length !== expectedSteps.length || actualSteps.some((step, index) =>
    step.name !== expectedSteps[index][0] || step.status !== "completed" || step.conclusion !== expectedSteps[index][1])) {
    reject("the exact migration job step sequence differs from the observed pre-spawn guard failure.");
  }
  const executionStepIndex = actualSteps.findIndex((step) => step.name === MIGRATION_FAILURE_STEP);
  const { failedStepRecords, fromFailedStepRecords } = selectRawFailedStepLog(
    parseJobLog(logText), actualSteps, executionStepIndex,
  );
  if (armedRetry) verifyArmedRetryGuardFailure(failedStepRecords);
  else if (failedStepRecords.filter((entry) => entry.message === MIGRATION_GUARD_FAILURE).length !== 1) {
    reject("failed-step logs do not contain one exact final writer-drain failure.");
  }
  if (fromFailedStepRecords.some((entry) => /Applying migration|No pending migrations to apply|All migrations have been applied/i.test(entry.message))) {
    reject("failed-step logs contain Prisma migration execution output.");
  }
  const runtimeRecords = [];
  for (const entry of failedStepRecords) {
    const start = entry.message.indexOf("{");
    if (start < 0) continue;
    try {
      const value = JSON.parse(entry.message.slice(start));
      const item = value?.authorizationRuntime?.find((runtime) => runtime?.name === "run-prisma-migrate-with-lock-timeout.mjs");
      if (item) runtimeRecords.push(item);
    } catch { /* Other structured log output is not the source-byte attestation. */ }
  }
  if (runtimeRecords.length !== 1) reject("the failed job lacks a unique in-image guard byte attestation.");
  const source = armedRetry ? validateArmedRetryNoSpawnSource(sourceGuardBytes, runtimeRecords[0])
    : validateNoSpawnSource(sourceGuardBytes, runtimeRecords[0]);
  return Object.freeze({
    schemaVersion: 1,
    purpose,
    sourceRunId: expectedRunId,
    sourceRunAttempt: 1,
    sourceSha: expectedSha,
    sourceWorkflowId: String(workflowId),
    sourceJobId: String(execution.id),
    failedStep: MIGRATION_FAILURE_STEP,
    actorId: BODYCAST_OWNER_ID,
    noPrismaSpawnVerified: true,
    failureCode: "final-prisma-writer-drain-rejected-before-spawn",
    guardRuntimeSha256: source.sourceSha256,
    guardRuntimeBytes: source.sourceBytes,
    failedStepLogSha256: sha256(Buffer.from(String(logText), "utf8")),
  });
}

export function verifyForwardResumeAuthorizationBundle({ envelope, preflightEvidence, preflightResult, restoreResult,
  artifactMetadata, allowlist, failedRunId = FORWARD_RESUME_FAILED_RUN_ID }) {
  const armedRetry = String(failedRunId) === ARMED_RETRY_FAILED_RUN_ID;
  const expectedSha = armedRetry ? ARMED_RETRY_FAILED_SHA : FORWARD_RESUME_FAILED_SHA;
  if (String(failedRunId) !== (armedRetry ? ARMED_RETRY_FAILED_RUN_ID : FORWARD_RESUME_FAILED_RUN_ID)) {
    reject("the signed source artifact is not from an admitted failed migration run.");
  }
  const verified = verifyHistoricalMigrationAuthorizationEnvelope(envelope, { allowlist, expected: {
    workflowRunId: failedRunId,
    workflowRunAttempt: 1,
    releaseSha: expectedSha,
    currentMainSha: expectedSha,
    actorId: BODYCAST_OWNER_ID,
    manifestId: "active-energy-unified-v2",
  } });
  const claims = verified.payload;
  if (preflightResult?.readyForOwnerAuthorization !== true || preflightResult.manifestId !== claims.manifestId
    || canonicalSha256(preflightResult) !== claims.preflightResultDigest
    || preflightEvidence?.verified !== true || preflightEvidence.repository !== "krustallik/body-model"
    || preflightEvidence.workflowPath !== ".github/workflows/production-migration-preflight.yml"
    || preflightEvidence.releaseSha !== claims.releaseSha || preflightEvidence.manifestId !== claims.manifestId
    || preflightEvidence.workflowRunId !== claims.preflightRunId
    || Number(preflightEvidence.workflowRunAttempt) !== claims.preflightRunAttempt
    || preflightEvidence.preflightResultDigest !== claims.preflightResultDigest
    || canonicalSha256(preflightResult) !== preflightEvidence.preflightResultDigest
    || canonicalSha256(restoreResult) !== claims.restoreResultDigest
    || canonicalSha256(restoreResult) !== preflightEvidence.restoreResultDigest
    || restoreResult?.verified !== true || restoreResult?.postflightReady !== true
    || canonicalSha256(preflightResult.previousAppProvenance) !== canonicalSha256(preflightEvidence.previousAppProvenance)
    || String(artifactMetadata?.id) !== claims.backupArtifactId
    || String(artifactMetadata?.digest).replace(/^sha256:/, "") !== claims.backupArtifactDigest
    || String(artifactMetadata?.workflowRunId) !== claims.preflightRunId
    || Number(artifactMetadata?.workflowRunAttempt) !== claims.preflightRunAttempt) {
    reject("the historical owner-signed migration artifact does not bind the exact preflight, previous-app capture, restore rehearsal, and backup metadata.");
  }
  if (armedRetry && (claims.executionMode !== "forward-resume"
    || claims.forwardResumeProofDigest !== preflightResult.forwardResume?.proofDigest
    || claims.forwardResumeSourceRunId !== FORWARD_RESUME_FAILED_RUN_ID
    || claims.forwardResumeSourceSha !== FORWARD_RESUME_FAILED_SHA
    || !DIGEST.test(String(claims.forwardResumeProofDigest ?? "")))) {
    reject("the armed retry source authorization does not bind the original verified forward-resume lineage.");
  }
  return Object.freeze({
    schemaVersion: 1,
    purpose: armedRetry ? ARMED_RETRY_PURPOSE : FORWARD_RESUME_PURPOSE,
    sourceRunId: String(failedRunId),
    sourceRunAttempt: 1,
    sourceSha: claims.releaseSha,
    preflightRunId: claims.preflightRunId,
    preflightRunAttempt: claims.preflightRunAttempt,
    previousAppProvenance: preflightResult.previousAppProvenance,
    preflightResultDigest: claims.preflightResultDigest,
    restoreResultDigest: claims.restoreResultDigest,
    originalAuthorizationId: claims.authorizationId,
    originalBackupArtifactId: claims.backupArtifactId,
    originalBackupArtifactDigest: claims.backupArtifactDigest,
    ...(armedRetry ? { sourceMarkerLineageDigest: claims.forwardResumeProofDigest } : {}),
  });
}

export function verifyForwardResumeMarkerObservation(observation, failureProof, authorizationBundleProof) {
  const armedRetry = failureProof?.purpose === ARMED_RETRY_PURPOSE;
  const fields = ["schemaVersion", "markerSchemaVersion", "releaseSha", "state", "markerDigest",
    ...(armedRetry ? ["workflowRunId", "workflowRunAttempt", "authorizationId", "lineageDigest", "spawnState"] : [])].sort();
  if (!observation || typeof observation !== "object" || Array.isArray(observation)
    || JSON.stringify(Object.keys(observation).sort()) !== JSON.stringify(fields)
    || observation.schemaVersion !== 1 || observation.markerSchemaVersion !== (armedRetry ? 2 : 1)
    || observation.releaseSha !== failureProof?.sourceSha || observation.state !== (armedRetry ? "forward-resume-armed" : "ddl-started")
    || (armedRetry && (observation.workflowRunId !== failureProof.sourceRunId
      || observation.workflowRunAttempt !== failureProof.sourceRunAttempt
      || observation.authorizationId !== authorizationBundleProof?.originalAuthorizationId
      || observation.lineageDigest !== authorizationBundleProof?.sourceMarkerLineageDigest
      || observation.spawnState !== "not-started"))
    || !/^[a-f0-9]{64}$/.test(String(observation.markerDigest ?? ""))) {
    reject("the live marker is not bound to the independently verified pre-spawn failure and signed authorization.");
  }
  return Object.freeze(observation);
}

export function verifyNoLaterMutationRun({ runs, sourceRunId = FORWARD_RESUME_FAILED_RUN_ID, currentRunId,
  currentMainSha, inventory: historyInventory, safeFailedPreflightRetries = [], readOnlyDiagnostics = [] }) {
  if (!historyInventory || historyInventory.complete !== true || historyInventory.scope !== "repository-since-source"
    || !Number.isSafeInteger(historyInventory.totalCount) || historyInventory.totalCount !== historyInventory.observedCount
    || !Array.isArray(runs) || historyInventory.totalCount < runs.length) reject("production workflow history is incomplete.");
  if (!/^[1-9][0-9]*$/.test(String(currentRunId ?? ""))) reject("current forward-resume preflight run ID is malformed.");
  const source = BigInt(sourceRunId);
  const current = BigInt(currentRunId);
  const inventory = [];
  const safeRetryById = new Map();
  for (const evidence of safeFailedPreflightRetries) {
    const runId = String(evidence?.run?.id ?? "");
    if (!runId || safeRetryById.has(runId)) reject("safe authorization-only preflight evidence is malformed or duplicated.");
    safeRetryById.set(runId, evidence);
  }
  const verifiedSafeRetryIds = new Set();
  const diagnosticById = new Map(readOnlyDiagnostics.map((evidence) => [String(evidence.run?.id), evidence]));
  if (diagnosticById.size !== readOnlyDiagnostics.length) reject("duplicate diagnostic evidence.");
  const verifiedDiagnosticIds = new Set();
  let hasSource = false;
  let hasCurrent = false;
  const seen = new Set();
  for (const run of runs ?? []) {
    const idText = String(run?.id ?? "");
    if (!/^[1-9][0-9]*$/.test(idText)) reject("production workflow history contains a malformed run ID.");
    if (seen.has(idText)) reject("production workflow history contains duplicate run IDs.");
    seen.add(idText);
    const id = BigInt(idText);
    const pathValue = workflowPath(run);
    if (!MUTATION_WORKFLOW_PATHS.has(pathValue) && pathValue !== DIAGNOSTIC_PATH) reject("unknown production workflow path in complete history.");
    if (id > current) reject("a newer production run exists during forward-resume verification.");
    if (id === source) hasSource = pathValue === ".github/workflows/production-migrate.yml";
    if (id === current) {
      assertTrustedOwnerWorkflowRun(run, { actorId: BODYCAST_OWNER_ID,
        workflowPath: ".github/workflows/production-migration-preflight.yml", workflowRunId: currentRunId,
        workflowRunAttempt: 1, sha: currentMainSha, requireInProgress: true });
      hasCurrent = true;
    }
    let interveningPreflightProof;
    if (id > source && id !== current) {
      if (pathValue === DIAGNOSTIC_PATH) {
        const evidence = diagnosticById.get(idText);
        if (!evidence || evidence.currentMainSha !== currentMainSha) reject("read-only diagnostic proof missing or stale.");
        interveningPreflightProof = verifyReadOnlyDiagnostic({ ...evidence, historyRun: run });
        verifiedDiagnosticIds.add(idText);
      } else {
        const evidence = safeRetryById.get(idText);
        if (pathValue !== ".github/workflows/production-migration-preflight.yml" || !evidence || evidence.currentMainSha !== currentMainSha) {
          reject("another production mutation/preflight run exists after the source migration failure.");
        }
        interveningPreflightProof = verifyAuthorizationOnlyForwardResumePreflightRetry({
          ...evidence,
          historyRun: run,
        });
        verifiedSafeRetryIds.add(idText);
      }
    }
    if (id >= source && id <= current) inventory.push({
      id: idText, workflowPath: pathValue, headSha: String(run?.head_sha ?? ""),
      runAttempt: Number(run?.run_attempt), status: String(run?.status ?? ""), conclusion: run?.conclusion ?? null,
      ...(interveningPreflightProof ? { verifiedReadOnlyProofDigest: canonicalSha256(interveningPreflightProof) } : {}),
    });
  }
  if (verifiedSafeRetryIds.size !== safeRetryById.size) reject("safe preflight evidence does not match the complete production workflow history.");
  if (verifiedDiagnosticIds.size !== diagnosticById.size) reject("diagnostic evidence does not match complete history.");
  if (!hasSource || !hasCurrent) reject("production mutation history is incomplete or omits the source/current preflight run.");
  inventory.sort((a, b) => BigInt(a.id) < BigInt(b.id) ? -1 : BigInt(a.id) > BigInt(b.id) ? 1 : 0);
  return canonicalSha256(inventory);
}

export function createForwardResumeContext({ failureProof, markerObservation, authorizationBundleProof,
  preflightRunId, preflightRunAttempt, targetSha, mutationHistoryDigest, preflightResult, report, restoreResult, backupBytes }) {
  verifyForwardResumeMarkerObservation(markerObservation, failureProof, authorizationBundleProof);
  const armedRetry = failureProof?.purpose === ARMED_RETRY_PURPOSE;
  const expectedSourceRunId = armedRetry ? ARMED_RETRY_FAILED_RUN_ID : FORWARD_RESUME_FAILED_RUN_ID;
  if (!failureProof || failureProof.schemaVersion !== 1
    || ![FORWARD_RESUME_PURPOSE, ARMED_RETRY_PURPOSE].includes(failureProof.purpose)
    || failureProof.noPrismaSpawnVerified !== true || failureProof.sourceRunId !== expectedSourceRunId
    || !authorizationBundleProof || authorizationBundleProof.sourceRunId !== failureProof.sourceRunId
    || authorizationBundleProof.sourceSha !== failureProof.sourceSha
    || !/^[1-9][0-9]*$/.test(String(preflightRunId ?? ""))
    || !Number.isSafeInteger(preflightRunAttempt) || preflightRunAttempt < 1) {
    reject("forward-resume source proof, signed migration provenance, marker observation, or current preflight identity is incomplete.");
  }
  if (!/^[a-f0-9]{40}$/.test(String(targetSha ?? "")) || !/^[a-f0-9]{64}$/.test(String(mutationHistoryDigest ?? ""))) {
    reject("forward-resume target SHA or production mutation history digest is missing.");
  }
  if (preflightResult?.readyForOwnerAuthorization !== true || preflightResult?.manifestId !== "active-energy-unified-v2"
    || !isCanonicalReport(report)
    || !restoreResult || restoreResult.verified !== true || restoreResult.postflightReady !== true
    || !Buffer.isBuffer(backupBytes) || backupBytes.length === 0
    || !DIGEST.test(String(preflightResult.logicalDataFingerprint ?? ""))
    || preflightResult.logicalDataFingerprint !== restoreResult.logicalDataFingerprint) {
    reject("fresh current-database preflight, encrypted backup, or isolated restore/rehearsal evidence is incomplete.");
  }
  const pending = [...preflightResult.pending].sort();
  if (!Array.isArray(preflightResult.pending) || pending.length !== 6
    || canonicalSha256(pending) !== preflightResult.pendingSetDigest
    || canonicalSha256(report.identity) !== canonicalSha256(preflightResult.identity)
    || canonicalSha256(report.migrations) !== canonicalSha256(preflightResult.migrations)
    || schemaInventoryDigest(report.objects) !== schemaInventoryDigest(preflightResult.objects)) {
    reject("fresh live database identity, schema, history, or exact six-migration pending set is inconsistent.");
  }
  const context = {
    schemaVersion: 1,
    purpose: failureProof.purpose,
    mode: "forward-resume",
    sourceRunId: failureProof.sourceRunId,
    sourceRunAttempt: failureProof.sourceRunAttempt,
    sourceSha: failureProof.sourceSha,
    sourcePreflightRunId: authorizationBundleProof.preflightRunId,
    sourcePreflightRunAttempt: authorizationBundleProof.preflightRunAttempt,
    failureProofDigest: canonicalSha256(failureProof),
    failureLogDigest: failureProof.failedStepLogSha256,
    sourceGuardRuntimeDigest: failureProof.guardRuntimeSha256,
    sourceAuthorizationId: authorizationBundleProof.originalAuthorizationId,
    sourcePreflightResultDigest: authorizationBundleProof.preflightResultDigest,
    previousAppProvenanceDigest: canonicalSha256(authorizationBundleProof.previousAppProvenance),
    originalBackupArtifactId: authorizationBundleProof.originalBackupArtifactId,
    originalBackupArtifactDigest: authorizationBundleProof.originalBackupArtifactDigest,
    markerSchemaVersion: markerObservation.markerSchemaVersion,
    markerReleaseSha: markerObservation.releaseSha,
    markerState: markerObservation.state,
    markerDigest: markerObservation.markerDigest,
    ...(armedRetry ? {
      sourceMarkerWorkflowRunId: markerObservation.workflowRunId,
      sourceMarkerWorkflowRunAttempt: markerObservation.workflowRunAttempt,
      sourceMarkerLineageDigest: markerObservation.lineageDigest,
    } : {}),
    currentPreflightRunId: String(preflightRunId),
    currentPreflightRunAttempt: preflightRunAttempt,
    targetSha,
    mutationHistoryDigest,
    noPrismaSpawnVerified: true,
    currentDatabaseIdentityDigest: canonicalSha256(report.identity),
    currentMigrationHistoryDigest: canonicalSha256(report.migrations),
    currentSchemaDigest: schemaInventoryDigest(report.objects),
    currentPendingSetDigest: canonicalSha256(pending),
    currentDataFingerprint: preflightResult.logicalDataFingerprint,
    encryptedBackupDigest: sha256(backupBytes),
    restoredDataFingerprint: restoreResult.logicalDataFingerprint,
    restorePostSchemaDigest: restoreResult.postSchemaDigest,
    restoreResultDigest: canonicalSha256(restoreResult),
  };
  context.proofDigest = canonicalSha256(context);
  return verifyForwardResumeContext(context, { targetSha, preflightRunId, preflightRunAttempt });
}

const FORWARD_RESUME_CONTEXT_FIELDS = Object.freeze([
  "schemaVersion", "purpose", "mode", "sourceRunId", "sourceRunAttempt", "sourceSha", "sourcePreflightRunId",
  "sourcePreflightRunAttempt", "failureProofDigest", "failureLogDigest", "sourceGuardRuntimeDigest",
  "sourceAuthorizationId", "sourcePreflightResultDigest", "previousAppProvenanceDigest", "originalBackupArtifactId",
  "originalBackupArtifactDigest", "markerSchemaVersion", "markerReleaseSha", "markerState", "markerDigest",
  "currentPreflightRunId", "currentPreflightRunAttempt", "targetSha", "mutationHistoryDigest",
  "noPrismaSpawnVerified", "currentDatabaseIdentityDigest", "currentMigrationHistoryDigest", "currentSchemaDigest",
  "currentPendingSetDigest", "currentDataFingerprint", "encryptedBackupDigest", "restoredDataFingerprint",
  "restorePostSchemaDigest", "restoreResultDigest", "proofDigest",
]);
const ARMED_RETRY_CONTEXT_FIELDS = Object.freeze([...FORWARD_RESUME_CONTEXT_FIELDS,
  "sourceMarkerWorkflowRunId", "sourceMarkerWorkflowRunAttempt", "sourceMarkerLineageDigest"]);

function isCanonicalReport(report) {
  return report && typeof report === "object" && !Array.isArray(report)
    && report.identity && Array.isArray(report.migrations) && Array.isArray(report.objects)
    && DIGEST.test(String(report.logicalDataFingerprint ?? ""));
}

export function verifyForwardResumeContext(context, { targetSha, preflightRunId, preflightRunAttempt } = {}) {
  const armedRetry = context?.purpose === ARMED_RETRY_PURPOSE;
  const expectedFields = armedRetry ? ARMED_RETRY_CONTEXT_FIELDS : FORWARD_RESUME_CONTEXT_FIELDS;
  const expectedRunId = armedRetry ? ARMED_RETRY_FAILED_RUN_ID : FORWARD_RESUME_FAILED_RUN_ID;
  const expectedSha = armedRetry ? ARMED_RETRY_FAILED_SHA : FORWARD_RESUME_FAILED_SHA;
  const digestFields = ["failureProofDigest", "failureLogDigest", "sourceGuardRuntimeDigest", "sourcePreflightResultDigest",
    "previousAppProvenanceDigest", "originalBackupArtifactDigest", "markerDigest", "mutationHistoryDigest", "proofDigest"];
  if (!context || typeof context !== "object" || Array.isArray(context)
    || JSON.stringify(Object.keys(context).sort()) !== JSON.stringify([...expectedFields].sort())
    || context.schemaVersion !== 1 || ![FORWARD_RESUME_PURPOSE, ARMED_RETRY_PURPOSE].includes(context.purpose)
    || context.mode !== "forward-resume"
    || context.noPrismaSpawnVerified !== true || context.sourceRunId !== expectedRunId
    || context.sourceRunAttempt !== 1 || context.sourceSha !== expectedSha
    || context.markerSchemaVersion !== (armedRetry ? 2 : 1) || context.markerReleaseSha !== expectedSha
    || context.markerState !== (armedRetry ? "forward-resume-armed" : "ddl-started") || context.targetSha !== targetSha
    || (armedRetry && (context.sourceMarkerWorkflowRunId !== ARMED_RETRY_FAILED_RUN_ID
      || context.sourceMarkerWorkflowRunAttempt !== 1
      || !DIGEST.test(String(context.sourceMarkerLineageDigest ?? ""))))
    || context.currentPreflightRunId !== String(preflightRunId)
    || context.currentPreflightRunAttempt !== Number(preflightRunAttempt)
    || !/^[1-9][0-9]*$/.test(String(context.sourcePreflightRunId ?? ""))
    || !Number.isSafeInteger(context.sourcePreflightRunAttempt) || context.sourcePreflightRunAttempt < 1
    || !/^[1-9][0-9]*$/.test(String(context.currentPreflightRunId ?? ""))
    || !Number.isSafeInteger(context.currentPreflightRunAttempt) || context.currentPreflightRunAttempt < 1
    || !digestFields.every((field) => DIGEST.test(String(context[field] ?? "")))
    || !["currentDatabaseIdentityDigest", "currentMigrationHistoryDigest", "currentSchemaDigest", "currentPendingSetDigest",
      "currentDataFingerprint", "encryptedBackupDigest", "restoredDataFingerprint", "restorePostSchemaDigest", "restoreResultDigest"]
      .every((field) => DIGEST.test(String(context[field] ?? "")))
    || !/^[1-9][0-9]*$/.test(String(context.originalBackupArtifactId ?? ""))
    || !/^[A-Za-z0-9-]{16,80}$/.test(String(context.sourceAuthorizationId ?? ""))) {
    reject("forward-resume context is malformed, stale, or not bound to this exact preflight attempt.");
  }
  const { proofDigest, ...body } = context;
  if (canonicalSha256(body) !== proofDigest) reject("forward-resume context digest does not match its closed-schema fields.");
  return Object.freeze(context);
}

export function assertForwardResumeCurrentSnapshot(context, { preflightResult, liveReport, evidence, restoreResult,
  targetSha, preflightRunId, preflightRunAttempt }) {
  verifyForwardResumeContext(context, { targetSha, preflightRunId, preflightRunAttempt });
  if (!isCanonicalReport(liveReport) || preflightResult?.logicalDataFingerprint !== context.currentDataFingerprint
    || canonicalSha256(liveReport.identity) !== context.currentDatabaseIdentityDigest
    || canonicalSha256(liveReport.migrations) !== context.currentMigrationHistoryDigest
    || schemaInventoryDigest(liveReport.objects) !== context.currentSchemaDigest
    || preflightResult?.pendingSetDigest !== context.currentPendingSetDigest
    || canonicalSha256([...(preflightResult?.pending ?? [])].sort()) !== context.currentPendingSetDigest
    || liveReport.logicalDataFingerprint !== context.currentDataFingerprint
    || evidence?.backupFileDigest !== context.encryptedBackupDigest
    || restoreResult?.logicalDataFingerprint !== context.restoredDataFingerprint
    || restoreResult?.postSchemaDigest !== context.restorePostSchemaDigest
    || canonicalSha256(restoreResult) !== context.restoreResultDigest
    || restoreResult?.verified !== true || restoreResult?.postflightReady !== true) {
    reject("fresh live DB identity, schema, history, pending migrations, encrypted backup, or restore rehearsal changed after forward-resume preflight.");
  }
  return true;
}

export async function inspectForwardResumeMarker({ expectedReleaseSha, sourceRunId = FORWARD_RESUME_FAILED_RUN_ID,
  repositoryPath = process.cwd() }) {
  if (!/^[a-f0-9]{40}$/.test(String(expectedReleaseSha ?? ""))) reject("expected failed release SHA is malformed.");
  const armedRetry = String(sourceRunId) === ARMED_RETRY_FAILED_RUN_ID;
  if (String(sourceRunId) !== (armedRetry ? ARMED_RETRY_FAILED_RUN_ID : FORWARD_RESUME_FAILED_RUN_ID)
    || expectedReleaseSha !== (armedRetry ? ARMED_RETRY_FAILED_SHA : FORWARD_RESUME_FAILED_SHA)) {
    reject("the marker source run and SHA are not an admitted pair.");
  }
  const gitDir = execFileSync("git", ["rev-parse", "--absolute-git-dir"], { cwd: repositoryPath, encoding: "utf8" }).trim();
  const currentPath = path.join(gitDir, "bodycast-production-release-marker", "marker");
  const legacyPath = path.join(gitDir, "bodycast-production-schema-cutover");
  const recoveryMarker = "/var/lib/bodycast/recovery/marker-v2.json";
  if (await readFile(recoveryMarker).then(() => true, (error) => error?.code === "ENOENT" ? false : Promise.reject(error))) {
    reject("a separate production recovery marker exists; forward resume is not applicable.");
  }
  const [current, legacy] = await Promise.all([
    readProductionReleaseMarker(currentPath).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error)),
    readProductionReleaseMarker(legacyPath).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error)),
  ]);
  if (current && legacy) reject("both current and legacy release markers exist; marker state is ambiguous.");
  const observed = current ?? legacy;
  if (!observed || observed.marker.schemaVersion !== (armedRetry ? 2 : 1)
    || observed.marker.state !== (armedRetry ? "forward-resume-armed" : "ddl-started")
    || observed.marker.releaseSha !== expectedReleaseSha) {
    reject("the expected pre-spawn failure marker is missing or changed.");
  }
  return verifyForwardResumeMarkerObservation({
    schemaVersion: 1,
    markerSchemaVersion: observed.marker.schemaVersion,
    releaseSha: observed.marker.releaseSha,
    state: observed.marker.state,
    markerDigest: observed.digest,
    ...(armedRetry ? {
      workflowRunId: observed.marker.workflowRunId,
      workflowRunAttempt: observed.marker.workflowRunAttempt,
      authorizationId: observed.marker.authorizationId,
      lineageDigest: observed.marker.lineageDigest,
      spawnState: observed.marker.spawnState,
    } : {}),
  }, { sourceSha: expectedReleaseSha, sourceRunId, sourceRunAttempt: 1,
    purpose: armedRetry ? ARMED_RETRY_PURPOSE : FORWARD_RESUME_PURPOSE },
  armedRetry ? { originalAuthorizationId: observed.marker.authorizationId,
    sourceMarkerLineageDigest: observed.marker.lineageDigest } : undefined);
}

async function main() {
  const [mode, ...args] = process.argv.slice(2);
  if (mode === "--inspect-marker") {
    if (args.length < 1 || args.length > 2) throw new Error("Usage: production-forward-resume.mjs --inspect-marker <failed-release-sha> [source-run-id]");
    process.stdout.write(`${JSON.stringify(await inspectForwardResumeMarker({ expectedReleaseSha: args[0],
      sourceRunId: args[1] ?? FORWARD_RESUME_FAILED_RUN_ID }))}\n`);
    return;
  }
  throw new Error("Usage: production-forward-resume.mjs --inspect-marker <failed-release-sha>");
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
