import { Prisma, PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addCalendarDays } from "@/modules/model-episodes/model-calendar";
import {
  rebuildRelativeMuscleEpisodeTrajectories,
  RELATIVE_MUSCLE_REBUILD_LOCK_NAMESPACE,
} from "@/modules/model-episodes/relative-muscle-shadow-core.service";
import { requireIsolatedStage01Database } from "@/modules/training/testing/require-isolated-database";
import { deleteDailyHealthRows } from "../helpers/delete-daily-health";

const databaseUrl = process.env.DATABASE_URL;
requireIsolatedStage01Database(databaseUrl, process.env.BODYCAST_STAGE01_MODE, "test");
const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
const profileId = 1;
const fixtureMethod = "relative-muscle-core-a-integration";
const episodeDate = "2088-01-01";
const timezoneDate = "2089-03-27";
const timezoneNextDate = addCalendarDays(timezoneDate, 1);
const timezoneThirdDate = addCalendarDays(timezoneDate, 2);
const raceDate = "2090-01-01";
const fixtureDates = [episodeDate, timezoneDate, timezoneNextDate, timezoneThirdDate, raceDate];

async function clean(): Promise<void> {
  const episodes = await prisma.modelEpisode.findMany({
    where: { profileId, baselineDerivationMethod: fixtureMethod },
    select: { id: true },
  });
  const episodeIds = episodes.map(({ id }) => id);
  await prisma.experimentalSkeletalMuscleDeltaShadow.deleteMany({
    where: { OR: [{ profileId, date: { in: fixtureDates } }, { modelEpisodeId: { in: episodeIds } }] },
  });
  await prisma.experimentalCessationDetrainingShadow.deleteMany({
    where: { OR: [{ profileId, date: { in: fixtureDates } }, { modelEpisodeId: { in: episodeIds } }] },
  });
  await prisma.workout.deleteMany({ where: { dailyHealthData: { date: { in: fixtureDates } } } });
  await prisma.dailyModelState.deleteMany({ where: { episodeId: { in: episodeIds } } });
  await prisma.modelEpisode.deleteMany({ where: { id: { in: episodeIds } } });
  await prisma.healthSyncSnapshot.deleteMany({ where: { date: { in: fixtureDates } } });
  await deleteDailyHealthRows(prisma, fixtureDates);
}

async function ensureProfile(): Promise<void> {
  await prisma.profile.upsert({
    where: { id: profileId },
    create: {
      id: profileId,
      sex: "male",
      dateOfBirth: new Date("1990-05-10T00:00:00.000Z"),
      heightCm: 180,
    },
    update: {},
  });
}

async function createEpisode(input: {
  startDate: string;
  timezone: string;
  active: boolean;
  deactivatedAt?: Date | null;
  latestModeledDate?: string | null;
}) {
  return prisma.modelEpisode.create({
    data: {
      profileId,
      startDate: input.startDate,
      timezone: input.timezone,
      modelVersion: "bodycast-physiology-v6",
      active: input.active,
      deactivatedAt: input.deactivatedAt ?? null,
      ecfPolicy: "hold-ecf",
      baselineEnergyIntakeKcalPerDay: 2_400,
      baselineCarbIntakeG: 220,
      baselineWindowStartDate: input.startDate,
      baselineWindowEndDate: input.startDate,
      baselineNutritionDayCount: 1,
      baselineWeightObservationCount: 1,
      baselineWeightTrendKgPerWeek: 0,
      baselineWeightTrendPercentPerWeek: 0,
      baselineDerivationMethod: fixtureMethod,
      initialFatMassKg: 16,
      initialLeanTissueKg: 55,
      initialGlycogenKg: 0.5,
      baselineExtracellularFluidLiters: 18,
      initialExtracellularFluidDeviationLiters: 0,
      initialAdaptiveThermogenesisKcalPerDay: 0,
      initialFilteredWeightKg: 80,
      initialWeightFilterVarianceKg2: 1,
      initialRmrKcalPerDay: 1_700,
      dynamicRmrFatCoefficient: 3.2,
      dynamicRmrLeanCoefficient: 22,
      dynamicRmrCalibrationOffsetKcalPerDay: 0,
      adaptiveThermogenesisBeta: 0.14,
      adaptiveThermogenesisTimeConstantDays: 14,
      weightProcessNoiseVarianceKg2PerDay: 0.01,
      weightMeasurementNoiseVarianceKg2: 0.25,
      calibrationDiagnostics: {},
      latestModeledDate: input.latestModeledDate ?? input.startDate,
    },
  });
}

