import { z } from "zod";

const StepperWorkoutInputSchema = z.object({
  startAt: z.string().datetime({ offset: true }),
  durationMinutes: z.number().int().min(1).max(1_440),
  manualStepCount: z.number().int().nonnegative().nullable().optional(),
  manualActiveEnergyKcal: z.number().nonnegative().nullable().optional(),
}).strict();

export const CreateStepperWorkoutSchema = StepperWorkoutInputSchema;
export const UpdateStepperWorkoutSchema = StepperWorkoutInputSchema;
export const StepperWorkoutIdParamsSchema = z.object({
  id: z.preprocess((value) => typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value,
    z.number().int().positive().safe()),
}).strict();

export type StepperWorkoutInput = z.infer<typeof StepperWorkoutInputSchema>;
