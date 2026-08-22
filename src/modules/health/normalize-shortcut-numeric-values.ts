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
