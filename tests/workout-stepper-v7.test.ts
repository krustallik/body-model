import { describe, expect, it } from "vitest";
import { canonicalizeWorkoutHeartRateEvidenceV7 } from "@/model/activity/workout-heart-rate-v7";
import {
  canonicalizeWorkoutStepperEvidenceV7,
  workoutStepperEvidenceDiagnosticV7,
} from "@/model/activity/workout-stepper-v7";
import type { WorkoutEnergyEvidenceV7 } from "@/model/activity/workout-energy-v7";

const startAt = "2026-09-17T16:00:00.000Z";
const endAt = "2026-09-17T16:30:00.000Z";
let snapshotId = 0;
const snapshot = (receivedAt: string, steps: number | null, syncedAt: string | null = null) => ({ id: ++snapshotId, receivedAt, syncedAt, steps });

function workout(input: Partial<WorkoutEnergyEvidenceV7> = {}): WorkoutEnergyEvidenceV7 {
  return {
    workoutId: 7,
    canonicalWorkoutType: "Stair Climbing",
    startAt,
    endAt,
    durationMinutes: 30,
    deviceEnergy: { availability: "unavailable", availabilityReason: "no-device-active-energy" },
    heartRate: canonicalizeWorkoutHeartRateEvidenceV7({
      workoutInterval: { startAt, endAt },
      heartRate: { availability: "loaded", samples: [{ timestamp: "2026-09-17T16:05:00.000Z", bpm: 120, provenance: { provider: "shortcut", device: null } }] },
    }),
    ...input,
  };
}

function evidence(snapshots: readonly ReturnType<typeof snapshot>[], input: Partial<WorkoutEnergyEvidenceV7> = {}) {
  return canonicalizeWorkoutStepperEvidenceV7({ workoutEnergy: workout(input), snapshots });
}

