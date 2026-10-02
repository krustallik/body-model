import { normalizeDailyMeasurements } from "@/modules/days/measurement-policy";
import { resolveWorkoutFeedObserved } from "@/modules/health/workout-feed-coverage";
import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { DEFAULT_TIME_ZONE, instantToLocalDateTime, localDateTimeToInstant } from "@/model/time-zone";
import { addCalendarDays } from "./model-calendar";
import { createGlycogenParameters } from "@/model/body-composition/glycogen";
import type { EpisodeCalculation } from "./episode-calculation";
import type { ModelHistoryQuery } from "./model-episode.schema";
import { isProductionGenerationCurrentV1 } from "./publication-generation-v1";
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

import {
  strengthEstimateFreshV1,
  strengthInputFingerprintV1,
  strengthSetFingerprintV1,
} from "@/modules/training/strength-publication-v1";
import { EXPERIMENTAL_STRENGTH_ACTIVE_ENERGY_V1_REVISION } from "@/modules/training/experimental-strength-active-energy-v1";
import { persistedPayloadFromUnknown } from "@/modules/training/persisted-load-accounting-v1";
import { episodeTimeContextForInstantV1 } from "./episode-time-context-v1";

export type ModelDatabaseClient = PrismaClient | Prisma.TransactionClient;

function strengthShadowSessionRevision(result: unknown): number | null {
  if (result === null || typeof result !== "object" || Array.isArray(result)) return null;
  const revision = (result as { sessionRevision?: unknown }).sessionRevision;
  return typeof revision === "number" && Number.isInteger(revision) ? revision : null;
}

function strengthShadowKcal(result: unknown): number | null {
  if (result === null || typeof result !== "object" || Array.isArray(result)) return null;
  const kcal = (result as { estimatedActiveKcal?: unknown }).estimatedActiveKcal;
  return typeof kcal === "number" && Number.isFinite(kcal) && kcal >= 0 ? kcal : null;
}

function strengthShadowInputFingerprint(result: unknown): string | null {
  if (result === null || typeof result !== "object" || Array.isArray(result)) return null;
  const fingerprint = (result as { inputFingerprint?: unknown }).inputFingerprint;
  return typeof fingerprint === "string" && fingerprint.length > 0 ? fingerprint : null;
}

function toSetFingerprintRows(
  sets: readonly {
    id?: number;
    sessionExerciseId?: number;
    resistanceType?: string;
    completedAt?: Date | string | null;
    reps: number;
    weightKg: number | { toNumber(): number } | null;
    bandNominalResistanceKg?: number | { toNumber(): number } | null;
    rir?: number | null;
  }[],
): Array<{ id?: number; sessionExerciseId?: number; resistanceType?: string; completedAt?: string | null; reps: number; weightKg: number | null; bandNominalResistanceKg?: number | null; rir?: number | null }> {
  return sets.map((set) => ({
    id: set.id,
    sessionExerciseId: set.sessionExerciseId,
    resistanceType: set.resistanceType,
    completedAt: set.completedAt instanceof Date ? set.completedAt.toISOString() : set.completedAt ?? null,
    reps: set.reps,
    weightKg: set.weightKg === null || set.weightKg === undefined
      ? null
      : typeof set.weightKg === "number"
        ? set.weightKg
        : set.weightKg.toNumber(),
    bandNominalResistanceKg: set.bandNominalResistanceKg === null || set.bandNominalResistanceKg === undefined
      ? null
      : typeof set.bandNominalResistanceKg === "number"
        ? set.bandNominalResistanceKg
        : set.bandNominalResistanceKg.toNumber(),
    rir: set.rir ?? null,
  }));
}

