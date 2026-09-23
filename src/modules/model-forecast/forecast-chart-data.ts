import type { ForecastMetric } from "./forecast-ui";
import type { ForecastDateSummary, ForecastResult, PredictiveSummary } from "./forecast.types";

export type ForecastChartHistoryDay = {
  date: string;
  modeledWeightKg?: number | null;
  filteredWeightKg?: number | null;
  fatMassKg?: number | null;
  leanTissueKg?: number | null;
  glycogenAssociatedMassKg?: number | null;
};

export type ForecastChartObservedDay = { date: string; weightKg: number };

export type ForecastChartRow = {
  date: string;
  measuredWeightKg: number | null;
  modelEstimateKg: number | null;
  historicalCompartmentKg: number | null;
  futureMedianKg: number | null;
  innerIntervalKg: [number, number] | null;
  outerIntervalKg: [number, number] | null;
  engineeringRangeKg: [number, number] | null;
};

export function forecastChartLabels(locale: "en" | "uk", metric: ForecastMetric, engineeringRange: boolean) {
  const uk = locale === "uk";
  return {
    measuredWeight: uk ? "Вага з вагів" : "Measured weight",
    modelEstimate: uk ? "Оцінка моделі" : "Model estimate",
    historicalEstimate: metric === "fatMassKg"
      ? (uk ? "Історична оцінка жиру" : "Historical fat estimate")
      : metric === "leanTissueKg"
        ? (uk ? "Історична оцінка безжирової тканини" : "Historical lean-tissue estimate")
        : (uk ? "Історична оцінка глікогену й води" : "Historical glycogen-and-water estimate"),
    futureMedian: uk ? "Майбутній прогноз · медіана" : "Future forecast · median",
    innerInterval: engineeringRange ? null : (uk ? "Інтервал прогнозу 25–75%" : "Forecast interval 25–75%"),
    outerInterval: engineeringRange ? null : (uk ? "Інтервал прогнозу 5–95%" : "Forecast interval 5–95%"),
    engineeringRange: uk ? "Інженерний діапазон" : "Engineering range",
    engineeringDescription: uk ? "Інженерний діапазон моделі" : "Model engineering range",
    hasQuantileBands: !engineeringRange,
  };
}

const metricHistoryKey: Record<ForecastMetric, keyof ForecastChartHistoryDay> = {
  physiologicalBodyWeightKg: "filteredWeightKg",
  fatMassKg: "fatMassKg",
  leanTissueKg: "leanTissueKg",
  glycogenAssociatedMassKg: "glycogenAssociatedMassKg",
};

const summaryMetricKeys = [
  "physiologicalBodyWeightKg", "fatMassKg", "leanTissueKg", "glycogenKg",
  "glycogenWaterKg", "glycogenAssociatedMassKg", "extracellularFluidDeviationLiters",
  "adaptiveThermogenesisKcalPerDay", "dynamicRmrKcalPerDay", "tdeeKcalPerDay",
  "energyIntakeKcal", "netActivityKcalPerDay",
] as const satisfies readonly (keyof ForecastDateSummary)[];

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function assertOrdered(summary: PredictiveSummary, date: string, metric: string): void {
  const quantiles: unknown[] = [summary.p05, summary.p25, summary.median, summary.p75, summary.p95];
  const present = quantiles.filter(finite);
  for (let index = 1; index < present.length; index += 1) {
    if (present[index - 1]! > present[index]!) {
      throw new RangeError(`Forecast quantiles are out of order for ${metric} on ${date}`);
    }
  }
}

function band(lower: unknown, upper: unknown): [number, number] | null {
  return finite(lower) && finite(upper) ? [lower, upper] : null;
}

function emptyRow(date: string): ForecastChartRow {
  return {
    date,
    measuredWeightKg: null,
    modelEstimateKg: null,
    historicalCompartmentKg: null,
    futureMedianKg: null,
    innerIntervalKg: null,
    outerIntervalKg: null,
    engineeringRangeKg: null,
  };
}

/** Combines date-only series without inventing measurements or joining history to future values. */
export function buildForecastChartRows(input: {
  result: ForecastResult;
  metric: ForecastMetric;
  history: readonly ForecastChartHistoryDay[];
  observedWeights?: readonly ForecastChartObservedDay[];
}): ForecastChartRow[] {
  const rowsByDate = new Map<string, ForecastChartRow>();
  const getRow = (date: string) => {
    const current = rowsByDate.get(date);
    if (current) return current;
    const next = emptyRow(date);
    rowsByDate.set(date, next);
    return next;
  };

  for (const day of input.history) {
    const row = getRow(day.date);
    const value = day[metricHistoryKey[input.metric]];
    if (!finite(value)) continue;
    if (input.metric === "physiologicalBodyWeightKg") row.modelEstimateKg = value;
    else row.historicalCompartmentKg = value;
  }

  if (input.metric === "physiologicalBodyWeightKg") {
    for (const day of input.observedWeights ?? []) {
      if (!finite(day.weightKg) || day.weightKg <= 0) continue;
      getRow(day.date).measuredWeightKg = day.weightKg;
    }
  }

  const engineeringRange = input.result.forecastVersion === "experimental-forecast-v1";
  for (const day of input.result.dates) {
    for (const key of summaryMetricKeys) assertOrdered(day[key], day.date, key);
    const summary = day[input.metric];
    const row = getRow(day.date);
    if (finite(summary.median)) row.futureMedianKg = summary.median;
    if (engineeringRange) {
      const interval = band(summary.p05, summary.p95);
      if (interval) {
        if (finite(summary.median) && (interval[0] > summary.median || summary.median > interval[1])) {
          throw new RangeError(`Forecast engineering range is out of order for ${input.metric} on ${day.date}`);
        }
        row.engineeringRangeKg = interval;
      }
    } else {
      row.innerIntervalKg = band(summary.p25, summary.p75);
      row.outerIntervalKg = band(summary.p05, summary.p95);
    }
  }

  return [...rowsByDate.values()].sort((left, right) => left.date.localeCompare(right.date));
}

export function formatForecastChartValue(value: unknown, locale: "en" | "uk"): string | null {
  const numberFormat = new Intl.NumberFormat(locale === "uk" ? "uk-UA" : "en-US", { maximumFractionDigits: 1 });
  if (finite(value)) return `${numberFormat.format(value)} kg`;
  if (Array.isArray(value) && value.length === 2 && finite(value[0]) && finite(value[1])) {
    return `${numberFormat.format(value[0])}–${numberFormat.format(value[1])} kg`;
  }
  return null;
}
