import { DEFAULT_TIME_ZONE, instantToLocalDateTime } from "@/model/time-zone";
import { resolveEventEnergyV1, type EnergySourceKind } from "@/model/activity/canonical-activity-policy-v1";
import { EXPERIMENTAL_STRENGTH_ACTIVE_ENERGY_V1_REVISION } from "@/modules/training/experimental-strength-active-energy-v1";
import {
  historicalStrengthInputFingerprintV1,
  recomputeHistoricalStrengthEstimateKcalV1,
  selectHistoricalStrengthEnergyV1,
} from "@/modules/training/strength-historical-energy-v1";
import {
  strengthEstimateFreshV1,
} from "@/modules/training/strength-publication-v1";
import type { StrengthSessionDto } from "@/modules/training/training.types";
import { ENTRY_MODE, MATCH_STATUS, RESISTANCE, SESSION_STATUS, EXERCISE_ORIGIN } from "@/modules/training/training.constants";

// Preserve the original import path for callers while keeping client components
// on the dedicated client-safe empty-fact module.
export { emptyTrainingDayFact } from "./training-day-fact-empty";

export type ExerciseDetailAvailability = "logged-sets" | "no-logged-sets" | "unavailable";
export type TrainingEventExecutionStatus = "in-progress" | "completed" | "partial" | "unknown";

export type TrainingDayEnergySource =
  | EnergySourceKind
  | "device-estimate"
  | "shadow-diary-estimate";

export type TrainingDayEventFact = {
  eventId: string;
  source: "workout" | "diary" | "matched";
  type: string;
  occurrenceAt: string;
  modelDate?: string;
  endAt: string | null;
  durationMinutes: number | null;
  activeEnergyKcal: number | null;
  energySource: TrainingDayEnergySource;
  executionStatus: TrainingEventExecutionStatus;
  workoutId: number | null;
  diarySessionId: number | null;
  diaryProgramName: string | null;
  diaryOnly: boolean;
  exerciseDetailAvailability: ExerciseDetailAvailability;
  loggedSetCount: number | null;
};

export type TrainingDayFact = {
  date: string;
  eventCount: number;
  /** 0 when there are no events; null when any event duration is unavailable. */
  durationMinutes: number | null;
  /** Hidden events count toward eventCount but do not reveal their details. */
  hiddenEventCount: number;
  /** Visible detail rows only; this can be shorter than eventCount. */
  events: TrainingDayEventFact[];
};

export type StrengthSetFactRow = {
  id: number;
  sessionExerciseId?: number;
  completedAt?: string | null;
  reps: number;
  weightKg: number | null;
  bandNominalResistanceKg?: number | null;
  rir?: number | null;
  resistanceType?: string | null;
};

export type StrengthFreshnessContext = {
  sessionId: number;
  revision: number | null | undefined;
  status: string | null | undefined;
  energyShadow: unknown;
  activeEnergyMassReference?: StrengthSessionDto["activeEnergyMassReference"];
  sets: readonly StrengthSetFactRow[];
  /** Preserves per-exercise resistance for on-demand recompute. */
  exercises?: readonly {
    resistanceType: string;
    sets: readonly StrengthSetFactRow[];
  }[];
  sameDayMassKg: number | null;
  startOfDayMassKg: number | null;
  estimatorVersion?: string | null;
  entryMode?: string | null;
  webStartedAt?: string | null;
  webEndedAt?: string | null;
  matchedWorkout?: {
    startAt: string;
    endAt: string;
    durationMinutes: number | null;
    activeEnergyKcal: number | null;
  } | null;
};

