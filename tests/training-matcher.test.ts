import { describe, expect, it } from "vitest";
import { matchDiaryToWorkouts } from "@/modules/training/training.matcher";

const session = {
  startAt: new Date("2026-09-17T16:02:00Z"),
  endAt: new Date("2026-09-17T17:18:00Z"),
};

function strength(id: number, startAt: string, endAt: string, alreadyMatched = false) {
  return {
    id,
    type: "Traditional Strength Training",
    startAt: new Date(startAt),
    endAt: new Date(endAt),
    alreadyMatched,
  };
}

describe("matchDiaryToWorkouts", () => {
  it("case 1: unique strongly overlapping strength workout → MATCH", () => {
    const result = matchDiaryToWorkouts(session, [
      strength(1, "2026-09-17T16:04:00Z", "2026-09-17T17:17:00Z"),
    ]);
    expect(result.kind).toBe("MATCH");
    expect(result.workoutId).toBe(1);
  });

  it("case 4: two plausible strength workouts → AMBIGUOUS", () => {
    const result = matchDiaryToWorkouts(session, [
      strength(1, "2026-09-17T16:03:00Z", "2026-09-17T17:16:00Z"),
      strength(2, "2026-09-17T16:05:00Z", "2026-09-17T17:15:00Z"),
    ]);
    expect(result.kind).toBe("AMBIGUOUS");
    expect(result.workoutId).toBeNull();
    expect(result.plausible).toHaveLength(2);
  });

  it("case 5: stair/stepper overlapping diary is never a candidate", () => {
    const result = matchDiaryToWorkouts(session, [
      {
        id: 9,
        type: "Stair Climbing",
        startAt: new Date("2026-09-17T16:02:00Z"),
        endAt: new Date("2026-09-17T17:18:00Z"),
      },
    ]);
    expect(result.kind).toBe("NO_MATCH");
    expect(result.plausible).toHaveLength(0);
  });

  it("case 7 conceptually: already-matched workout is skipped", () => {
    const result = matchDiaryToWorkouts(session, [
      strength(1, "2026-09-17T16:04:00Z", "2026-09-17T17:17:00Z", true),
    ]);
    expect(result.kind).toBe("NO_MATCH");
  });

  it("case 9: no candidate → NO_MATCH (service keeps PENDING)", () => {
    const result = matchDiaryToWorkouts(session, []);
    expect(result.kind).toBe("NO_MATCH");
  });

  it("ignores non-strength types and does not use kcal", () => {
    const result = matchDiaryToWorkouts(session, [
      {
        id: 3,
        type: "Walking",
        startAt: new Date("2026-09-17T16:02:00Z"),
        endAt: new Date("2026-09-17T17:18:00Z"),
      },
      strength(4, "2026-09-17T12:00:00Z", "2026-09-17T12:40:00Z"),
    ]);
    expect(result.kind).toBe("NO_MATCH");
  });

  it("rejects unique but weak duration compatibility as NO_MATCH", () => {
    const result = matchDiaryToWorkouts(session, [
      // Overlaps but duration relative delta exceeds maxDurationRelativeDelta.
      strength(5, "2026-09-17T16:18:00Z", "2026-09-17T17:05:00Z"),
    ]);
    expect(result.kind).toBe("NO_MATCH");
  });
});
