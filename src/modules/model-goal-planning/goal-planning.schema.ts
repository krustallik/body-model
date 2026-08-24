import { z } from "zod";
import { TargetSolverRequestSchema } from "@/modules/model-target-solver/target-solver.schema";
import type { SolverScenarioTemplate } from "@/modules/model-target-solver/target-solver.types";

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export const GoalPlanningRequestSchema = z.object({
  episodeId: z.number().int().positive().optional(),
  goal: z.object({
    metric: z.literal("weightKg"),
    targetValueKg: z.number().positive().max(1_000),
    goalDate: z.string().refine(isCalendarDate, "must be a real calendar date in YYYY-MM-DD format"),
  }).strict(),
  constraints: TargetSolverRequestSchema.shape.control.shape.constraints,
  scenarioTemplate: TargetSolverRequestSchema.shape.scenarioTemplate,
  seed: z.number().int().min(0).max(2_147_483_647).default(20_260_824),
}).strict();

export type GoalPlanningRequest = Omit<z.infer<typeof GoalPlanningRequestSchema>, "scenarioTemplate"> & {
  scenarioTemplate: SolverScenarioTemplate;
};
