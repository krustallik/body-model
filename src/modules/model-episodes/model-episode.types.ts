import type { PersonalizationCalibrationStatus } from "@/model/personalization-calibration";
import type {
  EcfSimulationPolicy,
  PhysiologicalSimulatorParameters,
  PhysiologicalSimulatorState,
} from "@/model/physiological-simulator";

export type ModelProfileSource = {
  id: number;
  sex: "male" | "female";
  dateOfBirth: string;
  heightCm: number;
};

export type ModelHealthDaySource = {
  date: string;
  weightKg: number | null;
  bodyFatPercent: number | null;
  caloriesKcal: number | null;
  proteinG: number | null;
  fatG: number | null;
  carbsG: number | null;
  averageWalkingSpeedKmh: number | null;
  walkingDistanceKm: number | null;
  strengthTrainingMinutes: number | null;
};

export type ModelSnapshotSource = {
  id: number;
  date: string;
  receivedAt: Date;
  syncedAt: Date | null;
  steps: number | null;
  walkingDistanceKm: number | null;
};

export type ModelWorkIntervalSource = {
  id: number;
  date: string;
  startAt: Date;
  endAt: Date;
  timezone: string;
  category: string;
  breakMinutes: number | null;
};

export type HistoricalModelSources = {
  days: ModelHealthDaySource[];
  snapshots: ModelSnapshotSource[];
  workIntervals: ModelWorkIntervalSource[];
};

export type MaintenanceBaselineDiagnostics = {
  method: "median-with-theil-sen-weight-stability";
  windowStartDate: string;
  windowEndDate: string;
  windowDays: number;
  completeNutritionDayCount: number;
  weightObservationCount: number;
  weightObservationSpanDays: number;
  medianWeightKg: number;
  weightTrendKgPerWeek: number;
  weightTrendPercentPerWeek: number;
  maximumAbsoluteWeightTrendPercentPerWeek: number;
};

export type MaintenanceBaseline = {
  baselineEnergyIntakeKcalPerDay: number;
  baselineCarbIntakeG: number;
  fallbackNutrition: NutritionVector;
  diagnostics: MaintenanceBaselineDiagnostics;
};

export type NutritionVector = {
  caloriesKcal: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
};

export type NutritionSource =
  | "observed"
  | "imputed-local"
  | "imputed-fallback"
  | "missing";

export type NutritionDependency = "observed" | "imputed-direct" | "imputed-downstream";

export type NutritionProvenance = {
  source: NutritionSource;
  method: "local-joint-donor" | "frozen-baseline-joint-donor" | null;
  referenceDayCount: number;
  gapLength: number;
  referenceDates: string[];
  observedFields: (keyof NutritionVector)[];
  imputedFields: (keyof NutritionVector)[];
  referenceCaloriesMedian: number | null;
  referenceCaloriesMad: number | null;
  referenceMacroMadG: {
    proteinG: number;
    fatG: number;
    carbsG: number;
  } | null;
  dependency: NutritionDependency;
};

export type PreparedEpisodeInitialization = {
  profileId: number;
  startDate: string;
  timezone: string;
  modelVersion: string;
  ecfPolicy: EcfSimulationPolicy;
  baseline: MaintenanceBaseline;
  initialState: PhysiologicalSimulatorState;
  simulatorParameters: PhysiologicalSimulatorParameters;
  initialRmrKcalPerDay: number;
  bodyFatObservationCount: number;
  bodyFatSpreadPercent: number;
  nutritionMaxBridgeDays: number;
};

