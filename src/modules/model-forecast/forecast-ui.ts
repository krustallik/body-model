import type { ForecastModelRequest } from "./model-forecast.schema";
import type { ForecastBlockedResult, ForecastResult, PredictiveSummary } from "./forecast.types";
import type { ModelStatusDto } from "@/modules/model-episodes/model-episode.types";
import type { Locale } from "@/i18n/i18n-provider";

/** Minimum time the forecast loading surface stays visible to avoid flicker. */
export const MIN_FORECAST_LOADING_MS = 800;

export function minimumVisibleDelay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Resolve work, then wait out any remaining minimum visibility (success path only). */
export async function withMinimumVisibleLoading<T>(
  work: Promise<T>,
  minMs: number = MIN_FORECAST_LOADING_MS,
): Promise<T> {
  const delay = minimumVisibleDelay(minMs);
  const result = await work;
  await delay;
  return result;
}

export const FORECAST_HORIZONS = [7, 30, 90, 180, 365] as const;
export type ForecastHorizon = (typeof FORECAST_HORIZONS)[number];
export type ScenarioMode = "recent-behavior" | "fixed" | "target-centered";
export type ForecastMetric = "physiologicalBodyWeightKg" | "fatMassKg" | "leanTissueKg" | "glycogenAssociatedMassKg";

export type PlanValues = {
  caloriesKcal: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
  outsideWorkWalkingDistanceKm: number;
  averageWalkingSpeedKmh: number;
  averageStepsPerDay: number;
  strengthDaysPerWeek: number;
  strengthTrainingMinutes: number;
  otherTrainingDaysPerWeek: number;
  otherTrainingMinutes: number;
  plannedWork: boolean;
  workDaysPerWeek: number;
  workCategory: "standingLight" | "manualLight" | "standingLightModerate" | "manualModerate";
  shiftHours: number;
  breakHours: number;
  workWalkingDistanceKm: number;
  workWalkingSpeedKmh: number;
};

export const DEFAULT_PLAN: PlanValues = {
  caloriesKcal: 2200,
  proteinG: 150,
  fatG: 75,
  carbsG: 240,
  outsideWorkWalkingDistanceKm: 4,
  averageWalkingSpeedKmh: 5,
  averageStepsPerDay: 8_000,
  strengthDaysPerWeek: 3,
  strengthTrainingMinutes: 45,
  otherTrainingDaysPerWeek: 0,
  otherTrainingMinutes: 45,
  plannedWork: false,
  workDaysPerWeek: 5,
  workCategory: "standingLight",
  shiftHours: 8,
  breakHours: 0.5,
  workWalkingDistanceKm: 0,
  workWalkingSpeedKmh: 5,
};

const TRAINING_WEEKDAYS: ReadonlyArray<0 | 1 | 2 | 3 | 4 | 5 | 6> = [1, 3, 5, 2, 4, 6, 0];

function calendarWeekday(date: string): 0 | 1 | 2 | 3 | 4 | 5 | 6 {
  return new Date(`${date}T12:00:00Z`).getUTCDay() as 0 | 1 | 2 | 3 | 4 | 5 | 6;
}

