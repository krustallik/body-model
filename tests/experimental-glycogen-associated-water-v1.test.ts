import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  EXPERIMENTAL_GLYCOGEN_ASSOCIATED_WATER_V1_PROVENANCE,
  EXPERIMENTAL_GLYCOGEN_ASSOCIATED_WATER_V1_REVISION,
  SCIENTIFIC_GLYCOGEN_ASSOCIATED_WATER_RATIO_KG_PER_KG_V1,
  estimateExperimentalGlycogenAssociatedWaterV1,
  experimentalGlycogenAssociatedWaterV1Fingerprint,
} from "@/model/physiology-v7/experimental-glycogen-associated-water-v1";
import { GLYCOGEN_WATER_KG_PER_KG } from "@/model/body-composition/constants";

/**
 * EXPERIMENTAL harness — not scientific validation / GREEN oracle.
 */
describe("experimental glycogen-associated water v1", () => {
  it("maps glycogen depletion to water loss of the same sign", () => {
    const result = estimateExperimentalGlycogenAssociatedWaterV1({
      glycogenDeltaKg: -0.04,
      currentGlycogenWaterKg: 1.2,
    });
    expect(result.availability).toBe("available");
    expect(result.estimatedGlycogenWaterDeltaKg!).toBeLessThan(0);
    expect(Math.sign(result.estimatedGlycogenWaterDeltaKg!))
      .toBe(Math.sign(-0.04));
    expect(result.estimatedGlycogenWaterDeltaKg!)
      .toBeCloseTo(-0.04 * SCIENTIFIC_GLYCOGEN_ASSOCIATED_WATER_RATIO_KG_PER_KG_V1.pointKgPerKg);
    expect(result.provenance).toBe(EXPERIMENTAL_GLYCOGEN_ASSOCIATED_WATER_V1_PROVENANCE);
    expect(result.contractVersion).toBe(EXPERIMENTAL_GLYCOGEN_ASSOCIATED_WATER_V1_REVISION);
  });

  it("maps glycogen repletion to water gain of the same sign", () => {
    const result = estimateExperimentalGlycogenAssociatedWaterV1({
      glycogenDeltaKg: 0.05,
      currentGlycogenWaterKg: 0.8,
    });
    expect(result.availability).toBe("available");
    expect(result.estimatedGlycogenWaterDeltaKg!).toBeGreaterThan(0);
    expect(result.estimatedGlycogenWaterDeltaKg!)
      .toBeCloseTo(0.05 * SCIENTIFIC_GLYCOGEN_ASSOCIATED_WATER_RATIO_KG_PER_KG_V1.pointKgPerKg);
  });

  it("keeps lower/point/upper ordered within the scientific 3–4 ratio band", () => {
    const result = estimateExperimentalGlycogenAssociatedWaterV1({
      glycogenDeltaKg: 0.1,
    });
    expect(result.lowerBoundKg!).toBeLessThanOrEqual(result.estimatedGlycogenWaterDeltaKg!);
    expect(result.estimatedGlycogenWaterDeltaKg!).toBeLessThanOrEqual(result.upperBoundKg!);
    expect(result.lowerBoundKg!).toBeCloseTo(0.1 * 3);
    expect(result.upperBoundKg!).toBeCloseTo(0.1 * 4);
    expect(result.features.ratioLowerKgPerKg).toBe(3);
    expect(result.features.ratioUpperKgPerKg).toBe(4);
    expect(result.features.rejectedLegacyFixedRatioKgPerKg).toBe(2.7);
    expect(GLYCOGEN_WATER_KG_PER_KG).toBe(2.7);
    expect(result.features.ratioPointKgPerKg).not.toBe(GLYCOGEN_WATER_KG_PER_KG);
    expect(SCIENTIFIC_GLYCOGEN_ASSOCIATED_WATER_RATIO_KG_PER_KG_V1.rangeClassification)
      .toBe("scientific-literature-range");
  });

  it("orders depletion bounds so more-negative upper-ratio loss is the lower bound", () => {
    const result = estimateExperimentalGlycogenAssociatedWaterV1({
      glycogenDeltaKg: -0.1,
      currentGlycogenWaterKg: 2,
    });
    expect(result.lowerBoundKg!).toBeCloseTo(-0.4);
    expect(result.upperBoundKg!).toBeCloseTo(-0.3);
    expect(result.estimatedGlycogenWaterDeltaKg!).toBeCloseTo(-0.35);
  });

  it("treats missing glycogen delta as unavailable, not zero water", () => {
    const missing = estimateExperimentalGlycogenAssociatedWaterV1({
      glycogenDeltaKg: null,
      currentGlycogenWaterKg: 1.0,
    });
    expect(missing.availability).toBe("unavailable");
    expect(missing.estimatedGlycogenWaterDeltaKg).toBeNull();
    expect(missing.lowerBoundKg).toBeNull();
    expect(missing.upperBoundKg).toBeNull();
    expect(missing.unavailableReason).toBe("missing-glycogen-delta");
    expect(missing.reasons).toContain("missing-glycogen-delta-is-not-zero-water");
  });

  it("keeps glycogen-associated water separate from ECF and transient exercise water", () => {
    const result = estimateExperimentalGlycogenAssociatedWaterV1({
      glycogenDeltaKg: 0.02,
    });
    expect(result.compartmentSeparation).toEqual({
      glycogenAssociatedWater: "separate-compartment",
      ecfDeviation: "not-a-fallback-or-residual",
      transientExerciseWater: "not-mixed",
    });
    expect(result.features.rejectedConversions).toEqual(
      expect.arrayContaining([
        "ecf-substitution",
        "transient-exercise-water-mixing",
      ]),
    );
    expect(JSON.stringify(result)).not.toMatch(/ecfDeviationKg|transientExerciseWaterKg/);
  });

  it("rejects scale-weight residual allocation into glycogen water", () => {
    const result = estimateExperimentalGlycogenAssociatedWaterV1({
      glycogenDeltaKg: -0.01,
      currentGlycogenWaterKg: 1,
    });
    expect(result.features.rejectedConversions).toContain("scale-weight-residual");
    expect(result.reasons).toContain("scale-weight-residual-intentionally-rejected");
  });

  it("is deterministic for identical inputs", () => {
    const input = {
      glycogenDeltaKg: -0.025,
      glycogenDeltaLowerKg: -0.04,
      glycogenDeltaUpperKg: -0.01,
      currentGlycogenWaterKg: 1.1,
    };
    const a = estimateExperimentalGlycogenAssociatedWaterV1(input);
    const b = estimateExperimentalGlycogenAssociatedWaterV1(input);
    expect(a).toEqual(b);
    expect(experimentalGlycogenAssociatedWaterV1Fingerprint(a))
      .toBe(experimentalGlycogenAssociatedWaterV1Fingerprint(b));
  });

  it("does not appear in production daily-runtime, forecast, TDEE, or v7 water transition apply paths", () => {
    const runtime = readFileSync("src/model/physiology-v7/daily-runtime-v7.ts", "utf8");
    const forecast = readFileSync("src/modules/model-forecast/forecast-engine.ts", "utf8");
    const tdee = readFileSync("src/model/base-tdee.ts", "utf8");
    const transition = readFileSync(
      "src/model/physiology-v7/glycogen-water-transition-v7.ts",
      "utf8",
    );
    const bodyComp = readFileSync("src/model/body-composition/glycogen.ts", "utf8");
    expect(runtime).not.toContain("estimateExperimentalGlycogenAssociatedWaterV1");
    expect(forecast).not.toContain("estimateExperimentalGlycogenAssociatedWaterV1");
    expect(tdee).not.toContain("estimateExperimentalGlycogenAssociatedWaterV1");
    expect(transition).not.toContain("estimateExperimentalGlycogenAssociatedWaterV1");
    expect(bodyComp).not.toContain("estimateExperimentalGlycogenAssociatedWaterV1");
  });
});
