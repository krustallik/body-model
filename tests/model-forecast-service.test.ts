import { beforeEach, describe, expect, it, vi } from "vitest";

const repositories = vi.hoisted(() => ({
  getActive: vi.fn(),
  getById: vi.fn(),
  loadSources: vi.fn(),
  loadCurrentEnsemble: vi.fn(),
}));

vi.mock("@/modules/model-episodes/model-episode.repository", () => ({
  ModelEpisodeRepository: class {
    getActive = repositories.getActive;
    getById = repositories.getById;
    loadSources = repositories.loadSources;
  },
}));
vi.mock("@/modules/model-recovery/model-recovery.repository", () => ({
  ModelRecoveryRepository: class {
    loadCurrentEnsemble = repositories.loadCurrentEnsemble;
  },
}));

import { buildSimulationDays } from "@/modules/model-episodes/simulation-input-builder";
import { addCalendarDays } from "@/modules/model-episodes/model-calendar";
import { forecastModelEpisode } from "@/modules/model-forecast/model-forecast.service";
import { recoverySourceFingerprint } from "@/modules/model-recovery/recovery-fingerprint";
import { DEFAULT_RECOVERY_CONFIG } from "@/modules/model-recovery/recovery.types";
import { persistedEpisodeFixture, sourceDay, stableSourceDays } from "./model-episode-fixtures";
import { UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V4_REVISION } from "@/model/unified-experimental-physiology-v1/contracts";

const episode = persistedEpisodeFixture("2026-08-22");
const now = new Date("2026-08-24T12:00:00.000Z");
const gapNow = new Date("2026-08-27T12:00:00.000Z");
const fixedRequest = {
  horizonDays: 7,
  seed: 17,
  scenario: {
    mode: "fixed" as const,
    schedule: {
      defaultDay: {
        nutrition: { caloriesKcal: 2_200, proteinG: 170, fatG: 70, carbsG: 230 },
        outsideWorkWalkingDistanceKm: 5,
        averageWalkingSpeedKmh: 5,
        strengthTrainingMinutes: 0,
        occupation: [],
      },
    },
  },
  config: { pathCount: 16 },
};

function forecastClient(overrides: {
  lifecycle?: Record<string, unknown>;
  state?: Record<string, unknown>;
} = {}) {
  const lifecycle = {
    invalidationGeneration: 8,
    staleFromDate: null,
    productionStaleFromDate: null,
    productionPublishedGeneration: 8,
    unifiedPublishedGeneration: 8,
    unifiedTargetRevision: UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V4_REVISION,
    unifiedRolloutEpoch: 1,
    unifiedPublishedRolloutEpoch: 1,
    ...overrides.lifecycle,
  };
  return {
    physiologyV7Lifecycle: { findUnique: vi.fn().mockResolvedValue(lifecycle) },
    unifiedExperimentalPhysiologyStateV2: {
      findUnique: vi.fn().mockResolvedValue({
        modelRevision: UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V4_REVISION,
        resultFingerprint: "a".repeat(64),
        state: overrides.state ?? {
          glycogen: { physicalAvailability: "available", physicalKg: 0.5, physicalProvenance: "production-daily-model-state" },
          glycogenWater: { physicalKg: 1.35 },
          transientWater: { levelKg: { point: 0.4 } },
        },
      }),
    },
  } as never;
}

function sources(days: ReturnType<typeof stableSourceDays>) {
  return { days, snapshots: [], workIntervals: [] };
}