export type PersistedEpisode = {
  id: number;
  profileId: number;
  startDate: string;
  timezone: string;
  modelVersion: string;
  active: boolean;
  ecfPolicy: EcfSimulationPolicy;
  baselineEnergyIntakeKcalPerDay: number;
  baselineCarbIntakeG: number;
  baselineNutritionFallback: NutritionVector | null;
  nutritionMaxBridgeDays: number;
  baselineWindowStartDate: string;
  baselineWindowEndDate: string;
  baselineNutritionDayCount: number;
  baselineWeightObservationCount: number;
  baselineWeightTrendKgPerWeek: number;
  baselineWeightTrendPercentPerWeek: number;
  initialState: PhysiologicalSimulatorState;
  simulatorParameters: PhysiologicalSimulatorParameters;
  initialRmrKcalPerDay: number;
  personalOffsetKcalPerDay: number;
  activityCalibration: number;
  calibrationStatus: PersonalizationCalibrationStatus;
  calibrationDiagnostics: unknown;
  latestModeledDate: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ModelDaySourceQuality = {
  status:
    | "complete"
    | "missing-nutrition"
    | "missing-activity"
    | "work-reconstruction-unavailable";
  issues: string[];
  workIntervalCount: number;
  workWalkingDistanceKm: number | null;
  outsideWorkWalkingDistanceKm: number | null;
  sourceObservationFields: string[];
  workWalkingReconstruction?: Array<{
    intervalId: number;
    distanceKm: number | null;
    reason: "insufficient-data" | "gap-too-large" | "counter-decreased" | null;
    startMethod: "exact" | "interpolated" | "nearest" | null;
    endMethod: "exact" | "interpolated" | "nearest" | null;
  }>;
  workBreaks?: Array<{
    intervalId: number;
    breakMinutes: number | null;
    source: "user-entered" | "legacy-unreported";
  }>;
  nutrition: NutritionProvenance;
};

export type BuiltSimulationDay = {
  input: import("@/model/physiological-simulator").PhysiologicalDailyInput;
  sourceQuality: ModelDaySourceQuality;
};

export type UnknownIntervalWrite = {
  startDate: string;
  lastUnknownDate: string;
  endDate: string | null;
  anchorDate: string | null;
  firstPostGapObservationDate: string | null;
  postGapObservedDayCount: number;
  postGapObservationDates: string[];
  missingTransitionFields: string[];
  recoveryRequired: true;
};

export type UnknownIntervalDto = UnknownIntervalWrite & {
  id: number;
  durationDays: number;
  open: boolean;
};

export type DailyModelStateWrite = {
  date: string;
  status: "complete" | "incomplete" | "blocked";
  dataQuality: "observed" | "estimated" | "incomplete" | "blocked";
  nutrition: NutritionProvenance;
  sourceQuality: ModelDaySourceQuality;
  missingFields: string[];
  modelVersion: string;
  startWeightKg: number | null;
  endWeightKg: number | null;
  fatMassKg: number | null;
  leanTissueKg: number | null;
  glycogenKg: number | null;
  extracellularFluidDeviationLiters: number | null;
  dynamicRmrKcalPerDay: number | null;
  tefKcalPerDay: number | null;
  activityKcalPerDay: number | null;
  adaptiveThermogenesisKcalPerDay: number | null;
  energyIntakeKcal: number | null;
  energyExpenditureKcal: number | null;
  energyBalanceKcal: number | null;
  deltaFatKg: number | null;
  deltaLeanTissueKg: number | null;
  deltaGlycogenKg: number | null;
  filteredWeightKg: number | null;
};

export type ModelStatusDto = {
  episodeId: number;
  episodeStartDate: string;
  latestModeledDate: string | null;
  modelVersion: string;
  calibrationStatus: PersonalizationCalibrationStatus;
  personalOffsetKcalPerDay: number;
  activityCalibration: number;
  daysModeled: number;
  incompleteDays: number;
  observedNutritionDays: number;
  imputedNutritionDays: number;
  unbridgeableNutritionDays: number;
  currentPredictedWeightKg: number | null;
  currentFilteredWeightKg: number | null;
  currentFatMassKg: number | null;
  currentLeanTissueKg: number | null;
  currentDynamicRmrKcalPerDay: number | null;
  currentModeledTdeeKcalPerDay: number | null;
  continuityStatus: "resolved" | "awaiting-recovery";
  lastResolvedDate: string | null;
  recoveryRequired: boolean;
  unknownIntervalCount: number;
  unresolvedDayCount: number;
  postGapObservedDayCount: number;
  unknownIntervals: UnknownIntervalDto[];
};
