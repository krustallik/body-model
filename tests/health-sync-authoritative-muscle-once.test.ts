import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  afterHealthSyncMatch,
  healthSyncRepository,
  rebuildAuthoritativeRelativeMuscleTrajectory,
  recordExperimentalStepperActiveEnergyShadowsForLocalDate,
  recordExperimentalStepperActiveEnergyShadowsForMassWindow,
  recordExperimentalStrengthShadowsForWeightDate,
  persistStepperReconciliationV1,
  recordExperimentalStepperGlycogenDemandShadowsForLocalDate,
  recordExperimentalGlycogenStateShadow,
  recordExperimentalFfmRetentionShadow,
  recordExperimentalLocalHypertrophyResponseShadow,
  rebuildUnifiedExperimentalPhysiologyStateV1,
  publishActiveEnergyChangesV1,
} = vi.hoisted(() => {
  const healthSyncRepository = {
    syncDay: vi.fn(),
    pruneOlderThan: vi.fn().mockResolvedValue({ deletedDays: 0, deletedSnapshots: 0 }),
  };
  return {
    afterHealthSyncMatch: vi.fn().mockResolvedValue(true),
    healthSyncRepository,
    rebuildAuthoritativeRelativeMuscleTrajectory: vi.fn().mockResolvedValue(undefined),
    recordExperimentalStepperActiveEnergyShadowsForLocalDate: vi.fn().mockResolvedValue(undefined),
    recordExperimentalStepperActiveEnergyShadowsForMassWindow: vi.fn().mockResolvedValue(undefined),
    recordExperimentalStrengthShadowsForWeightDate: vi.fn().mockResolvedValue(undefined),
    persistStepperReconciliationV1: vi.fn().mockResolvedValue({ groupIds: [], displayedSteps: null, potentialDuplication: false }),
    recordExperimentalStepperGlycogenDemandShadowsForLocalDate: vi.fn().mockResolvedValue(undefined),
    recordExperimentalGlycogenStateShadow: vi.fn().mockResolvedValue(undefined),
    recordExperimentalFfmRetentionShadow: vi.fn().mockResolvedValue(undefined),
    recordExperimentalLocalHypertrophyResponseShadow: vi.fn().mockResolvedValue(undefined),
    rebuildUnifiedExperimentalPhysiologyStateV1: vi.fn().mockResolvedValue(undefined),
    publishActiveEnergyChangesV1: vi.fn().mockResolvedValue(true),
  };
});

vi.mock("@/modules/training/training.service", () => ({
  trainingService: { afterHealthSyncMatch },
  recordExperimentalStrengthShadowsForWeightDate,
}));
vi.mock("@/modules/health/health.repository", () => ({ healthSyncRepository }));
vi.mock("@/lib/db/prisma", () => ({
  prisma: { trainingRefreshJob: { findUnique: async () => null } },
}));
vi.mock("@/modules/profile/experimental-stepper-active-energy-shadow.service", () => ({
  recordExperimentalStepperActiveEnergyShadowsForLocalDate,
  recordExperimentalStepperActiveEnergyShadowsForMassWindow,
}));
vi.mock("@/modules/training/stepper-reconciliation.service", () => ({ persistStepperReconciliationV1 }));
vi.mock("@/modules/profile/experimental-stepper-glycogen-demand-shadow.service", () => ({
  recordExperimentalStepperGlycogenDemandShadowsForLocalDate,
}));
vi.mock("@/modules/model-episodes/experimental-glycogen-state-shadow.service", () => ({
  recordExperimentalGlycogenStateShadow,
}));
vi.mock("@/modules/model-episodes/experimental-cessation-detraining-shadow.service", () => ({
  rebuildAuthoritativeRelativeMuscleTrajectory,
}));
vi.mock("@/modules/model-episodes/experimental-ffm-retention-shadow.service", () => ({
  recordExperimentalFfmRetentionShadow,
}));
vi.mock("@/modules/model-episodes/experimental-local-hypertrophy-response-shadow.service", () => ({
  recordExperimentalLocalHypertrophyResponseShadow,
}));
vi.mock("@/modules/model-episodes/unified-experimental-physiology-state.service", () => ({
  rebuildUnifiedExperimentalPhysiologyStateV1,
}));
vi.mock("@/modules/activity/active-energy-publication", () => ({ publishActiveEnergyChangesV1 }));

import { syncHealthData } from "@/modules/health/health.service";

