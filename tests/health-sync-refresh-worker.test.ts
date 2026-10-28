import { beforeEach, describe, expect, it, vi } from "vitest";

const { prisma, queryRaw, syncHealthData, blockUnifiedPublication } = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  syncHealthData: vi.fn(),
  blockUnifiedPublication: vi.fn().mockResolvedValue(undefined),
  prisma: {
    $transaction: vi.fn(),
    healthSyncRefreshJob: { updateMany: vi.fn() },
    unifiedPublicationBlock: { findMany: vi.fn(), count: vi.fn() },
    healthSyncSnapshot: { findMany: vi.fn() },
    healthMetricSample: { findMany: vi.fn() },
    physiologyV7Lifecycle: { findUnique: vi.fn() },
  },
}));

vi.mock("@/lib/db/prisma", () => ({ prisma }));
vi.mock("@/modules/health/health.repository", () => ({
  APPLE_HEALTH_SHORTCUT_SOURCE: "apple-health-shortcut",
  healthSyncRepository: {},
  healthSyncRepositoryForProfile: (profileId: number) => ({ profileId }),
}));
vi.mock("@/modules/health/health.service", () => ({ syncHealthData }));
vi.mock("@/modules/model-episodes/physiology-v7-persistence.repository", () => ({
  PhysiologyV7PersistenceRepository: class {
    blockUnifiedPublication = blockUnifiedPublication;
  },
}));

import { processNextHealthSyncRefreshJob } from "@/modules/health/health-sync-refresh-worker";
import {
  UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V3_REVISION,
  UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V4_REVISION,
} from "@/model/unified-experimental-physiology-v1/contracts";

const job = {
  profileId: 1,
  requestedGeneration: 3,
  completedGeneration: 2,
  fromDate: "2040-01-01",
  toDate: "2040-01-01",
  sourceDates: ["2040-01-01"],
  weightSourceChangedDates: [],
  attemptCount: 0,
};

const staleLifecycle = {
  invalidationGeneration: 3,
  productionStaleFromDate: "2040-01-01",
  productionPublishedGeneration: 2,
  unifiedPublishedGeneration: 2,
  unifiedTargetRevision: UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V4_REVISION,
  unifiedRolloutEpoch: 1,
  unifiedPublishedRolloutEpoch: 1,
  unifiedPublicationBlockedFromDate: null,
};

const currentLifecycle = {
  invalidationGeneration: 3,
  productionStaleFromDate: null,
  productionPublishedGeneration: 3,
  unifiedPublishedGeneration: 3,
  unifiedTargetRevision: UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V4_REVISION,
  unifiedRolloutEpoch: 1,
  unifiedPublishedRolloutEpoch: 1,
  unifiedPublicationBlockedFromDate: null,
};