export type WorkoutFactSource = {
  id: number;
  sourceIdentity: string;
  type: string;
  startAt: Date;
  endAt: Date;
  modelDate?: string;
  durationMinutes: number | null;
  activeEnergyKcal: number | null;
  manualStepCount?: number | null;
  manualActiveEnergyKcal?: number | null;
  mechanicalStepperKcal?: number | null;
  canonicalEnergyResolution?: { kcal: number | null; source: string; revision: number } | null;
  hiddenFromHistory: boolean;
  matchedDiarySession: {
    id: number;
    status: string | null;
    revision?: number | null;
    entryMode?: string | null;
    webStartedAt?: string | null;
    webEndedAt?: string | null;
    programName: string | null;
    loggedSetCount: number;
    energyShadow: unknown;
    activeEnergyMassReference?: StrengthSessionDto["activeEnergyMassReference"];
    sets?: readonly StrengthSetFactRow[];
    exercises?: readonly { resistanceType: string; sets: readonly StrengthSetFactRow[] }[];
    sameDayMassKg?: number | null;
    startOfDayMassKg?: number | null;
    estimatorVersion?: string | null;
    canonicalEnergyResolution?: { kcal: number | null; source: string; revision: number } | null;
  } | null;
};

export type DiaryFactSource = {
  id: number;
  status: string;
  entryMode: string;
  revision?: number | null;
  webStartedAt: Date | null;
  modelDate?: string | null;
  webEndedAt: Date | null;
  matchedWorkoutId?: number | null;
  loggedSetCount: number;
  programName: string | null;
  energyShadow: unknown;
  activeEnergyMassReference?: StrengthSessionDto["activeEnergyMassReference"];
  sets?: readonly StrengthSetFactRow[];
  exercises?: readonly { resistanceType: string; sets: readonly StrengthSetFactRow[] }[];
  sameDayMassKg?: number | null;
  startOfDayMassKg?: number | null;
  estimatorVersion?: string | null;
  canonicalEnergyResolution?: { kcal: number | null; source: string; revision: number } | null;
};

function validDuration(value: number | null): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function elapsedDuration(startAt: Date, endAt: Date | null): number | null {
  if (!endAt || endAt <= startAt) return null;
  return (endAt.getTime() - startAt.getTime()) / 60_000;
}

function shadowKcal(value: unknown): number | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const resolution = (value as { activeEnergyResolution?: unknown; estimatedActiveKcal?: unknown }).activeEnergyResolution
    ?? value;
  if (typeof resolution !== "object" || resolution === null || Array.isArray(resolution)) {
    const direct = (value as { estimatedActiveKcal?: unknown }).estimatedActiveKcal;
    return typeof direct === "number" && Number.isFinite(direct) && direct >= 0 ? direct : null;
  }
  const kcal = (resolution as { estimatedActiveKcal?: unknown }).estimatedActiveKcal;
  return typeof kcal === "number" && Number.isFinite(kcal) && kcal >= 0 ? kcal : null;
}

function shadowSessionRevision(value: unknown): number | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const revision = (value as { sessionRevision?: unknown }).sessionRevision;
  return typeof revision === "number" && Number.isInteger(revision) ? revision : null;
}

function shadowInputFingerprint(value: unknown): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const fingerprint = (value as { inputFingerprint?: unknown }).inputFingerprint;
  return typeof fingerprint === "string" && fingerprint.length > 0 ? fingerprint : null;
}

/**
 * Fresh only when the stored shadow fingerprint still matches historical
 * as-of-date estimator inputs. Presence of a fingerprint string alone is not
 * enough — late same-day mass or set edits without a revision bump must
 * invalidate the estimate. Today's later mass is never part of this check.
 */
export function strengthEstimateFreshForDay(input: StrengthFreshnessContext & {
  diaryKcal: number | null;
}): boolean {
  if (input.status !== "COMPLETED" || input.diaryKcal === null || input.revision == null) return false;
  const currentInputFingerprint = historicalStrengthInputFingerprintV1({
    sessionId: input.sessionId,
    sessionRevision: input.revision,
    sets: input.sets,
    sameDayMassKg: input.sameDayMassKg ?? null,
    startOfDayMassKg: input.startOfDayMassKg ?? null,
    stage02MassReference: input.activeEnergyMassReference,
    estimatorInputs: historicalEstimatorInputs(input),
    estimatorVersion: input.estimatorVersion ?? EXPERIMENTAL_STRENGTH_ACTIVE_ENERGY_V1_REVISION,
  });
  return strengthEstimateFreshV1({
    estimateKcal: input.diaryKcal,
    sessionRevision: input.revision,
    shadowSessionRevision: shadowSessionRevision(input.energyShadow),
    storedInputFingerprint: shadowInputFingerprint(input.energyShadow),
    currentInputFingerprint,
  });
}

