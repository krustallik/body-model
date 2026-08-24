import type { ForecastBlockedResult, ForecastResult } from "@/modules/model-forecast/forecast.types";
import { nutritionConstraintViolation, proportionalNutrition, scenarioWithNutrition } from "./nutrition-control";
import { boundedTargetSearch } from "./target-solver-search";
import { empiricalTargetAttainment } from "./target-probability";
import {
  DEFAULT_TARGET_SOLVER_CONFIG,
  TARGET_SOLVER_VERSION,
  type CandidateForecastEvaluator,
  type CandidateForecastEvaluation,
  type MonotonicityConfirmation,
  type RejectedSolverCandidate,
  type SolverCandidateEvaluation,
  type SolverScenarioTemplate,
  type TargetSolverBlockedResult,
  type TargetSolverConfig,
  type TargetSolverRequest,
  type TargetSolverResult,
} from "./target-solver.types";

function resolvedConfig(config?: Partial<TargetSolverConfig>): TargetSolverConfig {
  const result = { ...DEFAULT_TARGET_SOLVER_CONFIG, ...config };
  if (config?.monotonicityConfirmationPathCount === undefined) {
    result.monotonicityConfirmationPathCount = Math.max(
      DEFAULT_TARGET_SOLVER_CONFIG.monotonicityConfirmationPathCount,
      result.searchPathCount * 4,
    );
  }
  if (!(result.targetToleranceKg > 0) || !(result.candidateResolutionKcal > 0)
      || !(result.goalAttainmentToleranceKg >= 0) || !(result.robustnessDeltaKcal > 0)
      || !(result.monotonicityToleranceKg >= 0)
      || !Number.isInteger(result.monotonicityConfirmationPathCount)
      || result.monotonicityConfirmationPathCount <= result.searchPathCount
      || !Number.isInteger(result.coarseGridPoints) || result.coarseGridPoints < 3
      || !Number.isInteger(result.maxEvaluations) || result.maxEvaluations < result.coarseGridPoints
      || !Number.isInteger(result.searchPathCount) || result.searchPathCount < 1
      || !Number.isInteger(result.finalPathCount) || result.finalPathCount < 1) {
    throw new RangeError("invalid target solver configuration");
  }
  return result;
}

function blockedResult(blocked: ForecastBlockedResult): TargetSolverBlockedResult {
  return {
    status: blocked.status,
    solverVersion: TARGET_SOLVER_VERSION,
    modelVersion: blocked.modelVersion,
    forecastVersion: blocked.forecastVersion,
    recoveryVersion: blocked.recoveryVersion,
    initialStateQuality: blocked.initialStateQuality,
    reason: blocked.reason,
  };
}

function isBlockedForecast(value: CandidateForecastEvaluation | ForecastBlockedResult): value is ForecastBlockedResult {
  return "status" in value;
}

