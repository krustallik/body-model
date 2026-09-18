import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { transitionFatWeightShadowV1 } from "@/model/physiology-v7/fat-weight-shadow-v1";
import {
  ENGINEERING_FAT_COMPOSITION_HALFWIDTH_KG_V1,
  ENGINEERING_SCALE_WEIGHT_HALFWIDTH_KG_V1,
  EXPERIMENTAL_FAT_WEIGHT_UNCERTAINTY_PRIORS_V1,
  EXPERIMENTAL_FAT_WEIGHT_UNCERTAINTY_V1_PROVENANCE,
  EXPERIMENTAL_FAT_WEIGHT_UNCERTAINTY_V1_REVISION,
  initialExperimentalFatWeightUncertaintyStateV1,
  rebuildExperimentalFatWeightUncertaintyTrajectoryV1,
  transitionExperimentalFatWeightUncertaintyV1,
} from "@/model/physiology-v7/experimental-fat-weight-uncertainty-v1";

const priorMean = {
  fatMassKg: 20,
  slowNonFatKg: 50,
  availability: "available" as const,
  provenance: "episode-bia-derived-estimate" as const,
  uncertainty: "personal-unavailable" as const,
};

/**
 * EXPERIMENTAL harness — not scientific validation / GREEN oracle.
 */
