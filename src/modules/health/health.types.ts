import type { z } from "zod";
import type { HealthDaySchema, HealthSyncRequestSchema, WorkoutSchema } from "./health.schema";

export type WorkoutInput = z.infer<typeof WorkoutSchema>;
export type HealthDayInput = z.infer<typeof HealthDaySchema>;
export type HealthSyncRequest = z.infer<typeof HealthSyncRequestSchema>;
export type SyncAction = "created" | "updated";

export interface SyncDateResult {
  date: string;
  action: SyncAction;
}

export interface HealthSyncResult {
  status: "ok";
  received: number;
  created: number;
  updated: number;
  dates: SyncDateResult[];
}
