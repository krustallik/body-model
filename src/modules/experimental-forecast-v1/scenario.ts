import { z } from "zod";
import type { ExperimentalForecastScenario } from "./contracts";

export const ExperimentalForecastScenarioSchema = z.object({
  mode: z.enum([
    "maintain-current", "target-calories", "target-deficit", "target-surplus",
    "typical-recent-activity", "explicit-plan",
  ]),
  caloriesKcal: z.number().positive().max(20_000).optional(),
  deltaCaloriesKcal: z.number().min(-10_000).max(10_000).optional(),
  proteinG: z.number().nonnegative().max(1_000).optional(),
  fatG: z.number().nonnegative().max(1_000).optional(),
  carbsG: z.number().nonnegative().max(2_000).optional(),
  outsideWorkWalkingDistanceKm: z.number().nonnegative().max(100).optional(),
  averageWalkingSpeedKmh: z.number().positive().max(15).optional(),
  strengthTrainingMinutes: z.number().nonnegative().max(600).optional(),
  stepperMinutes: z.number().nonnegative().max(600).optional(),
  activityReplacement: z.enum(["replace", "additive"]).optional(),
}).strict().superRefine((value, context) => {
  if (["target-calories", "explicit-plan"].includes(value.mode) && value.caloriesKcal === undefined) {
    context.addIssue({ code: "custom", path: ["caloriesKcal"], message: "caloriesKcal is required for this scenario" });
  }
  if (value.mode === "target-deficit" && value.deltaCaloriesKcal !== undefined && value.deltaCaloriesKcal >= 0) {
    context.addIssue({ code: "custom", path: ["deltaCaloriesKcal"], message: "deficit must be negative" });
  }
  if (value.mode === "target-surplus" && value.deltaCaloriesKcal !== undefined && value.deltaCaloriesKcal <= 0) {
    context.addIssue({ code: "custom", path: ["deltaCaloriesKcal"], message: "surplus must be positive" });
  }
});

export function resolveScenario(input: ExperimentalForecastScenario): ExperimentalForecastScenario {
  return {
    activityReplacement: "replace",
    ...input,
  };
}
