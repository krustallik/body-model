import { beforeEach, describe, expect, it, vi } from "vitest";

type LooseRecord = Record<string, unknown>;
type Candidate = {
  priorStateFingerprint: string;
  sourceFingerprint: string;
  resultFingerprint: string;
  quality: { availability: string; gapSeverity: string };
  state: {
    glycogen: { physicalAvailability: string; physicalKg: number | null };
    glycogenWater: { physicalKg: number | null };
    persistedJsonProbe: number;
    [key: string]: unknown;
  };
  deltas: {
    glycogenKg: { point: number } | null;
    glycogenWaterKg: { point: number } | null;
  };
  uncertainty: unknown;
  reconciliation: unknown;
  energyLedger: unknown;
  sourceLineage: unknown;
  diagnostics: unknown;
};

const mocks = vi.hoisted(() => {
  const state: {
    lifecycle: LooseRecord | null;
    rows: LooseRecord[];
    candidates: Candidate[];
    day: LooseRecord;
    rangeQueue: LooseRecord[][];
    updateCount: number;
  } = {
    lifecycle: null,
    rows: [],
    candidates: [],
    day: {},
    rangeQueue: [],
    updateCount: 1,
  };
  const prisma = {
    modelEpisode: { findMany: vi.fn() },
    dailyHealthData: { findFirst: vi.fn() },
    strengthDiarySession: { findMany: vi.fn() },
    physiologyV7Lifecycle: { findUnique: vi.fn(), updateMany: vi.fn() },
    unifiedExperimentalPhysiologyStateV2: { findMany: vi.fn() },
    $transaction: vi.fn(),
  };
  return {
    state,
    prisma,
    loadRange: vi.fn(),
    buildCandidates: vi.fn(),
    sourceLineage: vi.fn(),
    rangeToken: vi.fn(),
    rebuild: vi.fn(),
    lockProfile: vi.fn(),
  };
});

vi.mock("@/lib/db/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/model/unified-experimental-physiology-v1/source-loader", () => ({
  UnifiedExperimentalPhysiologySourceLoaderV1: class {
    loadRange = mocks.loadRange;
  },
}));
vi.mock("@/modules/model-episodes/physiology-v7-persistence.repository", () => ({
  PhysiologyV7PersistenceRepository: class {
    lockProfile = mocks.lockProfile;
  },
  PhysiologyV7ConcurrentSourceChangeError: class extends Error {
    constructor() { super("concurrent source change"); }
  },
}));
vi.mock("@/modules/model-episodes/unified-experimental-physiology-state.service", () => ({
  buildUnifiedRangeCandidatesV1: mocks.buildCandidates,
  rebuildUnifiedExperimentalPhysiologyStateV1: mocks.rebuild,
  sourceLineage: mocks.sourceLineage,
  unifiedRangeToken: mocks.rangeToken,
}));

import {
  UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V3_REVISION as V3,
  UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V4_REVISION as V4,
} from "@/model/unified-experimental-physiology-v1/contracts";
import {
  activateAndReplayUnifiedV4,
  verifyAndPublishUnifiedV3Postflight,
  verifyPublishedV4Current,
  verifyUnifiedV4ReadyForTraffic,
} from "@/modules/model-episodes/unified-rollout-v4.service";

const date = "2026-01-01";
const boundaryAt = `${date}T00:00:00.000Z`;
const sourceLineage = { production: "daily-state", sourceRevision: 1 };

function lifecycle(overrides: Record<string, unknown> = {}) {
  return {
    profileId: 17,
    invalidationGeneration: 4,
    productionPublishedGeneration: 4,
    productionStaleFromDate: null,
    unifiedPublishedGeneration: 4,
    unifiedTargetRevision: V4,
    unifiedRolloutEpoch: 2,
    unifiedPublishedRolloutEpoch: 2,
    updatedAt: new Date("2026-01-03T00:00:00.000Z"),
    ...overrides,
  };
}

function candidate(overrides: LooseRecord = {}): Candidate {
  const base = {
    priorStateFingerprint: "prior-fingerprint",
    sourceFingerprint: "source-fingerprint",
    resultFingerprint: "result-fingerprint",
    quality: { availability: "available", gapSeverity: "none" },
    state: {
      glycogen: { physicalAvailability: "available", physicalKg: 0.5 },
      glycogenWater: { physicalKg: 1.35 },
      persistedJsonProbe: 0.3,
    },
    deltas: { glycogenKg: { point: 0.2 }, glycogenWaterKg: { point: 0.54 } },
    uncertainty: { source: "known" },
    reconciliation: { residualKg: 0 },
    energyLedger: { activeKcal: 0 },
    sourceLineage,
    diagnostics: { notes: [] },
  };
  const stateOverrides = (overrides.state ?? {}) as LooseRecord;
  const deltaOverrides = (overrides.deltas ?? {}) as LooseRecord;
  const qualityOverrides = (overrides.quality ?? {}) as LooseRecord;
  return {
    ...base,
    ...overrides,
    state: {
      ...base.state,
      ...stateOverrides,
      glycogen: { ...base.state.glycogen, ...(stateOverrides.glycogen as LooseRecord | undefined) },
      glycogenWater: { ...base.state.glycogenWater, ...(stateOverrides.glycogenWater as LooseRecord | undefined) },
    } as Candidate["state"],
    deltas: { ...base.deltas, ...deltaOverrides } as Candidate["deltas"],
    quality: { ...base.quality, ...qualityOverrides },
  };
}

