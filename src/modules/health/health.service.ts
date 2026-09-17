import { healthRetentionCutoffDate } from "./health-retention";
import { healthSyncRepository, type HealthSyncRepository } from "./health.repository";
import type { HealthSyncRequest, HealthSyncResult } from "./health.types";
import { DEFAULT_TIME_ZONE } from "@/model/time-zone";
import { errorKind, logEvent } from "@/lib/logger";

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

  const retentionCutoffDate = healthRetentionCutoffDate(day.date);
  let prunedDays = 0;
  let prunedSnapshots = 0;
  try {
    // Retention is a no-op for durable canonical sources (including snapshots).
    const pruned = await repository.pruneOlderThan(retentionCutoffDate);
    prunedDays = pruned.deletedDays;
    prunedSnapshots = pruned.deletedSnapshots;
    if (prunedDays > 0 || prunedSnapshots > 0) {
      logEvent("info", "health_sync_retention_pruned", {
        retentionCutoffDate,
        prunedDays,
        prunedSnapshots,
        referenceDate: day.date,
      });
    }
  } catch (error) {
    logEvent("warn", "health_sync_retention_prune_failed", {
      retentionCutoffDate,
      referenceDate: day.date,
      errorType: errorKind(error),
    });
  }

  return {
    status: "ok",
    received: 1,
    created,
    updated: 1 - created,
    dates: [date],
    retentionCutoffDate,
    prunedDays,
    prunedSnapshots,
  };
}
