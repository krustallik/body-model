import {
  expandTrainingWorkoutFields,
  resolveTrainingTimestamps,
  splitPositionalLines,
} from "@/modules/health/expand-training-workouts";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readDayField(day: Record<string, unknown>, canonical: string): unknown {
  const lower = canonical.trim().toLowerCase();
  for (const [key, value] of Object.entries(day)) {
    if (key.trim().toLowerCase() === lower) return value;
  }
  return undefined;
}

function hasDayField(day: Record<string, unknown>, canonical: string): boolean {
  const lower = canonical.trim().toLowerCase();
  return Object.keys(day).some((key) => key.trim().toLowerCase() === lower);
}

/** Compact, secret-free summary of a training string field for diagnostics. */
export function summarizeTrainingField(value: unknown): {
  present: boolean;
  kind: string;
  lineCount: number;
  preview: string;
} {
  if (value === undefined) {
    return { present: false, kind: "absent", lineCount: 0, preview: "" };
  }
  if (value === null) {
    return { present: true, kind: "null", lineCount: 0, preview: "" };
  }
  if (typeof value === "number") {
    return {
      present: true,
      kind: "number",
      lineCount: 1,
      preview: String(value).slice(0, 40),
    };
  }
  if (typeof value !== "string") {
    return {
      present: true,
      kind: Array.isArray(value) ? "array" : typeof value,
      lineCount: 0,
      preview: "",
    };
  }

  const lines = splitPositionalLines(value) ?? [];
  return {
    present: true,
    kind: "string",
    lineCount: lines.length,
    preview: value.slice(0, 160),
  };
}

/**
 * Full JSON body as received (before normalization).
 * Health sync bodies do not contain credentials; auth headers stay out of logs.
 */
export function serializeRawSyncBody(body: unknown): string {
  try {
    return JSON.stringify(body);
  } catch {
    return "[unserializable]";
  }
}

/** Compact, secret-free sync body summary for request diagnostics. */
export function summarizeSyncBody(body: unknown): {
  bodyType: string;
  rootKeys: string;
  daysCount: number;
  day0KeyCount: number;
  day0Keys: string;
  hasDate: boolean;
  hasDateCapital: boolean;
  hasTrainingType: boolean;
  hasTrainingActiveKcal: boolean;
  hasStrengthTrainingMinutes: boolean;
  hasWorkouts: boolean;
  trainingTypeLineCount: number;
  trainingActiveKcalLineCount: number;
  strengthTrainingMinutesLineCount: number;
  trainingTypePreview: string;
  trainingActiveKcalPreview: string;
  strengthTrainingMinutesPreview: string;
  structuredWorkoutCount: number;
} {
  if (!isObject(body)) {
    return {
      bodyType: Array.isArray(body) ? "array" : typeof body,
      rootKeys: "",
      daysCount: -1,
      day0KeyCount: 0,
      day0Keys: "",
      hasDate: false,
      hasDateCapital: false,
      hasTrainingType: false,
      hasTrainingActiveKcal: false,
      hasStrengthTrainingMinutes: false,
      hasWorkouts: false,
      trainingTypeLineCount: 0,
      trainingActiveKcalLineCount: 0,
      strengthTrainingMinutesLineCount: 0,
      trainingTypePreview: "",
      trainingActiveKcalPreview: "",
      strengthTrainingMinutesPreview: "",
      structuredWorkoutCount: -1,
    };
  }

  const daysValue = body.days ?? body.Days ?? body.DAYS;
  const daysCount = Array.isArray(daysValue) ? daysValue.length : -1;
  const day0 = Array.isArray(daysValue) && isObject(daysValue[0]) ? daysValue[0] : null;
  const day0KeysList = day0 ? Object.keys(day0) : [];
  const lower = new Set(day0KeysList.map((key) => key.toLowerCase()));

  const trainingType = day0 ? summarizeTrainingField(readDayField(day0, "trainingType")) : summarizeTrainingField(undefined);
  const trainingActiveKcal = day0
    ? summarizeTrainingField(readDayField(day0, "trainingActiveKcal"))
    : summarizeTrainingField(undefined);
  const strengthTrainingMinutes = day0
    ? summarizeTrainingField(readDayField(day0, "strengthTrainingMinutes"))
    : summarizeTrainingField(undefined);
  const workouts = day0 ? readDayField(day0, "workouts") : undefined;

  return {
    bodyType: "object",
    rootKeys: Object.keys(body).join(",").slice(0, 200),
    daysCount,
    day0KeyCount: day0KeysList.length,
    day0Keys: day0KeysList.join(",").slice(0, 500),
    hasDate: lower.has("date"),
    hasDateCapital: day0KeysList.includes("Date"),
    hasTrainingType: day0 ? hasDayField(day0, "trainingType") : false,
    hasTrainingActiveKcal: day0 ? hasDayField(day0, "trainingActiveKcal") : false,
    hasStrengthTrainingMinutes: day0 ? hasDayField(day0, "strengthTrainingMinutes") : false,
    hasWorkouts: day0 ? hasDayField(day0, "workouts") : false,
    trainingTypeLineCount: trainingType.lineCount,
    trainingActiveKcalLineCount: trainingActiveKcal.lineCount,
    strengthTrainingMinutesLineCount: strengthTrainingMinutes.lineCount,
    trainingTypePreview: trainingType.preview,
    trainingActiveKcalPreview: trainingActiveKcal.preview,
    strengthTrainingMinutesPreview: strengthTrainingMinutes.preview,
    structuredWorkoutCount: Array.isArray(workouts) ? workouts.length : workouts === undefined ? -1 : -2,
  };
}

export function summarizeNormalizedDay(payload: unknown): {
  normalizedDaysCount: number;
  normalizedDay0Keys: string;
  normalizedHasDate: boolean;
  derivedWorkoutCount: number;
  strengthTrainingMinutes: number | null;
  trainingExpansionReasons: string;
} {
  if (!isObject(payload) || !Array.isArray(payload.days)) {
    return {
      normalizedDaysCount: -1,
      normalizedDay0Keys: "",
      normalizedHasDate: false,
      derivedWorkoutCount: -1,
      strengthTrainingMinutes: null,
      trainingExpansionReasons: "",
    };
  }
  const day0 = isObject(payload.days[0]) ? payload.days[0] : null;
  const keys = day0 ? Object.keys(day0) : [];
  const workouts = day0 && Array.isArray(day0.workouts) ? day0.workouts : [];
  const strength = day0?.strengthTrainingMinutes;

  let trainingExpansionReasons = "";
  if (day0 && typeof day0.date === "string") {
    const { trainingTimestamps, consumedStrengthTrainingMinutes } = resolveTrainingTimestamps(day0);
    const hasTrainingFields = "trainingType" in day0
      || "trainingActiveKcal" in day0
      || "trainingTimestamps" in day0
      || consumedStrengthTrainingMinutes;
    if (hasTrainingFields && workouts.length === 0) {
      const { diagnostics } = expandTrainingWorkoutFields({
        trainingType: day0.trainingType,
        trainingActiveKcal: day0.trainingActiveKcal,
        trainingTimestamps,
        dayDate: day0.date,
      });
      trainingExpansionReasons = diagnostics.reasons.join(";").slice(0, 500);
    }
  }

  return {
    normalizedDaysCount: payload.days.length,
    normalizedDay0Keys: keys.join(",").slice(0, 500),
    normalizedHasDate: typeof day0?.date === "string",
    derivedWorkoutCount: workouts.length,
    strengthTrainingMinutes: typeof strength === "number" ? strength : null,
    trainingExpansionReasons,
  };
}
