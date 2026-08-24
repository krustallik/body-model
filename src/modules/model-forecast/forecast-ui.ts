import type { ForecastModelRequest } from "./model-forecast.schema";
import type { ForecastBlockedResult, ForecastResult, PredictiveSummary } from "./forecast.types";
import type { ModelStatusDto } from "@/modules/model-episodes/model-episode.types";
import type { Locale } from "@/i18n/i18n-provider";

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
  strengthDaysPerWeek: number;
  strengthTrainingMinutes: number;
  plannedWork: boolean;
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
  strengthDaysPerWeek: 3,
  strengthTrainingMinutes: 45,
  plannedWork: false,
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
  horizonDays: ForecastHorizon,
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
  if (plan.plannedWork) {
    for (let index = 1; index <= horizonDays; index += 1) {
      const date = addCalendarDays(today, index);
      const weekday = calendarWeekday(date);
      if (weekday >= 1 && weekday <= 5) byDate[date] = { occupation };
    }
  }
  const strengthByWeekday: NonNullable<FixedSchedule["strengthByWeekday"]> = {
    "0": selectedTrainingDays.has(0) ? plan.strengthTrainingMinutes : 0,
    "1": selectedTrainingDays.has(1) ? plan.strengthTrainingMinutes : 0,
    "2": selectedTrainingDays.has(2) ? plan.strengthTrainingMinutes : 0,
    "3": selectedTrainingDays.has(3) ? plan.strengthTrainingMinutes : 0,
    "4": selectedTrainingDays.has(4) ? plan.strengthTrainingMinutes : 0,
    "5": selectedTrainingDays.has(5) ? plan.strengthTrainingMinutes : 0,
    "6": selectedTrainingDays.has(6) ? plan.strengthTrainingMinutes : 0,
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
    return { tone: "blocked", title: uk ? "Потрібно оновити модель" : "Model update needed", detail: uk ? "Дані змінилися після останнього розрахунку. Оновіть модель, щоб прогноз відповідав поточній історії." : result.reason };
  }
  if (result.initialStateQuality === "degenerate") {
    return { tone: "blocked", title: uk ? "Поточний стан надто невизначений" : "Current state is too uncertain", detail: uk ? "Після пропуску даних можливі стани організму надто різняться. Додайте нові вимірювання ваги." : result.reason };
  }
  return { tone: "blocked", title: uk ? "Потрібно більше спостережень" : "More observations are needed", detail: uk ? "Після пропуску ще недостатньо вимірювань, щоб надійно відновити поточний стан." : result.reason };
}

export function qualityPresentation(result: ForecastResult, calibrationStatus?: string, locale: Locale = "en"): QualityPresentation {
  const uk = locale === "uk";
  if (result.diagnostics.numericalQuality.classification === "limited-long-horizon") {
    return { tone: "warning", title: uk ? "Точність далекого прогнозу обмежена" : "Long-range precision is limited", detail: uk ? "Загальний напрям корисний, але зовнішній діапазон на цьому горизонті менш стабільний." : "The direction is useful, but the outer range is less stable at this horizon." };
  }
  if (result.status !== "ok" || result.initialStateQuality === "degraded") {
    return { tone: "warning", title: uk ? "Для прогнозу мало даних" : "Forecast has limited evidence", detail: uk ? "BodyCast використав обережні припущення там, де у вашій історії бракує даних." : "BodyCast used conservative assumptions where your history was sparse." };
  }
  if (result.initialStateQuality === "recovered") {
    return { tone: "info", title: uk ? "Поточний стан відновлено" : "Current state reconstructed", detail: uk ? "Пропущений період відновлено, а його невизначеність врахована в діапазоні прогнозу." : "A missing period was recovered and its uncertainty is carried into the range." };
  }
  if (calibrationStatus === "insufficient-history" || calibrationStatus === "invalid-history") {
    return { tone: "warning", title: uk ? "Персоналізація прогнозу обмежена" : "Forecast uses limited personalization", detail: uk ? "Прогноз доступний, але історія ще недостатньо довга або різноманітна для повної персоналізації." : "The forecast can run, but your history is not yet long or varied enough for full personalization." };
  }
  return { tone: "good", title: uk ? "Прогноз готовий" : "Forecast ready", detail: uk ? "Стан моделі актуальний, а кількості даних достатньо для персоналізованого прогнозу." : "The model state and numerical sampling are current." };
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
    plan.plannedWork
      ? (uk ? `Робота з понеділка по п’ятницю: ${precision(plan.shiftHours)} год, з них ${precision(plan.breakHours)} год перерв і ${precision(plan.workWalkingDistanceKm)} км ходьби.` : `Monday–Friday work: ${precision(plan.shiftHours)} hours with ${precision(plan.breakHours)} hours of breaks and ${precision(plan.workWalkingDistanceKm)} km walking.`)
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
    detail: uk ? "Оцінка якості ще не розрахована, бо активну модель не створено." : "Quality has not been scored because there is no active model yet.",
    factors: uk ? [
      "Для першої моделі потрібен стабільний 28-денний проміжок із щонайменше 21 повним днем харчування.",
      "Потрібно щонайменше 14 вимірювань ваги, розподілених мінімум на 21 календарний день.",
      "Потрібне хоча б одне спільне вимірювання ваги й відсотка жиру за останні 14 днів.",
    ] : [
      "The first model needs a stable 28-day window with at least 21 complete nutrition days.",
      "At least 14 weight observations spanning at least 21 calendar days are required.",
      "At least one paired weight and body-fat observation from the latest 14 days is required.",
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
  const factors = [
    uk ? `${status.daysModeled} змодельованих днів; для стабільнішої оцінки бажано щонайменше 42.` : `${status.daysModeled} modeled days; at least 42 are preferred for a steadier estimate.`,
    uk ? `${status.observedNutritionDays} днів із повним фактичним харчуванням (${Math.round(nutritionRatio * 100)}%).` : `${status.observedNutritionDays} days with complete observed nutrition (${Math.round(nutritionRatio * 100)}%).`,
    personalized ? (uk ? "Персональні параметри відкалібровані." : "Personal parameters are calibrated.") : (uk ? "Персоналізація обмежена: історія ще недостатньо довга або різноманітна." : "Personalization is limited: history is not yet long or varied enough."),
    continuityResolved ? (uk ? "Історія стану без невідновлених розривів." : "State history has no unresolved gaps.") : (uk ? `${status.unresolvedDayCount} днів у невідновлених проміжках.` : `${status.unresolvedDayCount} days remain in unresolved intervals.`),
  ];
  if (input.mode === "recent-behavior" && input.donorDayCount !== undefined) factors.push(
    uk ? `${input.donorDayCount} надійних днів поведінки; для сценарію «Останній режим» потрібно щонайменше 14.` : `${input.donorDayCount} reliable behavior days; Recent routine requires at least 14.`,
  );
  return {
    score, level, canForecast,
    title: canForecast
      ? (level === "high" ? (uk ? "Висока якість прогнозу" : "High forecast quality") : level === "medium" ? (uk ? "Середня якість прогнозу" : "Medium forecast quality") : (uk ? "Низька якість прогнозу" : "Low forecast quality"))
      : (uk ? "Прогноз зараз неможливий" : "Forecast cannot run now"),
    detail: canForecast
      ? (uk ? "Оцінка показує, наскільки повними є дані для поточного прогнозу; вона не є гарантією результату." : "The score reflects data completeness for this forecast; it is not a guarantee of the outcome.")
      : (uk ? "Нижче вказано, яких саме даних або стану моделі бракує." : "The missing data or model state is explained below."),
    factors,
  };
}
