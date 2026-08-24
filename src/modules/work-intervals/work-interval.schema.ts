import { z } from "zod";
import { CalendarDateSchema } from "@/modules/days/day.schema";
import { isOccupationalCategory } from "@/model/occupational-activity";
import {
  DEFAULT_TIME_ZONE,
  isValidTimeZone,
  localDateTimeToInstant,
} from "@/model/time-zone";

const LocalTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "time must use HH:mm");
const TimeZoneSchema = z.string().min(1).max(100)
  .refine(isValidTimeZone, "timezone must be a valid IANA zone");
const CategorySchema = z.string().refine(isOccupationalCategory, "unknown occupational category");
const BreakMinutesSchema = z.number().int().nonnegative();

function validateResolvedInterval(
  interval: {
    date: string;
    startTime: string;
    endTime: string;
    timezone: string;
    breakMinutes: number | null;
  },
  context: z.RefinementCtx,
): void {
  try {
    const startAt = localDateTimeToInstant(interval.date, interval.startTime, interval.timezone);
    const endAt = localDateTimeToInstant(interval.date, interval.endTime, interval.timezone);
    if (endAt <= startAt) {
      context.addIssue({
        code: "custom", path: ["endTime"],
        message: "endTime must be later than startTime; overnight intervals are not supported yet",
      });
    } else if (interval.breakMinutes !== null
        && interval.breakMinutes >= (endAt.getTime() - startAt.getTime()) / 60_000) {
      context.addIssue({
        code: "custom", path: ["breakMinutes"],
        message: "breakMinutes must be shorter than the work interval",
      });
    }
  } catch (error) {
    context.addIssue({
      code: "custom", path: ["timezone"],
      message: (error as Error).message,
    });
  }
}

export const CreateWorkIntervalSchema = z.object({
  date: CalendarDateSchema,
  startTime: LocalTimeSchema,
  endTime: LocalTimeSchema,
  timezone: TimeZoneSchema.default(DEFAULT_TIME_ZONE),
  category: CategorySchema,
  breakMinutes: BreakMinutesSchema,
}).strict().superRefine(validateResolvedInterval);

/** Internal merged-record schema: null is reserved for imported historical rows. */
export const PersistedWorkIntervalSchema = z.object({
  date: CalendarDateSchema,
  startTime: LocalTimeSchema,
  endTime: LocalTimeSchema,
  timezone: TimeZoneSchema.default(DEFAULT_TIME_ZONE),
  category: CategorySchema,
  breakMinutes: BreakMinutesSchema.nullable(),
}).strict().superRefine(validateResolvedInterval);

export const UpdateWorkIntervalSchema = z.object({
  date: CalendarDateSchema.optional(),
  startTime: LocalTimeSchema.optional(),
  endTime: LocalTimeSchema.optional(),
  timezone: TimeZoneSchema.optional(),
  category: CategorySchema.optional(),
  breakMinutes: BreakMinutesSchema.optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "at least one field is required");

export const WorkIntervalListQuerySchema = z.object({ date: CalendarDateSchema.optional() }).strict();
export const WorkIntervalIdParamsSchema = z.object({
  id: z.string().regex(/^\d+$/).transform(Number).refine((value) => value > 0, "id must be positive"),
}).strict();

export type CreateWorkIntervalInput = z.infer<typeof CreateWorkIntervalSchema>;
export type PersistedWorkIntervalInput = z.infer<typeof PersistedWorkIntervalSchema>;
export type UpdateWorkIntervalInput = z.infer<typeof UpdateWorkIntervalSchema>;
