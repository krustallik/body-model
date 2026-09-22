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
    const experimentalEnergySummary = unified ? buildUnifiedEnergySummaryV1({
      days: (await this.client.dailyModelState.findMany({ where: { episodeId, date: { gte: from, lte: to } }, orderBy: { date: "asc" }, select: { date: true, energyExpenditureKcal: true, dynamicRmrKcalPerDay: true } })).map((row) => ({ date: row.date, productionTdeeKcalPerDay: row.energyExpenditureKcal, dynamicRmrKcalPerDay: row.dynamicRmrKcalPerDay })),
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
      experimentalEnergySummary,
    };
  }
}

export const modelDiagnosticsRepository = new ModelDiagnosticsRepository();
