import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

const mocks = vi.hoisted(() => {
  const state: {
    lifecycle: Record<string, unknown>;
    blocks: Array<{ source: string; sourceKey: string; fromDate: string; revision: number }>;
    failAt: string | null;
    failClear: string | null;
    invalidTrainingSession: number | null;
    inventoryRows: Record<string, Array<{ id: number; raw_row: string }>>;
    inventoryMetadataByteOverrides: Record<string, number>;
    inventoryReturnedBytes: number[];
    inventoryBoundBatchSizes: Array<{ rowCount: number; jsonbBytes: number }>;
    missingTrainingSessions: number[];
  } = { lifecycle: {}, blocks: [], failAt: null, failClear: null, invalidTrainingSession: null,
    inventoryRows: {}, inventoryMetadataByteOverrides: {}, inventoryReturnedBytes: [], inventoryBoundBatchSizes: [],
    missingTrainingSessions: [] };
  const queryRaw = vi.fn(async (query: string, ...parameters: unknown[]) => {
    const table = /FROM public\."([^"]+)"/.exec(query)?.[1];
    if (!table) return [];
    const rows = [...(state.inventoryRows[table] ?? [])].sort((left, right) => left.id - right.id);
    if (query.includes("COUNT(*)")) return [{ row_count: BigInt(rows.length) }];
    if (query.includes("AS raw_row_jsonb_bytes")) {
      const afterId = Number(parameters[0]);
      const limit = Number(parameters[1]);
      return rows.filter((row) => row.id > afterId).slice(0, limit).map((row) => ({
        id: row.id,
        raw_row_jsonb_bytes: BigInt(Buffer.byteLength(row.raw_row, "utf8")),
      }));
    }
    if (query.includes("AS raw_row_upper_bytes")) {
      const afterId = Number(parameters[0]);
      const throughId = Number(parameters[1]);
      const maxRowBytes = Number(parameters[2]);
      const selected = rows.filter((row) => row.id > afterId && row.id <= throughId);
      state.inventoryBoundBatchSizes.push({
        rowCount: selected.length,
        jsonbBytes: selected.reduce((sum, row) => sum + Buffer.byteLength(row.raw_row, "utf8"), 0),
      });
      return selected.map((row) => ({
        id: row.id,
        raw_row_upper_bytes: BigInt(state.inventoryMetadataByteOverrides[`${table}:${row.id}`]
          ?? Buffer.byteLength(row.raw_row, "utf8") * 6),
        raw_row_bytes: (state.inventoryMetadataByteOverrides[`${table}:${row.id}`] ?? 0) > maxRowBytes
          ? null : BigInt(Buffer.byteLength(row.raw_row, "utf8")),
      }));
    }
    if (query.includes("rendered_row.raw_row")) {
      const id = Number(parameters[0]);
      const length = Number(parameters[1]);
      const row = rows.find((candidate) => candidate.id === id);
      if (!row) return [];
      const chunks: Array<{ chunk_index: number; raw_row_chunk: string }> = [];
      let chunkText = "";
      let chunkCharacters = 0;
      for (const character of row.raw_row) {
        chunkText += character;
        chunkCharacters += 1;
        if (chunkCharacters === length) {
          chunks.push({ chunk_index: chunks.length, raw_row_chunk: chunkText });
          state.inventoryReturnedBytes.push(Buffer.byteLength(chunkText, "utf8"));
          chunkText = "";
          chunkCharacters = 0;
        }
      }
      if (chunkText.length > 0) {
        chunks.push({ chunk_index: chunks.length, raw_row_chunk: chunkText });
        state.inventoryReturnedBytes.push(Buffer.byteLength(chunkText, "utf8"));
      }
      return chunks;
    }
    if (query.includes("AS raw_row\n")) {
      const afterId = Number(parameters[0]);
      const throughId = Number(parameters[1]);
      const selected = rows.filter((row) => row.id > afterId && row.id <= throughId);
      state.inventoryReturnedBytes.push(selected.reduce((sum, row) => sum + Buffer.byteLength(row.raw_row, "utf8"), 0));
      return selected;
    }
    return [];
  });
  const prisma = {
    $queryRawUnsafe: queryRaw,
    $transaction: vi.fn(),
    physiologyV7Lifecycle: { findUnique: vi.fn() },
    unifiedPublicationBlock: { findMany: vi.fn(), findUnique: vi.fn(), count: vi.fn() },
    unifiedExperimentalPhysiologyStateV2: { count: vi.fn(async () => 9) },
    dailyHealthData: { findMany: vi.fn() },
    healthMetricSample: { findMany: vi.fn() },
    strengthDiarySession: { findFirst: vi.fn(), findUnique: vi.fn() },
    strengthSet: { findUnique: vi.fn(async () => null) },
    strengthSessionExercise: { findUnique: vi.fn(async () => null) },
  };
  const shadow = vi.fn(async () => {
    if (state.failAt === "audit-change") {
      state.inventoryRows.HealthSyncAudit = [{ id: 1, raw_row: "{\"body\":\"changed-during-recovery\"}" }];
    }
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
  const refreshDeletedTraining = vi.fn(async () => {});
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
    queryRaw,
    shadow,
    training,
    clearAll,
    assertTrainingReady,
    refreshDeletedTraining,
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
  FULL_HISTORY_RAW_INPUT_TABLES: ["ModelEpisode", "HealthSyncAudit", "DailyHealthData", "StrengthDiarySession"],
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
  refreshDeletedCompletedSessionDependenciesForRecoveryV1: mocks.refreshDeletedTraining,
  refreshPersistedTrainingSessionDependenciesV1: mocks.training,
  recordExperimentalStrengthShadowsForWeightDate: mocks.shadow,
}));

import { UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V4_REVISION as V4 } from "@/model/unified-experimental-physiology-v1/contracts";
import { createV4RecoveryEvidenceBindingV1, inventoryV4RecoveryRawSourcesV1,
  recoverUnifiedV4FromPersistedSourcesV1 } from "@/modules/model-episodes/unified-v4-derived-recovery.service";

const dates = Array.from({ length: 8 }, (_, index) => `2071-01-${String(index + 1).padStart(2, "0")}`);

function reset(blocks = true) {
  mocks.prisma.$transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback(mocks.prisma));
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
  mocks.state.inventoryRows = {};
  mocks.queryRaw.mockClear();
  mocks.state.inventoryMetadataByteOverrides = {};
  mocks.state.inventoryReturnedBytes = [];
  mocks.state.inventoryBoundBatchSizes = [];
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
  mocks.state.missingTrainingSessions = [];
  mocks.prisma.strengthDiarySession.findUnique.mockImplementation(async (args: { where: { id: number } }) =>
    mocks.state.missingTrainingSessions.includes(args.where.id) ? null : { profileId: 1 });
  mocks.clearAll.mockClear();
  mocks.shadow.mockClear();
  mocks.training.mockClear();
  mocks.assertTrainingReady.mockClear();
  mocks.refreshDeletedTraining.mockClear();
  mocks.inventory.mockClear();
  mocks.recalculate.mockClear();
  mocks.replay.mockClear();
}

async function recover(expectedEvidenceBinding?: ReturnType<typeof createV4RecoveryEvidenceBindingV1>) {
  const raw = await inventoryV4RecoveryRawSourcesV1(mocks.prisma as never);
  const expected = expectedEvidenceBinding ?? createV4RecoveryEvidenceBindingV1({
    rawFingerprint: raw.fingerprint,
    healthSyncAuditFingerprint: raw.healthSyncAuditFingerprint,
    blocks: mocks.state.blocks,
    lifecycle: mocks.state.lifecycle as never,
  });
  return recoverUnifiedV4FromPersistedSourcesV1({ profileId: 1, ownerAuthorized: true, expectedEvidenceBinding: expected });
}

