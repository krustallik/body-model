/**
 * Conservative engineering defaults for residual scale-weight filtering.
 * Variances are expressed in kg²; process noise is kg² per elapsed day.
 */
export const DEFAULT_WEIGHT_MEASUREMENT_NOISE_VARIANCE_KG2 = 0.25;
export const DEFAULT_WEIGHT_PROCESS_NOISE_VARIANCE_KG2_PER_DAY = 0.01;
export const DEFAULT_INITIAL_PREDICTION_VARIANCE_KG2 = 1;

export type WeightFilterState = {
  estimatedWeightKg: number;
  varianceKg2: number;
};

export type WeightFilterUpdate = {
  state: WeightFilterState;
  measurementApplied: boolean;
  innovationKg: number | null;
  innovationVarianceKg2: number | null;
  kalmanGain: number | null;
};

function requireFinite(name: string, value: number): void {
  if (!Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
}

function requirePositiveWeight(name: string, value: number): void {
  requireFinite(name, value);
  if (value <= 0) throw new RangeError(`${name} must be positive`);
}

function requireNonnegativeVariance(name: string, value: number): void {
  requireFinite(name, value);
  if (value < 0) throw new RangeError(`${name} must be nonnegative`);
}

function requirePositiveVariance(name: string, value: number): void {
  requireFinite(name, value);
  if (value <= 0) throw new RangeError(`${name} must be positive`);
}

function validateState(state: WeightFilterState): void {
  requirePositiveWeight("state.estimatedWeightKg", state.estimatedWeightKg);
  requireNonnegativeVariance("state.varianceKg2", state.varianceKg2);
}

function checkedState(estimatedWeightKg: number, varianceKg2: number): WeightFilterState {
  requirePositiveWeight("estimatedWeightKg", estimatedWeightKg);
  requireNonnegativeVariance("varianceKg2", varianceKg2);
  return { estimatedWeightKg, varianceKg2 };
}

/**
 * Initializes from the first measurement when available, or from an external
 * physiological prediction. A first measurement carries measurement variance;
 * an external prediction carries the configured initial prediction variance.
 */
export function initializeWeightFilterState(input: {
  measuredWeightKg: number | null;
  predictedWeightKg?: number | null;
  measurementNoiseVarianceKg2?: number;
  initialPredictionVarianceKg2?: number;
}): WeightFilterState {
  const measurementNoiseVarianceKg2 = input.measurementNoiseVarianceKg2
    ?? DEFAULT_WEIGHT_MEASUREMENT_NOISE_VARIANCE_KG2;
  const initialPredictionVarianceKg2 = input.initialPredictionVarianceKg2
    ?? DEFAULT_INITIAL_PREDICTION_VARIANCE_KG2;
  requirePositiveVariance("measurementNoiseVarianceKg2", measurementNoiseVarianceKg2);
  requireNonnegativeVariance("initialPredictionVarianceKg2", initialPredictionVarianceKg2);

  if (input.measuredWeightKg !== null) {
    requirePositiveWeight("measuredWeightKg", input.measuredWeightKg);
  }
  if (input.predictedWeightKg !== null && input.predictedWeightKg !== undefined) {
    requirePositiveWeight("predictedWeightKg", input.predictedWeightKg);
  }

  if (input.predictedWeightKg !== null && input.predictedWeightKg !== undefined) {
    const prediction = checkedState(input.predictedWeightKg, initialPredictionVarianceKg2);
    return updateWeightFilterWithMeasurement({
      predictedState: prediction,
      measuredWeightKg: input.measuredWeightKg,
      measurementNoiseVarianceKg2,
    }).state;
  }
  if (input.measuredWeightKg !== null) {
    return checkedState(input.measuredWeightKg, measurementNoiseVarianceKg2);
  }
  throw new RangeError("initialization requires a measurement or predicted weight");
}

/** Random-walk prediction, optionally centered on a simulator-provided weight. */
export function predictWeightFilterState(input: {
  state: WeightFilterState;
  predictedWeightKg?: number | null;
  elapsedDays?: number;
  processNoiseVarianceKg2PerDay?: number;
}): WeightFilterState {
  validateState(input.state);
  const elapsedDays = input.elapsedDays ?? 1;
  const processNoiseVarianceKg2PerDay = input.processNoiseVarianceKg2PerDay
    ?? DEFAULT_WEIGHT_PROCESS_NOISE_VARIANCE_KG2_PER_DAY;
  requireFinite("elapsedDays", elapsedDays);
  if (elapsedDays < 0) throw new RangeError("elapsedDays must be nonnegative");
  requireNonnegativeVariance("processNoiseVarianceKg2PerDay", processNoiseVarianceKg2PerDay);
  if (input.predictedWeightKg !== null && input.predictedWeightKg !== undefined) {
    requirePositiveWeight("predictedWeightKg", input.predictedWeightKg);
  }

  const estimatedWeightKg = input.predictedWeightKg ?? input.state.estimatedWeightKg;
  const varianceKg2 = input.state.varianceKg2 + processNoiseVarianceKg2PerDay * elapsedDays;
  return checkedState(estimatedWeightKg, varianceKg2);
}

/** Scalar Kalman observation update. Null means prediction-only. */
export function updateWeightFilterWithMeasurement(input: {
  predictedState: WeightFilterState;
  measuredWeightKg: number | null;
  measurementNoiseVarianceKg2?: number;
}): WeightFilterUpdate {
  validateState(input.predictedState);
  const measurementNoiseVarianceKg2 = input.measurementNoiseVarianceKg2
    ?? DEFAULT_WEIGHT_MEASUREMENT_NOISE_VARIANCE_KG2;
  requirePositiveVariance("measurementNoiseVarianceKg2", measurementNoiseVarianceKg2);
  if (input.measuredWeightKg === null) {
    return {
      state: { ...input.predictedState },
      measurementApplied: false,
      innovationKg: null,
      innovationVarianceKg2: null,
      kalmanGain: null,
    };
  }
  requirePositiveWeight("measuredWeightKg", input.measuredWeightKg);

  const innovationKg = input.measuredWeightKg - input.predictedState.estimatedWeightKg;
  const innovationVarianceKg2 = input.predictedState.varianceKg2 + measurementNoiseVarianceKg2;
  requirePositiveVariance("innovationVarianceKg2", innovationVarianceKg2);
  const kalmanGain = input.predictedState.varianceKg2 / innovationVarianceKg2;
  const estimatedWeightKg = input.predictedState.estimatedWeightKg + kalmanGain * innovationKg;
  // Joseph form preserves non-negativity under floating-point arithmetic.
  const residualGain = 1 - kalmanGain;
  const varianceKg2 = residualGain * residualGain * input.predictedState.varianceKg2
    + kalmanGain * kalmanGain * measurementNoiseVarianceKg2;

  return {
    state: checkedState(estimatedWeightKg, varianceKg2),
    measurementApplied: true,
    innovationKg,
    innovationVarianceKg2,
    kalmanGain,
  };
}