function historicalEstimatorInputs(input: StrengthFreshnessContext) {
  return {
    entryMode: input.entryMode ?? null,
    startAt: input.matchedWorkout?.startAt ?? input.webStartedAt ?? null,
    endAt: input.matchedWorkout?.endAt ?? input.webEndedAt ?? null,
    durationMinutes: input.matchedWorkout?.durationMinutes ?? null,
    stage02MassReference: input.activeEnergyMassReference?.reference ?? null,
    stage02SnapshotRevision: input.activeEnergyMassReference?.snapshotRevision ?? null,
    stage02InputFingerprint: input.activeEnergyMassReference?.inputFingerprint ?? null,
    stage02MassResolutionIdentity: input.activeEnergyMassReference?.massResolutionIdentity ?? null,
  };
}

function stubSessionForHistoricalEstimate(input: StrengthFreshnessContext): StrengthSessionDto {
  const resistance = (value: string | null | undefined) => {
    if (value === RESISTANCE.RESISTANCE_BAND || value === RESISTANCE.BODYWEIGHT) return value;
    return RESISTANCE.EXTERNAL_WEIGHT;
  };
  const exerciseGroups = (input.exercises && input.exercises.length > 0)
    ? input.exercises.map((exercise) => ({
      resistanceType: resistance(exercise.resistanceType),
      sets: exercise.sets,
    }))
    : [{
      resistanceType: resistance(input.sets[0]?.resistanceType),
      sets: input.sets,
    }];
  const createdAt = input.webStartedAt ?? input.matchedWorkout?.startAt ?? new Date(0).toISOString();
  return {
    id: input.sessionId,
    status: (input.status as StrengthSessionDto["status"]) ?? SESSION_STATUS.COMPLETED,
    entryMode: input.entryMode === ENTRY_MODE.RETROSPECTIVE
      ? ENTRY_MODE.RETROSPECTIVE
      : ENTRY_MODE.LIVE,
    revision: input.revision ?? 1,
    programId: 0,
    programName: "",
    programVersionId: 0,
    programVersionNumber: 1,
    webStartedAt: input.webStartedAt ?? null,
    webEndedAt: input.webEndedAt ?? null,
    matchStatus: MATCH_STATUS.MATCHED,
    matchMethod: null,
    matchedAt: null,
    matchedWorkoutId: input.matchedWorkout ? 1 : null,
    matchedWorkout: input.matchedWorkout
      ? {
        id: 1,
        type: "Traditional Strength Training",
        startAt: input.matchedWorkout.startAt,
        endAt: input.matchedWorkout.endAt,
        durationMinutes: input.matchedWorkout.durationMinutes,
        activeEnergyKcal: input.matchedWorkout.activeEnergyKcal,
        externalId: null,
      }
      : null,
    exercises: exerciseGroups.map((exercise, exerciseIndex) => ({
      id: exerciseIndex + 1,
      sourceExerciseCatalogId: null,
      stableKey: null,
      snapshotExerciseName: `historical-${exerciseIndex + 1}`,
      order: exerciseIndex,
      plannedSets: exercise.sets.length,
      resistanceType: exercise.resistanceType,
      origin: EXERCISE_ORIGIN.PLANNED,
      muscleMappingSnapshot: null,
      sets: exercise.sets.map((set, setIndex) => ({
        id: set.id,
        sessionExerciseId: exerciseIndex + 1,
        setNumber: setIndex + 1,
        reps: set.reps,
        weightKg: set.weightKg,
        bandNominalResistanceKg: set.bandNominalResistanceKg ?? null,
        rir: set.rir ?? null,
        comment: null,
        completedAt: set.completedAt ?? null,
        createdAt,
        updatedAt: createdAt,
      })),
    })),
    ordinaryTonnageKg: null,
    createdAt,
    updatedAt: input.webEndedAt ?? input.matchedWorkout?.endAt ?? createdAt,
  };
}

