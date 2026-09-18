import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { rebuildFatWeightShadowV1 } from "@/modules/model-episodes/fat-weight-shadow-v1.service";
import { PhysiologyV7ShadowService } from "@/modules/model-episodes/physiology-v7-shadow.service";
import {
  detectUnsupportedDomainCases,
  evaluateRebuildDeterminism,
  recommendShadowRollout,
  summarizeFatWeightShadowCoverage,
  summarizeV7ShadowCoverage,
  type FatShadowDaySample,
  type V7ShadowDaySample,
} from "@/modules/model-episodes/shadow-longitudinal-validation";
import { addCalendarDays } from "@/modules/model-episodes/model-calendar";
import { transitionFatWeightShadowV1 } from "@/model/physiology-v7/fat-weight-shadow-v1";
import { deleteDailyHealthRows } from "../helpers/delete-daily-health";

const prisma = new PrismaClient();
const profileId = 1;
const start = "2052-07-01";
const dayCount = 28;
const dates = Array.from({ length: dayCount }, (_, index) => addCalendarDays(start, index));
const fixtureMethod = "shadow-longitudinal-stage12";
const request = { profileId, fromDate: dates[0]!, toDate: dates[dates.length - 1]!, timeZone: "Europe/Bratislava" };

function energyFor(index: number): number {
  if (index < 10) return -350;
  if (index < 18) return 40;
  return 300;
}

