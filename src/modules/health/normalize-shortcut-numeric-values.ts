import { normalizeShortcutWhitespace } from "@/modules/health/expand-training-workouts";

type JsonObject = Record<string, unknown>;

const DAY_NUMERIC_FIELDS = new Set([
  "weightKg",
  "bodyFatPercent",
  "caloriesKcal",
  "proteinG",
  "fatG",
  "carbsG",
  "steps",
  "activeEnergyKcal",
  "averageWalkingSpeedKmh",
  "walkingDistanceKm",
  "strengthTrainingMinutes",
]);

const WORKOUT_NUMERIC_FIELDS = new Set(["durationMinutes", "energyKcal", "activeEnergyKcal"]);
const SHORTCUT_NUMBER_PATTERN = /^-?\d+(?:[.,]\d+)?$/;
const SHORTCUT_WORKOUT_DATE_PATTERN = /(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4}),?\s*(\d{1,2}):(\d{2})/g;
const ISO_DATETIME_PATTERN = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})/g;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseShortcutNumber(value: unknown): unknown {
  if (typeof value !== "string") return value;

  const trimmed = value.trim();
  if (trimmed === "") return null;
  if (!SHORTCUT_NUMBER_PATTERN.test(trimmed)) return value;

  const parsed = Number(trimmed.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : value;
}

interface ParsedWorkoutDate {
  calendarDate: string;
  timestamp: number;
  text: string;
}

function parseWorkoutDate(match: RegExpMatchArray): ParsedWorkoutDate | undefined {
  const [text, dayText, monthText, yearText, hourText, minuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const timestamp = Date.UTC(year, month - 1, day, hour, minute);
  const date = new Date(timestamp);

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    date.getUTCHours() !== hour ||
    date.getUTCMinutes() !== minute
  ) {
    return undefined;
  }

  return {
    calendarDate: `${yearText}-${monthText.padStart(2, "0")}-${dayText.padStart(2, "0")}`,
    timestamp,
    text,
  };
}

export function parseShortcutStrengthTrainingMinutes(value: unknown, dayDate: unknown): unknown {
  if (typeof value === "string" && value.trim() === "") return 0;

  const numericValue = parseShortcutNumber(value);
  if (numericValue !== value || typeof value !== "string") return numericValue;
  if (typeof dayDate !== "string") return value;

  const normalized = normalizeShortcutWhitespace(value);
  const matches = [...normalized.matchAll(SHORTCUT_WORKOUT_DATE_PATTERN)];
  if (matches.length !== 2) return value;

  const start = parseWorkoutDate(matches[0]);
  const end = parseWorkoutDate(matches[1]);
  if (!start || !end || end.timestamp < start.timestamp) return value;

  const separators = normalized.replace(start.text, "").replace(end.text, "");
  if (!/^[\s\-–—→]*$/.test(separators)) return value;
  if (start.calendarDate !== dayDate) return 0;

  return (end.timestamp - start.timestamp) / 60_000;
}

function normalizeWorkout(value: unknown): unknown {
  if (!isObject(value)) return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, fieldValue]) => [
      key,
      WORKOUT_NUMERIC_FIELDS.has(key) ? parseShortcutNumber(fieldValue) : fieldValue,
    ]),
  );
}

function splitShortcutLines(value: unknown): unknown[] {
  if (Array.isArray(value)) return value.filter((item) => !(typeof item === "string" && item.trim() === ""));
  if (typeof value !== "string") return [value];
  return value.split(/\r?\n|\\N|\\n/).map((item) => item.trim()).filter(Boolean);
}

function normalizeTimestamps(value: unknown): unknown[] {
  if (typeof value !== "string") return splitShortcutLines(value);
  ISO_DATETIME_PATTERN.lastIndex = 0;
  const recovered = [...value.matchAll(ISO_DATETIME_PATTERN)].map((match) => match[0]);
  return recovered.length > 0 ? recovered : splitShortcutLines(value);
}

function recoverGluedBpm(value: string, expectedCount: number): unknown[] {
  const text = value.trim();
  if (!/^\d+$/.test(text) || expectedCount < 2) return [value];
  const solutions: number[][] = [];
  const visit = (index: number, parts: number[]) => {
    if (solutions.length > 1) return;
    if (parts.length === expectedCount) {
      if (index === text.length) solutions.push(parts);
      return;
    }
    for (let length = 1; length <= 3 && index + length <= text.length; length += 1) {
      const bpm = Number(text.slice(index, index + length));
      if (bpm >= 20 && bpm <= 300) visit(index + length, [...parts, bpm]);
    }
  };
  visit(0, []);
  return solutions.length === 1 ? solutions[0] : [value];
}

function normalizeBpmValues(value: unknown, expectedCount: number): unknown[] {
  const lines = splitShortcutLines(value);
  if (lines.length === 1 && typeof lines[0] === "string" && expectedCount > 1) {
    return recoverGluedBpm(lines[0], expectedCount).map(parseShortcutNumber);
  }
  return lines.map(parseShortcutNumber);
}

