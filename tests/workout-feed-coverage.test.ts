import { describe, expect, it } from "vitest";
import { resolveWorkoutFeedObserved } from "@/modules/health/workout-feed-coverage";

describe("resolveWorkoutFeedObserved", () => {
  it("marks structured workouts array as observed even when empty", () => {
    expect(resolveWorkoutFeedObserved({ date: "2026-09-16", workouts: [] })).toBe(true);
  });

  it("does not treat a latest-3 feed for other days as an empty feed for this date", () => {
    expect(resolveWorkoutFeedObserved({
      date: "2026-09-16",
      workouts: [{
        type: "Stair Climbing",
        startAt: "2026-09-15T08:00:00.000Z",
        endAt: "2026-09-15T09:00:00.000Z",
        durationMinutes: 60,
      }],
    })).toBe(false);
  });

  it("marks workouts key absent as unavailable", () => {
    expect(resolveWorkoutFeedObserved({ date: "2026-09-16", walkingDistanceKm: 4 })).toBe(false);
  });

  it("marks null workouts as unavailable", () => {
    expect(resolveWorkoutFeedObserved({ date: "2026-09-16", workouts: null })).toBe(false);
  });

  it("marks malformed workouts value as unavailable", () => {
    expect(resolveWorkoutFeedObserved({ date: "2026-09-16", workouts: "nope" })).toBe(false);
  });

  it("marks empty-but-present training fields as observed", () => {
    expect(resolveWorkoutFeedObserved({
      date: "2026-09-16",
      trainingType: "",
      trainingTimestamps: "",
    })).toBe(true);
  });

  it("marks an empty Shortcut strength field as an observed rest day", () => {
    expect(resolveWorkoutFeedObserved({
      Date: "2026-09-15",
      Trainingtype: "",
      Trainingactivekcal: "",
      Strengthtrainingminutes: "",
    })).toBe(true);
  });

  it("accepts Shortcut Strengthtrainingminutes timestamp lines as the training feed", () => {
    expect(resolveWorkoutFeedObserved({
      Date: "2026-09-16",
      Trainingtype: "Stair Climbing\nTraditional Strength Training",
      Trainingactivekcal: "154\n562",
      Strengthtrainingminutes: [
        "16. 9. 2026, 12:40",
        "16. 9. 2026, 10:44",
        "16. 9. 2026, 12:52",
        "16. 9. 2026, 11:46",
      ].join("\n"),
    })).toBe(true);
  });

  it("marks catastrophically mismatched training fields as unavailable", () => {
    expect(resolveWorkoutFeedObserved({
      date: "2026-09-16",
      trainingType: "Stair Climbing",
      trainingTimestamps: "only-one-line",
    })).toBe(false);
  });

  it("does not use a later latest-3 payload to decide an older day", () => {
    // A latest-N list without an event for the synced date cannot confirm zero.
    expect(resolveWorkoutFeedObserved({
      date: "2026-09-10",
      workouts: [
        { type: "Stair Climbing", startAt: "2026-09-20T08:00:00.000Z", endAt: "2026-09-20T09:00:00.000Z" },
        { type: "Traditional Strength Training", startAt: "2026-09-19T08:00:00.000Z", endAt: "2026-09-19T09:00:00.000Z" },
        { type: "Stair Climbing", startAt: "2026-09-18T08:00:00.000Z", endAt: "2026-09-18T09:00:00.000Z" },
      ],
    })).toBe(false);
    expect(resolveWorkoutFeedObserved({ date: "2026-09-10" })).toBe(false);
  });

  it("keeps structured array coverage when one event is malformed", () => {
    expect(resolveWorkoutFeedObserved({
      date: "2026-09-16",
      workouts: [
        { type: "Stair Climbing", startAt: "not-a-date", endAt: "also-bad" },
        {
          type: "STAIR CLIMBING",
          startAt: "2026-09-16T08:00:00.000Z",
          endAt: "2026-09-16T09:00:00.000Z",
          durationMinutes: 60,
        },
      ],
    })).toBe(true);
  });
});
