import { describe, expect, it } from "vitest";
import {
  EXTRACELLULAR_FLUID_ESTIMATE,
  EXTRACELLULAR_FLUID_MODEL,
} from "@/model/body-composition/constants";
import {
  estimateInitialExtracellularFluid,
  stepExtracellularFluidOneDay,
} from "@/model/body-composition/extracellular-fluid";

const equilibriumInput = {
  baselineExtracellularFluidLiters: 17,
  currentExtracellularFluidDeviationLiters: 0,
  carbIntakeG: 250,
  baselineCarbIntakeG: 250,
  sodiumChangeMgPerDay: 0,
};

describe("initial extracellular-fluid estimate", () => {
  it("uses the documented Tabibzadeh equation and constants", () => {
    expect(EXTRACELLULAR_FLUID_ESTIMATE).toEqual({
      weightKgCoefficient: 0.1393,
      heightCmCoefficient: 0.0455,
      ageYearsCoefficient: 0.0125,
      sexInterceptLiters: { male: -2.6631, female: -3.3407 },
    });
    expect(estimateInitialExtracellularFluid({
      sex: "male", ageYears: 30, heightCm: 180, weightKg: 80,
    })).toEqual({
      estimatedExtracellularFluidLiters: 17.0459,
      method: "tabibzadeh-2022",
    });
    expect(estimateInitialExtracellularFluid({
      sex: "female", ageYears: 30, heightCm: 180, weightKg: 80,
    }).estimatedExtracellularFluidLiters).toBeCloseTo(16.3683, 12);
  });

  it("accepts finite decimal anthropometric inputs", () => {
    const result = estimateInitialExtracellularFluid({
      sex: "female", ageYears: 44, heightCm: 167.5, weightKg: 63.4,
    });
    expect(result.estimatedExtracellularFluidLiters).toBeGreaterThan(0);
    expect(Number.isFinite(result.estimatedExtracellularFluidLiters)).toBe(true);
  });

  it.each([
    { sex: "other", ageYears: 30, heightCm: 180, weightKg: 80 },
    { sex: "male", ageYears: 17, heightCm: 180, weightKg: 80 },
    { sex: "male", ageYears: 121, heightCm: 180, weightKg: 80 },
    { sex: "male", ageYears: 30, heightCm: 301, weightKg: 80 },
    { sex: "male", ageYears: 30, heightCm: 180, weightKg: 1_001 },
    { sex: "female", ageYears: 18, heightCm: 0.1, weightKg: 0.1 },
  ])("rejects unsupported estimate inputs: $sex/$ageYears/$heightCm/$weightKg", (input) => {
    expect(() => estimateInitialExtracellularFluid(
      input as Parameters<typeof estimateInitialExtracellularFluid>[0],
    )).toThrow(RangeError);
  });

  it.each([
    { sex: "male" as const, ageYears: 30.5, heightCm: 180, weightKg: 80 },
    { sex: "male" as const, ageYears: Number.NaN, heightCm: 180, weightKg: 80 },
    { sex: "male" as const, ageYears: 30, heightCm: Number.POSITIVE_INFINITY, weightKg: 80 },
    { sex: "male" as const, ageYears: 30, heightCm: 180, weightKg: Number.NaN },
  ])("rejects non-finite or non-integer estimate inputs", (input) => {
    expect(() => estimateInitialExtracellularFluid(input)).toThrow(TypeError);
  });

  it.each([
    { sex: "male" as const, ageYears: 30, heightCm: 0, weightKg: 80 },
    { sex: "male" as const, ageYears: 30, heightCm: 180, weightKg: 0 },
  ])("rejects nonpositive anthropometry", (input) => {
    expect(() => estimateInitialExtracellularFluid(input)).toThrow(RangeError);
  });
});

