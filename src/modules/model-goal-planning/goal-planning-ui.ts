import type { Locale } from "@/i18n/i18n-provider";
import { addCalendarDays, buildPlanningScenario, DEFAULT_PLAN, type PlanValues } from "@/modules/planning-scenario/planning-scenario";
import type { ModelStatusDto } from "@/modules/model-episodes/model-episode.types";
import type { ProfileDto } from "@/modules/profile/profile.types";
import {
  recommendNutrition,
  recommendNutritionAtCalories,
  type NutritionRecommendation,
  type NutritionRecommendationInput,
} from "@/modules/nutrition-recommender/nutrition-recommender";
import type { GoalPlanningRequest } from "./goal-planning.schema";
import type { GoalPlanningAssumptions, GoalPlanningResponse, GoalPlanningStatus, GoalPlanningWarning } from "./goal-planning.types";
import { isGoalDateAfterLatestCompletedLocalDate } from "@/modules/model-target-solver/goal-date";

export type GoalFormValues = {
  targetWeightKg: string;
  goalDate: string;
  minCaloriesKcal: string;
  maxCaloriesKcal: string;
  minProteinG: string;
  maxProteinG: string;
  minFatG: string;
  maxFatG: string;
  minCarbsG: string;
  maxCarbsG: string;
  mode: "fixed" | "target-centered";
  plan: PlanValues;
};

export type GoalFormErrors = Partial<Record<Exclude<keyof GoalFormValues, "plan" | "mode"> | "plan", string>>;

export type GuidedWorkDescription = "mostly-sitting" | "mostly-standing" | "manual-handling";

/** Maps plain-language answers to the closest existing supported work category. */
export function guidedWorkCategory(description: GuidedWorkDescription): PlanValues["workCategory"] {
  if (description === "manual-handling") return "manualLight";
  // The existing planner has no seated category; both low-movement answers use its
  // lightest supported category. Users who need a more exact category can choose it directly.
  return "standingLight";
}

export function defaultGoalForm(
  latestModeledDate?: string | null,
  currentWeightKg?: number | null,
  latestCompletedLocalDate?: string | null,
): GoalFormValues {
  const goalDateBase = latestModeledDate && latestCompletedLocalDate
    ? latestModeledDate > latestCompletedLocalDate ? latestModeledDate : latestCompletedLocalDate
    : null;
  return {
    targetWeightKg: currentWeightKg === null || currentWeightKg === undefined
      ? "" : (Math.round((currentWeightKg - 3) * 10) / 10).toString(),
    goalDate: goalDateBase ? addCalendarDays(goalDateBase, 90) : "",
    minCaloriesKcal: "1500",
    maxCaloriesKcal: "3300",
    minProteinG: "",
    maxProteinG: "",
    minFatG: "",
    maxFatG: "",
    minCarbsG: "",
    maxCarbsG: "",
    mode: "target-centered",
    plan: { ...DEFAULT_PLAN },
  };
}

/** Apply the suggestion only to the untouched default template; caller edits always win. */
export function initialGoalFormWithRecommendation(
  latestModeledDate: string | null,
  status: ModelStatusDto,
  latestCompletedLocalDate: string,
  profile: Pick<ProfileDto, "sex" | "dateOfBirth" | "heightCm"> | null = null,
): { form: GoalFormValues; recommendation: NutritionRecommendation } {
  const currentWeightKg = status.currentPredictedWeightKg ?? status.currentFilteredWeightKg;
  const form = defaultGoalForm(latestModeledDate, currentWeightKg, latestCompletedLocalDate);
  const recommendation = recommendGoalFormNutrition(form, latestModeledDate, status, profile);
  return {
    form: { ...form, plan: { ...form.plan, ...recommendation.nutrition } },
    recommendation,
  };
}

/** Re-evaluate only recommendation metadata from live inputs; callers must not apply it over edits. */
export function recommendGoalFormNutrition(
  values: GoalFormValues,
  latestModeledDate: string | null,
  status: ModelStatusDto,
  profile: Pick<ProfileDto, "sex" | "dateOfBirth" | "heightCm"> | null = null,
): NutritionRecommendation {
  return recommendNutrition(goalNutritionInput(values, latestModeledDate, status, profile));
}

