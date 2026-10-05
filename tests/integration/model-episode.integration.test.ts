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
import { serializeGoalPlanningResult } from "@/modules/model-goal-planning/goal-planning";
import type { GoalPlanningRequest } from "@/modules/model-goal-planning/goal-planning.schema";
import { solveModelEpisodeTarget } from "@/modules/model-target-solver/model-target-solver.service";
import { getModelDiagnostics } from "@/modules/model-diagnostics/model-diagnostics.service";
import { calculateStrengthActivity } from "@/model/activity/strength";
import { POST as postForecastAction } from "@/app/api/forecast/action/route";
import { experimentalForecastModelEpisode } from "@/modules/experimental-forecast-v1/service";
import { rebuildUnifiedExperimentalPhysiologyStateV1 } from "@/modules/model-episodes/unified-experimental-physiology-state.service";
import { PhysiologyV7PersistenceRepository } from "@/modules/model-episodes/physiology-v7-persistence.repository";
import { isProductionGenerationCurrentV1, isUnifiedGenerationCurrentV1 } from "@/modules/model-episodes/publication-generation-v1";
import { STAIR_CLIMBING_TYPE } from "@/modules/health/expand-training-workouts";
import { recordExperimentalStepperActiveEnergyShadow } from "@/modules/profile/experimental-stepper-active-energy-shadow.service";

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

function targetRequest(targetValueKg: number, goalDate: string, requestNow: Date) {
  return {
    episodeId, goal: { metric: "weightKg" as const, targetValueKg, goalDate },
    control: { type: "daily-calorie-center" as const,
      constraints: { minCaloriesKcal: 1_800, maxCaloriesKcal: 3_000 },
      nutritionAdjustmentPolicy: { type: "proportional-template" as const } },
    scenarioTemplate: fixedForecastScenario, seed: 1601,
    solverConfig: { searchPathCount: 8, finalPathCount: 32, coarseGridPoints: 3, maxEvaluations: 10 },
    now: requestNow,
  };
}

function goalPlanningRequest(targetValueKg: number, goalDate: string): GoalPlanningRequest {
  return {
    episodeId,
    goal: { metric: "weightKg", targetValueKg, goalDate },
    constraints: { minCaloriesKcal: 1_800, maxCaloriesKcal: 3_000 },
    scenarioTemplate: fixedForecastScenario,
    seed: 1601,
  };
}

