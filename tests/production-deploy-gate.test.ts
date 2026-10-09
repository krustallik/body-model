import { describe, expect, it } from "vitest";
import { evaluateProductionDeployGate, isCurrentMainSha } from "../scripts/ci/production-deploy-gate";

const tip = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const stale = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function gate(overrides: Record<string, unknown> = {}) {
  return evaluateProductionDeployGate({
    eventName: "workflow_dispatch",
    repositoryFullName: "krustallik/body-model",
    mainTipSha: tip,
    candidateSha: tip,
    dispatchConfirm: "deploy",
    nonServingDeploy: true,
    ...overrides,
  } as Parameters<typeof evaluateProductionDeployGate>[0]);
}

describe("evaluateProductionDeployGate", () => {
  it("allows only an exact current-main manual non-serving deployment", () => {
    expect(gate()).toEqual({
      decision: "deploy",
      reason: "Owner-authorized non-serving deploy is bound to the exact current main SHA.",
      candidateSha: tip,
    });
  });

  it("rejects automatic workflow-run deployment after merge CI", () => {
    expect(gate({ eventName: "workflow_run" })).toMatchObject({ decision: "block" });
  });

  it("requires explicit confirmation and non-serving mode", () => {
    expect(gate({ dispatchConfirm: "nope" })).toMatchObject({ decision: "block" });
    expect(gate({ nonServingDeploy: false })).toMatchObject({ decision: "block" });
  });

  it("rejects foreign repositories and malformed SHA values", () => {
    expect(gate({ repositoryFullName: "evil/body-model" })).toMatchObject({ decision: "block" });
    expect(gate({ candidateSha: "abc" })).toMatchObject({ decision: "block" });
  });

  it("blocks a stale explicit SHA when main advances", () => {
    expect(gate({ candidateSha: stale })).toMatchObject({ decision: "skip", candidateSha: stale });
  });

  it("uses a strict full-SHA freshness comparison", () => {
    expect(isCurrentMainSha(tip, tip)).toBe(true);
    expect(isCurrentMainSha(stale, tip)).toBe(false);
    expect(isCurrentMainSha("not-a-sha", tip)).toBe(false);
  });
});
