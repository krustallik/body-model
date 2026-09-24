import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST } from "@/app/api/v1/health/sync/route";
import { ModelEpisodeRepository } from "@/modules/model-episodes/model-episode.repository";
import { buildSimulationDays } from "@/modules/model-episodes/simulation-input-builder";
import {
  CURRENT_MODEL_VERSION,
  LEGACY_PHYSIOLOGY_V5,
} from "@/modules/model-episodes/model-version";
import {
  STAIR_CLIMBING_TYPE,
  TRADITIONAL_STRENGTH_TRAINING_TYPE,
} from "@/modules/health/expand-training-workouts";
import { workoutSourceIdentity } from "@/modules/health/workout-source-identity";
import { resolveExplicitWorkoutActivityKcal } from "@/model/activity/workout-energy";
import { deleteDailyHealthRows } from "../helpers/delete-daily-health";

const prisma = new PrismaClient();
const apiKey = process.env.IOS_SHORTCUT_API_KEY ?? "integration-test-secret";
const date = "2042-06-15";
const stepperV7Date = "2042-06-16";
const crossMidnightStartDate = "2042-06-17";
const crossMidnightEndDate = "2042-06-18";
const timezone = "Europe/Bratislava";

function syncRequest(body: unknown): Request {
  return new Request("http://localhost/api/v1/health/sync", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey },
    body: JSON.stringify(body),
  });
}

async function clean(): Promise<void> {
  await prisma.healthSyncSnapshot.deleteMany({ where: { date } });
  await prisma.workInterval.deleteMany({ where: { date } });
  await deleteDailyHealthRows(prisma, date);
}

async function cleanStepperV7(): Promise<void> {
  await prisma.healthActivityInterval.deleteMany({ where: { date: stepperV7Date } });
  await prisma.heartRateSample.deleteMany({ where: { date: stepperV7Date } });
  await prisma.healthSyncSnapshot.deleteMany({ where: { date: stepperV7Date } });
  await deleteDailyHealthRows(prisma, stepperV7Date);
}

async function cleanCrossMidnightStepper(): Promise<void> {
  const dates = [crossMidnightStartDate, crossMidnightEndDate];
  await prisma.healthActivityInterval.deleteMany({ where: { date: { in: dates } } });
  await prisma.heartRateSample.deleteMany({ where: { date: { in: dates } } });
  await prisma.healthSyncSnapshot.deleteMany({ where: { date: { in: dates } } });
  await deleteDailyHealthRows(prisma, crossMidnightStartDate);
  await deleteDailyHealthRows(prisma, crossMidnightEndDate);
}

