import { describe, expect, it, vi } from "vitest";
import { boundedTargetSearch } from "@/modules/model-target-solver/target-solver-search";
import type { SolverCandidateEvaluation } from "@/modules/model-target-solver/target-solver.types";

const config = {
  targetToleranceKg: 0.01,
  candidateResolutionKcal: 1,
  monotonicityToleranceKg: 0.02,
  coarseGridPoints: 5,
  maxEvaluations: 20,
};

function candidate(caloriesKcal: number, objectiveKg: number): SolverCandidateEvaluation {
  const terminal = { mean: objectiveKg, p05: objectiveKg, p25: objectiveKg, median: objectiveKg, p75: objectiveKg, p95: objectiveKg };
  return { caloriesKcal, objectiveKg, terminal, nutrition: { caloriesKcal, proteinG: 1, fatG: 1, carbsG: 1 },
    forecast: {} as never, pathCount: 1, stage: "search" };
}

describe("bounded target search", () => {
  it("detects a bracket and refines an increasing objective", async () => {
    const result = await boundedTargetSearch({ minCaloriesKcal: 1_000, maxCaloriesKcal: 3_000, config,
      evaluate: async (value) => candidate(value, (value - 2_137) / 1_000) });
    expect(result.status).toBe("candidate-found");
    expect(result.monotonicity).toBe("monotonic");
    expect(result.bracket).not.toBeNull();
    expect(Math.abs(result.best!.caloriesKcal - 2_137)).toBeLessThanOrEqual(8);
    expect(result.finalBracketWidthKcal).toBeLessThanOrEqual(16);
  });

  it("handles an exact grid hit", async () => {
    const result = await boundedTargetSearch({ minCaloriesKcal: 1_000, maxCaloriesKcal: 3_000, config,
      evaluate: async (value) => candidate(value, value - 2_000) });
    expect(result.best?.caloriesKcal).toBe(2_000);
    expect(result.best?.objectiveKg).toBe(0);
  });

  it("returns not-bracketed without expanding caller bounds", async () => {
    const result = await boundedTargetSearch({ minCaloriesKcal: 1_000, maxCaloriesKcal: 2_000, config,
      evaluate: async (value) => candidate(value, value / 1_000 + 1) });
    expect(result.status).toBe("not-bracketed");
    expect(result.bracket).toBeNull();
    expect(result.evaluations.every(({ caloriesKcal }) => caloriesKcal >= 1_000 && caloriesKcal <= 2_000)).toBe(true);
  });

  it("returns not-bracketed when the target is above every bounded outcome", async () => {
    const result = await boundedTargetSearch({ minCaloriesKcal: 1_000, maxCaloriesKcal: 2_000, config,
      evaluate: async (value) => candidate(value, value / 1_000 - 5) });
    expect(result.status).toBe("not-bracketed");
    expect(result.best?.caloriesKcal).toBe(2_000);
  });

  it("identifies small numerical reversals as approximately monotonic", async () => {
    const result = await boundedTargetSearch({ minCaloriesKcal: 0, maxCaloriesKcal: 4, config: { ...config, candidateResolutionKcal: 0.1 },
      evaluate: async (value) => candidate(value, value === 2 ? -0.005 : value - 2) });
    expect(["monotonic", "approximately-monotonic"]).toContain(result.monotonicity);
  });

  it("falls back to deterministic local refinement for a non-monotonic evaluator", async () => {
    const result = await boundedTargetSearch({ minCaloriesKcal: 0, maxCaloriesKcal: 4, config: { ...config, candidateResolutionKcal: 0.1 },
      evaluate: async (value) => candidate(value, (value - 1.3) ** 2 - 0.01) });
    expect(result.monotonicity).toBe("non-monotonic");
    expect(result.status).toBe("candidate-found");
  });

  it("is reproducible with noisy but deterministic evaluations", async () => {
    const evaluate = async (value: number) => candidate(value, value - 2_000 + Math.sin(value) * 0.001);
    const input = { minCaloriesKcal: 1_000, maxCaloriesKcal: 3_000, config, evaluate };
    expect(await boundedTargetSearch(input)).toEqual(await boundedTargetSearch(input));
  });

  it("honors maximum evaluations", async () => {
    const evaluate = vi.fn(async (value: number) => candidate(value, value - 2_137));
    const result = await boundedTargetSearch({ minCaloriesKcal: 1_000, maxCaloriesKcal: 3_000,
      config: { ...config, maxEvaluations: 6 }, evaluate });
    expect(evaluate).toHaveBeenCalledTimes(6);
    expect(result.maximumEvaluationsReached).toBe(true);
  });

  it("returns no-valid-candidate when all candidates are rejected", async () => {
    const result = await boundedTargetSearch({ minCaloriesKcal: 1, maxCaloriesKcal: 2, config,
      evaluate: async () => null });
    expect(result.status).toBe("no-valid-candidate");
    expect(result.best).toBeNull();
  });
});
