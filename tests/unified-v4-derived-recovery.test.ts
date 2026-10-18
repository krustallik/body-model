import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const state: {
    lifecycle: Record<string, unknown>;
    blocks: Array<{ source: string; sourceKey: string; fromDate: string; revision: number }>;
    failAt: string | null;
    failClear: string | null;
  } = { lifecycle: {}, blocks: [], failAt: null, failClear: null };
  const prisma = {
    $queryRawUnsafe: vi.fn(async () => []),
    physiologyV7Lifecycle: { findUnique: vi.fn() },
    unifiedPublicationBlock: { findMany: vi.fn(), findUnique: vi.fn(), count: vi.fn() },
    dailyHealthData: { findMany: vi.fn() },
    healthMetricSample: { findMany: vi.fn() },
    strengthDiarySession: { findFirst: vi.fn() },
  };
  const shadow = vi.fn(async () => {
    if (state.failAt === "health") throw Object.assign(new Error("transaction conflict"), { code: "P2034" });
  });
  const training = vi.fn(async () => {
    if (state.failAt === "training") throw Object.assign(new Error("transaction conflict"), { code: "P2034" });
  });
  const clear = vi.fn(async (input: { source: string; sourceKey: string; expectedRevision: number; expectedFromDate: string }) => {
    if (state.failClear === input.sourceKey) return false;
    const oldCount = state.blocks.length;
    state.blocks = state.blocks.filter((block) => !(block.source === input.source
      && block.sourceKey === input.sourceKey && block.revision === input.expectedRevision
      && block.fromDate === input.expectedFromDate));
    return state.blocks.length !== oldCount;
  });
  return {
    state,
    prisma,
    shadow,
    training,
    clear,
    inventory: vi.fn(async () => ({ fingerprint: "same-raw-source-fingerprint", tables: {} })),
    recalculate: vi.fn(async () => {
      if (state.failAt === "production") return null;
      state.lifecycle.productionStaleFromDate = null;
      state.lifecycle.productionPublishedGeneration = state.lifecycle.invalidationGeneration;
      return { latestModeledDate: "2071-01-09" };
    }),
    replay: vi.fn(async () => ({ profileId: 1, rolloutEpoch: 1, dayCount: 9 })),
  };
});

vi.mock("@/lib/db/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/modules/model-episodes/full-history-recalculation.service", () => ({
  FULL_HISTORY_RAW_INPUT_TABLES: ["ModelEpisode", "StrengthDiarySession"],
}));
vi.mock("@/modules/model-episodes/physiology-v7-persistence.repository", () => ({
  PhysiologyV7PersistenceRepository: class {
    clearUnifiedPublicationBlock = mocks.clear;
  },
}));
vi.mock("@/modules/model-episodes/experimental-ffm-retention-shadow.service", () => ({ recordExperimentalFfmRetentionShadow: mocks.shadow }));
vi.mock("@/modules/model-episodes/experimental-local-hypertrophy-response-shadow.service", () => ({ recordExperimentalLocalHypertrophyResponseShadow: mocks.shadow }));
vi.mock("@/modules/model-episodes/experimental-cessation-detraining-shadow.service", () => ({ rebuildAuthoritativeRelativeMuscleTrajectory: mocks.shadow }));
vi.mock("@/modules/model-episodes/experimental-glycogen-state-shadow.service", () => ({ recordExperimentalGlycogenStateShadow: mocks.shadow }));
vi.mock("@/modules/model-episodes/unified-rollout-v4.service", () => ({ activateAndReplayUnifiedV4: mocks.replay }));
vi.mock("@/modules/profile/experimental-stepper-active-energy-shadow.service", () => ({
  recordExperimentalStepperActiveEnergyShadowsForLocalDate: mocks.shadow,
  recordExperimentalStepperActiveEnergyShadowsForMassWindow: mocks.shadow,
}));
vi.mock("@/modules/profile/experimental-stepper-glycogen-demand-shadow.service", () => ({ recordExperimentalStepperGlycogenDemandShadowsForLocalDate: mocks.shadow }));
vi.mock("@/modules/activity/active-energy-publication", () => ({ recalculateActiveEnergyChangesV1: mocks.recalculate }));
vi.mock("@/modules/training/training.service", () => ({
  refreshPersistedTrainingSessionDependenciesV1: mocks.training,
  recordExperimentalStrengthShadowsForWeightDate: mocks.shadow,
}));

import { UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V4_REVISION as V4 } from "@/model/unified-experimental-physiology-v1/contracts";
import { recoverUnifiedV4FromPersistedSourcesV1 } from "@/modules/model-episodes/unified-v4-derived-recovery.service";

const dates = Array.from({ length: 8 }, (_, index) => `2071-01-${String(index + 1).padStart(2, "0")}`);

