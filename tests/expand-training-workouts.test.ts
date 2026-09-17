import { describe, expect, it } from "vitest";
import {
  STAIR_CLIMBING_TYPE,
  TRADITIONAL_STRENGTH_TRAINING_TYPE,
  expandTrainingWorkoutFields,
  extractTrainingTimestampLines,
  mergeExpandedTrainingWorkouts,
  splitPositionalLines,
  splitTrainingTypeLines,
} from "@/modules/health/expand-training-workouts";
import { HealthSyncRequestSchema, preprocessHealthDay } from "@/modules/health/health.schema";

const DAY = "2026-08-22";
const SEP16 = "2026-09-16";

const SEP16_GLUED_TIMESTAMPS =
  "16. 9. 2026, 12:40\n16. 9. 2026, 12:34\n16. 9. 2026, 10:4416. 9. 2026, 12:52\n16. 9. 2026, 12:36\n16. 9. 2026, 11:46";

describe("splitPositionalLines", () => {
  it("splits LF and CRLF while preserving empty middle slots", () => {
    expect(splitPositionalLines("a\nb\nc")).toEqual(["a", "b", "c"]);
    expect(splitPositionalLines("a\r\n\r\nc")).toEqual(["a", "", "c"]);
    expect(splitPositionalLines("154\n\n562")).toEqual(["154", "", "562"]);
  });

  it("splits literal backslash-N / backslash-n sequences from Shortcuts text", () => {
    expect(splitPositionalLines("Stair Climbing\\Nstair Climbing\\Ntraditional Strength Training")).toEqual([
      "Stair Climbing",
      "stair Climbing",
      "traditional Strength Training",
    ]);
    expect(splitPositionalLines("154\\n18\\n562")).toEqual(["154", "18", "562"]);
  });

  it.each(["", " ", "\t\n"])("treats blank string %j as empty list", (value) => {
    expect(splitPositionalLines(value)).toEqual([]);
  });

  it.each([null, undefined, 12, true, ["a"]])("returns null for non-string %j", (value) => {
    expect(splitPositionalLines(value)).toBeNull();
  });
});

describe("extractTrainingTimestampLines", () => {
  it("extracts six timestamps from the Sep 16 glued payload", () => {
    expect(extractTrainingTimestampLines(SEP16_GLUED_TIMESTAMPS)).toEqual([
      "16. 9. 2026, 12:40",
      "16. 9. 2026, 12:34",
      "16. 9. 2026, 10:44",
      "16. 9. 2026, 12:52",
      "16. 9. 2026, 12:36",
      "16. 9. 2026, 11:46",
    ]);
  });

  it("still extracts newline-separated Shortcut dates", () => {
    expect(extractTrainingTimestampLines(
      "16. 9. 2026, 12:40\n16. 9. 2026, 12:52",
    )).toEqual(["16. 9. 2026, 12:40", "16. 9. 2026, 12:52"]);
  });

  it.each(["", " ", "\t"])("treats blank string %j as empty list", (value) => {
    expect(extractTrainingTimestampLines(value)).toEqual([]);
  });

  it.each([null, undefined, 12])("returns null for non-string %j", (value) => {
    expect(extractTrainingTimestampLines(value)).toBeNull();
  });
});

