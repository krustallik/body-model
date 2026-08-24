import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { createGlycogenParameters } from "@/model/body-composition/glycogen";
import type { EpisodeCalculation } from "./episode-calculation";
import type { ModelHistoryQuery } from "./model-episode.schema";
import type {
  HistoricalModelSources,
  ModelProfileSource,
  ModelStatusDto,
  NutritionVector,
  PersistedEpisode,
  PreparedEpisodeInitialization,
  UnknownIntervalDto,
} from "./model-episode.types";
import { unknownIntervalDurationDays } from "./unknown-intervals";

export type ModelDatabaseClient = PrismaClient | Prisma.TransactionClient;

const episodeSelect = {
  id: true,
  profileId: true,
  startDate: true,
  timezone: true,
  modelVersion: true,
  active: true,
  ecfPolicy: true,
  baselineEnergyIntakeKcalPerDay: true,
  baselineCarbIntakeG: true,
  baselineNutritionFallback: true,
  nutritionMaxBridgeDays: true,
  baselineWindowStartDate: true,
  baselineWindowEndDate: true,
  baselineNutritionDayCount: true,
  baselineWeightObservationCount: true,
  baselineWeightTrendKgPerWeek: true,
  baselineWeightTrendPercentPerWeek: true,
  initialFatMassKg: true,
  initialLeanTissueKg: true,
  initialGlycogenKg: true,
  baselineExtracellularFluidLiters: true,
  initialExtracellularFluidDeviationLiters: true,
  initialAdaptiveThermogenesisKcalPerDay: true,
  initialFilteredWeightKg: true,
  initialWeightFilterVarianceKg2: true,
  initialRmrKcalPerDay: true,
  dynamicRmrFatCoefficient: true,
  dynamicRmrLeanCoefficient: true,
  dynamicRmrCalibrationOffsetKcalPerDay: true,
  adaptiveThermogenesisBeta: true,
  adaptiveThermogenesisTimeConstantDays: true,
  weightProcessNoiseVarianceKg2PerDay: true,
  weightMeasurementNoiseVarianceKg2: true,
  personalOffsetKcalPerDay: true,
  activityCalibration: true,
  calibrationStatus: true,
  calibrationDiagnostics: true,
  latestModeledDate: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ModelEpisodeSelect;

type EpisodeRecord = Prisma.ModelEpisodeGetPayload<{ select: typeof episodeSelect }>;

const unknownIntervalSelect = {
  id: true,
  startDate: true,
  lastUnknownDate: true,
  endDate: true,
  anchorDate: true,
  firstPostGapObservationDate: true,
  postGapObservedDayCount: true,
  postGapObservationDates: true,
  missingTransitionFields: true,
  recoveryRequired: true,
} satisfies Prisma.ModelUnknownIntervalSelect;

type UnknownIntervalRecord = Prisma.ModelUnknownIntervalGetPayload<{
  select: typeof unknownIntervalSelect;
}>;

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function nutritionVector(value: Prisma.JsonValue | null): NutritionVector | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, Prisma.JsonValue>;
  const fields = ["caloriesKcal", "proteinG", "fatG", "carbsG"] as const;
  if (!fields.every((field) => typeof candidate[field] === "number"
      && Number.isFinite(candidate[field]) && candidate[field] >= 0)) return null;
  return Object.fromEntries(fields.map((field) => [field, candidate[field]])) as NutritionVector;
}

