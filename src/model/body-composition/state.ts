import { GLYCOGEN_WATER_KG_PER_KG } from "./constants";

/**
 * Mass compartments in the Hall/NIDDK formulation. Glycogen-associated water
 * is derived from glycogen rather than represented as an independent state.
 */
export type BodyCompositionState = {
  fatMassKg: number;
  leanTissueKg: number;
  glycogenKg: number;
  extracellularFluidKg: number;
};

function assertFiniteNonnegative(name: string, value: number): void {
  if (!Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
  if (value < 0) throw new RangeError(`${name} must be nonnegative`);
}

function validateState(state: BodyCompositionState): void {
  assertFiniteNonnegative("fatMassKg", state.fatMassKg);
  assertFiniteNonnegative("leanTissueKg", state.leanTissueKg);
  assertFiniteNonnegative("glycogenKg", state.glycogenKg);
  assertFiniteNonnegative("extracellularFluidKg", state.extracellularFluidKg);
  if (state.fatMassKg === 0) throw new RangeError("fatMassKg must be positive");
  if (state.leanTissueKg === 0) throw new RangeError("leanTissueKg must be positive");
}

export function calculateGlycogenAssociatedWaterKg(glycogenKg: number): number {
  assertFiniteNonnegative("glycogenKg", glycogenKg);
  const waterKg = glycogenKg * GLYCOGEN_WATER_KG_PER_KG;
  if (!Number.isFinite(waterKg)) {
    throw new RangeError("glycogenKg is too large to reconstruct finite body mass");
  }
  return waterKg;
}

/** BW = F + L + G + 2.7G + ECF. No compartment dynamics are implemented here. */
export function reconstructBodyWeightKg(state: BodyCompositionState): number {
  validateState(state);
  const bodyWeightKg = state.fatMassKg
    + state.leanTissueKg
    + state.glycogenKg
    + calculateGlycogenAssociatedWaterKg(state.glycogenKg)
    + state.extracellularFluidKg;
  if (!Number.isFinite(bodyWeightKg)) {
    throw new RangeError("body-composition compartments exceed finite body mass");
  }
  return bodyWeightKg;
}