describe("Hall one-day extracellular-fluid transition", () => {
  it("uses Hall/NIDDK constants with explicit dimensional units", () => {
    expect(EXTRACELLULAR_FLUID_MODEL).toEqual({
      sodiumConcentrationMgPerLiter: 3_220,
      sodiumHomeostasisMgPerLiterPerDay: 3_000,
      carbohydrateResponseMgPerDay: 4_000,
      waterDensityKgPerLiter: 1,
      stepDurationDays: 1,
    });
  });

  it("stays at equilibrium when carbohydrate and sodium changes are zero", () => {
    expect(stepExtracellularFluidOneDay(equilibriumInput)).toEqual({
      baselineExtracellularFluidLiters: 17,
      previousExtracellularFluidDeviationLiters: 0,
      extracellularFluidDeviationLiters: 0,
      extracellularFluidLiters: 17,
      deltaExtracellularFluidLiters: 0,
      deltaExtracellularFluidMassKg: 0,
      sodiumChangeMgPerDay: 0,
      carbohydrateIntakeRatio: 1,
    });
  });

  it.each([
    { carbIntakeG: 100, expectedDeviation: -0.48488592723431373 },
    { carbIntakeG: 400, expectedDeviation: 0.4848859272343138 },
  ])("has the expected carbohydrate direction at $carbIntakeG g", ({
    carbIntakeG, expectedDeviation,
  }) => {
    const result = stepExtracellularFluidOneDay({ ...equilibriumInput, carbIntakeG });
    expect(result!.extracellularFluidDeviationLiters).toBeCloseTo(expectedDeviation, 12);
    expect(result!.deltaExtracellularFluidMassKg)
      .toBeCloseTo(result!.deltaExtracellularFluidLiters, 12);
  });

  it.each([
    { sodiumChangeMgPerDay: 1_000, expectedDeviation: 0.20203580301429735 },
    { sodiumChangeMgPerDay: -1_000, expectedDeviation: -0.20203580301429735 },
  ])("has the expected sodium direction at $sodiumChangeMgPerDay mg/day", ({
    sodiumChangeMgPerDay, expectedDeviation,
  }) => {
    const result = stepExtracellularFluidOneDay({
      ...equilibriumInput, sodiumChangeMgPerDay,
    });
    expect(result!.extracellularFluidDeviationLiters).toBeCloseTo(expectedDeviation, 12);
  });

  it.each([1, -1])("restores an existing deviation toward baseline", (deviation) => {
    const result = stepExtracellularFluidOneDay({
      ...equilibriumInput,
      currentExtracellularFluidDeviationLiters: deviation,
    });
    expect(result!.extracellularFluidDeviationLiters)
      .toBeCloseTo(deviation * 0.3938925909571079, 12);
    expect(Math.abs(result!.extracellularFluidDeviationLiters)).toBeLessThan(Math.abs(deviation));
  });

  it("treats zero carbohydrate and zero sodium change as observed values", () => {
    const result = stepExtracellularFluidOneDay({
      ...equilibriumInput, carbIntakeG: 0, sodiumChangeMgPerDay: 0,
    });
    expect(result).not.toBeNull();
    expect(result!.carbohydrateIntakeRatio).toBe(0);
    expect(result!.extracellularFluidDeviationLiters).toBeLessThan(0);
  });

  it.each([
    { carbIntakeG: null, sodiumChangeMgPerDay: 0 },
    { carbIntakeG: undefined, sodiumChangeMgPerDay: 0 },
    { carbIntakeG: 250, sodiumChangeMgPerDay: null },
    { carbIntakeG: 250, sodiumChangeMgPerDay: undefined },
  ])("returns unavailable when a required observation is missing", (missing) => {
    expect(stepExtracellularFluidOneDay({ ...equilibriumInput, ...missing })).toBeNull();
  });

  it.each([
    { baselineExtracellularFluidLiters: 0 },
    { baselineExtracellularFluidLiters: -1 },
    { baselineCarbIntakeG: 0 },
    { baselineCarbIntakeG: -1 },
    { carbIntakeG: -1 },
  ])("rejects invalid ranges", (change) => {
    expect(() => stepExtracellularFluidOneDay({ ...equilibriumInput, ...change }))
      .toThrow(RangeError);
  });

  it.each([
    { baselineExtracellularFluidLiters: Number.NaN },
    { currentExtracellularFluidDeviationLiters: Number.POSITIVE_INFINITY },
    { baselineCarbIntakeG: Number.NaN },
    { carbIntakeG: Number.POSITIVE_INFINITY },
    { sodiumChangeMgPerDay: Number.NaN },
  ])("rejects non-finite inputs", (change) => {
    expect(() => stepExtracellularFluidOneDay({ ...equilibriumInput, ...change }))
      .toThrow(TypeError);
  });

  it("rejects a nonpositive current absolute ECF", () => {
    expect(() => stepExtracellularFluidOneDay({
      ...equilibriumInput,
      currentExtracellularFluidDeviationLiters: -17,
    })).toThrow(RangeError);
  });

  it("rejects transitions that overflow or make absolute ECF nonpositive", () => {
    expect(() => stepExtracellularFluidOneDay({
      ...equilibriumInput,
      baselineCarbIntakeG: Number.MIN_VALUE,
    })).toThrow(RangeError);
    expect(() => stepExtracellularFluidOneDay({
      ...equilibriumInput,
      sodiumChangeMgPerDay: -1_000_000,
    })).toThrow(RangeError);
  });
});
