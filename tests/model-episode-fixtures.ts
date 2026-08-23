import type {
  ModelHealthDaySource,
  ModelProfileSource,
  PersistedEpisode,
} from "@/modules/model-episodes/model-episode.types";
import { addCalendarDays } from "@/modules/model-episodes/model-calendar";
import { prepareEpisodeInitialization } from "@/modules/model-episodes/episode-initialization";

export const modelProfile: ModelProfileSource = {
  id: 1,
  sex: "male",
  dateOfBirth: "1990-05-10",
  heightCm: 180,
};

export function sourceDay(
  date: string,
  override: Partial<ModelHealthDaySource> = {},
): ModelHealthDaySource {
  return {
    date,
    weightKg: 80,
    bodyFatPercent: 20,
    caloriesKcal: 2_500,
    proteinG: 150,
    fatG: 75,
    carbsG: 250,
    averageWalkingSpeedKmh: 5,
    walkingDistanceKm: 5,
    strengthTrainingMinutes: 0,
    ...override,
  };
}

export function stableSourceDays(input: {
  count?: number;
  endDate?: string;
  override?: (index: number, date: string) => Partial<ModelHealthDaySource>;
} = {}): ModelHealthDaySource[] {
  const count = input.count ?? 90;
  const endDate = input.endDate ?? "2026-08-22";
  const startDate = addCalendarDays(endDate, -(count - 1));
  return Array.from({ length: count }, (_, index) => {
    const date = addCalendarDays(startDate, index);
    return sourceDay(date, {
      weightKg: 80 + [0, 0.08, -0.05, 0.03, -0.04][index % 5],
      caloriesKcal: 2_450 + [0, 100, -50, 50, 0][index % 5],
      carbsG: 240 + [0, 20, -10, 10, 0][index % 5],
      bodyFatPercent: index >= count - 7 ? 20 + [0, 0.3, -0.2][index % 3] : null,
      ...(input.override?.(index, date) ?? {}),
    });
  });
}

export function persistedEpisodeFixture(startDate = "2026-08-22"): PersistedEpisode {
  const prepared = prepareEpisodeInitialization({
    profile: modelProfile,
    days: stableSourceDays({ endDate: startDate }),
    startDate,
  });
  return {
    id: 1,
    profileId: prepared.profileId,
    startDate: prepared.startDate,
    timezone: prepared.timezone,
    modelVersion: prepared.modelVersion,
    active: true,
    ecfPolicy: prepared.ecfPolicy,
    baselineEnergyIntakeKcalPerDay:
      prepared.baseline.baselineEnergyIntakeKcalPerDay,
    baselineCarbIntakeG: prepared.baseline.baselineCarbIntakeG,
    baselineNutritionFallback: prepared.baseline.fallbackNutrition,
    nutritionMaxBridgeDays: prepared.nutritionMaxBridgeDays,
    baselineWindowStartDate: prepared.baseline.diagnostics.windowStartDate,
    baselineWindowEndDate: prepared.baseline.diagnostics.windowEndDate,
    baselineNutritionDayCount:
      prepared.baseline.diagnostics.completeNutritionDayCount,
    baselineWeightObservationCount:
      prepared.baseline.diagnostics.weightObservationCount,
    baselineWeightTrendKgPerWeek:
      prepared.baseline.diagnostics.weightTrendKgPerWeek,
    baselineWeightTrendPercentPerWeek:
      prepared.baseline.diagnostics.weightTrendPercentPerWeek,
    initialState: prepared.initialState,
    simulatorParameters: prepared.simulatorParameters,
    initialRmrKcalPerDay: prepared.initialRmrKcalPerDay,
    personalOffsetKcalPerDay: 0,
    activityCalibration: 1,
    calibrationStatus: "insufficient-history",
    calibrationDiagnostics: {},
    latestModeledDate: null,
    createdAt: "2026-08-23T00:00:00.000Z",
    updatedAt: "2026-08-23T00:00:00.000Z",
  };
}
