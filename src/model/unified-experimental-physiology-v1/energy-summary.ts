export type UnifiedEnergySummaryDayV1 = {
  date: string;
  productionTdeeKcalPerDay: number | null;
  dynamicRmrKcalPerDay: number | null;
};

export type UnifiedEnergySummaryV1 = {
  restingRmrKcalPerDay: number | null;
  recentTypicalMaintenanceKcalPerDay: number | null;
  recentTypicalMaintenanceRangeKcalPerDay: { lower: number; upper: number } | null;
  todayEstimatedExpenditureKcalPerDay: number | null;
  latestModeledExpenditureKcalPerDay: number | null;
  typicalMaintenanceEligibleDays: number;
  typicalMaintenanceWindowDays: 28;
  notes: string[];
};

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
}

function percentile(values: number[], fraction: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * fraction)))]!;
}

/** Explicitly separates resting, recent-typical, and latest/today labels. */
export function buildUnifiedEnergySummaryV1(input: {
  days: readonly UnifiedEnergySummaryDayV1[];
  todayDate?: string;
  minimumEligibleDays?: number;
}): UnifiedEnergySummaryV1 {
  const ordered = [...input.days].sort((left, right) => left.date.localeCompare(right.date));
  const latest = [...ordered].reverse().find((day) => day.productionTdeeKcalPerDay !== null) ?? null;
  const latestRmr = [...ordered].reverse().find((day) => day.dynamicRmrKcalPerDay !== null)?.dynamicRmrKcalPerDay ?? null;
  const cutoff = latest === null ? null : new Date(`${latest.date}T00:00:00Z`).getTime() - 27 * 86_400_000;
  const eligible = ordered.filter((day) => day.productionTdeeKcalPerDay !== null && (cutoff === null || Date.parse(`${day.date}T00:00:00Z`) >= cutoff)).map((day) => day.productionTdeeKcalPerDay!);
  const minimum = input.minimumEligibleDays ?? 14;
  const typical = eligible.length >= minimum ? median(eligible) : null;
  const today = input.todayDate ? ordered.find((day) => day.date === input.todayDate)?.productionTdeeKcalPerDay ?? null : null;
  return {
    restingRmrKcalPerDay: latestRmr,
    recentTypicalMaintenanceKcalPerDay: typical,
    recentTypicalMaintenanceRangeKcalPerDay: typical === null ? null : { lower: percentile(eligible, 0.2)!, upper: percentile(eligible, 0.8)! },
    todayEstimatedExpenditureKcalPerDay: today,
    latestModeledExpenditureKcalPerDay: latest?.productionTdeeKcalPerDay ?? null,
    typicalMaintenanceEligibleDays: eligible.length,
    typicalMaintenanceWindowDays: 28,
    notes: typical === null ? [`requires-at-least-${minimum}-eligible-days`] : ["missing days are excluded, not treated as zero", "latest modeled expenditure is not labeled as today's estimate unless dated today"],
  };
}
