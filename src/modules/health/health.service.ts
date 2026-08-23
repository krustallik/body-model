import { healthSyncRepository, type HealthSyncRepository } from "./health.repository";
import type { HealthSyncRequest, HealthSyncResult } from "./health.types";
import { DEFAULT_TIME_ZONE } from "@/model/time-zone";

export async function syncHealthData(
  request: HealthSyncRequest,
  repository: HealthSyncRepository = healthSyncRepository,
  rawDays?: unknown[],
  receivedAt: Date = new Date(),
): Promise<HealthSyncResult> {
  const day = request.days[0];
  const date = await repository.syncDay(day, rawDays?.[0] ?? day, {
    timezone: request.timezone ?? DEFAULT_TIME_ZONE,
    receivedAt,
    syncedAt: request.syncedAt ?? null,
  });
  const created = date.action === "created" ? 1 : 0;

  return {
    status: "ok",
    received: 1,
    created,
    updated: 1 - created,
    dates: [date],
  };
}
