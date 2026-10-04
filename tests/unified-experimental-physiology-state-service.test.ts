import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const tx = {
    physiologyV7Lifecycle: { findUnique: vi.fn(), updateMany: vi.fn() },
    unifiedExperimentalPhysiologyStateV2: { upsert: vi.fn() },
    experimentalTransientExerciseWaterShadow: { findMany: vi.fn() },
  };
  return {
    tx,
    prisma: {
      modelEpisode: { findMany: vi.fn() },
      physiologyV7Lifecycle: { findUnique: vi.fn() },
      dailyHealthData: { findFirst: vi.fn() },
      unifiedExperimentalPhysiologyStateV2: { findMany: vi.fn(), findUnique: vi.fn() },
      $transaction: vi.fn(),
    },
    loadRange: vi.fn(),
    rebuildTransient: vi.fn(),
    readSourceToken: vi.fn(),
  };
});

vi.mock("@/lib/db/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/model/unified-experimental-physiology-v1/source-loader", () => ({
  UnifiedExperimentalPhysiologySourceLoaderV1: class {
    loadRange = mocks.loadRange;
  },
}));
vi.mock("@/modules/training/experimental-transient-exercise-water-shadow.service", () => ({
  rebuildExperimentalTransientExerciseWaterV2: mocks.rebuildTransient,
  readTransientExerciseWaterSourceTokenV2: mocks.readSourceToken,
}));
vi.mock("@/modules/model-episodes/physiology-v7-persistence.repository", () => ({
  PhysiologyV7PersistenceRepository: class {
    lockProfile = vi.fn();
  },
  PhysiologyV7ConcurrentSourceChangeError: class extends Error {},
}));

import {
  ProductionPublicationUnavailableError,
  rebuildUnifiedExperimentalPhysiologyStateV1,
} from "@/modules/model-episodes/unified-experimental-physiology-state.service";
import { UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V2_REVISION } from "@/model/unified-experimental-physiology-v1/contracts";

const boundaryAt = "2026-10-01T00:00:00.000Z";
const throughInstant = "2026-10-02T00:00:00.000Z";
const publication = {
  invalidationGeneration: 5,
  productionPublishedGeneration: 5,
  productionStaleFromDate: null,
  updatedAt: new Date("2026-10-01T01:00:00.000Z"),
};

function sourceDay(overrides: Record<string, unknown> = {}) {
  return {
    date: "2026-10-01",
    modelEpisodeId: 9,
    boundaryAt,
    dailyHealthData: null,
    productionDailyState: null,
    workouts: [],
    diarySessions: [],
    childModelRevisions: { episodePartition: "partition-v2" },
    childOutputs: {
      slowTissue: null,
      glycogen: null,
      glycogenWater: null,
      transientWater: [],
      relativeMuscle: null,
    },
    transientWaterBoundaries: [{ episodeId: 9, modelDate: "2026-10-01", boundaryInstant: boundaryAt }],
    ...overrides,
  } as never;
}

function prepare() {
  vi.clearAllMocks();
  const tx = mocks.tx as typeof mocks.tx & { $executeRaw?: ReturnType<typeof vi.fn> };
  mocks.prisma.modelEpisode.findMany.mockResolvedValue([{
    id: 9,
    startDate: "2026-10-01",
    timezone: "UTC",
    active: true,
    deactivatedAt: null,
  }]);
  mocks.prisma.physiologyV7Lifecycle.findUnique
    .mockResolvedValueOnce(publication)
    .mockResolvedValueOnce(publication);
  mocks.prisma.dailyHealthData.findFirst.mockResolvedValue({ date: "2026-10-01" });
  mocks.prisma.unifiedExperimentalPhysiologyStateV2.findMany.mockResolvedValue([]);
  mocks.prisma.unifiedExperimentalPhysiologyStateV2.findUnique.mockResolvedValue(null);
  tx.physiologyV7Lifecycle.findUnique.mockResolvedValue(publication);
  tx.physiologyV7Lifecycle.updateMany.mockResolvedValue({ count: 1 });
  tx.unifiedExperimentalPhysiologyStateV2.upsert.mockResolvedValue({});
  tx.experimentalTransientExerciseWaterShadow.findMany.mockResolvedValue([]);
  mocks.prisma.$transaction.mockImplementation(async (callback: (transaction: typeof mocks.tx) => Promise<unknown>) => callback(mocks.tx));
  mocks.loadRange.mockResolvedValue({
    fromInstant: boundaryAt,
    throughInstant,
    days: [sourceDay()],
  });
  mocks.rebuildTransient.mockResolvedValue({ earliestModelDate: null, sourceToken: "transient-token" });
  mocks.readSourceToken.mockResolvedValue("transient-token");
}

