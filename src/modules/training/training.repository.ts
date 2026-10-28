import { Prisma, type PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { requireProfileId } from "@/modules/profile/profile-scope";
import { episodeTimeContextForInstantV1 } from "@/modules/model-episodes/episode-time-context-v1";
import { DEFAULT_TIME_ZONE, instantToLocalDateTime, isValidTimeZone } from "@/model/time-zone";
import { canonicalizeWorkoutType } from "@/model/activity/workout-energy";
import { selectPersistedEnergyResolutionV1 } from "@/model/activity/canonical-activity-policy-v1";
import { TRADITIONAL_STRENGTH_TRAINING_TYPE } from "@/modules/health/expand-training-workouts";
import { CANONICAL_EXERCISE_IDENTITIES } from "./canonical-exercise-identity";
import {
  DIARY_COMPLETENESS,
  ENTRY_MODE,
  EXERCISE_ORIGIN,
  MATCH_METHOD,
  MATCH_STATUS,
  RESISTANCE,
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
import { historicalExerciseStableKey } from "./exercise-mapping-snapshot";
import { calculateLoadAccountingWithBreakdownV1, LOAD_ACCOUNTING_METHOD_V1, LEGACY_LOAD_INTERPRETATION_V1, classifyPersistedExerciseIdentityV1, loadConfigV1Schema, type BodyweightReferenceV1, type IdentityStatusV1, type LoadAccountingOutputV1 } from "./load-accounting-v1";
import { BODYWEIGHT_RESOLUTION_METHOD_V2 } from "./bodyweight-reference-v2";
import { buildMassResolutionIdentity, isPersistedLoadAccountingPayloadVersion, PERSISTED_LOAD_ACCOUNTING_PAYLOAD_V2, persistedPayloadFromUnknown, sha256Canonical } from "./persisted-load-accounting-v1";
import { rebaseCurrentAccountingSnapshotTimestamp } from "./rebase-current-accounting-snapshot";
import { resolveSessionHistoricalMassReferenceV1, resolveStrengthEnergyMassReferenceV1 } from "./session-mass-reference";
import { sessionPlanCompletion } from "./session-plan-completion";
import {
  SetCreateOperationConflictError,
  SetCreateOperationTombstonedError,
  SetCreateOperationUnresolvedError,
  TrainingConcurrentMutationError,
} from "./training.errors";
import { invalidateActiveEnergySourcesInTransactionV1 } from "@/modules/activity/active-energy-invalidation";
import { PhysiologyV7PersistenceRepository } from "@/modules/model-episodes/physiology-v7-persistence.repository";
import { evaluateSessionInactivity } from "./session-inactivity";
import { stableSha256 } from "@/modules/model-recovery/recovery-fingerprint";
import { resolveTransientWaterV2CanonicalEventInstant } from "@/model/physiology-v7/experimental-transient-exercise-water-v2";
import {
  activeEnergyConvergenceFenceChanged,
  enqueueTrainingSourceChangeInTransaction,
  isTrainingRefreshPending,
  readActiveEnergyConvergenceVisibilityFence,
  readTrainingRefreshVisibilityFence,
  trainingRefreshFenceChanged,
  trainingRefreshWorkerOwnsGeneration,
  type TrainingRefreshDeadlineMode,
  type TrainingSourceChangeEvidence,
} from "./training-refresh-queue";
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

export class StaleAccountingCandidateError extends Error {
  constructor() {
    super("accounting inputs changed before the result could be published");
    this.name = "StaleAccountingCandidateError";
  }
}

async function bumpAccountingInputRevision(
  tx: Prisma.TransactionClient,
  sessionId: number,
  publicationBlockSourceKey?: string,
): Promise<number> {
  const updated = await tx.strengthDiarySession.update({
    where: { id: sessionId },
    data: {
      revision: { increment: 1 },
      accountingInputRevision: { increment: 1 },
      currentSnapshotRevision: null,
    },
    select: { accountingInputRevision: true },
  });
  await invalidateStrengthSessionActiveEnergyInTransaction(tx, sessionId, publicationBlockSourceKey);
  return updated.accountingInputRevision;
}

async function blockCompletedStrengthUnifiedInTransaction(
  tx: Prisma.TransactionClient,
  sessionId: number,
  sourceKey?: string,
  evidence: {
    recordSourceChange?: boolean;
    operationKind?: string;
    affectedExerciseIds?: readonly number[];
    affectedSetIds?: readonly number[];
    publicationBlockSourceKeys?: readonly string[];
    affectedWorkoutIds?: readonly number[];
    oldSourceIdentity?: Prisma.InputJsonValue;
    newSourceIdentity?: Prisma.InputJsonValue;
    oldEventInstants?: Prisma.InputJsonValue;
    newEventInstants?: Prisma.InputJsonValue;
    oldModelDates?: readonly string[];
    newModelDates?: readonly string[];
    evidenceComplete?: boolean;
    deadlineMode?: TrainingSourceChangeEvidence["deadlineMode"];
  } = {},
): Promise<TrainingSourceChangeEvidence | null> {
  const session = await tx.strengthDiarySession.findUnique({
    where: { id: sessionId },
    select: {
      id: true, profileId: true, status: true, effectiveAccountingAt: true,
      webStartedAt: true, createdAt: true,
      matchedWorkoutId: true,
      matchStatus: true,
      matchMethod: true,
      matchedAt: true,
      matchedWorkout: { select: { id: true, sourceIdentity: true, startAt: true, endAt: true } },
    },
  });
  if (!session || session.status !== SESSION_STATUS.COMPLETED) return null;
  const eventAt = session.matchedWorkout?.startAt
    ?? session.effectiveAccountingAt
    ?? session.webStartedAt
    ?? session.createdAt;
  // Unified and its stateful physiology shadows are partitioned by the model
  // episode timezone, not by the diary's accounting-display timezone. The
  // durable block must include the old model date so a later event move cannot
  // skip the removed event's earlier glycogen suffix.
  const episodes = await tx.modelEpisode.findMany({
    where: { profileId: session.profileId },
    orderBy: [{ startDate: "asc" }, { id: "asc" }],
    select: { id: true, startDate: true, timezone: true, active: true },
  });
  const fromDate = episodeTimeContextForInstantV1(episodes, eventAt).date;
  await new PhysiologyV7PersistenceRepository(tx).blockUnifiedPublication({
    profileId: session.profileId,
    fromDate,
    source: "training",
    sourceKey: sourceKey ?? String(session.id),
  });

  const children = await tx.strengthSessionExercise.findMany({
    where: { sessionId: session.id },
    select: { id: true, sets: { select: { id: true } } },
  });
  const affectedExerciseIds = new Set(children.map(({ id }) => id));
  const affectedSetIds = new Set(children.flatMap(({ sets }) => sets.map(({ id }) => id)));
  for (const id of evidence.affectedExerciseIds ?? []) affectedExerciseIds.add(id);
  for (const id of evidence.affectedSetIds ?? []) affectedSetIds.add(id);
  const deletedChild = sourceKey?.match(/^training-delete-(set|exercise):(\d+):(\d+)$/);
  if (deletedChild) {
    const childId = Number(deletedChild[3]);
    if (deletedChild[1] === "set") affectedSetIds.add(childId);
    else affectedExerciseIds.add(childId);
  }
  const sourceIdentity = {
    sessionId: session.id,
    matchedWorkoutId: session.matchedWorkoutId,
    workoutSourceIdentity: session.matchedWorkout?.sourceIdentity ?? null,
    matchStatus: session.matchStatus,
    matchMethod: session.matchMethod,
    matchedAt: session.matchedAt?.toISOString() ?? null,
  } satisfies Prisma.InputJsonObject;
  const sourceWasRemoved = evidence.operationKind === "training_session_deleted";
  const sourceChange: TrainingSourceChangeEvidence = {
      profileId: session.profileId,
      operationKind: evidence.operationKind
        ?? (sourceKey ? "training_child_delete" : "training_source_change"),
      affectedSessionIds: [session.id],
      affectedWorkoutIds: [...new Set([
        ...(session.matchedWorkoutId === null ? [] : [session.matchedWorkoutId]),
        ...(evidence.affectedWorkoutIds ?? []),
      ])],
      affectedExerciseIds: [...affectedExerciseIds],
      affectedSetIds: [...affectedSetIds],
      publicationBlockSourceKeys: [sourceKey ?? String(session.id)],
      ...(evidence.oldSourceIdentity !== undefined
        ? { oldSourceIdentity: evidence.oldSourceIdentity }
        : sourceWasRemoved ? { oldSourceIdentity: sourceIdentity } : {}),
      ...(sourceWasRemoved && evidence.newSourceIdentity === undefined
        ? {}
        : { newSourceIdentity: evidence.newSourceIdentity ?? sourceIdentity }),
      oldEventInstants: evidence.oldEventInstants ?? (sourceWasRemoved ? [eventAt.toISOString()] : []),
      newEventInstants: evidence.newEventInstants ?? (sourceWasRemoved ? [] : [eventAt.toISOString()]),
      oldModelDates: evidence.oldModelDates ?? (sourceWasRemoved ? [fromDate] : []),
      newModelDates: evidence.newModelDates ?? (sourceWasRemoved ? [] : [fromDate]),
      evidenceComplete: evidence.evidenceComplete,
      deadlineMode: evidence.deadlineMode,
  };
  if (evidence.recordSourceChange !== false) {
    await enqueueTrainingSourceChangeInTransaction(tx, sourceChange);
  }
  return sourceChange;
}

export function trainingChildDeletionPublicationSourceKey(
  kind: "set" | "exercise",
  sessionId: number,
  childId: number,
): string {
  return `training-delete-${kind}:${sessionId}:${childId}`;
}

async function invalidateStrengthSessionActiveEnergyInTransaction(
  tx: Prisma.TransactionClient,
  sessionId: number,
  publicationBlockSourceKey?: string,
  evidence?: Parameters<typeof blockCompletedStrengthUnifiedInTransaction>[3],
): Promise<void> {
  const session = await tx.strengthDiarySession.findUnique({
    where: { id: sessionId },
    select: {
      id: true, profileId: true, matchedWorkoutId: true, effectiveAccountingAt: true,
      accountingTimeZone: true, webStartedAt: true, createdAt: true, status: true,
      matchedWorkout: { select: { id: true, startAt: true, endAt: true } },
    },
  });
  if (!session || session.status !== SESSION_STATUS.COMPLETED) return;
  const sourceChange = await blockCompletedStrengthUnifiedInTransaction(tx, sessionId, publicationBlockSourceKey, {
    ...evidence,
    recordSourceChange: false,
  });
  const eventInstant = resolveTransientWaterV2CanonicalEventInstant(session);
  await invalidateActiveEnergySourcesInTransactionV1({
    tx,
    profileId: session.profileId,
    aliases: [
      { sourceType: "strength-session", sourceId: String(session.id) },
      ...(session.matchedWorkoutId === null ? [] : [{ sourceType: "workout", sourceId: String(session.matchedWorkoutId) }]),
    ],
    affectedInstants: [eventInstant, session.matchedWorkout?.endAt],
    staleMatchingAliasesOnly: true,
  });
  if (sourceChange && evidence?.recordSourceChange !== false) {
    await enqueueTrainingSourceChangeInTransaction(tx, sourceChange);
  }
}

async function invalidateCompletedStrengthUnifiedInTransaction(
  tx: Prisma.TransactionClient,
  sessionId: number,
): Promise<void> {
  const session = await tx.strengthDiarySession.findUnique({
    where: { id: sessionId },
    select: { profileId: true, status: true },
  });
  if (session?.status === SESSION_STATUS.COMPLETED) {
    await blockCompletedStrengthUnifiedInTransaction(tx, sessionId);
  }
}

const catalogSelect = {
  id: true,
  name: true,
  stableKey: true,
  isActive: true,
  archivedAt: true,
  muscleMapping: true,
  currentLoadAccountingConfig: { select: { configVersion: true, configuration: true } },
} satisfies Prisma.ExerciseCatalogSelect;

const programExerciseSelect = {
  id: true,
  exerciseCatalogId: true,
  sortOrder: true,
  plannedSets: true,
  resistanceType: true,
  loadAccountingConfigSnapshot: true,
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
  loadAccountingOverride: true,
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
  loadAccountingConfigSnapshot: true,
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
  manualActiveEnergyKcal: true,
  sourceIdentity: true,
  updatedAt: true,
  externalId: true,
  dailyHealthData: { select: { date: true, weightKg: true } },
} satisfies Prisma.WorkoutSelect;

const sessionDetailSelect = {
  id: true,
  profileId: true,
  status: true,
  entryMode: true,
  revision: true,
  accountingInputRevision: true,
  effectiveAccountingAt: true,
  accountingTimeZone: true,
  accountingTimeZoneProvenance: true,
  currentSnapshotRevision: true,
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
  profile: { select: { autoAdvanceExercises: true } },
  programVersion: { select: { id: true, versionNumber: true } },
  matchedWorkout: { select: matchedWorkoutSelect },
  currentAccountingSnapshot: { select: {
    snapshotRevision: true,
    accountingInputRevision: true,
    inputFingerprint: true,
    effectiveLocalDate: true,
    timeZone: true,
    timeZoneProvenance: true,
    accountingMethodVersion: true,
    massResolutionMethodVersion: true,
    massResolutionIdentity: true,
    payloadVersion: true,
    payload: true,
  } },
  accountingOperations: {
    where: { status: "PENDING" as const },
    orderBy: { createdAt: "desc" as const },
    take: 1,
    select: { id: true },
  },
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
  exercises: {
    select: {
      snapshotExerciseName: true,
      plannedSets: true,
      _count: { select: { sets: true } },
    },
  },
} satisfies Prisma.StrengthDiarySessionSelect;

type CatalogRecord = Prisma.ExerciseCatalogGetPayload<{ select: typeof catalogSelect }>;
type ProgramExerciseRecord = Prisma.ProgramExerciseGetPayload<{ select: typeof programExerciseSelect }>;
type SetRecord = Prisma.StrengthSetGetPayload<{ select: typeof setSelect }>;
type SessionExerciseRecord = Prisma.StrengthSessionExerciseGetPayload<{ select: typeof sessionExerciseSelect }>;
type MatchedWorkoutRecord = Prisma.WorkoutGetPayload<{ select: typeof matchedWorkoutSelect }>;
type SessionDetailRecord = Prisma.StrengthDiarySessionGetPayload<{ select: typeof sessionDetailSelect }>;

function effectiveAccountingInstant(record: SessionDetailRecord): Date {
  return record.effectiveAccountingAt
    ?? record.matchedWorkout?.startAt
    ?? record.webStartedAt
    ?? record.createdAt;
}

function effectiveAccountingLocalDate(record: SessionDetailRecord, timeZone: string): string {
  return instantToLocalDateTime(effectiveAccountingInstant(record), timeZone).date;
}

function currentSnapshotForRecord(record: SessionDetailRecord): {
  state: "current" | "missing" | "pending" | "stale";
  payload: ReturnType<typeof persistedPayloadFromUnknown>;
} {
  if (record.currentSnapshotRevision === null) {
    return { state: record.accountingOperations.length > 0 ? "pending" : "missing", payload: null };
  }
  const snapshot = record.currentAccountingSnapshot;
  if (!snapshot || snapshot.snapshotRevision !== record.currentSnapshotRevision) {
    return { state: "stale", payload: null };
  }
  const payload = isPersistedLoadAccountingPayloadVersion(snapshot.payloadVersion)
    ? persistedPayloadFromUnknown(snapshot.payload) : null;
  if (!payload || payload.schemaVersion !== snapshot.payloadVersion) return { state: "stale", payload: null };
  const timeZone = record.accountingTimeZone ?? DEFAULT_TIME_ZONE;
  const timeZoneProvenance = record.accountingTimeZoneProvenance ?? "legacy-default";
  if (!isValidTimeZone(timeZone)) return { state: "stale", payload: null };
  const localDate = effectiveAccountingLocalDate(record, timeZone);
  const expectedMassIdentity = buildMassResolutionIdentity({
    localDate,
    timeZone,
    methodVersion: BODYWEIGHT_RESOLUTION_METHOD_V2,
    reference: payload.massReference,
  });
  const fresh = snapshot.accountingInputRevision === record.accountingInputRevision
    && payload.sessionId === record.id
    && payload.snapshotRevision === snapshot.snapshotRevision
    && payload.accountingInputRevision === record.accountingInputRevision
    && payload.effectiveAccountingAt === effectiveAccountingInstant(record).toISOString()
    && payload.effectiveLocalDate === localDate
    && payload.timeZone === timeZone
    && payload.timeZoneProvenance === timeZoneProvenance
    && payload.accountingMethodVersion === LOAD_ACCOUNTING_METHOD_V1
    && payload.massResolutionMethodVersion === BODYWEIGHT_RESOLUTION_METHOD_V2
    && payload.massResolutionIdentity === expectedMassIdentity
    && snapshot.effectiveLocalDate === localDate
    && snapshot.timeZone === timeZone
    && snapshot.timeZoneProvenance === timeZoneProvenance
    && snapshot.accountingMethodVersion === LOAD_ACCOUNTING_METHOD_V1
    && snapshot.massResolutionMethodVersion === BODYWEIGHT_RESOLUTION_METHOD_V2
    && snapshot.massResolutionIdentity === expectedMassIdentity;
  return fresh ? { state: "current", payload } : { state: "stale", payload: null };
}

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
    loadAccountingConfig: record.currentLoadAccountingConfig?.configuration ?? null,
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
    loadAccountingConfigSnapshot: record.loadAccountingConfigSnapshot ?? null,
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
    loadAccountingOverride: record.loadAccountingOverride ?? null,
  };
}

