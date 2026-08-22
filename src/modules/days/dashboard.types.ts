import type { DailyMetricDto } from "./day.types";

export interface DashboardDto {
  today: DailyMetricDto | null;
  recentDays: DailyMetricDto[];
  hasToday: boolean;
  lastSync: {
    at: string | null;
    status: null;
  };
}