export function addCalendarDays(date: string, days: number): string {
  const next = new Date(`${date}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

export function localCalendarDate(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Bratislava",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function buildForecastRequest(
  mode: ScenarioMode,
  horizonDays: number,
  plan: PlanValues,
  today = localCalendarDate(),
): ForecastModelRequest {
  if (mode === "recent-behavior") {
    return { horizonDays, seed: 20_260_824, scenario: { mode } };
  }

  const occupation = plan.plannedWork ? [{
    category: plan.workCategory,
    durationHours: plan.shiftHours,
    breakDurationHours: plan.breakHours,
    workWalkingDistanceKm: plan.workWalkingDistanceKm,
    averageWalkingSpeedKmh: plan.workWalkingSpeedKmh,
  }] : [];
  const defaultDay = {
    nutrition: {
      caloriesKcal: plan.caloriesKcal,
      proteinG: plan.proteinG,
      fatG: plan.fatG,
      carbsG: plan.carbsG,
    },
    outsideWorkWalkingDistanceKm: plan.outsideWorkWalkingDistanceKm,
    averageWalkingSpeedKmh: plan.averageWalkingSpeedKmh,
    strengthTrainingMinutes: 0,
    occupation: [],
  };
  const selectedTrainingDays = new Set(TRAINING_WEEKDAYS.slice(0, Math.round(plan.strengthDaysPerWeek)));
  type FixedSchedule = Extract<ForecastModelRequest["scenario"], { mode: "fixed" }>["schedule"];
  const byDate: NonNullable<FixedSchedule["byDate"]> = {};
  const selectedWorkDays = new Set(TRAINING_WEEKDAYS.slice(0, Math.round(plan.workDaysPerWeek)));
  if (plan.plannedWork) {
    for (let index = 1; index <= horizonDays; index += 1) {
      const date = addCalendarDays(today, index);
      const weekday = calendarWeekday(date);
      if (selectedWorkDays.has(weekday)) byDate[date] = { occupation };
    }
  }
  const selectedOtherTrainingDays = new Set(
    TRAINING_WEEKDAYS.slice(0, Math.round(plan.otherTrainingDaysPerWeek)),
  );
  const strengthByWeekday: NonNullable<FixedSchedule["strengthByWeekday"]> = {
    "0": (selectedTrainingDays.has(0) ? plan.strengthTrainingMinutes : 0) + (selectedOtherTrainingDays.has(0) ? plan.otherTrainingMinutes : 0),
    "1": (selectedTrainingDays.has(1) ? plan.strengthTrainingMinutes : 0) + (selectedOtherTrainingDays.has(1) ? plan.otherTrainingMinutes : 0),
    "2": (selectedTrainingDays.has(2) ? plan.strengthTrainingMinutes : 0) + (selectedOtherTrainingDays.has(2) ? plan.otherTrainingMinutes : 0),
    "3": (selectedTrainingDays.has(3) ? plan.strengthTrainingMinutes : 0) + (selectedOtherTrainingDays.has(3) ? plan.otherTrainingMinutes : 0),
    "4": (selectedTrainingDays.has(4) ? plan.strengthTrainingMinutes : 0) + (selectedOtherTrainingDays.has(4) ? plan.otherTrainingMinutes : 0),
    "5": (selectedTrainingDays.has(5) ? plan.strengthTrainingMinutes : 0) + (selectedOtherTrainingDays.has(5) ? plan.otherTrainingMinutes : 0),
    "6": (selectedTrainingDays.has(6) ? plan.strengthTrainingMinutes : 0) + (selectedOtherTrainingDays.has(6) ? plan.otherTrainingMinutes : 0),
  };
  const schedule: FixedSchedule = { defaultDay, byDate, strengthByWeekday };
  return {
    horizonDays,
    seed: 20_260_824,
    scenario: mode === "fixed" ? { mode, schedule } : { mode, schedule },
  };
}

export function formatDate(date: string, options?: Intl.DateTimeFormatOptions, locale: Locale = "en"): string {
  return new Intl.DateTimeFormat(locale === "uk" ? "uk-UA" : "en-US", {
    month: "short",
    day: "numeric",
    ...options,
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));
}

export function formatValue(value: number, unit: "kg" | "kcal" = "kg", locale: Locale = "en"): string {
  return `${new Intl.NumberFormat(locale === "uk" ? "uk-UA" : "en-US", { maximumFractionDigits: unit === "kg" ? 1 : 0 }).format(value)} ${unit}`;
}

export function summarizeEndpoint(result: ForecastResult, metric: ForecastMetric): PredictiveSummary | null {
  return result.dates.at(-1)?.[metric] ?? null;
}

export type QualityPresentation = { tone: "good" | "info" | "warning" | "blocked"; title: string; detail: string };

export function blockedPresentation(result: ForecastBlockedResult, locale: Locale = "en"): QualityPresentation {
  const uk = locale === "uk";
  if (/no longer matches|rerun|invalid/i.test(result.reason)) {
    return { tone: "blocked", title: uk ? "Потрібно оновити модель" : "Model update needed", detail: uk ? "Дані змінилися після останнього розрахунку. Оновіть модель, щоб прогноз відповідав новій історії." : result.reason };
  }
  if (result.initialStateQuality === "degenerate") {
    return { tone: "blocked", title: uk ? "Зараз занадто неясно, з чого починати" : "Starting point is too uncertain", detail: uk ? "Після пропуску даних можливі варіанти дуже різні. Додайте нові зважування." : result.reason };
  }
  return { tone: "blocked", title: uk ? "Потрібно більше зважувань" : "More weigh-ins are needed", detail: uk ? "Після пропуску в даних ще замало зважувань, щоб надійно зрозуміти поточну вагу." : result.reason };
}

export function qualityPresentation(result: ForecastResult, calibrationStatus?: string, locale: Locale = "en"): QualityPresentation {
  const uk = locale === "uk";
  if (result.diagnostics.numericalQuality.classification === "limited-long-horizon") {
    return { tone: "warning", title: uk ? "Далекий прогноз менш точний" : "Far-ahead forecast is less precise", detail: uk ? "Загальний напрям ще корисний, але діапазон на довгий строк ширший і менш стабільний." : "The overall direction is still useful, but the range farther out is wider and less stable." };
  }
  if (result.status !== "ok" || result.initialStateQuality === "degraded") {
    return { tone: "warning", title: uk ? "Зараз прогноз грубий" : "Forecast is rough right now", detail: uk ? "Десь у історії бракує даних, тож BodyCast обережно припустив типові значення." : "Some history is missing, so BodyCast carefully filled gaps with typical values." };
  }
  if (result.initialStateQuality === "recovered") {
    return { tone: "info", title: uk ? "Пропуск у даних закрито" : "A data gap was filled in", detail: uk ? "Модель оцінила пропущений період; через це діапазон прогнозу ширший." : "The model estimated the missing period, so the forecast range is wider." };
  }
  if (calibrationStatus === "insufficient-history" || calibrationStatus === "invalid-history") {
    return { tone: "warning", title: uk ? "Прогноз ще грубий" : "Forecast is still rough", detail: uk ? "Прогноз можна побудувати, але історії ще замало, щоб добре підлаштуватись саме під вас." : "A forecast can run, but there is not enough history yet to tune it closely to you." };
  }
  return { tone: "good", title: uk ? "Прогноз готовий" : "Forecast ready", detail: uk ? "Даних досить, і прогноз уже підлаштований під вашу історію." : "There is enough data, and the forecast is tuned to your history." };
}

export function chartRows(result: ForecastResult, metric: ForecastMetric) {
  return result.dates.map((day) => {
    const summary = day[metric];
    return {
      date: day.date,
      median: summary.median,
      likely: [summary.p25, summary.p75] as [number, number],
      possible: [summary.p05, summary.p95] as [number, number],
    };
  });
}

export type ForecastRequestTracker = { current: number };

export function beginForecastRequest(tracker: ForecastRequestTracker): number {
  tracker.current += 1;
  return tracker.current;
}

export function isCurrentForecastRequest(tracker: ForecastRequestTracker, requestId: number): boolean {
  return tracker.current === requestId;
}

export function planAssumptions(mode: Exclude<ScenarioMode, "recent-behavior">, plan: PlanValues, locale: Locale = "en"): string[] {
  const uk = locale === "uk";
  const precision = (value: number) => new Intl.NumberFormat(uk ? "uk-UA" : "en-US", { maximumFractionDigits: 1 }).format(value);
  return [
    mode === "fixed"
      ? (uk ? "Введений денний план виконується точно." : "The entered daily plan is followed exactly.")
      : (uk ? "Щоденна поведінка змінюється навколо цих типових цілей." : "Daily behavior varies around these typical targets."),
    uk ? `${precision(plan.caloriesKcal)} ккал, ${precision(plan.proteinG)} г білків, ${precision(plan.fatG)} г жирів і ${precision(plan.carbsG)} г вуглеводів на день.` : `${precision(plan.caloriesKcal)} kcal, ${precision(plan.proteinG)} g protein, ${precision(plan.fatG)} g fat, and ${precision(plan.carbsG)} g carbs per day.`,
    uk ? `${precision(plan.outsideWorkWalkingDistanceKm)} км ходьби поза роботою зі швидкістю ${precision(plan.averageWalkingSpeedKmh)} км/год.` : `${precision(plan.outsideWorkWalkingDistanceKm)} km walking outside work at ${precision(plan.averageWalkingSpeedKmh)} km/h.`,
    plan.strengthDaysPerWeek === 0 || plan.strengthTrainingMinutes === 0
      ? (uk ? "Силові тренування не заплановані." : "No strength training is scheduled.")
      : (uk ? `${precision(plan.strengthDaysPerWeek)} силових тренувань на тиждень по ${precision(plan.strengthTrainingMinutes)} хв.` : `${precision(plan.strengthDaysPerWeek)} strength sessions per week, ${precision(plan.strengthTrainingMinutes)} minutes each.`),
    plan.otherTrainingDaysPerWeek === 0 || plan.otherTrainingMinutes === 0
      ? (uk ? "Інші тренування не заплановані." : "No other training is scheduled.")
      : (uk ? `${precision(plan.otherTrainingDaysPerWeek)} інших тренувань на тиждень по ${precision(plan.otherTrainingMinutes)} хв.` : `${precision(plan.otherTrainingDaysPerWeek)} other sessions per week, ${precision(plan.otherTrainingMinutes)} minutes each.`),
    plan.plannedWork
      ? (uk ? `Робота ${precision(plan.workDaysPerWeek)} днів на тиждень: ${precision(plan.shiftHours)} год, з них ${precision(plan.breakHours)} год перерв.` : `Work ${precision(plan.workDaysPerWeek)} days per week: ${precision(plan.shiftHours)} hours with ${precision(plan.breakHours)} hours of breaks.`)
      : (uk ? "Заплановану робочу активність не включено." : "No planned occupational work is included."),
  ];
}

export type ForecastReadiness = {
  score: number | null;
  level: "high" | "medium" | "low" | "unavailable";
  canForecast: boolean;
  title: string;
  detail: string;
  factors: string[];
};

/** Copy for the missing-active-model empty state on Forecast. */
export function noActiveModelPresentation(locale: Locale = "en"): {
  eyebrow: string;
  title: string;
  detail: string;
  primaryAction: string;
  loadingAction: string;
  addObservations: string;
} {
  const uk = locale === "uk";
  return {
    eyebrow: uk ? "Модель ще не створена" : "Model not created yet",
    title: uk ? "Спочатку запустіть модель." : "Start the model first.",
    detail: uk
      ? "Модель ще не рахувала вашу історію. Якщо вага й калорії вже є — запустіть її тут, і після цього з’явиться прогноз."
      : "The model has not calculated your history yet. If weight and calories are already there, start it here — forecasting becomes available afterward.",
    primaryAction: uk ? "Запустити модель" : "Start model",
    loadingAction: uk ? "Створюємо модель…" : "Starting model…",
    addObservations: uk ? "Додати дані" : "Add data",
  };
}

/** Copy for the always-visible recalculate control on Forecast / Diagnostics. */
export function recalculateModelPresentation(locale: Locale = "en"): {
  action: string;
  loadingAction: string;
  hint: string;
} {
  const uk = locale === "uk";
  return {
    action: uk ? "Перерахувати модель" : "Recalculate model",
    loadingAction: uk ? "Перераховуємо модель…" : "Recalculating model…",
    hint: uk
      ? "Бере записи з таблиці здоров’я і зберігає пораховані дні для діагностики та прогнозу."
      : "Takes health-table rows and saves calculated days for diagnostics and forecasting.",
  };
}

export function modelNeedsRecalculation(status: Pick<ModelStatusDto, "daysModeled" | "latestModeledDate" | "currentPredictedWeightKg"> | null): boolean {
  if (!status) return false;
  return status.daysModeled === 0 || status.latestModeledDate === null || status.currentPredictedWeightKg === null;
}

export function initializationFailureMessage(
  reason: string | null | undefined,
  locale: Locale = "en",
): string {
  const uk = locale === "uk";
  const messages: Record<string, string> = uk ? {
    "profile-missing": "Немає профілю. Заповніть профіль і спробуйте знову.",
    "insufficient-baseline-data": "Недостатньо історії харчування та ваги для першої моделі.",
    "insufficient-weight-bia": "Недостатньо вимірювань ваги й складу тіла для першої моделі.",
    "invalid-initial-state": "Не вдалося побудувати початковий стан моделі з наявних даних.",
    "start-date-not-complete": "День старту моделі ще не завершився в локальному часі.",
  } : {
    "profile-missing": "Profile is missing. Complete the profile and try again.",
    "insufficient-baseline-data": "Not enough nutrition and weight history for the first model.",
    "insufficient-weight-bia": "Not enough weight and body-composition observations for the first model.",
    "invalid-initial-state": "Could not build an initial model state from the available data.",
    "start-date-not-complete": "The model start date is not complete in local time yet.",
  };
  return (reason && messages[reason])
    || (uk ? "Не вдалося створити модель." : "Could not start the model.");
}

export function forecastReadiness(input: {
  status: ModelStatusDto | null;
  locale?: Locale;
  mode: ScenarioMode;
  donorDayCount?: number;
  successfulForecast?: boolean;
  blocked?: boolean;
  scenarioEvidenceMissing?: boolean;
}): ForecastReadiness {
  const uk = input.locale === "uk";
  const status = input.status;
  if (!status) return {
    score: null, level: "unavailable", canForecast: false,
    title: uk ? "Прогноз поки недоступний" : "Forecast is not available yet",
    detail: uk
      ? "Спочатку потрібно запустити модель. Якщо вага й калорії вже є в історії — зробіть це тут; оцінка з’явиться після запуску."
      : "Start the model first. If weight and calories are already in your history, do it here; the score appears afterward.",
    factors: uk ? [
      "Потрібно близько 28 днів історії, з яких хоча б 21 день має і калорії, і вагу.",
      "Потрібно щонайменше 14 зважувань за 21+ календарних днів.",
      "За останні 14 днів потрібне хоча б одне зважування з відсотком жиру.",
    ] : [
      "About 28 days of history are needed, with at least 21 days that have both calories and weight.",
      "At least 14 weigh-ins spanning 21+ calendar days are required.",
      "At least one weigh-in with body-fat % from the latest 14 days is required.",
    ],
  };

  const modeledRatio = Math.min(status.daysModeled / 42, 1);
  const nutritionRatio = status.daysModeled === 0 ? 0 : Math.min(status.observedNutritionDays / status.daysModeled, 1);
  const hasCurrentState = status.currentPredictedWeightKg !== null;
  const continuityResolved = status.continuityStatus === "resolved";
  const personalized = status.calibrationStatus === "fully-calibrated" || status.calibrationStatus === "offset-only";
  let score = Math.round(modeledRatio * 25 + nutritionRatio * 25 + (hasCurrentState ? 20 : 0) + (continuityResolved ? 15 : 0) + (personalized ? 15 : 6));
  const insufficientDonors = input.mode === "recent-behavior" && input.donorDayCount !== undefined && input.donorDayCount < 14;
  if (insufficientDonors) score = Math.min(score, 49);
  const canForecast = Boolean(input.successfulForecast || (hasCurrentState && continuityResolved && !input.blocked && !input.scenarioEvidenceMissing && !insufficientDonors));
  const level = score >= 80 ? "high" : score >= 55 ? "medium" : "low";
  const factors: string[] = [];
  if (status.daysModeled === 0) {
    factors.push(uk
      ? "Записи в таблиці здоров’я ще не пораховані моделлю. Натисніть «Перерахувати модель» або «Побудувати прогноз»."
      : "Rows in the health table are not model days yet. Tap “Recalculate model” or “Run forecast”.");
  }
  factors.push(
    uk ? `Модель порахувала ${status.daysModeled} днів історії; для точнішого прогнозу бажано хоча б 42.` : `The model has calculated ${status.daysModeled} history days; at least 42 are preferred for a steadier forecast.`,
    uk ? `Днів з повним записом їжі (калорії): ${status.observedNutritionDays} (${Math.round(nutritionRatio * 100)}%).` : `Days with a full food log (calories): ${status.observedNutritionDays} (${Math.round(nutritionRatio * 100)}%).`,
    personalized
      ? (uk ? "Прогноз уже підлаштований під вашу історію." : "The forecast is tuned to your history.")
      : (uk ? "Прогноз ще грубий: історії замало, щоб добре підлаштуватись під вас." : "Forecast is still rough: not enough history yet to tune it closely to you."),
    continuityResolved
      ? (uk ? "Великих дірок у порахованій історії немає." : "There are no big holes in the calculated history.")
      : (uk ? `Є ${status.unresolvedDayCount} днів з дірками, які модель ще не закрила.` : `${status.unresolvedDayCount} days still have holes the model has not closed.`),
  );
  if (input.mode === "recent-behavior" && input.donorDayCount !== undefined) factors.push(
    uk ? `${input.donorDayCount} днів з вашими звичками; для сценарію «Як останнім часом» потрібно щонайменше 14.` : `${input.donorDayCount} days of your usual habits; “As lately” needs at least 14.`,
  );
  return {
    score, level, canForecast,
    title: canForecast
      ? (level === "high" ? (uk ? "Прогноз досить точний" : "Forecast looks solid") : level === "medium" ? (uk ? "Прогноз середньої точності" : "Forecast is okay") : (uk ? "Зараз прогноз грубий" : "Forecast is rough right now"))
      : (uk ? "Зараз прогноз побудувати не можна" : "Cannot build a forecast right now"),
    detail: canForecast
      ? (uk ? "Оцінка показує, наскільки повні дані для цього прогнозу. Це не гарантія результату." : "The score shows how complete the data is for this forecast. It is not a promise of the outcome.")
      : (uk ? "Нижче — чого саме бракує, щоб прогноз став доступним." : "Below is exactly what is missing before a forecast can run."),
    factors,
  };
}