async function clean() {
  await prisma.physiologyV7ShadowDiagnostic.deleteMany({ where: { profileId, date: { in: dates } } });
  await prisma.physiologyV7DailyResult.deleteMany({ where: { profileId, date: { in: dates } } });
  await prisma.physiologyV7Lifecycle.deleteMany({ where: { profileId } });
  await prisma.fatWeightShadowV1Result.deleteMany({ where: { profileId, date: { in: dates } } });
  await prisma.dailyModelState.deleteMany({
    where: { date: { in: dates }, episode: { baselineDerivationMethod: fixtureMethod } },
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
  const episode = await prisma.modelEpisode.create({
    data: {
      profileId,
      startDate: start,
      timezone: "Europe/Bratislava",
      modelVersion: "bodycast-physiology-v6",
      active: false,
      deactivatedAt: new Date("2052-08-01T00:00:00.000Z"),
      ecfPolicy: "hold-ecf",
      baselineEnergyIntakeKcalPerDay: 2_500,
      baselineCarbIntakeG: 250,
      baselineWindowStartDate: start,
      baselineWindowEndDate: start,
      baselineNutritionDayCount: 1,
      baselineWeightObservationCount: 1,
      baselineWeightTrendKgPerWeek: 0,
      baselineWeightTrendPercentPerWeek: 0,
      baselineDerivationMethod: fixtureMethod,
      initialFatMassKg: 16,
      initialLeanTissueKg: 55,
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
    },
  });
  await prisma.dailyHealthData.createMany({
    data: dates.map((date, index) => ({
      date,
      weightKg: 80 - index * 0.02,
      bodyFatPercent: 20,
      caloriesKcal: 2_200,
      proteinG: 160,
      fatG: 70,
      carbsG: 220,
      steps: 7_000,
      walkingDistanceKm: 5,
      workoutFeedObserved: true,
      rawPayload: {},
    })),
  });
  await prisma.dailyModelState.createMany({
    data: dates.map((date, index) => ({
      episodeId: episode.id,
      date,
      status: "complete",
      dataQuality: "observed",
      nutritionSource: "observed",
      sourceQuality: {},
      missingFields: [],
      modelVersion: "bodycast-physiology-v6",
      startWeightKg: 80,
      endWeightKg: 80 - index * 0.02,
      fatMassKg: 16,
      leanTissueKg: 55,
      glycogenKg: 0.5,
      extracellularFluidDeviationLiters: 0,
      dynamicRmrKcalPerDay: 1_700,
      tefKcalPerDay: 200,
      activityKcalPerDay: 500,
      adaptiveThermogenesisKcalPerDay: 0,
      energyIntakeKcal: 2_200,
      energyExpenditureKcal: 2_200 - energyFor(index),
      energyBalanceKcal: energyFor(index),
      deltaFatKg: 0,
      deltaLeanTissueKg: 0,
      deltaGlycogenKg: 0,
      filteredWeightKg: 80 - index * 0.02,
    })),
  });
  return episode.id;
}

describe("Stage 12 longitudinal shadow PostgreSQL validation", () => {
  beforeEach(async () => {
    await clean();
    await seed();
  });
  afterAll(async () => {
    await clean();
    await prisma.$disconnect();
  });

  it("evaluates a multi-week fat + v7 shadow window without mutating durable sources", async () => {
    const beforeHealth = await prisma.dailyHealthData.findMany({
      where: { date: { in: dates } },
      orderBy: { date: "asc" },
    });
    const beforeStates = await prisma.dailyModelState.findMany({
      where: { date: { in: dates }, episode: { baselineDerivationMethod: fixtureMethod } },
      orderBy: { date: "asc" },
    });

    await rebuildFatWeightShadowV1({ profileId, fromDate: dates[0]!, toDate: dates.at(-1)! });
    await rebuildFatWeightShadowV1({ profileId, fromDate: dates[0]!, toDate: dates.at(-1)! });
    await new PhysiologyV7ShadowService().run(request);

    const fatRows = await prisma.fatWeightShadowV1Result.findMany({
      where: { profileId, date: { in: dates } },
      orderBy: { date: "asc" },
    });
    expect(fatRows).toHaveLength(dayCount);

    const fatSamples: FatShadowDaySample[] = fatRows.map((row, index) => {
      const result = row.result as ReturnType<typeof transitionFatWeightShadowV1>;
      return {
        date: row.date,
        availability: result.state.availability,
        fatMassKg: result.state.fatMassKg,
        slowNonFatKg: result.state.slowNonFatKg,
        energyBalanceKcal: energyFor(index),
        observedWeightKg: beforeHealth[index]?.weightKg ?? null,
        observedBodyFatPercent: beforeHealth[index]?.bodyFatPercent?.toNumber() ?? null,
        reasons: result.reasons,
        fingerprint: result.fingerprint,
        observationHandling: result.observation.handling,
      };
    });
    const fatCoverage = summarizeFatWeightShadowCoverage(fatSamples);
    expect(fatCoverage.availabilityRates.available).toBe(1);
    expect(fatCoverage.energyRegimes.deficitDays).toBe(10);
    expect(fatCoverage.energyRegimes.maintenanceDays).toBe(8);
    expect(fatCoverage.energyRegimes.surplusDays).toBe(10);
    expect(fatCoverage.residualAllocationCount).toBe(0);
    expect(fatCoverage.fatTrajectory.stable).toBe(true);

    const secondPass = await prisma.fatWeightShadowV1Result.findMany({
      where: { profileId, date: { in: dates } },
      orderBy: { date: "asc" },
    });
    expect(evaluateRebuildDeterminism({
      firstPassFingerprints: fatRows.map((row) => row.sourceFingerprint),
      secondPassFingerprints: secondPass.map((row) => row.sourceFingerprint),
    }).deterministic).toBe(true);

    const diagnostics = await prisma.physiologyV7ShadowDiagnostic.findMany({
      where: { profileId, date: { in: dates } },
      orderBy: { date: "asc" },
    });
    expect(diagnostics).toHaveLength(dayCount);
    const v7Samples: V7ShadowDaySample[] = diagnostics.map((row) => {
      const projection = row.v7Projection as {
        observedWeightKg: number | null;
        reconstructedModelMassKg: number | null;
        counts: { known: number; carried: number; unavailable: number };
      };
      return {
        date: row.date,
        v7Status: row.v7Status as V7ShadowDaySample["v7Status"],
        executionStatus: row.executionStatus as "success" | "failure",
        observedWeightKg: projection.observedWeightKg ?? null,
        reconstructedModelMassKg: projection.reconstructedModelMassKg ?? null,
        compartmentCounts: projection.counts ?? { known: 0, carried: 0, unavailable: 7 },
        resultFingerprint: row.v7ResultFingerprint,
        comparisonAvailability: "unavailable",
        divergenceKg: null,
        runtimeDurationMs: row.runtimeDurationMs,
        reasonCodes: row.reasonCodes as string[],
      };
    });
    const v7Coverage = summarizeV7ShadowCoverage(v7Samples);
    expect(v7Coverage.coverageRates.executionFailure).toBe(0);
    expect(v7Coverage.compartmentRates.unavailable).toBeGreaterThan(0);
    expect(v7Coverage.legacyDivergence.comparableDayCount).toBe(0);

    const unsupported = detectUnsupportedDomainCases({ v7Days: v7Samples, fatDays: fatSamples });
    const rollout = recommendShadowRollout({
      v7Coverage,
      fatCoverage,
      determinism: { deterministic: true, historicalEditDetected: null, note: "" },
      continuity: { sampleCount: 0, violationCount: 0, continuous: true, perturbationKcalReference: 25 },
      unsupportedDomainCases: unsupported,
    });
    expect(rollout.recommendation).toBe("remain-shadow");

    expect(await prisma.dailyHealthData.findMany({
      where: { date: { in: dates } },
      orderBy: { date: "asc" },
    })).toEqual(beforeHealth);
    expect(await prisma.dailyModelState.findMany({
      where: { date: { in: dates }, episode: { baselineDerivationMethod: fixtureMethod } },
      orderBy: { date: "asc" },
    })).toEqual(beforeStates);
  });
});
