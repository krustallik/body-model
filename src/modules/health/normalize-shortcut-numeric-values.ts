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

const WORKOUT_NUMERIC_FIELDS = new Set(["durationMinutes", "energyKcal"]);
const SHORTCUT_NUMBER_PATTERN = /^-?\d+(?:[.,]\d+)?$/;
const SHORTCUT_WORKOUT_DATE_PATTERN = /(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4}),?\s*(\d{1,2}):(\d{2})/g;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseShortcutNumber(value: unknown): unknown {
  if (typeof value !== "string") return value;

  const trimmed = value.trim();
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
  const numericValue = parseShortcutNumber(value);
  if (numericValue !== value || typeof value !== "string") return numericValue;
  if (typeof dayDate !== "string") return value;

  const matches = [...value.matchAll(SHORTCUT_WORKOUT_DATE_PATTERN)];
  if (matches.length !== 2) return value;

  const start = parseWorkoutDate(matches[0]);
  const end = parseWorkoutDate(matches[1]);
  if (!start || !end || end.timestamp < start.timestamp) return value;

  const separators = value.replace(start.text, "").replace(end.text, "");
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
      return [key, fieldValue];
    }),
  );
}

export function normalizeShortcutNumericValues(input: unknown): unknown {
  if (!isObject(input) || !Array.isArray(input.days)) return input;
  return { ...input, days: input.days.map(normalizeDay) };
}
