import { describe, expect, it } from "vitest";
import { evaluateProductionDeployGate } from "../scripts/ci/production-deploy-gate.mjs";

const tip = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const older = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

describe("evaluateProductionDeployGate", () => {
  it("allows automatic deploy only for successful main push CI on current tip", () => {
    const result = evaluateProductionDeployGate({
      eventName: "workflow_run",
      repositoryFullName: "krustallik/body-model",
      workflowRepositoryFullName: "krustallik/body-model",
      workflowName: "BodyCast CI/CD",
      expectedWorkflowName: "BodyCast CI/CD",
      workflowRun: {
        conclusion: "success",
        event: "push",
        head_branch: "main",
        head_sha: tip,
      },
      mainTipSha: tip,
      candidateSha: tip,
    });
    expect(result).toEqual({
      decision: "deploy",
      reason: "Green main push CI for current tip authorizes automatic production app deploy.",
      candidateSha: tip,
    });
  });

  it("skips PR CI success", () => {
    const result = evaluateProductionDeployGate({
      eventName: "workflow_run",
      repositoryFullName: "krustallik/body-model",
      workflowRepositoryFullName: "krustallik/body-model",
      workflowName: "BodyCast CI/CD",
      expectedWorkflowName: "BodyCast CI/CD",
      workflowRun: {
        conclusion: "success",
        event: "pull_request",
        head_branch: "feature/x",
        head_sha: tip,
      },
      mainTipSha: tip,
      candidateSha: tip,
    });
    expect(result.decision).toBe("skip");
    expect(result.reason).toMatch(/pull_request/);
  });

  it("skips failed and canceled main CI", () => {
    for (const conclusion of ["failure", "cancelled", "timed_out", "neutral", "skipped"]) {
      const result = evaluateProductionDeployGate({
        eventName: "workflow_run",
        repositoryFullName: "krustallik/body-model",
        workflowRepositoryFullName: "krustallik/body-model",
        workflowName: "BodyCast CI/CD",
        expectedWorkflowName: "BodyCast CI/CD",
        workflowRun: {
          conclusion,
          event: "push",
          head_branch: "main",
          head_sha: tip,
        },
        mainTipSha: tip,
        candidateSha: tip,
      });
      expect(result.decision).toBe("skip");
    }
  });

  it("skips stale CI after a newer main tip", () => {
    const result = evaluateProductionDeployGate({
      eventName: "workflow_run",
      repositoryFullName: "krustallik/body-model",
      workflowRepositoryFullName: "krustallik/body-model",
      workflowName: "BodyCast CI/CD",
      expectedWorkflowName: "BodyCast CI/CD",
      workflowRun: {
        conclusion: "success",
        event: "push",
        head_branch: "main",
        head_sha: older,
      },
      mainTipSha: tip,
      candidateSha: older,
    });
    expect(result.decision).toBe("skip");
    expect(result.reason).toMatch(/Stale CI SHA/);
  });

  it("blocks foreign repository workflow_run", () => {
    const result = evaluateProductionDeployGate({
      eventName: "workflow_run",
      repositoryFullName: "krustallik/body-model",
      workflowRepositoryFullName: "evil/fork",
      workflowName: "BodyCast CI/CD",
      expectedWorkflowName: "BodyCast CI/CD",
      workflowRun: {
        conclusion: "success",
        event: "push",
        head_branch: "main",
        head_sha: tip,
      },
      mainTipSha: tip,
      candidateSha: tip,
    });
    expect(result.decision).toBe("block");
  });

  it("requires deploy confirmation for manual dispatch on tip", () => {
    expect(evaluateProductionDeployGate({
      eventName: "workflow_dispatch",
      repositoryFullName: "krustallik/body-model",
      workflowRepositoryFullName: "krustallik/body-model",
      workflowName: "BodyCast CI/CD",
      expectedWorkflowName: "BodyCast CI/CD",
      workflowRun: null,
      mainTipSha: tip,
      candidateSha: tip,
      dispatchConfirm: "nope",
    }).decision).toBe("block");

    expect(evaluateProductionDeployGate({
      eventName: "workflow_dispatch",
      repositoryFullName: "krustallik/body-model",
      workflowRepositoryFullName: "krustallik/body-model",
      workflowName: "BodyCast CI/CD",
      expectedWorkflowName: "BodyCast CI/CD",
      workflowRun: null,
      mainTipSha: tip,
      candidateSha: tip,
      dispatchConfirm: "deploy",
    }).decision).toBe("deploy");
  });
});