describe("health sync authoritative muscle suffix rebuild", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    afterHealthSyncMatch.mockResolvedValue(true);
    publishActiveEnergyChangesV1.mockResolvedValue(true);
    healthSyncRepository.syncDay.mockImplementation(async (day: { date: string }) => ({
      date: day.date,
      action: "created" as const,
    }));
    healthSyncRepository.pruneOlderThan.mockResolvedValue({ deletedDays: 0, deletedSnapshots: 0 });
  });

  it("replays the authoritative muscle suffix once after the chronological batch, not per day", async () => {
    const publicationLifecycle = {
      readUnifiedPublicationBlockToken: vi.fn(async ({ sourceKey }: { sourceKey: string }) => ({ revision: 1, fromDate: sourceKey })),
      blockUnifiedPublication: vi.fn().mockResolvedValue(undefined),
      clearUnifiedPublicationBlock: vi.fn().mockResolvedValue(true),
      hasUnifiedPublicationBlocks: vi.fn().mockResolvedValue(false),
      readUnifiedPublicationFence: vi.fn().mockResolvedValue({ invalidationGeneration: 1, updatedAt: "2026-09-23T00:00:00.000Z" }),
      restoreUnifiedPublicationBlocksIfCurrent: vi.fn().mockResolvedValue(false),
    };
    const result = await syncHealthData({
      days: [
        { date: "2026-09-23" },
        { date: "2026-09-21" },
        { date: "2026-09-22" },
        { date: "2026-09-22" },
      ],
    }, healthSyncRepository as never, undefined, undefined, undefined, { publicationLifecycle: publicationLifecycle as never });

    expect(rebuildAuthoritativeRelativeMuscleTrajectory).toHaveBeenCalledTimes(1);
    expect(rebuildAuthoritativeRelativeMuscleTrajectory).toHaveBeenCalledWith({
      fromDate: "2026-09-21",
    });
    // Glycogen is stateful, so its suffix replays once only after all same-day
    // stepper/depletion source shadows have been written.
    expect(recordExperimentalGlycogenStateShadow).toHaveBeenCalledTimes(1);
    expect(recordExperimentalGlycogenStateShadow).toHaveBeenCalledWith({ date: "2026-09-21" });
    expect(publishActiveEnergyChangesV1).toHaveBeenCalledTimes(1);
    expect(publicationLifecycle.readUnifiedPublicationBlockToken).toHaveBeenCalledTimes(3);
    expect(publicationLifecycle.clearUnifiedPublicationBlock).toHaveBeenCalledTimes(3);
    expect(afterHealthSyncMatch).toHaveBeenCalledTimes(3);
    expect(result.modelPublicationStatus).toBe("current");
    expect(rebuildUnifiedExperimentalPhysiologyStateV1).not.toHaveBeenCalled();
  });

  it("keeps Unified stale when Health matching reports failed publication dependencies", async () => {
    afterHealthSyncMatch.mockResolvedValueOnce(false);
    const publicationLifecycle = {
      readUnifiedPublicationBlockToken: vi.fn(async ({ sourceKey }: { sourceKey: string }) => ({ revision: 1, fromDate: sourceKey })),
      blockUnifiedPublication: vi.fn().mockResolvedValue(undefined),
      clearUnifiedPublicationBlock: vi.fn().mockResolvedValue(true),
      hasUnifiedPublicationBlocks: vi.fn().mockResolvedValue(false),
      readUnifiedPublicationFence: vi.fn().mockResolvedValue({ invalidationGeneration: 1, updatedAt: "2026-09-23T00:00:00.000Z" }),
      restoreUnifiedPublicationBlocksIfCurrent: vi.fn().mockResolvedValue(false),
    };

    await syncHealthData({ days: [{ date: "2026-09-21" }] }, healthSyncRepository as never,
      undefined, undefined, undefined, { publicationLifecycle: publicationLifecycle as never });

    expect(rebuildAuthoritativeRelativeMuscleTrajectory).toHaveBeenCalledTimes(1);
    expect(publishActiveEnergyChangesV1).not.toHaveBeenCalled();
    expect(rebuildUnifiedExperimentalPhysiologyStateV1).not.toHaveBeenCalled();
  });

  it("restores the exact Health retry fence when publication fails and shared block state is unreadable", async () => {
    publishActiveEnergyChangesV1.mockRejectedValueOnce(new Error("publication failed"));
    const publicationLifecycle = {
      readUnifiedPublicationBlockToken: vi.fn(async ({ sourceKey }: { sourceKey: string }) => ({ revision: 3, fromDate: sourceKey })),
      blockUnifiedPublication: vi.fn().mockResolvedValue(undefined),
      clearUnifiedPublicationBlock: vi.fn().mockResolvedValue(true),
      hasUnifiedPublicationBlocks: vi.fn().mockResolvedValueOnce(false).mockRejectedValueOnce(new Error("block read failed")),
      readUnifiedPublicationFence: vi.fn().mockResolvedValue({ invalidationGeneration: 1, updatedAt: "2026-09-23T00:00:00.000Z" }),
      restoreUnifiedPublicationBlocksIfCurrent: vi.fn().mockResolvedValue(true),
    };

    const result = await syncHealthData({ days: [{ date: "2026-09-21" }] }, healthSyncRepository as never,
      undefined, undefined, undefined, { publicationLifecycle: publicationLifecycle as never });

    expect(result.modelPublicationStatus).toBe("stale");
    expect(publicationLifecycle.restoreUnifiedPublicationBlocksIfCurrent).toHaveBeenCalledWith({
      profileId: 1,
      expectedGeneration: 1,
      expectedUpdatedAt: "2026-09-23T00:00:00.000Z",
      blocks: [{ fromDate: "2026-09-21", source: "health", sourceKey: "2026-09-21" }],
    });
    expect(rebuildUnifiedExperimentalPhysiologyStateV1).not.toHaveBeenCalled();
  });
});
