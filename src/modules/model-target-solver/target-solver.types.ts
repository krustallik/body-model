import type {
  ForecastBlockedResult,
  ForecastConfig,
  ForecastResult,
  ForecastScenario,
  PredictiveSummary,
} from "@/modules/model-forecast/forecast.types";
import type { EmpiricalAttainmentProbability } from "./target-probability";

export const TARGET_SOLVER_VERSION = "bodycast-target-solver-v1" as const;

export type WeightTarget = {
  metric: "weightKg";
  targetValueKg: number;
  goalDate: string;
};

export type NutritionConstraints = {
  minCaloriesKcal: number;
  maxCaloriesKcal: number;
  minProteinG?: number;
  maxProteinG?: number;
  minFatG?: number;
  maxFatG?: number;
  minCarbsG?: number;
  maxCarbsG?: number;
};

export type ProportionalNutritionPolicy = {
  type: "proportional-template";
};

export type TargetSolverConfig = {
  targetToleranceKg: number;
  goalAttainmentToleranceKg: number;
  candidateResolutionKcal: number;
  robustnessDeltaKcal: number;
  monotonicityToleranceKg: number;
  monotonicityConfirmationPathCount: number;
  coarseGridPoints: number;
  maxEvaluations: number;
  searchPathCount: number;
  finalPathCount: number;
};

export const DEFAULT_TARGET_SOLVER_CONFIG: TargetSolverConfig = {
  targetToleranceKg: 0.05,
  goalAttainmentToleranceKg: 0.5,
  candidateResolutionKcal: 10,
  robustnessDeltaKcal: 100,
  monotonicityToleranceKg: 0.02,
  monotonicityConfirmationPathCount: 512,
  coarseGridPoints: 5,
  maxEvaluations: 24,
  searchPathCount: 128,
  finalPathCount: 512,
};

export type SolverScenarioTemplate = Extract<ForecastScenario, { mode: "fixed" | "target-centered" }>;

export type TargetSolverRequest = {
  episodeId?: number;
  goal: WeightTarget;
  control: {
    type: "daily-calorie-center";
    constraints: NutritionConstraints;
    nutritionAdjustmentPolicy: ProportionalNutritionPolicy;
  };
  scenarioTemplate: SolverScenarioTemplate;
  seed: number;
  solverConfig?: Partial<TargetSolverConfig>;
  forecastConfig?: Partial<ForecastConfig>;
};

export type CandidateRejectionReason =
  | "protein-below-minimum"
  | "protein-above-maximum"
  | "fat-below-minimum"
  | "fat-above-maximum"
  | "carbs-below-minimum"
  | "carbs-above-maximum"
  | "invalid-nutrition-vector"
  | "forecast-unreliable";

export type SolverCandidateEvaluation = {
  caloriesKcal: number;
  nutrition: {
    caloriesKcal: number;
    proteinG: number;
    fatG: number;
    carbsG: number;
  };
  objectiveKg: number;
  terminal: PredictiveSummary;
  forecast: ForecastResult;
  pathCount: number;
  stage: "search" | "monotonicity-confirmation" | "final-verification" | "robustness";
};

export type RejectedSolverCandidate = {
  caloriesKcal: number;
  reason: CandidateRejectionReason;
};

export type SearchMonotonicity = "monotonic" | "approximately-monotonic" | "non-monotonic";

export type MonotonicityConfirmation = {
  status: "not-required" | "monte-carlo-artifact" | "confirmed-non-monotonic"
    | "constraint-discontinuity" | "inconclusive";
  pathCount: number | null;
  suspiciousCaloriesKcal: number[];
};

export type SolverSearchResult = {
  status: "candidate-found" | "not-bracketed" | "no-valid-candidate" | "search-failed";
  best: SolverCandidateEvaluation | null;
  evaluations: SolverCandidateEvaluation[];
  rejected: RejectedSolverCandidate[];
  monotonicity: SearchMonotonicity;
  bracket: { lowerCaloriesKcal: number; upperCaloriesKcal: number } | null;
  finalBracketWidthKcal: number | null;
  maximumEvaluationsReached: boolean;
};

