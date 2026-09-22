import {
  normalizeShortcutTimestamps,
  parseShortcutNumber,
  splitShortcutLines,
} from "@/modules/health/normalize-shortcut-numeric-values";
import {
  expandTrainingWorkoutFields,
  looksLikeTrainingTimestampBlob,
} from "@/modules/health/expand-training-workouts";
import { MAX_HEALTH_SYNC_CALENDAR_DAYS } from "@/modules/health/health-sync-limits";
import { DEFAULT_TIME_ZONE, instantToLocalDateTime, isValidTimeZone } from "@/model/time-zone";

type JsonObject = Record<string, unknown>;

export type TimestampedHealthMetric =
  | "calories-kcal"
  | "protein-g"
  | "fat-g"
  | "carbs-g"
  | "weight-kg"
  | "body-fat-percent"
  | "average-walking-speed-kmh";

export interface TimestampedHealthMetricSample {
  metric: TimestampedHealthMetric;
  timestamp: string;
  date: string;
  value: number;
}

export interface ShortcutRangeNormalizationIssue {
  path: (string | number)[];
  message: string;
  code: "invalid_range_payload";
}

export class ShortcutRangeNormalizationError extends Error {
  constructor(readonly issues: ShortcutRangeNormalizationIssue[]) {
    super(issues[0]?.message ?? "Shortcut range payload normalization failed");
    this.name = "ShortcutRangeNormalizationError";
  }
}

export interface RangeNormalizedShortcutPayload {
  payload: unknown;
  metricSamplesByDate: ReadonlyMap<string, TimestampedHealthMetricSample[]>;
}

interface MetricDefinition {
  field: "caloriesKcal" | "proteinG" | "fatG" | "carbsG" | "weightKg" | "bodyFatPercent" | "averageWalkingSpeedKmh";
  metric: TimestampedHealthMetric;
  timestampKey: string;
  valueKey: string;
  encodedJson: boolean;
  aggregate: "only" | "latest" | "mean";
  minimum: number;
  maximum: number;
}

const METRICS: readonly MetricDefinition[] = [
  { field: "caloriesKcal", metric: "calories-kcal", timestampKey: "timeStamps", valueKey: "Calories", encodedJson: false, aggregate: "only", minimum: 0, maximum: 20000 },
  { field: "proteinG", metric: "protein-g", timestampKey: "timeStamps", valueKey: "Protein", encodedJson: false, aggregate: "only", minimum: 0, maximum: 2000 },
  { field: "fatG", metric: "fat-g", timestampKey: "timeStamps", valueKey: "fat", encodedJson: false, aggregate: "only", minimum: 0, maximum: 2000 },
  { field: "carbsG", metric: "carbs-g", timestampKey: "timeStamps", valueKey: "carboHydrates", encodedJson: false, aggregate: "only", minimum: 0, maximum: 2000 },
  { field: "weightKg", metric: "weight-kg", timestampKey: "TimeStamps", valueKey: "Weights", encodedJson: true, aggregate: "latest", minimum: 20, maximum: 400 },
  { field: "bodyFatPercent", metric: "body-fat-percent", timestampKey: "timeStamps", valueKey: "FatPercentage", encodedJson: true, aggregate: "latest", minimum: 1, maximum: 70 },
  { field: "averageWalkingSpeedKmh", metric: "average-walking-speed-kmh", timestampKey: "timeStamps", valueKey: "speeds", encodedJson: true, aggregate: "mean", minimum: 0, maximum: 20 },
];

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readKey(object: JsonObject, name: string): unknown {
  const target = name.trim().toLowerCase();
  for (const [key, value] of Object.entries(object)) {
    if (key.trim().toLowerCase() === target) return value;
  }
  return undefined;
}

function hasRangeMetric(day: JsonObject): boolean {
  return METRICS.some(({ field, encodedJson }) => {
    const value = readKey(day, field);
    return encodedJson ? typeof value === "string" && value.trim().startsWith("{") : isObject(value);
  });
}

function fail(path: (string | number)[], message: string): never {
  throw new ShortcutRangeNormalizationError([{ path, code: "invalid_range_payload", message }]);
}

