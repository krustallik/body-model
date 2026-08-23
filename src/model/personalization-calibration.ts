import {
  DEFAULT_EXPENDITURE_PERSONALIZATION,
  type ExpenditurePersonalization,
} from "./dynamic-daily-expenditure";
import {
  simulateDays,
  type CompleteSimulationDay,
  type EcfSimulationPolicy,
  type PhysiologicalDailyInput,
  type PhysiologicalSimulatorParameters,
  type PhysiologicalSimulatorState,
} from "./physiological-simulator";

export type CalibrationDay = {
  date: string;
  simulatorInput: Omit<PhysiologicalDailyInput, "date" | "measuredWeightKg">;
  measuredWeightKg: number | null;
};

export type PersonalizationCalibrationStatus =
  | "insufficient-history"
  | "invalid-history"
  | "offset-only"
  | "fully-calibrated"
  | "defaults-retained";

export type CalibrationWarning =
  | "incomplete-simulation-day"
  | "insufficient-activity-variation"
  | "weak-two-parameter-identifiability"
  | "parameter-at-bound"
  | "validation-improvement-too-small";

export type ObservationLossConfig =
  | { type: "gaussian" }
  | { type: "student-t"; degreesOfFreedom: number };

export type PersonalizationCalibrationConfig = {
  minOffsetObservationCount: number;
  minOffsetObservationSpanDays: number;
  minFullObservationCount: number;
  minFullObservationSpanDays: number;
  validationFraction: number;
  minValidationObservationCount: number;
  minActivityStandardDeviationKcalPerDay: number;
  minActivityCoefficientOfVariation: number;
  personalOffsetMinKcalPerDay: number;
  personalOffsetMaxKcalPerDay: number;
  activityCalibrationMin: number;
  activityCalibrationMax: number;
  personalOffsetPriorScaleKcalPerDay: number;
  activityCalibrationPriorScale: number;
  gridIntervals: number;
  refinementIterations: number;
  minimumValidationNisImprovementFraction: number;
  minimumValidationNisImprovementAbsolute: number;
  parameterBoundToleranceFraction: number;
  ridgeProbeActivityDelta: number;
  ridgeMaxMeanNllIncrease: number;
  observationLoss: ObservationLossConfig;
};

/**
 * Conservative engineering policy, not population-level physiological truth.
 * Hall et al. support the >28-day offset gate; the stricter two-parameter gate
 * and excitation thresholds protect a practically weak intercept/slope fit.
 */
export const DEFAULT_PERSONALIZATION_CALIBRATION_CONFIG:
Readonly<PersonalizationCalibrationConfig> = {
  minOffsetObservationCount: 20,
  minOffsetObservationSpanDays: 28,
  minFullObservationCount: 35,
  minFullObservationSpanDays: 56,
  validationFraction: 0.2,
  minValidationObservationCount: 5,
  minActivityStandardDeviationKcalPerDay: 75,
  minActivityCoefficientOfVariation: 0.2,
  personalOffsetMinKcalPerDay: -500,
  personalOffsetMaxKcalPerDay: 500,
  activityCalibrationMin: 0.5,
  activityCalibrationMax: 1.5,
  personalOffsetPriorScaleKcalPerDay: 200,
  activityCalibrationPriorScale: 0.25,
  gridIntervals: 12,
  refinementIterations: 12,
  minimumValidationNisImprovementFraction: 0.02,
  minimumValidationNisImprovementAbsolute: 0.01,
  parameterBoundToleranceFraction: 0.01,
  ridgeProbeActivityDelta: 0.1,
  ridgeMaxMeanNllIncrease: 0.001,
  observationLoss: { type: "student-t", degreesOfFreedom: 5 },
};

export type CalibrationObservation = {
  date: string;
  dayIndex: number;
  innovationKg: number;
  innovationVarianceKg2: number;
  absoluteStandardizedInnovation: number;
  observationWeight: number;
  normalizedInnovationSquared: number;
  negativeLogLikelihood: number;
};

export type CalibrationEvaluation = {
  status: "complete" | "invalid-history";
  observations: CalibrationObservation[];
  activityKcalPerDay: number[];
  negativeLogLikelihood: number | null;
  meanNegativeLogLikelihood: number | null;
  meanNormalizedInnovationSquared: number | null;
  rootMeanSquaredErrorKg: number | null;
  largestStandardizedInnovation: number | null;
  minimumObservationWeight: number | null;
  observationLoss: ObservationLossConfig;
  invalidDayDate: string | null;
  missingFields: string[];
};

