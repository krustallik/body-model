import type { PrismaClient } from "@prisma/client";
import { clearUnifiedPublicationBlockFixtures } from "./clear-unified-publication-blocks";

/**
 * Intentional Profile 1 test cleanup: remove workouts, detach optional raw-row
 * pointers, then remove the daily projection while retaining source evidence.
 */
export async function deleteDailyHealthRows(
  client: PrismaClient,
  dates: string | readonly string[],
): Promise<void> {
  const dateList = Array.isArray(dates) ? [...dates] : [dates];
  if (dateList.length === 0) return;
  const fixtureDays = await client.dailyHealthData.findMany({
    where: { profileId: 1, date: { in: dateList } },
    select: { id: true },
  });
  const dayIds = fixtureDays.map(({ id }) => id);
  if (dayIds.length === 0) return;
  const fixtureWorkouts = await client.workout.findMany({
    where: { profileId: 1, dailyHealthDataId: { in: dayIds } },
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
    where: { profileId: 1, dailyHealthDataId: { in: dayIds } },
  });
  await client.healthSyncSnapshot.updateMany({
    where: { profileId: 1, dailyHealthDataId: { in: dayIds } },
    data: { dailyHealthDataId: null },
  });
  await client.healthMetricSample.updateMany({
    where: { profileId: 1, dailyHealthDataId: { in: dayIds } },
    data: { dailyHealthDataId: null },
  });
  await client.heartRateSample.updateMany({
    where: { profileId: 1, dailyHealthDataId: { in: dayIds } },
    data: { dailyHealthDataId: null },
  });
  await client.restingHeartRateSample.updateMany({
    where: { profileId: 1, dailyHealthDataId: { in: dayIds } },
    data: { dailyHealthDataId: null },
  });
  await client.dailyHealthData.deleteMany({ where: { profileId: 1, id: { in: dayIds } } });
}