function parseObject(value: unknown, path: (string | number)[]): JsonObject {
  if (isObject(value)) return value;
  if (typeof value !== "string") fail(path, "must be a JSON object string");
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!isObject(parsed)) fail(path, "must decode to a JSON object");
    return parsed;
  } catch (error) {
    if (error instanceof ShortcutRangeNormalizationError) throw error;
    fail(path, "contains invalid JSON");
  }
}

function parseNumber(value: unknown, path: (string | number)[]): number {
  const parsed = parseShortcutNumber(value);
  if (typeof parsed !== "number" || !Number.isFinite(parsed)) fail(path, "must be a finite number");
  return parsed;
}

function parseMetricSeries(definition: MetricDefinition, input: unknown, path: (string | number)[]): TimestampedHealthMetricSample[] {
  const object = definition.encodedJson ? parseObject(input, path) : input;
  if (!isObject(object)) fail(path, "must be an object with timestamps and values");

  const timestampsRaw = readKey(object, definition.timestampKey);
  const valuesRaw = readKey(object, definition.valueKey);
  if (timestampsRaw === undefined) fail([...path, definition.timestampKey], "is required");
  if (valuesRaw === undefined) fail([...path, definition.valueKey], "is required");

  const timestamps = normalizeShortcutTimestamps(timestampsRaw);
  const values = splitShortcutLines(valuesRaw);
  if (timestamps.length === 0 || values.length === 0) fail(path, "timestamps and values must not be empty");
  if (timestamps.length !== values.length) {
    fail(path, `timestamps and values must have the same length (timestamps=${timestamps.length}, values=${values.length})`);
  }

  return timestamps.map((timestamp, index) => {
    if (typeof timestamp !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(timestamp) || !Number.isFinite(Date.parse(timestamp))) {
      fail([...path, definition.timestampKey, index], "must be a valid ISO timestamp with an offset");
    }
    if (!/(?:Z|[+-]\d{2}:\d{2})$/.test(timestamp)) {
      fail([...path, definition.timestampKey, index], "must include a timezone offset");
    }
    const numericValue = parseNumber(values[index], [...path, definition.valueKey, index]);
    if (numericValue < definition.minimum || numericValue > definition.maximum) {
      fail([...path, definition.valueKey, index], `must be between ${definition.minimum} and ${definition.maximum}`);
    }
    return {
      metric: definition.metric,
      timestamp,
      date: timestamp.slice(0, 10),
      value: numericValue,
    };
  });
}

function aggregateMetric(
  definition: MetricDefinition,
  samples: readonly TimestampedHealthMetricSample[],
  path: (string | number)[],
): number {
  if (definition.aggregate === "only") {
    if (samples.length !== 1) fail(path, "must contain exactly one value for each calendar day");
    return samples[0]!.value;
  }
  if (definition.aggregate === "latest") {
    return [...samples].sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp))[0]!.value;
  }
  return samples.reduce((total, sample) => total + sample.value, 0) / samples.length;
}

/**
 * Converts the new one-envelope, timestamped Shortcut payload to the existing
 * daily contract. Returns null for the legacy daily payload format.
 */
