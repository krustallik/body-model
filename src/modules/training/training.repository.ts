import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import {
  DEFAULT_TRAINING_PROFILE_ID,
  MATCH_STATUS,
  SESSION_STATUS,
  TRAINING_LIMITS,
  type MatchMethod,
  type MatchStatus,
  type ResistanceType,
  type SessionStatus,
} from "./training.constants";
import { ordinaryExternalWeightTonnageKg } from "./training.tonnage";
import type {
  ExerciseCatalogDto,
  MatchCandidateDto,
  MatchedWorkoutDto,
  ProgramExerciseDto,
  StrengthSessionDto,
  StrengthSessionExerciseDto,
  StrengthSessionSummaryDto,
  StrengthSetDto,
  TrainingProgramDto,
  TrainingProgramSummaryDto,
} from "./training.types";

const catalogSelect = {
  id: true,
  name: true,
  isActive: true,
  archivedAt: true,
  muscleMapping: true,
} satisfies Prisma.ExerciseCatalogSelect;

const programExerciseSelect = {
  id: true,
  exerciseCatalogId: true,
  sortOrder: true,
  plannedSets: true,
  resistanceType: true,
  exerciseCatalog: { select: { id: true, name: true } },
} satisfies Prisma.ProgramExerciseSelect;

const setSelect = {
  id: true,
  sessionExerciseId: true,
  setNumber: true,
  reps: true,
  weightKg: true,
  bandNominalResistanceKg: true,
  completedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.StrengthSetSelect;

const sessionExerciseSelect = {
  id: true,
  sourceExerciseCatalogId: true,
  snapshotExerciseName: true,
  sortOrder: true,
  plannedSets: true,
  resistanceType: true,
  muscleMappingSnapshot: true,
  sets: { select: setSelect, orderBy: { setNumber: "asc" as const } },
} satisfies Prisma.StrengthSessionExerciseSelect;

const matchedWorkoutSelect = {
  id: true,
  type: true,
  startAt: true,
  endAt: true,
  durationMinutes: true,
  activeEnergyKcal: true,
  externalId: true,
} satisfies Prisma.WorkoutSelect;

const sessionDetailSelect = {
  id: true,
  status: true,
  programId: true,
  programVersionId: true,
  webStartedAt: true,
  webEndedAt: true,
  matchStatus: true,
  matchMethod: true,
  matchedAt: true,
  matchedWorkoutId: true,
  createdAt: true,
  updatedAt: true,
  program: { select: { id: true, name: true } },
  programVersion: { select: { id: true, versionNumber: true } },
  matchedWorkout: { select: matchedWorkoutSelect },
  exercises: { select: sessionExerciseSelect, orderBy: { sortOrder: "asc" as const } },
} satisfies Prisma.StrengthDiarySessionSelect;

type CatalogRecord = Prisma.ExerciseCatalogGetPayload<{ select: typeof catalogSelect }>;
type ProgramExerciseRecord = Prisma.ProgramExerciseGetPayload<{ select: typeof programExerciseSelect }>;
type SetRecord = Prisma.StrengthSetGetPayload<{ select: typeof setSelect }>;
type SessionExerciseRecord = Prisma.StrengthSessionExerciseGetPayload<{ select: typeof sessionExerciseSelect }>;
type MatchedWorkoutRecord = Prisma.WorkoutGetPayload<{ select: typeof matchedWorkoutSelect }>;
type SessionDetailRecord = Prisma.StrengthDiarySessionGetPayload<{ select: typeof sessionDetailSelect }>;

function decimalToNumber(value: Prisma.Decimal | null): number | null {
  return value === null ? null : value.toNumber();
}

function toCatalogDto(record: CatalogRecord): ExerciseCatalogDto {
  return {
    id: record.id,
    name: record.name,
    isActive: record.isActive,
    archivedAt: record.archivedAt?.toISOString() ?? null,
    muscleMapping: record.muscleMapping ?? null,
  };
}

function toProgramExerciseDto(record: ProgramExerciseRecord): ProgramExerciseDto {
  return {
    id: record.id,
    catalogId: record.exerciseCatalogId,
    catalogName: record.exerciseCatalog.name,
    order: record.sortOrder,
    plannedSets: record.plannedSets,
    resistanceType: record.resistanceType as ResistanceType,
  };
}

function toSetDto(record: SetRecord): StrengthSetDto {
  return {
    id: record.id,
    sessionExerciseId: record.sessionExerciseId,
    setNumber: record.setNumber,
    reps: record.reps,
    weightKg: decimalToNumber(record.weightKg),
    bandNominalResistanceKg: decimalToNumber(record.bandNominalResistanceKg),
    completedAt: record.completedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function toSessionExerciseDto(record: SessionExerciseRecord): StrengthSessionExerciseDto {
  return {
    id: record.id,
    sourceExerciseCatalogId: record.sourceExerciseCatalogId,
    snapshotExerciseName: record.snapshotExerciseName,
    order: record.sortOrder,
    plannedSets: record.plannedSets,
    resistanceType: record.resistanceType as ResistanceType,
    muscleMappingSnapshot: record.muscleMappingSnapshot ?? null,
    sets: record.sets.map(toSetDto),
  };
}

function toMatchedWorkoutDto(record: MatchedWorkoutRecord | null): MatchedWorkoutDto | null {
  if (!record) return null;
  return {
    id: record.id,
    type: record.type,
    startAt: record.startAt.toISOString(),
    endAt: record.endAt.toISOString(),
    durationMinutes: record.durationMinutes,
    activeEnergyKcal: record.activeEnergyKcal,
    externalId: record.externalId,
  };
}

export function toSessionDto(record: SessionDetailRecord): StrengthSessionDto {
  const exercises = record.exercises.map(toSessionExerciseDto);
  const tonnageSets = exercises.flatMap((exercise) =>
    exercise.sets.map((set) => ({
      resistanceType: exercise.resistanceType,
      reps: set.reps,
      weightKg: set.weightKg,
    })),
  );

  return {
    id: record.id,
    status: record.status as SessionStatus,
    programId: record.programId,
    programName: record.program.name,
    programVersionId: record.programVersionId,
    programVersionNumber: record.programVersion.versionNumber,
    webStartedAt: record.webStartedAt.toISOString(),
    webEndedAt: record.webEndedAt?.toISOString() ?? null,
    matchStatus: record.matchStatus as MatchStatus,
    matchMethod: (record.matchMethod as MatchMethod | null) ?? null,
    matchedAt: record.matchedAt?.toISOString() ?? null,
    matchedWorkoutId: record.matchedWorkoutId,
    matchedWorkout: toMatchedWorkoutDto(record.matchedWorkout),
    exercises,
    ordinaryTonnageKg: ordinaryExternalWeightTonnageKg(tonnageSets),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function toSessionSummaryDto(record: {
  id: number;
  status: string;
  programId: number;
  webStartedAt: Date;
  webEndedAt: Date | null;
  matchStatus: string;
  matchMethod: string | null;
  matchedWorkoutId: number | null;
  program: { name: string };
}): StrengthSessionSummaryDto {
  return {
    id: record.id,
    status: record.status as SessionStatus,
    programId: record.programId,
    programName: record.program.name,
    webStartedAt: record.webStartedAt.toISOString(),
    webEndedAt: record.webEndedAt?.toISOString() ?? null,
    matchStatus: record.matchStatus as MatchStatus,
    matchMethod: (record.matchMethod as MatchMethod | null) ?? null,
    matchedWorkoutId: record.matchedWorkoutId,
  };
}

export type OrderedProgramExerciseWrite = {
  exerciseCatalogId: number;
  sortOrder: number;
  plannedSets: number;
  resistanceType: ResistanceType;
};

export class TrainingRepository {
  constructor(private readonly db: PrismaClient = prisma) {}

  async listCatalog(options: {
    profileId?: number;
    activeOnly?: boolean;
  } = {}): Promise<ExerciseCatalogDto[]> {
    const profileId = options.profileId ?? DEFAULT_TRAINING_PROFILE_ID;
    const activeOnly = options.activeOnly ?? true;
    const rows = await this.db.exerciseCatalog.findMany({
      where: {
        profileId,
        ...(activeOnly ? { isActive: true } : {}),
      },
      select: catalogSelect,
      orderBy: [{ name: "asc" }, { id: "asc" }],
    });
    return rows.map(toCatalogDto);
  }

  async findCatalogByIds(ids: number[], profileId = DEFAULT_TRAINING_PROFILE_ID) {
    return this.db.exerciseCatalog.findMany({
      where: { profileId, id: { in: ids } },
      select: { id: true, name: true, isActive: true, muscleMapping: true },
    });
  }

  async listPrograms(options: {
    profileId?: number;
    includeArchived?: boolean;
  } = {}): Promise<TrainingProgramSummaryDto[]> {
    const profileId = options.profileId ?? DEFAULT_TRAINING_PROFILE_ID;
    const rows = await this.db.trainingProgram.findMany({
      where: {
        profileId,
        ...(options.includeArchived ? {} : { archivedAt: null }),
      },
      select: {
        id: true,
        name: true,
        archivedAt: true,
        currentVersionId: true,
        createdAt: true,
        updatedAt: true,
        currentVersion: {
          select: {
            id: true,
            versionNumber: true,
            _count: { select: { exercises: true } },
          },
        },
      },
      orderBy: [{ archivedAt: "asc" }, { name: "asc" }, { id: "asc" }],
    });

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      archivedAt: row.archivedAt?.toISOString() ?? null,
      currentVersionId: row.currentVersionId,
      currentVersionNumber: row.currentVersion?.versionNumber ?? null,
      exerciseCount: row.currentVersion?._count.exercises ?? 0,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));
  }

  async getProgram(
    programId: number,
    profileId = DEFAULT_TRAINING_PROFILE_ID,
  ): Promise<TrainingProgramDto | null> {
    const row = await this.db.trainingProgram.findFirst({
      where: { id: programId, profileId },
      select: {
        id: true,
        name: true,
        archivedAt: true,
        currentVersionId: true,
        createdAt: true,
        updatedAt: true,
        currentVersion: {
          select: {
            id: true,
            versionNumber: true,
            exercises: {
              select: programExerciseSelect,
              orderBy: { sortOrder: "asc" },
            },
          },
        },
      },
    });
    if (!row) return null;

    return {
      id: row.id,
      name: row.name,
      archivedAt: row.archivedAt?.toISOString() ?? null,
      currentVersionId: row.currentVersionId,
      currentVersionNumber: row.currentVersion?.versionNumber ?? null,
      exercises: (row.currentVersion?.exercises ?? []).map(toProgramExerciseDto),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async createProgramWithVersion(input: {
    profileId?: number;
    name: string;
    exercises: OrderedProgramExerciseWrite[];
  }): Promise<TrainingProgramDto> {
    const profileId = input.profileId ?? DEFAULT_TRAINING_PROFILE_ID;

    const created = await this.db.$transaction(async (tx) => {
      const program = await tx.trainingProgram.create({
        data: { profileId, name: input.name },
        select: { id: true },
      });
      const version = await tx.trainingProgramVersion.create({
        data: {
          programId: program.id,
          versionNumber: 1,
          exercises: {
            create: input.exercises.map((exercise) => ({
              exerciseCatalogId: exercise.exerciseCatalogId,
              sortOrder: exercise.sortOrder,
              plannedSets: exercise.plannedSets,
              resistanceType: exercise.resistanceType,
            })),
          },
        },
        select: { id: true },
      });
      await tx.trainingProgram.update({
        where: { id: program.id },
        data: { currentVersionId: version.id },
      });
      return program.id;
    });

    const dto = await this.getProgram(created, profileId);
    if (!dto) throw new Error("created program missing after write");
    return dto;
  }

  async updateProgramWithNewVersion(input: {
    programId: number;
    profileId?: number;
    name?: string;
    exercises?: OrderedProgramExerciseWrite[];
  }): Promise<TrainingProgramDto | null> {
    const profileId = input.profileId ?? DEFAULT_TRAINING_PROFILE_ID;

    const updatedId = await this.db.$transaction(async (tx) => {
      const existing = await tx.trainingProgram.findFirst({
        where: { id: input.programId, profileId },
        select: {
          id: true,
          name: true,
          currentVersionId: true,
          currentVersion: {
            select: {
              versionNumber: true,
              exercises: {
                select: {
                  exerciseCatalogId: true,
                  sortOrder: true,
                  plannedSets: true,
                  resistanceType: true,
                },
                orderBy: { sortOrder: "asc" },
              },
            },
          },
        },
      });
      if (!existing) return null;

      const nextName = input.name ?? existing.name;
      const nextExercises =
        input.exercises
        ?? (existing.currentVersion?.exercises ?? []).map((exercise) => ({
          exerciseCatalogId: exercise.exerciseCatalogId,
          sortOrder: exercise.sortOrder,
          plannedSets: exercise.plannedSets,
          resistanceType: exercise.resistanceType as ResistanceType,
        }));

      const nextVersionNumber = (existing.currentVersion?.versionNumber ?? 0) + 1;
      const version = await tx.trainingProgramVersion.create({
        data: {
          programId: existing.id,
          versionNumber: nextVersionNumber,
          exercises: {
            create: nextExercises.map((exercise) => ({
              exerciseCatalogId: exercise.exerciseCatalogId,
              sortOrder: exercise.sortOrder,
              plannedSets: exercise.plannedSets,
              resistanceType: exercise.resistanceType,
            })),
          },
        },
        select: { id: true },
      });

      await tx.trainingProgram.update({
        where: { id: existing.id },
        data: {
          name: nextName,
          currentVersionId: version.id,
        },
      });

      return existing.id;
    });

    if (updatedId == null) return null;
    return this.getProgram(updatedId, profileId);
  }

  async archiveProgram(
    programId: number,
    profileId = DEFAULT_TRAINING_PROFILE_ID,
    archivedAt: Date = new Date(),
  ): Promise<TrainingProgramDto | null> {
    const existing = await this.db.trainingProgram.findFirst({
      where: { id: programId, profileId },
      select: { id: true, archivedAt: true },
    });
    if (!existing) return null;
    if (existing.archivedAt) return this.getProgram(programId, profileId);

    await this.db.trainingProgram.update({
      where: { id: programId },
      data: { archivedAt },
    });
    return this.getProgram(programId, profileId);
  }

  async getActiveSession(profileId = DEFAULT_TRAINING_PROFILE_ID): Promise<StrengthSessionDto | null> {
    const row = await this.db.strengthDiarySession.findFirst({
      where: { profileId, status: SESSION_STATUS.ACTIVE },
      select: sessionDetailSelect,
    });
    return row ? toSessionDto(row) : null;
  }

  async getSession(
    sessionId: number,
    profileId = DEFAULT_TRAINING_PROFILE_ID,
  ): Promise<StrengthSessionDto | null> {
    const row = await this.db.strengthDiarySession.findFirst({
      where: { id: sessionId, profileId },
      select: sessionDetailSelect,
    });
    return row ? toSessionDto(row) : null;
  }

  async createSessionSnapshot(input: {
    profileId?: number;
    programId: number;
    programVersionId: number;
    webStartedAt?: Date;
    exercises: Array<{
      sourceExerciseCatalogId: number | null;
      snapshotExerciseName: string;
      sortOrder: number;
      plannedSets: number;
      resistanceType: ResistanceType;
      muscleMappingSnapshot: Prisma.InputJsonValue | typeof Prisma.JsonNull;
    }>;
  }): Promise<StrengthSessionDto> {
    const profileId = input.profileId ?? DEFAULT_TRAINING_PROFILE_ID;
    const created = await this.db.strengthDiarySession.create({
      data: {
        profileId,
        programId: input.programId,
        programVersionId: input.programVersionId,
        status: SESSION_STATUS.ACTIVE,
        webStartedAt: input.webStartedAt ?? new Date(),
        matchStatus: MATCH_STATUS.PENDING,
        exercises: {
          create: input.exercises.map((exercise) => ({
            sourceExerciseCatalogId: exercise.sourceExerciseCatalogId,
            snapshotExerciseName: exercise.snapshotExerciseName,
            sortOrder: exercise.sortOrder,
            plannedSets: exercise.plannedSets,
            resistanceType: exercise.resistanceType,
            muscleMappingSnapshot: exercise.muscleMappingSnapshot,
          })),
        },
      },
      select: { id: true },
    });
    const dto = await this.getSession(created.id, profileId);
    if (!dto) throw new Error("created session missing after write");
    return dto;
  }

  async findSessionExercise(sessionId: number, exerciseId: number, profileId = DEFAULT_TRAINING_PROFILE_ID) {
    return this.db.strengthSessionExercise.findFirst({
      where: {
        id: exerciseId,
        sessionId,
        session: { profileId },
      },
      select: {
        id: true,
        sessionId: true,
        resistanceType: true,
        session: { select: { id: true, status: true } },
        sets: { select: { setNumber: true }, orderBy: { setNumber: "desc" }, take: 1 },
      },
    });
  }

  async createSet(input: {
    sessionExerciseId: number;
    setNumber: number;
    reps: number;
    weightKg: number | null;
    bandNominalResistanceKg: number | null;
    completedAt: Date | null;
  }): Promise<StrengthSetDto> {
    const row = await this.db.strengthSet.create({
      data: {
        sessionExerciseId: input.sessionExerciseId,
        setNumber: input.setNumber,
        reps: input.reps,
        weightKg: input.weightKg,
        bandNominalResistanceKg: input.bandNominalResistanceKg,
        completedAt: input.completedAt,
      },
      select: setSelect,
    });
    return toSetDto(row);
  }

  async updateSet(input: {
    setId: number;
    sessionId: number;
    profileId?: number;
    reps?: number;
    weightKg?: number | null;
    bandNominalResistanceKg?: number | null;
    completedAt?: Date | null;
  }): Promise<StrengthSetDto | null> {
    const profileId = input.profileId ?? DEFAULT_TRAINING_PROFILE_ID;
    const existing = await this.db.strengthSet.findFirst({
      where: {
        id: input.setId,
        sessionExercise: { sessionId: input.sessionId, session: { profileId } },
      },
      select: { id: true },
    });
    if (!existing) return null;

    const row = await this.db.strengthSet.update({
      where: { id: input.setId },
      data: {
        ...(input.reps !== undefined ? { reps: input.reps } : {}),
        ...(input.weightKg !== undefined ? { weightKg: input.weightKg } : {}),
        ...(input.bandNominalResistanceKg !== undefined
          ? { bandNominalResistanceKg: input.bandNominalResistanceKg }
          : {}),
        ...(input.completedAt !== undefined ? { completedAt: input.completedAt } : {}),
      },
      select: setSelect,
    });
    return toSetDto(row);
  }

  async deleteSet(
    setId: number,
    sessionId: number,
    profileId = DEFAULT_TRAINING_PROFILE_ID,
  ): Promise<boolean> {
    const existing = await this.db.strengthSet.findFirst({
      where: {
        id: setId,
        sessionExercise: { sessionId, session: { profileId } },
      },
      select: { id: true },
    });
    if (!existing) return false;
    await this.db.strengthSet.delete({ where: { id: setId } });
    return true;
  }

  async findSetForSession(setId: number, sessionId: number, profileId = DEFAULT_TRAINING_PROFILE_ID) {
    return this.db.strengthSet.findFirst({
      where: {
        id: setId,
        sessionExercise: { sessionId, session: { profileId } },
      },
      select: {
        id: true,
        reps: true,
        weightKg: true,
        bandNominalResistanceKg: true,
        completedAt: true,
        sessionExercise: {
          select: {
            id: true,
            resistanceType: true,
            session: { select: { id: true, status: true } },
          },
        },
      },
    });
  }

  async markSessionCompleted(sessionId: number, webEndedAt: Date): Promise<void> {
    await this.db.strengthDiarySession.update({
      where: { id: sessionId },
      data: {
        status: SESSION_STATUS.COMPLETED,
        webEndedAt,
      },
    });
  }

  async markSessionCancelled(sessionId: number, webEndedAt: Date): Promise<void> {
    await this.db.strengthDiarySession.update({
      where: { id: sessionId },
      data: {
        status: SESSION_STATUS.CANCELLED,
        webEndedAt,
        matchStatus: MATCH_STATUS.UNMATCHED,
        matchMethod: null,
        matchedWorkoutId: null,
        matchedAt: null,
      },
    });
  }

  async applyMatchResult(input: {
    sessionId: number;
    matchStatus: MatchStatus;
    matchMethod: MatchMethod | null;
    matchedWorkoutId: number | null;
    matchedAt: Date | null;
  }): Promise<void> {
    await this.db.strengthDiarySession.update({
      where: { id: input.sessionId },
      data: {
        matchStatus: input.matchStatus,
        matchMethod: input.matchMethod,
        matchedWorkoutId: input.matchedWorkoutId,
        matchedAt: input.matchedAt,
      },
    });
  }

  async listRecentSessions(options: {
    profileId?: number;
    limit?: number;
  } = {}): Promise<StrengthSessionSummaryDto[]> {
    const profileId = options.profileId ?? DEFAULT_TRAINING_PROFILE_ID;
    const limit = options.limit ?? TRAINING_LIMITS.recentSessionsDefaultLimit;
    const rows = await this.db.strengthDiarySession.findMany({
      where: {
        profileId,
        status: { in: [SESSION_STATUS.COMPLETED, SESSION_STATUS.CANCELLED] },
      },
      select: {
        id: true,
        status: true,
        programId: true,
        webStartedAt: true,
        webEndedAt: true,
        matchStatus: true,
        matchMethod: true,
        matchedWorkoutId: true,
        program: { select: { name: true } },
      },
      orderBy: [{ webStartedAt: "desc" }, { id: "desc" }],
      take: limit,
    });
    return rows.map(toSessionSummaryDto);
  }

  async listMatchAttention(options: {
    profileId?: number;
    longPendingBefore?: Date;
  } = {}): Promise<StrengthSessionSummaryDto[]> {
    const profileId = options.profileId ?? DEFAULT_TRAINING_PROFILE_ID;
    const longPendingBefore = options.longPendingBefore;
    const rows = await this.db.strengthDiarySession.findMany({
      where: {
        profileId,
        status: SESSION_STATUS.COMPLETED,
        OR: [
          { matchStatus: MATCH_STATUS.AMBIGUOUS },
          ...(longPendingBefore
            ? [{
                matchStatus: MATCH_STATUS.PENDING,
                webEndedAt: { lte: longPendingBefore },
              }]
            : []),
        ],
      },
      select: {
        id: true,
        status: true,
        programId: true,
        webStartedAt: true,
        webEndedAt: true,
        matchStatus: true,
        matchMethod: true,
        matchedWorkoutId: true,
        program: { select: { name: true } },
      },
      orderBy: [{ webEndedAt: "desc" }, { id: "desc" }],
    });
    return rows.map(toSessionSummaryDto);
  }

  async findPendingCompletedSessionsOverlapping(window: {
    profileId?: number;
    windowStart: Date;
    windowEnd: Date;
  }) {
    const profileId = window.profileId ?? DEFAULT_TRAINING_PROFILE_ID;
    return this.db.strengthDiarySession.findMany({
      where: {
        profileId,
        status: SESSION_STATUS.COMPLETED,
        matchStatus: MATCH_STATUS.PENDING,
        OR: [
          { matchMethod: null },
          { matchMethod: { not: "MANUAL" } },
        ],
        webStartedAt: { lt: window.windowEnd },
        AND: [
          {
            OR: [
              { webEndedAt: { gt: window.windowStart } },
              { webEndedAt: null },
            ],
          },
        ],
      },
      select: {
        id: true,
        webStartedAt: true,
        webEndedAt: true,
        matchMethod: true,
        matchedWorkoutId: true,
      },
    });
  }

  async findWorkoutsNearInterval(interval: {
    startAt: Date;
    endAt: Date;
    padMs: number;
  }): Promise<Array<{
    id: number;
    type: string;
    startAt: Date;
    endAt: Date;
    durationMinutes: number | null;
    activeEnergyKcal: number | null;
    externalId: string | null;
    matchedDiarySession: { id: number } | null;
  }>> {
    const padStart = new Date(interval.startAt.getTime() - interval.padMs);
    const padEnd = new Date(interval.endAt.getTime() + interval.padMs);
    return this.db.workout.findMany({
      where: {
        startAt: { lt: padEnd },
        endAt: { gt: padStart },
      },
      select: {
        id: true,
        type: true,
        startAt: true,
        endAt: true,
        durationMinutes: true,
        activeEnergyKcal: true,
        externalId: true,
        matchedDiarySession: { select: { id: true } },
      },
      orderBy: [{ startAt: "asc" }, { id: "asc" }],
    });
  }

  toMatchCandidateDtos(
    rows: Array<{
      id: number;
      type: string;
      startAt: Date;
      endAt: Date;
      durationMinutes: number | null;
      activeEnergyKcal: number | null;
      externalId: string | null;
      matchedDiarySession: { id: number } | null;
    }>,
    currentSessionId: number,
  ): MatchCandidateDto[] {
    return rows.map((row) => ({
      id: row.id,
      type: row.type,
      startAt: row.startAt.toISOString(),
      endAt: row.endAt.toISOString(),
      durationMinutes: row.durationMinutes,
      activeEnergyKcal: row.activeEnergyKcal,
      externalId: row.externalId,
      alreadyMatched: row.matchedDiarySession != null && row.matchedDiarySession.id !== currentSessionId,
    }));
  }

  async findWorkoutById(workoutId: number) {
    return this.db.workout.findUnique({
      where: { id: workoutId },
      select: {
        id: true,
        type: true,
        startAt: true,
        endAt: true,
        matchedDiarySession: { select: { id: true } },
      },
    });
  }

  async loadProgramForStart(programId: number, profileId = DEFAULT_TRAINING_PROFILE_ID) {
    return this.db.trainingProgram.findFirst({
      where: { id: programId, profileId },
      select: {
        id: true,
        name: true,
        archivedAt: true,
        currentVersionId: true,
        currentVersion: {
          select: {
            id: true,
            versionNumber: true,
            exercises: {
              select: {
                exerciseCatalogId: true,
                sortOrder: true,
                plannedSets: true,
                resistanceType: true,
                exerciseCatalog: {
                  select: { id: true, name: true, muscleMapping: true },
                },
              },
              orderBy: { sortOrder: "asc" },
            },
          },
        },
      },
    });
  }
}

export const trainingRepository = new TrainingRepository();
