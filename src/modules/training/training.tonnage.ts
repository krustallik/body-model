import { RESISTANCE, type ResistanceType } from "./training.constants";

export type TonnageSetInput = {
  resistanceType: ResistanceType;
  reps: number;
  weightKg: number | null | undefined;
};

/**
 * Ordinary external-weight tonnage only: Σ(weightKg × reps).
 * RESISTANCE_BAND and BODYWEIGHT never contribute (including fake 0 kg).
 * Missing weight on EXTERNAL_WEIGHT is skipped (missing ≠ zero).
 */
export function ordinaryExternalWeightTonnageKg(sets: readonly TonnageSetInput[]): number | null {
  let sum = 0;
  let contributed = false;

  for (const set of sets) {
    if (set.resistanceType !== RESISTANCE.EXTERNAL_WEIGHT) continue;
    if (set.weightKg == null || !Number.isFinite(set.weightKg)) continue;
    if (set.weightKg <= 0 || set.reps <= 0) continue;
    sum += set.weightKg * set.reps;
    contributed = true;
  }

  return contributed ? sum : null;
}