async function removeTestData(): Promise<void> {
  const fixtureEpisodes = await prisma.modelEpisode.findMany({
    where: { startDate: { gte: testRangeStart, lte: finalDate } }, select: { id: true },
  });
  await prisma.unifiedExperimentalPhysiologyStateV2.deleteMany({
    where: { modelEpisodeId: { in: fixtureEpisodes.map(({ id }) => id) } },
  });
  await prisma.activeEnergyCanonicalEvent.deleteMany({
    where: { profileId: 1, modelDate: { gte: testRangeStart, lte: finalDate } },
  });
  await prisma.experimentalSkeletalMuscleDeltaShadow.deleteMany({
    where: { profileId: 1, date: { gte: testRangeStart, lte: finalDate } },
  });
  await prisma.experimentalCessationDetrainingShadow.deleteMany({
    where: { profileId: 1, date: { gte: testRangeStart, lte: finalDate } },
  });
  await prisma.healthActivityInterval.deleteMany({ where: { date: { gte: testRangeStart, lte: finalDate } } });
  await prisma.healthMetricSample.deleteMany({ where: { date: { gte: testRangeStart, lte: finalDate } } });
  await prisma.modelEpisode.deleteMany({
    where: { startDate: { gte: testRangeStart, lte: finalDate } },
  });
  await prisma.healthSyncSnapshot.deleteMany({
    where: { date: { gte: testRangeStart, lte: finalDate } },
  });
  await prisma.workInterval.deleteMany({
    where: { date: { gte: testRangeStart, lte: finalDate } },
  });
  await prisma.workout.deleteMany({
    where: { dailyHealthData: { date: { gte: testRangeStart, lte: finalDate } } },
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
        strengthTrainingMinutes: 30,
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
    await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS "transient_partition_test_failure" ON "ModelEpisode"');
    await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS "transient_partition_test_failure"()');
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
      modelVersion: "bodycast-physiology-v7",
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
    const episodeLocalDiagnostic = await prisma.experimentalCessationDetrainingShadow.findUnique({
      where: { profileId_modelEpisodeId_date: { profileId: 1, modelEpisodeId: replacement.id, date: episodeStart } },
    });
    expect(episodeLocalDiagnostic?.isStale).toBe(false);
    expect((episodeLocalDiagnostic?.result as { state?: { relativeCumulativeDeltaKg?: unknown } } | undefined)
      ?.state?.relativeCumulativeDeltaKg).toBe(0);
    expect((await prisma.modelEpisode.findUniqueOrThrow({ where: { id: episodeId } })).active)
      .toBe(false);
    await expect(prisma.modelEpisode.update({
      where: { id: episodeId }, data: { active: true, deactivatedAt: null },
    })).rejects.toThrow();
  });

  it("invalidates only Unified currentness when initializeNewModelEpisode changes the partition", async () => {
    // Use the same post-commit orchestration as production so the persisted
    // FatWeight child output exists before Unified/Forecast read it.
    await recalculateModelEpisode({ episodeId, now });
    const currentRelativeState = await prisma.experimentalCessationDetrainingShadow.findFirst({
      where: { profileId: 1, modelEpisodeId: episodeId, isStale: false },
      orderBy: { date: "desc" },
    });
    expect(currentRelativeState).not.toBeNull();
    expect(currentRelativeState?.modelEpisodeId).toBe(episodeId);
    expect((currentRelativeState?.result as { state?: { relativeCumulativeDeltaKg?: unknown } } | undefined)
      ?.state?.relativeCumulativeDeltaKg).not.toBeUndefined();
    await rebuildUnifiedExperimentalPhysiologyStateV1({ profileId: 1, fromDate: episodeStart, toDate: finalDate });
    const request = { episodeId, horizonDays: 7, seed: 443, scenario: fixedForecastScenario, now };
    expect(await experimentalForecastModelEpisode(request, prisma)).not.toBeNull();
    const beforeLifecycle = await prisma.physiologyV7Lifecycle.findUniqueOrThrow({
      where: { profileId: 1 },
      select: {
        invalidationGeneration: true, currentThroughDate: true, productionStaleFromDate: true,
        productionPublishedGeneration: true, unifiedPublishedGeneration: true,
      },
    });
    expect(isUnifiedGenerationCurrentV1(beforeLifecycle)).toBe(true);
    const beforeProductionRows = await prisma.physiologyV7DailyResult.findMany({
      where: { profileId: 1 }, orderBy: { date: "asc" }, select: { date: true, resultFingerprint: true, updatedAt: true },
    });

    const replacement = await initializeNewModelEpisode({ startDate: finalDate, now });

    const afterLifecycle = await prisma.physiologyV7Lifecycle.findUniqueOrThrow({
      where: { profileId: 1 },
      select: {
        invalidationGeneration: true, currentThroughDate: true, productionStaleFromDate: true,
        productionPublishedGeneration: true, unifiedPublishedGeneration: true,
      },
    });
    expect(afterLifecycle).toEqual({ ...beforeLifecycle, unifiedPublishedGeneration: null });
    expect(isProductionGenerationCurrentV1(afterLifecycle)).toBe(true);
    expect(isUnifiedGenerationCurrentV1(afterLifecycle)).toBe(false);
    expect(await prisma.physiologyV7DailyResult.findMany({
      where: { profileId: 1 }, orderBy: { date: "asc" }, select: { date: true, resultFingerprint: true, updatedAt: true },
    })).toEqual(beforeProductionRows);
    expect(await experimentalForecastModelEpisode(request, prisma)).toBeNull();

    await rebuildUnifiedExperimentalPhysiologyStateV1({ profileId: 1, fromDate: episodeStart, toDate: finalDate });
    const republished = await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId: 1 } });
    expect(isUnifiedGenerationCurrentV1(republished)).toBe(true);
    expect(await experimentalForecastModelEpisode({ ...request, episodeId: replacement.id }, prisma)).not.toBeNull();
  }, 60_000);

  it("rolls back Unified invalidation when initializeNewModelEpisode partition mutation fails", async () => {
    await recalculateModelEpisode({ episodeId, now });
    await rebuildUnifiedExperimentalPhysiologyStateV1({ profileId: 1, fromDate: episodeStart, toDate: finalDate });
    const request = { episodeId, horizonDays: 7, seed: 443, scenario: fixedForecastScenario, now };
    expect(await experimentalForecastModelEpisode(request, prisma)).not.toBeNull();
    const beforeLifecycle = await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId: 1 } });
    const beforePartition = await prisma.modelEpisode.findMany({
      where: { profileId: 1, startDate: { gte: testRangeStart, lte: finalDate } },
      orderBy: [{ startDate: "asc" }, { id: "asc" }],
    });
    const beforeProductionRows = await prisma.physiologyV7DailyResult.findMany({
      where: { profileId: 1 }, orderBy: { date: "asc" },
    });

    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION "transient_partition_test_failure"() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'forced ModelEpisode partition mutation rollback'; END;
      $$ LANGUAGE plpgsql
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER "transient_partition_test_failure"
      BEFORE UPDATE OF "active" ON "ModelEpisode"
      FOR EACH ROW WHEN (OLD."active" IS TRUE AND NEW."active" IS FALSE)
      EXECUTE FUNCTION "transient_partition_test_failure"()
    `);
    try {
      await expect(initializeNewModelEpisode({ startDate: finalDate, now })).rejects.toThrow(/forced ModelEpisode partition mutation rollback/);
    } finally {
      await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS "transient_partition_test_failure" ON "ModelEpisode"');
      await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS "transient_partition_test_failure"()');
    }

    expect(await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId: 1 } })).toEqual(beforeLifecycle);
    expect(isUnifiedGenerationCurrentV1(beforeLifecycle)).toBe(true);
    expect(await prisma.modelEpisode.findMany({
      where: { profileId: 1, startDate: { gte: testRangeStart, lte: finalDate } },
      orderBy: [{ startDate: "asc" }, { id: "asc" }],
    })).toEqual(beforePartition);
    expect(await prisma.physiologyV7DailyResult.findMany({
      where: { profileId: 1 }, orderBy: { date: "asc" },
    })).toEqual(beforeProductionRows);
    expect(await experimentalForecastModelEpisode(request, prisma)).not.toBeNull();
  }, 60_000);

  it("invalidates Unified currentness on the automatic restart path without staling production", async () => {
    // The first publication ends before the later BIA-backed run. Advancing
    // the model horizon then gives the real automatic restart a later boundary
    // while keeping the resulting episode partition chronological.
    const initialNow = new Date("2041-03-25T10:00:00.000Z");
    const initialThroughDate = "2041-03-24";
    await prisma.dailyHealthData.updateMany({
      where: { date: { gte: "2041-03-14", lte: episodeStart } },
      data: { bodyFatPercent: null },
    });
    await prisma.dailyHealthData.updateMany({
      where: { date: { gte: "2041-03-25", lte: finalDate } },
      data: { bodyFatPercent: 20 },
    });

    await recalculateModelEpisode({ episodeId, now: initialNow });
    await rebuildUnifiedExperimentalPhysiologyStateV1({ profileId: 1, fromDate: episodeStart, toDate: initialThroughDate });
    const beforeLifecycle = await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId: 1 } });
    expect(isUnifiedGenerationCurrentV1(beforeLifecycle)).toBe(true);
    const request = { episodeId, horizonDays: 7, seed: 443, scenario: fixedForecastScenario, now: initialNow };
    expect(await experimentalForecastModelEpisode(request, prisma)).not.toBeNull();
    const beforeProductionPrefix = await prisma.physiologyV7DailyResult.findMany({
      where: { profileId: 1, date: { lte: initialThroughDate } }, orderBy: { date: "asc" },
    });

    // The optional client deliberately exercises the production service's
    // automatic-restart branch directly; the standard wrapper uses an
    // explicit active episode id while coordinating Active Energy refreshes.
    const result = await recalculateModelEpisode({ now }, prisma);

    expect(result.episodeId).not.toBe(episodeId);
    const afterLifecycle = await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId: 1 } });
    expect(afterLifecycle.invalidationGeneration).toBe(beforeLifecycle.invalidationGeneration);
    expect(afterLifecycle.productionStaleFromDate).toBe(beforeLifecycle.productionStaleFromDate);
    expect(afterLifecycle.productionPublishedGeneration).toBe(afterLifecycle.invalidationGeneration);
    expect(afterLifecycle.unifiedPublishedGeneration).toBeNull();
    expect(isProductionGenerationCurrentV1(afterLifecycle)).toBe(true);
    expect(isUnifiedGenerationCurrentV1(afterLifecycle)).toBe(false);
    expect(await prisma.physiologyV7DailyResult.findMany({
      where: { profileId: 1, date: { lte: initialThroughDate } }, orderBy: { date: "asc" },
    })).toEqual(beforeProductionPrefix);
    expect(await experimentalForecastModelEpisode(request, prisma)).toBeNull();
    const restartedRequest = { ...request, episodeId: result.episodeId, now };
    expect(await experimentalForecastModelEpisode(restartedRequest, prisma)).toBeNull();

    // Re-run the restarted episode through normal orchestration to materialize
    // its post-commit child shadows before Unified V2 consumes them.
    await recalculateModelEpisode({ episodeId: result.episodeId, now });
    const productionRepublished = await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId: 1 } });
    expect(isProductionGenerationCurrentV1(productionRepublished)).toBe(true);
    expect(isUnifiedGenerationCurrentV1(productionRepublished)).toBe(false);
    expect(await experimentalForecastModelEpisode(restartedRequest, prisma)).toBeNull();

    await rebuildUnifiedExperimentalPhysiologyStateV1({ profileId: 1, fromDate: episodeStart, toDate: finalDate });
    const republished = await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId: 1 } });
    expect(isProductionGenerationCurrentV1(republished)).toBe(true);
    expect(isUnifiedGenerationCurrentV1(republished)).toBe(true);
    expect(republished.unifiedPublishedGeneration).toBe(republished.invalidationGeneration);
    expect(await experimentalForecastModelEpisode(restartedRequest, prisma)).not.toBeNull();
  }, 60_000);

  it("rejects a 4-day restart candidate, preserves stored rows, and fails closed while production is stale", async () => {
    const baselineNow = new Date("2041-03-30T10:00:00.000Z");
    const candidateNow = new Date("2041-03-31T10:00:00.000Z");
    await prisma.modelEpisode.update({ where: { id: episodeId }, data: { startDate: "2041-03-02" } });
    const baseline = await recalculateModelEpisode({ episodeId, now: baselineNow }, prisma);
    expect(baseline).toMatchObject({ latestModeledDate: "2041-03-29", completeDays: 28 });
    const baselineDiagnostics = await getModelDiagnostics(prisma);
    expect(baselineDiagnostics.currentState.status).toBe("available");
    expect(baselineDiagnostics.dataContinuity.completeDayCount).toBe(28);

    await prisma.dailyHealthData.updateMany({
      where: { date: { gte: "2041-03-02", lte: "2041-03-25" } },
      data: { steps: null, walkingDistanceKm: null },
    });
    await prisma.dailyHealthData.update({
      where: { date: "2041-03-26" }, data: { bodyFatPercent: 20 },
    });
    await prisma.dailyHealthData.update({
      where: { date: "2041-03-30" }, data: { steps: null, walkingDistanceKm: null },
    });

    const before = {
      episode: await prisma.modelEpisode.findUniqueOrThrow({ where: { id: episodeId } }),
      states: await prisma.dailyModelState.findMany({ where: { episodeId }, orderBy: { date: "asc" } }),
      intervals: await prisma.modelUnknownInterval.findMany({ where: { episodeId }, orderBy: { startDate: "asc" } }),
      episodes: await prisma.modelEpisode.count({ where: { startDate: { gte: testRangeStart, lte: finalDate } } }),
    };

    const first = await recalculateModelEpisode({ now: candidateNow }, prisma);
    expect(first.episodeId).toBe(episodeId);
    expect(first.current).toMatchObject({ latestModeledDate: null, daysModeled: 0 });
    const afterFirst = {
      episode: await prisma.modelEpisode.findUniqueOrThrow({ where: { id: episodeId } }),
      states: await prisma.dailyModelState.findMany({ where: { episodeId }, orderBy: { date: "asc" } }),
      intervals: await prisma.modelUnknownInterval.findMany({ where: { episodeId }, orderBy: { startDate: "asc" } }),
      episodes: await prisma.modelEpisode.count({ where: { startDate: { gte: testRangeStart, lte: finalDate } } }),
    };
    expect(afterFirst).toEqual(before);
    const afterDiagnostics = await getModelDiagnostics(prisma);
    expect(afterDiagnostics.currentState.status).toBe("unavailable");
    expect(afterDiagnostics.dataContinuity.completeDayCount).toBe(28);

    const repeated = await recalculateModelEpisode({ now: candidateNow }, prisma);
    expect(repeated.episodeId).toBe(episodeId);
    expect(repeated.current).toMatchObject({ latestModeledDate: null, daysModeled: 0 });
    expect(await prisma.modelEpisode.count({ where: { startDate: { gte: testRangeStart, lte: finalDate } } }))
      .toBe(before.episodes);
    expect(await prisma.dailyModelState.findMany({ where: { episodeId }, orderBy: { date: "asc" } }))
      .toEqual(before.states);
  });

  it("continues route recovery on the existing active episode after rejecting a replacement", async () => {
    const candidateNow = new Date("2041-03-31T10:00:00.000Z");
    await prisma.modelEpisode.update({ where: { id: episodeId }, data: { startDate: "2041-03-02" } });
    await recalculateModelEpisode({ episodeId, now: candidateNow }, prisma);
    await prisma.dailyHealthData.update({
      where: { date: "2041-03-30" }, data: { steps: null, walkingDistanceKm: null },
    });
    const current = await recalculateModelEpisode({ episodeId, now: candidateNow }, prisma);
    expect(current).toMatchObject({ episodeId, recoveryRequired: true });

    const before = await prisma.modelEpisode.findUniqueOrThrow({ where: { id: episodeId } });
    const episodeCount = await prisma.modelEpisode.count({
      where: { startDate: { gte: testRangeStart, lte: finalDate } },
    });
    const previousQaMode = process.env.BODYCAST_QA_MODE;
    const previousQaNow = process.env.BODYCAST_QA_NOW;
    process.env.BODYCAST_QA_MODE = "1";
    process.env.BODYCAST_QA_NOW = candidateNow.toISOString();

    let response: Response;
    try {
      response = await postForecastAction(new Request("http://localhost/api/forecast/action", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "recalculate" }),
      }));
    } finally {
      if (previousQaMode === undefined) delete process.env.BODYCAST_QA_MODE;
      else process.env.BODYCAST_QA_MODE = previousQaMode;
      if (previousQaNow === undefined) delete process.env.BODYCAST_QA_NOW;
      else process.env.BODYCAST_QA_NOW = previousQaNow;
    }

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toMatchObject({ episodeId, recoveryRequired: true });
    expect(payload).toHaveProperty("recovery");

    const after = await prisma.modelEpisode.findUniqueOrThrow({ where: { id: episodeId } });
    expect(after).toMatchObject({ id: before.id, startDate: before.startDate, active: true });
    expect(await prisma.modelEpisode.count({ where: { active: true } })).toBe(1);
    expect(await prisma.modelEpisode.count({
      where: { startDate: { gte: testRangeStart, lte: finalDate } },
    })).toBe(episodeCount);
  });

  it("switches only to a strictly improved candidate and does not churn on the next recalculate", async () => {
    const switched = await recalculateModelEpisode({ now }, prisma);
    expect(switched.episodeId).not.toBe(episodeId);
    expect(await prisma.modelEpisode.findUniqueOrThrow({ where: { id: episodeId } })).toMatchObject({
      active: false,
    });
    expect(await prisma.modelEpisode.findUniqueOrThrow({ where: { id: switched.episodeId } })).toMatchObject({
      active: true,
      modelVersion: "bodycast-physiology-v7",
    });
    const countAfterSwitch = await prisma.modelEpisode.count({
      where: { startDate: { gte: testRangeStart, lte: finalDate } },
    });
    const repeated = await recalculateModelEpisode({
      now: new Date(now.getTime() + 5 * 60_000),
    }, prisma);
    expect(repeated.episodeId).toBe(switched.episodeId);
    expect(await prisma.modelEpisode.count({
      where: { startDate: { gte: testRangeStart, lte: finalDate } },
    })).toBe(countAfterSwitch);
    expect(await prisma.modelEpisode.count({ where: { active: true } })).toBe(1);
  });

  it("does not switch on a readiness tie, including repeated recalculation", async () => {
    await prisma.modelEpisode.update({ where: { id: episodeId }, data: { startDate: "2041-03-14" } });
    const current = await recalculateModelEpisode({ episodeId, now }, prisma);
    expect(current).toMatchObject({ latestModeledDate: finalDate, completeDays: 17 });
    await prisma.modelEpisode.update({
      where: { id: episodeId }, data: { modelVersion: "bodycast-physiology-v6" },
    });
    const before = {
      episode: await prisma.modelEpisode.findUniqueOrThrow({ where: { id: episodeId } }),
      states: await prisma.dailyModelState.findMany({ where: { episodeId }, orderBy: { date: "asc" } }),
      episodes: await prisma.modelEpisode.count({ where: { startDate: { gte: testRangeStart, lte: finalDate } } }),
    };

    const first = await recalculateModelEpisode({ now }, prisma);
    const repeated = await recalculateModelEpisode({ now }, prisma);
    expect(first.episodeId).toBe(episodeId);
    expect(repeated.episodeId).toBe(episodeId);
    expect(await prisma.modelEpisode.findUniqueOrThrow({ where: { id: episodeId } })).toEqual(before.episode);
    expect(await prisma.dailyModelState.findMany({ where: { episodeId }, orderBy: { date: "asc" } }))
      .toEqual(before.states);
    expect(await prisma.modelEpisode.count({ where: { startDate: { gte: testRangeStart, lte: finalDate } } }))
      .toBe(before.episodes);
    expect(await prisma.modelEpisode.count({ where: { active: true } })).toBe(1);
  });

  it("keeps one active episode during concurrent automatic recalculations", async () => {
    const outcomes = await Promise.allSettled([
      recalculateModelEpisode({ now }, prisma),
      recalculateModelEpisode({ now: new Date(now.getTime() + 1_000) }, prisma),
    ]);
    expect(outcomes).toHaveLength(2);
    expect(outcomes.some((outcome) => outcome.status === "fulfilled")).toBe(true);
    for (const outcome of outcomes) {
      if (outcome.status === "rejected") {
        // No automatic retry: a losing SERIALIZABLE transaction fails closed.
        const reason = outcome.reason as { code?: unknown; meta?: unknown };
        expect(["P2034", "P2010"]).toContain(reason.code);
        if (reason.code === "P2010") {
          expect(reason.meta).toMatchObject({ code: "40001" });
        }
      }
    }
    expect(await prisma.modelEpisode.count({ where: { active: true } })).toBe(1);
    expect(await prisma.modelEpisode.count({ where: { startDate: { gte: testRangeStart, lte: finalDate } } }))
      .toBeLessThanOrEqual(2);
  });

  it("treats missing strength records as rest days instead of stopping the model prefix", async () => {
    const restDates = ["2041-03-25", "2041-03-27"];
    await prisma.dailyHealthData.updateMany({
      where: { date: { in: restDates } },
      data: { strengthTrainingMinutes: null, workoutFeedObserved: false },
    });

    const recalculated = await recalculateModelEpisode({ episodeId, now });
    expect(recalculated).toMatchObject({
      daysPersisted: 11,
      resolvedUntil: finalDate,
      continuityStatus: "resolved",
      recoveryRequired: false,
      unknownIntervals: [],
    });
    expect(await prisma.dailyModelState.count({ where: { episodeId, status: "complete" } })).toBe(11);
    expect(await prisma.modelUnknownInterval.count({ where: { episodeId } })).toBe(0);
  });

  it("reads compact diagnostics from PostgreSQL without mutating model records", async () => {
    const before = {
      episode: await prisma.modelEpisode.findUniqueOrThrow({ where: { id: episodeId } }),
      stateCount: await prisma.dailyModelState.count({ where: { episodeId } }),
      recoveryCount: await prisma.modelRecoveryRun.count({ where: { episodeId } }),
    };
    const diagnostics = await getModelDiagnostics(prisma);
    const after = {
      episode: await prisma.modelEpisode.findUniqueOrThrow({ where: { id: episodeId } }),
      stateCount: await prisma.dailyModelState.count({ where: { episodeId } }),
      recoveryCount: await prisma.modelRecoveryRun.count({ where: { episodeId } }),
    };
    expect(diagnostics.episode.id).toBe(episodeId);
    expect(diagnostics.dataContinuity).toMatchObject({
      recentWindowDays: 28,
      noWorkIntervalSemantics: "zero-occupational-work-not-missing",
    });
    expect(diagnostics.currentState.status).toBe("unavailable");
    expect(diagnostics.forecastReadiness).toMatchObject({ allowed: false, reasons: ["current-state-unavailable"] });
    expect(JSON.stringify(diagnostics)).not.toMatch(/ensemble|posteriorSummary|observationDates|topParticleOrigins/);
    expect(after).toEqual(before);
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
      forecastVersion: "bodycast-forecast-v1", modelVersion: "bodycast-physiology-v7",
    });
    expect("dates" in first && first.dates).toHaveLength(30);
    expect(await prisma.modelEpisode.findUniqueOrThrow({ where: { id: episodeId } }))
      .toEqual(beforeEpisode);
    expect(await prisma.dailyModelState.findMany({
      where: { episodeId }, orderBy: { date: "asc" },
    })).toEqual(beforeStates);
    expect(await prisma.modelRecoveryRun.count({ where: { episodeId } })).toBe(0);
  });

  it("uses only current production and Unified generations for the Forecast V1 historical anchor", async () => {
    const currentProduction = await recalculateModelEpisode({ episodeId, now });
    expect(currentProduction.episodeId).toBe(episodeId);
    const productionLifecycle = await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId: 1 } });
    expect(productionLifecycle.productionPublishedGeneration).toBe(productionLifecycle.invalidationGeneration);
    expect(productionLifecycle.productionStaleFromDate).toBeNull();

    await rebuildUnifiedExperimentalPhysiologyStateV1({ profileId: 1, fromDate: episodeStart, toDate: finalDate });
    const request = { episodeId, horizonDays: 7, seed: 443, scenario: fixedForecastScenario, now };
    const currentAnchor = await experimentalForecastModelEpisode(request, prisma);
    expect(currentAnchor).not.toBeNull();
    expect(currentAnchor && "dates" in currentAnchor && currentAnchor.dates[0]?.date).toBe("2041-03-31");
    const unifiedLifecycle = await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId: 1 } });
    expect(unifiedLifecycle.unifiedPublishedGeneration).toBe(unifiedLifecycle.invalidationGeneration);

    await prisma.$transaction(async (tx) => {
      await new PhysiologyV7PersistenceRepository(tx).invalidate(1, finalDate);
    });
    const invalidatedAnchor = await experimentalForecastModelEpisode(request, prisma);
    expect(invalidatedAnchor).toBeNull();

    await recalculateModelEpisode({ episodeId, now });
    const productionOnly = await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId: 1 } });
    expect(productionOnly.productionPublishedGeneration).toBe(productionOnly.invalidationGeneration);
    expect(productionOnly.productionStaleFromDate).toBeNull();
    expect(productionOnly.unifiedPublishedGeneration).not.toBe(productionOnly.invalidationGeneration);
    expect(await experimentalForecastModelEpisode(request, prisma)).toBeNull();

    await rebuildUnifiedExperimentalPhysiologyStateV1({ profileId: 1, fromDate: finalDate, toDate: finalDate });
    const republishedAnchor = await experimentalForecastModelEpisode(request, prisma);
    expect(republishedAnchor).not.toBeNull();
    expect(republishedAnchor && "dates" in republishedAnchor && republishedAnchor.dates[0]?.date).toBe("2041-03-31");
  }, 60_000);

  it("refreshes an unavailable Stepper candidate after replay creates its D-1 model mass", async () => {
    const workoutDate = finalDate;
    const predecessorDate = addCalendarDays(workoutDate, -1);
    const workoutStart = new Date("2041-03-30T08:00:00.000Z");
    const workoutEnd = new Date("2041-03-30T08:20:00.000Z");
    const massWindowStart = addCalendarDays(workoutDate, -7);
    await prisma.dailyHealthData.updateMany({
      where: { date: { gte: massWindowStart, lte: workoutDate } },
      data: { weightKg: null },
    });
    expect(await prisma.healthMetricSample.count({
      where: { metric: "weight-kg", date: { gte: massWindowStart, lte: addCalendarDays(workoutDate, 7) } },
    })).toBe(0);
    await prisma.workout.deleteMany({ where: { sourceIdentity: "active-energy-stepper-post-replay" } });
    const health = await prisma.dailyHealthData.findUniqueOrThrow({ where: { date: workoutDate } });
    const workout = await prisma.workout.create({
      data: {
        dailyHealthDataId: health.id,
        sourceIdentity: "active-energy-stepper-post-replay",
        type: STAIR_CLIMBING_TYPE,
        startAt: workoutStart,
        endAt: workoutEnd,
        durationMinutes: 20,
        activeEnergyKcal: 90,
      },
    });
    await prisma.healthActivityInterval.createMany({
      data: [400, 350, 450, 400].map((value, index) => ({
        date: workoutDate,
        metric: "steps",
        startAt: new Date(workoutStart.getTime() + index * 5 * 60_000),
        endAt: new Date(workoutStart.getTime() + (index + 1) * 5 * 60_000),
        value,
        sourceFingerprint: `active-energy-post-replay-${index}`,
      })),
    });
    const lifecycle = await prisma.$transaction(async (tx) => {
      const repository = new PhysiologyV7PersistenceRepository(tx);
      await repository.ensureLifecycle(1, workoutDate);
      return tx.physiologyV7Lifecycle.update({
        where: { profileId: 1 },
        data: {
          staleFromDate: workoutDate,
          productionStaleFromDate: workoutDate,
          currentThroughDate: predecessorDate,
          productionPublishedGeneration: null,
          unifiedPublishedGeneration: null,
          invalidationGeneration: { increment: 1 },
        },
      });
    });
    const initialGeneration = lifecycle.invalidationGeneration;

    await recordExperimentalStepperActiveEnergyShadow({ workoutId: workout.id, profileId: 1 });
    const initialShadow = await prisma.experimentalStepperActiveEnergyShadow.findUniqueOrThrow({ where: { workoutId: workout.id } });
    expect(initialShadow.result).toMatchObject({
      availability: "unavailable",
      unavailableReason: "missing-body-mass",
      massReference: { status: "unavailable" },
    });
    const beforeResolution = await prisma.activeEnergyCanonicalEvent.findFirstOrThrow({
      where: { profileId: 1, aliases: { some: { sourceType: "workout", sourceId: String(workout.id) } } },
    });
    expect(beforeResolution.currentSource).toBe("device-kcal");

    const result = await recalculateModelEpisode({ episodeId, now });
    expect(result.episodeId).toBe(episodeId);
    expect(result.latestModeledDate).toBe(finalDate);
    const predecessor = await prisma.dailyModelState.findUniqueOrThrow({
      where: { episodeId_date: { episodeId, date: predecessorDate } },
    });
    expect(predecessor.status).toBe("complete");
    expect(predecessor.filteredWeightKg).not.toBeNull();
    const refreshedShadow = await prisma.experimentalStepperActiveEnergyShadow.findUniqueOrThrow({ where: { workoutId: workout.id } });
    const initialResult = initialShadow.result as { inputFingerprint: string };
    const refreshedResult = refreshedShadow.result as {
      availability: string;
      estimatedActiveKcal: number | null;
      inputFingerprint: string;
      massReference: { status: string; sourceDate: string | null; sourceId: string | null };
    };
    expect(refreshedResult.availability).toBe("available");
    expect(refreshedResult.estimatedActiveKcal).toBeGreaterThan(0);
    expect(refreshedResult.inputFingerprint).not.toBe(initialResult.inputFingerprint);
    expect(refreshedResult.massReference).toMatchObject({ status: "model-estimated", sourceDate: predecessorDate });
    expect(refreshedResult.massReference.sourceId).toContain("daily-model-state:");

    const finalEvent = await prisma.activeEnergyCanonicalEvent.findFirstOrThrow({
      where: { profileId: 1, aliases: { some: { sourceType: "workout", sourceId: String(workout.id) } } },
      include: { resolutions: { orderBy: { revision: "asc" } } },
    });
    expect(finalEvent.currentSource).toBe("bodycast-stepper-mechanical");
    expect(finalEvent.currentKcal).toBe(refreshedResult.estimatedActiveKcal);
    expect(finalEvent.resolutions.at(-1)?.provenance).toMatchObject({
      evidence: { massReference: { status: "model-estimated", sourceDate: predecessorDate } },
    });
    const finalLifecycle = await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId: 1 } });
    expect(finalLifecycle.productionPublishedGeneration).toBe(finalLifecycle.invalidationGeneration);
    expect(finalLifecycle.productionStaleFromDate).toBeNull();
    expect(finalLifecycle.invalidationGeneration - initialGeneration).toBeLessThanOrEqual(4);

    await prisma.activeEnergyCanonicalEvent.deleteMany({ where: { id: finalEvent.id } });
    await prisma.workout.delete({ where: { id: workout.id } });
    await prisma.healthActivityInterval.deleteMany({ where: { sourceFingerprint: { startsWith: "active-energy-post-replay-" } } });
  }, 60_000);

  it("persists a compatible production suffix without touching its prefix and falls back to full replay when incompatible", async () => {
    const dirtyDate = "2041-03-27";
    const predecessorDate = addCalendarDays(dirtyDate, -1);
    await recalculateModelEpisode({ episodeId, now });

    const readStates = () => prisma.dailyModelState.findMany({
      where: { episodeId }, orderBy: { date: "asc" },
    });
    const prefixProjection = (rows: Awaited<ReturnType<typeof readStates>>) => rows
      .filter((row) => row.date < dirtyDate)
      .map((row) => ({
        id: row.id,
        date: row.date,
        status: row.status,
        sourceQuality: row.sourceQuality,
        filteredWeightKg: row.filteredWeightKg,
        weightFilterVarianceKg2: row.weightFilterVarianceKg2,
        fatMassKg: row.fatMassKg,
        leanTissueKg: row.leanTissueKg,
        glycogenKg: row.glycogenKg,
        dynamicRmrKcalPerDay: row.dynamicRmrKcalPerDay,
        updatedAt: row.updatedAt,
      }));
    const outputProjection = (rows: Awaited<ReturnType<typeof readStates>>) => rows
      .filter((row) => row.date >= dirtyDate)
      .map((row) => Object.fromEntries(Object.entries({
          id: row.id,
          date: row.date,
          status: row.status,
          modelVersion: row.modelVersion,
          sourceQuality: row.sourceQuality,
          startWeightKg: row.startWeightKg,
          endWeightKg: row.endWeightKg,
          filteredWeightKg: row.filteredWeightKg,
          weightFilterVarianceKg2: row.weightFilterVarianceKg2,
          fatMassKg: row.fatMassKg,
          leanTissueKg: row.leanTissueKg,
          glycogenKg: row.glycogenKg,
          extracellularFluidDeviationLiters: row.extracellularFluidDeviationLiters,
          adaptiveThermogenesisKcalPerDay: row.adaptiveThermogenesisKcalPerDay,
          dynamicRmrKcalPerDay: row.dynamicRmrKcalPerDay,
          tefKcalPerDay: row.tefKcalPerDay,
          activityKcalPerDay: row.activityKcalPerDay,
          energyIntakeKcal: row.energyIntakeKcal,
          energyExpenditureKcal: row.energyExpenditureKcal,
          energyBalanceKcal: row.energyBalanceKcal,
          deltaFatKg: row.deltaFatKg,
          deltaLeanTissueKg: row.deltaLeanTissueKg,
          deltaGlycogenKg: row.deltaGlycogenKg,
        }).map(([key, value]) => [key, typeof value === "number" ? Number(value.toFixed(9)) : value])));
    const invalidate = async (date: string) => prisma.$transaction(async (tx) => {
      await new PhysiologyV7PersistenceRepository(tx).invalidate(1, date);
    });

    const fullRows = await readStates();
    expect(fullRows.find((row) => row.date === predecessorDate)?.weightFilterVarianceKg2).not.toBeNull();
    const prefixBeforeSuffix = prefixProjection(fullRows);
    await invalidate(dirtyDate);
    await recalculateModelEpisode({ episodeId, now });
    const suffixRows = await readStates();
    expect(prefixProjection(suffixRows)).toEqual(prefixBeforeSuffix);

    const suffixOutput = outputProjection(suffixRows);
    await invalidate(episodeStart);
    await recalculateModelEpisode({ episodeId, now });
    const equivalentFullRows = await readStates();
    expect(outputProjection(equivalentFullRows)).toEqual(suffixOutput);

    const predecessorBeforeNullVariance = equivalentFullRows.find((row) => row.date === predecessorDate)!;
    await prisma.dailyModelState.update({
      where: { episodeId_date: { episodeId, date: predecessorDate } },
      data: { weightFilterVarianceKg2: null },
    });
    await invalidate(dirtyDate);
    await recalculateModelEpisode({ episodeId, now });
    const nullVarianceFallback = await readStates();
    expect(nullVarianceFallback.find((row) => row.date === predecessorDate)?.weightFilterVarianceKg2).not.toBeNull();
    expect(nullVarianceFallback.find((row) => row.date === predecessorDate)?.updatedAt.getTime())
      .toBeGreaterThan(predecessorBeforeNullVariance.updatedAt.getTime());

    const beforeCalibrationFallback = await readStates();
    await prisma.modelEpisode.update({
      where: { id: episodeId }, data: { calibrationDiagnostics: { calibrationInputFingerprint: "incompatible-calibration-fixture" } },
    });
    await invalidate(dirtyDate);
    await recalculateModelEpisode({ episodeId, now });
    const calibrationFallback = await readStates();
    expect(calibrationFallback.find((row) => row.date === predecessorDate)?.updatedAt.getTime())
      .toBeGreaterThan(beforeCalibrationFallback.find((row) => row.date === predecessorDate)!.updatedAt.getTime());

    const beforeModelVersionFallback = await readStates();
    await prisma.modelEpisode.update({ where: { id: episodeId }, data: { modelVersion: "bodycast-physiology-v6" } });
    await invalidate(dirtyDate);
    await recalculateModelEpisode({ episodeId, now });
    const modelVersionFallback = await readStates();
    expect(modelVersionFallback.find((row) => row.date === predecessorDate)?.modelVersion).toBe("bodycast-physiology-v6");
    expect(modelVersionFallback.find((row) => row.date === predecessorDate)?.updatedAt.getTime())
      .toBeGreaterThan(beforeModelVersionFallback.find((row) => row.date === predecessorDate)!.updatedAt.getTime());
  }, 120_000);

  it("solves a target read-only against PostgreSQL application state", async () => {
    const before = {
      profile: await prisma.profile.findUnique({ where: { id: 1 } }),
      episode: await prisma.modelEpisode.findUniqueOrThrow({ where: { id: episodeId } }),
      states: await prisma.dailyModelState.findMany({ where: { episodeId }, orderBy: { date: "asc" } }),
      recoveries: await prisma.modelRecoveryRun.findMany({ where: { episodeId }, orderBy: { id: "asc" } }),
      health: await prisma.dailyHealthData.findMany({ orderBy: { date: "asc" } }),
      work: await prisma.workInterval.findMany({ where: { date: workDate }, orderBy: { id: "asc" } }),
    };
    const result = await solveModelEpisodeTarget(targetRequest(80, "2041-04-29", now), prisma);
    const publicResult = serializeGoalPlanningResult(
      goalPlanningRequest(80, "2041-04-29"), result,
    );
    expect(result.status).toMatch(/solved|numerically-limited|not-bracketed/);
    expect(publicResult.status).toBe(result.status);
    expect(publicResult.forecast?.dates.at(-1)?.date).toBe("2041-04-29");
    expect(JSON.stringify(publicResult)).not.toMatch(/searchDiagnostics|evaluations|samples/);
    expect("searchDiagnostics" in result && result.searchDiagnostics.commonRandomNumbers).toBe(true);
    if ("terminal" in result && result.terminal) {
      expect(result.terminal.attainment.sampleCount).toBe(32);
      expect(result.terminal.attainment.monteCarloInterval.method).toBe("wilson-score");
    }
    const notBracketed = await solveModelEpisodeTarget(targetRequest(20, "2041-04-29", now), prisma);
    expect(notBracketed.status).toBe("not-bracketed");

    const minimumForecast = await forecastModelEpisode({ episodeId, horizonDays: 30, seed: 1601,
      scenario: { ...fixedForecastScenario, schedule: { defaultDay: { ...fixedForecastScenario.schedule.defaultDay,
        nutrition: { caloriesKcal: 1_800, proteinG: 170 * 1_800 / 2_200,
          fatG: 70 * 1_800 / 2_200, carbsG: 230 * 1_800 / 2_200 } } } },
      config: { pathCount: 1 }, now }, prisma);
    if (!("dates" in minimumForecast)) throw new Error("expected resolved boundary forecast");
    const boundary = await solveModelEpisodeTarget(targetRequest(
      minimumForecast.dates.at(-1)!.physiologicalBodyWeightKg.median, "2041-04-29", now,
    ), prisma);
    expect(boundary.status).toBe("solved-at-boundary");
    expect("control" in boundary && boundary.control.constraintBoundary).toBe("min");
    expect(serializeGoalPlanningResult(goalPlanningRequest(
      minimumForecast.dates.at(-1)!.physiologicalBodyWeightKg.median, "2041-04-29",
    ), boundary)).toMatchObject({
      status: "solved-at-boundary",
      control: { constraintBoundary: "min" },
      terminal: { date: "2041-04-29" },
      warnings: ["caller-boundary"],
    });
    expect(await prisma.modelEpisode.findUniqueOrThrow({ where: { id: episodeId } })).toEqual(before.episode);
    expect(await prisma.dailyModelState.findMany({ where: { episodeId }, orderBy: { date: "asc" } })).toEqual(before.states);
    expect(await prisma.modelRecoveryRun.findMany({ where: { episodeId }, orderBy: { id: "asc" } })).toEqual(before.recoveries);
    expect(await prisma.profile.findUnique({ where: { id: 1 } })).toEqual(before.profile);
    expect(await prisma.dailyHealthData.findMany({ orderBy: { date: "asc" } })).toEqual(before.health);
    expect(await prisma.workInterval.findMany({ where: { date: workDate }, orderBy: { id: "asc" } })).toEqual(before.work);
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
          strengthTrainingMinutes: 30, rawPayload: { source: "phase-14a-canonical" },
        })),
      });
      await prisma.workout.deleteMany({
        where: { dailyHealthData: { date: { gte: "2041-03-23", lte: "2041-03-29" } } },
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
        deterministicModelVersion: "bodycast-physiology-v7",
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
      await prisma.modelRecoveryRun.update({ where: { id: stored.id }, data: { status: "recovered" } });
      const recoveredSolve = await solveModelEpisodeTarget(targetRequest(80, "2041-05-06", extendedNow), prisma);
      expect("quality" in recoveredSolve && recoveredSolve.quality.initialStateQuality).toBe("recovered");
      expect(serializeGoalPlanningResult(
        goalPlanningRequest(80, "2041-05-06"), recoveredSolve,
      ).warnings).toContain("recovered-initial-state");
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
      const degradedSolve = await solveModelEpisodeTarget(targetRequest(80, "2041-05-06", extendedNow), prisma);
      expect("quality" in degradedSolve && degradedSolve.quality.initialStateQuality).toBe("degraded");
      expect(serializeGoalPlanningResult(
        goalPlanningRequest(80, "2041-05-06"), degradedSolve,
      ).warnings).toContain("degraded-initial-state");
      await prisma.modelRecoveryRun.update({
        where: { id: stored.id }, data: { status: "degenerate" },
      });
      expect(await forecastModelEpisode({
        episodeId, horizonDays: 7, seed: 321, scenario: fixedForecastScenario,
        config: { pathCount: 16 }, now: extendedNow,
      }, prisma)).toMatchObject({
        status: "initial-state-unreliable", initialStateQuality: "degenerate",
      });
      const degenerateSolve = await solveModelEpisodeTarget(
        targetRequest(80, "2041-05-06", extendedNow), prisma,
      );
      expect(degenerateSolve).toMatchObject({
        status: "initial-state-unreliable", initialStateQuality: "degenerate",
      });
      expect(serializeGoalPlanningResult(
        goalPlanningRequest(80, "2041-05-06"), degenerateSolve,
      )).toMatchObject({
        status: "initial-state-unreliable",
        terminal: null,
        forecast: null,
        warnings: ["initial-state-unreliable"],
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
      const awaitingSolve = await solveModelEpisodeTarget(
        targetRequest(80, "2041-05-06", extendedNow), prisma,
      );
      expect(awaitingSolve).toMatchObject({
        status: "initial-state-unavailable", initialStateQuality: "awaiting",
      });
      expect(serializeGoalPlanningResult(
        goalPlanningRequest(80, "2041-05-06"), awaitingSolve,
      )).toMatchObject({
        status: "initial-state-unavailable",
        terminal: null,
        forecast: null,
        warnings: ["initial-state-unavailable"],
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
      await prisma.workout.deleteMany({
        where: { dailyHealthData: { date: { in: extendedDates } } },
      });
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
    const expectedStrength = calculateStrengthActivity({ weightKg: weight,
      rmrKcalPerDay: workState.dynamicRmrKcalPerDay!, durationMinutes: 30 })!;
    expect(workState.activityKcalPerDay).toBeCloseTo(
      expectedWorkWalking + expectedResidual + expectedOutsideWalking + expectedStrength,
      10,
    );
    expect(workState.modelVersion).toBe("bodycast-physiology-v7");
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

  it("preserves an existing legacy episode version during recalculation", async () => {
    await prisma.modelEpisode.update({
      where: { id: episodeId }, data: { modelVersion: "bodycast-physiology-v1" },
    });
    await recalculateModelEpisode({ episodeId, now });
    expect((await prisma.modelEpisode.findUniqueOrThrow({ where: { id: episodeId } })).modelVersion)
      .toBe("bodycast-physiology-v1");
    const versions = await prisma.dailyModelState.findMany({
      where: { episodeId }, distinct: ["modelVersion"], select: { modelVersion: true },
    });
    expect(versions).toEqual([{ modelVersion: "bodycast-physiology-v1" }]);
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
    await prisma.workout.deleteMany({
      where: { dailyHealthData: { date: { in: gapDates } } },
    });
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
        strengthTrainingMinutes: 30, rawPayload: { source: "phase-13.2-backfill" },
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
    await prisma.workout.deleteMany({
      where: { dailyHealthData: { date: { in: gapDates } } },
    });
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
    await prisma.unifiedExperimentalPhysiologyStateV2.deleteMany({ where: { modelEpisodeId: episodeId } });
    await prisma.modelEpisode.delete({ where: { id: episodeId } });
    expect(await prisma.dailyModelState.count({ where: { episodeId } })).toBe(0);
  });
});
