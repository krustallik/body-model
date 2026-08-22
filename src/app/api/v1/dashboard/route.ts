import { validationResponse } from "@/modules/days/day.http";
import { dailyMetricRepository } from "@/modules/days/day.repository";
import { DashboardQuerySchema } from "@/modules/days/day.schema";
import type { DashboardDto } from "@/modules/days/dashboard.types";

export const dynamic = "force-dynamic";

function utcToday(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function GET(request: Request): Promise<Response> {
  const query = DashboardQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!query.success) return validationResponse(query.error);

  const date = query.data.date ?? utcToday();

  try {
    const [todayRows, recentRows, lastSyncAt] = await Promise.all([
      dailyMetricRepository.list({ from: date, to: date, limit: 1, offset: 0 }),
      dailyMetricRepository.list({ to: date, limit: 7, offset: 0 }),
      dailyMetricRepository.latestUpdatedAt(),
    ]);
    const recentDays = [...recentRows]
      .sort((left, right) => right.date.localeCompare(left.date))
      .slice(0, 7);
    const today = todayRows[0] ?? null;
    const dashboard: DashboardDto = {
      today,
      recentDays,
      hasToday: today !== null,
      lastSync: { at: lastSyncAt, status: null },
    };
    return Response.json(dashboard);
  } catch {
    return Response.json({ error: "internal_error" }, { status: 500 });
  }
}
