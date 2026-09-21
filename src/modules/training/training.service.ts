import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { canonicalizeWorkoutType } from "@/model/activity/workout-energy";
import { DEFAULT_TIME_ZONE, instantToLocalDateTime, localDateTimeToInstant } from "@/model/time-zone";
import {
  DEFAULT_TRAINING_PROFILE_ID,
  ENTRY_MODE,
  EXERCISE_ORIGIN,
  MATCH_METHOD,
  MATCH_STATUS,
  MATCH_THRESHOLDS,
  RESISTANCE,
  SESSION_STATUS,
  type ExerciseOrigin,
  type ResistanceType,
} from "./training.constants";
import {
  ActiveSessionExistsError,
  CatalogExerciseNotFoundError,
  ExerciseHasSetsError,
  ProgramArchivedError,
  ProgramNotFoundError,
  ProgramVersionNotFoundError,
  ResistanceChangeBlockedError,
  SessionExerciseNotFoundError,
  SessionNotEditableError,
  SessionNotFoundError,
  SetNotFoundError,
  SetValidationError,
  TrainingError,
  WorkoutAlreadyMatchedError,
  WorkoutNotEligibleError,
  WorkoutNotFoundError,
} from "./training.errors";
import { matchDiaryToWorkouts } from "./training.matcher";
import { planProgramExerciseReconcile } from "./training.program-reconcile";
import { muscleMappingSnapshotJson } from "./exercise-mapping-snapshot";
import {
  TrainingRepository,
  trainingRepository,
  type OrderedProgramExerciseWrite,
} from "./training.repository";
import type {
  BulkCreateFromWorkoutsInput,
  ChangeSessionProgramInput,
  CreateFromWorkoutInput,
  CreateProgramInput,
  CreateSessionExerciseInput,
  CreateSetInput,
  DeleteSessionExerciseInput,
  HistoricalWorkoutsQuery,
  ManualMatchInput,
  ReorderSessionExercisesInput,
  UpdateProgramInput,
  UpdateSessionExerciseInput,
  UpdateSetInput,
} from "./training.schema";
import { validateSetFields } from "./training.set-validation";
import { noteTrainingSourceChange } from "./training.source-revision";
import {
  recordExperimentalStrengthEnergyShadow,
  recordExperimentalStrengthEnergyShadowBySessionId,
} from "./experimental-strength-energy-shadow.service";
import {
  recordExperimentalStrengthGlycogenDemandShadow,
  recordExperimentalStrengthGlycogenDemandShadowBySessionId,
} from "./experimental-strength-glycogen-demand-shadow.service";
import {
  recordExperimentalTransientExerciseWaterShadow,
  recordExperimentalTransientExerciseWaterShadowBySessionId,
} from "./experimental-transient-exercise-water-shadow.service";
import {
  recordExperimentalSkeletalMuscleDeltaShadowForSession,
} from "@/modules/model-episodes/experimental-skeletal-muscle-delta-shadow.service";
import {
  recordExperimentalLocalHypertrophyResponseShadowForSession,
} from "@/modules/model-episodes/experimental-local-hypertrophy-response-shadow.service";
import {
  recordExperimentalCessationDetrainingShadowForSession,
} from "@/modules/model-episodes/experimental-cessation-detraining-shadow.service";
import {
  recordExperimentalFfmRetentionShadowForSession,
} from "@/modules/model-episodes/experimental-ffm-retention-shadow.service";
import type {
  HistoricalStrengthWorkoutDto,
  MatchCandidateDto,
  ProgramVersionSummaryDto,
  StrengthSessionDto,
  StrengthSetDto,
  TrainingProgramDto,
} from "./training.types";

export type BulkCreateFromWorkoutsResult = {
  sessions: StrengthSessionDto[];
  createdSessionIds: number[];
  existingSessionIds: number[];
  rejected: Array<{ workoutId: number; error: string }>;
};

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

