import { execFileSync } from "node:child_process";
import { chmod, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { assertTrustedOwnerWorkflowRun, BODYCAST_OWNER_ID } from "./github-owner-identity.mjs";
import { NO_APP_CAPTURE_LINEAGE, assertNoCompetingProductionRuns } from "./production-no-app-preflight.mjs";
import { V4_REPUBLICATION_MANIFEST } from "./production-migration-manifests.mjs";

const REPOSITORY = "krustallik/body-model";
const PREFLIGHT_PATH = ".github/workflows/production-migration-preflight.yml";
const MUTATION_WORKFLOWS = [
  "production-migration-preflight.yml",
  "production-migrate.yml",
  "production-database-cutback.yml",
  "activate-unified-v4-production.yml",
  "production-full-history-recalculate.yml",
  "deploy-production.yml",
  "production-no-app-preflight.yml",
];

function gh(args, { maxBuffer = 4 * 1024 * 1024 } = {}) {
  return execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer, timeout: 60_000 });
}

function api(route) {
  return JSON.parse(gh(["api", route]));
}

function workflowPathOf(run) { return typeof run?.path === "string" ? run.path.split("@")[0] : ""; }

export function activeProductionMutationRunInventory(runs, currentRunId) {
  if (!Array.isArray(runs) || !/^[1-9][0-9]*$/.test(String(currentRunId ?? ""))) {
    throw new Error("Production workflow inventory or current run identity is missing.");
  }
  const activeStatuses = new Set(["queued", "in_progress", "requested", "waiting", "pending"]);
  const knownStatuses = new Set([...activeStatuses, "completed"]);
  const seen = new Set();
  return runs.filter((run) => {
    const id = String(run?.id ?? "");
    if (!/^[1-9][0-9]*$/.test(id) || seen.has(id)) throw new Error("Production workflow inventory contains an invalid or duplicate run id.");
    seen.add(id);
    const isMutationWorkflow = MUTATION_WORKFLOWS.some((file) => workflowPathOf(run) === `.github/workflows/${file}`);
    if (run?.expectedWorkflowPath && workflowPathOf(run) !== run.expectedWorkflowPath) {
      throw new Error("Production workflow identity differs from its queried workflow.");
    }
    if (isMutationWorkflow && !knownStatuses.has(run.status)) throw new Error("Production workflow inventory contains an unknown status.");
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

function allRuns() {
  const result = [];
  for (let page = 1; page <= 100; page += 1) {
    const payload = api(`repos/${REPOSITORY}/actions/runs?per_page=100&page=${page}`);
    if (!Array.isArray(payload.workflow_runs)) throw new Error("GitHub returned an incomplete production workflow inventory.");
    result.push(...payload.workflow_runs);
    if (payload.workflow_runs.length < 100) return result;
  }
  throw new Error("Production workflow inventory exceeded its bounded pagination limit.");
}

function currentMainAncestor(sha, mainSha) {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", sha, mainSha], { stdio: "ignore" });
    return true;
  } catch { return false; }
}

function assertResumeSourceIdentity(sourceRun, { preflightWorkflowId, currentMainSha }) {
  if (String(sourceRun?.id) !== NO_APP_CAPTURE_LINEAGE.resumeRunId
    || String(sourceRun?.workflow_id) !== String(preflightWorkflowId)
    || workflowPathOf(sourceRun) !== PREFLIGHT_PATH
    || sourceRun.status !== "completed" || sourceRun.conclusion !== "failure"
    || sourceRun.run_attempt !== NO_APP_CAPTURE_LINEAGE.resumeRunAttempt
    || sourceRun.head_branch !== "main" || sourceRun.event !== "workflow_dispatch"
    || sourceRun.head_sha !== NO_APP_CAPTURE_LINEAGE.resumeSha
    || sourceRun.display_title !== `Preflight ${NO_APP_CAPTURE_LINEAGE.resumeSha} ${V4_REPUBLICATION_MANIFEST.id}`
    || !currentMainAncestor(sourceRun.head_sha, currentMainSha)) {
    throw new Error("Capture source is not the exact original V4 resume run on current-main ancestry.");
  }
  assertTrustedOwnerWorkflowRun(sourceRun, {
    actorId: BODYCAST_OWNER_ID,
    workflowPath: PREFLIGHT_PATH,
    workflowRunId: NO_APP_CAPTURE_LINEAGE.resumeRunId,
    workflowRunAttempt: NO_APP_CAPTURE_LINEAGE.resumeRunAttempt,
    ref: "refs/heads/main",
    sha: NO_APP_CAPTURE_LINEAGE.resumeSha,
  });
}

export function buildCaptureHistoryEvidence({ currentRunId, currentMainSha, sourceRun, preflightWorkflowId, allProductionRuns }) {
  if (!/^[1-9][0-9]*$/.test(String(currentRunId)) || !/^[a-f0-9]{40}$/.test(String(currentMainSha ?? ""))) {
    throw new Error("Current no-app workflow identity or exact main SHA is malformed.");
  }
  assertResumeSourceIdentity(sourceRun, { preflightWorkflowId, currentMainSha });
  const productionRuns = activeProductionMutationRunInventory(allProductionRuns, currentRunId);
  assertNoCompetingProductionRuns(productionRuns, { currentRunId: String(currentRunId) });
  const proof = Object.freeze({
    schemaVersion: 3,
    sourceRunId: NO_APP_CAPTURE_LINEAGE.sourceRunId,
    sourceRunAttempt: NO_APP_CAPTURE_LINEAGE.sourceRunAttempt,
    sourceSha: NO_APP_CAPTURE_LINEAGE.sourceSha,
    resumeRunId: NO_APP_CAPTURE_LINEAGE.resumeRunId,
    resumeRunAttempt: NO_APP_CAPTURE_LINEAGE.resumeRunAttempt,
    resumeSha: NO_APP_CAPTURE_LINEAGE.resumeSha,
    targetSha: currentMainSha,
    historyProvenance: Object.freeze({
      receiptJobLog: "UNVERIFIED",
      priorV2ArtifactLineage: "UNVERIFIED",
      interveningWorkflowEffects: "UNVERIFIED",
    }),
  });
  return Object.freeze({ proof, productionRuns });
}

export async function collectCaptureHistoryEvidence({ currentRunId, currentMainSha }) {
  const preflightWorkflowId = workflowId("production-migration-preflight.yml");
  const sourceRun = api(`repos/${REPOSITORY}/actions/runs/${NO_APP_CAPTURE_LINEAGE.resumeRunId}`);
  assertResumeSourceIdentity(sourceRun, { preflightWorkflowId, currentMainSha });

  const mutationPaths = new Set(MUTATION_WORKFLOWS.map((file) => `.github/workflows/${file}`));
  const allProductionRuns = allRuns().filter((run) => mutationPaths.has(workflowPathOf(run)));
  return buildCaptureHistoryEvidence({ currentRunId, currentMainSha, sourceRun, preflightWorkflowId, allProductionRuns });
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
    historyProvenance: evidence.proof.historyProvenance,
    activeProductionRuns: evidence.productionRuns,
  }) + "\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
