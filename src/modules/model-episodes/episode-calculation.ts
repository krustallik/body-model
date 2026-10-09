import {
  calibratePersonalization,
  type CalibrationDay,
  type PersonalizationCalibrationResult,
} from "@/model/personalization-calibration";
import { simulateDays } from "@/model/physiological-simulator";
import type { PhysiologicalSimulatorState } from "@/model/physiological-simulator";
import { stableSha256 } from "@/modules/model-recovery/recovery-fingerprint";
import { addCalendarDays } from "./model-calendar";
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
  calibrationInputFingerprint: string;
  replayMode: "full" | "suffix";
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
      workoutActivity: input.workoutActivity
        ? { events: input.workoutActivity.events.map((event) => ({ ...event })) }
        : undefined,
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
  episode: Pick<PersistedEpisode, "ecfPolicy" | "initialState" | "simulatorParameters" | "personalOffsetKcalPerDay" | "modelVersion">
    & Partial<Pick<PersistedEpisode, "initialPersonalOffsetKcalPerDay">>;
  days: readonly BuiltSimulationDay[];
  resume?: {
    fromDate: string;
    predecessorDate: string;
    predecessorState: PhysiologicalSimulatorState;
    persistedCalibrationInputFingerprint: string | null;
  };
}): EpisodeCalculation {
  const continuity = analyzeStateContinuity(input.days, input.episode.ecfPolicy);
  const firstDependentIndex = continuity.resolvedDays.findIndex(({ sourceQuality }) => (
    sourceQuality.nutrition.source !== "observed"
    || sourceQuality.nutrition.dependency !== "observed"
  ));
  const calibrationEligibleDays = firstDependentIndex === -1
    ? continuity.resolvedDays
    : continuity.resolvedDays.slice(0, firstDependentIndex);
  const history = calibrationHistory(calibrationEligibleDays);
  // The initialization estimate may be intentionally unapplied (for example,
  // a weak estimate). Calibration must start from the episode's applied
  // parameter; that value is also part of the suffix compatibility fingerprint.
  const calibrationDefaultOffset = input.episode.personalOffsetKcalPerDay;
  const calibration = calibratePersonalization({
    initialState: input.episode.initialState,
    simulatorParameters: input.episode.simulatorParameters,
    history,
    ecfPolicy: input.episode.ecfPolicy,
    defaultParameters: {
      personalOffsetKcalPerDay: calibrationDefaultOffset,
      activityCalibration: 1,
    },
    fitMode: "offset-and-activity",
  });
  const calibrationInputFingerprint = stableSha256(JSON.stringify({
    compatibilityRevision: "episode-calibration-input-v1",
    modelVersion: input.episode.modelVersion,
    ecfPolicy: input.episode.ecfPolicy,
    initialState: input.episode.initialState,
    simulatorParameters: input.episode.simulatorParameters,
    defaultParameters: {
      personalOffsetKcalPerDay: calibrationDefaultOffset,
      activityCalibration: 1,
    },
    history,
  }));
  const suffixDays = input.resume === undefined
    ? []
    : continuity.resolvedDays.filter(({ input: day }) => day.date >= input.resume!.fromDate);
  const useSuffix = input.resume !== undefined
    && input.resume.fromDate > (continuity.resolvedDays[0]?.input.date ?? input.resume.fromDate)
    && input.resume.predecessorDate === addCalendarDays(input.resume.fromDate, -1)
    && input.resume.persistedCalibrationInputFingerprint === calibrationInputFingerprint
    && suffixDays.length > 0
    && !continuity.unknownIntervals.some((interval) => interval.startDate < input.resume!.fromDate
      && (interval.lastUnknownDate >= input.resume!.fromDate
        || interval.postGapObservationDates.some((date) => date >= input.resume!.fromDate)))
    && continuity.resolvedDays.some(({ input: day }) => day.date === input.resume!.predecessorDate);
  const simulationDays = useSuffix ? suffixDays : continuity.resolvedDays;
  const results = simulateDays({
    initialState: useSuffix ? input.resume!.predecessorState : input.episode.initialState,
    parameters: input.episode.simulatorParameters,
    days: simulationDays.map(({ input: day }) => day),
    options: { ecfPolicy: input.episode.ecfPolicy },
    personalization: calibration.parameters,
  });
  const dailyStates = results.map((result, index): DailyModelStateWrite => {
    if (result.status !== "complete" || result.calculations === null) {
      throw new Error(`resolved-prefix invariant violated on ${result.date}`);
    }
    const sourceQuality = { ...simulationDays[index].sourceQuality,
      issues: [...simulationDays[index].sourceQuality.issues],
      sourceObservationFields: [
        ...simulationDays[index].sourceQuality.sourceObservationFields,
      ],
      nutrition: {
        ...simulationDays[index].sourceQuality.nutrition,
        referenceDates: [...simulationDays[index].sourceQuality.nutrition.referenceDates],
        observedFields: [...simulationDays[index].sourceQuality.nutrition.observedFields],
        imputedFields: [...simulationDays[index].sourceQuality.nutrition.imputedFields],
        referenceMacroMadG: simulationDays[index].sourceQuality.nutrition.referenceMacroMadG
          ? { ...simulationDays[index].sourceQuality.nutrition.referenceMacroMadG }
          : null,
      },
      ...(result.calculations.expenditure.workoutEnergyResolution === null
        ? {}
        : {
          selectionV1: simulationDays[index].sourceQuality.selectionV1 === undefined
            ? undefined
            : {
              ...simulationDays[index].sourceQuality.selectionV1,
              energyCoverage: result.calculations.expenditure.workoutEnergyResolution.energyCoverage ?? null,
            },
          workoutEnergyResolution: {
            ...result.calculations.expenditure.workoutEnergyResolution,
            perEvent: result.calculations.expenditure.workoutEnergyResolution.perEvent.map((event) => ({
              ...event,
              ...(event.stepperEnergy ? { stepperEnergy: { ...event.stepperEnergy, heartRate: { ...event.stepperEnergy.heartRate }, selected: { ...event.stepperEnergy.selected } } } : {}),
            })),
          },
        }),
    };
    const nutrition = sourceQuality.nutrition;
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
      energyIntakeKcal: simulationDays[index].input.caloriesKcal ?? null,
      energyExpenditureKcal:
        result.calculations.expenditure.personalizedTdeeKcalPerDay,
      energyBalanceKcal: result.calculations.energyBalanceKcal,
      deltaFatKg: result.calculations.tissueEnergy.deltaFatMassKg,
      deltaLeanTissueKg: result.calculations.tissueEnergy.deltaLeanTissueKg,
      deltaGlycogenKg: result.calculations.glycogenTransition.deltaGlycogenKg,
      filteredWeightKg: result.calculations.filteredObservedWeightKg,
      weightFilterVarianceKg2: result.endState.weightFilterState.varianceKg2,
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
    calibrationInputFingerprint,
    replayMode: useSuffix ? "suffix" : "full",
    dailyStates,
    latestModeledDate: dailyStates.findLast(({ status }) => status === "complete")?.date ?? null,
    unknownIntervals: continuity.unknownIntervals,
    continuityStatus: continuity.unknownIntervals.length === 0
      ? "resolved"
      : "awaiting-recovery",
  };
}
