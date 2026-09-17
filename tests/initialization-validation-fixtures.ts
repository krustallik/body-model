import { calculateDynamicDailyExpenditure } from "@/model/dynamic-daily-expenditure";
import { simulateDays, type PhysiologicalDailyInput } from "@/model/physiological-simulator";
import { reconstructBodyWeightKg } from "@/model/body-composition/state";
import { prepareEpisodeInitialization } from "@/modules/model-episodes/episode-initialization";
import { deriveEnergyHomeostasisReference } from "@/modules/model-episodes/initialization-bootstrap";
import { addCalendarDays } from "@/modules/model-episodes/model-calendar";
import type {
  HistoricalModelSources,
  ModelHealthDaySource,
  ModelProfileSource,
} from "@/modules/model-episodes/model-episode.types";

export const initValidationProfile: ModelProfileSource = {
  id: 1,
  sex: "male",
  dateOfBirth: "1990-05-10",
  heightCm: 180,
};

export const INIT_VALIDATION_END_DATE = "2035-12-31";
const COUNT = 140;
const START_DATE = addCalendarDays(INIT_VALIDATION_END_DATE, -(COUNT - 1));
const SCALE_NOISE = [0, 0.04, -0.03, 0.02, -0.02] as const;

/**
 * Synthetic initialization history matching scripts/validate-initialization-v5.ts.
 * Used so tests exercise prepareEpisodeInitialization application gates with known truth.
 */
export function buildInitializationValidationSources(input: {
  personalOffsetKcalPerDay: number;
  mutate?: (day: PhysiologicalDailyInput, index: number) => void;
  report?: (day: ModelHealthDaySource, index: number) => void;
  water?: (index: number) => number;
}): HistoricalModelSources {
  const seedDays: ModelHealthDaySource[] = Array.from({ length: COUNT }, (_, index) => ({
    date: addCalendarDays(START_DATE, index),
    weightKg: 80,
    bodyFatPercent: 20,
    caloriesKcal: 2_450,
    proteinG: 150,
    fatG: 75,
    carbsG: 240,
    averageWalkingSpeedKmh: 5,
    walkingDistanceKm: 5,
    strengthTrainingMinutes: 30,
    workoutFeedObserved: null,
  }));
  const seed = prepareEpisodeInitialization({
    profile: initValidationProfile,
    days: seedDays,
    startDate: INIT_VALIDATION_END_DATE,
    baselineConfig: {
      windowDays: 84,
      lookbackDays: 90,
      minimumCompleteNutritionDays: 63,
      minimumWeightObservations: 42,
      minimumWeightSpanDays: 63,
      maximumAbsoluteWeightTrendPercentPerWeek: 0.25,
    },
  });
  const activityKcalPerDay = calculateDynamicDailyExpenditure({
    bodyComposition: seed.initialState,
    rmrParameters: seed.simulatorParameters.rmrParameters,
    macros: seed.baseline.fallbackNutrition,
    outsideWorkWalking: { distanceKm: 5, averageSpeedKmh: 5 },
    strength: { durationMinutes: 30 },
    occupational: { category: null, durationHours: 0 },
    adaptiveThermogenesisKcalPerDay: 0,
  }).activityKcalPerDay!;
  const neutralIntakeKcalPerDay = deriveEnergyHomeostasisReference({
    rmrKcalPerDay: seed.initialRmrKcalPerDay,
    referenceActivityKcalPerDay: activityKcalPerDay,
    personalOffsetKcalPerDay: 0,
    observedReferenceNutrition: seed.baseline.fallbackNutrition,
  }).energyKcalPerDay;

  const inputs: PhysiologicalDailyInput[] = Array.from({ length: COUNT }, (_, index) => {
    const day: PhysiologicalDailyInput = {
      date: addCalendarDays(START_DATE, index),
      caloriesKcal: neutralIntakeKcalPerDay,
      proteinG: 150,
      fatG: 75,
      carbsG: 240,
      outsideWorkWalkingDistanceKm: 5,
      averageWalkingSpeedKmh: 5,
      strengthTrainingMinutes: 30,
      occupationalActivity: { category: null, durationHours: 0 },
      sodiumChangeMgPerDay: null,
      measuredWeightKg: null,
    };
    input.mutate?.(day, index);
    return day;
  });

  const generatedInitial = structuredClone(seed.initialState);
  generatedInitial.weightFilterState.estimatedWeightKg = reconstructBodyWeightKg(generatedInitial);
  const generated = simulateDays({
    initialState: generatedInitial,
    parameters: {
      ...seed.simulatorParameters,
      baselineEnergyIntakeKcalPerDay: neutralIntakeKcalPerDay,
    },
    days: inputs,
    options: { ecfPolicy: "hold-ecf" },
    personalization: {
      personalOffsetKcalPerDay: input.personalOffsetKcalPerDay,
      activityCalibration: 1,
    },
  });

  const days = generated.map((result, index): ModelHealthDaySource => {
    if (result.status !== "complete") throw new Error(result.status);
    const bodyWeightKg = reconstructBodyWeightKg(result.endState);
    const day: ModelHealthDaySource = {
      date: inputs[index]!.date,
      weightKg: bodyWeightKg
        + SCALE_NOISE[index % SCALE_NOISE.length]!
        + (input.water?.(index) ?? 0),
      bodyFatPercent: index % 3 === 0 || index === COUNT - 1
        ? result.endState.fatMassKg / bodyWeightKg * 100
        : null,
      caloriesKcal: inputs[index]!.caloriesKcal!,
      proteinG: inputs[index]!.proteinG!,
      fatG: inputs[index]!.fatG!,
      carbsG: inputs[index]!.carbsG!,
      averageWalkingSpeedKmh: inputs[index]!.averageWalkingSpeedKmh!,
      walkingDistanceKm: inputs[index]!.outsideWorkWalkingDistanceKm!,
      strengthTrainingMinutes: inputs[index]!.strengthTrainingMinutes!,
      workoutFeedObserved: null,
    };
    input.report?.(day, index);
    return day;
  });

  return { days, snapshots: [], workIntervals: [], workouts: [] };
}