async function recordExperimentalStrengthShadows(input: {
  session: StrengthSessionDto;
  profileId: number;
}): Promise<void> {
  await recordExperimentalStrengthEnergyShadow(input);
  await recordExperimentalStrengthGlycogenDemandShadow(input);
  await recordExperimentalTransientExerciseWaterShadow(input);
  await recordExperimentalSkeletalMuscleDeltaShadowForSession({
    sessionId: input.session.id,
    profileId: input.profileId,
  });
  await recordExperimentalCessationDetrainingShadowForSession({
    sessionId: input.session.id,
    profileId: input.profileId,
  });
  await recordExperimentalFfmRetentionShadowForSession({
    sessionId: input.session.id,
    profileId: input.profileId,
  });
  await recordExperimentalLocalHypertrophyResponseShadowForSession({
    sessionId: input.session.id,
    profileId: input.profileId,
  });
}

async function recordExperimentalStrengthShadowsBySessionId(input: {
  sessionId: number;
  profileId: number;
}): Promise<void> {
  await recordExperimentalStrengthEnergyShadowBySessionId(input);
  await recordExperimentalStrengthGlycogenDemandShadowBySessionId(input);
  await recordExperimentalTransientExerciseWaterShadowBySessionId(input);
  await recordExperimentalSkeletalMuscleDeltaShadowForSession(input);
  await recordExperimentalCessationDetrainingShadowForSession(input);
  await recordExperimentalFfmRetentionShadowForSession(input);
  await recordExperimentalLocalHypertrophyResponseShadowForSession(input);
}

function isStrengthWorkout(type: string): boolean {
  return canonicalizeWorkoutType(type).classification === "traditional-strength-training";
}

/** Calendar date of the linked Garmin workout, used only as a rebuild hint. */
function workoutLocalDate(
  startAt: Date | null | undefined,
  timezone = DEFAULT_TIME_ZONE,
): string | null {
  if (!(startAt instanceof Date) || !Number.isFinite(startAt.getTime())) return null;
  return instantToLocalDateTime(startAt, timezone).date;
}

/** Diary sessions remain editable after completion or cancellation; only unknown states are frozen. */
function assertSessionEditable(status: string): void {
  if (
    status !== SESSION_STATUS.ACTIVE
    && status !== SESSION_STATUS.COMPLETED
    && status !== SESSION_STATUS.CANCELLED
  ) {
    throw new SessionNotEditableError();
  }
}

/**
 * Load columns that stop being meaningful under a new resistance type.
 * Never converts weightKg ↔ bandNominalResistanceKg — the values are cleared
 * so the user re-enters them in the correct semantics.
 */
