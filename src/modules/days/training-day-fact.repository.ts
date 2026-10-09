import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { DEFAULT_TIME_ZONE, instantToLocalDateTime } from "@/model/time-zone";
import { addCalendarDays } from "@/modules/model-episodes/model-calendar";
import { episodeTimeContextForInstantV1 } from "@/modules/model-episodes/episode-time-context-v1";
import { readActiveEnergyMassReferencesV1 } from "@/modules/training/training.repository";
import {
  resolveTrainingDayFacts,
  type DiaryFactSource,
  type StrengthSetFactRow,
  type TrainingDayFact,
  type WorkoutFactSource,
} from "./training-day-fact";
import type { StrengthSessionDto } from "@/modules/training/training.types";
import { emptyTrainingDayFact } from "./training-day-fact-empty";

export type TrainingDayFactRange = { from?: string; to?: string };

type SetRow = {
  id: number;
  sessionExerciseId: number;
  completedAt: Date | null;
  reps: number;
  weightKg: Prisma.Decimal | number | null;
  bandNominalResistanceKg: Prisma.Decimal | number | null;
  rir: number | null;
};

function toSetRows(sets: readonly SetRow[], resistanceType?: string | null): StrengthSetFactRow[] {
  return sets.map((set) => ({
    id: set.id,
    sessionExerciseId: set.sessionExerciseId,
    completedAt: set.completedAt?.toISOString() ?? null,
    reps: set.reps,
    weightKg: typeof set.weightKg === "number"
      ? set.weightKg
      : set.weightKg === null
        ? null
        : set.weightKg.toNumber(),
    bandNominalResistanceKg: typeof set.bandNominalResistanceKg === "number"
      ? set.bandNominalResistanceKg
      : set.bandNominalResistanceKg === null
        ? null
        : set.bandNominalResistanceKg.toNumber(),
    rir: set.rir,
    resistanceType: resistanceType ?? null,
  }));
}

function startOfDayMassFor(
  date: string,
  weightsByDate: ReadonlyMap<string, number | null>,
  sortedWeightDates: readonly string[],
): number | null {
  for (let index = sortedWeightDates.length - 1; index >= 0; index -= 1) {
    const candidate = sortedWeightDates[index]!;
    if (candidate >= date) continue;
    const mass = weightsByDate.get(candidate);
    if (mass != null && Number.isFinite(mass) && mass > 0) return mass;
  }
  return null;
}