function mockConditionedRecovery(
  status: "recovered" | "degraded" = "recovered",
  overrides: Record<string, unknown> = {},
) {
  const mainDays = [sourceDay("2026-08-22")];
  const donorFrom = addCalendarDays("2026-08-23", -DEFAULT_RECOVERY_CONFIG.donorLookbackDays);
  const donorDays = stableSourceDays({
    count: DEFAULT_RECOVERY_CONFIG.donorLookbackDays,
    endDate: "2026-08-22",
  });
  repositories.loadSources.mockImplementation(async (from: string, to: string) => (
    from === donorFrom && to === "2026-08-22" ? sources(donorDays) : sources(mainDays)
  ));
  const builtMain = buildSimulationDays({
    from: "2026-08-22", to: "2026-08-26", sources: sources(mainDays),
    baselineNutritionFallback: episode.baselineNutritionFallback,
    nutritionGapPolicy: { maxBridgeDays: episode.nutritionMaxBridgeDays },
    modelVersion: episode.modelVersion,
  });
  const builtDonors = buildSimulationDays({
    from: donorFrom, to: "2026-08-22", sources: sources(donorDays),
    baselineNutritionFallback: episode.baselineNutritionFallback,
    nutritionGapPolicy: { maxBridgeDays: episode.nutritionMaxBridgeDays },
    modelVersion: episode.modelVersion,
  });
  repositories.loadCurrentEnsemble.mockResolvedValue({
    id: 4,
    algorithmVersion: "bodycast-recovery-v3",
    status,
    latestRecoveredDate: "2026-08-26",
    config: DEFAULT_RECOVERY_CONFIG,
    sourceFingerprint: recoverySourceFingerprint({ episode, days: builtMain, donorDays: builtDonors }),
    configFingerprint: "config",
    posteriorSummary: {},
    ensemble: [
      { particleIndex: 0, normalizedWeight: 0.75, state: episode.initialState },
      { particleIndex: 1, normalizedWeight: 0.25, state: {
        ...episode.initialState,
        fatMassKg: episode.initialState.fatMassKg + 1,
        weightFilterState: { ...episode.initialState.weightFilterState },
      } },
    ],
    ...overrides,
  });
}

