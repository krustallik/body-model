import { describe, expect, it } from "vitest";
import {
  evaluateProductionDeployGate,
  isCurrentMainSha,
  type DeployGateInput,
  type WorkflowRunEvidence,
} from "../scripts/ci/production-deploy-gate";

const tip = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const stale = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const ciPath = ".github/workflows/ci.yml@refs/heads/main";
const deployPath = ".github/workflows/deploy-production.yml@refs/heads/main";

const currentRun: WorkflowRunEvidence = {
  id: 901,
  run_attempt: 1,
  workflow_id: 80,
  path: deployPath,
  event: "workflow_run",
  head_branch: "main",
  head_sha: tip,
  status: "in_progress",
  conclusion: null,
  repository: { full_name: "krustallik/body-model" },
  head_repository: { full_name: "krustallik/body-model" },
};

const sourceRun: WorkflowRunEvidence = {
  id: 700,
  run_attempt: 2,
  workflow_id: 42,
  path: ciPath,
  event: "push",
  head_branch: "main",
  head_sha: tip,
  status: "completed",
  conclusion: "success",
  repository: { full_name: "krustallik/body-model" },
  head_repository: { full_name: "krustallik/body-model" },
};

function manualGate(overrides: Partial<DeployGateInput> = {}) {
  return evaluateProductionDeployGate({
    eventName: "workflow_dispatch",
    repositoryFullName: "krustallik/body-model",
    mainTipSha: tip,
    candidateSha: tip,
    dispatchConfirm: "deploy",
    nonServingDeploy: true,
    ...overrides,
  });
}

function automaticGate(overrides: Partial<DeployGateInput> = {}) {
  return evaluateProductionDeployGate({
    eventName: "workflow_run",
    repositoryFullName: "krustallik/body-model",
    mainTipSha: tip,
    candidateSha: "ignored-caller-value-must-not-select-release",
    currentWorkflowRun: currentRun,
    currentWorkflowRunId: 901,
    currentWorkflowRunAttempt: 1,
    currentWorkflowRunSha: tip,
    workflowRunEventId: 700,
    workflowRunEventAttempt: 2,
    sourceWorkflowRun: sourceRun,
    expectedCiWorkflowId: 42,
    ...overrides,
  });
}

describe("evaluateProductionDeployGate", () => {
  it("allows only exact current-main owner-authorized manual non-serving deploys", () => {
    expect(manualGate()).toEqual({
      decision: "deploy",
      reason: "Owner-authorized non-serving deploy is bound to the exact current main SHA.",
      candidateSha: tip,
      mode: "non-serving",
    });
    expect(manualGate({ dispatchConfirm: "nope" })).toMatchObject({ decision: "block" });
    expect(manualGate({ nonServingDeploy: false })).toMatchObject({ decision: "block" });
    expect(manualGate({ candidateSha: stale })).toMatchObject({ decision: "skip" });
  });

  it("allows automatic serving only from successful CI for the exact current main SHA", () => {
    expect(automaticGate()).toEqual({
      decision: "deploy",
      reason: "Automatic app deploy is bound to successful BodyCast CI/CD for the exact current main SHA.",
      candidateSha: tip,
      mode: "serving",
    });
  });

  it.each([
    ["PR workflow event", { event: "pull_request" }],
    ["feature branch", { head_branch: "feature/untrusted" }],
    ["failed CI", { conclusion: "failure" }],
    ["incomplete CI", { status: "in_progress" }],
    ["foreign repository", { repository: { full_name: "fork/body-model" } }],
    ["foreign head repository", { head_repository: { full_name: "fork/body-model" } }],
    ["wrong workflow path", { path: ".github/workflows/other.yml@refs/heads/main" }],
    ["wrong attempt", { run_attempt: 1 }],
    ["wrong workflow id", { workflow_id: 43 }],
    ["wrong run id", { id: 701 }],
  ])("blocks automatic deploy for %s", (_label, sourceOverride) => {
    const badSource = { ...sourceRun, ...sourceOverride } as WorkflowRunEvidence;
    expect(automaticGate({ sourceWorkflowRun: badSource })).toMatchObject({ decision: "block" });
  });

  it("blocks a replayed event attempt when GitHub reports a newer source attempt", () => {
    expect(automaticGate({ workflowRunEventAttempt: 1 })).toMatchObject({ decision: "block" });
    expect(automaticGate({ workflowRunEventAttempt: null })).toMatchObject({ decision: "block" });
  });

  it("requires a canonical head repository binding", () => {
    expect(automaticGate({ sourceWorkflowRun: { ...sourceRun, head_repository: null } })).toMatchObject({ decision: "block" });
  });

  it("blocks an untrusted/stale deploy workflow run and ignores caller-selected candidate SHA", () => {
    expect(automaticGate({ currentWorkflowRunId: 902 })).toMatchObject({ decision: "block" });
    expect(automaticGate({ currentWorkflowRunSha: stale })).toMatchObject({ decision: "block" });
    expect(automaticGate({ mainTipSha: stale })).toMatchObject({ decision: "skip", candidateSha: null });
    expect(automaticGate({ currentWorkflowRun: { ...currentRun, run_attempt: 2 } })).toMatchObject({ decision: "block" });
    expect(automaticGate({ currentWorkflowRun: { ...currentRun, path: ".github/workflows/other.yml@refs/heads/main" } })).toMatchObject({ decision: "block" });
    expect(automaticGate({ currentWorkflowRun: { ...currentRun, head_repository: null } })).toMatchObject({ decision: "block" });
  });

  it("rejects foreign repositories, malformed SHAs, and unsupported trigger types", () => {
    expect(manualGate({ repositoryFullName: "evil/body-model" })).toMatchObject({ decision: "block" });
    expect(manualGate({ candidateSha: "abc" })).toMatchObject({ decision: "block" });
    expect(manualGate({ eventName: "schedule" })).toMatchObject({ decision: "block" });
  });

  it("uses a strict full-SHA comparison", () => {
    expect(isCurrentMainSha(tip, tip)).toBe(true);
    expect(isCurrentMainSha(stale, tip)).toBe(false);
    expect(isCurrentMainSha("not-a-sha", tip)).toBe(false);
  });
});
