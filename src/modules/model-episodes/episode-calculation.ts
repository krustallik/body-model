import {
  calibratePersonalization,
  type CalibrationDay,
  type PersonalizationCalibrationResult,
} from "@/model/personalization-calibration";
import { simulateDays } from "@/model/physiological-simulator";
import type {
  BuiltSimulationDay,
  DailyModelStateWrite,
  PersistedEpisode,
} from "./model-episode.types";
import { analyzeStateContinuity } from "./unknown-intervals";

export type EpisodeCalculation = {
  calibration: PersonalizationCalibrationResult;
  calibrationNutritionDiagnostics: {
    observedNutritionDays: number;
    imputedNutritionDays: number;
    missingNutritionDays: number;
    calibrationEligibleObservedDays: number;
    calibrationExcludedDependentDays: number;
    firstImputedNutritionDate: string | null;
  };
  dailyStates: DailyModelStateWrite[];
  latestModeledDate: string | null;
  unknownIntervals: import("./model-episode.types").UnknownIntervalWrite[];
  continuityStatus: "resolved" | "awaiting-recovery";
};

function calibrationHistory(days: readonly BuiltSimulationDay[]): CalibrationDay[] {
  return days.map(({ input }) => ({
    date: input.date,
    measuredWeightKg: input.measuredWeightKg ?? null,
    simulatorInput: {
      caloriesKcal: input.caloriesKcal,
      proteinG: input.proteinG,
      fatG: input.fatG,
      carbsG: input.carbsG,
      outsideWorkWalkingDistanceKm: input.outsideWorkWalkingDistanceKm,
      averageWalkingSpeedKmh: input.averageWalkingSpeedKmh,
      strengthTrainingMinutes: input.strengthTrainingMinutes,
      occupationalActivity: {
        ...input.occupationalActivity,
        intervals: input.occupationalActivity.intervals?.map((interval) => ({ ...interval })),
      },
      sodiumChangeMgPerDay: input.sodiumChangeMgPerDay,
    },
  }));
}

/** Runs robust calibration, then one coherent retrospective personalized pass. */
export function calculateEpisodeHistory(input: {
  episode: PersistedEpisode;
  days: readonly BuiltSimulationDay[];
}): EpisodeCalculation {
  const continuity = analyzeStateContinuity(input.days, input.episode.ecfPolicy);
  const firstDependentIndex = continuity.resolvedDays.findIndex(({ sourceQuality }) => (
    sourceQuality.nutrition.source !== "observed"
    || sourceQuality.nutrition.dependency !== "observed"
  ));
  const calibrationEligibleDays = firstDependentIndex === -1
    ? continuity.resolvedDays
    : continuity.resolvedDays.slice(0, firstDependentIndex);
  const calibration = calibratePersonalization({
    initialState: input.episode.initialState,
    simulatorParameters: input.episode.simulatorParameters,
    history: calibrationHistory(calibrationEligibleDays),
    ecfPolicy: input.episode.ecfPolicy,
  });
  const results = simulateDays({
    initialState: input.episode.initialState,
    parameters: input.episode.simulatorParameters,
    days: continuity.resolvedDays.map(({ input: day }) => day),
    options: { ecfPolicy: input.episode.ecfPolicy },
    personalization: calibration.parameters,
  });
  const dailyStates = results.map((result, index): DailyModelStateWrite => {
    const sourceQuality = { ...continuity.resolvedDays[index].sourceQuality,
      issues: [...continuity.resolvedDays[index].sourceQuality.issues],
      sourceObservationFields: [
        ...continuity.resolvedDays[index].sourceQuality.sourceObservationFields,
      ],
      nutrition: {
        ...continuity.resolvedDays[index].sourceQuality.nutrition,
        referenceDates: [...continuity.resolvedDays[index].sourceQuality.nutrition.referenceDates],
        observedFields: [...continuity.resolvedDays[index].sourceQuality.nutrition.observedFields],
        imputedFields: [...continuity.resolvedDays[index].sourceQuality.nutrition.imputedFields],
        referenceMacroMadG: continuity.resolvedDays[index].sourceQuality.nutrition.referenceMacroMadG
          ? { ...continuity.resolvedDays[index].sourceQuality.nutrition.referenceMacroMadG }
          : null,
      },
    };
    const nutrition = sourceQuality.nutrition;
    if (result.status !== "complete") {
      throw new Error(`resolved-prefix invariant violated on ${result.date}`);
    }
    return {
      date: result.date,
      status: result.status,
      dataQuality: nutrition.dependency === "observed" ? "observed" : "estimated",
      nutrition,
      sourceQuality,
      missingFields: [],
      modelVersion: input.episode.modelVersion,
      startWeightKg: result.calculations.startWeightKg,
      endWeightKg: result.calculations.endWeightKg,
      fatMassKg: result.endState.fatMassKg,
      leanTissueKg: result.endState.leanTissueKg,
      glycogenKg: result.endState.glycogenKg,
      extracellularFluidDeviationLiters:
        result.endState.extracellularFluidDeviationLiters,
      dynamicRmrKcalPerDay:
        result.calculations.expenditure.dynamicRmrKcalPerDay,
      tefKcalPerDay: result.calculations.expenditure.tefKcalPerDay,
      activityKcalPerDay: result.calculations.expenditure.calibratedActivityKcalPerDay,
      adaptiveThermogenesisKcalPerDay:
        result.endState.adaptiveThermogenesisKcalPerDay,
      energyIntakeKcal: continuity.resolvedDays[index].input.caloriesKcal ?? null,
      energyExpenditureKcal:
        result.calculations.expenditure.personalizedTdeeKcalPerDay,
      energyBalanceKcal: result.calculations.energyBalanceKcal,
      deltaFatKg: result.calculations.tissueEnergy.deltaFatMassKg,
      deltaLeanTissueKg: result.calculations.tissueEnergy.deltaLeanTissueKg,
      deltaGlycogenKg: result.calculations.glycogenTransition.deltaGlycogenKg,
      filteredWeightKg: result.calculations.filteredObservedWeightKg,
    };
  });
  return {
    calibration,
    calibrationNutritionDiagnostics: {
      observedNutritionDays: input.days.filter(({ sourceQuality }) => (
        sourceQuality.nutrition.source === "observed"
      )).length,
      imputedNutritionDays: input.days.filter(({ sourceQuality }) => (
        sourceQuality.nutrition.source === "imputed-local"
        || sourceQuality.nutrition.source === "imputed-fallback"
      )).length,
      missingNutritionDays: input.days.filter(({ sourceQuality }) => (
        sourceQuality.nutrition.source === "missing"
      )).length,
      calibrationEligibleObservedDays: calibrationEligibleDays.length,
      calibrationExcludedDependentDays: input.days.length - calibrationEligibleDays.length,
      firstImputedNutritionDate: input.days.find(({ sourceQuality }) => (
        sourceQuality.nutrition.source === "imputed-local"
        || sourceQuality.nutrition.source === "imputed-fallback"
      ))?.input.date ?? null,
    },
    dailyStates,
    latestModeledDate: dailyStates.findLast(({ status }) => status === "complete")?.date ?? null,
    unknownIntervals: continuity.unknownIntervals,
    continuityStatus: continuity.unknownIntervals.length === 0
      ? "resolved"
      : "awaiting-recovery",
  };
}