function workoutSource(
  row: {
    id: number;
    sourceIdentity: string;
    type: string;
    startAt: Date;
    endAt: Date;
    modelDate?: string;
    durationMinutes: number | null;
    activeEnergyKcal: number | null;
    hiddenFromHistory: boolean;
    canonicalEnergyResolution?: { kcal: number | null; source: string; revision: number } | null;
    dailyHealthData?: { date: string; weightKg: number | null } | null;
    matchedDiarySession: null | {
      id: number;
      status: string;
      revision: number;
      entryMode: string;
      webStartedAt: Date | null;
      webEndedAt: Date | null;
      program: { name: string } | null;
      exercises: Array<{ resistanceType: string; sets: SetRow[] }>;
      experimentalStrengthEnergyShadow: { result: Prisma.JsonValue; modelRevision: string } | null;
      activeEnergyMassReference?: StrengthSessionDto["activeEnergyMassReference"];
      canonicalEnergyResolution?: { kcal: number | null; source: string; revision: number } | null;
    };
  },
  weightsByDate: ReadonlyMap<string, number | null>,
  sortedWeightDates: readonly string[],
  timeZone: string,
): WorkoutFactSource {
  const exerciseGroups = row.matchedDiarySession === null
    ? []
    : row.matchedDiarySession.exercises.map((exercise) => ({
      resistanceType: exercise.resistanceType,
      sets: toSetRows(exercise.sets, exercise.resistanceType),
    }));
  const sets = exerciseGroups.flatMap((exercise) => exercise.sets);
  const localDate = row.modelDate ?? row.dailyHealthData?.date
    ?? instantToLocalDateTime(row.startAt, timeZone).date;
  const sameDayMassKg = row.dailyHealthData?.weightKg ?? weightsByDate.get(localDate) ?? null;
  const startOfDayMassKg = startOfDayMassFor(localDate, weightsByDate, sortedWeightDates);
  return {
    id: row.id,
    sourceIdentity: row.sourceIdentity,
    type: row.type,
    startAt: row.startAt,
    endAt: row.endAt,
    modelDate: row.modelDate,
    durationMinutes: row.durationMinutes,
    activeEnergyKcal: row.activeEnergyKcal,
    hiddenFromHistory: row.hiddenFromHistory,
    canonicalEnergyResolution: row.canonicalEnergyResolution ?? null,
    matchedDiarySession: row.matchedDiarySession === null ? null : {
      id: row.matchedDiarySession.id,
      status: row.matchedDiarySession.status,
      revision: row.matchedDiarySession.revision,
      entryMode: row.matchedDiarySession.entryMode,
      webStartedAt: row.matchedDiarySession.webStartedAt?.toISOString() ?? null,
      webEndedAt: row.matchedDiarySession.webEndedAt?.toISOString() ?? null,
      programName: row.matchedDiarySession.program?.name ?? null,
      loggedSetCount: sets.length,
      energyShadow: row.matchedDiarySession.experimentalStrengthEnergyShadow?.result ?? null,
      activeEnergyMassReference: row.matchedDiarySession.activeEnergyMassReference ?? null,
      sets,
      exercises: exerciseGroups,
      sameDayMassKg,
      startOfDayMassKg,
      estimatorVersion: row.matchedDiarySession.experimentalStrengthEnergyShadow?.modelRevision ?? null,
      canonicalEnergyResolution: row.matchedDiarySession.canonicalEnergyResolution ?? null,
    },
  };
}

function diarySource(
  row: {
    id: number;
    status: string;
    entryMode: string;
    revision: number;
    webStartedAt: Date | null;
    webEndedAt: Date | null;
    modelDate?: string | null;
    program: { name: string } | null;
    exercises: Array<{ resistanceType: string; sets: SetRow[] }>;
    experimentalStrengthEnergyShadow: { result: Prisma.JsonValue; modelRevision: string } | null;
    activeEnergyMassReference?: StrengthSessionDto["activeEnergyMassReference"];
    canonicalEnergyResolution?: { kcal: number | null; source: string; revision: number } | null;
  },
  weightsByDate: ReadonlyMap<string, number | null>,
  sortedWeightDates: readonly string[],
  timeZone: string,
): DiaryFactSource {
  const exerciseGroups = row.exercises.map((exercise) => ({
    resistanceType: exercise.resistanceType,
    sets: toSetRows(exercise.sets, exercise.resistanceType),
  }));
  const sets = exerciseGroups.flatMap((exercise) => exercise.sets);
  const localDate = row.modelDate ?? (row.webStartedAt === null
    ? null
    : instantToLocalDateTime(row.webStartedAt, timeZone).date);
  const sameDayMassKg = localDate === null ? null : weightsByDate.get(localDate) ?? null;
  const startOfDayMassKg = localDate === null
    ? null
    : startOfDayMassFor(localDate, weightsByDate, sortedWeightDates);
  return {
    id: row.id,
    status: row.status,
    entryMode: row.entryMode,
    revision: row.revision,
    webStartedAt: row.webStartedAt,
    webEndedAt: row.webEndedAt,
    modelDate: row.modelDate,
    programName: row.program?.name ?? null,
    loggedSetCount: sets.length,
    energyShadow: row.experimentalStrengthEnergyShadow?.result ?? null,
    activeEnergyMassReference: row.activeEnergyMassReference ?? null,
    sets,
    exercises: exerciseGroups,
    sameDayMassKg,
    startOfDayMassKg,
    estimatorVersion: row.experimentalStrengthEnergyShadow?.modelRevision ?? null,
    canonicalEnergyResolution: row.canonicalEnergyResolution ?? null,
  };
}