function rowFor(value: Candidate, revision: string): LooseRecord {
  return {
    modelEpisodeId: 3,
    date,
    boundaryAt: new Date(boundaryAt),
    modelRevision: revision,
    priorStateFingerprint: value.priorStateFingerprint,
    resultFingerprint: value.resultFingerprint,
    sourceFingerprint: value.sourceFingerprint,
    state: structuredClone(value.state),
    deltas: structuredClone(value.deltas),
    uncertainty: structuredClone(value.uncertainty),
    reconciliation: structuredClone(value.reconciliation),
    energyLedger: structuredClone(value.energyLedger),
    sourceLineage: structuredClone(value.sourceLineage),
    diagnostics: structuredClone(value.diagnostics),
    qualityStatus: value.quality.availability,
    gapSeverity: value.quality.gapSeverity,
  };
}

function setCandidate(value: Candidate, revision: string = V4) {
  mocks.state.candidates = [value];
  mocks.state.rows = [rowFor(value, revision)];
}

function setCurrent(revision: string = V4) {
  mocks.state.lifecycle = lifecycle({
    unifiedTargetRevision: revision,
    unifiedRolloutEpoch: revision === V3 ? 0 : 2,
    unifiedPublishedRolloutEpoch: revision === V3 ? 0 : 2,
  });
  setCandidate(candidate(), revision);
}

function prepare() {
  vi.clearAllMocks();
  mocks.state.lifecycle = lifecycle();
  mocks.state.candidates = [candidate()];
  mocks.state.rows = [rowFor(mocks.state.candidates[0]!, V4)];
  mocks.state.day = { date, modelEpisodeId: 3, boundaryAt, sourceLineage };
  mocks.state.rangeQueue = [];
  mocks.state.updateCount = 1;
  mocks.prisma.modelEpisode.findMany.mockResolvedValue([{
    id: 3, profileId: 17, startDate: date, timezone: "UTC", active: true, deactivatedAt: null,
  }]);
  mocks.prisma.dailyHealthData.findFirst.mockResolvedValue({ date });
  mocks.prisma.strengthDiarySession.findMany.mockResolvedValue([]);
  mocks.prisma.physiologyV7Lifecycle.findUnique.mockImplementation(async () => (
    mocks.state.lifecycle ? { ...mocks.state.lifecycle } : null
  ));
  mocks.prisma.physiologyV7Lifecycle.updateMany.mockImplementation(async ({ data }: { data: LooseRecord }) => {
    if (mocks.state.updateCount === 0 || !mocks.state.lifecycle) return { count: 0 };
    const current = mocks.state.lifecycle;
    if (data.unifiedTargetRevision !== undefined) current.unifiedTargetRevision = data.unifiedTargetRevision;
    const epochUpdate = data.unifiedRolloutEpoch as { increment?: unknown } | undefined;
    if (typeof epochUpdate?.increment === "number" && typeof current.unifiedRolloutEpoch === "number") {
      current.unifiedRolloutEpoch += epochUpdate.increment;
    }
    if (data.unifiedPublishedRolloutEpoch !== undefined) current.unifiedPublishedRolloutEpoch = data.unifiedPublishedRolloutEpoch;
    if (data.unifiedPublishedGeneration !== undefined) current.unifiedPublishedGeneration = data.unifiedPublishedGeneration;
    current.updatedAt = new Date("2026-01-03T00:01:00.000Z");
    return { count: 1 };
  });
  mocks.prisma.unifiedExperimentalPhysiologyStateV2.findMany.mockImplementation(async () => mocks.state.rows);
  mocks.prisma.$transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback(mocks.prisma));
  mocks.loadRange.mockImplementation(async (input: { fromInstant: Date; throughInstant: Date }) => {
    const days = mocks.state.rangeQueue.shift() ?? [mocks.state.day];
    return {
      fromInstant: input.fromInstant.toISOString(),
      throughInstant: input.throughInstant.toISOString(),
      days,
    };
  });
  mocks.buildCandidates.mockImplementation(() => mocks.state.candidates);
  mocks.sourceLineage.mockImplementation((day: LooseRecord) => day.sourceLineage);
  mocks.rangeToken.mockImplementation((profileId: number, from: string, through: string, days: unknown[]) => (
    JSON.stringify({ profileId, from, through, days })
  ));
  mocks.lockProfile.mockResolvedValue(undefined);
  mocks.rebuild.mockImplementation(async ({ targetRevision, rolloutEpoch }: { targetRevision: string; rolloutEpoch: number }) => {
    mocks.state.lifecycle = lifecycle({
      unifiedTargetRevision: targetRevision,
      unifiedRolloutEpoch: rolloutEpoch,
      unifiedPublishedRolloutEpoch: rolloutEpoch,
    });
    mocks.state.rows = [rowFor(mocks.state.candidates[0]!, targetRevision)];
    return { dayCount: 1 };
  });
}

