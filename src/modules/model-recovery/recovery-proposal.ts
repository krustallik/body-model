import { missingPhysiologicalTransitionFields, type PhysiologicalDailyInput } from "@/model/physiological-simulator";
import type { BuiltSimulationDay } from "@/modules/model-episodes/model-episode.types";
import { SeededRandom } from "./recovery-math";
import {
  samplePriorRecoveryRegime,
  type RecoveryTrajectoryRegime,
} from "./recovery-regime-proposal";
import type { RecoveryConfig } from "./recovery.types";

export type { RecoveryTrajectoryRegime } from "./recovery-regime-proposal";

export function sampleRecoveryTrajectoryRegime(
  random: SeededRandom,
  config: RecoveryConfig,
): RecoveryTrajectoryRegime {
  return samplePriorRecoveryRegime(random, config);
}

const DAY_MS = 86_400_000;
const NUTRITION_FIELDS = ["caloriesKcal", "proteinG", "fatG", "carbsG"] as const;

function epochDay(date: string): number {
  return Date.parse(`${date}T00:00:00.000Z`) / DAY_MS;
}

function weekday(date: string): number {
  return new Date(`${date}T00:00:00.000Z`).getUTCDay();
}

function present(value: number | null | undefined): value is number {
  return value !== null && value !== undefined;
}

function cloneDay(day: PhysiologicalDailyInput): PhysiologicalDailyInput {
  return {
    ...day,
    occupationalActivity: {
      ...day.occupationalActivity,
      intervals: day.occupationalActivity.intervals?.map((interval) => ({ ...interval })),
    },
  };
}

