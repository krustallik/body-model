import { isValidTimeZone } from "@/model/time-zone";
import { calculateEpisodeHistory } from "./episode-calculation";
import { calendarDayIndex } from "./model-calendar";
import type { HistoricalModelSources, PersistedEpisode } from "./model-episode.types";
import { buildSimulationDays } from "./simulation-input-builder";
import { usesSelectionV1 } from "./model-version";

export const MAX_HISTORICAL_BODYWEIGHT_REPLAY_DAYS_V1 = 366;
const MAX_SOURCE_ROWS_V1 = 100_000;

export type HistoricalBodyweightAsOfEstimateV1 = {
  status: "available" | "unavailable";
  localDate: string;
  valueKg: number | null;
  episodeId: number;
  modelVersion: string;
  uncertainty: null;
  reason?: "invalid-date" | "unsafe-initial-state" | "replay-limit"
    | "too-many-source-rows" | "missing-model-state" | "calculation-failed";
};

function unavailable(
  episode: PersistedEpisode,
  localDate: string,
  reason: NonNullable<HistoricalBodyweightAsOfEstimateV1["reason"]>,
): HistoricalBodyweightAsOfEstimateV1 {
  return {
    status: "unavailable",
    localDate,
    valueKg: null,
    episodeId: episode.id,
    modelVersion: episode.modelVersion,
    uncertainty: null,
    reason,
  };
}

function sourceRowCount(sources: HistoricalModelSources): number {
  return sources.days.length
    + sources.snapshots.length
    + (sources.activityIntervals?.length ?? 0)
    + sources.workIntervals.length
    + (sources.workouts?.length ?? 0)
    + (sources.heartRateSamples?.length ?? 0)
    + (sources.webOnlyStrengthSessions?.length ?? 0)
    + (sources.reconciliationLinks?.length ?? 0);
}

function sourcesThrough(
  sources: HistoricalModelSources,
  fromDate: string,
  toDate: string,
): HistoricalModelSources {
  const through = <T extends { date: string }>(rows: readonly T[] | undefined): T[] => (
    (rows ?? []).filter(({ date }) => date >= fromDate && date <= toDate)
  );
  const days = through(sources.days).map((day) => (
    day.date === toDate ? { ...day, weightKg: null } : day
  ));
  const workouts = through(sources.workouts);
  const workoutIds = new Set(workouts.map(({ id }) => id));
  return {
    days,
    snapshots: through(sources.snapshots),
    activityIntervals: through(sources.activityIntervals),
    workIntervals: through(sources.workIntervals),
    workouts,
    heartRateSamples: through(sources.heartRateSamples),
    webOnlyStrengthSessions: through(sources.webOnlyStrengthSessions),
    reconciliationLinks: (sources.reconciliationLinks ?? []).filter((link) => (
      workoutIds.has(link.manualWorkoutId) && workoutIds.has(link.garminWorkoutId)
    )),
  };
}

function hasAsOfSafeInitialization(episode: PersistedEpisode): boolean {
  const diagnostics = episode.initializationDiagnostics;
  if (diagnostics === null || typeof diagnostics !== "object") return false;
  const value = diagnostics as Record<string, unknown>;
  const fittingInterval = value.fittingInterval;
  const preRollInterval = value.preRollInterval;
  const anchorDate = value.bodyStateAnchorDate;
  return typeof anchorDate === "string"
    && anchorDate < episode.startDate
    && fittingInterval !== null
    && typeof fittingInterval === "object"
    && typeof (fittingInterval as Record<string, unknown>).endDate === "string"
    && (fittingInterval as Record<string, string>).endDate < episode.startDate
    && preRollInterval !== null
    && typeof preRollInterval === "object"
    && (preRollInterval as Record<string, unknown>).endDate !== null
    && typeof (preRollInterval as Record<string, unknown>).endDate === "string"
    && (preRollInterval as Record<string, string>).endDate < episode.startDate;
}

/**
 * Read-only as-of adapter around BodyCast's existing initializer and model.
 * Callers must supply the frozen episode and historical source rows; this
 * function neither opens a database connection nor persists model state.
 */
export function calculateHistoricalBodyweightAsOfV1(input: {
  episode: PersistedEpisode;
  sources: HistoricalModelSources;
  localDate: string;
}): HistoricalBodyweightAsOfEstimateV1 {
  const { episode, localDate } = input;
  try {
    if (!isValidTimeZone(episode.timezone)) {
      return unavailable(episode, localDate, "invalid-date");
    }
    let dateIndex: number;
    let startIndex: number;
    try {
      dateIndex = calendarDayIndex(localDate);
      startIndex = calendarDayIndex(episode.startDate);
    } catch {
      return unavailable(episode, localDate, "invalid-date");
    }
    if (dateIndex < startIndex) return unavailable(episode, localDate, "invalid-date");
    const elapsedDays = calendarDayIndex(localDate) - calendarDayIndex(episode.startDate) + 1;
    if (elapsedDays > MAX_HISTORICAL_BODYWEIGHT_REPLAY_DAYS_V1) {
      return unavailable(episode, localDate, "replay-limit");
    }
    if (sourceRowCount(input.sources) > MAX_SOURCE_ROWS_V1) {
      return unavailable(episode, localDate, "too-many-source-rows");
    }
    if (episode.initializationStatus !== "strong" && episode.initializationStatus !== "weak") {
      return unavailable(episode, localDate, "unsafe-initial-state");
    }
    if (!episode.baselineWindowEndDate
        || episode.baselineWindowEndDate >= episode.startDate
        || !hasAsOfSafeInitialization(episode)) {
      return unavailable(episode, localDate, "unsafe-initial-state");
    }
    if (usesSelectionV1(episode.modelVersion)) {
      // Selection v1 requires its date-specific Unified mass input. Until the
      // repository adapter can provide that exact historical input, fail closed.
      return unavailable(episode, localDate, "unsafe-initial-state");
    }

    const sources = sourcesThrough(input.sources, episode.startDate, localDate);
    const days = buildSimulationDays({
      from: episode.startDate,
      to: localDate,
      sources,
      baselineNutritionFallback: episode.baselineNutritionFallback,
      nutritionGapPolicy: { maxBridgeDays: episode.nutritionMaxBridgeDays },
      modelVersion: episode.modelVersion,
    });
    const calculation = calculateEpisodeHistory({ episode, days });
    const target = calculation.dailyStates.find((state) => state.date === localDate);
    if (target?.status !== "complete"
        || target.endWeightKg === null
        || !Number.isFinite(target.endWeightKg)
        || target.endWeightKg <= 0) {
      return unavailable(episode, localDate, "missing-model-state");
    }
    return {
      status: "available",
      localDate,
      valueKg: target.endWeightKg,
      episodeId: episode.id,
      modelVersion: episode.modelVersion,
      uncertainty: null,
    };
  } catch {
    return unavailable(episode, localDate, "calculation-failed");
  }
}
