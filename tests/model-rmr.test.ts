import { describe, expect, it } from "vitest";
import { calculateRmr } from "@/model/rmr";

describe("calculateRmr", () => {
  // Scientific regression: simplified sex-specific equations reported by Mifflin et al. (1990).
  // https://pubmed.ncbi.nlm.nih.gov/2305711/
  it("matches the Mifflin–St Jeor male equation golden value", () => {
    expect(calculateRmr({ sex: "male", weightKg: 81.4, heightCm: 180, ageYears: 30 })).toBeCloseTo(1794, 10);
  });

  it("matches the Mifflin–St Jeor female equation golden value", () => {
    expect(calculateRmr({ sex: "female", weightKg: 60, heightCm: 165, ageYears: 40 })).toBeCloseTo(1270.25, 10);
  });

  it("preserves decimal body weight", () => {
    expect(calculateRmr({ sex: "male", weightKg: 81.45, heightCm: 180, ageYears: 30 })).toBeCloseTo(1794.5, 10);
  });

  it.each([
    ["negative weight", { sex: "male" as const, weightKg: -1, heightCm: 180, ageYears: 30 }],
    ["zero height", { sex: "male" as const, weightKg: 80, heightCm: 0, ageYears: 30 }],
    ["minor age", { sex: "male" as const, weightKg: 80, heightCm: 180, ageYears: 17 }],
    ["fractional age", { sex: "male" as const, weightKg: 80, heightCm: 180, ageYears: 30.5 }],
    ["excessive weight", { sex: "male" as const, weightKg: 1_001, heightCm: 180, ageYears: 30 }],
    ["excessive height", { sex: "male" as const, weightKg: 80, heightCm: 301, ageYears: 30 }],
    ["excessive age", { sex: "male" as const, weightKg: 80, heightCm: 180, ageYears: 121 }],
  ])("rejects %s", (_label, input) => {
    expect(() => calculateRmr(input)).toThrow();
  });

  it.each([
    ["weightKg", Number.NaN],
    ["weightKg", Number.POSITIVE_INFINITY],
    ["heightCm", Number.NaN],
    ["heightCm", Number.NEGATIVE_INFINITY],
    ["ageYears", Number.NaN],
    ["ageYears", Number.POSITIVE_INFINITY],
  ])("rejects non-finite %s", (field, value) => {
    expect(() => calculateRmr({
      sex: "male",
      weightKg: field === "weightKg" ? value : 80,
      heightCm: field === "heightCm" ? value : 180,
      ageYears: field === "ageYears" ? value : 30,
    })).toThrow(TypeError);
  });

  it("rejects a runtime sex outside the model union", () => {
    expect(() => calculateRmr({
      sex: "other" as "male",
      weightKg: 80,
      heightCm: 180,
      ageYears: 30,
    })).toThrow(RangeError);
  });
});