export type CalibrationDiagnostics = {
  historyDays: number;
  completeDayCount: number;
  observationCount: number;
  observationSpanDays: number;
  trainingObservationCount: number;
  validationObservationCount: number;
  activityMeanKcalPerDay: number | null;
  activityStandardDeviationKcalPerDay: number | null;
  activityCoefficientOfVariation: number | null;
  defaultTrainingLoss: number | null;
  trainingLoss: number | null;
  regularizedTrainingLoss: number | null;
  defaultValidationLoss: number | null;
  validationLoss: number | null;
  defaultValidationNis: number | null;
  validationNis: number | null;
  observationLossType: ObservationLossConfig["type"];
  studentTDegreesOfFreedom: number | null;
  largestStandardizedInnovation: number | null;
  minimumObservationWeight: number | null;
  parameterAtBound: (keyof ExpenditurePersonalization)[];
  twoParameterIdentifiability:
    | "not-evaluated"
    | "insufficient-variation"
    | "weak"
    | "adequate";
  personalizationAccepted: boolean;
  invalidDayDate: string | null;
  missingFields: string[];
  warnings: CalibrationWarning[];
};

export type PersonalizationCalibrationResult = {
  status: PersonalizationCalibrationStatus;
  parameters: ExpenditurePersonalization;
  loss: number | null;
  diagnostics: CalibrationDiagnostics;
};

type CalibrationContext = {
  initialState: PhysiologicalSimulatorState;
  simulatorParameters: PhysiologicalSimulatorParameters;
  history: readonly CalibrationDay[];
  ecfPolicy: EcfSimulationPolicy;
};

type EvaluationWindow = { startDayIndex: number; endDayIndex: number };

type Candidate = {
  parameters: ExpenditurePersonalization;
  regularizedLoss: number;
  evaluation: CalibrationEvaluation;
};

const GAUSSIAN_NORMALIZATION = Math.log(2 * Math.PI);
const LANCZOS_COEFFICIENTS = [
  676.5203681218851,
  -1259.1392167224028,
  771.3234287776531,
  -176.6150291621406,
  12.507343278686905,
  -0.13857109526572012,
  9.984369578019572e-6,
  1.5056327351493116e-7,
] as const;

function cloneDefaults(): ExpenditurePersonalization {
  return { ...DEFAULT_EXPENDITURE_PERSONALIZATION };
}

