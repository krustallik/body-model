import { beforeEach, describe, expect, it, vi } from "vitest";

const V3 = "unified-experimental-physiology-state-v3-relative-muscle-daily-cumulative-diagnostics";

const mocks = vi.hoisted(() => {
  const state = {
    rawSourceMutation: false,
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
import {
  FULL_HISTORY_RAW_INPUT_TABLES,
  inventoryFullHistoryRawInputs,
  runOwnerAuthorizedFullHistoryRecalculation,
} from "@/modules/model-episodes/full-history-recalculation.service";

describe("runOwnerAuthorizedFullHistoryRecalculation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.state.rawSourceMutation = false;
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
    mocks.queryRawUnsafe.mockImplementation(async (sql: string, afterId: number) => {
      const table = FULL_HISTORY_RAW_INPUT_TABLES.find((candidate) => sql.includes(`public."${candidate}"`));
      if (!table) throw new Error("Unexpected raw inventory table");
      if (afterId !== -2_147_483_649) return [];
      const sourceValue = table === "DailyHealthData" && mocks.state.rawSourceMutation ? 82.25 : 82.5;
      return [{
        id: 1,
        canonical_row: JSON.stringify({ id: 1, sourceValue, updatedAt: "2026-01-01T00:00:00.000Z" }),
      }];
    });
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
      rawInputFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });

  it("fail-closes when raw observation inventory changes", async () => {
    mocks.recalculateModelEpisode.mockImplementation(async () => {
      mocks.state.rawSourceMutation = true;
      return {
        status: "ok",
        episodeId: 11,
        daysPersisted: 10,
        completeDays: 9,
        latestModeledDate: "2026-01-09",
      };
    });
    await expect(runOwnerAuthorizedFullHistoryRecalculation({
      profileId: 1,
      ownerAuthorized: true,
    })).rejects.toThrow(/raw observation inputs/);
  });

  it("covers raw measurement, sleep, source provenance, and strength input tables", () => {
    expect(FULL_HISTORY_RAW_INPUT_TABLES).toEqual(expect.arrayContaining([
      "HealthMetricSample",
      "RestingHeartRateSample",
      "SleepSegment",
      "HealthSyncSnapshot",
      "HealthSyncAudit",
      "Workout",
      "StrengthSessionExercise",
      "StrengthSet",
    ]));
  });

  it("fingerprints complete canonical row values, not only row IDs or timestamps", async () => {
    const before = await inventoryFullHistoryRawInputs({ $queryRawUnsafe: mocks.queryRawUnsafe } as never);
    mocks.state.rawSourceMutation = true;
    const after = await inventoryFullHistoryRawInputs({ $queryRawUnsafe: mocks.queryRawUnsafe } as never);

    expect(after.fingerprint).not.toBe(before.fingerprint);
    expect(after.tables.find((table) => table.table === "DailyHealthData")?.contentSha256)
      .not.toBe(before.tables.find((table) => table.table === "DailyHealthData")?.contentSha256);
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
      profileId: 1,
      ownerAuthorized: false as true,
    })).rejects.toThrow(/owner authorization/);
    await expect(runOwnerAuthorizedFullHistoryRecalculation({
      profileId: 0,
      ownerAuthorized: true,
    })).rejects.toThrow(/positive integer/);
  });
});
