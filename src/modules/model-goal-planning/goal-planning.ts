import { DEFAULT_TARGET_SOLVER_CONFIG, type SolverScenarioTemplate, type TargetSolverBlockedResult, type TargetSolverRequest, type TargetSolverResult } from "@/modules/model-target-solver/target-solver.types";
import type { GoalPlanningRequest } from "./goal-planning.schema";
import type { GoalPlanningAssumptions, GoalPlanningResponse, GoalPlanningStatus, GoalPlanningWarning } from "./goal-planning.types";

export function toTargetSolverRequest(request: GoalPlanningRequest): TargetSolverRequest {
  return {
    episodeId: request.episodeId,
    goal: request.goal,
    control: {
      type: "daily-calorie-center",
      constraints: request.constraints,
      nutritionAdjustmentPolicy: { type: "proportional-template" },
    },
    scenarioTemplate: request.scenarioTemplate,
    seed: request.seed,
  };
}

function assumptions(request: GoalPlanningRequest): GoalPlanningAssumptions {
  const schedule = request.scenarioTemplate.schedule;
  const scheduledOccupationDayCount = Object.values(schedule.byDate ?? {})
    .filter((day) => (day.occupation?.length ?? 0) > 0).length;
  return {
    scenarioMode: request.scenarioTemplate.mode,
    nutritionPolicy: "proportional-template",
    constraints: request.constraints,
    referenceNutrition: schedule.defaultDay.nutrition,
    activity: {
      outsideWorkWalkingDistanceKm: schedule.defaultDay.outsideWorkWalkingDistanceKm,
      averageWalkingSpeedKmh: schedule.defaultDay.averageWalkingSpeedKmh,
      defaultStrengthTrainingMinutes: schedule.defaultDay.strengthTrainingMinutes,
      strengthByWeekday: schedule.strengthByWeekday ?? null,
      defaultOccupation: schedule.defaultDay.occupation,
      scheduledOccupationDayCount,
    },
  };
}

function publicStatus(result: TargetSolverResult): GoalPlanningStatus {
  if (result.status !== "no-valid-candidate") return result.status;
  return result.feasibility.status === "forecast-unreliable" ? "forecast-unreliable" : "constraint-limited";
}

function warningCodes(status: GoalPlanningStatus, result?: TargetSolverResult): GoalPlanningWarning[] {
  const warnings = new Set<GoalPlanningWarning>();
  const statusWarnings: Partial<Record<GoalPlanningStatus, GoalPlanningWarning>> = {
    "solved-at-boundary": "caller-boundary",
    "numerically-limited": "numerically-limited",
    "not-bracketed": "not-bracketed",
    "constraint-limited": "constraint-limited",
    "forecast-unreliable": "forecast-unreliable",
    "non-monotonic": "non-monotonic",
    "initial-state-unavailable": "initial-state-unavailable",
    "initial-state-unreliable": "initial-state-unreliable",
  };
  const statusWarning = statusWarnings[status];
  if (statusWarning) warnings.add(statusWarning);
  if (result?.quality.initialStateQuality === "degraded") warnings.add("degraded-initial-state");
  if (result?.quality.initialStateQuality === "recovered") warnings.add("recovered-initial-state");
  if (result?.quality.numericalQuality?.classification === "limited-long-horizon") warnings.add("limited-long-horizon");
  return [...warnings];
}

export function serializeGoalPlanningResult(
  request: GoalPlanningRequest,
  result: TargetSolverResult | TargetSolverBlockedResult,
): GoalPlanningResponse {
  const submittedAssumptions = assumptions(request);
  if (!("goal" in result)) {
    return {
      status: result.status,
      solverStatus: result.status,
      solverVersion: result.solverVersion,
      modelVersion: result.modelVersion,
      forecastVersion: result.forecastVersion,
      recoveryVersion: result.recoveryVersion,
      goal: { ...request.goal, horizonDays: null },
      control: { solvedCaloriesKcal: null, constraintBoundary: null, boundaryReason: null },
      terminal: null,
      feasibility: null,
      numerical: {
        solverToleranceKg: DEFAULT_TARGET_SOLVER_CONFIG.targetToleranceKg,
        goalToleranceKg: DEFAULT_TARGET_SOLVER_CONFIG.goalAttainmentToleranceKg,
        practicalResolutionKcal: null,
        localSensitivityKgPer100Kcal: null,
        robustnessClassification: null,
        forecastQuality: null,
        predictiveSpread90Kg: null,
      },
      provenance: { initialStateQuality: result.initialStateQuality, forecastStatus: null },
      assumptions: submittedAssumptions,
      warnings: warningCodes(result.status),
      forecast: null,
      reason: result.reason,
    };
  }

  const status = publicStatus(result);
  const terminalDate = result.forecast?.dates.at(-1)?.date ?? null;
  if (result.terminal && terminalDate !== result.goal.goalDate) {
    throw new Error("goal planning terminal date does not match the requested calendar date");
  }
  return {
    status,
    solverStatus: result.status,
    solverVersion: result.solverVersion,
    modelVersion: result.modelVersion,
    forecastVersion: result.forecastVersion,
    recoveryVersion: result.recoveryVersion,
    goal: result.goal,
    control: {
      solvedCaloriesKcal: result.control.solvedValueKcal,
      constraintBoundary: result.control.constraintBoundary,
      boundaryReason: result.control.boundaryReason,
    },
    terminal: result.terminal && terminalDate ? {
      mean: result.terminal.mean,
      p05: result.terminal.p05,
      p25: result.terminal.p25,
      median: result.terminal.median,
      p75: result.terminal.p75,
      p95: result.terminal.p95,
      date: terminalDate,
      targetErrorKg: result.terminal.targetErrorKg,
      attainment: {
        direction: result.terminal.attainment.direction,
        definition: result.terminal.attainment.definition,
        probability: result.terminal.attainment.probability,
        successes: result.terminal.attainment.successes,
        sampleCount: result.terminal.attainment.sampleCount,
        probabilityMonteCarloInterval: result.terminal.attainment.monteCarloInterval,
      },
    } : null,
    feasibility: result.feasibility,
    numerical: {
      solverToleranceKg: result.searchDiagnostics.targetToleranceKg,
      goalToleranceKg: DEFAULT_TARGET_SOLVER_CONFIG.goalAttainmentToleranceKg,
      practicalResolutionKcal: result.robustness.meaningfulResolutionKcal,
      localSensitivityKgPer100Kcal: result.robustness.sensitivityKgPer100Kcal,
      robustnessClassification: result.robustness.classification,
      forecastQuality: result.quality.numericalQuality?.classification ?? null,
      predictiveSpread90Kg: result.feasibility.predictiveIntervalWidth90Kg,
    },
    provenance: {
      initialStateQuality: result.quality.initialStateQuality,
      forecastStatus: result.quality.forecastStatus,
    },
    assumptions: submittedAssumptions,
    warnings: warningCodes(status, result),
    forecast: result.forecast,
    reason: null,
  };
}

export function scenarioReferenceNutrition(scenario: SolverScenarioTemplate) {
  return scenario.schedule.defaultDay.nutrition;
}