describe("splitTrainingTypeLines", () => {
  it("splits glued HealthKit names when expected count comes from kcal", () => {
    expect(splitTrainingTypeLines(
      "Stair ClimbingStair ClimbingTraditional Strength Training",
      3,
    )).toEqual([
      STAIR_CLIMBING_TYPE,
      STAIR_CLIMBING_TYPE,
      TRADITIONAL_STRENGTH_TRAINING_TYPE,
    ]);
  });

  it("splits Title-Case junctions like ClimbingTraditional", () => {
    expect(splitTrainingTypeLines(
      `${STAIR_CLIMBING_TYPE}${TRADITIONAL_STRENGTH_TRAINING_TYPE}`,
      2,
    )).toEqual([STAIR_CLIMBING_TYPE, TRADITIONAL_STRENGTH_TRAINING_TYPE]);
  });

  it("keeps newline splits when counts already match", () => {
    expect(splitTrainingTypeLines(
      `${STAIR_CLIMBING_TYPE}\n${TRADITIONAL_STRENGTH_TRAINING_TYPE}`,
      2,
    )).toEqual([STAIR_CLIMBING_TYPE, TRADITIONAL_STRENGTH_TRAINING_TYPE]);
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
    expect(result.diagnostics.reasons.some((reason) => reason.startsWith("mismatched-timestamp-count"))).toBe(true);
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
    expect(result.diagnostics.reasons.some((reason) => reason.startsWith("mismatched-active-kcal-count"))).toBe(true);
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

  it("expands the exact Sep 16 Shortcut payload with glued timestamps", () => {
    const result = expandTrainingWorkoutFields({
      trainingType: [
        STAIR_CLIMBING_TYPE,
        STAIR_CLIMBING_TYPE,
        TRADITIONAL_STRENGTH_TRAINING_TYPE,
      ].join("\n"),
      trainingActiveKcal: "154\n18\n562",
      trainingTimestamps: SEP16_GLUED_TIMESTAMPS,
      dayDate: SEP16,
      timezone: "Europe/Berlin",
    });
    expect(result.diagnostics.acceptedCount).toBe(3);
    expect(result.workouts).toEqual([
      expect.objectContaining({
        type: STAIR_CLIMBING_TYPE,
        activeEnergyKcal: 154,
        durationMinutes: 12,
        startAt: "2026-09-16T12:40:00.000Z",
        endAt: "2026-09-16T12:52:00.000Z",
      }),
      expect.objectContaining({
        type: STAIR_CLIMBING_TYPE,
        activeEnergyKcal: 18,
        durationMinutes: 2,
        startAt: "2026-09-16T12:34:00.000Z",
        endAt: "2026-09-16T12:36:00.000Z",
      }),
      expect.objectContaining({
        type: TRADITIONAL_STRENGTH_TRAINING_TYPE,
        activeEnergyKcal: 562,
        durationMinutes: 62,
        startAt: "2026-09-16T10:44:00.000Z",
        endAt: "2026-09-16T11:46:00.000Z",
      }),
    ]);
  });

  it("recovers Sep 17 glued boundary with Unicode spaces in strengthTrainingMinutes", () => {
    // Production failure: start-list end glued to end-list start as `12:3417. 9. 2026`
    // with non-breaking spaces around date components.
    const nbsp = "\u00A0";
    const timestamps = [
      `17.${nbsp}9.${nbsp}2026,${nbsp}10:00`,
      `17.${nbsp}9.${nbsp}2026,${nbsp}12:34`,
      `17.${nbsp}9.${nbsp}2026,${nbsp}13:00`,
      `17.${nbsp}9.${nbsp}2026,${nbsp}10:4517.${nbsp}9.${nbsp}2026,${nbsp}12:36`,
      `17.${nbsp}9.${nbsp}2026,${nbsp}14:00`,
    ].join("\n");

    expect(extractTrainingTimestampLines(timestamps)).toEqual([
      "17. 9. 2026, 10:00",
      "17. 9. 2026, 12:34",
      "17. 9. 2026, 13:00",
      "17. 9. 2026, 10:45",
      "17. 9. 2026, 12:36",
      "17. 9. 2026, 14:00",
    ]);

    const result = expandTrainingWorkoutFields({
      trainingType: [
        STAIR_CLIMBING_TYPE,
        STAIR_CLIMBING_TYPE,
        TRADITIONAL_STRENGTH_TRAINING_TYPE,
      ].join("\n"),
      trainingActiveKcal: "154\n18\n724",
      trainingTimestamps: timestamps,
      dayDate: "2026-09-17",
      timezone: "Europe/Berlin",
    });
    expect(result.diagnostics.acceptedCount).toBe(3);
    expect(result.workouts.map((workout) => workout.activeEnergyKcal)).toEqual([154, 18, 724]);
    expect(result.workouts.map((workout) => workout.type)).toEqual([
      STAIR_CLIMBING_TYPE,
      STAIR_CLIMBING_TYPE,
      TRADITIONAL_STRENGTH_TRAINING_TYPE,
    ]);
  });

  it("includes counts in mismatch diagnostics instead of a bare zero-workout outcome", () => {
    const result = expandTrainingWorkoutFields({
      trainingType: `${STAIR_CLIMBING_TYPE}\n${STAIR_CLIMBING_TYPE}`,
      trainingActiveKcal: "154\n18",
      trainingTimestamps: "17. 9. 2026, 12:34\n17. 9. 2026, 12:36",
      dayDate: "2026-09-17",
    });
    expect(result.workouts).toEqual([]);
    expect(result.diagnostics.reasons[0]).toMatch(
      /^mismatched-timestamp-count:types=2,kcal=2,timestamps=2,expected=4$/,
    );
  });

  it("returns no workouts when training fields are absent or empty (N optional)", () => {
    expect(expandTrainingWorkoutFields({
      trainingType: null,
      trainingActiveKcal: null,
      trainingTimestamps: null,
      dayDate: SEP16,
    }).workouts).toEqual([]);

    expect(expandTrainingWorkoutFields({
      trainingType: "",
      trainingActiveKcal: "",
      trainingTimestamps: "",
      dayDate: SEP16,
    }).workouts).toEqual([]);

    expect(expandTrainingWorkoutFields({
      trainingType: undefined,
      trainingActiveKcal: undefined,
      trainingTimestamps: undefined,
      dayDate: DAY,
    }).workouts).toEqual([]);
  });

  it("recovers glued trainingType using kcal count as N", () => {
    const result = expandTrainingWorkoutFields({
      trainingType: "Stair ClimbingStair ClimbingTraditional Strength Training",
      trainingActiveKcal: "154\n18\n562",
      trainingTimestamps: SEP16_GLUED_TIMESTAMPS,
      dayDate: SEP16,
      timezone: "Europe/Berlin",
    });
    expect(result.diagnostics.acceptedCount).toBe(3);
    expect(result.workouts.map((workout) => workout.type)).toEqual([
      STAIR_CLIMBING_TYPE,
      STAIR_CLIMBING_TYPE,
      TRADITIONAL_STRENGTH_TRAINING_TYPE,
    ]);
    expect(result.workouts.map((workout) => workout.activeEnergyKcal)).toEqual([154, 18, 562]);
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

  it("expands Sep 17 glued dates stored in strengthTrainingMinutes", () => {
    const result = HealthSyncRequestSchema.safeParse({
      timezone: "Europe/Berlin",
      days: [{
        date: "2026-09-17",
        trainingType: [
          STAIR_CLIMBING_TYPE,
          STAIR_CLIMBING_TYPE,
          TRADITIONAL_STRENGTH_TRAINING_TYPE,
        ].join("\n"),
        trainingActiveKcal: "154\n18\n724",
        strengthTrainingMinutes: [
          "17. 9. 2026, 10:00",
          "17. 9. 2026, 12:34",
          "17. 9. 2026, 13:00",
          "17. 9. 2026, 10:4517. 9. 2026, 12:36",
          "17. 9. 2026, 14:00",
        ].join("\n"),
        sleepSegments: {
          startTimestamps: ["2026-09-16T22:41:00+02:00"],
          endTimestamps: ["2026-09-16T23:10:00+02:00"],
          "    states": ["Повільний"],
        },
      }],
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.days[0]?.workouts).toHaveLength(3);
    expect(result.data.days[0]?.workouts?.map((workout) => workout.activeEnergyKcal))
      .toEqual([154, 18, 724]);
    expect(result.data.days[0]?.sleepSegments).toHaveLength(1);
  });
});
