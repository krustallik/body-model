import { describe, expect, it } from "vitest";
import {
  DURABLE_SOURCE_CUTOVER_DATE,
  DURABLE_SOURCE_TABLES,
  healthRetentionCutoffDate,
  isFullyRebuildableSourceDate,
} from "@/modules/health/health-retention";

describe("health retention / durable source policy", () => {
  it("keeps the legacy cutoff helper for API compat", () => {
    expect(healthRetentionCutoffDate("2026-09-16")).toBe("2026-08-17");
  });

  it("exposes an explicit durable-source cutover (not MIN(DailyHealthData.date))", () => {
    expect(DURABLE_SOURCE_CUTOVER_DATE).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(isFullyRebuildableSourceDate(DURABLE_SOURCE_CUTOVER_DATE)).toBe(true);
    expect(isFullyRebuildableSourceDate("2026-09-16")).toBe(false);
    expect(isFullyRebuildableSourceDate("2026-09-18")).toBe(true);
  });

  it("lists all durable canonical source tables including snapshots and training diary", () => {
    expect(DURABLE_SOURCE_TABLES).toEqual(expect.arrayContaining([
      "DailyHealthData",
      "Workout",
      "HealthSyncSnapshot",
      "HealthActivityInterval",
      "HeartRateSample",
      "RestingHeartRateSample",
      "SleepSegment",
      "WorkInterval",
      "ExerciseCatalog",
      "TrainingProgram",
      "TrainingProgramVersion",
      "ProgramExercise",
      "StrengthDiarySession",
      "StrengthSessionExercise",
      "StrengthSet",
    ]));
  });
});