describe("WorkoutStepperEvidenceV7", () => {
  it("selects the nearest snapshots, preserves timing gaps, and does not mutate sources", () => {
    const snapshots = [
      snapshot("2026-09-17T15:50:00.000Z", 900),
      snapshot("2026-09-17T15:59:30.000Z", 1_000),
      snapshot("2026-09-17T16:30:20.000Z", 1_300),
      snapshot("2026-09-17T16:45:00.000Z", 1_500),
    ];
    const before = structuredClone(snapshots);
    const result = evidence(snapshots);

    expect(result.bracketedSteps).toMatchObject({
      availability: "available",
      before: { timestamp: "2026-09-17T15:59:30.000Z", timestampBasis: "received-at", stepCount: 1_000 },
      after: { timestamp: "2026-09-17T16:30:20.000Z", timestampBasis: "received-at", stepCount: 1_300 },
      preGapSeconds: 30,
      postGapSeconds: 20,
      derivedStepDelta: { value: 300, provenance: "bracketed-health-step-delta" },
      derivedStepRatePerMinute: { value: 10, provenance: "derived-from-bracketed-health-step-delta-and-workout-duration" },
    });
    expect(snapshots).toEqual(before);
  });

  it("preserves wide gaps without a quality cutoff and prefers syncedAt when present", () => {
    const result = evidence([
      snapshot("2026-09-17T15:00:00.000Z", 100, "2026-09-17T15:30:00.000Z"),
      snapshot("2026-09-17T18:00:00.000Z", 400, "2026-09-17T17:30:00.000Z"),
    ]);

    expect(result.bracketedSteps).toMatchObject({
      availability: "available",
      before: { timestamp: "2026-09-17T15:30:00.000Z", timestampBasis: "synced-at", stepCount: 100 },
      after: { timestamp: "2026-09-17T17:30:00.000Z", timestampBasis: "synced-at", stepCount: 400 },
      preGapSeconds: 1_800,
      postGapSeconds: 3_600,
    });
    expect(result.bracketedSteps).not.toHaveProperty("adequacyClassification");
  });

  it.each([
    ["no before", [snapshot("2026-09-17T16:31:00.000Z", 10)], "no-before-snapshot"],
    ["no after", [snapshot("2026-09-17T15:59:00.000Z", 10)], "no-after-snapshot"],
    ["missing counter", [snapshot("2026-09-17T15:59:00.000Z", null), snapshot("2026-09-17T16:31:00.000Z", 20)], "missing-step-counter"],
    ["counter decrease", [snapshot("2026-09-17T15:59:00.000Z", 20), snapshot("2026-09-17T16:31:00.000Z", 10)], "counter-decrease"],
  ] as const)("reports %s without repairing source data", (_label, snapshots, availabilityReason) => {
    const result = evidence(snapshots);
    expect(result.bracketedSteps).toMatchObject({ availability: "unavailable", availabilityReason, derivedStepDelta: null, derivedStepRatePerMinute: null });
  });

  it("keeps derived zero distinct from unavailable and omits rate for missing or zero duration", () => {
    const snapshots = [snapshot("2026-09-17T15:59:00.000Z", 100), snapshot("2026-09-17T16:31:00.000Z", 100)];
    expect(evidence(snapshots).bracketedSteps).toMatchObject({ availability: "available", derivedStepDelta: { value: 0 } });
    expect(evidence(snapshots, { durationMinutes: null }).bracketedSteps).toMatchObject({ availability: "available", derivedStepRatePerMinute: null });
    expect(evidence(snapshots, { durationMinutes: 0 }).bracketedSteps).toMatchObject({ availability: "available", derivedStepRatePerMinute: null });
  });

  it("composes existing device-energy and HR evidence without changing their semantics", () => {
    const present = evidence([
      snapshot("2026-09-17T15:59:00.000Z", 100), snapshot("2026-09-17T16:31:00.000Z", 200),
    ], { deviceEnergy: { availability: "available", sourceValueStatus: "observed", valueKcal: 211, semantics: "active", provenance: "device-estimate" } });
    const absent = evidence([snapshot("2026-09-17T15:59:00.000Z", 100), snapshot("2026-09-17T16:31:00.000Z", 200)], {
      heartRate: canonicalizeWorkoutHeartRateEvidenceV7({ workoutInterval: { startAt, endAt }, heartRate: { availability: "unavailable" } }),
    });

    expect(present.workoutEnergy.deviceEnergy).toEqual({ availability: "available", sourceValueStatus: "observed", valueKcal: 211, semantics: "active", provenance: "device-estimate" });
    expect(present.workoutEnergy.heartRate.summary).toEqual({ sampleMeanBpm: 120, maxObservedBpm: 120, basis: "observed-samples-only" });
    expect(absent.workoutEnergy.deviceEnergy).toEqual({ availability: "unavailable", availabilityReason: "no-device-active-energy" });
    expect(absent.workoutEnergy.heartRate).toMatchObject({ availability: "unavailable" });
  });

  it("keeps generic stair evidence free of any inferred machine identity or energy", () => {
    const result = evidence([snapshot("2026-09-17T15:59:00.000Z", 100), snapshot("2026-09-17T16:31:00.000Z", 200)]);
    expect(result).not.toHaveProperty("machineProtocol");
    expect(result).not.toHaveProperty("grossEnergy");
    expect(result).not.toHaveProperty("mechanicalWork");
  });

  it("provides a compact developer diagnostic without deriving new physiology", () => {
    const result = evidence([snapshot("2026-09-17T15:59:00.000Z", 100), snapshot("2026-09-17T16:31:00.000Z", 200)]);
    expect(workoutStepperEvidenceDiagnosticV7(result)).toMatchObject({
      workout: { workoutId: 7, canonicalWorkoutType: "Stair Climbing", startAt, endAt, durationMinutes: 30 },
      bracketedSteps: { availability: "available", derivedStepDelta: { value: 100 } },
      deviceEnergy: { availability: "unavailable", availabilityReason: "no-device-active-energy" },
      heartRate: { availability: "loaded", summary: { sampleMeanBpm: 120, maxObservedBpm: 120 } },
    });
  });
});
