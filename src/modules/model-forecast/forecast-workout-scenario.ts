import {
  canonicalizeWorkoutType,
  hasExplicitStrengthWorkouts,
  type ExplicitWorkoutActivityEvent,
  type ExplicitWorkoutActivityInput,
} from "@/model/activity/workout-energy";
import {
  STAIR_CLIMBING_TYPE,
  TRADITIONAL_STRENGTH_TRAINING_TYPE,
} from "@/modules/health/expand-training-workouts";

export type ForecastWeekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** Forecast-local event: production event fields plus optional program snapshot provenance. */
export type ForecastWorkoutEvent = ExplicitWorkoutActivityEvent & {
  programId?: number | null;
  programVersionId?: number | null;
  programVersionNumber?: number | null;
  plannedSets?: number | null;
  energyProvenance?: "device-estimate" | "strength-met-fallback" | "unspecified" | null;
};

export type ForecastWorkoutActivity = {
  events: ForecastWorkoutEvent[];
};

export type ForecastWeekdayWorkoutPlan = {
  events: ForecastWorkoutEvent[];
};

export type ForecastWorkoutScheduleByWeekday = Partial<
  Record<ForecastWeekday, ForecastWeekdayWorkoutPlan>
>;

export function cloneForecastWorkoutActivity(
  activity: ForecastWorkoutActivity | ExplicitWorkoutActivityInput | undefined,
): ForecastWorkoutActivity | undefined {
  if (activity === undefined) return undefined;
  return {
    events: activity.events.map((event) => ({ ...event })),
  };
}

/** Strip forecast-only provenance so physiology receives the production event contract. */
export function toProductionWorkoutActivity(
  activity: ForecastWorkoutActivity | undefined,
): ExplicitWorkoutActivityInput | undefined {
  if (activity === undefined) return undefined;
  return {
    events: activity.events.map((event) => ({
      type: event.type,
      canonicalType: event.canonicalType,
      classification: event.classification,
      startAt: event.startAt,
      endAt: event.endAt,
      durationMinutes: event.durationMinutes,
      activeEnergyKcal: event.activeEnergyKcal,
    })),
  };
}

export function strengthMinutesForWorkoutActivity(
  activity: ForecastWorkoutActivity | undefined,
  legacyMinutes: number,
): number {
  if (activity && hasExplicitStrengthWorkouts(activity.events)) return 0;
  return legacyMinutes;
}

function syntheticWindow(durationMinutes: number | null): { startAt: string; endAt: string } {
  const startAt = "1970-01-01T17:00:00.000Z";
  const minutes = durationMinutes !== null && durationMinutes > 0 ? durationMinutes : 0;
  const endAt = new Date(Date.parse(startAt) + minutes * 60_000).toISOString();
  return { startAt, endAt };
}

export function createForecastWorkoutEvent(input: {
  type: string;
  durationMinutes: number | null;
  activeEnergyKcal?: number | null;
  programId?: number | null;
  programVersionId?: number | null;
  programVersionNumber?: number | null;
  plannedSets?: number | null;
  energyProvenance?: ForecastWorkoutEvent["energyProvenance"];
}): ForecastWorkoutEvent {
  const canonical = canonicalizeWorkoutType(input.type);
  const window = syntheticWindow(input.durationMinutes);
  const activeEnergyKcal = input.activeEnergyKcal === undefined ? null : input.activeEnergyKcal;
  return {
    type: input.type,
    canonicalType: canonical.canonicalType,
    classification: canonical.classification,
    startAt: window.startAt,
    endAt: window.endAt,
    durationMinutes: input.durationMinutes,
    activeEnergyKcal,
    programId: input.programId ?? null,
    programVersionId: input.programVersionId ?? null,
    programVersionNumber: input.programVersionNumber ?? null,
    plannedSets: input.plannedSets ?? null,
    energyProvenance: input.energyProvenance
      ?? (activeEnergyKcal !== null && activeEnergyKcal > 0
        ? "device-estimate"
        : canonical.classification === "traditional-strength-training"
          ? "strength-met-fallback"
          : "unspecified"),
  };
}

/**
 * Build a weekday workout schedule for forecast scenarios.
 * Strength and stepper sessions are separate events; planned sets/program are provenance only.
 */
export function buildForecastWorkoutSchedule(input: {
  strengthWeekdays?: readonly ForecastWeekday[];
  strengthDurationMinutes?: number;
  strengthActiveEnergyKcal?: number | null;
  programId?: number | null;
  programVersionId?: number | null;
  programVersionNumber?: number | null;
  plannedSets?: number | null;
  stepperWeekdays?: readonly ForecastWeekday[];
  stepperDurationMinutes?: number;
  stepperActiveEnergyKcal?: number | null;
}): ForecastWorkoutScheduleByWeekday {
  const schedule: ForecastWorkoutScheduleByWeekday = {};
  const strengthWeekdays = input.strengthWeekdays ?? [];
  const stepperWeekdays = input.stepperWeekdays ?? [];
  const weekdays = new Set<ForecastWeekday>([...strengthWeekdays, ...stepperWeekdays]);
  for (const weekday of weekdays) {
    const events: ForecastWorkoutEvent[] = [];
    if (strengthWeekdays.includes(weekday)) {
      events.push(createForecastWorkoutEvent({
        type: TRADITIONAL_STRENGTH_TRAINING_TYPE,
        durationMinutes: input.strengthDurationMinutes ?? 45,
        activeEnergyKcal: input.strengthActiveEnergyKcal ?? null,
        programId: input.programId,
        programVersionId: input.programVersionId,
        programVersionNumber: input.programVersionNumber,
        plannedSets: input.plannedSets,
      }));
    }
    if (stepperWeekdays.includes(weekday)) {
      events.push(createForecastWorkoutEvent({
        type: STAIR_CLIMBING_TYPE,
        durationMinutes: input.stepperDurationMinutes ?? 20,
        activeEnergyKcal: input.stepperActiveEnergyKcal ?? null,
      }));
    }
    schedule[weekday] = { events };
  }
  return schedule;
}

export function filterStrengthWorkoutEvents(
  activity: ForecastWorkoutActivity | undefined,
): ForecastWorkoutActivity | undefined {
  if (activity === undefined) return undefined;
  const events = activity.events.filter(
    (event) => event.classification !== "traditional-strength-training",
  );
  return { events };
}
