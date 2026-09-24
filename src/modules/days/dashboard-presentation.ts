import type { DashboardDto } from "./dashboard.types";

export type DashboardRecentRow = {
  date: string;
  weightKg: number | null;
  caloriesKcal: number | null;
  proteinG: number | null;
  steps: number | null;
  trainingDay: DashboardDto["todayTrainingDay"];
};

/** Merge event-only dates into the dashboard table without inventing metrics. */
export function dashboardRecentRows(dashboard: DashboardDto): DashboardRecentRow[] {
  const facts = new Map(dashboard.recentTrainingDays.map((fact) => [fact.date, fact]));
  const rows = new Map<string, DashboardRecentRow>();
  for (const day of dashboard.recentDays) {
    rows.set(day.date, {
      date: day.date,
      weightKg: day.weightKg,
      caloriesKcal: day.caloriesKcal,
      proteinG: day.proteinG,
      steps: day.steps,
      trainingDay: facts.get(day.date) ?? day.trainingDayFact ?? {
        date: day.date,
        eventCount: 0,
        durationMinutes: 0,
        hiddenEventCount: 0,
        events: [],
      },
    });
  }
  for (const fact of dashboard.recentTrainingDays) {
    if (fact.eventCount === 0 || rows.has(fact.date)) continue;
    rows.set(fact.date, {
      date: fact.date,
      weightKg: null,
      caloriesKcal: null,
      proteinG: null,
      steps: null,
      trainingDay: fact,
    });
  }
  return [...rows.values()].sort((left, right) => right.date.localeCompare(left.date));
}

export function dashboardTrainingMetricCaption(
  fact: DashboardDto["todayTrainingDay"],
  uk: boolean,
): string {
  if (fact.eventCount === 0) return uk ? "хв" : "min";
  const events = (uk ? "Подій" : "Events") + ": " + fact.eventCount;
  return fact.durationMinutes === null
    ? events + " · " + (uk ? "тривалість невідома" : "duration unknown")
    : events + " · " + (uk ? "хв" : "min");
}
