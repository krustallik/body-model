import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  estimateExperimentalStepperActiveEnergyV1,
  estimateMatchedProtocolDurationEnergyV1,
  experimentalStepperActiveEnergyV1Fingerprint,
  EXPERIMENTAL_STEPPER_ACTIVE_ENERGY_V1_PROVENANCE,
  EXPERIMENTAL_STEPPER_ACTIVE_ENERGY_V1_REVISION,
  mechanicalVerticalWorkJoulesV1,
  activeKcalFromMechanicalWorkV1,
  STANDARD_GRAVITY_M_PER_S2,
  JOULES_PER_THERMOCHEMICAL_KCAL,
} from "@/model/activity/experimental-stepper-active-energy-v1";
import { canonicalizeWorkoutHeartRateEvidenceV7 } from "@/model/activity/workout-heart-rate-v7";
import type { WorkoutEnergyEvidenceV7 } from "@/model/activity/workout-energy-v7";
import type { WorkoutStepperEvidenceV7 } from "@/model/activity/workout-stepper-v7";
import type { StepperEquipmentAssignmentV7 } from "@/model/activity/personal-stepper-reference-v7";
import { WORKOUT_RECOVERY_ENERGY_SCIENTIFIC_DECISION } from "@/model/activity/workout-energy";

const startAt = "2026-09-18T16:00:00.000Z";
const endAt = "2026-09-18T16:30:00.000Z";

const equipment: StepperEquipmentAssignmentV7 = {
  id: 1,
  machineFamily: "DOMYOS_MS100",
  configuration: "fixed",
  effectiveFrom: "2026-01-01T00:00:00.000Z",
  effectiveTo: null,
  createdAt: "2026-01-01T00:00:00.000Z",
};

function workoutEnergy(input: Partial<WorkoutEnergyEvidenceV7> = {}): WorkoutEnergyEvidenceV7 {
  return {
    workoutId: 42,
    canonicalWorkoutType: "Stair Climbing",
    startAt,
    endAt,
    durationMinutes: 30,
    deviceEnergy: { availability: "unavailable", availabilityReason: "no-device-active-energy" },
    heartRate: canonicalizeWorkoutHeartRateEvidenceV7({
      workoutInterval: { startAt, endAt },
      heartRate: { availability: "unavailable" },
    }),
    ...input,
  };
}

function stepper(input: {
  steps: number;
  durationMinutes?: number;
  energy?: Partial<WorkoutEnergyEvidenceV7>;
}): WorkoutStepperEvidenceV7 {
  const durationMinutes = input.durationMinutes ?? 30;
  const energy = workoutEnergy({ durationMinutes, ...input.energy });
  return {
    workoutEnergy: energy,
    bracketedSteps: {
      availability: "available",
      before: {
        snapshotId: 1,
        timestamp: startAt,
        timestampBasis: "received-at",
        stepCount: 0,
      },
      after: {
        snapshotId: 2,
        timestamp: endAt,
        timestampBasis: "received-at",
        stepCount: input.steps,
      },
      preGapSeconds: 0,
      postGapSeconds: 0,
      derivedStepDelta: { value: input.steps, provenance: "bracketed-health-step-delta" },
      derivedStepRatePerMinute: durationMinutes > 0
        ? {
          value: input.steps / durationMinutes,
          provenance: "derived-from-bracketed-health-step-delta-and-workout-duration",
        }
        : null,
    },
  };
}

/**
 * EXPERIMENTAL harness — not scientific validation / GREEN oracle.
 */
