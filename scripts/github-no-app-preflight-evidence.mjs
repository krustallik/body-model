import { execFileSync } from "node:child_process";
import { chmod, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { preflightCaptureResumeControlsMatch, verifyResumablePreflightAttempt } from "./production-preflight-resume.mjs";
import { assertTrustedOwnerWorkflowRun, BODYCAST_OWNER_ID } from "./github-owner-identity.mjs";
import { validateCaptureResumeReceipt } from "./production-capture-resume-receipt.mjs";
import { assertNoCompetingProductionRuns, NO_APP_CAPTURE_LINEAGE } from "./production-no-app-preflight.mjs";
import { V4_REPUBLICATION_MANIFEST } from "./production-migration-manifests.mjs";

const REPOSITORY = "krustallik/body-model";
const PREFLIGHT_PATH = ".github/workflows/production-migration-preflight.yml";
const DEPLOY_PATH = ".github/workflows/deploy-production.yml";
const V2_PREFLIGHT_RUN_ID = "38068531599";
const V2_MIGRATION_RUN_ID = "38069108209";
const MUTATION_WORKFLOWS = [
  "production-migration-preflight.yml",
  "production-migrate.yml",
  "production-database-cutback.yml",
  "activate-unified-v4-production.yml",
  "production-full-history-recalculate.yml",
  "deploy-production.yml",
  "production-no-app-preflight.yml",
];
const RESUME_RECEIPT_JOB = "Inspect, back up, restore, and rehearse on disposable PostgreSQL";
const RESUME_RECEIPT_STEP = "Enter maintenance and drain the old app before backup";
const RESUME_RECEIPT_MARKER = "BODYCAST_PRE_DDL_RESUME_RECEIPT=";
const RESUME_RECEIPT_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z > $/;

function gh(args, { maxBuffer = 4 * 1024 * 1024 } = {}) {
  return execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer, timeout: 60_000 });
}

function api(route) {
  return JSON.parse(gh(["api", route]));
}

function workflowPathOf(run) { return typeof run?.path === "string" ? run.path.split("@")[0] : ""; }

export function activeProductionMutationRunInventory(runs, currentRunId) {
  if (!Array.isArray(runs) || !/^[1-9][0-9]*$/.test(String(currentRunId ?? ""))) {
    throw new Error("Complete production run history or current run identity is missing.");
  }
  const activeStatuses = new Set(["queued", "in_progress", "requested", "waiting", "pending"]);
  const knownStatuses = new Set([...activeStatuses, "completed"]);
  const seen = new Set();
  return runs.filter((run) => {
    const id = String(run?.id ?? "");
    if (!/^[1-9][0-9]*$/.test(id) || seen.has(id)) throw new Error("Production run history contains an invalid or duplicate run id.");
    seen.add(id);
    const isMutationWorkflow = MUTATION_WORKFLOWS.some((file) => workflowPathOf(run) === `.github/workflows/${file}`);
    if (run?.expectedWorkflowPath && workflowPathOf(run) !== run.expectedWorkflowPath) {
      throw new Error("Production run history workflow path differs from its queried workflow identity.");
    }
    if (isMutationWorkflow && !knownStatuses.has(run.status)) throw new Error("Production run history contains an unknown mutation-workflow status.");
    return id !== String(currentRunId) && activeStatuses.has(run.status) && isMutationWorkflow;
  }).map((run) => ({
    id: String(run.id), status: run.status, conclusion: run.conclusion,
    runAttempt: run.run_attempt, workflowPath: workflowPathOf(run),
  }));
}

function workflowId(file) {
  const value = api(`repos/${REPOSITORY}/actions/workflows/${file}`);
  if (!Number.isSafeInteger(value.id) || value.state !== "active") throw new Error(`Production workflow identity is unavailable: ${file}`);
  return String(value.id);
}

function allRuns(id) {
  const result = [];
  for (let page = 1; page <= 100; page += 1) {
    const payload = api(`repos/${REPOSITORY}/actions/workflows/${id}/runs?per_page=100&page=${page}`);
    if (!Array.isArray(payload.workflow_runs)) throw new Error("GitHub returned an incomplete production workflow inventory.");
    result.push(...payload.workflow_runs);
    if (payload.workflow_runs.length < 100) return result;
  }
  throw new Error("Production workflow inventory exceeded its bounded pagination limit.");
}

