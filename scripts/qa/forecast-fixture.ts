import { PrismaClient } from "@prisma/client";
import { addCalendarDays, enumerateCalendarDates, latestCompletedLocalDate } from "@/modules/model-episodes/model-calendar";
import { initializeNewModelEpisode, recalculateModelEpisode } from "@/modules/model-episodes/model-episode.service";
import { recoverModelEpisode } from "@/modules/model-recovery/model-recovery.service";

type FixtureState = "deterministic" | "limited-history" | "insufficient-donors" | "recovered" | "degraded" | "awaiting" | "degenerate" | "stale";
const allowedStates = new Set<FixtureState>(["deterministic", "limited-history", "insufficient-donors", "recovered", "degraded", "awaiting", "degenerate", "stale"]);
const requestedStateArgument = process.argv[2];
if (!requestedStateArgument || !allowedStates.has(requestedStateArgument as FixtureState)) {
  throw new Error("Usage: npm run qa:forecast-fixture -- deterministic|limited-history|insufficient-donors|recovered|degraded|awaiting|degenerate|stale");
}
const requestedState = requestedStateArgument as FixtureState;

const databaseUrl = new URL(process.env.DATABASE_URL ?? "");
if (databaseUrl.pathname.replace(/^\//, "") !== "bodycast_qa") {
  throw new Error("Forecast QA fixtures may run only against the bodycast_qa database");
}

const QA_NOW = new Date(process.env.BODYCAST_QA_NOW ?? "2026-10-20T10:00:00.000Z");
if (!Number.isFinite(QA_NOW.getTime())) throw new Error("BODYCAST_QA_NOW must be valid");
const TIME_ZONE = "Europe/Bratislava";
const prisma = new PrismaClient();

function weekday(date: string): number {
  return new Date(`${date}T12:00:00.000Z`).getUTCDay();
}

async function clearQaDatabase() {
  await prisma.modelEpisode.deleteMany();
  await prisma.healthSyncSnapshot.deleteMany();
  await prisma.workInterval.deleteMany();
  await prisma.workout.deleteMany();
  await prisma.dailyHealthData.deleteMany();
  await prisma.profile.deleteMany();
}

async function seedSources(historyStart: string, finalDate: string) {
  const dates = enumerateCalendarDates(historyStart, finalDate);
  for (const [index, date] of dates.entries()) {
    const day = weekday(date);
    const walkingKm = 4.2 + [0, 1.1, 0.4, 1.8, 0.7, 2.2, -0.5][index % 7];
    const strengthMinutes = day === 1 || day === 3 || day === 5 ? 45 : 0;
    const caloriesKcal = 2_330 + [-120, 40, 90, -35, 135, -70, 15][index % 7];
    await prisma.dailyHealthData.create({ data: {
      date,
      weightKg: 82.4 - index * 0.012 + [0.08, -0.03, 0.04, -0.06][index % 4],
      bodyFatPercent: index % 7 === 0 ? 21.2 + [0.1, -0.1, 0][index % 3] : null,
      caloriesKcal,
      proteinG: 158 + [0, 8, -5, 4][index % 4],
      fatG: 72 + [0, 5, -3][index % 3],
      carbsG: 245 + [0, 18, -12, 9][index % 4],
      steps: Math.round(6_800 + walkingKm * 720),
      averageWalkingSpeedKmh: 4.9 + [0, 0.2, -0.1][index % 3],
      walkingDistanceKm: walkingKm,
      strengthTrainingMinutes: strengthMinutes,
      rawPayload: { source: "bodycast-deterministic-forecast-qa", fixtureVersion: 1 },
    } });

    const hasWork = day >= 1 && day <= 5 && index % 2 === 0;
    if (hasWork) {
      const startAt = new Date(`${date}T06:00:00.000Z`);
      const endAt = new Date(`${date}T14:00:00.000Z`);
      await prisma.workInterval.create({ data: {
        date, startAt, endAt, timezone: TIME_ZONE,
        category: index % 4 === 0 ? "manualLight" : "standingLightModerate",
        breakMinutes: index % 3 === 0 ? 45 : 30,
      } });
      await prisma.healthSyncSnapshot.createMany({ data: [
        { date, receivedAt: startAt, timezone: TIME_ZONE, steps: 1_200, walkingDistanceKm: 0.8, rawPayload: { source: "bodycast-deterministic-forecast-qa" } },
        { date, receivedAt: endAt, timezone: TIME_ZONE, steps: 5_900, walkingDistanceKm: 4.4, rawPayload: { source: "bodycast-deterministic-forecast-qa" } },
      ] });
    }
  }
  return dates;
}

async function removeGap(from: string, to: string) {
  await prisma.healthSyncSnapshot.deleteMany({ where: { date: { gte: from, lte: to } } });
  await prisma.workInterval.deleteMany({ where: { date: { gte: from, lte: to } } });
  await prisma.dailyHealthData.deleteMany({ where: { date: { gte: from, lte: to } } });
}

async function main() {
  await clearQaDatabase();
  const finalDate = latestCompletedLocalDate(QA_NOW, TIME_ZONE);
  const historyStart = addCalendarDays(finalDate, -89);
  const episodeStart = addCalendarDays(finalDate, requestedState === "limited-history" || requestedState === "insufficient-donors" ? -9 : -59);
  const sourceDates = await seedSources(historyStart, finalDate);
  await prisma.profile.create({ data: {
    id: 1, sex: "male", dateOfBirth: new Date("1990-05-10T00:00:00.000Z"), heightCm: 180,
  } });
  const episode = await initializeNewModelEpisode({ startDate: episodeStart, timezone: TIME_ZONE, now: QA_NOW }, prisma);
  let calculation = await recalculateModelEpisode({ episodeId: episode.id, now: QA_NOW }, prisma);
  let recovery: Awaited<ReturnType<typeof recoverModelEpisode>> | null = null;

  if (!(["deterministic", "limited-history", "insufficient-donors"] as FixtureState[]).includes(requestedState)) {
    const gapStart = addCalendarDays(finalDate, -13);
    const gapEnd = addCalendarDays(finalDate, -7);
    await removeGap(gapStart, gapEnd);
    if (requestedState === "awaiting") {
      await prisma.dailyHealthData.updateMany({
        where: { date: { gt: gapEnd, lte: finalDate } }, data: { weightKg: null },
      });
    }
    calculation = await recalculateModelEpisode({ episodeId: episode.id, now: QA_NOW }, prisma);
    const qualityConfig = requestedState === "degraded" ? {
      healthyNormalizedEssThreshold: 0.999999,
      degenerateNormalizedEssThreshold: 0.000001,
      healthyMaximumWeightThreshold: 0.0005,
      degenerateMaximumWeightThreshold: 0.999999,
      healthyValidParticleFractionThreshold: 0.999999,
      degenerateValidParticleFractionThreshold: 0.000001,
    } : requestedState === "degenerate" ? {
      healthyNormalizedEssThreshold: 0.999999,
      degenerateNormalizedEssThreshold: 0.999,
      healthyMaximumWeightThreshold: 0.0005,
      degenerateMaximumWeightThreshold: 0.001,
      healthyValidParticleFractionThreshold: 0.999999,
      degenerateValidParticleFractionThreshold: 0.000001,
    } : requestedState === "recovered" || requestedState === "stale" ? {
      healthyNormalizedEssThreshold: 0.000002,
      degenerateNormalizedEssThreshold: 0.000001,
      healthyMaximumWeightThreshold: 0.999998,
      degenerateMaximumWeightThreshold: 0.999999,
      healthyValidParticleFractionThreshold: 0.000002,
      degenerateValidParticleFractionThreshold: 0.000001,
    } : {};
    recovery = await recoverModelEpisode({
      episodeId: episode.id, seed: 15_100_001,
      config: { particleCount: 128, adaptivePilotParticleCount: 128, ...qualityConfig },
      now: QA_NOW,
    }, prisma);
    if (requestedState === "stale") {
      await prisma.dailyHealthData.update({
        where: { date: finalDate }, data: { caloriesKcal: 2_515 },
      });
    }
  }

  const donorFrom = addCalendarDays(finalDate, -55);
  if (requestedState === "insufficient-donors") {
    await prisma.dailyHealthData.updateMany({
      where: { date: { gte: donorFrom, lt: addCalendarDays(finalDate, -9) } },
      data: { caloriesKcal: null, proteinG: null, fatG: null, carbsG: null },
    });
  }
  const reliableDonorCount = await prisma.dailyHealthData.count({
    where: { date: { gte: donorFrom, lte: finalDate }, caloriesKcal: { not: null }, proteinG: { not: null }, fatG: { not: null }, carbsG: { not: null } },
  });
  const workIntervalCount = await prisma.workInterval.count();
  const weightObservationCount = await prisma.dailyHealthData.count({ where: { weightKg: { not: null } } });
  console.log(JSON.stringify({
    fixture: "bodycast-forecast-qa-v1", state: requestedState, qaNow: QA_NOW.toISOString(),
    historyStart, finalDate, episodeStart, sourceDayCount: sourceDates.length,
    modeledDayCount: calculation.daysPersisted, weightObservationCount,
    completeNutritionDayCount: requestedState === "insufficient-donors" ? 44 : sourceDates.length - (["deterministic", "limited-history"].includes(requestedState) ? 0 : 7),
    reliableDonorCount, workIntervalCount, strengthSchedule: "Monday/Wednesday/Friday, 45 minutes",
    recovery: recovery?.status === "ok" ? {
      status: recovery.recovery.status,
      observationCount: recovery.recovery.observationCount,
      particleCount: recovery.recovery.generatedParticleCount,
    } : recovery,
  }, null, 2));
}

main().finally(async () => prisma.$disconnect());
