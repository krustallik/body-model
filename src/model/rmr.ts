import { MIFFLIN_ST_JEOR, MODEL_INPUT_LIMITS, type ModelSex } from "./constants";

export type RmrInput = {
  sex: ModelSex;
  weightKg: number;
  heightCm: number;
  ageYears: number;
};

function assertFinite(name: string, value: number): void {
  if (!Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
}

function assertRmrInput({ sex, weightKg, heightCm, ageYears }: RmrInput): void {
  if (!(sex in MIFFLIN_ST_JEOR.sexOffsetKcalPerDay)) {
    throw new RangeError("sex must be male or female");
  }

  assertFinite("weightKg", weightKg);
  assertFinite("heightCm", heightCm);
  assertFinite("ageYears", ageYears);

  if (weightKg <= MODEL_INPUT_LIMITS.weightKg.minimumExclusive
      || weightKg > MODEL_INPUT_LIMITS.weightKg.maximumInclusive) {
    throw new RangeError("weightKg is outside the supported physical range");
  }
  if (heightCm <= MODEL_INPUT_LIMITS.heightCm.minimumExclusive
      || heightCm > MODEL_INPUT_LIMITS.heightCm.maximumInclusive) {
    throw new RangeError("heightCm is outside the supported physical range");
  }
  if (!Number.isInteger(ageYears)) throw new TypeError("ageYears must be an integer of completed years");
  if (ageYears < MODEL_INPUT_LIMITS.ageYears.minimumInclusive
      || ageYears > MODEL_INPUT_LIMITS.ageYears.maximumInclusive) {
    throw new RangeError("ageYears is outside the supported adult range");
  }
}

/** Returns Mifflin–St Jeor estimated resting energy expenditure in kcal/day. */
export function calculateRmr(input: RmrInput): number {
  assertRmrInput(input);
  return MIFFLIN_ST_JEOR.weightKgCoefficient * input.weightKg
    + MIFFLIN_ST_JEOR.heightCmCoefficient * input.heightCm
    + MIFFLIN_ST_JEOR.ageYearsCoefficient * input.ageYears
    + MIFFLIN_ST_JEOR.sexOffsetKcalPerDay[input.sex];
}
