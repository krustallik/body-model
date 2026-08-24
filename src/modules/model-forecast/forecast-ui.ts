import type { ForecastModelRequest } from "./model-forecast.schema";
import type { ForecastBlockedResult, ForecastResult, PredictiveSummary } from "./forecast.types";

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

export function formatDate(date: string, options?: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    ...options,
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));
}

export function formatValue(value: number, unit: "kg" | "kcal" = "kg"): string {
  return `${new Intl.NumberFormat("en", { maximumFractionDigits: unit === "kg" ? 1 : 0 }).format(value)} ${unit}`;
}

export function summarizeEndpoint(result: ForecastResult, metric: ForecastMetric): PredictiveSummary | null {
  return result.dates.at(-1)?.[metric] ?? null;
}

export type QualityPresentation = { tone: "good" | "info" | "warning" | "blocked"; title: string; detail: string };

export function blockedPresentation(result: ForecastBlockedResult): QualityPresentation {
  if (/no longer matches|rerun|invalid/i.test(result.reason)) {
    return { tone: "blocked", title: "Model update needed", detail: result.reason };
  }
  if (result.initialStateQuality === "degenerate") {
    return { tone: "blocked", title: "Current state is too uncertain", detail: result.reason };
  }
  return { tone: "blocked", title: "More observations are needed", detail: result.reason };
}

export function qualityPresentation(result: ForecastResult): QualityPresentation {
  if (result.diagnostics.numericalQuality.classification === "limited-long-horizon") {
    return { tone: "warning", title: "Long-range precision is limited", detail: "The direction is useful, but the outer range is less stable at this horizon." };
  }
  if (result.status !== "ok" || result.initialStateQuality === "degraded") {
    return { tone: "warning", title: "Forecast has limited evidence", detail: "BodyCast used conservative assumptions where your history was sparse." };
  }
  if (result.initialStateQuality === "recovered") {
    return { tone: "info", title: "Current state reconstructed", detail: "A missing period was recovered and its uncertainty is carried into the range." };
  }
  return { tone: "good", title: "Forecast ready", detail: "The model state and numerical sampling are current." };
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
