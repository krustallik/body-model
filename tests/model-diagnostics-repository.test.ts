import { describe, expect, it, vi } from "vitest";
import type { ModelDatabaseClient } from "@/modules/model-episodes/model-episode.repository";
import { ModelDiagnosticsRepository } from "@/modules/model-diagnostics/model-diagnostics.repository";

describe("ModelDiagnosticsRepository", () => {
  it("loads compact recent evidence without reading WorkInterval rows", async () => {
    const dailyCount = vi.fn()
      .mockResolvedValueOnce(28).mockResolvedValueOnce(25).mockResolvedValueOnce(18)
      .mockResolvedValueOnce(6).mockResolvedValueOnce(1);
    const weightCount = vi.fn().mockResolvedValue(9);
    const client = { dailyModelState: { count: dailyCount }, dailyHealthData: { count: weightCount } } as unknown as ModelDatabaseClient;
    const result = await new ModelDiagnosticsRepository(client).loadEvidence(7, "2026-07-29", "2026-08-25");
    expect(result).toEqual({
      modeledDayCount: 28, completeDayCount: 25, incompleteDayCount: 3,
      observedNutritionDayCount: 18, imputedNutritionDayCount: 6,
      unresolvedNutritionDayCount: 1, weightObservationCount: 9,
    });
    expect(dailyCount).toHaveBeenCalledTimes(5);
    expect(weightCount).toHaveBeenCalledWith({ where: { date: { gte: "2026-07-29", lte: "2026-08-25" }, weightKg: { not: null } } });
    expect(client).not.toHaveProperty("workInterval");
  });
});

