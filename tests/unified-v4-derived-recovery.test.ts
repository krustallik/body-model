import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const state: {
    lifecycle: Record<string, unknown>;
    blocks: Array<{ source: string; sourceKey: string; fromDate: string; revision: number }>;
    failAt: string | null;
    failClear: string | null;
    invalidTrainingSession: number | null;
  } = { lifecycle: {}, blocks: [], failAt: null, failClear: null, invalidTrainingSession: null };
  let prisma: Record<string, any>;
  prisma = {
    $queryRawUnsafe: vi.fn(async () => []),
    $transaction: vi.fn(async (callback: (tx: any) => Promise<unknown>) => callback(prisma)),
    physiologyV7Lifecycle: { findUnique: vi.fn() },
    unifiedPublicationBlock: { findMany: vi.fn(), findUnique: vi.fn(), count: vi.fn() },
    dailyHealthData: { findMany: vi.fn() },
    healthMetricSample: { findMany: vi.fn() },
    strengthDiarySession: { findFirst: vi.fn() },
  };
  const shadow = vi.fn(async () => {
    if (state.failAt === "health") throw Object.assign(new Error("transaction conflict"), { code: "P2034" });
  });
  const training = vi.fn(async (input: { sessionId: number }) => {
    if (state.failAt === "training" || state.failAt === `training:${input.sessionId}`) {
      throw Object.assign(new Error("transaction conflict"), { code: "P2034" });
    }
  });
  const assertTrainingReady = vi.fn(async ({ sessionId }: { sessionId: number }) => {
    if (state.invalidTrainingSession === sessionId) throw new Error("Training recovery requires the current persisted accounting snapshot");
  });
  const clearAll = vi.fn(async (input: { blocks: Array<{ source: string; sourceKey: string; expectedRevision: number; expectedFromDate: string }> }) => {
    const failed = input.blocks.find((block) => block.sourceKey === state.failClear);
    if (failed) throw new Error(`${failed.source} source fence changed during dependent refresh (${failed.sourceKey})`);
    const current = [...state.blocks].sort((left, right) => `${left.source}\0${left.sourceKey}`.localeCompare(`${right.source}\0${right.sourceKey}`));
    const expected = [...input.blocks].sort((left, right) => `${left.source}\0${left.sourceKey}`.localeCompare(`${right.source}\0${right.sourceKey}`));
    if (current.length !== expected.length || expected.some((block, index) => current[index]?.source !== block.source
      || current[index]?.sourceKey !== block.sourceKey || current[index]?.revision !== block.expectedRevision
      || current[index]?.fromDate !== block.expectedFromDate)) {
      throw new Error("Full publication fence set changed; no recovery fences were cleared");
    }
    state.blocks = [];
  });
  return {
    state,
    prisma,
    shadow,
    training,
    clearAll,
    assertTrainingReady,
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
    clearUnifiedPublicationBlocks = mocks.clearAll;
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
  assertPersistedTrainingSessionRecoveryReadyV1: mocks.assertTrainingReady,
  refreshPersistedTrainingSessionDependenciesV1: mocks.training,
  recordExperimentalStrengthShadowsForWeightDate: mocks.shadow,
}));

import { UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V4_REVISION as V4 } from "@/model/unified-experimental-physiology-v1/contracts";
import { createV4RecoveryEvidenceBindingV1, inventoryV4RecoveryRawSourcesV1,
  recoverUnifiedV4FromPersistedSourcesV1 } from "@/modules/model-episodes/unified-v4-derived-recovery.service";

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
      { source: "training", sourceKey: "24", fromDate: "2071-01-10", revision: 1 },
      { source: "training", sourceKey: "25", fromDate: "2071-01-11", revision: 4 },
    ]
    : [];
  mocks.state.failAt = null;
  mocks.state.failClear = null;
  mocks.state.invalidTrainingSession = null;
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
  mocks.clearAll.mockClear();
  mocks.shadow.mockClear();
  mocks.training.mockClear();
  mocks.assertTrainingReady.mockClear();
  mocks.inventory.mockClear();
  mocks.recalculate.mockClear();
  mocks.replay.mockClear();
}

