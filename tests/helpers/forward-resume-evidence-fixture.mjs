import { createHash } from "node:crypto";
import { FORWARD_RESUME_FAILED_RUN_ID, FORWARD_RESUME_FAILED_SHA, MIGRATION_FAILURE_JOB, MIGRATION_FAILURE_STEP, MIGRATION_GUARD_FAILURE } from "../../scripts/production-forward-resume.mjs";
export const FORWARD_RESUME_SAFE_PREFLIGHT_RETRY_RUN_ID = "38045689913";
export const FORWARD_RESUME_SAFE_PREFLIGHT_RETRY_SHA = "981e3370ec981838ab2c1e5037a74e3fd5b8ce49";
export const digest = (text) => createHash("sha256").update(text).digest("hex");
export const sourceBytes = Buffer.from(`
assertPrismaTargetMatchesSignedIdentity(finalGuard.receipt, actualIdentity, now());
if (writerDrain.activeClientBackends.length > 0) throw new Error("final Prisma writer-drain observation is missing, stale, or has active/unknown client backends.");
return spawn("npx", ["prisma", "migrate", "deploy"]);
`);
export const steps = [
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
].map(([name, conclusion]) => ({
  name,
  conclusion, status: "completed",
  ...(name === MIGRATION_FAILURE_STEP ? {
    started_at: "2026-10-09T12:00:00Z",
    completed_at: "2026-10-09T12:00:01Z",
  } : {}),
  ...(name === "Remove temporary runner credentials" ? {
    started_at: "2026-10-09T12:00:01Z",
    completed_at: "2026-10-09T12:00:02Z",
  } : {}),
}));

export function sourceRun(overrides = {}) {
  return {
    id: Number(FORWARD_RESUME_FAILED_RUN_ID),
    workflow_id: 77,
    path: ".github/workflows/production-migrate.yml@refs/heads/main",
    event: "workflow_dispatch",
    head_branch: "main",
    head_sha: FORWARD_RESUME_FAILED_SHA,
    run_attempt: 1,
    status: "completed",
    conclusion: "failure",
    repository: { full_name: "krustallik/body-model", owner: { id: 126446430, login: "krustallik" } },
    actor: { id: 126446430 },
    triggering_actor: { id: 126446430 },
    ...overrides,
  };
}

export function jobsPayload(overrides = {}) {
  return {
    total_count: 3,
    jobs: [
      { id: 1, run_id: Number(FORWARD_RESUME_FAILED_RUN_ID), status: "completed", name: "Select latest exact preflight evidence", conclusion: "success", head_sha: FORWARD_RESUME_FAILED_SHA, run_attempt: 1 },
      { id: 2, run_id: Number(FORWARD_RESUME_FAILED_RUN_ID), status: "completed", name: "Sign migration authorization envelope", conclusion: "success", head_sha: FORWARD_RESUME_FAILED_SHA, run_attempt: 1 },
      { id: 3, run_id: Number(FORWARD_RESUME_FAILED_RUN_ID), status: "completed", name: MIGRATION_FAILURE_JOB, conclusion: "failure", head_sha: FORWARD_RESUME_FAILED_SHA, run_attempt: 1,
        steps: steps.map((step) => ({ ...step })) },
    ],
    ...overrides,
  };
}

export function noSpawnProofInputs(overrides = {}) {
  const runtime = { name: "run-prisma-migrate-with-lock-timeout.mjs", bytes: sourceBytes.length, sha256: digest(sourceBytes) };
  const logText = [
    "\uFEFF2026-10-09T12:00:00.1000000Z ##[group]Run set -Eeuo pipefail",
    `2026-10-09T12:00:00.2000000Z ${JSON.stringify({ authorizationRuntime: [runtime] })}`,
    `2026-10-09T12:00:00.9000000Z ${MIGRATION_GUARD_FAILURE}`,
    "2026-10-09T12:00:00.9500000Z ##[error]Process completed with exit code 1.",
    "2026-10-09T12:00:01.1000000Z ##[group]Run rm -f runner-credentials",
  ].join("\n");
  return {
    run: sourceRun(), jobsPayload: jobsPayload(), logText, sourceGuardBytes: sourceBytes,
    workflowId: "77", sourceIsAncestor: true, ...overrides,
  };
}

export function safeFailedPreflightRetryEvidence(overrides = {}, expectedRetry = {}) {
  const retryRunId = expectedRetry.runId ?? FORWARD_RESUME_SAFE_PREFLIGHT_RETRY_RUN_ID;
  const retrySha = expectedRetry.sha ?? FORWARD_RESUME_SAFE_PREFLIGHT_RETRY_SHA;
  const currentMainSha = expectedRetry.currentMainSha ?? "a5578255f72d8d724d5c20be0a7ac278912a70e7";
  const run = {
    id: Number(retryRunId),
    workflow_id: 372102614,
    path: ".github/workflows/production-migration-preflight.yml@refs/heads/main",
    event: "workflow_dispatch",
    head_branch: "main",
    head_sha: retrySha,
    run_attempt: 1,
    status: "completed",
    conclusion: "failure",
    repository: { full_name: "krustallik/body-model", owner: { id: 126446430, login: "krustallik" } },
    actor: { id: 126446430 },
    triggering_actor: { id: 126446430 },
    ...overrides.run,
  };
  const jobsPayload = {
    total_count: 2,
    jobs: [
      { id: 114194642210, run_id: Number(retryRunId), name: "Authorize read-only preflight", status: "completed", conclusion: "failure",
        head_sha: retrySha, run_attempt: 1,
        steps: [
          { name: "Set up job", conclusion: "success", status: "completed" },
          { name: "Checkout current main tooling", conclusion: "success", status: "completed" },
          { name: "Validate canonical repository, exact main, and successful CI", conclusion: "failure", status: "completed" },
          { name: "Post Checkout current main tooling", conclusion: "success", status: "completed" },
          { name: "Complete job", conclusion: "success", status: "completed" },
        ] },
      { id: 114194697634, run_id: Number(retryRunId), name: "Inspect, back up, restore, and rehearse on disposable PostgreSQL",
        status: "completed", conclusion: "skipped", head_sha: retrySha,
        run_attempt: 1, steps: [] },
    ],
    ...overrides.jobsPayload,
  };
  const historyRun = {
    id: run.id, workflow_id: run.workflow_id, path: run.path, event: run.event, head_branch: run.head_branch,
    head_sha: run.head_sha, run_attempt: run.run_attempt, status: run.status, conclusion: run.conclusion,
    actor: run.actor, triggering_actor: run.triggering_actor,
    ...overrides.historyRun,
  };
  return {
    run, jobsPayload, historyRun, workflowId: String(run.workflow_id),
    currentMainSha,
    shaIsAncestorOfCurrentMain: true,
    ...overrides.evidence,
  };
}
