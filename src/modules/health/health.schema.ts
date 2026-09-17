import { normalizeDailyMeasurementInput } from "@/modules/days/measurement-policy";
import { mergeExpandedTrainingWorkouts } from "@/modules/health/expand-training-workouts";
import { normalizeShortcutPayload } from "@/modules/health/normalize-shortcut-payload";
import {
  describeSleepSegmentKeys,
  normalizeShortcutNumericValues,
  normalizeSleepSegmentsValue,
} from "@/modules/health/normalize-shortcut-numeric-values";
import { canonicalizeSleepState, SLEEP_STATES } from "@/modules/health/sleep-state";
import { z } from "zod";
import {
  DEFAULT_TIME_ZONE,
  instantToLocalDateTime,
  isValidTimeZone,
} from "@/model/time-zone";

function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;

  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const parsed = new Date(Date.UTC(year, month - 1, day));

  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const nullableOptionalNumber = (minimum: number, maximum: number) =>
  z.number().min(minimum).max(maximum).nullable().optional();

export const WorkoutSchema = z
  .object({
    externalId: z.string().min(1).nullable().optional(),
    type: z.string().min(1).max(100).refine((value) => value.trim().length > 0, "type must not be blank"),
    startAt: z.string().datetime({ offset: true }),
    endAt: z.string().datetime({ offset: true }),
    durationMinutes: nullableOptionalNumber(0, 1440),
    energyKcal: nullableOptionalNumber(0, 10000),
    activeEnergyKcal: nullableOptionalNumber(0, 10000),
  })
  .strict()
  .superRefine((workout, context) => {
    if (Date.parse(workout.endAt) < Date.parse(workout.startAt)) {
      context.addIssue({
        code: "custom",
        path: ["endAt"],
        message: "endAt must not be earlier than startAt",
      });
    }
  });

const HeartRateSamplesSchema = z.object({
  timestamps: z.array(z.string().datetime({ offset: true })),
  bpm: z.array(z.number().finite().positive()),
}).strict().superRefine((value, context) => {
  if (value.timestamps.length !== value.bpm.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["bpm"], message: "timestamps and bpm must have the same length" });
  }
});

const RestingHeartRateSamplesSchema = z.object({
  timestamps: z.array(z.string().datetime({ offset: true })),
  bpminpeace: z.array(z.number().finite().positive()),
}).strict().superRefine((value, context) => {
  if (value.timestamps.length !== value.bpminpeace.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["bpminpeace"], message: "timestamps and bpminpeace must have the same length" });
  }
});

const SleepSegmentSchema = z.preprocess(
  (value) => {
    if (!isObject(value)) return value;
    const rawState = typeof value.rawState === "string"
      ? value.rawState
      : typeof value.state === "string"
        ? value.state
        : value.rawState;
    const rawText = typeof rawState === "string" ? rawState.trim() : rawState;
    return {
      ...value,
      rawState: rawText,
      state: typeof rawText === "string" ? canonicalizeSleepState(rawText) : value.state,
    };
  },
  z.object({
    startAt: z.string().datetime({ offset: true }),
    endAt: z.string().datetime({ offset: true }),
    state: z.enum(SLEEP_STATES),
    rawState: z.string().min(1).max(100),
  }).strict().superRefine((segment, context) => {
    if (Date.parse(segment.endAt) <= Date.parse(segment.startAt)) {
      context.addIssue({
        code: "custom",
        path: ["endAt"],
        message: "endAt must be later than startAt",
      });
    }
  }),
);

/** iPhone Shortcut dictionary form: three parallel series (same pattern as bpm). */
function sleepSegmentsFromParallel(value: {
  startTimestamps: unknown[];
  endTimestamps: unknown[];
  states: unknown[];
  sourceKeys?: string[];
}): unknown[] | { error: string } {
  const startCount = value.startTimestamps.length;
  const endCount = value.endTimestamps.length;
  const stateCount = value.states.length;
  if (startCount !== endCount || startCount !== stateCount) {
    const keyHint = value.sourceKeys && value.sourceKeys.length > 0
      ? `; keys=[${value.sourceKeys.map((key) => JSON.stringify(key)).join(", ")}]`
      : "";
    return {
      error:
        `startTimestamps, endTimestamps, and states must have the same length`
        + ` (startTimestamps=${startCount}, endTimestamps=${endCount}, states=${stateCount}${keyHint})`,
    };
  }
  return value.startTimestamps.map((startAt, index) => {
    const rawState = String(value.states[index] ?? "").trim();
    return {
      startAt,
      endAt: value.endTimestamps[index],
      rawState,
      state: rawState,
    };
  });
}

type SleepSegmentParsed = z.output<typeof SleepSegmentSchema>;

