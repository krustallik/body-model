import type { ForecastChartObservedDay } from "@/modules/model-forecast/forecast-chart-data";

type DailyMeasurement = { date: string; weightKg: number | null; bodyFatPercent: number | null };
type DailyMeasurementsResponse = { days?: DailyMeasurement[] };

/** Adds same-day recorded body-fat percentages from the existing read-only health endpoint. */
export async function attachObservedBodyFatPercent(
  observedWeights: readonly ForecastChartObservedDay[],
  signal: AbortSignal,
): Promise<ForecastChartObservedDay[]> {
  if (observedWeights.length === 0) return [];

  const dates = observedWeights.map(({ date }) => date).sort();
  const from = dates[0];
  const to = dates.at(-1);
  if (!from || !to) return observedWeights.map((day) => ({ ...day, bodyFatPercent: null }));

  const measurements: DailyMeasurement[] = [];
  let offset = 0;
  try {
    while (true) {
      const query = new URLSearchParams({ from, to, limit: "100", offset: String(offset), includeTrainingDays: "false" });
      const response = await fetch(`/api/v1/days?${query}`, { cache: "no-store", signal });
      if (!response.ok) return observedWeights.map((day) => ({ ...day, bodyFatPercent: null }));
      const body = await response.json() as DailyMeasurementsResponse;
      const page = Array.isArray(body.days) ? body.days : [];
      measurements.push(...page);
      if (page.length < 100) break;
      offset += page.length;
    }
  } catch (error) {
    if (signal.aborted) throw error;
    return observedWeights.map((day) => ({ ...day, bodyFatPercent: null }));
  }

  const bodyFatByDate = new Map(measurements.flatMap((day) => (
    typeof day.weightKg === "number" && Number.isFinite(day.weightKg) && day.weightKg > 0
      && typeof day.bodyFatPercent === "number" && Number.isFinite(day.bodyFatPercent)
      && day.bodyFatPercent >= 0 && day.bodyFatPercent <= 100
      ? [[day.date, day.bodyFatPercent] as const]
      : []
  )));

  return observedWeights.map((day) => ({
    ...day,
    bodyFatPercent: bodyFatByDate.get(day.date) ?? null,
  }));
}
