import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  ENGINEERING_CARB_REPLETION_SCALE_TAU_G_V1,
  EXPERIMENTAL_GLYCOGEN_REPLETION_V1_PROVENANCE,
  EXPERIMENTAL_GLYCOGEN_REPLETION_V1_REVISION,
  EXPERIMENTAL_REPLETION_ENVELOPE_KG_V1,
  estimateExperimentalGlycogenRepletionV1,
  experimentalGlycogenRepletionV1Fingerprint,
  storeHeadroomFromExerciseDepletionKgV1,
} from "@/model/physiology-v7/experimental-glycogen-repletion-v1";
import { GLYCOGEN_ADULT_CAPACITY_RANGE_METADATA_V7 } from "@/model/physiology-v7/glycogen-transition-v7";

/**
 * EXPERIMENTAL harness — not scientific validation / GREEN oracle.
 */
describe("experimental glycogen repletion v1", () => {
  it("estimates positive bounded repletion from daily carbohydrate", () => {
    const result = estimateExperimentalGlycogenRepletionV1({
      carbsG: 250,
      proteinG: 120,
      currentGlycogenKg: 0.4,
      storeHeadroomKg: 0.2,
      headroomSource: "exercise-depletion-refill",
    });
    expect(result.availability).toBe("available");
    expect(result.estimatedGlycogenDeltaKg).toBeGreaterThan(0);
    expect(result.lowerBoundKg!).toBeGreaterThanOrEqual(0);
    expect(result.upperBoundKg!).toBeGreaterThanOrEqual(result.estimatedGlycogenDeltaKg!);
    expect(result.lowerBoundKg!).toBeLessThanOrEqual(result.estimatedGlycogenDeltaKg!);
    expect(result.provenance).toBe(EXPERIMENTAL_GLYCOGEN_REPLETION_V1_PROVENANCE);
    expect(result.contractVersion).toBe(EXPERIMENTAL_GLYCOGEN_REPLETION_V1_REVISION);
    expect(result.features.literatureCapacityClampRejected).toBe(true);
  });

  it("increases repletion demand with higher carbohydrate within the envelope", () => {
    const low = estimateExperimentalGlycogenRepletionV1({ carbsG: 80, storeHeadroomKg: null });
    const high = estimateExperimentalGlycogenRepletionV1({ carbsG: 320, storeHeadroomKg: null });
    expect(low.availability).toBe("available");
    expect(high.availability).toBe("available");
    expect(high.estimatedGlycogenDeltaKg!).toBeGreaterThan(low.estimatedGlycogenDeltaKg!);
    expect(high.features.carbScale).toBeGreaterThan(low.features.carbScale);
    expect(high.estimatedGlycogenDeltaKg!)
      .toBeLessThanOrEqual(EXPERIMENTAL_REPLETION_ENVELOPE_KG_V1.upperMagnitudeKg);
  });

  it("does not grant a protein glycogen bonus (C-H05)", () => {
    const carbsOnly = estimateExperimentalGlycogenRepletionV1({
      carbsG: 200,
      proteinG: 0,
      storeHeadroomKg: null,
    });
    const highProtein = estimateExperimentalGlycogenRepletionV1({
      carbsG: 200,
      proteinG: 250,
      storeHeadroomKg: null,
    });
    expect(carbsOnly.estimatedGlycogenDeltaKg).toBe(highProtein.estimatedGlycogenDeltaKg);
    expect(highProtein.features.ignoredProteinG).toBe(250);
    expect(highProtein.features.rejectedConversions).toContain("protein-glycogen-bonus");
    expect(highProtein.proteinBonusPolicy.application).toBe("intentionally-not-applied");
    expect(highProtein.proteinBonusPolicy.numericComponent).toBe("rejected");
  });

  it("treats missing carbohydrate as unavailable, not zero repletion", () => {
    const missing = estimateExperimentalGlycogenRepletionV1({
      carbsG: null,
      proteinG: 150,
      currentGlycogenKg: 0.5,
      storeHeadroomKg: 0.1,
    });
    expect(missing.availability).toBe("unavailable");
    expect(missing.estimatedGlycogenDeltaKg).toBeNull();
    expect(missing.lowerBoundKg).toBeNull();
    expect(missing.upperBoundKg).toBeNull();
    expect(missing.unavailableReason).toBe("missing-carbohydrate");
    expect(missing.reasons).toContain("missing-carbohydrate-is-not-zero-repletion");
  });

  it("bounds repletion to defensible store headroom without inventing personal capacity (C-H02)", () => {
    const headroomKg = 0.02;
    const result = estimateExperimentalGlycogenRepletionV1({
      carbsG: 400,
      storeHeadroomKg: headroomKg,
      headroomSource: "exercise-depletion-refill",
      currentGlycogenKg: 0.35,
    });
    expect(result.availability).toBe("available");
    expect(result.features.storeBoundApplied).toBe(true);
    expect(result.estimatedGlycogenDeltaKg!).toBeLessThanOrEqual(headroomKg);
    expect(result.upperBoundKg!).toBeLessThanOrEqual(headroomKg);
    expect(result.lowerBoundKg!).toBeLessThanOrEqual(headroomKg);
    expect(result.reasons).toContain("store-headroom-bound-applied-defensible-headroom");
    expect(result.adultCapacityClampPolicy.clamping).toBe("intentionally-rejected");
    expect(result.adultCapacityClampPolicy.personalCapacityDerivation).toBe("intentionally-rejected");
    expect(result.features.literatureCapacityClampRejected).toBe(true);
    // Literature adult range must not appear as an applied personal clamp.
    const lit = GLYCOGEN_ADULT_CAPACITY_RANGE_METADATA_V7.literatureRangeKg;
    expect(result.estimatedGlycogenDeltaKg).not.toBe(lit.upperKg);
    expect(result.estimatedGlycogenDeltaKg).not.toBe(lit.lowerKg);
    expect(result.features.rejectedConversions).toContain(
      "adult-literature-personal-capacity-clamp",
    );
  });

  it("emits demand without a fake capacity clamp when headroom is unknown", () => {
    const result = estimateExperimentalGlycogenRepletionV1({
      carbsG: 220,
      storeHeadroomKg: null,
      headroomSource: "unavailable",
      currentGlycogenKg: null,
    });
    expect(result.availability).toBe("available");
    expect(result.features.storeBoundApplied).toBe(false);
    expect(result.features.storeHeadroomKg).toBeNull();
    expect(result.estimatedGlycogenDeltaKg!).toBeGreaterThan(0);
    expect(result.reasons).toContain(
      "no-defensible-headroom-demand-emitted-without-fake-capacity-clamp",
    );
    expect(result.adultCapacityClampPolicy.clamping).toBe("intentionally-rejected");
  });

  it("derives refill headroom only from exercise depletion deltas", () => {
    expect(storeHeadroomFromExerciseDepletionKgV1([])).toBeNull();
    expect(storeHeadroomFromExerciseDepletionKgV1([null, undefined])).toBeNull();
    expect(storeHeadroomFromExerciseDepletionKgV1([-0.03, -0.02])).toBeCloseTo(0.05);
    expect(() => storeHeadroomFromExerciseDepletionKgV1([0.01])).toThrow(/≤ 0/);
  });

  it("is deterministic for identical inputs", () => {
    const input = {
      carbsG: 180,
      proteinG: 90,
      currentGlycogenKg: 0.42,
      storeHeadroomKg: 0.08,
      headroomSource: "exercise-depletion-refill" as const,
      activeEnergyKcal: 500,
    };
    const a = estimateExperimentalGlycogenRepletionV1(input);
    const b = estimateExperimentalGlycogenRepletionV1(input);
    expect(a).toEqual(b);
    expect(experimentalGlycogenRepletionV1Fingerprint(a))
      .toBe(experimentalGlycogenRepletionV1Fingerprint(b));
  });

  it("keeps carb scale τ and envelope classified as engineering priors", () => {
    expect(ENGINEERING_CARB_REPLETION_SCALE_TAU_G_V1).toBe(200);
    expect(EXPERIMENTAL_REPLETION_ENVELOPE_KG_V1.pointClassification)
      .toBe("engineering-midpoint");
    expect(EXPERIMENTAL_REPLETION_ENVELOPE_KG_V1.boundClassification)
      .toBe("engineering-order-of-magnitude-band");
  });

  it("does not appear in production daily-runtime, forecast, or TDEE paths", () => {
    const runtime = readFileSync("src/model/physiology-v7/daily-runtime-v7.ts", "utf8");
    const forecast = readFileSync("src/modules/model-forecast/forecast-engine.ts", "utf8");
    const tdee = readFileSync("src/model/base-tdee.ts", "utf8");
    const transition = readFileSync("src/model/physiology-v7/glycogen-transition-v7.ts", "utf8");
    expect(runtime).not.toContain("estimateExperimentalGlycogenRepletionV1");
    expect(forecast).not.toContain("estimateExperimentalGlycogenRepletionV1");
    expect(tdee).not.toContain("estimateExperimentalGlycogenRepletionV1");
    expect(transition).not.toContain("estimateExperimentalGlycogenRepletionV1");
  });
});
