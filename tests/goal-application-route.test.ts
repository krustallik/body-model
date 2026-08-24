import { beforeEach, describe, expect, it, vi } from "vitest";
import { NoActiveModelEpisodeError } from "@/modules/model-episodes/model-episode.errors";
import { buildGoalPlanningRequest, defaultGoalForm } from "@/modules/model-goal-planning/goal-planning-ui";

const services = vi.hoisted(() => ({ solve: vi.fn(), serialize: vi.fn() }));
vi.mock("@/modules/model-target-solver/model-target-solver.service", () => ({ solveModelEpisodeTarget: services.solve }));
vi.mock("@/modules/model-goal-planning/goal-planning", async (original) => {
  const actual = await original<typeof import("@/modules/model-goal-planning/goal-planning")>();
  return { ...actual, serializeGoalPlanningResult: services.serialize };
});

import { POST } from "@/app/api/goal/route";

const built = buildGoalPlanningRequest(defaultGoalForm("2026-10-19", 82), "2026-10-19");
if (!built.request) throw new Error("expected request");
const validBody = built.request;
function request(body: unknown) { return new Request("http://localhost/api/goal", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); }

describe("goal planning application route", () => {
  beforeEach(() => { vi.clearAllMocks(); services.serialize.mockReturnValue({ status: "solved", forecast: { dates: [] } }); });

  it("validates and delegates without exposing solver configuration controls", async () => {
    expect((await POST(request({ goal: {} }))).status).toBe(400);
    services.solve.mockResolvedValue({ status: "solved" });
    const response = await POST(request(validBody));
    expect(response.status).toBe(200);
    expect(services.solve).toHaveBeenCalledWith(expect.objectContaining({ goal: validBody.goal, seed: 20_260_824,
      control: { type: "daily-calorie-center", constraints: validBody.constraints,
        nutritionAdjustmentPolicy: { type: "proportional-template" } } }));
    expect(services.solve.mock.calls[0][0]).not.toHaveProperty("solverConfig");
  });

  it("rejects malformed dates and non-finite JSON values deterministically", async () => {
    expect((await POST(request({ ...validBody, goal: { ...validBody.goal, goalDate: "2026-02-30" } }))).status).toBe(400);
    const invalidTarget = JSON.stringify(validBody).replace(String(validBody.goal.targetValueKg), "null");
    const response = await POST(new Request("http://localhost/api/goal", { method: "POST", headers: { "content-type": "application/json" }, body: invalidTarget }));
    expect(response.status).toBe(400);
  });

  it("maps non-future goal dates and missing models to specific API errors", async () => {
    services.solve.mockRejectedValueOnce(new RangeError("goal date must be after latest date"));
    let response = await POST(request(validBody));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_goal_date" });
    services.solve.mockRejectedValueOnce(new NoActiveModelEpisodeError());
    response = await POST(request(validBody));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "no_active_episode" });
  });

  it("does not leak unexpected failures", async () => {
    services.solve.mockRejectedValue(new Error("private database detail"));
    const response = await POST(request(validBody));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "goal_planning_failed" });
  });
});