export function recommendGoalNutritionAtCalories(
  values: GoalFormValues,
  caloriesKcal: number,
  latestModeledDate: string | null,
  status: ModelStatusDto,
  profile: Pick<ProfileDto, "sex" | "dateOfBirth" | "heightCm"> | null = null,
): NutritionRecommendation {
  return recommendNutritionAtCalories(
    goalNutritionInput(values, latestModeledDate, status, profile),
    caloriesKcal,
  );
}

function goalNutritionInput(
  values: GoalFormValues,
  latestModeledDate: string | null,
  status: ModelStatusDto,
  profile: Pick<ProfileDto, "sex" | "dateOfBirth" | "heightCm"> | null,
): NutritionRecommendationInput {
  const currentWeightKg = status.currentPredictedWeightKg ?? status.currentFilteredWeightKg;
  const parsedTargetWeight = values.targetWeightKg.trim() === "" ? null : Number(values.targetWeightKg);
  return {
    currentWeightKg,
    modeledTdeeKcalPerDay: status.currentModeledTdeeKcalPerDay,
    modelEnergyStatus: status.continuityStatus === "resolved" && !status.recoveryRequired ? "available" : "limited",
    calibrationStatus: status.calibrationStatus,
    strengthSessionsPerWeek: values.plan.strengthDaysPerWeek,
    otherTrainingSessionsPerWeek: values.plan.otherTrainingDaysPerWeek,
    averageStepsPerDay: values.plan.averageStepsPerDay,
    workActivity: { planned: values.plan.plannedWork, daysPerWeek: values.plan.workDaysPerWeek },
    targetWeightKg: parsedTargetWeight,
    targetDate: values.goalDate || null,
    latestModeledDate,
    ageYears: profile && latestModeledDate ? ageOnDate(profile.dateOfBirth, latestModeledDate) : null,
    bodyCompositionAvailable: Number.isFinite(status.currentFatMassKg) || Number.isFinite(status.currentLeanTissueKg),
    sex: profile?.sex ?? null,
    heightCm: profile?.heightCm ?? null,
  };
}

function ageOnDate(dateOfBirth: string, referenceDate: string): number | null {
  const birth = new Date(`${dateOfBirth}T12:00:00.000Z`);
  const reference = new Date(`${referenceDate}T12:00:00.000Z`);
  if (!Number.isFinite(birth.getTime()) || birth.toISOString().slice(0, 10) !== dateOfBirth
      || !Number.isFinite(reference.getTime()) || reference.toISOString().slice(0, 10) !== referenceDate
      || dateOfBirth > referenceDate) return null;
  let age = reference.getUTCFullYear() - birth.getUTCFullYear();
  if (reference.getUTCMonth() < birth.getUTCMonth()
      || (reference.getUTCMonth() === birth.getUTCMonth() && reference.getUTCDate() < birth.getUTCDate())) age -= 1;
  return age;
}

/** Planner form must not render until a concrete latest modeled day exists. */
export function canOpenGoalPlanner(latestModeledDate: string | null | undefined): latestModeledDate is string {
  return typeof latestModeledDate === "string" && latestModeledDate.length > 0;
}

export function calendarDaysBetween(from: string, to: string): number {
  const fromTime = new Date(`${from}T12:00:00.000Z`).getTime();
  const toTime = new Date(`${to}T12:00:00.000Z`).getTime();
  if (!Number.isFinite(fromTime) || !Number.isFinite(toTime)) return Number.NaN;
  return Math.round((toTime - fromTime) / 86_400_000);
}

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function requiredNumber(value: string, label: string, errors: GoalFormErrors, key: keyof GoalFormErrors): number | null {
  if (value.trim() === "") { errors[key] = `${label} is required`; return null; }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) { errors[key] = `${label} must be a finite number`; return null; }
  return parsed;
}

