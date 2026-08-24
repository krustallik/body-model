import type { Locale } from "@/i18n/i18n-provider";
import { addCalendarDays, buildForecastRequest, DEFAULT_PLAN, type PlanValues } from "@/modules/model-forecast/forecast-ui";
import type { GoalPlanningRequest } from "./goal-planning.schema";
import type { GoalPlanningResponse, GoalPlanningStatus } from "./goal-planning.types";

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

export function defaultGoalForm(latestModeledDate?: string | null, currentWeightKg?: number | null): GoalFormValues {
  return {
    targetWeightKg: currentWeightKg === null || currentWeightKg === undefined
      ? "" : (Math.round((currentWeightKg - 3) * 10) / 10).toString(),
    goalDate: latestModeledDate ? addCalendarDays(latestModeledDate, 90) : "",
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

export function buildGoalPlanningRequest(values: GoalFormValues, latestModeledDate: string): {
  request: GoalPlanningRequest | null;
  errors: GoalFormErrors;
} {
  const errors: GoalFormErrors = {};
  const targetValueKg = requiredNumber(values.targetWeightKg, "Target weight", errors, "targetWeightKg");
  const minCaloriesKcal = requiredNumber(values.minCaloriesKcal, "Minimum calories", errors, "minCaloriesKcal");
  const maxCaloriesKcal = requiredNumber(values.maxCaloriesKcal, "Maximum calories", errors, "maxCaloriesKcal");
  const horizonDays = calendarDaysBetween(latestModeledDate, values.goalDate);
  if (!isCalendarDate(values.goalDate) || !Number.isInteger(horizonDays)) errors.goalDate = "Enter a valid calendar date";
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
  if (Object.keys(errors).length > 0 || targetValueKg === null || minCaloriesKcal === null || maxCaloriesKcal === null) {
    return { request: null, errors };
  }
  const scenario = buildForecastRequest(values.mode, horizonDays, values.plan, latestModeledDate).scenario;
  if (scenario.mode === "recent-behavior") throw new Error("goal planning requires an explicit scenario");
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

export function goalStatusPresentation(status: GoalPlanningStatus, locale: Locale = "en"): GoalStatusPresentation {
  const uk = locale === "uk";
  const copy: Record<GoalPlanningStatus, GoalStatusPresentation> = {
    solved: { tone: "success", title: uk ? "Медіанна траєкторія біля цілі" : "Median trajectory is near the target", detail: uk ? "За цих припущень фінальна медіана моделі перебуває в межах числової похибки цілі. Це сценарій, а не гарантія." : "Under these assumptions, the final model median is within numerical tolerance of the target. This is a scenario, not a guarantee." },
    "solved-at-boundary": { tone: "warning", title: uk ? "Рішення на межі ваших умов" : "Solution is at your planning boundary", detail: uk ? "Ціль досягнута моделлю на краю введеного діапазону калорій. Ця межа задана користувачем, а не фізіологією." : "The modeled target is reached at the edge of your calorie range. That boundary is user-supplied, not physiological." },
    "numerically-limited": { tone: "warning", title: uk ? "Числова точність обмежена" : "Numerical precision is limited", detail: uk ? "Forecast і Monte Carlo не підтримують точний центр плану. Орієнтуйтеся на траєкторію та діапазони, а не на точне число калорій." : "Forecast and Monte Carlo resolution do not support a precise plan center. Use the trajectory and ranges, not an exact calorie number." },
    "not-bracketed": { tone: "info", title: uk ? "Ціль не перетнута в заданих межах" : "Target not crossed within these bounds", detail: uk ? "У цьому сценарії ціль не була перетнута між вашими мінімальною та максимальною калорійністю. Це не означає біологічну неможливість." : "In this scenario, the target was not crossed between your calorie bounds. This does not mean biological impossibility." },
    "constraint-limited": { tone: "blocked", title: uk ? "Умови не залишили валідного варіанта" : "Constraints leave no valid candidate", detail: uk ? "Пропорційне масштабування макрошаблону порушує одну або кілька введених вами меж." : "Proportional scaling of the macro template violates one or more bounds you supplied." },
    "forecast-unreliable": { tone: "blocked", title: uk ? "Якість Forecast недостатня" : "Forecast quality is insufficient", detail: uk ? "Це не обмеження харчування: валідний розв’язок не можна підтвердити через якість прогнозних траєкторій." : "This is not a nutrition constraint: a valid solution cannot be verified because of forecast quality." },
    "non-monotonic": { tone: "warning", title: uk ? "Відгук моделі не є монотонним" : "Modeled response is non-monotonic", detail: uk ? "У перевіреній області відгук не підтримує звичайне припущення монотонного пошуку. Це числова властивість сценарію, не медичне попередження." : "The evaluated response does not support the usual monotonic search assumption. This is a numerical scenario property, not a health warning." },
    "search-failed": { tone: "blocked", title: uk ? "Пошук не завершився" : "Search did not complete", detail: uk ? "Солвер не зміг сформувати надійний результат у межах поточного бюджету обчислень." : "The solver could not form a reliable result within its computation budget." },
    "initial-state-unavailable": { tone: "blocked", title: uk ? "Поточний стан ще недоступний" : "Current state is not available", detail: uk ? "Планування заблоковано, доки модель не матиме достатнього поточного стану. Фіктивний центр калорій не створюється." : "Planning is blocked until the model has a sufficient current state. No fallback calorie center is fabricated." },
    "initial-state-unreliable": { tone: "blocked", title: uk ? "Поточний стан недостатньо надійний" : "Current state is not reliable enough", detail: uk ? "Невизначеність відновлення надто велика для надійного плану. Додайте спостереження або оновіть модель." : "Recovery uncertainty is too large for a trustworthy plan. Add observations or update the model." },
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
