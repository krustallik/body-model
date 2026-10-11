import { beforeEach, describe, expect, it, vi } from "vitest";

const V3 = "unified-experimental-physiology-state-v3-relative-muscle-daily-cumulative-diagnostics";

const mocks = vi.hoisted(() => {
  const state = {
    rawSourceMutation: false,
    modelEpisodeSourceMutation: false,
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
    rebuildTransientWater: vi.fn(),
    rebuildUnified: vi.fn(),
    verifyV3Postflight: vi.fn(),
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
vi.mock("@/modules/model-episodes/unified-rollout-v4.service", () => ({
  verifyAndPublishUnifiedV3Postflight: mocks.verifyV3Postflight,
}));
vi.mock("@/modules/training/experimental-transient-exercise-water-shadow.service", () => ({
  rebuildExperimentalTransientExerciseWaterV2: mocks.rebuildTransientWater,
}));
import {
  FULL_HISTORY_REBUILT_DERIVED_TABLES,
  FULL_HISTORY_RAW_INPUT_TABLES,
  inventoryFullHistoryRawInputs,
  runOwnerAuthorizedFullHistoryRecalculation,
} from "@/modules/model-episodes/full-history-recalculation.service";

describe("runOwnerAuthorizedFullHistoryRecalculation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.state.rawSourceMutation = false;
    mocks.state.modelEpisodeSourceMutation = false;
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
      const canonicalRow = table === "ModelEpisode"
        ? {
            id: 11,
            profileId: 1,
            startDate: "2024-01-01",
            initialGlycogenKg: mocks.state.modelEpisodeSourceMutation ? 0.6 : 0.5,
          }
        : { id: 1, sourceValue, updatedAt: "2026-01-01T00:00:00.000Z" };
      return [{
        id: table === "ModelEpisode" ? 11 : 1,
        canonical_row: JSON.stringify(canonicalRow),
      }];
    });
    mocks.invalidate.mockResolvedValue({});
    mocks.rebuildTransientWater.mockResolvedValue({
      earliestModelDate: "2024-01-01",
      sourceToken: "transient-water-source-token",
      impulseCount: 4,
    });
    mocks.recalculateModelEpisode.mockResolvedValue({
      status: "ok",
      episodeId: 11,
      daysPersisted: 10,
      completeDays: 9,
      latestModeledDate: "2026-01-09",
    });
    mocks.rebuildUnified.mockResolvedValue(undefined);
    mocks.verifyV3Postflight.mockImplementation(async () => {
      mocks.state.lifecycle.unifiedPublishedRolloutEpoch = 0;
      return { profileId: 1, dayCount: 1, rangeToken: "v3-postflight-token" };
    });
  });

  it("refreshes transient episode attribution before invalidation, recalculation, and Unified V3", async () => {
    const result = await runOwnerAuthorizedFullHistoryRecalculation({
      profileId: 1,
      ownerAuthorized: true,
    });

    expect(mocks.rebuildTransientWater).toHaveBeenCalledWith({ profileId: 1, client: expect.anything() });
    expect(mocks.invalidate).toHaveBeenCalledWith(1, "2024-01-01");
    expect(mocks.recalculateModelEpisode).toHaveBeenCalledWith({ episodeId: 11 }, expect.anything());
    expect(mocks.rebuildUnified).toHaveBeenCalledWith({
      profileId: 1,
      client: expect.anything(),
      targetRevision: V3,
      rolloutEpoch: 0,
    });
    expect(mocks.verifyV3Postflight).toHaveBeenCalledWith({ profileId: 1, client: expect.anything() });
    expect(mocks.rebuildTransientWater.mock.invocationCallOrder[0]).toBeLessThan(mocks.invalidate.mock.invocationCallOrder[0]!);
    expect(mocks.invalidate.mock.invocationCallOrder[0]).toBeLessThan(mocks.recalculateModelEpisode.mock.invocationCallOrder[0]!);
    expect(mocks.recalculateModelEpisode.mock.invocationCallOrder[0]).toBeLessThan(mocks.rebuildUnified.mock.invocationCallOrder[0]!);
    expect(mocks.rebuildUnified.mock.invocationCallOrder[0]).toBeLessThan(mocks.verifyV3Postflight.mock.invocationCallOrder[0]!);
    expect(result).toMatchObject({
      profileId: 1,
      episodeId: 11,
      invalidationGeneration: 7,
      productionPublishedGeneration: 7,
      unifiedPublishedGeneration: 7,
      rawInputFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      transientWaterImpulseCount: 4,
      transientWaterEarliestModelDate: "2024-01-01",
    });
  });

  it("publishes V3 postflight epoch after invalidation clears it", async () => {
    const generation = 8;
    mocks.invalidate.mockImplementation(async () => {
      mocks.state.lifecycle = {
        ...mocks.state.lifecycle,
        invalidationGeneration: generation,
        productionStaleFromDate: "2024-01-01",
        productionPublishedGeneration: null,
        unifiedPublishedGeneration: null,
        unifiedPublishedRolloutEpoch: null,
      };
    });
    mocks.recalculateModelEpisode.mockImplementation(async () => {
      mocks.state.lifecycle = {
        ...mocks.state.lifecycle,
        productionStaleFromDate: null,
        productionPublishedGeneration: generation,
      };
      return {
        status: "ok",
        episodeId: 11,
        daysPersisted: 10,
        completeDays: 9,
        latestModeledDate: "2026-01-09",
      };
    });
    mocks.rebuildUnified.mockImplementation(async () => {
      mocks.state.lifecycle = {
        ...mocks.state.lifecycle,
        unifiedPublishedGeneration: generation,
        unifiedTargetRevision: V3,
        unifiedRolloutEpoch: 0,
        unifiedPublishedRolloutEpoch: null,
      };
    });
    mocks.verifyV3Postflight.mockImplementation(async () => {
      expect(mocks.state.lifecycle.unifiedPublishedRolloutEpoch).toBeNull();
      mocks.state.lifecycle.unifiedPublishedRolloutEpoch = 0;
      return { profileId: 1, dayCount: 1, rangeToken: "verified-v3-range" };
    });

    const result = await runOwnerAuthorizedFullHistoryRecalculation({
      profileId: 1,
      ownerAuthorized: true,
    });

    expect(result).toMatchObject({
      invalidationGeneration: generation,
      productionPublishedGeneration: generation,
      unifiedPublishedGeneration: generation,
    });
    expect(mocks.state.lifecycle.unifiedPublishedRolloutEpoch).toBe(0);
    expect(mocks.verifyV3Postflight.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.rebuildUnified.mock.invocationCallOrder[0]!);
  });

  it("does not report recalculation success when V3 postflight fails", async () => {
    mocks.verifyV3Postflight.mockRejectedValue(new Error("V3 source coverage is stale"));

    await expect(runOwnerAuthorizedFullHistoryRecalculation({
      profileId: 1,
      ownerAuthorized: true,
    })).rejects.toThrow("V3 source coverage is stale");
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
      "ModelEpisode",
      "Workout",
      "StrengthSessionExercise",
      "StrengthSet",
    ]));
    expect(FULL_HISTORY_RAW_INPUT_TABLES).toEqual(expect.arrayContaining([
      "StepperReconciliationGroup",
      "StepperReconciliationCandidate",
    ]));
    expect(FULL_HISTORY_REBUILT_DERIVED_TABLES).toEqual(expect.arrayContaining([
      "StrengthSessionAccountingSnapshot",
      "StrengthSessionAccountingOperation",
      "ActiveEnergyCanonicalEvent",
      "ActiveEnergyEventAlias",
      "ActiveEnergyCandidate",
      "ActiveEnergyResolutionRevision",
    ]));
    for (const derivedTable of FULL_HISTORY_REBUILT_DERIVED_TABLES) {
      expect(FULL_HISTORY_RAW_INPUT_TABLES).not.toContain(derivedTable);
    }
  });

  it("fingerprints complete canonical row values, not only row IDs or timestamps", async () => {
    const before = await inventoryFullHistoryRawInputs({ $queryRawUnsafe: mocks.queryRawUnsafe } as never);
    mocks.state.rawSourceMutation = true;
    const after = await inventoryFullHistoryRawInputs({ $queryRawUnsafe: mocks.queryRawUnsafe } as never);

    expect(after.fingerprint).not.toBe(before.fingerprint);
    expect(after.tables.find((table) => table.table === "DailyHealthData")?.contentSha256)
      .not.toBe(before.tables.find((table) => table.table === "DailyHealthData")?.contentSha256);
  });

  it("fingerprints frozen episode initialization inputs and uses a narrow derived-output projection", async () => {
    await inventoryFullHistoryRawInputs({ $queryRawUnsafe: mocks.queryRawUnsafe } as never);
    const episodeQuery = mocks.queryRawUnsafe.mock.calls
      .map(([sql]) => String(sql))
      .find((sql) => sql.includes('public."ModelEpisode"'));
    expect(episodeQuery).toContain("to_jsonb(source_row) - ARRAY[");
    for (const outputField of [
      "personalOffsetKcalPerDay",
      "activityCalibration",
      "calibrationStatus",
      "calibrationDiagnostics",
      "latestModeledDate",
      "updatedAt",
    ]) {
      expect(episodeQuery).toContain(`'${outputField}'`);
    }

    const before = await inventoryFullHistoryRawInputs({ $queryRawUnsafe: mocks.queryRawUnsafe } as never);
    mocks.state.modelEpisodeSourceMutation = true;
    const after = await inventoryFullHistoryRawInputs({ $queryRawUnsafe: mocks.queryRawUnsafe } as never);

    expect(after.fingerprint).not.toBe(before.fingerprint);
    expect(after.tables.find((table) => table.table === "ModelEpisode")?.contentSha256)
      .not.toBe(before.tables.find((table) => table.table === "ModelEpisode")?.contentSha256);
  });

  it("normalizes only materialization-owned session outputs while retaining semantic accounting inputs", async () => {
    await inventoryFullHistoryRawInputs({ $queryRawUnsafe: mocks.queryRawUnsafe } as never);
    const sessionQuery = mocks.queryRawUnsafe.mock.calls
      .map(([sql]) => String(sql))
      .find((sql) => sql.includes('public."StrengthDiarySession"'));
    const sessionCall = mocks.queryRawUnsafe.mock.calls.find(([sql]) => String(sql).includes('public."StrengthDiarySession"'));
    const profileCall = mocks.queryRawUnsafe.mock.calls.find(([sql]) => String(sql).includes('public."Profile"'));
    expect(sessionQuery).toContain('LEFT JOIN public."Workout" AS matched_workout');
    expect(sessionQuery).toContain('source_row."effectiveAccountingAt", matched_workout."startAt", source_row."webStartedAt", source_row."createdAt"');
    expect(sessionQuery).toContain('COALESCE(source_row."accountingTimeZone", $3::text)');
    expect(sessionQuery).toContain("COALESCE(source_row.\"accountingTimeZoneProvenance\", 'legacy-default')");
    for (const derivedField of ["currentSnapshotRevision", "updatedAt", "effectiveAccountingAt", "accountingTimeZone", "accountingTimeZoneProvenance"]) {
      expect(sessionQuery).toContain(`'${derivedField}'`);
    }
    expect(FULL_HISTORY_RAW_INPUT_TABLES).toContain("StrengthDiarySession");
    expect(sessionCall).toHaveLength(4);
    expect(sessionCall?.[3]).toBe("Europe/Bratislava");
    expect(profileCall).toHaveLength(3);
  });

  it("fail-closes when Unified is not V3 epoch 0", async () => {
    mocks.state.lifecycle.unifiedTargetRevision = "unified-experimental-physiology-state-v4-physical-glycogen-water-2p7-exact-once";
    mocks.state.lifecycle.unifiedRolloutEpoch = 1;
    await expect(runOwnerAuthorizedFullHistoryRecalculation({
      profileId: 1,
      ownerAuthorized: true,
    })).rejects.toThrow(/Unified V3 epoch 0/);
    expect(mocks.rebuildTransientWater).not.toHaveBeenCalled();
    expect(mocks.invalidate).not.toHaveBeenCalled();
    expect(mocks.recalculateModelEpisode).not.toHaveBeenCalled();
    expect(mocks.rebuildUnified).not.toHaveBeenCalled();
  });

  it("rechecks the V3 epoch after transient rebuild before any publication mutation", async () => {
    mocks.rebuildTransientWater.mockImplementation(async () => {
      mocks.state.lifecycle.unifiedTargetRevision = "unified-experimental-physiology-state-v4-physical-glycogen-water-2p7-exact-once";
      mocks.state.lifecycle.unifiedRolloutEpoch = 1;
      return {
        earliestModelDate: "2024-01-01",
        sourceToken: "transient-water-source-token",
        impulseCount: 4,
      };
    });

    await expect(runOwnerAuthorizedFullHistoryRecalculation({
      profileId: 1,
      ownerAuthorized: true,
    })).rejects.toThrow(/Unified V3 epoch 0/);

    expect(mocks.rebuildTransientWater).toHaveBeenCalledTimes(1);
    expect(mocks.findUniqueLifecycle).toHaveBeenCalledTimes(2);
    expect(mocks.invalidate).not.toHaveBeenCalled();
    expect(mocks.recalculateModelEpisode).not.toHaveBeenCalled();
    expect(mocks.rebuildUnified).not.toHaveBeenCalled();
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