function optionalNumber(value: string, label: string, errors: GoalFormErrors, key: keyof GoalFormErrors): number | undefined {
  if (value.trim() === "") return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) { errors[key] = `${label} must be a finite number`; return undefined; }
  return parsed;
}

export function buildGoalPlanningRequest(
  values: GoalFormValues,
  latestModeledDate: string,
  latestCompletedLocalDate: string,
): {
  request: GoalPlanningRequest | null;
  errors: GoalFormErrors;
} {
  const errors: GoalFormErrors = {};
  const targetValueKg = requiredNumber(values.targetWeightKg, "Target weight", errors, "targetWeightKg");
  const minCaloriesKcal = requiredNumber(values.minCaloriesKcal, "Minimum calories", errors, "minCaloriesKcal");
  const maxCaloriesKcal = requiredNumber(values.maxCaloriesKcal, "Maximum calories", errors, "maxCaloriesKcal");
  const horizonDays = calendarDaysBetween(latestModeledDate, values.goalDate);
  if (!isCalendarDate(values.goalDate) || !Number.isInteger(horizonDays)) errors.goalDate = "Enter a valid calendar date";
  else if (!isGoalDateAfterLatestCompletedLocalDate(values.goalDate, latestCompletedLocalDate)) {
    errors.goalDate = "Goal date must be after the latest completed local day";
  }
  else if (horizonDays <= 0) errors.goalDate = "Goal date must be after the latest modeled date";
  if (targetValueKg !== null && targetValueKg <= 0) errors.targetWeightKg = "Target weight must be positive";
  if (minCaloriesKcal !== null && minCaloriesKcal <= 0) errors.minCaloriesKcal = "Minimum calories must be positive";
  if (maxCaloriesKcal !== null && maxCaloriesKcal <= 0) errors.maxCaloriesKcal = "Maximum calories must be positive";
  if (minCaloriesKcal !== null && maxCaloriesKcal !== null && minCaloriesKcal >= maxCaloriesKcal) {
    errors.minCaloriesKcal = "Minimum calories must be lower than maximum calories";
  }
  const optional = {
    minProteinG: optionalNumber(values.minProteinG, "Minimum protein", errors, "minProteinG"),
    maxProteinG: optionalNumber(values.maxProteinG, "Maximum protein", errors, "maxProteinG"),
    minFatG: optionalNumber(values.minFatG, "Minimum fat", errors, "minFatG"),
    maxFatG: optionalNumber(values.maxFatG, "Maximum fat", errors, "maxFatG"),
    minCarbsG: optionalNumber(values.minCarbsG, "Minimum carbohydrate", errors, "minCarbsG"),
    maxCarbsG: optionalNumber(values.maxCarbsG, "Maximum carbohydrate", errors, "maxCarbsG"),
  };
  for (const [minimumKey, maximumKey] of [["minProteinG", "maxProteinG"], ["minFatG", "maxFatG"], ["minCarbsG", "maxCarbsG"]] as const) {
    const minimum = optional[minimumKey];
    const maximum = optional[maximumKey];
    if (minimum !== undefined && minimum < 0) errors[minimumKey] = "Minimum cannot be negative";
    if (maximum !== undefined && maximum < 0) errors[maximumKey] = "Maximum cannot be negative";
    if (minimum !== undefined && maximum !== undefined && minimum > maximum) errors[minimumKey] = "Minimum must not exceed maximum";
  }
  if (!Object.values(values.plan).every((value) => typeof value === "boolean" || typeof value === "string" || Number.isFinite(value))) {
    errors.plan = "Planning assumptions must contain finite values";
  }
  if (values.plan.averageStepsPerDay < 0 || values.plan.averageStepsPerDay > 100_000
      || values.plan.strengthDaysPerWeek < 0 || values.plan.strengthDaysPerWeek > 7
      || values.plan.otherTrainingDaysPerWeek < 0 || values.plan.otherTrainingDaysPerWeek > 7
      || values.plan.workDaysPerWeek < 1 || values.plan.workDaysPerWeek > 7) {
    errors.plan = "Activity assumptions are outside the supported range";
  }
  if (Object.keys(errors).length > 0 || targetValueKg === null || minCaloriesKcal === null || maxCaloriesKcal === null) {
    return { request: null, errors };
  }
  const scenario = buildPlanningScenario(values.mode, horizonDays, values.plan, latestModeledDate);
  return {
    request: {
      goal: { metric: "weightKg", targetValueKg, goalDate: values.goalDate },
      constraints: { minCaloriesKcal, maxCaloriesKcal, ...optional },
      scenarioTemplate: scenario,
      seed: 20_260_824,
    },
    errors,
  };
}

