import { describe, expect, it } from "vitest";
import {
  STAIR_CLIMBING_TYPE,
  TRADITIONAL_STRENGTH_TRAINING_TYPE,
  expandTrainingWorkoutFields,
  mergeExpandedTrainingWorkouts,
  splitPositionalLines,
} from "@/modules/health/expand-training-workouts";
import { HealthSyncRequestSchema, preprocessHealthDay } from "@/modules/health/health.schema";

const DAY = "2026-08-22";

describe("splitPositionalLines", () => {
  it("splits LF and CRLF while preserving empty middle slots", () => {
    expect(splitPositionalLines("a\nb\nc")).toEqual(["a", "b", "c"]);
    expect(splitPositionalLines("a\r\n\r\nc")).toEqual(["a", "", "c"]);
    expect(splitPositionalLines("154\n\n562")).toEqual(["154", "", "562"]);
  });

  it.each(["", " ", "\t\n"])("treats blank string %j as empty list", (value) => {
    expect(splitPositionalLines(value)).toEqual([]);
  });

  it.each([null, undefined, 12, true, ["a"]])("returns null for non-string %j", (value) => {
    expect(splitPositionalLines(value)).toBeNull();
  });
});

describe("expandTrainingWorkoutFields", () => {
  it("pairs first-N timestamps as starts and second-N as ends for one workout", () => {
    const result = expandTrainingWorkoutFields({
      trainingType: TRADITIONAL_STRENGTH_TRAINING_TYPE,
      trainingActiveKcal: "562",
      trainingTimestamps: [
        "2026-08-22T17:00:00+02:00",
        "2026-08-22T18:15:00+02:00",
      ].join("\n"),
      dayDate: DAY,
      timezone: "Europe/Bratislava",
    });
    expect(result.diagnostics).toEqual({
      acceptedCount: 1,
      rejectedCount: 0,
      reasons: [],
    });
    expect(result.workouts).toHaveLength(1);
    expect(result.workouts[0]).toMatchObject({
      type: TRADITIONAL_STRENGTH_TRAINING_TYPE,
      durationMinutes: 75,
      activeEnergyKcal: 562,
      startAt: "2026-08-22T15:00:00.000Z",
      endAt: "2026-08-22T16:15:00.000Z",
    });
  });

  it("expands the realistic Garmin three-workout day with blank middle kcal", () => {
    const result = expandTrainingWorkoutFields({
      trainingType: [
        STAIR_CLIMBING_TYPE,
        STAIR_CLIMBING_TYPE,
        TRADITIONAL_STRENGTH_TRAINING_TYPE,
      ].join("\n"),
      trainingActiveKcal: "154\n18\n562",
      trainingTimestamps: [
        "2026-08-22T07:00:00+02:00",
        "2026-08-22T12:30:00+02:00",
        "2026-08-22T17:00:00+02:00",
        "2026-08-22T07:12:00+02:00",
        "2026-08-22T12:35:00+02:00",
        "2026-08-22T18:15:00+02:00",
      ].join("\n"),
      dayDate: DAY,
      timezone: "Europe/Bratislava",
    });
    expect(result.diagnostics.acceptedCount).toBe(3);
    expect(result.workouts.map((workout) => workout.activeEnergyKcal)).toEqual([154, 18, 562]);
    expect(result.workouts.map((workout) => workout.type)).toEqual([
      STAIR_CLIMBING_TYPE,
      STAIR_CLIMBING_TYPE,
      TRADITIONAL_STRENGTH_TRAINING_TYPE,
    ]);
  });

  it("preserves empty middle type/kcal slots without collapsing alignment", () => {
    const result = expandTrainingWorkoutFields({
      trainingType: `${STAIR_CLIMBING_TYPE}\n\n${TRADITIONAL_STRENGTH_TRAINING_TYPE}`,
      trainingActiveKcal: "154\n\n562",
      trainingTimestamps: [
        "2026-08-22T07:00:00Z",
        "2026-08-22T17:00:00Z",
        "2026-08-22T18:00:00Z",
        "2026-08-22T07:10:00Z",
        "2026-08-22T17:05:00Z",
        "2026-08-22T18:30:00Z",
      ].join("\n"),
      dayDate: DAY,
      timezone: "Europe/Bratislava",
    });
    expect(result.diagnostics.acceptedCount).toBe(2);
    expect(result.diagnostics.rejectedCount).toBe(1);
    expect(result.diagnostics.reasons).toContain("workout-1:missing-type");
    expect(result.workouts).toHaveLength(2);
    expect(result.workouts[0]?.activeEnergyKcal).toBe(154);
    expect(result.workouts[1]?.activeEnergyKcal).toBe(562);
  });

  it("accepts two workouts with CRLF separators", () => {
    const result = expandTrainingWorkoutFields({
      trainingType: `${STAIR_CLIMBING_TYPE}\r\n${TRADITIONAL_STRENGTH_TRAINING_TYPE}`,
      trainingActiveKcal: "154\r\n562",
      trainingTimestamps: [
        "2026-08-22T07:00:00+02:00",
        "2026-08-22T17:00:00+02:00",
        "2026-08-22T07:10:00+02:00",
        "2026-08-22T18:00:00+02:00",
      ].join("\r\n"),
      dayDate: DAY,
      timezone: "Europe/Bratislava",
    });
    expect(result.workouts).toHaveLength(2);
    expect(result.diagnostics.rejectedCount).toBe(0);
  });

  it("rejects mismatched timestamp counts without accepting partial siblings", () => {
    const result = expandTrainingWorkoutFields({
      trainingType: `${STAIR_CLIMBING_TYPE}\n${STAIR_CLIMBING_TYPE}`,
      trainingActiveKcal: "154\n18",
      trainingTimestamps: [
        "2026-08-22T07:00:00Z",
        "2026-08-22T07:10:00Z",
        "2026-08-22T07:12:00Z",
      ].join("\n"),
      dayDate: DAY,
    });
    expect(result.workouts).toEqual([]);
    expect(result.diagnostics.reasons).toContain("mismatched-timestamp-count");
    expect(result.diagnostics.rejectedCount).toBe(2);
  });

  it("rejects mismatched active-kcal counts", () => {
    const result = expandTrainingWorkoutFields({
      trainingType: `${STAIR_CLIMBING_TYPE}\n${TRADITIONAL_STRENGTH_TRAINING_TYPE}`,
      trainingActiveKcal: "154",
      trainingTimestamps: [
        "2026-08-22T07:00:00Z",
        "2026-08-22T17:00:00Z",
        "2026-08-22T07:10:00Z",
        "2026-08-22T18:00:00Z",
      ].join("\n"),
      dayDate: DAY,
    });
    expect(result.workouts).toEqual([]);
    expect(result.diagnostics.reasons).toContain("mismatched-active-kcal-count");
  });

  it("skips a malformed timestamp and keeps sibling workouts", () => {
    const result = expandTrainingWorkoutFields({
      trainingType: `${STAIR_CLIMBING_TYPE}\n${TRADITIONAL_STRENGTH_TRAINING_TYPE}`,
      trainingActiveKcal: "154\n562",
      trainingTimestamps: [
        "not-a-timestamp",
        "2026-08-22T17:00:00Z",
        "2026-08-22T07:10:00Z",
        "2026-08-22T18:00:00Z",
      ].join("\n"),
      dayDate: DAY,
    });
    expect(result.diagnostics.acceptedCount).toBe(1);
    expect(result.diagnostics.rejectedCount).toBe(1);
    expect(result.diagnostics.reasons).toContain("workout-0:malformed-start");
    expect(result.workouts).toHaveLength(1);
    expect(result.workouts[0]?.activeEnergyKcal).toBe(562);
  });

  it("rejects endAt earlier than or equal to startAt", () => {
    const earlier = expandTrainingWorkoutFields({
      trainingType: STAIR_CLIMBING_TYPE,
      trainingActiveKcal: "154",
      trainingTimestamps: "2026-08-22T08:00:00Z\n2026-08-22T07:00:00Z",
      dayDate: DAY,
    });
    const equal = expandTrainingWorkoutFields({
      trainingType: STAIR_CLIMBING_TYPE,
      trainingActiveKcal: "154",
      trainingTimestamps: "2026-08-22T08:00:00Z\n2026-08-22T08:00:00Z",
      dayDate: DAY,
    });
    expect(earlier.diagnostics.reasons).toContain("workout-0:non-positive-duration");
    expect(equal.diagnostics.reasons).toContain("workout-0:non-positive-duration");
    expect(earlier.workouts).toEqual([]);
    expect(equal.workouts).toEqual([]);
  });

  it("rejects workouts whose local start falls on another calendar day", () => {
    const result = expandTrainingWorkoutFields({
      trainingType: STAIR_CLIMBING_TYPE,
      trainingActiveKcal: "154",
      trainingTimestamps: "2026-08-21T23:30:00+02:00\n2026-08-22T00:05:00+02:00",
      dayDate: DAY,
      timezone: "Europe/Bratislava",
    });
    expect(result.diagnostics.reasons).toContain("workout-0:other-calendar-day");
    expect(result.workouts).toEqual([]);
  });

  it("allows null active kcal when the kcal field is omitted entirely", () => {
    const result = expandTrainingWorkoutFields({
      trainingType: TRADITIONAL_STRENGTH_TRAINING_TYPE,
      trainingActiveKcal: null,
      trainingTimestamps: "2026-08-22T17:00:00Z\n2026-08-22T18:00:00Z",
      dayDate: DAY,
    });
    expect(result.workouts[0]?.activeEnergyKcal).toBeNull();
    expect(result.diagnostics.acceptedCount).toBe(1);
  });
});