function runLogs(runId, jobId, failedOnly = false) {
  const args = ["run", "view", String(runId), "--repo", REPOSITORY, "--job", String(jobId), failedOnly ? "--log-failed" : "--log"];
  const output = gh(args, { maxBuffer: 2 * 1024 * 1024 });
  if (Buffer.byteLength(output, "utf8") > 1_000_000) throw new Error("Production workflow log exceeds the bounded evidence size.");
  return output;
}

function exactJob(jobs, name) {
  const matches = (jobs?.jobs ?? []).filter((job) => job.name === name);
  if (matches.length !== 1 || !Number.isSafeInteger(matches[0].id)) throw new Error(`Expected exactly one GitHub job: ${name}`);
  return matches[0];
}

function validateGitHubResumeReceipt(receipt, sourceRun) {
  if (String(sourceRun?.id) !== NO_APP_CAPTURE_LINEAGE.resumeRunId
    || sourceRun?.head_sha !== NO_APP_CAPTURE_LINEAGE.resumeSha
    || sourceRun?.run_attempt !== NO_APP_CAPTURE_LINEAGE.resumeRunAttempt) {
    throw new Error("Resume receipt source is not the exact reviewed GitHub run attempt.");
  }
  return validateCaptureResumeReceipt(receipt, {
    mode: "ordinary",
    sourceRunId: NO_APP_CAPTURE_LINEAGE.sourceRunId,
    sourceRunAttempt: NO_APP_CAPTURE_LINEAGE.sourceRunAttempt,
    sourceSha: NO_APP_CAPTURE_LINEAGE.sourceSha,
    targetSha: NO_APP_CAPTURE_LINEAGE.resumeSha,
    captureRunId: String(sourceRun.id),
    captureRunAttempt: sourceRun.run_attempt,
    // These GitHub values remain claims until host reconciliation binds them
    // to the exact source/current files and live database compatibility.
    sourceRecordDigest: receipt?.sourceRecordDigest,
    currentRecordDigest: receipt?.currentRecordDigest,
    compatibilityDigest: receipt?.compatibilityDigest,
  });
}

export function extractGitHubResumeReceipt(logText, sourceRun) {
  if (typeof logText !== "string" || String(sourceRun?.id) !== NO_APP_CAPTURE_LINEAGE.resumeRunId
    || sourceRun?.head_sha !== NO_APP_CAPTURE_LINEAGE.resumeSha
    || sourceRun?.run_attempt !== NO_APP_CAPTURE_LINEAGE.resumeRunAttempt) {
    throw new Error("Resume receipt source is not the exact reviewed GitHub run attempt.");
  }
  const expectedPrefix = `${RESUME_RECEIPT_JOB}\t${RESUME_RECEIPT_STEP}\t`;
  const payloads = [];
  for (const line of logText.split(/\r?\n/)) {
    const markerIndex = line.indexOf(RESUME_RECEIPT_MARKER);
    if (markerIndex < 0) continue;
    const prefix = line.slice(0, markerIndex);
    if (!prefix.startsWith(expectedPrefix) || !RESUME_RECEIPT_TIMESTAMP.test(prefix.slice(expectedPrefix.length))) continue;
    payloads.push(line.slice(markerIndex + RESUME_RECEIPT_MARKER.length));
  }
  if (payloads.length !== 1) {
    throw new Error("Exact source workflow log does not contain one unambiguous resume receipt.");
  }
  try {
    const encoded = payloads[0];
    if (!encoded || encoded.length > 11_000
      || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
      throw new Error("invalid base64");
    }
    const bytes = Buffer.from(encoded, "base64");
    if (!bytes.length || bytes.length > 8_192 || bytes.toString("base64") !== encoded) throw new Error("invalid base64");
    const jsonText = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const receipt = JSON.parse(jsonText);
    if (JSON.stringify(receipt) !== jsonText) throw new Error("noncanonical JSON");
    return validateGitHubResumeReceipt(receipt, sourceRun);
  } catch {
    throw new Error("Source workflow log contains a malformed or incorrectly bound resume receipt.");
  }
}

function currentMainAncestor(sha, mainSha) {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", sha, mainSha], { stdio: "ignore" });
    return true;
  } catch { return false; }
}

