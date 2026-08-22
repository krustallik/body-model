import { healthSyncRepository, type HealthSyncRepository } from "./health.repository";
import type { HealthSyncRequest, HealthSyncResult } from "./health.types";

export async function syncHealthData(
  request: HealthSyncRequest,
  repository: HealthSyncRepository = healthSyncRepository,
  rawDays?: unknown[],
): Promise<HealthSyncResult> {
  const dates = await repository.syncBatch(request.days, rawDays);
  const created = dates.filter(({ action }) => action === "created").length;

  return {
    status: "ok",
    received: request.days.length,
    created,
    updated: dates.length - created,
    dates,
  };
}
