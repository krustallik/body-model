import { healthSyncRepository, type HealthSyncRepository } from "./health.repository";
import type { HealthSyncRequest, HealthSyncResult } from "./health.types";

export async function syncHealthData(
  request: HealthSyncRequest,
  repository: HealthSyncRepository = healthSyncRepository,
): Promise<HealthSyncResult> {
  const dates = await repository.syncBatch(request.days);
  const created = dates.filter(({ action }) => action === "created").length;

  return {
    status: "ok",
    received: request.days.length,
    created,
    updated: dates.length - created,
    dates,
  };
}