async function recover(expectedEvidenceBinding?: ReturnType<typeof createV4RecoveryEvidenceBindingV1>) {
  const raw = await inventoryV4RecoveryRawSourcesV1(mocks.prisma as never);
  const expected = expectedEvidenceBinding ?? createV4RecoveryEvidenceBindingV1({
    rawFingerprint: raw.fingerprint,
    blocks: mocks.state.blocks,
    lifecycle: mocks.state.lifecycle as never,
  });
  return recoverUnifiedV4FromPersistedSourcesV1({ profileId: 1, ownerAuthorized: true, expectedEvidenceBinding: expected });
}

describe("persisted-source V4 derived recovery", () => {
  beforeEach(() => reset());

  it("refreshes every persisted Training dependency deterministically and CAS-clears all fences", async () => {
    const result = await recover();
    expect(mocks.shadow).toHaveBeenCalled();
    expect(mocks.training).toHaveBeenCalledWith({
      sessionId: 20, profileId: 1,
      expectedTrainingFence: { revision: 3, fromDate: "2071-01-09" },
    });
    expect(mocks.training.mock.calls.map(([input]) => input.sessionId)).toEqual([20, 24, 25]);
    expect(mocks.assertTrainingReady.mock.calls.map(([input]) => input.sessionId)).toEqual([20, 24, 25, 20, 24, 25]);
    expect(mocks.clearAll).toHaveBeenCalledTimes(1);
    expect(mocks.state.blocks).toHaveLength(0);
    expect(mocks.replay).toHaveBeenCalledWith({ profileId: 1, client: mocks.prisma });
    expect(result).toMatchObject({ rolloutEpoch: 1, dayCount: 9, healthDatesRefreshed: dates, trainingSessionIdsRefreshed: [20, 24, 25] });
    expect(result.rawInputFingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it("leaves fences armed and withholds V4 when a dependent refresh returns P2034", async () => {
    mocks.state.failAt = "health";
    await expect(recover())
      .rejects.toMatchObject({ code: "P2034" });
    expect(mocks.clearAll).not.toHaveBeenCalled();
    expect(mocks.replay).not.toHaveBeenCalled();
    expect(mocks.state.blocks).toHaveLength(11);
  });

  it("validates every Training source before refreshing any Health dependency", async () => {
    mocks.state.invalidTrainingSession = 24;
    await expect(recover())
      .rejects.toThrow("current persisted accounting snapshot");
    expect(mocks.assertTrainingReady.mock.calls.map(([input]) => input.sessionId)).toEqual([20, 24]);
    expect(mocks.shadow).not.toHaveBeenCalled();
    expect(mocks.training).not.toHaveBeenCalled();
    expect(mocks.clearAll).not.toHaveBeenCalled();
    expect(mocks.replay).not.toHaveBeenCalled();
    expect(mocks.state.blocks).toHaveLength(11);
  });

  it.each(["raw fingerprint", "fence digest", "lifecycle generation"] as const)(
    "fails closed before the first derived write when the rehearsed %s binding is stale",
    async (changedBinding) => {
      const raw = await inventoryV4RecoveryRawSourcesV1(mocks.prisma as never);
      const expected = createV4RecoveryEvidenceBindingV1({
        rawFingerprint: raw.fingerprint, blocks: mocks.state.blocks, lifecycle: mocks.state.lifecycle as never,
      });
      if (changedBinding === "raw fingerprint") expected.rawFingerprint = "f".repeat(64);
      if (changedBinding === "fence digest") expected.fenceDigest = "e".repeat(64);
      if (changedBinding === "lifecycle generation") expected.lifecycleDigest = "d".repeat(64);
      await expect(recover(expected)).rejects.toThrow(/changed after exact-image rehearsal/);
      expect(mocks.shadow).not.toHaveBeenCalled();
      expect(mocks.training).not.toHaveBeenCalled();
      expect(mocks.clearAll).not.toHaveBeenCalled();
      expect(mocks.replay).not.toHaveBeenCalled();
      expect(mocks.state.blocks).toHaveLength(11);
    },
  );

  it("withholds fence clearing and V4 publication if the second Training refresh fails", async () => {
    mocks.state.failAt = "training:24";
    await expect(recover())
      .rejects.toMatchObject({ code: "P2034" });
    expect(mocks.training.mock.calls.map(([input]) => input.sessionId)).toEqual([20, 24]);
    expect(mocks.clearAll).not.toHaveBeenCalled();
    expect(mocks.replay).not.toHaveBeenCalled();
    expect(mocks.state.blocks).toHaveLength(11);
  });

  it("retains the complete fence set when the final CAS token no longer matches", async () => {
    mocks.state.failClear = dates[0]!;
    await expect(recover())
      .rejects.toThrow("health source fence changed during dependent refresh");
    expect(mocks.state.blocks).toHaveLength(11);
    expect(mocks.replay).not.toHaveBeenCalled();
  });

  it("does not clear Health blocks when production recalculation remains stale", async () => {
    mocks.state.blocks = mocks.state.blocks.filter((block) => block.source === "health");
    mocks.state.lifecycle.productionStaleFromDate = "2071-01-01";
    mocks.state.lifecycle.productionPublishedGeneration = 11;
    mocks.state.failAt = "production";
    await expect(recover())
      .rejects.toThrow("Production generation remains stale");
    expect(mocks.clearAll).not.toHaveBeenCalled();
    expect(mocks.recalculate).toHaveBeenCalledWith({ skipTrainingAccountingMaterialization: true });
    expect(mocks.replay).not.toHaveBeenCalled();
    expect(mocks.state.blocks).toHaveLength(8);
  });

  it("can safely retry after all dependency blocks cleared but publication failed", async () => {
    reset(false);
    mocks.replay.mockRejectedValueOnce(Object.assign(new Error("serialization conflict"), { code: "P2034" }));
    await expect(recover())
      .rejects.toMatchObject({ code: "P2034" });
    await expect(recover())
      .resolves.toMatchObject({ rolloutEpoch: 1, dayCount: 9 });
    expect(mocks.clearAll.mock.calls.map(([input]) => input.blocks)).toEqual([[], []]);
    expect(mocks.shadow).not.toHaveBeenCalled();
  });

  it("rejects an epoch change and unknown source blockers", async () => {
    mocks.state.lifecycle.unifiedRolloutEpoch = 2;
    await expect(recover())
      .rejects.toThrow("existing V4 epoch 1");
    reset();
    mocks.state.blocks.push({ source: "day", sourceKey: "2071-01-01", fromDate: "2071-01-01", revision: 1 });
    await expect(recover())
      .rejects.toThrow("unsupported publication block set");
  });

  it.each([
    ["non-canonical Training identity", { source: "training", sourceKey: "020", fromDate: "2071-01-20", revision: 1 }],
    ["invalid Training model date", { source: "training", sourceKey: "26", fromDate: "2071-02-30", revision: 1 }],
    ["zero Training revision", { source: "training", sourceKey: "26", fromDate: "2071-01-20", revision: 0 }],
    ["unsupported fence identity", { source: "garmin", sourceKey: "26", fromDate: "2071-01-20", revision: 1 }],
  ])("rejects %s before refreshing or clearing any source", async (_name, invalidBlock) => {
    mocks.state.blocks.push(invalidBlock);
    await expect(recover())
      .rejects.toThrow("unsupported publication block set");
    expect(mocks.shadow).not.toHaveBeenCalled();
    expect(mocks.training).not.toHaveBeenCalled();
    expect(mocks.clearAll).not.toHaveBeenCalled();
    expect(mocks.replay).not.toHaveBeenCalled();
  });

  it("rejects duplicate Training fence identities before dependent work", async () => {
    mocks.state.blocks.push({ ...mocks.state.blocks.find((block) => block.source === "training" && block.sourceKey === "24")! });
    await expect(recover())
      .rejects.toThrow("unsupported publication block set");
    expect(mocks.shadow).not.toHaveBeenCalled();
    expect(mocks.training).not.toHaveBeenCalled();
    expect(mocks.clearAll).not.toHaveBeenCalled();
    expect(mocks.replay).not.toHaveBeenCalled();
  });
});
