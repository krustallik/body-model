import type { GoalFormValues } from "@/modules/model-goal-planning/goal-planning-ui";
import type { ForecastHorizon, ScenarioMode } from "@/modules/model-forecast/forecast-ui";
import type { PlanValues } from "@/modules/planning-scenario/planning-scenario";
import { isCalendarDate, isFiniteInRange, isRecord } from "./versioned-settings";

export type GoalBrowserSettings = {
  form: Omit<GoalFormValues, "plan"> & { plan: Omit<PlanValues, "caloriesKcal" | "proteinG" | "fatG" | "carbsG"> };
  manualNutrition: Pick<PlanValues, "caloriesKcal" | "proteinG" | "fatG" | "carbsG"> | null;
};

export type ForecastBrowserSettings = { horizon: ForecastHorizon; mode: ScenarioMode; plan: PlanValues };

const WORK_CATEGORIES = ["standingLight", "manualLight", "standingLightModerate", "manualModerate"] as const;
const GOAL_TEXT_FIELDS = [
  "targetWeightKg", "minCaloriesKcal", "maxCaloriesKcal", "minProteinG", "maxProteinG",
  "minFatG", "maxFatG", "minCarbsG", "maxCarbsG",
] as const;

function validGoalText(value: unknown, field: (typeof GOAL_TEXT_FIELDS)[number]): value is string {
  if (typeof value !== "string" || value.trim() === "") return typeof value === "string";
  const number = Number(value);
  if (!Number.isFinite(number)) return false;
  if (field === "targetWeightKg") return number > 0 && number <= 1000;
  if (field === "minCaloriesKcal" || field === "maxCaloriesKcal") return number > 0 && number <= 20_000;
  return number >= 0 && number <= 10_000;
}

function isActivityPlan(value: unknown): value is GoalBrowserSettings["form"]["plan"] {
  if (!isRecord(value) || typeof value.plannedWork !== "boolean" || !WORK_CATEGORIES.includes(value.workCategory as typeof WORK_CATEGORIES[number])) return false;
  return isFiniteInRange(value.averageStepsPerDay, 0, 100_000)
    && isFiniteInRange(value.strengthDaysPerWeek, 0, 7)
    && isFiniteInRange(value.strengthTrainingMinutes, 0, 600)
    && isFiniteInRange(value.otherTrainingDaysPerWeek, 0, 7)
    && isFiniteInRange(value.otherTrainingMinutes, 0, 600)
    && isFiniteInRange(value.workDaysPerWeek, 1, 7)
    && isFiniteInRange(value.shiftHours, 0.1, 24)
    && isFiniteInRange(value.breakHours, 0, 24)
    && value.breakHours <= value.shiftHours;
}

function isNutrition(value: unknown): value is ForecastBrowserSettings["plan"] {
  return isRecord(value)
    && isFiniteInRange(value.caloriesKcal, 0, 20_000)
    && isFiniteInRange(value.proteinG, 0, 1000)
    && isFiniteInRange(value.fatG, 0, 1000)
    && isFiniteInRange(value.carbsG, 0, 2000)
    && isActivityPlan(value);
}

export function isGoalBrowserSettings(value: unknown): value is GoalBrowserSettings {
  if (!isRecord(value) || !isRecord(value.form)) return false;
  const form = value.form;
  if (typeof form.mode !== "string" || !["fixed", "target-centered"].includes(form.mode)) return false;
  if (typeof form.goalDate !== "string" || (form.goalDate !== "" && !isCalendarDate(form.goalDate))) return false;
  if (!GOAL_TEXT_FIELDS.every((field) => validGoalText(form[field], field)) || !isActivityPlan(form.plan)) return false;
  if (value.manualNutrition === null) return true;
  return isRecord(value.manualNutrition)
    && isFiniteInRange(value.manualNutrition.caloriesKcal, 0, 20_000)
    && isFiniteInRange(value.manualNutrition.proteinG, 0, 1000)
    && isFiniteInRange(value.manualNutrition.fatG, 0, 1000)
    && isFiniteInRange(value.manualNutrition.carbsG, 0, 2000);
}

export function isForecastBrowserSettings(value: unknown): value is ForecastBrowserSettings {
  return isRecord(value)
    && [7, 30, 90, 180, 365].includes(value.horizon as number)
    && ["recent-behavior", "fixed", "target-centered"].includes(value.mode as string)
    && isNutrition(value.plan);
}

export function goalSettingsFromForm(form: GoalFormValues, manualNutrition: GoalBrowserSettings["manualNutrition"]): GoalBrowserSettings {
  return {
    form: {
      targetWeightKg: form.targetWeightKg,
      goalDate: form.goalDate,
      minCaloriesKcal: form.minCaloriesKcal,
      maxCaloriesKcal: form.maxCaloriesKcal,
      minProteinG: form.minProteinG,
      maxProteinG: form.maxProteinG,
      minFatG: form.minFatG,
      maxFatG: form.maxFatG,
      minCarbsG: form.minCarbsG,
      maxCarbsG: form.maxCarbsG,
      mode: form.mode,
      plan: {
        averageStepsPerDay: form.plan.averageStepsPerDay,
        strengthDaysPerWeek: form.plan.strengthDaysPerWeek,
        strengthTrainingMinutes: form.plan.strengthTrainingMinutes,
        otherTrainingDaysPerWeek: form.plan.otherTrainingDaysPerWeek,
        otherTrainingMinutes: form.plan.otherTrainingMinutes,
        plannedWork: form.plan.plannedWork,
        workDaysPerWeek: form.plan.workDaysPerWeek,
        workCategory: form.plan.workCategory,
        shiftHours: form.plan.shiftHours,
        breakHours: form.plan.breakHours,
      },
    },
    manualNutrition,
  };
}
