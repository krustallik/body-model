import type { AdaptiveThermogenesisState } from "../adaptive-thermogenesis";
import type { WeightFilterState } from "../weight-observation-filter";
import { stableSha256 } from "@/modules/model-recovery/recovery-fingerprint";

/** Independent v7 state contract. It is intentionally not a v6 simulator state. */
export const PHYSIOLOGY_V7_CONTRACT_VERSION = "bodycast-physiology-v7-state-v2" as const;

export type PhysiologyV7State = {
  /**
   * NON-OVERLAP CONTRACT: each listed mass is independent and contains none
   * of the other listed compartments. This is structural accounting only.
   */
  fatMassKg: number;
  /**
   * This is intentionally independent from generic lean tissue. A missing
   * defensible initial skeletal-muscle source stays unavailable; it is never
   * backfilled from another v7 compartment or a v6 lean-tissue value.
   */
  skeletalMuscleKg: number | null;
  otherLeanTissueKg: number;
  /**
   * Aggregate accounting placeholder only. It stays unavailable until a
   * defensible quantitative glycogen source/transition exists; it is never
   * initialized from body composition or nutrition defaults.
   */
  glycogenKg: number | null;
  /**
   * Glycogen-associated water is distinct from ECF and transient exercise
   * water. Without an approved ratio/transition it remains unavailable rather
   * than being synthesized from glycogenKg or substituted with zero.
   */
  glycogenWaterKg: number | null;
  ecfDeviationKg: number;
  transientExerciseWaterKg: number;
} & AdaptiveThermogenesisState & {
  /** Retained as a canonical state concept; v7 does not yet run its transition. */
  weightFilterState: WeightFilterState;
};

const NONNEGATIVE_COMPARTMENTS = [
  "fatMassKg",
  "otherLeanTissueKg",
  "transientExerciseWaterKg",
] as const;

/** Structural contract validation only; it deliberately adds no scientific clamps. */
export function validatePhysiologyV7State(state: PhysiologyV7State): PhysiologyV7State {
  for (const field of NONNEGATIVE_COMPARTMENTS) {
    const value = state[field];
    if (!Number.isFinite(value)) throw new TypeError(`${field} must be finite`);
    if (value < 0) throw new RangeError(`${field} must be nonnegative`);
  }
  if (state.glycogenKg !== null) {
    if (!Number.isFinite(state.glycogenKg)) throw new TypeError("glycogenKg must be finite when available");
    if (state.glycogenKg < 0) throw new RangeError("glycogenKg must be nonnegative when available");
  }
  if (state.glycogenWaterKg !== null) {
    if (!Number.isFinite(state.glycogenWaterKg)) throw new TypeError("glycogenWaterKg must be finite when available");
    if (state.glycogenWaterKg < 0) throw new RangeError("glycogenWaterKg must be nonnegative when available");
  }
  if (state.skeletalMuscleKg !== null) {
    if (!Number.isFinite(state.skeletalMuscleKg)) throw new TypeError("skeletalMuscleKg must be finite when available");
    if (state.skeletalMuscleKg < 0) throw new RangeError("skeletalMuscleKg must be nonnegative when available");
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
export function reconstructPhysiologyV7MassKg(state: PhysiologyV7State): number | null {
  validatePhysiologyV7State(state);
  if (state.skeletalMuscleKg === null || state.glycogenKg === null || state.glycogenWaterKg === null) return null;
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