function reset(blocks = true) {
  mocks.state.lifecycle = {
    unifiedTargetRevision: V4,
    unifiedRolloutEpoch: 1,
    productionStaleFromDate: null,
    productionPublishedGeneration: 12,
    invalidationGeneration: 12,
  };
  mocks.state.blocks = blocks
    ? [
      ...dates.map((date) => ({ source: "health", sourceKey: date, fromDate: date, revision: 1 })),
      { source: "training", sourceKey: "20", fromDate: "2071-01-09", revision: 3 },
    ]
    : [];
  mocks.state.failAt = null;
  mocks.state.failClear = null;
  mocks.prisma.physiologyV7Lifecycle.findUnique.mockImplementation(async () => ({ ...mocks.state.lifecycle }));
  mocks.prisma.unifiedPublicationBlock.findMany.mockImplementation(async () => mocks.state.blocks.map((block) => ({ ...block })));
  mocks.prisma.unifiedPublicationBlock.findUnique.mockImplementation(async (args: { where: { profileId_source_sourceKey: { source: string; sourceKey: string } } }) => {
    const key = args.where.profileId_source_sourceKey;
    return mocks.state.blocks.find((block) => block.source === key.source && block.sourceKey === key.sourceKey) ?? null;
  });
  mocks.prisma.unifiedPublicationBlock.count.mockImplementation(async () => mocks.state.blocks.length);
  mocks.prisma.dailyHealthData.findMany.mockImplementation(async () => dates.map((date) => ({ date, weightKg: 80 })));
  mocks.prisma.healthMetricSample.findMany.mockResolvedValue([]);
  mocks.prisma.strengthDiarySession.findFirst.mockResolvedValue({ id: 20 });
  mocks.clear.mockClear();
  mocks.shadow.mockClear();
  mocks.training.mockClear();
  mocks.inventory.mockClear();
  mocks.recalculate.mockClear();
  mocks.replay.mockClear();
}

describe("persisted-source V4 derived recovery", () => {
  beforeEach(() => reset());

  it("refreshes all persisted dependencies, CAS-clears nine fences, and preserves epoch 1", async () => {
    const result = await recoverUnifiedV4FromPersistedSourcesV1({ profileId: 1, ownerAuthorized: true });
    expect(mocks.shadow).toHaveBeenCalled();
    expect(mocks.training).toHaveBeenCalledWith({
      sessionId: 20, profileId: 1,
      expectedTrainingFence: { revision: 3, fromDate: "2071-01-09" },
    });
    expect(mocks.clear).toHaveBeenCalledTimes(9);
    expect(mocks.state.blocks).toHaveLength(0);
    expect(mocks.replay).toHaveBeenCalledWith({ profileId: 1, client: mocks.prisma });
    expect(result).toMatchObject({ rolloutEpoch: 1, dayCount: 9, healthDatesRefreshed: dates, trainingSessionIdsRefreshed: [20] });
    expect(result.rawInputFingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it("leaves fences armed and withholds V4 when a dependent refresh returns P2034", async () => {
    mocks.state.failAt = "health";
    await expect(recoverUnifiedV4FromPersistedSourcesV1({ profileId: 1, ownerAuthorized: true }))
      .rejects.toMatchObject({ code: "P2034" });
    expect(mocks.clear).not.toHaveBeenCalled();
    expect(mocks.replay).not.toHaveBeenCalled();
    expect(mocks.state.blocks).toHaveLength(9);
  });

  it("fails closed on a changed block revision before V4 publication", async () => {
    mocks.state.failClear = dates[0]!;
    await expect(recoverUnifiedV4FromPersistedSourcesV1({ profileId: 1, ownerAuthorized: true }))
      .rejects.toThrow("health source fence changed during dependent refresh");
    expect(mocks.replay).not.toHaveBeenCalled();
  });

  it("does not clear Health blocks when production recalculation remains stale", async () => {
    mocks.state.blocks = mocks.state.blocks.filter((block) => block.source === "health");
    mocks.state.lifecycle.productionStaleFromDate = "2071-01-01";
    mocks.state.lifecycle.productionPublishedGeneration = 11;
    mocks.state.failAt = "production";
    await expect(recoverUnifiedV4FromPersistedSourcesV1({ profileId: 1, ownerAuthorized: true }))
      .rejects.toThrow("Production generation remains stale");
    expect(mocks.clear).not.toHaveBeenCalled();
    expect(mocks.recalculate).toHaveBeenCalledWith({ skipTrainingAccountingMaterialization: true });
    expect(mocks.replay).not.toHaveBeenCalled();
    expect(mocks.state.blocks).toHaveLength(8);
  });

  it("can safely retry after all dependency blocks cleared but publication failed", async () => {
    reset(false);
    mocks.replay.mockRejectedValueOnce(Object.assign(new Error("serialization conflict"), { code: "P2034" }));
    await expect(recoverUnifiedV4FromPersistedSourcesV1({ profileId: 1, ownerAuthorized: true }))
      .rejects.toMatchObject({ code: "P2034" });
    await expect(recoverUnifiedV4FromPersistedSourcesV1({ profileId: 1, ownerAuthorized: true }))
      .resolves.toMatchObject({ rolloutEpoch: 1, dayCount: 9 });
    expect(mocks.clear).not.toHaveBeenCalled();
    expect(mocks.shadow).not.toHaveBeenCalled();
  });

  it("rejects an epoch change and unknown source blockers", async () => {
    mocks.state.lifecycle.unifiedRolloutEpoch = 2;
    await expect(recoverUnifiedV4FromPersistedSourcesV1({ profileId: 1, ownerAuthorized: true }))
      .rejects.toThrow("existing V4 epoch 1");
    reset();
    mocks.state.blocks.push({ source: "day", sourceKey: "2071-01-01", fromDate: "2071-01-01", revision: 1 });
    await expect(recoverUnifiedV4FromPersistedSourcesV1({ profileId: 1, ownerAuthorized: true }))
      .rejects.toThrow("unsupported publication block set");
  });
});