function assertOwnerMainRun(run, { id, sha, workflowId: expectedWorkflowId, workflowPath: expectedPath, title, conclusion }) {
  if (String(run?.id) !== String(id) || String(run.workflow_id) !== String(expectedWorkflowId)
    || workflowPathOf(run) !== expectedPath || run.status !== "completed" || run.conclusion !== conclusion
    || run.run_attempt !== 1 || run.head_branch !== "main" || run.event !== "workflow_dispatch"
    || run.head_sha !== sha || run.display_title !== title
    || String(run.actor?.id) !== BODYCAST_OWNER_ID || String(run.triggering_actor?.id) !== BODYCAST_OWNER_ID) {
    throw new Error("Historical production run identity or result differs from the reviewed provenance.");
  }
  assertTrustedOwnerWorkflowRun(run, {
    actorId: BODYCAST_OWNER_ID, workflowPath: expectedPath, workflowRunId: String(id),
    workflowRunAttempt: 1, ref: "refs/heads/main", sha,
  });
}

function verifyHistoricalV2Provenance({ preflightRun, preflightArtifacts, migrationRun, migrationJobs,
  preflightWorkflowId, migrationWorkflowId, currentMainSha }) {
  const v2Sha = "62b6961dde7036100c8af7281e7bfab75bb662db";
  assertOwnerMainRun(preflightRun, {
    id: V2_PREFLIGHT_RUN_ID, sha: v2Sha, workflowId: preflightWorkflowId,
    workflowPath: PREFLIGHT_PATH, title: `Preflight ${v2Sha} active-energy-unified-v2`, conclusion: "success",
  });
  if (!currentMainAncestor(v2Sha, currentMainSha)) throw new Error("Historical V2 preflight is not in current-main ancestry.");
  const artifacts = preflightArtifacts?.artifacts ?? [];
  const byName = new Map(artifacts.map((artifact) => [artifact.name, artifact]));
  const backupName = `bodycast-backup-${v2Sha}-active-energy-unified-v2-${V2_PREFLIGHT_RUN_ID}-1`;
  const evidenceName = `bodycast-preflight-evidence-${v2Sha}-active-energy-unified-v2-${V2_PREFLIGHT_RUN_ID}-1`;
  const backup = byName.get(backupName);
  const evidence = byName.get(evidenceName);
  if (preflightArtifacts?.total_count !== 2 || artifacts.length !== 2 || byName.size !== 2
    || !backup || !evidence
    || !Number.isSafeInteger(backup.id) || !Number.isSafeInteger(evidence.id)
    || !/^sha256:[a-f0-9]{64}$/.test(String(backup.digest ?? ""))
    || !/^sha256:[a-f0-9]{64}$/.test(String(evidence.digest ?? ""))
    || String(backup.workflow_run?.id) !== V2_PREFLIGHT_RUN_ID || backup.workflow_run?.head_sha !== v2Sha
    || String(evidence.workflow_run?.id) !== V2_PREFLIGHT_RUN_ID || evidence.workflow_run?.head_sha !== v2Sha) {
    throw new Error("Historic V2 backup/evidence metadata is incomplete; no old artifact can be reused.");
  }
  assertOwnerMainRun(migrationRun, {
    id: V2_MIGRATION_RUN_ID, sha: v2Sha, workflowId: migrationWorkflowId,
    workflowPath: ".github/workflows/production-migrate.yml", title: "Manual production migration", conclusion: "success",
  });
  const jobs = migrationJobs?.jobs ?? [];
  const execution = jobs.filter((job) => job.name === "Final live guard and authorized migration");
  if (migrationJobs?.total_count !== 3 || jobs.length !== 3 || execution.length !== 1
    || execution[0].conclusion !== "success" || execution[0].head_sha !== v2Sha || execution[0].run_attempt !== 1) {
    throw new Error("Historic V2 production migration completion is not independently attributable.");
  }
  return Object.freeze({
    preflightRunId: V2_PREFLIGHT_RUN_ID, preflightSha: v2Sha,
    manifestId: "active-energy-unified-v2", preflightConclusion: "success",
    backupArtifactId: String(backup.id), backupArtifactDigest: backup.digest,
    evidenceArtifactId: String(evidence.id), evidenceArtifactDigest: evidence.digest,
    migrationRunId: V2_MIGRATION_RUN_ID, migrationSha: v2Sha, migrationConclusion: "success",
    noV2ArtifactReuseForV4: true,
  });
}

