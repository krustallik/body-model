import { DEFAULT_TIME_ZONE, instantToLocalDateTime } from "@/model/time-zone";
import { resolveEventEnergyV1, type EnergySourceKind } from "@/model/activity/canonical-activity-policy-v1";
import { EXPERIMENTAL_STRENGTH_ACTIVE_ENERGY_V1_REVISION } from "@/modules/training/experimental-strength-active-energy-v1";
import {
  strengthEstimateFreshV1,
  strengthInputFingerprintV1,
  strengthSetFingerprintV1,
} from "@/modules/training/strength-publication-v1";

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
  reps: number;
  weightKg: number | null;
  bandNominalResistanceKg?: number | null;
  rir?: number | null;
};

export type StrengthFreshnessContext = {
  sessionId: number;
  revision: number | null | undefined;
  status: string | null | undefined;
  energyShadow: unknown;
  sets: readonly StrengthSetFactRow[];
  sameDayMassKg: number | null;
  startOfDayMassKg: number | null;
  estimatorVersion?: string | null;
};

export type WorkoutFactSource = {
  id: number;
  sourceIdentity: string;
  type: string;
  startAt: Date;
  endAt: Date;
  durationMinutes: number | null;
  activeEnergyKcal: number | null;
  manualStepCount?: number | null;
  manualActiveEnergyKcal?: number | null;
  mechanicalStepperKcal?: number | null;
  hiddenFromHistory: boolean;
  matchedDiarySession: {
    id: number;
    status: string | null;
    revision?: number | null;
    programName: string | null;
    loggedSetCount: number;
    energyShadow: unknown;
    sets?: readonly StrengthSetFactRow[];
    sameDayMassKg?: number | null;
    startOfDayMassKg?: number | null;
    estimatorVersion?: string | null;
  } | null;
};

export type DiaryFactSource = {
  id: number;
  status: string;
  entryMode: string;
  revision?: number | null;
  webStartedAt: Date | null;
  webEndedAt: Date | null;
  matchedWorkoutId?: number | null;
  loggedSetCount: number;
  programName: string | null;
  energyShadow: unknown;
  sets?: readonly StrengthSetFactRow[];
  sameDayMassKg?: number | null;
  startOfDayMassKg?: number | null;
  estimatorVersion?: string | null;
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
 * Fresh only when the stored shadow fingerprint still matches current estimator
 * inputs. Presence of a fingerprint string alone is not enough — late same-day
 * mass or set edits without a revision bump must invalidate the estimate.
 */
export function strengthEstimateFreshForDay(input: StrengthFreshnessContext & {
  diaryKcal: number | null;
}): boolean {
  if (input.status !== "COMPLETED" || input.diaryKcal === null || input.revision == null) return false;
  const shadowRevision = shadowSessionRevision(input.energyShadow);
  const storedInputFingerprint = shadowInputFingerprint(input.energyShadow);
  const sameDayMassKg = input.sameDayMassKg ?? null;
  const startOfDayMassKg = input.startOfDayMassKg ?? null;
  const massKg = sameDayMassKg ?? startOfDayMassKg;
  const currentInputFingerprint = strengthInputFingerprintV1({
    sessionId: input.sessionId,
    sessionRevision: input.revision,
    massKg,
    sameDayMassKg,
    startOfDayMassKg,
    setFingerprint: strengthSetFingerprintV1(input.sets),
    estimatorVersion: input.estimatorVersion ?? EXPERIMENTAL_STRENGTH_ACTIVE_ENERGY_V1_REVISION,
  });
  return strengthEstimateFreshV1({
    estimateKcal: input.diaryKcal,
    sessionRevision: input.revision,
    shadowSessionRevision: shadowRevision,
    storedInputFingerprint,
    currentInputFingerprint,
  });
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

/** Empty facts are explicit zeros for event occurrence, not biometric measurements. */
export function emptyTrainingDayFact(date: string): TrainingDayFact {
  return makeFact(date, [], 0);
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
    const date = instantToLocalDateTime(new Date(event.occurrenceAt), timeZone).date;
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
    const selected = selectedDayEnergy({
      classification,
      deviceKcal,
      bodyCastKcal: sessionCompleted ? diaryKcal : null,
      bodyCastFresh: matched
        ? strengthEstimateFreshForDay({
          sessionId: matched.id,
          status: matched.status,
          revision: matched.revision,
          energyShadow: matched.energyShadow,
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
    const diaryKcal = shadowKcal(session.energyShadow);
    const selected = selectedDayEnergy({
      classification: "traditional-strength-training",
      deviceKcal: null,
      bodyCastKcal: session.status === "COMPLETED" ? diaryKcal : null,
      bodyCastFresh: strengthEstimateFreshForDay({
        sessionId: session.id,
        status: session.status,
        revision: session.revision,
        energyShadow: session.energyShadow,
        diaryKcal,
        sets: session.sets ?? [],
        sameDayMassKg: session.sameDayMassKg ?? null,
        startOfDayMassKg: session.startOfDayMassKg ?? null,
        estimatorVersion: session.estimatorVersion,
      }),
      sessionCompleted: session.status === "COMPLETED",
      manualKcal: null,
      manualKcalPresent: false,
      mechanicalKcal: null,
      diaryOnly: true,
    });
    add({
      eventId: `diary:${session.id}`,
      source: "diary",
      type: "Traditional Strength Training",
      occurrenceAt: session.webStartedAt.toISOString(),
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
