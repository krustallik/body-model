import { describe, expect, it } from "vitest";
import { buildStepperWorkoutDiagnosticV7 } from "@/modules/profile/stepper-workout-diagnostic";

const start = "2026-09-17T10:00:00.000Z";
const end = "2026-09-17T10:20:00.000Z";
const assignment = (overrides: Partial<{ id: number; effectiveFrom: string; effectiveTo: string | null }> = {}) => ({
  id: 1, machineFamily: "DOMYOS_MS100" as const, configuration: "fixed" as const,
  effectiveFrom: "2026-09-01T00:00:00.000Z", effectiveTo: null, createdAt: "2026-09-01T00:00:00.000Z", ...overrides,
});
function input(overrides: Partial<Parameters<typeof buildStepperWorkoutDiagnosticV7>[0]> = {}) {
  return {
    workout: { id: 7, type: "Stair Climbing", startAt: start, endAt: end, durationMinutes: 20, activeEnergyKcal: 154 },
    assignments: [assignment()],
    snapshots: [
      { id: 10, receivedAt: "2026-09-17T09:58:00.000Z", syncedAt: null, steps: 1000 },
      { id: 11, receivedAt: "2026-09-17T10:23:00.000Z", syncedAt: null, steps: 1120 },
    ],
    heartRateSamples: [{ timestamp: "2026-09-17T10:05:00.000Z", bpm: 122, provenance: { provider: "shortcut", device: null } }],
    ...overrides,
  };
}

describe("stepper workout diagnostic", () => {
  it("shows active MS100 assignment and bracketed health-step attribution without making a machine-repetition claim", () => {
    const result = buildStepperWorkoutDiagnosticV7(input())!;
    expect(result.equipmentAssignment).toMatchObject({ id: 1, machineFamily: "DOMYOS_MS100", configuration: "fixed" });
    expect(result.bracketedSteps).toMatchObject({ availability: "available", preGapSeconds: 120, postGapSeconds: 180, derivedStepDelta: { value: 120, provenance: "bracketed-health-step-delta" }, derivedStepRatePerMinute: { value: 6 } });
    expect(result.labels).toEqual({ derivedStepDelta: "derived health step-counter attribution", garminActiveEnergy: "device estimate" });
    expect(result.deviceEnergy).toMatchObject({ availability: "available", valueKcal: 154, provenance: "device-estimate" });
    expect(result.heartRate.summary).toEqual({ sampleMeanBpm: 122, maxObservedBpm: 122, basis: "observed-samples-only" });
  });

  it("keeps no assignment distinct from a matching assignment and honors the effectiveFrom boundary", () => {
    expect(buildStepperWorkoutDiagnosticV7(input({ assignments: [] }))!.equipmentAssignment).toBeNull();
    expect(buildStepperWorkoutDiagnosticV7(input({ assignments: [assignment({ effectiveFrom: start })] }))!.equipmentAssignment?.id).toBe(1);
    expect(buildStepperWorkoutDiagnosticV7(input({ assignments: [assignment({ effectiveFrom: "2026-09-17T10:00:00.001Z" })] }))!.equipmentAssignment).toBeNull();
  });

  it("preserves historical equipment assignment after a later change", () => {
    const result = buildStepperWorkoutDiagnosticV7(input({ assignments: [
      assignment({ id: 1, effectiveTo: "2026-09-20T00:00:00.000Z" }),
      assignment({ id: 2, effectiveFrom: "2026-09-20T00:00:00.000Z" }),
    ] }))!;
    expect(result.equipmentAssignment?.id).toBe(1);
  });

  it("keeps missing snapshots, Garmin kcal, and HR as explicit unavailable or loaded-zero facts", () => {
    const result = buildStepperWorkoutDiagnosticV7(input({ snapshots: [], heartRateSamples: [], workout: { id: 7, type: "Stair Climbing", startAt: start, endAt: end, durationMinutes: 20, activeEnergyKcal: null } }))!;
    expect(result.bracketedSteps).toMatchObject({ availability: "unavailable", availabilityReason: "no-before-snapshot" });
    expect(result.deviceEnergy).toEqual({ availability: "unavailable", availabilityReason: "no-device-active-energy" });
    expect(result.heartRate).toMatchObject({ availability: "loaded", summary: null, samplingTopology: { sampledSpan: null } });
  });

  it("does not expose a diagnostic for non-stair workouts", () => {
    expect(buildStepperWorkoutDiagnosticV7(input({ workout: { id: 8, type: "Cycling", startAt: start, endAt: end, durationMinutes: 20, activeEnergyKcal: 154 } }))).toBeNull();
  });
});
