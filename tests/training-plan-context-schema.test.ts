import { describe, expect, it } from "vitest";
import {
  ProgramExerciseInputSchema,
  StartDynamicSessionSchema,
  StartSessionSchema,
} from "@/modules/training/training.schema";
import { RESISTANCE, SESSION_INTENT } from "@/modules/training/training.constants";

describe("training plan and session context schemas", () => {
  it("accepts explicit rep/RIR targets and an easy or deload intent", () => {
    expect(ProgramExerciseInputSchema.safeParse({
      catalogId: 1,
      plannedSets: 4,
      plannedRepsMin: 6,
      plannedRepsMax: 10,
      plannedRir: 3,
      resistanceType: RESISTANCE.EXTERNAL_WEIGHT,
    }).success).toBe(true);

    expect(StartSessionSchema.safeParse({
      programId: 1,
      sessionIntent: SESSION_INTENT.EASY_DELOAD,
      trainingBlockLabel: "Accumulation",
      trainingWeekNumber: 4,
    }).success).toBe(true);
  });

  it("rejects invalid rep ranges, RIR bounds, and block weeks", () => {
    expect(ProgramExerciseInputSchema.safeParse({
      catalogId: 1,
      plannedSets: 4,
      plannedRepsMin: 12,
      plannedRepsMax: 8,
      plannedRir: 3,
      resistanceType: RESISTANCE.EXTERNAL_WEIGHT,
    }).success).toBe(false);
    expect(ProgramExerciseInputSchema.safeParse({
      catalogId: 1,
      plannedSets: 4,
      plannedRir: 11,
      resistanceType: RESISTANCE.EXTERNAL_WEIGHT,
    }).success).toBe(false);
    expect(StartDynamicSessionSchema.safeParse({ trainingWeekNumber: 53 }).success).toBe(false);
  });

  it("keeps all context optional for old clients", () => {
    expect(StartDynamicSessionSchema.safeParse({}).success).toBe(true);
    expect(StartSessionSchema.safeParse({ programId: 1 }).success).toBe(true);
    expect(ProgramExerciseInputSchema.safeParse({
      catalogId: 1,
      plannedSets: 3,
      resistanceType: RESISTANCE.EXTERNAL_WEIGHT,
    }).success).toBe(true);
  });
});
