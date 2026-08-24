import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  getModelHistory,
  getModelStatus,
  initializeNewModelEpisode,
  recalculateModelEpisode,
} from "@/modules/model-episodes/model-episode.service";
import { addCalendarDays } from "@/modules/model-episodes/model-calendar";
import {
  getModelRecoveryStatus,
  recoverModelEpisode,
} from "@/modules/model-recovery/model-recovery.service";
import { forecastModelEpisode } from "@/modules/model-forecast/model-forecast.service";

const prisma = new PrismaClient();
const episodeStart = "2041-03-20";
const finalDate = "2041-03-30";
const testRangeStart = addCalendarDays(finalDate, -99);
const now = new Date("2041-03-31T10:00:00.000Z");
const workDate = "2041-03-25";
let originalProfile: Awaited<ReturnType<typeof prisma.profile.findUnique>>;
let originalActiveIds: number[] = [];
let episodeId = 0;

const fixedForecastScenario = {
  mode: "fixed" as const,
  schedule: {
    defaultDay: {
      nutrition: { caloriesKcal: 2_200, proteinG: 170, fatG: 70, carbsG: 230 },
      outsideWorkWalkingDistanceKm: 5,
      averageWalkingSpeedKmh: 5,
      strengthTrainingMinutes: 0,
      occupation: [],
    },
  },
};

async function removeTestData(): Promise<void> {
  await prisma.modelEpisode.deleteMany({
    where: { startDate: { gte: testRangeStart, lte: finalDate } },
  });
  await prisma.healthSyncSnapshot.deleteMany({
    where: { date: { gte: testRangeStart, lte: finalDate } },
  });
  await prisma.workInterval.deleteMany({
    where: { date: { gte: testRangeStart, lte: finalDate } },
  });
  await prisma.dailyHealthData.deleteMany({
    where: { date: { gte: testRangeStart, lte: finalDate } },
  });
}

async function seedSources(): Promise<void> {
  const biaStart = addCalendarDays(episodeStart, -6);
  for (let index = 0; index < 100; index += 1) {
    const date = addCalendarDays(testRangeStart, index);
    const bodyFatPercent = date >= biaStart && date <= episodeStart
      ? 20 + [0, 0.2, -0.1][index % 3]
      : null;
    await prisma.dailyHealthData.create({
      data: {
        date,
        weightKg: 80 + [0, 0.05, -0.04, 0.02][index % 4],
        bodyFatPercent,
        caloriesKcal: 2_450 + [0, 50, -50][index % 3],
        proteinG: 150,
        fatG: 75,
        carbsG: 240 + [0, 10, -10][index % 3],
        steps: 8_000,
        averageWalkingSpeedKmh: 5,
        walkingDistanceKm: date === workDate ? 5.1 : 5,
        strengthTrainingMinutes: 0,
        rawPayload: { source: "model-episode-integration" },
      },
    });
  }
  await prisma.workInterval.create({
    data: {
      date: workDate,
      startAt: new Date("2041-03-25T07:00:00.000Z"),
      endAt: new Date("2041-03-25T15:00:00.000Z"),
      timezone: "Europe/Bratislava",
      category: "manualModerate",
      breakMinutes: 30,
    },
  });
  await prisma.healthSyncSnapshot.createMany({
    data: [
      {
        date: workDate,
        receivedAt: new Date("2041-03-25T07:00:00.000Z"),
        timezone: "Europe/Bratislava",
        steps: 1_200,
        walkingDistanceKm: 0.8,
        rawPayload: { source: "model-episode-integration" },
      },
      {
        date: workDate,
        receivedAt: new Date("2041-03-25T15:00:00.000Z"),
        timezone: "Europe/Bratislava",
        steps: 4_700,
        walkingDistanceKm: 3.3,
        rawPayload: { source: "model-episode-integration" },
      },
    ],
  });
}

async function initializeTestEpisode(): Promise<void> {
  const episode = await initializeNewModelEpisode({ startDate: episodeStart, now });
  episodeId = episode.id;
}