export class TrainingDayFactRepository {
  constructor(private readonly client: PrismaClient = prisma) {}

  async list(range: TrainingDayFactRange = {}): Promise<TrainingDayFact[]> {
    // Episode timezone can differ from the browser/default timezone. Query a
    // UTC envelope wide enough to include every event whose episode-local
    // date may fall in the requested date-only range, then filter by that
    // authoritative model date after loading the episode map.
    const instantRange = {
      ...(range.from ? { gte: new Date(`${addCalendarDays(range.from, -2)}T00:00:00.000Z`) } : {}),
      ...(range.to ? { lt: new Date(`${addCalendarDays(range.to, 3)}T00:00:00.000Z`) } : {}),
    };
    const timeFilter = Object.keys(instantRange).length > 0 ? { startAt: instantRange } : {};
    const diaryTimeFilter = {
      not: null,
      ...instantRange,
    };
    const readClient = this.client as unknown as {
      workout?: { findMany?: unknown };
      strengthDiarySession?: { findMany?: unknown };
      dailyHealthData?: { findMany?: unknown };
      modelEpisode?: { findMany?: unknown };
    };

    const [workouts, diarySessions] = await Promise.all([
      readClient.workout?.findMany ? this.client.workout.findMany({
        where: timeFilter,
        select: {
          id: true,
          sourceIdentity: true,
          type: true,
          startAt: true,
          endAt: true,
          durationMinutes: true,
          activeEnergyKcal: true,
          hiddenFromHistory: true,
          dailyHealthData: { select: { date: true, weightKg: true } },
          matchedDiarySession: {
            select: {
              id: true,
              status: true,
              revision: true,
              entryMode: true,
              webStartedAt: true,
              webEndedAt: true,
              program: { select: { name: true } },
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
              experimentalStrengthEnergyShadow: { select: { result: true, modelRevision: true } },
            },
          },
        },
        orderBy: { startAt: "asc" },
      }) : Promise.resolve([]),
      readClient.strengthDiarySession?.findMany ? this.client.strengthDiarySession.findMany({
        where: {
          entryMode: "LIVE",
          matchedWorkoutId: null,
          webStartedAt: diaryTimeFilter,
          OR: [
            { status: { in: ["ACTIVE", "COMPLETED"] } },
            { status: "CANCELLED", exercises: { some: { sets: { some: {} } } } },
          ],
        } satisfies Prisma.StrengthDiarySessionWhereInput,
        select: {
          id: true,
          status: true,
          entryMode: true,
          revision: true,
          webStartedAt: true,
          webEndedAt: true,
          program: { select: { name: true } },
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
          experimentalStrengthEnergyShadow: { select: { result: true, modelRevision: true } },
        },
        orderBy: { webStartedAt: "asc" },
      }) : Promise.resolve([]),
    ]);

    const episodes = readClient.modelEpisode?.findMany
      ? await this.client.modelEpisode.findMany({
        where: { profileId: 1 },
        select: { id: true, startDate: true, timezone: true, active: true },
        orderBy: [{ startDate: "asc" }, { id: "asc" }],
      })
      : [];

    const energyAliases = workouts.length + diarySessions.length === 0 ? [] : await this.client.activeEnergyEventAlias.findMany({
      where: {
        profileId: 1,
        OR: [
          ...(workouts.length === 0 ? [] : [{ sourceType: "workout", sourceId: { in: workouts.map((row) => String(row.id)) } }]),
          ...(diarySessions.length === 0 ? [] : [{ sourceType: "strength-session", sourceId: { in: diarySessions.map((row) => String(row.id)) } }]),
        ],
      },
      select: {
        sourceType: true, sourceId: true,
        event: { select: { currentKcal: true, currentSource: true, resolutionRevision: true, isStale: true } },
      },
    });
    const activeEnergyByAlias = new Map(energyAliases.map((row) => [`${row.sourceType}:${row.sourceId}`, {
      kcal: row.event.isStale ? null : row.event.currentKcal,
      source: row.event.isStale ? "unavailable" : row.event.currentSource ?? "unavailable",
      revision: row.event.resolutionRevision,
    }]));

    const workoutModelDates = new Map<number, { date: string; timeZone: string }>();
    const diaryModelDates = new Map<number, { date: string; timeZone: string }>();
    const dates = new Set<string>();
    for (const row of workouts) {
      const context = episodeTimeContextForInstantV1(episodes, row.startAt);
      workoutModelDates.set(row.id, { date: context.date, timeZone: context.timeZone });
      dates.add(context.date);
    }
    for (const row of diarySessions) {
      if (row.webStartedAt === null) continue;
      const context = episodeTimeContextForInstantV1(episodes, row.webStartedAt);
      diaryModelDates.set(row.id, { date: context.date, timeZone: context.timeZone });
      dates.add(context.date);
    }
    const sortedDates = [...dates].sort();
    const earliest = sortedDates[0];
    const weightRows = readClient.dailyHealthData?.findMany && earliest !== undefined
      ? await this.client.dailyHealthData.findMany({
        where: {
          weightKg: { not: null },
          OR: [
            { date: { in: sortedDates } },
            { date: { lt: earliest } },
          ],
        },
        select: { date: true, weightKg: true },
        orderBy: { date: "asc" },
      })
      : [];
    const weightsByDate = new Map<string, number | null>();
    for (const row of weightRows) weightsByDate.set(row.date, row.weightKg);
    // Ensure same-day rows without a prior weight lookup still see their own scale mass.
    for (const row of workouts) {
      if (row.dailyHealthData && !weightsByDate.has(row.dailyHealthData.date)) {
        weightsByDate.set(row.dailyHealthData.date, row.dailyHealthData.weightKg);
      }
    }
    const sortedWeightDates = [...weightsByDate.keys()].sort();

    const allSessionIds = [
      ...diarySessions.map((row) => row.id),
      ...workouts.flatMap((row) => row.matchedDiarySession ? [row.matchedDiarySession.id] : []),
    ];
    const massReferences = await readActiveEnergyMassReferencesV1(this.client, {
      sessionIds: allSessionIds,
      profileId: 1,
    });

    const facts = resolveTrainingDayFacts({
      workouts: workouts.map((row) => workoutSource(
        {
          ...(row as Parameters<typeof workoutSource>[0]),
          modelDate: workoutModelDates.get(row.id)?.date,
          canonicalEnergyResolution: activeEnergyByAlias.get(`workout:${row.id}`) ?? null,
          matchedDiarySession: row.matchedDiarySession === null ? null : {
            ...row.matchedDiarySession,
            activeEnergyMassReference: massReferences.get(row.matchedDiarySession.id) ?? null,
            canonicalEnergyResolution: activeEnergyByAlias.get(`strength-session:${row.matchedDiarySession.id}`) ?? null,
          },
        },
        weightsByDate,
        sortedWeightDates,
        workoutModelDates.get(row.id)?.timeZone ?? DEFAULT_TIME_ZONE,
      )),
      diarySessions: diarySessions.map((row) => diarySource(
        {
          ...(row as Parameters<typeof diarySource>[0]),
          modelDate: diaryModelDates.get(row.id)?.date ?? null,
          activeEnergyMassReference: massReferences.get(row.id) ?? null,
          canonicalEnergyResolution: activeEnergyByAlias.get(`strength-session:${row.id}`) ?? null,
        },
        weightsByDate,
        sortedWeightDates,
        diaryModelDates.get(row.id)?.timeZone ?? DEFAULT_TIME_ZONE,
      )),
    });
    return facts.filter(({ date }) => (!range.from || date >= range.from) && (!range.to || date <= range.to));
  }

  async forDate(date: string): Promise<TrainingDayFact> {
    return (await this.list({ from: date, to: date }))[0] ?? emptyTrainingDayFact(date);
  }
}

export const trainingDayFactRepository = new TrainingDayFactRepository();
