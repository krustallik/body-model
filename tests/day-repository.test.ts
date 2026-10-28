import { Prisma, type PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { DuplicateDayError } from "@/modules/days/day.errors";
import { DailyMetricRepository, replayProductionDailyMetricShadowsV1 } from "@/modules/days/day.repository";
import { PhysiologyV7PersistenceRepository } from "@/modules/model-episodes/physiology-v7-persistence.repository";
import * as activeEnergyInvalidation from "@/modules/activity/active-energy-invalidation";
import * as activeEnergyPublication from "@/modules/activity/active-energy-publication";
import * as glycogenStateShadow from "@/modules/model-episodes/experimental-glycogen-state-shadow.service";
import * as relativeMuscleShadow from "@/modules/model-episodes/experimental-cessation-detraining-shadow.service";
import * as stepperActiveEnergyShadow from "@/modules/profile/experimental-stepper-active-energy-shadow.service";
import * as stepperGlycogenShadow from "@/modules/profile/experimental-stepper-glycogen-demand-shadow.service";
import * as strengthTraining from "@/modules/training/training.service";

vi.mock("@/modules/activity/active-energy-invalidation", () => ({
  invalidateWorkoutEnergyInTransactionV1: vi.fn().mockResolvedValue(null),
  invalidateStepperMassDependenciesInTransactionV1: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/modules/activity/active-energy-publication", () => ({ publishActiveEnergyChangesV1: vi.fn() }));
vi.mock("@/modules/model-episodes/experimental-glycogen-state-shadow.service", () => ({ recordExperimentalGlycogenStateShadow: vi.fn() }));
vi.mock("@/modules/model-episodes/experimental-cessation-detraining-shadow.service", () => ({ rebuildAuthoritativeRelativeMuscleTrajectory: vi.fn() }));
vi.mock("@/modules/profile/experimental-stepper-active-energy-shadow.service", () => ({ recordExperimentalStepperActiveEnergyShadowsForMassWindow: vi.fn() }));
vi.mock("@/modules/profile/experimental-stepper-glycogen-demand-shadow.service", () => ({ recordExperimentalStepperGlycogenDemandShadowsForLocalDate: vi.fn() }));
vi.mock("@/modules/training/training.service", () => ({ recordExperimentalStrengthShadowsForWeightDate: vi.fn() }));

const record = {
  date: "2026-08-22",
  weightKg: 89.4,
  bodyFatPercent: new Prisma.Decimal("27.4"),
  caloriesKcal: null,
  proteinG: 59,
  fatG: 15,
  carbsG: 56,
  steps: 23,
  activeEnergyKcal: null,
  averageWalkingSpeedKmh: new Prisma.Decimal("4.572"),
  walkingDistanceKm: new Prisma.Decimal("0.0125"),
  strengthTrainingMinutes: new Prisma.Decimal("75"),
  workouts: [],
  updatedAt: new Date("2026-08-22T10:00:00Z"),
};

function fixture() {
  const dailyHealthData = {
    findMany: vi.fn().mockResolvedValue([record]),
    findFirst: vi.fn().mockResolvedValue({ updatedAt: record.updatedAt }),
    findUnique: vi.fn().mockResolvedValue({ ...record, id: 42 }),
    findUniqueOrThrow: vi.fn().mockResolvedValue({ ...record, id: 42 }),
    create: vi.fn().mockResolvedValue(record),
    update: vi.fn().mockResolvedValue(record),
    delete: vi.fn().mockResolvedValue(record),
    deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
  };
  const workout = {
    findMany: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({ id: 100 }),
    update: vi.fn().mockResolvedValue({ id: 100 }),
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
  };
  const strengthDiarySession = {
    findMany: vi.fn().mockResolvedValue([]),
  };
  const healthMetricSample = {
    count: vi.fn().mockResolvedValue(0),
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
  };
  const healthSyncSnapshot = { updateMany: vi.fn().mockResolvedValue({ count: 0 }) };
  const heartRateSample = {
    findMany: vi.fn().mockResolvedValue([]),
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
  };
  const restingHeartRateSample = {
    findMany: vi.fn().mockResolvedValue([]),
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
  };
  const activeEnergyEventAlias = { findMany: vi.fn().mockResolvedValue([]) };
  const physiologyV7Lifecycle = {
    findUnique: vi.fn().mockResolvedValue({ profileId: 1 }),
    upsert: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  };
  const unifiedPublicationBlock = {
    findUnique: vi.fn().mockResolvedValue(null),
    findMany: vi.fn().mockResolvedValue([]),
    upsert: vi.fn().mockResolvedValue({}),
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
  };
  const client = {
    dailyHealthData,
    workout,
    strengthDiarySession,
    healthMetricSample,
    healthSyncSnapshot,
    heartRateSample,
    restingHeartRateSample,
    activeEnergyEventAlias,
    physiologyV7Lifecycle,
    unifiedPublicationBlock,
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback({
      dailyHealthData,
      workout,
      healthMetricSample,
      healthSyncSnapshot,
      heartRateSample,
      restingHeartRateSample,
      activeEnergyEventAlias,
      physiologyV7Lifecycle,
      unifiedPublicationBlock,
      $queryRaw: vi.fn().mockResolvedValue([]),
      $executeRaw: vi.fn().mockResolvedValue(0),
    })),
  } as unknown as PrismaClient;
  const shadowReplayer = { replayFrom: vi.fn().mockResolvedValue("current") };
  return {
    repository: new DailyMetricRepository(1, client, shadowReplayer),
    dailyHealthData,
    workout,
    healthMetricSample,
    strengthDiarySession,
    healthSyncSnapshot,
    heartRateSample,
    restingHeartRateSample,
    client,
    unifiedPublicationBlock,
    shadowReplayer,
  };
}

describe("DailyMetricRepository", () => {
  it("repairs all daily publication dependencies before publishing Active Energy and Unified", async () => {
    const order: string[] = [];
    vi.mocked(stepperActiveEnergyShadow.recordExperimentalStepperActiveEnergyShadowsForMassWindow)
      .mockImplementation(async () => { order.push("stepper-energy"); return []; });
    vi.mocked(strengthTraining.recordExperimentalStrengthShadowsForWeightDate)
      .mockImplementation(async () => { order.push("strength-energy-and-glycogen-demand"); return []; });
    vi.mocked(stepperGlycogenShadow.recordExperimentalStepperGlycogenDemandShadowsForLocalDate)
      .mockImplementation(async () => { order.push("stepper-glycogen-demand"); });
    vi.mocked(glycogenStateShadow.recordExperimentalGlycogenStateShadow)
      .mockImplementation(async () => { order.push("glycogen-state"); });
    vi.mocked(relativeMuscleShadow.rebuildAuthoritativeRelativeMuscleTrajectory)
      .mockImplementation(async () => { order.push("relative-muscle"); });
    vi.mocked(activeEnergyPublication.publishActiveEnergyChangesV1)
      .mockImplementation(async () => { order.push("publish"); return true; });

    const lifecycle = {
      readUnifiedPublicationBlockToken: vi.fn().mockResolvedValue({ revision: 2, fromDate: "2026-08-22" }),
      hasUnifiedPublicationBlocks: vi.fn().mockResolvedValue(false),
      blockUnifiedPublication: vi.fn(),
      clearUnifiedPublicationBlock: vi.fn().mockResolvedValue(true),
    } as unknown as InstanceType<typeof PhysiologyV7PersistenceRepository>;
    await expect(replayProductionDailyMetricShadowsV1(1, "2026-08-22", lifecycle, {
      weightSourceChanged: true, affectedWorkoutIds: [420],
    })).resolves.toBe("current");

    expect(order).toEqual([
      "stepper-energy",
      "strength-energy-and-glycogen-demand",
      "stepper-glycogen-demand",
      "glycogen-state",
      "relative-muscle",
      "publish",
    ]);
    expect(activeEnergyPublication.publishActiveEnergyChangesV1).toHaveBeenCalledWith({
      profileId: 1,
      activeEnergyCandidateScope: { strengthSessionIds: [], workoutIds: [420] },
    });
    expect(lifecycle.clearUnifiedPublicationBlock).toHaveBeenCalledWith({
      profileId: 1, source: "day", sourceKey: "2026-08-22", expectedRevision: 2,
      expectedFromDate: "2026-08-22",
    });
  });

  it("skips mass-dependent candidate refresh when a day edit did not change weight", async () => {
    vi.mocked(stepperActiveEnergyShadow.recordExperimentalStepperActiveEnergyShadowsForMassWindow).mockClear();
    vi.mocked(strengthTraining.recordExperimentalStrengthShadowsForWeightDate).mockClear();
    vi.mocked(activeEnergyPublication.publishActiveEnergyChangesV1).mockResolvedValue(true);
    const lifecycle = {
      readUnifiedPublicationBlockToken: vi.fn().mockResolvedValue({ revision: 3, fromDate: "2026-08-22" }),
      clearUnifiedPublicationBlock: vi.fn().mockResolvedValue(true),
      hasUnifiedPublicationBlocks: vi.fn().mockResolvedValue(false),
      blockUnifiedPublication: vi.fn().mockResolvedValue(undefined),
    } as unknown as InstanceType<typeof PhysiologyV7PersistenceRepository>;

    await expect(replayProductionDailyMetricShadowsV1(1, "2026-08-22", lifecycle, { affectedWorkoutIds: [] })).resolves.toBe("current");

    expect(stepperActiveEnergyShadow.recordExperimentalStepperActiveEnergyShadowsForMassWindow).not.toHaveBeenCalled();
    expect(strengthTraining.recordExperimentalStrengthShadowsForWeightDate).not.toHaveBeenCalled();
    expect(activeEnergyPublication.publishActiveEnergyChangesV1).toHaveBeenCalledWith({
      profileId: 1,
      activeEnergyCandidateScope: { strengthSessionIds: [], workoutIds: [] },
    });
  });

  it("refreshes weight dependencies and uses full candidate fallback for an unknown pending fence", async () => {
    vi.mocked(stepperActiveEnergyShadow.recordExperimentalStepperActiveEnergyShadowsForMassWindow)
      .mockClear().mockResolvedValue([420]);
    vi.mocked(strengthTraining.recordExperimentalStrengthShadowsForWeightDate)
      .mockClear().mockResolvedValue([430]);
    vi.mocked(activeEnergyPublication.publishActiveEnergyChangesV1).mockClear().mockResolvedValue(true);
    const lifecycle = {
      readUnifiedPublicationBlockToken: vi.fn().mockResolvedValue({ revision: 5, fromDate: "2026-08-21" }),
      clearUnifiedPublicationBlock: vi.fn().mockResolvedValue(true),
      hasUnifiedPublicationBlocks: vi.fn().mockResolvedValue(false),
      blockUnifiedPublication: vi.fn().mockResolvedValue(undefined),
    } as unknown as InstanceType<typeof PhysiologyV7PersistenceRepository>;

    await expect(replayProductionDailyMetricShadowsV1(1, "2026-08-22", lifecycle, {
      weightSourceChanged: true,
    })).resolves.toBe("current");

    expect(stepperActiveEnergyShadow.recordExperimentalStepperActiveEnergyShadowsForMassWindow)
      .toHaveBeenCalledWith({ profileId: 1, measurementDates: ["2026-08-22"] });
    expect(strengthTraining.recordExperimentalStrengthShadowsForWeightDate)
      .toHaveBeenCalledWith({ profileId: 1, date: "2026-08-22", refreshHistoricalAsOfFallback: true });
    expect(activeEnergyPublication.publishActiveEnergyChangesV1).toHaveBeenCalledWith({ profileId: 1 });
  });

  it("restores the day retry fence when publication fails and shared block state becomes unreadable", async () => {
    vi.mocked(activeEnergyPublication.publishActiveEnergyChangesV1)
      .mockRejectedValueOnce(new Error("publication failed"));
    const lifecycle = {
      readUnifiedPublicationBlockToken: vi.fn().mockResolvedValue({ revision: 4, fromDate: "2026-08-21" }),
      clearUnifiedPublicationBlock: vi.fn().mockResolvedValue(true),
      hasUnifiedPublicationBlocks: vi.fn().mockResolvedValueOnce(false).mockRejectedValueOnce(new Error("block read failed")),
      blockUnifiedPublication: vi.fn().mockResolvedValue(undefined),
    } as unknown as InstanceType<typeof PhysiologyV7PersistenceRepository>;

    await expect(replayProductionDailyMetricShadowsV1(1, "2026-08-22", lifecycle)).rejects.toThrow("publication failed");

    expect(lifecycle.blockUnifiedPublication).toHaveBeenCalledWith({
      profileId: 1, fromDate: "2026-08-21", source: "day", sourceKey: "2026-08-22",
    });
  });

  it("restores the day retry fence when publication returns stale and the final block read fails", async () => {
    vi.mocked(activeEnergyPublication.publishActiveEnergyChangesV1).mockResolvedValueOnce(false);
    const lifecycle = {
      readUnifiedPublicationBlockToken: vi.fn().mockResolvedValue({ revision: 4, fromDate: "2026-08-21" }),
      clearUnifiedPublicationBlock: vi.fn().mockResolvedValue(true),
      hasUnifiedPublicationBlocks: vi.fn().mockResolvedValueOnce(false).mockRejectedValueOnce(new Error("block read failed")),
      blockUnifiedPublication: vi.fn().mockResolvedValue(undefined),
    } as unknown as InstanceType<typeof PhysiologyV7PersistenceRepository>;

    await expect(replayProductionDailyMetricShadowsV1(1, "2026-08-22", lifecycle)).rejects.toThrow("block read failed");

    expect(lifecycle.blockUnifiedPublication).toHaveBeenCalledWith({
      profileId: 1, fromDate: "2026-08-21", source: "day", sourceKey: "2026-08-22",
    });
  });

  it("lists newest records with filters and serializes Prisma decimals", async () => {
    const { repository, dailyHealthData } = fixture();
    const days = await repository.list({ from: "2026-08-01", to: "2026-08-22", limit: 30, offset: 0, includeTrainingDays: true });

    expect(dailyHealthData.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { profileId: 1, date: { gte: "2026-08-01", lte: "2026-08-22" } },
      orderBy: { date: "desc" },
      take: 30,
      skip: 0,
    }));
    expect(days[0]).toMatchObject({
      bodyFatPercent: 27.4,
      strengthTrainingMinutes: 75,
      totalWorkoutMinutes: 0,
      workoutSource: "none",
      trainingDayFact: { eventCount: 0, durationMinutes: 0 },
      workouts: [],
    });
    expect(dailyHealthData.findMany).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({
        workouts: expect.objectContaining({
          orderBy: { startAt: "asc" },
        }),
      }),
    }));
  });

  it("uses the persisted canonical resolution for an unmatched diary session", async () => {
    const { repository, client } = fixture();
    const sets = [{ id: 91, reps: 8, weightKg: 60, bandNominalResistanceKg: null, rir: 2 }];
    const { strengthInputFingerprintV1, strengthSetFingerprintV1 } = await import(
      "@/modules/training/strength-publication-v1"
    );
    const inputFingerprint = strengthInputFingerprintV1({
      sessionId: 4,
      sessionRevision: 3,
      massKg: 89.4,
      sameDayMassKg: 89.4,
      startOfDayMassKg: null,
      setFingerprint: strengthSetFingerprintV1(sets),
    });
    const strengthDiarySession = {
      findMany: vi.fn().mockResolvedValue([{
        id: 4,
        status: "COMPLETED",
        entryMode: "LIVE",
        revision: 3,
        webStartedAt: new Date("2026-08-22T08:44:00.000Z"),
        webEndedAt: new Date("2026-08-22T09:46:00.000Z"),
        program: { name: "Push A" },
        exercises: [{ sets }],
        experimentalStrengthEnergyShadow: {
          modelRevision: "experimental-strength-active-energy-v1",
          result: {
            activeEnergyResolution: {
              estimatedActiveKcal: 311,
              source: "bodycast-diary-estimate",
            },
            sessionRevision: 3,
            inputFingerprint,
          },
        },
      }]),
    };
    Object.assign(client as object, {
      strengthDiarySession,
      activeEnergyEventAlias: {
        findMany: vi.fn().mockResolvedValue([{
          sourceType: "strength-session",
          sourceId: "4",
          event: {
            currentKcal: 311,
            currentSource: "bodycast-strength-estimate",
            resolutionRevision: 2,
            isStale: false,
          },
        }]),
      },
    });

    const [day] = await repository.list({ from: "2026-08-22", to: "2026-08-22", limit: 30, offset: 0, includeTrainingDays: true });

    expect(strengthDiarySession.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ entryMode: "LIVE", matchedWorkoutId: null }),
    }));
    expect(day?.workouts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: undefined,
        type: "Traditional Strength Training",
        startAt: "2026-08-22T08:44:00.000Z",
        endAt: "2026-08-22T09:46:00.000Z",
        durationMinutes: 62,
        activeEnergyKcal: 311,
        energySource: "bodycast-strength-estimate",
        diaryOnly: true,
        linkedTrainingSessionId: 4,
        linkedTrainingProgramName: "Push A",
      }),
    ]));
    expect(day?.totalWorkoutMinutes).toBe(62);
  });

  it("returns a Workout event independently of a DailyHealthData row", async () => {
    const { repository, dailyHealthData, workout } = fixture();
    dailyHealthData.findMany.mockResolvedValue([]);
    workout.findMany.mockResolvedValue([{
      id: 77,
      sourceIdentity: "ext:garmin-77",
      type: "Traditional Strength Training",
      startAt: new Date("2026-08-22T22:30:00.000Z"),
      endAt: new Date("2026-08-22T23:30:00.000Z"),
      durationMinutes: 60,
      activeEnergyKcal: null,
      hiddenFromHistory: false,
      matchedDiarySession: null,
    }]);

    const result = await repository.listWithTrainingFacts({
      from: "2026-08-23",
      to: "2026-08-23",
      limit: 30,
      offset: 0,
      includeTrainingDays: true,
    });

    expect(result.days).toEqual([]);
    expect(result.trainingDays).toMatchObject([{
      date: "2026-08-23",
      eventCount: 1,
      durationMinutes: 60,
      events: [{ workoutId: 77, exerciseDetailAvailability: "unavailable", loggedSetCount: null }],
    }]);
  });

  it("returns explicit zero facts for every requested calendar date", async () => {
    const { repository, dailyHealthData } = fixture();
    dailyHealthData.findMany.mockResolvedValue([]);

    const result = await repository.listWithTrainingFacts({
      from: "2026-08-22",
      to: "2026-08-24",
      limit: 30,
      offset: 0,
      includeTrainingDays: true,
    });

    expect(result.trainingDays.map((fact) => [fact.date, fact.eventCount, fact.durationMinutes])).toEqual([
      ["2026-08-24", 0, 0],
      ["2026-08-23", 0, 0],
      ["2026-08-22", 0, 0],
    ]);
  });

  it("materializes the maximum supported range with one fact query, not one query per date", async () => {
    const { repository, dailyHealthData, workout, strengthDiarySession } = fixture();
    dailyHealthData.findMany.mockResolvedValue([]);

    const result = await repository.listWithTrainingFacts({
      from: "2024-01-01",
      to: "2024-12-31",
      limit: 100,
      offset: 0,
      includeTrainingDays: true,
    });

    expect(result.trainingDays).toHaveLength(366);
    expect(result.trainingDays[0]).toMatchObject({ date: "2024-12-31", eventCount: 0, durationMinutes: 0 });
    expect(result.trainingDays.at(-1)).toMatchObject({ date: "2024-01-01", eventCount: 0, durationMinutes: 0 });
    expect(workout.findMany).toHaveBeenCalledTimes(1);
    expect(strengthDiarySession.findMany).toHaveBeenCalledTimes(1);
  });

  it("keeps long Health-only pages bounded and rejects oversized direct zero-fact materialization", async () => {
    const { repository, dailyHealthData, workout, strengthDiarySession } = fixture();
    dailyHealthData.findMany.mockResolvedValue([record]);

    const healthOnly = await repository.listWithTrainingFacts({
      from: "0100-01-01",
      to: "9999-12-31",
      limit: 100,
      offset: 0,
      includeTrainingDays: false,
    });
    expect(healthOnly.days).toHaveLength(1);
    expect(healthOnly.days[0]?.weightKg).toBe(89.4);
    expect(healthOnly.trainingDays).toEqual([]);
    expect(workout.findMany).toHaveBeenCalledTimes(1);
    expect(strengthDiarySession.findMany).toHaveBeenCalledTimes(1);

    await expect(repository.trainingDayFactsForRange("2025-01-01", "2026-01-02"))
      .rejects.toThrow(/must not exceed 366 calendar days/);
    expect(workout.findMany).toHaveBeenCalledTimes(1);
  });

  it("limits later paginated fact reads to page dates and skips empty terminal pages", async () => {
    const { repository, dailyHealthData, workout } = fixture();
    const page = await repository.listWithTrainingFacts({
      from: "2026-08-01",
      to: "2026-08-31",
      limit: 30,
      offset: 30,
      includeTrainingDays: false,
    });

    expect(workout.findMany).toHaveBeenCalledTimes(1);
    expect(workout.findMany.mock.calls[0]?.[0]).toMatchObject({
      where: { startAt: { gte: new Date("2026-08-20T00:00:00.000Z"), lt: new Date("2026-08-25T00:00:00.000Z") } },
    });
    expect(page.trainingDays).toEqual([]);

    dailyHealthData.findMany.mockResolvedValue([]);
    await repository.listWithTrainingFacts({
      to: "2026-08-31",
      limit: 30,
      offset: 100,
      includeTrainingDays: false,
    });
    expect(workout.findMany).toHaveBeenCalledTimes(1);
  });

  it("marks manually created rows without inventing metric values", async () => {
    const { repository, dailyHealthData, unifiedPublicationBlock } = fixture();
    await repository.create({ date: record.date, caloriesKcal: null, steps: 0 });
    expect(dailyHealthData.create).toHaveBeenCalledWith(expect.objectContaining({
      data: { profileId: 1, date: record.date, caloriesKcal: null, steps: 0, rawPayload: { source: "manual" } },
    }));
    expect(unifiedPublicationBlock.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { profileId_source_sourceKey: { profileId: 1, source: "day", sourceKey: record.date } },
    }));
  });

  it("reads the latest update timestamp without mutating records", async () => {
    const { repository, dailyHealthData } = fixture();
    await expect(repository.latestUpdatedAt()).resolves.toBe("2026-08-22T10:00:00.000Z");
    expect(dailyHealthData.findFirst).toHaveBeenCalledWith({
      where: { profileId: 1 },
      orderBy: { updatedAt: "desc" },
      select: { updatedAt: true },
    });
    expect(dailyHealthData.update).not.toHaveBeenCalled();
  });

  it("maps a unique-date violation to DuplicateDayError", async () => {
    const { repository, dailyHealthData } = fixture();
    dailyHealthData.create.mockRejectedValue({ code: "P2002" });
    await expect(repository.create({ date: record.date })).rejects.toBeInstanceOf(DuplicateDayError);
  });

  it("updates only supplied metrics and preserves rawPayload", async () => {
    const { repository, dailyHealthData, shadowReplayer } = fixture();
    await repository.update(record.date, { weightKg: 88.5, proteinG: null });
    expect(dailyHealthData.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { profileId_id: { profileId: 1, id: 42 } },
      data: { weightKg: 88.5, proteinG: null },
    }));
    expect(dailyHealthData.update.mock.calls[0]?.[0].data).not.toHaveProperty("rawPayload");
    expect(shadowReplayer.replayFrom).toHaveBeenCalledWith(1, record.date, {
      weightSourceChanged: false, affectedWorkoutIds: [],
    });
  });

  it("skips metric writes and publication when submitted Decimal values are unchanged", async () => {
    const { repository, dailyHealthData, unifiedPublicationBlock, shadowReplayer } = fixture();
    dailyHealthData.findUniqueOrThrow.mockResolvedValueOnce({
      ...record,
      id: 42,
      weightKg: new Prisma.Decimal("89.4"),
      bodyFatPercent: new Prisma.Decimal("27.4"),
      averageWalkingSpeedKmh: new Prisma.Decimal("4.57"),
      walkingDistanceKm: new Prisma.Decimal("0.01"),
      strengthTrainingMinutes: new Prisma.Decimal("75"),
    } as never);

    await repository.update(record.date, {
      weightKg: 89.4,
      bodyFatPercent: 27.4,
      averageWalkingSpeedKmh: 4.57,
      walkingDistanceKm: 0.01,
      strengthTrainingMinutes: 75,
    });

    expect(dailyHealthData.update).not.toHaveBeenCalled();
    expect(unifiedPublicationBlock.upsert).not.toHaveBeenCalled();
    expect(shadowReplayer.replayFrom).not.toHaveBeenCalled();
  });

  it("reports a committed source write as stale when dependent publication fails", async () => {
    const { repository, dailyHealthData, shadowReplayer } = fixture();
    shadowReplayer.replayFrom.mockRejectedValueOnce(new Error("shadow replay failed"));

    const updated = await repository.update(record.date, { weightKg: 88.5 });

    expect(dailyHealthData.update).toHaveBeenCalled();
    expect(updated).toMatchObject({ date: record.date, modelPublicationStatus: "stale" });
  });

  it("replaces explicit workouts while clearing legacy daily workout aggregates", async () => {
    const { repository, dailyHealthData, workout, shadowReplayer } = fixture();
    await repository.update(record.date, {
      workouts: [{
        type: "Strength training",
        startAt: "2026-08-22T10:00:00.000Z",
        durationMinutes: 45,
        activeEnergyKcal: 280,
      }],
    });
    expect(dailyHealthData.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ strengthTrainingMinutes: null, activeEnergyKcal: null }),
    }));
    expect(dailyHealthData.update.mock.calls[0]?.[0]).not.toMatchObject({
      data: expect.objectContaining({ workouts: expect.anything() }),
    });
    expect(workout.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        dailyHealthDataId: 42,
        type: "Strength training",
        durationMinutes: 45,
        activeEnergyKcal: 280,
        startAt: new Date("2026-08-22T10:00:00.000Z"),
        endAt: new Date("2026-08-22T10:45:00.000Z"),
        syncProtected: true,
        sourceIdentity: expect.stringMatching(/^manual:history:/),
      }),
    }));
    expect(shadowReplayer.replayFrom).toHaveBeenCalledWith(1, record.date, {
      weightSourceChanged: false, affectedWorkoutIds: [100],
    });
  });

  it("does not rewrite or replay when a submitted manual workout is unchanged", async () => {
    const { repository, dailyHealthData, workout, shadowReplayer } = fixture();
    dailyHealthData.findUniqueOrThrow.mockResolvedValueOnce({
      ...record,
      id: 42,
      workouts: [{
        id: 12,
        externalId: null,
        type: "Strength training",
        startAt: new Date("2026-08-22T10:00:00.000Z"),
        endAt: new Date("2026-08-22T10:45:00.000Z"),
        durationMinutes: 45,
        activeEnergyKcal: 280,
        sourceIdentity: "manual:history:12",
        syncProtected: true,
        matchedDiarySession: null,
      }],
    } as never);

    await repository.update(record.date, {
      workouts: [{
        id: 12,
        type: "Strength training",
        startAt: "2026-08-22T10:00:00.000Z",
        durationMinutes: 45,
        activeEnergyKcal: 280,
      }],
    });

    expect(workout.update).not.toHaveBeenCalled();
    expect(workout.create).not.toHaveBeenCalled();
    expect(workout.deleteMany).not.toHaveBeenCalled();
    expect(activeEnergyInvalidation.invalidateWorkoutEnergyInTransactionV1).not.toHaveBeenCalled();
    expect(shadowReplayer.replayFrom).not.toHaveBeenCalled();
    expect(dailyHealthData.update).not.toHaveBeenCalled();
  });

  it("retries a no-op update when a prior publication fence remains", async () => {
    const { repository, dailyHealthData, unifiedPublicationBlock, shadowReplayer } = fixture();
    unifiedPublicationBlock.findUnique.mockResolvedValue({ revision: 4, fromDate: record.date });

    await repository.update(record.date, { steps: record.steps });

    expect(dailyHealthData.update).not.toHaveBeenCalled();
    expect(shadowReplayer.replayFrom).toHaveBeenCalledWith(1, record.date, {
      weightSourceChanged: true,
      affectedWorkoutIds: undefined,
    });
  });

  it("scopes Day workout edits to the changed manual row and preserves synced candidates", async () => {
    const { repository, dailyHealthData, workout, shadowReplayer } = fixture();
    dailyHealthData.findUniqueOrThrow.mockResolvedValueOnce({
      ...record,
      id: 42,
      workouts: [
        {
          id: 11, externalId: "garmin-11", type: "Strength training",
          startAt: new Date("2026-08-22T08:00:00.000Z"), endAt: new Date("2026-08-22T08:45:00.000Z"),
          durationMinutes: 45, activeEnergyKcal: 400, sourceIdentity: "garmin:11", syncProtected: true,
          matchedDiarySession: null,
        },
        {
          id: 12, externalId: null, type: "Strength training",
          startAt: new Date("2026-08-22T10:00:00.000Z"), endAt: new Date("2026-08-22T10:45:00.000Z"),
          durationMinutes: 45, activeEnergyKcal: 280, sourceIdentity: "manual:history:12", syncProtected: true,
          matchedDiarySession: null,
        },
      ],
    } as never);

    await repository.update(record.date, {
      workouts: [{
        id: 12,
        type: "Strength training",
        startAt: "2026-08-22T10:00:00.000Z",
        durationMinutes: 45,
        activeEnergyKcal: 300,
      }],
    });

    expect(workout.update).toHaveBeenCalledTimes(1);
    expect(workout.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { profileId_id: { profileId: 1, id: 12 } },
    }));
    expect(activeEnergyInvalidation.invalidateWorkoutEnergyInTransactionV1).toHaveBeenCalledWith(expect.objectContaining({
      workoutIds: [12],
      staleMatchingAliasesOnly: true,
    }));
    expect(shadowReplayer.replayFrom).toHaveBeenCalledWith(1, record.date, {
      weightSourceChanged: false, affectedWorkoutIds: [12],
    });
  });

  it("returns null for a missing update and false for a missing delete", async () => {
    const { repository, dailyHealthData } = fixture();
    dailyHealthData.update.mockRejectedValue({ code: "P2025" });
    dailyHealthData.findUnique.mockResolvedValue(null);
    await expect(repository.update(record.date, { steps: 1 })).resolves.toBeNull();
    await expect(repository.delete(record.date)).resolves.toMatchObject({ deleted: false });
  });

  it("deletes workouts explicitly before deleting the day row", async () => {
    const {
      repository, dailyHealthData, workout, healthMetricSample, healthSyncSnapshot,
      heartRateSample, restingHeartRateSample, shadowReplayer,
    } = fixture();
    dailyHealthData.findUnique.mockResolvedValueOnce({
      ...record,
      id: 42,
      workouts: [{ id: 100, startAt: new Date("2026-08-22T10:00:00.000Z"), endAt: new Date("2026-08-22T10:45:00.000Z") }],
    });
    await expect(repository.delete(record.date)).resolves.toMatchObject({ deleted: true, modelPublicationStatus: "current" });
    expect(workout.deleteMany).toHaveBeenCalledWith({ where: { profileId: 1, dailyHealthDataId: 42 } });
    expect(healthSyncSnapshot.updateMany).toHaveBeenCalledWith({
      where: { profileId: 1, dailyHealthDataId: 42 },
      data: { dailyHealthDataId: null },
    });
    expect(healthSyncSnapshot.updateMany.mock.invocationCallOrder[0]!).toBeLessThan(
      dailyHealthData.delete.mock.invocationCallOrder[0]!,
    );
    for (const sampleTable of [healthMetricSample, heartRateSample, restingHeartRateSample]) {
      expect(sampleTable.updateMany).toHaveBeenCalledWith({
        where: { profileId: 1, dailyHealthDataId: 42 },
        data: { dailyHealthDataId: null },
      });
      expect(sampleTable.updateMany.mock.invocationCallOrder[0]!).toBeLessThan(
        dailyHealthData.delete.mock.invocationCallOrder[0]!,
      );
    }
    expect(dailyHealthData.delete).toHaveBeenCalledWith({ where: { profileId_id: { profileId: 1, id: 42 } } });
    expect(shadowReplayer.replayFrom).toHaveBeenCalledWith(1, record.date, {
      weightSourceChanged: true, affectedWorkoutIds: [100],
    });
  });

  it("retries a committed day deletion when its durable publication block remains", async () => {
    const { repository, dailyHealthData, unifiedPublicationBlock, shadowReplayer } = fixture();
    dailyHealthData.findUnique.mockResolvedValueOnce(record).mockResolvedValueOnce(null);
    unifiedPublicationBlock.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ revision: 4, fromDate: record.date })
      .mockResolvedValueOnce({ revision: 4, fromDate: record.date });
    shadowReplayer.replayFrom.mockRejectedValueOnce(new Error("transient derived failure"));

    await expect(repository.delete(record.date)).resolves.toMatchObject({ deleted: true, modelPublicationStatus: "stale" });
    await expect(repository.delete(record.date)).resolves.toMatchObject({ deleted: true, modelPublicationStatus: "current" });

    expect(dailyHealthData.delete).toHaveBeenCalledTimes(1);
    expect(shadowReplayer.replayFrom).toHaveBeenNthCalledWith(2, 1, record.date, { weightSourceChanged: true });
  });
});
