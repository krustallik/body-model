import { describe, expect, it } from "vitest";
import type { ForecastResult } from "@/modules/model-forecast/forecast.types";
import { buildGoalPlanningRequest, calendarDaysBetween, defaultGoalForm, goalStatusPresentation, probabilityDefinition, roundedPlanCalories } from "@/modules/model-goal-planning/goal-planning-ui";
import { serializeGoalPlanningResult } from "@/modules/model-goal-planning/goal-planning";
import type { GoalPlanningRequest } from "@/modules/model-goal-planning/goal-planning.schema";
import type { TargetSolverBlockedResult, TargetSolverResult } from "@/modules/model-target-solver/target-solver.types";

function request(): GoalPlanningRequest {
  const built = buildGoalPlanningRequest(defaultGoalForm("2026-10-19", 82), "2026-10-19");
  if (!built.request) throw new Error("expected valid request");
  return built.request;
}

function forecast(quality: "standard" | "limited-long-horizon" = "standard", initialStateQuality: "deterministic" | "recovered" | "degraded" = "deterministic"): ForecastResult {
  const summary = { mean: 79, p05: 77, p25: 78, median: 79, p75: 80, p95: 81 };
  return {
    status: initialStateQuality === "degraded" ? "degraded" : "ok", forecastVersion: "bodycast-forecast-v1",
    modelVersion: "bodycast-physiology-v4", recoveryVersion: initialStateQuality === "deterministic" ? null : "bodycast-recovery-v3",
    sourceFingerprint: "source", scenarioFingerprint: "scenario", initialStateQuality, horizonDays: 90,
    scenarioProvenance: { mode: "target-centered", nutrition: "joint-target-distribution", activity: "stochastic-adherence",
      donorEvidence: { donorDayCount: 0, source: "explicit-scenario", nutritionLogStandardDeviation: 0.2,
        macroCompositionLogStandardDeviation: 0.1, walkingLogStandardDeviation: 0.3 } },
    dates: [{ date: "2027-01-17", physiologicalBodyWeightKg: summary } as never],
    diagnostics: { seed: 20_260_824, generatedPathCount: 512, validPathCount: 512, invalidPathCount: 0,
      invalidPathReasons: {}, startingParticleCount: 1, startingParticleResampling: "none-single-state",
      uncertaintySources: { initialState: initialStateQuality !== "deterministic", futureBehavior: true, measurement: false, modelParameters: false },
      ecfPolicy: "hold-ecf", ecfLimitation: null, latentPhysiologicalWeightOnly: true, current: true,
      numericalQuality: { classification: quality, pathCount: 512, recommendedMinimumPathCount: quality === "standard" ? 512 : 1024,
        pathCountAdequateForHorizon: quality === "standard", uniqueStartingStateCount: 1, availableStartingStateCount: 1,
        outerQuantileRankStandardErrorProbability: 0.01, note: "test" } },
  };
}

