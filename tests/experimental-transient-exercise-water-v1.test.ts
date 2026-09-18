import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  ENGINEERING_RESOLUTION_HORIZON_DAYS_V1,
  estimateExperimentalTransientExerciseWaterV1,
  experimentalTransientExerciseWaterV1Fingerprint,
  EXPERIMENTAL_TRANSIENT_EXERCISE_WATER_V1_PROVENANCE,
  EXPERIMENTAL_TRANSIENT_EXERCISE_WATER_V1_REVISION,
  engineeringFiniteDecayFactorV1,
} from "@/model/physiology-v7/experimental-transient-exercise-water-v1";
import {
  ACUTE_SWELLING_NOT_SKELETAL_MUSCLE_POLICY_V7,
  rejectAcuteSwellingAsSkeletalMuscleV7,
} from "@/model/physiology-v7/transient-exercise-water-ecf-transition-v7";

/**
 * EXPERIMENTAL harness — not scientific validation / GREEN oracle.
 */
describe("experimental transient exercise water v1", () => {
  it("applies a nonnegative acute resistance transient-water impulse", () => {
    const result = estimateExperimentalTransientExerciseWaterV1({
      priorTransientWaterKg: 0,
      daysElapsed: 0,
      resistanceSession: {
        qualifiedHardSetCount: 10,
        exposureContext: "accustomed",
      },
      skeletalMuscleKg: 30,
    });
    expect(result.availability).toBe("available");
    expect(result.acuteImpulseKg.point).toBeGreaterThan(0);
    expect(result.acuteImpulseKg.lower).toBeGreaterThanOrEqual(0);
    expect(result.acuteImpulseKg.upper).toBeGreaterThanOrEqual(result.acuteImpulseKg.point);
    expect(result.resultingTransientWaterKg.point!).toBeGreaterThan(0);
    expect(result.transientWaterDeltaKg.point!).toBeGreaterThan(0);
    expect(result.transientWaterDeltaKg.lower).not.toBeNull();
    expect(result.transientWaterDeltaKg.upper).not.toBeNull();
    expect(result.provenance).toBe(EXPERIMENTAL_TRANSIENT_EXERCISE_WATER_V1_PROVENANCE);
    expect(result.contractVersion).toBe(EXPERIMENTAL_TRANSIENT_EXERCISE_WATER_V1_REVISION);
    expect(result.supportedDomain).toBe("resistance-transient-water-shadow-only");
  });

  it("decays isolated transient water monotonically toward baseline (C-J06)", () => {
    const day0 = estimateExperimentalTransientExerciseWaterV1({
      priorTransientWaterKg: 0,
      daysElapsed: 0,
      resistanceSession: {
        qualifiedHardSetCount: 12,
        exposureContext: "novel-or-unknown",
      },
    });
    const w0 = day0.resultingTransientWaterKg.point!;
    const day1 = estimateExperimentalTransientExerciseWaterV1({
      priorTransientWaterKg: w0,
      daysElapsed: 1,
      resistanceSession: null,
      skeletalMuscleKg: 28,
    });
    const day2 = estimateExperimentalTransientExerciseWaterV1({
      priorTransientWaterKg: day1.resultingTransientWaterKg.point,
      daysElapsed: 1,
      resistanceSession: null,
    });
    expect(day1.resultingTransientWaterKg.point!).toBeLessThan(w0);
    expect(day2.resultingTransientWaterKg.point!)
      .toBeLessThanOrEqual(day1.resultingTransientWaterKg.point!);
    expect(day1.resultingTransientWaterKg.point!).toBeGreaterThanOrEqual(0);
    expect(day1.reasons).toContain("decay-only-no-new-resistance-cause");
  });

  it("reaches finite resolution without asserting a scientific half-life", () => {
    expect(engineeringFiniteDecayFactorV1(5, 5)).toBe(0);
    expect(engineeringFiniteDecayFactorV1(6, 5)).toBe(0);
    const elevated = 0.3;
    const horizon = ENGINEERING_RESOLUTION_HORIZON_DAYS_V1.accustomed.pointDays;
    const resolved = estimateExperimentalTransientExerciseWaterV1({
      priorTransientWaterKg: elevated,
      daysElapsed: horizon,
      // Zero-set session carries accustomed horizon without a new acute impulse.
      resistanceSession: {
        qualifiedHardSetCount: 0,
        exposureContext: "accustomed",
      },
    });
    expect(resolved.resultingTransientWaterKg.point).toBe(0);
    expect(resolved.reasons).toContain("no-scientific-half-life-asserted");
    expect(resolved.features.rejectedConversions).toContain("scientific-half-life-coefficient");
  });

  it("never produces negative transient water", () => {
    const result = estimateExperimentalTransientExerciseWaterV1({
      priorTransientWaterKg: 0.05,
      daysElapsed: 10,
      resistanceSession: null,
    });
    expect(result.resultingTransientWaterKg.point!).toBeGreaterThanOrEqual(0);
    expect(result.resultingTransientWaterKg.lower!).toBeGreaterThanOrEqual(0);
    expect(result.resultingTransientWaterKg.upper!).toBeGreaterThanOrEqual(0);
  });

  it("never converts swelling into skeletalMuscleKg", () => {
    const skeletalMuscleKg = 32.5;
    const result = estimateExperimentalTransientExerciseWaterV1({
      priorTransientWaterKg: 0,
      daysElapsed: 0,
      resistanceSession: {
        qualifiedHardSetCount: 8,
        exposureContext: "novel-or-unknown",
      },
      skeletalMuscleKg,
    });
    const rejection = rejectAcuteSwellingAsSkeletalMuscleV7({ skeletalMuscleKg });
    expect(result.features.skeletalMuscleRejected).toBe(true);
    expect(result.swellingNotSkeletalMusclePolicy).toEqual(
      ACUTE_SWELLING_NOT_SKELETAL_MUSCLE_POLICY_V7,
    );
    expect(result.features.rejectedConversions).toContain(
      "transient-water-to-skeletal-muscle-kg",
    );
    expect(rejection.resultingSkeletalMuscleKg).toBe(skeletalMuscleKg);
    expect(result.resultingTransientWaterKg.point!).toBeGreaterThan(0);
    expect(JSON.stringify(result)).not.toMatch(/resultingSkeletalMuscleKg/);
  });

  it("treats missing resistance evidence and prior state as unavailable, not zero", () => {
    const missing = estimateExperimentalTransientExerciseWaterV1({
      priorTransientWaterKg: null,
      daysElapsed: 1,
      resistanceSession: null,
    });
    expect(missing.availability).toBe("unavailable");
    expect(missing.resultingTransientWaterKg.point).toBeNull();
    expect(missing.transientWaterDeltaKg.point).toBeNull();
    expect(missing.unavailableReason).toBe("missing-resistance-evidence-and-prior-state");
    expect(missing.reasons).toContain("missing-evidence-is-not-zero-transient-water");
  });

  it("is deterministic for identical inputs", () => {
    const input = {
      priorTransientWaterKg: 0.12,
      daysElapsed: 1,
      resistanceSession: {
        qualifiedHardSetCount: 6,
        exposureContext: "accustomed" as const,
      },
      skeletalMuscleKg: 30,
    };
    const a = estimateExperimentalTransientExerciseWaterV1(input);
    const b = estimateExperimentalTransientExerciseWaterV1(input);
    expect(a).toEqual(b);
    expect(experimentalTransientExerciseWaterV1Fingerprint(a))
      .toBe(experimentalTransientExerciseWaterV1Fingerprint(b));
  });

  it("uses exposure for resolution domain only without inventing attenuation coefficients (C-J03)", () => {
    const accustomed = estimateExperimentalTransientExerciseWaterV1({
      priorTransientWaterKg: 0,
      daysElapsed: 0,
      resistanceSession: {
        qualifiedHardSetCount: 8,
        exposureContext: "accustomed",
      },
    });
    const novel = estimateExperimentalTransientExerciseWaterV1({
      priorTransientWaterKg: 0,
      daysElapsed: 0,
      resistanceSession: {
        qualifiedHardSetCount: 8,
        exposureContext: "novel-or-unknown",
      },
    });
    expect(accustomed.acuteImpulseKg.point).toBe(novel.acuteImpulseKg.point);
    expect(accustomed.features.resolutionHorizonPointDays).toBe(1);
    expect(novel.features.resolutionHorizonPointDays).toBe(3.5);
    expect(accustomed.features.rejectedConversions).toEqual([
      "transient-water-to-skeletal-muscle-kg",
      "scale-weight-residual",
      "scientific-half-life-coefficient",
      "exact-repeated-bout-attenuation-coefficient",
    ]);
    expect(JSON.stringify(accustomed)).not.toMatch(/residualAllocate|halfLifeHours|boutAttenuationMultiplier/i);
  });

  it("rejects residual allocation and exact repeated-bout attenuation coefficients", () => {
    const result = estimateExperimentalTransientExerciseWaterV1({
      priorTransientWaterKg: 0,
      daysElapsed: 0,
      resistanceSession: {
        qualifiedHardSetCount: 8,
        exposureContext: "accustomed",
      },
    });
    expect(result.features.rejectedConversions).toContain("scale-weight-residual");
    expect(result.reasons).toContain("scale-weight-residual-intentionally-rejected");
    expect(result.reasons).toContain(
      "exact-repeated-bout-attenuation-coefficient-intentionally-rejected",
    );
  });

  it("permits distinct accustomed vs novel resolution domains without a two-component force (C-J02)", () => {
    const elevated = 0.2;
    const accustomed = estimateExperimentalTransientExerciseWaterV1({
      priorTransientWaterKg: elevated,
      daysElapsed: 1.25,
      resistanceSession: {
        qualifiedHardSetCount: 0,
        exposureContext: "accustomed",
      },
    });
    const novel = estimateExperimentalTransientExerciseWaterV1({
      priorTransientWaterKg: elevated,
      daysElapsed: 1.25,
      resistanceSession: {
        qualifiedHardSetCount: 0,
        exposureContext: "novel-or-unknown",
      },
    });
    expect(accustomed.resultingTransientWaterKg.point!).toBe(0);
    expect(novel.resultingTransientWaterKg.point!).toBeGreaterThan(0);
    expect(accustomed.reasons).toContain("accustomed-resolution-horizon-domain");
    expect(novel.reasons).toContain("novel-or-unknown-resolution-horizon-domain");
  });

  it("permits accustomed resolution about the next day (C-J04)", () => {
    const elevated = 0.25;
    const afterNextDay = estimateExperimentalTransientExerciseWaterV1({
      priorTransientWaterKg: elevated,
      daysElapsed: ENGINEERING_RESOLUTION_HORIZON_DAYS_V1.accustomed.pointDays,
      resistanceSession: {
        qualifiedHardSetCount: 0,
        exposureContext: "accustomed",
      },
    });
    expect(afterNextDay.resultingTransientWaterKg.point).toBe(0);
    expect(afterNextDay.features.resolutionHorizonPointDays).toBe(1);
  });

  it("permits novel multi-day elevation without extreme tails (C-J05)", () => {
    const elevated = 0.25;
    const day2 = estimateExperimentalTransientExerciseWaterV1({
      priorTransientWaterKg: elevated,
      daysElapsed: 2,
      resistanceSession: {
        qualifiedHardSetCount: 0,
        exposureContext: "novel-or-unknown",
      },
    });
    const day5 = estimateExperimentalTransientExerciseWaterV1({
      priorTransientWaterKg: elevated,
      daysElapsed: ENGINEERING_RESOLUTION_HORIZON_DAYS_V1["novel-or-unknown"].upperDays,
      resistanceSession: {
        qualifiedHardSetCount: 0,
        exposureContext: "novel-or-unknown",
      },
    });
    expect(day2.resultingTransientWaterKg.point!).toBeGreaterThan(0);
    expect(day5.resultingTransientWaterKg.point).toBe(0);
    expect(day2.features.resolutionHorizonPointDays).toBe(3.5);
    expect(day2.features.resolutionHorizonPointDays!).toBeLessThanOrEqual(5);
  });

  it("does not appear in production daily-runtime, forecast, or v7 transition apply paths", () => {
    const runtime = readFileSync("src/model/physiology-v7/daily-runtime-v7.ts", "utf8");
    const forecast = readFileSync("src/modules/model-forecast/forecast-engine.ts", "utf8");
    const transition = readFileSync(
      "src/model/physiology-v7/transient-exercise-water-ecf-transition-v7.ts",
      "utf8",
    );
    expect(runtime).not.toContain("estimateExperimentalTransientExerciseWaterV1");
    expect(forecast).not.toContain("estimateExperimentalTransientExerciseWaterV1");
    expect(transition).not.toContain("estimateExperimentalTransientExerciseWaterV1");
  });
});
