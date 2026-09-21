import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  EXPERIMENTAL_AGE_RELATED_MAINTENANCE_UNCERTAINTY_V1_PRIORS,
  evaluateExperimentalAgeRelatedMaintenanceUncertaintyV1,
  experimentalAgeRelatedMaintenanceUncertaintyV1Fingerprint,
  rebuildExperimentalAgeRelatedMaintenanceUncertaintyTrajectoryV1,
} from "@/model/physiology-v7/experimental-age-related-maintenance-uncertainty-v1";
import { estimateExperimentalSkeletalMuscleDeltaV1 } from "@/model/physiology-v7/experimental-skeletal-muscle-delta-v1";

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

describe("Experimental Age-Related Maintenance Uncertainty V1 (shadow only)", () => {
  it("does not let age automatically create skeletal-muscle loss (C-C04)", () => {
    const rest = estimateExperimentalSkeletalMuscleDeltaV1({
      qualifiedHardSetCount: 0,
      trainingExposureKind: "verified-no-exposure",
      proteinGPerKg: 1.8,
      energyBalanceKcal: 0,
    });
    const result = evaluateExperimentalAgeRelatedMaintenanceUncertaintyV1({
      ageYears: 90,
      underlying: rest,
    });

    expect(result.ageAdjustedPointEstimateKg).toBe(0);
    expect(result.ageGeneratedNegativeDelta).toBe(false);
    expect(result.centralEstimateModified).toBe(false);
    expect(result.rejectedConversions).toContain("age-to-automatic-negative-muscle-delta");
  });

  it("allows older age to widen uncertainty without shifting the central delta", () => {
    const underlying = trainedDelta();
    const younger = evaluateExperimentalAgeRelatedMaintenanceUncertaintyV1({ ageYears: 25, underlying });
    const older = evaluateExperimentalAgeRelatedMaintenanceUncertaintyV1({ ageYears: 75, underlying });

    expect(older.uncertaintyWidthMultiplier).toBeGreaterThan(younger.uncertaintyWidthMultiplier!);
    expect(older.ageAdjustedPointEstimateKg).toBe(underlying.estimatedSkeletalMuscleDeltaKg);
    expect(older.ageAdjustedLowerBoundKg!).toBeLessThanOrEqual(underlying.lowerBoundKg!);
    expect(older.ageAdjustedUpperBoundKg!).toBeGreaterThanOrEqual(underlying.upperBoundKg!);
  });

  it("uses a smooth age context rather than a hard threshold discontinuity", () => {
    const underlying = trainedDelta();
    const at49 = evaluateExperimentalAgeRelatedMaintenanceUncertaintyV1({ ageYears: 49, underlying });
    const at50 = evaluateExperimentalAgeRelatedMaintenanceUncertaintyV1({ ageYears: 50, underlying });
    const at51 = evaluateExperimentalAgeRelatedMaintenanceUncertaintyV1({ ageYears: 51, underlying });

    expect(at49.uncertaintyWidthMultiplier).toBeLessThan(at50.uncertaintyWidthMultiplier!);
    expect(at50.uncertaintyWidthMultiplier).toBeLessThan(at51.uncertaintyWidthMultiplier!);
    expect(at51.uncertaintyWidthMultiplier! - at49.uncertaintyWidthMultiplier!).toBeLessThan(0.01);
    expect(EXPERIMENTAL_AGE_RELATED_MAINTENANCE_UNCERTAINTY_V1_PRIORS.scientificDecision)
      .toBe("no-universal-age-cutoff-or-daily-annual-muscle-loss-coefficient");
  });

  it("preserves existing training and protein behavior instead of recalculating it", () => {
    const lowerProtein = trainedDelta(0.7);
    const higherProtein = trainedDelta(1.8);
    const lowerResult = evaluateExperimentalAgeRelatedMaintenanceUncertaintyV1({
      ageYears: 70,
      underlying: lowerProtein,
    });
    const higherResult = evaluateExperimentalAgeRelatedMaintenanceUncertaintyV1({
      ageYears: 70,
      underlying: higherProtein,
    });

    expect(higherProtein.estimatedSkeletalMuscleDeltaKg!)
      .toBeGreaterThanOrEqual(lowerProtein.estimatedSkeletalMuscleDeltaKg!);
    expect(higherResult.ageAdjustedPointEstimateKg)
      .toBe(higherProtein.estimatedSkeletalMuscleDeltaKg);
    expect(lowerResult.ageAdjustedPointEstimateKg)
      .toBe(lowerProtein.estimatedSkeletalMuscleDeltaKg);
    expect(higherResult.trainingProteinMathChanged).toBe(false);
  });

  it("keeps missing age unavailable rather than interpreting it as zero effect", () => {
    const underlying = trainedDelta();
    const result = evaluateExperimentalAgeRelatedMaintenanceUncertaintyV1({
      ageYears: null,
      underlying,
    });

    expect(result.availability).toBe("unavailable");
    expect(result.ageContextStatus).toBe("age-unavailable");
    expect(result.uncertaintyWidthMultiplier).toBeNull();
    expect(result.ageAdjustedPointEstimateKg).toBe(underlying.estimatedSkeletalMuscleDeltaKg);
    expect(result.ageAdjustedLowerBoundKg).toBeNull();
  });

  it("rebuilds deterministically and remains outside production paths", () => {
    const underlying = trainedDelta();
    const days = [
      { date: "2026-09-21", ageYears: 70, underlying },
      { date: "2026-09-20", ageYears: null, underlying },
    ];
    const first = rebuildExperimentalAgeRelatedMaintenanceUncertaintyTrajectoryV1({ days });
    const second = rebuildExperimentalAgeRelatedMaintenanceUncertaintyTrajectoryV1({
      days: [...days].reverse(),
    });
    const productionSources = [
      "src/model/physiology-v7/daily-runtime-v7.ts",
      "src/modules/model-forecast/forecast-engine.ts",
      "src/model/base-tdee.ts",
    ].map((path) => readFileSync(path, "utf8")).join("\n");

    expect(first).toEqual(second);
    expect(experimentalAgeRelatedMaintenanceUncertaintyV1Fingerprint(first[0]!.result))
      .toBe(experimentalAgeRelatedMaintenanceUncertaintyV1Fingerprint(second[0]!.result));
    expect(productionSources).not.toContain("experimental-age-related-maintenance-uncertainty");
  });
});
