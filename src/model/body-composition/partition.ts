import { MODEL_INPUT_LIMITS } from "../constants";
import {
  BODY_COMPARTMENT_ENERGY_DENSITY,
  FORBES_ENERGY_PARTITION_CONSTANT_KG,
  TISSUE_REMODELING_ENERGY,
} from "./constants";

export type EnergyPartitionInput = {
  /** Energy left after ordinary expenditure and separately modeled glycogen storage. */
  availableEnergyKcal: number;
  fatMassKg: number;
};

export type EnergyPartitionResult = {
  /** Energy entering the closed Fat/LeanTissue system before synthesis expenditure. */
  inputEnergyKcal: number;
  /** Energy chemically stored in Fat and LeanTissue after synthesis expenditure. */
  partitionableEnergyKcal: number;
  /** Fraction of stored tissue energy assigned to the Hall lean-tissue compartment. */
  pRatio: number;
  remodelingDenominator: number;
  fatStorageEnergyKcal: number;
  leanTissueStorageEnergyKcal: number;
  deltaFatMassKg: number;
  deltaLeanTissueKg: number;
  fatRemodelingEnergyKcal: number;
  leanTissueRemodelingEnergyKcal: number;
  totalRemodelingEnergyKcal: number;
};

function assertFinite(name: string, value: number): void {
  if (!Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
}

/**
 * Solves Hall's implicit tissue-energy system in closed form.
 *
 * B = R / (1 + etaF(1-p)/rhoF + etaL*p/rhoL)
 *
 * Eta terms keep their algebraic sign: deposition adds expenditure while
 * mobilization makes this remodeling term negative.
 */
export function partitionEnergyBalance(input: EnergyPartitionInput): EnergyPartitionResult {
  assertFinite("availableEnergyKcal", input.availableEnergyKcal);
  assertFinite("fatMassKg", input.fatMassKg);

  if (input.fatMassKg <= 0
      || input.fatMassKg > MODEL_INPUT_LIMITS.weightKg.maximumInclusive) {
    throw new RangeError("fatMassKg is outside the supported physical range");
  }

  const pRatio = FORBES_ENERGY_PARTITION_CONSTANT_KG
    / (FORBES_ENERGY_PARTITION_CONSTANT_KG + input.fatMassKg);
  const remodelingDenominator = 1
    + TISSUE_REMODELING_ENERGY.fatMassKcalPerKg * (1 - pRatio)
      / BODY_COMPARTMENT_ENERGY_DENSITY.fatMassKcalPerKg
    + TISSUE_REMODELING_ENERGY.leanTissueKcalPerKg * pRatio
      / BODY_COMPARTMENT_ENERGY_DENSITY.leanTissueKcalPerKg;

  if (input.availableEnergyKcal === 0) {
    return {
      inputEnergyKcal: 0,
      partitionableEnergyKcal: 0,
      pRatio,
      remodelingDenominator,
      fatStorageEnergyKcal: 0,
      leanTissueStorageEnergyKcal: 0,
      deltaFatMassKg: 0,
      deltaLeanTissueKg: 0,
      fatRemodelingEnergyKcal: 0,
      leanTissueRemodelingEnergyKcal: 0,
      totalRemodelingEnergyKcal: 0,
    };
  }

  const partitionableEnergyKcal = input.availableEnergyKcal / remodelingDenominator;
  const leanTissueStorageEnergyKcal = partitionableEnergyKcal * pRatio;
  const fatStorageEnergyKcal = partitionableEnergyKcal - leanTissueStorageEnergyKcal;
  const deltaFatMassKg = fatStorageEnergyKcal
    / BODY_COMPARTMENT_ENERGY_DENSITY.fatMassKcalPerKg;
  const deltaLeanTissueKg = leanTissueStorageEnergyKcal
    / BODY_COMPARTMENT_ENERGY_DENSITY.leanTissueKcalPerKg;
  const fatRemodelingEnergyKcal = TISSUE_REMODELING_ENERGY.fatMassKcalPerKg
    * deltaFatMassKg;
  const leanTissueRemodelingEnergyKcal = TISSUE_REMODELING_ENERGY.leanTissueKcalPerKg
    * deltaLeanTissueKg;
  const totalRemodelingEnergyKcal = fatRemodelingEnergyKcal
    + leanTissueRemodelingEnergyKcal;

  return {
    inputEnergyKcal: input.availableEnergyKcal,
    partitionableEnergyKcal,
    pRatio,
    remodelingDenominator,
    fatStorageEnergyKcal,
    leanTissueStorageEnergyKcal,
    deltaFatMassKg,
    deltaLeanTissueKg,
    fatRemodelingEnergyKcal,
    leanTissueRemodelingEnergyKcal,
    totalRemodelingEnergyKcal,
  };
}