function strengthEstimateFresh(input: {
  estimateKcal: number | null;
  sessionId: number;
  sessionRevision: number;
  shadowResult: unknown;
  massKg: number | null;
  sameDayMassKg: number | null;
  startOfDayMassKg?: number | null;
  sets: readonly {
    id?: number;
    sessionExerciseId?: number;
    resistanceType?: string;
    completedAt?: Date | string | null;
    reps: number;
    weightKg: number | { toNumber(): number } | null;
    bandNominalResistanceKg?: number | { toNumber(): number } | null;
    rir?: number | null;
  }[];
  estimatorVersion?: string | null;
  estimatorInputs?: unknown;
}): boolean {
  const currentInputFingerprint = strengthInputFingerprintV1({
    sessionId: input.sessionId,
    sessionRevision: input.sessionRevision,
    massKg: input.massKg,
    sameDayMassKg: input.sameDayMassKg,
    startOfDayMassKg: input.startOfDayMassKg ?? null,
    setFingerprint: strengthSetFingerprintV1(toSetFingerprintRows(input.sets)),
    estimatorVersion: input.estimatorVersion ?? EXPERIMENTAL_STRENGTH_ACTIVE_ENERGY_V1_REVISION,
    estimatorInputs: input.estimatorInputs ?? null,
  });
  return strengthEstimateFreshV1({
    estimateKcal: input.estimateKcal,
    sessionRevision: input.sessionRevision,
    shadowSessionRevision: strengthShadowSessionRevision(input.shadowResult),
    storedInputFingerprint: strengthShadowInputFingerprint(input.shadowResult),
    currentInputFingerprint,
  });
}

function strengthStage02MassSnapshot(session: {
  currentSnapshotRevision: number | null;
  accountingInputRevision: number;
  currentAccountingSnapshot: {
    snapshotRevision: number;
    accountingInputRevision: number;
    inputFingerprint: string;
    massResolutionIdentity: string;
    payloadVersion: string;
    payload: unknown;
  } | null;
}) {
  const snapshot = session.currentAccountingSnapshot;
  if (!snapshot || snapshot.snapshotRevision !== session.currentSnapshotRevision
    || snapshot.accountingInputRevision !== session.accountingInputRevision) return null;
  const payload = persistedPayloadFromUnknown(snapshot.payload);
  if (!payload || payload.snapshotRevision !== snapshot.snapshotRevision
    || payload.accountingInputRevision !== session.accountingInputRevision
    || payload.inputFingerprint !== snapshot.inputFingerprint
    || payload.massResolutionIdentity !== snapshot.massResolutionIdentity
    || payload.schemaVersion !== snapshot.payloadVersion) return null;
  return {
    reference: payload.massReference,
    snapshotRevision: payload.snapshotRevision,
    inputFingerprint: payload.inputFingerprint,
    massResolutionIdentity: payload.massResolutionIdentity,
  };
}

function strengthEstimatorInputs(input: {
  session: {
    id: number;
    entryMode: string;
    webStartedAt: Date | null;
    webEndedAt: Date | null;
    effectiveAccountingAt: Date | null;
    createdAt: Date;
    currentSnapshotRevision: number | null;
    accountingInputRevision: number;
    currentAccountingSnapshot: {
      snapshotRevision: number;
      accountingInputRevision: number;
      inputFingerprint: string;
      massResolutionIdentity: string;
      payloadVersion: string;
      payload: unknown;
    } | null;
    matchedWorkout?: { startAt: Date; endAt: Date; durationMinutes: number | null } | null;
  };
  episodes: readonly {
    id: number;
    timezone: string;
    modelVersion: string;
    startDate: string;
    latestModeledDate: string | null;
    active: boolean;
    updatedAt: Date;
  }[];
  modelDays: readonly {
    episodeId: number;
    date: string;
    status: string;
    dynamicRmrKcalPerDay: unknown;
    updatedAt: Date;
  }[];
}) {
  const stage02Mass = strengthStage02MassSnapshot(input.session);
  const occurrenceAt = input.session.matchedWorkout?.startAt
    ?? input.session.effectiveAccountingAt
    ?? input.session.webStartedAt
    ?? input.session.createdAt;
  const context = episodeTimeContextForInstantV1(input.episodes, occurrenceAt);
  const episode = context.episode;
  const modelDate = context.date;
  const modelDay = episode !== null && modelDate >= episode.startDate
      && (episode.latestModeledDate === null || modelDate <= episode.latestModeledDate)
    ? input.modelDays.find((candidate) => candidate.episodeId === episode.id && candidate.date === modelDate) ?? null
    : null;
  return {
    entryMode: input.session.entryMode,
    startAt: input.session.matchedWorkout?.startAt.toISOString() ?? input.session.webStartedAt?.toISOString() ?? null,
    endAt: input.session.matchedWorkout?.endAt.toISOString() ?? input.session.webEndedAt?.toISOString() ?? null,
    durationMinutes: input.session.matchedWorkout?.durationMinutes ?? null,
    stage02MassReference: stage02Mass?.reference ?? null,
    stage02SnapshotRevision: stage02Mass?.snapshotRevision ?? null,
    stage02InputFingerprint: stage02Mass?.inputFingerprint ?? null,
    stage02MassResolutionIdentity: stage02Mass?.massResolutionIdentity ?? null,
    modelEpisodeId: episode?.id ?? null,
    modelEpisodeVersion: episode?.modelVersion ?? null,
    modelEpisodeStartDate: episode?.startDate ?? null,
    modelEpisodeLatestModeledDate: episode?.latestModeledDate ?? null,
    modelEpisodeUpdatedAt: episode?.updatedAt.toISOString() ?? null,
    modelTimeZone: context.timeZone,
    modelDate,
    modelDayRmrKcalPerDay: modelDay?.status === "complete" ? modelDay.dynamicRmrKcalPerDay : null,
    modelDayUpdatedAt: modelDay?.status === "complete" ? modelDay.updatedAt.toISOString() : null,
  };
}

