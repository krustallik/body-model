import { z } from "zod";
import { CalendarDateSchema } from "@/modules/days/day.schema";

const queryInteger = (defaultValue: number, maximum?: number) => z.preprocess(
  (value) => (typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value),
  z.number().int().min(0).max(maximum ?? Number.MAX_SAFE_INTEGER).default(defaultValue),
);

export const RecalculateModelRequestSchema = z.object({
  episodeId: z.number().int().positive().optional(),
}).strict();

const optionalEpisodeId = z.preprocess(
  (value) => (typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value),
  z.number().int().positive().optional(),
);

export const ModelStatusQuerySchema = z.object({
  episodeId: optionalEpisodeId,
}).strict();

export const ModelHistoryQuerySchema = z.object({
  episodeId: optionalEpisodeId,
  from: CalendarDateSchema.optional(),
  to: CalendarDateSchema.optional(),
  limit: queryInteger(90, 366),
  offset: queryInteger(0),
}).strict().refine(({ from, to }) => !from || !to || from <= to, {
  path: ["to"],
  message: "to must not be earlier than from",
});

export type RecalculateModelRequest = z.infer<typeof RecalculateModelRequestSchema>;
export type ModelHistoryQuery = z.infer<typeof ModelHistoryQuerySchema>;
