/**
 * Pure gate for BodyCast automatic production deploy authorization.
 * Used by GitHub Actions and unit tests — no network side effects.
 */

export type WorkflowRunLike = {
  conclusion: string | null;
  event: string;
  head_branch: string | null;
  head_sha: string;
  path?: string | null;
  name?: string | null;
};

export type DeployGateInput = {
  eventName: string;
  repositoryFullName: string;
  workflowRepositoryFullName: string;
  workflowName: string;
  expectedWorkflowName: string;
  workflowRun: WorkflowRunLike | null;
  mainTipSha: string;
  candidateSha: string;
  dispatchConfirm?: string | null;
};

export type DeployGateResult = {
  decision: "deploy" | "skip" | "block";
  reason: string;
  candidateSha: string | null;
};

const FULL_SHA = /^[0-9a-f]{40}$/;

/** Compare a candidate against a freshly observed refs/heads/main commit. */
export function isCurrentMainSha(candidateSha: string, observedMainSha: string): boolean {
  return FULL_SHA.test(candidateSha) && FULL_SHA.test(observedMainSha) && candidateSha === observedMainSha;
}

export function evaluateProductionDeployGate(input: DeployGateInput): DeployGateResult {
  if (input.repositoryFullName !== input.workflowRepositoryFullName) {
    return {
      decision: "block",
      reason: "Workflow run source repository does not match this repository.",
      candidateSha: null,
    };
  }

  if (input.eventName === "workflow_dispatch") {
    if (input.dispatchConfirm !== "deploy") {
      return {
        decision: "block",
        reason: "Manual deploy requires confirm_production_deploy=deploy.",
        candidateSha: null,
      };
    }
    if (!FULL_SHA.test(input.candidateSha)) {
      return {
        decision: "block",
        reason: "Manual deploy requires a full 40-character candidate SHA.",
        candidateSha: null,
      };
    }
    if (!isCurrentMainSha(input.candidateSha, input.mainTipSha)) {
      return {
        decision: "skip",
        reason: `Candidate ${input.candidateSha} is not current origin/main tip ${input.mainTipSha}.`,
        candidateSha: input.candidateSha,
      };
    }
    return {
      decision: "deploy",
      reason: "Manual deploy authorized for current main tip.",
      candidateSha: input.candidateSha,
    };
  }

  if (input.eventName !== "workflow_run" || !input.workflowRun) {
    return {
      decision: "block",
      reason: `Unsupported deploy trigger event: ${input.eventName}`,
      candidateSha: null,
    };
  }

  const run = input.workflowRun;
  if (input.workflowName !== input.expectedWorkflowName) {
    return {
      decision: "skip",
      reason: `Ignoring workflow "${input.workflowName}" (expected "${input.expectedWorkflowName}").`,
      candidateSha: run.head_sha,
    };
  }
  if (run.conclusion !== "success") {
    return {
      decision: "skip",
      reason: `Main CI conclusion is "${run.conclusion ?? "null"}"; deploy requires success.`,
      candidateSha: run.head_sha,
    };
  }
  if (run.event !== "push") {
    return {
      decision: "skip",
      reason: `CI event is "${run.event}"; production deploy requires push to main (not pull_request).`,
      candidateSha: run.head_sha,
    };
  }
  if (run.head_branch !== "main") {
    return {
      decision: "skip",
      reason: `CI head_branch is "${run.head_branch ?? "null"}"; production deploy requires main.`,
      candidateSha: run.head_sha,
    };
  }
  if (!FULL_SHA.test(run.head_sha)) {
    return {
      decision: "block",
      reason: "CI head_sha is not a full 40-character commit SHA.",
      candidateSha: null,
    };
  }
  if (!isCurrentMainSha(run.head_sha, input.mainTipSha)) {
    return {
      decision: "skip",
      reason: `Stale CI SHA ${run.head_sha} superseded by origin/main tip ${input.mainTipSha}.`,
      candidateSha: run.head_sha,
    };
  }
  if (input.candidateSha !== run.head_sha) {
    return {
      decision: "block",
      reason: "Candidate SHA does not match the triggering CI head_sha.",
      candidateSha: input.candidateSha,
    };
  }

  return {
    decision: "deploy",
    reason: "Green main push CI for current tip authorizes automatic production app deploy.",
    candidateSha: run.head_sha,
  };
}
