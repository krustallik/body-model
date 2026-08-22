import { describe, expect, it } from "vitest";
import { initializeBodyComposition } from "@/model/body-composition/initialization";

describe("initializeBodyComposition", () => {
  it("initializes the required 80 kg at 20 percent example", () => {
    expect(initializeBodyComposition({ weightKg: 80, estimatedBodyFatPercent: 20 })).toEqual({
      bodyWeightKg: 80,
      observedFatMassKg: 16,
      observedFatFreeMassKg: 64,
      bodyFatPercentEstimate: 20,
    });
  });

  it("supports decimal weight and body-fat estimate", () => {
    const result = initializeBodyComposition({
      weightKg: 81.4,
      estimatedBodyFatPercent: 18.7,
    });
    expect(result.observedFatMassKg).toBeCloseTo(15.2218, 12);
    expect(result.observedFatFreeMassKg).toBeCloseTo(66.1782, 12);
  });

  it("rejects zero percent because it creates zero fat mass", () => {
    expect(() => initializeBodyComposition({ weightKg: 80, estimatedBodyFatPercent: 0 }))
      .toThrow(RangeError);
  });

  it("rejects 100 percent because it creates zero fat-free mass", () => {
    expect(() => initializeBodyComposition({ weightKg: 80, estimatedBodyFatPercent: 100 }))
      .toThrow(RangeError);
  });

  it("accepts a representable value just above zero", () => {
    const result = initializeBodyComposition({ weightKg: 80, estimatedBodyFatPercent: 0.000001 });
    expect(result.observedFatMassKg).toBeGreaterThan(0);
    expect(result.observedFatFreeMassKg).toBeGreaterThan(0);
  });

  it("accepts a representable value just below 100", () => {
    const result = initializeBodyComposition({ weightKg: 80, estimatedBodyFatPercent: 99.999999 });
    expect(result.observedFatMassKg).toBeGreaterThan(0);
    expect(result.observedFatFreeMassKg).toBeGreaterThan(0);
  });

  it.each([0, -1, 1_000.01])("rejects unsupported weight %s", (weightKg) => {
    expect(() => initializeBodyComposition({ weightKg, estimatedBodyFatPercent: 20 }))
      .toThrow(RangeError);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "rejects non-finite weight %s",
    (weightKg) => {
      expect(() => initializeBodyComposition({ weightKg, estimatedBodyFatPercent: 20 }))
        .toThrow(TypeError);
    },
  );

  it.each([-0.01, 100.01])("rejects unsupported body-fat estimate %s", (estimatedBodyFatPercent) => {
    expect(() => initializeBodyComposition({ weightKg: 80, estimatedBodyFatPercent }))
      .toThrow(RangeError);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "rejects non-finite body-fat estimate %s",
    (estimatedBodyFatPercent) => {
      expect(() => initializeBodyComposition({ weightKg: 80, estimatedBodyFatPercent }))
        .toThrow(TypeError);
    },
  );

  it("rejects a positive value that underflows to zero fat mass", () => {
    expect(() => initializeBodyComposition({
      weightKg: 0.1,
      estimatedBodyFatPercent: Number.MIN_VALUE,
    })).toThrow(RangeError);
  });
});
