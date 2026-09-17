/**
 * Durable canonical source retention policy.
 *
 * Architecture:
 *   External source / manual correction
 *     → normalization
 *     → durable canonical source (tables below)
 *     → simulation input builder
 *     → latest approved physiology
 *
 * Proven: HealthSyncSnapshot steps/walkingDistanceKm series are required for
 * identical rebuild of outside-work walking and stair-overlap subtraction.
 * Therefore snapshots are durable (Variant A), not 30-day transient.
 *
 * TODO(storage): HealthSyncSnapshot.rawPayload grows with every overlapping
 * sync and may outpace raw HR as the dominant per-profile storage consumer
 * now that snapshots are retained indefinitely. Do not strip/compress yet —
 * correctness > size for single-user — but plan a later audit for payload
 * retention vs keeping only reconstruction columns (steps, walkingDistanceKm,
 * syncedAt/receivedAt). Tracked as: snapshot-raw-payload-indefinite-growth.
 *
 * `pruneOlderThan` must not delete any model-required source. The sync path
 * still calls it for API compatibility; it is a documented no-op.
 *
 * SleepSegment / WorkInterval were already independent of DailyHealthData.
 * Nightly sleep summaries and model states are derived — never sole SoT.
 */

import { addCalendarDays } from "@/modules/model-episodes/model-calendar";

/**
 * Calendar date from which BodyCast guarantees durable-source policy for
 * latest-model rebuild. Not derived from MIN(DailyHealthData.date) — older
 * rows may exist without full source provenance (e.g. pruned pre-cutover).
 */
export const DURABLE_SOURCE_CUTOVER_DATE = "2026-09-17";

/** @deprecated Kept for API/compat; no longer used to delete durable sources. */
export const HEALTH_DATA_RETENTION_DAYS = 30;

/** Tables that must survive sync retention for rebuild. */
export const DURABLE_SOURCE_TABLES = [
  "DailyHealthData",
  "Workout",
  "HealthSyncSnapshot",
  "HeartRateSample",
  "RestingHeartRateSample",
  "SleepSegment",
  "WorkInterval",
  "ExerciseCatalog",
  "TrainingProgram",
  "TrainingProgramVersion",
  "ProgramExercise",
  "StrengthDiarySession",
  "StrengthDiaryProgramChange",
  "StrengthSessionExercise",
  "StrengthSet",
] as const;

/**
 * Earliest calendar date still within the legacy 30-day window for `referenceDate`.
 * Retained for response fields (`retentionCutoffDate`) only — not a delete gate.
 */
export function healthRetentionCutoffDate(
  referenceDate: string,
  retentionDays: number = HEALTH_DATA_RETENTION_DAYS,
): string {
  return addCalendarDays(referenceDate, -retentionDays);
}

/** True when `date` is on/after the durable-source cutover (fully rebuildable guarantee). */
export function isFullyRebuildableSourceDate(date: string): boolean {
  return date >= DURABLE_SOURCE_CUTOVER_DATE;
}