function incompatibleLoadColumns(
  target: ResistanceType,
  sets: ReadonlyArray<{
    weightKg: Prisma.Decimal | null;
    bandNominalResistanceKg: Prisma.Decimal | null;
  }>,
): { clearWeightKg: boolean; clearBandNominalResistanceKg: boolean } {
  const hasWeight = sets.some((set) => set.weightKg != null);
  const hasBand = sets.some((set) => set.bandNominalResistanceKg != null);
  return {
    clearWeightKg: hasWeight && target !== RESISTANCE.EXTERNAL_WEIGHT,
    clearBandNominalResistanceKg: hasBand && target !== RESISTANCE.RESISTANCE_BAND,
  };
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

export class TrainingService {
  constructor(
    private readonly db: PrismaClient = prisma,
    private readonly repo: TrainingRepository = new TrainingRepository(db),
    private readonly recordExperimentalShadow: (input: { session: StrengthSessionDto; profileId: number }) => Promise<void> =
      db === prisma ? recordExperimentalStrengthShadows : async () => {},
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
          muscleMappingSnapshot: muscleMappingSnapshotJson(exercise.exerciseCatalog.stableKey),
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

  listHistoricalStrengthWorkouts(
    query: Partial<HistoricalWorkoutsQuery> = {},
  ): Promise<HistoricalStrengthWorkoutDto[]> {
    return this.repo.listHistoricalStrengthWorkouts({
      limit: query.limit,
      cursor: query.cursor,
      onlyMissingDiary: query.onlyMissingDiary,
    });
  }

  async listProgramVersions(
    programId: number,
    profileId = DEFAULT_TRAINING_PROFILE_ID,
  ): Promise<ProgramVersionSummaryDto[]> {
    const versions = await this.repo.listProgramVersions(programId, profileId);
    if (!versions) throw new ProgramNotFoundError();
    return versions;
  }

  /**
   * Retrospective backfill: create a COMPLETED diary for an existing Garmin
   * strength workout. Deliberately different from the live flow — the workout
   * link is explicit (DIRECT_BACKFILL, no fuzzy matcher), an unrelated ACTIVE
   * live session may coexist, and archived programs stay selectable.
   */
  async createSessionFromWorkout(
    input: CreateFromWorkoutInput,
    profileId = DEFAULT_TRAINING_PROFILE_ID,
  ): Promise<StrengthSessionDto> {
    const { session } = await this.createOrGetSessionFromWorkout(input, profileId);
    return session;
  }

  async bulkCreateSessionsFromWorkouts(
    input: BulkCreateFromWorkoutsInput,
    profileId = DEFAULT_TRAINING_PROFILE_ID,
  ): Promise<BulkCreateFromWorkoutsResult> {
    const result: BulkCreateFromWorkoutsResult = {
      sessions: [],
      createdSessionIds: [],
      existingSessionIds: [],
      rejected: [],
    };

    for (const workoutId of [...new Set(input.workoutIds)]) {
      try {
        const { session, created } = await this.createOrGetSessionFromWorkout(
          {
            workoutId,
            programId: input.programId,
            programVersionId: input.programVersionId,
          },
          profileId,
        );
        result.sessions.push(session);
        if (created) result.createdSessionIds.push(session.id);
        else result.existingSessionIds.push(session.id);
      } catch (error) {
        if (error instanceof TrainingError) {
          result.rejected.push({ workoutId, error: error.code });
          continue;
        }
        throw error;
      }
    }

    return result;
  }

  private async createOrGetSessionFromWorkout(
    input: CreateFromWorkoutInput,
    profileId: number,
  ): Promise<{ session: StrengthSessionDto; created: boolean }> {
    const workout = await this.repo.findWorkoutById(input.workoutId);
    if (!workout) throw new WorkoutNotFoundError();
    if (!isStrengthWorkout(workout.type)) throw new WorkoutNotEligibleError();

    // A workout links to at most one diary session; re-requesting returns it.
    if (workout.matchedDiarySession) {
      const existing = await this.repo.getSession(workout.matchedDiarySession.id, profileId);
      if (!existing) throw new WorkoutAlreadyMatchedError();
      return { session: existing, created: false };
    }

    const program = await this.repo.loadProgramVersion({
      programId: input.programId,
      programVersionId: input.programVersionId ?? null,
      profileId,
    });
    if (!program) throw new ProgramNotFoundError();
    if (!program.version || program.version.exercises.length === 0) {
      throw new ProgramVersionNotFoundError();
    }

    try {
      const created = await this.repo.createRetrospectiveSession({
        profileId,
        programId: program.id,
        programVersionId: program.version.id,
        matchedWorkoutId: workout.id,
        exercises: program.version.exercises.map((exercise) => ({
          sourceExerciseCatalogId: exercise.exerciseCatalog.id,
          snapshotExerciseName: exercise.exerciseCatalog.name,
          sortOrder: exercise.sortOrder,
          plannedSets: exercise.plannedSets,
          resistanceType: exercise.resistanceType as ResistanceType,
          muscleMappingSnapshot: muscleMappingSnapshotJson(exercise.exerciseCatalog.stableKey),
        })),
      });
      noteTrainingSourceChange({
        sessionId: created.id,
        revision: created.revision,
        workoutLocalDate: workoutLocalDate(workout.startAt),
        reason: "retrospective_create",
      });
      return { session: created, created: true };
    } catch (error) {
      if (isUniqueViolation(error)) throw new WorkoutAlreadyMatchedError();
      throw error;
    }
  }

  /**
   * Reassign a historical session to a different program/version.
   * Matching exercises keep their recorded sets; unmatched ones survive as
   * EXTRA. Nothing is ever deleted and the template is not modified.
   */
  async changeSessionProgram(
    sessionId: number,
    input: ChangeSessionProgramInput,
    profileId = DEFAULT_TRAINING_PROFILE_ID,
  ): Promise<StrengthSessionDto> {
    const session = await this.repo.findSessionForEdit(sessionId, profileId);
    if (!session) throw new SessionNotFoundError();
    assertSessionEditable(session.status);

    const program = await this.repo.loadProgramVersion({
      programId: input.programId,
      programVersionId: input.programVersionId ?? null,
      profileId,
    });
    if (!program) throw new ProgramNotFoundError();
    if (!program.version) throw new ProgramVersionNotFoundError();

    if (session.programId === program.id && session.programVersionId === program.version.id) {
      return this.requireSession(sessionId, profileId);
    }

    const plan = planProgramExerciseReconcile(
      session.exercises.map((exercise) => ({
        id: exercise.id,
        sourceExerciseCatalogId: exercise.sourceExerciseCatalogId,
        snapshotExerciseName: exercise.snapshotExerciseName,
        sortOrder: exercise.sortOrder,
        plannedSets: exercise.plannedSets,
        resistanceType: exercise.resistanceType as ResistanceType,
        origin: exercise.origin as ExerciseOrigin,
        setCount: exercise._count.sets,
      })),
      program.version.exercises.map((exercise) => ({
        sourceExerciseCatalogId: exercise.exerciseCatalog.id,
        snapshotExerciseName: exercise.exerciseCatalog.name,
        sortOrder: exercise.sortOrder,
        plannedSets: exercise.plannedSets,
        resistanceType: exercise.resistanceType as ResistanceType,
        muscleMappingSnapshot: muscleMappingSnapshotJson(exercise.exerciseCatalog.stableKey),
      })),
    );

    const revision = await this.repo.changeSessionProgram({
      sessionId,
      fromProgramId: session.programId,
      fromProgramVersionId: session.programVersionId,
      toProgramId: program.id,
      toProgramVersionId: program.version.id,
      plan,
    });

    noteTrainingSourceChange({
      sessionId,
      revision,
      workoutLocalDate: workoutLocalDate(session.matchedWorkout?.startAt),
      reason: "program_change",
    });

    return this.requireSession(sessionId, profileId);
  }

  async addSessionExercise(
    sessionId: number,
    input: CreateSessionExerciseInput,
    profileId = DEFAULT_TRAINING_PROFILE_ID,
  ): Promise<StrengthSessionDto> {
    const session = await this.repo.findSessionForEdit(sessionId, profileId);
    if (!session) throw new SessionNotFoundError();
    assertSessionEditable(session.status);

    const [catalog] = await this.repo.findCatalogByIds([input.catalogId], profileId);
    if (!catalog) throw new CatalogExerciseNotFoundError();

    const { revision } = await this.repo.addSessionExercise({
      sessionId,
      sourceExerciseCatalogId: catalog.id,
      snapshotExerciseName: catalog.name,
      plannedSets: input.plannedSets,
      resistanceType: input.resistanceType,
      origin: EXERCISE_ORIGIN.EXTRA,
      muscleMappingSnapshot: muscleMappingSnapshotJson(catalog.stableKey),
      order: input.order,
      orderedExerciseIds: session.exercises.map((exercise) => exercise.id),
    });

    this.noteExerciseMutation(sessionId, revision, session.matchedWorkout?.startAt);
    return this.requireSession(sessionId, profileId);
  }

  async updateSessionExercise(
    sessionId: number,
    exerciseId: number,
    input: UpdateSessionExerciseInput,
    profileId = DEFAULT_TRAINING_PROFILE_ID,
  ): Promise<StrengthSessionDto> {
    const session = await this.repo.findSessionForEdit(sessionId, profileId);
    if (!session) throw new SessionNotFoundError();
    assertSessionEditable(session.status);

    const exercise = await this.repo.findSessionExerciseDetail(sessionId, exerciseId, profileId);
    if (!exercise) throw new SessionExerciseNotFoundError();

    let clear = { clearWeightKg: false, clearBandNominalResistanceKg: false };
    if (input.resistanceType !== undefined && input.resistanceType !== exercise.resistanceType) {
      clear = incompatibleLoadColumns(input.resistanceType, exercise.sets);
      if (
        (clear.clearWeightKg || clear.clearBandNominalResistanceKg)
        && !input.confirmResistanceChange
      ) {
        throw new ResistanceChangeBlockedError();
      }
    }

    const revision = await this.repo.updateSessionExercise({
      sessionId,
      exerciseId,
      plannedSets: input.plannedSets,
      resistanceType: input.resistanceType,
      clearWeightKg: clear.clearWeightKg,
      clearBandNominalResistanceKg: clear.clearBandNominalResistanceKg,
      order: input.order,
      orderedExerciseIds: session.exercises.map((item) => item.id),
    });

    this.noteExerciseMutation(sessionId, revision, session.matchedWorkout?.startAt);
    return this.requireSession(sessionId, profileId);
  }

  async deleteSessionExercise(
    sessionId: number,
    exerciseId: number,
    input: DeleteSessionExerciseInput = {},
    profileId = DEFAULT_TRAINING_PROFILE_ID,
  ): Promise<StrengthSessionDto> {
    const session = await this.repo.findSessionForEdit(sessionId, profileId);
    if (!session) throw new SessionNotFoundError();
    assertSessionEditable(session.status);

    const exercise = await this.repo.findSessionExerciseDetail(sessionId, exerciseId, profileId);
    if (!exercise) throw new SessionExerciseNotFoundError();
    // Recorded sets are user-entered history: never drop them without consent.
    if (exercise.sets.length > 0 && !input.confirm) throw new ExerciseHasSetsError();

    const revision = await this.repo.deleteSessionExercise({
      sessionId,
      exerciseId,
      orderedExerciseIds: session.exercises.map((item) => item.id),
    });

    this.noteExerciseMutation(sessionId, revision, session.matchedWorkout?.startAt);
    return this.requireSession(sessionId, profileId);
  }

  async reorderSessionExercises(
    sessionId: number,
    input: ReorderSessionExercisesInput,
    profileId = DEFAULT_TRAINING_PROFILE_ID,
  ): Promise<StrengthSessionDto> {
    const session = await this.repo.findSessionForEdit(sessionId, profileId);
    if (!session) throw new SessionNotFoundError();
    assertSessionEditable(session.status);

    const existing = session.exercises.map((exercise) => exercise.id);
    const requested = input.exerciseIds;
    const isCompletePermutation =
      requested.length === existing.length
      && new Set(requested).size === requested.length
      && requested.every((id) => existing.includes(id));
    if (!isCompletePermutation) throw new SessionExerciseNotFoundError();

    const revision = await this.repo.reorderSessionExercises({
      sessionId,
      orderedExerciseIds: requested,
    });

    this.noteExerciseMutation(sessionId, revision, session.matchedWorkout?.startAt);
    return this.requireSession(sessionId, profileId);
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
      && exercise.session.status !== SESSION_STATUS.CANCELLED
    ) {
      throw new SessionNotFoundError();
    }

    const validated = validateSetFields(exercise.resistanceType as ResistanceType, {
      reps: input.reps,
      weightKg: input.weightKg ?? null,
      bandNominalResistanceKg: input.bandNominalResistanceKg ?? null,
      rir: input.rir === undefined ? null : input.rir,
    });
    if (!validated.ok) throw new SetValidationError(validated.message);

    const nextSetNumber =
      input.setNumber
      ?? ((exercise.sets[0]?.setNumber ?? 0) + 1);

    try {
      const created = await this.repo.createSet({
        sessionExerciseId: exercise.id,
        setNumber: nextSetNumber,
        reps: validated.reps,
        weightKg: validated.weightKg,
        bandNominalResistanceKg: validated.bandNominalResistanceKg,
        rir: validated.rir,
        comment: input.comment === undefined ? undefined : input.comment,
        completedAt: input.completedAt ? new Date(input.completedAt) : new Date(),
      });
      await this.noteSetMutation(exercise.session);
      return created;
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
      && existing.sessionExercise.session.status !== SESSION_STATUS.CANCELLED
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
    const nextRir = input.rir !== undefined ? input.rir : existing.rir;

    const validated = validateSetFields(
      existing.sessionExercise.resistanceType as ResistanceType,
      {
        reps: nextReps,
        weightKg: nextWeight,
        bandNominalResistanceKg: nextBand,
        rir: nextRir,
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
      rir: validated.rir,
      comment: input.comment,
      completedAt:
        input.completedAt === undefined
          ? undefined
          : input.completedAt === null
            ? null
            : new Date(input.completedAt),
    });
    if (!updated) throw new SetNotFoundError();
    await this.noteSetMutation(existing.sessionExercise.session);
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
      && existing.sessionExercise.session.status !== SESSION_STATUS.CANCELLED
    ) {
      throw new SessionNotFoundError();
    }
    await this.repo.deleteSet(setId, sessionId, profileId);
    await this.noteSetMutation(existing.sessionExercise.session);
  }

  async getExerciseHistory(
    sessionId: number,
    exerciseId: number,
    profileId = DEFAULT_TRAINING_PROFILE_ID,
  ) {
    const exercise = await this.repo.findSessionExercise(sessionId, exerciseId, profileId);
    if (!exercise) throw new SessionExerciseNotFoundError();
    return this.repo.listExerciseHistory({
      profileId,
      excludeSessionId: sessionId,
      catalogId: exercise.sourceExerciseCatalogId,
      snapshotExerciseName: exercise.snapshotExerciseName,
    });
  }

  async finishSession(
    sessionId: number,
    profileId = DEFAULT_TRAINING_PROFILE_ID,
  ): Promise<StrengthSessionDto> {
    const session = await this.repo.getSession(sessionId, profileId);
    if (!session) throw new SessionNotFoundError();

    if (session.status === SESSION_STATUS.COMPLETED) {
      // Idempotent finish: re-run matcher only while still PENDING/AUTO-eligible.
      // Retrospective sessions are already linked and never re-matched.
      if (
        session.matchStatus === MATCH_STATUS.PENDING
        && session.matchMethod !== MATCH_METHOD.MANUAL
        && session.entryMode !== ENTRY_MODE.RETROSPECTIVE
      ) {
        await this.tryAutoMatchSession(sessionId, profileId);
      }
      const refreshed = await this.repo.getSession(sessionId, profileId);
      if (!refreshed) throw new SessionNotFoundError();
      // Keep the shadow dependency chain ordered; its failure remains isolated
      // from the completed-session result.
      await this.recordExperimentalShadow({ session: refreshed, profileId }).catch(() => {});
      return refreshed;
    }

    if (session.status !== SESSION_STATUS.ACTIVE) {
      throw new SessionNotFoundError();
    }

    await this.repo.markSessionCompleted(sessionId, new Date());
    await this.tryAutoMatchSession(sessionId, profileId);
    const refreshed = await this.repo.getSession(sessionId, profileId);
    if (!refreshed) throw new SessionNotFoundError();
    await this.recordExperimentalShadow({ session: refreshed, profileId }).catch(() => {});
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

  /**
   * Delete a completed/cancelled diary entry. Garmin Workout rows are never
   * deleted — the user can recreate a retrospective link later.
   */
  async deleteDiarySession(
    sessionId: number,
    profileId = DEFAULT_TRAINING_PROFILE_ID,
  ): Promise<{ matchedWorkoutId: number | null }> {
    const session = await this.repo.getSession(sessionId, profileId);
    if (!session) throw new SessionNotFoundError();
    if (session.status === SESSION_STATUS.ACTIVE) {
      throw new SessionNotEditableError();
    }
    const matchedWorkoutId = session.matchedWorkoutId;
    await this.repo.deleteDiarySession(sessionId, profileId);
    return { matchedWorkoutId };
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
    // Retrospective sessions have no live interval to search around; their
    // workout link is chosen explicitly, so there are no fuzzy candidates.
    if (session.webStartedAt === null) return [];
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
      )
      .filter((candidate) => candidate.id !== session.matchedWorkoutId)
      .filter((candidate) => !candidate.alreadyMatched);
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
    // A manual link can add Garmin diagnostic context after completion.
    await this.recordExperimentalShadow({ session: refreshed, profileId }).catch(() => {});
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
      if (session.matchMethod === MATCH_METHOD.DIRECT_BACKFILL) continue;
      if (session.entryMode === ENTRY_MODE.RETROSPECTIVE) continue;
      if (session.webStartedAt === null) continue;
      await this.tryAutoMatchSession(session.id, profileId);
      if (this.db === prisma) {
        // A delayed sync may add Garmin diagnostic context after finishSession.
        await recordExperimentalStrengthShadowsBySessionId({ sessionId: session.id, profileId }).catch(() => {});
      }
    }
  }

  private async tryAutoMatchSession(
    sessionId: number,
    profileId = DEFAULT_TRAINING_PROFILE_ID,
  ): Promise<void> {
    const session = await this.repo.getSession(sessionId, profileId);
    if (!session) return;
    if (session.status !== SESSION_STATUS.COMPLETED) return;
    if (session.entryMode === ENTRY_MODE.RETROSPECTIVE) return;
    if (session.matchMethod === MATCH_METHOD.MANUAL) return;
    if (session.matchMethod === MATCH_METHOD.DIRECT_BACKFILL) return;
    if (session.webStartedAt === null) return;
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

  private async requireSession(
    sessionId: number,
    profileId: number,
  ): Promise<StrengthSessionDto> {
    const session = await this.repo.getSession(sessionId, profileId);
    if (!session) throw new SessionNotFoundError();
    return session;
  }

  private noteExerciseMutation(
    sessionId: number,
    revision: number,
    workoutStartAt: Date | null | undefined,
  ): void {
    noteTrainingSourceChange({
      sessionId,
      revision,
      workoutLocalDate: workoutLocalDate(workoutStartAt),
      reason: "exercise_mutation",
    });
  }

  /**
   * Editing sets on a terminal diary session rewrites history, so bump the
   * durable revision for future rebuild fingerprints. Live ACTIVE logging does not.
   */
  private async noteSetMutation(session: {
    id: number;
    status: string;
    matchedWorkout?: { startAt: Date } | null;
  }): Promise<void> {
    if (
      session.status !== SESSION_STATUS.COMPLETED
      && session.status !== SESSION_STATUS.CANCELLED
    ) return;
    const revision = await this.repo.incrementSessionRevision(session.id);
    noteTrainingSourceChange({
      sessionId: session.id,
      revision,
      workoutLocalDate: workoutLocalDate(session.matchedWorkout?.startAt),
      reason: "set_mutation",
    });
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
