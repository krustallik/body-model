import type { ForecastModelRequest } from "./model-forecast.schema";
import type { ForecastBlockedResult, ForecastResult, PredictiveSummary } from "./forecast.types";
import type { ModelStatusDto } from "@/modules/model-episodes/model-episode.types";
import type { Locale } from "@/i18n/i18n-provider";
import { buildPlanningScenario } from "@/modules/planning-scenario/planning-scenario";
import type { PlanValues } from "@/modules/planning-scenario/planning-scenario";
import { calendarDayIndex } from "@/modules/model-episodes/model-calendar";

export { addCalendarDays, DEFAULT_PLAN, type PlanValues } from "@/modules/planning-scenario/planning-scenario";

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
  const scenario = buildPlanningScenario(mode, horizonDays, plan, today);
  return {
    horizonDays,
    seed: 20_260_824,
    scenario,
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

export function forecastAccuracyEvidence(locale: Locale = "en"): {
  status: "not-validated";
  title: string;
  detail: string;
} {
  return locale === "uk" ? {
    status: "not-validated",
    title: "Точність прогнозу ще недостатньо перевірена",
    detail: "BodyCast поки не зберігає незмінні прогнози на момент їх видачі. Історичні replay є counterfactual перевірками, а не виміром точності вже показаних прогнозів.",
  } : {
    status: "not-validated",
    title: "Forecast accuracy is not yet sufficiently validated",
    detail: "BodyCast does not yet retain immutable forecasts as issued. Historical replays are counterfactual checks, not accuracy measurements of forecasts users actually saw.",
  };
}

export function blockedPresentation(result: ForecastBlockedResult, locale: Locale = "en"): QualityPresentation {
  const uk = locale === "uk";
  if (result.reasonCode === "unified-v4-not-current") {
    return {
      tone: "blocked",
      title: uk ? "Модель ще не опублікована" : "Model publication is not current",
      detail: uk
        ? "Актуальний стан моделі ще не опублікований для прогнозу. Перерахуйте модель і спробуйте знову."
        : "The current model state has not been published for forecasting. Recalculate the model and try again.",
    };
  }
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
  if (result.experimentalQuality === "bootstrap") {
    return { tone: "warning", title: uk ? "Орієнтовний стартовий прогноз" : "Provisional starter forecast", detail: uk ? "Повна історія ще не порахована. Прогноз стартує від останньої ваги й профільних припущень, тому діапазон ширший." : "The full history is not modeled yet. This forecast starts from your latest weight and profile assumptions, so the range is wider." };
  }
  if (result.experimentalQuality === "limited-history") {
    return { tone: "warning", title: uk ? "Прогноз з обмеженою історією" : "Forecast with limited history", detail: uk ? "Прогноз уже доступний, але донорів мало — діапазон свідомо ширший." : "The forecast is available, but there are few history donors, so the range is intentionally wider." };
  }
  if (result.diagnostics.numericalQuality.classification === "limited-long-horizon") {
    return { tone: "warning", title: uk ? "Далекий прогноз менш точний" : "Far-ahead forecast is less precise", detail: uk ? "Загальний напрям ще корисний, але діапазон на довгий строк ширший і менш стабільний." : "The overall direction is still useful, but the range farther out is wider and less stable." };
  }
  if (result.status !== "ok" || result.initialStateQuality === "degraded") {
    return { tone: "warning", title: uk ? "Зараз прогноз грубий" : "Forecast is rough right now", detail: uk ? "Десь у історії бракує даних, тож BodyCast обережно припустив типові значення." : "Some history is missing, so BodyCast carefully filled gaps with typical values." };
  }
  if (result.initialStateQuality === "recovered") {
    return { tone: "info", title: uk ? "Пропуск у даних закрито" : "A data gap was filled in", detail: uk ? "Модель оцінила пропущений період; через це діапазон прогнозу ширший." : "The model estimated the missing period, so the forecast range is wider." };
  }
  if (calibrationStatus === "defaults-retained") {
    return { tone: "warning", title: uk ? "Залишили типові налаштування" : "Typical settings were kept", detail: uk ? "Кандидат персоналізації не пройшов чинну перевірку, тому активні параметри залишилися типовими. Це не перевірка точності майбутнього прогнозу." : "The personalization candidate did not pass the existing validation, so typical parameters remain active. This does not measure future forecast accuracy." };
  }
  if (calibrationStatus === "insufficient-history" || calibrationStatus === "invalid-history") {
    return { tone: "warning", title: uk ? "Прогноз розрахований без персоналізації" : "Forecast calculated without personalization", detail: uk ? "Чинні критерії персоналізації ще не виконані або історія має проблемні дні. Сам факт розрахунку не доводить точність." : "The existing personalization criteria are not met, or the history contains invalid days. A completed calculation does not prove accuracy." };
  }
  if (calibrationStatus === "offset-only" || calibrationStatus === "fully-calibrated") {
    return { tone: "info", title: uk ? "Прогноз розрахований; калібрування прийняте" : "Forecast calculated; calibration accepted", detail: uk ? "Параметри пройшли внутрішню перевірку калібрування. Це не є незалежною перевіркою точності майбутніх прогнозів." : "The parameters passed the model's internal calibration check. This is not an independent test of future forecast accuracy." };
  }
  return { tone: "info", title: uk ? "Прогноз розрахований" : "Forecast calculated", detail: uk ? "Це результат обраного сценарію; його точність ще не перевірена на незмінних прогнозах, збережених під час видачі." : "This is the result for the selected scenario; its accuracy has not yet been tested against immutable forecasts saved when issued." };
}

export function chartRows(result: ForecastResult, metric: ForecastMetric) {
  return result.dates.map((day) => {
    const summary = day[metric];
    if (summary === null) return { date: day.date, median: null, likely: null, possible: null };
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
    uk ? `${precision(plan.averageStepsPerDay)} середніх кроків на день.` : `${precision(plan.averageStepsPerDay)} average steps per day.`,
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
  level: "available" | "limited" | "blocked";
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
      ? "Бере записи з таблиці здоров’я, зберігає пораховані дні і за потреби автоматично оцінює стан після пропуску."
      : "Takes health-table rows, saves calculated days, and automatically estimates state after a data gap when needed.",
  };
}

export type RecalculationPublicationStatus = "current" | "stale" | "unknown";

export function recalculateCompletionMessage(
  status: RecalculationPublicationStatus,
  locale: Locale = "en",
): string {
  const uk = locale === "uk";
  if (status === "current") return uk
    ? "Перерахунок завершено; модель опублікована й актуальна."
    : "Recalculation complete; the model is published and current.";
  if (status === "stale") return uk
    ? "Перерахунок завершено, але публікація моделі застаріла. Прогноз може бути недоступним."
    : "Recalculation finished, but model publication is stale. Forecasting may be unavailable.";
  return uk
    ? "Перерахунок завершено; актуальність публікації моделі не підтверджена."
    : "Recalculation finished; model publication status is unconfirmed.";
}

export function modelNeedsRecalculation(status: Pick<ModelStatusDto, "daysModeled" | "latestModeledDate" | "currentPredictedWeightKg"> | null): boolean {
  if (!status) return false;
  return status.daysModeled === 0 || status.latestModeledDate === null || status.currentPredictedWeightKg === null;
}

export function diagnosticsRecalculateTitle(
  state: { noActiveModel: boolean; needsRecalculation: boolean; daysModeled: number },
  locale: Locale = "en",
): string {
  const uk = locale === "uk";
  if (state.noActiveModel) return uk ? "Активної моделі ще немає" : "There is no active model yet";
  if (!state.needsRecalculation) return uk ? "Оновити пораховану історію" : "Refresh calculated history";
  if (state.daysModeled === 0) return uk ? "Порахованих днів ще немає" : "No calculated days yet";
  return uk
    ? "Є пораховані дні, але поточна оцінка потребує оновлення"
    : "Modeled days exist, but the current estimate needs refreshing";
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
  forecastQuality?: ForecastResult["experimentalQuality"];
}): ForecastReadiness {
  const uk = input.locale === "uk";
  const status = input.status;
  if (!status) {
    if (input.successfulForecast) return {
      level: "limited",
      canForecast: true,
      title: uk ? "Прогноз розрахований з обмеженою історією" : "Forecast calculated with limited history",
      detail: uk ? "Доступний результат побудовано без повної збереженої модельної історії. Це статус доступності даних, не точності." : "A result was produced without a complete persisted model history. This describes data availability, not accuracy.",
      factors: uk ? ["Повної історії моделі для цього результату немає.", "Точність прогнозу ще недостатньо перевірена."] : ["A complete modeled history is not available for this result.", "Forecast accuracy is not yet sufficiently validated."],
    };
    return {
      level: "blocked", canForecast: false,
      title: uk ? "Прогноз поки недоступний" : "Forecast is not available yet",
      detail: uk
        ? "Спочатку потрібно запустити модель. Якщо вага й калорії вже є в історії — зробіть це тут; оцінка з’явиться після запуску."
        : "Start the model first. If weight and calories are already in your history, do it here; the estimate appears after the model starts.",
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
  }

  const hasCurrentState = status.currentPredictedWeightKg !== null;
  const continuityResolved = status.continuityStatus === "resolved";
  const insufficientDonors = input.mode === "recent-behavior" && input.donorDayCount !== undefined && input.donorDayCount < 14;
  const canForecast = Boolean(input.successfulForecast || (hasCurrentState && continuityResolved && !input.blocked && !input.scenarioEvidenceMissing));
  const modeledDayCount = status.daysModeled + status.incompleteDays;
  const calendarDayCount = status.latestModeledDate && status.latestModeledDate >= status.episodeStartDate
    ? calendarDayIndex(status.latestModeledDate) - calendarDayIndex(status.episodeStartDate) + 1
    : 0;
  const limited = !status.productionCurrent
    || !continuityResolved
    || modeledDayCount < calendarDayCount
    || input.forecastQuality === "bootstrap"
    || input.forecastQuality === "limited-history"
    || input.forecastQuality === "degraded"
    || input.forecastQuality === "unavailable"
    || insufficientDonors;
  const level = !canForecast ? "blocked" : limited ? "limited" : "available";
  const factors: string[] = [];
  if (status.daysModeled === 0) {
    factors.push(uk
      ? "Записи в таблиці здоров’я ще не пораховані моделлю. Натисніть «Перерахувати модель» або «Побудувати прогноз»."
      : "Rows in the health table are not model days yet. Tap “Recalculate model” or “Run forecast”.");
  }
  factors.push(uk
    ? `Змодельована історія: ${status.episodeStartDate} — ${status.latestModeledDate ?? "—"}, ${calendarDayCount} календарних днів; ${modeledDayCount} модельних (${status.daysModeled} повних, ${status.incompleteDays} неповних), ${Math.max(0, calendarDayCount - modeledDayCount)} без модельного дня.`
    : `Modeled history: ${status.episodeStartDate} — ${status.latestModeledDate ?? "—"}, ${calendarDayCount} calendar days; ${modeledDayCount} modeled (${status.daysModeled} complete, ${status.incompleteDays} incomplete), ${Math.max(0, calendarDayCount - modeledDayCount)} without a model day.`,
  );
  factors.push(uk
    ? `Харчування: ${status.observedNutritionDays} спостережених, ${status.imputedNutritionDays} заповнених і ${status.unbridgeableNutritionDays} невирішених модельних днів.`
    : `Nutrition: ${status.observedNutritionDays} observed, ${status.imputedNutritionDays} imputed, and ${status.unbridgeableNutritionDays} unresolved modeled days.`,
  );
  factors.push(continuityResolved
    ? (uk ? "Поточність модельного стану підтверджена." : "The modeled state is current.")
    : (uk ? `Потрібно закрити пропуски: ${status.unresolvedDayCount} невирішених днів.` : `${status.unresolvedDayCount} unresolved days still need recovery.`),
  );
  if (input.mode === "recent-behavior" && input.donorDayCount !== undefined) factors.push(
    input.donorDayCount < 14
      ? (uk ? `Для сценарію доступно лише ${input.donorDayCount} днів поведінкових прикладів; опора цього сценарію обмежена.` : `Only ${input.donorDayCount} behavior-example days are available for this scenario; its evidence is limited.`)
      : (uk ? `Для сценарію доступно ${input.donorDayCount} днів поведінкових прикладів.` : `${input.donorDayCount} behavior-example days are available for this scenario.`),
  );
  return {
    level, canForecast,
      title: canForecast
      ? (level === "available" ? (uk ? "Дані дозволяють розрахувати сценарій" : "Data allow the scenario to be calculated") : (uk ? "Сценарій розрахований з обмеженнями" : "Scenario calculated with limitations"))
      : (uk ? "Зараз прогноз побудувати не можна" : "Cannot build a forecast right now"),
    detail: canForecast
      ? (uk ? "Це опис доступності та повноти входів, а не оцінка точності прогнозу." : "This describes input availability and coverage, not forecast accuracy.")
      : (uk ? "Нижче — чого саме бракує, щоб прогноз став доступним." : "Below is exactly what is missing before a forecast can run."),
    factors,
  };
}
