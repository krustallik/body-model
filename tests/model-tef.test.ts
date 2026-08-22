import { describe, expect, it } from "vitest";
import { calculateTef } from "@/model/tef";

describe("calculateTef", () => {
  // Scientific regression defaults within Westerterp's reported ranges:
  // protein 20–30%, carbohydrate 5–10%, fat 0–3%.
  // https://pmc.ncbi.nlm.nih.gov/articles/PMC524030/
  it("calculates a representative mixed-macro day", () => {
    const result = calculateTef({ proteinG: 168, carbsG: 239, fatG: 74 });
    expect(result).toBeCloseTo(253.02, 10);
  });

  it("returns zero when all three macros are explicitly zero", () => {
    expect(calculateTef({ proteinG: 0, carbsG: 0, fatG: 0 })).toBe(0);
  });

  it.each([
    ["protein", { proteinG: null, carbsG: 100, fatG: 50 }],
    ["carbs", { proteinG: 100, carbsG: null, fatG: 50 }],
    ["fat", { proteinG: 100, carbsG: 100, fatG: null }],
    ["undefined", { proteinG: undefined, carbsG: 100, fatG: 50 }],
  ])("returns null when %s data is unavailable", (_label, input) => {
    expect(calculateTef(input)).toBeNull();
  });

  it("preserves decimal macro grams", () => {
    const result = calculateTef({ proteinG: 10.5, carbsG: 20.25, fatG: 3.5 });
    expect(result).toBeCloseTo(17.205, 10);
  });

  it.each([
    ["proteinG", -1],
    ["carbsG", -1],
    ["fatG", -1],
  ])("rejects negative %s", (field, value) => {
    expect(() => calculateTef({
      proteinG: field === "proteinG" ? value : 1,
      carbsG: field === "carbsG" ? value : 1,
      fatG: field === "fatG" ? value : 1,
    })).toThrow(RangeError);
  });

  it.each([
    ["proteinG", Number.NaN],
    ["proteinG", Number.POSITIVE_INFINITY],
    ["carbsG", Number.NaN],
    ["carbsG", Number.NEGATIVE_INFINITY],
    ["fatG", Number.NaN],
    ["fatG", Number.POSITIVE_INFINITY],
  ])("rejects non-finite %s", (field, value) => {
    expect(() => calculateTef({
      proteinG: field === "proteinG" ? value : 1,
      carbsG: field === "carbsG" ? value : 1,
      fatG: field === "fatG" ? value : 1,
    })).toThrow(TypeError);
  });

  it("validates present values even when another macro is missing", () => {
    expect(() => calculateTef({ proteinG: -1, carbsG: null, fatG: 10 })).toThrow(RangeError);
  });
});
