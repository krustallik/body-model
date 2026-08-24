import { z } from "zod";
import { ForecastConfigSchema, ForecastModelRequestSchema } from "@/modules/model-forecast/model-forecast.schema";

const nutritionConstraints = z.object({
  minCaloriesKcal: z.number().positive().max(20_000),
  maxCaloriesKcal: z.number().positive().max(20_000),
  minProteinG: z.number().nonnegative().max(1_000).optional(),
  maxProteinG: z.number().nonnegative().max(1_000).optional(),
  minFatG: z.number().nonnegative().max(1_000).optional(),
  maxFatG: z.number().nonnegative().max(1_000).optional(),
  minCarbsG: z.number().nonnegative().max(2_000).optional(),
  maxCarbsG: z.number().nonnegative().max(2_000).optional(),
}).strict().superRefine((value, context) => {
  const pairs = [
    ["CaloriesKcal", value.minCaloriesKcal, value.maxCaloriesKcal],
    ["ProteinG", value.minProteinG, value.maxProteinG],
    ["FatG", value.minFatG, value.maxFatG],
    ["CarbsG", value.minCarbsG, value.maxCarbsG],
  ] as const;
  for (const [name, minimum, maximum] of pairs) {
    if (minimum !== undefined && maximum !== undefined && minimum > maximum) {
      context.addIssue({ code: "custom", path: [`min${name}`], message: "must not exceed the corresponding maximum" });
    }
  }
  if (value.minCaloriesKcal >= value.maxCaloriesKcal) {
    context.addIssue({ code: "custom", path: ["minCaloriesKcal"], message: "must be less than maxCaloriesKcal" });
  }
});

const solverConfig = z.object({
  targetToleranceKg: z.number().positive().max(10).optional(),
  goalAttainmentToleranceKg: z.number().nonnegative().max(10).optional(),
  candidateResolutionKcal: z.number().positive().max(1_000).optional(),
  robustnessDeltaKcal: z.number().positive().max(2_000).optional(),
  monotonicityToleranceKg: z.number().nonnegative().max(10).optional(),
  monotonicityConfirmationPathCount: z.number().int().min(2).max(20_000).optional(),
  coarseGridPoints: z.number().int().min(3).max(51).optional(),
  maxEvaluations: z.number().int().min(3).max(200).optional(),
  searchPathCount: z.number().int().min(1).max(20_000).optional(),
  finalPathCount: z.number().int().min(1).max(20_000).optional(),
}).strict();

const scenario = ForecastModelRequestSchema.shape.scenario.refine(
  (value) => value.mode !== "recent-behavior",
  { message: "target solving requires an explicit fixed or target-centered scenario template" },
).refine(
  (value) => !("schedule" in value)
    || !Object.values(value.schedule.byDate ?? {}).some((day) => day.nutrition !== undefined),
  { message: "by-date nutrition overrides are unsupported because the scalar nutrition mapping would be ambiguous" },
);

export const TargetSolverRequestSchema = z.object({
  episodeId: z.number().int().positive().optional(),
  goal: z.object({
    metric: z.literal("weightKg"),
    targetValueKg: z.number().positive().max(1_000),
    goalDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }).strict(),
  control: z.object({
    type: z.literal("daily-calorie-center"),
    constraints: nutritionConstraints,
    nutritionAdjustmentPolicy: z.object({ type: z.literal("proportional-template") }).strict(),
  }).strict(),
  scenarioTemplate: scenario,
  seed: z.number().int().min(0).max(2_147_483_647).default(20_260_824),
  solverConfig: solverConfig.optional(),
  forecastConfig: ForecastConfigSchema.optional(),
}).strict().superRefine((value, context) => {
  if (!("schedule" in value.scenarioTemplate)) return;
  const reference = value.scenarioTemplate.schedule.defaultDay.nutrition;
  if (reference && !(reference.caloriesKcal > 0 && reference.proteinG + reference.fatG + reference.carbsG > 0)) {
    context.addIssue({ code: "custom", path: ["scenarioTemplate", "schedule", "defaultDay", "nutrition"], message: "a complete positive reference nutrition plan is required" });
  }
});
