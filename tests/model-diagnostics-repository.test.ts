import { describe, expect, it, vi } from "vitest";
import type { ModelDatabaseClient } from "@/modules/model-episodes/model-episode.repository";
import { ModelDiagnosticsRepository } from "@/modules/model-diagnostics/model-diagnostics.repository";

describe("ModelDiagnosticsRepository", () => {
  it("loads compact recent evidence without reading WorkInterval rows", async () => {
    const dailyCount = vi.fn()
      .mockResolvedValueOnce(28).mockResolvedValueOnce(25).mockResolvedValueOnce(18)
      .mockResolvedValueOnce(6).mockResolvedValueOnce(1);
    const weightCount = vi.fn().mockResolvedValue(9);
    const dailyFindMany = vi.fn()
      .mockResolvedValueOnce([
        { date: "2026-08-24", status: "complete", energyExpenditureKcal: 2400, dynamicRmrKcalPerDay: 1600 },
        { date: "2026-08-25", status: "complete", energyExpenditureKcal: 2500, dynamicRmrKcalPerDay: 1610 },
      ])
      .mockResolvedValueOnce([
        { date: "2026-08-24", energyExpenditureKcal: 2400 },
        { date: "2026-08-23", energyExpenditureKcal: null },
        { date: "2026-08-22", energyExpenditureKcal: 2350 },
      ]);
    const latestDay = vi.fn().mockResolvedValue({ date: "2026-08-25", status: "incomplete", energyExpenditureKcal: null });
    const client = { dailyModelState: { count: dailyCount, findMany: dailyFindMany, findFirst: latestDay }, dailyHealthData: { count: weightCount } } as unknown as ModelDatabaseClient;
    const result = await new ModelDiagnosticsRepository(client).loadEvidence(7, "2026-07-29", "2026-08-25");
    expect(result).toEqual({
      modeledDayCount: 28, completeDayCount: 25, incompleteDayCount: 3,
      observedNutritionDayCount: 18, imputedNutritionDayCount: 6,
      unresolvedNutritionDayCount: 1, weightObservationCount: 9,
      energyHistory: {
        latestModeledDay: { date: "2026-08-25", status: "incomplete", expenditureKcalPerDay: null },
        previousCompletedDays: [
          { date: "2026-08-22", expenditureKcalPerDay: 2350 },
          { date: "2026-08-23", expenditureKcalPerDay: null },
          { date: "2026-08-24", expenditureKcalPerDay: 2400 },
        ],
      },
    });
    expect(dailyCount).toHaveBeenCalledTimes(5);
    expect(latestDay).toHaveBeenCalledWith({ where: { episodeId: 7, date: "2026-08-25" }, select: { date: true, status: true, energyExpenditureKcal: true } });
    expect(dailyFindMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: { episodeId: 7, date: { lt: "2026-08-25" }, status: "complete" },
      orderBy: { date: "desc" }, take: 7,
    }));
    expect(weightCount).toHaveBeenCalledWith({ where: { date: { gte: "2026-07-29", lte: "2026-08-25" }, weightKg: { gt: 0 } } });
    expect(client).not.toHaveProperty("workInterval");
  });
});

