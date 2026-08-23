import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { initializeNewModelEpisode, recalculateModelEpisode } from "@/modules/model-episodes/model-episode.service";
import { addCalendarDays } from "@/modules/model-episodes/model-calendar";

const prisma = new PrismaClient();
const episodeStart = "2041-03-20";
const finalDate = "2041-03-30";
const testRangeStart = addCalendarDays(finalDate, -99);
const now = new Date("2041-03-31T10:00:00.000Z");
const workDate = "2041-03-25";
let originalProfile: Awaited<ReturnType<typeof prisma.profile.findUnique>>;
let originalActiveIds: number[] = [];
let episodeId = 0;

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
      modelVersion: "bodycast-physiology-v1",
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

  it("persists deterministic, idempotent history and overlap-aware walking", async () => {
    const first = await recalculateModelEpisode({ episodeId, now });
    const firstRows = await prisma.dailyModelState.findMany({
      where: { episodeId }, orderBy: { date: "asc" },
      select: {
        date: true, status: true, sourceQuality: true, endWeightKg: true,
        energyExpenditureKcal: true,
      },
    });
    const second = await recalculateModelEpisode({ episodeId, now });
    const secondRows = await prisma.dailyModelState.findMany({
      where: { episodeId }, orderBy: { date: "asc" },
      select: {
        date: true, status: true, sourceQuality: true, endWeightKg: true,
        energyExpenditureKcal: true,
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
