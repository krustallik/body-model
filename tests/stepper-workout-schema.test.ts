import { describe, expect, it } from "vitest";
import { CreateStepperWorkoutSchema, StepperWorkoutIdParamsSchema, UpdateStepperWorkoutSchema } from "@/modules/training/stepper-workout.schema";

describe("stepper workout input", () => {
  it("accepts date, duration, and safe positive workout ids", () => {
    expect(CreateStepperWorkoutSchema.safeParse({ startAt: "2042-03-15T08:00:00.000Z", durationMinutes: 20 }).success).toBe(true);
    expect(UpdateStepperWorkoutSchema.safeParse({ startAt: "2042-03-15T08:00:00+01:00", durationMinutes: 1_440 }).success).toBe(true);
    expect(StepperWorkoutIdParamsSchema.safeParse({ id: "12" }).data).toEqual({ id: 12 });
  });

  it("rejects fabricated energy fields, invalid timestamps, and out-of-range durations", () => {
    expect(CreateStepperWorkoutSchema.safeParse({ startAt: "2042-03-15T08:00", durationMinutes: 20 }).success).toBe(false);
    expect(CreateStepperWorkoutSchema.safeParse({ startAt: "2042-03-15T08:00:00Z", durationMinutes: 0 }).success).toBe(false);
    expect(CreateStepperWorkoutSchema.safeParse({ startAt: "2042-03-15T08:00:00Z", durationMinutes: 20, activeEnergyKcal: 300 }).success).toBe(false);
    expect(StepperWorkoutIdParamsSchema.safeParse({ id: "0" }).success).toBe(false);
  });
});
