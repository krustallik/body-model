import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { canonicalizeWorkoutType } from "@/model/activity/workout-energy";
import { DEFAULT_TIME_ZONE, instantToLocalDateTime, isValidTimeZone, localDateTimeToInstant } from "@/model/time-zone";
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
  StaleStrengthEnergySourceError,
  TrainingError,
  WorkoutAlreadyMatchedError,
  WorkoutNotEligibleError,
  WorkoutNotFoundError,
} from "./training.errors";
import { matchDiaryToWorkouts } from "./training.matcher";
import { planProgramExerciseReconcile } from "./training.program-reconcile";
import { trainingExerciseMappingSnapshotJsonV1 } from "./exercise-mapping-snapshot";
import {
  TrainingRepository,
  StaleAccountingCandidateError,
  trainingChildDeletionPublicationSourceKey,
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
  UpdateCatalogLoadAccountingConfigInput,
} from "./training.schema";
import { validateSetFields } from "./training.set-validation";
import {
  LEGACY_LOAD_INTERPRETATION_V1,
  legacyLoadConfigForIdentityV1,
  loadConfigV1Schema,
  setExecutionOverrideV1Schema,
  type LoadConfigV1,
} from "./load-accounting-v1";
import { noteTrainingSourceChange } from "./training.source-revision";
import { episodeTimeContextForInstantV1 } from "@/modules/model-episodes/episode-time-context-v1";
import {
  listExperimentalStrengthEnergySessionsForWeightDate,
  recordExperimentalStrengthEnergyShadow,
  recordExperimentalStrengthEnergyShadowBySessionId,
} from "./experimental-strength-energy-shadow.service";
import {
  recordExperimentalStrengthGlycogenDemandShadow,
  recordExperimentalStrengthGlycogenDemandShadowBySessionId,
} from "./experimental-strength-glycogen-demand-shadow.service";
import { recordExperimentalGlycogenStateShadow } from "@/modules/model-episodes/experimental-glycogen-state-shadow.service";
import {
  recordExperimentalLocalHypertrophyResponseShadowForSession,
} from "@/modules/model-episodes/experimental-local-hypertrophy-response-shadow.service";
import { rebuildAuthoritativeRelativeMuscleTrajectory } from "@/modules/model-episodes/experimental-cessation-detraining-shadow.service";
import { PhysiologyV7PersistenceRepository } from "@/modules/model-episodes/physiology-v7-persistence.repository";
import {
  recordExperimentalFfmRetentionShadowForSession,
} from "@/modules/model-episodes/experimental-ffm-retention-shadow.service";
import {
  invalidateUnifiedRelativeMuscleSuffixV1,
  rebuildUnifiedExperimentalPhysiologyStateV1,
} from "@/modules/model-episodes/unified-experimental-physiology-state.service";
import { recalculateActiveEnergyChangesV1, type ActiveEnergyPublicationStatusV1 } from "@/modules/activity/active-energy-publication";
import { isUnifiedGenerationCurrentV1 } from "@/modules/model-episodes/publication-generation-v1";
import { errorDiagnosticFields, logEvent } from "@/lib/logger";
import { strengthSessionSourceFingerprintV1 } from "./strength-publication-v1";
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

type TrainingShadowRefreshResultV1 = {
  blockRevision: number | null;
  blockFromDate: string | null;
  modelDate: string | undefined;
};

type TrainingPublicationBlockTokenV1 = { sourceKey: string; token: { revision: number; fromDate: string } };

class TrainingPublicationStageError extends Error {
  constructor(readonly stage: string, readonly originalError: unknown) {
    super("Training dependency refresh failed");
    this.name = "TrainingPublicationStageError";
    if (originalError instanceof Error) {
      const code = (originalError as Error & { code?: unknown }).code;
      if (typeof code === "string") (this as Error & { code?: string }).code = code;
      this.stack = originalError.stack;
    }
  }
}

async function withTrainingPublicationStage<T>(stage: string, action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof TrainingPublicationStageError || error instanceof StaleStrengthEnergySourceError) throw error;
    throw new TrainingPublicationStageError(stage, error);
  }
}

function trainingPublicationDiagnosticFields(error: unknown) {
  if (error instanceof TrainingPublicationStageError) {
    return { ...errorDiagnosticFields(error.originalError), stage: error.stage };
  }
  return errorDiagnosticFields(error);
}

function sameTrainingPublicationBlockToken(
  left: { revision: number; fromDate: string } | null,
  right: { revision: number; fromDate: string } | null,
): boolean {
  return left === null ? right === null
    : right !== null && left.revision === right.revision && left.fromDate === right.fromDate;
}

async function captureTrainingPublicationBlocksAfterMaterialization(input: {
  profileId: number;
  session: StrengthSessionDto;
  sourceKeys: readonly string[];
  initialTokens: readonly TrainingPublicationBlockTokenV1[];
  refreshedFromDate: string;
}): Promise<TrainingPublicationBlockTokenV1[]> {
  const initialByKey = new Map(input.initialTokens.map((entry) => [entry.sourceKey, entry.token]));
  const sessionSourceKey = String(input.session.id);
  return prisma.$transaction(async (tx) => {
    const lifecycle = new PhysiologyV7PersistenceRepository(tx);
    await lifecycle.lockProfile(input.profileId);
    const currentSession = await new TrainingRepository().getSession(input.session.id, input.profileId);
    if (currentSession === null
        || strengthSessionSourceFingerprintV1(currentSession) !== strengthSessionSourceFingerprintV1(input.session)) {
      throw new StaleStrengthEnergySourceError();
    }
    const currentEntries = await Promise.all(input.sourceKeys.map(async (sourceKey) => ({
      sourceKey,
      token: await lifecycle.readUnifiedPublicationBlockToken({
        profileId: input.profileId, source: "training", sourceKey,
      }),
    })));
    const captured: TrainingPublicationBlockTokenV1[] = [];
    for (const { sourceKey, token } of currentEntries) {
      const initial = initialByKey.get(sourceKey) ?? null;
      if (sourceKey !== sessionSourceKey && !sameTrainingPublicationBlockToken(initial, token)) {
        throw new Error("training child source changed during dependent-shadow refresh; Unified remains blocked");
      }
      // Strength shadow publication can legitimately advance this session's
      // own retry fence. It is safe to adopt only after the locked raw-session
      // snapshot above proves that the candidate still describes live inputs.
      if (token === null) continue;
      if (token.fromDate < input.refreshedFromDate) {
        throw new Error("training publication retry fence moved earlier than the refreshed dependency range");
      }
      captured.push({ sourceKey, token });
    }
    return captured;
  });
}

async function recordExperimentalStrengthShadows(input: {
  session: StrengthSessionDto;
  profileId: number;
  deferUnifiedPublication?: boolean;
  publicationBlockSourceKeys?: readonly string[];
}): Promise<TrainingShadowRefreshResultV1> {
  const lifecycle = new PhysiologyV7PersistenceRepository();
  const publicationBlockSourceKeys = [...new Set([
    String(input.session.id),
    ...(input.publicationBlockSourceKeys ?? []),
  ])];
  const blockTokens = (await withTrainingPublicationStage("read-training-publication-fences", () => Promise.all(
    publicationBlockSourceKeys.map(async (sourceKey) => ({
      sourceKey,
      token: await lifecycle.readUnifiedPublicationBlockToken({
        profileId: input.profileId, source: "training", sourceKey,
      }),
    })),
  ))).filter((entry): entry is { sourceKey: string; token: { revision: number; fromDate: string } } => entry.token !== null);
  let blockToken = blockTokens.find(({ sourceKey }) => sourceKey === String(input.session.id))?.token ?? null;
  const currentSession = await withTrainingPublicationStage("load-completed-training-session", () =>
    new TrainingRepository(prisma).getSession(input.session.id, input.profileId));
  if (currentSession === null) throw new Error("training source disappeared before dependent-shadow refresh");
  const currentInput = { session: currentSession, profileId: input.profileId };
  const relativeMuscleEventAt = currentSession.matchedWorkout?.startAt
    ?? currentSession.effectiveAccountingAt
    ?? currentSession.webStartedAt
    ?? currentSession.createdAt;
  const sourceDate = await withTrainingPublicationStage("resolve-training-model-date", () =>
    trainingModelDate(input.profileId, relativeMuscleEventAt));
  const refreshFromDate = blockTokens.reduce(
    (earliest, { token }) => token.fromDate < earliest ? token.fromDate : earliest,
    sourceDate,
  );
  await withTrainingPublicationStage("strength-active-energy-shadow", () => recordExperimentalStrengthEnergyShadow(currentInput));
  // Keep production current before rebuilding dependent shadows, but defer
  // Unified publication until this full shadow chain has completed.
  const production = await withTrainingPublicationStage("production-active-energy-recalculation", () =>
    recalculateActiveEnergyChangesV1());
  if (production === null) {
    throw new Error("production model is unavailable after completed training source update");
  }
  const clearBlockTokens = await withTrainingPublicationStage("capture-training-publication-fences", () =>
    captureTrainingPublicationBlocksAfterMaterialization({
      profileId: input.profileId,
      session: currentSession,
      sourceKeys: publicationBlockSourceKeys,
      initialTokens: blockTokens,
      refreshedFromDate: refreshFromDate,
    }));
  blockToken = clearBlockTokens.find(({ sourceKey }) => sourceKey === String(input.session.id))?.token ?? null;
  await withTrainingPublicationStage("strength-glycogen-demand-shadow", () =>
    recordExperimentalStrengthGlycogenDemandShadow(currentInput));
  // State is replayed from the edited session's calendar date through the
  // durable suffix, so a historical diary/workout correction cannot leave
  // dependent glycogen rows current-looking but stale.
  await withTrainingPublicationStage("glycogen-state-shadow-rebuild", () =>
    recordExperimentalGlycogenStateShadow({ date: refreshFromDate, profileId: input.profileId }));
  let relativeMuscleModelDate: string | undefined;
  if (relativeMuscleEventAt) {
    const fromInstant = refreshFromDate === sourceDate
      ? new Date(relativeMuscleEventAt)
      : await trainingModelDateStartInstant(input.profileId, refreshFromDate);
    const dirty = await withTrainingPublicationStage("relative-muscle-invalidation", () =>
      invalidateUnifiedRelativeMuscleSuffixV1({ profileId: input.profileId, fromInstant }));
    relativeMuscleModelDate = dirty?.modelDate;
    await withTrainingPublicationStage("relative-muscle-suffix-rebuild", () =>
      rebuildAuthoritativeRelativeMuscleTrajectory({ fromInstant, profileId: input.profileId }));
  }
  await withTrainingPublicationStage("ffm-retention-shadow", () =>
    recordExperimentalFfmRetentionShadowForSession({ sessionId: currentSession.id, profileId: input.profileId }));
  await withTrainingPublicationStage("local-hypertrophy-shadow", () =>
    recordExperimentalLocalHypertrophyResponseShadowForSession({ sessionId: currentSession.id, profileId: input.profileId }));
  if (!input.deferUnifiedPublication) {
    for (const { sourceKey, token } of clearBlockTokens) {
      if (!await withTrainingPublicationStage("clear-training-publication-fence", () => lifecycle.clearUnifiedPublicationBlock({
        profileId: input.profileId,
        source: "training",
        sourceKey,
        expectedRevision: token.revision,
        expectedFromDate: token.fromDate,
      }))) {
        throw new Error("training source changed during dependent-shadow refresh; Unified remains blocked");
      }
    }
    if (!await withTrainingPublicationStage("check-remaining-publication-fences", () =>
      deferTrainingPublicationIfAnotherSourceIsBlocked(lifecycle, input.profileId, clearBlockTokens))) {
      try {
        await withTrainingPublicationStage("unified-state-publication", () =>
          rebuildUnifiedExperimentalPhysiologyStateV1({ profileId: input.profileId, fromDate: relativeMuscleModelDate }));
      } catch (error) {
        await restoreTrainingPublicationFencesWhenUnblocked(lifecycle, input.profileId, clearBlockTokens);
        throw error;
      }
    }
  }
  return {
    blockRevision: blockToken?.revision ?? null,
    blockFromDate: blockToken?.fromDate ?? null,
    modelDate: relativeMuscleModelDate,
  };
}

