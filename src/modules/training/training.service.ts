import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { canonicalizeWorkoutType } from "@/model/activity/workout-energy";
import { DEFAULT_TIME_ZONE, localDateTimeToInstant } from "@/model/time-zone";
import {
  DEFAULT_TRAINING_PROFILE_ID,
  MATCH_METHOD,
  MATCH_STATUS,
  MATCH_THRESHOLDS,
  SESSION_STATUS,
  type ResistanceType,
} from "./training.constants";
import {
  ActiveSessionExistsError,
  CatalogExerciseNotFoundError,
  ProgramArchivedError,
  ProgramNotFoundError,
  SessionExerciseNotFoundError,
  SessionNotFoundError,
  SetNotFoundError,
  SetValidationError,
  WorkoutAlreadyMatchedError,
  WorkoutNotEligibleError,
} from "./training.errors";
import { matchDiaryToWorkouts } from "./training.matcher";
import {
  TrainingRepository,
  trainingRepository,
  type OrderedProgramExerciseWrite,
} from "./training.repository";
import type {
  CreateProgramInput,
  CreateSetInput,
  ManualMatchInput,
  UpdateProgramInput,
  UpdateSetInput,
} from "./training.schema";
import { validateSetFields } from "./training.set-validation";
import type {
  MatchCandidateDto,
  StrengthSessionDto,
  StrengthSetDto,
  TrainingProgramDto,
} from "./training.types";

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function normalizeProgramExercises(
  exercises: CreateProgramInput["exercises"],
): OrderedProgramExerciseWrite[] {
  return exercises.map((exercise, index) => ({
    exerciseCatalogId: exercise.catalogId,
    sortOrder: exercise.order ?? index,
    plannedSets: exercise.plannedSets,
    resistanceType: exercise.resistanceType,
  }));
}

function jsonSnapshot(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (value === null || value === undefined) return Prisma.JsonNull;
  return value as Prisma.InputJsonValue;
}

export class TrainingService {
  constructor(
    private readonly db: PrismaClient = prisma,
    private readonly repo: TrainingRepository = new TrainingRepository(db),
  ) {}

  listCatalog(options?: { includeInactive?: boolean; profileId?: number }) {
    return this.repo.listCatalog({
      profileId: options?.profileId,
      activeOnly: !options?.includeInactive,
    });
  }

  listPrograms(options?: { includeArchived?: boolean; profileId?: number }) {
    return this.repo.listPrograms(options);
  }

  getProgram(programId: number, profileId = DEFAULT_TRAINING_PROFILE_ID) {
    return this.repo.getProgram(programId, profileId);
  }

  async createProgram(
    input: CreateProgramInput,
    profileId = DEFAULT_TRAINING_PROFILE_ID,
  ): Promise<TrainingProgramDto> {
    const ordered = normalizeProgramExercises(input.exercises);
    await this.assertCatalogExercisesExist(
      ordered.map((exercise) => exercise.exerciseCatalogId),
      profileId,
    );
    return this.repo.createProgramWithVersion({
      profileId,
      name: input.name,
      exercises: ordered,
    });
  }

  async updateProgram(
    programId: number,
    input: UpdateProgramInput,
    profileId = DEFAULT_TRAINING_PROFILE_ID,
  ): Promise<TrainingProgramDto> {
    const existing = await this.repo.getProgram(programId, profileId);
    if (!existing) throw new ProgramNotFoundError();

    let ordered: OrderedProgramExerciseWrite[] | undefined;
    if (input.exercises) {
      ordered = normalizeProgramExercises(input.exercises);
      await this.assertCatalogExercisesExist(
        ordered.map((exercise) => exercise.exerciseCatalogId),
        profileId,
      );
    }

    // Program edits always create a new version; never mutate old version exercises.
    const updated = await this.repo.updateProgramWithNewVersion({
      programId,
      profileId,
      name: input.name,
      exercises: ordered,
    });
    if (!updated) throw new ProgramNotFoundError();
    return updated;
  }

  async archiveProgram(programId: number, profileId = DEFAULT_TRAINING_PROFILE_ID) {
    const archived = await this.repo.archiveProgram(programId, profileId);
    if (!archived) throw new ProgramNotFoundError();
    return archived;
  }

  getActiveSession(profileId = DEFAULT_TRAINING_PROFILE_ID) {
    return this.repo.getActiveSession(profileId);
  }

  getSession(sessionId: number, profileId = DEFAULT_TRAINING_PROFILE_ID) {
    return this.repo.getSession(sessionId, profileId);
  }

