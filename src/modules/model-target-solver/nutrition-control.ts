import type {
  CandidateRejectionReason,
  NutritionConstraints,
  SolverScenarioTemplate,
} from "./target-solver.types";

type Nutrition = SolverScenarioTemplate["schedule"]["defaultDay"]["nutrition"];

export function proportionalNutrition(reference: Nutrition, caloriesKcal: number): Nutrition {
  const scale = caloriesKcal / reference.caloriesKcal;
  return {
    caloriesKcal,
    proteinG: reference.proteinG * scale,
    fatG: reference.fatG * scale,
    carbsG: reference.carbsG * scale,
  };
}

export function nutritionConstraintViolation(
  nutrition: Nutrition,
  constraints: NutritionConstraints,
): CandidateRejectionReason | null {
  if (!Object.values(nutrition).every(Number.isFinite)
      || nutrition.caloriesKcal <= 0
      || nutrition.proteinG < 0 || nutrition.fatG < 0 || nutrition.carbsG < 0
      || nutrition.proteinG + nutrition.fatG + nutrition.carbsG <= 0) return "invalid-nutrition-vector";
  if (constraints.minProteinG !== undefined && nutrition.proteinG < constraints.minProteinG) return "protein-below-minimum";
  if (constraints.maxProteinG !== undefined && nutrition.proteinG > constraints.maxProteinG) return "protein-above-maximum";
  if (constraints.minFatG !== undefined && nutrition.fatG < constraints.minFatG) return "fat-below-minimum";
  if (constraints.maxFatG !== undefined && nutrition.fatG > constraints.maxFatG) return "fat-above-maximum";
  if (constraints.minCarbsG !== undefined && nutrition.carbsG < constraints.minCarbsG) return "carbs-below-minimum";
  if (constraints.maxCarbsG !== undefined && nutrition.carbsG > constraints.maxCarbsG) return "carbs-above-maximum";
  return null;
}

export function scenarioWithNutrition(
  template: SolverScenarioTemplate,
  nutrition: Nutrition,
): SolverScenarioTemplate {
  return {
    ...template,
    schedule: {
      ...template.schedule,
      defaultDay: {
        ...template.schedule.defaultDay,
        nutrition: { ...nutrition },
        occupation: template.schedule.defaultDay.occupation.map((interval) => ({ ...interval })),
      },
      byDate: template.schedule.byDate === undefined ? undefined : Object.fromEntries(
        Object.entries(template.schedule.byDate).map(([date, day]) => [date, {
          ...day,
          occupation: day.occupation?.map((interval) => ({ ...interval })),
        }]),
      ),
      strengthByWeekday: template.schedule.strengthByWeekday === undefined
        ? undefined : { ...template.schedule.strengthByWeekday },
    },
  };
}