async function recordExperimentalStrengthShadowsBySessionId(input: {
  sessionId: number;
  profileId: number;
  refreshAccounting?: boolean;
  skipAccountingMaterialization?: boolean;
  deferUnifiedPublication?: boolean;
  clearTrainingFenceAfterDependencyRefresh?: boolean;
  deferProductionRefresh?: boolean;
  expectedTrainingFence?: { revision: number; fromDate: string };
}): Promise<TrainingShadowRefreshResultV1> {
  const lifecycle = new PhysiologyV7PersistenceRepository();
  const refresh = await withTrainingPublicationStage("strength-active-energy-shadow", () =>
    recordExperimentalStrengthEnergyShadowBySessionId({
      sessionId: input.sessionId,
      profileId: input.profileId,
      ...(input.refreshAccounting === undefined ? {} : { refreshAccounting: input.refreshAccounting }),
      ...(input.skipAccountingMaterialization === undefined ? {} : { skipAccountingMaterialization: input.skipAccountingMaterialization }),
    }));
  const session = refresh.session;
  if (session === null) throw new Error("training source disappeared before dependent-shadow refresh");
  const initialBlockToken = refresh.publicationBlockToken;
  const production = input.deferProductionRefresh
    ? null
    : await withTrainingPublicationStage("production-active-energy-recalculation", () =>
      recalculateActiveEnergyChangesV1({
        ...(input.skipAccountingMaterialization ? { skipTrainingAccountingMaterialization: true } : {}),
      }));
  if (production === null && !input.deferProductionRefresh) {
    throw new Error("production model is unavailable after completed training source update");
  }
  const relativeMuscleEventAt = session.matchedWorkout?.startAt
    ?? session.effectiveAccountingAt
    ?? session.webStartedAt
    ?? session.createdAt;
  const sourceDate = await withTrainingPublicationStage("resolve-training-model-date", () =>
    trainingModelDate(input.profileId, relativeMuscleEventAt));
  const refreshFromDate = initialBlockToken !== null && initialBlockToken.fromDate < sourceDate
    ? initialBlockToken.fromDate
    : sourceDate;
  const clearBlockTokens = await withTrainingPublicationStage("capture-training-publication-fences", () =>
    captureTrainingPublicationBlocksAfterMaterialization({
      profileId: input.profileId,
      session,
      sourceKeys: [String(input.sessionId)],
      initialTokens: initialBlockToken === null ? [] : [{ sourceKey: String(input.sessionId), token: initialBlockToken }],
      refreshedFromDate: refreshFromDate,
    }));
  const currentBlockToken = clearBlockTokens[0]?.token ?? null;
  if (input.expectedTrainingFence !== undefined
      && (currentBlockToken === null
        || currentBlockToken.revision !== input.expectedTrainingFence.revision
        || currentBlockToken.fromDate !== input.expectedTrainingFence.fromDate)) {
    throw new StaleStrengthEnergySourceError();
  }
  await withTrainingPublicationStage("strength-glycogen-demand-shadow", () =>
    recordExperimentalStrengthGlycogenDemandShadowBySessionId(input));
  if (currentBlockToken !== null && currentBlockToken.fromDate < refreshFromDate) {
    throw new Error("training publication retry fence moved earlier than the refreshed dependency range");
  }
  await withTrainingPublicationStage("glycogen-state-shadow-rebuild", () =>
    recordExperimentalGlycogenStateShadow({ date: refreshFromDate, profileId: input.profileId }));
  let relativeMuscleModelDate: string | undefined;
  if (relativeMuscleEventAt) {
    const fromInstant = refreshFromDate === sourceDate
      ? new Date(relativeMuscleEventAt)
      : await trainingModelDateStartInstant(input.profileId, refreshFromDate);
    const dirty = await withTrainingPublicationStage("relative-muscle-invalidation", () =>
      invalidateUnifiedRelativeMuscleSuffixV1({ profileId: input.profileId, fromInstant }));
    relativeMuscleModelDate = dirty?.modelDate;
    await withTrainingPublicationStage("relative-muscle-suffix-rebuild", () =>
      rebuildAuthoritativeRelativeMuscleTrajectory({ fromInstant, profileId: input.profileId }));
  }
  await withTrainingPublicationStage("ffm-retention-shadow", () => recordExperimentalFfmRetentionShadowForSession(input));
  await withTrainingPublicationStage("local-hypertrophy-shadow", () =>
    recordExperimentalLocalHypertrophyResponseShadowForSession(input));
  // Event-relocation callers defer clearing until their additional old-date
  // relative-muscle refresh is complete. Weight-date callers have no such
  // outer dependency phase, so they explicitly clear after this full refresh
  // while the day/Health fence still protects shared publication.
  const clearTrainingFence = input.deferUnifiedPublication !== true
    || input.clearTrainingFenceAfterDependencyRefresh === true;
  if (clearTrainingFence && currentBlockToken !== null && !await withTrainingPublicationStage(
    "clear-training-publication-fence",
    () => lifecycle.clearUnifiedPublicationBlock({
      profileId: input.profileId,
      source: "training",
      sourceKey: String(input.sessionId),
      expectedRevision: currentBlockToken.revision,
      expectedFromDate: currentBlockToken.fromDate,
    }))) throw new StaleStrengthEnergySourceError();
  if (!input.deferUnifiedPublication) {
    const clearedFences = currentBlockToken === null
      ? []
      : [{ sourceKey: String(input.sessionId), token: currentBlockToken }];
    if (await withTrainingPublicationStage("check-remaining-publication-fences", () =>
      deferTrainingPublicationIfAnotherSourceIsBlocked(lifecycle, input.profileId, clearedFences))) {
      return {
        blockRevision: currentBlockToken?.revision ?? null,
        blockFromDate: currentBlockToken?.fromDate ?? null,
        modelDate: relativeMuscleModelDate,
      };
    }
    try {
      await withTrainingPublicationStage("unified-state-publication", () =>
        rebuildUnifiedExperimentalPhysiologyStateV1({ profileId: input.profileId, fromDate: relativeMuscleModelDate }));
    } catch (error) {
      await restoreTrainingPublicationFencesWhenUnblocked(lifecycle, input.profileId, clearedFences);
      throw error;
    }
  }
  return {
    blockRevision: currentBlockToken?.revision ?? null,
    blockFromDate: currentBlockToken?.fromDate ?? null,
    modelDate: relativeMuscleModelDate,
  };
}

