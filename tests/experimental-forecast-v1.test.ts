import { describe, expect, it } from "vitest";
import { persistedEpisodeFixture } from "./model-episode-fixtures";
import type { ExperimentalForecastInitialState } from "@/modules/experimental-forecast-v1/contracts";
import { runExperimentalForecast, type ExperimentalForecastBehavior } from "@/modules/experimental-forecast-v1/engine";
import { createForecastWorkoutEvent } from "@/modules/model-forecast/forecast-workout-scenario";

const episode = persistedEpisodeFixture("2026-08-22");
const initial: ExperimentalForecastInitialState = {
  unified: {} as never,
  sourceResult: {} as never,
  anchorDate: "2026-08-22",
  anchorWeightKg: 80,
  fatMassKg: 16,
  slowNonFatKg: 64,
  glycogenRelativeKg: { point: 0, lower: -0.2, upper: 0.2, representation: "engineering-range" },
  glycogenWaterKg: { point: 1, lower: 0.8, upper: 1.2, representation: "engineering-range" },
  transientWaterKg: { point: 0, lower: -0.2, upper: 0.2, representation: "engineering-range" },
  restingRmrKcalPerDay: 1_700,
  typicalMaintenanceKcalPerDay: 2_400,
  latestExpenditureKcalPerDay: 2_400,
  quality: "standard",
  eligibleDays: 28,
  requestedWindowDays: 28,
  uncertaintyReasons: [],
  unifiedFingerprint: "unified-test-fingerprint",
};

const baseline: ExperimentalForecastBehavior = {
  caloriesKcal: 2_400,
  proteinG: 150,
  fatG: 75,
  carbsG: 250,
  outsideWorkWalkingDistanceKm: 4,
  averageWalkingSpeedKmh: 5,
  strengthTrainingMinutes: 0,
  stepperMinutes: 0,
  occupation: [],
};

function forecast(mode: "maintain-current" | "target-deficit" | "target-surplus", horizonDays = 30) {
  return runExperimentalForecast({
    initial,
    simulatorState: episode.initialState,
    parameters: episode.simulatorParameters,
    personalization: { personalOffsetKcalPerDay: 0, activityCalibration: 1 },
    ecfPolicy: "hold-ecf",
    baseline,
    scenario: mode === "maintain-current" ? { mode } : { mode, deltaCaloriesKcal: mode === "target-deficit" ? -400 : 400 },
    startDate: "2026-08-23",
    horizonDays,
    seed: 20260823,
  });
}

describe("ExperimentalForecastV1", () => {
  it.each([7, 30, 90, 180, 365])("supports %i-day horizon", (horizonDays) => {
    expect(forecast("maintain-current", horizonDays).dates).toHaveLength(horizonDays);
  });

  it("is deterministic for identical state, scenario and seed", () => {
    expect(forecast("target-deficit", 30)).toEqual(forecast("target-deficit", 30));
  });

  it("changes intake for deficit/surplus without adding fake activity dose", () => {
    const deficit = forecast("target-deficit").dates.at(-1)!;
    const surplus = forecast("target-surplus").dates.at(-1)!;
    expect(deficit.intakeKcal.median).toBe(2_000);
    expect(surplus.intakeKcal.median).toBe(2_800);
    expect(new Set(deficit.selectedDoseKeys).size).toBe(deficit.selectedDoseKeys.length);
    expect(deficit.selectedDoseKeys).toContain("baseline:activity");
    expect(deficit.selectedDoseKeys).toContain("activity:walking");
  });

  it("marks limited history and widens the engineering range", () => {
    const limited = runExperimentalForecast({
      ...({
        initial: { ...initial, quality: "limited-history", eligibleDays: 8, requestedWindowDays: 28 },
        simulatorState: episode.initialState,
        parameters: episode.simulatorParameters,
        personalization: { personalOffsetKcalPerDay: 0, activityCalibration: 1 },
        ecfPolicy: "hold-ecf" as const,
        baseline,
        scenario: { mode: "maintain-current" as const },
        startDate: "2026-08-23",
        horizonDays: 30,
        seed: 1,
      }),
    });
    expect(limited.status).toBe("limited-history");
    expect(limited.coverage).toEqual({ eligibleDays: 8, requestedWindowDays: 28 });
    expect(limited.dates[29]!.weightChangeFromAnchorKg.upper - limited.dates[29]!.weightChangeFromAnchorKg.lower)
      .toBeGreaterThan(0.5);
  });

  it("applies rest, strength, stepper, and combined future days without duplicate activity doses", () => {
    const strength = createForecastWorkoutEvent({ type: "Traditional Strength Training", durationMinutes: 45 });
    const stepper = createForecastWorkoutEvent({ type: "Stair Climbing", durationMinutes: 20 });
    const result = runExperimentalForecast({
      initial,
      simulatorState: episode.initialState,
      parameters: episode.simulatorParameters,
      personalization: { personalOffsetKcalPerDay: 0, activityCalibration: 1 },
      ecfPolicy: "hold-ecf",
      baseline,
      scenario: { mode: "explicit-plan", caloriesKcal: 2_400, activityReplacement: "replace" },
      behaviorForDate: (_date, dayIndex) => ({
        ...baseline,
        workoutActivity: dayIndex === 1
          ? { events: [strength] }
          : dayIndex === 2
            ? { events: [stepper] }
            : dayIndex === 3
              ? { events: [strength, stepper] }
              : undefined,
      }),
      startDate: "2026-08-23",
      horizonDays: 4,
      seed: 20260823,
    });
    expect(result.dates[0]!.selectedDoseKeys).not.toContain("activity:strength");
    expect(result.dates[1]!.selectedDoseKeys).toContain("activity:strength");
    expect(result.dates[2]!.selectedDoseKeys).toContain("activity:stepper");
    expect(result.dates[3]!.selectedDoseKeys).toEqual(expect.arrayContaining(["activity:strength", "activity:stepper"]));
    for (const day of result.dates) {
      expect(new Set(day.selectedDoseKeys).size).toBe(day.selectedDoseKeys.length);
    }
  });
});
