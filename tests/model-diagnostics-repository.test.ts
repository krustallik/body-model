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
        { date: "2026-08-22", status: "complete", energyExpenditureKcal: 2350 },
        { date: "2026-08-23", status: "incomplete", energyExpenditureKcal: 2200 },
        { date: "2026-08-24", status: "complete", energyExpenditureKcal: 2400 },
      ]);
    const latestDay = vi.fn().mockResolvedValue({ date: "2026-08-25", status: "incomplete", energyExpenditureKcal: null });
    const client = { dailyModelState: { count: dailyCount, findMany: dailyFindMany, findFirst: latestDay }, dailyHealthData: { count: weightCount } } as unknown as ModelDatabaseClient;
    const result = await new ModelDiagnosticsRepository(client).loadEvidence(7, "2026-07-29", "2026-08-25", "2026-08-25");
    expect(result).toEqual({
      modeledDayCount: 28, completeDayCount: 25, incompleteDayCount: 3,
      observedNutritionDayCount: 18, imputedNutritionDayCount: 6,
      unresolvedNutritionDayCount: 1, weightObservationCount: 9,
      energyHistory: {
        latestModeledDay: { date: "2026-08-25", status: "incomplete", expenditureKcalPerDay: null },
        previousCompletedDays: [
          { date: "2026-08-18", expenditureKcalPerDay: null },
          { date: "2026-08-19", expenditureKcalPerDay: null },
          { date: "2026-08-20", expenditureKcalPerDay: null },
          { date: "2026-08-21", expenditureKcalPerDay: null },
          { date: "2026-08-22", expenditureKcalPerDay: 2350 },
          { date: "2026-08-23", expenditureKcalPerDay: null },
          { date: "2026-08-24", expenditureKcalPerDay: 2400 },
        ],
      },
    });
    expect(dailyCount).toHaveBeenCalledTimes(5);
    expect(latestDay).toHaveBeenCalledWith({ where: { episodeId: 7, date: { equals: "2026-08-25", lte: "2026-08-25" } }, select: { date: true, status: true, energyExpenditureKcal: true } });
    expect(dailyFindMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: { episodeId: 7, date: { gte: "2026-08-18", lt: "2026-08-25" } },
      orderBy: { date: "asc" },
    }));
    expect(weightCount).toHaveBeenCalledWith({ where: { date: { gte: "2026-07-29", lte: "2026-08-25" }, weightKg: { gt: 0 } } });
    expect(client).not.toHaveProperty("workInterval");
  });

  it("keeps history, latest estimates, coverage, and experimental summary inside the current prefix", async () => {
    const storedRows = Array.from({ length: 15 }, (_, index) => {
      const day = index + 1;
      return {
        date: `2026-10-${String(day).padStart(2, "0")}`,
        status: "complete",
        energyExpenditureKcal: day * 100,
        dynamicRmrKcalPerDay: day * 10,
      };
    });
    const dailyCount = vi.fn()
      .mockResolvedValueOnce(9).mockResolvedValueOnce(9).mockResolvedValueOnce(6)
      .mockResolvedValueOnce(2).mockResolvedValueOnce(1);
    const weightCount = vi.fn().mockResolvedValue(4);
    const dailyFindMany = vi.fn()
      .mockResolvedValueOnce(storedRows.slice(0, 9))
      .mockResolvedValueOnce(storedRows.slice(1, 8));
    const latestDay = vi.fn().mockResolvedValue(storedRows[8]);
    const client = {
      dailyModelState: { count: dailyCount, findMany: dailyFindMany, findFirst: latestDay },
      dailyHealthData: { count: weightCount },
      unifiedExperimentalPhysiologyState: { findMany: vi.fn() },
    } as unknown as ModelDatabaseClient;

    const result = await new ModelDiagnosticsRepository(client)
      .loadEvidence(7, "2026-10-01", "2026-10-09", "2026-10-09");

    expect(result).toMatchObject({
      modeledDayCount: 9,
      completeDayCount: 9,
      observedNutritionDayCount: 6,
      imputedNutritionDayCount: 2,
      unresolvedNutritionDayCount: 1,
      weightObservationCount: 4,
      energyHistory: {
        latestModeledDay: { date: "2026-10-09", expenditureKcalPerDay: 900 },
      },
      experimentalEnergySummary: { latestModeledExpenditureKcalPerDay: 900 },
    });
    expect(result.energyHistory?.previousCompletedDays.every((day) => day.date < "2026-10-10")).toBe(true);
    expect(result.energyHistory?.previousCompletedDays.map((day) => day.date)).toEqual([
      "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08",
    ]);
    expect(result.energyHistory?.previousCompletedDays.map((day) => day.expenditureKcalPerDay)).toEqual([200, 300, 400, 500, 600, 700, 800]);
    expect(dailyCount.mock.calls.every(([args]) => args.where.date.lte === "2026-10-09")).toBe(true);
    expect(dailyFindMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: { episodeId: 7, date: { gte: "2026-10-01", lte: "2026-10-09" } },
    }));
    expect(latestDay).toHaveBeenCalledWith(expect.objectContaining({
      where: { episodeId: 7, date: { equals: "2026-10-09", lte: "2026-10-09" } },
    }));
    expect(weightCount).toHaveBeenCalledWith({
      where: { date: { gte: "2026-10-01", lte: "2026-10-09" }, weightKg: { gt: 0 } },
    });
    expect(storedRows.slice(9).map((row) => row.date)).toEqual([
      "2026-10-10", "2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15",
    ]);
  });

  it("does not extend energy history or summary past the latest complete current day", async () => {
    const dailyCount = vi.fn().mockResolvedValue(8);
    const weightCount = vi.fn().mockResolvedValue(3);
    const dailyFindMany = vi.fn()
      .mockResolvedValueOnce([{ date: "2026-10-01", status: "complete", energyExpenditureKcal: 500, dynamicRmrKcalPerDay: 100 }])
      .mockResolvedValueOnce([]);
    const latestDay = vi.fn().mockResolvedValue({
      date: "2026-10-08", status: "complete", energyExpenditureKcal: 800,
    });
    const client = {
      dailyModelState: { count: dailyCount, findMany: dailyFindMany, findFirst: latestDay },
      dailyHealthData: { count: weightCount },
      unifiedExperimentalPhysiologyState: { findMany: vi.fn() },
    } as unknown as ModelDatabaseClient;

    const result = await new ModelDiagnosticsRepository(client)
      .loadEvidence(7, "2026-09-11", "2026-10-08", "2026-10-08");

    expect(dailyCount).toHaveBeenCalledTimes(5);
    expect(dailyCount.mock.calls.every(([args]) => args.where.date.lte === "2026-10-08")).toBe(true);
    expect(dailyFindMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: { episodeId: 7, date: { gte: "2026-09-11", lte: "2026-10-08" } },
    }));
    expect(latestDay).toHaveBeenCalledWith(expect.objectContaining({
      where: { episodeId: 7, date: { equals: "2026-10-08", lte: "2026-10-08" } },
    }));
    expect(result.energyHistory?.latestModeledDay?.date).toBe("2026-10-08");
    expect(result.energyHistory?.previousCompletedDays).toEqual(Array.from({ length: 7 }, (_, index) => ({
      date: `2026-10-${String(index + 1).padStart(2, "0")}`,
      expenditureKcalPerDay: null,
    })));
    expect(result.experimentalEnergySummary?.latestModeledExpenditureKcalPerDay).toBe(500);
  });
});

