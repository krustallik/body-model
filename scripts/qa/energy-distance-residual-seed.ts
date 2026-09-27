/**
 * Isolated-test DB seed for energy-distance residuals R2/R3 browser QA.
 * Refuses non-localhost URLs and the production-looking bodycast DB name.
 *
 * Usage:
 *   npx tsx scripts/qa/energy-distance-residual-seed.ts
 */
import { PrismaClient } from "@prisma/client";
import { MANUAL_STEPPER_SOURCE_PREFIX } from "@/modules/health/workout-source-identity";
import { persistStepperReconciliationV1 } from "@/modules/training/stepper-reconciliation.service";
import { addCalendarDays, latestCompletedLocalDate } from "@/modules/model-episodes/model-calendar";
import {
  initializeNewModelEpisode,
  recalculateModelEpisode,
} from "@/modules/model-episodes/model-episode.service";

const TIME_ZONE = "Europe/Bratislava";
const MARKER = "energy-distance-residual-seed-v1";
const STAIR = "Stair Climbing";
const STRENGTH = "Traditional Strength Training";
const prisma = new PrismaClient();

function assertSafeDatabaseUrl(url: string): void {
  if (!url.includes("127.0.0.1") && !url.includes("localhost")) {
    throw new Error("residual-seed refuses non-localhost DATABASE_URL");
  }
  if (url.includes("/bodycast?") || url.endsWith("/bodycast") || url.includes(":5432/bodycast")) {
    throw new Error("residual-seed refuses production-like bodycast database");
  }
  if (!url.includes("bodycast_energy_distance_test") && !url.includes("bodycast_combined_integration_test")) {
    throw new Error("residual-seed requires an isolated *integration*_test database name");
  }
}

async function upsertDay(date: string, weightKg: number, extras: Record<string, unknown> = {}) {
  return prisma.dailyHealthData.upsert({
    where: { date },
    create: {
      date,
      weightKg,
      caloriesKcal: 2400,
      proteinG: 150,
      fatG: 70,
      carbsG: 250,
      steps: 8000,
      averageWalkingSpeedKmh: 5,
      walkingDistanceKm: 5,
      strengthTrainingMinutes: 0,
      workoutFeedObserved: true,
      rawPayload: { source: MARKER, ...extras },
    },
    update: {
      weightKg,
      caloriesKcal: 2400,
      proteinG: 150,
      fatG: 70,
      carbsG: 250,
      steps: 8000,
      averageWalkingSpeedKmh: 5,
      walkingDistanceKm: 5,
      strengthTrainingMinutes: 0,
      workoutFeedObserved: true,
      rawPayload: { source: MARKER, ...extras },
    },
  });
}

async function clearPriorMarkerWorkouts(): Promise<void> {
  const marked = await prisma.workout.findMany({
    where: {
      OR: [
        { sourceIdentity: { startsWith: `${MANUAL_STEPPER_SOURCE_PREFIX}residual-` } },
        { sourceIdentity: { startsWith: "ext:residual-" } },
        { externalId: { startsWith: "residual-" } },
      ],
    },
    select: { id: true },
  });
  const ids = marked.map((row) => row.id);
  if (ids.length === 0) return;
  await prisma.stepperReconciliationCandidate.deleteMany({
    where: { OR: [{ manualWorkoutId: { in: ids } }, { garminWorkoutId: { in: ids } }] },
  });
  await prisma.stepperReconciliationGroup.deleteMany({
    where: { OR: [{ provisionalWorkoutId: { in: ids } }, { candidates: { some: { OR: [{ manualWorkoutId: { in: ids } }, { garminWorkoutId: { in: ids } }] } } }] },
  });
  await prisma.workout.deleteMany({ where: { id: { in: ids } } });
}

