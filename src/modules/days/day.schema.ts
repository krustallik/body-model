import { z } from "zod";

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

const nullableMetric = (schema: z.ZodNumber) =>
  z.preprocess(parseNullableNumericInput, schema.nullable().optional());

export const DailyMetricFieldsSchema = z.object({
  weightKg: nullableMetric(z.number().min(0)),
  bodyFatPercent: nullableMetric(z.number().min(0).max(100)),
  caloriesKcal: nullableMetric(z.number().min(0)),
  proteinG: nullableMetric(z.number().min(0)),
  fatG: nullableMetric(z.number().min(0)),
  carbsG: nullableMetric(z.number().min(0)),
  steps: nullableMetric(z.number().int().min(0)),
  activeEnergyKcal: nullableMetric(z.number().min(0)),
  averageWalkingSpeedKmh: nullableMetric(z.number().min(0)),
  walkingDistanceKm: nullableMetric(z.number().min(0)),
  strengthTrainingMinutes: nullableMetric(z.number().min(0)),
});

export const CreateDailyMetricSchema = DailyMetricFieldsSchema.extend({
  date: CalendarDateSchema,
}).strict();

export const UpdateDailyMetricSchema = DailyMetricFieldsSchema.strict().refine(
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
  })
  .strict()
  .refine(({ from, to }) => !from || !to || from <= to, {
    path: ["to"],
    message: "to must not be earlier than from",
  });

export type CreateDailyMetricInput = z.infer<typeof CreateDailyMetricSchema>;
export type UpdateDailyMetricInput = z.infer<typeof UpdateDailyMetricSchema>;
export type DailyMetricListQuery = z.infer<typeof DailyMetricListQuerySchema>;
