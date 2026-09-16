/**
 * Local UI-review seed: realistic recent history + workouts + active model episode.
 * Safe for local Docker only. Does not touch production.
 *
 * Usage: npx tsx scripts/qa/ui-review-seed.ts
 */
import { PrismaClient } from "@prisma/client";
import { addCalendarDays, latestCompletedLocalDate } from "@/modules/model-episodes/model-calendar";
import { initializeNewModelEpisode, recalculateModelEpisode } from "@/modules/model-episodes/model-episode.service";

const TIME_ZONE = "Europe/Bratislava";
const prisma = new PrismaClient();

function weekday(date: string): number {
  return new Date(`${date}T12:00:00.000Z`).getUTCDay();
}

async function clearLocalReviewData() {
  await prisma.modelEpisode.deleteMany();
  await prisma.healthSyncSnapshot.deleteMany();
  await prisma.workInterval.deleteMany();
  await prisma.workout.deleteMany();
  await prisma.dailyHealthData.deleteMany();
  await prisma.profile.deleteMany();
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL ?? "";
  if (!databaseUrl.includes("localhost") && !databaseUrl.includes("127.0.0.1")) {
    throw new Error("ui-review-seed refuses non-localhost DATABASE_URL");
  }

  const now = new Date();
  const finalDate = latestCompletedLocalDate(now, TIME_ZONE);
  const historyStart = addCalendarDays(finalDate, -89);
  const episodeStart = addCalendarDays(finalDate, -59);
  const biaStart = addCalendarDays(episodeStart, -6);

  await clearLocalReviewData();
  await prisma.profile.create({
    data: {
      id: 1,
      sex: "male",
      dateOfBirth: new Date("1990-05-10T00:00:00.000Z"),
      heightCm: 180,
      locale: "uk",
    },
  });

  const dates: string[] = [];
  for (let cursor = historyStart; cursor <= finalDate; cursor = addCalendarDays(cursor, 1)) {
    dates.push(cursor);
  }

  for (const [index, date] of dates.entries()) {
    const day = weekday(date);
    const walkingKm = 4.2 + [0, 1.1, 0.4, 1.8, 0.7, 2.2, -0.5][index % 7]!;
    const caloriesKcal = 2_330 + [-120, 40, 90, -35, 135, -70, 15][index % 7]!;
    const isLegacyStrengthOnly = date === addCalendarDays(finalDate, -8);
    const inBiaWindow = date >= biaStart && date <= episodeStart;
    const recent = date >= addCalendarDays(finalDate, -14);
    // Model sources normalize 0 → null, so keep a positive legacy strength field every day.
    // Explicit Workout rows still drive History UI totals / details.
    const strengthMinutes = isLegacyStrengthOnly ? 62 : 45;

    const row = await prisma.dailyHealthData.create({
      data: {
        date,
        weightKg: 89.4 - index * 0.012 + [0.08, -0.03, 0.04, -0.06][index % 4]!,
        bodyFatPercent: inBiaWindow
          ? 27.2 + [0.1, -0.1, 0][index % 3]!
          : index % 14 === 0
            ? 27.0
            : null,
        caloriesKcal,
        proteinG: 158 + [0, 8, -5, 4][index % 4]!,
        fatG: 72 + [0, 5, -3][index % 3]!,
        carbsG: 245 + [0, 18, -12, 9][index % 4]!,
        steps: Math.round(6_800 + walkingKm * 720),
        averageWalkingSpeedKmh: 4.9 + [0, 0.2, -0.1][index % 3]!,
        walkingDistanceKm: walkingKm,
        strengthTrainingMinutes: strengthMinutes,
        rawPayload: { source: "bodycast-ui-review-seed", fixtureVersion: 1 },
      },
    });

    if (!isLegacyStrengthOnly && recent && (day === 1 || day === 3 || day === 5)) {
      await prisma.workout.create({
        data: {
          dailyHealthDataId: row.id,
          externalId: `ui-strength-${date}`,
          type: "Traditional Strength Training",
          startAt: new Date(`${date}T16:00:00.000Z`),
          endAt: new Date(`${date}T16:45:00.000Z`),
          durationMinutes: 45,
          activeEnergyKcal: 180,
        },
      });
    }

    if (date === addCalendarDays(finalDate, -1)) {
      await prisma.workout.createMany({
        data: [
          {
            dailyHealthDataId: row.id,
            externalId: `ui-stair-${date}`,
            type: "Stair Climbing",
            startAt: new Date(`${date}T08:44:00.000Z`),
            endAt: new Date(`${date}T09:46:00.000Z`),
            durationMinutes: 62,
            activeEnergyKcal: 154,
          },
          {
            dailyHealthDataId: row.id,
            externalId: `ui-strength-extra-${date}`,
            type: "Traditional Strength Training",
            startAt: new Date(`${date}T17:00:00.000Z`),
            endAt: new Date(`${date}T17:45:00.000Z`),
            durationMinutes: 45,
            activeEnergyKcal: null,
          },
        ],
      });
    }

    if (date === addCalendarDays(finalDate, -3)) {
      await prisma.workout.create({
        data: {
          dailyHealthDataId: row.id,
          externalId: `ui-stair-only-${date}`,
          type: "Stair Climbing",
          startAt: new Date(`${date}T10:00:00.000Z`),
          endAt: new Date(`${date}T10:40:00.000Z`),
          durationMinutes: 40,
          activeEnergyKcal: 110,
        },
      });
    }

    // Work intervals only with paired sync snapshots so outside-work walking reconstructs.
    if (day >= 1 && day <= 5 && index % 2 === 0) {
      const startAt = new Date(`${date}T06:00:00.000Z`);
      const endAt = new Date(`${date}T14:00:00.000Z`);
      await prisma.workInterval.create({
        data: {
          date,
          startAt,
          endAt,
          timezone: TIME_ZONE,
          category: index % 4 === 0 ? "manualLight" : "standingLightModerate",
          breakMinutes: 30,
        },
      });
      await prisma.healthSyncSnapshot.createMany({
        data: [
          {
            date,
            receivedAt: startAt,
            timezone: TIME_ZONE,
            steps: 1_200,
            walkingDistanceKm: 0.8,
            rawPayload: { source: "bodycast-ui-review-seed" },
          },
          {
            date,
            receivedAt: endAt,
            timezone: TIME_ZONE,
            steps: 5_900,
            walkingDistanceKm: Math.min(walkingKm, 4.4),
            rawPayload: { source: "bodycast-ui-review-seed" },
          },
        ],
      });
    }
  }

  const episode = await initializeNewModelEpisode({ startDate: episodeStart, timezone: TIME_ZONE, now }, prisma);
  const calculation = await recalculateModelEpisode({ episodeId: episode.id, now }, prisma);
  const workoutCount = await prisma.workout.count();

  console.log(JSON.stringify({
    ok: true,
    historyStart,
    finalDate,
    episodeStart,
    dayCount: dates.length,
    workoutCount,
    episodeId: episode.id,
    modeledDays: calculation.daysPersisted,
    latestModeledDate: calculation.latestModeledDate,
    tips: {
      history: "Open /history — chart «Рух і тренування», click Тренування (хв)",
      forecast: "Open /forecast — loading should stay ~800ms",
      goal: "Open /goal — should load planner with latest modeled day",
    },
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
