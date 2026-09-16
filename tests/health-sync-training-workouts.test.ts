import { describe, expect, it } from "vitest";
import {
  STAIR_CLIMBING_TYPE,
  TRADITIONAL_STRENGTH_TRAINING_TYPE,
} from "@/modules/health/expand-training-workouts";
import { filterWorkoutsForSyncedDay } from "@/modules/health/health.repository";
import { HealthSyncRequestSchema } from "@/modules/health/health.schema";
import { normalizeShortcutNumericValues } from "@/modules/health/normalize-shortcut-numeric-values";
import { normalizeShortcutPayload } from "@/modules/health/normalize-shortcut-payload";
import type { WorkoutInput } from "@/modules/health/health.types";

const DAY = "2026-08-22";
const TIMEZONE = "Europe/Bratislava";

function parseShortcutSync(body: unknown) {
  const { payload } = normalizeShortcutPayload(body);
  const numeric = normalizeShortcutNumericValues(payload);
  return HealthSyncRequestSchema.safeParse(numeric);
}

const threeWorkoutTimestamps = [
  "2026-08-22T07:00:00+02:00",
  "2026-08-22T12:30:00+02:00",
  "2026-08-22T17:00:00+02:00",
  "2026-08-22T07:12:00+02:00",
  "2026-08-22T12:35:00+02:00",
  "2026-08-22T18:15:00+02:00",
].join("\n");

const threeWorkoutTypes = [
  STAIR_CLIMBING_TYPE,
  STAIR_CLIMBING_TYPE,
  TRADITIONAL_STRENGTH_TRAINING_TYPE,
].join("\n");