async function seedPendingAndAmbiguous(today: string) {
  const pendingDate = addCalendarDays(today, -1);
  const ambiguousDate = addCalendarDays(today, -2);
  const pendingDay = await upsertDay(pendingDate, 81, { scenario: "pending-pair" });
  const ambiguousDay = await upsertDay(ambiguousDate, 81, { scenario: "ambiguous-pair" });

  const pendingManual = await prisma.workout.create({
    data: {
      dailyHealthDataId: pendingDay.id,
      sourceIdentity: `${MANUAL_STEPPER_SOURCE_PREFIX}residual-pending`,
      externalId: "residual-pending-manual",
      type: STAIR,
      startAt: new Date(`${pendingDate}T09:00:00.000+02:00`),
      endAt: new Date(`${pendingDate}T10:00:00.000+02:00`),
      durationMinutes: 60,
      activeEnergyKcal: null,
      manualStepCount: 2200,
      manualActiveEnergyKcal: 180,
      hiddenFromHistory: false,
      syncProtected: false,
    },
  });
  const pendingGarmin = await prisma.workout.create({
    data: {
      dailyHealthDataId: pendingDay.id,
      sourceIdentity: "ext:residual-pending-garmin",
      externalId: "residual-pending-garmin",
      type: STAIR,
      startAt: new Date(`${pendingDate}T09:05:00.000+02:00`),
      endAt: new Date(`${pendingDate}T10:05:00.000+02:00`),
      durationMinutes: 60,
      activeEnergyKcal: 410,
      hiddenFromHistory: false,
      syncProtected: false,
    },
  });

  const ambiguousManual = await prisma.workout.create({
    data: {
      dailyHealthDataId: ambiguousDay.id,
      sourceIdentity: `${MANUAL_STEPPER_SOURCE_PREFIX}residual-ambiguous`,
      externalId: "residual-ambiguous-manual",
      type: STAIR,
      startAt: new Date(`${ambiguousDate}T09:00:00.000+02:00`),
      endAt: new Date(`${ambiguousDate}T10:00:00.000+02:00`),
      durationMinutes: 60,
      activeEnergyKcal: null,
      manualStepCount: 2000,
      manualActiveEnergyKcal: 150,
      hiddenFromHistory: false,
      syncProtected: false,
    },
  });
  await prisma.workout.create({
    data: {
      dailyHealthDataId: ambiguousDay.id,
      sourceIdentity: "ext:residual-ambiguous-garmin-a",
      externalId: "residual-ambiguous-garmin-a",
      type: STAIR,
      startAt: new Date(`${ambiguousDate}T09:02:00.000+02:00`),
      endAt: new Date(`${ambiguousDate}T10:02:00.000+02:00`),
      durationMinutes: 60,
      activeEnergyKcal: 390,
      hiddenFromHistory: false,
      syncProtected: false,
    },
  });
  await prisma.workout.create({
    data: {
      dailyHealthDataId: ambiguousDay.id,
      sourceIdentity: "ext:residual-ambiguous-garmin-b",
      externalId: "residual-ambiguous-garmin-b",
      type: STAIR,
      startAt: new Date(`${ambiguousDate}T09:10:00.000+02:00`),
      endAt: new Date(`${ambiguousDate}T10:10:00.000+02:00`),
      durationMinutes: 60,
      activeEnergyKcal: 420,
      hiddenFromHistory: false,
      syncProtected: false,
    },
  });

  await persistStepperReconciliationV1(prisma, {
    from: pendingDate,
    to: pendingDate,
    synchronizedSteps: 9000,
  });
  await persistStepperReconciliationV1(prisma, {
    from: ambiguousDate,
    to: ambiguousDate,
    synchronizedSteps: 9000,
  });

  return {
    pendingDate,
    ambiguousDate,
    pendingManualId: pendingManual.id,
    pendingGarminId: pendingGarmin.id,
    ambiguousManualId: ambiguousManual.id,
  };
}

