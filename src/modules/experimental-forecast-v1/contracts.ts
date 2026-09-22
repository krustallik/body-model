import type {
  UnifiedExperimentalPhysiologyDayResultV1,
  UnifiedExperimentalPhysiologyStateV1,
  UnifiedNumericEnvelopeV1,
} from "@/model/unified-experimental-physiology-v1/contracts";

export const EXPERIMENTAL_FORECAST_V1_REVISION = "experimental-forecast-v1" as const;

export type ExperimentalForecastQuality =
  | "standard"
  | "limited-history"
  | "degraded"
  | "unavailable";

export type ExperimentalForecastScenarioMode =
  | "maintain-current"
  | "target-calories"
  | "target-deficit"
  | "target-surplus"
  | "typical-recent-activity"
  | "explicit-plan";

export type ExperimentalForecastScenario = {
  mode: ExperimentalForecastScenarioMode;
  caloriesKcal?: number;
  deltaCaloriesKcal?: number;
  proteinG?: number;
  fatG?: number;
  carbsG?: number;
  outsideWorkWalkingDistanceKm?: number;
  averageWalkingSpeedKmh?: number;
  strengthTrainingMinutes?: number;
  stepperMinutes?: number;
  activityReplacement?: "replace" | "additive";
};

export type ExperimentalForecastConfig = {
  pathCount: number;
  rangeLowerProbability: number;
  rangeUpperProbability: number;
  limitedHistoryMinimumDays: number;
  limitedHistoryRequestedWindowDays: number;
  horizonUncertaintyPerDayKg: number;
};

export const DEFAULT_EXPERIMENTAL_FORECAST_CONFIG: ExperimentalForecastConfig = {
  pathCount: 64,
  rangeLowerProbability: 0.05,
  rangeUpperProbability: 0.95,
  limitedHistoryMinimumDays: 14,
  limitedHistoryRequestedWindowDays: 28,
  horizonUncertaintyPerDayKg: 0.015,
};

export type ExperimentalForecastInitialState = {
  unified: UnifiedExperimentalPhysiologyStateV1;
  anchorDate: string;
  anchorWeightKg: number | null;
  fatMassKg: number | null;
  slowNonFatKg: number | null;
  glycogenRelativeKg: UnifiedNumericEnvelopeV1 | null;
  glycogenWaterKg: UnifiedNumericEnvelopeV1 | null;
  transientWaterKg: UnifiedNumericEnvelopeV1 | null;
  restingRmrKcalPerDay: number | null;
  typicalMaintenanceKcalPerDay: number | null;
  latestExpenditureKcalPerDay: number | null;
  quality: ExperimentalForecastQuality;
  eligibleDays: number;
  requestedWindowDays: number;
  uncertaintyReasons: string[];
  unifiedFingerprint: string;
  sourceResult: UnifiedExperimentalPhysiologyDayResultV1;
};

export type ExperimentalEngineeringRange = {
  median: number;
  lower: number;
  upper: number;
  representation: "engineering-range";
};

export type ExperimentalForecastDate = {
  date: string;
  expectedWeightKg: number | null;
  weightChangeFromAnchorKg: ExperimentalEngineeringRange;
  weightKg: ExperimentalEngineeringRange | null;
  fatMassKg: ExperimentalEngineeringRange | null;
  slowNonFatKg: ExperimentalEngineeringRange | null;
  glycogenKg: ExperimentalEngineeringRange | null;
  glycogenWaterKg: ExperimentalEngineeringRange | null;
  transientWaterKg: ExperimentalEngineeringRange | null;
  expenditureKcalPerDay: ExperimentalEngineeringRange;
  intakeKcal: ExperimentalEngineeringRange;
  activityKcalPerDay: ExperimentalEngineeringRange;
  energyState: "deficit" | "maintenance" | "surplus";
  selectedDoseKeys: string[];
  quality: ExperimentalForecastQuality;
  uncertaintyReasons: string[];
};

export type ExperimentalForecastResult = {
  status: "ok" | "limited-history" | "degraded" | "unavailable";
  forecastRevision: typeof EXPERIMENTAL_FORECAST_V1_REVISION;
  horizonDays: number;
  anchorDate: string;
  anchorWeightKg: number | null;
  initialStateQuality: ExperimentalForecastQuality;
  initialStateFingerprint: string;
  scenarioFingerprint: string;
  seed: number;
  scenario: ExperimentalForecastScenario;
  coverage: { eligibleDays: number; requestedWindowDays: number };
  current: {
    modeledWeightKg: number | null;
    fatMassKg: number | null;
    slowNonFatKg: number | null;
    glycogenWaterKg: number | null;
    transientWaterKg: number | null;
    restingRmrKcalPerDay: number | null;
    typicalMaintenanceKcalPerDay: number | null;
    latestExpenditureKcalPerDay: number | null;
  };
  dates: ExperimentalForecastDate[];
  diagnostics: {
    generatedPathCount: number;
    validPathCount: number;
    uncertaintySources: {
      initialState: boolean;
      futureInputs: boolean;
      model: boolean;
      horizon: boolean;
      missingAssumptions: boolean;
    };
    notes: string[];
  };
};