function verifyV4CaptureRefreshProvenance({ run, jobsPayload, artifacts, failureLogText, preflightWorkflowId, currentMainSha }) {
  const refreshRunId = NO_APP_CAPTURE_LINEAGE.sourceRunId;
  assertOwnerMainRun(run, {
    id: refreshRunId, sha: NO_APP_CAPTURE_LINEAGE.sourceSha, workflowId: preflightWorkflowId,
    workflowPath: PREFLIGHT_PATH,
    title: `Preflight ${NO_APP_CAPTURE_LINEAGE.sourceSha} unified-v4-republication-v1`, conclusion: "failure",
  });
  if (!currentMainAncestor(run.head_sha, currentMainSha)) throw new Error("V4 refresh run is not in current-main ancestry.");
  const jobs = jobsPayload?.jobs ?? [];
  const authorize = jobs.filter((job) => job.name === "Authorize read-only preflight");
  const inspect = jobs.filter((job) => job.name === "Inspect, back up, restore, and rehearse on disposable PostgreSQL");
  const steps = new Map((inspect[0]?.steps ?? []).map((step) => [step.name, step.conclusion]));
  const failed = (inspect[0]?.steps ?? []).filter((step) => step.conclusion === "failure").map((step) => step.name);
  const normalizedLog = String(failureLogText).replace(/\r\n/g, "\n");
  if (jobsPayload?.total_count !== 2 || jobs.length !== 2 || authorize.length !== 1
    || authorize[0].conclusion !== "success" || authorize[0].head_sha !== run.head_sha || authorize[0].run_attempt !== 1
    || inspect.length !== 1 || inspect[0].conclusion !== "failure" || inspect[0].head_sha !== run.head_sha || inspect[0].run_attempt !== 1
    || steps.get("Enter maintenance and drain the old app before backup") !== "success"
    || steps.get("Verify production container and PostgreSQL client versions") !== "success"
    || steps.get("Read-only production identity, full migration set, schema signatures, and locks") !== "success"
    || steps.get("Capture pg_dump start on production host and create encrypted backup") !== "success"
    || steps.get("Restore snapshot, compare source state, and rehearse exact migrations") !== "failure"
    || steps.get("Create preflight evidence bundle") !== "skipped"
    || steps.get("Upload encrypted production backup artifact") !== "skipped"
    || steps.get("Upload immutable preflight and restore evidence artifact") !== "skipped"
    || failed.length !== 1 || failed[0] !== "Restore snapshot, compare source state, and rehearse exact migrations"
    || artifacts?.total_count !== 0 || (artifacts?.artifacts ?? []).length !== 0
    || (normalizedLog.match(/REFRESH_CAPTURE: 1/g) ?? []).length !== 1) {
    throw new Error("V4 capture-refresh provenance does not prove one owner refresh followed only by isolated restore failure.");
  }
  return Object.freeze({
    runId: refreshRunId, runAttempt: 1, releaseSha: NO_APP_CAPTURE_LINEAGE.sourceSha,
    conclusion: "failure", refreshCapture: true, failureBoundary: "isolated-restore-before-artifact-upload",
    artifactsPublished: false,
  });
}

