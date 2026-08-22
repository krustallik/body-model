import { z } from "zod";
import { CalendarDateSchema, parseNullableNumericInput } from "@/modules/days/day.schema";

const todayDate = () => new Date().toISOString().slice(0, 10);

export const SexSchema = z.enum(["male", "female"]);

const requiredNumeric = (schema: z.ZodNumber) =>
  z.preprocess(parseNullableNumericInput, schema);

const optionalNumeric = (schema: z.ZodNumber) =>
  z.preprocess(parseNullableNumericInput, schema.nullable().optional());

const optionalDate = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? null : value),
  CalendarDateSchema.nullable().optional(),
);

export const ProfileInputSchema = z.object({
  sex: SexSchema,
  dateOfBirth: CalendarDateSchema.refine(
    (value) => value <= todayDate(),
    "dateOfBirth must not be in the future",
  ),
  heightCm: requiredNumeric(z.number().positive().max(300)),
  targetWeightKg: optionalNumeric(z.number().positive().max(500)),
  targetDate: optionalDate,
}).strict();

export type ProfileInput = z.infer<typeof ProfileInputSchema>;