function median(values: readonly number[]): number {
  if (values.length === 0) throw new Error("A recovery empirical median requires observations.");
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

export function observedRecoveryDonors(input: {
  days: readonly BuiltSimulationDay[];
  ecfPolicy: Parameters<typeof missingPhysiologicalTransitionFields>[1];
}): BuiltSimulationDay[] {
  return input.days.filter((day) => (
    missingPhysiologicalTransitionFields(day.input, input.ecfPolicy).length === 0
      && day.sourceQuality.sourceObservationFields.length > 0
      && day.sourceQuality.nutrition.dependency === "observed"
  ));
}

export function sampleRecoveryDay(input: {
  target: PhysiologicalDailyInput;
  donors: readonly BuiltSimulationDay[];
  random: SeededRandom;
  config: RecoveryConfig;
  regime?: RecoveryTrajectoryRegime;
}): PhysiologicalDailyInput {
  if (input.donors.length === 0) {
    throw new Error("No complete observed donor day is available.");
  }
  const targetEpochDay = epochDay(input.target.date);
  const targetWeekday = weekday(input.target.date);
  const donorWeights = input.donors.map((donor) => {
    const ageDays = Math.max(0, targetEpochDay - epochDay(donor.input.date));
    const recency = 2 ** (-ageDays / input.config.donorRecencyHalfLifeDays);
    return recency * (weekday(donor.input.date) === targetWeekday
      ? input.config.sameWeekdayMultiplier
      : 1);
  });
  const donor = input.donors[input.random.weightedIndex(donorWeights)].input;
  const regime = input.regime ?? sampleRecoveryTrajectoryRegime(input.random, input.config);
  const result = cloneDay(input.target);
  const walkingWasMissing = !present(result.outsideWorkWalkingDistanceKm);
  const strengthWasMissing = !present(result.strengthTrainingMinutes);
  const occupationWasCompletelyMissing = result.occupationalActivity.intervals === undefined
    && !present(result.occupationalActivity.durationHours);

  const observedRatios = NUTRITION_FIELDS.flatMap((field) => {
    const observed = result[field];
    const donorValue = donor[field];
    return present(observed) && present(donorValue) && donorValue > 0
      ? [observed / donorValue]
      : [];
  });
  const donorCalories = input.donors
    .map((day) => day.input.caloriesKcal)
    .filter(present)
    .filter((value) => value > 0);
  const calorieMedian = median(donorCalories);
  const logAbsoluteDeviations = donorCalories.map((value) => (
    Math.abs(Math.log(value / calorieMedian))
  ));
  const robustLogSpread = 1.4826 * median(logAbsoluteDeviations);
  const nutritionSpread = Math.min(
    input.config.nutritionLogStandardDeviationCeiling,
    Math.max(input.config.nutritionLogStandardDeviationFloor, robustLogSpread),
  ) * input.config.vacationSpreadMultiplier;
  const nutritionCenter = observedRatios.length > 0 ? median(observedRatios) : 1;
  const nutritionFactor = nutritionCenter * regime.nutritionMultiplier
    * input.random.logNormal(0, nutritionSpread);
  if (!present(result.caloriesKcal) && present(donor.caloriesKcal)) {
    result.caloriesKcal = donor.caloriesKcal * nutritionFactor;
  }
  const macroFields = ["proteinG", "fatG", "carbsG"] as const;
  const compositionShocks = macroFields.map(() => (
    input.config.macroCompositionLogStandardDeviation * input.random.normal()
  ));
  const meanCompositionShock = compositionShocks.reduce((sum, value) => sum + value, 0)
    / compositionShocks.length;
  for (const [index, field] of macroFields.entries()) {
    if (!present(result[field]) && present(donor[field])) {
      result[field] = donor[field] * nutritionFactor
        * Math.exp(compositionShocks[index] - meanCompositionShock)
        * regime.macroCompositionMultipliers[index];
    }
  }

  if (walkingWasMissing
      && present(donor.outsideWorkWalkingDistanceKm)) {
    result.outsideWorkWalkingDistanceKm = donor.outsideWorkWalkingDistanceKm
      * input.random.logNormal(0, input.config.walkingLogStandardDeviation);
    if (regime.useActivityExploration) {
      const positiveWalking = input.donors
        .map((day) => day.input.outsideWorkWalkingDistanceKm)
        .filter(present)
        .filter((value) => value > 0);
      const empiricalReference = positiveWalking.length > 0 ? median(positiveWalking) : 0;
      const reference = Math.max(empiricalReference, input.config.minimumWalkingReferenceKm);
      result.outsideWorkWalkingDistanceKm = reference * input.random.logNormal(
        0,
        input.config.activityExplorationLogStandardDeviation,
      );
    }
    result.outsideWorkWalkingDistanceKm *= regime.walkingMultiplier;
  }
  if (!present(result.averageWalkingSpeedKmh)) {
    result.averageWalkingSpeedKmh = donor.averageWalkingSpeedKmh;
  }
  if (strengthWasMissing) {
    result.strengthTrainingMinutes = donor.strengthTrainingMinutes;
    if (regime.forceNoStrengthTraining) {
      result.strengthTrainingMinutes = 0;
    } else if (regime.useStrengthExploration) {
      result.strengthTrainingMinutes = input.config.strengthExplorationMedianMinutes
        * input.random.logNormal(0, input.config.strengthExplorationLogStandardDeviation);
    }
  }

  if (result.occupationalActivity.intervals === undefined) {
    result.occupationalActivity = occupationWasCompletelyMissing
      ? {
          ...donor.occupationalActivity,
          intervals: donor.occupationalActivity.intervals?.map((interval) => ({ ...interval })),
        }
      : {
          ...result.occupationalActivity,
          category: result.occupationalActivity.category ?? donor.occupationalActivity.category,
          durationHours: result.occupationalActivity.durationHours
            ?? donor.occupationalActivity.durationHours,
        };
  } else {
    const donorIntervals = donor.occupationalActivity.intervals ?? [];
    result.occupationalActivity.intervals = result.occupationalActivity.intervals.map((interval, index) => {
      const fallback = donorIntervals[index % Math.max(1, donorIntervals.length)];
      return {
        ...interval,
        category: interval.category ?? fallback?.category ?? donor.occupationalActivity.category,
        durationHours: interval.durationHours
          ?? fallback?.durationHours
          ?? donor.occupationalActivity.durationHours,
        breakDurationHours: interval.breakDurationHours ?? fallback?.breakDurationHours,
        workWalkingDistanceKm: interval.workWalkingDistanceKm ?? fallback?.workWalkingDistanceKm,
        averageWalkingSpeedKmh: interval.averageWalkingSpeedKmh ?? fallback?.averageWalkingSpeedKmh,
      };
    });
  }
  if (occupationWasCompletelyMissing
      && regime.forceNoOccupationalWork) {
    result.occupationalActivity = { category: null, durationHours: 0, intervals: [] };
  }
  result.measuredWeightKg = null;
  return result;
}
