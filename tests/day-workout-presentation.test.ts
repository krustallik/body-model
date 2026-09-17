import { describe, expect, it } from "vitest";
import { displayWorkoutType, summarizeDayWorkouts } from "@/modules/days/day-workout-presentation";

const workout = (
  type: string,
  durationMinutes: number | null,
  activeEnergyKcal: number | null = null,
  startAt = "2026-09-16T08:44:00.000Z",
  endAt = "2026-09-16T09:46:00.000Z",
) => ({ type, startAt, endAt, durationMinutes, activeEnergyKcal });

describe("summarizeDayWorkouts", () => {
  it("returns no observation when workouts and legacy strength are absent", () => {
    expect(summarizeDayWorkouts({ workouts: [], legacyStrengthTrainingMinutes: null })).toEqual({
      workouts: [],
      totalWorkoutMinutes: null,
      workoutSource: "none",
    });
  });

  it("sums one strength workout", () => {
    const summary = summarizeDayWorkouts({
      workouts: [workout("Traditional Strength Training", 62)],
      legacyStrengthTrainingMinutes: null,
    });
    expect(summary.totalWorkoutMinutes).toBe(62);
    expect(summary.workoutSource).toBe("workouts");
    expect(summary.workouts).toHaveLength(1);
    expect(displayWorkoutType(summary.workouts[0]!)).toBe("Traditional Strength Training");
    expect(summary.workouts[0]?.linkedTrainingSessionId).toBeNull();
    expect(summary.workouts[0]?.linkedTrainingProgramName).toBeNull();
  });

  it("surfaces matched diary session linkage when present", () => {
    const summary = summarizeDayWorkouts({
      workouts: [{
        type: "Traditional Strength Training",
        startAt: "2026-09-16T08:44:00.000Z",
        endAt: "2026-09-16T09:46:00.000Z",
        durationMinutes: 62,
        activeEnergyKcal: null,
        matchedDiarySession: { id: 42, program: { name: "Push A" } },
      }],
      legacyStrengthTrainingMinutes: null,
    });
    expect(summary.workouts[0]?.linkedTrainingSessionId).toBe(42);
    expect(summary.workouts[0]?.linkedTrainingProgramName).toBe("Push A");
  });

  it("sums one stair workout without renaming it strength", () => {
    const summary = summarizeDayWorkouts({
      workouts: [workout("Stair Climbing", 62, 154)],
      legacyStrengthTrainingMinutes: null,
    });
    expect(summary.totalWorkoutMinutes).toBe(62);
    expect(displayWorkoutType(summary.workouts[0]!)).toBe("Stair Climbing");
    expect(summary.workouts[0]?.activeEnergyKcal).toBe(154);
  });

  it("sums stair + strength", () => {
    const summary = summarizeDayWorkouts({
      workouts: [
        workout("Stair Climbing", 62, 154),
        workout("Traditional Strength Training", 45),
      ],
      legacyStrengthTrainingMinutes: 99,
    });
    expect(summary.totalWorkoutMinutes).toBe(107);
    expect(summary.workoutSource).toBe("workouts");
    expect(summary.workouts).toHaveLength(2);
  });

  it("sums three workouts", () => {
    const summary = summarizeDayWorkouts({
      workouts: [
        workout("Stair Climbing", 20),
        workout("Traditional Strength Training", 30),
        workout("Cycling", 40),
      ],
      legacyStrengthTrainingMinutes: null,
    });
    expect(summary.totalWorkoutMinutes).toBe(90);
    expect(summary.workouts).toHaveLength(3);
  });

  it("falls back to legacy strength when no workout rows exist", () => {
    expect(summarizeDayWorkouts({
      workouts: [],
      legacyStrengthTrainingMinutes: 62,
    })).toEqual({
      workouts: [],
      totalWorkoutMinutes: 62,
      workoutSource: "legacy-strength",
    });
  });

  it("does not double-count legacy strength when explicit workouts exist", () => {
    const summary = summarizeDayWorkouts({
      workouts: [workout("Traditional Strength Training", 50)],
      legacyStrengthTrainingMinutes: 50,
    });
    expect(summary.totalWorkoutMinutes).toBe(50);
    expect(summary.workoutSource).toBe("workouts");
  });

  it("excludes malformed and non-positive durations from the total safely", () => {
    const summary = summarizeDayWorkouts({
      workouts: [
        workout("Stair Climbing", null),
        workout("Traditional Strength Training", 0),
        workout("Cycling", Number.NaN),
        workout("Traditional Strength Training", 40),
      ],
      legacyStrengthTrainingMinutes: null,
    });
    expect(summary.totalWorkoutMinutes).toBe(40);
    expect(summary.workouts).toHaveLength(4);
    expect(summary.workouts.map((item) => item.durationMinutes)).toEqual([null, null, null, 40]);
  });

  it("canonicalizes workout types case-insensitively", () => {
    const summary = summarizeDayWorkouts({
      workouts: [workout("stair climbing", 30)],
      legacyStrengthTrainingMinutes: null,
    });
    expect(summary.workouts[0]?.classification).toBe("stair-climbing");
    expect(displayWorkoutType(summary.workouts[0]!)).toBe("Stair Climbing");
  });
});
