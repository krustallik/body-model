import { calculateTef } from "@/model/tef";
import { stepGlycogenOneDay, type GlycogenParameters } from "@/model/body-composition/glycogen";
import type { NutritionVector } from "./model-episode.types";

export const INITIALIZATION_REGIME_POLICY = {
  nutritionRelativeChange: 0.15,
  nutritionAbsoluteChangeKcalPerDay: 150,
  activityRelativeChange: 0.2,
  activityAbsoluteChangeKcalPerDay: 75,
  carbRelativeChange: 0.2,
  carbAbsoluteChangeGPerDay: 40,
  persistentWaterStepKg: 0.75,
  persistentWaterMinimumDays: 3,
  persistentWaterMinimumDailyResidualChangeKg: 0.4,
} as const;

export const INITIALIZATION_SENSITIVITY_POLICY = {
  offsetStrongSpreadKcalPerDay: 25,
  offsetMaximumSpreadKcalPerDay: 50,
  glycogenAssociatedMassToleranceKg: 0.05,
  atStrongMaximumRemainingInfluence: 0.15,
} as const;

export type InitializationOffsetScenario = {
  id: string;
  offsetKcalPerDay: number | null;
};

/** Explicit BodyCast engineering gate; it makes uncertainty auditable. */
export function summarizeOffsetSensitivity(
  baseOffsetKcalPerDay: number,
  alternatives: readonly InitializationOffsetScenario[],
): {
  minKcalPerDay: number;
  maxKcalPerDay: number;
  spreadKcalPerDay: number;
  minScenarioIds: string[];
  maxScenarioIds: string[];
  confidenceCap: "strong" | "weak" | "insufficient";
  complete: boolean;
} {
  const finite = alternatives.flatMap((scenario) => scenario.offsetKcalPerDay !== null
    && Number.isFinite(scenario.offsetKcalPerDay)
    ? [{ ...scenario, offsetKcalPerDay: scenario.offsetKcalPerDay }]
    : []);
  const complete = finite.length === alternatives.length;
  const all = [{ id: "base", offsetKcalPerDay: baseOffsetKcalPerDay }, ...finite] as const;
  const minKcalPerDay = Math.min(...all.map(({ offsetKcalPerDay }) => offsetKcalPerDay));
  const maxKcalPerDay = Math.max(...all.map(({ offsetKcalPerDay }) => offsetKcalPerDay));
  const spreadKcalPerDay = maxKcalPerDay - minKcalPerDay;
  const extrema = (value: number) => all.filter((scenario) => scenario.offsetKcalPerDay === value)
    .map(({ id }) => id);
  return {
    minKcalPerDay,
    maxKcalPerDay,
    spreadKcalPerDay,
    minScenarioIds: extrema(minKcalPerDay),
    maxScenarioIds: extrema(maxKcalPerDay),
    confidenceCap: !complete || spreadKcalPerDay > INITIALIZATION_SENSITIVITY_POLICY.offsetMaximumSpreadKcalPerDay
      ? "insufficient"
      : spreadKcalPerDay > INITIALIZATION_SENSITIVITY_POLICY.offsetStrongSpreadKcalPerDay ? "weak" : "strong",
    complete,
  };
}

/**
 * BodyCast v5 model adaptation. It is not a Hall equation: it constructs the
 * internally neutral intake of the existing RMR + net Activity + macro TEF
 * expenditure model for a candidate absolute personalization offset.
 */
