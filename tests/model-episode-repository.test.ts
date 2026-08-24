import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import { ModelEpisodeRepository } from "@/modules/model-episodes/model-episode.repository";
import { prepareEpisodeInitialization } from "@/modules/model-episodes/episode-initialization";
import type { EpisodeCalculation } from "@/modules/model-episodes/episode-calculation";
import { modelProfile, stableSourceDays } from "./model-episode-fixtures";
import { observedNutritionProvenance } from "@/modules/model-episodes/nutrition-gap-bridge";

const db = {
  profile: { findUnique: vi.fn() },
  modelEpisode: {
    findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), updateMany: vi.fn(), update: vi.fn(),
  },
  dailyHealthData: { findMany: vi.fn() },
  healthSyncSnapshot: { findMany: vi.fn() },
  workInterval: { findMany: vi.fn() },
  dailyModelState: {
    deleteMany: vi.fn(), upsert: vi.fn(), count: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(),
  },
  modelUnknownInterval: {
    deleteMany: vi.fn(), upsert: vi.fn(), findMany: vi.fn(),
  },
};

const client = db as unknown as PrismaClient;

function record() {
  return {
    id: 3,
    profileId: 1,
    startDate: "2026-08-22",
    timezone: "Europe/Bratislava",
    modelVersion: "bodycast-physiology-v1",
    active: true,
    ecfPolicy: "hold-ecf",
    baselineEnergyIntakeKcalPerDay: 2_450,
    baselineCarbIntakeG: 240,
    baselineNutritionFallback: {
      caloriesKcal: 2_450, proteinG: 150, fatG: 75, carbsG: 240,
    },
    nutritionMaxBridgeDays: 2,
    baselineWindowStartDate: "2026-07-26",
    baselineWindowEndDate: "2026-08-22",
    baselineNutritionDayCount: 28,
    baselineWeightObservationCount: 28,
    baselineWeightTrendKgPerWeek: 0,
    baselineWeightTrendPercentPerWeek: 0,
    initialFatMassKg: 16,
    initialLeanTissueKg: 47.15,
    initialGlycogenKg: 0.5,
    baselineExtracellularFluidLiters: 15,
    initialExtracellularFluidDeviationLiters: 0,
    initialAdaptiveThermogenesisKcalPerDay: 0,
    initialFilteredWeightKg: 80,
    initialWeightFilterVarianceKg2: 0.25,
    initialRmrKcalPerDay: 1_700,
    dynamicRmrFatCoefficient: 3.2,
    dynamicRmrLeanCoefficient: 22,
    dynamicRmrCalibrationOffsetKcalPerDay: 611.5,
    adaptiveThermogenesisBeta: 0.14,
    adaptiveThermogenesisTimeConstantDays: 14,
    weightProcessNoiseVarianceKg2PerDay: 0.01,
    weightMeasurementNoiseVarianceKg2: 0.25,
    personalOffsetKcalPerDay: 10,
    activityCalibration: 0.95,
    calibrationStatus: "offset-only",
    calibrationDiagnostics: { observationCount: 30 },
    latestModeledDate: "2026-08-22",
    createdAt: new Date("2026-08-23T00:00:00.000Z"),
    updatedAt: new Date("2026-08-23T01:00:00.000Z"),
  };
}

function unknownIntervalRecord(input: {
  id: number;
  startDate: string;
  lastUnknownDate: string;
  endDate: string | null;
  postGapObservationDates?: unknown;
}) {
  const dates = Array.isArray(input.postGapObservationDates)
    ? input.postGapObservationDates.filter((date): date is string => typeof date === "string")
    : [];
  return {
    ...input,
    anchorDate: "2026-08-22",
    firstPostGapObservationDate: dates[0] ?? null,
    postGapObservedDayCount: dates.length,
    postGapObservationDates: input.postGapObservationDates ?? [],
    missingTransitionFields: ["caloriesKcal", 42],
    recoveryRequired: true,
  };
}

