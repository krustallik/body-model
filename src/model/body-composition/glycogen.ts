import { KCAL_PER_GRAM } from "../constants";
import { GLYCOGEN_MODEL } from "./constants";
import {
  calculateGlycogenAssociatedMassKg,
  calculateGlycogenAssociatedWaterKg,
} from "./state";

export type GlycogenParametersInput = {
  baselineCarbIntakeG: number;
  initialGlycogenKg?: number;
};

export type GlycogenParameters = {
  baselineCarbIntakeG: number;
  baselineCarbEnergyKcalPerDay: number;
  initialGlycogenKg: number;
  quadraticOutflowKcalPerKgSquaredPerDay: number;
};

export type GlycogenStepInput = {
  currentGlycogenKg: number;
  carbIntakeG: number | null | undefined;
  parameters: GlycogenParameters;
};

export type GlycogenTransition = {
  previousGlycogenKg: number;
  glycogenKg: number;
  deltaGlycogenKg: number;
  previousGlycogenWaterKg: number;
  glycogenWaterKg: number;
  deltaGlycogenWaterKg: number;
  glycogenAssociatedMassKg: number;
  deltaGlycogenAssociatedMassKg: number;
  glycogenStorageEnergyKcal: number;
};

function assertFinite(name: string, value: number): void {
  if (!Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
}

function assertNonnegative(name: string, value: number): void {
  assertFinite(name, value);
  if (value < 0) throw new RangeError(`${name} must be nonnegative`);
}

function assertPositive(name: string, value: number): void {
  assertFinite(name, value);
  if (value <= 0) throw new RangeError(`${name} must be positive`);
}

function validateParameters(parameters: GlycogenParameters): void {
  assertPositive("baselineCarbIntakeG", parameters.baselineCarbIntakeG);
  assertPositive("baselineCarbEnergyKcalPerDay", parameters.baselineCarbEnergyKcalPerDay);
  assertPositive("initialGlycogenKg", parameters.initialGlycogenKg);
  assertPositive(
    "quadraticOutflowKcalPerKgSquaredPerDay",
    parameters.quadraticOutflowKcalPerKgSquaredPerDay,
  );
  if (parameters.quadraticOutflowKcalPerKgSquaredPerDay
      / GLYCOGEN_MODEL.energyDensityKcalPerKg === 0) {
    throw new RangeError("glycogen parameters are below supported numeric precision");
  }
}

export function createGlycogenParameters(input: GlycogenParametersInput): GlycogenParameters {
  assertPositive("baselineCarbIntakeG", input.baselineCarbIntakeG);
  const initialGlycogenKg = input.initialGlycogenKg === undefined
    ? GLYCOGEN_MODEL.defaultInitialGlycogenKg
    : input.initialGlycogenKg;
  assertPositive("initialGlycogenKg", initialGlycogenKg);

  const baselineCarbEnergyKcalPerDay = input.baselineCarbIntakeG * KCAL_PER_GRAM.carbs;
  const quadraticOutflowKcalPerKgSquaredPerDay = baselineCarbEnergyKcalPerDay
    / initialGlycogenKg ** 2;
  if (!Number.isFinite(baselineCarbEnergyKcalPerDay)
      || !Number.isFinite(quadraticOutflowKcalPerKgSquaredPerDay)
      || baselineCarbEnergyKcalPerDay === 0
      || quadraticOutflowKcalPerKgSquaredPerDay === 0
      || quadraticOutflowKcalPerKgSquaredPerDay
        / GLYCOGEN_MODEL.energyDensityKcalPerKg === 0) {
    throw new RangeError("glycogen parameters exceed supported numeric precision");
  }

  return {
    baselineCarbIntakeG: input.baselineCarbIntakeG,
    baselineCarbEnergyKcalPerDay,
    initialGlycogenKg,
    quadraticOutflowKcalPerKgSquaredPerDay,
  };
}

function solveOneDay(
  currentGlycogenKg: number,
  carbEnergyKcalPerDay: number,
  quadraticOutflowKcalPerKgSquaredPerDay: number,
): number {
  const outflowRatePerKgPerDay = quadraticOutflowKcalPerKgSquaredPerDay
    / GLYCOGEN_MODEL.energyDensityKcalPerKg;

  if (carbEnergyKcalPerDay === 0) {
    return currentGlycogenKg
      / (1 + outflowRatePerKgPerDay * currentGlycogenKg * GLYCOGEN_MODEL.stepDurationDays);
  }

  const equilibriumSquaredKg = carbEnergyKcalPerDay
    / quadraticOutflowKcalPerKgSquaredPerDay;
  if (equilibriumSquaredKg === 0) {
    return currentGlycogenKg
      / (1 + outflowRatePerKgPerDay * currentGlycogenKg * GLYCOGEN_MODEL.stepDurationDays);
  }
  const equilibriumGlycogenKg = Math.sqrt(equilibriumSquaredKg);
  const exponentialDecay = Math.exp(
    -2
    * outflowRatePerKgPerDay
    * equilibriumGlycogenKg
    * GLYCOGEN_MODEL.stepDurationDays,
  );
  const ratio = (currentGlycogenKg - equilibriumGlycogenKg)
    / (currentGlycogenKg + equilibriumGlycogenKg)
    * exponentialDecay;
  return equilibriumGlycogenKg * (1 + ratio) / (1 - ratio);
}

/** Exact one-day solution for constant daily carbohydrate intake. */
export function stepGlycogenOneDay(input: GlycogenStepInput): GlycogenTransition | null {
  assertNonnegative("currentGlycogenKg", input.currentGlycogenKg);
  validateParameters(input.parameters);
  if (input.carbIntakeG === null || input.carbIntakeG === undefined) return null;
  assertNonnegative("carbIntakeG", input.carbIntakeG);

  const carbEnergyKcalPerDay = input.carbIntakeG * KCAL_PER_GRAM.carbs;
  if (!Number.isFinite(carbEnergyKcalPerDay)) {
    throw new RangeError("carbIntakeG exceeds supported numeric precision");
  }
  const glycogenKg = solveOneDay(
    input.currentGlycogenKg,
    carbEnergyKcalPerDay,
    input.parameters.quadraticOutflowKcalPerKgSquaredPerDay,
  );
  if (!Number.isFinite(glycogenKg) || glycogenKg < 0) {
    throw new RangeError("glycogen transition exceeds supported numeric precision");
  }
  const deltaGlycogenKg = glycogenKg - input.currentGlycogenKg;
  const glycogenStorageEnergyKcal = deltaGlycogenKg
    * GLYCOGEN_MODEL.energyDensityKcalPerKg;
  if (!Number.isFinite(deltaGlycogenKg) || !Number.isFinite(glycogenStorageEnergyKcal)) {
    throw new RangeError("glycogen transition exceeds supported numeric precision");
  }
  const previousGlycogenWaterKg = calculateGlycogenAssociatedWaterKg(input.currentGlycogenKg);
  const glycogenWaterKg = calculateGlycogenAssociatedWaterKg(glycogenKg);
  const previousAssociatedMassKg = calculateGlycogenAssociatedMassKg(input.currentGlycogenKg);
  const glycogenAssociatedMassKg = calculateGlycogenAssociatedMassKg(glycogenKg);
  return {
    previousGlycogenKg: input.currentGlycogenKg,
    glycogenKg,
    deltaGlycogenKg,
    previousGlycogenWaterKg,
    glycogenWaterKg,
    deltaGlycogenWaterKg: glycogenWaterKg - previousGlycogenWaterKg,
    glycogenAssociatedMassKg,
    deltaGlycogenAssociatedMassKg: glycogenAssociatedMassKg - previousAssociatedMassKg,
    glycogenStorageEnergyKcal,
  };
}
