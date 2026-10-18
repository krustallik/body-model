import { prisma } from "@/lib/db/prisma";
import type { ModelDatabaseClient } from "@/modules/model-episodes/model-episode.repository";
import type { DiagnosticsEvidence } from "./model-diagnostics.types";
import { buildUnifiedEnergySummaryV1 } from "@/model/unified-experimental-physiology-v1/energy-summary";
import { addCalendarDays } from "@/modules/model-episodes/model-calendar";

export class ModelDiagnosticsRepository {
  constructor(private readonly client: ModelDatabaseClient = prisma) {}

  async loadEvidence(episodeId: number, from: string, to: string, latestModeledDate: string | null): Promise<DiagnosticsEvidence> {
    const [modeledDayCount, completeDayCount, observedNutritionDayCount, imputedNutritionDayCount, unresolvedNutritionDayCount, weightObservationCount] = await Promise.all([
      this.client.dailyModelState.count({ where: { episodeId, date: { gte: from, lte: to } } }),
      this.client.dailyModelState.count({ where: { episodeId, date: { gte: from, lte: to }, status: "complete" } }),
      this.client.dailyModelState.count({ where: { episodeId, date: { gte: from, lte: to }, nutritionSource: "observed" } }),
      this.client.dailyModelState.count({ where: { episodeId, date: { gte: from, lte: to }, nutritionSource: { in: ["imputed-local", "imputed-fallback"] } } }),
      this.client.dailyModelState.count({ where: { episodeId, date: { gte: from, lte: to }, nutritionSource: "missing" } }),
      this.client.dailyHealthData.count({ where: { date: { gte: from, lte: to }, weightKg: { gt: 0 } } }),
    ]);
    const unified = (this.client as unknown as { unifiedExperimentalPhysiologyState?: { findMany: (args: unknown) => Promise<unknown[]> } }).unifiedExperimentalPhysiologyState;
    const [energyRows, latestModeledDay, previousCalendarRows] = await Promise.all([
      this.client.dailyModelState.findMany({ where: { episodeId, date: { gte: from, lte: to } }, orderBy: { date: "asc" }, select: { date: true, status: true, energyExpenditureKcal: true, dynamicRmrKcalPerDay: true } }),
      latestModeledDate
        ? this.client.dailyModelState.findFirst({ where: { episodeId, date: { equals: latestModeledDate, lte: to } }, select: { date: true, status: true, energyExpenditureKcal: true } })
        : Promise.resolve(null),
      latestModeledDate
        ? this.client.dailyModelState.findMany({
          where: { episodeId, date: { gte: addCalendarDays(latestModeledDate, -7), lt: latestModeledDate } },
          orderBy: { date: "asc" },
          select: { date: true, status: true, energyExpenditureKcal: true },
        })
        : Promise.resolve([]),
    ]);
    const previousRowsByDate = new Map(previousCalendarRows.map((row) => [row.date, row]));
    const previousCompletedDays = latestModeledDate
      ? Array.from({ length: 7 }, (_, index) => addCalendarDays(latestModeledDate, index - 7))
        .map((date) => {
          const row = previousRowsByDate.get(date);
          return {
            date,
            expenditureKcalPerDay: row?.status === "complete"
              && typeof row.energyExpenditureKcal === "number"
              && Number.isFinite(row.energyExpenditureKcal)
              ? row.energyExpenditureKcal
              : null,
          };
        })
      : [];
    const energySummaryDays = energyRows.map((row) => ({
      date: row.date,
      productionTdeeKcalPerDay: row.energyExpenditureKcal,
      dynamicRmrKcalPerDay: row.dynamicRmrKcalPerDay,
    }));
    const energySummary = unified ? buildUnifiedEnergySummaryV1({
      days: energySummaryDays,
      todayDate: new Date().toISOString().slice(0, 10),
    }) : null;
    const latestEnergyDay = [...energySummaryDays].reverse()
      .find((day) => day.productionTdeeKcalPerDay !== null) ?? null;
    const maintenanceWindowStart = latestEnergyDay
      ? addCalendarDays(latestEnergyDay.date, -(energySummary?.typicalMaintenanceWindowDays ?? 28) + 1)
      : null;
    const eligibleMaintenanceValues = maintenanceWindowStart
      ? energySummaryDays
        .filter((day) => day.date >= maintenanceWindowStart && day.productionTdeeKcalPerDay !== null)
        .map((day) => day.productionTdeeKcalPerDay!)
      : [];
    const recentAverageMaintenanceKcalPerDay = energySummary?.recentTypicalMaintenanceKcalPerDay !== null
      && energySummary?.recentTypicalMaintenanceKcalPerDay !== undefined
      && eligibleMaintenanceValues.length === energySummary.typicalMaintenanceEligibleDays
      ? eligibleMaintenanceValues.reduce((average, value, index) => average + (value - average) / (index + 1), 0)
      : null;
    const experimentalEnergySummary = energySummary
      ? { ...energySummary, recentTypicalMaintenanceKcalPerDay: recentAverageMaintenanceKcalPerDay }
      : null;
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
        previousCompletedDays,
      },
    };
  }
}

export const modelDiagnosticsRepository = new ModelDiagnosticsRepository();