function requireFinite(name: string, value: number): void {
  if (!Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
}

function validateIntegerAtLeast(name: string, value: number, minimum: number): void {
  requireFinite(name, value);
  if (!Number.isInteger(value) || value < minimum) {
    throw new RangeError(`${name} must be an integer >= ${minimum}`);
  }
}

function validateObservationLoss(config: ObservationLossConfig): void {
  if (config.type !== "gaussian" && config.type !== "student-t") {
    throw new RangeError("unknown observation loss type");
  }
  if (config.type === "student-t") {
    requireFinite("observationLoss.degreesOfFreedom", config.degreesOfFreedom);
    if (config.degreesOfFreedom <= 2) {
      throw new RangeError("Student-t degreesOfFreedom must be > 2 for finite variance");
    }
  }
}

function validateConfig(config: PersonalizationCalibrationConfig): void {
  validateIntegerAtLeast("minOffsetObservationCount", config.minOffsetObservationCount, 1);
  validateIntegerAtLeast("minOffsetObservationSpanDays", config.minOffsetObservationSpanDays, 1);
  validateIntegerAtLeast("minFullObservationCount", config.minFullObservationCount, 1);
  validateIntegerAtLeast("minFullObservationSpanDays", config.minFullObservationSpanDays, 1);
  validateIntegerAtLeast("minValidationObservationCount", config.minValidationObservationCount, 1);
  validateIntegerAtLeast("gridIntervals", config.gridIntervals, 2);
  validateIntegerAtLeast("refinementIterations", config.refinementIterations, 0);
  const finiteFields: (keyof Omit<PersonalizationCalibrationConfig, "observationLoss">)[] = [
    "validationFraction",
    "minActivityStandardDeviationKcalPerDay",
    "minActivityCoefficientOfVariation",
    "personalOffsetMinKcalPerDay",
    "personalOffsetMaxKcalPerDay",
    "activityCalibrationMin",
    "activityCalibrationMax",
    "personalOffsetPriorScaleKcalPerDay",
    "activityCalibrationPriorScale",
    "minimumValidationNisImprovementFraction",
    "minimumValidationNisImprovementAbsolute",
    "parameterBoundToleranceFraction",
    "ridgeProbeActivityDelta",
    "ridgeMaxMeanNllIncrease",
  ];
  for (const field of finiteFields) requireFinite(field, config[field]);
  if (config.validationFraction <= 0 || config.validationFraction >= 0.5) {
    throw new RangeError("validationFraction must be between 0 and 0.5");
  }
  if (config.minActivityStandardDeviationKcalPerDay < 0
      || config.minActivityCoefficientOfVariation < 0) {
    throw new RangeError("Activity variation thresholds must be nonnegative");
  }
  if (config.personalOffsetMinKcalPerDay >= config.personalOffsetMaxKcalPerDay) {
    throw new RangeError("personalOffset bounds must be increasing");
  }
  if (config.personalOffsetMinKcalPerDay > 0
      || config.personalOffsetMaxKcalPerDay < 0) {
    throw new RangeError("personalOffset bounds must include the scientific default 0");
  }
  if (config.activityCalibrationMin < 0
      || config.activityCalibrationMin >= config.activityCalibrationMax) {
    throw new RangeError("activityCalibration bounds must be nonnegative and increasing");
  }
  if (config.activityCalibrationMin > 1 || config.activityCalibrationMax < 1) {
    throw new RangeError("activityCalibration bounds must include the scientific default 1");
  }
  if (config.personalOffsetPriorScaleKcalPerDay <= 0
      || config.activityCalibrationPriorScale <= 0) {
    throw new RangeError("prior scales must be positive");
  }
  if (config.minimumValidationNisImprovementFraction < 0
      || config.minimumValidationNisImprovementAbsolute < 0
      || config.parameterBoundToleranceFraction < 0
      || config.parameterBoundToleranceFraction > 0.5
      || config.ridgeProbeActivityDelta <= 0
      || config.ridgeMaxMeanNllIncrease < 0) {
    throw new RangeError("acceptance and ridge settings are outside supported ranges");
  }
  validateObservationLoss(config.observationLoss);
}

export function createPersonalizationCalibrationConfig(
  overrides: Partial<PersonalizationCalibrationConfig> = {},
): PersonalizationCalibrationConfig {
  const observationLoss = overrides.observationLoss
    ?? DEFAULT_PERSONALIZATION_CALIBRATION_CONFIG.observationLoss;
  const config = {
    ...DEFAULT_PERSONALIZATION_CALIBRATION_CONFIG,
    ...overrides,
    observationLoss: { ...observationLoss },
  };
  validateConfig(config);
  return config;
}

function asSimulationDays(history: readonly CalibrationDay[]): PhysiologicalDailyInput[] {
  return history.map((day) => ({
    ...day.simulatorInput,
    occupationalActivity: { ...day.simulatorInput.occupationalActivity },
    date: day.date,
    measuredWeightKg: day.measuredWeightKg,
  }));
}

function inWindow(dayIndex: number, window: EvaluationWindow | undefined): boolean {
  return window === undefined
    || (dayIndex >= window.startDayIndex && dayIndex < window.endDayIndex);
}

function logGamma(value: number): number {
  const shifted = value - 1;
  let series = 0.9999999999998099;
  for (let index = 0; index < LANCZOS_COEFFICIENTS.length; index += 1) {
    series += LANCZOS_COEFFICIENTS[index] / (shifted + index + 1);
  }
  const t = shifted + LANCZOS_COEFFICIENTS.length - 0.5;
  return 0.5 * Math.log(2 * Math.PI)
    + (shifted + 0.5) * Math.log(t)
    - t
    + Math.log(series);
}

function calculateObservationLoss(input: {
  innovationKg: number;
  innovationVarianceKg2: number;
  config: ObservationLossConfig;
}): { negativeLogLikelihood: number; observationWeight: number } {
  const normalizedInnovationSquared = input.innovationKg ** 2
    / input.innovationVarianceKg2;
  if (input.config.type === "gaussian") {
    return {
      negativeLogLikelihood: 0.5 * (
        GAUSSIAN_NORMALIZATION
        + Math.log(input.innovationVarianceKg2)
        + normalizedInnovationSquared
      ),
      observationWeight: 1,
    };
  }
  const degreesOfFreedom = input.config.degreesOfFreedom;
  // Match the existing innovation variance instead of treating it as t scale².
  const scaleSquaredKg2 = input.innovationVarianceKg2
    * (degreesOfFreedom - 2) / degreesOfFreedom;
  const scaledSquaredResidual = input.innovationKg ** 2
    / (degreesOfFreedom * scaleSquaredKg2);
  return {
    negativeLogLikelihood:
      logGamma(degreesOfFreedom / 2)
      - logGamma((degreesOfFreedom + 1) / 2)
      + 0.5 * Math.log(degreesOfFreedom * Math.PI * scaleSquaredKg2)
      + (degreesOfFreedom + 1) / 2 * Math.log1p(scaledSquaredResidual),
    /** Unit-scale tail influence: 1 at zero and approaches 0 continuously. */
    observationWeight: 1 / (1 + scaledSquaredResidual),
  };
}

function evaluate(
  context: CalibrationContext,
  parameters: ExpenditurePersonalization,
  lossConfig: ObservationLossConfig,
  window?: EvaluationWindow,
): CalibrationEvaluation {
  const results = simulateDays({
    initialState: context.initialState,
    parameters: context.simulatorParameters,
    days: asSimulationDays(context.history),
    options: { ecfPolicy: context.ecfPolicy },
    personalization: parameters,
  });
  const incomplete = results.find((result) => result.status === "incomplete");
  const completePrefix = (incomplete === undefined
    ? results
    : results.slice(0, results.indexOf(incomplete))) as CompleteSimulationDay[];
  const observations: CalibrationObservation[] = [];
  const activityKcalPerDay: number[] = [];
  for (let dayIndex = 0; dayIndex < completePrefix.length; dayIndex += 1) {
    const result = completePrefix[dayIndex];
    if (!inWindow(dayIndex, window)) continue;
    activityKcalPerDay.push(result.calculations.expenditure.activityKcalPerDay!);
    const update = result.calculations.weightFilterUpdate;
    if (update.innovationKg === null || update.innovationVarianceKg2 === null) continue;
    const normalizedInnovationSquared = update.innovationKg ** 2
      / update.innovationVarianceKg2;
    const robustLoss = calculateObservationLoss({
      innovationKg: update.innovationKg,
      innovationVarianceKg2: update.innovationVarianceKg2,
      config: lossConfig,
    });
    observations.push({
      date: result.date,
      dayIndex,
      innovationKg: update.innovationKg,
      innovationVarianceKg2: update.innovationVarianceKg2,
      absoluteStandardizedInnovation: Math.sqrt(normalizedInnovationSquared),
      observationWeight: robustLoss.observationWeight,
      normalizedInnovationSquared,
      negativeLogLikelihood: robustLoss.negativeLogLikelihood,
    });
  }
  if (incomplete !== undefined) {
    return {
      status: "invalid-history",
      observations,
      activityKcalPerDay,
      negativeLogLikelihood: null,
      meanNegativeLogLikelihood: null,
      meanNormalizedInnovationSquared: null,
      rootMeanSquaredErrorKg: null,
      largestStandardizedInnovation: null,
      minimumObservationWeight: null,
      observationLoss: { ...lossConfig },
      invalidDayDate: incomplete.date,
      missingFields: [...incomplete.missingFields],
    };
  }
  const count = observations.length;
  const negativeLogLikelihood = count === 0
    ? null
    : observations.reduce((sum, observation) => sum + observation.negativeLogLikelihood, 0);
  const squaredError = count === 0
    ? null
    : observations.reduce((sum, observation) => sum + observation.innovationKg ** 2, 0);
  const normalizedSquared = count === 0
    ? null
    : observations.reduce(
      (sum, observation) => sum + observation.normalizedInnovationSquared,
      0,
    );
  return {
    status: "complete",
    observations,
    activityKcalPerDay,
    negativeLogLikelihood,
    meanNegativeLogLikelihood: negativeLogLikelihood === null
      ? null
      : negativeLogLikelihood / count,
    meanNormalizedInnovationSquared: normalizedSquared === null
      ? null
      : normalizedSquared / count,
    rootMeanSquaredErrorKg: squaredError === null ? null : Math.sqrt(squaredError / count),
    largestStandardizedInnovation: count === 0
      ? null
      : Math.max(...observations.map((observation) => (
        observation.absoluteStandardizedInnovation
      ))),
    minimumObservationWeight: count === 0
      ? null
      : Math.min(...observations.map((observation) => observation.observationWeight)),
    observationLoss: { ...lossConfig },
    invalidDayDate: null,
    missingFields: [],
  };
}

/** Evaluates raw one-step Kalman innovations without fitting or mutation. */
export function evaluatePersonalization(input: CalibrationContext & {
  personalization?: ExpenditurePersonalization;
  observationLoss?: ObservationLossConfig;
}): CalibrationEvaluation {
  const observationLoss = input.observationLoss
    ?? DEFAULT_PERSONALIZATION_CALIBRATION_CONFIG.observationLoss;
  validateObservationLoss(observationLoss);
  return evaluate(
    input,
    input.personalization ?? cloneDefaults(),
    observationLoss,
  );
}

function regularizationPenalty(
  parameters: ExpenditurePersonalization,
  config: PersonalizationCalibrationConfig,
): number {
  return 0.5 * (parameters.personalOffsetKcalPerDay
      / config.personalOffsetPriorScaleKcalPerDay) ** 2
    + 0.5 * ((parameters.activityCalibration - 1)
      / config.activityCalibrationPriorScale) ** 2;
}

function objective(
  context: CalibrationContext,
  parameters: ExpenditurePersonalization,
  config: PersonalizationCalibrationConfig,
  trainingWindow: EvaluationWindow,
): Candidate {
  try {
    const evaluation = evaluate(context, parameters, config.observationLoss, trainingWindow);
    return {
      parameters,
      regularizedLoss: evaluation.negativeLogLikelihood!
        + regularizationPenalty(parameters, config),
      evaluation,
    };
  } catch {
    return {
      parameters,
      regularizedLoss: Number.POSITIVE_INFINITY,
      evaluation: {
        status: "invalid-history",
        observations: [],
        activityKcalPerDay: [],
        negativeLogLikelihood: null,
        meanNegativeLogLikelihood: null,
        meanNormalizedInnovationSquared: null,
        rootMeanSquaredErrorKg: null,
        largestStandardizedInnovation: null,
        minimumObservationWeight: null,
        observationLoss: { ...config.observationLoss },
        invalidDayDate: null,
        missingFields: [],
      },
    };
  }
}

function normalizedDistance(parameters: ExpenditurePersonalization): number {
  return Math.abs(parameters.personalOffsetKcalPerDay) / 500
    + Math.abs(parameters.activityCalibration - 1);
}

function better(candidate: Candidate, current: Candidate | null): boolean {
  if (current === null) return true;
  const tolerance = 1e-12;
  if (candidate.regularizedLoss < current.regularizedLoss - tolerance) return true;
  return Math.abs(candidate.regularizedLoss - current.regularizedLoss) <= tolerance
    && normalizedDistance(candidate.parameters) < normalizedDistance(current.parameters);
}

function optimizeOffset(
  context: CalibrationContext,
  config: PersonalizationCalibrationConfig,
  trainingWindow: EvaluationWindow,
): Candidate {
  const minimum = config.personalOffsetMinKcalPerDay;
  const maximum = config.personalOffsetMaxKcalPerDay;
  const initialStep = (maximum - minimum) / config.gridIntervals;
  let best: Candidate | null = null;
  for (let index = 0; index <= config.gridIntervals; index += 1) {
    const candidate = objective(context, {
      personalOffsetKcalPerDay: minimum + initialStep * index,
      activityCalibration: 1,
    }, config, trainingWindow);
    if (better(candidate, best)) best = candidate;
  }
  let step = initialStep;
  for (let iteration = 0; iteration < config.refinementIterations; iteration += 1) {
    step /= 2;
    for (const direction of [-1, 1]) {
      const offset = Math.min(maximum, Math.max(
        minimum,
        best!.parameters.personalOffsetKcalPerDay + direction * step,
      ));
      const candidate = objective(context, {
        personalOffsetKcalPerDay: offset,
        activityCalibration: 1,
      }, config, trainingWindow);
      if (better(candidate, best)) best = candidate;
    }
  }
  return best!;
}

function optimizeBoth(
  context: CalibrationContext,
  config: PersonalizationCalibrationConfig,
  trainingWindow: EvaluationWindow,
): Candidate {
  const offsetStep = (config.personalOffsetMaxKcalPerDay
      - config.personalOffsetMinKcalPerDay) / config.gridIntervals;
  const activityStep = (config.activityCalibrationMax
      - config.activityCalibrationMin) / config.gridIntervals;
  let best: Candidate | null = null;
  for (let offsetIndex = 0; offsetIndex <= config.gridIntervals; offsetIndex += 1) {
    for (let activityIndex = 0; activityIndex <= config.gridIntervals; activityIndex += 1) {
      const candidate = objective(context, {
        personalOffsetKcalPerDay: config.personalOffsetMinKcalPerDay
          + offsetStep * offsetIndex,
        activityCalibration: config.activityCalibrationMin
          + activityStep * activityIndex,
      }, config, trainingWindow);
      if (better(candidate, best)) best = candidate;
    }
  }
  let localOffsetStep = offsetStep;
  let localActivityStep = activityStep;
  for (let iteration = 0; iteration < config.refinementIterations; iteration += 1) {
    localOffsetStep /= 2;
    localActivityStep /= 2;
    const center = best!.parameters;
    for (const offsetDirection of [-1, 0, 1]) {
      for (const activityDirection of [-1, 0, 1]) {
        const candidate = objective(context, {
          personalOffsetKcalPerDay: Math.min(
            config.personalOffsetMaxKcalPerDay,
            Math.max(
              config.personalOffsetMinKcalPerDay,
              center.personalOffsetKcalPerDay + offsetDirection * localOffsetStep,
            ),
          ),
          activityCalibration: Math.min(
            config.activityCalibrationMax,
            Math.max(
              config.activityCalibrationMin,
              center.activityCalibration + activityDirection * localActivityStep,
            ),
          ),
        }, config, trainingWindow);
        if (better(candidate, best)) best = candidate;
      }
    }
  }
  return best!;
}

function epochDay(date: string): number {
  return Date.parse(`${date}T00:00:00.000Z`) / 86_400_000;
}

function mean(values: readonly number[]): number | null {
  return values.length === 0
    ? null
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function activityStatistics(values: readonly number[]): {
  mean: number | null;
  standardDeviation: number | null;
  coefficientOfVariation: number | null;
} {
  const activityMean = mean(values);
  if (activityMean === null) {
    return { mean: null, standardDeviation: null, coefficientOfVariation: null };
  }
  const variance = values.reduce(
    (sum, value) => sum + (value - activityMean) ** 2,
    0,
  ) / values.length;
  const standardDeviation = Math.sqrt(variance);
  return {
    mean: activityMean,
    standardDeviation,
    coefficientOfVariation: activityMean === 0
      ? null
      : standardDeviation / Math.abs(activityMean),
  };
}

function boundaryParameters(
  parameters: ExpenditurePersonalization,
  config: PersonalizationCalibrationConfig,
): (keyof ExpenditurePersonalization)[] {
  const atBound: (keyof ExpenditurePersonalization)[] = [];
  const offsetTolerance = (config.personalOffsetMaxKcalPerDay
      - config.personalOffsetMinKcalPerDay) * config.parameterBoundToleranceFraction;
  const activityTolerance = (config.activityCalibrationMax
      - config.activityCalibrationMin) * config.parameterBoundToleranceFraction;
  if (parameters.personalOffsetKcalPerDay - config.personalOffsetMinKcalPerDay
      <= offsetTolerance
      || config.personalOffsetMaxKcalPerDay - parameters.personalOffsetKcalPerDay
      <= offsetTolerance) {
    atBound.push("personalOffsetKcalPerDay");
  }
  if (parameters.activityCalibration - config.activityCalibrationMin <= activityTolerance
      || config.activityCalibrationMax - parameters.activityCalibration <= activityTolerance) {
    atBound.push("activityCalibration");
  }
  return atBound;
}

function isWeakRidge(input: {
  context: CalibrationContext;
  candidate: Candidate;
  config: PersonalizationCalibrationConfig;
  trainingWindow: EvaluationWindow;
  activityMean: number;
}): boolean {
  for (const direction of [-1, 1]) {
    const activityCalibration = input.candidate.parameters.activityCalibration
      + direction * input.config.ridgeProbeActivityDelta;
    const personalOffsetKcalPerDay = input.candidate.parameters.personalOffsetKcalPerDay
      - direction * input.config.ridgeProbeActivityDelta * input.activityMean;
    if (activityCalibration < input.config.activityCalibrationMin
        || activityCalibration > input.config.activityCalibrationMax
        || personalOffsetKcalPerDay < input.config.personalOffsetMinKcalPerDay
        || personalOffsetKcalPerDay > input.config.personalOffsetMaxKcalPerDay) {
      continue;
    }
    const alternative = objective(input.context, {
      activityCalibration,
      personalOffsetKcalPerDay,
    }, input.config, input.trainingWindow);
    const optimumMeanRegularizedLoss = input.candidate.regularizedLoss
      / input.candidate.evaluation.observations.length;
    const alternativeMeanRegularizedLoss = alternative.regularizedLoss
      / alternative.evaluation.observations.length;
    if (Number.isFinite(alternativeMeanRegularizedLoss)
        && alternativeMeanRegularizedLoss - optimumMeanRegularizedLoss
          <= input.config.ridgeMaxMeanNllIncrease) {
      return true;
    }
  }
  return false;
}

function validationAccepted(input: {
  defaultEvaluation: CalibrationEvaluation;
  candidateEvaluation: CalibrationEvaluation;
  candidate: Candidate;
  config: PersonalizationCalibrationConfig;
  parameterAtBound: (keyof ExpenditurePersonalization)[];
}): boolean {
  const defaultNis = input.defaultEvaluation.meanNormalizedInnovationSquared;
  const candidateNis = input.candidateEvaluation.meanNormalizedInnovationSquared;
  if (defaultNis === null || candidateNis === null || input.parameterAtBound.length > 0) {
    return false;
  }
  const requiredImprovement = Math.max(
    input.config.minimumValidationNisImprovementAbsolute,
    defaultNis * input.config.minimumValidationNisImprovementFraction,
  );
  return defaultNis - candidateNis >= requiredImprovement
    && input.candidate.regularizedLoss < Number.POSITIVE_INFINITY;
}

function makeDiagnostics(input: {
  historyDays: number;
  completeDayCount: number;
  observationCount: number;
  observationSpanDays: number;
  trainingObservationCount: number;
  validationObservationCount: number;
  activity: ReturnType<typeof activityStatistics>;
  defaultTraining: CalibrationEvaluation | null;
  candidateTraining: CalibrationEvaluation | null;
  regularizedTrainingLoss: number | null;
  defaultValidation: CalibrationEvaluation | null;
  candidateValidation: CalibrationEvaluation | null;
  observationLoss: ObservationLossConfig;
  parameterAtBound: (keyof ExpenditurePersonalization)[];
  identifiability: CalibrationDiagnostics["twoParameterIdentifiability"];
  accepted: boolean;
  invalidDayDate?: string | null;
  missingFields?: string[];
  warnings: CalibrationWarning[];
}): CalibrationDiagnostics {
  const diagnosticEvaluations = [input.candidateTraining, input.candidateValidation]
    .filter((evaluation): evaluation is CalibrationEvaluation => evaluation !== null);
  const largestInnovations = diagnosticEvaluations
    .map((evaluation) => evaluation.largestStandardizedInnovation)
    .filter((value): value is number => value !== null);
  const minimumWeights = diagnosticEvaluations
    .map((evaluation) => evaluation.minimumObservationWeight)
    .filter((value): value is number => value !== null);
  return {
    historyDays: input.historyDays,
    completeDayCount: input.completeDayCount,
    observationCount: input.observationCount,
    observationSpanDays: input.observationSpanDays,
    trainingObservationCount: input.trainingObservationCount,
    validationObservationCount: input.validationObservationCount,
    activityMeanKcalPerDay: input.activity.mean,
    activityStandardDeviationKcalPerDay: input.activity.standardDeviation,
    activityCoefficientOfVariation: input.activity.coefficientOfVariation,
    defaultTrainingLoss: input.defaultTraining?.meanNegativeLogLikelihood ?? null,
    trainingLoss: input.candidateTraining?.meanNegativeLogLikelihood ?? null,
    regularizedTrainingLoss: input.regularizedTrainingLoss,
    defaultValidationLoss: input.defaultValidation?.meanNegativeLogLikelihood ?? null,
    validationLoss: input.candidateValidation?.meanNegativeLogLikelihood ?? null,
    defaultValidationNis: input.defaultValidation?.meanNormalizedInnovationSquared ?? null,
    validationNis: input.candidateValidation?.meanNormalizedInnovationSquared ?? null,
    observationLossType: input.observationLoss.type,
    studentTDegreesOfFreedom: input.observationLoss.type === "student-t"
      ? input.observationLoss.degreesOfFreedom
      : null,
    largestStandardizedInnovation: largestInnovations.length === 0
      ? null
      : Math.max(...largestInnovations),
    minimumObservationWeight: minimumWeights.length === 0
      ? null
      : Math.min(...minimumWeights),
    parameterAtBound: input.parameterAtBound,
    twoParameterIdentifiability: input.identifiability,
    personalizationAccepted: input.accepted,
    invalidDayDate: input.invalidDayDate ?? null,
    missingFields: input.missingFields ?? [],
    warnings: [...new Set(input.warnings)],
  };
}

/**
 * Conservatively fits at most an effective expenditure offset and one global
 * net-Activity multiplier. The optimizer is bounded, deterministic, and pure.
 */
export function calibratePersonalization(input: CalibrationContext & {
  config?: PersonalizationCalibrationConfig;
}): PersonalizationCalibrationResult {
  const config = input.config ?? createPersonalizationCalibrationConfig();
  validateConfig(config);
  const defaults = cloneDefaults();
  const fullDefaultEvaluation = evaluate(input, defaults, config.observationLoss);
  const observationCount = fullDefaultEvaluation.observations.length;
  const observationSpanDays = observationCount < 2
    ? observationCount
    : epochDay(fullDefaultEvaluation.observations.at(-1)!.date)
      - epochDay(fullDefaultEvaluation.observations[0].date) + 1;
  const emptyActivity = activityStatistics([]);
  if (fullDefaultEvaluation.status === "invalid-history") {
    return {
      status: "invalid-history",
      parameters: defaults,
      loss: null,
      diagnostics: makeDiagnostics({
        historyDays: input.history.length,
        completeDayCount: fullDefaultEvaluation.activityKcalPerDay.length,
        observationCount,
        observationSpanDays,
        trainingObservationCount: 0,
        validationObservationCount: 0,
        activity: activityStatistics(fullDefaultEvaluation.activityKcalPerDay),
        defaultTraining: null,
        candidateTraining: null,
        regularizedTrainingLoss: null,
        defaultValidation: null,
        candidateValidation: null,
        observationLoss: config.observationLoss,
        parameterAtBound: [],
        identifiability: "not-evaluated",
        accepted: false,
        invalidDayDate: fullDefaultEvaluation.invalidDayDate,
        missingFields: fullDefaultEvaluation.missingFields,
        warnings: ["incomplete-simulation-day"],
      }),
    };
  }
  if (observationCount < config.minOffsetObservationCount
      || observationSpanDays < config.minOffsetObservationSpanDays) {
    return {
      status: "insufficient-history",
      parameters: defaults,
      loss: fullDefaultEvaluation.meanNegativeLogLikelihood,
      diagnostics: makeDiagnostics({
        historyDays: input.history.length,
        completeDayCount: input.history.length,
        observationCount,
        observationSpanDays,
        trainingObservationCount: observationCount,
        validationObservationCount: 0,
        activity: emptyActivity,
        defaultTraining: fullDefaultEvaluation,
        candidateTraining: fullDefaultEvaluation,
        regularizedTrainingLoss: fullDefaultEvaluation.negativeLogLikelihood,
        defaultValidation: null,
        candidateValidation: null,
        observationLoss: config.observationLoss,
        parameterAtBound: [],
        identifiability: "not-evaluated",
        accepted: false,
        warnings: [],
      }),
    };
  }

  const requestedValidationCount = Math.max(
    config.minValidationObservationCount,
    Math.ceil(observationCount * config.validationFraction),
  );
  const validationCount = Math.min(observationCount - 1, requestedValidationCount);
  const validationStartObservation = fullDefaultEvaluation.observations[
    observationCount - validationCount
  ];
  const trainingWindow = { startDayIndex: 0, endDayIndex: validationStartObservation.dayIndex };
  const validationWindow = {
    startDayIndex: validationStartObservation.dayIndex,
    endDayIndex: input.history.length,
  };
  const defaultTraining = evaluate(input, defaults, config.observationLoss, trainingWindow);
  const defaultValidation = evaluate(input, defaults, config.observationLoss, validationWindow);
  const activity = activityStatistics(defaultTraining.activityKcalPerDay);
  const hasFullHistory = observationCount >= config.minFullObservationCount
    && observationSpanDays >= config.minFullObservationSpanDays;
  const hasActivityVariation = activity.standardDeviation !== null
    && activity.coefficientOfVariation !== null
    && activity.standardDeviation >= config.minActivityStandardDeviationKcalPerDay
    && activity.coefficientOfVariation >= config.minActivityCoefficientOfVariation;
  const warnings: CalibrationWarning[] = [];
  let attemptedFullAtBound: (keyof ExpenditurePersonalization)[] = [];
  let identifiability: CalibrationDiagnostics["twoParameterIdentifiability"] = "not-evaluated";

  if (hasFullHistory && hasActivityVariation) {
    const fullCandidate = optimizeBoth(input, config, trainingWindow);
    const fullValidation = evaluate(
      input,
      fullCandidate.parameters,
      config.observationLoss,
      validationWindow,
    );
    const fullAtBound = boundaryParameters(fullCandidate.parameters, config);
    attemptedFullAtBound = fullAtBound;
    const weakRidge = isWeakRidge({
      context: input,
      candidate: fullCandidate,
      config,
      trainingWindow,
      activityMean: activity.mean!,
    });
    identifiability = weakRidge ? "weak" : "adequate";
    if (weakRidge) warnings.push("weak-two-parameter-identifiability");
    if (fullAtBound.length > 0) warnings.push("parameter-at-bound");
    const accepted = !weakRidge && validationAccepted({
      defaultEvaluation: defaultValidation,
      candidateEvaluation: fullValidation,
      candidate: fullCandidate,
      config,
      parameterAtBound: fullAtBound,
    });
    if (accepted) {
      return {
        status: "fully-calibrated",
        parameters: { ...fullCandidate.parameters },
        loss: fullCandidate.regularizedLoss,
        diagnostics: makeDiagnostics({
          historyDays: input.history.length,
          completeDayCount: input.history.length,
          observationCount,
          observationSpanDays,
          trainingObservationCount: defaultTraining.observations.length,
          validationObservationCount: defaultValidation.observations.length,
          activity,
          defaultTraining,
          candidateTraining: fullCandidate.evaluation,
          regularizedTrainingLoss: fullCandidate.regularizedLoss,
          defaultValidation,
          candidateValidation: fullValidation,
          observationLoss: config.observationLoss,
          parameterAtBound: fullAtBound,
          identifiability,
          accepted: true,
          warnings,
        }),
      };
    }
  } else if (hasFullHistory) {
    identifiability = "insufficient-variation";
    warnings.push("insufficient-activity-variation");
  }

  const offsetCandidate = optimizeOffset(input, config, trainingWindow);
  const offsetValidation = evaluate(
    input,
    offsetCandidate.parameters,
    config.observationLoss,
    validationWindow,
  );
  const offsetAtBound = boundaryParameters(offsetCandidate.parameters, config)
    .filter((parameter) => parameter === "personalOffsetKcalPerDay");
  const reportedAtBound = [...new Set([...attemptedFullAtBound, ...offsetAtBound])];
  if (offsetAtBound.length > 0) warnings.push("parameter-at-bound");
  const offsetAccepted = validationAccepted({
    defaultEvaluation: defaultValidation,
    candidateEvaluation: offsetValidation,
    candidate: offsetCandidate,
    config,
    parameterAtBound: offsetAtBound,
  });
  if (!offsetAccepted) warnings.push("validation-improvement-too-small");
  return {
    status: offsetAccepted ? "offset-only" : "defaults-retained",
    parameters: offsetAccepted ? { ...offsetCandidate.parameters } : defaults,
    loss: offsetAccepted
      ? offsetCandidate.regularizedLoss
      : defaultTraining.negativeLogLikelihood,
    diagnostics: makeDiagnostics({
      historyDays: input.history.length,
      completeDayCount: input.history.length,
      observationCount,
      observationSpanDays,
      trainingObservationCount: defaultTraining.observations.length,
      validationObservationCount: defaultValidation.observations.length,
      activity,
      defaultTraining,
      candidateTraining: offsetAccepted ? offsetCandidate.evaluation : defaultTraining,
      regularizedTrainingLoss: offsetAccepted
        ? offsetCandidate.regularizedLoss
        : defaultTraining.negativeLogLikelihood,
      defaultValidation,
      candidateValidation: offsetAccepted ? offsetValidation : defaultValidation,
      observationLoss: config.observationLoss,
      parameterAtBound: reportedAtBound,
      identifiability,
      accepted: offsetAccepted,
      warnings,
    }),
  };
}
