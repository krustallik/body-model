import { MODEL_INPUT_LIMITS } from "../constants";
import {
  BODY_COMPARTMENT_ENERGY_DENSITY,
  FORBES_ENERGY_PARTITION_CONSTANT_KG,
} from "./constants";

export type EnergyPartitionInput = {
  energyBalanceKcal: number;
  fatMassKg: number;
};

export type EnergyPartitionResult = {
  energyBalanceKcal: number;
  /** Fraction of energy imbalance assigned to the fat-free-mass compartment. */
  pRatio: number;
  fatEnergyKcal: number;
  fatFreeMassEnergyKcal: number;
  deltaFatMassKg: number;
  deltaFatFreeMassKg: number;
};

function assertFinite(name: string, value: number): void {
  if (!Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
}

/**
 * Partitions a one-day energy imbalance with the local Forbes/Hall relation.
 *
 * p = C / (C + FM) is the energy fraction assigned to fat-free mass, not the
 * fraction of total mass change. The result describes effective tissue energy
 * stores; fat-free mass must not be interpreted as skeletal muscle alone.
 */
export function partitionEnergyBalance(input: EnergyPartitionInput): EnergyPartitionResult {
  assertFinite("energyBalanceKcal", input.energyBalanceKcal);
  assertFinite("fatMassKg", input.fatMassKg);

  if (input.fatMassKg <= 0
      || input.fatMassKg > MODEL_INPUT_LIMITS.weightKg.maximumInclusive) {
    throw new RangeError("fatMassKg is outside the supported physical range");
  }

  const pRatio = FORBES_ENERGY_PARTITION_CONSTANT_KG
    / (FORBES_ENERGY_PARTITION_CONSTANT_KG + input.fatMassKg);

  if (input.energyBalanceKcal === 0) {
    return {
      energyBalanceKcal: 0,
      pRatio,
      fatEnergyKcal: 0,
      fatFreeMassEnergyKcal: 0,
      deltaFatMassKg: 0,
      deltaFatFreeMassKg: 0,
    };
  }

  const fatFreeMassEnergyKcal = input.energyBalanceKcal * pRatio;
  const fatEnergyKcal = input.energyBalanceKcal - fatFreeMassEnergyKcal;

  return {
    energyBalanceKcal: input.energyBalanceKcal,
    pRatio,
    fatEnergyKcal,
    fatFreeMassEnergyKcal,
    deltaFatMassKg:
      fatEnergyKcal / BODY_COMPARTMENT_ENERGY_DENSITY.fatMassKcalPerKg,
    deltaFatFreeMassKg:
      fatFreeMassEnergyKcal / BODY_COMPARTMENT_ENERGY_DENSITY.fatFreeMassKcalPerKg,
  };
}