export function buildCaptureHistoryEvidence({ currentRunId, currentMainSha, sourceRun, sourceJobs, sourceArtifacts,
  laterRuns, allProductionRuns, failedDeploys, failedPreflights, preflightWorkflowId, deployWorkflowId, githubReceipt,
  historicalV2, captureRefresh }) {
  if (!/^[1-9][0-9]*$/.test(String(currentRunId)) || !/^[a-f0-9]{40}$/.test(String(currentMainSha))) {
    throw new Error("Current no-app workflow identity or exact main SHA is malformed.");
  }
  const sourceRecord = sourceRun;
  const sourceId = NO_APP_CAPTURE_LINEAGE.resumeRunId;
  const sourceAttempt = NO_APP_CAPTURE_LINEAGE.resumeRunAttempt;
  if (String(sourceRecord?.id) !== sourceId || sourceRecord.run_attempt !== sourceAttempt
    || sourceRecord.head_sha !== NO_APP_CAPTURE_LINEAGE.resumeSha) {
    throw new Error("Capture source is not the exact owner-run V4 resume attempt.");
  }
  const productionRuns = laterRuns.filter((run) => MUTATION_WORKFLOWS.some((file) => workflowPathOf(run) === `.github/workflows/${file}`));
  const resumeProof = verifyResumablePreflightAttempt({
    sourceRun: sourceRecord,
    sourceJobs,
    sourceArtifacts,
    laterRuns: productionRuns,
    sourceRunId: sourceId,
    currentRunId: String(currentRunId),
    currentMainSha,
    workflowId: preflightWorkflowId,
    deployWorkflowId,
    manifestId: V4_REPUBLICATION_MANIFEST.id,
    sourceIsAncestor: currentMainAncestor(sourceRecord.head_sha, currentMainSha),
    safeFailedDeployRuns: failedDeploys.map((evidence) => ({
      ...evidence,
      shaIsAncestorOfCurrentMain: currentMainAncestor(evidence?.run?.head_sha, currentMainSha),
    })),
    safeFailedPreflightRetries: failedPreflights.map((evidence) => ({
      ...evidence,
      shaIsAncestorOfCurrentMain: currentMainAncestor(evidence?.run?.head_sha, currentMainSha),
      sourceShaIsAncestor: currentMainAncestor(sourceRecord.head_sha, evidence?.run?.head_sha),
      captureControlsMatch: preflightCaptureResumeControlsMatch(evidence?.run?.head_sha, currentMainSha),
    })),
  });
  const proof = Object.freeze({ ...resumeProof, historicalV2, captureRefresh });
  if (proof.targetSha !== currentMainSha) throw new Error("Capture history proof is not bound to current main.");
  const validatedReceipt = validateGitHubResumeReceipt(githubReceipt, sourceRecord);
  const productionInventory = activeProductionMutationRunInventory(allProductionRuns, currentRunId);
  assertNoCompetingProductionRuns(productionInventory, { currentRunId: String(currentRunId) });
  return Object.freeze({
    proof,
    githubReceipt: validatedReceipt,
    productionRuns: productionInventory,
  });
}