export function roundedPlanCalories(value: number, practicalResolutionKcal: number): number {
  if (!Number.isFinite(value) || !(practicalResolutionKcal > 0)) throw new RangeError("plan value and resolution must be finite and positive");
  return Math.round(value / practicalResolutionKcal) * practicalResolutionKcal;
}

export type GoalStatusPresentation = { tone: "success" | "info" | "warning" | "blocked"; title: string; detail: string };

export function goalScenarioModeLabel(mode: GoalPlanningAssumptions["scenarioMode"], locale: Locale = "en"): string {
  const uk = locale === "uk";
  return mode === "fixed"
    ? uk ? "Точний сценарій" : "Fixed scenario"
    : uk ? "Гнучкий сценарій" : "Flexible scenario";
}

export function goalWarningLabel(warning: string, locale: Locale = "en"): string {
  const uk = locale === "uk";
  const labels: Record<GoalPlanningWarning, { uk: string; en: string }> = {
    "caller-boundary": { uk: "Розв’язок досяг межі калорій, заданої вами.", en: "The solution reached a calorie boundary you set." },
    "numerically-limited": { uk: "Числова точність обмежена; оцінюйте траєкторію разом із діапазонами.", en: "Numerical precision is limited; consider the trajectory together with its ranges." },
    "not-bracketed": { uk: "У заданих межах калорій не знайдено сценарію, що перетинає ціль.", en: "No scenario crossing the target was found within the calorie bounds you set." },
    "constraint-limited": { uk: "Введені обмеження харчування не залишили допустимого варіанта.", en: "The nutrition limits you entered leave no valid option." },
    "forecast-unreliable": { uk: "Якість прогнозних траєкторій недостатня, щоб підтвердити результат.", en: "Forecast trajectories are not reliable enough to confirm a result." },
    "non-monotonic": { uk: "Відгук моделі змінювався нерівномірно в перевіреному діапазоні.", en: "The model response varied non-monotonically across the evaluated range." },
    "degraded-initial-state": { uk: "Початковий стан моделі має обмеження якості.", en: "The model’s starting state has quality limitations." },
    "recovered-initial-state": { uk: "Для розрахунку використано відновлений початковий стан моделі.", en: "The calculation used a recovered model starting state." },
    "limited-long-horizon": { uk: "На довгому горизонті точність траєкторій може бути нижчою.", en: "Trajectory precision may be lower over a long horizon." },
    "initial-state-unavailable": { uk: "Поточний стан моделі недоступний для прогнозування.", en: "The current model state is unavailable for forecasting." },
    "initial-state-unreliable": { uk: "Поточний стан моделі недостатньо надійний для прогнозування.", en: "The current model state is not reliable enough for forecasting." },
  };
  const known = labels[warning as GoalPlanningWarning];
  return known ? (uk ? known.uk : known.en) : uk ? "Є додаткове обмеження сценарію." : "There is an additional scenario limitation.";
}