function toSessionExerciseDto(record: SessionExerciseRecord): StrengthSessionExerciseDto {
  return {
    id: record.id,
    sourceExerciseCatalogId: record.sourceExerciseCatalogId,
    stableKey: historicalExerciseStableKey(record.muscleMappingSnapshot, record.sourceExerciseCatalog?.stableKey),
    snapshotExerciseName: record.snapshotExerciseName,
    order: record.sortOrder,
    plannedSets: record.plannedSets,
    resistanceType: record.resistanceType as ResistanceType,
    origin: asExerciseOrigin(record.origin),
    muscleMappingSnapshot: record.muscleMappingSnapshot ?? null,
    loadAccountingConfigSnapshot: record.loadAccountingConfigSnapshot ?? null,
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
    manualActiveEnergyKcal: record.manualActiveEnergyKcal,
    externalId: record.externalId,
  };
}

async function resolveSessionBodyweightReference(
  profileId: number,
  db: PrismaClient,
  record: SessionDetailRecord,
  localDate: string,
  timeZone: string,
): Promise<BodyweightReferenceV1> {
  const unavailable: BodyweightReferenceV1 = {
    status: "unavailable", valueKg: null, localDate, source: null, sourceId: null,
  };
  if (!record.exercises.some((exercise) => (
    exercise.resistanceType === RESISTANCE.BODYWEIGHT && exercise.sets.length > 0
  ))) return unavailable;
  return resolveSessionHistoricalMassReferenceV1(profileId, db, localDate, timeZone);
}

function calculateSessionLoadAccounting(
  record: SessionDetailRecord,
  localDate: string,
  bodyweightReference: BodyweightReferenceV1,
) {
  return calculateLoadAccountingWithBreakdownV1({
    sessionId: record.id,
    localDate,
    bodyweightReference,
    exercises: record.exercises.map((exercise) => {
      const stableKey = historicalExerciseStableKey(
        exercise.muscleMappingSnapshot,
        exercise.sourceExerciseCatalog?.stableKey,
      );
      const identityClass = classifyPersistedExerciseIdentityV1({
        sourceExerciseCatalogId: exercise.sourceExerciseCatalogId,
        snapshotStableKey: exercise.muscleMappingSnapshot ? stableKey : null,
        catalogStableKey: exercise.sourceExerciseCatalog?.stableKey ?? null,
      });
      const identity: IdentityStatusV1 = identityClass === "canonical"
        ? "canonical-snapshot"
        : identityClass === "legacy" ? "known-legacy"
          : identityClass === "custom" ? "custom" : "ambiguous";
      const config = exercise.loadAccountingConfigSnapshot;
      const configParsed = config == null ? null : loadConfigV1Schema.safeParse(config);
      const configValue = configParsed?.success ? configParsed.data : config;
      const provenance = configParsed?.success
        ? {
          kind: configParsed.data.configVersion === LEGACY_LOAD_INTERPRETATION_V1
            ? "legacy-interpretation" as const : "session-snapshot" as const,
          version: configParsed.data.configVersion,
          stableKey: stableKey ?? undefined,
        }
        : undefined;
      return {
        sessionExerciseId: exercise.id,
        exerciseOrder: exercise.sortOrder,
        exerciseName: exercise.snapshotExerciseName,
        identity: { status: identity, stableKey },
        resistanceHint: exercise.resistanceType === "RESISTANCE_BAND" ? "band-nominal" as const
          : exercise.resistanceType === "BODYWEIGHT" ? "bodyweight" as const
            : "external" as const,
        configSnapshot: configValue,
        configProvenance: provenance,
        sets: exercise.sets.map((set) => ({
          strengthSetId: set.id,
          setNumber: set.setNumber,
          reps: set.reps,
          weightKg: decimalToNumber(set.weightKg),
          bandNominalResistanceKg: decimalToNumber(set.bandNominalResistanceKg),
          override: set.loadAccountingOverride,
        })),
      };
    }),
  });
}

