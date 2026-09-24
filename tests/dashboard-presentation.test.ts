import { describe, expect, it } from "vitest";
import { dashboardRecentRows, dashboardTrainingMetricCaption } from "@/modules/days/dashboard-presentation";
import type { DashboardDto } from "@/modules/days/dashboard.types";

function dashboard(overrides: Partial<DashboardDto> = {}): DashboardDto {
  return {
    today: null,
    todayTrainingDay: { date: "2026-09-24", eventCount: 0, durationMinutes: 0, hiddenEventCount: 0, events: [] },
    recentDays: [],
    recentTrainingDays: [],
    hasToday: false,
    lastSync: { at: null, status: null },
    restingHeartRate: { latestBpm: null, timestamp: null },
    sleep: null,
    ...overrides,
  };
}

describe("dashboard recent-day presentation", () => {
  it("includes diary-only event dates without inventing health measurements", () => {
    const rows = dashboardRecentRows(dashboard({
      recentTrainingDays: [{
        date: "2026-09-23",
        eventCount: 1,
        durationMinutes: null,
        hiddenEventCount: 0,
        events: [],
      }],
    }));

    expect(rows).toEqual([{
      date: "2026-09-23",
      weightKg: null,
      caloriesKcal: null,
      proteinG: null,
      steps: null,
      trainingDay: expect.objectContaining({ eventCount: 1, durationMinutes: null }),
    }]);
  });

  it("keeps an empty workout day on an existing health row without materializing zero rows", () => {
    const healthDay = {
      date: "2026-09-24",
      weightKg: 81,
      caloriesKcal: null,
      proteinG: 90,
      steps: null,
    } as DashboardDto["recentDays"][number];
    const rows = dashboardRecentRows(dashboard({
      recentDays: [healthDay],
      recentTrainingDays: [{
        date: "2026-09-24",
        eventCount: 0,
        durationMinutes: 0,
        hiddenEventCount: 0,
        events: [],
      }, {
        date: "2026-09-23",
        eventCount: 0,
        durationMinutes: 0,
        hiddenEventCount: 0,
        events: [],
      }],
    }));

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ date: "2026-09-24", weightKg: 81, trainingDay: { eventCount: 0, durationMinutes: 0 } });
  });

  it("keeps unknown duration distinct from no event in both locales", () => {
    const fact = { date: "2026-09-24", eventCount: 1, durationMinutes: null, hiddenEventCount: 0, events: [] };
    expect(dashboardTrainingMetricCaption(fact, true)).toBe("Подій: 1 · тривалість невідома");
    expect(dashboardTrainingMetricCaption(fact, false)).toBe("Events: 1 · duration unknown");
    expect(dashboardTrainingMetricCaption({ ...fact, eventCount: 0, durationMinutes: 0 }, true)).toBe("хв");
  });
});