function defer<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("durable Health sync refresh worker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    let lifecycleStateReads = 0;
    queryRaw.mockResolvedValue([job]);
    prisma.$transaction.mockImplementation(async (action: (transaction: unknown) => Promise<unknown>) =>
      action({ $queryRaw: queryRaw, healthSyncRefreshJob: { update: vi.fn().mockResolvedValue({ attemptCount: 1 }) } }));
    prisma.unifiedPublicationBlock.findMany.mockResolvedValue([{ sourceKey: "2040-01-01" }]);
    prisma.unifiedPublicationBlock.count.mockResolvedValue(0);
    prisma.healthSyncSnapshot.findMany.mockResolvedValue([{ date: "2040-01-01", timezone: "Europe/Bratislava" }]);
    prisma.healthMetricSample.findMany.mockResolvedValue([]);
    prisma.physiologyV7Lifecycle.findUnique.mockImplementation(async ({ select }: { select: Record<string, boolean> }) => {
      if (select.profileId) return { profileId: 1 };
      lifecycleStateReads += 1;
      return lifecycleStateReads === 1 ? staleLifecycle : currentLifecycle;
    });
    prisma.healthSyncRefreshJob.updateMany.mockResolvedValue({ count: 1 });
    syncHealthData.mockResolvedValue({ status: "ok", modelPublicationStatus: "current" });
  });

  it("refreshes persisted dates without replaying the raw Health write", async () => {
    await expect(processNextHealthSyncRefreshJob()).resolves.toBe(true);

    expect(blockUnifiedPublication).toHaveBeenCalledWith({
      profileId: 1, fromDate: "2040-01-01", source: "health", sourceKey: "2040-01-01",
    });
    expect(syncHealthData).toHaveBeenCalledWith(
      { days: [{ date: "2040-01-01" }], timezone: "Europe/Bratislava" },
      { profileId: 1 },
      undefined,
      undefined,
      new Map(),
      expect.objectContaining({
        measurementDates: [],
        measurementInstants: [],
        persistedDates: [{ date: "2040-01-01", action: "updated" }],
        timezoneByDate: new Map([["2040-01-01", "Europe/Bratislava"]]),
        skipRetention: true,
      }),
    );
    expect(prisma.healthSyncRefreshJob.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ profileId: 1, leaseToken: expect.any(String), requestedGeneration: 3 }),
      data: expect.objectContaining({ completedGeneration: 3, fromDate: null, toDate: null }),
    }));
  });

  it("keeps the durable job retryable when a dependent refresh fails after persistence", async () => {
    syncHealthData.mockRejectedValueOnce(new Error("dependent refresh failed"));

    await expect(processNextHealthSyncRefreshJob()).resolves.toBe(true);

    expect(prisma.healthSyncRefreshJob.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ profileId: 1, leaseToken: expect.any(String) }),
      data: expect.objectContaining({ leaseToken: null, leaseUntil: null, lastErrorAt: expect.any(Date) }),
    }));
    expect(prisma.healthSyncRefreshJob.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ completedGeneration: 3 }),
    }));
  });

  it("retries when a health publication fence remains after refresh", async () => {
    syncHealthData.mockResolvedValueOnce({ status: "ok", modelPublicationStatus: "stale" });
    prisma.unifiedPublicationBlock.count.mockResolvedValue(1);

    await expect(processNextHealthSyncRefreshJob()).resolves.toBe(true);

    expect(prisma.healthSyncRefreshJob.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ leaseToken: null, lastErrorType: "Error" }),
    }));
  });

  it("re-arms a durable Health fence when publication is stale but best-effort restoration left no fence", async () => {
    syncHealthData.mockResolvedValueOnce({ status: "ok", modelPublicationStatus: "stale" });
    prisma.physiologyV7Lifecycle.findUnique.mockImplementation(async ({ select }: { select: Record<string, boolean> }) => {
      if (select.profileId) return { profileId: 1 };
      return staleLifecycle;
    });

    await expect(processNextHealthSyncRefreshJob()).resolves.toBe(true);

    expect(blockUnifiedPublication).toHaveBeenCalledTimes(2);
    expect(blockUnifiedPublication).toHaveBeenLastCalledWith({
      profileId: 1, fromDate: "2040-01-01", source: "health", sourceKey: "2040-01-01",
    });
    expect(prisma.healthSyncRefreshJob.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ leaseToken: null, lastErrorType: "Error" }),
    }));
    expect(prisma.healthSyncRefreshJob.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ completedGeneration: 3 }),
    }));
  });

  it("acknowledges completed Health dependencies when another source owns the publication block", async () => {
    syncHealthData.mockImplementationOnce(async (...args) => {
      const options = args[5] as { onHealthDependenciesComplete?: () => void };
      options.onHealthDependenciesComplete?.();
      return { status: "ok", modelPublicationStatus: "stale" };
    });
    prisma.physiologyV7Lifecycle.findUnique.mockImplementation(async ({ select }: { select: Record<string, boolean> }) => {
      if (select.profileId) return { profileId: 1 };
      return staleLifecycle;
    });
    prisma.unifiedPublicationBlock.count.mockImplementation(async ({ where }: { where: { source?: { not?: string } } }) =>
      where.source?.not === "health" ? 1 : 0);

    await expect(processNextHealthSyncRefreshJob()).resolves.toBe(true);

    expect(blockUnifiedPublication).toHaveBeenCalledTimes(1);
    expect(prisma.healthSyncRefreshJob.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ completedGeneration: 3 }),
    }));
    expect(prisma.healthSyncRefreshJob.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ lastErrorAt: expect.any(Date) }),
    }));
  });

  it("re-arms publication after a prior worker cleared fences and crashed before publishing", async () => {
    prisma.unifiedPublicationBlock.count.mockResolvedValueOnce(0);
    await expect(processNextHealthSyncRefreshJob()).resolves.toBe(true);

    expect(blockUnifiedPublication).toHaveBeenCalledWith({
      profileId: 1, fromDate: "2040-01-01", source: "health", sourceKey: "2040-01-01",
    });
    expect(syncHealthData).toHaveBeenCalledWith(
      expect.objectContaining({ days: [{ date: "2040-01-01" }] }),
      expect.any(Object),
      undefined,
      undefined,
      expect.any(Map),
      expect.objectContaining({ persistedDates: [{ date: "2040-01-01", action: "updated" }] }),
    );
  });

  it("acknowledges a retry when a previous attempt already published the current generation", async () => {
    prisma.physiologyV7Lifecycle.findUnique.mockResolvedValueOnce({
      invalidationGeneration: 7,
      productionStaleFromDate: null,
      productionPublishedGeneration: 7,
      unifiedPublishedGeneration: 7,
      unifiedTargetRevision: UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V4_REVISION,
      unifiedRolloutEpoch: 2,
      unifiedPublishedRolloutEpoch: 2,
      unifiedPublicationBlockedFromDate: null,
    });

    await expect(processNextHealthSyncRefreshJob()).resolves.toBe(true);

    expect(blockUnifiedPublication).not.toHaveBeenCalled();
    expect(syncHealthData).not.toHaveBeenCalled();
    expect(prisma.healthSyncRefreshJob.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ completedGeneration: 3 }),
    }));
  });

  it.each([
    ["V4 target at epoch zero", UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V4_REVISION, 0],
    ["V3 target at a V4 epoch", UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V3_REVISION, 1],
  ] as const)("does not acknowledge a generation with an invalid %s pair", async (_label, revision, epoch) => {
    prisma.physiologyV7Lifecycle.findUnique.mockResolvedValueOnce({
      ...currentLifecycle,
      unifiedTargetRevision: revision,
      unifiedRolloutEpoch: epoch,
    });
    syncHealthData.mockRejectedValueOnce(new Error("dependent refresh failed"));

    await expect(processNextHealthSyncRefreshJob()).resolves.toBe(true);

    expect(syncHealthData).toHaveBeenCalledTimes(1);
    expect(prisma.healthSyncRefreshJob.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ completedGeneration: 3 }),
    }));
    expect(prisma.healthSyncRefreshJob.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ leaseToken: null, lastErrorAt: expect.any(Date) }),
    }));
  });

  it("acknowledges a current V3 generation only at rollout epoch zero", async () => {
    prisma.physiologyV7Lifecycle.findUnique.mockResolvedValueOnce({
      ...currentLifecycle,
      unifiedTargetRevision: UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V3_REVISION,
      unifiedRolloutEpoch: 0,
      unifiedPublishedRolloutEpoch: 0,
    });

    await expect(processNextHealthSyncRefreshJob()).resolves.toBe(true);

    expect(syncHealthData).not.toHaveBeenCalled();
    expect(prisma.healthSyncRefreshJob.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ completedGeneration: 3 }),
    }));
  });

  it("stops before dependent work when a newer generation takes the lease", async () => {
    prisma.healthSyncRefreshJob.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(processNextHealthSyncRefreshJob()).resolves.toBe(true);

    expect(syncHealthData).not.toHaveBeenCalled();
    expect(prisma.healthSyncRefreshJob.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ completedGeneration: 3 }),
    }));
  });

  it("does not acknowledge a publication when another worker takes over during the in-flight refresh", async () => {
    const refresh = defer<void>();
    syncHealthData.mockReturnValueOnce(refresh.promise);

    const processing = processNextHealthSyncRefreshJob();
    await vi.waitFor(() => expect(syncHealthData).toHaveBeenCalledTimes(1));
    // The refresh stage is still in flight when another generation takes the
    // lease. The post-stage fence check must prevent acknowledgement.
    prisma.healthSyncRefreshJob.updateMany.mockResolvedValueOnce({ count: 0 });
    refresh.resolve();
    await expect(processing).resolves.toBe(true);

    expect(prisma.healthSyncRefreshJob.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ completedGeneration: 3 }),
    }));
    expect(prisma.healthSyncRefreshJob.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ leaseToken: null, lastErrorAt: expect.any(Date) }),
    }));
  });

  it("allows only one concurrent claimant to run the same pending refresh", async () => {
    const refresh = defer<void>();
    syncHealthData.mockReturnValueOnce(refresh.promise);
    queryRaw.mockResolvedValueOnce([job]).mockResolvedValueOnce([]);

    const first = processNextHealthSyncRefreshJob();
    await vi.waitFor(() => expect(syncHealthData).toHaveBeenCalledTimes(1));
    await expect(processNextHealthSyncRefreshJob()).resolves.toBe(false);
    refresh.resolve();
    await expect(first).resolves.toBe(true);
    expect(syncHealthData).toHaveBeenCalledTimes(1);
  });
});
