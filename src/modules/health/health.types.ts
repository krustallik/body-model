import type { z } from "zod";
import type { HealthDaySchema, HealthSyncRequestSchema, WorkoutSchema } from "./health.schema";
import type { TimestampedHealthMetricSample } from "./normalize-shortcut-range-payload";

export type WorkoutInput = z.infer<typeof WorkoutSchema>;
export type HealthDayInput = z.infer<typeof HealthDaySchema>;
export type HealthSyncRequest = z.infer<typeof HealthSyncRequestSchema>;
export type HealthMetricSampleInput = TimestampedHealthMetricSample;
export type SyncAction = "created" | "updated";

export type HealthSyncMetadata = {
  timezone: string;
  receivedAt: Date;
  syncedAt: string | null;
  /** Enqueue dependent refresh work in the same transaction as each raw write. */
  deferDependentRefresh?: boolean;
};

export interface SyncDateResult {
  date: string;
  action: SyncAction;
  /** Whether this sync changed a raw weight source on the date. */
  weightSourceChanged?: boolean;
  /** Exact Workout rows whose source fields changed in this sync. */
  affectedWorkoutIds?: number[];
}

export interface HealthRetentionPruneResult {
  cutoffDate: string;
  deletedDays: number;
  deletedSnapshots: number;
}

export interface HealthSyncResult {
  status: "ok";
  /** Raw ingestion succeeded; this separately reports whether model publication is current. */
  modelPublicationStatus: "current" | "stale" | "not-run";
  received: number;
  created: number;
  updated: number;
  dates: SyncDateResult[];
  retentionCutoffDate: string;
  prunedDays: number;
  prunedSnapshots: number;
}
