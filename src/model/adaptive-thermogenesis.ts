export const DEFAULT_ADAPTIVE_THERMOGENESIS_BETA = 0.14;
export const DEFAULT_ADAPTIVE_THERMOGENESIS_TIME_CONSTANT_DAYS = 14;

export type AdaptiveThermogenesisState = {
  /** Additive expenditure adjustment. Negative lowers expenditure. */
  adaptiveThermogenesisKcalPerDay: number;
};

export type AdaptiveThermogenesisTransition = {
  previousAdaptiveThermogenesisKcalPerDay: number;
  adaptiveThermogenesisKcalPerDay: number;
  /** Exact interval mean used as the additive expenditure during this step. */
  meanAdaptiveThermogenesisKcalPerDay: number;
  deltaAdaptiveThermogenesisKcalPerDay: number;
  deltaEnergyIntakeKcalPerDay: number;
  targetAdaptiveThermogenesisKcalPerDay: number;
  decayFactor: number;
  betaAdaptiveThermogenesis: number;
  timeConstantDays: number;
  elapsedDays: number;
};

export type AdaptiveThermogenesisStepInput = {
  currentAdaptiveThermogenesisKcalPerDay: number;
  currentEnergyIntakeKcalPerDay: number | null | undefined;
  baselineEnergyIntakeKcalPerDay: number | null | undefined;
  betaAdaptiveThermogenesis?: number;
  timeConstantDays?: number;
  elapsedDays?: number;
};

function assertFinite(name: string, value: number): void {
  if (!Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
}

function assertNonnegative(name: string, value: number): void {
  assertFinite(name, value);
  if (value < 0) throw new RangeError(`${name} must be nonnegative`);
}

/** Baseline equilibrium has no adaptive expenditure adjustment. */
export function initializeAdaptiveThermogenesisState(): AdaptiveThermogenesisState {
  return { adaptiveThermogenesisKcalPerDay: 0 };
}

/**
 * Exact transition for constant intake over elapsedDays:
 * tau * dAT/dt = beta * (current intake - baseline intake) - AT.
 */
export function stepAdaptiveThermogenesis(
  input: AdaptiveThermogenesisStepInput,
): AdaptiveThermogenesisTransition | null {
  assertFinite(
    "currentAdaptiveThermogenesisKcalPerDay",
    input.currentAdaptiveThermogenesisKcalPerDay,
  );
  const betaAdaptiveThermogenesis = input.betaAdaptiveThermogenesis
    ?? DEFAULT_ADAPTIVE_THERMOGENESIS_BETA;
  const timeConstantDays = input.timeConstantDays
    ?? DEFAULT_ADAPTIVE_THERMOGENESIS_TIME_CONSTANT_DAYS;
  const elapsedDays = input.elapsedDays ?? 1;
  assertNonnegative("betaAdaptiveThermogenesis", betaAdaptiveThermogenesis);
  assertFinite("timeConstantDays", timeConstantDays);
  if (timeConstantDays <= 0) throw new RangeError("timeConstantDays must be positive");
  assertNonnegative("elapsedDays", elapsedDays);

  const currentIntakeMissing = input.currentEnergyIntakeKcalPerDay === null
    || input.currentEnergyIntakeKcalPerDay === undefined;
  const baselineIntakeMissing = input.baselineEnergyIntakeKcalPerDay === null
    || input.baselineEnergyIntakeKcalPerDay === undefined;
  if (!currentIntakeMissing) {
    assertNonnegative("currentEnergyIntakeKcalPerDay", input.currentEnergyIntakeKcalPerDay!);
  }
  if (!baselineIntakeMissing) {
    assertNonnegative("baselineEnergyIntakeKcalPerDay", input.baselineEnergyIntakeKcalPerDay!);
  }
  if (currentIntakeMissing || baselineIntakeMissing) return null;

  const deltaEnergyIntakeKcalPerDay = input.currentEnergyIntakeKcalPerDay!
    - input.baselineEnergyIntakeKcalPerDay!;
  const targetAdaptiveThermogenesisKcalPerDay = betaAdaptiveThermogenesis
    * deltaEnergyIntakeKcalPerDay;
  const decayFactor = Math.exp(-elapsedDays / timeConstantDays);
  const adaptiveThermogenesisKcalPerDay = targetAdaptiveThermogenesisKcalPerDay
    + (input.currentAdaptiveThermogenesisKcalPerDay
      - targetAdaptiveThermogenesisKcalPerDay) * decayFactor;
  const meanAdaptiveThermogenesisKcalPerDay = elapsedDays === 0
    ? input.currentAdaptiveThermogenesisKcalPerDay
    : targetAdaptiveThermogenesisKcalPerDay
      + (input.currentAdaptiveThermogenesisKcalPerDay
        - targetAdaptiveThermogenesisKcalPerDay)
        * timeConstantDays / elapsedDays
        * -Math.expm1(-elapsedDays / timeConstantDays);
  const deltaAdaptiveThermogenesisKcalPerDay = adaptiveThermogenesisKcalPerDay
    - input.currentAdaptiveThermogenesisKcalPerDay;
  const results = [
    deltaEnergyIntakeKcalPerDay,
    targetAdaptiveThermogenesisKcalPerDay,
    decayFactor,
    adaptiveThermogenesisKcalPerDay,
    meanAdaptiveThermogenesisKcalPerDay,
    deltaAdaptiveThermogenesisKcalPerDay,
  ];
  if (results.some((value) => !Number.isFinite(value))) {
    throw new RangeError("adaptive thermogenesis transition must remain finite");
  }

  return {
    previousAdaptiveThermogenesisKcalPerDay:
      input.currentAdaptiveThermogenesisKcalPerDay,
    adaptiveThermogenesisKcalPerDay,
    meanAdaptiveThermogenesisKcalPerDay,
    deltaAdaptiveThermogenesisKcalPerDay,
    deltaEnergyIntakeKcalPerDay,
    targetAdaptiveThermogenesisKcalPerDay,
    decayFactor,
    betaAdaptiveThermogenesis,
    timeConstantDays,
    elapsedDays,
  };
}
