import { describe, expect, it } from "vitest";
import { initializeBodyComposition } from "@/model/body-composition/initialization";

describe("initializeBodyComposition", () => {
  it("initializes the required 80 kg at 20 percent example", () => {
    expect(initializeBodyComposition({ weightKg: 80, estimatedBodyFatPercent: 20 })).toEqual({
      bodyWeightKg: 80,
      fatMassKg: 16,
      fatFreeMassKg: 64,
      bodyFatPercentEstimate: 20,
    });
  });

  it("supports decimal weight and body-fat estimate", () => {
    const result = initializeBodyComposition({
      weightKg: 81.4,
      estimatedBodyFatPercent: 18.7,
    });
    expect(result.fatMassKg).toBeCloseTo(15.2218, 12);
    expect(result.fatFreeMassKg).toBeCloseTo(66.1782, 12);
  });

  it("accepts zero percent as a mathematical boundary", () => {
    expect(initializeBodyComposition({ weightKg: 80, estimatedBodyFatPercent: 0 }))
      .toMatchObject({ fatMassKg: 0, fatFreeMassKg: 80 });
  });

  it("accepts 100 percent as a mathematical boundary", () => {
    expect(initializeBodyComposition({ weightKg: 80, estimatedBodyFatPercent: 100 }))
      .toMatchObject({ fatMassKg: 80, fatFreeMassKg: 0 });
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
});