export function deriveEnergyHomeostasisReference(input: {
  rmrKcalPerDay: number;
  referenceActivityKcalPerDay: number;
  personalOffsetKcalPerDay: number;
  observedReferenceNutrition: NutritionVector;
}): { energyKcalPerDay: number; tefFraction: number; referenceNutrition: NutritionVector } {
  const values = [input.rmrKcalPerDay, input.referenceActivityKcalPerDay,
    input.personalOffsetKcalPerDay, input.observedReferenceNutrition.caloriesKcal];
  if (values.some((value) => !Number.isFinite(value))) throw new TypeError("reference inputs must be finite");
  if (input.rmrKcalPerDay <= 0 || input.referenceActivityKcalPerDay < 0
      || input.observedReferenceNutrition.caloriesKcal <= 0) {
    throw new RangeError("reference RMR, Activity, and calories are outside the supported range");
  }
  const observedTef = calculateTef(input.observedReferenceNutrition);
  if (observedTef === null) throw new RangeError("complete reference macros are required");
  const tefFraction = observedTef / input.observedReferenceNutrition.caloriesKcal;
  if (!(tefFraction >= 0 && tefFraction < 1)) {
    throw new RangeError("reference macro TEF fraction must be in [0, 1)");
  }
  const energyKcalPerDay = (input.rmrKcalPerDay + input.referenceActivityKcalPerDay
    + input.personalOffsetKcalPerDay) / (1 - tefFraction);
  if (!Number.isFinite(energyKcalPerDay) || energyKcalPerDay <= 0) {
    throw new RangeError("energy-homeostasis reference must be positive and finite");
  }
  const scale = energyKcalPerDay / input.observedReferenceNutrition.caloriesKcal;
  return {
    energyKcalPerDay,
    tefFraction,
    referenceNutrition: {
      caloriesKcal: energyKcalPerDay,
      proteinG: input.observedReferenceNutrition.proteinG * scale,
      fatG: input.observedReferenceNutrition.fatG * scale,
      carbsG: input.observedReferenceNutrition.carbsG * scale,
    },
  };
}

/** Replays the existing nonlinear equation; no separate glycogen physics exists here. */
export function glycogenInitialStateInfluence(input: {
  parameters: GlycogenParameters;
  carbsG: readonly number[];
  lowInitialGlycogenKg?: number;
  highInitialGlycogenKg?: number;
}): { associatedMassDifferenceKg: number; converged: boolean } {
  let low = input.lowInitialGlycogenKg ?? 0.2;
  let high = input.highInitialGlycogenKg ?? 0.8;
  for (const carbsG of input.carbsG) {
    low = stepGlycogenOneDay({ currentGlycogenKg: low, carbIntakeG: carbsG,
      parameters: input.parameters })!.glycogenKg;
    high = stepGlycogenOneDay({ currentGlycogenKg: high, carbIntakeG: carbsG,
      parameters: input.parameters })!.glycogenKg;
  }
  const associatedMassDifferenceKg = Math.abs(high - low) * 3.7;
  return {
    associatedMassDifferenceKg,
    converged: associatedMassDifferenceKg
      < INITIALIZATION_SENSITIVITY_POLICY.glycogenAssociatedMassToleranceKg,
  };
}

export function remainingAdaptiveThermogenesisInfluence(
  preRollDays: number,
  timeConstantDays: number,
): number {
  if (!Number.isFinite(preRollDays) || preRollDays < 0
      || !Number.isFinite(timeConstantDays) || timeConstantDays <= 0) {
    throw new RangeError("AT pre-roll and time constant must be finite and valid");
  }
  return Math.exp(-preRollDays / timeConstantDays);
}