describe("experimental stepper active energy v1", () => {
  it("estimates positive active energy for a valid MS100 session", () => {
    const result = estimateExperimentalStepperActiveEnergyV1({
      workout: stepper({ steps: 2_100 }),
      bodyMassKg: 80,
      equipment,
    });
    expect(result.availability).toBe("available");
    expect(result.estimatedActiveKcal!).toBeGreaterThan(0);
    expect(result.lowerBoundKcal!).toBeGreaterThan(0);
    expect(result.upperBoundKcal!).toBeGreaterThanOrEqual(result.estimatedActiveKcal!);
    expect(result.lowerBoundKcal!).toBeLessThanOrEqual(result.estimatedActiveKcal!);
    expect(result.provenance).toBe(EXPERIMENTAL_STEPPER_ACTIVE_ENERGY_V1_PROVENANCE);
    expect(result.contractVersion).toBe(EXPERIMENTAL_STEPPER_ACTIVE_ENERGY_V1_REVISION);
    expect(result.supportedDomain).toBe("ms100-stair-stepper-shadow-only");
    expect(result.recoveryEnergy).toEqual(WORKOUT_RECOVERY_ENERGY_SCIENTIFIC_DECISION);
    expect(result.recoveryEnergy.addedKcal).toBeNull();
  });

  it("keeps matched mechanical protocol energy nondecreasing with duration (C-K06)", () => {
    const short = estimateMatchedProtocolDurationEnergyV1({
      bodyMassKg: 75,
      durationMinutes: 20,
      stepRatePerMinute: 70,
      equipment,
    });
    const long = estimateMatchedProtocolDurationEnergyV1({
      bodyMassKg: 75,
      durationMinutes: 40,
      stepRatePerMinute: 70,
      equipment,
    });
    expect(short.availability).toBe("available");
    expect(long.availability).toBe("available");
    expect(long.estimatedActiveKcal!).toBeGreaterThanOrEqual(short.estimatedActiveKcal!);
    expect(long.estimatedActiveKcal!).toBeGreaterThan(short.estimatedActiveKcal!);
  });

  it("increases estimated energy when attributed step work increases at fixed mass", () => {
    const fewer = estimateExperimentalStepperActiveEnergyV1({
      workout: stepper({ steps: 1_000 }),
      bodyMassKg: 80,
      equipment,
    });
    const more = estimateExperimentalStepperActiveEnergyV1({
      workout: stepper({ steps: 2_000 }),
      bodyMassKg: 80,
      equipment,
    });
    expect(more.estimatedActiveKcal!).toBeGreaterThan(fewer.estimatedActiveKcal!);
  });

  it("increases estimated energy with higher body mass at matched work", () => {
    const lighter = estimateExperimentalStepperActiveEnergyV1({
      workout: stepper({ steps: 1_500 }),
      bodyMassKg: 60,
      equipment,
    });
    const heavier = estimateExperimentalStepperActiveEnergyV1({
      workout: stepper({ steps: 1_500 }),
      bodyMassKg: 90,
      equipment,
    });
    expect(heavier.estimatedActiveKcal!).toBeGreaterThan(lighter.estimatedActiveKcal!);
    // Directionality only — not exact physiological m-scaling invariance.
    expect(heavier.estimatedActiveKcal! / lighter.estimatedActiveKcal!).toBeCloseTo(90 / 60, 5);
  });

  it("treats missing session evidence as unavailable, not zero kcal", () => {
    const missingSteps = estimateExperimentalStepperActiveEnergyV1({
      workout: {
        workoutEnergy: workoutEnergy(),
        bracketedSteps: {
          availability: "unavailable",
          availabilityReason: "no-before-snapshot",
          before: null,
          after: null,
          preGapSeconds: null,
          postGapSeconds: null,
          derivedStepDelta: null,
          derivedStepRatePerMinute: null,
        },
      },
      bodyMassKg: 80,
      equipment,
    });
    const missingMass = estimateExperimentalStepperActiveEnergyV1({
      workout: stepper({ steps: 1_000 }),
      bodyMassKg: null,
      equipment,
    });
    const missingEquipment = estimateExperimentalStepperActiveEnergyV1({
      workout: stepper({ steps: 1_000 }),
      bodyMassKg: 80,
      equipment: null,
    });
    for (const result of [missingSteps, missingMass, missingEquipment]) {
      expect(result.availability).toBe("unavailable");
      expect(result.estimatedActiveKcal).toBeNull();
      expect(result.lowerBoundKcal).toBeNull();
      expect(result.upperBoundKcal).toBeNull();
      expect(result.reasons).toContain("missing-evidence-is-not-zero-kcal");
    }
  });

  it("keeps Garmin active kcal as optional reference and never as estimation target", () => {
    const withGarmin = estimateExperimentalStepperActiveEnergyV1({
      workout: stepper({
        steps: 1_200,
        energy: {
          deviceEnergy: {
            availability: "available",
            sourceValueStatus: "observed",
            valueKcal: 999,
            semantics: "active",
            provenance: "device-estimate",
          },
        },
      }),
      bodyMassKg: 80,
      equipment,
    });
    const withoutGarmin = estimateExperimentalStepperActiveEnergyV1({
      workout: stepper({ steps: 1_200 }),
      bodyMassKg: 80,
      equipment,
    });
    expect(withGarmin.estimatedActiveKcal).toBe(withoutGarmin.estimatedActiveKcal);
    expect(withGarmin.garminReferenceKcal).toBe(999);
    expect(withoutGarmin.garminReferenceKcal).toBeNull();
    expect(withGarmin.features.rejectedMethods).toContain("garmin-truth-calibration");
    expect(withGarmin.reasons).toContain("garmin-active-kcal-reference-only-not-truth");
  });

  it("uses HR only as coverage/context and never as a kcal driver", () => {
    const noHr = estimateExperimentalStepperActiveEnergyV1({
      workout: stepper({ steps: 1_200 }),
      bodyMassKg: 80,
      equipment,
    });
    const withHr = estimateExperimentalStepperActiveEnergyV1({
      workout: stepper({
        steps: 1_200,
        energy: {
          heartRate: canonicalizeWorkoutHeartRateEvidenceV7({
            workoutInterval: { startAt, endAt },
            heartRate: {
              availability: "loaded",
              samples: [
                { timestamp: "2026-09-18T16:05:00.000Z", bpm: 140, provenance: { provider: "garmin", device: null } },
                { timestamp: "2026-09-18T16:10:00.000Z", bpm: 150, provenance: { provider: "garmin", device: null } },
                { timestamp: "2026-09-18T16:15:00.000Z", bpm: 155, provenance: { provider: "garmin", device: null } },
              ],
            },
          }),
        },
      }),
      bodyMassKg: 80,
      equipment,
    });
    expect(withHr.estimatedActiveKcal).toBe(noHr.estimatedActiveKcal);
    expect(withHr.features.hrCoverage).toBe("contextual");
    expect(noHr.features.hrCoverage).toBe("unavailable");
    expect(withHr.features.rejectedMethods).toContain("hr-to-kcal-formula");
    expect(withHr.reasons).toContain("hr-context-coverage-only-not-kcal");
  });

  it("is deterministic for identical inputs", () => {
    const input = {
      workout: stepper({ steps: 1_800 }),
      bodyMassKg: 82.5,
      equipment,
    };
    const a = estimateExperimentalStepperActiveEnergyV1(input);
    const b = estimateExperimentalStepperActiveEnergyV1(input);
    expect(a).toEqual(b);
    expect(experimentalStepperActiveEnergyV1Fingerprint(a))
      .toBe(experimentalStepperActiveEnergyV1Fingerprint(b));
  });

  it("rejects fixed MET, HR→kcal, Garmin calibration, and EPOC add-ons", () => {
    const result = estimateExperimentalStepperActiveEnergyV1({
      workout: stepper({ steps: 900 }),
      bodyMassKg: 70,
      equipment,
    });
    expect(result.features.rejectedMethods).toEqual([
      "fixed-met-fallback",
      "hr-to-kcal-formula",
      "garmin-truth-calibration",
      "epoc-recovery-add-on",
    ]);
    expect(result.recoveryEnergy.application).toBe("intentionally-not-applied");
    expect(JSON.stringify(result)).not.toMatch(/\bgrossMet\b|\bepocPercent\b|calibrateToGarmin/i);
  });

  it("matches the explicit mechanical work formula", () => {
    const bodyMassKg = 80;
    const steps = 1_000;
    const height = 0.16;
    const eta = 0.2;
    const work = mechanicalVerticalWorkJoulesV1({
      bodyMassKg,
      stepHeightM: height,
      stepCount: steps,
    });
    expect(work).toBe(bodyMassKg * STANDARD_GRAVITY_M_PER_S2 * height * steps);
    expect(activeKcalFromMechanicalWorkV1({ mechanicalWorkJ: work, efficiencyFraction: eta }))
      .toBe(work / eta / JOULES_PER_THERMOCHEMICAL_KCAL);
  });

  it("does not appear in production TDEE, forecast, or workout-energy resolver paths", () => {
    const workoutEnergy = readFileSync("src/model/activity/workout-energy.ts", "utf8");
    const forecast = readFileSync("src/modules/model-forecast/forecast-engine.ts", "utf8");
    const runtime = readFileSync("src/model/physiology-v7/daily-runtime-v7.ts", "utf8");
    expect(workoutEnergy).not.toContain("estimateExperimentalStepperActiveEnergyV1");
    expect(forecast).not.toContain("estimateExperimentalStepperActiveEnergyV1");
    expect(runtime).not.toContain("estimateExperimentalStepperActiveEnergyV1");
  });
});