describe("v6 workout activity PostgreSQL integration", () => {
  beforeAll(clean);
  afterAll(async () => {
    await clean();
    await cleanStepperV7();
    await cleanCrossMidnightStepper();
    await prisma.$disconnect();
  });

  it("syncs mixed-case Stair + Stair + Strength payload and persists activeEnergyKcal", async () => {
    await clean();
    const response = await POST(syncRequest({
      timezone,
      days: [{
        date,
        walkingDistanceKm: 5.0,
        averageWalkingSpeedKmh: 5.0,
        strengthTrainingMinutes: 75,
        Trainingtype: "stair Climbing\nSTAIR CLIMBING\ntraditional Strength Training",
        Trainingactivekcal: "154\n18\n562",
        trainingTimestamps: [
          `${date}T08:00:00+02:00`,
          `${date}T12:00:00+02:00`,
          `${date}T16:00:00+02:00`,
          `${date}T08:20:00+02:00`,
          `${date}T12:10:00+02:00`,
          `${date}T17:00:00+02:00`,
        ].join("\n"),
      }],
    }));
    expect(response.status).toBe(200);

    const stored = await prisma.dailyHealthData.findUniqueOrThrow({
      where: { date },
      include: { workouts: { orderBy: { startAt: "asc" } } },
    });
    expect(stored.workouts).toHaveLength(3);
    expect(stored.workouts.map((workout) => workout.type)).toEqual([
      "stair Climbing",
      "STAIR CLIMBING",
      "traditional Strength Training",
    ]);
    expect(stored.workouts.map((workout) => workout.activeEnergyKcal)).toEqual([154, 18, 562]);
    expect(stored.workouts.every((workout) => workout.energyKcal === null)).toBe(true);
  });

  it("loads workouts for fresh v6 sources and ignores them on legacy v5 path", async () => {
    const repository = new ModelEpisodeRepository(prisma);
    const sources = await repository.loadSources(date, date);
    expect(sources.workouts).toHaveLength(3);
    expect(sources.workouts?.every((workout) => workout.activeEnergyKcal !== null)).toBe(true);

    const v6 = buildSimulationDays({
      from: date,
      to: date,
      sources,
      modelVersion: CURRENT_MODEL_VERSION,
    });
    expect(v6[0]?.input.workoutActivity?.events).toHaveLength(3);
    expect(v6[0]?.input.workoutActivity?.events.map((event) => ({
      raw: event.type,
      canonical: event.canonicalType,
      classification: event.classification,
    }))).toEqual([
      {
        raw: "stair Climbing",
        canonical: STAIR_CLIMBING_TYPE,
        classification: "stair-climbing",
      },
      {
        raw: "STAIR CLIMBING",
        canonical: STAIR_CLIMBING_TYPE,
        classification: "stair-climbing",
      },
      {
        raw: "traditional Strength Training",
        canonical: TRADITIONAL_STRENGTH_TRAINING_TYPE,
        classification: "traditional-strength-training",
      },
    ]);
    expect(v6[0]?.input.strengthTrainingMinutes).toBe(0);

    const v5 = buildSimulationDays({
      from: date,
      to: date,
      sources,
      modelVersion: LEGACY_PHYSIOLOGY_V5,
    });
    expect(v5[0]?.input.workoutActivity).toBeUndefined();
    expect(v5[0]?.input.strengthTrainingMinutes).toBe(75);
    expect(v5[0]?.input.outsideWorkWalkingDistanceKm).toBe(5);
  });

  it("applies stair snapshot overlap through repository/input-builder and skips weak snapshots", async () => {
    await prisma.healthSyncSnapshot.deleteMany({ where: { date } });
    const day = await prisma.dailyHealthData.findUniqueOrThrow({ where: { date } });

    // Strong boundaries within 10 minutes of first stair (08:00–08:20 local / 06:00–06:20Z).
    await prisma.healthSyncSnapshot.createMany({
      data: [
        {
          dailyHealthDataId: day.id,
          date,
          timezone,
          receivedAt: new Date(`${date}T05:55:00.000Z`),
          syncedAt: new Date(`${date}T05:55:00.000Z`),
          steps: 1_000,
          walkingDistanceKm: 2.0,
          rawPayload: {},
        },
        {
          dailyHealthDataId: day.id,
          date,
          timezone,
          receivedAt: new Date(`${date}T06:25:00.000Z`),
          syncedAt: new Date(`${date}T06:25:00.000Z`),
          steps: 1_600,
          walkingDistanceKm: 2.6,
          rawPayload: {},
        },
      ],
    });

    const repository = new ModelEpisodeRepository(prisma);
    const sources = await repository.loadSources(date, date);
    const withOverlap = buildSimulationDays({
      from: date,
      to: date,
      sources,
      modelVersion: CURRENT_MODEL_VERSION,
    });
    expect(withOverlap[0]?.input.outsideWorkWalkingDistanceKm).toBeCloseTo(4.6, 8);
    const stairDiag = withOverlap[0]?.sourceQuality.stairWalkingOverlap?.[0];
    expect(stairDiag?.overlapApplied).toBe(true);
    expect(stairDiag?.reason).toBe("applied");
    expect(stairDiag?.overlapDistanceAppliedKm).toBeCloseTo(0.4, 8);

    await prisma.healthSyncSnapshot.deleteMany({ where: { date } });
    // Weak/missing after boundary: only a too-early before snapshot.
    await prisma.healthSyncSnapshot.create({
      data: {
        dailyHealthDataId: day.id,
        date,
        timezone,
        receivedAt: new Date(`${date}T04:00:00.000Z`),
        syncedAt: new Date(`${date}T04:00:00.000Z`),
        steps: 500,
        walkingDistanceKm: 1.0,
        rawPayload: {},
      },
    });
    const weakSources = await repository.loadSources(date, date);
    const withoutOverlap = buildSimulationDays({
      from: date,
      to: date,
      sources: weakSources,
      modelVersion: CURRENT_MODEL_VERSION,
    });
    expect(withoutOverlap[0]?.input.outsideWorkWalkingDistanceKm).toBe(5);
    expect(
      withoutOverlap[0]?.sourceQuality.stairWalkingOverlap?.every(
        (item) => item.overlapApplied === false,
      ),
    ).toBe(true);
    expect(withoutOverlap[0]?.input.workoutActivity?.events.reduce(
      (total, event) => total + (event.activeEnergyKcal ?? 0),
      0,
    )).toBe(734);
  });

  it("keeps legacy Workout rows readable after activeEnergyKcal migration round-trip", async () => {
    await clean();
    const day = await prisma.dailyHealthData.create({
      data: {
        date,
        walkingDistanceKm: 3,
        averageWalkingSpeedKmh: 5,
        strengthTrainingMinutes: 30,
        rawPayload: { date, legacy: true },
        workouts: {
          create: [{
            type: "legacy-spin",
            startAt: new Date(`${date}T10:00:00.000Z`),
            endAt: new Date(`${date}T10:30:00.000Z`),
            durationMinutes: 30,
            energyKcal: 220,
            activeEnergyKcal: null,
            sourceIdentity: workoutSourceIdentity({
              type: "legacy-spin",
              startAt: new Date(`${date}T10:00:00.000Z`),
              endAt: new Date(`${date}T10:30:00.000Z`),
            }),
          }],
        },
      },
      include: { workouts: true },
    });
    const legacyWorkout = day.workouts[0]!;
    expect(legacyWorkout.energyKcal).toBe(220);
    expect(legacyWorkout.activeEnergyKcal).toBeNull();

    const reloaded = await prisma.workout.findUniqueOrThrow({ where: { id: legacyWorkout.id } });
    expect(reloaded).toMatchObject({
      type: "legacy-spin",
      energyKcal: 220,
      activeEnergyKcal: null,
    });

    const sources = await new ModelEpisodeRepository(prisma).loadSources(date, date);
    expect(sources.workouts).toEqual([expect.objectContaining({
      type: "legacy-spin",
      energyKcal: 220,
      activeEnergyKcal: null,
    })]);
  });

  it("loads timed step and HR evidence through v7 and selects BodyCast energy without adding Garmin kcal", async () => {
    await cleanStepperV7();
    try {
      const day = await prisma.dailyHealthData.create({
        data: {
          date: stepperV7Date,
          weightKg: 80,
          caloriesKcal: 2_400,
          proteinG: 150,
          fatG: 75,
          carbsG: 250,
          steps: 1_500,
          averageWalkingSpeedKmh: 5,
          walkingDistanceKm: 1,
          rawPayload: { source: "stepper-v7-integration" },
        },
      });
      const startAt = new Date(`${stepperV7Date}T06:00:00.000Z`);
      const endAt = new Date(`${stepperV7Date}T06:20:00.000Z`);
      await prisma.workout.create({
        data: {
          dailyHealthDataId: day.id,
          type: STAIR_CLIMBING_TYPE,
          startAt,
          endAt,
          durationMinutes: 20,
          energyKcal: null,
          activeEnergyKcal: 99,
          sourceIdentity: workoutSourceIdentity({
            type: STAIR_CLIMBING_TYPE,
            startAt,
            endAt,
          }),
        },
      });
      await prisma.healthActivityInterval.createMany({
        data: [300, 350, 400, 450].map((value, index) => ({
          date: stepperV7Date,
          metric: "steps",
          startAt: new Date(startAt.getTime() + index * 5 * 60_000),
          endAt: new Date(startAt.getTime() + (index + 1) * 5 * 60_000),
          value,
          sourceFingerprint: `stepper-v7-integration-${index}`,
        })),
      });
      await prisma.heartRateSample.createMany({
        data: [110, 120, 130, 140, 150].map((bpm, index) => ({
          dailyHealthDataId: day.id,
          date: stepperV7Date,
          timestamp: new Date(startAt.getTime() + index * 5 * 60_000),
          bpm,
          source: "integration-watch",
        })),
      });

      const sources = await new ModelEpisodeRepository(prisma).loadSources(stepperV7Date, stepperV7Date);
      const [built] = buildSimulationDays({
        from: stepperV7Date,
        to: stepperV7Date,
        sources,
        modelVersion: CURRENT_MODEL_VERSION,
      });
      const event = built?.input.workoutActivity?.events[0];
      expect(event?.stepperEvidence).toMatchObject({
        bracketedSteps: {
          availability: "available",
          derivedStepDelta: { value: 1_500 },
          intervalCoveragePercent: 100,
        },
        workoutEnergy: {
          heartRate: { availability: "loaded", sampleCount: 5 },
        },
      });
      expect(event?.stepperEvidence?.workoutEnergy.heartRate.summary?.sampleMeanBpm).toBe(130);

      const energy = resolveExplicitWorkoutActivityKcal({
        events: built!.input.workoutActivity!.events,
        weightKg: 80,
        rmrKcalPerDay: 1_700,
      });
      expect(energy.perEvent[0]?.source).toBe("mechanical-stepper");
      expect(energy.perEvent[0]?.stepperEnergy?.heartRate.decisionReason)
        .toBe("no-personal-ms100-calibration");
      expect(energy.bodyCastStepperActiveEnergyKcal).toBeGreaterThan(99);
      expect(energy.deviceActiveEnergyKcal).toBe(0);
      expect(energy.workoutActivityKcal).toBe(energy.bodyCastStepperActiveEnergyKcal);
    } finally {
      await cleanStepperV7();
    }
  });

  it("keeps cross-midnight stepper energy once while subtracting both dates' overlapping walking intervals", async () => {
    await cleanCrossMidnightStepper();
    try {
      const firstDay = await prisma.dailyHealthData.create({
        data: {
          date: crossMidnightStartDate,
          weightKg: 80,
          caloriesKcal: 2_400,
          proteinG: 150,
          fatG: 75,
          carbsG: 250,
          averageWalkingSpeedKmh: 5,
          walkingDistanceKm: 0.4,
          rawPayload: { source: "cross-midnight-stepper-audit" },
        },
      });
      await prisma.dailyHealthData.create({
        data: {
          date: crossMidnightEndDate,
          weightKg: 80,
          caloriesKcal: 2_400,
          proteinG: 150,
          fatG: 75,
          carbsG: 250,
          averageWalkingSpeedKmh: 5,
          walkingDistanceKm: 0.5,
          rawPayload: { source: "cross-midnight-stepper-audit" },
        },
      });
      const startAt = new Date("2042-06-17T23:50:00+02:00");
      const midnight = new Date("2042-06-18T00:00:00+02:00");
      const workoutEnd = new Date("2042-06-18T00:10:00+02:00");
      const afterEnd = new Date("2042-06-18T00:20:00+02:00");
      await prisma.workout.create({
        data: {
          dailyHealthDataId: firstDay.id,
          type: STAIR_CLIMBING_TYPE,
          startAt,
          endAt: workoutEnd,
          durationMinutes: 20,
          energyKcal: null,
          activeEnergyKcal: null,
          sourceIdentity: workoutSourceIdentity({ type: STAIR_CLIMBING_TYPE, startAt, endAt: workoutEnd }),
        },
      });
      await prisma.healthActivityInterval.createMany({
        data: [
          { date: crossMidnightStartDate, metric: "walking-distance-km", startAt: new Date("2042-06-17T23:40:00+02:00"), endAt: startAt, value: 0.1, sourceFingerprint: "cross-midnight-walk-before" },
          { date: crossMidnightStartDate, metric: "walking-distance-km", startAt, endAt: midnight, value: 0.3, sourceFingerprint: "cross-midnight-walk-first-half" },
          { date: crossMidnightStartDate, metric: "steps", startAt, endAt: midnight, value: 100, sourceFingerprint: "cross-midnight-steps-first-half" },
          { date: crossMidnightEndDate, metric: "walking-distance-km", startAt: midnight, endAt: workoutEnd, value: 0.2, sourceFingerprint: "cross-midnight-walk-second-half" },
          { date: crossMidnightEndDate, metric: "walking-distance-km", startAt: workoutEnd, endAt: afterEnd, value: 0.3, sourceFingerprint: "cross-midnight-walk-after" },
          { date: crossMidnightEndDate, metric: "steps", startAt: midnight, endAt: workoutEnd, value: 100, sourceFingerprint: "cross-midnight-steps-second-half" },
        ],
      });

      const sources = await new ModelEpisodeRepository(prisma).loadSources(crossMidnightStartDate, crossMidnightEndDate);
      const builtDays = buildSimulationDays({
        from: crossMidnightStartDate,
        to: crossMidnightEndDate,
        sources,
        modelVersion: CURRENT_MODEL_VERSION,
      });
      const startDay = builtDays[0]!;
      const endDay = builtDays[1]!;
      const startDayEvents = startDay.input.workoutActivity!.events;
      const energy = resolveExplicitWorkoutActivityKcal({
        events: startDayEvents,
        weightKg: 80,
        rmrKcalPerDay: 1_700,
      });

      expect(startDayEvents).toHaveLength(1);
      expect(startDayEvents[0]?.stepperEvidence?.bracketedSteps).toMatchObject({
        availability: "available",
        derivedStepDelta: { value: 200 },
        intervalCoveragePercent: 100,
      });
      expect(energy.perEvent[0]?.source).toBe("mechanical-stepper");
      expect(energy.workoutActivityKcal).toBeGreaterThan(0);
      expect(endDay.input.workoutActivity?.events).toEqual([]);
      expect(startDay.input.outsideWorkWalkingDistanceKm).toBeCloseTo(0.1, 12);
      expect(endDay.input.outsideWorkWalkingDistanceKm).toBeCloseTo(0.3, 12);
      expect(startDay.sourceQuality.stairWalkingOverlap?.[0]?.overlapDistanceAppliedKm).toBeCloseTo(0.3, 12);
      expect(endDay.sourceQuality.stairWalkingOverlap?.[0]?.overlapDistanceAppliedKm).toBeCloseTo(0.2, 12);
      expect(
        startDay.input.workoutActivity!.events.reduce((sum, event) => sum + resolveExplicitWorkoutActivityKcal({
          events: [event],
          weightKg: 80,
          rmrKcalPerDay: 1_700,
        }).workoutActivityKcal, 0)
        + endDay.input.workoutActivity!.events.reduce((sum, event) => sum + resolveExplicitWorkoutActivityKcal({
          events: [event],
          weightKg: 80,
          rmrKcalPerDay: 1_700,
        }).workoutActivityKcal, 0),
      ).toBeCloseTo(energy.workoutActivityKcal, 12);
    } finally {
      await cleanCrossMidnightStepper();
    }
  });
});
