import { describe, expect, it } from "vitest";
import { canonicalizeWorkoutHeartRateEvidenceV7 } from "@/model/activity/workout-heart-rate-v7";
import { canonicalizeWorkoutStepperEvidenceV7 } from "@/model/activity/workout-stepper-v7";
import {
  buildPersonalStepperReferenceSetV7,
  personalStepperReferenceSetFingerprintV7,
} from "@/model/activity/personal-stepper-reference-v7";
import type { WorkoutEnergyEvidenceV7 } from "@/model/activity/workout-energy-v7";

function candidate(input: {
  workoutId?: number;
  startedAt?: string;
  activeKcal?: number | null;
  durationMinutes?: number | null;
  hr?: "available" | "unavailable";
  bodyMassKg?: number | null;
}) {
  const startAt = input.startedAt ?? "2026-09-17T16:00:00.000Z";
  const endAt = new Date(Date.parse(startAt) + 30 * 60_000).toISOString();
  const energy: WorkoutEnergyEvidenceV7 = {
    workoutId: input.workoutId ?? 1,
    canonicalWorkoutType: "Stair Climbing", startAt, endAt,
    durationMinutes: input.durationMinutes === undefined ? 30 : input.durationMinutes,
    deviceEnergy: input.activeKcal === null
      ? { availability: "unavailable", availabilityReason: "no-device-active-energy" }
      : { availability: "available", sourceValueStatus: "observed", valueKcal: input.activeKcal ?? 211, semantics: "active", provenance: "device-estimate" },
    heartRate: canonicalizeWorkoutHeartRateEvidenceV7({
      workoutInterval: { startAt, endAt },
      heartRate: input.hr === "unavailable" ? { availability: "unavailable" } : { availability: "loaded", samples: [{ timestamp: startAt, bpm: 120, provenance: { provider: "shortcut", device: null } }] },
    }),
  };
  return {
    workout: canonicalizeWorkoutStepperEvidenceV7({
      workoutEnergy: energy,
      snapshots: [
        { id: 10, receivedAt: "2026-09-17T15:59:00.000Z", syncedAt: null, steps: 100 },
        { id: 11, receivedAt: "2026-09-17T16:31:00.000Z", syncedAt: null, steps: 200 },
      ],
    }),
    bodyMassKg: input.bodyMassKg === undefined ? 80 : input.bodyMassKg,
  };
}

describe("personal stepper reference set v7", () => {
  it("uses the fixed MS100 regardless of profile assignment history", () => {
    const result = buildPersonalStepperReferenceSetV7({ candidates: [
      candidate({ workoutId: 2, startedAt: "2026-09-12T16:00:00.000Z" }),
      candidate({ workoutId: 1, startedAt: "2026-09-05T16:00:00.000Z" }),
      candidate({ workoutId: 3, startedAt: "2026-08-31T16:00:00.000Z" }),
    ] });

    expect(result.samples.map((sample) => [sample.workoutId, sample.equipmentAssignment.id])).toEqual([[3, 0], [1, 0], [2, 0]]);
    expect(result.diagnostics.every(({ status }) => status === "eligible")).toBe(true);
  });

  it("keeps device energy and duration required while HR, body mass, and step context stay optional", () => {
    const result = buildPersonalStepperReferenceSetV7({ candidates: [
      candidate({ workoutId: 1, activeKcal: null }),
      candidate({ workoutId: 2, durationMinutes: null }),
      candidate({ workoutId: 3, hr: "unavailable", bodyMassKg: null }),
    ] });

    expect(result.diagnostics.map(({ workoutId, status, requiredReasons }) => ({ workoutId, status, requiredReasons }))).toEqual([
      { workoutId: 1, status: "ineligible", requiredReasons: ["no-device-active-energy"] },
      { workoutId: 2, status: "ineligible", requiredReasons: ["no-duration"] },
      { workoutId: 3, status: "eligible", requiredReasons: [] },
    ]);
    expect(result.diagnostics[2].optionalContextMissing).toEqual(["hr-unavailable", "body-mass-unavailable"]);
    expect(result.samples[0].target).toEqual({ valueKcal: 211, sourceValueStatus: "observed", semantics: "active", provenance: "device-estimate" });
  });

  it("orders references deterministically and fingerprints every selected source dependency", () => {
    const input = { candidates: [candidate({ workoutId: 2, startedAt: "2026-09-18T16:00:00.000Z" }), candidate({ workoutId: 1 })] };
    const first = buildPersonalStepperReferenceSetV7(input);
    const second = buildPersonalStepperReferenceSetV7({ candidates: [...input.candidates].reverse() });
    expect(first.samples.map(({ workoutId }) => workoutId)).toEqual([1, 2]);
    expect(personalStepperReferenceSetFingerprintV7(first)).toBe(personalStepperReferenceSetFingerprintV7(second));

    const changed = buildPersonalStepperReferenceSetV7({ candidates: [candidate({ workoutId: 1, activeKcal: 212 }), candidate({ workoutId: 2, startedAt: "2026-09-18T16:00:00.000Z" })] });
    expect(personalStepperReferenceSetFingerprintV7(changed)).not.toBe(personalStepperReferenceSetFingerprintV7(first));
  });
});
