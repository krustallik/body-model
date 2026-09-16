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

  it("accepts production Shortcut timestamps in Strengthtrainingminutes with Trainingtype feed", () => {
    // BodyCast Sync puts latest-N start/end lines into Strengthtrainingminutes
    // (legacy key), not trainingTimestamps — regression from e422bc8 expansion.
    const result = parseShortcutSync({
      days: [{
        Fatg: 62,
        Carbsg: 253,
        Averagewalkingspeedkmh: "5",
        Calorieskcal: 2411,
        Trainingtype: [
          STAIR_CLIMBING_TYPE,
          STAIR_CLIMBING_TYPE,
          TRADITIONAL_STRENGTH_TRAINING_TYPE,
        ].join("\n"),
        Proteing: 203,
        Walkingdistancekm: "0.5814353488389005",
        Bodyfatpercent: "27.6",
        Date: "2026-09-16",
        Trainingactivekcal: "154\n18\n562",
        Strengthtrainingminutes: [
          "16. 9. 2026, 12:40",
          "16. 9. 2026, 12:34",
          "16. 9. 2026, 10:44",
          "16. 9. 2026, 12:52",
          "16. 9. 2026, 12:36",
          "16. 9. 2026, 11:46",
        ].join("\n"),
        Weightkg: "89.80000305175781",
        Steps: 4449,
      }],
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      expect(result.error.issues).toEqual([]);
      return;
    }

    const day = result.data.days[0];
    expect(day?.date).toBe("2026-09-16");
    expect(day).not.toHaveProperty("strengthTrainingMinutes");
    const workouts = day?.workouts ?? [];
    expect(workouts).toHaveLength(3);
    expect(workouts.map((workout) => workout.type)).toEqual([
      STAIR_CLIMBING_TYPE,
      STAIR_CLIMBING_TYPE,
      TRADITIONAL_STRENGTH_TRAINING_TYPE,
    ]);
    expect(workouts.map((workout) => workout.activeEnergyKcal)).toEqual([154, 18, 562]);
    expect(workouts.map((workout) => workout.durationMinutes)).toEqual([12, 2, 62]);
  });

  it("accepts the exact Sep 16 rawBody with glued 10:44 timestamp and WalkingDistanceKm", () => {
    const result = parseShortcutSync({
      days: [{
        fatG: 57,
        carbsG: 260,
        averageWalkingSpeedKmh: "5",
        caloriesKcal: 2393,
        trainingType: "Stair Climbing\nStair Climbing\nTraditional Strength Training",
        proteinG: 202,
        WalkingDistanceKm: "3,713",
        bodyFatPercent: "27.6",
        date: "2026-09-16",
        trainingActiveKcal: "154\n18\n562",
        strengthTrainingMinutes:
          "16. 9. 2026, 12:40\n16. 9. 2026, 12:34\n16. 9. 2026, 10:4416. 9. 2026, 12:52\n16. 9. 2026, 12:36\n16. 9. 2026, 11:46",
        weightKg: "89.80000305175781",
        steps: 4449,
      }],
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      expect(result.error.issues).toEqual([]);
      return;
    }

    const day = result.data.days[0];
    expect(day?.date).toBe("2026-09-16");
    expect(day?.walkingDistanceKm).toBe(3.713);
    expect(day).not.toHaveProperty("strengthTrainingMinutes");
    const workouts = day?.workouts ?? [];
    expect(workouts).toHaveLength(3);
    expect(workouts).toEqual([
      expect.objectContaining({
        type: STAIR_CLIMBING_TYPE,
        activeEnergyKcal: 154,
        durationMinutes: 12,
      }),
      expect.objectContaining({
        type: STAIR_CLIMBING_TYPE,
        activeEnergyKcal: 18,
        durationMinutes: 2,
      }),
      expect.objectContaining({
        type: TRADITIONAL_STRENGTH_TRAINING_TYPE,
        activeEnergyKcal: 562,
        durationMinutes: 62,
      }),
    ]);
  });

  it("accepts the exact Shortcuts screenshot payload with literal \\\\N separators and string Steps", () => {
    const result = parseShortcutSync({
      days: [{
        Fatg: 62,
        Carbsg: 253,
        Averagewalkingspeedkmh: "5",
        Calorieskcal: 2411,
        Trainingtype: "Stair Climbing\\Nstair Climbing\\Ntraditional Strength Training",
        Proteing: 203,
        Walkingdistancekm: "0.5814353488389005",
        Bodyfatpercent: "27.6",
        Date: "2026-09-16",
        Trainingactivekcal: "154\\N18\\N562",
        Strengthtrainingminutes:
          "16. 9. 2026, 12:40\\N16. 9. 2026, 12:34\\N16. 9. 2026, 10:44\\N16. 9. 2026, 12:52\\N16. 9. 2026, 12:36\\N16. 9. 2026, 11:46",
        Weightkg: "89.80000305175781",
        Steps: "4449",
      }],
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      expect(result.error.issues).toEqual([]);
      return;
    }
    expect(result.data.days[0]?.date).toBe("2026-09-16");
    expect(result.data.days[0]?.steps).toBe(4449);
    expect(result.data.days[0]?.workouts).toHaveLength(3);
  });

  it("still validates when Date is only remapped inside schema preprocess", () => {
    // Simulates a path where route-level normalize was skipped but Apple `Date` remains.
    const result = HealthSyncRequestSchema.safeParse({
      days: [{
        Date: "2026-09-16",
        Steps: 4449,
        Trainingtype: "Traditional Strength Training",
        Trainingactivekcal: "100",
        Strengthtrainingminutes: "16. 9. 2026, 10:00\\N16. 9. 2026, 11:00",
      }],
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.days[0]?.date).toBe("2026-09-16");
    expect(result.data.days[0]?.steps).toBe(4449);
  });

  it("keeps legacy two-date strengthTrainingMinutes when training feed keys are absent", () => {
    const result = parseShortcutSync({
      Days: [{
        Date: "2026-09-16",
        Strengthtrainingminutes: "16. 9. 2026, 12:40 16. 9. 2026, 13:55",
      }],
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.days[0]?.strengthTrainingMinutes).toBe(75);
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