describe.sequential("model episode lifecycle with PostgreSQL", () => {
  beforeAll(async () => {
    originalProfile = await prisma.profile.findUnique({ where: { id: 1 } });
    originalActiveIds = (await prisma.modelEpisode.findMany({
      where: { active: true }, select: { id: true },
    })).map(({ id }) => id);
    if (originalActiveIds.length > 0) {
      await prisma.modelEpisode.updateMany({
        where: { id: { in: originalActiveIds } },
        data: { active: false, deactivatedAt: new Date() },
      });
    }
  });

  beforeEach(async () => {
    await removeTestData();
    await prisma.profile.upsert({
      where: { id: 1 },
      create: {
        id: 1, sex: "male", dateOfBirth: new Date("1990-05-10T00:00:00.000Z"),
        heightCm: 180,
      },
      update: {
        sex: "male", dateOfBirth: new Date("1990-05-10T00:00:00.000Z"),
        heightCm: 180, targetWeightKg: null, targetDate: null,
      },
    });
    await seedSources();
    await initializeTestEpisode();
  });

  afterAll(async () => {
    await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS "model_episode_test_failure" ON "DailyModelState"');
    await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS "model_episode_test_failure"()');
    await removeTestData();
    if (originalProfile) {
      await prisma.profile.update({
        where: { id: 1 },
        data: {
          sex: originalProfile.sex,
          dateOfBirth: originalProfile.dateOfBirth,
          heightCm: originalProfile.heightCm,
          targetWeightKg: originalProfile.targetWeightKg,
          targetDate: originalProfile.targetDate,
        },
      });
    } else {
      await prisma.profile.deleteMany({ where: { id: 1 } });
    }
    if (originalActiveIds.length > 0) {
      await prisma.modelEpisode.updateMany({
        where: { id: { in: originalActiveIds } },
        data: { active: true, deactivatedAt: null },
      });
    }
    await prisma.$disconnect();
  });

  it("initializes frozen baselines and enforces one active episode", async () => {
    const episode = await prisma.modelEpisode.findUniqueOrThrow({ where: { id: episodeId } });
    expect(episode).toMatchObject({
      active: true,
      timezone: "Europe/Bratislava",
      modelVersion: "bodycast-physiology-v4",
      ecfPolicy: "hold-ecf",
      baselineEnergyIntakeKcalPerDay: 2_450,
      baselineCarbIntakeG: 240,
      calibrationStatus: "insufficient-history",
    });
    await prisma.dailyHealthData.update({
      where: { date: episode.baselineWindowEndDate }, data: { caloriesKcal: 3_500 },
    });
    expect((await prisma.modelEpisode.findUniqueOrThrow({ where: { id: episodeId } }))
      .baselineEnergyIntakeKcalPerDay).toBe(2_450);

    const replacement = await initializeNewModelEpisode({ startDate: episodeStart, now });
    expect(replacement.id).not.toBe(episodeId);
    expect((await prisma.modelEpisode.findUniqueOrThrow({ where: { id: episodeId } })).active)
      .toBe(false);
    await expect(prisma.modelEpisode.update({
      where: { id: episodeId }, data: { active: true, deactivatedAt: null },
    })).rejects.toThrow();
  });

  it("forecasts a resolved episode reproducibly without mutating model history", async () => {
    const beforeEpisode = await prisma.modelEpisode.findUniqueOrThrow({ where: { id: episodeId } });
    const beforeStates = await prisma.dailyModelState.findMany({
      where: { episodeId }, orderBy: { date: "asc" },
    });
    const first = await forecastModelEpisode({
      episodeId, horizonDays: 30, seed: 88, scenario: fixedForecastScenario,
      config: { pathCount: 32 }, now,
    }, prisma);
    const second = await forecastModelEpisode({
      episodeId, horizonDays: 30, seed: 88, scenario: fixedForecastScenario,
      config: { pathCount: 32 }, now,
    }, prisma);
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      status: "ok", initialStateQuality: "deterministic",
      forecastVersion: "bodycast-forecast-v1", modelVersion: "bodycast-physiology-v4",
    });
    expect("dates" in first && first.dates).toHaveLength(30);
    expect(await prisma.modelEpisode.findUniqueOrThrow({ where: { id: episodeId } }))
      .toEqual(beforeEpisode);
    expect(await prisma.dailyModelState.findMany({
      where: { episodeId }, orderBy: { date: "asc" },
    })).toEqual(beforeStates);
    expect(await prisma.modelRecoveryRun.count({ where: { episodeId } })).toBe(0);
  });

  it("persists a reproducible weighted recovery ensemble and invalidates it after a source edit", async () => {
    const extendedDates = [
      "2041-03-31", "2041-04-01", "2041-04-02", "2041-04-03",
      "2041-04-04", "2041-04-05", "2041-04-06",
    ];
    const extendedNow = new Date("2041-04-07T10:00:00.000Z");
    try {
      await prisma.dailyHealthData.createMany({
        data: extendedDates.map((date, index) => ({
          date, weightKg: 80 + index * 0.03, bodyFatPercent: null,
          caloriesKcal: 2_450, proteinG: 150, fatG: 75, carbsG: 240,
          steps: 8_000, averageWalkingSpeedKmh: 5, walkingDistanceKm: 5,
          strengthTrainingMinutes: 0, rawPayload: { source: "phase-14a-canonical" },
        })),
      });
      await prisma.dailyHealthData.deleteMany({
        where: { date: { gte: "2041-03-23", lte: "2041-03-29" } },
      });
      await recalculateModelEpisode({ episodeId, now: extendedNow });
      expect(await prisma.dailyModelState.findMany({
        where: { episodeId }, orderBy: { date: "asc" }, select: { date: true },
      })).toEqual([{ date: "2041-03-20" }, { date: "2041-03-21" }, { date: "2041-03-22" }]);

      const recovered = await recoverModelEpisode({
        episodeId, seed: 1234, config: { particleCount: 64 }, now: extendedNow,
      });
      expect(recovered).toMatchObject({
        status: "ok",
        deterministicModelVersion: "bodycast-physiology-v4",
        recovery: {
          seed: 1234,
          observationCount: 8,
          generatedParticleCount: 64,
          validParticleCount: 64,
          stale: false,
        },
      });
      const stored = await prisma.modelRecoveryRun.findFirstOrThrow({
        where: { episodeId, staleAt: null },
      });
      expect(Array.isArray(stored.ensemble)).toBe(true);
      expect(stored.algorithmVersion).toBe("bodycast-recovery-v3");
      expect(await prisma.dailyModelState.count({ where: { episodeId } })).toBe(3);

      const beforeForecastEpisode = await prisma.modelEpisode.findUniqueOrThrow({ where: { id: episodeId } });
      const beforeForecastStates = await prisma.dailyModelState.findMany({
        where: { episodeId }, orderBy: { date: "asc" },
      });
      const originalRecoveryStatus = stored.status;
      await prisma.modelRecoveryRun.update({
        where: { id: stored.id }, data: { status: "degraded" },
      });
      const forecast = await forecastModelEpisode({
        episodeId, horizonDays: 30, seed: 321, scenario: fixedForecastScenario,
        config: { pathCount: 64 }, now: extendedNow,
      }, prisma);
      expect(forecast).toMatchObject({
        status: "degraded", initialStateQuality: "degraded",
        recoveryVersion: "bodycast-recovery-v3",
      });
      expect("diagnostics" in forecast && forecast.diagnostics.startingParticleCount).toBe(64);
      await prisma.modelRecoveryRun.update({
        where: { id: stored.id }, data: { status: "degenerate" },
      });
      expect(await forecastModelEpisode({
        episodeId, horizonDays: 7, seed: 321, scenario: fixedForecastScenario,
        config: { pathCount: 16 }, now: extendedNow,
      }, prisma)).toMatchObject({
        status: "initial-state-unreliable", initialStateQuality: "degenerate",
      });
      await prisma.modelRecoveryRun.update({
        where: { id: stored.id }, data: { status: originalRecoveryStatus },
      });
      expect(await prisma.modelEpisode.findUniqueOrThrow({ where: { id: episodeId } }))
        .toEqual(beforeForecastEpisode);
      expect(await prisma.dailyModelState.findMany({
        where: { episodeId }, orderBy: { date: "asc" },
      })).toEqual(beforeForecastStates);
      expect((await prisma.modelRecoveryRun.findUniqueOrThrow({ where: { id: stored.id } })).ensemble)
        .toEqual(stored.ensemble);

      const repeated = await recoverModelEpisode({
        episodeId, seed: 1234, config: { particleCount: 64 }, now: extendedNow,
      });
      expect(repeated.status === "ok" && repeated.recovery.id).toBe(stored.id);
      expect(await prisma.modelRecoveryRun.count({ where: { episodeId } })).toBe(1);

      await prisma.$executeRawUnsafe(`
        CREATE OR REPLACE FUNCTION "model_recovery_test_failure"() RETURNS trigger AS $$
        BEGIN RAISE EXCEPTION 'forced recovery persistence failure'; END;
        $$ LANGUAGE plpgsql
      `);
      await prisma.$executeRawUnsafe(`
        CREATE TRIGGER "model_recovery_test_failure"
        BEFORE INSERT ON "ModelRecoveryRun"
        FOR EACH ROW EXECUTE FUNCTION "model_recovery_test_failure"()
      `);
      await expect(recoverModelEpisode({
        episodeId, seed: 999, config: { particleCount: 64 }, now: extendedNow,
      })).rejects.toThrow();
      expect(await prisma.modelRecoveryRun.findUniqueOrThrow({ where: { id: stored.id } }))
        .toMatchObject({ staleAt: null });
      await prisma.$executeRawUnsafe('DROP TRIGGER "model_recovery_test_failure" ON "ModelRecoveryRun"');
      await prisma.$executeRawUnsafe('DROP FUNCTION "model_recovery_test_failure"()');

      await prisma.workInterval.updateMany({
        where: { date: workDate }, data: { breakMinutes: 45 },
      });
      expect(await forecastModelEpisode({
        episodeId, horizonDays: 7, seed: 321, scenario: fixedForecastScenario,
        config: { pathCount: 16 }, now: extendedNow,
      }, prisma)).toMatchObject({
        status: "initial-state-unavailable", initialStateQuality: "awaiting",
      });
      const afterBreakEdit = await getModelRecoveryStatus(episodeId, prisma, extendedNow);
      expect(afterBreakEdit.recovery).toMatchObject({ id: stored.id, stale: true });

      const refreshed = await recoverModelEpisode({
        episodeId, seed: 1234, config: { particleCount: 64 }, now: extendedNow,
      });
      expect(refreshed.status).toBe("ok");
      if (refreshed.status !== "ok") throw new Error("Expected refreshed recovery.");
      expect(refreshed.recovery.id).not.toBe(stored.id);
      expect(refreshed.recovery.stale).toBe(false);

      await prisma.dailyHealthData.update({
        where: { date: "2041-04-06" }, data: { caloriesKcal: 2_700 },
      });
      const afterNutritionEdit = await getModelRecoveryStatus(episodeId, prisma, extendedNow);
      expect(afterNutritionEdit.recovery).toMatchObject({
        id: refreshed.recovery.id, stale: true,
      });
    } finally {
      await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS "model_recovery_test_failure" ON "ModelRecoveryRun"');
      await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS "model_recovery_test_failure"()');
      await prisma.dailyHealthData.deleteMany({ where: { date: { in: extendedDates } } });
    }
  });

  it("persists deterministic, idempotent history and overlap-aware walking", async () => {
    const first = await recalculateModelEpisode({ episodeId, now });
    const firstRows = await prisma.dailyModelState.findMany({
      where: { episodeId }, orderBy: { date: "asc" },
      select: {
        date: true, status: true, sourceQuality: true, endWeightKg: true,
        energyExpenditureKcal: true, activityKcalPerDay: true,
        startWeightKg: true, dynamicRmrKcalPerDay: true, modelVersion: true,
      },
    });
    const second = await recalculateModelEpisode({ episodeId, now });
    const secondRows = await prisma.dailyModelState.findMany({
      where: { episodeId }, orderBy: { date: "asc" },
      select: {
        date: true, status: true, sourceQuality: true, endWeightKg: true,
        energyExpenditureKcal: true, activityKcalPerDay: true,
        startWeightKg: true, dynamicRmrKcalPerDay: true, modelVersion: true,
      },
    });
    expect(second).toEqual(first);
    expect(secondRows).toEqual(firstRows);
    expect(secondRows).toHaveLength(11);
    expect(new Set(secondRows.map(({ date }) => date)).size).toBe(11);
    expect(secondRows.every(({ status }) => status === "complete")).toBe(true);
    const workQuality = secondRows.find(({ date }) => date === workDate)!.sourceQuality as {
      workWalkingDistanceKm: number;
      outsideWorkWalkingDistanceKm: number;
    };
    expect(workQuality.workWalkingDistanceKm).toBeCloseTo(2.5, 12);
    expect(workQuality.outsideWorkWalkingDistanceKm).toBeCloseTo(2.6, 12);
    expect(await prisma.healthSyncSnapshot.count({ where: { date: workDate } })).toBe(2);
    expect(await prisma.workInterval.count({ where: { date: workDate } })).toBe(1);
    const workState = secondRows.find(({ date }) => date === workDate)!;
    const weight = workState.startWeightKg!;
    const restingPerHour = workState.dynamicRmrKcalPerDay! / 24;
    const workWalkingHours = 2.5 / 5;
    const outsideWalkingHours = 2.6 / 5;
    const expectedWorkWalking = 3.8 * weight * workWalkingHours
      - restingPerHour * workWalkingHours;
    const expectedResidual = 4.5 * weight * (7.5 - workWalkingHours)
      - restingPerHour * (7.5 - workWalkingHours);
    const expectedOutsideWalking = 3.8 * weight * outsideWalkingHours
      - restingPerHour * outsideWalkingHours;
    expect(workState.activityKcalPerDay).toBeCloseTo(
      expectedWorkWalking + expectedResidual + expectedOutsideWalking,
      10,
    );
    expect(workState.modelVersion).toBe("bodycast-physiology-v4");
  });

  it("rebuilds the later trajectory after an occupational category edit", async () => {
    await recalculateModelEpisode({ episodeId, now });
    const beforeWork = await prisma.dailyModelState.findUniqueOrThrow({
      where: { episodeId_date: { episodeId, date: workDate } },
    });
    const beforeFinal = await prisma.dailyModelState.findUniqueOrThrow({
      where: { episodeId_date: { episodeId, date: finalDate } },
    });
    await prisma.workInterval.updateMany({
      where: { date: workDate }, data: { category: "standingLight" },
    });
    await recalculateModelEpisode({ episodeId, now });
    const afterWork = await prisma.dailyModelState.findUniqueOrThrow({
      where: { episodeId_date: { episodeId, date: workDate } },
    });
    const afterFinal = await prisma.dailyModelState.findUniqueOrThrow({
      where: { episodeId_date: { episodeId, date: finalDate } },
    });
    expect(afterWork.activityKcalPerDay).toBeLessThan(beforeWork.activityKcalPerDay!);
    expect(afterFinal.endWeightKg).not.toBe(beforeFinal.endWeightKg);
    expect(await prisma.dailyModelState.count({ where: { episodeId } })).toBe(11);
  });

  it("atomically upgrades an existing episode and all rebuilt rows to v4", async () => {
    await prisma.modelEpisode.update({
      where: { id: episodeId }, data: { modelVersion: "bodycast-physiology-v1" },
    });
    await recalculateModelEpisode({ episodeId, now });
    expect((await prisma.modelEpisode.findUniqueOrThrow({ where: { id: episodeId } })).modelVersion)
      .toBe("bodycast-physiology-v4");
    const versions = await prisma.dailyModelState.findMany({
      where: { episodeId }, distinct: ["modelVersion"], select: { modelVersion: true },
    });
    expect(versions).toEqual([{ modelVersion: "bodycast-physiology-v4" }]);
  });

  it("recomputes all later states after a historical source edit", async () => {
    await recalculateModelEpisode({ episodeId, now });
    const before = await prisma.dailyModelState.findUniqueOrThrow({
      where: { episodeId_date: { episodeId, date: finalDate } },
    });
    await prisma.dailyHealthData.update({
      where: { date: episodeStart }, data: { caloriesKcal: { increment: 500 } },
    });
    await recalculateModelEpisode({ episodeId, now });
    const after = await prisma.dailyModelState.findUniqueOrThrow({
      where: { episodeId_date: { episodeId, date: finalDate } },
    });
    expect(after.endWeightKg).not.toBe(before.endWeightKg);
  });

  it("bridges missing nutrition, persists provenance, then replaces it with observed data", async () => {
    const missingDate = "2041-03-23";
    await prisma.dailyHealthData.update({
      where: { date: missingDate },
      data: { caloriesKcal: null, proteinG: null, fatG: null, carbsG: null },
    });
    const estimatedRun = await recalculateModelEpisode({ episodeId, now });
    const estimatedGap = await prisma.dailyModelState.findUniqueOrThrow({
      where: { episodeId_date: { episodeId, date: missingDate } },
    });
    const estimatedLater = await prisma.dailyModelState.findUniqueOrThrow({
      where: { episodeId_date: { episodeId, date: finalDate } },
    });
    expect(estimatedRun).toMatchObject({
      completeDays: 11,
      incompleteDays: 0,
      imputedNutritionDays: 1,
      unbridgeableNutritionDays: 0,
    });
    expect(estimatedGap).toMatchObject({
      status: "complete",
      dataQuality: "estimated",
      nutritionSource: "imputed-local",
      nutritionImputationMethod: "local-joint-donor",
      nutritionGapLength: 1,
    });
    expect(estimatedGap.nutritionReferenceDayCount).toBeGreaterThanOrEqual(2);
    expect(estimatedLater).toMatchObject({ status: "complete", dataQuality: "estimated" });

    await prisma.dailyHealthData.update({
      where: { date: missingDate },
      data: { caloriesKcal: 3_100, proteinG: 180, fatG: 105, carbsG: 340 },
    });
    const observedRun = await recalculateModelEpisode({ episodeId, now });
    const observedGap = await prisma.dailyModelState.findUniqueOrThrow({
      where: { episodeId_date: { episodeId, date: missingDate } },
    });
    const observedLater = await prisma.dailyModelState.findUniqueOrThrow({
      where: { episodeId_date: { episodeId, date: finalDate } },
    });
    expect(observedRun).toMatchObject({
      observedNutritionDays: 11,
      imputedNutritionDays: 0,
      unbridgeableNutritionDays: 0,
    });
    expect(observedGap).toMatchObject({
      dataQuality: "observed",
      nutritionSource: "observed",
      nutritionImputationMethod: null,
      nutritionReferenceDayCount: 0,
      nutritionGapLength: 0,
    });
    expect(observedLater.endWeightKg).not.toBe(estimatedLater.endWeightKg);
    expect(await prisma.dailyModelState.count({ where: { episodeId } })).toBe(11);

    const repeated = await recalculateModelEpisode({ episodeId, now });
    expect(repeated).toEqual(observedRun);
    expect(await prisma.dailyModelState.count({ where: { episodeId } })).toBe(11);
  });

  it("persists a long unknown interval, exposes later observations, and heals on backfill", async () => {
    const gapDates = [
      "2041-03-23", "2041-03-24", "2041-03-25", "2041-03-26",
      "2041-03-27", "2041-03-28", "2041-03-29",
    ];
    const frozenBefore = await prisma.modelEpisode.findUniqueOrThrow({ where: { id: episodeId } });
    await prisma.healthSyncSnapshot.deleteMany({ where: { date: { in: gapDates } } });
    await prisma.workInterval.deleteMany({ where: { date: { in: gapDates } } });
    await prisma.dailyHealthData.deleteMany({ where: { date: { in: gapDates } } });

    const unresolved = await recalculateModelEpisode({ episodeId, now });
    expect(unresolved).toMatchObject({
      episodeId,
      daysPersisted: 3,
      resolvedUntil: "2041-03-22",
      continuityStatus: "awaiting-recovery",
      recoveryRequired: true,
    });
    expect(await prisma.dailyModelState.findMany({
      where: { episodeId }, orderBy: { date: "asc" }, select: { date: true },
    })).toEqual([
      { date: "2041-03-20" }, { date: "2041-03-21" }, { date: "2041-03-22" },
    ]);
    const intervals = await prisma.modelUnknownInterval.findMany({ where: { episodeId } });
    expect(intervals).toHaveLength(1);
    expect(intervals[0]).toMatchObject({
      startDate: "2041-03-23",
      lastUnknownDate: "2041-03-29",
      endDate: "2041-03-29",
      anchorDate: "2041-03-22",
      firstPostGapObservationDate: "2041-03-30",
      postGapObservedDayCount: 1,
      recoveryRequired: true,
    });
    const frozenAfter = await prisma.modelEpisode.findUniqueOrThrow({ where: { id: episodeId } });
    expect(frozenAfter).toMatchObject({
      id: frozenBefore.id,
      active: true,
      baselineEnergyIntakeKcalPerDay: frozenBefore.baselineEnergyIntakeKcalPerDay,
      baselineCarbIntakeG: frozenBefore.baselineCarbIntakeG,
      baselineNutritionFallback: frozenBefore.baselineNutritionFallback,
      initialFatMassKg: frozenBefore.initialFatMassKg,
      initialLeanTissueKg: frozenBefore.initialLeanTissueKg,
      initialGlycogenKg: frozenBefore.initialGlycogenKg,
      personalOffsetKcalPerDay: frozenBefore.personalOffsetKcalPerDay,
      activityCalibration: frozenBefore.activityCalibration,
    });
    expect(await getModelStatus(episodeId)).toMatchObject({
      continuityStatus: "awaiting-recovery",
      lastResolvedDate: "2041-03-22",
      unknownIntervalCount: 1,
      unresolvedDayCount: 7,
      postGapObservedDayCount: 1,
    });
    const laterHistory = await getModelHistory({
      episodeId, from: finalDate, to: finalDate, limit: 90, offset: 0,
    });
    expect(laterHistory.days).toEqual([]);
    expect(laterHistory.unknownIntervals).toHaveLength(1);
    expect(laterHistory.observationsAwaitingRecovery.map(({ date }) => date)).toEqual([finalDate]);
    expect(await recalculateModelEpisode({ episodeId, now })).toEqual(unresolved);
    expect(await prisma.modelUnknownInterval.count({ where: { episodeId } })).toBe(1);

    await Promise.all(gapDates.map((date) => prisma.dailyHealthData.create({
      data: {
        date, weightKg: 80, bodyFatPercent: null, caloriesKcal: 2_450,
        proteinG: 150, fatG: 75, carbsG: 240, steps: 8_000,
        averageWalkingSpeedKmh: 5, walkingDistanceKm: 5,
        strengthTrainingMinutes: 0, rawPayload: { source: "phase-13.2-backfill" },
      },
    })));
    const healed = await recalculateModelEpisode({ episodeId, now });
    expect(healed).toMatchObject({
      daysPersisted: 11,
      resolvedUntil: finalDate,
      continuityStatus: "resolved",
      recoveryRequired: false,
      unknownIntervals: [],
    });
    expect(await prisma.modelUnknownInterval.count({ where: { episodeId } })).toBe(0);
    expect(await prisma.dailyModelState.count({ where: { episodeId } })).toBe(11);
  });

  it("persists an open trailing interval without including the unfinished local day", async () => {
    const gapDates = [
      "2041-03-24", "2041-03-25", "2041-03-26", "2041-03-27",
      "2041-03-28", "2041-03-29", "2041-03-30",
    ];
    await prisma.healthSyncSnapshot.deleteMany({ where: { date: { in: gapDates } } });
    await prisma.workInterval.deleteMany({ where: { date: { in: gapDates } } });
    await prisma.dailyHealthData.deleteMany({ where: { date: { in: gapDates } } });

    const recalculated = await recalculateModelEpisode({ episodeId, now });
    expect(recalculated).toMatchObject({
      episodeId,
      daysPersisted: 4,
      resolvedUntil: "2041-03-23",
      continuityStatus: "awaiting-recovery",
      recoveryRequired: true,
    });
    const interval = await prisma.modelUnknownInterval.findFirstOrThrow({ where: { episodeId } });
    expect(interval).toMatchObject({
      startDate: "2041-03-24",
      lastUnknownDate: finalDate,
      endDate: null,
      anchorDate: "2041-03-23",
      firstPostGapObservationDate: null,
      postGapObservedDayCount: 0,
    });
    expect(interval.lastUnknownDate).not.toBe("2041-03-31");
    expect(await prisma.dailyModelState.findMany({
      where: { episodeId }, orderBy: { date: "asc" }, select: { date: true },
    })).toEqual([
      { date: "2041-03-20" }, { date: "2041-03-21" },
      { date: "2041-03-22" }, { date: "2041-03-23" },
    ]);
  });

  it("synchronizes multiple gaps through partial backfill and complete healing", async () => {
    const firstGap = ["2041-03-23", "2041-03-24", "2041-03-25"];
    const secondGap = ["2041-03-27", "2041-03-28", "2041-03-29"];
    await prisma.dailyHealthData.updateMany({
      where: { date: { in: [...firstGap, ...secondGap] } },
      data: { caloriesKcal: null, proteinG: null, fatG: null, carbsG: null },
    });

    await recalculateModelEpisode({ episodeId, now });
    expect(await prisma.modelUnknownInterval.findMany({
      where: { episodeId }, orderBy: { startDate: "asc" },
      select: { startDate: true, lastUnknownDate: true, anchorDate: true },
    })).toEqual([
      { startDate: "2041-03-23", lastUnknownDate: "2041-03-25", anchorDate: "2041-03-22" },
      { startDate: "2041-03-27", lastUnknownDate: "2041-03-29", anchorDate: "2041-03-22" },
    ]);
    expect(await prisma.dailyModelState.count({ where: { episodeId } })).toBe(3);

    await prisma.dailyHealthData.update({
      where: { date: "2041-03-24" },
      data: { caloriesKcal: 2_450, proteinG: 150, fatG: 75, carbsG: 240 },
    });
    const partiallyHealed = await recalculateModelEpisode({ episodeId, now });
    expect(partiallyHealed).toMatchObject({
      daysPersisted: 7,
      resolvedUntil: "2041-03-26",
      continuityStatus: "awaiting-recovery",
    });
    expect(await prisma.modelUnknownInterval.findMany({
      where: { episodeId }, select: { startDate: true, anchorDate: true },
    })).toEqual([{ startDate: "2041-03-27", anchorDate: "2041-03-26" }]);
    expect(await prisma.dailyModelState.count({ where: { episodeId } })).toBe(7);

    await prisma.dailyHealthData.update({
      where: { date: "2041-03-28" },
      data: { caloriesKcal: 2_450, proteinG: 150, fatG: 75, carbsG: 240 },
    });
    const healed = await recalculateModelEpisode({ episodeId, now });
    expect(healed).toMatchObject({
      daysPersisted: 11,
      resolvedUntil: finalDate,
      continuityStatus: "resolved",
      recoveryRequired: false,
    });
    expect(await prisma.modelUnknownInterval.count({ where: { episodeId } })).toBe(0);
    expect(await prisma.dailyModelState.count({ where: { episodeId } })).toBe(11);
    expect(await prisma.dailyModelState.groupBy({
      by: ["date"], where: { episodeId }, having: { date: { _count: { gt: 1 } } },
    })).toEqual([]);
  });

  it("rolls back partial rows and episode metadata when persistence fails", async () => {
    await recalculateModelEpisode({ episodeId, now });
    const beforeRows = await prisma.dailyModelState.findMany({
      where: { episodeId }, orderBy: { date: "asc" },
      select: { date: true, endWeightKg: true, updatedAt: true },
    });
    const beforeEpisode = await prisma.modelEpisode.findUniqueOrThrow({ where: { id: episodeId } });
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION "model_episode_test_failure"()
      RETURNS trigger AS $$
      BEGIN
        IF NEW."date" = '2041-03-27' THEN
          RAISE EXCEPTION 'intentional model episode integration failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER "model_episode_test_failure"
      BEFORE INSERT OR UPDATE ON "DailyModelState"
      FOR EACH ROW EXECUTE FUNCTION "model_episode_test_failure"()
    `);
    try {
      await expect(recalculateModelEpisode({ episodeId, now })).rejects.toThrow();
    } finally {
      await prisma.$executeRawUnsafe('DROP TRIGGER "model_episode_test_failure" ON "DailyModelState"');
      await prisma.$executeRawUnsafe('DROP FUNCTION "model_episode_test_failure"()');
    }
    const afterRows = await prisma.dailyModelState.findMany({
      where: { episodeId }, orderBy: { date: "asc" },
      select: { date: true, endWeightKg: true, updatedAt: true },
    });
    const afterEpisode = await prisma.modelEpisode.findUniqueOrThrow({ where: { id: episodeId } });
    expect(afterRows).toEqual(beforeRows);
    expect(afterEpisode.updatedAt).toEqual(beforeEpisode.updatedAt);
    expect(afterEpisode.latestModeledDate).toBe(beforeEpisode.latestModeledDate);
  });

  it("cascades persisted daily state with its auditable episode relation", async () => {
    await recalculateModelEpisode({ episodeId, now });
    expect(await prisma.dailyModelState.count({ where: { episodeId } })).toBeGreaterThan(0);
    await prisma.modelEpisode.delete({ where: { id: episodeId } });
    expect(await prisma.dailyModelState.count({ where: { episodeId } })).toBe(0);
  });
});