export function goalStatusPresentation(status: GoalPlanningStatus, locale: Locale = "en"): GoalStatusPresentation {
  const uk = locale === "uk";
  const copy: Record<GoalPlanningStatus, GoalStatusPresentation> = {
    solved: { tone: "success", title: uk ? "Медіанна траєкторія біля цілі" : "Median trajectory is near the target", detail: uk ? "За цих припущень фінальна медіана моделі перебуває в межах числової похибки цілі. Це сценарій, а не гарантія." : "Under these assumptions, the final model median is within numerical tolerance of the target. This is a scenario, not a guarantee." },
    "solved-at-boundary": { tone: "warning", title: uk ? "Рішення на межі ваших умов" : "Solution is at your planning boundary", detail: uk ? "Ціль досягнута моделлю на краю введеного діапазону калорій. Ця межа задана користувачем, а не фізіологією." : "The modeled target is reached at the edge of your calorie range. That boundary is user-supplied, not physiological." },
    "numerically-limited": { tone: "warning", title: uk ? "Числова точність обмежена" : "Numerical precision is limited", detail: uk ? "Forecast і Monte Carlo не підтримують точний центр плану. Орієнтуйтеся на траєкторію та діапазони, а не на точне число калорій." : "Forecast and Monte Carlo resolution do not support a precise plan center. Use the trajectory and ranges, not an exact calorie number." },
    "not-bracketed": { tone: "info", title: uk ? "Ціль не перетнута в заданих межах" : "Target not crossed within these bounds", detail: uk ? "У цьому сценарії ціль не була перетнута між вашими мінімальною та максимальною калорійністю. Це не означає біологічну неможливість." : "In this scenario, the target was not crossed between your calorie bounds. This does not mean biological impossibility." },
    "constraint-limited": { tone: "blocked", title: uk ? "Умови не залишили валідного варіанта" : "Constraints leave no valid candidate", detail: uk ? "Пропорційне масштабування макрошаблону порушує одну або кілька введених вами меж." : "Proportional scaling of the macro template violates one or more bounds you supplied." },
    "forecast-unreliable": { tone: "blocked", title: uk ? "Якість прогнозу недостатня" : "Forecast quality is insufficient", detail: uk ? "BodyCast не показує прогнозні значення, якщо якості траєкторій недостатньо для надійного результату." : "BodyCast does not show forecast values when the trajectories are not reliable enough to support a result." },
    "non-monotonic": { tone: "warning", title: uk ? "Відгук моделі не є монотонним" : "Modeled response is non-monotonic", detail: uk ? "У перевіреній області відгук не підтримує звичайне припущення монотонного пошуку. Це числова властивість сценарію, не медичне попередження." : "The evaluated response does not support the usual monotonic search assumption. This is a numerical scenario property, not a health warning." },
    "search-failed": { tone: "blocked", title: uk ? "Пошук не завершився" : "Search did not complete", detail: uk ? "Солвер не зміг сформувати надійний результат у межах поточного бюджету обчислень." : "The solver could not form a reliable result within its computation budget." },
    "initial-state-unavailable": { tone: "blocked", title: uk ? "Поточний стан ще недоступний" : "Current state is not available", detail: uk ? "BodyCast не показує прогнозні значення, доки модель не має придатного поточного стану. Додайте історичні дані й оновіть модель." : "BodyCast does not show forecast values until the model has a usable current state. Add history and update the model." },
    "initial-state-unreliable": { tone: "blocked", title: uk ? "Поточний стан недостатньо надійний" : "Current state is not reliable enough", detail: uk ? "BodyCast не показує прогнозні значення, коли поточний стан моделі недостатньо надійний. Додайте зважування або оновіть модель." : "BodyCast does not show forecast values when the current model state is not reliable enough. Add weigh-ins or update the model." },
  };
  return copy[status];
}

export function probabilityDefinition(response: GoalPlanningResponse, locale: Locale = "en"): string | null {
  if (!response.terminal) return null;
  const uk = locale === "uk";
  if (response.terminal.attainment.direction === "loss") return uk ? "Частка фінальних траєкторій на рівні цілі або нижче." : "Share of final paths at or below the target.";
  if (response.terminal.attainment.direction === "gain") return uk ? "Частка фінальних траєкторій на рівні цілі або вище." : "Share of final paths at or above the target.";
  return uk ? `Частка фінальних траєкторій у межах ±${response.numerical.goalToleranceKg} кг від цілі.` : `Share of final paths within ±${response.numerical.goalToleranceKg} kg of the target.`;
}
