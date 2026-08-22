import { healthSyncRepository, type HealthSyncRepository } from "./health.repository";
import type { HealthSyncRequest, HealthSyncResult } from "./health.types";

export async function syncHealthData(
  request: HealthSyncRequest,
  repository: HealthSyncRepository = healthSyncRepository,
  rawDays?: unknown[],
): Promise<HealthSyncResult> {
  const day = request.days[0];
  const date = await repository.syncDay(day, rawDays?.[0]);
  const created = date.action === "created" ? 1 : 0;

  return {
    status: "ok",
    received: 1,
    created,
    updated: 1 - created,
    dates: [date],
  };
}