describe("persisted-source V4 derived recovery", () => {
  beforeEach(() => reset());

  it("preserves the exact V3 fingerprint while reading bounded pages and oversized rows", async () => {
    const rows = Array.from({ length: 257 }, (_, index) => ({
      id: (index + 1) * 2,
      raw_row: JSON.stringify({ fixture: "paged-recovery", index }),
    }));
    rows[251] = {
      id: rows[251]!.id,
      raw_row: JSON.stringify({ fixture: "paged-recovery-large", payload: `${"x".repeat(1_048_500)}${"💪".repeat(2 * 1024 * 1024)}` }),
    };
    mocks.state.inventoryRows.ModelEpisode = rows;

    const result = await inventoryV4RecoveryRawSourcesV1(mocks.prisma as never);
    const modelEpisodeDigest = createHash("sha256").update(`ModelEpisode\0${rows.length}\0`);
    for (const row of rows) {
      modelEpisodeDigest.update(`${row.id}:${Buffer.byteLength(row.raw_row, "utf8")}:${row.raw_row}\n`);
    }
    const expectedTables: Record<string, string> = {
      ModelEpisode: modelEpisodeDigest.digest("hex"),
      HealthSyncAudit: createHash("sha256").update(`HealthSyncAudit\0${0}\0`).digest("hex"),
      DailyHealthData: createHash("sha256").update(`DailyHealthData\0${0}\0`).digest("hex"),
    };
    for (const table of ["StrengthDiarySession", "StrengthSessionAccountingSnapshot", "StrengthSessionAccountingOperation"]) {
      expectedTables[table] = createHash("sha256").update(`${table}\0${0}\0`).digest("hex");
    }
    const expectedFingerprint = createHash("sha256").update("bodycast-v4-recovery-raw-sources-v3\0");
    for (const [table, tableDigest] of Object.entries(expectedTables)) {
      if (table !== "HealthSyncAudit") expectedFingerprint.update(`${table}\0${tableDigest}\0`);
    }

    expect(result.tables).toEqual(expectedTables);
    expect(result.fingerprint).toBe(expectedFingerprint.digest("hex"));
    expect(mocks.state.inventoryReturnedBytes.every((bytes) => bytes <= 8 * 1024 * 1024)).toBe(true);
    expect(mocks.state.inventoryReturnedBytes.some((bytes) => bytes > 0 && bytes < 8 * 1024 * 1024)).toBe(true);
    const metadataQueries = mocks.queryRaw.mock.calls.filter(([query]) => String(query).includes("AS raw_row_jsonb_bytes"));
    expect(metadataQueries.length).toBeGreaterThan(1);
    expect(metadataQueries.every(([query]) => String(query).includes("pg_column_size((to_jsonb(source_row)")
      && !String(query).includes("WITH RECURSIVE")
      && !String(query).includes("raw_row_jsonb::text")
      && !String(query).includes("octet_length"))).toBe(true);
    const boundQueries = mocks.queryRaw.mock.calls.filter(([query]) => String(query).includes("AS raw_row_upper_bytes"));
    expect(boundQueries.length).toBeGreaterThan(1);
    expect(boundQueries.every(([query]) => String(query).includes("pg_catalog.numeric_send")
      && String(query).includes("pg_column_size(raw_rows.raw_row_jsonb)::bigint * 6")
      && String(query).includes("CASE WHEN raw_row_upper_bytes <= $3::bigint")
      && String(query).includes("THEN octet_length(raw_row_jsonb::text)::bigint"))).toBe(true);
    expect(mocks.state.inventoryBoundBatchSizes.length).toBeGreaterThan(1);
    expect(mocks.state.inventoryBoundBatchSizes.every(({ rowCount, jsonbBytes }) =>
      jsonbBytes <= 1024 * 1024 || rowCount === 1)).toBe(true);
    expect(mocks.queryRaw.mock.calls.filter(([query]) => String(query).includes("WITH rendered_row AS MATERIALIZED"))).toHaveLength(1);
    expect(mocks.prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "RepeatableRead", maxWait: 10_000, timeout: 120_000,
    });
  });

  it("separates retention-managed HealthSyncAudit preservation from V4 currentness", async () => {
    mocks.state.inventoryRows.HealthSyncAudit = [{ id: 1, raw_row: "{\"body\":\"retained\"}" }];
    const baseline = await inventoryV4RecoveryRawSourcesV1(mocks.prisma as never);

    mocks.state.inventoryRows.HealthSyncAudit = [{ id: 1, raw_row: "{\"body\":\"expired\"}" }];
    const auditChanged = await inventoryV4RecoveryRawSourcesV1(mocks.prisma as never);
    expect(auditChanged.fingerprint).toBe(baseline.fingerprint);
    expect(auditChanged.healthSyncAuditFingerprint).not.toBe(baseline.healthSyncAuditFingerprint);
    expect(mocks.queryRaw.mock.calls.some(([query]) => String(query).includes('public.\"HealthSyncAudit\"'))).toBe(true);

    mocks.state.inventoryRows.DailyHealthData = [{ id: 1, raw_row: "{\"rawPayload\":\"changed\"}" }];
    const sourceChanged = await inventoryV4RecoveryRawSourcesV1(mocks.prisma as never);
    expect(sourceChanged.fingerprint).not.toBe(auditChanged.fingerprint);
  });

  it("fails closed before rendering an oversized single source row", async () => {
    mocks.state.inventoryRows.ModelEpisode = [{ id: 1, raw_row: "{}" }];
    mocks.state.inventoryMetadataByteOverrides["ModelEpisode:1"] = 64 * 1024 * 1024 + 1;

    await expect(inventoryV4RecoveryRawSourcesV1(mocks.prisma as never))
      .rejects.toThrow(/serialized-size upper bound exceeds its limit ModelEpisode row id=1 upperBytes=67108865/);
    expect(mocks.queryRaw.mock.calls.some(([query]) => String(query).includes("WITH rendered_row AS MATERIALIZED"))).toBe(false);
    expect(mocks.queryRaw.mock.calls.some(([query]) => String(query).includes("THEN octet_length(raw_row_jsonb::text)::bigint"))).toBe(true);
  });

  it("refreshes every persisted Training dependency deterministically and CAS-clears all fences", async () => {
    const result = await recover();
    expect(mocks.shadow).toHaveBeenCalled();
    expect(mocks.training).toHaveBeenCalledWith({
      sessionId: 20, profileId: 1,
      expectedTrainingFence: { revision: 3, fromDate: "2071-01-09" },
    });
    expect(mocks.training.mock.calls.map(([input]) => input.sessionId)).toEqual([20, 24, 25]);
    expect(mocks.assertTrainingReady.mock.calls.map(([input]) => input.sessionId)).toEqual([20, 24, 25]);
    expect(mocks.clearAll).toHaveBeenCalledTimes(1);
    expect(mocks.state.blocks).toHaveLength(0);
    expect(mocks.replay).toHaveBeenCalledWith({ profileId: 1, client: mocks.prisma });
    expect(result).toMatchObject({ rolloutEpoch: 1, dayCount: 9, alreadyCurrent: false,
      healthDatesRefreshed: dates, trainingSessionIdsRefreshed: [20, 24, 25] });
    expect(result.rawInputFingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rebinds already-current V4 with a read-only evidence check and no replay", async () => {
    reset(false);
    Object.assign(mocks.state.lifecycle, {
      unifiedPublishedGeneration: 12,
      unifiedPublishedRolloutEpoch: 1,
      unifiedPublicationBlockedFromDate: null,
      unifiedPublicationBlockedSource: null,
    });

    const result = await recover();

    expect(result).toMatchObject({ rolloutEpoch: 1, dayCount: 9, alreadyCurrent: true,
      healthDatesRefreshed: [], trainingSessionIdsRefreshed: [], deletedTrainingSessionIdsReconciled: [] });
    expect(mocks.prisma.unifiedExperimentalPhysiologyStateV2.count).toHaveBeenCalledTimes(2);
    expect(mocks.shadow).not.toHaveBeenCalled();
    expect(mocks.training).not.toHaveBeenCalled();
    expect(mocks.recalculate).not.toHaveBeenCalled();
    expect(mocks.clearAll).not.toHaveBeenCalled();
    expect(mocks.replay).not.toHaveBeenCalled();
    expect(mocks.state.blocks).toHaveLength(0);
  });

  it("fails closed when Unified is current but V7 production currentness is stale", async () => {
    reset(false);
    Object.assign(mocks.state.lifecycle, {
      productionStaleFromDate: "2071-01-01",
      productionPublishedGeneration: 11,
      unifiedPublishedGeneration: 12,
      unifiedPublishedRolloutEpoch: 1,
      unifiedPublicationBlockedFromDate: null,
      unifiedPublicationBlockedSource: null,
    });

    await expect(recover()).rejects.toThrow("cannot be treated as current while its V7 production generation is stale");
    expect(mocks.prisma.unifiedExperimentalPhysiologyStateV2.count).not.toHaveBeenCalled();
    expect(mocks.shadow).not.toHaveBeenCalled();
    expect(mocks.recalculate).not.toHaveBeenCalled();
    expect(mocks.clearAll).not.toHaveBeenCalled();
    expect(mocks.replay).not.toHaveBeenCalled();
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
        rawFingerprint: raw.fingerprint, healthSyncAuditFingerprint: raw.healthSyncAuditFingerprint,
        blocks: mocks.state.blocks, lifecycle: mocks.state.lifecycle as never,
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

  it("fails closed when audit payloads change after exact-image rehearsal", async () => {
    mocks.state.inventoryRows.HealthSyncAudit = [{ id: 1, raw_row: "{\"body\":\"retained\"}" }];
    mocks.state.failAt = "audit-change";

    const error = await recover().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors[1]).toMatchObject({ message: expect.stringContaining("HealthSyncAudit") });
    expect(mocks.clearAll).not.toHaveBeenCalled();
    expect(mocks.replay).not.toHaveBeenCalled();
    expect(mocks.state.blocks).toHaveLength(11);
  });

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
    expect(mocks.recalculate).toHaveBeenCalledWith({
      skipTrainingAccountingMaterialization: true,
      onConvergenceDiagnostic: expect.any(Function),
    });
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

  it("refreshes a child-deletion fence through its persisted parent session", async () => {
    mocks.state.blocks = [
      { source: "training", sourceKey: "training-delete-set:20:551", fromDate: "2071-01-09", revision: 7 },
      { source: "training", sourceKey: "training-delete-exercise:20:552", fromDate: "2071-01-08", revision: 8 },
    ];
    const result = await recover();
    expect(mocks.assertTrainingReady.mock.calls.map(([input]) => input.sessionId)).toEqual([20]);
    expect(mocks.assertTrainingReady).toHaveBeenCalledWith({
      sessionId: 20, profileId: 1,
      recoveryTrainingSourceKeys: ["training-delete-exercise:20:552", "training-delete-set:20:551"],
    });
    expect(mocks.training).toHaveBeenCalledWith({
      sessionId: 20, profileId: 1,
      publicationBlockSourceKeys: ["training-delete-exercise:20:552", "training-delete-set:20:551"],
      recoveryTrainingSourceKeys: ["training-delete-exercise:20:552", "training-delete-set:20:551"],
    });
    expect(mocks.refreshDeletedTraining).not.toHaveBeenCalled();
    expect(result).toMatchObject({ trainingSessionIdsRefreshed: [20], deletedTrainingSessionIdsReconciled: [] });
    expect(mocks.state.blocks).toHaveLength(0);
  });

  it("reconciles a hard-deleted session only with its numeric fence and committed tombstone", async () => {
    mocks.state.blocks = [
      { source: "training", sourceKey: "training-delete-set:32:553", fromDate: "2071-01-08", revision: 4 },
      { source: "training", sourceKey: "32", fromDate: "2071-01-09", revision: 5 },
      { source: "training", sourceKey: "training-delete-session:32", fromDate: "2071-01-09", revision: 1 },
    ];
    mocks.state.missingTrainingSessions = [32];
    const result = await recover();
    expect(mocks.assertTrainingReady).not.toHaveBeenCalled();
    expect(mocks.training).not.toHaveBeenCalled();
    expect(mocks.refreshDeletedTraining).toHaveBeenCalledWith({ profileId: 1, fromDate: "2071-01-08" });
    expect(result).toMatchObject({ trainingSessionIdsRefreshed: [], deletedTrainingSessionIdsReconciled: [32] });
    expect(mocks.state.blocks).toHaveLength(0);
  });

  it("fails closed when a missing session has no committed deletion tombstone", async () => {
    mocks.state.blocks = [
      { source: "training", sourceKey: "training-delete-set:32:553", fromDate: "2071-01-08", revision: 4 },
      { source: "training", sourceKey: "32", fromDate: "2071-01-09", revision: 5 },
    ];
    mocks.state.missingTrainingSessions = [32];
    await expect(recover()).rejects.toThrow("numeric fence plus committed deletion tombstone");
    expect(mocks.training).not.toHaveBeenCalled();
    expect(mocks.refreshDeletedTraining).not.toHaveBeenCalled();
    expect(mocks.clearAll).not.toHaveBeenCalled();
    expect(mocks.replay).not.toHaveBeenCalled();
    expect(mocks.state.blocks).toHaveLength(2);
  });

  it.each([
    ["non-canonical Training identity", { source: "training", sourceKey: "020", fromDate: "2071-01-20", revision: 1 }],
    ["invalid Training model date", { source: "training", sourceKey: "26", fromDate: "2071-02-30", revision: 1 }],
    ["malformed Training child-deletion identity", { source: "training", sourceKey: "training-delete-set:020:5", fromDate: "2071-01-20", revision: 1 }],
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