async function seedIncompleteCoverageForecast(today: string) {
  const incompleteDate = addCalendarDays(today, -3);
  const day = await upsertDay(incompleteDate, 81, { scenario: "incomplete-coverage" });
  await prisma.workout.create({
    data: {
      dailyHealthDataId: day.id,
      sourceIdentity: "ext:residual-known-200",
      externalId: "residual-known-200",
      type: STRENGTH,
      startAt: new Date(`${incompleteDate}T07:00:00.000+02:00`),
      endAt: new Date(`${incompleteDate}T08:00:00.000+02:00`),
      durationMinutes: 60,
      activeEnergyKcal: 200,
      hiddenFromHistory: false,
    },
  });
  await prisma.workout.create({
    data: {
      dailyHealthDataId: day.id,
      sourceIdentity: "ext:residual-unknown-energy",
      externalId: "residual-unknown-energy",
      type: STRENGTH,
      startAt: new Date(`${incompleteDate}T09:00:00.000+02:00`),
      endAt: new Date(`${incompleteDate}T10:00:00.000+02:00`),
      durationMinutes: 60,
      activeEnergyKcal: null,
      hiddenFromHistory: false,
    },
  });

  // Enough recent history so forecast can initialize under default v7.
  for (let offset = 4; offset <= 45; offset += 1) {
    const date = addCalendarDays(today, -offset);
    const recent = date >= addCalendarDays(today, -14);
    const row = await upsertDay(date, 81 - offset * 0.01, { scenario: "forecast-history" });
    if (offset % 7 === 0 || (recent && offset % 3 === 0)) {
      await prisma.dailyHealthData.update({
        where: { date },
        data: { bodyFatPercent: 21.5 + (offset % 5) * 0.1 },
      });
    }
    if (offset % 3 === 0) {
      await prisma.workout.create({
        data: {
          dailyHealthDataId: row.id,
          sourceIdentity: `ext:residual-hist-${date}`,
          externalId: `residual-hist-${date}`,
          type: STRENGTH,
          startAt: new Date(`${date}T16:00:00.000+02:00`),
          endAt: new Date(`${date}T16:45:00.000+02:00`),
          durationMinutes: 45,
          activeEnergyKcal: 280,
          hiddenFromHistory: false,
        },
      });
    }
  }
  return incompleteDate;
}

async function ensureEpisode(startDate: string) {
  await prisma.profile.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      sex: "male",
      dateOfBirth: new Date("1990-05-10T00:00:00.000Z"),
      heightCm: 180,
      locale: "en",
    },
  });
  const active = await prisma.modelEpisode.findFirst({ where: { active: true } });
  if (active) {
    await recalculateModelEpisode({ episodeId: active.id });
    return active.id;
  }
  const created = await initializeNewModelEpisode({
    startDate,
    timezone: TIME_ZONE,
  });
  await recalculateModelEpisode({ episodeId: created.id });
  return created.id;
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL ?? "";
  assertSafeDatabaseUrl(databaseUrl);
  const today = latestCompletedLocalDate(new Date(), TIME_ZONE);
  await clearPriorMarkerWorkouts();
  const recon = await seedPendingAndAmbiguous(today);
  const incompleteDate = await seedIncompleteCoverageForecast(today);
  const episodeId = await ensureEpisode(addCalendarDays(today, -45));
  const pendingGroup = await prisma.stepperReconciliationGroup.findFirst({
    where: { localDate: recon.pendingDate, status: { in: ["pending", "ambiguous"] } },
    include: { candidates: true },
  });
  const ambiguousGroup = await prisma.stepperReconciliationGroup.findFirst({
    where: { localDate: recon.ambiguousDate, status: { in: ["pending", "ambiguous"] } },
    include: { candidates: true },
  });
  console.log(JSON.stringify({
    ok: true,
    marker: MARKER,
    today,
    episodeId,
    incompleteDate,
    pending: {
      date: recon.pendingDate,
      manualId: recon.pendingManualId,
      garminId: recon.pendingGarminId,
      groupStatus: pendingGroup?.status ?? null,
      candidateCount: pendingGroup?.candidates.length ?? 0,
    },
    ambiguous: {
      date: recon.ambiguousDate,
      manualId: recon.ambiguousManualId,
      groupStatus: ambiguousGroup?.status ?? null,
      candidateCount: ambiguousGroup?.candidates.length ?? 0,
    },
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
