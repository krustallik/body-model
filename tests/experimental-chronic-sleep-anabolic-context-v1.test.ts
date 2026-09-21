import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  EXPERIMENTAL_CHRONIC_SLEEP_ANABOLIC_CONTEXT_V1_PRIORS,
  experimentalChronicSleepAnabolicContextV1Fingerprint,
  rebuildExperimentalChronicSleepAnabolicContextTrajectoryV1,
  transitionExperimentalChronicSleepAnabolicContextV1,
} from "@/model/physiology-v7/experimental-chronic-sleep-anabolic-context-v1";
import { estimateExperimentalSkeletalMuscleDeltaV1 } from "@/model/physiology-v7/experimental-skeletal-muscle-delta-v1";
import type { SleepObservationV7 } from "@/model/physiology-v7/sleep-hrv-context-v7";

function trainedDelta(proteinGPerKg = 1.8) {
  return estimateExperimentalSkeletalMuscleDeltaV1({
    qualifiedHardSetCount: 12,
    mappedMuscleGroupCount: 4,
    trainingExposureKind: "qualified-mapped-training",
    trainingStatus: "intermediate",
    proteinGPerKg,
    energyBalanceKcal: 0,
  });
}

function sleep(durationMinutes: number, stages?: { remMinutes: number; coreMinutes: number; deepMinutes: number }): SleepObservationV7 {
  return {
    availability: "available",
    durationMinutes,
    source: "wearable-consumer",
    stages: stages ?? null,
  };
}

describe("Experimental Chronic Sleep / Anabolic Context V1 (shadow only)", () => {
  it("does not let one poor night alter the muscle point estimate (C-M01)", () => {
    const underlying = trainedDelta();
    const result = transitionExperimentalChronicSleepAnabolicContextV1({
      sleepObservation: sleep(300),
      underlying,
    });

    expect(result.sleepContextStatus).toBe("one-low-sleep-night-context");
    expect(result.sleepAdjustedPointEstimateKg).toBe(underlying.estimatedSkeletalMuscleDeltaKg);
    expect(result.centralEstimateModified).toBe(false);
    expect(result.positiveAnabolicBonusFromSleep).toBe(0);
    expect(result.uncertaintyWidthMultiplier).toBe(1);
  });

  it("distinguishes repeated observed low-sleep context from one-night noise", () => {
    const underlying = trainedDelta();
    const rows = rebuildExperimentalChronicSleepAnabolicContextTrajectoryV1({
      days: [0, 1, 2].map((day) => ({
        date: `2026-09-${String(20 + day).padStart(2, "0")}`,
        sleepObservation: sleep(300),
        underlying,
      })),
    });

    expect(rows[0]!.result.sleepContextStatus).toBe("one-low-sleep-night-context");
    expect(rows[2]!.result.sleepContextStatus).toBe("sustained-observed-low-sleep-context");
    expect(rows[2]!.result.state.consecutiveObservedLowSleepNights).toBe(3);
    expect(rows[2]!.result.uncertaintyWidthMultiplier)
      .toBe(EXPERIMENTAL_CHRONIC_SLEEP_ANABOLIC_CONTEXT_V1_PRIORS.sustainedRestrictionUncertaintyWidthMultiplier);
    expect(rows[2]!.result.sleepAdjustedPointEstimateKg).toBe(underlying.estimatedSkeletalMuscleDeltaKg);
  });

  it("keeps missing sleep unknown rather than treating it as zero sleep", () => {
    const underlying = trainedDelta();
    const result = transitionExperimentalChronicSleepAnabolicContextV1({
      sleepObservation: null,
      underlying,
    });

    expect(result.availability).toBe("unavailable");
    expect(result.sleepContextStatus).toBe("unknown-sleep-coverage");
    expect(result.uncertaintyWidthMultiplier).toBeNull();
    expect(result.sleepAdjustedPointEstimateKg).toBe(underlying.estimatedSkeletalMuscleDeltaKg);
  });

  it("does not use sleep stages to drive body composition and retains wearable uncertainty", () => {
    const underlying = trainedDelta();
    const result = transitionExperimentalChronicSleepAnabolicContextV1({
      sleepObservation: sleep(300, { remMinutes: 10, coreMinutes: 20, deepMinutes: 250 }),
      underlying,
    });

    expect(result.sleepStageDrivenBodyComposition).toBe(false);
    expect(result.rejectedConversions).toContain("sleep-stage-to-body-composition");
    expect(result.wearableSleepIsNotPsg).toBe(true);
    expect(result.measurementUncertainty).toBe("retained");
  });

  it("preserves existing training, protein, and energy point math", () => {
    const lowerProtein = trainedDelta(0.7);
    const higherProtein = trainedDelta(1.8);
    const lower = transitionExperimentalChronicSleepAnabolicContextV1({
      sleepObservation: sleep(300), underlying: lowerProtein,
    });
    const higher = transitionExperimentalChronicSleepAnabolicContextV1({
      sleepObservation: sleep(300), underlying: higherProtein,
    });

    expect(higherProtein.estimatedSkeletalMuscleDeltaKg!)
      .toBeGreaterThanOrEqual(lowerProtein.estimatedSkeletalMuscleDeltaKg!);
    expect(lower.sleepAdjustedPointEstimateKg).toBe(lowerProtein.estimatedSkeletalMuscleDeltaKg);
    expect(higher.sleepAdjustedPointEstimateKg).toBe(higherProtein.estimatedSkeletalMuscleDeltaKg);
    expect(higher.trainingProteinEnergyMathChanged).toBe(false);
  });

  it("rebuilds deterministically and remains outside production paths", () => {
    const underlying = trainedDelta();
    const days = [
      { date: "2026-09-22", sleepObservation: sleep(300), underlying },
      { date: "2026-09-20", sleepObservation: sleep(300), underlying },
      { date: "2026-09-21", sleepObservation: sleep(300), underlying },
    ];
    const first = rebuildExperimentalChronicSleepAnabolicContextTrajectoryV1({ days });
    const second = rebuildExperimentalChronicSleepAnabolicContextTrajectoryV1({
      days: [...days].reverse(),
    });
    const productionSources = [
      "src/model/physiology-v7/daily-runtime-v7.ts",
      "src/modules/model-forecast/forecast-engine.ts",
      "src/model/base-tdee.ts",
    ].map((path) => readFileSync(path, "utf8")).join("\n");

    expect(first).toEqual(second);
    expect(experimentalChronicSleepAnabolicContextV1Fingerprint(first[0]!.result))
      .toBe(experimentalChronicSleepAnabolicContextV1Fingerprint(second[0]!.result));
    expect(productionSources).not.toContain("experimental-chronic-sleep-anabolic-context");
  });
});