/** Validate a persisted Training source before derived-only V4 recovery. */
export async function assertPersistedTrainingSessionRecoveryReadyV1(input: {
  sessionId: number;
  profileId: number;
}): Promise<void> {
  if (!Number.isSafeInteger(input.sessionId) || input.sessionId <= 0) {
    throw new Error("Training recovery session identity must be a positive integer");
  }
  const session = await new TrainingRepository(prisma).getSession(input.sessionId, input.profileId);
  if (session === null) throw new Error("Training publication fence has no persisted session for this profile");
  const persistedIdentity = await prisma.strengthDiarySession.findUnique({
    where: { id: input.sessionId },
    select: { profileId: true, entryMode: true },
  });
  if (persistedIdentity === null || persistedIdentity.profileId !== input.profileId
      || (persistedIdentity.entryMode !== ENTRY_MODE.LIVE
        && persistedIdentity.entryMode !== ENTRY_MODE.RETROSPECTIVE)
      || session.entryMode !== persistedIdentity.entryMode) {
    throw new Error("Training recovery found an unsupported persisted entry mode or source identity");
  }
  if (session.status !== SESSION_STATUS.COMPLETED) {
    throw new Error("Training recovery supports only completed persisted sessions");
  }
  if (session.materializationState !== "current") {
    throw new Error("Training recovery requires the current persisted accounting snapshot");
  }
  if (session.entryMode !== ENTRY_MODE.LIVE && session.entryMode !== ENTRY_MODE.RETROSPECTIVE) {
    throw new Error("Training recovery found an unsupported persisted entry mode");
  }
  const matched = session.matchStatus === MATCH_STATUS.MATCHED;
  const noMatch = session.matchStatus === MATCH_STATUS.PENDING
    || session.matchStatus === MATCH_STATUS.UNMATCHED
    || session.matchStatus === MATCH_STATUS.AMBIGUOUS;
  if (matched) {
    const persistedWorkout = session.matchedWorkoutId === null ? null : await prisma.workout.findUnique({
      where: { id: session.matchedWorkoutId },
      select: { id: true, type: true, sourceIdentity: true, dailyHealthData: { select: { date: true } } },
    });
    if (!Number.isSafeInteger(session.matchedWorkoutId) || session.matchedWorkoutId === null
        || session.matchedWorkout?.id !== session.matchedWorkoutId || persistedWorkout === null) {
      throw new Error("Matched Training recovery source has no correctly linked persisted Workout");
    }
    if (persistedWorkout.id !== session.matchedWorkoutId
        || canonicalizeWorkoutType(persistedWorkout.type).classification !== "traditional-strength-training"
        || persistedWorkout.sourceIdentity.length === 0
        || persistedWorkout.dailyHealthData?.date === undefined) {
      throw new Error("Matched Training recovery source has no correctly linked persisted Workout");
    }
  } else if (!noMatch || session.matchedWorkoutId !== null || session.matchedWorkout !== null
      || (session.entryMode === ENTRY_MODE.RETROSPECTIVE
        && session.matchStatus !== MATCH_STATUS.UNMATCHED)) {
    throw new Error("Unmatched Training recovery source has an unsupported status or linked Workout");
  }
}

/**
 * Retry the derived dependency chain for an already persisted completed
 * session. This deliberately does not mutate the session, workout, or sets;
 * the source block is cleared by the existing shadow refresh only after every
 * dependent shadow has been rebuilt successfully.
 */
export async function refreshPersistedTrainingSessionDependenciesV1(input: {
  sessionId: number;
  profileId?: number;
  expectedTrainingFence: { revision: number; fromDate: string };
}): Promise<void> {
  if (!Number.isSafeInteger(input.sessionId) || input.sessionId <= 0) {
    throw new Error("sessionId must be a positive integer");
  }
  const profileId = input.profileId ?? DEFAULT_TRAINING_PROFILE_ID;
  await assertPersistedTrainingSessionRecoveryReadyV1({ sessionId: input.sessionId, profileId });
  await recordExperimentalStrengthShadowsBySessionId({
    sessionId: input.sessionId,
    profileId,
    skipAccountingMaterialization: true,
    deferUnifiedPublication: true,
    clearTrainingFenceAfterDependencyRefresh: false,
    deferProductionRefresh: true,
    expectedTrainingFence: input.expectedTrainingFence,
  });
}

/** Refreshes each affected strength session through the full dependency/fence lifecycle after a weight-source edit. */
export async function recordExperimentalStrengthShadowsForWeightDate(input: {
  date: string;
  profileId?: number;
  refreshHistoricalAsOfFallback?: boolean;
  /** Recovery refreshes dependent shadows without owning any Training fence. */
  clearTrainingFenceAfterDependencyRefresh?: boolean;
  /** Recovery consumes persisted accounting snapshots without writing source accounting fields. */
  skipAccountingMaterialization?: boolean;
  deferProductionRefresh?: boolean;
}): Promise<void> {
  const profileId = input.profileId ?? DEFAULT_TRAINING_PROFILE_ID;
  const sessionIds = await listExperimentalStrengthEnergySessionsForWeightDate({
    date: input.date,
    profileId,
    ...(input.refreshHistoricalAsOfFallback === undefined
      ? {} : { refreshHistoricalAsOfFallback: input.refreshHistoricalAsOfFallback }),
  });
  for (const sessionId of sessionIds) {
    await recordExperimentalStrengthShadowsBySessionId({
      sessionId,
      profileId,
      ...(input.refreshHistoricalAsOfFallback === undefined
        ? {} : { refreshAccounting: input.refreshHistoricalAsOfFallback }),
      ...(input.skipAccountingMaterialization === undefined
        ? {} : { skipAccountingMaterialization: input.skipAccountingMaterialization }),
      ...(input.deferProductionRefresh === undefined
        ? {} : { deferProductionRefresh: input.deferProductionRefresh }),
      deferUnifiedPublication: true,
      clearTrainingFenceAfterDependencyRefresh: input.clearTrainingFenceAfterDependencyRefresh !== false,
    });
  }
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
    loadAccountingConfigSnapshot: null,
  }));
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function logPhysiologyPublicationFailure(operation: string, error: unknown): void {
  logEvent("warn", "training_unified_republication_failed", {
    operation,
    ...trainingPublicationDiagnosticFields(error),
  });
}

type ClearedTrainingPublicationFenceV1 = {
  sourceKey: string;
  token: { revision: number; fromDate: string };
};

async function restoreTrainingPublicationFencesWhenUnblocked(
  lifecycle: PhysiologyV7PersistenceRepository,
  profileId: number,
  fences: readonly ClearedTrainingPublicationFenceV1[],
): Promise<void> {
  if (fences.length === 0) return;
  let anotherBlockRemains = false;
  try {
    anotherBlockRemains = await lifecycle.hasUnifiedPublicationBlocks(profileId);
  } catch {
    // If the shared block read fails, restore this source's retry handle.
  }
  if (anotherBlockRemains) return;
  for (const { sourceKey, token } of fences) {
    await lifecycle.blockUnifiedPublication({
      profileId,
      source: "training",
      sourceKey,
      fromDate: token.fromDate,
    });
  }
}

async function deferTrainingPublicationIfAnotherSourceIsBlocked(
  lifecycle: PhysiologyV7PersistenceRepository,
  profileId: number,
  clearedFences: readonly ClearedTrainingPublicationFenceV1[],
): Promise<boolean> {
  try {
    return await lifecycle.hasUnifiedPublicationBlocks(profileId);
  } catch (error) {
    try {
      await restoreTrainingPublicationFencesWhenUnblocked(lifecycle, profileId, clearedFences);
    } catch (restoreError) {
      throw new AggregateError(
        [error, restoreError],
        "Could not inspect shared Unified fences or restore the training retry fence.",
      );
    }
    throw error;
  }
}

async function trainingModelDate(profileId: number, eventAt: string): Promise<string> {
  const instant = new Date(eventAt);
  if (!Number.isFinite(instant.getTime())) throw new Error("training event instant is invalid");
  const episodes = await prisma.modelEpisode.findMany({
    where: { profileId },
    orderBy: [{ startDate: "asc" }, { id: "asc" }],
    select: { id: true, startDate: true, timezone: true, active: true },
  });
  return episodeTimeContextForInstantV1(episodes, instant).date;
}

async function trainingModelDateStartInstant(profileId: number, modelDate: string): Promise<Date> {
  const episodes = await prisma.modelEpisode.findMany({
    where: { profileId },
    orderBy: [{ startDate: "asc" }, { id: "asc" }],
    select: { startDate: true, timezone: true },
  });
  const episode = [...episodes].reverse().find((candidate) => candidate.startDate <= modelDate);
  return localDateTimeToInstant(modelDate, "00:00", episode?.timezone ?? DEFAULT_TIME_ZONE);
}

function persistedJson(config: LoadConfigV1 | null): Prisma.InputJsonValue | null {
  return config === null ? null : JSON.parse(JSON.stringify(config)) as Prisma.InputJsonValue;
}

function legacyConfigForStableKey(stableKey: string | null): LoadConfigV1 | null {
  if (!stableKey) return null;
  const resolved = legacyLoadConfigForIdentityV1({ status: "known-legacy", stableKey });
  return resolved.config ?? null;
}

function validatedProgramSnapshot(value: unknown, stableKey: string | null): LoadConfigV1 | null {
  if (value === null || value === undefined) return legacyConfigForStableKey(stableKey);
  const parsed = loadConfigV1Schema.safeParse(value);
  if (!parsed.success) throw new SetValidationError("stored program load accounting snapshot is invalid");
  return parsed.data;
}

