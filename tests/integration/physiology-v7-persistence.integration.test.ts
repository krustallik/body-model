import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createUnavailablePhysiologyRuntimeStateV7 } from "@/model/physiology-v7/daily-runtime-v7";
import {
  PhysiologyV7ConcurrentSourceChangeError,
  PhysiologyV7PersistenceRepository,
} from "@/modules/model-episodes/physiology-v7-persistence.repository";
import { PhysiologyV7PersistedRebuildService } from "@/modules/model-episodes/physiology-v7-persisted-rebuild.service";
import { currentPhysiologyV7Versions } from "@/modules/model-episodes/physiology-v7-persistence";
import { stableSha256 } from "@/modules/model-recovery/recovery-fingerprint";
import { deleteDailyHealthRows } from "../helpers/delete-daily-health";

const prisma = new PrismaClient();
const persistence = new PhysiologyV7PersistenceRepository(prisma);
const service = new PhysiologyV7PersistedRebuildService();
const dates = ["2051-04-01", "2051-04-02", "2051-04-03", "2051-04-04"] as const;
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
  await prisma.physiologyV7DailyResult.deleteMany({ where: { profileId: { in: [1, 991302] } } });
  await prisma.physiologyV7Lifecycle.deleteMany({ where: { profileId: { in: [1, 991302] } } });
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
  beforeEach(async () => {
    await clean();
    await seed();
  });

  afterAll(async () => {
    await clean();
    await prisma.$disconnect();
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
