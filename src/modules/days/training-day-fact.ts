import { DEFAULT_TIME_ZONE, instantToLocalDateTime } from "@/model/time-zone";

export type ExerciseDetailAvailability = "logged-sets" | "no-logged-sets" | "unavailable";
export type TrainingEventExecutionStatus = "in-progress" | "completed" | "partial" | "unknown";

export type TrainingDayEventFact = {
  eventId: string;
  source: "workout" | "diary" | "matched";
  type: string;
  occurrenceAt: string;
  endAt: string | null;
  durationMinutes: number | null;
  activeEnergyKcal: number | null;
  energySource: "device-estimate" | "shadow-diary-estimate" | "unavailable";
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

export type WorkoutFactSource = {
  id: number;
  sourceIdentity: string;
  type: string;
  startAt: Date;
  endAt: Date;
  durationMinutes: number | null;
  activeEnergyKcal: number | null;
  hiddenFromHistory: boolean;
  matchedDiarySession: {
    id: number;
    status: string | null;
    programName: string | null;
    loggedSetCount: number;
    energyShadow: unknown;
  } | null;
};

export type DiaryFactSource = {
  id: number;
  status: string;
  entryMode: string;
  webStartedAt: Date | null;
  webEndedAt: Date | null;
  matchedWorkoutId?: number | null;
  loggedSetCount: number;
  programName: string | null;
  energyShadow: unknown;
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
  const resolution = (value as { activeEnergyResolution?: unknown }).activeEnergyResolution;
  if (typeof resolution !== "object" || resolution === null || Array.isArray(resolution)) return null;
  const kcal = (resolution as { estimatedActiveKcal?: unknown }).estimatedActiveKcal;
  return typeof kcal === "number" && Number.isFinite(kcal) && kcal >= 0 ? kcal : null;
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
    const kcal = validDuration(workout.activeEnergyKcal) === null
      ? (workout.activeEnergyKcal === 0 ? 0 : null)
      : workout.activeEnergyKcal;
    const diaryKcal = matched ? shadowKcal(matched.energyShadow) : null;
    add({
      eventId: `workout:${workout.id}`,
      source: matched ? "matched" : "workout",
      type: workout.type,
      occurrenceAt: workout.startAt.toISOString(),
      endAt: workout.endAt.toISOString(),
      durationMinutes,
      activeEnergyKcal: kcal ?? diaryKcal,
      energySource: kcal !== null ? "device-estimate" : diaryKcal !== null ? "shadow-diary-estimate" : "unavailable",
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
    const kcal = shadowKcal(session.energyShadow);
    add({
      eventId: `diary:${session.id}`,
      source: "diary",
      type: "Traditional Strength Training",
      occurrenceAt: session.webStartedAt.toISOString(),
      endAt: session.webEndedAt?.toISOString() ?? null,
      durationMinutes: elapsedDuration(session.webStartedAt, session.webEndedAt),
      activeEnergyKcal: kcal,
      energySource: kcal === null ? "unavailable" : "shadow-diary-estimate",
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
    .map(([date, value]) => makeFact(date, value.events.sort((left, right) => left.occurrenceAt.localeCompare(right.occurrenceAt)), value.hiddenEventCount));
}