function strengthStage02MassKg(session: Parameters<typeof strengthStage02MassSnapshot>[0]): number | null {
  const reference = strengthStage02MassSnapshot(session)?.reference;
  return reference && reference.status !== "unavailable"
    && Number.isFinite(reference.valueKg) && reference.valueKg > 0
    ? reference.valueKg
    : null;
}

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
  observedReferenceNutrition: true,
  energyHomeostasisReferenceKcalPerDay: true,
  glycogenReferenceCarbIntakeG: true,
  initialPersonalOffsetKcalPerDay: true,
  initializationStatus: true,
  initializationDiagnostics: true,
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
    initialPersonalOffsetKcalPerDay: record.initialPersonalOffsetKcalPerDay ?? 0,
    initializationStatus: record.initializationStatus,
    initializationDiagnostics: record.initializationDiagnostics,
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

  /** Resolve the latest episode that had started by the requested local date. */
  async getAsOf(localDate: string): Promise<PersistedEpisode | null> {
    const record = await this.client.modelEpisode.findFirst({
      where: { profileId: 1, startDate: { lte: localDate } },
      orderBy: [{ startDate: "desc" }, { id: "desc" }],
      select: episodeSelect,
    });
    return record ? toEpisode(record) : null;
  }

  async loadSources(from: string, to: string, timeZone = DEFAULT_TIME_ZONE): Promise<HistoricalModelSources> {
    const contextFrom = addCalendarDays(from, -2);
    const contextTo = addCalendarDays(to, 2);
    const workoutWindowStart = localDateTimeToInstant(from, "00:00", timeZone);
    const workoutWindowEnd = localDateTimeToInstant(addCalendarDays(to, 1), "00:00", timeZone);
    const webWindowStart = localDateTimeToInstant(addCalendarDays(from, -2), "00:00", timeZone);
    const webWindowEnd = localDateTimeToInstant(addCalendarDays(to, 3), "00:00", timeZone);
    const [days, snapshots, activityIntervals, workIntervals, workoutRows, heartRateSamples, webSessions, reconciliationRows] = await Promise.all([
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
          workoutFeedObserved: true,
          rawPayload: true,
        },
      }),
      this.client.healthSyncSnapshot.findMany({
        where: { date: { gte: contextFrom, lte: contextTo } },
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
      this.client.healthActivityInterval.findMany({
        where: {
          OR: [
            { date: { gte: contextFrom, lte: contextTo } },
            { startAt: { lt: workoutWindowEnd }, endAt: { gt: workoutWindowStart } },
          ],
        },
        orderBy: [{ date: "asc" }, { startAt: "asc" }, { id: "asc" }],
        select: { id: true, date: true, metric: true, startAt: true, endAt: true, value: true },
      }),
      this.client.workInterval.findMany({
        where: { date: { gte: contextFrom, lte: contextTo } },
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
      this.client.workout.findMany({
        where: {
          hiddenFromHistory: false,
          OR: [
            { dailyHealthData: { date: { gte: from, lte: to } } },
            { startAt: { gte: workoutWindowStart, lt: workoutWindowEnd } },
          ],
        },
        orderBy: [{ startAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          externalId: true,
          sourceIdentity: true,
          type: true,
          startAt: true,
          endAt: true,
          durationMinutes: true,
          energyKcal: true,
          activeEnergyKcal: true,
          manualStepCount: true,
          manualActiveEnergyKcal: true,
          activeEnergyAliases: {
            where: { profileId: 1, sourceType: "workout" },
            select: {
              event: { select: { currentKcal: true, currentSource: true, resolutionRevision: true, isStale: true } },
            },
          },
          dailyHealthData: { select: { date: true, weightKg: true } },
          matchedDiarySession: {
            select: {
              id: true,
              status: true,
              revision: true,
              entryMode: true,
              webStartedAt: true,
              webEndedAt: true,
              effectiveAccountingAt: true,
              createdAt: true,
              currentSnapshotRevision: true,
              accountingInputRevision: true,
              currentAccountingSnapshot: { select: {
                snapshotRevision: true,
                accountingInputRevision: true,
                inputFingerprint: true,
                massResolutionIdentity: true,
                payloadVersion: true,
                payload: true,
              } },
              experimentalStrengthEnergyShadow: {
                select: { result: true, sourceFingerprint: true, modelRevision: true },
              },
              exercises: {
                select: {
                  resistanceType: true,
                  sets: {
                    select: {
                      id: true,
                      sessionExerciseId: true,
                      completedAt: true,
                      reps: true,
                      weightKg: true,
                      bandNominalResistanceKg: true,
                      rir: true,
                    },
                  },
                },
              },
            },
          },
        },
      }),
      this.client.heartRateSample.findMany({
        where: {
          OR: [
            { date: { gte: contextFrom, lte: contextTo } },
            { timestamp: { gte: workoutWindowStart, lt: workoutWindowEnd } },
          ],
        },
        orderBy: [{ timestamp: "asc" }, { id: "asc" }],
        select: { date: true, timestamp: true, bpm: true, source: true },
      }),
      this.client.strengthDiarySession.findMany({
        where: {
          matchedWorkoutId: null,
          status: { in: ["COMPLETED", "ACTIVE"] },
          webStartedAt: { gte: webWindowStart, lt: webWindowEnd },
          webEndedAt: { not: null },
        },
        select: {
          id: true,
          status: true,
          revision: true,
          entryMode: true,
          webStartedAt: true,
          webEndedAt: true,
          effectiveAccountingAt: true,
          createdAt: true,
          currentSnapshotRevision: true,
          accountingInputRevision: true,
          currentAccountingSnapshot: { select: {
            snapshotRevision: true,
            accountingInputRevision: true,
            inputFingerprint: true,
            massResolutionIdentity: true,
            payloadVersion: true,
            payload: true,
          } },
          experimentalStrengthEnergyShadow: {
            select: { result: true, sourceFingerprint: true, modelRevision: true },
          },
          exercises: {
            select: {
              resistanceType: true,
              sets: {
                select: {
                  id: true,
                  sessionExerciseId: true,
                  completedAt: true,
                  reps: true,
                  weightKg: true,
                  bandNominalResistanceKg: true,
                  rir: true,
                },
              },
            },
          },
        },
      }),
      this.client.stepperReconciliationCandidate.findMany({
        where: {
          group: { status: { in: ["pending", "ambiguous", "confirmed"] } },
          OR: [
            { manualWorkout: { dailyHealthData: { date: { gte: contextFrom, lte: contextTo } } } },
            { garminWorkout: { dailyHealthData: { date: { gte: contextFrom, lte: contextTo } } } },
            { manualWorkout: { startAt: { gte: workoutWindowStart, lt: workoutWindowEnd } } },
            { garminWorkout: { startAt: { gte: workoutWindowStart, lt: workoutWindowEnd } } },
          ],
        },
        select: {
          manualWorkoutId: true,
          garminWorkoutId: true,
          group: {
            select: {
              id: true,
              status: true,
              evaluationRevision: true,
              provisionalWorkoutId: true,
              policyVersion: true,
              sourceRevision: true,
            },
          },
        },
      }),
    ]);
    const strengthSessions = [
      ...webSessions,
      ...workoutRows.flatMap((workout) => workout.matchedDiarySession ? [workout.matchedDiarySession] : []),
    ];
    const modelEpisodes = strengthSessions.length > 0 ? await this.client.modelEpisode.findMany({
      where: { profileId: 1 },
      select: {
        id: true,
        timezone: true,
        modelVersion: true,
        startDate: true,
        latestModeledDate: true,
        active: true,
        updatedAt: true,
      },
      orderBy: { startDate: "asc" },
    }) : [];
    const modelDays = modelEpisodes.length > 0 ? await this.client.dailyModelState.findMany({
      where: {
        episodeId: { in: modelEpisodes.map((episode) => episode.id) },
        date: { gte: contextFrom, lte: contextTo },
      },
      select: { episodeId: true, date: true, status: true, dynamicRmrKcalPerDay: true, updatedAt: true },
    }) : [];
    const webSessionEnergyAliases = webSessions.length === 0 ? [] : await this.client.activeEnergyEventAlias.findMany({
      where: {
        profileId: 1,
        sourceType: "strength-session",
        sourceId: { in: webSessions.map((session) => String(session.id)) },
      },
      select: {
        sourceId: true,
        event: { select: { currentKcal: true, currentSource: true, resolutionRevision: true, isStale: true } },
      },
    });
    const webSessionEnergyById = new Map(webSessionEnergyAliases.map((alias) => [alias.sourceId, {
      currentKcal: alias.event.currentKcal,
      currentSource: alias.event.currentSource,
      resolutionRevision: alias.event.resolutionRevision,
      isStale: alias.event.isStale,
    }]));
    return {
      days: days.map(normalizeDailyMeasurements).map((day) => ({
        ...day,
        bodyFatPercent: decimal(day.bodyFatPercent),
        averageWalkingSpeedKmh: decimal(day.averageWalkingSpeedKmh),
        walkingDistanceKm: decimal(day.walkingDistanceKm),
        strengthTrainingMinutes: decimal(day.strengthTrainingMinutes),
        workoutFeedObserved: day.workoutFeedObserved
          ?? (resolveWorkoutFeedObserved(day.rawPayload) ? true : null),
      })),
      snapshots: snapshots.map(normalizeDailyMeasurements).map((snapshot) => ({
        ...snapshot,
        walkingDistanceKm: decimal(snapshot.walkingDistanceKm),
      })),
      activityIntervals: activityIntervals.map((interval) => ({
        ...interval,
        metric: interval.metric as "steps" | "walking-distance-km",
        value: interval.value.toNumber(),
      })),
      workIntervals,
      workouts: workoutRows.map((workout) => {
        const session = workout.matchedDiarySession;
        const estimate = session?.status === "COMPLETED"
          ? strengthShadowKcal(session.experimentalStrengthEnergyShadow?.result)
          : null;
        const stage02MassKg = session ? strengthStage02MassKg(session) : null;
        const sets = session?.exercises.flatMap((exercise) => exercise.sets.map((set) => ({
          ...set,
          resistanceType: exercise.resistanceType,
        }))) ?? [];
        return {
          id: workout.id,
          // Workout occurrence belongs to the episode-local day; the related
          // health sync row's date is date-only source metadata and may use a
          // different timezone boundary.
          date: instantToLocalDateTime(workout.startAt, timeZone).date,
          externalId: workout.externalId,
          type: workout.type,
          startAt: workout.startAt,
          endAt: workout.endAt,
          durationMinutes: workout.durationMinutes,
          energyKcal: workout.energyKcal,
          activeEnergyKcal: workout.activeEnergyKcal,
          manualStepCount: workout.manualStepCount,
          manualActiveEnergyKcal: workout.manualActiveEnergyKcal,
          canonicalEnergyResolution: workout.activeEnergyAliases[0]?.event ?? null,
          bodyCastEstimateKcal: estimate,
          bodyCastEstimateFresh: session !== null && session !== undefined
            && strengthEstimateFresh({
              estimateKcal: estimate,
              sessionId: session.id,
              sessionRevision: session.revision,
              shadowResult: session.experimentalStrengthEnergyShadow?.result ?? null,
              massKg: stage02MassKg,
              sameDayMassKg: null,
              sets,
              estimatorVersion: session.experimentalStrengthEnergyShadow?.modelRevision ?? null,
              estimatorInputs: strengthEstimatorInputs({
                session: { ...session, matchedWorkout: workout },
                episodes: modelEpisodes,
                modelDays,
              }),
            }),
          strengthSessionCompleted: session?.status === "COMPLETED",
          sourceIdentity: workout.sourceIdentity,
        };
      }),
      heartRateSamples,
      webOnlyStrengthSessions: webSessions.flatMap((session) => {
        if (session.webStartedAt === null || session.webEndedAt === null) return [];
        const date = instantToLocalDateTime(session.webStartedAt, timeZone).date;
        if (date < from || date > to) return [];
        const estimate = session.status === "COMPLETED"
          ? strengthShadowKcal(session.experimentalStrengthEnergyShadow?.result)
          : null;
        const stage02MassKg = strengthStage02MassKg(session);
        const sets = session.exercises.flatMap((exercise) => exercise.sets.map((set) => ({
          ...set,
          resistanceType: exercise.resistanceType,
        })));
        return [{
          sessionId: session.id,
          date,
          status: session.status,
          revision: session.revision,
          startAt: session.webStartedAt,
          endAt: session.webEndedAt,
          bodyCastEstimateKcal: estimate,
          bodyCastEstimateFresh: strengthEstimateFresh({
            estimateKcal: estimate,
            sessionId: session.id,
            sessionRevision: session.revision,
            shadowResult: session.experimentalStrengthEnergyShadow?.result ?? null,
            massKg: stage02MassKg,
            sameDayMassKg: null,
            sets,
            estimatorVersion: session.experimentalStrengthEnergyShadow?.modelRevision ?? null,
            estimatorInputs: strengthEstimatorInputs({
              session,
              episodes: modelEpisodes,
              modelDays,
            }),
          }),
          inputFingerprint: strengthShadowInputFingerprint(session.experimentalStrengthEnergyShadow?.result)
            ?? session.experimentalStrengthEnergyShadow?.sourceFingerprint
            ?? null,
          canonicalEnergyResolution: webSessionEnergyById.get(String(session.id)) ?? null,
        }];
      }),
      reconciliationLinks: reconciliationRows.flatMap((row) => {
        const status = row.group.status;
        if (status !== "pending" && status !== "ambiguous" && status !== "confirmed") return [];
        return [{
          groupId: row.group.id,
          status,
          evaluationRevision: row.group.evaluationRevision,
          policyVersion: row.group.policyVersion,
          sourceRevision: row.group.sourceRevision,
          provisionalWorkoutId: row.group.provisionalWorkoutId,
          manualWorkoutId: row.manualWorkoutId,
          garminWorkoutId: row.garminWorkoutId,
          // Pending: provisional manual contributes; Garmin withheld.
          // Confirmed: Garmin is canonical; manual remains audit-only.
          // Ambiguous: neither contributes until resolved.
          suppressGarminEnergy: status === "pending" || status === "ambiguous",
          suppressManualEnergy: status === "confirmed" || status === "ambiguous",
        }];
      }),
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
        observedReferenceNutrition: jsonValue(
          input.observedReferenceNutrition ?? input.baseline.fallbackNutrition,
        ),
        energyHomeostasisReferenceKcalPerDay:
          input.energyHomeostasisReferenceKcalPerDay
          ?? input.baseline.baselineEnergyIntakeKcalPerDay,
        glycogenReferenceCarbIntakeG:
          input.glycogenReferenceCarbIntakeG ?? input.baseline.baselineCarbIntakeG,
        initialPersonalOffsetKcalPerDay: input.initialPersonalOffsetKcalPerDay ?? 0,
        initializationStatus: input.initializationStatus ?? "insufficient",
        initializationDiagnostics: jsonValue(input.initializationDiagnostics ?? {}),
        personalOffsetKcalPerDay: input.appliedPersonalOffsetKcalPerDay ?? 0,
        activityCalibration: 1,
        calibrationStatus: input.appliedPersonalOffsetKcalPerDay
          ? "offset-only" : "insufficient-history",
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
    preserveBeforeDate?: string,
  ): Promise<void> {
    const dates = calculation.dailyStates.map(({ date }) => date);
    await this.client.dailyModelState.deleteMany({
      where: {
        episodeId,
        ...(preserveBeforeDate !== undefined || dates.length > 0 ? {
          date: {
            ...(preserveBeforeDate === undefined ? {} : { gte: preserveBeforeDate }),
            ...(dates.length === 0 ? {} : { notIn: dates }),
          },
        } : {}),
      },
    });
    const persistedIntervals = preserveBeforeDate === undefined
      ? calculation.unknownIntervals
      : calculation.unknownIntervals.filter(({ startDate }) => startDate >= preserveBeforeDate);
    const intervalStarts = persistedIntervals.map(({ startDate }) => startDate);
    await this.client.modelUnknownInterval.deleteMany({
      where: {
        episodeId,
        ...(preserveBeforeDate !== undefined || intervalStarts.length > 0 ? {
          startDate: {
            ...(preserveBeforeDate === undefined ? {} : { gte: preserveBeforeDate }),
            ...(intervalStarts.length === 0 ? {} : { notIn: intervalStarts }),
          },
        } : {}),
      },
    });
    for (const interval of persistedIntervals) {
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
        weightFilterVarianceKg2: state.weightFilterVarianceKg2,
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
          calibrationInputFingerprint: calculation.calibrationInputFingerprint,
        }),
        latestModeledDate: calculation.latestModeledDate,
      },
    });
  }

  async markRecoveryRunsStale(episodeId: number, at = new Date()): Promise<void> {
    await this.client.modelRecoveryRun.updateMany({
      where: { episodeId, staleAt: null },
      data: { staleAt: at },
    });
  }

  async status(id?: number): Promise<ModelStatusDto | null> {
    const episode = id === undefined ? await this.getActive() : await this.getById(id);
    if (!episode) return null;
    const lifecycle = await this.client.physiologyV7Lifecycle.findUnique({
      where: { profileId: episode.profileId },
      select: {
        invalidationGeneration: true,
        productionPublishedGeneration: true,
        productionStaleFromDate: true,
      },
    });
    const productionCurrent = isProductionGenerationCurrentV1(lifecycle);
    const currentPrefixWhere = !productionCurrent
      ? { date: { lt: lifecycle?.productionStaleFromDate ?? episode.startDate } }
      : {};
    const modeledWhere = { episodeId: episode.id, ...currentPrefixWhere };
    const [
      daysModeled,
      incompleteDays,
      observedNutritionDays,
      imputedNutritionDays,
      unbridgeableNutritionDays,
      latest,
      unknownIntervals,
    ] = await Promise.all([
      this.client.dailyModelState.count({ where: { ...modeledWhere, status: "complete" } }),
      this.client.dailyModelState.count({ where: { ...modeledWhere, status: { not: "complete" } } }),
      this.client.dailyModelState.count({
        where: { ...modeledWhere, nutritionSource: "observed" },
      }),
      this.client.dailyModelState.count({
        where: { ...modeledWhere, nutritionSource: { in: ["imputed-local", "imputed-fallback"] } },
      }),
      this.client.dailyModelState.count({
        where: { ...modeledWhere, nutritionSource: "missing" },
      }),
      this.client.dailyModelState.findFirst({
        where: { ...modeledWhere, status: "complete" },
        orderBy: { date: "desc" },
        select: {
          date: true,
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
      timezone: episode.timezone,
      productionCurrent,
      productionDirtyFromDate: lifecycle?.productionStaleFromDate ?? null,
      latestModeledDate: productionCurrent ? episode.latestModeledDate : latest?.date ?? null,
      modelVersion: episode.modelVersion,
      calibrationStatus: episode.calibrationStatus,
      personalOffsetKcalPerDay: episode.personalOffsetKcalPerDay,
      activityCalibration: episode.activityCalibration,
      daysModeled,
      incompleteDays,
      observedNutritionDays,
      imputedNutritionDays,
      unbridgeableNutritionDays,
      currentPredictedWeightKg: productionCurrent ? latest?.endWeightKg ?? null : null,
      currentFilteredWeightKg: productionCurrent ? latest?.filteredWeightKg ?? null : null,
      currentFatMassKg: productionCurrent ? latest?.fatMassKg ?? null : null,
      currentLeanTissueKg: productionCurrent ? latest?.leanTissueKg ?? null : null,
      currentDynamicRmrKcalPerDay: productionCurrent ? latest?.dynamicRmrKcalPerDay ?? null : null,
      currentModeledTdeeKcalPerDay: productionCurrent ? latest?.energyExpenditureKcal ?? null : null,
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
    const lifecycle = await this.client.physiologyV7Lifecycle.findUnique({
      where: { profileId: episode.profileId },
      select: { invalidationGeneration: true, productionPublishedGeneration: true, productionStaleFromDate: true },
    });
    const productionCurrent = isProductionGenerationCurrentV1(lifecycle);
    const dateFilter: { gte?: string; lte?: string; lt?: string } = {
      ...(query.from ? { gte: query.from } : {}),
      ...(query.to ? { lte: query.to } : {}),
    };
    if (!productionCurrent) dateFilter.lt = lifecycle?.productionStaleFromDate ?? episode.startDate;
    const [rows, intervals] = await Promise.all([
      this.client.dailyModelState.findMany({
      where: {
        episodeId: episode.id,
        date: dateFilter,
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