describe("mergeExpandedTrainingWorkouts", () => {
  it("appends expanded workouts without destroying structured siblings", () => {
    const existing = {
      type: "Running",
      startAt: "2026-08-22T06:00:00.000Z",
      endAt: "2026-08-22T06:30:00.000Z",
      durationMinutes: 30,
      activeEnergyKcal: 220,
      externalId: "structured-1",
    };
    const merged = mergeExpandedTrainingWorkouts({
      date: DAY,
      trainingType: STAIR_CLIMBING_TYPE,
      trainingActiveKcal: "154",
      trainingTimestamps: "2026-08-22T07:00:00Z\n2026-08-22T07:10:00Z",
      workouts: [existing],
      walkingDistanceKm: 5.1,
    }, "Europe/Bratislava");
    expect(merged).not.toHaveProperty("trainingType");
    expect(merged).not.toHaveProperty("trainingActiveKcal");
    expect(merged).not.toHaveProperty("trainingTimestamps");
    expect(merged.walkingDistanceKm).toBe(5.1);
    expect(merged.workouts).toHaveLength(2);
    expect((merged.workouts as unknown[])[0]).toEqual(existing);
    expect((merged.workouts as Array<{ activeEnergyKcal: number }>)[1]?.activeEnergyKcal).toBe(154);
  });
});