describe("health sync training workout pipeline", () => {
  it("expands case-insensitive Trainingtype/Trainingactivekcal/trainingTimestamps into workouts with activeEnergyKcal", () => {
    const result = parseShortcutSync({
      Timezone: TIMEZONE,
      Days: [{
        Date: DAY,
        Trainingtype: threeWorkoutTypes,
        Trainingactivekcal: "154\n18\n562",
        trainingTimestamps: threeWorkoutTimestamps,
      }],
    });

    expect(result.success).toBe(true);
    if (!result.success) return;

    const workouts = result.data.days[0]?.workouts ?? [];
    expect(workouts).toHaveLength(3);
    expect(workouts.map((workout) => workout.activeEnergyKcal)).toEqual([154, 18, 562]);
    expect(workouts.map((workout) => workout.type)).toEqual([
      STAIR_CLIMBING_TYPE,
      STAIR_CLIMBING_TYPE,
      TRADITIONAL_STRENGTH_TRAINING_TYPE,
    ]);
    expect(result.data.days[0]).not.toHaveProperty("trainingType");
    expect(result.data.days[0]).not.toHaveProperty("trainingActiveKcal");
    expect(result.data.days[0]).not.toHaveProperty("trainingTimestamps");
  });

  it("pairs first-N starts with second-N ends for three workouts (154, 18, 562)", () => {
    const result = parseShortcutSync({
      timezone: TIMEZONE,
      days: [{
        date: DAY,
        trainingType: threeWorkoutTypes,
        trainingActiveKcal: "154\n18\n562",
        trainingTimestamps: threeWorkoutTimestamps,
      }],
    });

    expect(result.success).toBe(true);
    if (!result.success) return;

    const workouts = result.data.days[0]?.workouts ?? [];
    expect(workouts).toEqual([
      expect.objectContaining({
        type: STAIR_CLIMBING_TYPE,
        activeEnergyKcal: 154,
        startAt: "2026-08-22T05:00:00.000Z",
        endAt: "2026-08-22T05:12:00.000Z",
        durationMinutes: 12,
      }),
      expect.objectContaining({
        type: STAIR_CLIMBING_TYPE,
        activeEnergyKcal: 18,
        startAt: "2026-08-22T10:30:00.000Z",
        endAt: "2026-08-22T10:35:00.000Z",
        durationMinutes: 5,
      }),
      expect.objectContaining({
        type: TRADITIONAL_STRENGTH_TRAINING_TYPE,
        activeEnergyKcal: 562,
        startAt: "2026-08-22T15:00:00.000Z",
        endAt: "2026-08-22T16:15:00.000Z",
        durationMinutes: 75,
      }),
    ]);
  });

  it("preserves blank middle kcal positional alignment so type2 gets null kcal", () => {
    const result = parseShortcutSync({
      timezone: TIMEZONE,
      days: [{
        date: DAY,
        trainingType: threeWorkoutTypes,
        trainingActiveKcal: "154\n\n562",
        trainingTimestamps: threeWorkoutTimestamps,
      }],
    });

    expect(result.success).toBe(true);
    if (!result.success) return;

    const workouts = result.data.days[0]?.workouts ?? [];
    expect(workouts).toHaveLength(3);
    expect(workouts.map((workout) => workout.type)).toEqual([
      STAIR_CLIMBING_TYPE,
      STAIR_CLIMBING_TYPE,
      TRADITIONAL_STRENGTH_TRAINING_TYPE,
    ]);
    expect(workouts.map((workout) => workout.activeEnergyKcal)).toEqual([154, null, 562]);
  });

  it("keeps the day valid when one workout is malformed and siblings remain", () => {
    const result = parseShortcutSync({
      timezone: TIMEZONE,
      days: [{
        date: DAY,
        trainingType: `${STAIR_CLIMBING_TYPE}\n${TRADITIONAL_STRENGTH_TRAINING_TYPE}`,
        trainingActiveKcal: "154\n562",
        trainingTimestamps: [
          "not-a-timestamp",
          "2026-08-22T17:00:00+02:00",
          "2026-08-22T07:10:00+02:00",
          "2026-08-22T18:00:00+02:00",
        ].join("\n"),
      }],
    });

    expect(result.success).toBe(true);
    if (!result.success) return;

    const workouts = result.data.days[0]?.workouts ?? [];
    expect(workouts).toHaveLength(1);
    expect(workouts[0]).toMatchObject({
      type: TRADITIONAL_STRENGTH_TRAINING_TYPE,
      activeEnergyKcal: 562,
    });
  });

  it("still accepts legacy strengthTrainingMinutes numeric values", () => {
    const result = parseShortcutSync({
      timezone: TIMEZONE,
      Days: [{
        Date: DAY,
        Strengthtrainingminutes: "65,5",
      }],
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.days[0]?.strengthTrainingMinutes).toBe(65.5);
    expect(result.data.days[0]?.workouts ?? []).toEqual([]);
  });

  it("validates a structured workouts array with activeEnergyKcal", () => {
    const result = parseShortcutSync({
      timezone: TIMEZONE,
      days: [{
        date: DAY,
        workouts: [{
          externalId: "structured-1",
          type: TRADITIONAL_STRENGTH_TRAINING_TYPE,
          startAt: "2026-08-22T17:00:00+02:00",
          endAt: "2026-08-22T18:15:00+02:00",
          durationMinutes: 75,
          activeEnergyKcal: 562,
        }],
      }],
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.days[0]?.workouts).toEqual([
      expect.objectContaining({
        externalId: "structured-1",
        type: TRADITIONAL_STRENGTH_TRAINING_TYPE,
        activeEnergyKcal: 562,
        durationMinutes: 75,
      }),
    ]);
  });
});

describe("filterWorkoutsForSyncedDay", () => {
  const sameDay: WorkoutInput = {
    type: STAIR_CLIMBING_TYPE,
    startAt: "2026-08-22T07:00:00+02:00",
    endAt: "2026-08-22T07:12:00+02:00",
    durationMinutes: 12,
    activeEnergyKcal: 154,
  };

  const otherDay: WorkoutInput = {
    type: TRADITIONAL_STRENGTH_TRAINING_TYPE,
    startAt: "2026-08-21T23:30:00+02:00",
    endAt: "2026-08-22T00:30:00+02:00",
    durationMinutes: 60,
    activeEnergyKcal: 300,
  };

  it("drops workouts whose start falls on another calendar day", () => {
    expect(filterWorkoutsForSyncedDay([sameDay, otherDay], DAY, TIMEZONE)).toEqual([sameDay]);
  });

  it("keeps overnight workouts that start on the synced local day", () => {
    const overnight: WorkoutInput = {
      type: "Running",
      startAt: "2026-08-22T23:30:00+02:00",
      endAt: "2026-08-23T00:15:00+02:00",
      durationMinutes: 45,
      activeEnergyKcal: 400,
    };
    expect(filterWorkoutsForSyncedDay([overnight], DAY, TIMEZONE)).toEqual([overnight]);
  });
});