const SleepSegmentsSchema = z.preprocess(
  (value) => {
    if (value === undefined || value === null) return value;
    const keyInfo = describeSleepSegmentKeys(
      typeof value === "string"
        ? (() => {
          try { return JSON.parse(value) as unknown; } catch { return value; }
        })()
        : value,
    );
    const normalized = normalizeSleepSegmentsValue(value);
    if (Array.isArray(normalized)) return normalized;
    if (
      isObject(normalized)
      && Array.isArray(normalized.startTimestamps)
      && Array.isArray(normalized.endTimestamps)
      && Array.isArray(normalized.states)
    ) {
      return sleepSegmentsFromParallel({
        startTimestamps: normalized.startTimestamps,
        endTimestamps: normalized.endTimestamps,
        states: normalized.states,
        sourceKeys: keyInfo.foundKeys,
      });
    }
    if (isObject(normalized)) {
      const missing = [
        !keyInfo.hasStarts ? "startTimestamps" : null,
        !keyInfo.hasEnds ? "endTimestamps" : null,
        !keyInfo.hasStates ? "states" : null,
      ].filter((item): item is string => item !== null);
      return {
        error:
          `sleepSegments dictionary is missing recognized keys: ${missing.join(", ") || "unknown"}`
          + `; keys=[${keyInfo.foundKeys.map((key) => JSON.stringify(key)).join(", ")}]`,
      };
    }
    return normalized;
  },
  z.union([
    z.array(SleepSegmentSchema),
    z.object({ error: z.string() }).strict().superRefine((value, context) => {
      context.addIssue({ code: z.ZodIssueCode.custom, message: value.error });
    }),
  ]),
) as unknown as z.ZodType<SleepSegmentParsed[]>;

const HealthDayObjectSchema = z
  .object({
    date: z.string().refine(isCalendarDate, "date must be a real calendar date in YYYY-MM-DD format"),
    weightKg: nullableOptionalNumber(20, 400),
    bodyFatPercent: nullableOptionalNumber(1, 70),
    caloriesKcal: nullableOptionalNumber(0, 20000),
    proteinG: nullableOptionalNumber(0, 2000),
    fatG: nullableOptionalNumber(0, 2000),
    carbsG: nullableOptionalNumber(0, 2000),
    steps: z.number().int().min(0).max(200000).nullable().optional(),
    activeEnergyKcal: nullableOptionalNumber(0, 10000),
    averageWalkingSpeedKmh: nullableOptionalNumber(0, 20),
    walkingDistanceKm: nullableOptionalNumber(0, 200),
    strengthTrainingMinutes: nullableOptionalNumber(0, 600),
    workouts: z.array(WorkoutSchema).nullable().optional(),
    bpm: HeartRateSamplesSchema.optional(),
    bpminpeace: RestingHeartRateSamplesSchema.optional(),
    sleepSegments: SleepSegmentsSchema.optional(),
  })
  .strict();

export function preprocessHealthDay(
  value: unknown,
  timezone: string = DEFAULT_TIME_ZONE,
): unknown {
  // Idempotent safety net: Apple/Shortcuts may still present `Date` if an earlier
  // normalize step was skipped or only partially applied.
  const remapped = normalizeShortcutNumericValues(normalizeShortcutPayload({ days: [value] }).payload);
  const day = isObject(remapped) && Array.isArray(remapped.days) ? remapped.days[0] : value;
  const measured = normalizeDailyMeasurementInput(day);
  if (!isObject(measured)) return measured;
  return mergeExpandedTrainingWorkouts(measured, timezone);
}

export const HealthDaySchema = z.preprocess(
  (value) => preprocessHealthDay(value),
  HealthDayObjectSchema,
);

export const HealthSyncRequestSchema = z.preprocess(
  (value) => {
    if (!isObject(value) || !Array.isArray(value.days)) return value;
    const timezone = typeof value.timezone === "string" && isValidTimeZone(value.timezone)
      ? value.timezone
      : DEFAULT_TIME_ZONE;
    return {
      ...value,
      days: value.days.map((day) => preprocessHealthDay(day, timezone)),
    };
  },
  z
    .object({
      days: z.array(HealthDayObjectSchema).length(1, "days must contain exactly today's data"),
      timezone: z.string().min(1).max(100).refine(isValidTimeZone, "timezone must be a valid IANA zone")
        .optional(),
      syncedAt: z.string().datetime({ offset: true }).nullable().optional(),
    })
    .strict()
    .superRefine((request, context) => {
      if (!request.syncedAt) return;
      const localDate = instantToLocalDateTime(
        new Date(request.syncedAt),
        request.timezone ?? DEFAULT_TIME_ZONE,
      ).date;
      if (localDate !== request.days[0]?.date) {
        context.addIssue({
          code: "custom",
          path: ["syncedAt"],
          message: "syncedAt must fall on the synced calendar day in the supplied timezone",
        });
      }
    }),
);
