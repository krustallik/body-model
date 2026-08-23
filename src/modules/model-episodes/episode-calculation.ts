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
  const firstDependentIndex = input.days.findIndex(({ sourceQuality }) => (
    sourceQuality.nutrition.source !== "observed"
    || sourceQuality.nutrition.dependency !== "observed"
  ));
  const calibrationEligibleDays = firstDependentIndex === -1
    ? input.days
    : input.days.slice(0, firstDependentIndex);
  const calibration = calibratePersonalization({
    initialState: input.episode.initialState,
    simulatorParameters: input.episode.simulatorParameters,
    history: calibrationHistory(calibrationEligibleDays),
    ecfPolicy: input.episode.ecfPolicy,
  });
  const results = simulateDays({
    initialState: input.episode.initialState,
    parameters: input.episode.simulatorParameters,
    days: input.days.map(({ input: day }) => day),
    options: { ecfPolicy: input.episode.ecfPolicy },
    personalization: calibration.parameters,
  });
  const dailyStates = results.map((result, index): DailyModelStateWrite => {
    const sourceQuality = { ...input.days[index].sourceQuality,
      issues: [...input.days[index].sourceQuality.issues],
      nutrition: {
        ...input.days[index].sourceQuality.nutrition,
        referenceDates: [...input.days[index].sourceQuality.nutrition.referenceDates],
        observedFields: [...input.days[index].sourceQuality.nutrition.observedFields],
        imputedFields: [...input.days[index].sourceQuality.nutrition.imputedFields],
        referenceMacroMadG: input.days[index].sourceQuality.nutrition.referenceMacroMadG
          ? { ...input.days[index].sourceQuality.nutrition.referenceMacroMadG }
          : null,
      },
    };
    const nutrition = sourceQuality.nutrition;
    if (result.status === "incomplete") {
      return {
        date: result.date,
        status: result.status,
        dataQuality: "incomplete",
        nutrition,
        sourceQuality,
        missingFields: [...result.missingFields],
        modelVersion: input.episode.modelVersion,
        startWeightKg: null,
        endWeightKg: null,
        fatMassKg: null,
        leanTissueKg: null,
        glycogenKg: null,
        extracellularFluidDeviationLiters: null,
        dynamicRmrKcalPerDay: null,
        tefKcalPerDay: null,
        activityKcalPerDay: null,
        adaptiveThermogenesisKcalPerDay: null,
        energyIntakeKcal: input.days[index].input.caloriesKcal ?? null,
        energyExpenditureKcal: null,
        energyBalanceKcal: null,
        deltaFatKg: null,
        deltaLeanTissueKg: null,
        deltaGlycogenKg: null,
        filteredWeightKg: null,
      };
    }
    if (result.status === "blocked") {
      return {
        date: result.date,
        status: result.status,
        dataQuality: "blocked",
        nutrition,
        sourceQuality,
        missingFields: [`blockedByDate:${result.blockedByDate}`],
        modelVersion: input.episode.modelVersion,
        startWeightKg: null,
        endWeightKg: null,
        fatMassKg: null,
        leanTissueKg: null,
        glycogenKg: null,
        extracellularFluidDeviationLiters: null,
        dynamicRmrKcalPerDay: null,
        tefKcalPerDay: null,
        activityKcalPerDay: null,
        adaptiveThermogenesisKcalPerDay: null,
        energyIntakeKcal: input.days[index].input.caloriesKcal ?? null,
        energyExpenditureKcal: null,
        energyBalanceKcal: null,
        deltaFatKg: null,
        deltaLeanTissueKg: null,
        deltaGlycogenKg: null,
        filteredWeightKg: null,
      };
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
      energyIntakeKcal: input.days[index].input.caloriesKcal ?? null,
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
  };
}
