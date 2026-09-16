import { DEFAULT_TIME_ZONE, instantToLocalDateTime } from "@/model/time-zone";

type JsonObject = Record<string, unknown>;

const SHORTCUT_WORKOUT_DATE_PATTERN = /(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4}),?\s*(\d{1,2}):(\d{2})/g;

export const TRADITIONAL_STRENGTH_TRAINING_TYPE = "Traditional Strength Training";
export const STAIR_CLIMBING_TYPE = "Stair Climbing";

export type ExpandedTrainingWorkout = {
  type: string;
  startAt: string;
  endAt: string;
  durationMinutes: number;
  activeEnergyKcal: number | null;
  externalId: string;
};

export type TrainingWorkoutExpansionDiagnostics = {
  acceptedCount: number;
  rejectedCount: number;
  reasons: string[];
};

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Split newline fields while preserving empty middle slots for positional alignment. */
export function splitPositionalLines(value: unknown): string[] | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return null;
  if (value.trim() === "") return [];
  return value.split(/\r?\n/).map((line) => line.trim());
}

function parseIsoOrShortcutInstant(raw: string): Date | null {
  if (raw === "") return null;
  const iso = Date.parse(raw);
  if (Number.isFinite(iso)) return new Date(iso);

  const matches = [...raw.matchAll(SHORTCUT_WORKOUT_DATE_PATTERN)];
  if (matches.length !== 1) return null;
  const match = matches[0];
  const year = Number(match[3]);
  const month = Number(match[2]);
  const day = Number(match[1]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const timestamp = Date.UTC(year, month - 1, day, hour, minute);
  const date = new Date(timestamp);
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
    || date.getUTCHours() !== hour
    || date.getUTCMinutes() !== minute
  ) {
    return null;
  }
  return date;
}

function parseOptionalActiveKcal(raw: string): { ok: true; value: number | null } | { ok: false } {
  if (raw === "") return { ok: true, value: null };
  const normalized = raw.replace(",", ".");
  if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) return { ok: false };
  const value = Number(normalized);
  if (!Number.isFinite(value) || value < 0 || value > 10000) return { ok: false };
  return { ok: true, value };
}

/**
 * Pair first-N starts with second-N ends by index.
 * One malformed event is skipped; siblings remain.
 */
export function expandTrainingWorkoutFields(input: {
  trainingType: unknown;
  trainingActiveKcal: unknown;
  trainingTimestamps: unknown;
  dayDate: string;
  timezone?: string;
}): {
  workouts: ExpandedTrainingWorkout[];
  diagnostics: TrainingWorkoutExpansionDiagnostics;
} {
  const types = splitPositionalLines(input.trainingType);
  const kcals = splitPositionalLines(input.trainingActiveKcal);
  const timestamps = splitPositionalLines(input.trainingTimestamps);
  const diagnostics: TrainingWorkoutExpansionDiagnostics = {
    acceptedCount: 0,
    rejectedCount: 0,
    reasons: [],
  };

  if (types === null && kcals === null && timestamps === null) {
    return { workouts: [], diagnostics };
  }
  if (types === null || timestamps === null) {
    diagnostics.rejectedCount += 1;
    diagnostics.reasons.push("missing-training-fields");
    return { workouts: [], diagnostics };
  }
  if (types.length === 0) {
    return { workouts: [], diagnostics };
  }

  const n = types.length;
  if (timestamps.length !== 2 * n) {
    diagnostics.rejectedCount += n;
    diagnostics.reasons.push("mismatched-timestamp-count");
    return { workouts: [], diagnostics };
  }
  if (kcals !== null && kcals.length !== n) {
    diagnostics.rejectedCount += n;
    diagnostics.reasons.push("mismatched-active-kcal-count");
    return { workouts: [], diagnostics };
  }

  const timezone = input.timezone ?? DEFAULT_TIME_ZONE;
  const workouts: ExpandedTrainingWorkout[] = [];

  for (let index = 0; index < n; index += 1) {
    const type = types[index] ?? "";
    const kcalRaw = kcals?.[index] ?? "";
    const startRaw = timestamps[index] ?? "";
    const endRaw = timestamps[n + index] ?? "";

    if (type === "") {
      diagnostics.rejectedCount += 1;
      diagnostics.reasons.push(`workout-${index}:missing-type`);
      continue;
    }

    const startAt = parseIsoOrShortcutInstant(startRaw);
    const endAt = parseIsoOrShortcutInstant(endRaw);
    if (!startAt) {
      diagnostics.rejectedCount += 1;
      diagnostics.reasons.push(`workout-${index}:malformed-start`);
      continue;
    }
    if (!endAt) {
      diagnostics.rejectedCount += 1;
      diagnostics.reasons.push(`workout-${index}:malformed-end`);
      continue;
    }
    if (endAt.getTime() <= startAt.getTime()) {
      diagnostics.rejectedCount += 1;
      diagnostics.reasons.push(`workout-${index}:non-positive-duration`);
      continue;
    }

    const kcalParsed = parseOptionalActiveKcal(kcalRaw);
    if (!kcalParsed.ok) {
      diagnostics.rejectedCount += 1;
      diagnostics.reasons.push(`workout-${index}:malformed-active-kcal`);
      continue;
    }

    const localStartDate = instantToLocalDateTime(startAt, timezone).date;
    if (localStartDate !== input.dayDate) {
      diagnostics.rejectedCount += 1;
      diagnostics.reasons.push(`workout-${index}:other-calendar-day`);
      continue;
    }

    const durationMinutes = (endAt.getTime() - startAt.getTime()) / 60_000;
    workouts.push({
      type,
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
      durationMinutes,
      activeEnergyKcal: kcalParsed.value,
      externalId: `training-${input.dayDate}-${index}-${startAt.toISOString()}`,
    });
    diagnostics.acceptedCount += 1;
  }

  return { workouts, diagnostics };
}

/** Merge expanded training workouts into a day object without destroying structured workouts. */
export function mergeExpandedTrainingWorkouts(
  day: JsonObject,
  timezone?: string,
): JsonObject {
  const date = typeof day.date === "string" ? day.date : null;
  if (!date) return day;

  const hasTrainingFields = "trainingType" in day
    || "trainingActiveKcal" in day
    || "trainingTimestamps" in day;
  if (!hasTrainingFields) return day;

  const { workouts: expanded } = expandTrainingWorkoutFields({
    trainingType: day.trainingType,
    trainingActiveKcal: day.trainingActiveKcal,
    trainingTimestamps: day.trainingTimestamps,
    dayDate: date,
    timezone,
  });

  const rest = { ...day };
  delete rest.trainingType;
  delete rest.trainingActiveKcal;
  delete rest.trainingTimestamps;

  const existing = Array.isArray(rest.workouts)
    ? rest.workouts.filter((item) => isObject(item))
    : [];

  return {
    ...rest,
    workouts: [...existing, ...expanded],
  };
}
