import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

const episodes = vi.hoisted(() => ({
  getActive: vi.fn(), getById: vi.fn(), loadSources: vi.fn(),
}));
const recovery = vi.hoisted(() => ({
  markAllStale: vi.fn(), persist: vi.fn(), latestStatus: vi.fn(),
}));
const engine = vi.hoisted(() => ({ recoverHistoricalTrajectories: vi.fn() }));

vi.mock("@/modules/model-episodes/model-episode.repository", () => ({
  ModelEpisodeRepository: class { constructor() { return episodes; } },
}));
vi.mock("@/modules/model-recovery/model-recovery.repository", () => ({
  ModelRecoveryRepository: class { constructor() { return recovery; } },
}));
vi.mock("@/modules/model-recovery/trajectory-recovery", () => engine);

import {
  getModelRecoveryStatus,
  recoverModelEpisode,
} from "@/modules/model-recovery/model-recovery.service";
import {
  ModelEpisodeNotFoundError,
  NoActiveModelEpisodeError,
} from "@/modules/model-episodes/model-episode.errors";
import { buildSimulationDays } from "@/modules/model-episodes/simulation-input-builder";
import { ModelRecoveryEvidenceError } from "@/modules/model-recovery/model-recovery.errors";
import {
  recoverySourceFingerprint,
  resolvedRecoveryConfig,
} from "@/modules/model-recovery/recovery-fingerprint";
import { RECOVERY_ALGORITHM_VERSION } from "@/modules/model-recovery/recovery.types";
import { persistedEpisodeFixture, sourceDay, stableSourceDays } from "./model-episode-fixtures";

const clientMock = {
  $transaction: vi.fn(async (callback: (transaction: object) => unknown) => callback({})),
};
const client = clientMock as unknown as PrismaClient;
const now = new Date("2026-08-11T10:00:00.000Z");

function sources(days: ReturnType<typeof sourceDay>[]) {
  return { days, snapshots: [], workIntervals: [] };
}

function episodeGapSources() {
  return sources([
    sourceDay("2026-08-01"), sourceDay("2026-08-02"), sourceDay("2026-08-03"),
    sourceDay("2026-08-07"), sourceDay("2026-08-08"),
    sourceDay("2026-08-09"), sourceDay("2026-08-10"),
  ]);
}