function solved(overrides: Partial<TargetSolverResult> = {}): TargetSolverResult {
  const finalForecast = overrides.forecast ?? forecast();
  return {
    status: "solved", solverVersion: "bodycast-target-solver-v1", modelVersion: "bodycast-physiology-v4",
    forecastVersion: "bodycast-forecast-v1", recoveryVersion: finalForecast.recoveryVersion,
    goal: { metric: "weightKg", targetValueKg: 79, goalDate: "2027-01-17", horizonDays: 90 },
    control: { type: "daily-calorie-center", constraints: { minCaloriesKcal: 1500, maxCaloriesKcal: 3300 },
      nutritionAdjustmentPolicy: { type: "proportional-template" }, solvedValueKcal: 2243.75,
      constraintBoundary: null, boundaryReason: null },
    scenario: request().scenarioTemplate,
    terminal: { mean: 79, p05: 77, p25: 78, median: 79, p75: 80, p95: 81, targetErrorKg: 0,
      targetAttainmentProbability: 0.64, attainment: { direction: "loss", definition: "at-or-below-target",
        probability: 0.64, successes: 328, sampleCount: 512,
        monteCarloInterval: { confidenceLevel: 0.95, lower: 0.598, upper: 0.68, method: "wilson-score" } } },
    feasibility: { status: "feasible", constraints: "satisfied", bracketing: "bracketed", convergence: "within-tolerance",
      initialState: finalForecast.initialStateQuality, forecastNumericalQuality: finalForecast.diagnostics.numericalQuality.classification,
      predictiveIntervalWidth90Kg: 4, solverResidualKg: 0, responseShape: "monotonic" },
    robustness: { deltaKcal: 100, lower: null, upper: null, sensitivityKgPer100Kcal: 0.96,
      meaningfulResolutionKcal: 20, resolutionDiagnostics: { configuredCandidateSpacingKcal: 10, finalBracketWidthKcal: 10,
        endpointToleranceEquivalentKcal: 5, monteCarloShiftEquivalentKcal: 20, searchToFinalMedianShiftKg: 0.02 },
      neighboringCandidatesEffectivelyEquivalent: false, classification: "stable", commonRandomNumbers: true },
    quality: { initialStateQuality: finalForecast.initialStateQuality, forecastStatus: finalForecast.status,
      numericalQuality: finalForecast.diagnostics.numericalQuality, solverQuality: "standard" },
    searchDiagnostics: { seed: 20_260_824, commonRandomNumbers: true, objective: "terminal-weight-median-minus-target",
      evaluations: [], rejectedCandidates: [], bracket: { lowerCaloriesKcal: 2230, upperCaloriesKcal: 2250 },
      finalBracketWidthKcal: 20, monotonicity: "monotonic", initialMonotonicity: "monotonic",
      monotonicityConfirmation: { status: "not-required", pathCount: null, suspiciousCaloriesKcal: [] },
      targetToleranceKg: 0.05, candidateResolutionKcal: 10, searchPathCount: 128, finalPathCount: 512,
      finalVerificationEvaluations: 1, maximumEvaluationsReached: false, finalVerificationWithinTolerance: true },
    forecast: finalForecast,
    ...overrides,
  };
}

