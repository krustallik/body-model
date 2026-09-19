import { parseShortcutNumber } from "./normalize-shortcut-numeric-values";

export type ActivityIntervalSeries = {
  starts: unknown[];
  ends: unknown[];
  values: unknown[];
};

type JsonObject = Record<string, unknown>;

const ISO_DATETIME_PATTERN = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})/g;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function pickIgnoreCase(object: JsonObject, keys: string[]): unknown {
  const values = new Map(Object.entries(object).map(([key, value]) => [key.trim().toLowerCase(), value]));
  for (const key of keys) {
    const value = values.get(key.toLowerCase());
    if (value !== undefined) return value;
  }
  return undefined;
}

function splitLines(value: unknown): unknown[] {
  if (Array.isArray(value)) return value.filter((item) => !(typeof item === "string" && item.trim() === ""));
  if (typeof value !== "string") return [value];
  return value.split(/\r?\n|\\N|\\n/).map((item) => item.trim()).filter(Boolean);
}

function timestamps(value: unknown): unknown[] {
  if (typeof value !== "string") return splitLines(value);
  ISO_DATETIME_PATTERN.lastIndex = 0;
  const recovered = [...value.matchAll(ISO_DATETIME_PATTERN)].map((match) => match[0]);
  return recovered.length > 0 ? recovered : splitLines(value);
}

function values(value: unknown): unknown[] {
  return splitLines(value).map(parseShortcutNumber);
}

/** Normalize the Shortcut's JSON-string parallel activity interval payload. */
export function normalizeActivityIntervalSeries(
  value: unknown,
  valueKeys: string[],
): unknown {
  const parsed = parseJson(value);
  // The Shortcut sends steps as a singleton list containing its interval
  // dictionary. Treat that wrapper as transport syntax, not a scalar metric.
  const dictionary = Array.isArray(parsed) && parsed.length === 1 && isObject(parsed[0])
    ? parsed[0]
    : parsed;
  if (!isObject(dictionary)) return value;
  // HealthDay preprocessing and the field schema both normalize input. Keep
  // the internal canonical form intact on that second pass.
  if (Array.isArray(dictionary.starts) && Array.isArray(dictionary.ends) && Array.isArray(dictionary.values)) {
    return dictionary;
  }
  return {
    starts: timestamps(pickIgnoreCase(dictionary, ["timeStampsStart"])),
    ends: timestamps(pickIgnoreCase(dictionary, ["timeStampsEnd"])),
    values: values(pickIgnoreCase(dictionary, valueKeys)),
  } satisfies ActivityIntervalSeries;
}
