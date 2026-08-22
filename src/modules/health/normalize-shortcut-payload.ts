type JsonObject = Record<string, unknown>;

const ROOT_KEYS = canonicalKeyMap(["days"]);
const DAY_KEYS = canonicalKeyMap([
  "date",
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
  "workouts",
]);
const WORKOUT_KEYS = canonicalKeyMap([
  "externalId",
  "type",
  "startAt",
  "endAt",
  "durationMinutes",
  "energyKcal",
]);

export interface ShortcutNormalizationIssue {
  path: (string | number)[];
  message: string;
  code: "key_collision";
}

export class ShortcutNormalizationError extends Error {
  constructor(readonly issues: ShortcutNormalizationIssue[]) {
    super(issues[0]?.message ?? "Shortcut payload normalization failed");
    this.name = "ShortcutNormalizationError";
  }
}

export interface NormalizedShortcutPayload {
  payload: unknown;
  originalDays: unknown[];
}

function canonicalKeyMap(keys: string[]): ReadonlyMap<string, string> {
  return new Map(keys.map((key) => [key.toLowerCase(), key]));
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeObject(
  input: JsonObject,
  keys: ReadonlyMap<string, string>,
  path: (string | number)[],
  transform?: (key: string, value: unknown) => unknown,
): JsonObject {
  const output: JsonObject = {};
  const sources = new Map<string, string>();

  for (const [sourceKey, value] of Object.entries(input)) {
    const canonicalKey = keys.get(sourceKey.toLowerCase()) ?? sourceKey;
    const previousSource = sources.get(canonicalKey);
    if (previousSource !== undefined) {
      throw new ShortcutNormalizationError([
        {
          path: [...path, canonicalKey],
          code: "key_collision",
          message: `Keys "${previousSource}" and "${sourceKey}" both normalize to "${canonicalKey}"`,
        },
      ]);
    }

    sources.set(canonicalKey, sourceKey);
    output[canonicalKey] = transform?.(canonicalKey, value) ?? value;
  }

  return output;
}

function normalizeWorkout(value: unknown, path: (string | number)[]): unknown {
  return isObject(value) ? normalizeObject(value, WORKOUT_KEYS, path) : value;
}

function normalizeDay(value: unknown, path: (string | number)[]): unknown {
  if (!isObject(value)) return value;

  return normalizeObject(value, DAY_KEYS, path, (key, fieldValue) => {
    if (key !== "workouts" || !Array.isArray(fieldValue)) return fieldValue;
    return fieldValue.map((workout, index) => normalizeWorkout(workout, [...path, "workouts", index]));
  });
}

export function normalizeShortcutPayload(input: unknown): NormalizedShortcutPayload {
  if (!isObject(input)) return { payload: input, originalDays: [] };

  let originalDays: unknown[] = [];
  const payload = normalizeObject(input, ROOT_KEYS, [], (key, value) => {
    if (key !== "days" || !Array.isArray(value)) return value;
    originalDays = value;
    return value.map((day, index) => normalizeDay(day, ["days", index]));
  });

  return { payload, originalDays };
}
