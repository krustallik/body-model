import type { AdaptiveThermogenesisState } from "../adaptive-thermogenesis";
import type { WeightFilterState } from "../weight-observation-filter";
import { stableSha256 } from "@/modules/model-recovery/recovery-fingerprint";

/** Independent v7 state contract. It is intentionally not a v6 simulator state. */
export const PHYSIOLOGY_V7_CONTRACT_VERSION = "bodycast-physiology-v7-state-v1" as const;

export type PhysiologyV7State = {
  /**
   * NON-OVERLAP CONTRACT: each listed mass is independent and contains none
   * of the other listed compartments. This is structural accounting only.
   */
  fatMassKg: number;
  skeletalMuscleKg: number;
  otherLeanTissueKg: number;
  glycogenKg: number;
  glycogenWaterKg: number;
  ecfDeviationKg: number;
  transientExerciseWaterKg: number;
} & AdaptiveThermogenesisState & {
  /** Retained as a canonical state concept; v7 does not yet run its transition. */
  weightFilterState: WeightFilterState;
};

const NONNEGATIVE_COMPARTMENTS = [
  "fatMassKg",
  "skeletalMuscleKg",
  "otherLeanTissueKg",
  "glycogenKg",
  "glycogenWaterKg",
  "transientExerciseWaterKg",
] as const;

/** Structural contract validation only; it deliberately adds no scientific clamps. */
export function validatePhysiologyV7State(state: PhysiologyV7State): PhysiologyV7State {
  for (const field of NONNEGATIVE_COMPARTMENTS) {
    const value = state[field];
    if (!Number.isFinite(value)) throw new TypeError(`${field} must be finite`);
    if (value < 0) throw new RangeError(`${field} must be nonnegative`);
  }
  for (const [field, value] of Object.entries({
    ecfDeviationKg: state.ecfDeviationKg,
    adaptiveThermogenesisKcalPerDay: state.adaptiveThermogenesisKcalPerDay,
    estimatedWeightKg: state.weightFilterState.estimatedWeightKg,
    varianceKg2: state.weightFilterState.varianceKg2,
  })) {
    if (!Number.isFinite(value)) throw new TypeError(`${field} must be finite`);
  }
  return state;
}

/** Stable serialization seam for future v7 persistence/rebuild work. */
export function physiologyV7StateFingerprint(state: PhysiologyV7State): string {
  validatePhysiologyV7State(state);
  return stableSha256({ contractVersion: PHYSIOLOGY_V7_CONTRACT_VERSION, state });
}

/**
 * Structural mass accounting only:
 * fat + skeletal muscle + other lean tissue + glycogen + glycogen water
 * + signed ECF deviation + transient exercise water.
 *
 * `ecfDeviationKg` is a signed deviation, so it has no nonnegative invariant.
 * No term contains another term and each is counted exactly once.
 */
export function reconstructPhysiologyV7MassKg(state: PhysiologyV7State): number {
  validatePhysiologyV7State(state);
  const massKg = state.fatMassKg
    + state.skeletalMuscleKg
    + state.otherLeanTissueKg
    + state.glycogenKg
    + state.glycogenWaterKg
    + state.ecfDeviationKg
    + state.transientExerciseWaterKg;
  if (!Number.isFinite(massKg)) throw new RangeError("v7 mass compartments exceed finite precision");
  return massKg;
}