function resolveStrengthFactEnergy(input: StrengthFreshnessContext & {
  deviceKcal: number | null;
  manualKcal?: number | null;
  diaryOnly?: boolean;
}): { kcal: number | null; energySource: TrainingDayEnergySource } {
  const sessionCompleted = input.status === "COMPLETED";
  const onDemandEstimateKcal = sessionCompleted && input.revision != null
    ? recomputeHistoricalStrengthEstimateKcalV1({
      session: stubSessionForHistoricalEstimate(input),
      sameDayMassKg: input.sameDayMassKg ?? null,
      startOfDayMassKg: input.startOfDayMassKg ?? null,
      stage02MassReference: input.activeEnergyMassReference,
    })
    : null;
  const selected = selectHistoricalStrengthEnergyV1({
    sessionCompleted,
    sessionId: input.sessionId,
    sessionRevision: input.revision ?? 0,
    energyShadow: input.energyShadow,
    sets: input.sets,
    sameDayMassKg: input.sameDayMassKg ?? null,
    startOfDayMassKg: input.startOfDayMassKg ?? null,
    stage02MassReference: input.activeEnergyMassReference,
    estimatorInputs: historicalEstimatorInputs(input),
    estimatorVersion: input.estimatorVersion,
    onDemandEstimateKcal,
    manualKcal: input.manualKcal ?? null,
    garminKcal: input.deviceKcal,
  });
  const energySource: TrainingDayEnergySource = input.diaryOnly === true
    && selected.source === "bodycast-strength-estimate"
    ? "shadow-diary-estimate"
    : selected.source;
  return { kcal: selected.selectedKcal, energySource };
}

function selectedDayEnergy(input: {
  classification: "traditional-strength-training" | "stair-climbing" | "other";
  deviceKcal: number | null;
  bodyCastKcal: number | null;
  bodyCastFresh: boolean;
  sessionCompleted: boolean;
  manualKcal: number | null;
  manualKcalPresent: boolean;
  mechanicalKcal: number | null;
  diaryOnly?: boolean;
}): { kcal: number | null; energySource: TrainingDayEnergySource } {
  const selected = resolveEventEnergyV1({
    classification: input.classification,
    activeEnergyKcal: input.deviceKcal,
    bodyCastEstimateKcal: input.bodyCastKcal,
    bodyCastEstimateFresh: input.bodyCastFresh,
    strengthSessionCompleted: input.sessionCompleted,
    manualActiveKcal: input.manualKcal,
    manualActiveKcalPresent: input.manualKcalPresent,
    mechanicalStepperKcal: input.mechanicalKcal,
  });
  const energySource: TrainingDayEnergySource = input.diaryOnly === true
    && selected.source === "bodycast-strength-estimate"
    ? "shadow-diary-estimate"
    : selected.source;
  return { kcal: selected.selectedKcal, energySource };
}

function canonicalEnergySelection(input: { kcal: number | null; source: string }): { kcal: number | null; energySource: TrainingDayEnergySource } {
  const source = input.source === "device-kcal" ? "garmin-fallback" : input.source;
  return { kcal: input.kcal, energySource: source as TrainingDayEnergySource };
}

function executionStatus(status: string | null | undefined, loggedSetCount: number): TrainingEventExecutionStatus {
  if (status === "ACTIVE") return "in-progress";
  if (status === "COMPLETED") return "completed";
  if (status === "CANCELLED" && loggedSetCount > 0) return "partial";
  return "unknown";
}

function makeFact(date: string, events: TrainingDayEventFact[], hiddenEventCount: number): TrainingDayFact {
  const eventCount = events.length + hiddenEventCount;
  const durationMinutes = eventCount === 0
    ? 0
    : hiddenEventCount > 0 || events.some((event) => event.durationMinutes === null)
      ? null
      : events.reduce((sum, event) => sum + (event.durationMinutes ?? 0), 0);
  return { date, eventCount, durationMinutes, hiddenEventCount, events };
}