function normalizeHeartRateObject(value: unknown, valueKey: "bpm" | "bpminpeace"): unknown {
  if (typeof value === "string") {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return value;
    }
  }
  if (!isObject(value)) return value;
  const timestamps = normalizeTimestamps(pickIgnoreCase(value, ["timestamps", "timestamp"]));
  const sourceValue = valueKey === "bpminpeace"
    ? pickIgnoreCase(value, ["bvminpeace", "bpminpeace", "bpm"])
    : pickIgnoreCase(value, ["bpm", "values"]);
  return { timestamps, [valueKey]: normalizeBpmValues(sourceValue, timestamps.length) };
}

function parseMaybeJsonObject(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function pickIgnoreCase(object: JsonObject, names: string[]): unknown {
  // Shortcuts sometimes emit padded dictionary keys ("    states").
  const lookup = new Map(
    Object.entries(object).map(([key, fieldValue]) => [key.trim().toLowerCase(), fieldValue]),
  );
  for (const name of names) {
    const needle = name.trim().toLowerCase();
    if (lookup.has(needle)) return lookup.get(needle);
  }
  return undefined;
}

/** Report which parallel sleep keys were found after trim/case normalization. */
export function describeSleepSegmentKeys(value: unknown): {
  foundKeys: string[];
  hasStarts: boolean;
  hasEnds: boolean;
  hasStates: boolean;
} {
  if (!isObject(value)) {
    return { foundKeys: [], hasStarts: false, hasEnds: false, hasStates: false };
  }
  const foundKeys = Object.keys(value);
  const normalized = new Set(foundKeys.map((key) => key.trim().toLowerCase()));
  return {
    foundKeys,
    hasStarts: ["starttimestamps", "starts", "starttimestamp", "start"]
      .some((name) => normalized.has(name)),
    hasEnds: ["endtimestamps", "ends", "endtimestamp", "end"]
      .some((name) => normalized.has(name)),
    hasStates: ["states", "state", "sleepstates", "values"]
      .some((name) => normalized.has(name)),
  };
}

function isCanonicalSleepSegmentArray(value: unknown): value is unknown[] {
  if (!Array.isArray(value)) return false;
  if (value.length === 0) return true;
  const first = parseMaybeJsonObject(value[0]);
  return isObject(first) && ("startAt" in first || "endAt" in first);
}

/**
 * Normalize Shortcut sleepSegments into either:
 * - canonical segment array [{ startAt, endAt, state, rawState }], or
 * - parallel dictionary { startTimestamps, endTimestamps, states }
 *   (HR-style) so Zod can validate length mismatches with a clear message.
 */
export function normalizeSleepSegmentsValue(value: unknown): unknown {
  value = parseMaybeJsonObject(value);
  if (isCanonicalSleepSegmentArray(value)) {
    return value.map((item) => {
      const parsed = parseMaybeJsonObject(item);
      if (!isObject(parsed)) return item;
      const rawSource = typeof parsed.rawState === "string"
        ? parsed.rawState
        : typeof parsed.state === "string"
          ? parsed.state
          : "";
      const rawState = String(rawSource).trim();
      return {
        startAt: parsed.startAt,
        endAt: parsed.endAt,
        rawState,
        state: rawState,
      };
    });
  }
  if (!isObject(value)) return value;

  const startTimestamps = normalizeTimestamps(
    pickIgnoreCase(value, ["startTimestamps", "starts", "starttimestamp", "start"]),
  );
  const endTimestamps = normalizeTimestamps(
    pickIgnoreCase(value, ["endTimestamps", "ends", "endtimestamp", "end"]),
  );
  const states = splitShortcutLines(
    pickIgnoreCase(value, ["states", "state", "sleepStates", "values"]),
  ).map((state) => (typeof state === "string" ? state.trim() : state));

  // Always emit the parallel dictionary form. Matching lengths become segments in Zod.
  return { startTimestamps, endTimestamps, states };
}

function normalizeDay(value: unknown): unknown {
  if (!isObject(value)) return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, fieldValue]) => {
      if (key === "strengthTrainingMinutes") {
        return [key, parseShortcutStrengthTrainingMinutes(fieldValue, value.date)];
      }
      if (DAY_NUMERIC_FIELDS.has(key)) return [key, parseShortcutNumber(fieldValue)];
      if (key === "workouts" && Array.isArray(fieldValue)) {
        return [key, fieldValue.map(normalizeWorkout)];
      }
      if (key === "bpm") return [key, normalizeHeartRateObject(fieldValue, "bpm")];
      if (key === "bpminpeace") return [key, normalizeHeartRateObject(fieldValue, "bpminpeace")];
      if (key === "sleepSegments") return [key, normalizeSleepSegmentsValue(fieldValue)];
      return [key, fieldValue];
    }),
  );
}

export function normalizeShortcutNumericValues(input: unknown): unknown {
  if (!isObject(input) || !Array.isArray(input.days)) return input;
  return { ...input, days: input.days.map(normalizeDay) };
}
