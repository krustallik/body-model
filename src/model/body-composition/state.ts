import {
  EXTRACELLULAR_FLUID_MODEL,
  GLYCOGEN_WATER_KG_PER_KG,
} from "./constants";

/**
 * Mass compartments in the Hall/NIDDK formulation. Glycogen-associated water
 * is derived from glycogen rather than represented as an independent state.
 */
export type BodyCompositionState = {
  fatMassKg: number;
  leanTissueKg: number;
  glycogenKg: number;
  baselineExtracellularFluidLiters: number;
  extracellularFluidDeviationLiters: number;
};

function assertFiniteNonnegative(name: string, value: number): void {
  if (!Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
  if (value < 0) throw new RangeError(`${name} must be nonnegative`);
}

function validateState(state: BodyCompositionState): void {
  assertFiniteNonnegative("fatMassKg", state.fatMassKg);
  assertFiniteNonnegative("leanTissueKg", state.leanTissueKg);
  assertFiniteNonnegative("glycogenKg", state.glycogenKg);
  assertFiniteNonnegative(
    "baselineExtracellularFluidLiters",
    state.baselineExtracellularFluidLiters,
  );
  if (!Number.isFinite(state.extracellularFluidDeviationLiters)) {
    throw new TypeError("extracellularFluidDeviationLiters must be finite");
  }
  if (state.fatMassKg === 0) throw new RangeError("fatMassKg must be positive");
  if (state.leanTissueKg === 0) throw new RangeError("leanTissueKg must be positive");
  if (calculateExtracellularFluidLiters(state) <= 0) {
    throw new RangeError("absolute extracellular fluid must be positive");
  }
}

export function calculateGlycogenAssociatedWaterKg(glycogenKg: number): number {
  assertFiniteNonnegative("glycogenKg", glycogenKg);
  const waterKg = glycogenKg * GLYCOGEN_WATER_KG_PER_KG;
  if (!Number.isFinite(waterKg)) {
    throw new RangeError("glycogenKg is too large to reconstruct finite body mass");
  }
  return waterKg;
}

export function calculateGlycogenAssociatedMassKg(glycogenKg: number): number {
  assertFiniteNonnegative("glycogenKg", glycogenKg);
  const associatedMassKg = glycogenKg + calculateGlycogenAssociatedWaterKg(glycogenKg);
  if (!Number.isFinite(associatedMassKg)) {
    throw new RangeError("glycogenKg is too large to reconstruct finite associated mass");
  }
  return associatedMassKg;
}

export function calculateExtracellularFluidLiters(
  state: Pick<
    BodyCompositionState,
    "baselineExtracellularFluidLiters" | "extracellularFluidDeviationLiters"
  >,
): number {
  const liters = state.baselineExtracellularFluidLiters
    + state.extracellularFluidDeviationLiters;
  if (!Number.isFinite(liters)) {
    throw new RangeError("extracellular-fluid volume exceeds supported numeric precision");
  }
  return liters;
}

export function calculateExtracellularFluidMassKg(extracellularFluidLiters: number): number {
  assertFiniteNonnegative("extracellularFluidLiters", extracellularFluidLiters);
  return extracellularFluidLiters * EXTRACELLULAR_FLUID_MODEL.waterDensityKgPerLiter;
}

/** BW = F + L + G + 2.7G + rhoWater * ECF. */
export function reconstructBodyWeightKg(state: BodyCompositionState): number {
  validateState(state);
  const bodyWeightKg = state.fatMassKg
    + state.leanTissueKg
    + calculateGlycogenAssociatedMassKg(state.glycogenKg)
    + calculateExtracellularFluidMassKg(calculateExtracellularFluidLiters(state));
  if (!Number.isFinite(bodyWeightKg)) {
    throw new RangeError("body-composition compartments exceed finite body mass");
  }
  return bodyWeightKg;
}