function toEpisode(record: EpisodeRecord): PersistedEpisode {
  const glycogenParameters = createGlycogenParameters({
    baselineCarbIntakeG: record.baselineCarbIntakeG,
    initialGlycogenKg: record.initialGlycogenKg,
  });
  return {
    id: record.id,
    profileId: record.profileId,
    startDate: record.startDate,
    timezone: record.timezone,
    modelVersion: record.modelVersion,
    active: record.active,
    ecfPolicy: record.ecfPolicy as PersistedEpisode["ecfPolicy"],
    baselineEnergyIntakeKcalPerDay: record.baselineEnergyIntakeKcalPerDay,
    baselineCarbIntakeG: record.baselineCarbIntakeG,
    baselineNutritionFallback: nutritionVector(record.baselineNutritionFallback),
    nutritionMaxBridgeDays: record.nutritionMaxBridgeDays,
    baselineWindowStartDate: record.baselineWindowStartDate,
    baselineWindowEndDate: record.baselineWindowEndDate,
    baselineNutritionDayCount: record.baselineNutritionDayCount,
    baselineWeightObservationCount: record.baselineWeightObservationCount,
    baselineWeightTrendKgPerWeek: record.baselineWeightTrendKgPerWeek,
    baselineWeightTrendPercentPerWeek: record.baselineWeightTrendPercentPerWeek,
    initialState: {
      fatMassKg: record.initialFatMassKg,
      leanTissueKg: record.initialLeanTissueKg,
      glycogenKg: record.initialGlycogenKg,
      baselineExtracellularFluidLiters: record.baselineExtracellularFluidLiters,
      extracellularFluidDeviationLiters:
        record.initialExtracellularFluidDeviationLiters,
      adaptiveThermogenesisKcalPerDay:
        record.initialAdaptiveThermogenesisKcalPerDay,
      weightFilterState: {
        estimatedWeightKg: record.initialFilteredWeightKg,
        varianceKg2: record.initialWeightFilterVarianceKg2,
      },
    },
    simulatorParameters: {
      rmrParameters: {
        fatMassKcalPerKgPerDay: record.dynamicRmrFatCoefficient,
        leanTissueKcalPerKgPerDay: record.dynamicRmrLeanCoefficient,
        calibrationOffsetKcalPerDay:
          record.dynamicRmrCalibrationOffsetKcalPerDay,
      },
      glycogenParameters,
      baselineEnergyIntakeKcalPerDay: record.baselineEnergyIntakeKcalPerDay,
      adaptiveThermogenesis: {
        beta: record.adaptiveThermogenesisBeta,
        timeConstantDays: record.adaptiveThermogenesisTimeConstantDays,
      },
      weightFilter: {
        processNoiseVarianceKg2PerDay:
          record.weightProcessNoiseVarianceKg2PerDay,
        measurementNoiseVarianceKg2:
          record.weightMeasurementNoiseVarianceKg2,
      },
    },
    initialRmrKcalPerDay: record.initialRmrKcalPerDay,
    personalOffsetKcalPerDay: record.personalOffsetKcalPerDay,
    activityCalibration: record.activityCalibration,
    calibrationStatus:
      record.calibrationStatus as PersistedEpisode["calibrationStatus"],
    calibrationDiagnostics: record.calibrationDiagnostics,
    latestModeledDate: record.latestModeledDate,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function decimal(value: Prisma.Decimal | null): number | null {
  return value?.toNumber() ?? null;
}

function stringArray(value: Prisma.JsonValue): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function toUnknownInterval(record: UnknownIntervalRecord): UnknownIntervalDto {
  return {
    id: record.id,
    startDate: record.startDate,
    lastUnknownDate: record.lastUnknownDate,
    endDate: record.endDate,
    anchorDate: record.anchorDate,
    firstPostGapObservationDate: record.firstPostGapObservationDate,
    postGapObservedDayCount: record.postGapObservedDayCount,
    postGapObservationDates: stringArray(record.postGapObservationDates),
    missingTransitionFields: stringArray(record.missingTransitionFields),
    recoveryRequired: record.recoveryRequired as true,
    durationDays: unknownIntervalDurationDays(record),
    open: record.endDate === null,
  };
}

export class ModelEpisodeRepository {
  constructor(private readonly client: ModelDatabaseClient = prisma) {}

  async getProfile(): Promise<ModelProfileSource | null> {
    const profile = await this.client.profile.findUnique({
      where: { id: 1 },
      select: { id: true, sex: true, dateOfBirth: true, heightCm: true },
    });
    return profile ? {
      id: profile.id,
      sex: profile.sex as ModelProfileSource["sex"],
      dateOfBirth: profile.dateOfBirth.toISOString().slice(0, 10),
      heightCm: profile.heightCm.toNumber(),
    } : null;
  }

  async getActive(): Promise<PersistedEpisode | null> {
    const record = await this.client.modelEpisode.findFirst({
      where: { active: true },
      orderBy: { id: "desc" },
      select: episodeSelect,
    });
    return record ? toEpisode(record) : null;
  }

  async getById(id: number): Promise<PersistedEpisode | null> {
    const record = await this.client.modelEpisode.findUnique({
      where: { id }, select: episodeSelect,
    });
    return record ? toEpisode(record) : null;
  }

  async loadSources(from: string, to: string): Promise<HistoricalModelSources> {
    const [days, snapshots, workIntervals] = await Promise.all([
      this.client.dailyHealthData.findMany({
        where: { date: { gte: from, lte: to } },
        orderBy: { date: "asc" },
        select: {
          date: true,
          weightKg: true,
          bodyFatPercent: true,
          caloriesKcal: true,
          proteinG: true,
          fatG: true,
          carbsG: true,
          averageWalkingSpeedKmh: true,
          walkingDistanceKm: true,
          strengthTrainingMinutes: true,
        },
      }),
      this.client.healthSyncSnapshot.findMany({
        where: { date: { gte: from, lte: to } },
        orderBy: [{ date: "asc" }, { receivedAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          date: true,
          receivedAt: true,
          syncedAt: true,
          steps: true,
          walkingDistanceKm: true,
        },
      }),
      this.client.workInterval.findMany({
        where: { date: { gte: from, lte: to } },
        orderBy: [{ date: "asc" }, { startAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          date: true,
          startAt: true,
          endAt: true,
          timezone: true,
          category: true,
          breakMinutes: true,
        },
      }),
    ]);
    return {
      days: days.map((day) => ({
        ...day,
        bodyFatPercent: decimal(day.bodyFatPercent),
        averageWalkingSpeedKmh: decimal(day.averageWalkingSpeedKmh),
        walkingDistanceKm: decimal(day.walkingDistanceKm),
        strengthTrainingMinutes: decimal(day.strengthTrainingMinutes),
      })),
      snapshots: snapshots.map((snapshot) => ({
        ...snapshot,
        walkingDistanceKm: decimal(snapshot.walkingDistanceKm),
      })),
      workIntervals,
    };
  }

  async deactivateActive(at: Date): Promise<void> {
    await this.client.modelEpisode.updateMany({
      where: { active: true },
      data: { active: false, deactivatedAt: at },
    });
  }

  async createPrepared(input: PreparedEpisodeInitialization): Promise<PersistedEpisode> {
    const record = await this.client.modelEpisode.create({
      data: {
        profileId: input.profileId,
        startDate: input.startDate,
        timezone: input.timezone,
        modelVersion: input.modelVersion,
        active: true,
        ecfPolicy: input.ecfPolicy,
        baselineEnergyIntakeKcalPerDay:
          input.baseline.baselineEnergyIntakeKcalPerDay,
        baselineCarbIntakeG: input.baseline.baselineCarbIntakeG,
        baselineNutritionFallback: jsonValue(input.baseline.fallbackNutrition),
        nutritionMaxBridgeDays: input.nutritionMaxBridgeDays,
        baselineWindowStartDate: input.baseline.diagnostics.windowStartDate,
        baselineWindowEndDate: input.baseline.diagnostics.windowEndDate,
        baselineNutritionDayCount:
          input.baseline.diagnostics.completeNutritionDayCount,
        baselineWeightObservationCount:
          input.baseline.diagnostics.weightObservationCount,
        baselineWeightTrendKgPerWeek:
          input.baseline.diagnostics.weightTrendKgPerWeek,
        baselineWeightTrendPercentPerWeek:
          input.baseline.diagnostics.weightTrendPercentPerWeek,
        baselineDerivationMethod: input.baseline.diagnostics.method,
        initialFatMassKg: input.initialState.fatMassKg,
        initialLeanTissueKg: input.initialState.leanTissueKg,
        initialGlycogenKg: input.initialState.glycogenKg,
        baselineExtracellularFluidLiters:
          input.initialState.baselineExtracellularFluidLiters,
        initialExtracellularFluidDeviationLiters:
          input.initialState.extracellularFluidDeviationLiters,
        initialAdaptiveThermogenesisKcalPerDay:
          input.initialState.adaptiveThermogenesisKcalPerDay,
        initialFilteredWeightKg:
          input.initialState.weightFilterState.estimatedWeightKg,
        initialWeightFilterVarianceKg2:
          input.initialState.weightFilterState.varianceKg2,
        initialRmrKcalPerDay: input.initialRmrKcalPerDay,
        dynamicRmrFatCoefficient:
          input.simulatorParameters.rmrParameters.fatMassKcalPerKgPerDay,
        dynamicRmrLeanCoefficient:
          input.simulatorParameters.rmrParameters.leanTissueKcalPerKgPerDay,
        dynamicRmrCalibrationOffsetKcalPerDay:
          input.simulatorParameters.rmrParameters.calibrationOffsetKcalPerDay,
        adaptiveThermogenesisBeta:
          input.simulatorParameters.adaptiveThermogenesis.beta,
        adaptiveThermogenesisTimeConstantDays:
          input.simulatorParameters.adaptiveThermogenesis.timeConstantDays,
        weightProcessNoiseVarianceKg2PerDay:
          input.simulatorParameters.weightFilter.processNoiseVarianceKg2PerDay,
        weightMeasurementNoiseVarianceKg2:
          input.simulatorParameters.weightFilter.measurementNoiseVarianceKg2,
        personalOffsetKcalPerDay: 0,
        activityCalibration: 1,
        calibrationStatus: "insufficient-history",
        calibrationDiagnostics: jsonValue({
          initialization: {
            bodyFatObservationCount: input.bodyFatObservationCount,
            bodyFatSpreadPercent: input.bodyFatSpreadPercent,
            baseline: input.baseline.diagnostics,
          },
        }),
      },
      select: episodeSelect,
    });
    return toEpisode(record);
  }

  async persistCalculation(
    episodeId: number,
    calculation: EpisodeCalculation,
    modelVersion?: string,
  ): Promise<void> {
    const dates = calculation.dailyStates.map(({ date }) => date);
    await this.client.dailyModelState.deleteMany({
      where: {
        episodeId,
        ...(dates.length > 0 ? { date: { notIn: dates } } : {}),
      },
    });
    const intervalStarts = calculation.unknownIntervals.map(({ startDate }) => startDate);
    await this.client.modelUnknownInterval.deleteMany({
      where: {
        episodeId,
        ...(intervalStarts.length > 0 ? { startDate: { notIn: intervalStarts } } : {}),
      },
    });
    for (const interval of calculation.unknownIntervals) {
      const data = {
        lastUnknownDate: interval.lastUnknownDate,
        endDate: interval.endDate,
        anchorDate: interval.anchorDate,
        firstPostGapObservationDate: interval.firstPostGapObservationDate,
        postGapObservedDayCount: interval.postGapObservedDayCount,
        postGapObservationDates: jsonValue(interval.postGapObservationDates),
        missingTransitionFields: jsonValue(interval.missingTransitionFields),
        recoveryRequired: interval.recoveryRequired,
      };
      await this.client.modelUnknownInterval.upsert({
        where: { episodeId_startDate: { episodeId, startDate: interval.startDate } },
        create: { episodeId, startDate: interval.startDate, ...data },
        update: data,
      });
    }
    for (const state of calculation.dailyStates) {
      const data = {
        status: state.status,
        dataQuality: state.dataQuality,
        nutritionSource: state.nutrition.source,
        nutritionImputationMethod: state.nutrition.method,
        nutritionReferenceDayCount: state.nutrition.referenceDayCount,
        nutritionGapLength: state.nutrition.gapLength,
        nutritionImputationDiagnostics: jsonValue({
          referenceDates: state.nutrition.referenceDates,
          observedFields: state.nutrition.observedFields,
          imputedFields: state.nutrition.imputedFields,
          referenceCaloriesMedian: state.nutrition.referenceCaloriesMedian,
          referenceCaloriesMad: state.nutrition.referenceCaloriesMad,
          referenceMacroMadG: state.nutrition.referenceMacroMadG,
          dependency: state.nutrition.dependency,
        }),
        sourceQuality: jsonValue(state.sourceQuality),
        missingFields: jsonValue(state.missingFields),
        modelVersion: state.modelVersion,
        startWeightKg: state.startWeightKg,
        endWeightKg: state.endWeightKg,
        fatMassKg: state.fatMassKg,
        leanTissueKg: state.leanTissueKg,
        glycogenKg: state.glycogenKg,
        extracellularFluidDeviationLiters:
          state.extracellularFluidDeviationLiters,
        dynamicRmrKcalPerDay: state.dynamicRmrKcalPerDay,
        tefKcalPerDay: state.tefKcalPerDay,
        activityKcalPerDay: state.activityKcalPerDay,
        adaptiveThermogenesisKcalPerDay:
          state.adaptiveThermogenesisKcalPerDay,
        energyIntakeKcal: state.energyIntakeKcal,
        energyExpenditureKcal: state.energyExpenditureKcal,
        energyBalanceKcal: state.energyBalanceKcal,
        deltaFatKg: state.deltaFatKg,
        deltaLeanTissueKg: state.deltaLeanTissueKg,
        deltaGlycogenKg: state.deltaGlycogenKg,
        filteredWeightKg: state.filteredWeightKg,
      };
      await this.client.dailyModelState.upsert({
        where: { episodeId_date: { episodeId, date: state.date } },
        create: { episodeId, date: state.date, ...data },
        update: data,
      });
    }
    await this.client.modelEpisode.update({
      where: { id: episodeId },
      data: {
        ...(modelVersion === undefined ? {} : { modelVersion }),
        personalOffsetKcalPerDay:
          calculation.calibration.parameters.personalOffsetKcalPerDay,
        activityCalibration:
          calculation.calibration.parameters.activityCalibration,
        calibrationStatus: calculation.calibration.status,
        calibrationDiagnostics: jsonValue({
          scientificCalibration: calculation.calibration.diagnostics,
          nutritionProvenance: calculation.calibrationNutritionDiagnostics,
        }),
        latestModeledDate: calculation.latestModeledDate,
      },
    });
  }

  async status(id?: number): Promise<ModelStatusDto | null> {
    const episode = id === undefined ? await this.getActive() : await this.getById(id);
    if (!episode) return null;
    const [
      daysModeled,
      incompleteDays,
      observedNutritionDays,
      imputedNutritionDays,
      unbridgeableNutritionDays,
      latest,
      unknownIntervals,
    ] = await Promise.all([
      this.client.dailyModelState.count({ where: { episodeId: episode.id, status: "complete" } }),
      this.client.dailyModelState.count({ where: { episodeId: episode.id, status: { not: "complete" } } }),
      this.client.dailyModelState.count({
        where: { episodeId: episode.id, nutritionSource: "observed" },
      }),
      this.client.dailyModelState.count({
        where: { episodeId: episode.id, nutritionSource: { in: ["imputed-local", "imputed-fallback"] } },
      }),
      this.client.dailyModelState.count({
        where: { episodeId: episode.id, nutritionSource: "missing" },
      }),
      this.client.dailyModelState.findFirst({
        where: { episodeId: episode.id, status: "complete" },
        orderBy: { date: "desc" },
        select: {
          endWeightKg: true,
          filteredWeightKg: true,
          fatMassKg: true,
          leanTissueKg: true,
          dynamicRmrKcalPerDay: true,
          energyExpenditureKcal: true,
        },
      }),
      this.client.modelUnknownInterval.findMany({
        where: { episodeId: episode.id },
        orderBy: [{ startDate: "asc" }, { id: "asc" }],
        select: unknownIntervalSelect,
      }),
    ]);
    const intervalDtos = unknownIntervals.map(toUnknownInterval);
    return {
      episodeId: episode.id,
      episodeStartDate: episode.startDate,
      latestModeledDate: episode.latestModeledDate,
      modelVersion: episode.modelVersion,
      calibrationStatus: episode.calibrationStatus,
      personalOffsetKcalPerDay: episode.personalOffsetKcalPerDay,
      activityCalibration: episode.activityCalibration,
      daysModeled,
      incompleteDays,
      observedNutritionDays,
      imputedNutritionDays,
      unbridgeableNutritionDays,
      currentPredictedWeightKg: latest?.endWeightKg ?? null,
      currentFilteredWeightKg: latest?.filteredWeightKg ?? null,
      currentFatMassKg: latest?.fatMassKg ?? null,
      currentLeanTissueKg: latest?.leanTissueKg ?? null,
      currentDynamicRmrKcalPerDay: latest?.dynamicRmrKcalPerDay ?? null,
      currentModeledTdeeKcalPerDay: latest?.energyExpenditureKcal ?? null,
      continuityStatus: intervalDtos.length === 0 ? "resolved" : "awaiting-recovery",
      lastResolvedDate: episode.latestModeledDate,
      recoveryRequired: intervalDtos.length > 0,
      unknownIntervalCount: intervalDtos.length,
      unresolvedDayCount: intervalDtos.reduce((sum, interval) => sum + interval.durationDays, 0),
      postGapObservedDayCount: intervalDtos.reduce(
        (sum, interval) => sum + interval.postGapObservedDayCount,
        0,
      ),
      unknownIntervals: intervalDtos,
    };
  }

  async history(query: ModelHistoryQuery): Promise<{
    episodeId: number;
    days: unknown[];
    unknownIntervals: UnknownIntervalDto[];
    observationsAwaitingRecovery: Array<{
      date: string;
      source: "recorded-after-unresolved-transition";
    }>;
  } | null> {
    const episode = query.episodeId === undefined
      ? await this.getActive()
      : await this.getById(query.episodeId);
    if (!episode) return null;
    const [rows, intervals] = await Promise.all([
      this.client.dailyModelState.findMany({
      where: {
        episodeId: episode.id,
        date: {
          ...(query.from ? { gte: query.from } : {}),
          ...(query.to ? { lte: query.to } : {}),
        },
      },
      orderBy: { date: "asc" },
      take: query.limit,
      skip: query.offset,
      select: {
        date: true,
        status: true,
        dataQuality: true,
        nutritionSource: true,
        nutritionImputationMethod: true,
        nutritionReferenceDayCount: true,
        nutritionGapLength: true,
        nutritionImputationDiagnostics: true,
        sourceQuality: true,
        missingFields: true,
        modelVersion: true,
        startWeightKg: true,
        endWeightKg: true,
        fatMassKg: true,
        leanTissueKg: true,
        glycogenKg: true,
        extracellularFluidDeviationLiters: true,
        dynamicRmrKcalPerDay: true,
        tefKcalPerDay: true,
        activityKcalPerDay: true,
        adaptiveThermogenesisKcalPerDay: true,
        energyIntakeKcal: true,
        energyExpenditureKcal: true,
        energyBalanceKcal: true,
        deltaFatKg: true,
        deltaLeanTissueKg: true,
        deltaGlycogenKg: true,
        filteredWeightKg: true,
        updatedAt: true,
      },
      }),
      this.client.modelUnknownInterval.findMany({
        where: { episodeId: episode.id },
        orderBy: [{ startDate: "asc" }, { id: "asc" }],
        select: unknownIntervalSelect,
      }),
    ]);
    const intervalDtos = intervals.map(toUnknownInterval).filter((interval) => {
      const unknownOverlap = interval.startDate <= (query.to ?? "9999-12-31")
        && interval.lastUnknownDate >= (query.from ?? "0000-01-01");
      const observationOverlap = interval.postGapObservationDates.some(
        (date) => (!query.from || date >= query.from) && (!query.to || date <= query.to),
      );
      return unknownOverlap || observationOverlap;
    });
    const observationDates = [...new Set(intervalDtos.flatMap(
      ({ postGapObservationDates }) => postGapObservationDates,
    ))].filter((date) => (!query.from || date >= query.from) && (!query.to || date <= query.to))
      .sort();
    return {
      episodeId: episode.id,
      days: rows.map((row) => ({ ...row, updatedAt: row.updatedAt.toISOString() })),
      unknownIntervals: intervalDtos,
      observationsAwaitingRecovery: observationDates.map((date) => ({
        date,
        source: "recorded-after-unresolved-transition" as const,
      })),
    };
  }
}

export const modelEpisodeRepository = new ModelEpisodeRepository();
