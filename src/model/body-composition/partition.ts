import { MODEL_INPUT_LIMITS } from "../constants";
import {
  BODY_COMPARTMENT_ENERGY_DENSITY,
  FORBES_ENERGY_PARTITION_CONSTANT_KG,
} from "./constants";

export type EnergyPartitionInput = {
  /** Energy available to fat/lean tissue after any separately modeled glycogen storage. */
  partitionableEnergyKcal: number;
  fatMassKg: number;
};

export type EnergyPartitionResult = {
  partitionableEnergyKcal: number;
  /** Fraction of partitionable energy assigned to the Hall lean-tissue compartment. */
  pRatio: number;
  fatEnergyKcal: number;
  leanTissueEnergyKcal: number;
  deltaFatMassKg: number;
  deltaLeanTissueKg: number;
};

function assertFinite(name: string, value: number): void {
  if (!Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
}

/**
 * Partitions a one-day energy imbalance with the local Forbes/Hall relation.
 *
 * p = C / (C + FM) is the energy fraction assigned to Hall lean tissue, not the
 * fraction of total mass change. In a future explicit-glycogen model, the input
 * must already exclude energy stored in glycogen.
 */
export function partitionEnergyBalance(input: EnergyPartitionInput): EnergyPartitionResult {
  assertFinite("partitionableEnergyKcal", input.partitionableEnergyKcal);
  assertFinite("fatMassKg", input.fatMassKg);

  if (input.fatMassKg <= 0
      || input.fatMassKg > MODEL_INPUT_LIMITS.weightKg.maximumInclusive) {
    throw new RangeError("fatMassKg is outside the supported physical range");
  }

  const pRatio = FORBES_ENERGY_PARTITION_CONSTANT_KG
    / (FORBES_ENERGY_PARTITION_CONSTANT_KG + input.fatMassKg);

  if (input.partitionableEnergyKcal === 0) {
    return {
      partitionableEnergyKcal: 0,
      pRatio,
      fatEnergyKcal: 0,
      leanTissueEnergyKcal: 0,
      deltaFatMassKg: 0,
      deltaLeanTissueKg: 0,
    };
  }

  const leanTissueEnergyKcal = input.partitionableEnergyKcal * pRatio;
  const fatEnergyKcal = input.partitionableEnergyKcal - leanTissueEnergyKcal;

  return {
    partitionableEnergyKcal: input.partitionableEnergyKcal,
    pRatio,
    fatEnergyKcal,
    leanTissueEnergyKcal,
    deltaFatMassKg:
      fatEnergyKcal / BODY_COMPARTMENT_ENERGY_DENSITY.fatMassKcalPerKg,
    deltaLeanTissueKg:
      leanTissueEnergyKcal / BODY_COMPARTMENT_ENERGY_DENSITY.leanTissueKcalPerKg,
  };
}