describe("Unified V2 rebuild publication", () => {
  beforeEach(prepare);

  it("replays a current production-backed range and publishes its durable candidate", async () => {
    await rebuildUnifiedExperimentalPhysiologyStateV1({ profileId: 4 });

    expect(mocks.prisma.modelEpisode.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { profileId: 4 },
      orderBy: [{ startDate: "asc" }, { id: "asc" }],
    }));
    expect(mocks.rebuildTransient).toHaveBeenCalledWith({ profileId: 4 });
    expect(mocks.loadRange).toHaveBeenCalledTimes(2);
    expect(mocks.tx.unifiedExperimentalPhysiologyStateV2.upsert).toHaveBeenCalledOnce();
    const persisted = mocks.tx.unifiedExperimentalPhysiologyStateV2.upsert.mock.calls[0]![0].create;
    expect(persisted).toMatchObject({
      profileId: 4,
      modelEpisodeId: 9,
      date: "2026-10-01",
      modelRevision: UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V2_REVISION,
      qualityStatus: "unavailable",
      energyLedger: { quality: "partial" },
    });
    expect(mocks.tx.physiologyV7Lifecycle.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ profileId: 4, invalidationGeneration: 5, productionPublishedGeneration: 5 }),
      data: { unifiedPublishedGeneration: 5 },
    }));
  });

  it("rejects reversed date ranges before reading or writing state", async () => {
    await expect(rebuildUnifiedExperimentalPhysiologyStateV1({
      fromDate: "2026-10-03",
      toDate: "2026-10-02",
    })).rejects.toThrow(RangeError);
    expect(mocks.prisma.modelEpisode.findMany).not.toHaveBeenCalled();
    expect(mocks.tx.unifiedExperimentalPhysiologyStateV2.upsert).not.toHaveBeenCalled();
  });

  it("fails closed when there is no episode or production generation is stale", async () => {
    mocks.prisma.modelEpisode.findMany.mockResolvedValueOnce([]);
    await expect(rebuildUnifiedExperimentalPhysiologyStateV1({})).rejects.toThrow(ProductionPublicationUnavailableError);

    mocks.prisma.modelEpisode.findMany.mockResolvedValue([{
      id: 9, startDate: "2026-10-01", timezone: "UTC", active: true, deactivatedAt: null,
    }]);
    mocks.prisma.physiologyV7Lifecycle.findUnique.mockReset().mockResolvedValue({
      invalidationGeneration: 6,
      productionPublishedGeneration: 5,
      productionStaleFromDate: "2026-10-01",
    });
    await expect(rebuildUnifiedExperimentalPhysiologyStateV1({})).rejects.toThrow(ProductionPublicationUnavailableError);
    expect(mocks.rebuildTransient).not.toHaveBeenCalled();
    expect(mocks.tx.unifiedExperimentalPhysiologyStateV2.upsert).not.toHaveBeenCalled();
  });

  it("rejects a candidate if production generation changes while it is being built", async () => {
    mocks.prisma.physiologyV7Lifecycle.findUnique
      .mockReset()
      .mockResolvedValueOnce(publication)
      .mockResolvedValueOnce({ ...publication, invalidationGeneration: 6, productionPublishedGeneration: 5 });

    await expect(rebuildUnifiedExperimentalPhysiologyStateV1({})).rejects.toThrow();
    expect(mocks.loadRange).not.toHaveBeenCalled();
    expect(mocks.tx.unifiedExperimentalPhysiologyStateV2.upsert).not.toHaveBeenCalled();
  });
});