export function toSessionDto(
  record: SessionDetailRecord,
  loadAccountingV1?: LoadAccountingOutputV1,
  materializationState: "current" | "missing" | "pending" | "stale" = "missing",
  loadAccountingBreakdown?: StrengthSessionDto["loadAccountingBreakdown"],
  activeEnergyMassReference?: StrengthSessionDto["activeEnergyMassReference"],
  canonicalActiveEnergy?: {
    currentKcal: number | null;
    currentSource: string | null;
    resolutionRevision: number;
    isStale: boolean;
  } | null,
): StrengthSessionDto {
  const exercises = record.exercises.map(toSessionExerciseDto);
  const tonnageSets = exercises.flatMap((exercise) =>
    exercise.sets.map((set) => ({
      resistanceType: exercise.resistanceType,
      reps: set.reps,
      weightKg: set.weightKg,
      stableKey: exercise.stableKey,
    })),
  );

  const sessionWithoutEnergy: StrengthSessionDto = {
    id: record.id,
    status: record.status as SessionStatus,
    entryMode: asEntryMode(record.entryMode),
    revision: record.revision,
    programId: record.programId,
    programName: record.program?.name ?? null,
    programVersionId: record.programVersionId,
    programVersionNumber: record.programVersion?.versionNumber ?? null,
    webStartedAt: record.webStartedAt?.toISOString() ?? null,
    webEndedAt: record.webEndedAt?.toISOString() ?? null,
    effectiveAccountingAt: effectiveAccountingInstant(record).toISOString(),
    accountingTimeZone: record.accountingTimeZone ?? DEFAULT_TIME_ZONE,
    accountingTimeZoneProvenance: record.accountingTimeZoneProvenance ?? "legacy-default",
    matchStatus: record.matchStatus as MatchStatus,
    matchMethod: (record.matchMethod as MatchMethod | null) ?? null,
    matchedAt: record.matchedAt?.toISOString() ?? null,
    matchedWorkoutId: record.matchedWorkoutId,
    matchedWorkout: toMatchedWorkoutDto(record.matchedWorkout),
    exercises,
    ordinaryTonnageKg: ordinaryExternalWeightTonnageKg(tonnageSets),
    loadAccountingV1,
    ...(loadAccountingBreakdown ? { loadAccountingBreakdown } : {}),
    materializationState,
    activeEnergyMassReference: activeEnergyMassReference ?? null,
    autoAdvanceExercises: record.profile?.autoAdvanceExercises ?? false,
    ...planCompletionFields(exercises),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
  return {
    ...sessionWithoutEnergy,
    selectedActiveEnergy: (() => {
      const selected = selectPersistedEnergyResolutionV1({
        resolution: canonicalActiveEnergy ?? {
          currentKcal: null, currentSource: null, resolutionRevision: 0, isStale: true,
        },
        classification: "traditional-strength-training",
      });
      return {
        status: selected.selectedKcal === null || canonicalActiveEnergy?.isStale === true ? "unavailable" : "current",
        kcal: selected.selectedKcal,
        source: selected.source,
        fullCoverage: selected.fullCoverage,
        resolutionRevision: canonicalActiveEnergy?.resolutionRevision ?? null,
      };
    })(),
  };
}

async function toSessionDtoWithHistoricalMass(
  db: PrismaClient,
  record: SessionDetailRecord,
): Promise<StrengthSessionDto> {
  const aliases = await db.activeEnergyEventAlias.findMany({
    where: {
      profileId: record.profileId,
      OR: [
        { sourceType: "strength-session", sourceId: String(record.id) },
        ...(record.matchedWorkoutId === null ? [] : [{ sourceType: "workout", sourceId: String(record.matchedWorkoutId) }]),
      ],
    },
    select: {
      sourceType: true,
      event: { select: { currentKcal: true, currentSource: true, resolutionRevision: true, isStale: true } },
    },
  });
  const canonicalAlias = aliases.find((alias) => alias.sourceType === "strength-session") ?? aliases[0] ?? null;
  const snapshot = currentSnapshotForRecord(record);
  const payload = snapshot.state === "current" ? snapshot.payload : null;
  const breakdown = payload && "breakdown" in payload
    ? { status: "available" as const, value: payload.breakdown }
    : payload
      ? { status: "unavailable" as const, reason: "legacy-snapshot-no-breakdown" as const }
      : undefined;
  return toSessionDto(
    record,
    payload?.result,
    snapshot.state,
    breakdown,
    payload ? {
      reference: payload.massReference,
      snapshotRevision: payload.snapshotRevision,
      inputFingerprint: payload.inputFingerprint,
      massResolutionIdentity: payload.massResolutionIdentity,
    } : null,
    canonicalAlias?.event ?? null,
  );
}

export async function hideSessionDerivedResultsWhileTrainingRefreshIsPending(
  db: PrismaClient,
  profileId: number,
  trainingFence: Awaited<ReturnType<typeof readTrainingRefreshVisibilityFence>>,
  session: StrengthSessionDto,
): Promise<StrengthSessionDto> {
  const convergenceFence = await readActiveEnergyConvergenceVisibilityFence(db, profileId);
  const workerOwnsGeneration = await trainingRefreshWorkerOwnsGeneration(
    db, profileId, trainingFence?.requestedGeneration,
  );
  if (convergenceFence?.active === true
      || (isTrainingRefreshPending(trainingFence) && !workerOwnsGeneration)
      || await trainingRefreshFenceChanged(db, profileId, trainingFence)
      || await activeEnergyConvergenceFenceChanged(db, profileId, convergenceFence)) {
    return {
      ...session,
      // Session accounting has its own source revision and fingerprint. Keep
      // that independently current Training view available while the shared
      // physiology generation is pending; only hide the model-derived energy
      // selection until its generation is published.
      selectedActiveEnergy: {
        status: "pending",
        kcal: null,
        source: "unavailable",
        fullCoverage: false,
        resolutionRevision: null,
      },
    };
  }
  return session;
}

export async function readActiveEnergyMassReferencesV1(
  db: PrismaClient,
  input: { sessionIds: readonly number[]; profileId: number },
): Promise<Map<number, NonNullable<StrengthSessionDto["activeEnergyMassReference"]>>> {
  const sessionIds = [...new Set(input.sessionIds)];
  if (sessionIds.length === 0) return new Map();
  const rows = await db.strengthDiarySession.findMany({
    where: { profileId: input.profileId, id: { in: sessionIds } },
    select: sessionDetailSelect,
  });
  const references = new Map<number, NonNullable<StrengthSessionDto["activeEnergyMassReference"]>>();
  for (const row of rows) {
    const snapshot = currentSnapshotForRecord(row);
    const payload = snapshot.state === "current" ? snapshot.payload : null;
    if (payload === null) continue;
    const reference = await resolveStrengthEnergyMassReferenceV1(db, {
      profileId: input.profileId,
      stage02Mass: {
        reference: payload.massReference,
        snapshotRevision: payload.snapshotRevision,
        inputFingerprint: payload.inputFingerprint,
        massResolutionIdentity: payload.massResolutionIdentity,
      },
      localDate: payload.effectiveLocalDate,
      timeZone: payload.timeZone,
    });
    if (reference !== null) references.set(row.id, reference);
  }
  return references;
}

function planCompletionFields(
  exercises: ReadonlyArray<{
    snapshotExerciseName: string;
    plannedSets: number;
    sets: ReadonlyArray<unknown> | { length: number };
  }>,
) {
  const completion = sessionPlanCompletion(exercises);
  return {
    loggedSets: completion.loggedSets,
    plannedSets: completion.plannedSets,
    planCompletionPercent: completion.percent,
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
    programName: record.program?.name ?? null,
    webStartedAt: record.webStartedAt?.toISOString() ?? null,
    webEndedAt: record.webEndedAt?.toISOString() ?? null,
    matchStatus: record.matchStatus as MatchStatus,
    matchMethod: (record.matchMethod as MatchMethod | null) ?? null,
    matchedWorkoutId: record.matchedWorkoutId,
    occurrenceAt: occurrenceInstant(record)?.toISOString() ?? null,
    ...planCompletionFields(record.exercises.map((exercise) => ({
      snapshotExerciseName: exercise.snapshotExerciseName,
      plannedSets: exercise.plannedSets,
      sets: { length: exercise._count.sets },
    }))),
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

function nullableJsonInput(value: Prisma.InputJsonValue | null): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return value === null ? Prisma.DbNull : value;
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

async function assertSessionExerciseIds(
  tx: Prisma.TransactionClient,
  sessionId: number,
  profileId: number,
  exerciseIds: readonly number[],
): Promise<void> {
  const requested = new Set(exerciseIds);
  const rows = await tx.strengthSessionExercise.findMany({
    where: { sessionId, session: { profileId } },
    select: { id: true },
  });
  if (requested.size !== exerciseIds.length || rows.length !== exerciseIds.length
      || rows.some(({ id }) => !requested.has(id))) {
    throw new TrainingConcurrentMutationError();
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
  loadAccountingConfigSnapshot: Prisma.InputJsonValue | null;
};

export class TrainingRepository {
  constructor(private readonly db: PrismaClient = prisma) {}

  async listCatalog(options: {
    profileId: number;
    activeOnly?: boolean;
  }): Promise<ExerciseCatalogDto[]> {
    const profileId = requireProfileId(options.profileId);
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
   * Bootstrap/upsert the supported exercises with explicit portable keys.
   * Never silently overwrites a conflicting non-null stableKey. Display-name
   * renames of already-keyed rows are left untouched.
   */
  async ensureCanonicalExerciseCatalog(
    profileId: number,
  ): Promise<ExerciseCatalogDto[]> {
    profileId = requireProfileId(profileId);
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

  async findCatalogByIds(ids: number[], profileId: number) {
    profileId = requireProfileId(profileId);
    return this.db.exerciseCatalog.findMany({
      where: { profileId, id: { in: ids } },
      select: {
        id: true, name: true, stableKey: true, isActive: true, muscleMapping: true,
        currentLoadAccountingConfig: { select: { configVersion: true, configuration: true } },
      },
    });
  }

  async setCatalogLoadAccountingConfig(input: {
    catalogId: number;
    profileId: number;
    config: Prisma.InputJsonValue | null;
    configVersion?: string;
  }): Promise<boolean> {
    const profileId = requireProfileId(input.profileId);
    return this.db.$transaction(async (tx) => {
      const catalog = await tx.exerciseCatalog.findFirst({
        where: { id: input.catalogId, profileId },
        select: { id: true },
      });
      if (!catalog) return false;
      if (input.config === null || input.configVersion === undefined) {
        await tx.exerciseCatalog.update({
          where: { profileId_id: { profileId, id: catalog.id } },
          data: { currentLoadAccountingConfigId: null },
        });
        return true;
      }
      const version = await tx.exerciseLoadConfiguration.create({
        data: {
          profileId,
          exerciseCatalogId: catalog.id,
          configVersion: input.configVersion,
          configuration: input.config,
        },
        select: { id: true },
      });
      await tx.exerciseCatalog.update({
        where: { profileId_id: { profileId, id: catalog.id } },
        data: { currentLoadAccountingConfigId: version.id },
      });
      return true;
    });
  }

  async listPrograms(options: {
    profileId: number;
    includeArchived?: boolean;
  }): Promise<TrainingProgramSummaryDto[]> {
    const profileId = requireProfileId(options.profileId);
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
    profileId: number,
  ): Promise<TrainingProgramDto | null> {
    profileId = requireProfileId(profileId);
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
    profileId: number;
    name: string;
    exercises: OrderedProgramExerciseWrite[];
  }): Promise<TrainingProgramDto> {
    const profileId = requireProfileId(input.profileId);

    const created = await this.db.$transaction(async (tx) => {
      const program = await tx.trainingProgram.create({
        data: { profileId, name: input.name },
        select: { id: true },
      });
      const version = await tx.trainingProgramVersion.create({
        data: {
          profileId,
          programId: program.id,
          versionNumber: 1,
          exercises: {
            create: input.exercises.map((exercise) => ({
              sortOrder: exercise.sortOrder,
              plannedSets: exercise.plannedSets,
              resistanceType: exercise.resistanceType,
              loadAccountingConfigSnapshot: nullableJsonInput(exercise.loadAccountingConfigSnapshot),
              exerciseCatalog: {
                connect: { profileId_id: { profileId, id: exercise.exerciseCatalogId } },
              },
              profile: { connect: { id: profileId } },
            })),
          },
        },
        select: { id: true },
      });
      await tx.trainingProgram.update({
        where: { profileId_id: { profileId, id: program.id } },
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
    profileId: number;
    name?: string;
    exercises?: OrderedProgramExerciseWrite[];
  }): Promise<TrainingProgramDto | null> {
    const profileId = requireProfileId(input.profileId);

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
                  loadAccountingConfigSnapshot: true,
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
          loadAccountingConfigSnapshot: exercise.loadAccountingConfigSnapshot as Prisma.InputJsonValue | null,
        }));

      const nextVersionNumber = (existing.currentVersion?.versionNumber ?? 0) + 1;
      const version = await tx.trainingProgramVersion.create({
        data: {
          profileId,
          programId: existing.id,
          versionNumber: nextVersionNumber,
          exercises: {
            create: nextExercises.map((exercise) => ({
              sortOrder: exercise.sortOrder,
              plannedSets: exercise.plannedSets,
              resistanceType: exercise.resistanceType,
              loadAccountingConfigSnapshot: nullableJsonInput(exercise.loadAccountingConfigSnapshot),
              exerciseCatalog: {
                connect: { profileId_id: { profileId, id: exercise.exerciseCatalogId } },
              },
              profile: { connect: { id: profileId } },
            })),
          },
        },
        select: { id: true },
      });

      await tx.trainingProgram.update({
        where: { profileId_id: { profileId, id: existing.id } },
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
    profileId: number,
    archivedAt: Date = new Date(),
  ): Promise<TrainingProgramDto | null> {
    profileId = requireProfileId(profileId);
    const existing = await this.db.trainingProgram.findFirst({
      where: { id: programId, profileId },
      select: { id: true, archivedAt: true },
    });
    if (!existing) return null;
    if (existing.archivedAt) return this.getProgram(programId, profileId);

    await this.db.trainingProgram.update({
      where: { profileId_id: { profileId, id: programId } },
      data: { archivedAt },
    });
    return this.getProgram(programId, profileId);
  }

  async getActiveSession(profileId: number): Promise<StrengthSessionDto | null> {
    profileId = requireProfileId(profileId);
    const trainingFence = await readTrainingRefreshVisibilityFence(this.db, profileId);
    const row = await this.db.strengthDiarySession.findFirst({
      where: { profileId, status: SESSION_STATUS.ACTIVE },
      select: sessionDetailSelect,
    });
    if (!row) return null;
    const session = await toSessionDtoWithHistoricalMass(this.db, row);
    return hideSessionDerivedResultsWhileTrainingRefreshIsPending(this.db, profileId, trainingFence, session);
  }

  async finishInactiveSessions(input: { profileId: number; now?: Date }): Promise<Array<{ id: number; endAt: Date }>> {
    const profileId = requireProfileId(input.profileId);
    const now = input.now ?? new Date();
    const rows = (await this.db.strengthDiarySession.findMany({
      where: { profileId, status: SESSION_STATUS.ACTIVE },
      select: { id: true, exercises: { select: { sets: { select: { completedAt: true, createdAt: true } } } } },
    })) ?? [];
    const expired: Array<{ id: number; endAt: Date }> = [];
    for (const row of rows) {
      const lastSetAt = row.exercises.flatMap((exercise) => exercise.sets)
        .map((set) => set.completedAt ?? set.createdAt)
        .sort((left, right) => right.getTime() - left.getTime())[0] ?? null;
      const decision = evaluateSessionInactivity({ status: SESSION_STATUS.ACTIVE, lastSetAt, now });
      if (decision.action !== "finish") continue;
      expired.push({ id: row.id, endAt: decision.endAt });
    }
    return expired;
  }

  async getSession(
    sessionId: number,
    profileId: number,
  ): Promise<StrengthSessionDto | null> {
    profileId = requireProfileId(profileId);
    const trainingFence = await readTrainingRefreshVisibilityFence(this.db, profileId);
    const row = await this.db.strengthDiarySession.findFirst({
      where: { id: sessionId, profileId },
      select: sessionDetailSelect,
    });
    if (!row) return null;
    const session = await toSessionDtoWithHistoricalMass(this.db, row);
    return hideSessionDerivedResultsWhileTrainingRefreshIsPending(this.db, profileId, trainingFence, session);
  }

  /** Complete, non-paginated source set for transient-water reconstruction. */
  async listCompletedTransientWaterSourcesV2(profileId: number): Promise<Array<{
    session: StrengthSessionDto;
    canonicalEventInstant: Date;
    sourceDependencyFingerprint: string;
  }>> {
    profileId = requireProfileId(profileId);
    return TrainingRepository.listCompletedTransientWaterSourcesV2FromClient(this.db, profileId);
  }

  static async listCompletedTransientWaterSourcesV2FromClient(
    db: Pick<PrismaClient, "strengthDiarySession"> | Prisma.TransactionClient,
    profileId: number,
  ): Promise<Array<{
    session: StrengthSessionDto;
    canonicalEventInstant: Date;
    sourceDependencyFingerprint: string;
  }>> {
    profileId = requireProfileId(profileId);
    const rows = await db.strengthDiarySession.findMany({
      where: { profileId, status: SESSION_STATUS.COMPLETED },
      orderBy: [{ id: "asc" }],
      select: sessionDetailSelect,
    });
    return rows.map((record) => {
      const canonicalEventInstant = resolveTransientWaterV2CanonicalEventInstant(record);
      const sourceDependencyFingerprint = stableSha256({
        session: {
          id: record.id,
          profileId: record.profileId,
          status: record.status,
          revision: record.revision,
          accountingInputRevision: record.accountingInputRevision,
          currentSnapshotRevision: record.currentSnapshotRevision,
          effectiveAccountingAt: record.effectiveAccountingAt,
          webStartedAt: record.webStartedAt,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
          matchedWorkoutId: record.matchedWorkoutId,
          matchStatus: record.matchStatus,
          programVersionId: record.programVersionId,
          programVersionNumber: record.programVersion?.versionNumber ?? null,
          exercises: record.exercises.map((exercise) => ({
            id: exercise.id,
            order: exercise.sortOrder,
            origin: exercise.origin,
            resistanceType: exercise.resistanceType,
            mappingSnapshot: exercise.muscleMappingSnapshot,
            loadAccountingConfigSnapshot: exercise.loadAccountingConfigSnapshot,
            sets: exercise.sets.map((set) => ({
              id: set.id,
              setNumber: set.setNumber,
              reps: set.reps,
              rir: set.rir,
              weightKg: set.weightKg,
              bandNominalResistanceKg: set.bandNominalResistanceKg,
              completedAt: set.completedAt,
              createdAt: set.createdAt,
              updatedAt: set.updatedAt,
              loadAccountingOverride: set.loadAccountingOverride,
            })),
          })),
        },
        matchedWorkout: record.matchedWorkout === null ? null : {
          id: record.matchedWorkout.id,
          startAt: record.matchedWorkout.startAt,
          endAt: record.matchedWorkout.endAt,
          updatedAt: record.matchedWorkout.updatedAt,
          sourceIdentity: record.matchedWorkout.sourceIdentity,
          externalId: record.matchedWorkout.externalId,
          type: record.matchedWorkout.type,
        },
      });
      return {
        session: toSessionDto(record),
        canonicalEventInstant,
        sourceDependencyFingerprint,
      };
    });
  }

  async updateAccountingContext(input: {
    sessionId: number;
    profileId: number;
    effectiveAccountingAt?: Date;
    timeZone?: string;
  }): Promise<void> {
    const profileId = requireProfileId(input.profileId);
    await this.db.$transaction(async (tx) => {
      await new PhysiologyV7PersistenceRepository(tx).lockProfile(profileId);
      await tx.$queryRaw<Array<{ id: number }>>`
        SELECT "id" FROM "StrengthDiarySession"
        WHERE "id" = ${input.sessionId} AND "profileId" = ${profileId}
        FOR UPDATE
      `;
      const session = await tx.strengthDiarySession.findFirst({
        where: { id: input.sessionId, profileId },
        select: {
          effectiveAccountingAt: true, webStartedAt: true, createdAt: true,
          status: true,
          accountingTimeZone: true, accountingTimeZoneProvenance: true,
          matchedWorkoutId: true, matchStatus: true, matchMethod: true, matchedAt: true,
          matchedWorkout: { select: { id: true, sourceIdentity: true, startAt: true, endAt: true } },
        },
      });
      if (!session) throw new Error("session not found for accounting context update");
      const effectiveAt = input.effectiveAccountingAt
        ?? session.effectiveAccountingAt ?? session.webStartedAt ?? session.createdAt;
      const timeZone = input.timeZone ?? session.accountingTimeZone ?? DEFAULT_TIME_ZONE;
      const timeZoneProvenance = input.timeZone
        ? "client-session"
        : session.accountingTimeZoneProvenance ?? "legacy-default";
      const oldEffectiveAt = session.effectiveAccountingAt ?? session.webStartedAt ?? session.createdAt;
      const oldTimeZone = session.accountingTimeZone ?? DEFAULT_TIME_ZONE;
      const oldProvenance = session.accountingTimeZoneProvenance ?? "legacy-default";
      if (effectiveAt.getTime() === oldEffectiveAt.getTime()
          && timeZone === oldTimeZone && timeZoneProvenance === oldProvenance) return;
      const effectiveLocalDate = instantToLocalDateTime(effectiveAt, timeZone).date;
      const sameAccountingDay = timeZone === oldTimeZone
        && timeZoneProvenance === oldProvenance
        && effectiveLocalDate === instantToLocalDateTime(oldEffectiveAt, oldTimeZone).date;
      if (session.status === SESSION_STATUS.COMPLETED) {
        // Persist the old occurrence boundary before the event timestamp is
        // replaced. The post-write fence below adds the new boundary; the
        // durable block keeps the earliest date until all shadows are rebuilt.
        await blockCompletedStrengthUnifiedInTransaction(tx, input.sessionId, undefined, {
          recordSourceChange: false,
        });
      }
      await tx.strengthDiarySession.update({
        where: { id: input.sessionId },
        data: {
          effectiveAccountingAt: effectiveAt,
          accountingTimeZone: timeZone,
          accountingTimeZoneProvenance: timeZoneProvenance,
          ...(sameAccountingDay ? {} : {
            accountingInputRevision: { increment: 1 },
            currentSnapshotRevision: null,
          }),
        },
      });
      if (sameAccountingDay && effectiveAt.getTime() !== oldEffectiveAt.getTime()) {
        await rebaseCurrentAccountingSnapshotTimestamp(tx, {
          sessionId: input.sessionId,
          effectiveAccountingAt: effectiveAt,
          effectiveLocalDate,
          timeZone,
          timeZoneProvenance,
        });
      }
      // Only completed sessions are materialized into production Active
      // Energy and its Unified consumers. Editing an active session's planned
      // accounting context must not stale a published production generation
      // that does not yet include that session.
      if (session.status === SESSION_STATUS.COMPLETED) {
        await invalidateActiveEnergySourcesInTransactionV1({
          tx,
          profileId,
          aliases: [
            { sourceType: "strength-session", sourceId: String(input.sessionId) },
            ...(session.matchedWorkoutId === null ? [] : [{
              sourceType: "workout" as const,
              sourceId: String(session.matchedWorkoutId),
            }]),
          ],
          affectedInstants: [
            oldEffectiveAt,
            effectiveAt,
            session.matchedWorkout?.startAt ?? oldEffectiveAt,
            session.matchedWorkout?.endAt,
          ],
          staleMatchingAliasesOnly: true,
        });
        const episodes = await tx.modelEpisode.findMany({
          where: { profileId },
          orderBy: [{ startDate: "asc" }, { id: "asc" }],
          select: { id: true, startDate: true, timezone: true, active: true },
        });
        const oldEventAt = session.matchedWorkout?.startAt ?? oldEffectiveAt;
        const newEventAt = session.matchedWorkout?.startAt ?? effectiveAt;
        const oldModelDate = episodeTimeContextForInstantV1(episodes, oldEventAt).date;
        const newModelDate = episodeTimeContextForInstantV1(episodes, newEventAt).date;
        const oldSourceIdentity = {
          sessionId: input.sessionId,
          matchedWorkoutId: session.matchedWorkoutId,
          workoutSourceIdentity: session.matchedWorkout?.sourceIdentity ?? null,
          effectiveAccountingAt: oldEffectiveAt.toISOString(),
          accountingTimeZone: oldTimeZone,
          matchStatus: session.matchStatus,
          matchMethod: session.matchMethod,
          matchedAt: session.matchedAt?.toISOString() ?? null,
        } satisfies Prisma.InputJsonObject;
        const newSourceIdentity = {
          sessionId: input.sessionId,
          matchedWorkoutId: session.matchedWorkoutId,
          workoutSourceIdentity: session.matchedWorkout?.sourceIdentity ?? null,
          effectiveAccountingAt: effectiveAt.toISOString(),
          accountingTimeZone: timeZone,
          matchStatus: session.matchStatus,
          matchMethod: session.matchMethod,
          matchedAt: session.matchedAt?.toISOString() ?? null,
        } satisfies Prisma.InputJsonObject;
        await blockCompletedStrengthUnifiedInTransaction(tx, input.sessionId, undefined, {
          operationKind: "accounting_context_relocated",
          oldSourceIdentity,
          newSourceIdentity,
          oldEventInstants: [oldEventAt.toISOString()],
          newEventInstants: [newEventAt.toISOString()],
          oldModelDates: [oldModelDate],
          newModelDates: [newModelDate],
        });
      }
    });
  }

  /** Controlled Stage 02 write path. GET never calls this method. */
  async materializeAccounting(input: {
    sessionId: number;
    profileId: number;
    mode?: "ordinary" | "refresh";
    idempotencyKey?: string;
    finalizeAt?: Date;
    /** Source context for any durable replay evidence emitted by a completed snapshot refresh. */
    deadlineMode?: TrainingRefreshDeadlineMode;
    /** Health day whose changed bodyweight caused this completed snapshot refresh. */
    dependentHealthDate?: string;
  }): Promise<number> {
    const profileId = requireProfileId(input.profileId);
    const mode = input.mode ?? "ordinary";
    const record = await this.db.strengthDiarySession.findFirst({
      where: { id: input.sessionId, profileId },
      select: sessionDetailSelect,
    });
    if (!record) throw new Error("session not found for accounting materialization");

    const timeZone = record.accountingTimeZone ?? DEFAULT_TIME_ZONE;
    if (!isValidTimeZone(timeZone)) throw new Error("stored session timezone is invalid");
    const timeZoneProvenance = record.accountingTimeZoneProvenance ?? "legacy-default";
    const effectiveAt = effectiveAccountingInstant(record);
    const localDate = instantToLocalDateTime(effectiveAt, timeZone).date;
    const operationKey = input.idempotencyKey
      ?? `${mode}:${record.id}:${record.accountingInputRevision}:${randomUUID()}`;
    const requestDigest = sha256Canonical({ sessionId: record.id, mode });

    // Fast ordinary no-op: take the session lock and verify the persisted
    // pointer before returning, so GET/reopen paths never replay physiology.
    const alreadyCurrent = mode === "ordinary" ? await this.db.$transaction(async (tx) => {
      await new PhysiologyV7PersistenceRepository(tx).lockProfile(profileId);
      await tx.$queryRaw<Array<{ id: number }>>`
        SELECT "id" FROM "StrengthDiarySession"
        WHERE "id" = ${record.id} AND "profileId" = ${profileId}
        FOR UPDATE
      `;
      const locked = await tx.strengthDiarySession.findFirst({
        where: { id: record.id, profileId }, select: sessionDetailSelect,
      });
      if (!locked) throw new Error("session missing during accounting materialization");
      const duplicate = await tx.strengthSessionAccountingOperation.findUnique({
        where: { sessionId_idempotencyKey: { sessionId: record.id, idempotencyKey: operationKey } },
        select: { requestDigest: true, status: true, resultSnapshotRevision: true },
      });
      if (duplicate) {
        if (duplicate.requestDigest !== requestDigest) throw new Error("idempotency key reused with a different request");
        if (duplicate.status === "COMPLETED" && duplicate.resultSnapshotRevision !== null) return duplicate.resultSnapshotRevision;
        throw new Error("accounting operation is not complete");
      }
      const fresh = currentSnapshotForRecord(locked);
      if (fresh.state !== "current" || locked.currentSnapshotRevision === null) return null;
      if (input.finalizeAt) {
        const finalized = await tx.strengthDiarySession.updateMany({
          where: { id: record.id, profileId, status: SESSION_STATUS.ACTIVE },
          data: { status: SESSION_STATUS.COMPLETED, webEndedAt: input.finalizeAt },
        });
        if (finalized.count > 0) {
          await invalidateStrengthSessionActiveEnergyInTransaction(tx, record.id, undefined, {
            ...(input.deadlineMode === undefined ? {} : { deadlineMode: input.deadlineMode }),
            ...(input.dependentHealthDate === undefined ? {} : {
              operationKind: "health_weight_accounting_refresh",
              oldModelDates: [input.dependentHealthDate],
              newModelDates: [input.dependentHealthDate],
            }),
          });
        }
      }
      await tx.strengthSessionAccountingOperation.create({
        data: {
          sessionId: record.id, idempotencyKey: operationKey, requestDigest,
          status: "COMPLETED", resultSnapshotRevision: locked.currentSnapshotRevision,
        },
      });
      return locked.currentSnapshotRevision;
    }) : null;
    if (alreadyCurrent !== null) return alreadyCurrent;

    let massReference: BodyweightReferenceV1 | null = null;
    if (mode === "ordinary") {
      const previous = await this.db.strengthSessionAccountingSnapshot.findMany({
        where: {
          sessionId: record.id,
          effectiveLocalDate: localDate,
          timeZone,
          timeZoneProvenance,
          massResolutionMethodVersion: BODYWEIGHT_RESOLUTION_METHOD_V2,
        },
        orderBy: { snapshotRevision: "desc" },
        take: 20,
        select: { payloadVersion: true, payload: true },
      });
      for (const candidate of previous) {
        if (!isPersistedLoadAccountingPayloadVersion(candidate.payloadVersion)) continue;
        const parsed = persistedPayloadFromUnknown(candidate.payload);
        if (parsed && parsed.schemaVersion === candidate.payloadVersion
            && parsed.massReference.status !== "unavailable") {
          massReference = parsed.massReference;
          break;
        }
      }
    }
    if (!massReference) {
      massReference = await resolveSessionBodyweightReference(
        profileId,
        this.db,
        record,
        localDate,
        timeZone,
      );
    }

    const accounting = calculateSessionLoadAccounting(record, localDate, massReference);
    const result = accounting.result;
    const breakdown = accounting.breakdown;
    const massResolutionIdentity = buildMassResolutionIdentity({
      localDate,
      timeZone,
      methodVersion: BODYWEIGHT_RESOLUTION_METHOD_V2,
      reference: massReference,
    });
    const inputFingerprint = sha256Canonical({
      effectiveLocalDate: localDate,
      timeZone,
      timeZoneProvenance,
      accountingMethodVersion: LOAD_ACCOUNTING_METHOD_V1,
      massResolutionMethodVersion: BODYWEIGHT_RESOLUTION_METHOD_V2,
      massResolutionIdentity,
      exercises: record.exercises.map((exercise) => ({
        stableKey: historicalExerciseStableKey(
          exercise.muscleMappingSnapshot,
          exercise.sourceExerciseCatalog?.stableKey,
        ),
        identityStatus: classifyPersistedExerciseIdentityV1({
          sourceExerciseCatalogId: exercise.sourceExerciseCatalogId,
          snapshotStableKey: exercise.muscleMappingSnapshot
            ? historicalExerciseStableKey(exercise.muscleMappingSnapshot, exercise.sourceExerciseCatalog?.stableKey)
            : null,
          catalogStableKey: exercise.sourceExerciseCatalog?.stableKey ?? null,
        }),
        resistanceType: exercise.resistanceType,
        config: exercise.loadAccountingConfigSnapshot,
        sets: [...exercise.sets].sort((left, right) => left.setNumber - right.setNumber).map((set) => ({
          setNumber: set.setNumber,
          reps: set.reps,
          weightKg: decimalToNumber(set.weightKg),
          bandNominalResistanceKg: decimalToNumber(set.bandNominalResistanceKg),
          override: set.loadAccountingOverride,
        })),
      })),
    });
    return this.db.$transaction(async (tx) => {
      await new PhysiologyV7PersistenceRepository(tx).lockProfile(profileId);
      await tx.$queryRaw<Array<{ id: number }>>`
        SELECT "id" FROM "StrengthDiarySession"
        WHERE "id" = ${record.id} AND "profileId" = ${profileId}
        FOR UPDATE
      `;
      const duplicate = await tx.strengthSessionAccountingOperation.findUnique({
        where: { sessionId_idempotencyKey: { sessionId: record.id, idempotencyKey: operationKey } },
        select: { requestDigest: true, status: true, resultSnapshotRevision: true },
      });
      if (duplicate) {
        if (duplicate.requestDigest !== requestDigest) throw new Error("idempotency key reused with a different request");
        if (duplicate.status === "COMPLETED" && duplicate.resultSnapshotRevision !== null) {
          return duplicate.resultSnapshotRevision;
        }
        throw new Error("accounting operation is not complete");
      }

      const locked = await tx.strengthDiarySession.findFirst({
        where: { id: record.id, profileId },
        select: {
          accountingInputRevision: true,
          effectiveAccountingAt: true,
          accountingTimeZone: true,
          accountingTimeZoneProvenance: true,
          webStartedAt: true,
          createdAt: true,
          matchedWorkout: { select: { startAt: true } },
          currentSnapshotRevision: true,
          currentAccountingSnapshot: { select: {
            snapshotRevision: true, accountingInputRevision: true, inputFingerprint: true,
            effectiveLocalDate: true, timeZone: true, timeZoneProvenance: true,
            accountingMethodVersion: true, massResolutionMethodVersion: true,
            massResolutionIdentity: true, payloadVersion: true, payload: true,
          } },
          accountingOperations: { where: { status: "PENDING" }, take: 1, select: { id: true } },
          id: true,
          profileId: true,
          revision: true,
          status: true,
          entryMode: true,
          programId: true,
          programVersionId: true,
          webEndedAt: true,
          matchStatus: true,
          matchMethod: true,
          matchedAt: true,
          matchedWorkoutId: true,
          updatedAt: true,
          program: { select: { id: true, name: true } },
          profile: { select: { autoAdvanceExercises: true } },
          programVersion: { select: { id: true, versionNumber: true } },
          exercises: { select: sessionExerciseSelect, orderBy: { sortOrder: "asc" } },
        },
      });
      if (!locked) throw new Error("session missing during accounting materialization");
      const lockedEffectiveAt = locked.effectiveAccountingAt
        ?? locked.matchedWorkout?.startAt
        ?? locked.webStartedAt
        ?? locked.createdAt;
      const lockedTimeZone = locked.accountingTimeZone ?? DEFAULT_TIME_ZONE;
      if (locked.accountingInputRevision !== record.accountingInputRevision
          || lockedEffectiveAt.getTime() !== effectiveAt.getTime()
          || lockedTimeZone !== timeZone
          || (locked.accountingTimeZoneProvenance ?? "legacy-default") !== timeZoneProvenance) {
        throw new StaleAccountingCandidateError();
      }

      const currentLocked = currentSnapshotForRecord(locked as SessionDetailRecord);
      if (mode === "ordinary" && currentLocked.state === "current"
          && locked.currentSnapshotRevision !== null) {
        if (input.finalizeAt) {
          const finalized = await tx.strengthDiarySession.updateMany({
            where: { id: record.id, profileId, status: SESSION_STATUS.ACTIVE },
            data: { status: SESSION_STATUS.COMPLETED, webEndedAt: input.finalizeAt },
          });
          if (finalized.count > 0) {
            await invalidateStrengthSessionActiveEnergyInTransaction(tx, record.id, undefined, {
              ...(input.deadlineMode === undefined ? {} : { deadlineMode: input.deadlineMode }),
              ...(input.dependentHealthDate === undefined ? {} : {
                operationKind: "health_weight_accounting_refresh",
                oldModelDates: [input.dependentHealthDate],
                newModelDates: [input.dependentHealthDate],
              }),
            });
          }
        }
        await tx.strengthSessionAccountingOperation.create({
          data: {
            sessionId: record.id,
            idempotencyKey: operationKey,
            requestDigest,
            status: "COMPLETED",
            resultSnapshotRevision: locked.currentSnapshotRevision,
          },
        });
        return locked.currentSnapshotRevision;
      }

      const aggregate = await tx.strengthSessionAccountingSnapshot.aggregate({
        where: { sessionId: record.id },
        _max: { snapshotRevision: true },
      });
      const snapshotRevision = (aggregate._max.snapshotRevision ?? 0) + 1;
      const payload = {
        schemaVersion: PERSISTED_LOAD_ACCOUNTING_PAYLOAD_V2,
        sessionId: record.id,
        snapshotRevision,
        accountingInputRevision: record.accountingInputRevision,
        effectiveAccountingAt: effectiveAt.toISOString(),
        effectiveLocalDate: localDate,
        timeZone,
        timeZoneProvenance,
        inputFingerprint,
        accountingMethodVersion: LOAD_ACCOUNTING_METHOD_V1,
        massResolutionMethodVersion: BODYWEIGHT_RESOLUTION_METHOD_V2,
        massResolutionIdentity,
        massReference,
        result,
        breakdown,
      };
      const parsedPayload = persistedPayloadFromUnknown(payload);
      if (!parsedPayload) throw new Error("generated Stage 02 payload failed strict validation");

      await tx.strengthSessionAccountingSnapshot.create({
        data: {
          sessionId: record.id,
          snapshotRevision,
          accountingInputRevision: record.accountingInputRevision,
          inputFingerprint,
          effectiveLocalDate: localDate,
          timeZone,
          timeZoneProvenance,
          accountingMethodVersion: LOAD_ACCOUNTING_METHOD_V1,
          massResolutionMethodVersion: BODYWEIGHT_RESOLUTION_METHOD_V2,
          massResolutionIdentity,
          payloadVersion: PERSISTED_LOAD_ACCOUNTING_PAYLOAD_V2,
          payload: JSON.parse(JSON.stringify(parsedPayload)) as Prisma.InputJsonValue,
        },
      });
      await tx.strengthDiarySession.update({
        where: { profileId_id: { profileId, id: record.id } },
        data: {
          effectiveAccountingAt: locked.effectiveAccountingAt ?? effectiveAt,
          accountingTimeZone: locked.accountingTimeZone ?? timeZone,
          accountingTimeZoneProvenance: locked.accountingTimeZoneProvenance ?? timeZoneProvenance,
          currentSnapshotRevision: snapshotRevision,
          ...(input.finalizeAt ? {
            status: SESSION_STATUS.COMPLETED,
            webEndedAt: input.finalizeAt,
          } : {}),
        },
      });
      if (input.finalizeAt || locked.status === SESSION_STATUS.COMPLETED) {
        // Active diary snapshots are not model inputs. Invalidate only after
        // a real completion transition or when refreshing a completed source.
        await invalidateStrengthSessionActiveEnergyInTransaction(tx, record.id, undefined, {
          ...(input.deadlineMode === undefined ? {} : { deadlineMode: input.deadlineMode }),
          ...(input.dependentHealthDate === undefined ? {} : {
            operationKind: "health_weight_accounting_refresh",
            oldModelDates: [input.dependentHealthDate],
            newModelDates: [input.dependentHealthDate],
          }),
        });
      }
      await tx.strengthSessionAccountingOperation.create({
        data: {
          sessionId: record.id,
          idempotencyKey: operationKey,
          requestDigest,
          status: "COMPLETED",
          resultSnapshotRevision: snapshotRevision,
        },
      });
      return snapshotRevision;
    });
  }

  async createSessionSnapshot(input: {
    profileId: number;
    programId: number | null;
    programVersionId: number | null;
    status?: SessionStatus;
    entryMode?: EntryMode;
    /** Explicit null keeps a RETROSPECTIVE session free of faked live times. */
    webStartedAt?: Date | null;
    webEndedAt?: Date | null;
    effectiveAccountingAt?: Date;
    accountingTimeZone?: string;
    accountingTimeZoneProvenance?: string;
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
      loadAccountingConfigSnapshot: Prisma.InputJsonValue | null;
    }>;
  }): Promise<StrengthSessionDto> {
    const profileId = requireProfileId(input.profileId);
    const webStartedAt = input.webStartedAt === undefined ? new Date() : input.webStartedAt;
    const effectiveAccountingAt = input.effectiveAccountingAt
      ?? webStartedAt
      ?? new Date();
    const accountingTimeZone = input.accountingTimeZone ?? DEFAULT_TIME_ZONE;
    const accountingTimeZoneProvenance = input.accountingTimeZoneProvenance ?? "legacy-default";
    const created = await this.db.$transaction(async (tx) => {
      await new PhysiologyV7PersistenceRepository(tx).lockProfile(profileId);
      const row = await tx.strengthDiarySession.create({
      data: {
        profileId,
        programId: input.programId,
        programVersionId: input.programVersionId,
        status: input.status ?? SESSION_STATUS.ACTIVE,
        entryMode: input.entryMode ?? ENTRY_MODE.LIVE,
        webStartedAt,
        webEndedAt: input.webEndedAt ?? null,
        effectiveAccountingAt,
        accountingTimeZone,
        accountingTimeZoneProvenance,
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
            loadAccountingConfigSnapshot: nullableJsonInput(exercise.loadAccountingConfigSnapshot),
          })),
        },
      },
        select: { id: true },
      });
      if ((input.status ?? SESSION_STATUS.ACTIVE) === SESSION_STATUS.COMPLETED) {
        await blockCompletedStrengthUnifiedInTransaction(tx, row.id);
      }
      return row;
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
    profileId: number;
    programId: number;
    programVersionId: number;
    matchedWorkoutId: number;
    matchedAt?: Date;
    effectiveAccountingAt: Date;
    exercises: Array<{
      sourceExerciseCatalogId: number | null;
      snapshotExerciseName: string;
      sortOrder: number;
      plannedSets: number;
      resistanceType: ResistanceType;
      muscleMappingSnapshot: Prisma.InputJsonValue | typeof Prisma.JsonNull;
      loadAccountingConfigSnapshot: Prisma.InputJsonValue | null;
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
      effectiveAccountingAt: input.effectiveAccountingAt,
      accountingTimeZone: DEFAULT_TIME_ZONE,
      accountingTimeZoneProvenance: "legacy-default",
      exercises: input.exercises.map((exercise) => ({
        ...exercise,
        origin: EXERCISE_ORIGIN.PLANNED,
      })),
    });
  }

  async incrementSessionRevision(sessionId: number, profileId: number): Promise<number> {
    profileId = requireProfileId(profileId);
    return this.db.$transaction(async (tx) => {
      await new PhysiologyV7PersistenceRepository(tx).lockProfile(profileId);
      const row = await tx.strengthDiarySession.update({
        where: { profileId_id: { profileId, id: sessionId } },
        data: { revision: { increment: 1 } },
        select: { revision: true },
      });
      await invalidateStrengthSessionActiveEnergyInTransaction(tx, sessionId);
      return row.revision;
    });
  }

  async findSessionExercise(sessionId: number, exerciseId: number, profileId: number) {
    profileId = requireProfileId(profileId);
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
    profileId: number,
  ) {
    profileId = requireProfileId(profileId);
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
  async findSessionForEdit(sessionId: number, profileId: number) {
    profileId = requireProfileId(profileId);
    return this.db.strengthDiarySession.findFirst({
      where: { id: sessionId, profileId },
      select: {
        id: true,
        status: true,
        entryMode: true,
        revision: true,
        accountingInputRevision: true,
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
    profileId: number;
    fromProgramId: number;
    fromProgramVersionId: number;
    toProgramId: number;
    toProgramVersionId: number;
    plan: ProgramReconcilePlan;
  }): Promise<number> {
    const profileId = requireProfileId(input.profileId);
    return this.db.$transaction(async (tx) => {
      await new PhysiologyV7PersistenceRepository(tx).lockProfile(profileId);
      const sourceSession = await tx.strengthDiarySession.findFirst({
        where: { id: input.sessionId, profileId },
        select: {
          id: true, profileId: true, status: true, programId: true,
          programVersionId: true, revision: true, matchedWorkoutId: true,
          effectiveAccountingAt: true, webStartedAt: true, createdAt: true,
          matchedWorkout: { select: { sourceIdentity: true, startAt: true } },
        },
      });
      if (!sourceSession || sourceSession.programId !== input.fromProgramId
          || sourceSession.programVersionId !== input.fromProgramVersionId) {
        throw new Error("session not found for program change");
      }
      const targetVersion = await tx.trainingProgramVersion.findFirst({
        where: { id: input.toProgramVersionId, programId: input.toProgramId, profileId },
        select: { id: true },
      });
      if (!targetVersion) throw new Error("target program version not found for profile");
      const oldExercises = await tx.strengthSessionExercise.findMany({
        where: { sessionId: input.sessionId, session: { profileId } },
        select: { id: true, sets: { select: { id: true } } },
      });
      const keepIds = input.plan.keep.map((keep) => keep.exerciseId);
      const ownedKeep = await tx.strengthSessionExercise.findMany({
        where: { sessionId: input.sessionId, id: { in: keepIds }, session: { profileId } },
        select: { id: true },
      });
      if (keepIds.length !== new Set(keepIds).size || ownedKeep.length !== keepIds.length) {
        throw new TrainingConcurrentMutationError();
      }
      const catalogIds = [...new Set(input.plan.add
        .map((exercise) => exercise.sourceExerciseCatalogId)
        .filter((id): id is number => id !== null))];
      const ownedCatalogIds = await tx.exerciseCatalog.findMany({
        where: { profileId, id: { in: catalogIds } }, select: { id: true },
      });
      if (ownedCatalogIds.length !== catalogIds.length) throw new TrainingConcurrentMutationError();
      await parkExerciseOrder(tx, input.plan.keep.map((keep) => keep.exerciseId));

      for (const added of input.plan.add) {
        await tx.strengthSessionExercise.create({
          data: {
            profileId,
            sessionId: input.sessionId,
            sourceExerciseCatalogId: added.sourceExerciseCatalogId,
            snapshotExerciseName: added.snapshotExerciseName,
            sortOrder: added.sortOrder,
            plannedSets: added.plannedSets,
            resistanceType: added.resistanceType,
            origin: added.origin,
            muscleMappingSnapshot: jsonInput(added.muscleMappingSnapshot),
            loadAccountingConfigSnapshot: nullableJsonInput(added.loadAccountingConfigSnapshot ?? null),
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
        where: { profileId_id: { profileId, id: input.sessionId } },
        data: {
          programId: input.toProgramId,
          programVersionId: input.toProgramVersionId,
          revision: { increment: 1 },
          accountingInputRevision: { increment: 1 },
          currentSnapshotRevision: null,
        },
        select: { revision: true },
      });
      await invalidateStrengthSessionActiveEnergyInTransaction(tx, input.sessionId);
      if (sourceSession.status === SESSION_STATUS.ACTIVE) {
        // ACTIVE sessions retain their transient training projection refresh
        // through the durable worker queue. It must share this source commit;
        // waiting for a synchronous model rebuild here would slow CRUD and a
        // fire-and-forget refresh could be lost on restart.
        const eventAt = sourceSession.matchedWorkout?.startAt
          ?? sourceSession.effectiveAccountingAt
          ?? sourceSession.webStartedAt
          ?? sourceSession.createdAt;
        const episodes = await tx.modelEpisode.findMany({
          where: { profileId: sourceSession.profileId },
          orderBy: [{ startDate: "asc" }, { id: "asc" }],
          select: { id: true, startDate: true, timezone: true, active: true },
        });
        const modelDate = episodeTimeContextForInstantV1(episodes, eventAt).date;
        const newExercises = await tx.strengthSessionExercise.findMany({
          where: { sessionId: input.sessionId, session: { profileId } },
          select: { id: true, sets: { select: { id: true } } },
        });
        const oldIdentity = {
          sessionId: sourceSession.id,
          status: sourceSession.status,
          revision: sourceSession.revision,
          programId: sourceSession.programId,
          programVersionId: sourceSession.programVersionId,
          matchedWorkoutId: sourceSession.matchedWorkoutId,
          workoutSourceIdentity: sourceSession.matchedWorkout?.sourceIdentity ?? null,
          eventAt: eventAt.toISOString(),
        } satisfies Prisma.InputJsonObject;
        const newIdentity = {
          ...oldIdentity,
          revision: session.revision,
          programId: input.toProgramId,
          programVersionId: input.toProgramVersionId,
        } satisfies Prisma.InputJsonObject;
        await enqueueTrainingSourceChangeInTransaction(tx, {
          profileId: sourceSession.profileId,
          operationKind: "training_active_session_program_changed",
          affectedSessionIds: [sourceSession.id],
          affectedExerciseIds: [...new Set([
            ...oldExercises.map(({ id }) => id),
            ...newExercises.map(({ id }) => id),
          ])],
          affectedSetIds: [...new Set(oldExercises.flatMap(({ sets }) => sets.map(({ id }) => id)))],
          oldSourceIdentity: oldIdentity,
          newSourceIdentity: newIdentity,
          oldEventInstants: [eventAt.toISOString()],
          newEventInstants: [eventAt.toISOString()],
          oldModelDates: [modelDate],
          newModelDates: [modelDate],
        });
      }
      return session.revision;
    });
  }

  /** Session-only exercise addition; the program template is never touched. */
  async addSessionExercise(input: {
    profileId: number;
    sessionId: number;
    sourceExerciseCatalogId: number;
    snapshotExerciseName: string;
    plannedSets: number;
    resistanceType: ResistanceType;
    origin?: ExerciseOrigin;
    muscleMappingSnapshot: unknown;
    loadAccountingConfigSnapshot: Prisma.InputJsonValue | null;
    /** Insert position; appended when omitted or past the end. */
    order?: number;
    orderedExerciseIds: readonly number[];
  }): Promise<{ exerciseId: number; revision: number }> {
    const profileId = requireProfileId(input.profileId);
    return this.db.$transaction(async (tx) => {
      await new PhysiologyV7PersistenceRepository(tx).lockProfile(profileId);
      const ownedSession = await tx.strengthDiarySession.findFirst({
        where: { id: input.sessionId, profileId }, select: { id: true },
      });
      if (!ownedSession) throw new TrainingConcurrentMutationError();
      const ownedCatalog = await tx.exerciseCatalog.findFirst({
        where: { id: input.sourceExerciseCatalogId, profileId }, select: { id: true },
      });
      if (!ownedCatalog) throw new TrainingConcurrentMutationError();
      await assertSessionExerciseIds(tx, input.sessionId, profileId, input.orderedExerciseIds);
      const existing = [...input.orderedExerciseIds];
      const position = input.order === undefined
        ? existing.length
        : Math.min(Math.max(input.order, 0), existing.length);
      const appended = position === existing.length;

      if (!appended) await parkExerciseOrder(tx, existing);

      const created = await tx.strengthSessionExercise.create({
        data: {
          profileId,
          sessionId: input.sessionId,
          sourceExerciseCatalogId: input.sourceExerciseCatalogId,
          snapshotExerciseName: input.snapshotExerciseName,
          sortOrder: position,
          plannedSets: input.plannedSets,
          resistanceType: input.resistanceType,
          origin: input.origin ?? EXERCISE_ORIGIN.EXTRA,
          muscleMappingSnapshot: jsonInput(input.muscleMappingSnapshot),
          loadAccountingConfigSnapshot: nullableJsonInput(input.loadAccountingConfigSnapshot),
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
        where: { profileId_id: { profileId, id: input.sessionId } },
        data: {
          revision: { increment: 1 },
          accountingInputRevision: { increment: 1 },
          currentSnapshotRevision: null,
        },
        select: { revision: true },
      });
      await invalidateStrengthSessionActiveEnergyInTransaction(tx, input.sessionId);
      return { exerciseId: created.id, revision: session.revision };
    });
  }

  async updateSessionExercise(input: {
    profileId: number;
    sessionId: number;
    exerciseId: number;
    plannedSets?: number;
    resistanceType?: ResistanceType;
    /** Null out load columns made meaningless by a confirmed resistance change. */
    clearWeightKg?: boolean;
    clearBandNominalResistanceKg?: boolean;
    order?: number;
    expectedAccountingInputRevision: number;
    orderedExerciseIds: readonly number[];
  }): Promise<number> {
    const profileId = requireProfileId(input.profileId);
    return this.db.$transaction(async (tx) => {
      await new PhysiologyV7PersistenceRepository(tx).lockProfile(profileId);
      const lockedSession = await tx.strengthDiarySession.findFirst({
        where: { id: input.sessionId, profileId },
        select: { accountingInputRevision: true, revision: true },
      });
      if (!lockedSession || lockedSession.accountingInputRevision !== input.expectedAccountingInputRevision) {
        throw new TrainingConcurrentMutationError();
      }
      const currentExercise = await tx.strengthSessionExercise.findFirst({
        where: { id: input.exerciseId, sessionId: input.sessionId, session: { profileId } },
        select: {
          plannedSets: true,
          resistanceType: true,
          sortOrder: true,
          sets: { select: { weightKg: true, bandNominalResistanceKg: true } },
        },
      });
      if (!currentExercise) throw new TrainingConcurrentMutationError();
      const clearsExistingLoad = currentExercise !== null && (
        input.clearWeightKg && currentExercise.sets.some((set) => set.weightKg !== null)
        || input.clearBandNominalResistanceKg && currentExercise.sets.some((set) => set.bandNominalResistanceKg !== null)
      );
      const sourceChanged = currentExercise !== null && (
        input.plannedSets !== undefined && input.plannedSets !== currentExercise.plannedSets
        || input.resistanceType !== undefined && input.resistanceType !== currentExercise.resistanceType
        || clearsExistingLoad
        || input.order !== undefined && input.order !== currentExercise.sortOrder
      );
      if (currentExercise !== null && !sourceChanged) return lockedSession.revision;
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
        const ownedSetIds = await tx.strengthSet.findMany({
          where: { sessionExerciseId: input.exerciseId, sessionExercise: { session: { profileId } } },
          select: { id: true },
        });
        await tx.strengthSet.updateMany({
          where: { id: { in: ownedSetIds.map(({ id }) => id) }, sessionExerciseId: input.exerciseId },
          data: {
            ...(input.clearWeightKg ? { weightKg: null } : {}),
            ...(input.clearBandNominalResistanceKg ? { bandNominalResistanceKg: null } : {}),
          },
        });
      }

      if (input.order !== undefined) {
        await assertSessionExerciseIds(tx, input.sessionId, profileId, input.orderedExerciseIds);
        const reordered = moveWithin(input.orderedExerciseIds, input.exerciseId, input.order);
        await parkExerciseOrder(tx, reordered);
        await writeExerciseOrder(tx, reordered);
      }

      const session = await tx.strengthDiarySession.update({
        where: { profileId_id: { profileId, id: input.sessionId } },
        data: {
          revision: { increment: 1 },
          ...(input.resistanceType !== undefined || input.clearWeightKg || input.clearBandNominalResistanceKg
            ? { accountingInputRevision: { increment: 1 }, currentSnapshotRevision: null }
            : {}),
        },
        select: { revision: true },
      });
      await invalidateStrengthSessionActiveEnergyInTransaction(tx, input.sessionId);
      return session.revision;
    });
  }

  async deleteSessionExercise(input: {
    profileId: number;
    sessionId: number;
    exerciseId: number;
    orderedExerciseIds: readonly number[];
  }): Promise<number> {
    const profileId = requireProfileId(input.profileId);
    return this.db.$transaction(async (tx) => {
      await new PhysiologyV7PersistenceRepository(tx).lockProfile(profileId);
      const ownedExercise = await tx.strengthSessionExercise.findFirst({
        where: { id: input.exerciseId, sessionId: input.sessionId, session: { profileId } },
        select: { id: true },
      });
      if (!ownedExercise) throw new TrainingConcurrentMutationError();
      await assertSessionExerciseIds(tx, input.sessionId, profileId, input.orderedExerciseIds);
      const deletedSets = await tx.strengthSet.findMany({
        where: { sessionExerciseId: input.exerciseId, sessionExercise: { session: { profileId } } },
        select: { id: true },
      });
      if (deletedSets.length > 0) {
        await tx.trainingSetCreateOperation.updateMany({
          where: {
            profileId,
            canonicalSetId: { in: deletedSets.map(({ id }) => id) },
            state: "COMMITTED",
          },
          data: { state: "TOMBSTONED" },
        });
      }
      await tx.strengthSessionExercise.delete({ where: { id: input.exerciseId } });
      const remaining = input.orderedExerciseIds.filter((id) => id !== input.exerciseId);
      await parkExerciseOrder(tx, remaining);
      await writeExerciseOrder(tx, remaining);
      const session = await tx.strengthDiarySession.update({
        where: { profileId_id: { profileId, id: input.sessionId } },
        data: {
          revision: { increment: 1 },
          accountingInputRevision: { increment: 1 },
          currentSnapshotRevision: null,
        },
        select: { revision: true },
      });
      await invalidateStrengthSessionActiveEnergyInTransaction(
        tx,
        input.sessionId,
        trainingChildDeletionPublicationSourceKey("exercise", input.sessionId, input.exerciseId),
        {
          operationKind: "training_exercise_deleted",
          affectedSetIds: deletedSets.map(({ id }) => id),
        },
      );
      return session.revision;
    });
  }

  async reorderSessionExercises(input: {
    profileId: number;
    sessionId: number;
    orderedExerciseIds: readonly number[];
  }): Promise<number> {
    const profileId = requireProfileId(input.profileId);
    return this.db.$transaction(async (tx) => {
      await new PhysiologyV7PersistenceRepository(tx).lockProfile(profileId);
      const [currentSession, exercises] = await Promise.all([
        tx.strengthDiarySession.findFirst({ where: { id: input.sessionId, profileId }, select: { id: true, revision: true } }),
        tx.strengthSessionExercise.findMany({
          where: { sessionId: input.sessionId, session: { profileId } },
          orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
          select: { id: true },
        }),
      ]);
      if (currentSession && exercises.length === input.orderedExerciseIds.length
          && exercises.every((exercise, index) => exercise.id === input.orderedExerciseIds[index])) {
        return currentSession.revision;
      }
      const requestedIds = new Set(input.orderedExerciseIds);
      if (!currentSession || exercises.length !== input.orderedExerciseIds.length
          || requestedIds.size !== input.orderedExerciseIds.length
          || exercises.some((exercise) => !requestedIds.has(exercise.id))) {
        throw new TrainingConcurrentMutationError();
      }
      await parkExerciseOrder(tx, input.orderedExerciseIds);
      await writeExerciseOrder(tx, input.orderedExerciseIds);
      const session = await tx.strengthDiarySession.update({
        where: { profileId_id: { profileId, id: input.sessionId } },
        data: { revision: { increment: 1 } },
        select: { revision: true },
      });
      await invalidateStrengthSessionActiveEnergyInTransaction(tx, input.sessionId);
      return session.revision;
    });
  }

  async createSet(input: {
    profileId: number;
    operationId: string;
    payloadDigest: string;
    sessionId: number;
    sessionExerciseId: number;
    expectedResistanceType: ResistanceType;
    reps: number;
    weightKg: number | null;
    bandNominalResistanceKg: number | null;
    rir?: number | null;
    comment?: string | null;
    completedAt: Date | null;
    loadAccountingOverride?: Prisma.InputJsonValue | null;
  }): Promise<StrengthSetDto | { state: "REJECTED" } | null> {
    return this.db.$transaction(async (tx) => {
      const profileId = requireProfileId(input.profileId);
      await new PhysiologyV7PersistenceRepository(tx).lockProfile(profileId);
      const existing = await tx.trainingSetCreateOperation.findUnique({
        where: { profileId_operationId: { profileId, operationId: input.operationId } },
      });
      if (existing) {
        if (existing.payloadVersion !== 1 || existing.payloadDigest !== input.payloadDigest
            || existing.sessionId !== input.sessionId || existing.exerciseId !== input.sessionExerciseId) {
          throw new SetCreateOperationConflictError();
        }
        if (existing.state === "TOMBSTONED") throw new SetCreateOperationTombstonedError();
        if (existing.state === "REJECTED") throw new TrainingConcurrentMutationError();
        if (existing.state !== "COMMITTED" || existing.canonicalSetId === null) {
          throw new SetCreateOperationUnresolvedError();
        }
        const canonical = await tx.strengthSet.findFirst({
          where: {
            id: existing.canonicalSetId,
            sessionExercise: { id: input.sessionExerciseId, session: { id: input.sessionId, profileId } },
          },
          select: setSelect,
        });
        if (!canonical) {
          await tx.trainingSetCreateOperation.update({
            where: { profileId_operationId: { profileId, operationId: input.operationId } },
            data: { state: "TOMBSTONED" },
          });
          return null;
        }
        return toSetDto(canonical);
      }
      const exercise = await tx.strengthSessionExercise.findFirst({
        where: { id: input.sessionExerciseId, sessionId: input.sessionId, session: { profileId } },
        select: { id: true, sessionId: true, resistanceType: true },
      });
      if (!exercise) throw new Error("session exercise not found while creating set");
      if (exercise.resistanceType !== input.expectedResistanceType) {
        // Persist the definitive pre-write rejection under the same key. A
        // second tab may still be retrying this ID after observing the 409;
        // once this row commits, every same-key POST resolves to rejection.
        await tx.trainingSetCreateOperation.create({
          data: {
            profileId,
            operationId: input.operationId,
            payloadVersion: 1,
            payloadDigest: input.payloadDigest,
            sessionId: input.sessionId,
            exerciseId: input.sessionExerciseId,
            state: "REJECTED",
          },
        });
        return { state: "REJECTED" };
      }
      await tx.trainingSetCreateOperation.create({
        data: {
          profileId,
          operationId: input.operationId,
          payloadVersion: 1,
          payloadDigest: input.payloadDigest,
          sessionId: input.sessionId,
          exerciseId: input.sessionExerciseId,
          state: "PENDING",
        },
      });
      const lastSet = await tx.strengthSet.aggregate({
        where: { sessionExerciseId: input.sessionExerciseId },
        _max: { setNumber: true },
      });
      const row = await tx.strengthSet.create({
        data: {
          sessionExerciseId: input.sessionExerciseId,
          setNumber: (lastSet._max.setNumber ?? 0) + 1,
          reps: input.reps,
          weightKg: input.weightKg,
          bandNominalResistanceKg: input.bandNominalResistanceKg,
          rir: input.rir === undefined ? null : input.rir,
          comment: input.comment === undefined
            ? undefined
            : (input.comment?.trim() ? input.comment.trim() : null),
          completedAt: input.completedAt,
          loadAccountingOverride: nullableJsonInput(input.loadAccountingOverride ?? null),
        },
        select: setSelect,
      });
      await bumpAccountingInputRevision(tx, exercise.sessionId);
      await tx.trainingSetCreateOperation.update({
        where: { profileId_operationId: { profileId, operationId: input.operationId } },
        data: { state: "COMMITTED", canonicalSetId: row.id },
      });
      return toSetDto(row);
    });
  }

  /**
   * Store a known pre-write validation rejection for an explicit client key.
   * This serializes with createSet under the same profile lock so a stale tab
   * cannot later turn the rejected key into a successful create.
   */
  async rejectSetCreateOperation(input: {
    profileId: number;
    operationId: string;
    payloadDigest: string;
    sessionId: number;
    exerciseId: number;
  }): Promise<
    | { state: "NOT_FOUND" }
    | { state: "REJECTED" }
    | { state: "TOMBSTONED" }
    | { state: "PENDING" }
    | { state: "COMMITTED"; set: StrengthSetDto }
  > {
    const profileId = requireProfileId(input.profileId);
    return this.db.$transaction(async (tx) => {
      await new PhysiologyV7PersistenceRepository(tx).lockProfile(profileId);
      const existing = await tx.trainingSetCreateOperation.findUnique({
        where: { profileId_operationId: { profileId, operationId: input.operationId } },
      });
      if (existing) {
        if (existing.payloadVersion !== 1 || existing.payloadDigest !== input.payloadDigest
            || existing.sessionId !== input.sessionId || existing.exerciseId !== input.exerciseId) {
          throw new SetCreateOperationConflictError();
        }
        if (existing.state === "TOMBSTONED") return { state: "TOMBSTONED" };
        if (existing.state === "REJECTED") return { state: "REJECTED" };
        if (existing.state !== "COMMITTED" || existing.canonicalSetId === null) return { state: "PENDING" };
        const canonical = await tx.strengthSet.findFirst({
          where: {
            id: existing.canonicalSetId,
            sessionExercise: { id: input.exerciseId, session: { id: input.sessionId, profileId } },
          },
          select: setSelect,
        });
        if (!canonical) {
          await tx.trainingSetCreateOperation.update({
            where: { profileId_operationId: { profileId, operationId: input.operationId } },
            data: { state: "TOMBSTONED" },
          });
          return { state: "TOMBSTONED" };
        }
        return { state: "COMMITTED", set: toSetDto(canonical) };
      }

      const exercise = await tx.strengthSessionExercise.findFirst({
        where: { id: input.exerciseId, sessionId: input.sessionId, session: { profileId } },
        select: { id: true },
      });
      if (!exercise) return { state: "NOT_FOUND" };
      await tx.trainingSetCreateOperation.create({
        data: {
          profileId,
          operationId: input.operationId,
          payloadVersion: 1,
          payloadDigest: input.payloadDigest,
          sessionId: input.sessionId,
          exerciseId: input.exerciseId,
          state: "REJECTED",
        },
      });
      return { state: "REJECTED" };
    });
  }

  async resolveSetCreateOperation(input: {
    profileId: number;
    operationId: string;
    payloadDigest?: string;
    sessionId?: number;
    exerciseId?: number;
  }): Promise<{ state: "NOT_FOUND" } | { state: "COMMITTED"; set: StrengthSetDto } | { state: "TOMBSTONED" } | { state: "REJECTED" } | { state: "PENDING" }> {
    const profileId = requireProfileId(input.profileId);
    const operation = await this.db.trainingSetCreateOperation.findUnique({
      where: { profileId_operationId: { profileId, operationId: input.operationId } },
    });
    if (!operation) return { state: "NOT_FOUND" };
    if (input.payloadDigest !== undefined && (
      operation.payloadVersion !== 1
      || operation.payloadDigest !== input.payloadDigest
      || (input.sessionId !== undefined && operation.sessionId !== input.sessionId)
      || (input.exerciseId !== undefined && operation.exerciseId !== input.exerciseId)
    )) throw new SetCreateOperationConflictError();
    if (operation.state === "TOMBSTONED") return { state: "TOMBSTONED" };
    if (operation.state === "REJECTED") return { state: "REJECTED" };
    if (operation.state !== "COMMITTED" || operation.canonicalSetId === null) return { state: "PENDING" };
    const row = await this.db.strengthSet.findFirst({
      where: {
        id: operation.canonicalSetId,
        sessionExercise: { id: operation.exerciseId, session: { id: operation.sessionId, profileId } },
      },
      select: setSelect,
    });
    if (!row) {
      await this.db.trainingSetCreateOperation.updateMany({
        where: { profileId, operationId: input.operationId, state: "COMMITTED" },
        data: { state: "TOMBSTONED" },
      });
      return { state: "TOMBSTONED" };
    }
    return { state: "COMMITTED", set: toSetDto(row) };
  }

  async updateSet(input: {
    setId: number;
    sessionId: number;
    profileId: number;
    reps?: number;
    weightKg?: number | null;
    bandNominalResistanceKg?: number | null;
    rir?: number | null;
    comment?: string | null;
    completedAt?: Date | null;
    loadAccountingOverride?: Prisma.InputJsonValue | null;
  }): Promise<StrengthSetDto | null> {
    const profileId = requireProfileId(input.profileId);
    return this.db.$transaction(async (tx) => {
      await new PhysiologyV7PersistenceRepository(tx).lockProfile(profileId);
      const existing = await tx.strengthSet.findFirst({
        where: {
          id: input.setId,
          sessionExercise: { sessionId: input.sessionId, session: { profileId } },
        },
        select: { ...setSelect, sessionExercise: { select: { sessionId: true } } },
      });
      if (!existing) return null;
      const nextComment = input.comment === undefined
        ? existing.comment
        : input.comment?.trim() ? input.comment.trim() : null;
      const unchanged = (input.reps === undefined || input.reps === existing.reps)
        && (input.weightKg === undefined || input.weightKg === existing.weightKg?.toNumber()
          || input.weightKg === null && existing.weightKg === null)
        && (input.bandNominalResistanceKg === undefined
          || input.bandNominalResistanceKg === existing.bandNominalResistanceKg?.toNumber()
          || input.bandNominalResistanceKg === null && existing.bandNominalResistanceKg === null)
        && (input.rir === undefined || input.rir === existing.rir)
        && (input.comment === undefined || nextComment === existing.comment)
        && (input.completedAt === undefined
          || (input.completedAt?.getTime() ?? null) === (existing.completedAt?.getTime() ?? null))
        && (input.loadAccountingOverride === undefined
          || stableSha256(input.loadAccountingOverride) === stableSha256(existing.loadAccountingOverride));
      if (unchanged) return toSetDto(existing);
      const accountingChanged = (input.reps !== undefined && input.reps !== existing.reps)
        || (input.weightKg !== undefined && input.weightKg !== existing.weightKg?.toNumber() && !(input.weightKg === null && existing.weightKg === null))
        || (input.bandNominalResistanceKg !== undefined
          && input.bandNominalResistanceKg !== existing.bandNominalResistanceKg?.toNumber()
          && !(input.bandNominalResistanceKg === null && existing.bandNominalResistanceKg === null))
        || (input.loadAccountingOverride !== undefined
          && stableSha256(input.loadAccountingOverride) !== stableSha256(existing.loadAccountingOverride));
      const activeEnergyChanged = input.completedAt !== undefined
        && (input.completedAt?.getTime() ?? null) !== (existing.completedAt?.getTime() ?? null);
      const row = await tx.strengthSet.update({
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
          ...(input.loadAccountingOverride !== undefined
            ? { loadAccountingOverride: nullableJsonInput(input.loadAccountingOverride) }
            : {}),
        },
        select: setSelect,
      });
      if (accountingChanged) await bumpAccountingInputRevision(tx, existing.sessionExercise.sessionId);
      else if (activeEnergyChanged) await invalidateStrengthSessionActiveEnergyInTransaction(tx, existing.sessionExercise.sessionId);
      else if (input.rir !== undefined && input.rir !== existing.rir) {
        await invalidateCompletedStrengthUnifiedInTransaction(tx, existing.sessionExercise.sessionId);
      }
      return toSetDto(row);
    });
  }

  async deleteSet(
    setId: number,
    sessionId: number,
    profileId: number,
  ): Promise<boolean> {
    return this.db.$transaction(async (tx) => {
      await new PhysiologyV7PersistenceRepository(tx).lockProfile(profileId);
      const existing = await tx.strengthSet.findFirst({
        where: { id: setId, sessionExercise: { sessionId, session: { profileId } } },
        select: { id: true },
      });
      if (!existing) return false;
      await tx.strengthSet.delete({ where: { id: setId } });
      await tx.trainingSetCreateOperation.updateMany({
        where: { profileId, canonicalSetId: setId, state: "COMMITTED" },
        data: { state: "TOMBSTONED" },
      });
      await bumpAccountingInputRevision(
        tx,
        sessionId,
        trainingChildDeletionPublicationSourceKey("set", sessionId, setId),
      );
      return true;
    });
  }

  /**
   * Prior completed sessions for the same catalog exercise (or snapshot name fallback).
   * Newest first. Excludes the current session and empty set lists.
   */
  async listExerciseHistory(input: {
    profileId: number;
    excludeSessionId: number;
    catalogId: number | null;
    snapshotExerciseName: string;
    limit?: number;
  }): Promise<ExerciseHistoryEntryDto[]> {
    const profileId = requireProfileId(input.profileId);
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
      // Page by durable ids; occurrence order is applied in memory so nullable
      // matchedWorkout.startAt cannot steal the top-N window via NULLS FIRST.
      orderBy: [{ sessionId: "desc" }, { id: "desc" }],
      take: Math.min(limit * 8, 160),
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
            id: true,
            setNumber: true,
            reps: true,
            weightKg: true,
            bandNominalResistanceKg: true,
            rir: true,
            comment: true,
            completedAt: true,
            loadAccountingOverride: true,
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
        programName: row.session.program?.name ?? null,
        resistanceType: row.resistanceType as ResistanceType,
        sets: row.sets.map((set) => ({
          id: set.id,
          setNumber: set.setNumber,
          reps: set.reps,
          weightKg: decimalToNumber(set.weightKg),
          bandNominalResistanceKg: decimalToNumber(set.bandNominalResistanceKg),
          rir: set.rir,
          comment: set.comment ?? null,
          completedAt: set.completedAt?.toISOString() ?? null,
          loadAccountingOverride: set.loadAccountingOverride,
        })),
      };
    }).sort((left, right) => {
      const leftMs = Date.parse(left.occurredAt);
      const rightMs = Date.parse(right.occurredAt);
      const leftOk = Number.isFinite(leftMs);
      const rightOk = Number.isFinite(rightMs);
      if (leftOk && rightOk && leftMs !== rightMs) return rightMs - leftMs;
      if (leftOk !== rightOk) return leftOk ? -1 : 1;
      return right.sessionId - left.sessionId;
    }).slice(0, limit);
  }

  async findSetForSession(setId: number, sessionId: number, profileId: number) {
    profileId = requireProfileId(profileId);
    return this.db.strengthSet.findFirst({
      where: {
        id: setId,
        sessionExercise: { sessionId, session: { profileId } },
      },
      select: {
        id: true,
        setNumber: true,
        reps: true,
        weightKg: true,
        bandNominalResistanceKg: true,
        rir: true,
        comment: true,
        completedAt: true,
        createdAt: true,
        updatedAt: true,
        loadAccountingOverride: true,
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

  async markSessionCompleted(
    sessionId: number,
    webEndedAt: Date,
    profileId: number,
  ): Promise<void> {
    profileId = requireProfileId(profileId);
    await this.db.$transaction(async (tx) => {
      await new PhysiologyV7PersistenceRepository(tx).lockProfile(profileId);
      await tx.strengthDiarySession.update({
        where: { profileId_id: { profileId, id: sessionId } },
        data: { status: SESSION_STATUS.COMPLETED, webEndedAt },
      });
      await blockCompletedStrengthUnifiedInTransaction(tx, sessionId);
    });
  }

  async markSessionCancelled(sessionId: number, webEndedAt: Date, profileId: number): Promise<void> {
    profileId = requireProfileId(profileId);
    await this.db.$transaction(async (tx) => {
      await new PhysiologyV7PersistenceRepository(tx).lockProfile(profileId);
      const session = await tx.strengthDiarySession.findFirst({
        where: { id: sessionId, profileId },
        select: {
          id: true, profileId: true, status: true, effectiveAccountingAt: true,
          webStartedAt: true, createdAt: true, matchedWorkoutId: true,
          matchStatus: true, matchMethod: true, matchedAt: true,
          matchedWorkout: { select: { id: true, sourceIdentity: true, startAt: true, endAt: true } },
        },
      });
      const trainingEvidence = session?.status === SESSION_STATUS.COMPLETED
        ? await blockCompletedStrengthUnifiedInTransaction(tx, sessionId, undefined, {
          recordSourceChange: false,
          operationKind: "training_session_cancelled",
        })
        : null;
      if (session?.status === SESSION_STATUS.COMPLETED) {
        const oldEventAt = session.matchedWorkout?.startAt
          ?? session.effectiveAccountingAt ?? session.webStartedAt ?? session.createdAt;
        await invalidateActiveEnergySourcesInTransactionV1({
          tx,
          profileId: session.profileId,
          aliases: [
            { sourceType: "strength-session", sourceId: String(session.id) },
            ...(session.matchedWorkoutId === null ? [] : [{ sourceType: "workout", sourceId: String(session.matchedWorkoutId) }]),
          ],
          affectedInstants: [oldEventAt, session.matchedWorkout?.endAt],
          staleMatchingAliasesOnly: true,
        });
      }
      await tx.strengthDiarySession.update({
        where: { profileId_id: { profileId, id: sessionId } },
        data: {
          status: SESSION_STATUS.CANCELLED,
          webEndedAt,
          matchStatus: MATCH_STATUS.UNMATCHED,
          matchMethod: null,
          matchedWorkoutId: null,
          matchedAt: null,
        },
      });
      if (session?.status === SESSION_STATUS.COMPLETED && trainingEvidence) {
        const newEventAt = session.effectiveAccountingAt ?? session.webStartedAt ?? session.createdAt;
        const episodes = await tx.modelEpisode.findMany({
          where: { profileId: session.profileId },
          orderBy: [{ startDate: "asc" }, { id: "asc" }],
          select: { id: true, startDate: true, timezone: true, active: true },
        });
        const newModelDate = episodeTimeContextForInstantV1(episodes, newEventAt).date;
        await enqueueTrainingSourceChangeInTransaction(tx, {
          ...trainingEvidence,
          operationKind: "training_session_cancelled",
          oldSourceIdentity: {
            sessionId,
            status: SESSION_STATUS.COMPLETED,
            matchedWorkoutId: session.matchedWorkoutId,
            workoutSourceIdentity: session.matchedWorkout?.sourceIdentity ?? null,
            matchStatus: session.matchStatus,
            matchMethod: session.matchMethod,
            matchedAt: session.matchedAt?.toISOString() ?? null,
          } satisfies Prisma.InputJsonObject,
          newSourceIdentity: {
            sessionId,
            status: SESSION_STATUS.CANCELLED,
            matchedWorkoutId: null,
            workoutSourceIdentity: null,
            matchStatus: MATCH_STATUS.UNMATCHED,
            matchMethod: null,
            matchedAt: null,
          } satisfies Prisma.InputJsonObject,
          oldEventInstants: [
            (session.matchedWorkout?.startAt ?? session.effectiveAccountingAt ?? session.webStartedAt ?? session.createdAt).toISOString(),
          ],
          newEventInstants: [newEventAt.toISOString()],
          oldModelDates: trainingEvidence.newModelDates ?? [],
          newModelDates: [newModelDate],
        });
      }
    });
  }

  /**
   * Hard-delete a diary session. Cascades exercises/sets/program-change audit.
   * Does NOT delete the linked Garmin Workout — only clears the 1:1 relation.
   */
  async deleteDiarySession(
    sessionId: number,
    profileId: number,
  ): Promise<{ deleted: true; matchedWorkoutId: number | null }> {
    profileId = requireProfileId(profileId);
    const existing = await this.db.strengthDiarySession.findFirst({
      where: { id: sessionId, profileId },
      select: { id: true, matchedWorkoutId: true },
    });
    if (!existing) {
      return { deleted: true, matchedWorkoutId: null };
    }
    const matchedWorkoutId = existing.matchedWorkoutId;
    await this.db.$transaction(async (tx) => {
      await new PhysiologyV7PersistenceRepository(tx).lockProfile(profileId);
      const session = await tx.strengthDiarySession.findFirst({
        where: { id: sessionId, profileId },
        select: {
          profileId: true, status: true, effectiveAccountingAt: true, accountingTimeZone: true,
          webStartedAt: true, createdAt: true, matchedWorkoutId: true,
          matchStatus: true, matchMethod: true, matchedAt: true,
          matchedWorkout: { select: { id: true, sourceIdentity: true, startAt: true, endAt: true } },
        },
      });
      let trainingEvidence: TrainingSourceChangeEvidence | null = null;
      if (session) {
        if (session.status === SESSION_STATUS.COMPLETED) {
          const eventAt = session.matchedWorkout?.startAt
            ?? session.effectiveAccountingAt ?? session.webStartedAt ?? session.createdAt;
          trainingEvidence = await blockCompletedStrengthUnifiedInTransaction(tx, sessionId, undefined, {
            recordSourceChange: false,
            operationKind: "training_session_deleted",
            oldSourceIdentity: {
              sessionId,
              matchedWorkoutId: session.matchedWorkoutId,
              workoutSourceIdentity: session.matchedWorkout?.sourceIdentity ?? null,
              matchStatus: session.matchStatus,
              matchMethod: session.matchMethod,
              matchedAt: session.matchedAt?.toISOString() ?? null,
            } satisfies Prisma.InputJsonObject,
            oldEventInstants: [eventAt.toISOString()],
            newEventInstants: [],
          });
        }
        await tx.trainingSetCreateOperation.updateMany({
          where: { profileId, sessionId, state: "COMMITTED" },
          data: { state: "TOMBSTONED" },
        });
        await invalidateActiveEnergySourcesInTransactionV1({
          tx,
          profileId: session.profileId,
          aliases: [
            { sourceType: "strength-session", sourceId: String(sessionId) },
            ...(matchedWorkoutId === null ? [] : [{ sourceType: "workout", sourceId: String(matchedWorkoutId) }]),
          ],
          affectedInstants: [session.matchedWorkout?.startAt ?? session.effectiveAccountingAt ?? session.webStartedAt ?? session.createdAt, session.matchedWorkout?.endAt],
          staleMatchingAliasesOnly: true,
        });
      }
      await tx.strengthDiarySession.delete({ where: { profileId_id: { profileId, id: sessionId } } });
      if (trainingEvidence) await enqueueTrainingSourceChangeInTransaction(tx, trainingEvidence);
    });
    return { deleted: true, matchedWorkoutId };
  }

  async applyMatchResult(input: {
    profileId: number;
    sessionId: number;
    matchStatus: MatchStatus;
    matchMethod: MatchMethod | null;
    matchedWorkoutId: number | null;
    matchedAt: Date | null;
    deadlineMode?: TrainingSourceChangeEvidence["deadlineMode"];
  }): Promise<void> {
    const profileId = requireProfileId(input.profileId);
    await this.db.$transaction(async (tx) => {
      await new PhysiologyV7PersistenceRepository(tx).lockProfile(profileId);
      const session = await tx.strengthDiarySession.findFirst({
        where: { id: input.sessionId, profileId },
        select: {
          id: true,
          profileId: true,
          status: true,
          effectiveAccountingAt: true,
          accountingTimeZone: true,
          accountingTimeZoneProvenance: true,
          webStartedAt: true,
          createdAt: true,
          matchedWorkoutId: true,
          matchStatus: true,
          matchMethod: true,
          matchedAt: true,
        },
      });
      if (!session) return;
      const [previousWorkout, workout] = await Promise.all([
        session.matchedWorkoutId === null ? Promise.resolve(null) : tx.workout.findUnique({
          where: { profileId_id: { profileId, id: session.matchedWorkoutId } }, select: { id: true, sourceIdentity: true, startAt: true, endAt: true },
        }),
        input.matchedWorkoutId === null ? Promise.resolve(null) : tx.workout.findUnique({
          where: { profileId_id: { profileId, id: input.matchedWorkoutId } }, select: { id: true, sourceIdentity: true, startAt: true, endAt: true },
        }),
      ]);
      const nextEffectiveAt = workout?.startAt ?? session.webStartedAt ?? session.createdAt;
      const previousEffectiveAt = session.effectiveAccountingAt ?? session.webStartedAt ?? session.createdAt;
      const accountingTimeZone = session.accountingTimeZone ?? DEFAULT_TIME_ZONE;
      const accountingTimeZoneProvenance = session.accountingTimeZoneProvenance ?? "legacy-default";
      const previousLocalDate = instantToLocalDateTime(previousEffectiveAt, accountingTimeZone).date;
      const nextLocalDate = instantToLocalDateTime(nextEffectiveAt, accountingTimeZone).date;
      const accountingDateChanged = previousLocalDate !== nextLocalDate;
      const matchChanged = session.matchedWorkoutId !== input.matchedWorkoutId
        || session.matchStatus !== input.matchStatus
        || session.matchMethod !== input.matchMethod
        || session.matchedAt?.getTime() !== input.matchedAt?.getTime();
      if ((matchChanged || previousEffectiveAt.getTime() !== nextEffectiveAt.getTime())
          && session.status === SESSION_STATUS.COMPLETED) {
        // Fence the old matched-workout date before replacing the relation.
        await blockCompletedStrengthUnifiedInTransaction(tx, session.id, undefined, {
          recordSourceChange: false,
        });
      }
      await tx.strengthDiarySession.update({
        where: { profileId_id: { profileId, id: input.sessionId } },
        data: {
          matchStatus: input.matchStatus,
          matchMethod: input.matchMethod,
          matchedWorkoutId: input.matchedWorkoutId,
          matchedAt: input.matchedAt,
          ...(previousEffectiveAt.getTime() === nextEffectiveAt.getTime() ? {} : {
            effectiveAccountingAt: nextEffectiveAt,
            ...(accountingDateChanged ? {
              accountingInputRevision: { increment: 1 },
              currentSnapshotRevision: null,
            } : {}),
          }),
        },
      });
      if (previousEffectiveAt.getTime() !== nextEffectiveAt.getTime() && !accountingDateChanged) {
        await rebaseCurrentAccountingSnapshotTimestamp(tx, {
          sessionId: input.sessionId,
          effectiveAccountingAt: nextEffectiveAt,
          effectiveLocalDate: nextLocalDate,
          timeZone: accountingTimeZone,
          timeZoneProvenance: accountingTimeZoneProvenance,
        });
      }
      if (matchChanged || previousEffectiveAt.getTime() !== nextEffectiveAt.getTime()) {
        const workoutIds = [...new Set([session.matchedWorkoutId, input.matchedWorkoutId]
          .filter((id): id is number => id !== null))];
        await invalidateActiveEnergySourcesInTransactionV1({
          tx,
          profileId: session.profileId,
          aliases: [
            { sourceType: "strength-session", sourceId: String(session.id) },
            ...workoutIds.map((id) => ({ sourceType: "workout", sourceId: String(id) })),
          ],
          affectedInstants: [
            previousWorkout?.startAt ?? previousEffectiveAt,
            previousWorkout?.endAt,
            workout?.startAt ?? nextEffectiveAt,
            workout?.endAt,
          ],
          staleMatchingAliasesOnly: true,
        });
        if (session.status === SESSION_STATUS.COMPLETED) {
          const episodes = await tx.modelEpisode.findMany({
            where: { profileId: session.profileId },
            orderBy: [{ startDate: "asc" }, { id: "asc" }],
            select: { id: true, startDate: true, timezone: true, active: true },
          });
          const oldEventAt = previousWorkout?.startAt ?? previousEffectiveAt;
          const newEventAt = workout?.startAt ?? nextEffectiveAt;
          const oldModelDate = episodeTimeContextForInstantV1(episodes, oldEventAt).date;
          const newModelDate = episodeTimeContextForInstantV1(episodes, newEventAt).date;
          const oldSourceIdentity = {
            sessionId: session.id,
            matchedWorkoutId: session.matchedWorkoutId,
            workoutSourceIdentity: previousWorkout?.sourceIdentity ?? null,
            eventAt: oldEventAt.toISOString(),
            matchStatus: session.matchStatus,
            matchMethod: session.matchMethod,
            matchedAt: session.matchedAt?.toISOString() ?? null,
          } satisfies Prisma.InputJsonObject;
          const newSourceIdentity = {
            sessionId: session.id,
            matchedWorkoutId: input.matchedWorkoutId,
            workoutSourceIdentity: workout?.sourceIdentity ?? null,
            eventAt: newEventAt.toISOString(),
            matchStatus: input.matchStatus,
            matchMethod: input.matchMethod,
            matchedAt: input.matchedAt?.toISOString() ?? null,
          } satisfies Prisma.InputJsonObject;
          await blockCompletedStrengthUnifiedInTransaction(tx, session.id, undefined, {
            operationKind: "training_match_relocated",
            affectedWorkoutIds: workoutIds,
            oldSourceIdentity,
            newSourceIdentity,
            oldEventInstants: [oldEventAt.toISOString()],
            newEventInstants: [newEventAt.toISOString()],
            oldModelDates: [oldModelDate],
            newModelDates: [newModelDate],
            deadlineMode: input.deadlineMode,
          });
        }
      }
    });
  }

  async listRecentSessions(options: {
    profileId: number;
    limit?: number;
    offset?: number;
  }): Promise<StrengthSessionSummaryDto[]> {
    const profileId = requireProfileId(options.profileId);
    const limit = Math.min(Math.max(options.limit ?? TRAINING_LIMITS.recentSessionsDefaultLimit, 1), 100);
    const offset = Math.min(Math.max(options.offset ?? 0, 0), 1_000_000);
    // Page by the same canonical occurrence time shown in the diary. The id tie
    // break makes pages stable, including retrospective and unmatched sessions.
    const pageIds = await this.db.$queryRaw<Array<{ id: number }>>`
      SELECT s."id"
      FROM "StrengthDiarySession" AS s
      LEFT JOIN "Workout" AS w ON w."id" = s."matchedWorkoutId"
      WHERE s."profileId" = ${profileId}
        AND s."status" IN (${SESSION_STATUS.COMPLETED}, ${SESSION_STATUS.CANCELLED})
      ORDER BY COALESCE(w."startAt" AT TIME ZONE 'UTC', s."webStartedAt", s."createdAt") DESC, s."id" DESC
      LIMIT ${limit} OFFSET ${offset}
    `;
    if (pageIds.length === 0) return [];
    const rows = await this.db.strengthDiarySession.findMany({
      where: { profileId, id: { in: pageIds.map(({ id }) => id) } },
      select: sessionSummarySelect,
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    return pageIds.flatMap(({ id }) => {
      const row = byId.get(id);
      return row ? [toSessionSummaryDto(row)] : [];
    });
  }

  countRecentSessions(profileId: number): Promise<number> {
    profileId = requireProfileId(profileId);
    return this.db.strengthDiarySession.count({
      where: {
        profileId,
        status: { in: [SESSION_STATUS.COMPLETED, SESSION_STATUS.CANCELLED] },
      },
    });
  }

  async listMatchAttention(options: {
    profileId: number;
    longPendingBefore?: Date;
    limit?: number;
    offset?: number;
  }): Promise<StrengthSessionSummaryDto[]> {
    const profileId = requireProfileId(options.profileId);
    const longPendingBefore = options.longPendingBefore;
    const limit = Math.min(Math.max(options.limit ?? 100, 1), 100);
    const offset = Math.min(Math.max(options.offset ?? 0, 0), 1_000_000);
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
      orderBy: [{ webEndedAt: { sort: "desc", nulls: "last" } }, { id: "desc" }],
      take: limit,
      skip: offset,
    });
    return rows.map(toSessionSummaryDto);
  }

  countMatchAttention(options: {
    profileId: number;
    longPendingBefore?: Date;
  }): Promise<number> {
    const profileId = requireProfileId(options.profileId);
    return this.db.strengthDiarySession.count({
      where: {
        profileId,
        status: SESSION_STATUS.COMPLETED,
        OR: [
          { matchStatus: MATCH_STATUS.AMBIGUOUS },
          ...(options.longPendingBefore
            ? [{
                matchStatus: MATCH_STATUS.PENDING,
                webEndedAt: { lte: options.longPendingBefore },
              }]
            : []),
        ],
      },
    });
  }

  async findPendingCompletedSessionsOverlapping(window: {
    profileId: number;
    windowStart: Date;
    windowEnd: Date;
  }) {
    const profileId = requireProfileId(window.profileId);
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
    profileId: number;
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
    const profileId = requireProfileId(interval.profileId);
    const padStart = new Date(interval.startAt.getTime() - interval.padMs);
    const padEnd = new Date(interval.endAt.getTime() + interval.padMs);
    return this.db.workout.findMany({
      where: {
        profileId,
        hiddenFromHistory: false,
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

  async findWorkoutById(workoutId: number, profileId: number) {
    profileId = requireProfileId(profileId);
    return this.db.workout.findFirst({
        where: { id: workoutId, profileId, hiddenFromHistory: false },
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
    profileId: number;
    limit?: number;
    offset?: number;
    cursor?: number;
    onlyMissingDiary?: boolean;
  }): Promise<HistoricalStrengthWorkoutDto[]> {
    const profileId = requireProfileId(options.profileId);
    const limit = options.limit ?? TRAINING_LIMITS.recentSessionsDefaultLimit;
    const rows = await this.db.workout.findMany({
      where: {
        profileId,
        hiddenFromHistory: false,
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
      ...(options.offset !== undefined
        ? { skip: Math.min(options.offset, 1_000_000) }
        : options.cursor !== undefined
          ? { cursor: { id: options.cursor }, skip: 1 }
          : {}),
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
          linkedProgramName: linked?.program?.name ?? null,
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

  countHistoricalStrengthWorkouts(options: {
    profileId: number;
    onlyMissingDiary?: boolean;
  }): Promise<number> {
    const profileId = requireProfileId(options.profileId);
    return this.db.workout.count({
      where: {
        profileId,
        hiddenFromHistory: false,
        type: { equals: TRADITIONAL_STRENGTH_TRAINING_TYPE, mode: "insensitive" },
        ...(options.onlyMissingDiary ? { matchedDiarySession: null } : {}),
      },
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
    profileId: number;
  }) {
    const profileId = requireProfileId(input.profileId);
    const program = await this.db.trainingProgram.findFirst({
      where: { id: input.programId, profileId },
      select: { id: true, name: true, archivedAt: true, currentVersionId: true },
    });
    if (!program) return null;

    const versionId = input.programVersionId ?? program.currentVersionId;
    if (versionId == null) return { ...program, version: null };

    const version = await this.db.trainingProgramVersion.findFirst({
      where: { id: versionId, programId: program.id, profileId },
      select: {
        id: true,
        versionNumber: true,
        exercises: {
          select: {
            exerciseCatalogId: true,
            sortOrder: true,
            plannedSets: true,
            resistanceType: true,
            loadAccountingConfigSnapshot: true,
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
    profileId: number,
  ): Promise<ProgramVersionSummaryDto[] | null> {
    profileId = requireProfileId(profileId);
    const program = await this.db.trainingProgram.findFirst({
      where: { id: programId, profileId },
      select: { id: true },
    });
    if (!program) return null;

    const rows = await this.db.trainingProgramVersion.findMany({
      where: { programId, profileId },
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

  async loadProgramForStart(programId: number, profileId: number) {
    profileId = requireProfileId(profileId);
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
                loadAccountingConfigSnapshot: true,
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
