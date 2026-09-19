import { describe, expect, it } from "vitest";
import { parseTrainingDecimal } from "@/modules/training/parse-training-decimal";
import { sessionPlanCompletion } from "@/modules/training/session-plan-completion";
import { formatElapsedClock } from "@/app/training/training-labels";

describe("parseTrainingDecimal", () => {
  it("accepts comma and dot decimals", () => {
    expect(parseTrainingDecimal("33,5")).toBe(33.5);
    expect(parseTrainingDecimal("33.5")).toBe(33.5);
    expect(parseTrainingDecimal("")).toBeNaN();
  });
});

describe("sessionPlanCompletion", () => {
  it("can exceed 100 percent when extra sets are logged", () => {
    const result = sessionPlanCompletion([
      { snapshotExerciseName: "Press", plannedSets: 4, sets: [{}, {}, {}, {}, {}] },
      { snapshotExerciseName: "Fly", plannedSets: 3, sets: [{}, {}] },
    ]);
    expect(result.loggedSets).toBe(7);
    expect(result.plannedSets).toBe(7);
    expect(result.percent).toBe(100);
    expect(result.incompleteExercises).toEqual([
      { name: "Fly", loggedSets: 2, plannedSets: 3 },
    ]);
  });

  it("reports 125 percent for 5 of 4 sets", () => {
    expect(sessionPlanCompletion([
      { snapshotExerciseName: "Press", plannedSets: 4, sets: [{}, {}, {}, {}, {}] },
    ]).percent).toBe(125);
  });
});

describe("formatElapsedClock", () => {
  it("formats mm:ss and h:mm:ss", () => {
    expect(formatElapsedClock(82_000)).toBe("01:22");
    expect(formatElapsedClock(3_662_000)).toBe("1:01:02");
  });
});
