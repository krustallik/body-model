import { describe, expect, it } from "vitest";
import { canOpenGoalPlanner, defaultGoalForm } from "@/modules/model-goal-planning/goal-planning-ui";
import { formatDate } from "@/modules/model-forecast/forecast-ui";

describe("goal planner readiness", () => {
  it("blocks planner rendering when latestModeledDate is null (root-cause regression)", () => {
    expect(canOpenGoalPlanner(null)).toBe(false);
    expect(canOpenGoalPlanner(undefined)).toBe(false);
    expect(canOpenGoalPlanner("")).toBe(false);
    // Previous crash path: formatDate(null!) → Invalid Date / RangeError in Intl
    expect(() => formatDate(null as unknown as string, { year: "numeric" }, "en")).toThrow();
  });

  it("allows planner rendering for valid modeled dates (v5/v6 episodes with state)", () => {
    expect(canOpenGoalPlanner("2026-09-16")).toBe(true);
    const form = defaultGoalForm("2026-09-16", 89.4);
    expect(form.goalDate).toBe("2026-12-15");
    expect(form.targetWeightKg).toBe("86.4");
    expect(formatDate("2026-09-16", { year: "numeric" }, "en")).toContain("2026");
  });

  it("keeps empty goal date when model state is insufficient", () => {
    const form = defaultGoalForm(null, null);
    expect(form.goalDate).toBe("");
    expect(form.targetWeightKg).toBe("");
    expect(canOpenGoalPlanner(form.goalDate || null)).toBe(false);
  });
});
