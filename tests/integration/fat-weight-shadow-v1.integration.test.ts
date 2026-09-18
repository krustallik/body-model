import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { forecastModelEpisode } from "@/modules/model-forecast/model-forecast.service";
import { rebuildFatWeightShadowV1 } from "@/modules/model-episodes/fat-weight-shadow-v1.service";
import {
  FAT_WEIGHT_SHADOW_V1_VERSION,
  transitionFatWeightShadowV1,
  type FatWeightShadowStateV1,
} from "@/model/physiology-v7/fat-weight-shadow-v1";
import { deleteDailyHealthRows } from "../helpers/delete-daily-health";

const prisma = new PrismaClient();
const profileId = 1;
const dates = ["2051-06-01", "2051-06-02", "2051-06-03"] as const;
const fixtureMethod = "fat-weight-shadow-v1-integration";
const initialFatMassKg = 16;
const initialSlowNonFatKg = 55;
const productionTdeeKcal = 2_480;
const misleadingDailyFatKg = 99;
const energyBalances = [-400, -200, 100] as const;
const extremeWeights = [140, 138.5, 137] as const;
const extremeBodyFatPercents = [5, 6, 4.5] as const;
const request = { profileId, fromDate: dates[0], toDate: dates[2] };
const forecastNow = new Date("2051-06-01T08:00:00.000Z");
const availablePrior: FatWeightShadowStateV1 = {
  fatMassKg: initialFatMassKg,
  slowNonFatKg: initialSlowNonFatKg,
  availability: "available",
  provenance: "episode-bia-derived-estimate",
  uncertainty: "personal-unavailable",
};

type ShadowJson = ReturnType<typeof transitionFatWeightShadowV1>;

function asShadow(result: unknown): ShadowJson {
  return result as ShadowJson;
}

function expectPersistedShadow(actual: unknown, expected: ShadowJson) {
  const row = asShadow(actual);
  expect(row.modelVersion).toBe(expected.modelVersion);
  expect(row.fingerprint).toBe(expected.fingerprint);
  expect(row.reasons).toEqual(expected.reasons);
  expect(row.observation).toEqual(expected.observation);
  expect(row.state.availability).toBe(expected.state.availability);
  expect(row.state.provenance).toBe(expected.state.provenance);
  expect(row.state.uncertainty).toBe(expected.state.uncertainty);
  if (expected.state.fatMassKg === null || expected.state.slowNonFatKg === null) {
    expect(row.state.fatMassKg).toBeNull();
    expect(row.state.slowNonFatKg).toBeNull();
    return;
  }
  expect(row.state.fatMassKg).toBeCloseTo(expected.state.fatMassKg, 10);
  expect(row.state.slowNonFatKg).toBeCloseTo(expected.state.slowNonFatKg, 10);
}

function episodeData(startDate: string) {
  return {
    profileId,
    startDate,
    timezone: "Europe/Bratislava",
    modelVersion: "bodycast-physiology-v6",
    active: false,
    deactivatedAt: new Date("2051-06-04T00:00:00.000Z"),
    ecfPolicy: "hold-ecf",
    baselineEnergyIntakeKcalPerDay: 2_500,
    baselineCarbIntakeG: 250,
    baselineWindowStartDate: startDate,
    baselineWindowEndDate: startDate,
    baselineNutritionDayCount: 1,
    baselineWeightObservationCount: 1,
    baselineWeightTrendKgPerWeek: 0,
    baselineWeightTrendPercentPerWeek: 0,
    baselineDerivationMethod: fixtureMethod,
    initialFatMassKg,
    initialLeanTissueKg: initialSlowNonFatKg,
    initialGlycogenKg: 0.5,
    baselineExtracellularFluidLiters: 18,
    initialExtracellularFluidDeviationLiters: 0,
    initialAdaptiveThermogenesisKcalPerDay: 0,
    initialFilteredWeightKg: 80,
    initialWeightFilterVarianceKg2: 1,
    initialRmrKcalPerDay: 1_261.2,
    dynamicRmrFatCoefficient: 3.2,
    dynamicRmrLeanCoefficient: 22,
    dynamicRmrCalibrationOffsetKcalPerDay: 0,
    adaptiveThermogenesisBeta: 0.14,
    adaptiveThermogenesisTimeConstantDays: 14,
    weightProcessNoiseVarianceKg2PerDay: 0.01,
    weightMeasurementNoiseVarianceKg2: 0.25,
    calibrationDiagnostics: {},
  };
}

function expectedTransitions(input: {
  prior: FatWeightShadowStateV1;
  energy: readonly (number | null)[];
  weights: readonly (number | null)[];
  bodyFatPercents: readonly (number | null)[];
}) {
  const rows: ShadowJson[] = [];
  let prior = input.prior;
  for (let index = 0; index < dates.length; index += 1) {
    const result = transitionFatWeightShadowV1({
      prior,
      energyBalanceKcal: input.energy[index] ?? null,
      observedWeightKg: input.weights[index] ?? null,
      observedBodyFatPercent: input.bodyFatPercents[index] ?? null,
    });
    rows.push(result);
    prior = result.state;
  }
  return rows;
}

