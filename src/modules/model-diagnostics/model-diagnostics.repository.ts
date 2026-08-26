import { prisma } from "@/lib/db/prisma";
import type { ModelDatabaseClient } from "@/modules/model-episodes/model-episode.repository";
import type { DiagnosticsEvidence } from "./model-diagnostics.types";

export class ModelDiagnosticsRepository {
  constructor(private readonly client: ModelDatabaseClient = prisma) {}

  async loadEvidence(episodeId: number, from: string, to: string): Promise<DiagnosticsEvidence> {
    const [modeledDayCount, completeDayCount, observedNutritionDayCount, imputedNutritionDayCount, unresolvedNutritionDayCount, weightObservationCount] = await Promise.all([
      this.client.dailyModelState.count({ where: { episodeId, date: { gte: from, lte: to } } }),
      this.client.dailyModelState.count({ where: { episodeId, date: { gte: from, lte: to }, status: "complete" } }),
      this.client.dailyModelState.count({ where: { episodeId, date: { gte: from, lte: to }, nutritionSource: "observed" } }),
      this.client.dailyModelState.count({ where: { episodeId, date: { gte: from, lte: to }, nutritionSource: { in: ["imputed-local", "imputed-fallback"] } } }),
      this.client.dailyModelState.count({ where: { episodeId, date: { gte: from, lte: to }, nutritionSource: "missing" } }),
      this.client.dailyHealthData.count({ where: { date: { gte: from, lte: to }, weightKg: { not: null } } }),
    ]);
    return {
      modeledDayCount,
      completeDayCount,
      incompleteDayCount: modeledDayCount - completeDayCount,
      observedNutritionDayCount,
      imputedNutritionDayCount,
      unresolvedNutritionDayCount,
      weightObservationCount,
    };
  }
}

export const modelDiagnosticsRepository = new ModelDiagnosticsRepository();

