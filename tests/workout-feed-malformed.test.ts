import { describe, expect, it } from "vitest";
import {
  STAIR_CLIMBING_TYPE,
  TRADITIONAL_STRENGTH_TRAINING_TYPE,
  expandTrainingWorkoutFields,
} from "@/modules/health/expand-training-workouts";
import { resolveWorkoutFeedObserved } from "@/modules/health/workout-feed-coverage";

const DAY = "2026-08-22";

describe("workout feed malformed / incomplete training payloads", () => {
  it("marks type-present timestamps-missing as unavailable coverage and empty expansion", () => {
    const observed = resolveWorkoutFeedObserved({
      date: DAY,
      trainingType: STAIR_CLIMBING_TYPE,
      trainingActiveKcal: "154",
      trainingTimestamps: "",
    });
    const expanded = expandTrainingWorkoutFields({
      trainingType: STAIR_CLIMBING_TYPE,
      trainingActiveKcal: "154",
      trainingTimestamps: "",
      dayDate: DAY,
    });
    expect(observed).toBe(false);
    expect(expanded.workouts).toEqual([]);
    expect(expanded.diagnostics.reasons.some((reason) => reason.startsWith("mismatched-timestamp-count"))).toBe(true);
  });

  it("rejects kcal present with malformed timestamps while keeping coverage unavailable for odd count", () => {
    const observed = resolveWorkoutFeedObserved({
      date: DAY,
      trainingType: `${STAIR_CLIMBING_TYPE}\n${TRADITIONAL_STRENGTH_TRAINING_TYPE}`,
      trainingActiveKcal: "154\n562",
      trainingTimestamps: "not-a-timestamp\nalso-bad\nstill-odd",
    });
    const expanded = expandTrainingWorkoutFields({
      trainingType: `${STAIR_CLIMBING_TYPE}\n${TRADITIONAL_STRENGTH_TRAINING_TYPE}`,
      trainingActiveKcal: "154\n562",
      trainingTimestamps: "not-a-timestamp\nalso-bad\nstill-odd",
      dayDate: DAY,
    });
    expect(observed).toBe(false);
    expect(expanded.workouts).toEqual([]);
    expect(expanded.diagnostics.reasons.some((reason) => reason.startsWith("mismatched-timestamp-count"))).toBe(true);
  });

  it("keeps sibling workouts when kcal is present and only one timestamp pair is malformed", () => {
    const expanded = expandTrainingWorkoutFields({
      trainingType: `${STAIR_CLIMBING_TYPE}\n${TRADITIONAL_STRENGTH_TRAINING_TYPE}`,
      trainingActiveKcal: "154\n562",
      trainingTimestamps: [
        "garbage-start",
        "2026-08-22T17:00:00Z",
        "still-not-a-time",
        "2026-08-22T18:00:00Z",
      ].join("\n"),
      dayDate: DAY,
    });
    expect(expanded.diagnostics.acceptedCount).toBe(1);
    expect(expanded.diagnostics.rejectedCount).toBe(1);
    expect(expanded.diagnostics.reasons).toContain("workout-0:malformed-start");
    expect(expanded.workouts).toHaveLength(1);
    expect(expanded.workouts[0]?.activeEnergyKcal).toBe(562);
    // Structure is usable (2N timestamps + matching kcal), so the feed was observed.
    expect(resolveWorkoutFeedObserved({
      date: DAY,
      trainingType: `${STAIR_CLIMBING_TYPE}\n${TRADITIONAL_STRENGTH_TRAINING_TYPE}`,
      trainingActiveKcal: "154\n562",
      trainingTimestamps: [
        "garbage-start",
        "2026-08-22T17:00:00Z",
        "still-not-a-time",
        "2026-08-22T18:00:00Z",
      ].join("\n"),
    })).toBe(true);
  });

  it("marks mismatched starts/ends and odd timestamp counts as unavailable (not confirmed zero)", () => {
    expect(resolveWorkoutFeedObserved({
      date: DAY,
      trainingType: `${STAIR_CLIMBING_TYPE}\n${STAIR_CLIMBING_TYPE}`,
      trainingActiveKcal: "154\n18",
      trainingTimestamps: [
        "2026-08-22T07:00:00Z",
        "2026-08-22T07:10:00Z",
        "2026-08-22T07:12:00Z",
      ].join("\n"),
    })).toBe(false);

    expect(resolveWorkoutFeedObserved({
      date: DAY,
      trainingType: STAIR_CLIMBING_TYPE,
      trainingActiveKcal: "154",
      trainingTimestamps: "2026-08-22T07:00:00Z",
    })).toBe(false);

    const mismatched = expandTrainingWorkoutFields({
      trainingType: `${STAIR_CLIMBING_TYPE}\n${STAIR_CLIMBING_TYPE}`,
      trainingActiveKcal: "154\n18",
      trainingTimestamps: [
        "2026-08-22T07:00:00Z",
        "2026-08-22T07:10:00Z",
        "2026-08-22T07:12:00Z",
      ].join("\n"),
      dayDate: DAY,
    });
    expect(mismatched.workouts).toEqual([]);
    expect(mismatched.diagnostics.reasons.some((reason) => reason.startsWith("mismatched-timestamp-count"))).toBe(true);
  });

  it("marks a whole malformed workouts feed as unavailable, not confirmed empty zero", () => {
    expect(resolveWorkoutFeedObserved({
      date: DAY,
      workouts: "not-an-array",
    })).toBe(false);
    expect(resolveWorkoutFeedObserved({
      date: DAY,
      workouts: null,
    })).toBe(false);
    expect(resolveWorkoutFeedObserved({
      date: DAY,
      trainingType: { nested: true },
      trainingTimestamps: 12,
    })).toBe(false);
  });

  it("keeps structured siblings when one workout is malformed without overstating empty unknown", () => {
    expect(resolveWorkoutFeedObserved({
      date: DAY,
      workouts: [
        { type: STAIR_CLIMBING_TYPE, startAt: "not-a-date", endAt: "also-bad" },
        {
          type: TRADITIONAL_STRENGTH_TRAINING_TYPE,
          startAt: "2026-08-22T15:00:00.000Z",
          endAt: "2026-08-22T16:00:00.000Z",
          durationMinutes: 60,
          activeEnergyKcal: 400,
        },
      ],
    })).toBe(true);

    // Contrast: absent feed is unavailable; empty array is observed confirmed-zero candidate.
    expect(resolveWorkoutFeedObserved({ date: DAY })).toBe(false);
    expect(resolveWorkoutFeedObserved({ date: DAY, workouts: [] })).toBe(true);
  });
});
