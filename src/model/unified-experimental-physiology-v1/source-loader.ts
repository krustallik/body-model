import { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { EXPERIMENTAL_CESSATION_DETRAINING_V1_REVISION } from "@/model/physiology-v7/experimental-cessation-detraining-v1";
import { EXPERIMENTAL_FFM_RETENTION_V1_REVISION } from "@/model/physiology-v7/experimental-ffm-retention-v1";
import { EXPERIMENTAL_GLYCOGEN_ASSOCIATED_WATER_V1_REVISION } from "@/model/physiology-v7/experimental-glycogen-associated-water-v1";
import { EXPERIMENTAL_GLYCOGEN_REPLETION_V1_REVISION } from "@/model/physiology-v7/experimental-glycogen-repletion-v1";
import { EXPERIMENTAL_GLYCOGEN_STATE_V1_REVISION } from "@/model/physiology-v7/experimental-glycogen-state-v1";
import { EXPERIMENTAL_SKELETAL_MUSCLE_DELTA_V1_REVISION } from "@/model/physiology-v7/experimental-skeletal-muscle-delta-v1";
import { EXPERIMENTAL_STEPPER_GLYCOGEN_DEMAND_V1_REVISION } from "@/model/physiology-v7/experimental-stepper-glycogen-demand-v1";
import { EXPERIMENTAL_STRENGTH_GLYCOGEN_DEMAND_V1_REVISION } from "@/model/physiology-v7/experimental-strength-glycogen-demand-v1";
import { EXPERIMENTAL_TRANSIENT_EXERCISE_WATER_V1_REVISION } from "@/model/physiology-v7/experimental-transient-exercise-water-v1";
import { addCalendarDays, enumerateCalendarDates } from "@/modules/model-episodes/model-calendar";

export type UnifiedDurableWorkoutV1 = {
  id: number;
  date: string;
  type: string;
  startAt: string;
  endAt: string;
  durationMinutes: number | null;
  activeEnergyKcal: number | null;
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
  date: string;
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
  } | null;
  childOutputs: {
    slowTissue: { id: number; updatedAt: string; sourceFingerprint: string; result: unknown } | null;
    glycogen: { id: number; updatedAt: string; sourceFingerprint: string; result: unknown } | null;
    glycogenWater: { id: number; updatedAt: string; sourceFingerprint: string; result: unknown } | null;
    transientWater: Array<{ id: number; updatedAt: string; sourceFingerprint: string; result: unknown }>;
    relativeMuscle: { id: number; updatedAt: string; sourceFingerprint: string; result: unknown } | null;
  };
  childModelRevisions: Record<string, string>;
};

export type UnifiedDurableRangeEvidenceV1 = {
  profileId: number;
  fromDate: string;
  toDate: string;
  days: UnifiedDurableDayEvidenceV1[];
};

const CHILD_MODEL_REVISIONS: Record<string, string> = {
  glycogenState: EXPERIMENTAL_GLYCOGEN_STATE_V1_REVISION,
  strengthGlycogenDemand: EXPERIMENTAL_STRENGTH_GLYCOGEN_DEMAND_V1_REVISION,
  stepperGlycogenDemand: EXPERIMENTAL_STEPPER_GLYCOGEN_DEMAND_V1_REVISION,
  glycogenRepletion: EXPERIMENTAL_GLYCOGEN_REPLETION_V1_REVISION,
  glycogenWater: EXPERIMENTAL_GLYCOGEN_ASSOCIATED_WATER_V1_REVISION,
  transientWater: EXPERIMENTAL_TRANSIENT_EXERCISE_WATER_V1_REVISION,
  skeletalMuscleDelta: EXPERIMENTAL_SKELETAL_MUSCLE_DELTA_V1_REVISION,
  cessationDetraining: EXPERIMENTAL_CESSATION_DETRAINING_V1_REVISION,
  ffmRetention: EXPERIMENTAL_FFM_RETENTION_V1_REVISION,
};

