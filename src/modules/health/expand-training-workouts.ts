import { DEFAULT_TIME_ZONE, instantToLocalDateTime } from "@/model/time-zone";

type JsonObject = Record<string, unknown>;

const SHORTCUT_WORKOUT_DATE_PATTERN = /(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4}),?\s*(\d{1,2}):(\d{2})/g;

/** Common HealthKit workout activity names, longest-first for greedy ungluing. */
const KNOWN_WORKOUT_TYPES = [
  "High Intensity Interval Training",
  "Traditional Strength Training",
  "Functional Strength Training",
  "Mixed Cardio",
  "Stair Climbing",
  "Elliptical",
  "Swimming",
  "Cycling",
  "Walking",
  "Running",
  "Hiking",
  "Rowing",
  "Yoga",
].sort((a, b) => b.length - a.length);

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

/**
 * Split newline fields while preserving empty middle slots for positional alignment.
 * iOS Shortcuts Quick Look often shows newlines as `\N`; some payloads also embed
 * the literal two-character sequence `\N` or `\n` instead of a real line break.
 */
export function splitPositionalLines(value: unknown): string[] | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return null;
  if (value.trim() === "") return [];
  return value.split(/\r?\n|\\N|\\n/).map((line) => line.trim());
}

/**
 * Extract Shortcut / ISO workout timestamps from a blob, including glued pairs
 * like `10:4416. 9. 2026` where a newline was dropped between end of one date
 * and start of the next.
 */
export function extractTrainingTimestampLines(value: unknown): string[] | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return null;
  if (value.trim() === "") return [];

  // Shortcut datetime regex recovers glued pairs that line-splitting would miss.
  SHORTCUT_WORKOUT_DATE_PATTERN.lastIndex = 0;
  const shortcut = [...value.matchAll(SHORTCUT_WORKOUT_DATE_PATTERN)].map((match) => match[0]);
  if (shortcut.length > 0) return shortcut;

  // ISO / opaque lines keep positional newline splitting (preserves malformed slots).
  return splitPositionalLines(value) ?? [];
}

function splitGluedTitleCaseSegments(blob: string): string[] {
  // Insert a break before a new Title-Case word that was glued to the previous
  // word (e.g. ClimbingTraditional, TrainingStair).
  const withBreaks = blob.replace(/([a-z])([A-Z])/g, "$1\n$2");
  return withBreaks.split(/\r?\n/).map((part) => part.trim()).filter((part) => part !== "");
}

function matchKnownWorkoutTypes(blob: string): string[] | null {
  const found: string[] = [];
  let remaining = blob.trim();
  while (remaining !== "") {
    let matched: string | null = null;
    for (const known of KNOWN_WORKOUT_TYPES) {
      if (remaining.toLowerCase().startsWith(known.toLowerCase())) {
        matched = remaining.slice(0, known.length);
        remaining = remaining.slice(known.length).trim();
        break;
      }
    }
    if (!matched) return null;
    found.push(matched);
  }
  return found.length > 0 ? found : null;
}

/**
 * Split trainingType lines; when counts disagree with expectedN (usually from
 * kcal lines), attempt to recover glued HealthKit names / Title-Case junctions.
 */
export function splitTrainingTypeLines(
  value: unknown,
  expectedCount?: number,
): string[] | null {
  const lines = splitPositionalLines(value);
  if (lines === null) return null;
  if (expectedCount === undefined || expectedCount <= 0 || lines.length === expectedCount) {
    return lines;
  }

  const raw = typeof value === "string" ? value : "";
  const flattened = raw.replace(/\r?\n|\\N|\\n/g, "");

  const known = matchKnownWorkoutTypes(flattened);
  if (known && known.length === expectedCount) return known;

  const titleCase = splitGluedTitleCaseSegments(flattened);
  if (titleCase.length === expectedCount) return titleCase;

  // Partial recovery: unglue each line that may itself be glued.
  const expanded: string[] = [];
  for (const line of lines) {
    if (line === "") {
      expanded.push(line);
      continue;
    }
    const lineKnown = matchKnownWorkoutTypes(line);
    if (lineKnown && lineKnown.length > 1) {
      expanded.push(...lineKnown);
      continue;
    }
    const lineTitle = splitGluedTitleCaseSegments(line);
    if (lineTitle.length > 1) {
      expanded.push(...lineTitle);
      continue;
    }
    expanded.push(line);
  }
  if (expanded.length === expectedCount) return expanded;

  return lines;
}