function med(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function meaningfulChange(before: number | null, after: number | null, relative: number, absolute: number): boolean {
  return before !== null && after !== null
    && Math.abs(after - before) >= Math.max(absolute, Math.abs(before) * relative);
}

export function detectInitializationRegimeChange(input: {
  beforeNutritionKcal: readonly number[];
  afterNutritionKcal: readonly number[];
  beforeActivityKcal: readonly number[];
  afterActivityKcal: readonly number[];
  beforeCarbsG: readonly number[];
  afterCarbsG: readonly number[];
}) {
  const beforeNutrition = med(input.beforeNutritionKcal);
  const afterNutrition = med(input.afterNutritionKcal);
  const beforeActivity = med(input.beforeActivityKcal);
  const afterActivity = med(input.afterActivityKcal);
  const beforeCarbs = med(input.beforeCarbsG);
  const afterCarbs = med(input.afterCarbsG);
  const nutritionChanged = meaningfulChange(beforeNutrition, afterNutrition,
    INITIALIZATION_REGIME_POLICY.nutritionRelativeChange,
    INITIALIZATION_REGIME_POLICY.nutritionAbsoluteChangeKcalPerDay);
  const activityChanged = meaningfulChange(beforeActivity, afterActivity,
    INITIALIZATION_REGIME_POLICY.activityRelativeChange,
    INITIALIZATION_REGIME_POLICY.activityAbsoluteChangeKcalPerDay);
  const carbChanged = meaningfulChange(beforeCarbs, afterCarbs,
    INITIALIZATION_REGIME_POLICY.carbRelativeChange,
    INITIALIZATION_REGIME_POLICY.carbAbsoluteChangeGPerDay);
  return {
    classification: nutritionChanged && activityChanged ? "simultaneous"
      : nutritionChanged ? "nutrition-only" : activityChanged ? "activity-only"
        : carbChanged ? "carb-only" : "none",
    nutritionChanged, activityChanged, carbChanged,
    before: { nutritionKcal: beforeNutrition, activityKcal: beforeActivity, carbsG: beforeCarbs },
    after: { nutritionKcal: afterNutrition, activityKcal: afterActivity, carbsG: afterCarbs },
  } as const;
}

export function detectInternalRegimeChange(input: {
  nutritionKcal: readonly number[];
  activityKcal: readonly number[];
  carbsG: readonly number[];
  minimumSegmentDays?: number;
}): { detected: boolean; splitIndex: number | null; classification: string; preChangeDays: number; postChangeDays: number } {
  const minimum = input.minimumSegmentDays ?? 7;
  const length = Math.min(input.nutritionKcal.length, input.activityKcal.length, input.carbsG.length);
  let best: ReturnType<typeof detectInitializationRegimeChange> & { splitIndex: number; score: number } | null = null;
  for (let splitIndex = minimum; splitIndex <= length - minimum; splitIndex += 1) {
    const change = detectInitializationRegimeChange({
      beforeNutritionKcal: input.nutritionKcal.slice(0, splitIndex),
      afterNutritionKcal: input.nutritionKcal.slice(splitIndex, length),
      beforeActivityKcal: input.activityKcal.slice(0, splitIndex),
      afterActivityKcal: input.activityKcal.slice(splitIndex, length),
      beforeCarbsG: input.carbsG.slice(0, splitIndex),
      afterCarbsG: input.carbsG.slice(splitIndex, length),
    });
    if (change.classification === "none") continue;
    const score = Math.abs((change.after.nutritionKcal ?? 0) - (change.before.nutritionKcal ?? 0)) / 150
      + Math.abs((change.after.activityKcal ?? 0) - (change.before.activityKcal ?? 0)) / 75
      + Math.abs((change.after.carbsG ?? 0) - (change.before.carbsG ?? 0)) / 40;
    if (!best || score > best.score) best = { ...change, splitIndex, score };
  }
  return best ? { detected: true, splitIndex: best.splitIndex, classification: best.classification,
    preChangeDays: best.splitIndex, postChangeDays: length - best.splitIndex }
    : { detected: false, splitIndex: null, classification: "none", preChangeDays: 0, postChangeDays: 0 };
}

/** A persistent unexplained scale shift is evidence against strong offset inference. */
export function detectPersistentWaterDisturbance(input: {
  measuredWeightKg: readonly (number | null | undefined)[];
  predictedWeightKg: readonly (number | null | undefined)[];
}): { detected: boolean; maximumCoherentResidualKg: number; coherentDays: number; maximumDailyResidualChangeKg: number } {
  const residuals = input.measuredWeightKg.map((weight, index) => (
    weight !== null && weight !== undefined && input.predictedWeightKg[index] !== null
      && input.predictedWeightKg[index] !== undefined ? weight - input.predictedWeightKg[index]!
      : null
  ));
  let bestDays = 0; let bestMagnitude = 0; let run = 0; let sign = 0;
  let maximumDailyResidualChangeKg = 0;
  for (const residual of residuals) {
    const currentSign = residual === null || Math.abs(residual) < INITIALIZATION_REGIME_POLICY.persistentWaterStepKg
      ? 0 : Math.sign(residual);
    run = currentSign !== 0 && currentSign === sign ? run + 1 : currentSign === 0 ? 0 : 1;
    sign = currentSign;
    if (run >= bestDays && residual !== null) { bestDays = run; bestMagnitude = Math.max(bestMagnitude, Math.abs(residual)); }
  }
  for (let split = 3; split <= residuals.length - 3; split += 1) {
    const before = med(residuals.slice(split - 3, split).filter((value): value is number => value !== null));
    const after = med(residuals.slice(split, split + 3).filter((value): value is number => value !== null));
    if (before !== null && after !== null) {
      maximumDailyResidualChangeKg = Math.max(maximumDailyResidualChangeKg, Math.abs(after - before));
    }
  }
  return { detected: bestDays >= INITIALIZATION_REGIME_POLICY.persistentWaterMinimumDays
      && maximumDailyResidualChangeKg
        >= INITIALIZATION_REGIME_POLICY.persistentWaterMinimumDailyResidualChangeKg,
    maximumCoherentResidualKg: bestMagnitude, coherentDays: bestDays,
    maximumDailyResidualChangeKg };
}
