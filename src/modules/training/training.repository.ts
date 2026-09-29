import { Prisma, type PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { ModelEpisodeRepository } from "@/modules/model-episodes/model-episode.repository";
import { calculateHistoricalBodyweightAsOfV1, MAX_HISTORICAL_BODYWEIGHT_REPLAY_DAYS_V1 } from "@/modules/model-episodes/historical-bodyweight-asof-v1";
import { calendarDayIndex } from "@/modules/model-episodes/model-calendar";
import { DEFAULT_TIME_ZONE, instantToLocalDateTime, isValidTimeZone, localDateTimeToInstant } from "@/model/time-zone";
import { canonicalizeWorkoutType } from "@/model/activity/workout-energy";
import { TRADITIONAL_STRENGTH_TRAINING_TYPE } from "@/modules/health/expand-training-workouts";
import { EXPERIMENTAL_STRENGTH_ACTIVE_ENERGY_V1_REVISION } from "./experimental-strength-active-energy-v1";
import {
  recomputeHistoricalStrengthEstimateKcalV1,
  selectHistoricalStrengthEnergyV1,
  strengthWorkoutAsOfDateV1,
} from "./strength-historical-energy-v1";
import { CANONICAL_EXERCISE_IDENTITIES } from "./canonical-exercise-identity";
import {
  DEFAULT_TRAINING_PROFILE_ID,
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
import { calculateLoadAccountingV1, LOAD_ACCOUNTING_METHOD_V1, LEGACY_LOAD_INTERPRETATION_V1, classifyPersistedExerciseIdentityV1, loadConfigV1Schema, type BodyweightReferenceV1, type IdentityStatusV1, type LoadAccountingOutputV1 } from "./load-accounting-v1";
import { resolveBodyweightReferenceV2, BODYWEIGHT_RESOLUTION_METHOD_V2 } from "./bodyweight-reference-v2";
import { buildMassResolutionIdentity, PERSISTED_LOAD_ACCOUNTING_PAYLOAD_V1, persistedPayloadFromUnknown, sha256Canonical } from "./persisted-load-accounting-v1";
import { addCalendarDays } from "@/modules/model-episodes/model-calendar";
import { sessionPlanCompletion } from "./session-plan-completion";
import { evaluateSessionInactivity } from "./session-inactivity";
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
): Promise<number> {
  const updated = await tx.strengthDiarySession.update({
    where: { id: sessionId },
    data: {
      accountingInputRevision: { increment: 1 },
      currentSnapshotRevision: null,
    },
    select: { accountingInputRevision: true },
  });
  return updated.accountingInputRevision;
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
  externalId: true,
  dailyHealthData: { select: { date: true, weightKg: true } },
} satisfies Prisma.WorkoutSelect;

const sessionDetailSelect = {
  id: true,
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
  experimentalStrengthEnergyShadow: { select: { result: true, modelRevision: true } },
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
  const payload = snapshot.payloadVersion === PERSISTED_LOAD_ACCOUNTING_PAYLOAD_V1
    ? persistedPayloadFromUnknown(snapshot.payload) : null;
  if (!payload) return { state: "stale", payload: null };
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

async function loadHistoricalMassContext(
  db: PrismaClient,
  record: {
    matchedWorkout: {
      startAt: Date;
      dailyHealthData?: { date: string; weightKg: number | null } | null;
    } | null;
    webStartedAt: Date | null;
    createdAt: Date;
  },
): Promise<{ sameDayMassKg: number | null; startOfDayMassKg: number | null }> {
  const asOfDate = strengthWorkoutAsOfDateV1({
    matchedWorkoutStartAt: record.matchedWorkout?.startAt.toISOString() ?? null,
    webStartedAt: record.webStartedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
  });
  let sameDayMassKg: number | null = null;
  const workoutDay = record.matchedWorkout?.dailyHealthData ?? null;
  if (workoutDay?.date === asOfDate && workoutDay.weightKg != null) {
    sameDayMassKg = workoutDay.weightKg;
  }
  const health = (db as {
    dailyHealthData?: {
      findUnique?: (args: unknown) => Promise<{ weightKg: number | null } | null>;
      findFirst?: (args: unknown) => Promise<{ weightKg: number | null } | null>;
    };
  }).dailyHealthData;
  if (sameDayMassKg === null && typeof health?.findUnique === "function") {
    const sameDay = await health.findUnique({
      where: { date: asOfDate },
      select: { weightKg: true },
    });
    sameDayMassKg = sameDay?.weightKg ?? null;
  }
  let startOfDayMassKg: number | null = null;
  if (typeof health?.findFirst === "function") {
    const prior = await health.findFirst({
      where: { weightKg: { not: null }, date: { lt: asOfDate } },
      orderBy: { date: "desc" },
      select: { weightKg: true },
    });
    startOfDayMassKg = prior?.weightKg ?? null;
  }
  return {
    sameDayMassKg,
    startOfDayMassKg,
  };
}

function selectedStrengthEnergy(
  session: StrengthSessionDto,
  massContext: { sameDayMassKg: number | null; startOfDayMassKg: number | null },
  energyShadow: { result: unknown; modelRevision?: string } | null,
) {
  const setRows = session.exercises.flatMap((exercise) => exercise.sets).map((set) => ({
    id: set.id,
    reps: set.reps,
    weightKg: set.weightKg,
    bandNominalResistanceKg: set.bandNominalResistanceKg,
    rir: set.rir,
  }));
  const onDemandEstimateKcal = session.status === "COMPLETED"
    ? recomputeHistoricalStrengthEstimateKcalV1({
      session,
      sameDayMassKg: massContext.sameDayMassKg,
      startOfDayMassKg: massContext.startOfDayMassKg,
    })
    : null;
  const selected = selectHistoricalStrengthEnergyV1({
    sessionCompleted: session.status === "COMPLETED",
    sessionId: session.id,
    sessionRevision: session.revision,
    energyShadow: energyShadow?.result ?? null,
    sets: setRows,
    sameDayMassKg: massContext.sameDayMassKg,
    startOfDayMassKg: massContext.startOfDayMassKg,
    estimatorVersion: energyShadow?.modelRevision
      ?? EXPERIMENTAL_STRENGTH_ACTIVE_ENERGY_V1_REVISION,
    onDemandEstimateKcal,
    garminKcal: session.matchedWorkout?.activeEnergyKcal ?? null,
  });
  return {
    kcal: selected.selectedKcal,
    source: selected.source,
    fullCoverage: selected.fullCoverage,
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

async function resolveSessionBodyweightReference(
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
  const dataClient = db as unknown as {
    healthMetricSample?: {
      findMany?: (args: unknown) => Promise<Array<{
        id: number;
        timestamp: Date;
        value: { toNumber(): number };
        source: string | null;
      }>>;
    };
  };
  const findSamples = dataClient.healthMetricSample?.findMany;
  if (typeof findSamples !== "function") return unavailable;
  let start: Date;
  let end: Date;
  try {
    start = localDateTimeToInstant(addCalendarDays(localDate, -7), "00:00", timeZone);
    end = localDateTimeToInstant(addCalendarDays(localDate, 8), "00:00", timeZone);
  } catch {
    return unavailable;
  }
  let observedSamples;
  try {
    const samples = await findSamples.call(dataClient.healthMetricSample, {
      where: {
        metric: "weight-kg",
        source: "apple-health-shortcut",
        timestamp: { gte: start, lt: end },
      },
      orderBy: [{ timestamp: "desc" }, { id: "desc" }],
      select: { id: true, timestamp: true, value: true, source: true },
    });
    observedSamples = samples.map((sample) => ({
      id: String(sample.id),
      timestamp: sample.timestamp,
      valueKg: sample.value.toNumber(),
      source: sample.source,
    }));
  } catch {
    return unavailable;
  }

  const observedReference = resolveBodyweightReferenceV2({
    localDate,
    timeZone,
    observedSamples,
  });
  if (observedReference.status !== "unavailable") return observedReference;

  let modelEstimate = null;
  try {
    const episodes = new ModelEpisodeRepository(db);
    const episode = await episodes.getAsOf(localDate);
    if (episode && calendarDayIndex(localDate) - calendarDayIndex(episode.startDate) + 1
        <= MAX_HISTORICAL_BODYWEIGHT_REPLAY_DAYS_V1) {
      const sources = await episodes.loadSources(episode.startDate, localDate);
      const estimate = calculateHistoricalBodyweightAsOfV1({ episode, sources, localDate });
      if (estimate.status === "available" && estimate.valueKg !== null) {
        modelEstimate = {
          localDate: estimate.localDate,
          valueKg: estimate.valueKg,
          episodeId: estimate.episodeId,
          modelVersion: estimate.modelVersion,
          uncertainty: estimate.uncertainty,
        };
      }
    }
  } catch {
    // Historical fallback is optional; fail closed while preserving observed inputs.
  }

  return resolveBodyweightReferenceV2({
    localDate,
    timeZone,
    observedSamples,
    modelEstimate,
  });
}

function calculateSessionLoadAccounting(
  record: SessionDetailRecord,
  localDate: string,
  bodyweightReference: BodyweightReferenceV1,
) {
  return calculateLoadAccountingV1({
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
        identity: { status: identity, stableKey },
        resistanceHint: exercise.resistanceType === "RESISTANCE_BAND" ? "band-nominal" as const
          : exercise.resistanceType === "BODYWEIGHT" ? "bodyweight" as const
            : "external" as const,
        configSnapshot: configValue,
        configProvenance: provenance,
        sets: exercise.sets.map((set) => ({
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
  massContext: { sameDayMassKg: number | null; startOfDayMassKg: number | null } = {
    sameDayMassKg: null,
    startOfDayMassKg: null,
  },
  loadAccountingV1?: LoadAccountingOutputV1,
  materializationState: "current" | "missing" | "pending" | "stale" = "missing",
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
    programName: record.program.name,
    programVersionId: record.programVersionId,
    programVersionNumber: record.programVersion.versionNumber,
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
    materializationState,
    autoAdvanceExercises: record.profile?.autoAdvanceExercises ?? false,
    ...planCompletionFields(exercises),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
  return {
    ...sessionWithoutEnergy,
    selectedActiveEnergy: selectedStrengthEnergy(
      sessionWithoutEnergy,
      massContext,
      record.experimentalStrengthEnergyShadow,
    ),
  };
}

async function toSessionDtoWithHistoricalMass(
  db: PrismaClient,
  record: SessionDetailRecord,
): Promise<StrengthSessionDto> {
  const massContext = await loadHistoricalMassContext(db, record);
  const snapshot = currentSnapshotForRecord(record);
  return toSessionDto(
    record,
    massContext,
    snapshot.state === "current" ? snapshot.payload?.result : undefined,
    snapshot.state,
  );
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
    programName: record.program.name,
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
   * Bootstrap/upsert the supported exercises with explicit portable keys.
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
      select: {
        id: true, name: true, stableKey: true, isActive: true, muscleMapping: true,
        currentLoadAccountingConfig: { select: { configVersion: true, configuration: true } },
      },
    });
  }

  async setCatalogLoadAccountingConfig(input: {
    catalogId: number;
    profileId?: number;
    config: Prisma.InputJsonValue | null;
    configVersion?: string;
  }): Promise<boolean> {
    const profileId = input.profileId ?? DEFAULT_TRAINING_PROFILE_ID;
    return this.db.$transaction(async (tx) => {
      const catalog = await tx.exerciseCatalog.findFirst({
        where: { id: input.catalogId, profileId },
        select: { id: true },
      });
      if (!catalog) return false;
      if (input.config === null || input.configVersion === undefined) {
        await tx.exerciseCatalog.update({
          where: { id: catalog.id },
          data: { currentLoadAccountingConfigId: null },
        });
        return true;
      }
      const version = await tx.exerciseLoadConfiguration.create({
        data: {
          exerciseCatalogId: catalog.id,
          configVersion: input.configVersion,
          configuration: input.config,
        },
        select: { id: true },
      });
      await tx.exerciseCatalog.update({
        where: { id: catalog.id },
        data: { currentLoadAccountingConfigId: version.id },
      });
      return true;
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
              loadAccountingConfigSnapshot: nullableJsonInput(exercise.loadAccountingConfigSnapshot),
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
          programId: existing.id,
          versionNumber: nextVersionNumber,
          exercises: {
            create: nextExercises.map((exercise) => ({
              exerciseCatalogId: exercise.exerciseCatalogId,
              sortOrder: exercise.sortOrder,
              plannedSets: exercise.plannedSets,
              resistanceType: exercise.resistanceType,
              loadAccountingConfigSnapshot: nullableJsonInput(exercise.loadAccountingConfigSnapshot),
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
    return row ? toSessionDtoWithHistoricalMass(this.db, row) : null;
  }

  async finishInactiveSessions(input: { profileId?: number; now?: Date } = {}): Promise<Array<{ id: number; endAt: Date }>> {
    const profileId = input.profileId ?? DEFAULT_TRAINING_PROFILE_ID;
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
    profileId = DEFAULT_TRAINING_PROFILE_ID,
  ): Promise<StrengthSessionDto | null> {
    const row = await this.db.strengthDiarySession.findFirst({
      where: { id: sessionId, profileId },
      select: sessionDetailSelect,
    });
    return row ? toSessionDtoWithHistoricalMass(this.db, row) : null;
  }

  async updateAccountingContext(input: {
    sessionId: number;
    profileId?: number;
    effectiveAccountingAt?: Date;
    timeZone?: string;
  }): Promise<void> {
    const profileId = input.profileId ?? DEFAULT_TRAINING_PROFILE_ID;
    await this.db.$transaction(async (tx) => {
      await tx.$queryRaw<Array<{ id: number }>>`
        SELECT "id" FROM "StrengthDiarySession"
        WHERE "id" = ${input.sessionId} AND "profileId" = ${profileId}
        FOR UPDATE
      `;
      const session = await tx.strengthDiarySession.findFirst({
        where: { id: input.sessionId, profileId },
        select: {
          effectiveAccountingAt: true, webStartedAt: true, createdAt: true,
          accountingTimeZone: true, accountingTimeZoneProvenance: true,
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
      await tx.strengthDiarySession.update({
        where: { id: input.sessionId },
        data: {
          effectiveAccountingAt: effectiveAt,
          accountingTimeZone: timeZone,
          accountingTimeZoneProvenance: timeZoneProvenance,
          accountingInputRevision: { increment: 1 },
          currentSnapshotRevision: null,
        },
      });
    });
  }

  /** Controlled Stage 02 write path. GET never calls this method. */
  async materializeAccounting(input: {
    sessionId: number;
    profileId?: number;
    mode?: "ordinary" | "refresh";
    idempotencyKey?: string;
    finalizeAt?: Date;
  }): Promise<number> {
    const profileId = input.profileId ?? DEFAULT_TRAINING_PROFILE_ID;
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
        await tx.strengthDiarySession.updateMany({
          where: { id: record.id, profileId, status: SESSION_STATUS.ACTIVE },
          data: { status: SESSION_STATUS.COMPLETED, webEndedAt: input.finalizeAt },
        });
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
        if (candidate.payloadVersion !== PERSISTED_LOAD_ACCOUNTING_PAYLOAD_V1) continue;
        const parsed = persistedPayloadFromUnknown(candidate.payload);
        if (parsed && parsed.massReference.status !== "unavailable") {
          massReference = parsed.massReference;
          break;
        }
      }
    }
    if (!massReference) {
      massReference = await resolveSessionBodyweightReference(
        this.db,
        record,
        localDate,
        timeZone,
      );
    }

    const result = calculateSessionLoadAccounting(record, localDate, massReference);
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
          experimentalStrengthEnergyShadow: { select: { result: true, modelRevision: true } },
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
          await tx.strengthDiarySession.updateMany({
            where: { id: record.id, profileId, status: SESSION_STATUS.ACTIVE },
            data: { status: SESSION_STATUS.COMPLETED, webEndedAt: input.finalizeAt },
          });
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
        schemaVersion: PERSISTED_LOAD_ACCOUNTING_PAYLOAD_V1,
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
          payloadVersion: PERSISTED_LOAD_ACCOUNTING_PAYLOAD_V1,
          payload: JSON.parse(JSON.stringify(parsedPayload)) as Prisma.InputJsonValue,
        },
      });
      await tx.strengthDiarySession.update({
        where: { id: record.id },
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
    profileId?: number;
    programId: number;
    programVersionId: number;
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
    const profileId = input.profileId ?? DEFAULT_TRAINING_PROFILE_ID;
    const webStartedAt = input.webStartedAt === undefined ? new Date() : input.webStartedAt;
    const effectiveAccountingAt = input.effectiveAccountingAt
      ?? webStartedAt
      ?? new Date();
    const accountingTimeZone = input.accountingTimeZone ?? DEFAULT_TIME_ZONE;
    const accountingTimeZoneProvenance = input.accountingTimeZoneProvenance ?? "legacy-default";
    const created = await this.db.strengthDiarySession.create({
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
        where: { id: input.sessionId },
        data: {
          programId: input.toProgramId,
          programVersionId: input.toProgramVersionId,
          revision: { increment: 1 },
          accountingInputRevision: { increment: 1 },
          currentSnapshotRevision: null,
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
    loadAccountingConfigSnapshot: Prisma.InputJsonValue | null;
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
        where: { id: input.sessionId },
        data: {
          revision: { increment: 1 },
          accountingInputRevision: { increment: 1 },
          currentSnapshotRevision: null,
        },
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
        data: {
          revision: { increment: 1 },
          ...(input.resistanceType !== undefined || input.clearWeightKg || input.clearBandNominalResistanceKg
            ? { accountingInputRevision: { increment: 1 }, currentSnapshotRevision: null }
            : {}),
        },
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
        data: {
          revision: { increment: 1 },
          accountingInputRevision: { increment: 1 },
          currentSnapshotRevision: null,
        },
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
    loadAccountingOverride?: Prisma.InputJsonValue | null;
  }): Promise<StrengthSetDto> {
    return this.db.$transaction(async (tx) => {
      const exercise = await tx.strengthSessionExercise.findUnique({
        where: { id: input.sessionExerciseId }, select: { sessionId: true },
      });
      if (!exercise) throw new Error("session exercise not found while creating set");
      const row = await tx.strengthSet.create({
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
          loadAccountingOverride: nullableJsonInput(input.loadAccountingOverride ?? null),
        },
        select: setSelect,
      });
      await bumpAccountingInputRevision(tx, exercise.sessionId);
      return toSetDto(row);
    });
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
    loadAccountingOverride?: Prisma.InputJsonValue | null;
  }): Promise<StrengthSetDto | null> {
    const profileId = input.profileId ?? DEFAULT_TRAINING_PROFILE_ID;
    return this.db.$transaction(async (tx) => {
      const existing = await tx.strengthSet.findFirst({
        where: {
          id: input.setId,
          sessionExercise: { sessionId: input.sessionId, session: { profileId } },
        },
        select: {
          id: true, reps: true, weightKg: true, bandNominalResistanceKg: true,
          loadAccountingOverride: true, sessionExercise: { select: { sessionId: true } },
        },
      });
      if (!existing) return null;
      const accountingChanged = (input.reps !== undefined && input.reps !== existing.reps)
        || (input.weightKg !== undefined && input.weightKg !== existing.weightKg?.toNumber() && !(input.weightKg === null && existing.weightKg === null))
        || (input.bandNominalResistanceKg !== undefined
          && input.bandNominalResistanceKg !== existing.bandNominalResistanceKg?.toNumber()
          && !(input.bandNominalResistanceKg === null && existing.bandNominalResistanceKg === null))
        || (input.loadAccountingOverride !== undefined
          && JSON.stringify(input.loadAccountingOverride) !== JSON.stringify(existing.loadAccountingOverride));
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
      return toSetDto(row);
    });
  }

  async deleteSet(
    setId: number,
    sessionId: number,
    profileId = DEFAULT_TRAINING_PROFILE_ID,
  ): Promise<boolean> {
    return this.db.$transaction(async (tx) => {
      const existing = await tx.strengthSet.findFirst({
        where: { id: setId, sessionExercise: { sessionId, session: { profileId } } },
        select: { id: true },
      });
      if (!existing) return false;
      await tx.strengthSet.delete({ where: { id: setId } });
      await bumpAccountingInputRevision(tx, sessionId);
      return true;
    });
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
            setNumber: true,
            reps: true,
            weightKg: true,
            bandNominalResistanceKg: true,
            rir: true,
            comment: true,
            completedAt: true,
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
          completedAt: set.completedAt?.toISOString() ?? null,
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
    await this.db.$transaction(async (tx) => {
      const session = await tx.strengthDiarySession.findUnique({
        where: { id: input.sessionId },
        select: {
          effectiveAccountingAt: true,
          accountingTimeZone: true,
          webStartedAt: true,
          createdAt: true,
        },
      });
      if (!session) return;
      const workout = input.matchedWorkoutId === null ? null : await tx.workout.findUnique({
        where: { id: input.matchedWorkoutId }, select: { startAt: true },
      });
      const nextEffectiveAt = workout?.startAt ?? session.webStartedAt ?? session.createdAt;
      const previousEffectiveAt = session.effectiveAccountingAt ?? session.webStartedAt ?? session.createdAt;
      const accountingTimeZone = session.accountingTimeZone ?? DEFAULT_TIME_ZONE;
      const previousLocalDate = instantToLocalDateTime(previousEffectiveAt, accountingTimeZone).date;
      const nextLocalDate = instantToLocalDateTime(nextEffectiveAt, accountingTimeZone).date;
      const accountingDateChanged = previousLocalDate !== nextLocalDate;
      await tx.strengthDiarySession.update({
        where: { id: input.sessionId },
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
    });
  }

  async listRecentSessions(options: {
    profileId?: number;
    limit?: number;
    offset?: number;
  } = {}): Promise<StrengthSessionSummaryDto[]> {
    const profileId = options.profileId ?? DEFAULT_TRAINING_PROFILE_ID;
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

  countRecentSessions(profileId = DEFAULT_TRAINING_PROFILE_ID): Promise<number> {
    return this.db.strengthDiarySession.count({
      where: {
        profileId,
        status: { in: [SESSION_STATUS.COMPLETED, SESSION_STATUS.CANCELLED] },
      },
    });
  }

  async listMatchAttention(options: {
    profileId?: number;
    longPendingBefore?: Date;
    limit?: number;
    offset?: number;
  } = {}): Promise<StrengthSessionSummaryDto[]> {
    const profileId = options.profileId ?? DEFAULT_TRAINING_PROFILE_ID;
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
    profileId?: number;
    longPendingBefore?: Date;
  } = {}): Promise<number> {
    const profileId = options.profileId ?? DEFAULT_TRAINING_PROFILE_ID;
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

  async findWorkoutById(workoutId: number) {
    return this.db.workout.findUnique({
        where: { id: workoutId, hiddenFromHistory: false },
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
    offset?: number;
    cursor?: number;
    onlyMissingDiary?: boolean;
  } = {}): Promise<HistoricalStrengthWorkoutDto[]> {
    const limit = options.limit ?? TRAINING_LIMITS.recentSessionsDefaultLimit;
    const rows = await this.db.workout.findMany({
      where: {
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

  countHistoricalStrengthWorkouts(options: {
    onlyMissingDiary?: boolean;
  } = {}): Promise<number> {
    return this.db.workout.count({
      where: {
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