describe("Unified V3/V4 rollout verification", () => {
  beforeEach(prepare);

  it("verifies current V4 coverage and permits Forecast V2 traffic", async () => {
    const result = await verifyUnifiedV4ReadyForTraffic({ profileId: 17, client: mocks.prisma as never });
    expect(result).toEqual({ profileId: 17, rolloutEpoch: 2, dayCount: 1 });
    expect(mocks.lockProfile).toHaveBeenCalledWith(17);
    expect(mocks.prisma.unifiedExperimentalPhysiologyStateV2.findMany).toHaveBeenCalled();
  });

  it("fails closed for missing, stale, unpublished, or non-V4 lifecycle", async () => {
    const invalid = [
      null,
      lifecycle({ unifiedTargetRevision: V3 }),
      lifecycle({ unifiedRolloutEpoch: 0 }),
      lifecycle({ unifiedPublishedRolloutEpoch: 1 }),
      lifecycle({ unifiedPublishedGeneration: 3 }),
      lifecycle({ productionPublishedGeneration: 3 }),
      lifecycle({ productionStaleFromDate: date }),
    ];
    for (const row of invalid) {
      mocks.state.lifecycle = row;
      await expect(verifyUnifiedV4ReadyForTraffic({ profileId: 17, client: mocks.prisma as never }))
        .rejects.toThrow("Forecast V2 serving is blocked until Unified V4 is current");
    }
  });

  it("rejects source changes between candidate capture and locked currentness verification", async () => {
    mocks.state.rangeQueue = [
      [mocks.state.day],
      [{ ...mocks.state.day, sourceLineage: { production: "changed" } }],
    ];
    await expect(verifyPublishedV4Current(mocks.prisma as never, 17, 2))
      .rejects.toThrow("concurrent source change");
  });

  it("rejects missing or mismatched output coverage", async () => {
    mocks.state.rows = [];
    await expect(verifyPublishedV4Current(mocks.prisma as never, 17, 2))
      .rejects.toThrow("postflight coverage mismatch: expected 1, found 0");

    setCurrent();
    (mocks.state.rows[0]!.state as Candidate["state"]).persistedJsonProbe = 0.31;
    await expect(verifyPublishedV4Current(mocks.prisma as never, 17, 2))
      .rejects.toThrow("state:$.persistedJsonProbe");
  });

  it("rejects noncanonical physical water and partial/noncanonical glycogen deltas", async () => {
    const wrongWater = candidate({ state: { glycogenWater: { physicalKg: 1.4 } } });
    setCandidate(wrongWater);
    await expect(verifyPublishedV4Current(mocks.prisma as never, 17, 2))
      .rejects.toThrow("physical glycogen/water mismatch");

    const partial = candidate({ deltas: { glycogenWaterKg: null } });
    setCandidate(partial);
    await expect(verifyPublishedV4Current(mocks.prisma as never, 17, 2))
      .rejects.toThrow("partial glycogen transition");

    const wrongDelta = candidate({ deltas: { glycogenWaterKg: { point: 0.4 } } });
    setCandidate(wrongDelta);
    await expect(verifyPublishedV4Current(mocks.prisma as never, 17, 2))
      .rejects.toThrow("noncanonical glycogen transition");
  });

  it("accepts unavailable physical values only when both mass components are null", async () => {
    const unavailable = candidate({
      state: {
        glycogen: { physicalAvailability: "unavailable", physicalKg: null },
        glycogenWater: { physicalKg: null },
      },
      deltas: { glycogenKg: null, glycogenWaterKg: null },
    });
    setCandidate(unavailable);
    await expect(verifyPublishedV4Current(mocks.prisma as never, 17, 2)).resolves.toBe(1);

    const numericUnavailable = candidate({
      state: {
        glycogen: { physicalAvailability: "unavailable", physicalKg: 0 },
        glycogenWater: { physicalKg: null },
      },
      deltas: { glycogenKg: null, glycogenWaterKg: null },
    });
    setCandidate(numericUnavailable);
    await expect(verifyPublishedV4Current(mocks.prisma as never, 17, 2))
      .rejects.toThrow("unavailable physical glycogen has a numeric value");
  });

  it("publishes V3 postflight epoch zero only after exact coverage and source-token recheck", async () => {
    setCurrent(V3);
    mocks.state.candidates[0]!.state.persistedJsonProbe = 0.3;
    mocks.state.rows = [rowFor(mocks.state.candidates[0]!, V3)];
    (mocks.state.rows[0]!.state as Candidate["state"]).persistedJsonProbe = 0.1 + 0.2;

    const result = await verifyAndPublishUnifiedV3Postflight({ profileId: 17, client: mocks.prisma as never });
    expect(result).toMatchObject({ profileId: 17, dayCount: 1 });
    expect(mocks.prisma.physiologyV7Lifecycle.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { unifiedPublishedRolloutEpoch: 0 },
    }));
    expect(mocks.state.lifecycle!.unifiedPublishedRolloutEpoch).toBe(0);
  });

  it("does not publish V3 when lifecycle or output coverage is stale", async () => {
    mocks.state.lifecycle = lifecycle({ unifiedTargetRevision: V4 });
    await expect(verifyAndPublishUnifiedV3Postflight({ client: mocks.prisma as never }))
      .rejects.toThrow("V3 postflight lifecycle/generation is not current");
    expect(mocks.prisma.physiologyV7Lifecycle.updateMany).not.toHaveBeenCalled();

    setCurrent(V3);
    mocks.state.rows[0]!.sourceFingerprint = "stale-source";
    await expect(verifyAndPublishUnifiedV3Postflight({ client: mocks.prisma as never }))
      .rejects.toThrow("source-fingerprint");
    expect(mocks.prisma.physiologyV7Lifecycle.updateMany).not.toHaveBeenCalled();
  });

  it("rejects source-token changes during V3 postflight and failed lifecycle CAS", async () => {
    setCurrent(V3);
    mocks.state.rangeQueue = [
      [mocks.state.day],
      [{ ...mocks.state.day, sourceLineage: { production: "changed" } }],
    ];
    await expect(verifyAndPublishUnifiedV3Postflight({ client: mocks.prisma as never }))
      .rejects.toThrow("concurrent source change");

    setCurrent(V3);
    mocks.state.updateCount = 0;
    await expect(verifyAndPublishUnifiedV3Postflight({ client: mocks.prisma as never }))
      .rejects.toThrow("concurrent source change");
  });

  it("activates V4 only from a published V3 postflight, then replays and verifies", async () => {
    setCurrent(V3);
    const result = await activateAndReplayUnifiedV4({ profileId: 17, client: mocks.prisma as never });
    expect(result).toEqual({ profileId: 17, rolloutEpoch: 1, dayCount: 1 });
    expect(mocks.prisma.physiologyV7Lifecycle.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ unifiedTargetRevision: V4, unifiedRolloutEpoch: { increment: 1 } }),
    }));
    expect(mocks.rebuild).toHaveBeenCalledWith(expect.objectContaining({ targetRevision: V4, rolloutEpoch: 1 }));
  });

  it("rejects activation without current production or published V3 postflight", async () => {
    mocks.state.lifecycle = lifecycle({ productionStaleFromDate: date });
    await expect(activateAndReplayUnifiedV4({ client: mocks.prisma as never }))
      .rejects.toThrow("V4 activation requires current production state");

    setCurrent(V3);
    mocks.state.lifecycle!.unifiedPublishedRolloutEpoch = null;
    await expect(activateAndReplayUnifiedV4({ client: mocks.prisma as never }))
      .rejects.toThrow("V4 activation requires a successfully published V3 postflight epoch 0");
  });

  it("supports retrying an unpublished V4 epoch and reads already-current V4 idempotently", async () => {
    mocks.state.lifecycle = lifecycle({ unifiedPublishedRolloutEpoch: null, unifiedPublishedGeneration: null });
    const replayed = await activateAndReplayUnifiedV4({ profileId: 17, client: mocks.prisma as never });
    expect(replayed.rolloutEpoch).toBe(2);
    expect(mocks.rebuild).toHaveBeenCalledTimes(1);

    prepare();
    const current = await activateAndReplayUnifiedV4({ profileId: 17, client: mocks.prisma as never });
    expect(current).toEqual({ profileId: 17, rolloutEpoch: 2, dayCount: 1 });
    expect(mocks.rebuild).not.toHaveBeenCalled();
  });

  it("rejects a lost activation compare-and-swap without replaying", async () => {
    setCurrent(V3);
    mocks.state.updateCount = 0;
    await expect(activateAndReplayUnifiedV4({ client: mocks.prisma as never }))
      .rejects.toThrow("concurrent source change");
    expect(mocks.rebuild).not.toHaveBeenCalled();
  });
});