  async startSession(
    programId: number,
    profileId = DEFAULT_TRAINING_PROFILE_ID,
  ): Promise<StrengthSessionDto> {
    const active = await this.repo.getActiveSession(profileId);
    if (active) throw new ActiveSessionExistsError(active.id);

    const program = await this.repo.loadProgramForStart(programId, profileId);
    if (!program || !program.currentVersion || !program.currentVersionId) {
      throw new ProgramNotFoundError();
    }
    if (program.archivedAt) throw new ProgramArchivedError();
    if (program.currentVersion.exercises.length === 0) {
      throw new ProgramNotFoundError();
    }

    try {
      return await this.repo.createSessionSnapshot({
        profileId,
        programId: program.id,
        programVersionId: program.currentVersion.id,
        exercises: program.currentVersion.exercises.map((exercise) => ({
          sourceExerciseCatalogId: exercise.exerciseCatalog.id,
          snapshotExerciseName: exercise.exerciseCatalog.name,
          sortOrder: exercise.sortOrder,
          plannedSets: exercise.plannedSets,
          resistanceType: exercise.resistanceType as ResistanceType,
          muscleMappingSnapshot: jsonSnapshot(exercise.exerciseCatalog.muscleMapping),
        })),
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        const again = await this.repo.getActiveSession(profileId);
        if (again) throw new ActiveSessionExistsError(again.id);
      }
      throw error;
    }
  }

  async createSet(
    sessionId: number,
    exerciseId: number,
    input: CreateSetInput,
    profileId = DEFAULT_TRAINING_PROFILE_ID,
  ): Promise<StrengthSetDto> {
    const exercise = await this.repo.findSessionExercise(sessionId, exerciseId, profileId);
    if (!exercise) throw new SessionExerciseNotFoundError();
    if (
      exercise.session.status !== SESSION_STATUS.ACTIVE
      && exercise.session.status !== SESSION_STATUS.COMPLETED
    ) {
      throw new SessionNotFoundError();
    }

    const validated = validateSetFields(exercise.resistanceType as ResistanceType, {
      reps: input.reps,
      weightKg: input.weightKg ?? null,
      bandNominalResistanceKg: input.bandNominalResistanceKg ?? null,
    });
    if (!validated.ok) throw new SetValidationError(validated.message);

    const nextSetNumber =
      input.setNumber
      ?? ((exercise.sets[0]?.setNumber ?? 0) + 1);

    try {
      return await this.repo.createSet({
        sessionExerciseId: exercise.id,
        setNumber: nextSetNumber,
        reps: validated.reps,
        weightKg: validated.weightKg,
        bandNominalResistanceKg: validated.bandNominalResistanceKg,
        completedAt: input.completedAt ? new Date(input.completedAt) : new Date(),
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new SetValidationError("setNumber already exists for this exercise");
      }
      throw error;
    }
  }

  async updateSet(
    sessionId: number,
    setId: number,
    input: UpdateSetInput,
    profileId = DEFAULT_TRAINING_PROFILE_ID,
  ): Promise<StrengthSetDto> {
    const existing = await this.repo.findSetForSession(setId, sessionId, profileId);
    if (!existing) throw new SetNotFoundError();
    if (
      existing.sessionExercise.session.status !== SESSION_STATUS.ACTIVE
      && existing.sessionExercise.session.status !== SESSION_STATUS.COMPLETED
    ) {
      throw new SessionNotFoundError();
    }

    const nextReps = input.reps ?? existing.reps;
    const nextWeight =
      input.weightKg !== undefined
        ? input.weightKg
        : existing.weightKg === null
          ? null
          : existing.weightKg.toNumber();
    const nextBand =
      input.bandNominalResistanceKg !== undefined
        ? input.bandNominalResistanceKg
        : existing.bandNominalResistanceKg === null
          ? null
          : existing.bandNominalResistanceKg.toNumber();

    const validated = validateSetFields(
      existing.sessionExercise.resistanceType as ResistanceType,
      {
        reps: nextReps,
        weightKg: nextWeight,
        bandNominalResistanceKg: nextBand,
      },
    );
    if (!validated.ok) throw new SetValidationError(validated.message);

    const updated = await this.repo.updateSet({
      setId,
      sessionId,
      profileId,
      reps: validated.reps,
      weightKg: validated.weightKg,
      bandNominalResistanceKg: validated.bandNominalResistanceKg,
      completedAt:
        input.completedAt === undefined
          ? undefined
          : input.completedAt === null
            ? null
            : new Date(input.completedAt),
    });
    if (!updated) throw new SetNotFoundError();
    return updated;
  }

  async deleteSet(
    sessionId: number,
    setId: number,
    profileId = DEFAULT_TRAINING_PROFILE_ID,
  ): Promise<void> {
    const existing = await this.repo.findSetForSession(setId, sessionId, profileId);
    if (!existing) throw new SetNotFoundError();
    if (
      existing.sessionExercise.session.status !== SESSION_STATUS.ACTIVE
      && existing.sessionExercise.session.status !== SESSION_STATUS.COMPLETED
    ) {
      throw new SessionNotFoundError();
    }
    await this.repo.deleteSet(setId, sessionId, profileId);
  }

  async finishSession(
    sessionId: number,
    profileId = DEFAULT_TRAINING_PROFILE_ID,
  ): Promise<StrengthSessionDto> {
    const session = await this.repo.getSession(sessionId, profileId);
    if (!session) throw new SessionNotFoundError();

    if (session.status === SESSION_STATUS.COMPLETED) {
      // Idempotent finish: re-run matcher only while still PENDING/AUTO-eligible.
      if (
        session.matchStatus === MATCH_STATUS.PENDING
        && session.matchMethod !== MATCH_METHOD.MANUAL
      ) {
        await this.tryAutoMatchSession(sessionId, profileId);
      }
      const refreshed = await this.repo.getSession(sessionId, profileId);
      if (!refreshed) throw new SessionNotFoundError();
      return refreshed;
    }

    if (session.status !== SESSION_STATUS.ACTIVE) {
      throw new SessionNotFoundError();
    }

    await this.repo.markSessionCompleted(sessionId, new Date());
    await this.tryAutoMatchSession(sessionId, profileId);
    const refreshed = await this.repo.getSession(sessionId, profileId);
    if (!refreshed) throw new SessionNotFoundError();
    return refreshed;
  }

  async cancelSession(
    sessionId: number,
    profileId = DEFAULT_TRAINING_PROFILE_ID,
  ): Promise<StrengthSessionDto> {
    const session = await this.repo.getSession(sessionId, profileId);
    if (!session) throw new SessionNotFoundError();
    if (session.status === SESSION_STATUS.CANCELLED) return session;
    if (session.status !== SESSION_STATUS.ACTIVE) {
      throw new SessionNotFoundError();
    }
    await this.repo.markSessionCancelled(sessionId, new Date());
    const refreshed = await this.repo.getSession(sessionId, profileId);
    if (!refreshed) throw new SessionNotFoundError();
    return refreshed;
  }

  listRecentSessions(options?: { limit?: number; profileId?: number }) {
    return this.repo.listRecentSessions(options);
  }

  listMatchAttention(profileId = DEFAULT_TRAINING_PROFILE_ID) {
    return this.repo.listMatchAttention({
      profileId,
      longPendingBefore: new Date(Date.now() - MATCH_THRESHOLDS.longPendingMs),
    });
  }

  async listMatchCandidates(
    sessionId: number,
    profileId = DEFAULT_TRAINING_PROFILE_ID,
  ): Promise<MatchCandidateDto[]> {
    const session = await this.repo.getSession(sessionId, profileId);
    if (!session) throw new SessionNotFoundError();
    const startAt = new Date(session.webStartedAt);
    const endAt = new Date(session.webEndedAt ?? session.webStartedAt);
    const rows = await this.repo.findWorkoutsNearInterval({
      startAt,
      endAt,
      padMs: MATCH_THRESHOLDS.maxStartDeltaMs,
    });
    return this.repo
      .toMatchCandidateDtos(rows, sessionId)
      .filter((candidate) =>
        canonicalizeWorkoutType(candidate.type).classification === "traditional-strength-training"
      );
  }

  async manualMatch(
    sessionId: number,
    input: ManualMatchInput,
    profileId = DEFAULT_TRAINING_PROFILE_ID,
  ): Promise<StrengthSessionDto> {
    const session = await this.repo.getSession(sessionId, profileId);
    if (!session) throw new SessionNotFoundError();
    if (session.status !== SESSION_STATUS.COMPLETED) {
      throw new SessionNotFoundError();
    }

    if (input.workoutId === null) {
      await this.repo.applyMatchResult({
        sessionId,
        matchStatus: MATCH_STATUS.UNMATCHED,
        matchMethod: MATCH_METHOD.MANUAL,
        matchedWorkoutId: null,
        matchedAt: new Date(),
      });
    } else {
      const workout = await this.repo.findWorkoutById(input.workoutId);
      if (!workout) throw new WorkoutNotEligibleError("workout not found");
      if (
        canonicalizeWorkoutType(workout.type).classification !== "traditional-strength-training"
      ) {
        throw new WorkoutNotEligibleError();
      }
      if (workout.matchedDiarySession && workout.matchedDiarySession.id !== sessionId) {
        throw new WorkoutAlreadyMatchedError();
      }

      try {
        await this.repo.applyMatchResult({
          sessionId,
          matchStatus: MATCH_STATUS.MATCHED,
          matchMethod: MATCH_METHOD.MANUAL,
          matchedWorkoutId: workout.id,
          matchedAt: new Date(),
        });
      } catch (error) {
        if (isUniqueViolation(error)) throw new WorkoutAlreadyMatchedError();
        throw error;
      }
    }

    const refreshed = await this.repo.getSession(sessionId, profileId);
    if (!refreshed) throw new SessionNotFoundError();
    return refreshed;
  }

  /**
   * After health sync for a calendar day, attempt auto-match for overlapping
   * completed PENDING sessions. Skips MANUAL sticky matches. Failures are
   * caller-owned (service throws; health sync should catch/log).
   */
  async afterHealthSyncMatch(
    date: string,
    options: { profileId?: number; timezone?: string } = {},
  ): Promise<void> {
    const profileId = options.profileId ?? DEFAULT_TRAINING_PROFILE_ID;
    const timezone = options.timezone ?? DEFAULT_TIME_ZONE;
    const windowStart = localDateTimeToInstant(date, "00:00", timezone);
    const nextDay = new Date(windowStart.getTime() + 24 * 60 * 60_000);
    // Inclusive local day: [00:00, next 00:00)
    const windowEnd = nextDay;

    const sessions = await this.repo.findPendingCompletedSessionsOverlapping({
      profileId,
      windowStart,
      windowEnd,
    });

    for (const session of sessions) {
      if (session.matchMethod === MATCH_METHOD.MANUAL) continue;
      await this.tryAutoMatchSession(session.id, profileId);
    }
  }

  private async tryAutoMatchSession(
    sessionId: number,
    profileId = DEFAULT_TRAINING_PROFILE_ID,
  ): Promise<void> {
    const session = await this.repo.getSession(sessionId, profileId);
    if (!session) return;
    if (session.status !== SESSION_STATUS.COMPLETED) return;
    if (session.matchMethod === MATCH_METHOD.MANUAL) return;
    if (session.matchStatus === MATCH_STATUS.MATCHED && session.matchedWorkoutId != null) return;

    const startAt = new Date(session.webStartedAt);
    const endAt = session.webEndedAt ? new Date(session.webEndedAt) : startAt;
    if (!(endAt > startAt)) return;

    const rows = await this.repo.findWorkoutsNearInterval({
      startAt,
      endAt,
      padMs: MATCH_THRESHOLDS.maxStartDeltaMs,
    });

    const result = matchDiaryToWorkouts(
      { startAt, endAt },
      rows.map((row) => ({
        id: row.id,
        type: row.type,
        startAt: row.startAt,
        endAt: row.endAt,
        alreadyMatched:
          row.matchedDiarySession != null && row.matchedDiarySession.id !== sessionId,
      })),
    );

    if (result.kind === "MATCH" && result.workoutId != null) {
      try {
        await this.repo.applyMatchResult({
          sessionId,
          matchStatus: MATCH_STATUS.MATCHED,
          matchMethod: MATCH_METHOD.AUTO,
          matchedWorkoutId: result.workoutId,
          matchedAt: new Date(),
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          await this.repo.applyMatchResult({
            sessionId,
            matchStatus: MATCH_STATUS.AMBIGUOUS,
            matchMethod: null,
            matchedWorkoutId: null,
            matchedAt: null,
          });
          return;
        }
        throw error;
      }
      return;
    }

    if (result.kind === "AMBIGUOUS") {
      await this.repo.applyMatchResult({
        sessionId,
        matchStatus: MATCH_STATUS.AMBIGUOUS,
        matchMethod: null,
        matchedWorkoutId: null,
        matchedAt: null,
      });
      return;
    }

    // NO_MATCH: stay PENDING (waiting for delayed Garmin). Never auto-UNMATCHED.
    if (session.matchStatus !== MATCH_STATUS.PENDING || session.matchedWorkoutId != null) {
      await this.repo.applyMatchResult({
        sessionId,
        matchStatus: MATCH_STATUS.PENDING,
        matchMethod: null,
        matchedWorkoutId: null,
        matchedAt: null,
      });
    }
  }

  private async assertCatalogExercisesExist(
    ids: number[],
    profileId: number,
  ): Promise<void> {
    const unique = [...new Set(ids)];
    const found = await this.repo.findCatalogByIds(unique, profileId);
    if (found.length !== unique.length) throw new CatalogExerciseNotFoundError();
  }
}

export const trainingService = new TrainingService(prisma, trainingRepository);
