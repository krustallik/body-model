import type { PrismaClient } from "@prisma/client";
import { clearUnifiedPublicationBlockFixtures } from "./clear-unified-publication-blocks";

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
  const fixtureWorkouts = await client.workout.findMany({
    where: { dailyHealthData: { date: { in: dateList } } },
    select: { id: true },
  });
  await clearUnifiedPublicationBlockFixtures(client, [
    ...dateList.flatMap((sourceKey) => [
      { profileId: 1, source: "health" as const, sourceKey },
      { profileId: 1, source: "day" as const, sourceKey },
    ]),
    ...fixtureWorkouts.map(({ id }) => ({
      profileId: 1,
      source: "stepper" as const,
      sourceKey: String(id),
    })),
  ]);
  await client.workout.deleteMany({
    where: { dailyHealthData: { date: { in: dateList } } },
  });
  await client.dailyHealthData.deleteMany({ where: { date: { in: dateList } } });
}