/**
 * Resolve recorded Workout and LIVE diary rows into local-day events.
 * Matching uses the persisted Workout/session relation; timestamps are never
 * used as a fuzzy deduplication key.
 */
export function resolveTrainingDayFacts(input: {
  workouts: readonly WorkoutFactSource[];
  diarySessions: readonly DiaryFactSource[];
  timeZone?: string;
}): TrainingDayFact[] {
  const timeZone = input.timeZone ?? DEFAULT_TIME_ZONE;
  const canonicalWorkouts = new Map<string, WorkoutFactSource>();
  for (const workout of input.workouts) {
    const identity = workout.sourceIdentity.trim() || `workout-id:${workout.id}`;
    const current = canonicalWorkouts.get(identity);
    // A retained hidden/tombstoned row wins over a duplicate visible copy.
    if (!current || Number(workout.hiddenFromHistory) > Number(current.hiddenFromHistory)
      || (!current.matchedDiarySession && workout.matchedDiarySession)) {
      canonicalWorkouts.set(identity, workout);
    }
  }

  const byDate = new Map<string, { events: TrainingDayEventFact[]; hiddenEventCount: number }>();
  const add = (event: TrainingDayEventFact, hidden: boolean) => {
    const date = event.modelDate ?? instantToLocalDateTime(new Date(event.occurrenceAt), timeZone).date;
    const day = byDate.get(date) ?? { events: [], hiddenEventCount: 0 };
    if (hidden) day.hiddenEventCount += 1;
    else day.events.push(event);
    byDate.set(date, day);
  };

  for (const workout of canonicalWorkouts.values()) {
    const matched = workout.matchedDiarySession;
    const durationMinutes = validDuration(workout.durationMinutes) ?? elapsedDuration(workout.startAt, workout.endAt);
    const deviceKcal = validDuration(workout.activeEnergyKcal) === null
      ? (workout.activeEnergyKcal === 0 ? 0 : null)
      : workout.activeEnergyKcal;
    const diaryKcal = matched ? shadowKcal(matched.energyShadow) : null;
    const sessionCompleted = matched?.status === "COMPLETED";
    const classification = workout.type.trim().toLowerCase() === "stair climbing"
      ? "stair-climbing" as const
      : workout.type.trim().toLowerCase() === "traditional strength training"
        ? "traditional-strength-training" as const
        : "other" as const;
    const selected = workout.canonicalEnergyResolution
      ? canonicalEnergySelection(workout.canonicalEnergyResolution)
      : classification === "traditional-strength-training" && matched
      ? resolveStrengthFactEnergy({
        sessionId: matched.id,
        status: matched.status,
        revision: matched.revision,
        energyShadow: matched.energyShadow,
        activeEnergyMassReference: matched.activeEnergyMassReference,
        sets: matched.sets ?? [],
        exercises: matched.exercises,
        sameDayMassKg: matched.sameDayMassKg ?? null,
        startOfDayMassKg: matched.startOfDayMassKg ?? null,
        estimatorVersion: matched.estimatorVersion,
        entryMode: matched.entryMode,
        webStartedAt: matched.webStartedAt ?? null,
        webEndedAt: matched.webEndedAt ?? null,
        matchedWorkout: {
          startAt: workout.startAt.toISOString(),
          endAt: workout.endAt.toISOString(),
          durationMinutes: workout.durationMinutes,
          activeEnergyKcal: workout.activeEnergyKcal,
        },
        deviceKcal,
        manualKcal: workout.manualActiveEnergyKcal ?? null,
      })
      : selectedDayEnergy({
        classification,
        deviceKcal,
        bodyCastKcal: sessionCompleted ? diaryKcal : null,
        bodyCastFresh: matched
          ? strengthEstimateFreshForDay({
            sessionId: matched.id,
            status: matched.status,
            revision: matched.revision,
            energyShadow: matched.energyShadow,
            activeEnergyMassReference: matched.activeEnergyMassReference,
            diaryKcal,
            sets: matched.sets ?? [],
            sameDayMassKg: matched.sameDayMassKg ?? null,
            startOfDayMassKg: matched.startOfDayMassKg ?? null,
            estimatorVersion: matched.estimatorVersion,
          })
          : false,
        sessionCompleted: sessionCompleted === true,
        manualKcal: workout.manualActiveEnergyKcal ?? null,
        manualKcalPresent: workout.manualActiveEnergyKcal !== undefined && workout.manualActiveEnergyKcal !== null,
        mechanicalKcal: workout.mechanicalStepperKcal ?? null,
      });
    add({
      eventId: `workout:${workout.id}`,
      source: matched ? "matched" : "workout",
      type: workout.type,
      occurrenceAt: workout.startAt.toISOString(),
      ...(workout.modelDate ? { modelDate: workout.modelDate } : {}),
      endAt: workout.endAt.toISOString(),
      durationMinutes,
      activeEnergyKcal: selected.kcal,
      energySource: selected.energySource,
      executionStatus: matched ? executionStatus(matched.status, matched.loggedSetCount) : "unknown",
      workoutId: workout.id,
      diarySessionId: matched?.id ?? null,
      diaryProgramName: matched?.programName ?? null,
      diaryOnly: false,
      exerciseDetailAvailability: matched
        ? matched.loggedSetCount > 0 ? "logged-sets" : "no-logged-sets"
        : "unavailable",
      loggedSetCount: matched ? matched.loggedSetCount : null,
    }, workout.hiddenFromHistory);
  }

  for (const session of input.diarySessions) {
    if (session.entryMode !== "LIVE" || session.webStartedAt === null || session.matchedWorkoutId != null) continue;
    const eligible = session.status === "ACTIVE" || session.status === "COMPLETED"
      || (session.status === "CANCELLED" && session.loggedSetCount > 0);
    if (!eligible) continue;
    const selected = session.canonicalEnergyResolution
      ? canonicalEnergySelection(session.canonicalEnergyResolution)
      : resolveStrengthFactEnergy({
      sessionId: session.id,
      status: session.status,
      revision: session.revision,
      energyShadow: session.energyShadow,
      activeEnergyMassReference: session.activeEnergyMassReference,
      sets: session.sets ?? [],
      exercises: session.exercises,
      sameDayMassKg: session.sameDayMassKg ?? null,
      startOfDayMassKg: session.startOfDayMassKg ?? null,
      estimatorVersion: session.estimatorVersion,
      entryMode: session.entryMode,
      webStartedAt: session.webStartedAt?.toISOString() ?? null,
      webEndedAt: session.webEndedAt?.toISOString() ?? null,
      matchedWorkout: null,
      deviceKcal: null,
      manualKcal: null,
      diaryOnly: true,
    });
    add({
      eventId: `diary:${session.id}`,
      source: "diary",
      type: "Traditional Strength Training",
      occurrenceAt: session.webStartedAt.toISOString(),
      ...(session.modelDate ? { modelDate: session.modelDate } : {}),
      endAt: session.webEndedAt?.toISOString() ?? null,
      durationMinutes: elapsedDuration(session.webStartedAt, session.webEndedAt),
      activeEnergyKcal: selected.kcal,
      energySource: selected.energySource,
      executionStatus: executionStatus(session.status, session.loggedSetCount),
      workoutId: null,
      diarySessionId: session.id,
      diaryProgramName: session.programName,
      diaryOnly: true,
      exerciseDetailAvailability: session.loggedSetCount > 0 ? "logged-sets" : "no-logged-sets",
      loggedSetCount: session.loggedSetCount,
    }, false);
  }

  return [...byDate.entries()]
    .sort(([left], [right]) => right.localeCompare(left))
    .map(([date, value]) => makeFact(date, value.events.sort((left, right) => {
      const time = right.occurrenceAt.localeCompare(left.occurrenceAt);
      return time !== 0 ? time : right.eventId.localeCompare(left.eventId);
    }), value.hiddenEventCount));
}
