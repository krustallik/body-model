import type { DailyMetricDto, NightlySleepSummaryDto } from "./day.types";
import type { TrainingDayFact } from "./training-day-fact";

export interface DashboardDto {
  today: DailyMetricDto | null;
  todayTrainingDay: TrainingDayFact;
  recentDays: DailyMetricDto[];
  recentTrainingDays: TrainingDayFact[];
  hasToday: boolean;
  lastSync: {
    at: string | null;
    status: null;
  };
  restingHeartRate: { latestBpm: number | null; timestamp: string | null };
  sleep: NightlySleepSummaryDto | null;
}
