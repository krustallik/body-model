import { MODEL_INPUT_LIMITS, type ModelSex } from "../constants";
import {
  EXTRACELLULAR_FLUID_ESTIMATE,
  EXTRACELLULAR_FLUID_MODEL,
} from "./constants";

export type ExtracellularFluidEstimateInput = {
  sex: ModelSex;
  ageYears: number;
  heightCm: number;
  weightKg: number;
};

export type ExtracellularFluidEstimate = {
  estimatedExtracellularFluidLiters: number;
  method: "tabibzadeh-2022";
};

export type ExtracellularFluidStepInput = {
  baselineExtracellularFluidLiters: number;
  currentExtracellularFluidDeviationLiters: number;
  carbIntakeG: number | null | undefined;
  baselineCarbIntakeG: number;
  /** Current sodium intake minus baseline sodium intake. Missing means unknown. */
  sodiumChangeMgPerDay: number | null | undefined;
};

export type ExtracellularFluidTransition = {
  baselineExtracellularFluidLiters: number;
  previousExtracellularFluidDeviationLiters: number;
  extracellularFluidDeviationLiters: number;
  extracellularFluidLiters: number;
  deltaExtracellularFluidLiters: number;
  deltaExtracellularFluidMassKg: number;
  sodiumChangeMgPerDay: number;
  carbohydrateIntakeRatio: number;
};

function assertFinite(name: string, value: number): void {
  if (!Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
}

function assertPositive(name: string, value: number): void {
  assertFinite(name, value);
  if (value <= 0) throw new RangeError(`${name} must be positive`);
}

function assertNonnegative(name: string, value: number): void {
  assertFinite(name, value);
  if (value < 0) throw new RangeError(`${name} must be nonnegative`);
}

export function estimateInitialExtracellularFluid(
  input: ExtracellularFluidEstimateInput,
): ExtracellularFluidEstimate {
  if (!(input.sex in EXTRACELLULAR_FLUID_ESTIMATE.sexInterceptLiters)) {
    throw new RangeError("sex must be male or female");
  }
  assertPositive("weightKg", input.weightKg);
  assertPositive("heightCm", input.heightCm);
  assertFinite("ageYears", input.ageYears);
  if (input.weightKg > MODEL_INPUT_LIMITS.weightKg.maximumInclusive) {
    throw new RangeError("weightKg is outside the supported physical range");
  }
  if (input.heightCm > MODEL_INPUT_LIMITS.heightCm.maximumInclusive) {
    throw new RangeError("heightCm is outside the supported physical range");
  }
  if (!Number.isInteger(input.ageYears)) {
    throw new TypeError("ageYears must be an integer of completed years");
  }
  if (input.ageYears < MODEL_INPUT_LIMITS.ageYears.minimumInclusive
      || input.ageYears > MODEL_INPUT_LIMITS.ageYears.maximumInclusive) {
    throw new RangeError("ageYears is outside the supported adult range");
  }

  const estimatedExtracellularFluidLiters =
    EXTRACELLULAR_FLUID_ESTIMATE.sexInterceptLiters[input.sex]
    + EXTRACELLULAR_FLUID_ESTIMATE.weightKgCoefficient * input.weightKg
    + EXTRACELLULAR_FLUID_ESTIMATE.heightCmCoefficient * input.heightCm
    + EXTRACELLULAR_FLUID_ESTIMATE.ageYearsCoefficient * input.ageYears;
  if (!Number.isFinite(estimatedExtracellularFluidLiters)
      || estimatedExtracellularFluidLiters <= 0) {
    throw new RangeError("inputs cannot produce a positive finite ECF estimate");
  }
  return {
    estimatedExtracellularFluidLiters,
    method: "tabibzadeh-2022",
  };
}

/** Exact one-day solution of the Hall ECF deviation equation for constant inputs. */
export function stepExtracellularFluidOneDay(
  input: ExtracellularFluidStepInput,
): ExtracellularFluidTransition | null {
  assertPositive("baselineExtracellularFluidLiters", input.baselineExtracellularFluidLiters);
  assertFinite(
    "currentExtracellularFluidDeviationLiters",
    input.currentExtracellularFluidDeviationLiters,
  );
  assertPositive("baselineCarbIntakeG", input.baselineCarbIntakeG);
  const previousExtracellularFluidLiters = input.baselineExtracellularFluidLiters
    + input.currentExtracellularFluidDeviationLiters;
  if (!Number.isFinite(previousExtracellularFluidLiters)
      || previousExtracellularFluidLiters <= 0) {
    throw new RangeError("current absolute extracellular fluid must be positive and finite");
  }

  if (input.carbIntakeG === null || input.carbIntakeG === undefined
      || input.sodiumChangeMgPerDay === null || input.sodiumChangeMgPerDay === undefined) {
    return null;
  }
  assertNonnegative("carbIntakeG", input.carbIntakeG);
  assertFinite("sodiumChangeMgPerDay", input.sodiumChangeMgPerDay);

  const carbohydrateIntakeRatio = input.carbIntakeG / input.baselineCarbIntakeG;
  const forcingMgPerDay = input.sodiumChangeMgPerDay
    - EXTRACELLULAR_FLUID_MODEL.carbohydrateResponseMgPerDay
      * (1 - carbohydrateIntakeRatio);
  const equilibriumDeviationLiters = forcingMgPerDay
    / EXTRACELLULAR_FLUID_MODEL.sodiumHomeostasisMgPerLiterPerDay;
  const restoringRatePerDay =
    EXTRACELLULAR_FLUID_MODEL.sodiumHomeostasisMgPerLiterPerDay
    / EXTRACELLULAR_FLUID_MODEL.sodiumConcentrationMgPerLiter;
  const extracellularFluidDeviationLiters = equilibriumDeviationLiters
    + (input.currentExtracellularFluidDeviationLiters - equilibriumDeviationLiters)
      * Math.exp(-restoringRatePerDay * EXTRACELLULAR_FLUID_MODEL.stepDurationDays);
  const extracellularFluidLiters = input.baselineExtracellularFluidLiters
    + extracellularFluidDeviationLiters;
  const deltaExtracellularFluidLiters = extracellularFluidDeviationLiters
    - input.currentExtracellularFluidDeviationLiters;
  const results = [
    carbohydrateIntakeRatio,
    forcingMgPerDay,
    equilibriumDeviationLiters,
    extracellularFluidDeviationLiters,
    extracellularFluidLiters,
    deltaExtracellularFluidLiters,
  ];
  if (extracellularFluidLiters <= 0 || results.some((value) => !Number.isFinite(value))) {
    throw new RangeError("ECF transition cannot produce a positive finite state");
  }

  return {
    baselineExtracellularFluidLiters: input.baselineExtracellularFluidLiters,
    previousExtracellularFluidDeviationLiters:
      input.currentExtracellularFluidDeviationLiters,
    extracellularFluidDeviationLiters,
    extracellularFluidLiters,
    deltaExtracellularFluidLiters,
    deltaExtracellularFluidMassKg:
      deltaExtracellularFluidLiters * EXTRACELLULAR_FLUID_MODEL.waterDensityKgPerLiter,
    sodiumChangeMgPerDay: input.sodiumChangeMgPerDay,
    carbohydrateIntakeRatio,
  };
}