async function shadowRows() {
  return prisma.fatWeightShadowV1Result.findMany({
    where: { profileId, date: { in: [...dates] } },
    orderBy: { date: "asc" },
  });
}

async function productionSnapshot(episodeId: number) {
  return {
    episode: await prisma.modelEpisode.findUniqueOrThrow({ where: { id: episodeId } }),
    states: await prisma.dailyModelState.findMany({
      where: { episodeId }, orderBy: { date: "asc" },
    }),
    health: await prisma.dailyHealthData.findMany({
      where: { date: { in: [...dates] } }, orderBy: { date: "asc" },
    }),
  };
}

async function forecast(episodeId: number) {
  return forecastModelEpisode({
    episodeId,
    horizonDays: 2,
    seed: 1601,
    scenario: {
      mode: "fixed",
      schedule: {
        defaultDay: {
          nutrition: { caloriesKcal: 2_200, proteinG: 170, fatG: 70, carbsG: 230 },
          outsideWorkWalkingDistanceKm: 5,
          averageWalkingSpeedKmh: 5,
          strengthTrainingMinutes: 0,
          occupation: [],
        },
      },
    },
    config: { pathCount: 1 },
    now: forecastNow,
  }, prisma);
}

async function clean() {
  await prisma.fatWeightShadowV1Result.deleteMany({
    where: { profileId, date: { in: [...dates] } },
  });
  await prisma.modelEpisode.deleteMany({ where: { baselineDerivationMethod: fixtureMethod } });
  await deleteDailyHealthRows(prisma, dates);
}

async function seed() {
  await prisma.profile.upsert({
    where: { id: profileId },
    create: {
      id: profileId,
      sex: "male",
      dateOfBirth: new Date("1990-05-10T00:00:00.000Z"),
      heightCm: 180,
    },
    update: {},
  });
  const episode = await prisma.modelEpisode.create({ data: episodeData(dates[0]) });
  await prisma.dailyHealthData.createMany({
    data: dates.map((date, index) => ({
      date,
      weightKg: extremeWeights[index],
      bodyFatPercent: extremeBodyFatPercents[index],
      caloriesKcal: 2_100,
      proteinG: 150,
      fatG: 70,
      carbsG: 220,
      steps: 7_000,
      walkingDistanceKm: 5,
      workoutFeedObserved: true,
      rawPayload: { source: "fat-weight-shadow-v1-integration" },
    })),
  });
  await prisma.dailyModelState.createMany({
    data: dates.map((date, index) => ({
      episodeId: episode.id,
      date,
      status: "complete",
      sourceQuality: {},
      missingFields: [],
      modelVersion: "bodycast-physiology-v6",
      fatMassKg: misleadingDailyFatKg,
      leanTissueKg: 1,
      energyBalanceKcal: energyBalances[index],
      energyExpenditureKcal: productionTdeeKcal,
      energyIntakeKcal: 2_100,
    })),
  });
  return episode.id;
}

