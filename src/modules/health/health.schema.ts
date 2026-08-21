import { z } from "zod";

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

export const HealthDaySchema = z
  .object({
    date: z.string().refine(isCalendarDate, "date must be a real calendar date in YYYY-MM-DD format"),
    weightKg: nullableOptionalNumber(20, 400),
    caloriesKcal: nullableOptionalNumber(0, 20000),
    proteinG: nullableOptionalNumber(0, 2000),
    fatG: nullableOptionalNumber(0, 2000),
    carbsG: nullableOptionalNumber(0, 2000),
    steps: z.number().int().min(0).max(200000).nullable().optional(),
    activeEnergyKcal: nullableOptionalNumber(0, 10000),
    workouts: z.array(WorkoutSchema).nullable().optional(),
  })
  .strict();

export const HealthSyncRequestSchema = z
  .object({
    days: z.array(HealthDaySchema).min(1).max(7),
  })
  .strict()
  .superRefine(({ days }, context) => {
    const seen = new Set<string>();
    days.forEach((day, index) => {
      if (seen.has(day.date)) {
        context.addIssue({
          code: "custom",
          path: ["days", index, "date"],
          message: "date must be unique within the request",
        });
      }
      seen.add(day.date);
    });
  });
