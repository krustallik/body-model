import { RESISTANCE, TRAINING_LIMITS, type ResistanceType } from "./training.constants";

export type SetFieldInput = {
  reps: number;
  weightKg?: number | null;
  bandNominalResistanceKg?: number | null;
};

export type SetValidationResult =
  | {
      ok: true;
      reps: number;
      weightKg: number | null;
      bandNominalResistanceKg: number | null;
    }
  | { ok: false; message: string };

function isPresentNumber(value: number | null | undefined): value is number {
  return value != null && Number.isFinite(value);
}

/**
 * Validate set fields against the session exercise resistance type.
 * Completed-set semantics: mixed weight+band is always rejected.
 */
export function validateSetFields(
  resistanceType: ResistanceType,
  input: SetFieldInput,
): SetValidationResult {
  if (!Number.isInteger(input.reps) || input.reps <= 0 || input.reps > TRAINING_LIMITS.maxReps) {
    return { ok: false, message: "reps must be a positive integer" };
  }

  const weightKg = input.weightKg === undefined ? null : input.weightKg;
  const band = input.bandNominalResistanceKg === undefined ? null : input.bandNominalResistanceKg;

  if (isPresentNumber(weightKg) && weightKg <= 0) {
    return { ok: false, message: "weightKg must be positive when present" };
  }
  if (isPresentNumber(band) && band <= 0) {
    return { ok: false, message: "bandNominalResistanceKg must be positive when present" };
  }
  if (isPresentNumber(weightKg) && weightKg > TRAINING_LIMITS.maxLoadKg) {
    return { ok: false, message: "weightKg exceeds allowed maximum" };
  }
  if (isPresentNumber(band) && band > TRAINING_LIMITS.maxLoadKg) {
    return { ok: false, message: "bandNominalResistanceKg exceeds allowed maximum" };
  }

  if (isPresentNumber(weightKg) && isPresentNumber(band)) {
    return { ok: false, message: "weightKg and bandNominalResistanceKg cannot both be set" };
  }

  switch (resistanceType) {
    case RESISTANCE.EXTERNAL_WEIGHT:
      if (isPresentNumber(band)) {
        return { ok: false, message: "EXTERNAL_WEIGHT sets must not have bandNominalResistanceKg" };
      }
      return { ok: true, reps: input.reps, weightKg, bandNominalResistanceKg: null };

    case RESISTANCE.RESISTANCE_BAND:
      if (isPresentNumber(weightKg)) {
        return { ok: false, message: "RESISTANCE_BAND sets must not have weightKg" };
      }
      return { ok: true, reps: input.reps, weightKg: null, bandNominalResistanceKg: band };

    case RESISTANCE.BODYWEIGHT:
      if (isPresentNumber(weightKg) || isPresentNumber(band)) {
        return { ok: false, message: "BODYWEIGHT sets must not have weightKg or bandNominalResistanceKg" };
      }
      return { ok: true, reps: input.reps, weightKg: null, bandNominalResistanceKg: null };

    default:
      return { ok: false, message: "unknown resistance type" };
  }
}