export class TrainingService {
  constructor(
    private readonly db: PrismaClient = prisma,
    private readonly repo: TrainingRepository = new TrainingRepository(db),
  private readonly recordExperimentalShadow: (input: {
    session: StrengthSessionDto;
    profileId: number;
    deferUnifiedPublication?: boolean;
    publicationBlockSourceKeys?: readonly string[];
  }) => Promise<TrainingShadowRefreshResultV1 | void> =
      db === prisma ? recordExperimentalStrengthShadows : async () => {},
    private readonly recordExperimentalShadowsBySessionId: (input: {
      sessionId: number;
      profileId: number;
      deferUnifiedPublication?: boolean;
    }) => Promise<TrainingShadowRefreshResultV1 | void> = recordExperimentalStrengthShadowsBySessionId,
  ) {}

  private async unifiedPublicationStatus(profileId: number): Promise<ActiveEnergyPublicationStatusV1> {
    const current = await this.db.physiologyV7Lifecycle.findUnique({
      where: { profileId },
      select: {
        invalidationGeneration: true,
        productionStaleFromDate: true,
        productionPublishedGeneration: true,
        unifiedPublishedGeneration: true,
        unifiedPublicationBlockedFromDate: true,
        unifiedPublishedRolloutEpoch: true,
        unifiedRolloutEpoch: true,
      },
    });
    return isUnifiedGenerationCurrentV1(current)
      && current.unifiedPublishedRolloutEpoch === current.unifiedRolloutEpoch
      ? "current"
      : "stale";
  }

  private async refreshDeletedCompletedSessionPublication(input: {
    sessionId: number;
    profileId: number;
    fromInstant: Date;
    blockToken: { revision: number; fromDate: string };
  }): Promise<ActiveEnergyPublicationStatusV1> {
    const dirty = await invalidateUnifiedRelativeMuscleSuffixV1({
      profileId: input.profileId,
      fromInstant: input.fromInstant,
    });
    if (dirty === null) throw new Error("deleted completed training session has no resolvable model-day boundary");
    const production = await recalculateActiveEnergyChangesV1();
    if (production === null) throw new Error("production shadows are unavailable after completed training deletion");
    const refreshFromDate = input.blockToken.fromDate < dirty.modelDate
      ? input.blockToken.fromDate
      : dirty.modelDate;
    await recordExperimentalGlycogenStateShadow({ date: refreshFromDate, profileId: input.profileId });
    await rebuildAuthoritativeRelativeMuscleTrajectory({ fromInstant: input.fromInstant, profileId: input.profileId });
    const lifecycle = new PhysiologyV7PersistenceRepository();
    if (!await lifecycle.clearUnifiedPublicationBlock({
      profileId: input.profileId,
      source: "training",
      sourceKey: String(input.sessionId),
      expectedRevision: input.blockToken.revision,
      expectedFromDate: input.blockToken.fromDate,
    })) throw new Error("training source changed during dependent-shadow refresh; Unified remains blocked");
    const clearedFence = { sourceKey: String(input.sessionId), token: input.blockToken };
    if (await deferTrainingPublicationIfAnotherSourceIsBlocked(lifecycle, input.profileId, [clearedFence])) {
      return "stale";
    }
    try {
      await rebuildUnifiedExperimentalPhysiologyStateV1({ profileId: input.profileId, fromDate: refreshFromDate });
    } catch (error) {
      await restoreTrainingPublicationFencesWhenUnblocked(lifecycle, input.profileId, [clearedFence]);
      throw error;
    }
    return this.unifiedPublicationStatus(input.profileId);
  }

  listCatalog(options?: { includeInactive?: boolean; profileId?: number }) {
    return this.repo.listCatalog({
      profileId: options?.profileId,
      activeOnly: !options?.includeInactive,
    });
  }