function resultBase(input: {
  request: TargetSolverRequest;
  horizonDays: number;
  config: TargetSolverConfig;
  search: Awaited<ReturnType<typeof boundedTargetSearch>>;
  rejected: RejectedSolverCandidate[];
  finalForecast: ForecastResult | null;
  finalScenario: SolverScenarioTemplate | null;
  finalVerificationEvaluations: number;
  initialMonotonicity: TargetSolverResult["searchDiagnostics"]["initialMonotonicity"];
  monotonicityConfirmation: MonotonicityConfirmation;
}): Omit<TargetSolverResult, "status" | "modelVersion" | "forecastVersion" | "recoveryVersion" | "terminal"
  | "feasibility" | "robustness"> {
  const best = input.search.best;
  const calories = best?.caloriesKcal ?? null;
  const boundary = calories === input.request.control.constraints.minCaloriesKcal ? "min"
    : calories === input.request.control.constraints.maxCaloriesKcal ? "max" : null;
  const verificationError = input.finalForecast && best
    ? input.finalForecast.dates.at(-1)!.physiologicalBodyWeightKg.median - input.request.goal.targetValueKg : null;
  return {
    solverVersion: TARGET_SOLVER_VERSION,
    goal: { ...input.request.goal, horizonDays: input.horizonDays },
    control: { ...input.request.control, solvedValueKcal: calories, constraintBoundary: boundary,
      boundaryReason: boundary ? "target-statistic-reached-at-caller-bound" : null },
    scenario: input.finalScenario,
    quality: {
      initialStateQuality: input.finalForecast?.initialStateQuality ?? best?.forecast.initialStateQuality ?? null,
      forecastStatus: input.finalForecast?.status ?? best?.forecast.status ?? null,
      numericalQuality: input.finalForecast?.diagnostics.numericalQuality ?? best?.forecast.diagnostics.numericalQuality ?? null,
      solverQuality: input.monotonicityConfirmation.status === "confirmed-non-monotonic" ? "non-monotonic-response"
        : verificationError !== null && Math.abs(verificationError) > input.config.targetToleranceKg
          ? "final-verification-outside-tolerance" : best ? "standard" : "unresolved",
    },
    searchDiagnostics: {
      seed: input.request.seed,
      commonRandomNumbers: true,
      objective: "terminal-weight-median-minus-target",
      evaluations: input.search.evaluations,
      rejectedCandidates: input.rejected,
      bracket: input.search.bracket,
      finalBracketWidthKcal: input.search.finalBracketWidthKcal,
      monotonicity: input.search.monotonicity,
      initialMonotonicity: input.initialMonotonicity,
      monotonicityConfirmation: input.monotonicityConfirmation,
      targetToleranceKg: input.config.targetToleranceKg,
      candidateResolutionKcal: input.config.candidateResolutionKcal,
      searchPathCount: input.config.searchPathCount,
      finalPathCount: input.config.finalPathCount,
      finalVerificationEvaluations: input.finalVerificationEvaluations,
      maximumEvaluationsReached: input.search.maximumEvaluationsReached,
      finalVerificationWithinTolerance: verificationError === null
        ? null : Math.abs(verificationError) <= input.config.targetToleranceKg,
    },
    forecast: input.finalForecast,
  };
}

