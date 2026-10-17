import { z } from "zod";

const StepperWorkoutInputSchema = z.object({
  startAt: z.string().datetime({ offset: true }),
  durationMinutes: z.number().int().min(1).max(1_440),
  // Persisted as PostgreSQL Int; reject out-of-range declarations before a
  // durable idempotency intent can become permanently unreplayable.
  manualStepCount: z.number().int().min(0).max(2_147_483_647).nullable().optional(),
  manualActiveEnergyKcal: z.number().nonnegative().nullable().optional(),
}).strict();

export const CreateStepperWorkoutSchema = StepperWorkoutInputSchema;
export const UpdateStepperWorkoutSchema = StepperWorkoutInputSchema;
export const StepperWorkoutListQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).optional(),
  offset: z.coerce.number().int().nonnegative().max(1_000_000).optional(),
}).strict();
export const StepperWorkoutIdParamsSchema = z.object({
  id: z.preprocess((value) => typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value,
    z.number().int().positive().safe()),
}).strict();

export type StepperWorkoutInput = z.infer<typeof StepperWorkoutInputSchema>;
