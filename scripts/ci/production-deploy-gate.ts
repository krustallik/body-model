export type WorkflowRunEvidence = {
  id: number | string;
  run_attempt: number;
  workflow_id: number | string;
  path: string;
  event: string;
  head_branch: string;
  head_sha: string;
  status: string;
  conclusion: string | null;
  repository?: { full_name?: string } | null;
  head_repository?: { full_name?: string } | null;
};

export type DeployGateInput = {
  eventName: string;
  repositoryFullName: string;
  mainTipSha: string;
  candidateSha: string;
  dispatchConfirm?: string | null;
  nonServingDeploy?: boolean;
  currentWorkflowRun?: WorkflowRunEvidence;
  currentWorkflowRunId?: number | string | null;
  currentWorkflowRunAttempt?: number | string | null;
  currentWorkflowRunSha?: string | null;
  workflowRunEventId?: number | string | null;
  workflowRunEventAttempt?: number | string | null;
  sourceWorkflowRun?: WorkflowRunEvidence;
  expectedCiWorkflowId?: number | string | null;
};

export type DeployGateResult = {
  decision: "deploy" | "block" | "skip";
  reason: string;
  candidateSha: string | null;
  mode?: "serving" | "non-serving";
};

const FULL_SHA = /^[0-9a-f]{40}$/;
const POSITIVE_INTEGER = /^[1-9][0-9]*$/;
const REPOSITORY = "krustallik/body-model";
const DEPLOY_WORKFLOW_PATH = ".github/workflows/deploy-production.yml";
const CI_WORKFLOW_PATH = ".github/workflows/ci.yml";

/** Compare a candidate against a freshly observed canonical refs/heads/main commit. */
export function isCurrentMainSha(candidateSha: string, observedMainSha: string): boolean {
  return FULL_SHA.test(candidateSha) && FULL_SHA.test(observedMainSha) && candidateSha === observedMainSha;
}

function pathMatchesWorkflow(value: string | undefined, expected: string): boolean {
  return value === expected;
}

function validRunAttempt(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function validRunId(value: unknown): boolean {
  return POSITIVE_INTEGER.test(String(value ?? ""));
}

/**
 * The deploy workflow itself must be the current main workflow run. This is
 * checked independently from the upstream CI run so queued/stale workflow_run
 * events cannot authorize production credentials.
 */
export function isTrustedDeployWorkflowRun(
  run: WorkflowRunEvidence | undefined,
  expected: { repository: string; runId: string; runAttempt: string; headSha: string },
): boolean {
  return Boolean(run)
    && run!.repository?.full_name === expected.repository
    && validRunId(run!.id)
    && String(run!.id) === expected.runId
    && validRunAttempt(run!.run_attempt)
    && String(run!.run_attempt) === expected.runAttempt
    && pathMatchesWorkflow(run!.path, DEPLOY_WORKFLOW_PATH)
    && run!.event === "workflow_run"
    && run!.head_branch === "main"
    && run!.head_repository?.full_name === expected.repository
    && run!.head_sha === expected.headSha
    && run!.status === "in_progress"
    && run!.conclusion === null;
}

function trustedSuccessfulMainCiRun(input: DeployGateInput): boolean {
  const run = input.sourceWorkflowRun;
  const expectedId = input.workflowRunEventId;
  const eventAttempt = input.workflowRunEventAttempt;
  const expectedWorkflowId = input.expectedCiWorkflowId;
  if (!run || !validRunId(run.id) || !validRunAttempt(run.run_attempt)
    || !validRunId(expectedId) || String(run.id) !== String(expectedId)
    || !validRunId(eventAttempt) || String(run.run_attempt) !== String(eventAttempt)
    || !validRunId(expectedWorkflowId) || String(run.workflow_id) !== String(expectedWorkflowId)
    || !pathMatchesWorkflow(run.path, CI_WORKFLOW_PATH)
    || run.event !== "push" || run.head_branch !== "main"
    || run.status !== "completed" || run.conclusion !== "success"
    || run.repository?.full_name !== REPOSITORY
    || run.head_repository?.full_name !== REPOSITORY
    || !FULL_SHA.test(run.head_sha)) {
    return false;
  }

  return true;
}

/**
 * Ordinary app deploy follows successful current-main CI. Manual deployment is
 * retained only for the owner-authorized non-serving schema-cutover path.
 */
export function evaluateProductionDeployGate(input: DeployGateInput): DeployGateResult {
  if (input.repositoryFullName !== REPOSITORY) {
    return { decision: "block", reason: "Production deployment is allowed only from the canonical BodyCast repository.", candidateSha: null };
  }

  if (input.eventName === "workflow_dispatch") {
    if (input.dispatchConfirm !== "deploy") {
      return { decision: "block", reason: "Manual deploy requires confirm_production_deploy=deploy.", candidateSha: null };
    }
    if (input.nonServingDeploy !== true) {
      return { decision: "block", reason: "Manual deploy is reserved for the owner-authorized non-serving schema-cutover path.", candidateSha: null };
    }
    if (!FULL_SHA.test(input.candidateSha)) {
      return { decision: "block", reason: "Manual deploy requires a full 40-character candidate SHA.", candidateSha: null };
    }
    if (!isCurrentMainSha(input.candidateSha, input.mainTipSha)) {
      return { decision: "skip", reason: `Candidate ${input.candidateSha} is not current canonical main tip ${input.mainTipSha}.`, candidateSha: input.candidateSha };
    }
    return {
      decision: "deploy",
      reason: "Owner-authorized non-serving deploy is bound to the exact current main SHA.",
      candidateSha: input.candidateSha,
      mode: "non-serving",
    };
  }

  if (input.eventName !== "workflow_run") {
    return { decision: "block", reason: "Production deployment requires successful current-main CI or an owner-authorized manual dispatch.", candidateSha: null };
  }
  if (!isTrustedDeployWorkflowRun(input.currentWorkflowRun, {
    repository: REPOSITORY,
    runId: String(input.currentWorkflowRunId ?? ""),
    runAttempt: String(input.currentWorkflowRunAttempt ?? ""),
    headSha: String(input.currentWorkflowRunSha ?? ""),
  })) {
    return { decision: "block", reason: "Automatic deploy workflow run is not the active canonical main workflow attempt.", candidateSha: null };
  }
  if (input.currentWorkflowRunSha !== input.mainTipSha) {
    return { decision: "skip", reason: "Automatic deploy workflow code is not from the current canonical main SHA.", candidateSha: null };
  }
  if (!trustedSuccessfulMainCiRun(input)) {
    return { decision: "block", reason: "Automatic deploy requires the exact successful BodyCast CI/CD push run for main.", candidateSha: null };
  }
  const candidateSha = input.sourceWorkflowRun!.head_sha;
  if (!isCurrentMainSha(candidateSha, input.mainTipSha)) {
    return { decision: "skip", reason: `Successful CI candidate ${candidateSha} is no longer the canonical main tip ${input.mainTipSha}.`, candidateSha };
  }
  return {
    decision: "deploy",
    reason: "Automatic app deploy is bound to successful BodyCast CI/CD for the exact current main SHA.",
    candidateSha,
    mode: "serving",
  };
}
