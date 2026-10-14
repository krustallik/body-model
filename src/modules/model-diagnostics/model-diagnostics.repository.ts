import { prisma } from "@/lib/db/prisma";
import type { ModelDatabaseClient } from "@/modules/model-episodes/model-episode.repository";
import type { DiagnosticsEvidence } from "./model-diagnostics.types";
import { buildUnifiedEnergySummaryV1 } from "@/model/unified-experimental-physiology-v1/energy-summary";

export class ModelDiagnosticsRepository {
  constructor(private readonly client: ModelDatabaseClient = prisma) {}

  async loadEvidence(episodeId: number, from: string, to: string): Promise<DiagnosticsEvidence> {
    const [modeledDayCount, completeDayCount, observedNutritionDayCount, imputedNutritionDayCount, unresolvedNutritionDayCount, weightObservationCount] = await Promise.all([
      this.client.dailyModelState.count({ where: { episodeId, date: { gte: from, lte: to } } }),
      this.client.dailyModelState.count({ where: { episodeId, date: { gte: from, lte: to }, status: "complete" } }),
      this.client.dailyModelState.count({ where: { episodeId, date: { gte: from, lte: to }, nutritionSource: "observed" } }),
      this.client.dailyModelState.count({ where: { episodeId, date: { gte: from, lte: to }, nutritionSource: { in: ["imputed-local", "imputed-fallback"] } } }),
      this.client.dailyModelState.count({ where: { episodeId, date: { gte: from, lte: to }, nutritionSource: "missing" } }),
      this.client.dailyHealthData.count({ where: { date: { gte: from, lte: to }, weightKg: { gt: 0 } } }),
    ]);
    const unified = (this.client as unknown as { unifiedExperimentalPhysiologyState?: { findMany: (args: unknown) => Promise<unknown[]> } }).unifiedExperimentalPhysiologyState;
    const [energyRows, latestModeledDay, previousCompletedDays] = await Promise.all([
      this.client.dailyModelState.findMany({ where: { episodeId, date: { gte: from, lte: to } }, orderBy: { date: "asc" }, select: { date: true, status: true, energyExpenditureKcal: true, dynamicRmrKcalPerDay: true } }),
      this.client.dailyModelState.findFirst({ where: { episodeId, date: to }, select: { date: true, status: true, energyExpenditureKcal: true } }),
      this.client.dailyModelState.findMany({
        where: { episodeId, date: { lt: to }, status: "complete" },
        orderBy: { date: "desc" },
        take: 7,
        select: { date: true, energyExpenditureKcal: true },
      }),
    ]);
    const experimentalEnergySummary = unified ? buildUnifiedEnergySummaryV1({
      days: energyRows.map((row) => ({ date: row.date, productionTdeeKcalPerDay: row.energyExpenditureKcal, dynamicRmrKcalPerDay: row.dynamicRmrKcalPerDay })),
      todayDate: new Date().toISOString().slice(0, 10),
    }) : null;
    return {
      modeledDayCount,
      completeDayCount,
      incompleteDayCount: modeledDayCount - completeDayCount,
      observedNutritionDayCount,
      imputedNutritionDayCount,
      unresolvedNutritionDayCount,
      weightObservationCount,
      ...(experimentalEnergySummary === null ? {} : { experimentalEnergySummary }),
      energyHistory: {
        latestModeledDay: latestModeledDay && (latestModeledDay.status === "complete" || latestModeledDay.status === "incomplete")
          ? { date: latestModeledDay.date, status: latestModeledDay.status, expenditureKcalPerDay: latestModeledDay.energyExpenditureKcal }
          : null,
        previousCompletedDays: previousCompletedDays
          .map((day) => ({ date: day.date, expenditureKcalPerDay: day.energyExpenditureKcal }))
          .reverse(),
      },
    };
  }
}

export const modelDiagnosticsRepository = new ModelDiagnosticsRepository();