describe("historical recovery application service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    recovery.markAllStale.mockResolvedValue(undefined);
    recovery.persist.mockResolvedValue({ id: 9, status: "recovered", stale: false });
    recovery.latestStatus.mockResolvedValue(null);
    engine.recoverHistoricalTrajectories.mockReturnValue({
      algorithmVersion: RECOVERY_ALGORITHM_VERSION,
      seed: 12,
      status: "recovered",
      generatedParticleCount: 32,
      validParticleCount: 32,
      invalidParticleCount: 0,
      observationCount: 2,
      observationDates: ["2026-08-09", "2026-08-10"],
      effectiveSampleSize: 20,
      normalizedEffectiveSampleSize: 0.625,
      maximumWeight: 0.1,
      posteriorSummary: {},
      ensemble: [],
      diagnostics: {},
    });
  });

  it("reconstructs the deterministic prefix and persists a fingerprinted recovery", async () => {
    const episode = persistedEpisodeFixture("2026-08-01");
    episodes.getById.mockResolvedValue(episode);
    episodes.loadSources
      .mockResolvedValueOnce(sources([
        sourceDay("2026-08-01"), sourceDay("2026-08-02"), sourceDay("2026-08-03"),
        sourceDay("2026-08-07"), sourceDay("2026-08-08"),
        sourceDay("2026-08-09"), sourceDay("2026-08-10"),
      ]))
      .mockResolvedValueOnce(sources(stableSourceDays({ count: 42, endDate: "2026-08-03" })));
    const result = await recoverModelEpisode({
      episodeId: 1, seed: 12, config: { particleCount: 32 }, now,
    }, client);
    expect(engine.recoverHistoricalTrajectories).toHaveBeenCalledWith(expect.objectContaining({
      seed: 12,
      days: expect.arrayContaining([
        expect.objectContaining({ input: expect.objectContaining({ date: "2026-08-04" }) }),
      ]),
      personalization: { personalOffsetKcalPerDay: 0, activityCalibration: 1 },
    }));
    expect(recovery.persist).toHaveBeenCalledWith(expect.objectContaining({
      episodeId: 1,
      firstUnknownDate: "2026-08-04",
      latestRecoveredDate: "2026-08-10",
      configFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      sourceFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
    }));
    expect(result).toMatchObject({ status: "ok", recovery: { id: 9 } });
  });

  it("returns not-required and stales old runs when continuity is complete", async () => {
    const episode = persistedEpisodeFixture("2026-08-01");
    episodes.getActive.mockResolvedValue(episode);
    episodes.loadSources.mockResolvedValue(sources(stableSourceDays({ count: 10, endDate: "2026-08-10" })));
    await expect(recoverModelEpisode({ seed: 1, now }, client)).resolves.toEqual({
      status: "not-required", episodeId: 1, recoveryRequired: false,
    });
    expect(recovery.markAllStale).toHaveBeenCalledWith(1);
    expect(engine.recoverHistoricalTrajectories).not.toHaveBeenCalled();
  });

  it("returns not-required before a future episode has a completed local day", async () => {
    const episode = persistedEpisodeFixture("2026-08-12");
    episodes.getActive.mockResolvedValue(episode);
    await expect(recoverModelEpisode({ seed: 1, now }, client)).resolves.toEqual({
      status: "not-required", episodeId: 1, recoveryRequired: false,
    });
    expect(recovery.markAllStale).toHaveBeenCalledWith(1);
    expect(episodes.loadSources).not.toHaveBeenCalled();
  });

  it("wraps engine failures as insufficient recovery evidence", async () => {
    episodes.getById.mockResolvedValue(persistedEpisodeFixture("2026-08-01"));
    episodes.loadSources
      .mockResolvedValueOnce(episodeGapSources())
      .mockResolvedValueOnce(sources(stableSourceDays({ count: 42, endDate: "2026-08-03" })));
    engine.recoverHistoricalTrajectories.mockImplementation(() => { throw new Error("all particles invalid"); });
    await expect(recoverModelEpisode({ episodeId: 1, seed: 1, now }, client))
      .rejects.toEqual(expect.objectContaining({
        name: "ModelRecoveryEvidenceError", message: "all particles invalid",
      }));
    await expect(Promise.reject(new ModelRecoveryEvidenceError("evidence")))
      .rejects.toBeInstanceOf(ModelRecoveryEvidenceError);
    expect(recovery.persist).not.toHaveBeenCalled();
  });

  it("returns an empty status when the episode has no recovery run", async () => {
    episodes.getActive.mockResolvedValue(persistedEpisodeFixture("2026-08-01"));
    recovery.latestStatus.mockResolvedValue(null);
    await expect(getModelRecoveryStatus(undefined, client, now)).resolves.toMatchObject({
      episodeId: 1, recovery: null,
    });
    expect(episodes.loadSources).not.toHaveBeenCalled();
  });

  it("keeps a current recovery when its complete source fingerprint is unchanged", async () => {
    const episode = persistedEpisodeFixture("2026-08-01");
    const gapSources = episodeGapSources();
    const donorSources = sources(stableSourceDays({ count: 42, endDate: "2026-08-03" }));
    const config = resolvedRecoveryConfig({ particleCount: 32 });
    const days = buildSimulationDays({
      from: episode.startDate, to: "2026-08-10", sources: gapSources,
      baselineNutritionFallback: episode.baselineNutritionFallback,
      nutritionGapPolicy: { maxBridgeDays: episode.nutritionMaxBridgeDays },
    });
    const donorDays = buildSimulationDays({
      from: "2026-06-23", to: "2026-08-03", sources: donorSources,
      baselineNutritionFallback: episode.baselineNutritionFallback,
      nutritionGapPolicy: { maxBridgeDays: episode.nutritionMaxBridgeDays },
    });
    const current = {
      id: 4, stale: false, config,
      sourceFingerprint: recoverySourceFingerprint({ episode, days, donorDays }),
    };
    episodes.getActive.mockResolvedValue(episode);
    episodes.loadSources
      .mockResolvedValueOnce(gapSources)
      .mockResolvedValueOnce(donorSources);
    recovery.latestStatus.mockResolvedValue(current);

    const result = await getModelRecoveryStatus(undefined, client, now);
    expect(result.recovery).toBe(current);
    expect(recovery.markAllStale).not.toHaveBeenCalled();
  });

  it.each([
    ["changed source evidence", episodeGapSources(), "wrong-fingerprint"],
    ["a healed historical gap", sources(stableSourceDays({ count: 10, endDate: "2026-08-10" })), "irrelevant"],
  ])("marks a current recovery stale after %s", async (_label, currentSources, sourceFingerprint) => {
    const episode = persistedEpisodeFixture("2026-08-01");
    const current = { id: 4, stale: false, config: resolvedRecoveryConfig(), sourceFingerprint };
    const stale = { ...current, stale: true };
    episodes.getActive.mockResolvedValue(episode);
    episodes.loadSources
      .mockResolvedValueOnce(currentSources)
      .mockResolvedValueOnce(sources(stableSourceDays({ count: 42, endDate: "2026-08-03" })));
    recovery.latestStatus.mockResolvedValueOnce(current).mockResolvedValueOnce(stale);

    const result = await getModelRecoveryStatus(undefined, client, now);
    expect(recovery.markAllStale).toHaveBeenCalledWith(1);
    expect(result.recovery).toEqual(stale);
  });

  it("preserves active-versus-explicit episode not-found semantics", async () => {
    episodes.getActive.mockResolvedValue(null);
    await expect(recoverModelEpisode({ seed: 1, now }, client))
      .rejects.toBeInstanceOf(NoActiveModelEpisodeError);
    episodes.getById.mockResolvedValue(null);
    await expect(recoverModelEpisode({ episodeId: 99, seed: 1, now }, client))
      .rejects.toBeInstanceOf(ModelEpisodeNotFoundError);

    await expect(getModelRecoveryStatus(undefined, client))
      .rejects.toBeInstanceOf(NoActiveModelEpisodeError);
    await expect(getModelRecoveryStatus(99, client))
      .rejects.toBeInstanceOf(ModelEpisodeNotFoundError);
  });
});