async function createCompleteModelDay(episodeId: number, date: string): Promise<void> {
  await prisma.dailyModelState.create({
    data: {
      episodeId,
      date,
      status: "complete",
      sourceQuality: {},
      missingFields: [],
      modelVersion: "bodycast-physiology-v6",
      energyBalanceKcal: -100,
      energyIntakeKcal: 2_400,
      energyExpenditureKcal: 2_500,
    },
  });
}

async function createHealthDay(date: string, timezone: string, workoutFeedObserved: boolean | null = true) {
  const health = await prisma.dailyHealthData.create({
    data: {
      date,
      weightKg: 80,
      proteinG: 150,
      workoutFeedObserved,
      rawPayload: {},
    },
  });
  await prisma.healthSyncSnapshot.create({
    data: {
      dailyHealthDataId: health.id,
      date,
      timezone,
      rawPayload: {},
    },
  });
  return health;
}

beforeAll(ensureProfile);
beforeEach(clean);
afterAll(async () => {
  await clean();
  await prisma.$disconnect();
});

describe("Relative Muscle episode core", () => {
  it("isolates same-local-date episode identities and resets the diagnostic baseline", async () => {
    const laterBoundary = new Date("2088-01-01T10:00:00.000Z");
    const episodeA = await createEpisode({
      startDate: episodeDate,
      timezone: "Pacific/Kiritimati",
      active: false,
      deactivatedAt: laterBoundary,
    });
    const episodeB = await createEpisode({
      startDate: episodeDate,
      timezone: "America/Adak",
      active: true,
    });
    expect(episodeA.id).not.toBe(episodeB.id);
    await createCompleteModelDay(episodeA.id, episodeDate);
    await createCompleteModelDay(episodeB.id, episodeDate);
    await createHealthDay(episodeDate, "America/Adak", true);

    // A prior episode can contain a numeric diagnostic state; a request for B
    // must start from B's own baseline and leave A's row untouched.
    const legacyResult = {
      state: { absoluteSkeletalMuscleKg: null, relativeCumulativeDeltaKg: 0.25 },
    };
    const legacyFingerprint = "a".repeat(64);
    await prisma.experimentalSkeletalMuscleDeltaShadow.create({
      data: {
        profileId,
        modelEpisodeId: episodeA.id,
        date: episodeDate,
        sourceFingerprint: legacyFingerprint,
        modelRevision: "relative-muscle-fixture",
        features: {},
        result: legacyResult,
        isStale: false,
      },
    });
    await prisma.experimentalCessationDetrainingShadow.create({
      data: {
        profileId,
        modelEpisodeId: episodeA.id,
        date: episodeDate,
        sourceFingerprint: legacyFingerprint,
        modelRevision: "relative-muscle-fixture",
        features: {},
        result: {
          state: {
            observedNoExposureStreakDays: 0,
            hadPriorQualifiedTraining: true,
            phase: "not-in-cessation",
            relativeCumulativeDeltaKg: 0.25,
            absoluteSkeletalMuscleKg: null,
          },
        },
        isStale: false,
      },
    });

    await rebuildRelativeMuscleEpisodeTrajectories({
      profileId,
      fromInstant: new Date("2088-01-01T18:00:00.000Z"),
    });

    const rows = await prisma.experimentalSkeletalMuscleDeltaShadow.findMany({
      where: { profileId, date: episodeDate },
      orderBy: { modelEpisodeId: "asc" },
    });
    expect(rows).toHaveLength(2);
    const rowA = rows.find(({ modelEpisodeId }) => modelEpisodeId === episodeA.id)!;
    const rowB = rows.find(({ modelEpisodeId }) => modelEpisodeId === episodeB.id)!;
    expect(rowA.sourceFingerprint).toBe(legacyFingerprint);
    expect((rowA.result as typeof legacyResult).state.relativeCumulativeDeltaKg).toBe(0.25);
    expect((rowB.result as { availability: string; state: { relativeCumulativeDeltaKg: number | null } }).availability)
      .toBe("available");
    expect((rowB.result as { state: { relativeCumulativeDeltaKg: number | null } }).state.relativeCumulativeDeltaKg)
      .toBe(0);
    expect(rowB.isStale).toBe(false);
    expect(rows.map(({ modelEpisodeId }) => modelEpisodeId)).toEqual([episodeA.id, episodeB.id]);

    // A full rebuild distinguishes unknown coverage from verified no exposure.
    await rebuildRelativeMuscleEpisodeTrajectories({ profileId, fromDate: episodeDate });
    const rebuilt = await prisma.experimentalSkeletalMuscleDeltaShadow.findMany({
      where: { profileId, date: episodeDate },
    });
    const rebuiltA = rebuilt.find(({ modelEpisodeId }) => modelEpisodeId === episodeA.id)!;
    const rebuiltB = rebuilt.find(({ modelEpisodeId }) => modelEpisodeId === episodeB.id)!;
    expect((rebuiltA.result as { availability: string; state: { relativeCumulativeDeltaKg: number | null } }).availability)
      .toBe("unavailable");
    expect((rebuiltA.result as { state: { relativeCumulativeDeltaKg: number | null } }).state.relativeCumulativeDeltaKg)
      .toBeNull();
    expect((rebuiltB.result as { estimatedSkeletalMuscleDeltaKg: number | null }).estimatedSkeletalMuscleDeltaKg)
      .toBe(0);
    expect((rebuiltB.result as { state: { relativeCumulativeDeltaKg: number | null } }).state.relativeCumulativeDeltaKg)
      .toBe(0);
  });

  it("assigns an event to episode-local date across UTC midnight on the DST transition date", async () => {
    const episode = await createEpisode({ startDate: timezoneDate, timezone: "Europe/Bratislava", active: true });
    const healthDay = await createHealthDay(timezoneDate, "Europe/Bratislava", true);
    await createHealthDay(timezoneNextDate, "Europe/Bratislava", true);
    await createCompleteModelDay(episode.id, timezoneDate);
    await createCompleteModelDay(episode.id, timezoneNextDate);
    await prisma.workout.create({
      data: {
        dailyHealthDataId: healthDay.id,
        sourceIdentity: "relative-muscle-timezone-boundary-workout",
        type: "Traditional Strength Training",
        startAt: new Date(`${timezoneDate}T23:30:00.000Z`),
        endAt: new Date(`${timezoneNextDate}T00:10:00.000Z`),
        durationMinutes: 40,
      },
    });

    await rebuildRelativeMuscleEpisodeTrajectories({ profileId, fromDate: timezoneDate });

    const rows = await prisma.experimentalSkeletalMuscleDeltaShadow.findMany({
      where: { profileId, modelEpisodeId: episode.id, date: { in: [timezoneDate, timezoneNextDate] } },
      orderBy: { date: "asc" },
    });
    expect(rows.map(({ date }) => date)).toEqual([timezoneDate, timezoneNextDate]);
    const previousLocalDay = rows[0]!.result as { features: { trainingExposureKind: string } };
    const eventLocalDay = rows[1]!.result as { features: { trainingExposureKind: string } };
    expect(previousLocalDay.features.trainingExposureKind).toBe("verified-no-exposure");
    expect(eventLocalDay.features.trainingExposureKind).toBe("unresolved-missing-training");
    const lineage = rows[1]!.features as { lineage?: { episodeTimezone?: string; modelDate?: string } };
    expect(lineage.lineage?.episodeTimezone).toBe("Europe/Bratislava");
    expect(lineage.lineage?.modelDate).toBe(timezoneNextDate);
  });

  it("falls back to full replay when the exact D-1 predecessor result is incompatible", async () => {
    const episode = await createEpisode({ startDate: timezoneDate, timezone: "Europe/Bratislava", active: true });
    for (const date of [timezoneDate, timezoneNextDate, timezoneThirdDate]) {
      await createHealthDay(date, "Europe/Bratislava", true);
      await createCompleteModelDay(episode.id, date);
    }
    await rebuildRelativeMuscleEpisodeTrajectories({ profileId, fromDate: timezoneDate });
    const baseline = await prisma.experimentalSkeletalMuscleDeltaShadow.findMany({
      where: { profileId, modelEpisodeId: episode.id },
      orderBy: { date: "asc" },
    });
    expect(baseline.map(({ date }) => date)).toEqual([timezoneDate, timezoneNextDate, timezoneThirdDate]);

    const predecessor = baseline[1]!;
    const altered = structuredClone(predecessor.result) as {
      state: { relativeCumulativeDeltaKg: number | null };
    };
    altered.state.relativeCumulativeDeltaKg = 123.456;
    await prisma.experimentalSkeletalMuscleDeltaShadow.update({
      where: { profileId_modelEpisodeId_date: { profileId, modelEpisodeId: episode.id, date: timezoneNextDate } },
      data: { result: altered as Prisma.InputJsonValue },
    });

    await rebuildRelativeMuscleEpisodeTrajectories({ profileId, fromDate: timezoneThirdDate });
    const repaired = await prisma.experimentalSkeletalMuscleDeltaShadow.findMany({
      where: { profileId, modelEpisodeId: episode.id },
      orderBy: { date: "asc" },
    });
    expect(repaired.map(({ sourceFingerprint }) => sourceFingerprint))
      .toEqual(baseline.map(({ sourceFingerprint }) => sourceFingerprint));
    expect(repaired.map(({ result }) => result))
      .toEqual(baseline.map(({ result }) => result));
    expect(repaired.every(({ isStale }) => !isStale)).toBe(true);
  });

  it("serializes concurrent rebuilds so a delayed stale candidate cannot overwrite newer source state", async () => {
    const episode = await createEpisode({ startDate: raceDate, timezone: "UTC", active: true });
    await createHealthDay(raceDate, "UTC", true);
    await createCompleteModelDay(episode.id, raceDate);

    const barrierNamespace = 1_886_417_001;
    const functionName = "relative_muscle_rebuild_race_gate";
    const triggerName = "relative_muscle_rebuild_race_gate_trigger";
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION "${functionName}"() RETURNS trigger AS $$
      BEGIN
        IF NEW."profileId" = ${profileId}
          AND NEW."date" = '${raceDate}'
          AND NEW."features"->>'energyBalanceKcal' = '-100' THEN
          PERFORM pg_advisory_xact_lock(${barrierNamespace}, ${profileId});
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER "${triggerName}"
      BEFORE INSERT OR UPDATE ON "ExperimentalSkeletalMuscleDeltaShadow"
      FOR EACH ROW EXECUTE FUNCTION "${functionName}"()
    `);

    let releaseBarrier!: () => void;
    let acquiredBarrier!: () => void;
    const barrierReleased = new Promise<void>((resolve) => { releaseBarrier = resolve; });
    const barrierAcquired = new Promise<void>((resolve) => { acquiredBarrier = resolve; });
    const waitForBlockedLock = async (namespace: number) => {
      for (let attempt = 0; attempt < 150; attempt += 1) {
        const rows = await prisma.$queryRaw<Array<{ count: number }>>`
          SELECT count(*)::int AS count
          FROM pg_locks
          WHERE locktype = 'advisory' AND granted = false
            AND classid = ${namespace}::oid AND objid = ${profileId}::oid AND objsubid = 2
        `;
        if ((rows[0]?.count ?? 0) > 0) return;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error(`Timed out waiting for Relative Muscle advisory lock ${namespace}`);
    };

    const barrierTransaction = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(${barrierNamespace}::integer, ${profileId}::integer)`;
      acquiredBarrier();
      await barrierReleased;
    }, { timeout: 30_000 });
    await barrierAcquired;
    const candidates: Promise<void>[] = [];
    try {
      const staleCandidate = rebuildRelativeMuscleEpisodeTrajectories({ profileId, fromDate: raceDate });
      candidates.push(staleCandidate);
      await waitForBlockedLock(barrierNamespace);
      await prisma.dailyModelState.update({
        where: { episodeId_date: { episodeId: episode.id, date: raceDate } },
        data: { energyBalanceKcal: -500 },
      });
      const freshCandidate = rebuildRelativeMuscleEpisodeTrajectories({ profileId, fromDate: raceDate });
      candidates.push(freshCandidate);
      await waitForBlockedLock(RELATIVE_MUSCLE_REBUILD_LOCK_NAMESPACE);
      releaseBarrier();
      await Promise.all([barrierTransaction, staleCandidate, freshCandidate]);

      const finalRow = await prisma.experimentalSkeletalMuscleDeltaShadow.findUniqueOrThrow({
        where: { profileId_modelEpisodeId_date: { profileId, modelEpisodeId: episode.id, date: raceDate } },
      });
      expect(finalRow.isStale).toBe(false);
      expect((finalRow.features as { energyBalanceKcal?: number }).energyBalanceKcal).toBe(-500);
    } finally {
      releaseBarrier();
      await Promise.allSettled([barrierTransaction, ...candidates]);
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${triggerName}" ON "ExperimentalSkeletalMuscleDeltaShadow"`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${functionName}"()`);
    }
  }, 30_000);
});
