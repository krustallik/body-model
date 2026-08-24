import type { ForecastResult, PredictiveSummary } from "@/modules/model-forecast/forecast.types";
import type { NutritionConstraints, TargetSolverBlockedResult, TargetSolverResult } from "@/modules/model-target-solver/target-solver.types";

export type GoalPlanningStatus = Exclude<TargetSolverResult["status"], "no-valid-candidate">
  | "constraint-limited" | "forecast-unreliable"
  | TargetSolverBlockedResult["status"];

export type GoalPlanningWarning =
  | "caller-boundary"
  | "numerically-limited"
  | "not-bracketed"
  | "constraint-limited"
  | "forecast-unreliable"
  | "non-monotonic"
  | "degraded-initial-state"
  | "recovered-initial-state"
  | "limited-long-horizon"
  | "initial-state-unavailable"
  | "initial-state-unreliable";

export type GoalPlanningAssumptions = {
  scenarioMode: "fixed" | "target-centered";
  nutritionPolicy: "proportional-template";
  constraints: NutritionConstraints;
  referenceNutrition: { caloriesKcal: number; proteinG: number; fatG: number; carbsG: number };
  activity: {
    outsideWorkWalkingDistanceKm: number;
    averageWalkingSpeedKmh: number;
    defaultStrengthTrainingMinutes: number;
    strengthByWeekday: Record<string, number> | null;
    defaultOccupation: Array<{
      category: string;
      durationHours: number;
      breakDurationHours: number | null;
      workWalkingDistanceKm: number | null;
      averageWalkingSpeedKmh: number | null;
    }>;
    scheduledOccupationDayCount: number;
  };
};

export type GoalPlanningResponse = {
  status: GoalPlanningStatus;
  solverStatus: TargetSolverResult["status"] | TargetSolverBlockedResult["status"];
  solverVersion: string;
  modelVersion: string | null;
  forecastVersion: string | null;
  recoveryVersion: string | null;
  goal: { metric: "weightKg"; targetValueKg: number; goalDate: string; horizonDays: number | null };
  control: {
    solvedCaloriesKcal: number | null;
    constraintBoundary: "min" | "max" | null;
    boundaryReason: "target-statistic-reached-at-caller-bound" | null;
  };
  terminal: (PredictiveSummary & {
    date: string;
    targetErrorKg: number;
    attainment: {
      direction: "loss" | "gain" | "maintenance";
      definition: "at-or-below-target" | "at-or-above-target" | "within-target-band";
      probability: number;
      successes: number;
      sampleCount: number;
      probabilityMonteCarloInterval: { confidenceLevel: 0.95; lower: number; upper: number; method: "wilson-score" };
    };
  }) | null;
  feasibility: TargetSolverResult["feasibility"] | null;
  numerical: {
    solverToleranceKg: number;
    goalToleranceKg: number;
    practicalResolutionKcal: number | null;
    localSensitivityKgPer100Kcal: number | null;
    robustnessClassification: TargetSolverResult["robustness"]["classification"] | null;
    forecastQuality: ForecastResult["diagnostics"]["numericalQuality"]["classification"] | null;
    predictiveSpread90Kg: number | null;
  };
  provenance: {
    initialStateQuality: ForecastResult["initialStateQuality"] | "awaiting" | "degenerate" | null;
    forecastStatus: ForecastResult["status"] | null;
  };
  assumptions: GoalPlanningAssumptions;
  warnings: GoalPlanningWarning[];
  forecast: ForecastResult | null;
  reason: string | null;
};