function parseIsoOrShortcutInstant(raw: string): Date | null {
  if (raw === "") return null;
  const iso = Date.parse(raw);
  if (Number.isFinite(iso)) return new Date(iso);

  SHORTCUT_WORKOUT_DATE_PATTERN.lastIndex = 0;
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
 * N is derived dynamically from kcal / type / timestamp counts (2N).
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
  const kcals = splitPositionalLines(input.trainingActiveKcal);
  const timestamps = extractTrainingTimestampLines(input.trainingTimestamps);

  // Prefer kcal line count when types may be glued / ambiguous.
  const preferredN = kcals !== null && kcals.length > 0
    ? kcals.length
    : timestamps !== null && timestamps.length > 0 && timestamps.length % 2 === 0
      ? timestamps.length / 2
      : undefined;

  const types = splitTrainingTypeLines(input.trainingType, preferredN);
  const diagnostics: TrainingWorkoutExpansionDiagnostics = {
    acceptedCount: 0,
    rejectedCount: 0,
    reasons: [],
  };

  if (types === null && kcals === null && timestamps === null) {
    return { workouts: [], diagnostics };
  }
  // Training feed optional: absent / empty types → no workouts.
  if (types === null || types.length === 0) {
    return { workouts: [], diagnostics };
  }
  if (timestamps === null) {
    diagnostics.rejectedCount += 1;
    diagnostics.reasons.push("missing-training-fields");
    return { workouts: [], diagnostics };
  }

  const n = preferredN !== undefined && preferredN === types.length
    ? preferredN
    : types.length;

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

/**
 * Production Shortcut stores latest-N start/end lines in `strengthTrainingMinutes`
 * (legacy key) alongside `trainingType` / `trainingActiveKcal`, not in
 * `trainingTimestamps`. Detect that blob so expansion can consume it.
 */
export function looksLikeTrainingTimestampBlob(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed === "") return false;
  // Plain numeric minutes must keep the legacy numeric-minutes path.
  if (/^-?\d+(?:[.,]\d+)?$/.test(trimmed)) return false;
  SHORTCUT_WORKOUT_DATE_PATTERN.lastIndex = 0;
  const hasShortcutDates = SHORTCUT_WORKOUT_DATE_PATTERN.test(trimmed);
  SHORTCUT_WORKOUT_DATE_PATTERN.lastIndex = 0;
  if (hasShortcutDates) return true;
  return /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(trimmed);
}

/** Prefer explicit trainingTimestamps; else Shortcut's strengthTrainingMinutes lines. */
export function resolveTrainingTimestamps(day: JsonObject): {
  trainingTimestamps: unknown;
  consumedStrengthTrainingMinutes: boolean;
} {
  if ("trainingTimestamps" in day && day.trainingTimestamps !== undefined) {
    return { trainingTimestamps: day.trainingTimestamps, consumedStrengthTrainingMinutes: false };
  }
  // Only alias when the new training feed keys are present; bare timestamp-like
  // strengthTrainingMinutes must stay on the legacy numeric-minutes path.
  const hasTypeOrKcal = "trainingType" in day || "trainingActiveKcal" in day;
  if (hasTypeOrKcal && looksLikeTrainingTimestampBlob(day.strengthTrainingMinutes)) {
    return {
      trainingTimestamps: day.strengthTrainingMinutes,
      consumedStrengthTrainingMinutes: true,
    };
  }
  return { trainingTimestamps: day.trainingTimestamps, consumedStrengthTrainingMinutes: false };
}

/** Merge expanded training workouts into a day object without destroying structured workouts. */
export function mergeExpandedTrainingWorkouts(
  day: JsonObject,
  timezone?: string,
): JsonObject {
  const date = typeof day.date === "string" ? day.date : null;
  if (!date) {
    // Still drop non-numeric timestamp blobs so Zod never sees a string minutes field.
    if (looksLikeTrainingTimestampBlob(day.strengthTrainingMinutes)) {
      const rest = { ...day };
      delete rest.strengthTrainingMinutes;
      return rest;
    }
    return day;
  }

  const { trainingTimestamps, consumedStrengthTrainingMinutes } = resolveTrainingTimestamps(day);
  const hasTrainingFields = "trainingType" in day
    || "trainingActiveKcal" in day
    || "trainingTimestamps" in day
    || consumedStrengthTrainingMinutes;
  if (!hasTrainingFields) {
    if (looksLikeTrainingTimestampBlob(day.strengthTrainingMinutes)) {
      const rest = { ...day };
      delete rest.strengthTrainingMinutes;
      return rest;
    }
    return day;
  }

  const { workouts: expanded } = expandTrainingWorkoutFields({
    trainingType: day.trainingType,
    trainingActiveKcal: day.trainingActiveKcal,
    trainingTimestamps,
    dayDate: date,
    timezone,
  });

  const rest = { ...day };
  delete rest.trainingType;
  delete rest.trainingActiveKcal;
  delete rest.trainingTimestamps;
  // Timestamp lines are not numeric minutes; drop them once consumed as the feed.
  if (consumedStrengthTrainingMinutes) delete rest.strengthTrainingMinutes;
  // If a timestamp blob somehow remains (failed expansion, odd separators), never
  // forward it to the numeric Zod field — that would 400 the whole sync day.
  if (looksLikeTrainingTimestampBlob(rest.strengthTrainingMinutes)) {
    delete rest.strengthTrainingMinutes;
  }

  const existing = Array.isArray(rest.workouts)
    ? rest.workouts.filter((item) => isObject(item))
    : [];

  return {
    ...rest,
    workouts: [...existing, ...expanded],
  };
}
