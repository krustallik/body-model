import type { CanonicalWorkoutType } from "./workout-energy";
import type { WorkoutHeartRateEvidenceV7 } from "./workout-heart-rate-v7";

export type WorkoutEnergyEvidenceV7 = {
  workoutId: number;
  canonicalWorkoutType: CanonicalWorkoutType | null;
  startAt: string;
  endAt: string;
  durationMinutes: number | null;
  /** Raw device energy remains an estimate, not criterion-calorimetry truth. */
  deviceEnergy: {
    availability: "available";
    sourceValueStatus: "observed";
    valueKcal: number;
    semantics: "active" | "gross";
    provenance: "device-estimate";
  } | {
    availability: "unavailable";
    availabilityReason: "no-device-active-energy";
  };
  heartRate: WorkoutHeartRateEvidenceV7;
};

export type WorkoutEnergyResolutionV7 = {
  activeEnergy: {
    availability: "available";
    valueKcal: number;
    semantics: "active";
    provenance: "device-estimate";
  } | {
    availability: "unavailable";
    availabilityReason: "no-device-active-energy";
  };
  /** Preserved context; this slice never converts HR into kcal. */
  heartRateContext: WorkoutEnergyEvidenceV7["heartRate"];
};

export function resolveWorkoutEnergyEvidenceV7(
  evidence: WorkoutEnergyEvidenceV7,
): WorkoutEnergyResolutionV7 {
  const heartRateContext = evidence.heartRate;
  if (
    evidence.deviceEnergy.availability === "available"
    && evidence.deviceEnergy.semantics === "active"
  ) {
    return {
      activeEnergy: {
        availability: "available",
        valueKcal: evidence.deviceEnergy.valueKcal,
        semantics: "active",
        provenance: "device-estimate",
      },
      heartRateContext,
    };
  }
  return {
    activeEnergy: {
      availability: "unavailable",
      availabilityReason: "no-device-active-energy",
    },
    heartRateContext,
  };
}
