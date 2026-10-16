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
} {
  if (value === undefined) {
    return { present: false, kind: "absent", lineCount: 0 };
  }
  if (value === null) {
    return { present: true, kind: "null", lineCount: 0 };
  }
  if (typeof value === "number") {
    return {
      present: true,
      kind: "number",
      lineCount: 1,
    };
  }
  if (typeof value !== "string") {
    return {
      present: true,
      kind: Array.isArray(value) ? "array" : typeof value,
      lineCount: 0,
    };
  }

  const lines = splitPositionalLines(value) ?? [];
  return {
    present: true,
    kind: "string",
    lineCount: lines.length,
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
  rootKeyCount: number;
  daysCount: number;
  day0KeyCount: number;
  hasDate: boolean;
  hasDateCapital: boolean;
  hasTrainingType: boolean;
  hasTrainingActiveKcal: boolean;
  hasStrengthTrainingMinutes: boolean;
  hasWorkouts: boolean;
  trainingTypeLineCount: number;
  trainingActiveKcalLineCount: number;
  strengthTrainingMinutesLineCount: number;
  structuredWorkoutCount: number;
} {
  if (!isObject(body)) {
    return {
      bodyType: Array.isArray(body) ? "array" : typeof body,
      rootKeyCount: 0,
      daysCount: -1,
      day0KeyCount: 0,
      hasDate: false,
      hasDateCapital: false,
      hasTrainingType: false,
      hasTrainingActiveKcal: false,
      hasStrengthTrainingMinutes: false,
      hasWorkouts: false,
      trainingTypeLineCount: 0,
      trainingActiveKcalLineCount: 0,
      strengthTrainingMinutesLineCount: 0,
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
    rootKeyCount: Object.keys(body).length,
    daysCount,
    day0KeyCount: day0KeysList.length,
    hasDate: lower.has("date"),
    hasDateCapital: day0KeysList.includes("Date"),
    hasTrainingType: day0 ? hasDayField(day0, "trainingType") : false,
    hasTrainingActiveKcal: day0 ? hasDayField(day0, "trainingActiveKcal") : false,
    hasStrengthTrainingMinutes: day0 ? hasDayField(day0, "strengthTrainingMinutes") : false,
    hasWorkouts: day0 ? hasDayField(day0, "workouts") : false,
    trainingTypeLineCount: trainingType.lineCount,
    trainingActiveKcalLineCount: trainingActiveKcal.lineCount,
    strengthTrainingMinutesLineCount: strengthTrainingMinutes.lineCount,
    structuredWorkoutCount: Array.isArray(workouts) ? workouts.length : workouts === undefined ? -1 : -2,
  };
}

export function summarizeNormalizedDay(payload: unknown): {
  normalizedDaysCount: number;
  normalizedDay0KeyCount: number;
  normalizedHasDate: boolean;
  derivedWorkoutCount: number;
  trainingExpansionReasons: string;
} {
  if (!isObject(payload) || !Array.isArray(payload.days)) {
    return {
      normalizedDaysCount: -1,
      normalizedDay0KeyCount: 0,
      normalizedHasDate: false,
      derivedWorkoutCount: -1,
      trainingExpansionReasons: "",
    };
  }
  const day0 = isObject(payload.days[0]) ? payload.days[0] : null;
  const keys = day0 ? Object.keys(day0) : [];
  const workouts = day0 && Array.isArray(day0.workouts) ? day0.workouts : [];

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
    normalizedDay0KeyCount: keys.length,
    normalizedHasDate: typeof day0?.date === "string",
    derivedWorkoutCount: workouts.length,
    trainingExpansionReasons,
  };
}
