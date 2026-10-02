import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createUnavailablePhysiologyRuntimeStateV7 } from "@/model/physiology-v7/daily-runtime-v7";
import {
  PhysiologyV7ConcurrentSourceChangeError,
  PhysiologyV7PersistenceRepository,
} from "@/modules/model-episodes/physiology-v7-persistence.repository";
import { PhysiologyV7PersistedRebuildService } from "@/modules/model-episodes/physiology-v7-persisted-rebuild.service";
import { currentPhysiologyV7Versions } from "@/modules/model-episodes/physiology-v7-persistence";
import { stableSha256 } from "@/modules/model-recovery/recovery-fingerprint";
import { isProductionGenerationCurrentV1, isUnifiedGenerationCurrentV1 } from "@/modules/model-episodes/publication-generation-v1";
import { requireIsolatedStage01Database } from "@/modules/training/testing/require-isolated-database";
import { deleteDailyHealthRows } from "../helpers/delete-daily-health";

const prisma = new PrismaClient();
const concurrencyPrisma = new PrismaClient();
let connected = false;
const persistence = new PhysiologyV7PersistenceRepository(prisma);
const service = new PhysiologyV7PersistedRebuildService();
const dates = ["2051-04-01", "2051-04-02", "2051-04-03", "2051-04-04"] as const;
const concurrencyProfileIds = [991310, 991311, 991312, 991313, 991314, 991315] as const;
const laterDate = "2051-04-05";
const lastDate = "2051-04-06";
const request = {
  profileId: 1,
  fromDate: dates[0],
  toDate: dates[3],
  historyFromDate: dates[0],
  timeZone: "Europe/Bratislava",
  initialState: createUnavailablePhysiologyRuntimeStateV7(),
};

async function clean(): Promise<void> {
  await deleteDailyHealthRows(prisma, dates);
  const profileIds = [1, 991302, ...concurrencyProfileIds];
  await prisma.physiologyV7DailyResult.deleteMany({ where: { profileId: { in: profileIds } } });
  await prisma.physiologyV7Lifecycle.deleteMany({ where: { profileId: { in: profileIds } } });
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

async function waitForProfileInvalidationLockWait(): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const rows = await prisma.$queryRaw<Array<{ blocked: boolean }>>`
      SELECT EXISTS (
        SELECT 1
        FROM pg_stat_activity
        WHERE datname = current_database()
          AND pid <> pg_backend_pid()
          AND wait_event_type = 'Lock'
          AND query ILIKE '%pg_advisory_xact_lock(927001%'
      ) AS blocked
    `;
    if (rows[0]?.blocked) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("second invalidation did not reach the PostgreSQL profile-lock wait");
}

async function seedLifecycle(input: {
  profileId: number;
  staleFromDate: string | null;
  currentThroughDate: string | null;
  invalidationGeneration?: number;
}) {
  return prisma.physiologyV7Lifecycle.create({
    data: {
      profileId: input.profileId,
      staleFromDate: input.staleFromDate,
      currentThroughDate: input.currentThroughDate,
      invalidationGeneration: input.invalidationGeneration ?? 10,
      ...currentPhysiologyV7Versions,
    },
  });
}

async function raceInvalidations(input: {
  profileId: number;
  firstDate: string;
  secondDate: string;
}) {
  const firstMutationComplete = deferred();
  const secondTransactionStarted = deferred();
  const releaseFirstTransaction = deferred();
  const firstTransaction = prisma.$transaction(async (tx) => {
    await new PhysiologyV7PersistenceRepository(tx).invalidate(input.profileId, input.firstDate);
    firstMutationComplete.resolve();
    await releaseFirstTransaction.promise;
  }, { maxWait: 10_000, timeout: 30_000 });

  await firstMutationComplete.promise;
  const secondTransaction = concurrencyPrisma.$transaction(async (tx) => {
    secondTransactionStarted.resolve();
    await new PhysiologyV7PersistenceRepository(tx).invalidate(input.profileId, input.secondDate);
  }, { maxWait: 10_000, timeout: 30_000 });

  await secondTransactionStarted.promise;
  try {
    await waitForProfileInvalidationLockWait();
  } catch (error) {
    releaseFirstTransaction.resolve();
    await Promise.allSettled([firstTransaction, secondTransaction]);
    throw error;
  }
  // The second transaction is confirmed waiting in PostgreSQL before the
  // first is allowed to commit. Its later commit must preserve the minimum.
  releaseFirstTransaction.resolve();
  await Promise.all([firstTransaction, secondTransaction]);
}

