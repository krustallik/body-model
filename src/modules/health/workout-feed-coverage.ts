import {
  expandTrainingWorkoutFields,
  splitPositionalLines,
} from "@/modules/health/expand-training-workouts";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Whether a sync payload established a valid workout feed observation for the
 * synced calendar day. This must be decided at sync time and persisted — never
 * re-inferred later from a newer latest-3 feed.
 *
 * - true: feed present (array, possibly empty / other-day events only)
 * - false: feed absent or structurally invalid for coverage
 */
export function resolveWorkoutFeedObserved(rawDay: unknown): boolean {
  if (!isObject(rawDay)) return false;

  if ("workouts" in rawDay) {
    if (rawDay.workouts === null) return false;
    return Array.isArray(rawDay.workouts);
  }

  const hasTrainingFields = "trainingType" in rawDay
    || "trainingActiveKcal" in rawDay
    || "trainingTimestamps" in rawDay;
  if (!hasTrainingFields) return false;

  const date = typeof rawDay.date === "string" ? rawDay.date : "";
  const types = splitPositionalLines(rawDay.trainingType);
  const timestamps = splitPositionalLines(rawDay.trainingTimestamps);
  const kcals = splitPositionalLines(rawDay.trainingActiveKcal);

  // Empty-but-present training lines establish coverage (confirmed no today workout
  // once other-day events are filtered). Catastrophic structure does not.
  if (types === null || timestamps === null) return false;
  if (types.length === 0) return true;
  if (timestamps.length !== 2 * types.length) return false;
  if (kcals !== null && kcals.length !== types.length) return false;

  // Structure is usable; even if every event is another calendar day or one slot
  // is malformed, the feed itself was observed for this sync day.
  if (!date) return true;
  const { diagnostics } = expandTrainingWorkoutFields({
    trainingType: rawDay.trainingType,
    trainingActiveKcal: rawDay.trainingActiveKcal,
    trainingTimestamps: rawDay.trainingTimestamps,
    dayDate: date,
  });
  const fatal = diagnostics.reasons.some((reason) => (
    reason === "missing-training-fields"
    || reason === "mismatched-timestamp-count"
    || reason === "mismatched-active-kcal-count"
  ));
  return !fatal;
}