describe("goal planning application support", () => {
  it("derives editable convenience defaults without inventing a state", () => {
    expect(defaultGoalForm()).toMatchObject({ targetWeightKg: "", goalDate: "", minCaloriesKcal: "1500", maxCaloriesKcal: "3300" });
    expect(defaultGoalForm("2026-10-19", 82)).toMatchObject({ targetWeightKg: "79", goalDate: "2027-01-17" });
  });

  it("builds an explicit solver scenario and preserves zero separately from missing", () => {
    const values = defaultGoalForm("2026-10-19", 82);
    values.minProteinG = "0";
    values.maxProteinG = "";
    values.plan.strengthDaysPerWeek = 0;
    values.plan.strengthTrainingMinutes = 0;
    const built = buildGoalPlanningRequest(values, "2026-10-19");
    expect(built.errors).toEqual({});
    expect(built.request?.constraints).toMatchObject({ minProteinG: 0 });
    expect(built.request?.constraints.maxProteinG).toBeUndefined();
    expect(built.request?.scenarioTemplate.schedule.strengthByWeekday).toEqual({ "0": 0, "1": 0, "2": 0, "3": 0, "4": 0, "5": 0, "6": 0 });
  });

  it("rejects missing/non-finite values, invalid bounds, and non-future dates", () => {
    const missing = defaultGoalForm("2026-10-19", null);
    missing.maxCaloriesKcal = "Infinity";
    missing.goalDate = "2026-10-19";
    const invalid = buildGoalPlanningRequest(missing, "2026-10-19");
    expect(invalid.request).toBeNull();
    expect(invalid.errors).toMatchObject({ targetWeightKg: expect.any(String), maxCaloriesKcal: expect.any(String), goalDate: expect.any(String) });
    const impossibleDate = defaultGoalForm("2026-01-31", 82);
    impossibleDate.goalDate = "2026-02-31";
    expect(buildGoalPlanningRequest(impossibleDate, "2026-01-31").errors.goalDate)
      .toBe("Enter a valid calendar date");
    const reversed = defaultGoalForm("2026-10-19", 82);
    reversed.minCaloriesKcal = "3300"; reversed.maxCaloriesKcal = "1500";
    reversed.minFatG = "100"; reversed.maxFatG = "50";
    expect(buildGoalPlanningRequest(reversed, "2026-10-19").errors).toMatchObject({ minCaloriesKcal: expect.any(String), minFatG: expect.any(String) });
  });

  it("keeps calendar dates consecutive across the late-October DST transition", () => {
    expect(calendarDaysBetween("2026-10-24", "2026-10-27")).toBe(3);
  });

  it("rounds only through the solver practical resolution", () => {
    expect(roundedPlanCalories(2243.75, 20)).toBe(2240);
    expect(roundedPlanCalories(2243.75, 100)).toBe(2200);
    expect(() => roundedPlanCalories(2243.75, 0)).toThrow(/resolution/);
  });

  it("serializes compact probability, trajectory, assumptions, and numerical quality", () => {
    const response = serializeGoalPlanningResult(request(), solved());
    expect(response).toMatchObject({ status: "solved", control: { solvedCaloriesKcal: 2243.75 },
      terminal: { date: "2027-01-17", p05: 77, median: 79, p95: 81,
        attainment: { probability: 0.64, probabilityMonteCarloInterval: { method: "wilson-score" } } },
      numerical: { solverToleranceKg: 0.05, goalToleranceKg: 0.5, practicalResolutionKcal: 20,
        localSensitivityKgPer100Kcal: 0.96, forecastQuality: "standard" } });
    const json = JSON.stringify(response);
    expect(json).not.toMatch(/terminalPhysiologicalBodyWeightSamplesKg|searchDiagnostics|initialParticles|recoveryParticles/);
    expect(response.forecast?.dates).toHaveLength(1);
  });

  it("normalizes no-valid-candidate into constraint and forecast quality statuses", () => {
    const constrained = solved({ status: "no-valid-candidate", terminal: null, forecast: null,
      feasibility: { ...solved().feasibility, status: "constraint-limited", constraints: "no-valid-candidate" } });
    const unreliable = solved({ status: "no-valid-candidate", terminal: null, forecast: null,
      feasibility: { ...solved().feasibility, status: "forecast-unreliable" } });
    expect(serializeGoalPlanningResult(request(), constrained).status).toBe("constraint-limited");
    expect(serializeGoalPlanningResult(request(), unreliable).status).toBe("forecast-unreliable");
  });

  it("propagates boundary, degraded, recovered, and long-horizon warnings", () => {
    const boundary = solved({ status: "solved-at-boundary", forecast: forecast("limited-long-horizon", "degraded"),
      control: { ...solved().control, constraintBoundary: "min", boundaryReason: "target-statistic-reached-at-caller-bound" } });
    expect(serializeGoalPlanningResult(request(), boundary).warnings).toEqual(expect.arrayContaining(["caller-boundary", "degraded-initial-state", "limited-long-horizon"]));
    expect(serializeGoalPlanningResult(request(), solved({ forecast: forecast("standard", "recovered") })).warnings).toContain("recovered-initial-state");
  });

  it("serializes blocked current states without a fake plan", () => {
    const blocked: TargetSolverBlockedResult = { status: "initial-state-unavailable", solverVersion: "bodycast-target-solver-v1",
      modelVersion: "bodycast-physiology-v4", forecastVersion: "bodycast-forecast-v1", recoveryVersion: "bodycast-recovery-v3",
      initialStateQuality: "awaiting", reason: "stale recovery" };
    const response = serializeGoalPlanningResult(request(), blocked);
    expect(response).toMatchObject({ status: "initial-state-unavailable", control: { solvedCaloriesKcal: null }, terminal: null, forecast: null });
  });

  it.each(["solved", "solved-at-boundary", "numerically-limited", "not-bracketed", "constraint-limited",
    "forecast-unreliable", "non-monotonic", "search-failed", "initial-state-unavailable", "initial-state-unreliable"] as const)
  ("provides specific product wording for %s", (status) => {
    const copy = goalStatusPresentation(status, "uk");
    expect(copy.title.length).toBeGreaterThan(5);
    expect(copy.detail).not.toMatch(/ви досягнете|біологічно неможливо/i);
  });

  it("explains directional and maintenance probability without reconstructing quantiles", () => {
    const response = serializeGoalPlanningResult(request(), solved());
    expect(probabilityDefinition(response, "en")).toMatch(/at or below/);
    response.terminal!.attainment.direction = "maintenance";
    expect(probabilityDefinition(response, "en")).toContain("±0.5 kg");
  });
});
