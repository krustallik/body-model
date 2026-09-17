import { RESISTANCE, type ResistanceType } from "./training.constants";
import { ordinaryTonnageFactorForStableKey } from "./external-load-accounting";

export type TonnageSetInput = {
  resistanceType: ResistanceType;
  reps: number;
  weightKg: number | null | undefined;
  /** Portable catalog identity. Required to resolve load-accounting factor. */
  stableKey?: string | null;
  /**
   * Explicit factor for fixtures / total-load customs.
   * When omitted, resolved from stableKey registry. Never defaults to 2.
   */
  ordinaryTonnageFactor?: number | null;
};

/**
 * Ordinary external-weight tonnage:
 * Σ(weightKg × reps × ordinaryTonnageFactor) for EXTERNAL_WEIGHT only.
 *
 * Factor comes from explicit load-accounting metadata (stableKey registry or
 * provided factor). Unknown/custom exercises without semantics do not contribute
 * (no guessed ×2). RESISTANCE_BAND / BODYWEIGHT never contribute.
 */
export function ordinaryExternalWeightTonnageKg(sets: readonly TonnageSetInput[]): number | null {
  let sum = 0;
  let contributed = false;

  for (const set of sets) {
    if (set.resistanceType !== RESISTANCE.EXTERNAL_WEIGHT) continue;
    if (set.weightKg == null || !Number.isFinite(set.weightKg)) continue;
    if (set.weightKg <= 0 || set.reps <= 0) continue;

    const factor = set.ordinaryTonnageFactor !== undefined
      ? set.ordinaryTonnageFactor
      : ordinaryTonnageFactorForStableKey(set.stableKey ?? null);
    if (factor == null || !Number.isFinite(factor) || factor <= 0) continue;

    sum += set.weightKg * set.reps * factor;
    contributed = true;
  }

  return contributed ? sum : null;
}