  async updateCatalogLoadAccountingConfig(
    catalogId: number,
    input: UpdateCatalogLoadAccountingConfigInput,
    profileId = DEFAULT_TRAINING_PROFILE_ID,
  ): Promise<void> {
    const [catalog] = await this.repo.findCatalogByIds([catalogId], profileId);
    if (!catalog) throw new CatalogExerciseNotFoundError();
    const parsed = input.loadAccountingConfig === null
      ? null
      : loadConfigV1Schema.safeParse(input.loadAccountingConfig);
    if (parsed !== null && !parsed.success) {
      throw new SetValidationError("invalid load accounting configuration");
    }
    const next = parsed === null ? null : parsed.data;
    if (next?.configVersion === LEGACY_LOAD_INTERPRETATION_V1) {
      throw new SetValidationError("configVersion is reserved for legacy interpretation");
    }
    const current = catalog.currentLoadAccountingConfig?.configuration ?? null;
    if (next !== null && current !== null) {
      const currentParse = loadConfigV1Schema.safeParse(current);
      if (!currentParse.success) throw new SetValidationError("stored load accounting configuration is invalid");
      if (next.configVersion === currentParse.data.configVersion
          && stableJson(next) !== stableJson(currentParse.data)) {
        throw new SetValidationError("configVersion must change when configuration changes");
      }
      if (stableJson(next) === stableJson(currentParse.data)) return;
    }
    try {
      await this.repo.setCatalogLoadAccountingConfig({
        catalogId,
        profileId,
        config: persistedJson(next),
        configVersion: next?.configVersion,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new SetValidationError("configVersion has already been used for this exercise");
      }
      throw error;
    }
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
    const snapshotted = await this.snapshotProgramExerciseConfigs(ordered, profileId);
    return this.repo.createProgramWithVersion({
      profileId,
      name: input.name,
      exercises: snapshotted,
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
      ordered = await this.snapshotProgramExerciseConfigs(ordered, profileId);
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

  async getActiveSession(profileId = DEFAULT_TRAINING_PROFILE_ID) {
    await this.finalizeInactiveSessions(profileId);
    return this.repo.getActiveSession(profileId);
  }

  async getSession(sessionId: number, profileId = DEFAULT_TRAINING_PROFILE_ID) {
    await this.finalizeInactiveSessions(profileId);
    return this.repo.getSession(sessionId, profileId);
  }

  async materializeSessionAccounting(
    sessionId: number,
    profileId = DEFAULT_TRAINING_PROFILE_ID,
    idempotencyKey?: string,
  ) {
    const before = await this.repo.getSession(sessionId, profileId);
    if (!before) throw new SessionNotFoundError();
    const revision = await this.repo.materializeAccounting({
      sessionId, profileId, mode: "ordinary", idempotencyKey,
    });
    const session = await this.repo.getSession(sessionId, profileId);
    if (!session) throw new SessionNotFoundError();
    await this.refreshCompletedAccountingPublication(
      session,
      before.materializationState === "current"
        ? before.activeEnergyMassReference?.snapshotRevision ?? null
        : null,
      revision,
      profileId,
    );
    return { ...session, snapshotRevision: revision };
  }

  async refreshSessionAccounting(
    sessionId: number,
    profileId = DEFAULT_TRAINING_PROFILE_ID,
    idempotencyKey?: string,
  ) {
    const before = await this.repo.getSession(sessionId, profileId);
    if (!before) throw new SessionNotFoundError();
    const revision = await this.repo.materializeAccounting({
      sessionId, profileId, mode: "refresh", idempotencyKey,
    });
    const session = await this.repo.getSession(sessionId, profileId);
    if (!session) throw new SessionNotFoundError();
    await this.refreshCompletedAccountingPublication(
      session,
      before.materializationState === "current"
        ? before.activeEnergyMassReference?.snapshotRevision ?? null
        : null,
      revision,
      profileId,
    );
    return { ...session, snapshotRevision: revision };
  }

  private async refreshCompletedAccountingPublication(
    session: StrengthSessionDto,
    previousSnapshotRevision: number | null,
    snapshotRevision: number,
    profileId: number,
  ): Promise<void> {
    if (this.db !== prisma || session.status !== SESSION_STATUS.COMPLETED) return;
    if (previousSnapshotRevision !== null && snapshotRevision === previousSnapshotRevision) {
      const lifecycle = await this.db.physiologyV7Lifecycle.findUnique({
        where: { profileId },
        select: {
          invalidationGeneration: true,
          productionStaleFromDate: true,
          productionPublishedGeneration: true,
          unifiedPublishedGeneration: true,
          unifiedPublicationBlockedFromDate: true,
          unifiedPublishedRolloutEpoch: true,
          unifiedRolloutEpoch: true,
        },
      });
      if (
        isUnifiedGenerationCurrentV1(lifecycle)
        && lifecycle.unifiedPublishedRolloutEpoch === lifecycle.unifiedRolloutEpoch
      ) return;
    }
    // Materializing a completed session changes a source consumed by
    // production Active Energy and Unified. The repository has already
    // invalidated currentness transactionally; refresh the dependent chain
    // before reporting the new accounting snapshot as ready.
    await this.recordExperimentalShadow({ session, profileId });
  }

  async updateSessionAccountingContext(
    sessionId: number,
    input: { effectiveAccountingAt?: string; timeZone?: string },
    profileId = DEFAULT_TRAINING_PROFILE_ID,
  ) {
    if (input.timeZone !== undefined && !isValidTimeZone(input.timeZone)) {
      throw new SetValidationError("invalid session accounting timezone");
    }
    const before = await this.repo.getSession(sessionId, profileId);
    if (!before) throw new SessionNotFoundError();
    const previousEventAt = before.matchedWorkout?.startAt
      ?? before.effectiveAccountingAt
      ?? before.webStartedAt
      ?? before.createdAt;
    await this.repo.updateAccountingContext({
      sessionId,
      profileId,
      ...(input.effectiveAccountingAt ? { effectiveAccountingAt: new Date(input.effectiveAccountingAt) } : {}),
      ...(input.timeZone !== undefined ? { timeZone: input.timeZone } : {}),
    });
    const session = await this.repo.getSession(sessionId, profileId);
    if (!session) throw new SessionNotFoundError();
    if (this.db === prisma && session.status === SESSION_STATUS.COMPLETED) {
      try {
        const shadowRefresh = await this.recordExperimentalShadowsBySessionId({
          sessionId,
          profileId,
          deferUnifiedPublication: true,
        });
        await this.refreshRelativeMuscleAfterEventChange(sessionId, profileId, previousEventAt, {
          blockRevision: shadowRefresh && "blockRevision" in shadowRefresh ? shadowRefresh.blockRevision : null,
          blockFromDate: shadowRefresh && "blockFromDate" in shadowRefresh ? shadowRefresh.blockFromDate : null,
          publicationFromDate: shadowRefresh && "modelDate" in shadowRefresh ? shadowRefresh.modelDate : undefined,
        });
      } catch (error) {
        logPhysiologyPublicationFailure("training-accounting-context-republish", error);
        throw error;
      }
    }
    return session;
  }

  /** Existing lazy expiry behavior, now finalized with its persisted accounting result. */
  private async finalizeInactiveSessions(profileId: number, now = new Date()): Promise<void> {
    if (typeof this.repo.finishInactiveSessions !== "function") return;
    const expired = await this.repo.finishInactiveSessions({ profileId, now });
    for (const candidate of expired) {
      let snapshotRevision: number | null = null;
      try {
        snapshotRevision = await this.repo.materializeAccounting({
          sessionId: candidate.id,
          profileId,
          mode: "ordinary",
          idempotencyKey: `inactivity-finalize:${candidate.id}:${candidate.endAt.toISOString()}`,
          finalizeAt: candidate.endAt,
        });
      } catch (error) {
        // If another request finalized it, the idempotent operation/current
        // snapshot is authoritative; otherwise preserve the active session.
        if (!(error instanceof StaleAccountingCandidateError)) throw error;
      }
      if (snapshotRevision !== null && this.db === prisma) {
        const session = await this.repo.getSession(candidate.id, profileId);
        if (session?.status === SESSION_STATUS.COMPLETED) {
          await this.recordExperimentalShadow({ session, profileId });
        }
      }
    }
  }

  async startSession(
    programId: number,
    profileId = DEFAULT_TRAINING_PROFILE_ID,
    accountingTimeZone?: string,
  ): Promise<StrengthSessionDto> {
    await this.finalizeInactiveSessions(profileId);
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
        accountingTimeZone,
        accountingTimeZoneProvenance: accountingTimeZone ? "client-session" : "legacy-default",
        exercises: program.currentVersion.exercises.map((exercise) => ({
          sourceExerciseCatalogId: exercise.exerciseCatalog.id,
          snapshotExerciseName: exercise.exerciseCatalog.name,
          sortOrder: exercise.sortOrder,
          plannedSets: exercise.plannedSets,
          resistanceType: exercise.resistanceType as ResistanceType,
          muscleMappingSnapshot: trainingExerciseMappingSnapshotJsonV1(exercise.exerciseCatalog.stableKey),
          loadAccountingConfigSnapshot: persistedJson(validatedProgramSnapshot(
            exercise.loadAccountingConfigSnapshot,
            exercise.exerciseCatalog.stableKey,
          )),
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
      offset: query.offset,
      cursor: query.cursor,
      onlyMissingDiary: query.onlyMissingDiary,
    });
  }

  countHistoricalStrengthWorkouts(onlyMissingDiary = false): Promise<number> {
    return this.repo.countHistoricalStrengthWorkouts({ onlyMissingDiary });
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
  ): Promise<StrengthSessionDto & { modelPublicationStatus?: ActiveEnergyPublicationStatusV1 }> {
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
  ): Promise<{ session: StrengthSessionDto & { modelPublicationStatus?: ActiveEnergyPublicationStatusV1 }; created: boolean }> {
    const workout = await this.repo.findWorkoutById(input.workoutId);
    if (!workout) throw new WorkoutNotFoundError();
    if (!isStrengthWorkout(workout.type)) throw new WorkoutNotEligibleError();

    // A workout links to at most one diary session; re-requesting returns it.
    if (workout.matchedDiarySession) {
      const existing = await this.repo.getSession(workout.matchedDiarySession.id, profileId);
      if (!existing) throw new WorkoutAlreadyMatchedError();
      let modelPublicationStatus = await this.publicationStatusForCurrentDatabase(profileId);
      if (existing.status === SESSION_STATUS.COMPLETED && modelPublicationStatus === "stale") {
        modelPublicationStatus = await this.refreshUnifiedAfterCompletedSessionMutation(
          existing.id, profileId, "retry-existing-retrospective-session-publication",
        );
      }
      return {
        session: { ...existing, ...(modelPublicationStatus === undefined ? {} : { modelPublicationStatus }) },
        created: false,
      };
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
        effectiveAccountingAt: workout.startAt,
        exercises: program.version.exercises.map((exercise) => ({
          sourceExerciseCatalogId: exercise.exerciseCatalog.id,
          snapshotExerciseName: exercise.exerciseCatalog.name,
          sortOrder: exercise.sortOrder,
          plannedSets: exercise.plannedSets,
          resistanceType: exercise.resistanceType as ResistanceType,
          muscleMappingSnapshot: trainingExerciseMappingSnapshotJsonV1(exercise.exerciseCatalog.stableKey),
          loadAccountingConfigSnapshot: persistedJson(validatedProgramSnapshot(
            exercise.loadAccountingConfigSnapshot,
            exercise.exerciseCatalog.stableKey,
          )),
        })),
      });
      // Retrospective sessions begin without a persisted accounting snapshot.
      // Materialize it before deriving the strength-energy shadow so its
      // source fingerprint and MET fallback use the same committed accounting
      // state as later edits and ordinary completed-session publication.
      await this.repo.materializeAccounting({ sessionId: created.id, profileId, mode: "ordinary" });
      const materialized = await this.repo.getSession(created.id, profileId);
      if (!materialized) throw new SessionNotFoundError();
      noteTrainingSourceChange({
        sessionId: created.id,
        revision: created.revision,
        workoutLocalDate: workoutLocalDate(workout.startAt),
        reason: "retrospective_create",
      });
      let modelPublicationStatus: ActiveEnergyPublicationStatusV1 | undefined;
      try {
        await this.recordExperimentalShadow({ session: materialized, profileId });
        modelPublicationStatus = await this.publicationStatusForCurrentDatabase(profileId);
      } catch (error) {
        if (error instanceof StaleStrengthEnergySourceError) throw error;
        logPhysiologyPublicationFailure("retrospective-session-create", error);
        modelPublicationStatus = this.db === prisma ? "stale" : undefined;
      }
      return {
        session: { ...materialized, ...(modelPublicationStatus === undefined ? {} : { modelPublicationStatus }) },
        created: true,
      };
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
  ): Promise<StrengthSessionDto & { modelPublicationStatus?: ActiveEnergyPublicationStatusV1 }> {
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
        muscleMappingSnapshot: trainingExerciseMappingSnapshotJsonV1(exercise.exerciseCatalog.stableKey),
        loadAccountingConfigSnapshot: validatedProgramSnapshot(
          exercise.loadAccountingConfigSnapshot,
          exercise.exerciseCatalog.stableKey,
        ),
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
      workoutLocalDate: workoutLocalDate(
        session.matchedWorkout?.startAt ? new Date(session.matchedWorkout.startAt) : undefined,
      ),
      reason: "program_change",
    });
    let modelPublicationStatus: ActiveEnergyPublicationStatusV1 | undefined;
    if (session.status === SESSION_STATUS.COMPLETED) {
      modelPublicationStatus = await this.refreshUnifiedAfterCompletedSessionMutation(
        sessionId, profileId, "completed-session-program-change",
      );
    } else {
      await this.refreshTransientWaterAfterMutation(profileId).catch(() => {});
    }

    return {
      ...await this.requireSession(sessionId, profileId),
      ...(modelPublicationStatus === undefined ? {} : { modelPublicationStatus }),
    };
  }

  async addSessionExercise(
    sessionId: number,
    input: CreateSessionExerciseInput,
    profileId = DEFAULT_TRAINING_PROFILE_ID,
  ): Promise<StrengthSessionDto & { modelPublicationStatus?: ActiveEnergyPublicationStatusV1 }> {
    const session = await this.repo.findSessionForEdit(sessionId, profileId);
    if (!session) throw new SessionNotFoundError();
    assertSessionEditable(session.status);

    const [catalog] = await this.repo.findCatalogByIds([input.catalogId], profileId);
    if (!catalog) throw new CatalogExerciseNotFoundError();

    const stored = catalog.currentLoadAccountingConfig?.configuration ?? null;
    let config: LoadConfigV1 | null = null;
    if (stored !== null) {
      const parsed = loadConfigV1Schema.safeParse(stored);
      if (!parsed.success || parsed.data.configVersion !== catalog.currentLoadAccountingConfig?.configVersion) {
        throw new SetValidationError("stored load accounting configuration is invalid");
      }
      config = parsed.data;
    } else {
      config = legacyConfigForStableKey(catalog.stableKey);
    }

    const { revision } = await this.repo.addSessionExercise({
      sessionId,
      sourceExerciseCatalogId: catalog.id,
      snapshotExerciseName: catalog.name,
      plannedSets: input.plannedSets,
      resistanceType: input.resistanceType,
      origin: EXERCISE_ORIGIN.EXTRA,
      muscleMappingSnapshot: trainingExerciseMappingSnapshotJsonV1(catalog.stableKey),
      loadAccountingConfigSnapshot: persistedJson(config),
      order: input.order,
      orderedExerciseIds: session.exercises.map((exercise) => exercise.id),
    });

    const modelPublicationStatus = await this.noteExerciseMutation(sessionId, revision, profileId);
    return {
      ...await this.requireSession(sessionId, profileId),
      ...(modelPublicationStatus === undefined ? {} : { modelPublicationStatus }),
    };
  }

  async updateSessionExercise(
    sessionId: number,
    exerciseId: number,
    input: UpdateSessionExerciseInput,
    profileId = DEFAULT_TRAINING_PROFILE_ID,
  ): Promise<StrengthSessionDto & { modelPublicationStatus?: ActiveEnergyPublicationStatusV1 }> {
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

    const modelPublicationStatus = await this.noteExerciseMutation(sessionId, revision, profileId);
    return {
      ...await this.requireSession(sessionId, profileId),
      ...(modelPublicationStatus === undefined ? {} : { modelPublicationStatus }),
    };
  }

  async deleteSessionExercise(
    sessionId: number,
    exerciseId: number,
    input: DeleteSessionExerciseInput = {},
    profileId = DEFAULT_TRAINING_PROFILE_ID,
  ): Promise<StrengthSessionDto & { modelPublicationStatus?: ActiveEnergyPublicationStatusV1 }> {
    const session = await this.repo.findSessionForEdit(sessionId, profileId);
    if (!session) throw new SessionNotFoundError();
    assertSessionEditable(session.status);

    const exercise = await this.repo.findSessionExerciseDetail(sessionId, exerciseId, profileId);
    if (!exercise) {
      const publicationBlockSourceKey = trainingChildDeletionPublicationSourceKey("exercise", sessionId, exerciseId);
      const retryStatus = await this.retryDeletedChildPublication({
        sessionId,
        profileId,
        publicationBlockSourceKey,
        operation: "completed-session-exercise-delete-retry",
      });
      if (retryStatus === undefined) throw new SessionExerciseNotFoundError();
      return {
        ...await this.requireSession(sessionId, profileId),
        modelPublicationStatus: retryStatus,
      };
    }
    // Recorded sets are user-entered history: never drop them without consent.
    if (exercise.sets.length > 0 && !input.confirm) throw new ExerciseHasSetsError();

    const revision = await this.repo.deleteSessionExercise({
      sessionId,
      exerciseId,
      orderedExerciseIds: session.exercises.map((item) => item.id),
    });

    const modelPublicationStatus = await this.noteExerciseMutation(
      sessionId,
      revision,
      profileId,
      trainingChildDeletionPublicationSourceKey("exercise", sessionId, exerciseId),
    );
    return {
      ...await this.requireSession(sessionId, profileId),
      ...(modelPublicationStatus === undefined ? {} : { modelPublicationStatus }),
    };
  }

  async reorderSessionExercises(
    sessionId: number,
    input: ReorderSessionExercisesInput,
    profileId = DEFAULT_TRAINING_PROFILE_ID,
  ): Promise<StrengthSessionDto & { modelPublicationStatus?: ActiveEnergyPublicationStatusV1 }> {
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

    const modelPublicationStatus = await this.noteExerciseMutation(sessionId, revision, profileId);
    return {
      ...await this.requireSession(sessionId, profileId),
      ...(modelPublicationStatus === undefined ? {} : { modelPublicationStatus }),
    };
  }

  async createSet(
    sessionId: number,
    exerciseId: number,
    input: CreateSetInput,
    profileId = DEFAULT_TRAINING_PROFILE_ID,
  ): Promise<StrengthSetDto & { modelPublicationStatus?: ActiveEnergyPublicationStatusV1 }> {
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
    const override = input.loadAccountingOverride === undefined || input.loadAccountingOverride === null
      ? null
      : setExecutionOverrideV1Schema.safeParse(input.loadAccountingOverride);
    if (override !== null && !override.success) throw new SetValidationError("invalid load accounting override");

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
        loadAccountingOverride: override === null ? null : JSON.parse(JSON.stringify(override.data)) as Prisma.InputJsonValue,
      });
      const modelPublicationStatus = await this.noteSetMutation(sessionId, profileId);
      return { ...created, ...(modelPublicationStatus === undefined ? {} : { modelPublicationStatus }) };
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
  ): Promise<StrengthSetDto & { modelPublicationStatus?: ActiveEnergyPublicationStatusV1 }> {
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
    const override = input.loadAccountingOverride === undefined
      ? undefined
      : input.loadAccountingOverride === null
        ? null
        : setExecutionOverrideV1Schema.safeParse(input.loadAccountingOverride);
    if (override !== undefined && override !== null && !override.success) {
      throw new SetValidationError("invalid load accounting override");
    }

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
      loadAccountingOverride: override === undefined || override === null
        ? override
        : JSON.parse(JSON.stringify(override.data)) as Prisma.InputJsonValue,
    });
    if (!updated) throw new SetNotFoundError();
    const modelPublicationStatus = await this.noteSetMutation(sessionId, profileId);
    return { ...updated, ...(modelPublicationStatus === undefined ? {} : { modelPublicationStatus }) };
  }

  async deleteSet(
    sessionId: number,
    setId: number,
    profileId = DEFAULT_TRAINING_PROFILE_ID,
  ): Promise<{ modelPublicationStatus?: ActiveEnergyPublicationStatusV1 }> {
    const existing = await this.repo.findSetForSession(setId, sessionId, profileId);
    if (!existing) {
      const session = await this.repo.getSession(sessionId, profileId);
      if (!session) throw new SessionNotFoundError();
      if (session.status !== SESSION_STATUS.COMPLETED) throw new SetNotFoundError();
      const retryStatus = await this.retryDeletedChildPublication({
        sessionId,
        profileId,
        publicationBlockSourceKey: trainingChildDeletionPublicationSourceKey("set", sessionId, setId),
        operation: "completed-session-set-delete-retry",
      });
      if (retryStatus === undefined) throw new SetNotFoundError();
      return { modelPublicationStatus: retryStatus };
    }
    if (
      existing.sessionExercise.session.status !== SESSION_STATUS.ACTIVE
      && existing.sessionExercise.session.status !== SESSION_STATUS.COMPLETED
      && existing.sessionExercise.session.status !== SESSION_STATUS.CANCELLED
    ) {
      throw new SessionNotFoundError();
    }
    await this.repo.deleteSet(setId, sessionId, profileId);
    const modelPublicationStatus = await this.noteSetMutation(
      sessionId,
      profileId,
      trainingChildDeletionPublicationSourceKey("set", sessionId, setId),
    );
    return { ...(modelPublicationStatus === undefined ? {} : { modelPublicationStatus }) };
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
  ): Promise<StrengthSessionDto & { modelPublicationStatus?: ActiveEnergyPublicationStatusV1 }> {
    const session = await this.repo.getSession(sessionId, profileId);
    if (!session) throw new SessionNotFoundError();

    if (session.status === SESSION_STATUS.COMPLETED) {
      const previousRelativeMuscleEventAt = session.matchedWorkout?.startAt
        ?? session.effectiveAccountingAt
        ?? session.webStartedAt;
      // Idempotent finish: re-run matcher only while still PENDING/AUTO-eligible.
      // Retrospective sessions are already linked and never re-matched.
      if (
        session.matchStatus === MATCH_STATUS.PENDING
        && session.matchMethod !== MATCH_METHOD.MANUAL
        && session.entryMode !== ENTRY_MODE.RETROSPECTIVE
      ) {
        await this.tryAutoMatchSession(sessionId, profileId);
      }
      await this.repo.materializeAccounting({ sessionId, profileId, mode: "ordinary" });
      const refreshed = await this.repo.getSession(sessionId, profileId);
      if (!refreshed) throw new SessionNotFoundError();
      // Keep the shadow dependency chain ordered; its failure remains isolated
      // from the completed-session result.
      let publicationDependenciesReady = true;
      let shadowRefresh: TrainingShadowRefreshResultV1 | void = undefined;
      try {
        shadowRefresh = await this.recordExperimentalShadow({
          session: refreshed, profileId, deferUnifiedPublication: true,
        });
      } catch (error) {
        if (error instanceof StaleStrengthEnergySourceError) throw error;
        publicationDependenciesReady = false;
        logPhysiologyPublicationFailure("completed-session-republish", error);
      }
      let modelPublicationStatus: ActiveEnergyPublicationStatusV1 | undefined;
      if (publicationDependenciesReady) {
        try {
          await this.refreshRelativeMuscleAfterEventChange(
            sessionId,
            profileId,
            previousRelativeMuscleEventAt,
            {
              blockRevision: shadowRefresh && "blockRevision" in shadowRefresh ? shadowRefresh.blockRevision : null,
              blockFromDate: shadowRefresh && "blockFromDate" in shadowRefresh ? shadowRefresh.blockFromDate : null,
              publicationFromDate: shadowRefresh && "modelDate" in shadowRefresh ? shadowRefresh.modelDate : undefined,
            },
          );
          modelPublicationStatus = await this.publicationStatusForCurrentDatabase(profileId);
        } catch (error) {
          logPhysiologyPublicationFailure("completed-session-event-relocation", error);
          modelPublicationStatus = this.db === prisma ? "stale" : undefined;
        }
      } else {
        modelPublicationStatus = this.db === prisma ? "stale" : undefined;
      }
      return { ...refreshed, ...(modelPublicationStatus === undefined ? {} : { modelPublicationStatus }) };
    }

    if (session.status !== SESSION_STATUS.ACTIVE) {
      throw new SessionNotFoundError();
    }

    await this.repo.materializeAccounting({
      sessionId,
      profileId,
      mode: "ordinary",
      idempotencyKey: `finish:${sessionId}:${session.updatedAt}`,
      finalizeAt: new Date(),
    });
    await this.tryAutoMatchSession(sessionId, profileId);
    await this.repo.materializeAccounting({ sessionId, profileId, mode: "ordinary" });
    const refreshed = await this.repo.getSession(sessionId, profileId);
    if (!refreshed) throw new SessionNotFoundError();
    let modelPublicationStatus: ActiveEnergyPublicationStatusV1 | undefined;
    try {
      await this.recordExperimentalShadow({ session: refreshed, profileId });
      modelPublicationStatus = await this.publicationStatusForCurrentDatabase(profileId);
    } catch (error) {
      if (error instanceof StaleStrengthEnergySourceError) throw error;
      logPhysiologyPublicationFailure("completed-session-republish", error);
      modelPublicationStatus = this.db === prisma ? "stale" : undefined;
    }
    return { ...refreshed, ...(modelPublicationStatus === undefined ? {} : { modelPublicationStatus }) };
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
    await this.refreshTransientWaterAfterMutation(profileId).catch(() => {});
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
  ): Promise<{ matchedWorkoutId: number | null; modelPublicationStatus?: ActiveEnergyPublicationStatusV1 }> {
    const session = await this.repo.getSession(sessionId, profileId);
    if (!session) {
      if (this.db !== prisma) throw new SessionNotFoundError();
      const lifecycle = new PhysiologyV7PersistenceRepository();
      const blockToken = await lifecycle.readUnifiedPublicationBlockToken({
        profileId, source: "training", sourceKey: String(sessionId),
      });
      if (blockToken === null) throw new SessionNotFoundError();
      try {
        const fromInstant = await trainingModelDateStartInstant(profileId, blockToken.fromDate);
        return {
          matchedWorkoutId: null,
          modelPublicationStatus: await this.refreshDeletedCompletedSessionPublication({
            sessionId, profileId, fromInstant, blockToken,
          }),
        };
      } catch (error) {
        logPhysiologyPublicationFailure("retry-deleted-completed-session-dependency-refresh", error);
        return { matchedWorkoutId: null, modelPublicationStatus: "stale" };
      }
    }
    if (session.status === SESSION_STATUS.ACTIVE) {
      throw new SessionNotEditableError();
    }
    const matchedWorkoutId = session.matchedWorkoutId;
    const relativeMuscleEventAt = session.matchedWorkout?.startAt
      ?? session.effectiveAccountingAt
      ?? session.webStartedAt
      ?? session.createdAt;
    await this.repo.deleteDiarySession(sessionId, profileId);
    let modelPublicationStatus: ActiveEnergyPublicationStatusV1 | undefined;
    if (this.db === prisma && session.status === SESSION_STATUS.COMPLETED) {
      try {
        const eventAt = new Date(relativeMuscleEventAt);
        const lifecycle = new PhysiologyV7PersistenceRepository();
        const blockToken = await lifecycle.readUnifiedPublicationBlockToken({
          profileId, source: "training", sourceKey: String(sessionId),
        });
        if (blockToken === null) throw new Error("completed training deletion lost its durable publication fence");
        modelPublicationStatus = await this.refreshDeletedCompletedSessionPublication({
          sessionId, profileId, fromInstant: eventAt, blockToken,
        });
      } catch (error) {
        logPhysiologyPublicationFailure("deleted-completed-session-dependency-refresh", error);
        modelPublicationStatus = "stale";
      }
    } else if (this.db === prisma) {
      await this.refreshTransientWaterAfterMutation(profileId).catch(() => {});
    } else {
      await this.refreshTransientWaterAfterMutation(profileId).catch(() => {});
    }
    return { matchedWorkoutId, ...(modelPublicationStatus === undefined ? {} : { modelPublicationStatus }) };
  }

  listRecentSessions(options?: { limit?: number; offset?: number; profileId?: number }) {
    return this.repo.listRecentSessions(options);
  }

  countRecentSessions(profileId = DEFAULT_TRAINING_PROFILE_ID) {
    return this.repo.countRecentSessions(profileId);
  }

  listMatchAttention(options: { limit?: number; offset?: number; profileId?: number } = {}) {
    return this.repo.listMatchAttention({
      profileId: options.profileId ?? DEFAULT_TRAINING_PROFILE_ID,
      limit: options.limit,
      offset: options.offset,
      longPendingBefore: new Date(Date.now() - MATCH_THRESHOLDS.longPendingMs),
    });
  }

  countMatchAttention(profileId = DEFAULT_TRAINING_PROFILE_ID) {
    return this.repo.countMatchAttention({
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
  ): Promise<StrengthSessionDto & { modelPublicationStatus?: ActiveEnergyPublicationStatusV1 }> {
    const session = await this.repo.getSession(sessionId, profileId);
    if (!session) throw new SessionNotFoundError();
    if (session.status !== SESSION_STATUS.COMPLETED) {
      throw new SessionNotFoundError();
    }
    const previousRelativeMuscleEventAt = session.matchedWorkout?.startAt
      ?? session.effectiveAccountingAt
      ?? session.webStartedAt;

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

    await this.repo.materializeAccounting({ sessionId, profileId, mode: "ordinary" });
    const refreshed = await this.repo.getSession(sessionId, profileId);
    if (!refreshed) throw new SessionNotFoundError();
    // A manual link can add Garmin diagnostic context after completion.
    let publicationDependenciesReady = true;
    let shadowRefresh: TrainingShadowRefreshResultV1 | void = undefined;
    try {
      shadowRefresh = await this.recordExperimentalShadow({
        session: refreshed, profileId, deferUnifiedPublication: true,
      });
    } catch (error) {
      if (error instanceof StaleStrengthEnergySourceError) throw error;
      publicationDependenciesReady = false;
      logPhysiologyPublicationFailure("manual-match-republish", error);
    }
    let modelPublicationStatus: ActiveEnergyPublicationStatusV1 | undefined;
    if (publicationDependenciesReady) {
      try {
        await this.refreshRelativeMuscleAfterEventChange(
          sessionId,
          profileId,
          previousRelativeMuscleEventAt,
          {
            blockRevision: shadowRefresh && "blockRevision" in shadowRefresh ? shadowRefresh.blockRevision : null,
            blockFromDate: shadowRefresh && "blockFromDate" in shadowRefresh ? shadowRefresh.blockFromDate : null,
            publicationFromDate: shadowRefresh && "modelDate" in shadowRefresh ? shadowRefresh.modelDate : undefined,
          },
        );
        modelPublicationStatus = await this.publicationStatusForCurrentDatabase(profileId);
      } catch (error) {
        logPhysiologyPublicationFailure("manual-match-event-relocation", error);
        modelPublicationStatus = this.db === prisma ? "stale" : undefined;
      }
    } else {
      modelPublicationStatus = this.db === prisma ? "stale" : undefined;
    }
    return { ...refreshed, ...(modelPublicationStatus === undefined ? {} : { modelPublicationStatus }) };
  }

  /**
   * After health sync for a calendar day, attempt auto-match for overlapping
   * completed PENDING sessions. Skips MANUAL sticky matches. Failures are
   * caller-owned (service throws; health sync should catch/log).
   */
  async afterHealthSyncMatch(
    date: string,
    options: { profileId?: number; timezone?: string } = {},
  ): Promise<boolean> {
    const profileId = options.profileId ?? DEFAULT_TRAINING_PROFILE_ID;
    const timezone = options.timezone ?? DEFAULT_TIME_ZONE;
    const windowStart = localDateTimeToInstant(date, "00:00", timezone);
    const nextDay = new Date(windowStart.getTime() + 24 * 60 * 60_000);
    // Inclusive local day: [00:00, next 00:00)
    const windowEnd = nextDay;
    let publicationDependenciesReady = true;

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
        let sessionPublicationDependenciesReady = true;
        let shadowRefresh: TrainingShadowRefreshResultV1 | void = undefined;
        try {
          shadowRefresh = await this.recordExperimentalShadowsBySessionId({
            sessionId: session.id,
            profileId,
            deferUnifiedPublication: true,
          });
        } catch (error) {
          sessionPublicationDependenciesReady = false;
          publicationDependenciesReady = false;
          logPhysiologyPublicationFailure("health-sync-strength-republish", error);
        }
        if (sessionPublicationDependenciesReady) {
          try {
            await this.refreshRelativeMuscleAfterEventChange(
              session.id,
              profileId,
              session.webStartedAt,
              {
                deferUnifiedPublication: true,
                blockRevision: shadowRefresh && "blockRevision" in shadowRefresh ? shadowRefresh.blockRevision : null,
                blockFromDate: shadowRefresh && "blockFromDate" in shadowRefresh ? shadowRefresh.blockFromDate : null,
                publicationFromDate: shadowRefresh && "modelDate" in shadowRefresh ? shadowRefresh.modelDate : undefined,
              },
            );
          } catch (error) {
            publicationDependenciesReady = false;
            logPhysiologyPublicationFailure("health-sync-strength-republication", error);
          }
        }
      }
    }
    return publicationDependenciesReady;
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

  private async noteExerciseMutation(
    sessionId: number,
    revision: number,
    profileId: number,
    publicationBlockSourceKey?: string,
  ): Promise<ActiveEnergyPublicationStatusV1 | undefined> {
    const session = await this.repo.getSession(sessionId, profileId);
    if (!session) throw new SessionNotFoundError();
    noteTrainingSourceChange({
      sessionId,
      revision,
      workoutLocalDate: workoutLocalDate(
        session.matchedWorkout?.startAt ? new Date(session.matchedWorkout.startAt) : undefined,
      ),
      reason: "exercise_mutation",
    });
    if (session.status !== SESSION_STATUS.COMPLETED) return undefined;
    return this.refreshUnifiedAfterCompletedSessionMutation(
      sessionId,
      profileId,
      "completed-session-exercise-change",
      publicationBlockSourceKey === undefined ? [] : [publicationBlockSourceKey],
    );
  }

  /**
   * Editing sets on a terminal diary session rewrites history, so bump the
   * durable revision for future rebuild fingerprints. Live ACTIVE logging does not.
   */
  private async noteSetMutation(
    sessionId: number,
    profileId: number,
    publicationBlockSourceKey?: string,
  ): Promise<ActiveEnergyPublicationStatusV1 | undefined> {
    const session = await this.repo.getSession(sessionId, profileId);
    if (!session) throw new SessionNotFoundError();
    if (
      session.status !== SESSION_STATUS.COMPLETED
      && session.status !== SESSION_STATUS.CANCELLED
    ) return undefined;
    const revision = await this.repo.incrementSessionRevision(session.id);
    noteTrainingSourceChange({
      sessionId: session.id,
      revision,
      workoutLocalDate: workoutLocalDate(
        session.matchedWorkout?.startAt ? new Date(session.matchedWorkout.startAt) : undefined,
      ),
      reason: "set_mutation",
    });
    if (this.db === prisma && session.status === SESSION_STATUS.COMPLETED) {
      return this.refreshUnifiedAfterCompletedSessionMutation(
        session.id,
        profileId,
        "completed-session-set-change",
        publicationBlockSourceKey === undefined ? [] : [publicationBlockSourceKey],
      );
    }
    return undefined;
  }

  private async refreshUnifiedAfterCompletedSessionMutation(
    sessionId: number,
    profileId: number,
    operation: string,
    publicationBlockSourceKeys: readonly string[] = [],
  ): Promise<ActiveEnergyPublicationStatusV1 | undefined> {
    try {
      if (this.db !== prisma) return undefined;
      const session = await this.repo.getSession(sessionId, profileId);
      if (!session) return "stale";
      // Rebuild the full session dependency chain before Unified. A source edit
      // can change canonical strength energy and glycogen demand as well as
      // Relative Muscle; publishing after only one child refresh can make a
      // later unrelated writer expose an older child row as current.
      await withTrainingPublicationStage("session-dependent-shadow-chain", () => this.recordExperimentalShadow({
        session,
        profileId,
        ...(publicationBlockSourceKeys.length > 0 ? { publicationBlockSourceKeys } : {}),
      }));
      return this.unifiedPublicationStatus(profileId);
    } catch (error) {
      if (error instanceof StaleStrengthEnergySourceError) throw error;
      logPhysiologyPublicationFailure(`${operation}-dependency-refresh`, error);
      return "stale";
    }
  }

  private async retryDeletedChildPublication(input: {
    sessionId: number;
    profileId: number;
    publicationBlockSourceKey: string;
    operation: string;
  }): Promise<ActiveEnergyPublicationStatusV1 | undefined> {
    if (this.db !== prisma) return undefined;
    const token = await new PhysiologyV7PersistenceRepository().readUnifiedPublicationBlockToken({
      profileId: input.profileId,
      source: "training",
      sourceKey: input.publicationBlockSourceKey,
    });
    // A missing child is retryable only when this exact deletion left durable
    // publication work behind. A session-wide or unrelated block is not proof
    // that this child was deleted by a prior request.
    if (token === null) return undefined;
    return this.refreshUnifiedAfterCompletedSessionMutation(
      input.sessionId,
      input.profileId,
      input.operation,
      [input.publicationBlockSourceKey],
    );
  }

  private async publicationStatusForCurrentDatabase(
    profileId: number,
  ): Promise<ActiveEnergyPublicationStatusV1 | undefined> {
    return this.db === prisma && this.recordExperimentalShadow === recordExperimentalStrengthShadows
      ? this.unifiedPublicationStatus(profileId)
      : undefined;
  }

  private async refreshTransientWaterAfterMutation(profileId: number, fromDate?: string): Promise<void> {
    if (this.db !== prisma) return;
    try {
      await rebuildUnifiedExperimentalPhysiologyStateV1({ profileId, fromDate });
    } catch (error) {
      logPhysiologyPublicationFailure("training-source-mutation", error);
      throw error;
    }
  }

  private async refreshRelativeMuscleAfterSessionMutation(sessionId: number, profileId: number): Promise<string | null> {
    if (this.db !== prisma) return null;
    const session = await this.repo.getSession(sessionId, profileId);
    const eventAt = session?.matchedWorkout?.startAt ?? session?.webStartedAt ?? null;
    if (!eventAt) return null;
    return (await this.invalidateAndRebuildRelativeMuscle(profileId, new Date(eventAt)))?.modelDate ?? null;
  }

  private async invalidateAndRebuildRelativeMuscle(profileId: number, fromInstant: Date) {
    const dirty = await invalidateUnifiedRelativeMuscleSuffixV1({ profileId, fromInstant });
    await rebuildAuthoritativeRelativeMuscleTrajectory({ fromInstant, profileId });
    return dirty;
  }

  private async refreshRelativeMuscleAfterEventChange(
    sessionId: number,
    profileId: number,
    previousEventAt: Date | string | null,
    options: {
      deferUnifiedPublication?: boolean;
      blockRevision?: number | null;
      blockFromDate?: string | null;
      publicationFromDate?: string;
    } = {},
  ): Promise<void> {
    if (this.db !== prisma) return;
    const session = await this.repo.getSession(sessionId, profileId);
    const currentEventAt = session?.matchedWorkout?.startAt
      ?? session?.effectiveAccountingAt
      ?? session?.webStartedAt
      ?? null;
    const dirtyDates = [options.publicationFromDate].filter((date): date is string => date !== undefined);
    if (previousEventAt !== null) {
      const previousInstant = new Date(previousEventAt);
      if (!Number.isFinite(previousInstant.getTime())) throw new Error("previous training event instant is invalid");
      if (currentEventAt === null || new Date(currentEventAt).getTime() !== previousInstant.getTime()) {
        const dirty = await this.invalidateAndRebuildRelativeMuscle(profileId, previousInstant);
        if (dirty === null) throw new Error("previous training event has no resolvable model-day boundary");
        dirtyDates.push(dirty.modelDate);
      }
    }
    const lifecycle = new PhysiologyV7PersistenceRepository();
    let sourceBlockCleared = false;
    if (options.blockRevision !== null && options.blockRevision !== undefined) {
      if (options.blockFromDate === null || options.blockFromDate === undefined) {
        throw new Error("training publication block boundary is missing; Unified remains blocked");
      }
      if (!await lifecycle.clearUnifiedPublicationBlock({
        profileId, source: "training", sourceKey: String(sessionId), expectedRevision: options.blockRevision,
        expectedFromDate: options.blockFromDate,
      })) throw new Error("training source changed during event relocation; Unified remains blocked");
      sourceBlockCleared = true;
    }
    const fromDate = dirtyDates.sort()[0];
    if (!options.deferUnifiedPublication) {
      const clearedFences = sourceBlockCleared && options.blockRevision !== null && options.blockRevision !== undefined
        ? [{
          sourceKey: String(sessionId),
          token: { revision: options.blockRevision, fromDate: options.blockFromDate! },
        }]
        : [];
      if (await deferTrainingPublicationIfAnotherSourceIsBlocked(lifecycle, profileId, clearedFences)) return;
      try {
        await rebuildUnifiedExperimentalPhysiologyStateV1({ profileId, fromDate });
      } catch (error) {
        logPhysiologyPublicationFailure("training-event-relocation", error);
        if (sourceBlockCleared) {
          try {
            await restoreTrainingPublicationFencesWhenUnblocked(lifecycle, profileId, clearedFences);
          } catch (restoreError) {
            throw new AggregateError(
              [error, restoreError],
              "Unified publication failed and the training retry fence could not be restored",
            );
          }
        }
        throw error;
      }
    }
  }

  private async snapshotProgramExerciseConfigs(
    exercises: OrderedProgramExerciseWrite[],
    profileId: number,
  ): Promise<OrderedProgramExerciseWrite[]> {
    const unique = [...new Set(exercises.map((exercise) => exercise.exerciseCatalogId))];
    const found = await this.repo.findCatalogByIds(unique, profileId);
    if (found.length !== unique.length) throw new CatalogExerciseNotFoundError();
    const byId = new Map(found.map((catalog) => [catalog.id, catalog]));
    return exercises.map((exercise) => {
      const catalog = byId.get(exercise.exerciseCatalogId);
      if (!catalog) throw new CatalogExerciseNotFoundError();
      const stored = catalog.currentLoadAccountingConfig?.configuration ?? null;
      let config: LoadConfigV1 | null;
      if (stored !== null) {
        const parsed = loadConfigV1Schema.safeParse(stored);
        if (!parsed.success
            || parsed.data.configVersion !== catalog.currentLoadAccountingConfig?.configVersion) {
          throw new SetValidationError("stored load accounting configuration is invalid");
        }
        config = parsed.data;
      } else {
        config = legacyConfigForStableKey(catalog.stableKey);
      }
      return { ...exercise, loadAccountingConfigSnapshot: persistedJson(config) };
    });
  }
}

export const trainingService = new TrainingService(prisma, trainingRepository);
