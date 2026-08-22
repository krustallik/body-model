import { describe, expect, it } from "vitest";
import { calculateEnergyBalance } from "@/model/energy-balance";

describe("calculateEnergyBalance", () => {
  it("returns a negative deficit", () => {
    expect(calculateEnergyBalance({ intakeKcal: 2_000, expenditureKcal: 2_500 })).toBe(-500);
  });

  it("returns a positive surplus", () => {
    expect(calculateEnergyBalance({ intakeKcal: 2_700.5, expenditureKcal: 2_400.25 }))
      .toBeCloseTo(300.25, 12);
  });

  it("returns zero at maintenance", () => {
    expect(calculateEnergyBalance({ intakeKcal: 2_400, expenditureKcal: 2_400 })).toBe(0);
  });

  it("accepts explicit zero intake", () => {
    expect(calculateEnergyBalance({ intakeKcal: 0, expenditureKcal: 2_000 })).toBe(-2_000);
  });

  it.each([
    { intakeKcal: -1, expenditureKcal: 2_000 },
    { intakeKcal: 2_000, expenditureKcal: 0 },
    { intakeKcal: 2_000, expenditureKcal: -1 },
  ])("rejects values outside physical ranges", (input) => {
    expect(() => calculateEnergyBalance(input)).toThrow(RangeError);
  });

  it.each([
    { intakeKcal: Number.NaN, expenditureKcal: 2_000 },
    { intakeKcal: Number.POSITIVE_INFINITY, expenditureKcal: 2_000 },
    { intakeKcal: 2_000, expenditureKcal: Number.NEGATIVE_INFINITY },
  ])("rejects non-finite inputs", (input) => {
    expect(() => calculateEnergyBalance(input)).toThrow(TypeError);
  });
});
