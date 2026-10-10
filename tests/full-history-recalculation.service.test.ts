import { beforeEach, describe, expect, it, vi } from "vitest";

const V3 = "unified-experimental-physiology-state-v3-relative-muscle-daily-cumulative-diagnostics";

const mocks = vi.hoisted(() => {
  const state = {
    inventoryCalls: 0,
    fingerprints: ["raw-before", "raw-after-mismatch"] as string[],
    lifecycle: {
      invalidationGeneration: 3,
      productionStaleFromDate: null as string | null,
      productionPublishedGeneration: 3 as number | null,
      unifiedPublishedGeneration: 3 as number | null,
      unifiedTargetRevision: "unified-experimental-physiology-state-v3-relative-muscle-daily-cumulative-diagnostics",
      unifiedRolloutEpoch: 0,
      unifiedPublishedRolloutEpoch: 0 as number | null,
    },
  };
  return {
    state,
    getModelStatus: vi.fn(),
    invalidate: vi.fn(),
    recalculateModelEpisode: vi.fn(),
    rebuildUnified: vi.fn(),
    findUniqueEpisode: vi.fn(),
    findUniqueLifecycle: vi.fn(),
    queryRawUnsafe: vi.fn(),
  };
});

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    modelEpisode: { findUnique: mocks.findUniqueEpisode },
    physiologyV7Lifecycle: { findUnique: mocks.findUniqueLifecycle },
    $queryRawUnsafe: mocks.queryRawUnsafe,
  },
}));
vi.mock("@/modules/model-episodes/model-episode.service", () => ({
  getModelStatus: mocks.getModelStatus,
  recalculateModelEpisode: mocks.recalculateModelEpisode,
}));
vi.mock("@/modules/model-episodes/physiology-v7-persistence.repository", () => ({
  PhysiologyV7PersistenceRepository: class {
    invalidate = mocks.invalidate;
  },
}));
vi.mock("@/modules/model-episodes/unified-experimental-physiology-state.service", () => ({
  rebuildUnifiedExperimentalPhysiologyStateV1: mocks.rebuildUnified,
}));
vi.mock("@/modules/model-recovery/recovery-fingerprint", () => ({
  stableSha256: (value: unknown) => {
    mocks.state.inventoryCalls += 1;
    return mocks.state.fingerprints[Math.min(mocks.state.inventoryCalls - 1, mocks.state.fingerprints.length - 1)]
      ?? JSON.stringify(value);
  },
}));

import { runOwnerAuthorizedFullHistoryRecalculation } from "@/modules/model-episodes/full-history-recalculation.service";

describe("runOwnerAuthorizedFullHistoryRecalculation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.state.inventoryCalls = 0;
    mocks.state.fingerprints = ["raw-stable", "raw-stable"];
    mocks.state.lifecycle = {
      invalidationGeneration: 7,
      productionStaleFromDate: null,
      productionPublishedGeneration: 7,
      unifiedPublishedGeneration: 7,
      unifiedTargetRevision: V3,
      unifiedRolloutEpoch: 0,
      unifiedPublishedRolloutEpoch: 0,
    };
    mocks.getModelStatus.mockResolvedValue({ episodeId: 11 });
    mocks.findUniqueEpisode.mockResolvedValue({
      id: 11,
      profileId: 1,
      startDate: "2024-01-01",
      modelVersion: "v5",
      active: true,
    });
    mocks.findUniqueLifecycle.mockImplementation(async () => ({ ...mocks.state.lifecycle }));
    mocks.queryRawUnsafe.mockResolvedValue([{
      row_count: 1n,
      max_marker: new Date("2026-01-01T00:00:00.000Z"),
      id_checksum: "abc",
    }]);
    mocks.invalidate.mockResolvedValue({});
    mocks.recalculateModelEpisode.mockResolvedValue({
      status: "ok",
      episodeId: 11,
      daysPersisted: 10,
      completeDays: 9,
      latestModeledDate: "2026-01-09",
    });
    mocks.rebuildUnified.mockResolvedValue(undefined);
  });

  it("forces invalidation from episode start, recalculates, rebuilds Unified V3, and conserves raw inputs", async () => {
    const result = await runOwnerAuthorizedFullHistoryRecalculation({
      profileId: 1,
      ownerAuthorized: true,
    });

    expect(mocks.invalidate).toHaveBeenCalledWith(1, "2024-01-01");
    expect(mocks.recalculateModelEpisode).toHaveBeenCalledWith({ episodeId: 11 }, expect.anything());
    expect(mocks.rebuildUnified).toHaveBeenCalledWith({
      profileId: 1,
      client: expect.anything(),
      targetRevision: V3,
      rolloutEpoch: 0,
    });
    expect(result).toMatchObject({
      profileId: 1,
      episodeId: 11,
      invalidationGeneration: 7,
      productionPublishedGeneration: 7,
      unifiedPublishedGeneration: 7,
      rawInputFingerprint: "raw-stable",
    });
  });

  it("fail-closes when raw observation inventory changes", async () => {
    mocks.state.fingerprints = ["raw-before", "raw-after"];
    await expect(runOwnerAuthorizedFullHistoryRecalculation({
      profileId: 1,
      ownerAuthorized: true,
    })).rejects.toThrow(/raw observation inputs/);
  });

  it("fail-closes when Unified is not V3 epoch 0", async () => {
    mocks.state.lifecycle.unifiedTargetRevision = "unified-experimental-physiology-state-v4-physical-glycogen-water-2p7-exact-once";
    mocks.state.lifecycle.unifiedRolloutEpoch = 1;
    await expect(runOwnerAuthorizedFullHistoryRecalculation({
      profileId: 1,
      ownerAuthorized: true,
    })).rejects.toThrow(/Unified V3 epoch 0/);
  });

  it("requires explicit owner authorization and a positive profile id", async () => {
    await expect(runOwnerAuthorizedFullHistoryRecalculation({
      profileId: 1,
      ownerAuthorized: true,
    })).resolves.toBeTruthy();
    await expect(runOwnerAuthorizedFullHistoryRecalculation({
      // @ts-expect-error intentional unauthorized call
      profileId: 1,
      ownerAuthorized: false,
    })).rejects.toThrow(/owner authorization/);
    await expect(runOwnerAuthorizedFullHistoryRecalculation({
      profileId: 0,
      ownerAuthorized: true,
    })).rejects.toThrow(/positive integer/);
  });
});
