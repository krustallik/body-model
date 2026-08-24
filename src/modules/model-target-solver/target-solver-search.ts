import type {
  SearchMonotonicity,
  SolverCandidateEvaluation,
  SolverSearchResult,
  TargetSolverConfig,
} from "./target-solver.types";

export type SearchEvaluation = (caloriesKcal: number) => Promise<SolverCandidateEvaluation | null>;

function uniqueSorted(values: readonly number[]): number[] {
  return [...new Set(values.map((value) => Number(value.toFixed(9))))].sort((a, b) => a - b);
}

function classifyMonotonicity(
  evaluations: readonly SolverCandidateEvaluation[],
  toleranceKg: number,
): SearchMonotonicity {
  let approximate = false;
  for (let index = 1; index < evaluations.length; index += 1) {
    const delta = evaluations[index].objectiveKg - evaluations[index - 1].objectiveKg;
    if (delta < -toleranceKg) return "non-monotonic";
    if (delta < 0) approximate = true;
  }
  return approximate ? "approximately-monotonic" : "monotonic";
}

function bestOf(evaluations: readonly SolverCandidateEvaluation[]): SolverCandidateEvaluation | null {
  return evaluations.reduce<SolverCandidateEvaluation | null>((best, candidate) => {
    if (!best || Math.abs(candidate.objectiveKg) < Math.abs(best.objectiveKg)
        || (Math.abs(candidate.objectiveKg) === Math.abs(best.objectiveKg)
          && candidate.caloriesKcal < best.caloriesKcal)) return candidate;
    return best;
  }, null);
}

function findBracket(evaluations: readonly SolverCandidateEvaluation[]): [SolverCandidateEvaluation, SolverCandidateEvaluation] | null {
  for (let index = 0; index < evaluations.length; index += 1) {
    const current = evaluations[index];
    if (current.objectiveKg === 0) return [current, current];
    const next = evaluations[index + 1];
    if (next && Math.sign(current.objectiveKg) !== Math.sign(next.objectiveKg)) return [current, next];
  }
  return null;
}

export async function boundedTargetSearch(input: {
  minCaloriesKcal: number;
  maxCaloriesKcal: number;
  config: Pick<TargetSolverConfig,
    "targetToleranceKg" | "candidateResolutionKcal" | "monotonicityToleranceKg" | "coarseGridPoints" | "maxEvaluations">;
  evaluate: SearchEvaluation;
}): Promise<SolverSearchResult> {
  const evaluations = new Map<number, SolverCandidateEvaluation>();
  let attempted = 0;
  const evaluate = async (value: number): Promise<SolverCandidateEvaluation | null> => {
    const caloriesKcal = Math.min(input.maxCaloriesKcal, Math.max(input.minCaloriesKcal, value));
    const key = Number(caloriesKcal.toFixed(9));
    const existing = evaluations.get(key);
    if (existing) return existing;
    if (attempted >= input.config.maxEvaluations) return null;
    attempted += 1;
    const result = await input.evaluate(key);
    if (result) evaluations.set(key, result);
    return result;
  };
  const grid = Array.from({ length: input.config.coarseGridPoints }, (_, index) => (
    input.minCaloriesKcal
      + (input.maxCaloriesKcal - input.minCaloriesKcal) * index / (input.config.coarseGridPoints - 1)
  ));
  for (const value of grid) await evaluate(value);
  let ordered = uniqueSorted([...evaluations.keys()]).map((key) => evaluations.get(key)!);
  if (ordered.length === 0) return {
    status: "no-valid-candidate", best: null, evaluations: [], rejected: [], monotonicity: "monotonic",
    bracket: null, finalBracketWidthKcal: null, maximumEvaluationsReached: attempted >= input.config.maxEvaluations,
  };
  const monotonicity = classifyMonotonicity(ordered, input.config.monotonicityToleranceKg);
  let bracket = findBracket(ordered);

  if (monotonicity === "non-monotonic") {
    while (attempted < input.config.maxEvaluations) {
      ordered = uniqueSorted([...evaluations.keys()]).map((key) => evaluations.get(key)!);
      const best = bestOf(ordered)!;
      if (Math.abs(best.objectiveKg) <= input.config.targetToleranceKg) break;
      const bestIndex = ordered.indexOf(best);
      const left = ordered[Math.max(0, bestIndex - 1)].caloriesKcal;
      const right = ordered[Math.min(ordered.length - 1, bestIndex + 1)].caloriesKcal;
      if (right - left <= input.config.candidateResolutionKcal) break;
      const candidates = uniqueSorted([(left + best.caloriesKcal) / 2, (best.caloriesKcal + right) / 2]);
      let added = false;
      for (const candidate of candidates) {
        const before = evaluations.size;
        await evaluate(candidate);
        added ||= evaluations.size > before;
      }
      if (!added) break;
    }
    ordered = uniqueSorted([...evaluations.keys()]).map((key) => evaluations.get(key)!);
    bracket = findBracket(ordered);
    return {
      status: bestOf(ordered) ? "candidate-found" : "search-failed",
      best: bestOf(ordered), evaluations: ordered, rejected: [], monotonicity, bracket: bracket ? {
        lowerCaloriesKcal: bracket[0].caloriesKcal, upperCaloriesKcal: bracket[1].caloriesKcal,
      } : null,
      finalBracketWidthKcal: bracket ? bracket[1].caloriesKcal - bracket[0].caloriesKcal : null,
      maximumEvaluationsReached: attempted >= input.config.maxEvaluations,
    };
  }

  if (!bracket) return {
    status: "not-bracketed", best: bestOf(ordered), evaluations: ordered, rejected: [], monotonicity,
    bracket: null, finalBracketWidthKcal: null, maximumEvaluationsReached: attempted >= input.config.maxEvaluations,
  };
  let [lower, upper] = bracket;
  while (attempted < input.config.maxEvaluations
      && upper.caloriesKcal - lower.caloriesKcal > input.config.candidateResolutionKcal
      && Math.abs(bestOf([lower, upper])!.objectiveKg) > input.config.targetToleranceKg) {
    const midpoint = await evaluate((lower.caloriesKcal + upper.caloriesKcal) / 2);
    if (!midpoint) break;
    if (midpoint.objectiveKg === 0) {
      lower = midpoint;
      upper = midpoint;
      break;
    }
    if (Math.sign(lower.objectiveKg) === Math.sign(midpoint.objectiveKg)) lower = midpoint;
    else upper = midpoint;
  }
  ordered = uniqueSorted([...evaluations.keys()]).map((key) => evaluations.get(key)!);
  return {
    status: "candidate-found", best: bestOf(ordered), evaluations: ordered, rejected: [], monotonicity,
    bracket: { lowerCaloriesKcal: lower.caloriesKcal, upperCaloriesKcal: upper.caloriesKcal },
    finalBracketWidthKcal: upper.caloriesKcal - lower.caloriesKcal,
    maximumEvaluationsReached: attempted >= input.config.maxEvaluations,
  };
}

