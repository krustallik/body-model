import type { PrismaClient } from "@prisma/client";

/**
 * Intentional test cleanup: workouts must be removed before DailyHealthData
 * because Workout.onDelete is Restrict (durable source protection).
 */
export async function deleteDailyHealthRows(
  client: PrismaClient,
  dates: string | readonly string[],
): Promise<void> {
  const dateList = Array.isArray(dates) ? [...dates] : [dates];
  if (dateList.length === 0) return;
  await client.workout.deleteMany({
    where: { dailyHealthData: { date: { in: dateList } } },
  });
  await client.dailyHealthData.deleteMany({ where: { date: { in: dateList } } });
}
