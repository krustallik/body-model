/** Hall-style resting-expenditure coefficients, expressed in kcal/(kg day). */
export const DYNAMIC_RMR_COEFFICIENTS = {
  fatMassKcalPerKgPerDay: 3.2,
  leanTissueKcalPerKgPerDay: 22,
} as const;

export type DynamicRmrParameters = {
  fatMassKcalPerKgPerDay: number;
  leanTissueKcalPerKgPerDay: number;
  calibrationOffsetKcalPerDay: number;
};

export type DynamicRmrInitializationInput = {
  initialRmrKcalPerDay: number;
  initialFatMassKg: number;
  initialLeanTissueKg: number;
};

function assertFinite(name: string, value: number): void {
  if (!Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
}

function assertPositive(name: string, value: number): void {
  assertFinite(name, value);
  if (value <= 0) throw new RangeError(`${name} must be positive`);
}

function structuralRmrKcalPerDay(
  fatMassKg: number,
  leanTissueKg: number,
  parameters: Pick<
    DynamicRmrParameters,
    "fatMassKcalPerKgPerDay" | "leanTissueKcalPerKgPerDay"
  >,
): number {
  const result = parameters.fatMassKcalPerKgPerDay * fatMassKg
    + parameters.leanTissueKcalPerKgPerDay * leanTissueKg;
  if (!Number.isFinite(result)) {
    throw new RangeError("body composition exceeds finite RMR precision");
  }
  return result;
}

/**
 * Calibrates the Hall-style body-composition equation to the initial RMR.
 * This physiological alignment constant is not a fitted total-expenditure offset.
 */
export function createDynamicRmrParameters(
  input: DynamicRmrInitializationInput,
): DynamicRmrParameters {
  assertPositive("initialRmrKcalPerDay", input.initialRmrKcalPerDay);
  assertPositive("initialFatMassKg", input.initialFatMassKg);
  assertPositive("initialLeanTissueKg", input.initialLeanTissueKg);

  const parameters = {
    ...DYNAMIC_RMR_COEFFICIENTS,
    calibrationOffsetKcalPerDay: 0,
  };
  parameters.calibrationOffsetKcalPerDay = input.initialRmrKcalPerDay
    - structuralRmrKcalPerDay(
      input.initialFatMassKg,
      input.initialLeanTissueKg,
      parameters,
    );
  assertFinite("calibrationOffsetKcalPerDay", parameters.calibrationOffsetKcalPerDay);
  return parameters;
}

/** RMR = calibration offset + 3.2 FatMass + 22 LeanTissue, in kcal/day. */
export function calculateDynamicRmr(input: {
  fatMassKg: number;
  leanTissueKg: number;
  parameters: DynamicRmrParameters;
}): number {
  assertPositive("fatMassKg", input.fatMassKg);
  assertPositive("leanTissueKg", input.leanTissueKg);
  assertFinite("fatMassKcalPerKgPerDay", input.parameters.fatMassKcalPerKgPerDay);
  assertFinite("leanTissueKcalPerKgPerDay", input.parameters.leanTissueKcalPerKgPerDay);
  assertFinite("calibrationOffsetKcalPerDay", input.parameters.calibrationOffsetKcalPerDay);
  if (input.parameters.fatMassKcalPerKgPerDay < 0
      || input.parameters.leanTissueKcalPerKgPerDay < 0) {
    throw new RangeError("dynamic RMR coefficients must be nonnegative");
  }

  const rmrKcalPerDay = input.parameters.calibrationOffsetKcalPerDay
    + structuralRmrKcalPerDay(input.fatMassKg, input.leanTissueKg, input.parameters);
  if (!Number.isFinite(rmrKcalPerDay)) {
    throw new RangeError("dynamic RMR exceeds finite numeric precision");
  }
  if (rmrKcalPerDay <= 0) {
    throw new RangeError("dynamic RMR must remain positive");
  }
  return rmrKcalPerDay;
}