export type TargetSolverBlockedResult = {
  status: "initial-state-unavailable" | "initial-state-unreliable";
  solverVersion: typeof TARGET_SOLVER_VERSION;
  modelVersion: string;
  forecastVersion: string;
  recoveryVersion: string | null;
  initialStateQuality: "awaiting" | "degenerate";
  reason: string;
};

export type TargetSolverResult = {
  status: "solved" | "solved-at-boundary" | "numerically-limited" | "non-monotonic"
    | "not-bracketed" | "no-valid-candidate" | "search-failed";
  solverVersion: typeof TARGET_SOLVER_VERSION;
  modelVersion: string | null;
  forecastVersion: string | null;
  recoveryVersion: string | null;
  goal: WeightTarget & { horizonDays: number };
  control: TargetSolverRequest["control"] & {
    solvedValueKcal: number | null;
    constraintBoundary: "min" | "max" | null;
    boundaryReason: "target-statistic-reached-at-caller-bound" | null;
  };
  scenario: SolverScenarioTemplate | null;
  terminal: (PredictiveSummary & {
    targetErrorKg: number;
    targetAttainmentProbability: number;
    attainment: EmpiricalAttainmentProbability;
  }) | null;
  feasibility: {
    status: "feasible" | "feasible-at-boundary" | "numerically-limited" | "not-bracketed"
      | "constraint-limited" | "forecast-unreliable" | "non-monotonic" | "search-failed";
    constraints: "satisfied" | "no-valid-candidate";
    bracketing: "bracketed" | "not-bracketed" | "not-applicable";
    convergence: "within-tolerance" | "outside-tolerance" | "no-candidate";
    initialState: ForecastResult["initialStateQuality"] | null;
    forecastNumericalQuality: ForecastResult["diagnostics"]["numericalQuality"]["classification"] | null;
    predictiveIntervalWidth90Kg: number | null;
    solverResidualKg: number | null;
    responseShape: SearchMonotonicity;
  };
  robustness: {
    deltaKcal: number;
    lower: { caloriesKcal: number; terminalMedianKg: number; objectiveKg: number } | null;
    upper: { caloriesKcal: number; terminalMedianKg: number; objectiveKg: number } | null;
    sensitivityKgPer100Kcal: number | null;
    meaningfulResolutionKcal: number;
    resolutionDiagnostics: {
      configuredCandidateSpacingKcal: number;
      finalBracketWidthKcal: number | null;
      endpointToleranceEquivalentKcal: number | null;
      monteCarloShiftEquivalentKcal: number | null;
      searchToFinalMedianShiftKg: number | null;
    };
    neighboringCandidatesEffectivelyEquivalent: boolean | null;
    classification: "stable" | "boundary-limited" | "unavailable";
    commonRandomNumbers: true;
  };
  quality: {
    initialStateQuality: ForecastResult["initialStateQuality"] | null;
    forecastStatus: ForecastResult["status"] | null;
    numericalQuality: ForecastResult["diagnostics"]["numericalQuality"] | null;
    solverQuality: "standard" | "non-monotonic-response" | "final-verification-outside-tolerance" | "unresolved";
  };
  searchDiagnostics: {
    seed: number;
    commonRandomNumbers: true;
    objective: "terminal-weight-median-minus-target";
    evaluations: SolverCandidateEvaluation[];
    rejectedCandidates: RejectedSolverCandidate[];
    bracket: SolverSearchResult["bracket"];
    finalBracketWidthKcal: number | null;
    monotonicity: SearchMonotonicity;
    initialMonotonicity: SearchMonotonicity;
    monotonicityConfirmation: MonotonicityConfirmation;
    targetToleranceKg: number;
    candidateResolutionKcal: number;
    searchPathCount: number;
    finalPathCount: number;
    finalVerificationEvaluations: number;
    maximumEvaluationsReached: boolean;
    finalVerificationWithinTolerance: boolean | null;
  };
  forecast: ForecastResult | null;
};

export type CandidateForecastEvaluator = (input: {
  caloriesKcal: number;
  scenario: SolverScenarioTemplate;
  pathCount: number;
}) => Promise<CandidateForecastEvaluation | ForecastBlockedResult>;

export type CandidateForecastEvaluation = {
  forecast: ForecastResult;
  initialPhysiologicalBodyWeightKg: number;
  terminalPhysiologicalBodyWeightSamplesKg: readonly number[];
};
