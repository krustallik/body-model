import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { localCalendarRangeInstants } from "./calendar-range";
import {
  emptyTrainingDayFact,
  resolveTrainingDayFacts,
  type DiaryFactSource,
  type TrainingDayFact,
  type WorkoutFactSource,
} from "./training-day-fact";

export type TrainingDayFactRange = { from?: string; to?: string };

function workoutSource(row: {
  id: number;
  sourceIdentity: string;
  type: string;
  startAt: Date;
  endAt: Date;
  durationMinutes: number | null;
  activeEnergyKcal: number | null;
  hiddenFromHistory: boolean;
  matchedDiarySession: null | {
    id: number;
    status: string;
    program: { name: string } | null;
    exercises: Array<{ _count: { sets: number } }>;
    experimentalStrengthEnergyShadow: { result: Prisma.JsonValue } | null;
  };
}): WorkoutFactSource {
  return {
    ...row,
    matchedDiarySession: row.matchedDiarySession === null ? null : {
      id: row.matchedDiarySession.id,
      status: row.matchedDiarySession.status,
      programName: row.matchedDiarySession.program?.name ?? null,
      loggedSetCount: row.matchedDiarySession.exercises.reduce((sum, exercise) => sum + exercise._count.sets, 0),
      energyShadow: row.matchedDiarySession.experimentalStrengthEnergyShadow?.result ?? null,
    },
  };
}

function diarySource(row: {
  id: number;
  status: string;
  entryMode: string;
  webStartedAt: Date | null;
  webEndedAt: Date | null;
  program: { name: string } | null;
  exercises: Array<{ _count: { sets: number } }>;
  experimentalStrengthEnergyShadow: { result: Prisma.JsonValue } | null;
}): DiaryFactSource {
  return {
    id: row.id,
    status: row.status,
    entryMode: row.entryMode,
    webStartedAt: row.webStartedAt,
    webEndedAt: row.webEndedAt,
    programName: row.program?.name ?? null,
    loggedSetCount: row.exercises.reduce((sum, exercise) => sum + exercise._count.sets, 0),
    energyShadow: row.experimentalStrengthEnergyShadow?.result ?? null,
  };
}

export class TrainingDayFactRepository {
  constructor(private readonly client: PrismaClient = prisma) {}

  async list(range: TrainingDayFactRange = {}): Promise<TrainingDayFact[]> {
    const instantRange = localCalendarRangeInstants(range);
    const timeFilter = Object.keys(instantRange).length > 0 ? { startAt: instantRange } : {};
    const diaryTimeFilter = {
      not: null,
      ...instantRange,
    };
    const readClient = this.client as unknown as {
      workout?: { findMany?: unknown };
      strengthDiarySession?: { findMany?: unknown };
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
          matchedDiarySession: {
            select: {
              id: true,
              status: true,
              program: { select: { name: true } },
              exercises: { select: { _count: { select: { sets: true } } } },
              experimentalStrengthEnergyShadow: { select: { result: true } },
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
          webStartedAt: true,
          webEndedAt: true,
          program: { select: { name: true } },
          exercises: { select: { _count: { select: { sets: true } } } },
          experimentalStrengthEnergyShadow: { select: { result: true } },
        },
        orderBy: { webStartedAt: "asc" },
      }) : Promise.resolve([]),
    ]);

    return resolveTrainingDayFacts({
      workouts: workouts.map((row) => workoutSource(row as Parameters<typeof workoutSource>[0])),
      diarySessions: diarySessions.map((row) => diarySource(row as Parameters<typeof diarySource>[0])),
    });
  }

  async forDate(date: string): Promise<TrainingDayFact> {
    return (await this.list({ from: date, to: date }))[0] ?? emptyTrainingDayFact(date);
  }
}

export const trainingDayFactRepository = new TrainingDayFactRepository();