describe("HealthSyncRequestSchema training expansion", () => {
  it("expands positional training fields through preprocessHealthDay", () => {
    const day = preprocessHealthDay({
      date: DAY,
      trainingType: `${STAIR_CLIMBING_TYPE}\n${TRADITIONAL_STRENGTH_TRAINING_TYPE}`,
      trainingActiveKcal: "154\n562",
      trainingTimestamps: [
        "2026-08-22T07:00:00+02:00",
        "2026-08-22T17:00:00+02:00",
        "2026-08-22T07:10:00+02:00",
        "2026-08-22T18:00:00+02:00",
      ].join("\n"),
    }, "Europe/Bratislava");
    expect(day).toMatchObject({
      date: DAY,
      workouts: [
        { type: STAIR_CLIMBING_TYPE, activeEnergyKcal: 154 },
        { type: TRADITIONAL_STRENGTH_TRAINING_TYPE, activeEnergyKcal: 562 },
      ],
    });
  });

  it("accepts the expanded Garmin day via HealthSyncRequestSchema", () => {
    const result = HealthSyncRequestSchema.safeParse({
      timezone: "Europe/Bratislava",
      days: [{
        date: DAY,
        trainingType: [
          STAIR_CLIMBING_TYPE,
          STAIR_CLIMBING_TYPE,
          TRADITIONAL_STRENGTH_TRAINING_TYPE,
        ].join("\n"),
        trainingActiveKcal: "154\n18\n562",
        trainingTimestamps: [
          "2026-08-22T07:00:00+02:00",
          "2026-08-22T12:30:00+02:00",
          "2026-08-22T17:00:00+02:00",
          "2026-08-22T07:12:00+02:00",
          "2026-08-22T12:35:00+02:00",
          "2026-08-22T18:15:00+02:00",
        ].join("\n"),
      }],
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.days[0]?.workouts).toHaveLength(3);
    expect(result.data.days[0]?.workouts?.map((workout) => workout.activeEnergyKcal))
      .toEqual([154, 18, 562]);
  });
});
