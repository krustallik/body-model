import {
  expandTrainingWorkoutFields,
  extractTrainingTimestampLines,
  resolveTrainingTimestamps,
  splitPositionalLines,
  splitTrainingTypeLines,
} from "@/modules/health/expand-training-workouts";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Raw Shortcut days keep original casing (`Trainingtype`, `Date`, …). */
function readCanonicalField(day: Record<string, unknown>, canonical: string): unknown {
  const target = canonical.toLowerCase();
  for (const [key, value] of Object.entries(day)) {
    if (key.toLowerCase() === target) return value;
  }
  return undefined;
}

function hasCanonicalField(day: Record<string, unknown>, canonical: string): boolean {
  const target = canonical.toLowerCase();
  return Object.keys(day).some((key) => key.toLowerCase() === target);
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

  if (hasCanonicalField(rawDay, "workouts")) {
    const workouts = readCanonicalField(rawDay, "workouts");
    if (workouts === null) return false;
    return Array.isArray(workouts);
  }

  const canonicalDay: Record<string, unknown> = {};
  if (hasCanonicalField(rawDay, "date")) {
    canonicalDay.date = readCanonicalField(rawDay, "date");
  }
  if (hasCanonicalField(rawDay, "trainingType")) {
    canonicalDay.trainingType = readCanonicalField(rawDay, "trainingType");
  }
  if (hasCanonicalField(rawDay, "trainingActiveKcal")) {
    canonicalDay.trainingActiveKcal = readCanonicalField(rawDay, "trainingActiveKcal");
  }
  if (hasCanonicalField(rawDay, "strengthTrainingMinutes")) {
    canonicalDay.strengthTrainingMinutes = readCanonicalField(rawDay, "strengthTrainingMinutes");
  }
  if (hasCanonicalField(rawDay, "trainingTimestamps")) {
    canonicalDay.trainingTimestamps = readCanonicalField(rawDay, "trainingTimestamps");
  }

  const trainingType = canonicalDay.trainingType;
  const trainingActiveKcal = canonicalDay.trainingActiveKcal;
  const { trainingTimestamps, consumedStrengthTrainingMinutes } = resolveTrainingTimestamps(canonicalDay);
  const hasTrainingFields = "trainingType" in canonicalDay
    || "trainingActiveKcal" in canonicalDay
    || "trainingTimestamps" in canonicalDay
    || consumedStrengthTrainingMinutes;
  if (!hasTrainingFields) return false;

  const date = typeof canonicalDay.date === "string" ? canonicalDay.date : "";
  const kcals = splitPositionalLines(trainingActiveKcal);
  const timestamps = extractTrainingTimestampLines(trainingTimestamps);
  const preferredN = kcals !== null && kcals.length > 0
    ? kcals.length
    : timestamps !== null && timestamps.length > 0 && timestamps.length % 2 === 0
      ? timestamps.length / 2
      : undefined;
  const types = splitTrainingTypeLines(trainingType, preferredN);

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
    trainingType,
    trainingActiveKcal,
    trainingTimestamps,
    dayDate: date,
  });
  const fatal = diagnostics.reasons.some((reason) => (
    reason === "missing-training-fields"
    || reason === "mismatched-timestamp-count"
    || reason === "mismatched-active-kcal-count"
  ));
  return !fatal;
}