describe("experimental fat/weight uncertainty v1", () => {
  it("keeps the FatWeightShadowV1 mean point estimate unchanged (C-FW01)", () => {
    const mean = transitionFatWeightShadowV1({
      prior: priorMean,
      energyBalanceKcal: -400,
      observedWeightKg: 95,
      observedBodyFatPercent: 12,
    });
    const withUncertainty = transitionExperimentalFatWeightUncertaintyV1({
      priorMean,
      energyBalanceKcal: -400,
      observedWeightKg: 95,
      observedBodyFatPercent: 12,
      fastCompartmentContextKg: 3.5,
    });
    expect(withUncertainty.availability).toBe("available");
    expect(withUncertainty.fatMassKg.pointKg).toBe(mean.state.fatMassKg);
    expect(withUncertainty.slowNonFatKgPoint).toBe(mean.state.slowNonFatKg);
    expect(withUncertainty.modeledWeightKg.pointKg)
      .toBe(mean.state.fatMassKg! + mean.state.slowNonFatKg!);
    expect(withUncertainty.modeledWeightKg.pointKg).not.toBe(95);
    expect(withUncertainty.fatMassKg.pointKg).not.toBe(95 * 0.12);
    expect(withUncertainty.provenance).toBe(EXPERIMENTAL_FAT_WEIGHT_UNCERTAINTY_V1_PROVENANCE);
    expect(withUncertainty.contractVersion).toBe(EXPERIMENTAL_FAT_WEIGHT_UNCERTAINTY_V1_REVISION);
  });

  it("never allocates scale-model residual into fat, muscle, glycogen, water, or ECF", () => {
    const result = transitionExperimentalFatWeightUncertaintyV1({
      priorMean,
      energyBalanceKcal: -200,
      observedWeightKg: 120,
      observedBodyFatPercent: 40,
      fastCompartmentContextKg: 2,
    });
    expect(result.observation.residualAllocation).toBe("intentionally-rejected");
    expect(result.features.rejectedConversions).toEqual(
      expect.arrayContaining([
        "scale-weight-residual-into-fat",
        "scale-weight-residual-into-muscle",
        "scale-weight-residual-into-glycogen",
        "scale-weight-residual-into-water",
        "scale-weight-residual-into-ecf",
      ]),
    );
    expect(result.observation.scaleResidualKg).not.toBeNull();
    expect(result.fatMassKg.pointKg).not.toBe(
      priorMean.fatMassKg + result.observation.scaleResidualKg!,
    );
    expect(JSON.stringify(result)).not.toMatch(/skeletalMuscleKg|glycogenWaterKg|ecfDeviationKg/);
  });

  it("widens uncertainty with missing/gapped scale observations", () => {
    const dense = rebuildExperimentalFatWeightUncertaintyTrajectoryV1({
      priorMean,
      days: [
        { date: "2026-09-01", energyBalanceKcal: -100, observedWeightKg: 70.1, observedBodyFatPercent: null },
        { date: "2026-09-02", energyBalanceKcal: -100, observedWeightKg: 70.0, observedBodyFatPercent: null },
        { date: "2026-09-03", energyBalanceKcal: -100, observedWeightKg: 69.9, observedBodyFatPercent: null },
      ],
    });
    const gapped = rebuildExperimentalFatWeightUncertaintyTrajectoryV1({
      priorMean,
      days: [
        { date: "2026-09-01", energyBalanceKcal: -100, observedWeightKg: 70.1, observedBodyFatPercent: null },
        { date: "2026-09-02", energyBalanceKcal: -100, observedWeightKg: null, observedBodyFatPercent: null },
        { date: "2026-09-03", energyBalanceKcal: -100, observedWeightKg: null, observedBodyFatPercent: null },
        { date: "2026-09-04", energyBalanceKcal: -100, observedWeightKg: null, observedBodyFatPercent: null },
      ],
    });
    const denseWidth = dense[dense.length - 1]!.uncertaintyState.weightHalfWidthKg!;
    const gappedWidth = gapped[gapped.length - 1]!.uncertaintyState.weightHalfWidthKg!;
    expect(gappedWidth).toBeGreaterThan(denseWidth);
    expect(gapped[1]!.features.scaleObservationMissing).toBe(true);
    expect(gapped[1]!.reasons).toContain("missing-scale-observation-widens-uncertainty-not-zero");
    expect(gapped[1]!.uncertaintyState.weightHalfWidthKg).not.toBe(0);
  });

  it("may reduce uncertainty after repeated compatible scale observations", () => {
    const trajectory = rebuildExperimentalFatWeightUncertaintyTrajectoryV1({
      priorMean,
      priorUncertainty: initialExperimentalFatWeightUncertaintyStateV1(),
      days: Array.from({ length: 6 }, (_, index) => ({
        date: `2026-09-${String(index + 1).padStart(2, "0")}`,
        energyBalanceKcal: 0,
        // Near modeled weight (~70) so residual stays compatible.
        observedWeightKg: 70.05,
        observedBodyFatPercent: null,
      })),
    });
    const first = trajectory[0]!.uncertaintyState.weightHalfWidthKg!;
    const last = trajectory[trajectory.length - 1]!.uncertaintyState.weightHalfWidthKg!;
    expect(last).toBeLessThan(first);
    expect(trajectory[trajectory.length - 1]!.uncertaintyState.consecutiveCompatibleScaleDays)
      .toBeGreaterThanOrEqual(3);
    expect(trajectory[trajectory.length - 1]!.reasons).toContain(
      "repeated-compatible-scale-observations-support-narrower-uncertainty",
    );
  });

  it("treats mixed/noisy BIA and extreme scale residuals as context, not truth", () => {
    const noisy = transitionExperimentalFatWeightUncertaintyV1({
      priorMean,
      energyBalanceKcal: -150,
      observedWeightKg: 140,
      observedBodyFatPercent: 5,
    });
    expect(noisy.fatMassKg.pointKg).not.toBe(140 * 0.05);
    expect(noisy.modeledWeightKg.pointKg).not.toBe(140);
    expect(noisy.observation.biaHandling).toBe("noisy-context-not-truth");
    expect(noisy.features.rejectedConversions).toContain("bia-body-fat-as-truth");
    expect(noisy.features.compatibleScaleObservation).toBe(false);
    expect(noisy.reasons).toContain("incompatible-scale-observation-widens-uncertainty-not-truth");
  });

  it("reproduces the same trajectory on deterministic historical rebuild", () => {
    const days = [
      { date: "2026-09-10", energyBalanceKcal: -300, observedWeightKg: 69.8, observedBodyFatPercent: 22 },
      { date: "2026-09-11", energyBalanceKcal: -250, observedWeightKg: null, observedBodyFatPercent: null },
      { date: "2026-09-12", energyBalanceKcal: -200, observedWeightKg: 69.5, observedBodyFatPercent: 21 },
    ];
    const a = rebuildExperimentalFatWeightUncertaintyTrajectoryV1({ priorMean, days });
    const b = rebuildExperimentalFatWeightUncertaintyTrajectoryV1({ priorMean, days });
    expect(a.map((row) => row.fingerprint)).toEqual(b.map((row) => row.fingerprint));
    expect(a.map((row) => row.fatMassKg)).toEqual(b.map((row) => row.fatMassKg));
    expect(a.map((row) => row.modeledWeightKg)).toEqual(b.map((row) => row.modeledWeightKg));
  });

  it("keeps engineering priors classified and ordered lower ≤ point ≤ upper", () => {
    const result = transitionExperimentalFatWeightUncertaintyV1({
      priorMean,
      energyBalanceKcal: -100,
      observedWeightKg: 70,
      observedBodyFatPercent: null,
    });
    expect(ENGINEERING_SCALE_WEIGHT_HALFWIDTH_KG_V1).toBe(0.5);
    expect(ENGINEERING_FAT_COMPOSITION_HALFWIDTH_KG_V1).toBe(2.0);
    expect(EXPERIMENTAL_FAT_WEIGHT_UNCERTAINTY_PRIORS_V1.scaleClassification)
      .toBe("engineering-order-of-magnitude-band");
    expect(result.fatMassKg.lowerKg!).toBeLessThanOrEqual(result.fatMassKg.pointKg!);
    expect(result.fatMassKg.pointKg!).toBeLessThanOrEqual(result.fatMassKg.upperKg!);
    expect(result.modeledWeightKg.lowerKg!).toBeLessThanOrEqual(result.modeledWeightKg.pointKg!);
    expect(result.modeledWeightKg.pointKg!).toBeLessThanOrEqual(result.modeledWeightKg.upperKg!);
  });

  it("does not appear in production forecast, TDEE, daily-runtime, or FatWeightShadow mean paths", () => {
    const runtime = readFileSync("src/model/physiology-v7/daily-runtime-v7.ts", "utf8");
    const forecast = readFileSync("src/modules/model-forecast/forecast-engine.ts", "utf8");
    const tdee = readFileSync("src/model/base-tdee.ts", "utf8");
    const mean = readFileSync("src/model/physiology-v7/fat-weight-shadow-v1.ts", "utf8");
    expect(runtime).not.toContain("transitionExperimentalFatWeightUncertaintyV1");
    expect(forecast).not.toContain("transitionExperimentalFatWeightUncertaintyV1");
    expect(tdee).not.toContain("transitionExperimentalFatWeightUncertaintyV1");
    expect(mean).not.toContain("transitionExperimentalFatWeightUncertaintyV1");
    expect(mean).toContain("transitionFatWeightShadowV1");
  });
});