export async function solveWeightTarget(input: {
  request: TargetSolverRequest;
  horizonDays: number;
  evaluateForecast: CandidateForecastEvaluator;
}): Promise<TargetSolverResult | TargetSolverBlockedResult> {
  if (!Number.isInteger(input.horizonDays) || input.horizonDays <= 0) {
    throw new RangeError("goal date must produce a positive forecast horizon");
  }
  const config = resolvedConfig(input.request.solverConfig);
  const constraints = input.request.control.constraints;
  if (!(constraints.minCaloriesKcal > 0 && constraints.maxCaloriesKcal > constraints.minCaloriesKcal)) {
    throw new RangeError("calorie bounds must be finite, positive, and ordered");
  }
  const reference = input.request.scenarioTemplate.schedule.defaultDay.nutrition;
  const rejected: RejectedSolverCandidate[] = [];
  let blocked: ForecastBlockedResult | null = null;
  const artifacts = new Map<string, CandidateForecastEvaluation>();
  const extraEvaluations: SolverCandidateEvaluation[] = [];
  const evaluate = async (
    caloriesKcal: number,
    pathCount: number,
    stage: SolverCandidateEvaluation["stage"],
  ): Promise<SolverCandidateEvaluation | null> => {
    const nutrition = proportionalNutrition(reference, caloriesKcal);
    const violation = nutritionConstraintViolation(nutrition, constraints);
    if (violation) {
      rejected.push({ caloriesKcal, reason: violation });
      return null;
    }
    const scenario = scenarioWithNutrition(input.request.scenarioTemplate, nutrition);
    const evaluation = await input.evaluateForecast({ caloriesKcal, scenario, pathCount });
    if (isBlockedForecast(evaluation)) {
      blocked = evaluation;
      return null;
    }
    const forecast = evaluation.forecast;
    const terminal = forecast.dates.at(-1)?.physiologicalBodyWeightKg;
    if (!terminal || !Number.isFinite(terminal.median)) {
      rejected.push({ caloriesKcal, reason: "forecast-unreliable" });
      return null;
    }
    artifacts.set(`${pathCount}:${caloriesKcal}`, evaluation);
    const result: SolverCandidateEvaluation = {
      caloriesKcal,
      nutrition,
      objectiveKg: terminal.median - input.request.goal.targetValueKg,
      terminal,
      forecast,
      pathCount,
      stage,
    };
    if (stage !== "search") extraEvaluations.push(result);
    return result;
  };
  const search = await boundedTargetSearch({
    minCaloriesKcal: constraints.minCaloriesKcal,
    maxCaloriesKcal: constraints.maxCaloriesKcal,
    config,
    evaluate: (caloriesKcal) => evaluate(caloriesKcal, config.searchPathCount, "search"),
  });
  if (blocked) return blockedResult(blocked);
  const initialMonotonicity = search.monotonicity;
  let monotonicityConfirmation: MonotonicityConfirmation = {
    status: "not-required", pathCount: null, suspiciousCaloriesKcal: [],
  };
  if (initialMonotonicity === "non-monotonic") {
    const ordered = [...search.evaluations].sort((a, b) => a.caloriesKcal - b.caloriesKcal);
    const suspicious = new Set<number>();
    for (let index = 1; index < ordered.length; index += 1) {
      if (ordered[index].objectiveKg - ordered[index - 1].objectiveKg < -config.monotonicityToleranceKg) {
        suspicious.add(ordered[index - 1].caloriesKcal);
        suspicious.add(ordered[index].caloriesKcal);
      }
    }
    const suspiciousCaloriesKcal = [...suspicious].sort((a, b) => a - b);
    const gapRejected = rejected.some(({ caloriesKcal, reason }) => {
      const lower = suspiciousCaloriesKcal.at(0);
      const upper = suspiciousCaloriesKcal.at(-1);
      return reason !== "forecast-unreliable" && lower !== undefined && upper !== undefined
        && caloriesKcal > lower && caloriesKcal < upper;
    });
    if (gapRejected) {
      monotonicityConfirmation = { status: "constraint-discontinuity", pathCount: null, suspiciousCaloriesKcal };
    } else {
      const confirmed: SolverCandidateEvaluation[] = [];
      for (const caloriesKcal of suspiciousCaloriesKcal) {
        const candidate = await evaluate(caloriesKcal, config.monotonicityConfirmationPathCount,
          "monotonicity-confirmation");
        if (candidate) confirmed.push(candidate);
      }
      if (blocked) return blockedResult(blocked);
      const complete = confirmed.length === suspiciousCaloriesKcal.length;
      const persists = complete && confirmed.some((candidate, index) => index > 0
        && candidate.objectiveKg - confirmed[index - 1].objectiveKg < -config.monotonicityToleranceKg);
      monotonicityConfirmation = {
        status: !complete ? "inconclusive" : persists ? "confirmed-non-monotonic" : "monte-carlo-artifact",
        pathCount: config.monotonicityConfirmationPathCount,
        suspiciousCaloriesKcal,
      };
      if (!persists && complete) search.monotonicity = "approximately-monotonic";
    }
  }
  let finalForecast: ForecastResult | null = null;
  let finalArtifacts: CandidateForecastEvaluation | null = null;
  let finalScenario: SolverScenarioTemplate | null = null;
  let finalVerificationEvaluations = 0;
  if (search.best) {
    finalScenario = scenarioWithNutrition(input.request.scenarioTemplate, search.best.nutrition);
    const final = await evaluate(search.best.caloriesKcal, config.finalPathCount, "final-verification");
    if (blocked) return blockedResult(blocked);
    if (!final) throw new Error("final target-solver candidate became invalid");
    finalVerificationEvaluations += 1;
    finalForecast = final.forecast;
    finalArtifacts = artifacts.get(`${config.finalPathCount}:${final.caloriesKcal}`)!;
    let current: SolverCandidateEvaluation = final;
    let previous: SolverCandidateEvaluation | null = null;
    for (let refinement = 0; refinement < 4
        && Math.abs(current.objectiveKg) > config.targetToleranceKg; refinement += 1) {
      const ordered = [...search.evaluations].sort((a, b) => a.caloriesKcal - b.caloriesKcal);
      const nearest = [...ordered].sort((a, b) => (
        Math.abs(a.caloriesKcal - current.caloriesKcal) - Math.abs(b.caloriesKcal - current.caloriesKcal)
      ));
      const slope = previous && current.caloriesKcal !== previous.caloriesKcal
        ? (current.objectiveKg - previous.objectiveKg) / (current.caloriesKcal - previous.caloriesKcal)
        : nearest.length >= 2 && nearest[0].caloriesKcal !== nearest[1].caloriesKcal
          ? (nearest[0].objectiveKg - nearest[1].objectiveKg) / (nearest[0].caloriesKcal - nearest[1].caloriesKcal)
          : Number.NaN;
      if (!(slope > 0)) break;
      const raw = current.caloriesKcal - current.objectiveKg / slope;
      const proposed = Math.min(constraints.maxCaloriesKcal, Math.max(constraints.minCaloriesKcal,
        Math.round(raw / config.candidateResolutionKcal) * config.candidateResolutionKcal));
      if (proposed === current.caloriesKcal) break;
      const refined = await evaluate(proposed, config.finalPathCount, "final-verification");
      if (!refined || blocked) break;
      previous = current;
      current = refined;
      finalVerificationEvaluations += 1;
      search.best = refined;
      finalForecast = refined.forecast;
      finalArtifacts = artifacts.get(`${config.finalPathCount}:${refined.caloriesKcal}`)!;
      finalScenario = scenarioWithNutrition(input.request.scenarioTemplate, refined.nutrition);
    }
    if (blocked) return blockedResult(blocked);
  }
  let robustnessLower: SolverCandidateEvaluation | null = null;
  let robustnessUpper: SolverCandidateEvaluation | null = null;
  if (search.best) {
    const lowerCalories = search.best.caloriesKcal - config.robustnessDeltaKcal;
    const upperCalories = search.best.caloriesKcal + config.robustnessDeltaKcal;
    if (lowerCalories >= constraints.minCaloriesKcal) {
      robustnessLower = await evaluate(lowerCalories, config.finalPathCount, "robustness");
    }
    if (upperCalories <= constraints.maxCaloriesKcal) {
      robustnessUpper = await evaluate(upperCalories, config.finalPathCount, "robustness");
    }
    if (blocked) return blockedResult(blocked);
  }
  if (extraEvaluations.length > 0) search.evaluations.push(...extraEvaluations);
  const base = resultBase({ request: input.request, horizonDays: input.horizonDays, config, search, rejected,
    finalForecast, finalScenario, finalVerificationEvaluations, initialMonotonicity, monotonicityConfirmation });
  const terminalSummary = finalForecast?.dates.at(-1)?.physiologicalBodyWeightKg ?? null;
  const attainment = terminalSummary && finalArtifacts ? empiricalTargetAttainment({
    samplesKg: finalArtifacts.terminalPhysiologicalBodyWeightSamplesKg,
    initialWeightKg: finalArtifacts.initialPhysiologicalBodyWeightKg,
    targetWeightKg: input.request.goal.targetValueKg,
    maintenanceToleranceKg: config.goalAttainmentToleranceKg,
  }) : null;
  const terminal = terminalSummary && attainment ? {
    ...terminalSummary,
    targetErrorKg: terminalSummary.median - input.request.goal.targetValueKg,
    targetAttainmentProbability: attainment.probability,
    attainment,
  } : null;
  const boundary = base.control.constraintBoundary;
  const rejectedOnlyForForecastQuality = rejected.length > 0
    && rejected.every(({ reason }) => reason === "forecast-unreliable");
  const withinTolerance = terminal !== null && Math.abs(terminal.targetErrorKg) <= config.targetToleranceKg;
  const nonMonotonic = monotonicityConfirmation.status === "confirmed-non-monotonic";
  const confirmationLimited = monotonicityConfirmation.status === "inconclusive";
  const status: TargetSolverResult["status"] = nonMonotonic ? "non-monotonic"
    : search.status === "candidate-found"
      ? !withinTolerance || confirmationLimited ? "numerically-limited" : boundary ? "solved-at-boundary" : "solved"
      : search.status;
  const feasibilityStatus: TargetSolverResult["feasibility"]["status"] = search.status === "candidate-found"
    ? nonMonotonic ? "non-monotonic" : !withinTolerance || confirmationLimited ? "numerically-limited"
      : boundary ? "feasible-at-boundary" : "feasible"
    : search.status === "no-valid-candidate" ? rejectedOnlyForForecastQuality
      ? "forecast-unreliable" : "constraint-limited"
      : search.status === "not-bracketed" ? "not-bracketed" : "search-failed";
  const sensitivity = robustnessLower && robustnessUpper
    ? (robustnessUpper.terminal.median - robustnessLower.terminal.median)
      / (robustnessUpper.caloriesKcal - robustnessLower.caloriesKcal) * 100
    : null;
  const robustnessClassification: TargetSolverResult["robustness"]["classification"] =
    robustnessLower && robustnessUpper
      && robustnessUpper.terminal.median + config.monotonicityToleranceKg >= robustnessLower.terminal.median
      ? "stable" : search.best && (!robustnessLower || !robustnessUpper) ? "boundary-limited" : "unavailable";
  const matchedSearchToFinalShifts = extraEvaluations
    .filter((candidate) => candidate.stage === "final-verification")
    .flatMap((candidate) => {
      const searchCandidate = search.evaluations.find((searched) => searched.stage === "search"
        && searched.caloriesKcal === candidate.caloriesKcal);
      return searchCandidate ? [Math.abs(candidate.terminal.median - searchCandidate.terminal.median)] : [];
    });
  const searchToFinalMedianShiftKg = matchedSearchToFinalShifts.length > 0
    ? Math.max(...matchedSearchToFinalShifts) : null;
  const slopeKgPerKcal = sensitivity === null ? null : Math.abs(sensitivity / 100);
  const endpointToleranceEquivalentKcal = slopeKgPerKcal && slopeKgPerKcal > Number.EPSILON
    ? config.targetToleranceKg / slopeKgPerKcal : null;
  const monteCarloShiftEquivalentKcal = slopeKgPerKcal && slopeKgPerKcal > Number.EPSILON
      && searchToFinalMedianShiftKg !== null ? searchToFinalMedianShiftKg / slopeKgPerKcal : null;
  const resolutionInputs = [config.candidateResolutionKcal, search.finalBracketWidthKcal,
    endpointToleranceEquivalentKcal, monteCarloShiftEquivalentKcal]
    .filter((value): value is number => value !== null && Number.isFinite(value));
  const meaningfulResolutionKcal = Math.ceil(Math.max(...resolutionInputs) / config.candidateResolutionKcal)
    * config.candidateResolutionKcal;
  return {
    ...base,
    status,
    modelVersion: finalForecast?.modelVersion ?? search.best?.forecast.modelVersion ?? null,
    forecastVersion: finalForecast?.forecastVersion ?? search.best?.forecast.forecastVersion ?? null,
    recoveryVersion: finalForecast?.recoveryVersion ?? search.best?.forecast.recoveryVersion ?? null,
    terminal,
    feasibility: {
      status: feasibilityStatus,
      constraints: search.status === "no-valid-candidate" && !rejectedOnlyForForecastQuality
        ? "no-valid-candidate" : "satisfied",
      bracketing: search.bracket ? "bracketed"
        : search.status === "no-valid-candidate" ? "not-applicable" : "not-bracketed",
      convergence: terminal ? withinTolerance ? "within-tolerance" : "outside-tolerance" : "no-candidate",
      initialState: base.quality.initialStateQuality,
      forecastNumericalQuality: base.quality.numericalQuality?.classification ?? null,
      predictiveIntervalWidth90Kg: terminal ? terminal.p95 - terminal.p05 : null,
      solverResidualKg: terminal?.targetErrorKg ?? null,
      responseShape: search.monotonicity,
    },
    robustness: {
      deltaKcal: config.robustnessDeltaKcal,
      lower: robustnessLower ? { caloriesKcal: robustnessLower.caloriesKcal,
        terminalMedianKg: robustnessLower.terminal.median, objectiveKg: robustnessLower.objectiveKg } : null,
      upper: robustnessUpper ? { caloriesKcal: robustnessUpper.caloriesKcal,
        terminalMedianKg: robustnessUpper.terminal.median, objectiveKg: robustnessUpper.objectiveKg } : null,
      sensitivityKgPer100Kcal: sensitivity,
      meaningfulResolutionKcal,
      resolutionDiagnostics: {
        configuredCandidateSpacingKcal: config.candidateResolutionKcal,
        finalBracketWidthKcal: search.finalBracketWidthKcal,
        endpointToleranceEquivalentKcal,
        monteCarloShiftEquivalentKcal,
        searchToFinalMedianShiftKg,
      },
      neighboringCandidatesEffectivelyEquivalent: robustnessLower && robustnessUpper && terminal
        ? Math.abs(robustnessUpper.terminal.median - robustnessLower.terminal.median)
          <= Math.max(config.targetToleranceKg, 0.1 * (terminal.p95 - terminal.p05))
        : null,
      classification: robustnessClassification,
      commonRandomNumbers: true,
    },
  };
}
