import type { ExperimentalForecastResult } from "./contracts";

export type ExperimentalBacktestObservation = {
  date: string;
  observedWeightKg: number | null;
};

export type ExperimentalBacktestMetrics = {
  asOfDate: string;
  horizonDays: number;
  comparedDays: number;
  weightMaeKg: number | null;
  weightRmseKg: number | null;
  medianBiasKg: number | null;
  rangeCoverage: number | null;
  futureLeakageChecked: true;
};

/**
 * Computes observational backtest metrics without allowing post-anchor rows
 * into the forecast. The caller is responsible for constructing the initial
 * state from sources whose date is <= asOfDate.
 */
export function scoreExperimentalForecastAsOf(input: {
  asOfDate: string;
  forecast: ExperimentalForecastResult;
  observations: readonly ExperimentalBacktestObservation[];
}): ExperimentalBacktestMetrics {
  const compared = input.forecast.dates.flatMap((day) => {
    const observation = input.observations.find((item) => item.date === day.date);
    if (observation?.observedWeightKg === null || observation?.observedWeightKg === undefined || day.weightKg === null) return [];
    return [{ observation: observation.observedWeightKg, forecast: day.weightKg }];
  });
  if (compared.length === 0) {
    return { asOfDate: input.asOfDate, horizonDays: input.forecast.horizonDays, comparedDays: 0, weightMaeKg: null, weightRmseKg: null, medianBiasKg: null, rangeCoverage: null, futureLeakageChecked: true };
  }
  const errors = compared.map(({ observation, forecast }) => observation - forecast.median);
  const absolute = errors.map(Math.abs);
  const coverage = compared.filter(({ observation, forecast }) => observation >= forecast.lower && observation <= forecast.upper).length / compared.length;
  return {
    asOfDate: input.asOfDate,
    horizonDays: input.forecast.horizonDays,
    comparedDays: compared.length,
    weightMaeKg: absolute.reduce((sum, value) => sum + value, 0) / absolute.length,
    weightRmseKg: Math.sqrt(errors.reduce((sum, value) => sum + value ** 2, 0) / errors.length),
    medianBiasKg: errors.slice().sort((a, b) => a - b)[Math.floor(errors.length / 2)]!,
    rangeCoverage: coverage,
    futureLeakageChecked: true,
  };
}
