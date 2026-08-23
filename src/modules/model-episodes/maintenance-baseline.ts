import { addCalendarDays, calendarDayIndex } from "./model-calendar";
import type { MaintenanceBaseline, ModelHealthDaySource } from "./model-episode.types";

export const BASELINE_DERIVATION_DEFAULTS = {
  windowDays: 28,
  lookbackDays: 90,
  minimumCompleteNutritionDays: 21,
  minimumWeightObservations: 14,
  minimumWeightSpanDays: 21,
  maximumAbsoluteWeightTrendPercentPerWeek: 0.25,
} as const;

export type BaselineDerivationConfig = {
  windowDays: number;
  lookbackDays: number;
  minimumCompleteNutritionDays: number;
  minimumWeightObservations: number;
  minimumWeightSpanDays: number;
  maximumAbsoluteWeightTrendPercentPerWeek: number;
};

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function isFiniteNonnegative(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value >= 0;
}

function completeNutrition(day: ModelHealthDaySource): boolean {
  return isFiniteNonnegative(day.caloriesKcal)
    && isFiniteNonnegative(day.proteinG)
    && isFiniteNonnegative(day.fatG)
    && isFiniteNonnegative(day.carbsG);
}

function jointFallbackDonor(
  days: readonly ModelHealthDaySource[],
  center: { caloriesKcal: number; proteinG: number; fatG: number; carbsG: number },
) {
  return [...days].sort((left, right) => {
    const score = (day: ModelHealthDaySource) => (
      Math.abs(day.caloriesKcal! - center.caloriesKcal) / Math.max(center.caloriesKcal, 1)
      + Math.abs(day.proteinG! - center.proteinG) / Math.max(center.proteinG, 1)
      + Math.abs(day.fatG! - center.fatG) / Math.max(center.fatG, 1)
      + Math.abs(day.carbsG! - center.carbsG) / Math.max(center.carbsG, 1)
    );
    return score(left) - score(right) || right.date.localeCompare(left.date);
  })[0];
}

function theilSenSlopeKgPerDay(
  observations: readonly { date: string; weightKg: number }[],
): number {
  const slopes: number[] = [];
  for (let left = 0; left < observations.length; left += 1) {
    const leftDay = calendarDayIndex(observations[left].date);
    for (let right = left + 1; right < observations.length; right += 1) {
      const elapsedDays = calendarDayIndex(observations[right].date) - leftDay;
      if (elapsedDays > 0) {
        slopes.push((observations[right].weightKg - observations[left].weightKg) / elapsedDays);
      }
    }
  }
  return slopes.length === 0 ? 0 : median(slopes);
}

function validateConfig(config: BaselineDerivationConfig): void {
  const integerFields: (keyof BaselineDerivationConfig)[] = [
    "windowDays",
    "lookbackDays",
    "minimumCompleteNutritionDays",
    "minimumWeightObservations",
    "minimumWeightSpanDays",
  ];
  for (const field of integerFields) {
    if (!Number.isInteger(config[field]) || config[field] <= 0) {
      throw new RangeError(`${field} must be a positive integer`);
    }
  }
  if (config.lookbackDays < config.windowDays
      || config.minimumCompleteNutritionDays > config.windowDays
      || config.minimumWeightSpanDays > config.windowDays) {
    throw new RangeError("baseline window configuration is inconsistent");
  }
  if (!Number.isFinite(config.maximumAbsoluteWeightTrendPercentPerWeek)
      || config.maximumAbsoluteWeightTrendPercentPerWeek < 0) {
    throw new RangeError("weight trend threshold must be finite and nonnegative");
  }
}

/** Finds the newest robust, weight-stable maintenance window without mutation. */
export function deriveMaintenanceBaseline(input: {
  days: readonly ModelHealthDaySource[];
  referenceDate: string;
  config?: BaselineDerivationConfig;
}): MaintenanceBaseline | null {
  const config = input.config ?? { ...BASELINE_DERIVATION_DEFAULTS };
  validateConfig(config);
  calendarDayIndex(input.referenceDate);
  const sortedDays = [...input.days].sort((left, right) => left.date.localeCompare(right.date));

  for (let endOffset = 0; endOffset <= config.lookbackDays - config.windowDays; endOffset += 1) {
    const windowEndDate = addCalendarDays(input.referenceDate, -endOffset);
    const windowStartDate = addCalendarDays(windowEndDate, -(config.windowDays - 1));
    const window = sortedDays.filter(({ date }) => date >= windowStartDate && date <= windowEndDate);
    const nutritionDays = window.filter(completeNutrition);
    if (nutritionDays.length < config.minimumCompleteNutritionDays) continue;

    const weightObservations = window.flatMap((day) => (
      day.weightKg !== null && Number.isFinite(day.weightKg) && day.weightKg > 0
        ? [{ date: day.date, weightKg: day.weightKg }]
        : []
    ));
    if (weightObservations.length < config.minimumWeightObservations) continue;
    const weightSpanDays = calendarDayIndex(weightObservations.at(-1)!.date)
      - calendarDayIndex(weightObservations[0].date) + 1;
    if (weightSpanDays < config.minimumWeightSpanDays) continue;

    const baselineEnergyIntakeKcalPerDay = median(
      nutritionDays.map(({ caloriesKcal }) => caloriesKcal!),
    );
    const baselineCarbIntakeG = median(nutritionDays.map(({ carbsG }) => carbsG!));
    if (baselineEnergyIntakeKcalPerDay <= 0 || baselineCarbIntakeG <= 0) continue;

    const medianWeightKg = median(weightObservations.map(({ weightKg }) => weightKg));
    const weightTrendKgPerWeek = theilSenSlopeKgPerDay(weightObservations) * 7;
    const weightTrendPercentPerWeek = weightTrendKgPerWeek / medianWeightKg * 100;
    if (Math.abs(weightTrendPercentPerWeek)
        > config.maximumAbsoluteWeightTrendPercentPerWeek) continue;

    const nutritionCenter = {
      caloriesKcal: baselineEnergyIntakeKcalPerDay,
      proteinG: median(nutritionDays.map(({ proteinG }) => proteinG!)),
      fatG: median(nutritionDays.map(({ fatG }) => fatG!)),
      carbsG: baselineCarbIntakeG,
    };
    const fallbackDonor = jointFallbackDonor(nutritionDays, nutritionCenter);

    return {
      baselineEnergyIntakeKcalPerDay,
      baselineCarbIntakeG,
      fallbackNutrition: {
        caloriesKcal: fallbackDonor.caloriesKcal!,
        proteinG: fallbackDonor.proteinG!,
        fatG: fallbackDonor.fatG!,
        carbsG: fallbackDonor.carbsG!,
      },
      diagnostics: {
        method: "median-with-theil-sen-weight-stability",
        windowStartDate,
        windowEndDate,
        windowDays: config.windowDays,
        completeNutritionDayCount: nutritionDays.length,
        weightObservationCount: weightObservations.length,
        weightObservationSpanDays: weightSpanDays,
        medianWeightKg,
        weightTrendKgPerWeek,
        weightTrendPercentPerWeek,
        maximumAbsoluteWeightTrendPercentPerWeek:
          config.maximumAbsoluteWeightTrendPercentPerWeek,
      },
    };
  }
  return null;
}