function decimal(value: { toNumber(): number } | null | undefined): number | null {
  return value?.toNumber() ?? null;
}

export class UnifiedExperimentalPhysiologySourceLoaderV1 {
  constructor(private readonly client: PrismaClient = prisma) {}

  async loadRange(input: {
    profileId?: number;
    fromDate: string;
    toDate: string;
  }): Promise<UnifiedDurableRangeEvidenceV1> {
    if (input.toDate < input.fromDate) throw new RangeError("toDate must not precede fromDate");
    const profileId = input.profileId ?? 1;
    const dates = enumerateCalendarDates(input.fromDate, input.toDate);
    const optional = <T>(modelName: string, query: () => Promise<T[]>): Promise<T[]> => {
      const model = (this.client as unknown as Record<string, unknown>)[modelName];
      return model === undefined ? Promise.resolve([]) : query();
    };
    const dailyRows = await this.client.dailyHealthData.findMany({
      where: { date: { gte: input.fromDate, lte: input.toDate } },
      orderBy: { date: "asc" },
      select: {
        id: true, date: true, updatedAt: true, weightKg: true, bodyFatPercent: true,
        caloriesKcal: true, proteinG: true, fatG: true, carbsG: true, steps: true,
        walkingDistanceKm: true, workoutFeedObserved: true,
      },
    });
    const [workoutRows, diaryRows, activityRows, snapshots, hr, restingHr, sleep, production, slowTissueRows, glycogenRows, glycogenWaterRows, transientWaterRows, relativeMuscleRows] = await Promise.all([
      this.client.workout.findMany({
        where: { dailyHealthData: { date: { gte: input.fromDate, lte: input.toDate } } },
        orderBy: [{ dailyHealthData: { date: "asc" } }, { startAt: "asc" }, { id: "asc" }],
        select: { id: true, type: true, startAt: true, endAt: true, durationMinutes: true, activeEnergyKcal: true, updatedAt: true, sourceIdentity: true, dailyHealthData: { select: { date: true } } },
      }),
      this.client.strengthDiarySession.findMany({
        where: { profileId, status: { not: "CANCELLED" }, OR: [
          { matchedWorkout: { dailyHealthData: { date: { gte: input.fromDate, lte: input.toDate } } } },
          { webStartedAt: { gte: new Date(`${input.fromDate}T00:00:00.000Z`), lt: new Date(`${addCalendarDays(input.toDate, 1)}T00:00:00.000Z`) } },
        ] },
        orderBy: [{ id: "asc" }],
        select: { id: true, status: true, entryMode: true, revision: true, webStartedAt: true, webEndedAt: true, matchedWorkoutId: true, updatedAt: true, matchedWorkout: { select: { dailyHealthData: { select: { date: true } } } } },
      }),
      this.client.healthActivityInterval.findMany({ where: { metric: "steps", date: { gte: input.fromDate, lte: input.toDate } }, orderBy: [{ startAt: "asc" }, { id: "asc" }], select: { id: true, date: true, startAt: true, endAt: true, value: true } }),
      this.client.healthSyncSnapshot.findMany({ where: { date: { gte: input.fromDate, lte: input.toDate } }, orderBy: [{ date: "asc" }, { id: "asc" }], select: { id: true, date: true } }),
      this.client.heartRateSample.findMany({ where: { profileId, date: { gte: input.fromDate, lte: input.toDate } }, select: { date: true } }),
      this.client.restingHeartRateSample.findMany({ where: { profileId, date: { gte: input.fromDate, lte: input.toDate } }, select: { date: true } }),
      this.client.sleepSegment.findMany({ where: { profileId }, select: { endAt: true } }),
      this.client.dailyModelState.findMany({ where: { date: { gte: input.fromDate, lte: input.toDate }, episode: { profileId } }, orderBy: [{ date: "asc" }, { id: "asc" }], select: { id: true, date: true, updatedAt: true, modelVersion: true, energyExpenditureKcal: true, energyBalanceKcal: true, dynamicRmrKcalPerDay: true, tefKcalPerDay: true, activityKcalPerDay: true, adaptiveThermogenesisKcalPerDay: true } }),
      optional("fatWeightShadowV1Result", () => this.client.fatWeightShadowV1Result.findMany({ where: { profileId, date: { gte: input.fromDate, lte: input.toDate } }, orderBy: [{ date: "asc" }, { id: "asc" }], select: { id: true, date: true, updatedAt: true, sourceFingerprint: true, result: true } })),
      optional("experimentalGlycogenStateShadow", () => this.client.experimentalGlycogenStateShadow.findMany({ where: { profileId, date: { gte: input.fromDate, lte: input.toDate } }, orderBy: [{ date: "asc" }, { id: "asc" }], select: { id: true, date: true, updatedAt: true, sourceFingerprint: true, result: true } })),
      optional("experimentalGlycogenAssociatedWaterShadow", () => this.client.experimentalGlycogenAssociatedWaterShadow.findMany({ where: { profileId, date: { gte: input.fromDate, lte: input.toDate } }, orderBy: [{ date: "asc" }, { id: "asc" }], select: { id: true, date: true, updatedAt: true, sourceFingerprint: true, result: true } })),
      optional("experimentalTransientExerciseWaterShadow", () => this.client.experimentalTransientExerciseWaterShadow.findMany({ where: { profileId }, orderBy: [{ id: "asc" }], select: { id: true, updatedAt: true, sourceFingerprint: true, result: true, session: { select: { matchedWorkout: { select: { dailyHealthData: { select: { date: true } } } }, webStartedAt: true } } } })),
      optional("experimentalSkeletalMuscleDeltaShadow", () => this.client.experimentalSkeletalMuscleDeltaShadow.findMany({ where: { profileId, date: { gte: input.fromDate, lte: input.toDate } }, orderBy: [{ date: "asc" }, { id: "asc" }], select: { id: true, date: true, updatedAt: true, sourceFingerprint: true, result: true } })),
    ]);
    const dailyByDate = new Map(dailyRows.map((row) => [row.date, row] as const));
    const productionByDate = new Map<string, typeof production[number]>();
    for (const row of production) if (!productionByDate.has(row.date)) productionByDate.set(row.date, row);
    const oneByDate = <T extends { date: string }>(rows: T[]) => {
      const map = new Map<string, T>();
      for (const row of rows) if (!map.has(row.date)) map.set(row.date, row);
      return map;
    };
    const slowTissueByDate = oneByDate(slowTissueRows);
    const glycogenByDate = oneByDate(glycogenRows);
    const glycogenWaterByDate = oneByDate(glycogenWaterRows);
    const relativeMuscleByDate = oneByDate(relativeMuscleRows);
    const transientByDate = new Map<string, typeof transientWaterRows>();
    for (const row of transientWaterRows) {
      const date = row.session.matchedWorkout?.dailyHealthData.date ?? row.session.webStartedAt?.toISOString().slice(0, 10);
      if (date && date >= input.fromDate && date <= input.toDate) transientByDate.set(date, [...(transientByDate.get(date) ?? []), row]);
    }
    const workoutsByDate = new Map<string, typeof workoutRows>();
    for (const row of workoutRows) workoutsByDate.set(row.dailyHealthData.date, [...(workoutsByDate.get(row.dailyHealthData.date) ?? []), row]);
    const diaryByDate = new Map<string, typeof diaryRows>();
    for (const row of diaryRows) {
      const date = row.matchedWorkout?.dailyHealthData.date ?? row.webStartedAt?.toISOString().slice(0, 10);
      if (date && date >= input.fromDate && date <= input.toDate) diaryByDate.set(date, [...(diaryByDate.get(date) ?? []), row]);
    }
    return {
      profileId, fromDate: input.fromDate, toDate: input.toDate,
      days: dates.map((date) => {
        const daily = dailyByDate.get(date);
        const productionRow = productionByDate.get(date);
        const dayWorkouts = workoutsByDate.get(date) ?? [];
        return {
          date,
          dailyHealthData: daily ? {
            id: daily.id, updatedAt: daily.updatedAt.toISOString(), weightKg: daily.weightKg,
            bodyFatPercent: decimal(daily.bodyFatPercent), caloriesKcal: daily.caloriesKcal,
            proteinG: daily.proteinG, fatG: daily.fatG, carbsG: daily.carbsG, steps: daily.steps,
            walkingDistanceKm: decimal(daily.walkingDistanceKm), workoutFeedObserved: daily.workoutFeedObserved,
          } : null,
          workouts: dayWorkouts.map((row) => ({ id: row.id, date, type: row.type, startAt: row.startAt.toISOString(), endAt: row.endAt.toISOString(), durationMinutes: row.durationMinutes, activeEnergyKcal: row.activeEnergyKcal, updatedAt: row.updatedAt.toISOString(), sourceIdentity: row.sourceIdentity })),
          diarySessions: (diaryByDate.get(date) ?? []).map((row) => ({ id: row.id, date, status: row.status, entryMode: row.entryMode, revision: row.revision, webStartedAt: row.webStartedAt?.toISOString() ?? null, webEndedAt: row.webEndedAt?.toISOString() ?? null, matchedWorkoutId: row.matchedWorkoutId, updatedAt: row.updatedAt.toISOString() })),
          activity: { stepIntervals: activityRows.filter((row) => row.date === date).map((row) => ({ id: row.id, startAt: row.startAt.toISOString(), endAt: row.endAt.toISOString(), value: row.value.toNumber() })), snapshotIds: snapshots.filter((row) => row.date === date).map((row) => row.id) },
          context: { heartRateSampleCount: hr.filter((row) => row.date === date).length, restingHeartRateSampleCount: restingHr.filter((row) => row.date === date).length, sleepSegmentCount: sleep.filter((row) => row.endAt.toISOString().slice(0, 10) === date).length },
          productionDailyState: productionRow ? { id: productionRow.id, updatedAt: productionRow.updatedAt.toISOString(), modelVersion: productionRow.modelVersion, energyExpenditureKcal: productionRow.energyExpenditureKcal, energyBalanceKcal: productionRow.energyBalanceKcal, dynamicRmrKcalPerDay: productionRow.dynamicRmrKcalPerDay, tefKcalPerDay: productionRow.tefKcalPerDay, activityKcalPerDay: productionRow.activityKcalPerDay, adaptiveThermogenesisKcalPerDay: productionRow.adaptiveThermogenesisKcalPerDay } : null,
          childOutputs: {
            slowTissue: (() => { const row = slowTissueByDate.get(date); return row ? { id: row.id, updatedAt: row.updatedAt.toISOString(), sourceFingerprint: row.sourceFingerprint, result: row.result } : null; })(),
            glycogen: (() => { const row = glycogenByDate.get(date); return row ? { id: row.id, updatedAt: row.updatedAt.toISOString(), sourceFingerprint: row.sourceFingerprint, result: row.result } : null; })(),
            glycogenWater: (() => { const row = glycogenWaterByDate.get(date); return row ? { id: row.id, updatedAt: row.updatedAt.toISOString(), sourceFingerprint: row.sourceFingerprint, result: row.result } : null; })(),
            transientWater: (transientByDate.get(date) ?? []).map((row) => ({ id: row.id, updatedAt: row.updatedAt.toISOString(), sourceFingerprint: row.sourceFingerprint, result: row.result })),
            relativeMuscle: (() => { const row = relativeMuscleByDate.get(date); return row ? { id: row.id, updatedAt: row.updatedAt.toISOString(), sourceFingerprint: row.sourceFingerprint, result: row.result } : null; })(),
          },
          childModelRevisions: { ...CHILD_MODEL_REVISIONS },
        };
      }),
    };
  }
}

export const unifiedExperimentalPhysiologySourceLoaderV1 = new UnifiedExperimentalPhysiologySourceLoaderV1();