export function normalizeShortcutRangePayload(input: unknown): RangeNormalizedShortcutPayload | null {
  if (!isObject(input)) return null;
  const days = readKey(input, "days");
  if (!Array.isArray(days) || days.length !== 1 || !isObject(days[0]) || !hasRangeMetric(days[0])) return null;

  const rawDay = days[0];
  const syncAt = readKey(rawDay, "date");
  if (typeof syncAt !== "string" || !Number.isFinite(Date.parse(syncAt)) || !/(?:Z|[+-]\d{2}:\d{2})$/.test(syncAt)) {
    fail(["days", 0, "date"], "must be the Shortcut ISO execution timestamp with an offset");
  }

  const metricSamplesByDate = new Map<string, TimestampedHealthMetricSample[]>();
  const daily = new Map<string, JsonObject>();
  const rangeFields = new Set(METRICS.map(({ field }) => field.toLowerCase()));
  const trainingFields = new Set([
    "trainingtype",
    "trainingactivekcal",
    "trainingtimestamps",
    "strengthtrainingminutes",
    "workouts",
  ]);
  const passthrough = Object.fromEntries(Object.entries(rawDay).filter(([key]) => {
    const normalized = key.trim().toLowerCase();
    return normalized !== "date" && !rangeFields.has(normalized) && !trainingFields.has(normalized);
  }));

  const ensureDay = (date: string): JsonObject => {
    const existing = daily.get(date);
    if (existing) return existing;
    const created = { ...passthrough, date };
    daily.set(date, created);
    return created;
  };

  const timezoneValue = readKey(input, "timezone");
  const timezone = typeof timezoneValue === "string" && isValidTimeZone(timezoneValue)
    ? timezoneValue
    : DEFAULT_TIME_ZONE;

  // Training fields in a range payload describe one latest-N feed, not every
  // generated calendar record. Expand it once and partition workouts by their
  // own local start date instead of copying the raw strings to every day.
  const trainingType = readKey(rawDay, "trainingType");
  const trainingActiveKcal = readKey(rawDay, "trainingActiveKcal");
  const explicitTimestamps = readKey(rawDay, "trainingTimestamps");
  const legacyTimestampBlob = readKey(rawDay, "strengthTrainingMinutes");
  const trainingTimestamps = explicitTimestamps !== undefined
    ? explicitTimestamps
    : (trainingType !== undefined || trainingActiveKcal !== undefined)
      && looksLikeTrainingTimestampBlob(legacyTimestampBlob)
      ? legacyTimestampBlob
      : undefined;
  if (trainingType !== undefined || trainingActiveKcal !== undefined || trainingTimestamps !== undefined) {
    const expanded = expandTrainingWorkoutFields({
      trainingType,
      trainingActiveKcal,
      trainingTimestamps,
      timezone,
    }).workouts;
    for (const workout of expanded) {
      const date = instantToLocalDateTime(new Date(workout.startAt), timezone).date;
      const day = ensureDay(date);
      const current = Array.isArray(day.workouts) ? day.workouts : [];
      day.workouts = [...current, workout];
    }
  }

  // Structured workouts may also be present in a range envelope. Partition
  // them by start date for the same reason; never copy them to every day.
  const structured = readKey(rawDay, "workouts");
  if (Array.isArray(structured)) {
    const syncDate = instantToLocalDateTime(new Date(syncAt), timezone).date;
    for (const workout of structured) {
      if (!isObject(workout) || typeof workout.startAt !== "string") {
        const day = ensureDay(syncDate);
        day.workouts = [...(Array.isArray(day.workouts) ? day.workouts : []), workout];
        continue;
      }
      const startAt = new Date(workout.startAt);
      if (!Number.isFinite(startAt.getTime())) {
        const day = ensureDay(syncDate);
        day.workouts = [...(Array.isArray(day.workouts) ? day.workouts : []), workout];
        continue;
      }
      const day = ensureDay(instantToLocalDateTime(startAt, timezone).date);
      const current = Array.isArray(day.workouts) ? day.workouts : [];
      day.workouts = [...current, workout];
    }
  }

  for (const definition of METRICS) {
    const rawMetric = readKey(rawDay, definition.field);
    if (rawMetric === undefined || rawMetric === null) continue;
    const path = ["days", 0, definition.field] as (string | number)[];
    const samples = parseMetricSeries(definition, rawMetric, path);
    for (const sample of samples) {
      const perDate = metricSamplesByDate.get(sample.date) ?? [];
      perDate.push(sample);
      metricSamplesByDate.set(sample.date, perDate);
      ensureDay(sample.date);
    }
    for (const [date, record] of daily) {
      const perDay = samples.filter((sample) => sample.date === date);
      if (perDay.length > 0) record[definition.field] = aggregateMetric(definition, perDay, path);
    }
  }

  if (daily.size === 0) fail(["days", 0], "must contain at least one timestamped metric value");
  if (daily.size > MAX_HEALTH_SYNC_CALENDAR_DAYS) {
    fail(["days", 0], `must contain values for at most ${MAX_HEALTH_SYNC_CALENDAR_DAYS} calendar days`);
  }

  return {
    payload: {
      ...input,
      syncedAt: syncAt,
      rangePayload: true,
      days: [...daily.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([, day]) => day),
    },
    metricSamplesByDate,
  };
}
