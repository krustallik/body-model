import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ForecastResult } from "@/modules/model-forecast/forecast.types";
import { persistedEpisodeFixture } from "./model-episode-fixtures";

const mocks = vi.hoisted(() => ({ getActive: vi.fn(), getById: vi.fn(), forecast: vi.fn() }));

vi.mock("@/modules/model-episodes/model-episode.repository", () => ({
  ModelEpisodeRepository: class {
    getActive = mocks.getActive;
    getById = mocks.getById;
  },
}));
vi.mock("@/modules/model-forecast/model-forecast.service", () => ({
  forecastModelEpisodeWithInternalArtifacts: mocks.forecast,
}));

import { solveModelEpisodeTarget } from "@/modules/model-target-solver/model-target-solver.service";

const episode = persistedEpisodeFixture("2026-08-22");
const now = new Date("2026-08-24T12:00:00Z");
const scenarioTemplate = {
  mode: "fixed" as const,
  schedule: { defaultDay: {
    nutrition: { caloriesKcal: 2_400, proteinG: 180, fatG: 80, carbsG: 250 },
    outsideWorkWalkingDistanceKm: 5,
    averageWalkingSpeedKmh: 5,
    strengthTrainingMinutes: 0,
    occupation: [],
  } },
};
const request = {
  goal: { metric: "weightKg" as const, targetValueKg: 80, goalDate: "2026-09-22" },
  control: { type: "daily-calorie-center" as const,
    constraints: { minCaloriesKcal: 1_600, maxCaloriesKcal: 3_200 },
    nutritionAdjustmentPolicy: { type: "proportional-template" as const } },
  scenarioTemplate,
  seed: 17,
  solverConfig: { searchPathCount: 8, finalPathCount: 32, coarseGridPoints: 3, maxEvaluations: 8,
    targetToleranceKg: 0.05, candidateResolutionKcal: 10, monotonicityToleranceKg: 0.01 },
};

function forecastResult(caloriesKcal: number, pathCount: number, quality: "deterministic" | "degraded" = "deterministic"): ForecastResult {
  const median = 76 + caloriesKcal / 600;
  const summary = { mean: median, p05: median - 2, p25: median - 1, median, p75: median + 1, p95: median + 2 };
  return {
    status: quality === "degraded" ? "degraded" : "ok",
    forecastVersion: "bodycast-forecast-v1",
    modelVersion: episode.modelVersion,
    recoveryVersion: quality === "degraded" ? "bodycast-recovery-v3" : null,
    sourceFingerprint: "source",
    scenarioFingerprint: "scenario",
    initialStateQuality: quality,
    horizonDays: 30,
    scenarioProvenance: { mode: "fixed", nutrition: "fixed", activity: "fixed-scheduled",
      donorEvidence: { donorDayCount: 0, source: "explicit-scenario", nutritionLogStandardDeviation: 0,
        macroCompositionLogStandardDeviation: 0, walkingLogStandardDeviation: 0 } },
    dates: [{ date: "2026-09-22", physiologicalBodyWeightKg: summary } as never],
    diagnostics: { seed: 17, generatedPathCount: pathCount, validPathCount: pathCount, invalidPathCount: 0,
      invalidPathReasons: {}, startingParticleCount: 1, startingParticleResampling: "none-single-state",
      uncertaintySources: { initialState: quality === "degraded", futureBehavior: false, measurement: false, modelParameters: false },
      ecfPolicy: "hold-ecf", ecfLimitation: null, latentPhysiologicalWeightOnly: true, current: true,
      numericalQuality: { classification: "standard", pathCount, recommendedMinimumPathCount: 512,
        pathCountAdequateForHorizon: true, uniqueStartingStateCount: 1, availableStartingStateCount: 1,
        outerQuantileRankStandardErrorProbability: 0.01, note: "test" } },
  };
}

describe("model target solver application service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getActive.mockResolvedValue(episode);
    mocks.getById.mockResolvedValue(episode);
    mocks.forecast.mockImplementation(async (input: { scenario: typeof scenarioTemplate; config: { pathCount: number } }) => {
      const forecast = forecastResult(input.scenario.schedule.defaultDay.nutrition.caloriesKcal, input.config.pathCount);
      return { result: forecast, initialPhysiologicalBodyWeightKg: 85,
        terminalPhysiologicalBodyWeightSamplesKg: Array.from({ length: input.config.pathCount },
          () => forecast.dates.at(-1)!.physiologicalBodyWeightKg.median) };
    });
  });

  it("converts the local goal date to a 30-day horizon and uses search/final path counts", async () => {
    const result = await solveModelEpisodeTarget({ ...request, now }, {} as never);
    expect(result.status).toBe("solved");
    expect("goal" in result && result.goal.horizonDays).toBe(30);
    expect(mocks.forecast.mock.calls.every(([input]) => input.seed === 17 && input.horizonDays === 30)).toBe(true);
    expect(mocks.forecast.mock.calls.some(([input]) => input.config.pathCount === 8)).toBe(true);
    expect(mocks.forecast.mock.calls.at(-1)![0].config.pathCount).toBe(32);
  });

  it("retains degraded starting-state provenance", async () => {
    mocks.forecast.mockImplementation(async (input: { scenario: typeof scenarioTemplate; config: { pathCount: number } }) => {
      const forecast = forecastResult(input.scenario.schedule.defaultDay.nutrition.caloriesKcal, input.config.pathCount, "degraded");
      return { result: forecast, initialPhysiologicalBodyWeightKg: 85,
        terminalPhysiologicalBodyWeightSamplesKg: Array.from({ length: input.config.pathCount },
          () => forecast.dates.at(-1)!.physiologicalBodyWeightKg.median) };
    });
    const result = await solveModelEpisodeTarget({ ...request, now }, {} as never);
    expect("quality" in result && result.quality.initialStateQuality).toBe("degraded");
    expect("recoveryVersion" in result && result.recoveryVersion).toBe("bodycast-recovery-v3");
  });

  it("propagates awaiting and does not invent a starting state", async () => {
    mocks.forecast.mockResolvedValue({ status: "initial-state-unavailable", initialStateQuality: "awaiting",
      reason: "stale recovery", modelVersion: episode.modelVersion, forecastVersion: "bodycast-forecast-v1", recoveryVersion: null });
    const result = await solveModelEpisodeTarget({ ...request, now }, {} as never);
    expect(result).toMatchObject({ status: "initial-state-unavailable", initialStateQuality: "awaiting", reason: "stale recovery" });
  });

  it("rejects a non-future goal before evaluating Forecast", async () => {
    await expect(solveModelEpisodeTarget({ ...request, goal: { ...request.goal, goalDate: "2026-08-23" }, now }, {} as never))
      .rejects.toThrow(/after/);
    expect(mocks.forecast).not.toHaveBeenCalled();
  });
});
