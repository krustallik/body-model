import { describe, expect, it } from "vitest";
import { latestCompletedLocalDate } from "@/modules/model-episodes/model-calendar";
import { defaultGoalForm, buildGoalPlanningRequest } from "@/modules/model-goal-planning/goal-planning-ui";
import {
  goalHorizonDays,
  isGoalDateAfterLatestCompletedLocalDate,
  minimumGoalDate,
} from "@/modules/model-target-solver/goal-date";

describe("Goal date boundary shared with the solver", () => {
  it("uses the first day after the latest completed local day as the minimum", () => {
    expect(minimumGoalDate("2026-09-29")).toBe("2026-09-30");
    expect(isGoalDateAfterLatestCompletedLocalDate("2026-09-29", "2026-09-29")).toBe(false);
    expect(isGoalDateAfterLatestCompletedLocalDate("2026-09-30", "2026-09-29")).toBe(true);
    expect(goalHorizonDays("2026-09-29", "2026-09-30")).toBe(1);
    expect(() => goalHorizonDays("2026-09-29", "2026-09-29")).toThrow(/latest completed local date/);
  });

  it("defaults from the later of modeled and completed dates so stale histories remain valid", () => {
    const stale = defaultGoalForm("2026-06-10", 79, "2026-09-29");
    expect(stale.goalDate).toBe("2026-12-28");
    expect(isGoalDateAfterLatestCompletedLocalDate(stale.goalDate, "2026-09-29")).toBe(true);

    const current = defaultGoalForm("2026-10-05", 79, "2026-09-29");
    expect(current.goalDate).toBe("2027-01-03");
    expect(isGoalDateAfterLatestCompletedLocalDate(current.goalDate, "2026-09-29")).toBe(true);
    expect(defaultGoalForm("2026-06-10", 79).goalDate).toBe("");
  });

  it("blocks a pre-boundary date client-side and accepts the first valid future date", () => {
    const values = defaultGoalForm("2026-06-10", 79, "2026-09-29");
    values.goalDate = "2026-09-29";
    const rejected = buildGoalPlanningRequest(values, "2026-06-10", "2026-09-29");
    expect(rejected.request).toBeNull();
    expect(rejected.errors.goalDate).toBe("Goal date must be after the latest completed local day");

    values.goalDate = "2026-09-30";
    const accepted = buildGoalPlanningRequest(values, "2026-06-10", "2026-09-29");
    expect(accepted.errors.goalDate).toBeUndefined();
    expect(accepted.request?.goal.goalDate).toBe("2026-09-30");
  });

  it("tracks the completed-day boundary through local midnight and the DST transition", () => {
    const beforeSeptemberMidnight = latestCompletedLocalDate(
      new Date("2026-09-29T21:59:59.000Z"),
      "Europe/Bratislava",
    );
    const afterSeptemberMidnight = latestCompletedLocalDate(
      new Date("2026-09-29T22:00:00.000Z"),
      "Europe/Bratislava",
    );
    expect(beforeSeptemberMidnight).toBe("2026-09-28");
    expect(minimumGoalDate(beforeSeptemberMidnight)).toBe("2026-09-29");
    expect(afterSeptemberMidnight).toBe("2026-09-29");
    expect(minimumGoalDate(afterSeptemberMidnight)).toBe("2026-09-30");

    const beforeDstMidnight = latestCompletedLocalDate(
      new Date("2026-10-25T22:59:59.000Z"),
      "Europe/Bratislava",
    );
    const afterDstMidnight = latestCompletedLocalDate(
      new Date("2026-10-25T23:00:00.000Z"),
      "Europe/Bratislava",
    );
    expect(beforeDstMidnight).toBe("2026-10-24");
    expect(minimumGoalDate(beforeDstMidnight)).toBe("2026-10-25");
    expect(afterDstMidnight).toBe("2026-10-25");
    expect(minimumGoalDate(afterDstMidnight)).toBe("2026-10-26");
  });
});