export async function collectCaptureHistoryEvidence({ currentRunId, currentMainSha }) {
  const preflightWorkflowId = workflowId("production-migration-preflight.yml");
  const deployWorkflowId = workflowId("deploy-production.yml");
  const migrationWorkflowId = workflowId("production-migrate.yml");
  const sourceRun = api(`repos/${REPOSITORY}/actions/runs/${NO_APP_CAPTURE_LINEAGE.resumeRunId}`);
  const sourceJobs = api(`repos/${REPOSITORY}/actions/runs/${NO_APP_CAPTURE_LINEAGE.resumeRunId}/jobs?per_page=100`);
  const sourceArtifacts = api(`repos/${REPOSITORY}/actions/runs/${NO_APP_CAPTURE_LINEAGE.resumeRunId}/artifacts?per_page=100`);
  const sourceInspect = exactJob(sourceJobs, RESUME_RECEIPT_JOB);
  const sourceLog = runLogs(sourceRun.id, sourceInspect.id);
  const githubReceipt = extractGitHubResumeReceipt(sourceLog, sourceRun);

  const v2Run = api(`repos/${REPOSITORY}/actions/runs/${V2_PREFLIGHT_RUN_ID}`);
  const v2Artifacts = api(`repos/${REPOSITORY}/actions/runs/${V2_PREFLIGHT_RUN_ID}/artifacts?per_page=100`);
  const v2MigrationRun = api(`repos/${REPOSITORY}/actions/runs/${V2_MIGRATION_RUN_ID}`);
  const v2MigrationJobs = api(`repos/${REPOSITORY}/actions/runs/${V2_MIGRATION_RUN_ID}/jobs?per_page=100`);
  const historicalV2 = verifyHistoricalV2Provenance({ preflightRun: v2Run, preflightArtifacts: v2Artifacts,
    migrationRun: v2MigrationRun, migrationJobs: v2MigrationJobs, preflightWorkflowId, migrationWorkflowId, currentMainSha });

  const refreshRun = api(`repos/${REPOSITORY}/actions/runs/${NO_APP_CAPTURE_LINEAGE.sourceRunId}`);
  const refreshJobs = api(`repos/${REPOSITORY}/actions/runs/${NO_APP_CAPTURE_LINEAGE.sourceRunId}/jobs?per_page=100`);
  const refreshArtifacts = api(`repos/${REPOSITORY}/actions/runs/${NO_APP_CAPTURE_LINEAGE.sourceRunId}/artifacts?per_page=100`);
  const refreshInspect = exactJob(refreshJobs, "Inspect, back up, restore, and rehearse on disposable PostgreSQL");
  const refreshFailureLog = runLogs(refreshRun.id, refreshInspect.id);
  const captureRefresh = verifyV4CaptureRefreshProvenance({ run: refreshRun, jobsPayload: refreshJobs,
    artifacts: refreshArtifacts, failureLogText: refreshFailureLog, preflightWorkflowId, currentMainSha });

  const inventoryByPath = new Map();
  for (const file of MUTATION_WORKFLOWS) inventoryByPath.set(file, allRuns(workflowId(file)));
  const allProductionRuns = [...inventoryByPath.entries()].flatMap(([file, runs]) => runs.map((run) => ({
    ...run, expectedWorkflowPath: `.github/workflows/${file}`,
  })));
  const laterRuns = allProductionRuns.filter((run) => BigInt(String(run.id)) > BigInt(NO_APP_CAPTURE_LINEAGE.resumeRunId));
  const failedDeploys = [];
  for (const run of laterRuns.filter((item) => workflowPathOf(item) === DEPLOY_PATH)) {
    const jobs = api(`repos/${REPOSITORY}/actions/runs/${run.id}/jobs?per_page=100`);
    const deployJob = exactJob(jobs, "Deploy exact current-main SHA");
    const failureLogText = run.status === "completed" && run.conclusion === "failure"
      ? runLogs(run.id, deployJob.id, true) : "";
    const ciRuns = allRuns(workflowId("ci.yml")).filter((ci) => ci.head_sha === run.head_sha);
    failedDeploys.push({ run, jobs, deployLogText: failureLogText, ciRuns });
  }
  const failedPreflights = [];
  for (const run of laterRuns.filter((item) => workflowPathOf(item) === PREFLIGHT_PATH
    && item.status === "completed" && item.conclusion === "failure")) {
    const jobs = api(`repos/${REPOSITORY}/actions/runs/${run.id}/jobs?per_page=100`);
    const artifacts = api(`repos/${REPOSITORY}/actions/runs/${run.id}/artifacts?per_page=100`);
    const inspect = exactJob(jobs, "Inspect, back up, restore, and rehearse on disposable PostgreSQL");
    const failureLogText = inspect.conclusion === "failure" ? runLogs(run.id, inspect.id, true) : "";
    failedPreflights.push({ run, jobs, artifacts, failureLogText });
  }
  return buildCaptureHistoryEvidence({ currentRunId, currentMainSha, sourceRun, sourceJobs, sourceArtifacts,
    laterRuns, allProductionRuns, failedDeploys, failedPreflights, preflightWorkflowId, deployWorkflowId, githubReceipt,
    historicalV2, captureRefresh });
}

async function main() {
  const [mode, currentRunId, currentMainSha, outputPath] = process.argv.slice(2);
  if (mode !== "--collect" || !currentRunId || !currentMainSha || !outputPath) {
    throw new Error("Usage: github-no-app-preflight-evidence.mjs --collect <current-run-id> <current-main-sha> <output.json>");
  }
  const evidence = await collectCaptureHistoryEvidence({ currentRunId, currentMainSha });
  const target = path.resolve(outputPath);
  await writeFile(target, `${JSON.stringify(evidence)}\n`, { flag: "wx", mode: 0o600 });
  await chmod(target, 0o600);
  process.stdout.write(JSON.stringify({
    sourceRunId: NO_APP_CAPTURE_LINEAGE.resumeRunId,
    captureGuardEffects: evidence.proof.captureGuardPreflightEffects,
    safeDeployRuns: evidence.proof.safePreMaintenanceDeployRunIds,
    activeProductionRuns: evidence.productionRuns,
  }) + "\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
