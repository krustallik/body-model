import { z } from "zod";
import { collapsesZeroToAbsent } from "@/modules/days/measurement-policy";
import { inclusiveCalendarDayCount, MAX_MATERIALIZED_TRAINING_DAY_RANGE_DAYS } from "@/modules/days/calendar-range";

const CALENDAR_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const NUMERIC_INPUT_PATTERN = /^\d+(?:[.,]\d+)?$/;

export function isCalendarDate(value: string): boolean {
  const match = CALENDAR_DATE_PATTERN.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));

  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

export const CalendarDateSchema = z
  .string()
  .refine(isCalendarDate, "date must be a real calendar date in YYYY-MM-DD format");

export function parseNullableNumericInput(value: unknown): unknown {
  if (value === null || value === undefined || typeof value === "number") return value;
  if (typeof value !== "string") return value;

  const trimmed = value.trim();
  if (trimmed === "") return null;
  if (!NUMERIC_INPUT_PATTERN.test(trimmed)) return value;

  const parsed = Number(trimmed.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : value;
}

const nullableMetric = (field: string, schema: z.ZodNumber) =>
  z.preprocess((value) => {
    const parsed = parseNullableNumericInput(value);
    if (parsed === 0 && collapsesZeroToAbsent(field)) return null;
    return parsed;
  }, schema.nullable().optional());

export const DailyMetricFieldsSchema = z.object({
  weightKg: nullableMetric("weightKg", z.number().min(0)),
  bodyFatPercent: nullableMetric("bodyFatPercent", z.number().min(0).max(100)),
  caloriesKcal: nullableMetric("caloriesKcal", z.number().min(0)),
  proteinG: nullableMetric("proteinG", z.number().min(0)),
  fatG: nullableMetric("fatG", z.number().min(0)),
  carbsG: nullableMetric("carbsG", z.number().min(0)),
  steps: nullableMetric("steps", z.number().int().min(0)),
  activeEnergyKcal: nullableMetric("activeEnergyKcal", z.number().min(0)),
  averageWalkingSpeedKmh: nullableMetric("averageWalkingSpeedKmh", z.number().min(0)),
  walkingDistanceKm: nullableMetric("walkingDistanceKm", z.number().min(0)),
  strengthTrainingMinutes: nullableMetric("strengthTrainingMinutes", z.number().min(0)),
});

const WorkoutEditSchema = z.object({
  type: z.string().trim().min(1).max(160),
  startAt: z.string().datetime({ offset: true }),
  durationMinutes: z.preprocess(parseNullableNumericInput, z.number().positive().max(1_440)),
  activeEnergyKcal: nullableMetric("workoutActiveEnergyKcal", z.number().min(0)),
}).strict();

const WorkoutEditableFieldsSchema = z.object({
  workouts: z.array(WorkoutEditSchema).max(30).optional(),
});

export const CreateDailyMetricSchema = DailyMetricFieldsSchema.merge(WorkoutEditableFieldsSchema).extend({
  date: CalendarDateSchema,
}).strict();

export const UpdateDailyMetricSchema = DailyMetricFieldsSchema.merge(WorkoutEditableFieldsSchema).strict().refine(
  (value) => Object.keys(value).length > 0,
  "at least one metric is required",
);

export const DailyMetricDateParamsSchema = z.object({ date: CalendarDateSchema }).strict();
export const DashboardQuerySchema = z.object({ date: CalendarDateSchema.optional() }).strict();

const queryInteger = (defaultValue: number, maximum?: number) =>
  z.preprocess(
    (value) => (typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value),
    z.number().int().min(0).max(maximum ?? Number.MAX_SAFE_INTEGER).default(defaultValue),
  );

export const DailyMetricListQuerySchema = z
  .object({
    from: CalendarDateSchema.optional(),
    to: CalendarDateSchema.optional(),
    limit: queryInteger(30, 100),
    offset: queryInteger(0),
    /** Skip the unpaginated range facts after a consumer has loaded page one. */
    includeTrainingDays: z.enum(["true", "false"]).optional().transform((value) => value !== "false"),
  })
  .strict()
  .refine(({ from, to }) => !from || !to || from <= to, {
    path: ["to"],
    message: "to must not be earlier than from",
  })
  .refine(({ from, to, includeTrainingDays }) => {
    if (includeTrainingDays === false || !from || !to || from > to) return true;
    const dayCount = inclusiveCalendarDayCount(from, to);
    return dayCount !== null && dayCount <= MAX_MATERIALIZED_TRAINING_DAY_RANGE_DAYS;
  }, {
    path: ["to"],
    message: `training-day fact ranges must not exceed ${MAX_MATERIALIZED_TRAINING_DAY_RANGE_DAYS} calendar days`,
  });

export type CreateDailyMetricInput = z.infer<typeof CreateDailyMetricSchema>;
export type UpdateDailyMetricInput = z.infer<typeof UpdateDailyMetricSchema>;
export type DailyMetricListQuery = z.infer<typeof DailyMetricListQuerySchema>;
