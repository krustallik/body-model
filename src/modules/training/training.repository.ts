import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { canonicalizeWorkoutType } from "@/model/activity/workout-energy";
import { parseExerciseMuscleMappingSnapshotV7 } from "@/model/physiology-v7/exercise-muscle-mapping-v7";
import { TRADITIONAL_STRENGTH_TRAINING_TYPE } from "@/modules/health/expand-training-workouts";
import { CANONICAL_EXERCISE_IDENTITIES } from "./canonical-exercise-identity";
import {
  DEFAULT_TRAINING_PROFILE_ID,
  DIARY_COMPLETENESS,
  ENTRY_MODE,
  EXERCISE_ORIGIN,
  MATCH_METHOD,
  MATCH_STATUS,
  SESSION_STATUS,
  TRAINING_LIMITS,
  type DiaryCompleteness,
  type EntryMode,
  type ExerciseOrigin,
  type MatchMethod,
  type MatchStatus,
  type ResistanceType,
  type SessionStatus,
} from "./training.constants";
import type { ProgramReconcilePlan } from "./training.program-reconcile";
import { ordinaryExternalWeightTonnageKg } from "./training.tonnage";
import type {
  ExerciseCatalogDto,
  ExerciseHistoryEntryDto,
  HistoricalStrengthWorkoutDto,
  MatchCandidateDto,
  MatchedWorkoutDto,
  ProgramExerciseDto,
  ProgramVersionSummaryDto,
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
  stableKey: true,
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
  rir: true,
  comment: true,
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
  origin: true,
  muscleMappingSnapshot: true,
  sourceExerciseCatalog: { select: { stableKey: true } },
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
  entryMode: true,
  revision: true,
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

const sessionSummarySelect = {
  id: true,
  status: true,
  entryMode: true,
  programId: true,
  webStartedAt: true,
  webEndedAt: true,
  matchStatus: true,
  matchMethod: true,
  matchedWorkoutId: true,
  createdAt: true,
  program: { select: { name: true } },
  matchedWorkout: { select: { startAt: true } },
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

/** Narrow VarChar enum columns to their union type, defaulting to the legacy value. */
function asEntryMode(value: string): EntryMode {
  return value === ENTRY_MODE.RETROSPECTIVE ? ENTRY_MODE.RETROSPECTIVE : ENTRY_MODE.LIVE;
}

function asExerciseOrigin(value: string): ExerciseOrigin {
  return value === EXERCISE_ORIGIN.EXTRA ? EXERCISE_ORIGIN.EXTRA : EXERCISE_ORIGIN.PLANNED;
}

function toCatalogDto(record: CatalogRecord): ExerciseCatalogDto {
  return {
    id: record.id,
    name: record.name,
    stableKey: record.stableKey,
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
    rir: record.rir,
    comment: record.comment ?? null,
    completedAt: record.completedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function toSessionExerciseDto(record: SessionExerciseRecord): StrengthSessionExerciseDto {
  const snapshot = parseExerciseMuscleMappingSnapshotV7(record.muscleMappingSnapshot);
  return {
    id: record.id,
    sourceExerciseCatalogId: record.sourceExerciseCatalogId,
    stableKey: record.sourceExerciseCatalog?.stableKey ?? snapshot?.stableKey ?? null,
    snapshotExerciseName: record.snapshotExerciseName,
    order: record.sortOrder,
    plannedSets: record.plannedSets,
    resistanceType: record.resistanceType as ResistanceType,
    origin: asExerciseOrigin(record.origin),
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
      stableKey: exercise.stableKey,
    })),
  );

  return {
    id: record.id,
    status: record.status as SessionStatus,
    entryMode: asEntryMode(record.entryMode),
    revision: record.revision,
    programId: record.programId,
    programName: record.program.name,
    programVersionId: record.programVersionId,
    programVersionNumber: record.programVersion.versionNumber,
    webStartedAt: record.webStartedAt?.toISOString() ?? null,
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

type SessionSummaryRecord = Prisma.StrengthDiarySessionGetPayload<{
  select: typeof sessionSummarySelect;
}>;

/**
 * Occurrence time is the physiological event time: the linked Garmin workout
 * start when matched, otherwise the live web start. Null for a retrospective
 * session whose workout link was cleared.
 */
function occurrenceInstant(record: {
  webStartedAt: Date | null;
  matchedWorkout: { startAt: Date } | null;
}): Date | null {
  return record.matchedWorkout?.startAt ?? record.webStartedAt ?? null;
}

function toSessionSummaryDto(record: SessionSummaryRecord): StrengthSessionSummaryDto {
  return {
    id: record.id,
    status: record.status as SessionStatus,
    entryMode: asEntryMode(record.entryMode),
    programId: record.programId,
    programName: record.program.name,
    webStartedAt: record.webStartedAt?.toISOString() ?? null,
    webEndedAt: record.webEndedAt?.toISOString() ?? null,
    matchStatus: record.matchStatus as MatchStatus,
    matchMethod: (record.matchMethod as MatchMethod | null) ?? null,
    matchedWorkoutId: record.matchedWorkoutId,
    occurrenceAt: occurrenceInstant(record)?.toISOString() ?? null,
  };
}

/**
 * Backfill progress for a historical workout (UI only — never physiology).
 * PARTIAL means the diary has sets but at least one snapshot exercise is empty.
 */
export function diaryCompletenessOf(
  session: { exercises: Array<{ setCount: number }> } | null,
): DiaryCompleteness {
  if (!session) return DIARY_COMPLETENESS.NO_DIARY;
  const withSets = session.exercises.filter((exercise) => exercise.setCount > 0);
  if (withSets.length === 0) return DIARY_COMPLETENESS.DIARY_EMPTY;
  if (withSets.length === session.exercises.length) return DIARY_COMPLETENESS.DIARY_WITH_SETS;
  return DIARY_COMPLETENESS.DIARY_PARTIAL;
}

function jsonInput(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (value === null || value === undefined) return Prisma.JsonNull;
  return value as Prisma.InputJsonValue;
}

/**
 * Park rows on negative sortOrder before writing final positions so the
 * (sessionId, sortOrder) unique index cannot collide mid-reorder.
 */
async function parkExerciseOrder(
  tx: Prisma.TransactionClient,
  orderedExerciseIds: readonly number[],
): Promise<void> {
  for (const [index, id] of orderedExerciseIds.entries()) {
    await tx.strengthSessionExercise.update({
      where: { id },
      data: { sortOrder: -(index + 1) },
    });
  }
}

async function writeExerciseOrder(
  tx: Prisma.TransactionClient,
  orderedExerciseIds: readonly number[],
  options: { skipExerciseId?: number } = {},
): Promise<void> {
  for (const [index, id] of orderedExerciseIds.entries()) {
    if (id === options.skipExerciseId) continue;
    await tx.strengthSessionExercise.update({ where: { id }, data: { sortOrder: index } });
  }
}

function moveWithin(orderedIds: readonly number[], exerciseId: number, position: number): number[] {
  const without = orderedIds.filter((id) => id !== exerciseId);
  const target = Math.min(Math.max(position, 0), without.length);
  return [...without.slice(0, target), exerciseId, ...without.slice(target)];
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

  /**
   * Bootstrap/upsert the twelve supported exercises with explicit portable keys.
   * Never silently overwrites a conflicting non-null stableKey. Display-name
   * renames of already-keyed rows are left untouched.
   */
  async ensureCanonicalExerciseCatalog(
    profileId = DEFAULT_TRAINING_PROFILE_ID,
  ): Promise<ExerciseCatalogDto[]> {
    for (const identity of CANONICAL_EXERCISE_IDENTITIES) {
      const byKey = await this.db.exerciseCatalog.findFirst({
        where: { profileId, stableKey: identity.stableKey },
        select: catalogSelect,
      });
      if (byKey) {
        continue;
      }

      const byName = await this.db.exerciseCatalog.findFirst({
        where: { profileId, name: identity.displayName },
        select: catalogSelect,
      });
      if (byName) {
        if (byName.stableKey != null && byName.stableKey !== identity.stableKey) {
          throw new Error(
            `ExerciseCatalog stableKey conflict for canonical exercise ${identity.stableKey}`,
          );
        }
        if (byName.stableKey == null) {
          await this.db.exerciseCatalog.update({
            where: { id: byName.id },
            data: { stableKey: identity.stableKey },
          });
        }
        continue;
      }

      await this.db.exerciseCatalog.create({
        data: {
          profileId,
          name: identity.displayName,
          stableKey: identity.stableKey,
          isActive: true,
        },
      });
    }

    return this.listCatalog({ profileId, activeOnly: false });
  }

  async findCatalogByIds(ids: number[], profileId = DEFAULT_TRAINING_PROFILE_ID) {
    return this.db.exerciseCatalog.findMany({
      where: { profileId, id: { in: ids } },
      select: { id: true, name: true, stableKey: true, isActive: true, muscleMapping: true },
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
    status?: SessionStatus;
    entryMode?: EntryMode;
    /** Explicit null keeps a RETROSPECTIVE session free of faked live times. */
    webStartedAt?: Date | null;
    webEndedAt?: Date | null;
    matchStatus?: MatchStatus;
    matchMethod?: MatchMethod | null;
    matchedWorkoutId?: number | null;
    matchedAt?: Date | null;
    revision?: number;
    exercises: Array<{
      sourceExerciseCatalogId: number | null;
      snapshotExerciseName: string;
      sortOrder: number;
      plannedSets: number;
      resistanceType: ResistanceType;
      origin?: ExerciseOrigin;
      muscleMappingSnapshot: Prisma.InputJsonValue | typeof Prisma.JsonNull;
    }>;
  }): Promise<StrengthSessionDto> {
    const profileId = input.profileId ?? DEFAULT_TRAINING_PROFILE_ID;
    const created = await this.db.strengthDiarySession.create({
      data: {
        profileId,
        programId: input.programId,
        programVersionId: input.programVersionId,
        status: input.status ?? SESSION_STATUS.ACTIVE,
        entryMode: input.entryMode ?? ENTRY_MODE.LIVE,
        webStartedAt: input.webStartedAt === undefined ? new Date() : input.webStartedAt,
        webEndedAt: input.webEndedAt ?? null,
        revision: input.revision ?? 1,
        matchStatus: input.matchStatus ?? MATCH_STATUS.PENDING,
        matchMethod: input.matchMethod ?? null,
        matchedWorkoutId: input.matchedWorkoutId ?? null,
        matchedAt: input.matchedAt ?? null,
        exercises: {
          create: input.exercises.map((exercise) => ({
            sourceExerciseCatalogId: exercise.sourceExerciseCatalogId,
            snapshotExerciseName: exercise.snapshotExerciseName,
            sortOrder: exercise.sortOrder,
            plannedSets: exercise.plannedSets,
            resistanceType: exercise.resistanceType,
            origin: exercise.origin ?? EXERCISE_ORIGIN.PLANNED,
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

  /**
   * Historical backfill: a COMPLETED diary directly linked 1:1 to an existing
   * Garmin workout. No fuzzy matcher runs — the user picked the workout.
   */
  async createRetrospectiveSession(input: {
    profileId?: number;
    programId: number;
    programVersionId: number;
    matchedWorkoutId: number;
    matchedAt?: Date;
    exercises: Array<{
      sourceExerciseCatalogId: number | null;
      snapshotExerciseName: string;
      sortOrder: number;
      plannedSets: number;
      resistanceType: ResistanceType;
      muscleMappingSnapshot: Prisma.InputJsonValue | typeof Prisma.JsonNull;
    }>;
  }): Promise<StrengthSessionDto> {
    return this.createSessionSnapshot({
      profileId: input.profileId,
      programId: input.programId,
      programVersionId: input.programVersionId,
      status: SESSION_STATUS.COMPLETED,
      entryMode: ENTRY_MODE.RETROSPECTIVE,
      webStartedAt: null,
      webEndedAt: null,
      matchStatus: MATCH_STATUS.MATCHED,
      matchMethod: MATCH_METHOD.DIRECT_BACKFILL,
      matchedWorkoutId: input.matchedWorkoutId,
      matchedAt: input.matchedAt ?? new Date(),
      exercises: input.exercises.map((exercise) => ({
        ...exercise,
        origin: EXERCISE_ORIGIN.PLANNED,
      })),
    });
  }

  async incrementSessionRevision(sessionId: number): Promise<number> {
    const row = await this.db.strengthDiarySession.update({
      where: { id: sessionId },
      data: { revision: { increment: 1 } },
      select: { revision: true },
    });
    return row.revision;
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
        sourceExerciseCatalogId: true,
        snapshotExerciseName: true,
        resistanceType: true,
        session: {
          select: {
            id: true,
            status: true,
            entryMode: true,
            matchedWorkout: { select: { startAt: true } },
          },
        },
        sets: { select: { setNumber: true }, orderBy: { setNumber: "desc" }, take: 1 },
      },
    });
  }

  /**
   * Full editable view of one session exercise: snapshot fields plus every set's
   * load columns, so resistance-type changes can detect incompatible loads.
   */
  async findSessionExerciseDetail(
    sessionId: number,
    exerciseId: number,
    profileId = DEFAULT_TRAINING_PROFILE_ID,
  ) {
    return this.db.strengthSessionExercise.findFirst({
      where: { id: exerciseId, sessionId, session: { profileId } },
      select: {
        id: true,
        sessionId: true,
        sortOrder: true,
        plannedSets: true,
        resistanceType: true,
        origin: true,
        sets: { select: { id: true, weightKg: true, bandNominalResistanceKg: true } },
      },
    });
  }

  /** Session shape needed to plan program reconciliation and exercise edits. */
  async findSessionForEdit(sessionId: number, profileId = DEFAULT_TRAINING_PROFILE_ID) {
    return this.db.strengthDiarySession.findFirst({
      where: { id: sessionId, profileId },
      select: {
        id: true,
        status: true,
        entryMode: true,
        revision: true,
        programId: true,
        programVersionId: true,
        webStartedAt: true,
        matchedWorkout: { select: { id: true, startAt: true } },
        exercises: {
          select: {
            id: true,
            sourceExerciseCatalogId: true,
            snapshotExerciseName: true,
            sortOrder: true,
            plannedSets: true,
            resistanceType: true,
            origin: true,
            _count: { select: { sets: true } },
          },
          orderBy: { sortOrder: "asc" },
        },
      },
    });
  }

  /**
   * Reassign a historical session to another program version.
   * Keeps every existing exercise (orphans become EXTRA), never deletes sets,
   * writes an audit row, and bumps the diary source revision.
   */
  async changeSessionProgram(input: {
    sessionId: number;
    fromProgramId: number;
    fromProgramVersionId: number;
    toProgramId: number;
    toProgramVersionId: number;
    plan: ProgramReconcilePlan;
  }): Promise<number> {
    return this.db.$transaction(async (tx) => {
      await parkExerciseOrder(tx, input.plan.keep.map((keep) => keep.exerciseId));

      for (const added of input.plan.add) {
        await tx.strengthSessionExercise.create({
          data: {
            sessionId: input.sessionId,
            sourceExerciseCatalogId: added.sourceExerciseCatalogId,
            snapshotExerciseName: added.snapshotExerciseName,
            sortOrder: added.sortOrder,
            plannedSets: added.plannedSets,
            resistanceType: added.resistanceType,
            origin: added.origin,
            muscleMappingSnapshot: jsonInput(added.muscleMappingSnapshot),
          },
        });
      }

      for (const keep of input.plan.keep) {
        await tx.strengthSessionExercise.update({
          where: { id: keep.exerciseId },
          data: {
            sortOrder: keep.sortOrder,
            plannedSets: keep.plannedSets,
            origin: keep.origin,
          },
        });
      }

      await tx.strengthDiaryProgramChange.create({
        data: {
          sessionId: input.sessionId,
          fromProgramId: input.fromProgramId,
          fromProgramVersionId: input.fromProgramVersionId,
          toProgramId: input.toProgramId,
          toProgramVersionId: input.toProgramVersionId,
        },
      });

      const session = await tx.strengthDiarySession.update({
        where: { id: input.sessionId },
        data: {
          programId: input.toProgramId,
          programVersionId: input.toProgramVersionId,
          revision: { increment: 1 },
        },
        select: { revision: true },
      });
      return session.revision;
    });
  }

  /** Session-only exercise addition; the program template is never touched. */
  async addSessionExercise(input: {
    sessionId: number;
    sourceExerciseCatalogId: number;
    snapshotExerciseName: string;
    plannedSets: number;
    resistanceType: ResistanceType;
    origin?: ExerciseOrigin;
    muscleMappingSnapshot: unknown;
    /** Insert position; appended when omitted or past the end. */
    order?: number;
    orderedExerciseIds: readonly number[];
  }): Promise<{ exerciseId: number; revision: number }> {
    return this.db.$transaction(async (tx) => {
      const existing = [...input.orderedExerciseIds];
      const position = input.order === undefined
        ? existing.length
        : Math.min(Math.max(input.order, 0), existing.length);
      const appended = position === existing.length;

      if (!appended) await parkExerciseOrder(tx, existing);

      const created = await tx.strengthSessionExercise.create({
        data: {
          sessionId: input.sessionId,
          sourceExerciseCatalogId: input.sourceExerciseCatalogId,
          snapshotExerciseName: input.snapshotExerciseName,
          sortOrder: position,
          plannedSets: input.plannedSets,
          resistanceType: input.resistanceType,
          origin: input.origin ?? EXERCISE_ORIGIN.EXTRA,
          muscleMappingSnapshot: jsonInput(input.muscleMappingSnapshot),
        },
        select: { id: true },
      });

      if (!appended) {
        await writeExerciseOrder(
          tx,
          [...existing.slice(0, position), created.id, ...existing.slice(position)],
          { skipExerciseId: created.id },
        );
      }

      const session = await tx.strengthDiarySession.update({
        where: { id: input.sessionId },
        data: { revision: { increment: 1 } },
        select: { revision: true },
      });
      return { exerciseId: created.id, revision: session.revision };
    });
  }

  async updateSessionExercise(input: {
    sessionId: number;
    exerciseId: number;
    plannedSets?: number;
    resistanceType?: ResistanceType;
    /** Null out load columns made meaningless by a confirmed resistance change. */
    clearWeightKg?: boolean;
    clearBandNominalResistanceKg?: boolean;
    order?: number;
    orderedExerciseIds: readonly number[];
  }): Promise<number> {
    return this.db.$transaction(async (tx) => {
      if (input.plannedSets !== undefined || input.resistanceType !== undefined) {
        await tx.strengthSessionExercise.update({
          where: { id: input.exerciseId },
          data: {
            ...(input.plannedSets !== undefined ? { plannedSets: input.plannedSets } : {}),
            ...(input.resistanceType !== undefined ? { resistanceType: input.resistanceType } : {}),
          },
        });
      }

      if (input.clearWeightKg || input.clearBandNominalResistanceKg) {
        await tx.strengthSet.updateMany({
          where: { sessionExerciseId: input.exerciseId },
          data: {
            ...(input.clearWeightKg ? { weightKg: null } : {}),
            ...(input.clearBandNominalResistanceKg ? { bandNominalResistanceKg: null } : {}),
          },
        });
      }

      if (input.order !== undefined) {
        const reordered = moveWithin(input.orderedExerciseIds, input.exerciseId, input.order);
        await parkExerciseOrder(tx, reordered);
        await writeExerciseOrder(tx, reordered);
      }

      const session = await tx.strengthDiarySession.update({
        where: { id: input.sessionId },
        data: { revision: { increment: 1 } },
        select: { revision: true },
      });
      return session.revision;
    });
  }

  async deleteSessionExercise(input: {
    sessionId: number;
    exerciseId: number;
    orderedExerciseIds: readonly number[];
  }): Promise<number> {
    return this.db.$transaction(async (tx) => {
      await tx.strengthSessionExercise.delete({ where: { id: input.exerciseId } });
      const remaining = input.orderedExerciseIds.filter((id) => id !== input.exerciseId);
      await parkExerciseOrder(tx, remaining);
      await writeExerciseOrder(tx, remaining);
      const session = await tx.strengthDiarySession.update({
        where: { id: input.sessionId },
        data: { revision: { increment: 1 } },
        select: { revision: true },
      });
      return session.revision;
    });
  }

  async reorderSessionExercises(input: {
    sessionId: number;
    orderedExerciseIds: readonly number[];
  }): Promise<number> {
    return this.db.$transaction(async (tx) => {
      await parkExerciseOrder(tx, input.orderedExerciseIds);
      await writeExerciseOrder(tx, input.orderedExerciseIds);
      const session = await tx.strengthDiarySession.update({
        where: { id: input.sessionId },
        data: { revision: { increment: 1 } },
        select: { revision: true },
      });
      return session.revision;
    });
  }

  async createSet(input: {
    sessionExerciseId: number;
    setNumber: number;
    reps: number;
    weightKg: number | null;
    bandNominalResistanceKg: number | null;
    rir?: number | null;
    comment?: string | null;
    completedAt: Date | null;
  }): Promise<StrengthSetDto> {
    const row = await this.db.strengthSet.create({
      data: {
        sessionExerciseId: input.sessionExerciseId,
        setNumber: input.setNumber,
        reps: input.reps,
        weightKg: input.weightKg,
        bandNominalResistanceKg: input.bandNominalResistanceKg,
        rir: input.rir === undefined ? null : input.rir,
        comment: input.comment === undefined
          ? undefined
          : (input.comment?.trim() ? input.comment.trim() : null),
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
    rir?: number | null;
    comment?: string | null;
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
        ...(input.rir !== undefined ? { rir: input.rir } : {}),
        ...(input.comment !== undefined
          ? { comment: input.comment?.trim() ? input.comment.trim() : null }
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

  /**
   * Prior completed sessions for the same catalog exercise (or snapshot name fallback).
   * Newest first. Excludes the current session and empty set lists.
   */
  async listExerciseHistory(input: {
    profileId?: number;
    excludeSessionId: number;
    catalogId: number | null;
    snapshotExerciseName: string;
    limit?: number;
  }): Promise<ExerciseHistoryEntryDto[]> {
    const profileId = input.profileId ?? DEFAULT_TRAINING_PROFILE_ID;
    const limit = Math.min(Math.max(input.limit ?? 8, 1), 20);
    const identityFilter = input.catalogId != null
      ? { sourceExerciseCatalogId: input.catalogId }
      : { snapshotExerciseName: input.snapshotExerciseName };

    const rows = await this.db.strengthSessionExercise.findMany({
      where: {
        ...identityFilter,
        sessionId: { not: input.excludeSessionId },
        session: {
          profileId,
          status: SESSION_STATUS.COMPLETED,
        },
        sets: { some: {} },
      },
      orderBy: [
        { session: { matchedWorkout: { startAt: "desc" } } },
        { session: { webStartedAt: "desc" } },
        { session: { createdAt: "desc" } },
      ],
      take: limit,
      select: {
        resistanceType: true,
        sessionId: true,
        session: {
          select: {
            webStartedAt: true,
            createdAt: true,
            program: { select: { name: true } },
            matchedWorkout: { select: { startAt: true } },
          },
        },
        sets: {
          orderBy: { setNumber: "desc" },
          select: {
            setNumber: true,
            reps: true,
            weightKg: true,
            bandNominalResistanceKg: true,
            rir: true,
            comment: true,
          },
        },
      },
    });

    return rows.map((row) => {
      const occurredAt = (
        row.session.matchedWorkout?.startAt
        ?? row.session.webStartedAt
        ?? row.session.createdAt
      ).toISOString();
      return {
        sessionId: row.sessionId,
        occurredAt,
        programName: row.session.program.name,
        resistanceType: row.resistanceType as ResistanceType,
        sets: row.sets.map((set) => ({
          setNumber: set.setNumber,
          reps: set.reps,
          weightKg: decimalToNumber(set.weightKg),
          bandNominalResistanceKg: decimalToNumber(set.bandNominalResistanceKg),
          rir: set.rir,
          comment: set.comment ?? null,
        })),
      };
    });
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
        rir: true,
        completedAt: true,
        sessionExercise: {
          select: {
            id: true,
            resistanceType: true,
            session: {
              select: {
                id: true,
                status: true,
                entryMode: true,
                matchedWorkout: { select: { startAt: true } },
              },
            },
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

  /**
   * Hard-delete a diary session. Cascades exercises/sets/program-change audit.
   * Does NOT delete the linked Garmin Workout — only clears the 1:1 relation.
   */
  async deleteDiarySession(
    sessionId: number,
    profileId = DEFAULT_TRAINING_PROFILE_ID,
  ): Promise<{ deleted: true; matchedWorkoutId: number | null }> {
    const existing = await this.db.strengthDiarySession.findFirst({
      where: { id: sessionId, profileId },
      select: { id: true, matchedWorkoutId: true },
    });
    if (!existing) {
      return { deleted: true, matchedWorkoutId: null };
    }
    const matchedWorkoutId = existing.matchedWorkoutId;
    await this.db.strengthDiarySession.delete({ where: { id: sessionId } });
    return { deleted: true, matchedWorkoutId };
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
    // RETROSPECTIVE rows have no webStartedAt, so page by createdAt and then
    // present by occurrence (linked workout start) which is the real event time.
    const rows = await this.db.strengthDiarySession.findMany({
      where: {
        profileId,
        status: { in: [SESSION_STATUS.COMPLETED, SESSION_STATUS.CANCELLED] },
      },
      select: sessionSummarySelect,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit,
    });
    return rows
      .slice()
      .sort((a, b) => {
        const left = occurrenceInstant(a)?.getTime() ?? null;
        const right = occurrenceInstant(b)?.getTime() ?? null;
        if (left === right) return b.id - a.id;
        if (left === null) return 1;
        if (right === null) return -1;
        return right - left;
      })
      .map(toSessionSummaryDto);
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
      select: sessionSummarySelect,
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
    // Retrospective backfills are already linked 1:1 by the user; the fuzzy
    // matcher must never revisit them (and they have no live web interval).
    return this.db.strengthDiarySession.findMany({
      where: {
        profileId,
        status: SESSION_STATUS.COMPLETED,
        matchStatus: MATCH_STATUS.PENDING,
        entryMode: { not: ENTRY_MODE.RETROSPECTIVE },
        webStartedAt: { not: null, lt: window.windowEnd },
        OR: [
          { matchMethod: null },
          { matchMethod: { notIn: [MATCH_METHOD.MANUAL, MATCH_METHOD.DIRECT_BACKFILL] } },
        ],
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
        entryMode: true,
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
        durationMinutes: true,
        activeEnergyKcal: true,
        externalId: true,
        matchedDiarySession: {
          select: {
            id: true,
            status: true,
            entryMode: true,
            program: { select: { id: true, name: true } },
            exercises: { select: { id: true, _count: { select: { sets: true } } } },
          },
        },
      },
    });
  }

  /**
   * Historical Garmin strength workouts for retrospective backfill.
   * Only canonical Traditional Strength Training is eligible — stepper and
   * other activity types are never diary candidates.
   */
  async listHistoricalStrengthWorkouts(options: {
    limit?: number;
    cursor?: number;
    onlyMissingDiary?: boolean;
  } = {}): Promise<HistoricalStrengthWorkoutDto[]> {
    const limit = options.limit ?? TRAINING_LIMITS.recentSessionsDefaultLimit;
    const rows = await this.db.workout.findMany({
      where: {
        type: { equals: TRADITIONAL_STRENGTH_TRAINING_TYPE, mode: "insensitive" },
        ...(options.onlyMissingDiary ? { matchedDiarySession: null } : {}),
      },
      select: {
        id: true,
        type: true,
        startAt: true,
        endAt: true,
        durationMinutes: true,
        activeEnergyKcal: true,
        matchedDiarySession: {
          select: {
            id: true,
            program: { select: { name: true } },
            exercises: { select: { _count: { select: { sets: true } } } },
          },
        },
      },
      orderBy: [{ startAt: "desc" }, { id: "desc" }],
      take: limit,
      ...(options.cursor !== undefined ? { cursor: { id: options.cursor }, skip: 1 } : {}),
    });

    return rows
      .filter((row) =>
        canonicalizeWorkoutType(row.type).classification === "traditional-strength-training"
      )
      .map((row) => {
        const linked = row.matchedDiarySession;
        return {
          workoutId: row.id,
          type: row.type,
          startAt: row.startAt.toISOString(),
          endAt: row.endAt.toISOString(),
          durationMinutes: row.durationMinutes,
          activeEnergyKcal: row.activeEnergyKcal,
          linkedSessionId: linked?.id ?? null,
          linkedProgramName: linked?.program.name ?? null,
          diaryCompleteness: diaryCompletenessOf(
            linked
              ? {
                exercises: linked.exercises.map((exercise) => ({
                  setCount: exercise._count.sets,
                })),
              }
              : null,
          ),
        };
      });
  }

  /**
   * Load a specific (or current) program version for snapshotting.
   * Archived programs are allowed: historical sessions legitimately reference
   * programs the user has since retired.
   */
  async loadProgramVersion(input: {
    programId: number;
    programVersionId?: number | null;
    profileId?: number;
  }) {
    const profileId = input.profileId ?? DEFAULT_TRAINING_PROFILE_ID;
    const program = await this.db.trainingProgram.findFirst({
      where: { id: input.programId, profileId },
      select: { id: true, name: true, archivedAt: true, currentVersionId: true },
    });
    if (!program) return null;

    const versionId = input.programVersionId ?? program.currentVersionId;
    if (versionId == null) return { ...program, version: null };

    const version = await this.db.trainingProgramVersion.findFirst({
      where: { id: versionId, programId: program.id },
      select: {
        id: true,
        versionNumber: true,
        exercises: {
          select: {
            exerciseCatalogId: true,
            sortOrder: true,
            plannedSets: true,
            resistanceType: true,
            exerciseCatalog: { select: { id: true, name: true, stableKey: true, muscleMapping: true } },
          },
          orderBy: { sortOrder: "asc" },
        },
      },
    });
    return { ...program, version };
  }

  /** Null when the program does not exist for this profile. */
  async listProgramVersions(
    programId: number,
    profileId = DEFAULT_TRAINING_PROFILE_ID,
  ): Promise<ProgramVersionSummaryDto[] | null> {
    const program = await this.db.trainingProgram.findFirst({
      where: { id: programId, profileId },
      select: { id: true },
    });
    if (!program) return null;

    const rows = await this.db.trainingProgramVersion.findMany({
      where: { programId },
      select: {
        id: true,
        programId: true,
        versionNumber: true,
        createdAt: true,
        _count: { select: { exercises: true } },
      },
      orderBy: [{ versionNumber: "desc" }],
    });
    return rows.map((row) => ({
      id: row.id,
      programId: row.programId,
      versionNumber: row.versionNumber,
      exerciseCount: row._count.exercises,
      createdAt: row.createdAt.toISOString(),
    }));
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
                  select: { id: true, name: true, stableKey: true, muscleMapping: true },
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