describe("fat weight shadow v1 with PostgreSQL", () => {
  let episodeId = 0;

  beforeEach(async () => {
    await clean();
    episodeId = await seed();
  });

  afterAll(async () => {
    await clean();
    await prisma.$disconnect();
  });

  it("persists a deterministic round-trip with stable fingerprints", async () => {
    const expected = expectedTransitions({
      prior: availablePrior,
      energy: energyBalances,
      weights: extremeWeights,
      bodyFatPercents: extremeBodyFatPercents,
    });
    await rebuildFatWeightShadowV1(request);
    await rebuildFatWeightShadowV1(request);
    const rows = await shadowRows();
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.modelVersion)).toEqual([
      FAT_WEIGHT_SHADOW_V1_VERSION,
      FAT_WEIGHT_SHADOW_V1_VERSION,
      FAT_WEIGHT_SHADOW_V1_VERSION,
    ]);
    expect(rows.map((row) => row.sourceFingerprint)).toEqual(expected.map((row) => row.fingerprint));
    rows.forEach((row, index) => expectPersistedShadow(row.result, expected[index]!));
    expect(new Set(rows.map((row) => row.id)).size).toBe(3);
  });

  it("does not overwrite latent fat from scale or BIA and does not allocate residual", async () => {
    await rebuildFatWeightShadowV1(request);
    const first = await shadowRows();
    await prisma.dailyHealthData.update({
      where: { date: dates[0] }, data: { weightKg: 42, bodyFatPercent: 48 },
    });
    await prisma.dailyHealthData.update({
      where: { date: dates[1] }, data: { weightKg: 41, bodyFatPercent: 49 },
    });
    await prisma.dailyHealthData.update({
      where: { date: dates[2] }, data: { weightKg: 40, bodyFatPercent: 50 },
    });
    await rebuildFatWeightShadowV1(request);
    const second = await shadowRows();
    expect(second.map((row) => asShadow(row.result).state))
      .toEqual(first.map((row) => asShadow(row.result).state));
    for (const row of second) {
      const result = asShadow(row.result);
      expect(result.observation.handling).toBe("noisy-not-state-overwrite");
      expect(result.state.fatMassKg).not.toBe(misleadingDailyFatKg);
      expect(result.state.fatMassKg).not.toBe((result.observation.scaleWeightKg ?? 0)
        * (result.observation.bodyFatPercent ?? 0) / 100);
      expect((result.state.fatMassKg ?? 0) + (result.state.slowNonFatKg ?? 0))
        .not.toBe(result.observation.scaleWeightKg);
      expect(result.state.provenance).toBe("episode-bia-derived-estimate");
      expect(result.state).not.toHaveProperty("skeletalMuscleKg");
    }
    expect(asShadow(first[0]!.result).state.fatMassKg).toBeCloseTo(
      expectedTransitions({
        prior: availablePrior,
        energy: energyBalances,
        weights: extremeWeights,
        bodyFatPercents: extremeBodyFatPercents,
      })[0]!.state.fatMassKg!,
      12,
    );
  });

  it("rebuilds later days when historical energy is corrected", async () => {
    await rebuildFatWeightShadowV1(request);
    const before = await shadowRows();
    await prisma.dailyModelState.update({
      where: { episodeId_date: { episodeId, date: dates[0] } },
      data: { energyBalanceKcal: 400 },
    });
    await rebuildFatWeightShadowV1(request);
    const after = await shadowRows();
    const expected = expectedTransitions({
      prior: availablePrior,
      energy: [400, energyBalances[1], energyBalances[2]],
      weights: extremeWeights,
      bodyFatPercents: extremeBodyFatPercents,
    });
    expect(asShadow(after[0]!.result).state.fatMassKg)
      .toBeGreaterThan(asShadow(before[0]!.result).state.fatMassKg!);
    expect(after.map((row) => row.sourceFingerprint))
      .not.toEqual(before.map((row) => row.sourceFingerprint));
    after.forEach((row, index) => expectPersistedShadow(row.result, expected[index]!));
  });

  it("keeps missing compatible initialization unavailable rather than writing zero", async () => {
    await prisma.fatWeightShadowV1Result.deleteMany({
      where: { profileId, date: { in: [...dates] } },
    });
    await prisma.modelEpisode.deleteMany({ where: { baselineDerivationMethod: fixtureMethod } });
    const hidden = await prisma.modelEpisode.findMany({
      where: { profileId, startDate: { lte: dates[0] } },
      select: { id: true, startDate: true },
    });
    try {
      for (const row of hidden) {
        await prisma.modelEpisode.update({
          where: { id: row.id }, data: { startDate: "2099-12-31" },
        });
      }
      const late = await prisma.modelEpisode.create({ data: episodeData("2051-06-10") });
      await prisma.dailyModelState.createMany({
        data: dates.map((date, index) => ({
          episodeId: late.id,
          date,
          status: "complete",
          sourceQuality: {},
          missingFields: [],
          modelVersion: "bodycast-physiology-v6",
          fatMassKg: misleadingDailyFatKg,
          leanTissueKg: 1,
          energyBalanceKcal: energyBalances[index],
          energyExpenditureKcal: productionTdeeKcal,
        })),
      });
      await rebuildFatWeightShadowV1(request);
      const rows = await shadowRows();
      expect(rows).toHaveLength(3);
      for (const row of rows) {
        const result = asShadow(row.result);
        expect(result.state).toEqual({
          fatMassKg: null,
          slowNonFatKg: null,
          availability: "unavailable",
          provenance: null,
          uncertainty: "personal-unavailable",
        });
        expect(result.reasons).toContain("missing-defensible-initial-fat-state");
      }
    } finally {
      for (const row of hidden) {
        await prisma.modelEpisode.update({
          where: { id: row.id }, data: { startDate: row.startDate },
        });
      }
    }
  });

  it("isolates a shadow write failure without mutating sources or TDEE", async () => {
    await prisma.modelEpisode.update({
      where: { id: episodeId },
      data: { initialFatMassKg: 1_000.1 },
    });
    const before = await productionSnapshot(episodeId);
    await expect(rebuildFatWeightShadowV1(request))
      .rejects.toThrow("fatMassKg is outside the supported physical range");
    expect(await productionSnapshot(episodeId)).toEqual(before);
    expect(await prisma.fatWeightShadowV1Result.count({
      where: { profileId, date: { in: [...dates] } },
    })).toBe(0);
    expect(before.states.map((row) => row.energyExpenditureKcal))
      .toEqual([productionTdeeKcal, productionTdeeKcal, productionTdeeKcal]);
  });

  it("leaves production forecast, TDEE, and source data unchanged after a successful rebuild", async () => {
    const before = await productionSnapshot(episodeId);
    const beforeForecast = await forecast(episodeId);
    await rebuildFatWeightShadowV1(request);
    expect(await productionSnapshot(episodeId)).toEqual(before);
    expect(await forecast(episodeId)).toEqual(beforeForecast);
    expect(before.states.every((row) => row.energyExpenditureKcal === productionTdeeKcal)).toBe(true);
    expect(await prisma.fatWeightShadowV1Result.count({
      where: { profileId, date: { in: [...dates] } },
    })).toBe(3);
  });
});
