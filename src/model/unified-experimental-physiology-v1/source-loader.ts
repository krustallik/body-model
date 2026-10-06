import { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { EXPERIMENTAL_CESSATION_DETRAINING_V1_REVISION } from "@/model/physiology-v7/experimental-cessation-detraining-v1";
import { EXPERIMENTAL_FFM_RETENTION_V1_REVISION } from "@/model/physiology-v7/experimental-ffm-retention-v1";
import { EXPERIMENTAL_GLYCOGEN_ASSOCIATED_WATER_V1_REVISION } from "@/model/physiology-v7/experimental-glycogen-associated-water-v1";
import { EXPERIMENTAL_GLYCOGEN_REPLETION_V1_REVISION } from "@/model/physiology-v7/experimental-glycogen-repletion-v1";
import { EXPERIMENTAL_GLYCOGEN_STATE_V1_REVISION } from "@/model/physiology-v7/experimental-glycogen-state-v1";
import { EXPERIMENTAL_SKELETAL_MUSCLE_DELTA_V1_REVISION } from "@/model/physiology-v7/experimental-skeletal-muscle-delta-v1";
import { EXPERIMENTAL_STEPPER_GLYCOGEN_DEMAND_V1_REVISION } from "@/model/physiology-v7/experimental-stepper-glycogen-demand-v1";
import { EXPERIMENTAL_STRENGTH_GLYCOGEN_DEMAND_V1_REVISION } from "@/model/physiology-v7/experimental-strength-glycogen-demand-v1";
import { EXPERIMENTAL_TRANSIENT_EXERCISE_WATER_V2_REVISION } from "@/model/physiology-v7/experimental-transient-exercise-water-v2";
import { addCalendarDays } from "@/modules/model-episodes/model-calendar";
import {
  buildTransientEpisodePartitionsV2,
  indexTransientModelDayBoundariesV2,
  requireTransientModelDayBoundaryV2,
  transientModelDayIdentityV2,
  TRANSIENT_EPISODE_PARTITION_V2_REVISION,
  transientEpisodeTimeForInstantV2,
  transientModelDayBoundariesV2,
} from "@/modules/model-episodes/transient-exercise-water-episode-time-v2";

export type UnifiedDurableWorkoutV1 = {
  id: number;
  date: string;
  type: string;
  startAt: string;
  endAt: string;
  durationMinutes: number | null;
  activeEnergyKcal: number | null;
  manualActiveEnergyKcal?: number | null;
  canonicalEnergyResolution?: {
    eventId: number;
    logicalEventKey: string;
    currentKcal: number | null;
    currentSource: string | null;
    resolutionRevision: number;
    isStale: boolean;
  } | null;
  matchedDiarySession?: {
    status: string;
    experimentalStrengthEnergyShadow: { result: unknown } | null;
  } | null;
  updatedAt: string;
  sourceIdentity: string;
};

export type UnifiedDurableDiarySessionV1 = {
  id: number;
  date: string;
  status: string;
  entryMode: string;
  revision: number;
  webStartedAt: string | null;
  webEndedAt: string | null;
  matchedWorkoutId: number | null;
  updatedAt: string;
};

export type UnifiedDurableDayEvidenceV1 = {
  modelEpisodeId: number;
  date: string;
  boundaryAt: string;
  dailyHealthData: {
    id: number;
    updatedAt: string;
    weightKg: number | null;
    bodyFatPercent: number | null;
    caloriesKcal: number | null;
    proteinG: number | null;
    fatG: number | null;
    carbsG: number | null;
    steps: number | null;
    walkingDistanceKm: number | null;
    workoutFeedObserved: boolean | null;
  } | null;
  workouts: UnifiedDurableWorkoutV1[];
  diarySessions: UnifiedDurableDiarySessionV1[];
  activity: {
    stepIntervals: Array<{ id: number; startAt: string; endAt: string; value: number }>;
    snapshotIds: number[];
  };
  context: { heartRateSampleCount: number; restingHeartRateSampleCount: number; sleepSegmentCount: number };
  productionDailyState: {
    id: number;
    updatedAt: string;
    modelVersion: string;
    energyExpenditureKcal: number | null;
    energyBalanceKcal: number | null;
    dynamicRmrKcalPerDay: number | null;
    tefKcalPerDay: number | null;
    activityKcalPerDay: number | null;
    adaptiveThermogenesisKcalPerDay: number | null;
    sourceQuality: unknown;
  } | null;
  childOutputs: {
    slowTissue: { id: number; updatedAt: string; sourceFingerprint: string; result: unknown } | null;
    glycogen: { id: number; updatedAt: string; sourceFingerprint: string; result: unknown } | null;
    glycogenWater: { id: number; updatedAt: string; sourceFingerprint: string; result: unknown } | null;
    transientWater: Array<{ id: number; sessionId: number; updatedAt: string; sourceFingerprint: string; modelRevision: string; result: unknown }>;
    relativeMuscle: {
      daily: { id: number; updatedAt: string; sourceFingerprint: string; modelRevision: string; result: unknown } | null;
      cumulative: { id: number; updatedAt: string; sourceFingerprint: string; modelRevision: string; result: unknown } | null;
    };
  };
  transientWaterBoundaries: Array<{ episodeId: number; modelDate: string; boundaryInstant: string }>;
  childModelRevisions: Record<string, string>;
};

export type UnifiedDurableRangeEvidenceV1 = {
  profileId: number;
  fromInstant: string;
  throughInstant: string;
  days: UnifiedDurableDayEvidenceV1[];
};

const CHILD_MODEL_REVISIONS: Record<string, string> = {
  episodePartition: TRANSIENT_EPISODE_PARTITION_V2_REVISION,
  glycogenState: EXPERIMENTAL_GLYCOGEN_STATE_V1_REVISION,
  strengthGlycogenDemand: EXPERIMENTAL_STRENGTH_GLYCOGEN_DEMAND_V1_REVISION,
  stepperGlycogenDemand: EXPERIMENTAL_STEPPER_GLYCOGEN_DEMAND_V1_REVISION,
  glycogenRepletion: EXPERIMENTAL_GLYCOGEN_REPLETION_V1_REVISION,
  glycogenWater: EXPERIMENTAL_GLYCOGEN_ASSOCIATED_WATER_V1_REVISION,
  transientWater: EXPERIMENTAL_TRANSIENT_EXERCISE_WATER_V2_REVISION,
  skeletalMuscleDelta: EXPERIMENTAL_SKELETAL_MUSCLE_DELTA_V1_REVISION,
  cessationDetraining: EXPERIMENTAL_CESSATION_DETRAINING_V1_REVISION,
  ffmRetention: EXPERIMENTAL_FFM_RETENTION_V1_REVISION,
};

function decimal(value: { toNumber(): number } | null | undefined): number | null {
  return value?.toNumber() ?? null;
}

export class UnifiedExperimentalPhysiologySourceLoaderV1 {
  constructor(private readonly client: PrismaClient | Prisma.TransactionClient = prisma) {}

  async loadRange(input: {
    profileId?: number;
    fromInstant: Date;
    throughInstant: Date;
  }): Promise<UnifiedDurableRangeEvidenceV1> {
    if (!Number.isFinite(input.fromInstant.getTime())
        || !Number.isFinite(input.throughInstant.getTime())
        || input.throughInstant.getTime() <= input.fromInstant.getTime()) {
      throw new RangeError("Unified absolute replay interval is invalid");
    }
    const profileId = input.profileId ?? 1;
    const episodeRows = await this.client.modelEpisode.findMany({
      where: { profileId },
      orderBy: [{ startDate: "asc" }, { id: "asc" }],
      select: { id: true, startDate: true, timezone: true, active: true, deactivatedAt: true },
    });
    const episodePartitions = buildTransientEpisodePartitionsV2(episodeRows);
    const modelDayBoundaries = transientModelDayBoundariesV2({
      partitions: episodePartitions,
      fromInstant: input.fromInstant,
      throughInstant: input.throughInstant,
    }).map((boundary) => ({
      episodeId: boundary.episodeId,
      modelDate: boundary.modelDate,
      boundaryInstant: boundary.boundaryInstant.toISOString(),
    }));
    if (modelDayBoundaries.length === 0) {
      throw new Error("Unified absolute replay interval contains no episode model-day boundary");
    }
    const boundaryByIdentity = indexTransientModelDayBoundariesV2(modelDayBoundaries);
    const dateLabels = modelDayBoundaries.map(({ modelDate }) => modelDate);
    const fromDate = dateLabels.reduce((minimum, date) => date < minimum ? date : minimum);
    const toDate = dateLabels.reduce((maximum, date) => date > maximum ? date : maximum);
    const optional = <T>(modelName: string, query: () => Promise<T[]>): Promise<T[]> => {
      const model = (this.client as unknown as Record<string, unknown>)[modelName];
      return model === undefined ? Promise.resolve([]) : query();
    };
    const dailyRows = await this.client.dailyHealthData.findMany({
      where: { date: { gte: fromDate, lte: toDate } },
      orderBy: { date: "asc" },
      select: {
        id: true, date: true, updatedAt: true, weightKg: true, bodyFatPercent: true,
        caloriesKcal: true, proteinG: true, fatG: true, carbsG: true, steps: true,
        walkingDistanceKm: true, workoutFeedObserved: true,
      },
    });
    const [workoutRows, diaryRows, activityRows, snapshots, hr, restingHr, sleep, production, slowTissueRows, glycogenRows, glycogenWaterRows, transientWaterRows, relativeMuscleDeltaRows, relativeMuscleCessationRows, completedStrengthIds] = await Promise.all([
      this.client.workout.findMany({
        where: { hiddenFromHistory: false, dailyHealthData: { date: { gte: addCalendarDays(fromDate, -2), lte: addCalendarDays(toDate, 2) } } },
        orderBy: [{ dailyHealthData: { date: "asc" } }, { startAt: "asc" }, { id: "asc" }],
        select: {
          id: true, type: true, startAt: true, endAt: true, durationMinutes: true,
          activeEnergyKcal: true, manualActiveEnergyKcal: true, updatedAt: true, sourceIdentity: true,
          activeEnergyAliases: {
            where: { profileId, sourceType: "workout" },
            select: {
              event: { select: { id: true, logicalEventKey: true, currentKcal: true, currentSource: true, resolutionRevision: true, isStale: true } },
            },
          },
          dailyHealthData: { select: { date: true } },
          matchedDiarySession: {
            select: { status: true, experimentalStrengthEnergyShadow: { select: { result: true } } },
          },
        },
      }),
      this.client.strengthDiarySession.findMany({
        where: { profileId, status: { not: "CANCELLED" }, OR: [
          { matchedWorkout: { dailyHealthData: { date: { gte: addCalendarDays(fromDate, -2), lte: addCalendarDays(toDate, 2) } } } },
          { webStartedAt: { gte: new Date(`${addCalendarDays(fromDate, -2)}T00:00:00.000Z`), lt: new Date(`${addCalendarDays(toDate, 3)}T00:00:00.000Z`) } },
        ] },
        orderBy: [{ id: "asc" }],
        select: { id: true, status: true, entryMode: true, revision: true, webStartedAt: true, webEndedAt: true, matchedWorkoutId: true, updatedAt: true, matchedWorkout: { select: { startAt: true, dailyHealthData: { select: { date: true } } } } },
      }),
      this.client.healthActivityInterval.findMany({ where: { metric: "steps", date: { gte: fromDate, lte: toDate } }, orderBy: [{ startAt: "asc" }, { id: "asc" }], select: { id: true, date: true, startAt: true, endAt: true, value: true } }),
      this.client.healthSyncSnapshot.findMany({ where: { date: { gte: fromDate, lte: toDate } }, orderBy: [{ date: "asc" }, { id: "asc" }], select: { id: true, date: true } }),
      this.client.heartRateSample.findMany({ where: { profileId, date: { gte: fromDate, lte: toDate } }, select: { date: true } }),
      this.client.restingHeartRateSample.findMany({ where: { profileId, date: { gte: fromDate, lte: toDate } }, select: { date: true } }),
      this.client.sleepSegment.findMany({ where: { profileId }, select: { endAt: true } }),
      this.client.dailyModelState.findMany({ where: { date: { gte: fromDate, lte: toDate }, episode: { profileId } }, orderBy: [{ date: "asc" }, { id: "asc" }], select: { id: true, episodeId: true, date: true, updatedAt: true, modelVersion: true, energyExpenditureKcal: true, energyBalanceKcal: true, dynamicRmrKcalPerDay: true, tefKcalPerDay: true, activityKcalPerDay: true, adaptiveThermogenesisKcalPerDay: true, sourceQuality: true } }),
      optional("fatWeightShadowV1Result", () => this.client.fatWeightShadowV1Result.findMany({ where: { profileId, date: { gte: fromDate, lte: toDate } }, orderBy: [{ date: "asc" }, { id: "asc" }], select: { id: true, date: true, updatedAt: true, sourceFingerprint: true, result: true } })),
      optional("experimentalGlycogenStateShadow", () => this.client.experimentalGlycogenStateShadow.findMany({ where: { profileId, date: { gte: fromDate, lte: toDate } }, orderBy: [{ date: "asc" }, { id: "asc" }], select: { id: true, date: true, updatedAt: true, sourceFingerprint: true, result: true } })),
      optional("experimentalGlycogenAssociatedWaterShadow", () => this.client.experimentalGlycogenAssociatedWaterShadow.findMany({ where: { profileId, date: { gte: fromDate, lte: toDate } }, orderBy: [{ date: "asc" }, { id: "asc" }], select: { id: true, date: true, updatedAt: true, sourceFingerprint: true, result: true } })),
      optional("experimentalTransientExerciseWaterShadow", () => this.client.experimentalTransientExerciseWaterShadow.findMany({ where: { profileId }, orderBy: [{ id: "asc" }], select: { id: true, sessionId: true, updatedAt: true, sourceFingerprint: true, modelRevision: true, result: true } })),
      optional("experimentalSkeletalMuscleDeltaShadow", () => this.client.experimentalSkeletalMuscleDeltaShadow.findMany({ where: { profileId, modelEpisodeId: { not: null }, isStale: false, date: { gte: fromDate, lte: toDate } }, orderBy: [{ modelEpisodeId: "asc" }, { date: "asc" }, { id: "asc" }], select: { id: true, modelEpisodeId: true, date: true, isStale: true, updatedAt: true, sourceFingerprint: true, modelRevision: true, result: true } })),
      optional("experimentalCessationDetrainingShadow", () => this.client.experimentalCessationDetrainingShadow.findMany({ where: { profileId, modelEpisodeId: { not: null }, isStale: false, date: { gte: fromDate, lte: toDate } }, orderBy: [{ modelEpisodeId: "asc" }, { date: "asc" }, { id: "asc" }], select: { id: true, modelEpisodeId: true, date: true, isStale: true, updatedAt: true, sourceFingerprint: true, modelRevision: true, result: true } })),
      this.client.strengthDiarySession.findMany({ where: { profileId, status: "COMPLETED" }, orderBy: [{ id: "asc" }], select: { id: true } }),
    ]);
    const dailyByDate = new Map(dailyRows.map((row) => [row.date, row] as const));
    const productionByEpisodeDate = new Map<string, typeof production[number]>();
    for (const row of production) productionByEpisodeDate.set(`${row.episodeId}|${row.date}`, row);
    const oneByDate = <T extends { date: string }>(rows: T[]) => {
      const map = new Map<string, T>();
      for (const row of rows) if (!map.has(row.date)) map.set(row.date, row);
      return map;
    };
    const slowTissueByDate = oneByDate(slowTissueRows);
    const glycogenByDate = oneByDate(glycogenRows);
    const glycogenWaterByDate = oneByDate(glycogenWaterRows);
    const relativeMuscleDailyByEpisodeDate = new Map<string, typeof relativeMuscleDeltaRows[number]>();
    for (const row of relativeMuscleDeltaRows) {
      if (row.modelEpisodeId === null || row.isStale || row.modelRevision !== EXPERIMENTAL_SKELETAL_MUSCLE_DELTA_V1_REVISION) continue;
      const result = row.result && typeof row.result === "object" ? row.result as { contractVersion?: unknown } : null;
      if (result?.contractVersion !== EXPERIMENTAL_SKELETAL_MUSCLE_DELTA_V1_REVISION) {
        throw new Error(`Relative Muscle daily result revision mismatch on row ${row.id}`);
      }
      const key = `${row.modelEpisodeId}|${row.date}`;
      if (relativeMuscleDailyByEpisodeDate.has(key)) throw new Error(`duplicate current Relative Muscle daily row for ${key}`);
      relativeMuscleDailyByEpisodeDate.set(key, row);
    }
    const relativeMuscleCumulativeByEpisodeDate = new Map<string, typeof relativeMuscleCessationRows[number]>();
    for (const row of relativeMuscleCessationRows) {
      if (row.modelEpisodeId === null || row.isStale || row.modelRevision !== EXPERIMENTAL_CESSATION_DETRAINING_V1_REVISION) continue;
      const result = row.result && typeof row.result === "object" ? row.result as { contractVersion?: unknown } : null;
      if (result?.contractVersion !== EXPERIMENTAL_CESSATION_DETRAINING_V1_REVISION) {
        throw new Error(`Relative Muscle cumulative result revision mismatch on row ${row.id}`);
      }
      const key = `${row.modelEpisodeId}|${row.date}`;
      if (relativeMuscleCumulativeByEpisodeDate.has(key)) throw new Error(`duplicate current Relative Muscle cumulative row for ${key}`);
      relativeMuscleCumulativeByEpisodeDate.set(key, row);
    }
    const transientByEpisodeDate = new Map<string, typeof transientWaterRows>();
    const v2SessionIds = new Set<number>();
    for (const row of transientWaterRows) {
      if (row.modelRevision !== EXPERIMENTAL_TRANSIENT_EXERCISE_WATER_V2_REVISION) continue;
      const result = row.result && typeof row.result === "object" ? row.result as { impulse?: unknown } : null;
      const impulse = result?.impulse && typeof result.impulse === "object"
        ? result.impulse as {
            modelDate?: unknown;
            modelEpisodeId?: unknown;
            strengthDiarySessionId?: unknown;
            canonicalEventInstant?: unknown;
            sourceFingerprint?: unknown;
            contractVersion?: unknown;
          }
        : null;
      if (impulse?.contractVersion !== EXPERIMENTAL_TRANSIENT_EXERCISE_WATER_V2_REVISION
          || typeof impulse.modelDate !== "string" || typeof impulse.modelEpisodeId !== "number"
          || !Number.isInteger(impulse.modelEpisodeId)
          || impulse.strengthDiarySessionId !== row.sessionId
          || typeof impulse.canonicalEventInstant !== "string"
          || typeof impulse.sourceFingerprint !== "string") {
        throw new Error(`invalid V2 transient-water row ${row.id}`);
      }
      if (v2SessionIds.has(row.sessionId)) throw new Error(`duplicate V2 transient impulse for Strength session ${row.sessionId}`);
      v2SessionIds.add(row.sessionId);
      if (row.sourceFingerprint !== impulse.sourceFingerprint) {
        throw new Error(`V2 transient source fingerprint mismatch on row ${row.id}`);
      }
      const eventInstantMs = Date.parse(impulse.canonicalEventInstant);
      if (!Number.isFinite(eventInstantMs)) throw new Error(`invalid canonical event instant on V2 transient row ${row.id}`);
      const resolvedEvent = transientEpisodeTimeForInstantV2(episodePartitions, new Date(eventInstantMs));
      if (!resolvedEvent
          || resolvedEvent.episode.id !== impulse.modelEpisodeId
          || resolvedEvent.modelDate !== impulse.modelDate) {
        throw new Error(`V2 transient impulse episode/date provenance mismatch on row ${row.id}`);
      }
      const eligible = eventInstantMs >= input.fromInstant.getTime()
        && eventInstantMs < input.throughInstant.getTime();
      if (eligible) {
        const boundary = requireTransientModelDayBoundaryV2(
          boundaryByIdentity,
          impulse.modelEpisodeId,
          impulse.modelDate,
        );
        const key = transientModelDayIdentityV2(boundary.episodeId, boundary.modelDate);
        transientByEpisodeDate.set(key, [...(transientByEpisodeDate.get(key) ?? []), row]);
      }
    }
    const missingTransientSession = completedStrengthIds.find((session) => !v2SessionIds.has(session.id));
    if (missingTransientSession) {
      throw new Error(`incomplete V2 transient-water coverage for completed Strength session ${missingTransientSession.id}`);
    }
    const boundaryKeys = new Set(boundaryByIdentity.keys());
    const workoutsByEpisodeDate = new Map<string, typeof workoutRows>();
    for (const row of workoutRows) {
      const eventTime = transientEpisodeTimeForInstantV2(episodePartitions, row.startAt);
      if (!eventTime) continue;
      const key = `${eventTime.episode.id}|${eventTime.modelDate}`;
      if (boundaryKeys.has(key)) workoutsByEpisodeDate.set(key, [...(workoutsByEpisodeDate.get(key) ?? []), row]);
    }
    const diaryByEpisodeDate = new Map<string, typeof diaryRows>();
    for (const row of diaryRows) {
      const instant = row.matchedWorkout?.startAt ?? row.webStartedAt;
      if (!instant) continue;
      const eventTime = transientEpisodeTimeForInstantV2(episodePartitions, instant);
      if (!eventTime) continue;
      const key = `${eventTime.episode.id}|${eventTime.modelDate}`;
      if (boundaryKeys.has(key)) diaryByEpisodeDate.set(key, [...(diaryByEpisodeDate.get(key) ?? []), row]);
    }
    return {
      profileId,
      fromInstant: input.fromInstant.toISOString(),
      throughInstant: input.throughInstant.toISOString(),
      days: modelDayBoundaries.map((boundary) => {
        const date = boundary.modelDate;
          const identity = transientModelDayIdentityV2(boundary.episodeId, date);
        const daily = dailyByDate.get(date);
        const productionRow = productionByEpisodeDate.get(identity);
        const dayWorkouts = workoutsByEpisodeDate.get(identity) ?? [];
        return {
          modelEpisodeId: boundary.episodeId,
          date,
          boundaryAt: boundary.boundaryInstant,
          dailyHealthData: daily ? {
            id: daily.id, updatedAt: daily.updatedAt.toISOString(), weightKg: daily.weightKg,
            bodyFatPercent: decimal(daily.bodyFatPercent), caloriesKcal: daily.caloriesKcal,
            proteinG: daily.proteinG, fatG: daily.fatG, carbsG: daily.carbsG, steps: daily.steps,
            walkingDistanceKm: decimal(daily.walkingDistanceKm), workoutFeedObserved: daily.workoutFeedObserved,
          } : null,
          workouts: dayWorkouts.map((row) => ({
            id: row.id, date, type: row.type, startAt: row.startAt.toISOString(), endAt: row.endAt.toISOString(),
            durationMinutes: row.durationMinutes, activeEnergyKcal: row.activeEnergyKcal,
            manualActiveEnergyKcal: row.manualActiveEnergyKcal,
            canonicalEnergyResolution: row.activeEnergyAliases[0]?.event
              ? {
                  eventId: row.activeEnergyAliases[0].event.id,
                  logicalEventKey: row.activeEnergyAliases[0].event.logicalEventKey,
                  currentKcal: row.activeEnergyAliases[0].event.currentKcal,
                  currentSource: row.activeEnergyAliases[0].event.currentSource,
                  resolutionRevision: row.activeEnergyAliases[0].event.resolutionRevision,
                  isStale: row.activeEnergyAliases[0].event.isStale,
                }
              : null,
            matchedDiarySession: row.matchedDiarySession,
            updatedAt: row.updatedAt.toISOString(), sourceIdentity: row.sourceIdentity,
          })),
          diarySessions: (diaryByEpisodeDate.get(identity) ?? []).map((row) => ({ id: row.id, date, status: row.status, entryMode: row.entryMode, revision: row.revision, webStartedAt: row.webStartedAt?.toISOString() ?? null, webEndedAt: row.webEndedAt?.toISOString() ?? null, matchedWorkoutId: row.matchedWorkoutId, updatedAt: row.updatedAt.toISOString() })),
          activity: { stepIntervals: activityRows.filter((row) => row.date === date).map((row) => ({ id: row.id, startAt: row.startAt.toISOString(), endAt: row.endAt.toISOString(), value: row.value.toNumber() })), snapshotIds: snapshots.filter((row) => row.date === date).map((row) => row.id) },
          context: { heartRateSampleCount: hr.filter((row) => row.date === date).length, restingHeartRateSampleCount: restingHr.filter((row) => row.date === date).length, sleepSegmentCount: sleep.filter((row) => row.endAt.toISOString().slice(0, 10) === date).length },
          productionDailyState: productionRow ? { id: productionRow.id, updatedAt: productionRow.updatedAt.toISOString(), modelVersion: productionRow.modelVersion, energyExpenditureKcal: productionRow.energyExpenditureKcal, energyBalanceKcal: productionRow.energyBalanceKcal, dynamicRmrKcalPerDay: productionRow.dynamicRmrKcalPerDay, tefKcalPerDay: productionRow.tefKcalPerDay, activityKcalPerDay: productionRow.activityKcalPerDay, adaptiveThermogenesisKcalPerDay: productionRow.adaptiveThermogenesisKcalPerDay, sourceQuality: productionRow.sourceQuality } : null,
          childOutputs: {
            slowTissue: (() => { const row = slowTissueByDate.get(date); return row ? { id: row.id, updatedAt: row.updatedAt.toISOString(), sourceFingerprint: row.sourceFingerprint, result: row.result } : null; })(),
            glycogen: (() => { const row = glycogenByDate.get(date); return row ? { id: row.id, updatedAt: row.updatedAt.toISOString(), sourceFingerprint: row.sourceFingerprint, result: row.result } : null; })(),
            glycogenWater: (() => { const row = glycogenWaterByDate.get(date); return row ? { id: row.id, updatedAt: row.updatedAt.toISOString(), sourceFingerprint: row.sourceFingerprint, result: row.result } : null; })(),
            transientWater: (transientByEpisodeDate.get(identity) ?? []).map((row) => ({ id: row.id, sessionId: row.sessionId, updatedAt: row.updatedAt.toISOString(), sourceFingerprint: row.sourceFingerprint, modelRevision: row.modelRevision, result: row.result })),
            relativeMuscle: {
              daily: (() => { const row = relativeMuscleDailyByEpisodeDate.get(identity); return row ? { id: row.id, updatedAt: row.updatedAt.toISOString(), sourceFingerprint: row.sourceFingerprint, modelRevision: row.modelRevision, result: row.result } : null; })(),
              cumulative: (() => { const row = relativeMuscleCumulativeByEpisodeDate.get(identity); return row ? { id: row.id, updatedAt: row.updatedAt.toISOString(), sourceFingerprint: row.sourceFingerprint, modelRevision: row.modelRevision, result: row.result } : null; })(),
            },
          },
          transientWaterBoundaries: [boundary],
          childModelRevisions: { ...CHILD_MODEL_REVISIONS },
        };
      }),
    };
  }
}

export const unifiedExperimentalPhysiologySourceLoaderV1 = new UnifiedExperimentalPhysiologySourceLoaderV1();