describe("model episode repository mapping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.modelEpisode.updateMany.mockResolvedValue({ count: 1 });
    db.dailyModelState.deleteMany.mockResolvedValue({ count: 0 });
    db.dailyModelState.upsert.mockResolvedValue({});
    db.modelUnknownInterval.deleteMany.mockResolvedValue({ count: 0 });
    db.modelUnknownInterval.upsert.mockResolvedValue({});
    db.modelUnknownInterval.findMany.mockResolvedValue([]);
    db.modelEpisode.update.mockResolvedValue({});
  });

  it("maps profile, active episode, explicit episode, and absence", async () => {
    const repository = new ModelEpisodeRepository(client);
    db.profile.findUnique.mockResolvedValue(null);
    await expect(repository.getProfile()).resolves.toBeNull();
    db.profile.findUnique.mockResolvedValue({
      id: 1, sex: "male", dateOfBirth: new Date("1990-05-10T00:00:00.000Z"),
      heightCm: new Prisma.Decimal(180),
    });
    await expect(repository.getProfile()).resolves.toEqual(modelProfile);

    db.modelEpisode.findFirst.mockResolvedValue(null);
    await expect(repository.getActive()).resolves.toBeNull();
    db.modelEpisode.findFirst.mockResolvedValue(record());
    const active = await repository.getActive();
    expect(active).toMatchObject({
      id: 3,
      calibrationStatus: "offset-only",
      simulatorParameters: { glycogenParameters: { baselineCarbIntakeG: 240 } },
    });
    db.modelEpisode.findUnique.mockResolvedValue(record());
    await expect(repository.getById(3)).resolves.toMatchObject({ id: 3 });
    db.modelEpisode.findUnique.mockResolvedValue(null);
    await expect(repository.getById(999)).resolves.toBeNull();
  });

  it("loads source records and converts Prisma decimals without mutation", async () => {
    db.dailyHealthData.findMany.mockResolvedValue([{
      date: "2026-08-22", weightKg: 80, bodyFatPercent: new Prisma.Decimal(20),
      caloriesKcal: 2_500, proteinG: 150, fatG: 75, carbsG: 250,
      averageWalkingSpeedKmh: new Prisma.Decimal(5),
      walkingDistanceKm: new Prisma.Decimal("5.1"),
      strengthTrainingMinutes: new Prisma.Decimal(0),
    }]);
    db.healthSyncSnapshot.findMany.mockResolvedValue([{
      id: 1, date: "2026-08-22", receivedAt: new Date(), syncedAt: null,
      steps: 1_000, walkingDistanceKm: new Prisma.Decimal("1.25"),
    }]);
    db.workInterval.findMany.mockResolvedValue([{
      id: 1, date: "2026-08-22", startAt: new Date(), endAt: new Date(),
      timezone: "Europe/Bratislava", category: "manualLight", breakMinutes: null,
    }]);
    const result = await new ModelEpisodeRepository(client)
      .loadSources("2026-08-01", "2026-08-22");
    expect(result.days[0]).toMatchObject({
      bodyFatPercent: 20, walkingDistanceKm: 5.1, strengthTrainingMinutes: 0,
    });
    expect(result.snapshots[0].walkingDistanceKm).toBe(1.25);
    expect(result.workIntervals).toHaveLength(1);
  });

  it("deactivates and creates a fully frozen prepared episode", async () => {
    const repository = new ModelEpisodeRepository(client);
    const prepared = prepareEpisodeInitialization({
      profile: modelProfile,
      days: stableSourceDays(),
      startDate: "2026-08-22",
    });
    db.modelEpisode.create.mockResolvedValue(record());
    const at = new Date("2026-08-23T00:00:00.000Z");
    await repository.deactivateActive(at);
    const created = await repository.createPrepared(prepared);
    expect(db.modelEpisode.updateMany).toHaveBeenCalledWith({
      where: { active: true }, data: { active: false, deactivatedAt: at },
    });
    expect(db.modelEpisode.create.mock.calls[0]?.[0].data).toMatchObject({
      startDate: "2026-08-22",
      modelVersion: "bodycast-physiology-v4",
      baselineDerivationMethod: "median-with-theil-sen-weight-stability",
      calibrationStatus: "insufficient-history",
    });
    expect(created.id).toBe(3);
  });

  it("upserts calculation rows, removes stale dates, and updates episode diagnostics", async () => {
    const calculation: EpisodeCalculation = {
      calibration: {
        status: "defaults-retained",
        parameters: { personalOffsetKcalPerDay: 0, activityCalibration: 1 },
        loss: 1,
        diagnostics: { observationCount: 20 } as never,
      },
      calibrationNutritionDiagnostics: {
        observedNutritionDays: 1,
        imputedNutritionDays: 0,
        missingNutritionDays: 0,
        calibrationEligibleObservedDays: 1,
        calibrationExcludedDependentDays: 0,
        firstImputedNutritionDate: null,
      },
      latestModeledDate: "2026-08-22",
      unknownIntervals: [],
      continuityStatus: "resolved",
      dailyStates: [{
        date: "2026-08-22",
        status: "complete",
        dataQuality: "observed",
        nutrition: observedNutritionProvenance(),
        sourceQuality: {
          status: "complete", issues: [], workIntervalCount: 0,
          workWalkingDistanceKm: 0, outsideWorkWalkingDistanceKm: 5,
          sourceObservationFields: ["dailyHealthData"],
          nutrition: observedNutritionProvenance(),
        },
        missingFields: [],
        modelVersion: "bodycast-physiology-v1",
        startWeightKg: 80,
        endWeightKg: 79.9,
        fatMassKg: 16,
        leanTissueKg: 47,
        glycogenKg: 0.5,
        extracellularFluidDeviationLiters: 0,
        dynamicRmrKcalPerDay: 1_700,
        tefKcalPerDay: 200,
        activityKcalPerDay: 500,
        adaptiveThermogenesisKcalPerDay: 0,
        energyIntakeKcal: 2_500,
        energyExpenditureKcal: 2_400,
        energyBalanceKcal: 100,
        deltaFatKg: 0.01,
        deltaLeanTissueKg: 0.005,
        deltaGlycogenKg: 0,
        filteredWeightKg: 79.95,
      }],
    };
    const repository = new ModelEpisodeRepository(client);
    await repository.persistCalculation(3, calculation);
    expect(db.dailyModelState.deleteMany).toHaveBeenCalledWith({
      where: { episodeId: 3, date: { notIn: ["2026-08-22"] } },
    });
    expect(db.dailyModelState.upsert).toHaveBeenCalledOnce();
    expect(db.modelUnknownInterval.deleteMany).toHaveBeenCalledWith({
      where: { episodeId: 3 },
    });
    expect(db.modelEpisode.update.mock.calls[0]?.[0].data).toMatchObject({
      calibrationStatus: "defaults-retained",
      latestModeledDate: "2026-08-22",
    });

    await repository.persistCalculation(3, { ...calculation, dailyStates: [] });
    expect(db.dailyModelState.deleteMany).toHaveBeenLastCalledWith({ where: { episodeId: 3 } });
  });

  it("synchronizes unknown intervals and upgrades persisted semantics atomically", async () => {
    const calculation: EpisodeCalculation = {
      calibration: {
        status: "insufficient-history",
        parameters: { personalOffsetKcalPerDay: 10, activityCalibration: 0.95 },
        loss: null,
        diagnostics: { observationCount: 3 } as never,
      },
      calibrationNutritionDiagnostics: {
        observedNutritionDays: 3, imputedNutritionDays: 0, missingNutritionDays: 7,
        calibrationEligibleObservedDays: 3, calibrationExcludedDependentDays: 0,
        firstImputedNutritionDate: null,
      },
      dailyStates: [],
      latestModeledDate: "2026-08-22",
      continuityStatus: "awaiting-recovery",
      unknownIntervals: [{
        startDate: "2026-08-23", lastUnknownDate: "2026-08-29", endDate: null,
        anchorDate: "2026-08-22", firstPostGapObservationDate: null,
        postGapObservedDayCount: 0, postGapObservationDates: [],
        missingTransitionFields: ["caloriesKcal", "outsideWorkWalkingDistanceKm"],
        recoveryRequired: true,
      }],
    };
    await new ModelEpisodeRepository(client).persistCalculation(
      3,
      calculation,
      "bodycast-physiology-v4",
    );
    expect(db.modelUnknownInterval.deleteMany).toHaveBeenCalledWith({
      where: { episodeId: 3, startDate: { notIn: ["2026-08-23"] } },
    });
    expect(db.modelUnknownInterval.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { episodeId_startDate: { episodeId: 3, startDate: "2026-08-23" } },
      create: expect.objectContaining({
        episodeId: 3,
        startDate: "2026-08-23",
        lastUnknownDate: "2026-08-29",
        recoveryRequired: true,
      }),
    }));
    expect(db.modelEpisode.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ modelVersion: "bodycast-physiology-v4" }),
    }));
  });

  it("maps consistent open, closed, and multiple-interval status metadata", async () => {
    db.modelEpisode.findUnique.mockResolvedValue(record());
    db.dailyModelState.count.mockResolvedValueOnce(3).mockResolvedValueOnce(0)
      .mockResolvedValueOnce(3).mockResolvedValueOnce(0).mockResolvedValueOnce(0);
    db.dailyModelState.findFirst.mockResolvedValue(null);
    db.modelUnknownInterval.findMany.mockResolvedValue([
      unknownIntervalRecord({
        id: 1, startDate: "2026-08-23", lastUnknownDate: "2026-08-29",
        endDate: "2026-08-29", postGapObservationDates: ["2026-08-30", "2026-08-31"],
      }),
      unknownIntervalRecord({
        id: 2, startDate: "2026-09-05", lastUnknownDate: "2026-09-07", endDate: null,
      }),
    ]);
    const status = await new ModelEpisodeRepository(client).status(3);
    expect(status).toMatchObject({
      continuityStatus: "awaiting-recovery",
      lastResolvedDate: "2026-08-22",
      recoveryRequired: true,
      unknownIntervalCount: 2,
      unresolvedDayCount: 10,
      postGapObservedDayCount: 2,
      currentPredictedWeightKg: null,
    });
    expect(status?.unknownIntervals).toEqual([
      expect.objectContaining({
        id: 1, durationDays: 7, open: false,
        postGapObservationDates: ["2026-08-30", "2026-08-31"],
        missingTransitionFields: ["caloriesKcal"],
      }),
      expect.objectContaining({ id: 2, durationDays: 3, open: true }),
    ]);
  });

  it("filters history gaps by unknown dates or retained observation dates", async () => {
    db.modelEpisode.findFirst.mockResolvedValue(record());
    db.dailyModelState.findMany.mockResolvedValue([]);
    db.modelUnknownInterval.findMany.mockResolvedValue([
      unknownIntervalRecord({
        id: 1, startDate: "2026-08-23", lastUnknownDate: "2026-08-29",
        endDate: "2026-08-29", postGapObservationDates: ["2026-08-30", "2026-08-31"],
      }),
      unknownIntervalRecord({
        id: 2, startDate: "2026-09-05", lastUnknownDate: "2026-09-07", endDate: null,
        postGapObservationDates: { malformed: true },
      }),
    ]);
    const history = await new ModelEpisodeRepository(client).history({
      from: "2026-08-31", to: "2026-08-31", limit: 90, offset: 0,
    });
    expect(history).toMatchObject({
      unknownIntervals: [expect.objectContaining({ id: 1 })],
      observationsAwaitingRecovery: [{
        date: "2026-08-31", source: "recorded-after-unresolved-transition",
      }],
    });
  });

  it("returns resolved states, a seven-day gap, and five observations as distinct history", async () => {
    db.modelEpisode.findUnique.mockResolvedValue(record());
    db.dailyModelState.findMany.mockResolvedValue([0, 1, 2].map((index) => ({
      date: `2026-08-0${index + 1}`,
      updatedAt: new Date(`2026-08-0${index + 1}T12:00:00.000Z`),
    })));
    db.modelUnknownInterval.findMany.mockResolvedValue([
      unknownIntervalRecord({
        id: 1,
        startDate: "2026-08-04",
        lastUnknownDate: "2026-08-10",
        endDate: "2026-08-10",
        postGapObservationDates: [
          "2026-08-11", "2026-08-12", "2026-08-13", "2026-08-14", "2026-08-15",
        ],
      }),
    ]);
    const history = await new ModelEpisodeRepository(client).history({
      episodeId: 3, from: "2026-08-01", to: "2026-08-15", limit: 90, offset: 0,
    });
    expect(history?.days).toHaveLength(3);
    expect(history?.unknownIntervals).toEqual([
      expect.objectContaining({ startDate: "2026-08-04", durationDays: 7 }),
    ]);
    expect(history?.observationsAwaitingRecovery).toHaveLength(5);
    expect(history?.days).not.toHaveLength(15);
  });

  it("builds concise status and chronological history DTOs", async () => {
    db.modelEpisode.findFirst.mockResolvedValue(record());
    db.dailyModelState.count.mockResolvedValueOnce(10).mockResolvedValueOnce(2)
      .mockResolvedValueOnce(8).mockResolvedValueOnce(2).mockResolvedValueOnce(1);
    db.dailyModelState.findFirst.mockResolvedValue({
      endWeightKg: 79,
      filteredWeightKg: 79.1,
      fatMassKg: 15.5,
      leanTissueKg: 47,
      dynamicRmrKcalPerDay: 1_690,
      energyExpenditureKcal: 2_450,
    });
    const repository = new ModelEpisodeRepository(client);
    await expect(repository.status()).resolves.toMatchObject({
      episodeId: 3,
      daysModeled: 10,
      incompleteDays: 2,
      observedNutritionDays: 8,
      imputedNutritionDays: 2,
      unbridgeableNutritionDays: 1,
      currentPredictedWeightKg: 79,
      currentModeledTdeeKcalPerDay: 2_450,
    });

    db.modelEpisode.findUnique.mockResolvedValue(record());
    db.dailyModelState.findMany.mockResolvedValue([{
      date: "2026-08-22", status: "complete", dataQuality: "observed",
      nutritionSource: "observed", nutritionImputationMethod: null,
      nutritionReferenceDayCount: 0, nutritionGapLength: 0,
      nutritionImputationDiagnostics: {}, sourceQuality: {}, missingFields: [],
      modelVersion: "bodycast-physiology-v1", startWeightKg: 80, endWeightKg: 79.9,
      fatMassKg: 16, leanTissueKg: 47, glycogenKg: 0.5,
      extracellularFluidDeviationLiters: 0, dynamicRmrKcalPerDay: 1_700,
      tefKcalPerDay: 200, activityKcalPerDay: 500,
      adaptiveThermogenesisKcalPerDay: 0, energyIntakeKcal: 2_500,
      energyExpenditureKcal: 2_400, energyBalanceKcal: 100,
      deltaFatKg: 0, deltaLeanTissueKg: 0, deltaGlycogenKg: 0,
      filteredWeightKg: 79.95, updatedAt: new Date("2026-08-23T00:00:00.000Z"),
    }]);
    const history = await repository.history({ episodeId: 3, limit: 90, offset: 0 });
    expect(history).toMatchObject({
      episodeId: 3,
      days: [{ date: "2026-08-22", updatedAt: "2026-08-23T00:00:00.000Z" }],
      unknownIntervals: [],
      observationsAwaitingRecovery: [],
    });
    db.modelEpisode.findUnique.mockResolvedValue(null);
    await expect(repository.status(999)).resolves.toBeNull();
    await expect(repository.history({ episodeId: 999, limit: 90, offset: 0 }))
      .resolves.toBeNull();
  });
});