async function seed(): Promise<void> {
  await prisma.dailyHealthData.createMany({
    data: dates.map((date, index) => ({
      date,
      weightKg: 80 - index * 0.1,
      bodyFatPercent: 20,
      caloriesKcal: 2_300,
      proteinG: 150,
      fatG: 75,
      carbsG: 250,
      steps: 7_000,
      walkingDistanceKm: 5,
      workoutFeedObserved: true,
      rawPayload: {},
    })),
  });
}

describe("persisted physiology v7 rebuild lifecycle with PostgreSQL", () => {
  beforeAll(async () => {
    requireIsolatedStage01Database(process.env.DATABASE_URL, process.env.BODYCAST_STAGE01_MODE, "test");
    await Promise.all([prisma.$connect(), concurrencyPrisma.$connect()]);
    connected = true;
  }, 60_000);

  beforeEach(async () => {
    await clean();
    await seed();
  });

  afterAll(async () => {
    if (!connected) return;
    await clean();
    await prisma.$disconnect();
    await concurrencyPrisma.$disconnect();
  });

  it("persists idempotently, round-trips availability and rebuilds only the stale suffix", async () => {
    const first = await service.rebuild(request);
    expect(first.persistedDayCount).toBe(4);
    expect(await prisma.physiologyV7DailyResult.count({ where: { profileId: 1 } })).toBe(4);
    const firstRows = await persistence.readRange(1, dates[0], dates[3]);
    expect(firstRows.map(({ status }) => status)).toEqual(["current", "current", "current", "current"]);
    expect(firstRows[0]!.result.resultingState.compartments.glycogenKg)
      .toMatchObject({ availability: "unavailable", valueKg: null });
    expect(firstRows[0]!.result.observations.observedWeightKg).toMatchObject({ valueKg: 80 });
    expect(firstRows[0]!.result.massReconstruction).toMatchObject({ availability: "unavailable" });

    const fingerprints = firstRows.map(({ resultFingerprint }) => resultFingerprint);
    const repeat = await service.rebuild(request);
    expect(repeat.days.map(({ scientificFingerprint }) => scientificFingerprint))
      .toEqual(first.days.map(({ scientificFingerprint }) => scientificFingerprint));
    expect(await prisma.physiologyV7DailyResult.count({ where: { profileId: 1 } })).toBe(4);
    expect((await persistence.readRange(1, dates[0], dates[3])).map(({ resultFingerprint }) => resultFingerprint))
      .toEqual(fingerprints);

    await prisma.dailyHealthData.update({ where: { date: dates[1] }, data: { carbsG: 275 } });
    const stale = await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId: 1 } });
    expect(stale.staleFromDate).toBe(dates[1]);
    expect((await persistence.readRange(1, dates[0], dates[3])).map(({ status }) => status))
      .toEqual(["current", "stale", "stale", "stale"]);

    const rebuilt = await service.rebuild(request);
    expect(rebuilt.effectiveFromDate).toBe(dates[1]);
    const after = await persistence.readRange(1, dates[0], dates[3]);
    expect(after[0]!.resultFingerprint).toBe(fingerprints[0]);
    expect(after[1]!.resultFingerprint).not.toBe(fingerprints[1]);
    expect(after[2]!.result.priorStateFingerprint)
      .toBe(stableSha256(after[1]!.result.resultingState));
    expect(after.every(({ status }) => status === "current")).toBe(true);
  });

  it("merges invalidations atomically and transaction rollback cannot lose freshness state", async () => {
    await service.rebuild(request);
    await Promise.all([
      prisma.dailyHealthData.update({ where: { date: dates[3] }, data: { carbsG: 260 } }),
      prisma.dailyHealthData.update({ where: { date: dates[1] }, data: { proteinG: 151 } }),
      prisma.dailyHealthData.update({ where: { date: dates[2] }, data: { weightKg: 79 } }),
    ]);
    const lifecycle = await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId: 1 } });
    expect(lifecycle.staleFromDate).toBe(dates[1]);
    const generation = lifecycle.invalidationGeneration;
    await expect(prisma.$transaction(async (tx) => {
      await tx.dailyHealthData.update({ where: { date: dates[0] }, data: { carbsG: 999 } });
      throw new Error("rollback");
    })).rejects.toThrow("rollback");
    expect((await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId: 1 } }))
      .invalidationGeneration).toBe(generation);
    expect((await prisma.dailyHealthData.findUniqueOrThrow({ where: { date: dates[0] } })).carbsG)
      .toBe(250);
  });

  it("preserves the earliest dirty date across real concurrent invalidations and rollback", async () => {
    const [laterCommitProfile, earlierCommitProfile, preserveEarlierProfile, replaceLaterProfile, rollbackProfile] = concurrencyProfileIds;
    const base = {
      staleFromDate: null,
      currentThroughDate: "2051-04-10",
      invalidationGeneration: 10,
    };

    await seedLifecycle({ profileId: laterCommitProfile, ...base });
    await raceInvalidations({
      profileId: laterCommitProfile,
      firstDate: dates[1],
      secondDate: laterDate,
    });
    expect(await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId: laterCommitProfile } }))
      .toMatchObject({
        staleFromDate: dates[1],
        currentThroughDate: dates[0],
        invalidationGeneration: 12,
      });

    await seedLifecycle({ profileId: earlierCommitProfile, ...base });
    await raceInvalidations({
      profileId: earlierCommitProfile,
      firstDate: laterDate,
      secondDate: dates[1],
    });
    expect(await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId: earlierCommitProfile } }))
      .toMatchObject({
        staleFromDate: dates[1],
        currentThroughDate: dates[0],
        invalidationGeneration: 12,
      });

    await seedLifecycle({
      profileId: preserveEarlierProfile,
      staleFromDate: dates[0],
      currentThroughDate: "2051-03-31",
    });
    await Promise.all([
      persistence.invalidate(preserveEarlierProfile, laterDate),
      persistence.invalidate(preserveEarlierProfile, lastDate),
    ]);
    expect(await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId: preserveEarlierProfile } }))
      .toMatchObject({ staleFromDate: dates[0], currentThroughDate: "2051-03-31", invalidationGeneration: 12 });

    await seedLifecycle({
      profileId: replaceLaterProfile,
      staleFromDate: laterDate,
      currentThroughDate: dates[3],
    });
    await persistence.invalidate(replaceLaterProfile, dates[1]);
    expect(await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId: replaceLaterProfile } }))
      .toMatchObject({ staleFromDate: dates[1], currentThroughDate: dates[0], invalidationGeneration: 11 });

    await seedLifecycle({ profileId: rollbackProfile, ...base });
    await expect(prisma.$transaction(async (tx) => {
      await new PhysiologyV7PersistenceRepository(tx).invalidate(rollbackProfile, dates[0]);
      throw new Error("abort invalidation");
    })).rejects.toThrow("abort invalidation");
    expect(await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId: rollbackProfile } }))
      .toMatchObject({ staleFromDate: null, currentThroughDate: "2051-04-10", invalidationGeneration: 10 });
    await persistence.invalidate(rollbackProfile, laterDate);
    expect(await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId: rollbackProfile } }))
      .toMatchObject({ staleFromDate: laterDate, currentThroughDate: dates[3], invalidationGeneration: 11 });
  }, 30_000);

  it("publishes production only for the captured generation and leaves Unified stale until rebuilt", async () => {
    const profileId = concurrencyProfileIds[5];
    await seedLifecycle({
      profileId,
      staleFromDate: null,
      currentThroughDate: lastDate,
      invalidationGeneration: 10,
    });
    await prisma.physiologyV7Lifecycle.update({
      where: { profileId },
      data: { productionPublishedGeneration: 10, unifiedPublishedGeneration: 10 },
    });
    const current = await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId } });
    expect(isUnifiedGenerationCurrentV1(current)).toBe(true);

    await persistence.invalidate(profileId, dates[1]);
    const invalidated = await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId } });
    expect(invalidated).toMatchObject({
      invalidationGeneration: 11,
      productionStaleFromDate: dates[1],
      productionPublishedGeneration: 10,
      unifiedPublishedGeneration: 10,
    });
    expect(isProductionGenerationCurrentV1(invalidated)).toBe(false);
    expect(isUnifiedGenerationCurrentV1(invalidated)).toBe(false);

    await expect(persistence.publishProduction({ profileId, expectedGeneration: 10 }))
      .rejects.toBeInstanceOf(PhysiologyV7ConcurrentSourceChangeError);
    const stalePublication = await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId } });
    expect(stalePublication).toMatchObject({
      invalidationGeneration: 11,
      productionStaleFromDate: dates[1],
      productionPublishedGeneration: 10,
      unifiedPublishedGeneration: 10,
    });

    await persistence.publishProduction({ profileId, expectedGeneration: 11 });
    const productionOnly = await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId } });
    expect(productionOnly).toMatchObject({
      invalidationGeneration: 11,
      productionStaleFromDate: null,
      productionPublishedGeneration: 11,
      unifiedPublishedGeneration: 10,
    });
    expect(isProductionGenerationCurrentV1(productionOnly)).toBe(true);
    expect(isUnifiedGenerationCurrentV1(productionOnly)).toBe(false);
  });

  it("invalidates from the earlier authoritative day when a workout is reattached", async () => {
    await service.rebuild(request);
    const dayThree = await prisma.dailyHealthData.findUniqueOrThrow({ where: { date: dates[2] } });
    const workout = await prisma.workout.create({
      data: {
        dailyHealthDataId: dayThree.id,
        externalId: "v7-persistence-move",
        sourceIdentity: "v7-persistence-move-source",
        type: "Traditional Strength Training",
        startAt: new Date("2051-04-03T17:00:00.000Z"),
        endAt: new Date("2051-04-03T18:00:00.000Z"),
        durationMinutes: 60,
      },
    });
    expect((await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId: 1 } })).staleFromDate)
      .toBe(dates[2]);
    await service.rebuild(request);
    const dayTwo = await prisma.dailyHealthData.findUniqueOrThrow({ where: { date: dates[1] } });
    await prisma.workout.update({ where: { id: workout.id }, data: { dailyHealthDataId: dayTwo.id } });
    expect((await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId: 1 } })).staleFromDate)
      .toBe(dates[1]);
  });

  it("lets a source mutation win a rebuild race and keeps crash/retry stale", async () => {
    await service.rebuild(request);
    await prisma.dailyHealthData.update({ where: { date: dates[1] }, data: { carbsG: 270 } });
    await expect(service.rebuild({
      ...request,
      beforePromotion: async () => {
        await prisma.dailyHealthData.update({ where: { date: dates[2] }, data: { proteinG: 155 } });
      },
    })).rejects.toBeInstanceOf(PhysiologyV7ConcurrentSourceChangeError);
    expect((await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId: 1 } })).staleFromDate)
      .toBe(dates[1]);

    await expect(service.rebuild({
      ...request,
      beforePromotion: async () => { throw new Error("simulated-crash"); },
    })).rejects.toThrow("simulated-crash");
    expect((await persistence.readDay(1, dates[1])).status).toBe("stale");
    await service.rebuild(request);
    expect((await persistence.readDay(1, dates[1])).status).toBe("current");
  });

  it("serializes same-profile promotion while keeping profiles independent", async () => {
    await Promise.all([service.rebuild(request), service.rebuild(request)]);
    expect(await prisma.physiologyV7DailyResult.count({ where: { profileId: 1 } })).toBe(4);

    await persistence.invalidate(991302, dates[0]);
    await service.rebuild({ ...request, profileId: 991302 });
    expect(await prisma.physiologyV7DailyResult.count({ where: { profileId: 991302 } })).toBe(4);
    expect((await persistence.readDay(1, dates[0])).status).toBe("current");
    expect((await persistence.readDay(991302, dates[0])).status).toBe("current");
  });

  it("keeps version mismatch stale, deletion missing, and presentation rename non-scientific", async () => {
    await service.rebuild(request);
    await prisma.physiologyV7Lifecycle.update({
      where: { profileId: 1 }, data: { dailyRuntimeVersion: "obsolete" },
    });
    expect((await persistence.readDay(1, dates[0])).status).toBe("stale");
    await service.rebuild(request);
    expect((await persistence.readDay(1, dates[0])).status).toBe("current");
    expect(await prisma.physiologyV7Lifecycle.findUnique({ where: { profileId: 1 } }))
      .toMatchObject(currentPhysiologyV7Versions);

    const catalog = await prisma.exerciseCatalog.create({ data: { profileId: 1, name: "cosmetic" } });
    const generation = (await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId: 1 } }))
      .invalidationGeneration;
    await prisma.exerciseCatalog.update({ where: { id: catalog.id }, data: { name: "cosmetic renamed" } });
    expect((await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId: 1 } }))
      .invalidationGeneration).toBe(generation);
    await prisma.exerciseCatalog.delete({ where: { id: catalog.id } });

    await prisma.dailyHealthData.delete({ where: { date: dates[2] } });
    expect((await prisma.physiologyV7Lifecycle.findUniqueOrThrow({ where: { profileId: 1 } })).staleFromDate)
      .toBe(dates[2]);
    await service.rebuild(request);
    const deletedDay = (await persistence.readDay(1, dates[2])).result;
    expect(deletedDay?.observations.observedWeightKg).toMatchObject({ availability: "unavailable" });
    expect(deletedDay?.energyNutrition.evidence.provenance.source).toBe("missing");
    expect(deletedDay?.energyNutrition.evidence.provenance.observedFields).not.toContain("carbsG");
  });
});