describe("forecast application service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    repositories.getActive.mockResolvedValue(episode);
    repositories.getById.mockResolvedValue(episode);
    repositories.loadCurrentEnsemble.mockResolvedValue(null);
  });

  it("forecasts fully resolved history without requiring recovery or mutating repositories", async () => {
    repositories.loadSources.mockResolvedValue(sources([
      sourceDay("2026-08-22"), sourceDay("2026-08-23"),
    ]));
    const result = await forecastModelEpisode({ ...fixedRequest, now }, forecastClient());
    expect(result.status).toBe("ok");
    expect(result.initialStateQuality).toBe("deterministic");
    expect("dates" in result && result.dates).toHaveLength(7);
    expect(repositories.loadCurrentEnsemble).not.toHaveBeenCalled();
    expect(Object.keys(repositories).filter((key) => key.startsWith("persist"))).toHaveLength(0);
  });

  it("returns a typed V2 block when the current production glycogen row is explicitly null", async () => {
    repositories.loadSources.mockResolvedValue(sources([sourceDay("2026-08-22"), sourceDay("2026-08-23")]));
    const result = await forecastModelEpisode({ ...fixedRequest, now }, forecastClient({
      state: {
        glycogen: { physicalAvailability: "blocked", physicalKg: null, physicalProvenance: "current-production-null" },
        glycogenWater: { physicalKg: null },
      },
    }));
    expect(result).toMatchObject({
      status: "initial-state-unavailable",
      forecastVersion: "experimental-forecast-v2",
      reasonCode: "production-glycogen-null",
    });
    expect("dates" in result).toBe(false);
  });

  it("keeps current production glycogen zero and its associated water zero", async () => {
    repositories.loadSources.mockResolvedValue(sources([sourceDay("2026-08-22"), sourceDay("2026-08-23")]));
    const result = await forecastModelEpisode({ ...fixedRequest, now }, forecastClient({
      state: {
        glycogen: { physicalAvailability: "available", physicalKg: 0, physicalProvenance: "production-daily-model-state" },
        glycogenWater: { physicalKg: 0 },
        transientWater: { levelKg: { point: 0.4 } },
      },
    }));
    expect(result).toMatchObject({
      status: "ok",
      forecastVersion: "experimental-forecast-v2",
      experimentalCurrent: { glycogenKg: 0, glycogenWaterKg: 0, transientWaterKg: 0.4 },
    });
    expect("dates" in result && result.dates[0]?.glycogenKg?.median).toBeGreaterThanOrEqual(0);
  });

  it("does not fall through to V1 when V4 is not current", async () => {
    const result = await forecastModelEpisode({ ...fixedRequest, now }, forecastClient({
      lifecycle: {
        unifiedTargetRevision: "unified-experimental-physiology-state-v3-relative-muscle-daily-cumulative-diagnostics",
        unifiedRolloutEpoch: 0,
        unifiedPublishedRolloutEpoch: 0,
      },
    }));
    expect(result).toMatchObject({
      status: "initial-state-unavailable",
      forecastVersion: "experimental-forecast-v2",
      reasonCode: "unified-v4-not-current",
    });
  });

  it("ignores a stale marker from before the active episode boundary", async () => {
    repositories.loadSources.mockResolvedValue(sources([
      sourceDay("2026-08-22"), sourceDay("2026-08-23"),
    ]));
    const result = await forecastModelEpisode({ ...fixedRequest, now }, forecastClient({
      lifecycle: { staleFromDate: "2026-08-21" },
    }));
    expect(result).toMatchObject({
      status: "ok",
      forecastVersion: "experimental-forecast-v2",
    });
  });

  it("blocks when the stale marker intersects the active episode history", async () => {
    const result = await forecastModelEpisode({ ...fixedRequest, now }, forecastClient({
      lifecycle: { staleFromDate: episode.startDate },
    }));
    expect(result).toMatchObject({
      status: "initial-state-unavailable",
      forecastVersion: "experimental-forecast-v2",
      reasonCode: "unified-v4-not-current",
    });
  });

  it("returns awaiting explicitly when an unresolved gap has no current recovery", async () => {
    repositories.loadSources.mockResolvedValue(sources([sourceDay("2026-08-22")]));
    const result = await forecastModelEpisode({ ...fixedRequest, now: gapNow }, forecastClient());
    expect(result).toMatchObject({
      status: "initial-state-unavailable",
      initialStateQuality: "awaiting",
    });
  });

  it("blocks a degenerate recovery without using its particles", async () => {
    repositories.loadSources.mockResolvedValue(sources([sourceDay("2026-08-22")]));
    repositories.loadCurrentEnsemble.mockResolvedValue({
      algorithmVersion: "bodycast-recovery-v3", status: "degenerate", ensemble: [],
    });
    const result = await forecastModelEpisode({ ...fixedRequest, now: gapNow }, forecastClient());
    expect(result).toMatchObject({
      status: "initial-state-unreliable",
      initialStateQuality: "degenerate",
    });
  });

  it("propagates a current degraded recovery ensemble with its provenance", async () => {
    const mainDays = [sourceDay("2026-08-22")];
    const donorFrom = addCalendarDays("2026-08-23", -DEFAULT_RECOVERY_CONFIG.donorLookbackDays);
    const donorDays = stableSourceDays({
      count: DEFAULT_RECOVERY_CONFIG.donorLookbackDays,
      endDate: "2026-08-22",
    });
    repositories.loadSources.mockImplementation(async (from: string, to: string) => (
      from === donorFrom && to === "2026-08-22" ? sources(donorDays) : sources(mainDays)
    ));
    const builtMain = buildSimulationDays({
      from: "2026-08-22", to: "2026-08-26", sources: sources(mainDays),
      baselineNutritionFallback: episode.baselineNutritionFallback,
      nutritionGapPolicy: { maxBridgeDays: episode.nutritionMaxBridgeDays },
      modelVersion: episode.modelVersion,
    });
    const builtDonors = buildSimulationDays({
      from: donorFrom, to: "2026-08-22", sources: sources(donorDays),
      baselineNutritionFallback: episode.baselineNutritionFallback,
      nutritionGapPolicy: { maxBridgeDays: episode.nutritionMaxBridgeDays },
      modelVersion: episode.modelVersion,
    });
    repositories.loadCurrentEnsemble.mockResolvedValue({
      id: 4,
      algorithmVersion: "bodycast-recovery-v3",
      status: "degraded",
      latestRecoveredDate: "2026-08-26",
      config: DEFAULT_RECOVERY_CONFIG,
      sourceFingerprint: recoverySourceFingerprint({ episode, days: builtMain, donorDays: builtDonors }),
      configFingerprint: "config",
      posteriorSummary: {},
      ensemble: [
        { particleIndex: 0, normalizedWeight: 0.75, state: episode.initialState },
        { particleIndex: 1, normalizedWeight: 0.25, state: {
          ...episode.initialState,
          fatMassKg: episode.initialState.fatMassKg + 1,
          weightFilterState: { ...episode.initialState.weightFilterState },
        } },
      ],
    });
    const result = await forecastModelEpisode({ ...fixedRequest, now: gapNow }, forecastClient());
    expect(result.status).toBe("degraded");
    expect(result.initialStateQuality).toBe("degraded");
    expect("diagnostics" in result && result.diagnostics.startingParticleCount).toBe(2);
  });

  it("accepts a current recovered ensemble without degrading forecast quality", async () => {
    mockConditionedRecovery("recovered");
    const result = await forecastModelEpisode({ ...fixedRequest, now: gapNow }, forecastClient());
    expect(result.status).toBe("ok");
    expect(result.initialStateQuality).toBe("recovered");
    expect("diagnostics" in result && result.diagnostics.startingParticleCount).toBe(2);
  });

  it("blocks a conditioned recovery with a stale source fingerprint", async () => {
    mockConditionedRecovery("recovered", { sourceFingerprint: "stale-source" });
    expect(await forecastModelEpisode({ ...fixedRequest, now: gapNow }, forecastClient()))
      .toMatchObject({ status: "initial-state-unavailable", initialStateQuality: "awaiting" });
  });

  it("blocks invalid and zero-weight persisted recovery ensembles", async () => {
    mockConditionedRecovery("recovered", {
      ensemble: [{ particleIndex: 0, normalizedWeight: 0, state: episode.initialState }],
    });
    expect(await forecastModelEpisode({ ...fixedRequest, now: gapNow }, forecastClient()))
      .toMatchObject({ status: "initial-state-unavailable", initialStateQuality: "awaiting" });
    mockConditionedRecovery("recovered", {
      ensemble: [{ particleIndex: 0, normalizedWeight: -1, state: episode.initialState }],
    });
    expect(await forecastModelEpisode({ ...fixedRequest, now: gapNow }, forecastClient()))
      .toMatchObject({ status: "initial-state-unavailable", initialStateQuality: "awaiting" });
    mockConditionedRecovery("recovered", {
      ensemble: [{ particleIndex: 0, normalizedWeight: 1, state: {
        ...episode.initialState,
        extracellularFluidDeviationLiters: null,
      } }],
    });
    expect(await forecastModelEpisode({ ...fixedRequest, now: gapNow }, forecastClient()))
      .toMatchObject({ status: "initial-state-unavailable", initialStateQuality: "awaiting" });
  });

  it("blocks stale recovery fingerprints and prior-only awaiting ensembles", async () => {
    repositories.loadSources.mockResolvedValue(sources([sourceDay("2026-08-22")]));
    repositories.loadCurrentEnsemble.mockResolvedValue({
      id: 1, algorithmVersion: "bodycast-recovery-v3", status: "awaiting-observations",
      latestRecoveredDate: "2026-08-26", config: DEFAULT_RECOVERY_CONFIG,
      sourceFingerprint: "old", ensemble: [],
    });
    expect(await forecastModelEpisode({ ...fixedRequest, now: gapNow }, forecastClient()))
      .toMatchObject({ status: "initial-state-unavailable", initialStateQuality: "awaiting" });
  });

  it("supports limited-history explicit plans and labels stochastic fallback uncertainty", async () => {
    repositories.loadSources.mockResolvedValue(sources([
      sourceDay("2026-08-22"), sourceDay("2026-08-23"),
    ]));
    const result = await forecastModelEpisode({
      ...fixedRequest,
      scenario: { ...fixedRequest.scenario, mode: "target-centered" as const },
      now,
    }, forecastClient());
    expect(result.status).toBe("degraded");
    expect("scenarioProvenance" in result && result.scenarioProvenance.donorEvidence.source)
      .toBe("engineering-fallback");
  });

  it("derives robust variability from reliable observed donors and preserves work intervals", async () => {
    const donorDays = stableSourceDays({ count: 30, endDate: "2026-08-23" });
    repositories.loadSources.mockResolvedValue({
      days: donorDays,
      snapshots: [
        {
          id: 1, date: "2026-08-23", receivedAt: new Date("2026-08-23T06:05:00.000Z"),
          syncedAt: null, steps: 1_200, walkingDistanceKm: 0.8,
        },
        {
          id: 2, date: "2026-08-23", receivedAt: new Date("2026-08-23T14:05:00.000Z"),
          syncedAt: null, steps: 4_700, walkingDistanceKm: 3.3,
        },
      ],
      workIntervals: [{
        id: 1,
        date: "2026-08-23",
        startAt: new Date("2026-08-23T06:00:00.000Z"),
        endAt: new Date("2026-08-23T14:00:00.000Z"),
        timezone: "Europe/Bratislava",
        category: "manualModerate",
        breakMinutes: 30,
      }],
    });
    const result = await forecastModelEpisode({
      ...fixedRequest,
      scenario: {
        mode: "recent-behavior" as const,
        blockLengthDays: 3,
        donorLookbackDays: 30,
        minimumDonorDays: 14,
      },
      now,
    }, forecastClient());
    expect(result.status).toBe("ok");
    expect("scenarioProvenance" in result && result.scenarioProvenance).toMatchObject({
      mode: "recent-behavior",
      nutrition: "observed-joint-block-resampling",
      donorEvidence: { source: "observed-history", donorDayCount: 30 },
    });
  });

  it("labels complete explicit target variability independently of donor volume", async () => {
    repositories.loadSources.mockResolvedValue(sources([
      sourceDay("2026-08-22"), sourceDay("2026-08-23"),
    ]));
    const result = await forecastModelEpisode({
      ...fixedRequest,
      scenario: {
        mode: "target-centered" as const,
        schedule: fixedRequest.scenario.schedule,
        variability: {
          nutritionLogStandardDeviation: 0.15,
          macroCompositionLogStandardDeviation: 0.08,
          walkingLogStandardDeviation: 0.2,
        },
      },
      now,
    }, forecastClient());
    expect("scenarioProvenance" in result && result.scenarioProvenance.donorEvidence.source)
      .toBe("explicit-scenario");
  });

  it("uses the explicit engineering fallback when complete recent donors are absent", async () => {
    repositories.loadSources.mockResolvedValue(sources([
      sourceDay("2026-08-22", { caloriesKcal: null, proteinG: null, fatG: null, carbsG: null }),
      sourceDay("2026-08-23", { caloriesKcal: null, proteinG: null, fatG: null, carbsG: null }),
    ]));
    const result = await forecastModelEpisode({
      ...fixedRequest,
      scenario: { mode: "recent-behavior", minimumDonorDays: 14 },
      now,
    }, forecastClient());
    expect(result.status).toBe("degraded");
    expect("scenarioProvenance" in result && result.scenarioProvenance).toMatchObject({
      nutrition: "engineering-fallback",
      activity: "engineering-fallback",
      donorEvidence: { source: "engineering-fallback", donorDayCount: 0 },
    });
    expect("experimentalProvenance" in result && result.experimentalProvenance).toMatchObject({
      nutritionSource: "episode-engineering-fallback",
      nutritionFallback: episode.baselineNutritionFallback,
    });
  });

  it("returns a typed V2 block when neither a valid recent donor nor the existing fallback exists", async () => {
    repositories.getActive.mockResolvedValue({ ...episode, baselineNutritionFallback: null });
    repositories.loadSources.mockResolvedValue(sources([
      sourceDay("2026-08-22", { caloriesKcal: null, proteinG: null, fatG: null, carbsG: null }),
      sourceDay("2026-08-23", { caloriesKcal: null, proteinG: null, fatG: null, carbsG: null }),
    ]));
    const result = await forecastModelEpisode({
      ...fixedRequest,
      scenario: { mode: "recent-behavior", minimumDonorDays: 14 },
      now,
    }, forecastClient());
    expect(result).toMatchObject({
      status: "initial-state-unavailable",
      forecastVersion: "experimental-forecast-v2",
      reasonCode: "nutrition-evidence-unavailable",
    });
  });

  it("distinguishes no active episode from a missing requested episode", async () => {
    repositories.getActive.mockResolvedValue(null);
    await expect(forecastModelEpisode({ ...fixedRequest, now }, forecastClient()))
      .rejects.toMatchObject({ name: "NoActiveModelEpisodeError" });
    repositories.getById.mockResolvedValue(null);
    await expect(forecastModelEpisode({ ...fixedRequest, episodeId: 999, now }, forecastClient()))
      .rejects.toMatchObject({ name: "ModelEpisodeNotFoundError" });
  });
});
