import { RESISTANCE, TRAINING_LIMITS, type ResistanceType } from "./training.constants";

export type SetFieldInput = {
  reps: number;
  weightKg?: number | null;
  bandNominalResistanceKg?: number | null;
  /** Undefined = leave unchanged (update path). Null = clear / not reported. */
  rir?: number | null;
};

export type SetValidationResult =
  | {
      ok: true;
      reps: number;
      weightKg: number | null;
      bandNominalResistanceKg: number | null;
      rir: number | null;
    }
  | { ok: false; message: string };

function isPresentNumber(value: number | null | undefined): value is number {
  return value != null && Number.isFinite(value);
}

/**
 * Validate optional user-reported RIR.
 * ENGINEERING input constraint only — not a scientific hard-set cutoff (P-A04).
 * Null means not reported; null is never coerced to 0.
 */
export function validateRir(rir: number | null | undefined): {
  ok: true;
  rir: number | null;
} | { ok: false; message: string } {
  if (rir === undefined || rir === null) return { ok: true, rir: null };
  if (!Number.isInteger(rir)) {
    return { ok: false, message: "rir must be an integer when present" };
  }
  if (rir < TRAINING_LIMITS.minRir || rir > TRAINING_LIMITS.maxRir) {
    return {
      ok: false,
      message: `rir must be between ${TRAINING_LIMITS.minRir} and ${TRAINING_LIMITS.maxRir} when present`,
    };
  }
  return { ok: true, rir };
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
  const rirResult = validateRir(input.rir === undefined ? null : input.rir);
  if (!rirResult.ok) return rirResult;

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
      return {
        ok: true,
        reps: input.reps,
        weightKg,
        bandNominalResistanceKg: null,
        rir: rirResult.rir,
      };

    case RESISTANCE.RESISTANCE_BAND:
      if (isPresentNumber(weightKg)) {
        return { ok: false, message: "RESISTANCE_BAND sets must not have weightKg" };
      }
      return {
        ok: true,
        reps: input.reps,
        weightKg: null,
        bandNominalResistanceKg: band,
        rir: rirResult.rir,
      };

    case RESISTANCE.BODYWEIGHT:
      if (isPresentNumber(weightKg) || isPresentNumber(band)) {
        return { ok: false, message: "BODYWEIGHT sets must not have weightKg or bandNominalResistanceKg" };
      }
      return {
        ok: true,
        reps: input.reps,
        weightKg: null,
        bandNominalResistanceKg: null,
        rir: rirResult.rir,
      };

    default:
      return { ok: false, message: "unknown resistance type" };
  }
}
