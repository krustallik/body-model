import { validationResponse } from "@/modules/days/day.http";
import { dailyMetricRepository } from "@/modules/days/day.repository";
import { DashboardQuerySchema } from "@/modules/days/day.schema";
import type { DashboardDto } from "@/modules/days/dashboard.types";
import { sleepRepository } from "@/modules/health/sleep.repository";
import { addCalendarDays, todayInCalendarTimeZone } from "@/modules/days/calendar-range";
import { emptyTrainingDayFact } from "@/modules/days/training-day-fact";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const query = DashboardQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!query.success) return validationResponse(query.error);

  const date = query.data.date ?? todayInCalendarTimeZone();
  const recentFrom = addCalendarDays(date, -6);

  try {
    const latestRestingHeartRate = (dailyMetricRepository as Partial<typeof dailyMetricRepository>)
      .latestRestingHeartRate;
    const [recentResult, lastSyncAt, restingHeartRate, sleep] = await Promise.all([
      dailyMetricRepository.listWithTrainingFacts({ from: recentFrom, to: date, limit: 7, offset: 0, includeTrainingDays: true }),
      dailyMetricRepository.latestUpdatedAt(),
      latestRestingHeartRate
        ? latestRestingHeartRate.call(dailyMetricRepository)
        : Promise.resolve({ latestBpm: null, timestamp: null }),
      sleepRepository.latestCompleted(),
    ]);
    const recentDays = [...recentResult.days]
      .sort((left, right) => right.date.localeCompare(left.date))
      .slice(0, 7);
    const today = recentDays.find((day) => day.date === date) ?? null;
    const recentTrainingDays = recentResult.trainingDays;
    const todayTrainingDay = recentTrainingDays.find((fact) => fact.date === date)
      ?? emptyTrainingDayFact(date);
    const dashboard: DashboardDto = {
      today,
      todayTrainingDay,
      recentDays,
      recentTrainingDays,
      hasToday: today !== null,
      lastSync: { at: lastSyncAt, status: null },
      restingHeartRate,
      sleep,
    };
    return Response.json(dashboard);
  } catch {
    return Response.json({ error: "internal_error" }, { status: 500 });
  }
}
