import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { buildExerciseMuscleMappingSnapshotV7 } from "@/model/physiology-v7/exercise-muscle-mapping-v7";
import {
  estimateExperimentalStepperGlycogenDemandV1,
  experimentalStepperGlycogenDemandV1Fingerprint,
  EXPERIMENTAL_STEPPER_GLYCOGEN_DEMAND_V1_PROVENANCE,
  EXPERIMENTAL_STEPPER_GLYCOGEN_DEMAND_V1_REVISION,
  strengthAndStepperGlycogenDifferAtEqualActiveKcalV1,
} from "@/model/physiology-v7/experimental-stepper-glycogen-demand-v1";
import { estimateExperimentalStrengthGlycogenDemandV1 } from "@/model/physiology-v7/experimental-strength-glycogen-demand-v1";
import { buildQualifiedResistanceTrainingDoseV7 } from "@/model/physiology-v7/qualified-resistance-training-dose-v7";
import { buildCanonicalStrengthTrainingInputV7 } from "@/modules/model-episodes/strength-training-input-v7";
import { canonicalizeWorkoutHeartRateEvidenceV7 } from "@/model/activity/workout-heart-rate-v7";
import type { WorkoutEnergyEvidenceV7 } from "@/model/activity/workout-energy-v7";
import type { WorkoutStepperEvidenceV7 } from "@/model/activity/workout-stepper-v7";
import type { StepperEquipmentAssignmentV7 } from "@/model/activity/personal-stepper-reference-v7";
import { RESISTANCE } from "@/modules/training/training.constants";
import type { StrengthSessionDto } from "@/modules/training/training.types";

const startAt = "2026-09-18T16:00:00.000Z";
const endAt = "2026-09-18T16:40:00.000Z";

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
    workoutId: 77,
    canonicalWorkoutType: "Stair Climbing",
    startAt,
    endAt,
    durationMinutes: 40,
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
  const durationMinutes = input.durationMinutes ?? 40;
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

function strengthDose(setCount: number) {
  const sets = Array.from({ length: setCount }, (_, index) => ({
    id: 100 + index,
    sessionExerciseId: 1,
    setNumber: index + 1,
    reps: 8,
    weightKg: null,
    bandNominalResistanceKg: null,
    rir: null,
    comment: null,
    completedAt: null,
    createdAt: "2026-09-17T17:00:00.000Z",
    updatedAt: "2026-09-17T17:00:00.000Z",
  }));
  const session = {
    id: 42,
    status: "COMPLETED",
    entryMode: "RETROSPECTIVE",
    revision: 1,
    programId: 1,
    programName: "P",
    programVersionId: 1,
    programVersionNumber: 1,
    webStartedAt: null,
    webEndedAt: null,
    matchStatus: "MATCHED",
    matchMethod: "DIRECT_BACKFILL",
    matchedAt: null,
    matchedWorkoutId: 99,
    matchedWorkout: {
      id: 99,
      type: "Strength Training",
      startAt: "2026-09-17T17:00:00.000Z",
      endAt: "2026-09-17T18:00:00.000Z",
      durationMinutes: 60,
      activeEnergyKcal: 300,
      externalId: null,
    },
    ordinaryTonnageKg: null,
    createdAt: "2026-09-17T17:00:00.000Z",
    updatedAt: "2026-09-17T18:00:00.000Z",
    exercises: [{
      id: 1,
      sourceExerciseCatalogId: 2,
      stableKey: "hyperextension",
      snapshotExerciseName: "Hyperextension",
      order: 1,
      plannedSets: setCount,
      resistanceType: RESISTANCE.BODYWEIGHT,
      origin: "PLANNED",
      muscleMappingSnapshot: buildExerciseMuscleMappingSnapshotV7("hyperextension"),
      sets,
    }],
  } satisfies StrengthSessionDto;
  return buildQualifiedResistanceTrainingDoseV7(
    buildCanonicalStrengthTrainingInputV7({ session, heartRateSamples: null }),
  );
}

/**
 * EXPERIMENTAL harness — not scientific validation / GREEN oracle.
 */
describe("experimental stepper glycogen demand v1", () => {
  it("keeps exercise-only glycogen delta nonpositive and store-bounded (C-G01)", () => {
    const result = estimateExperimentalStepperGlycogenDemandV1({
      workout: stepper({ steps: 2_800 }),
      bodyMassKg: 80,
      equipment,
      availableGlycogenKg: 0.3,
    });
    expect(result.availability).toBe("available");
    expect(result.estimatedGlycogenDeltaKg!).toBeLessThanOrEqual(0);
    expect(result.lowerBoundKg!).toBeLessThanOrEqual(result.estimatedGlycogenDeltaKg!);
    expect(result.upperBoundKg!).toBeGreaterThanOrEqual(result.estimatedGlycogenDeltaKg!);
    expect(result.upperBoundKg!).toBeLessThanOrEqual(0);
    expect(result.estimatedGlycogenDeltaKg!).toBeGreaterThanOrEqual(-0.3);
    expect(result.lowerBoundKg!).toBeGreaterThanOrEqual(-0.3);
    expect(result.provenance).toBe(EXPERIMENTAL_STEPPER_GLYCOGEN_DEMAND_V1_PROVENANCE);
    expect(result.contractVersion).toBe(EXPERIMENTAL_STEPPER_GLYCOGEN_DEMAND_V1_REVISION);
  });

  it("bounds depletion to the available glycogen store", () => {
    const result = estimateExperimentalStepperGlycogenDemandV1({
      workout: stepper({ steps: 5_000, durationMinutes: 60 }),
      bodyMassKg: 90,
      equipment,
      availableGlycogenKg: 0.02,
    });
    expect(result.estimatedGlycogenDeltaKg).toBe(-0.02);
    expect(result.lowerBoundKg).toBe(-0.02);
    expect(result.features.storeBoundApplied).toBe(true);
  });

  it("increases depletion magnitude with longer matched-rate duration / more steps", () => {
    const short = estimateExperimentalStepperGlycogenDemandV1({
      workout: stepper({ steps: 1_400, durationMinutes: 20 }),
      bodyMassKg: 80,
      equipment,
    });
    const long = estimateExperimentalStepperGlycogenDemandV1({
      workout: stepper({ steps: 2_800, durationMinutes: 40 }),
      bodyMassKg: 80,
      equipment,
    });
    expect(long.estimatedGlycogenDeltaKg!).toBeLessThan(short.estimatedGlycogenDeltaKg!);
  });

  it("treats missing session evidence as unavailable, not zero depletion", () => {
    const missingSteps = estimateExperimentalStepperGlycogenDemandV1({
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
    const missingMass = estimateExperimentalStepperGlycogenDemandV1({
      workout: stepper({ steps: 2_000 }),
      bodyMassKg: null,
      equipment,
    });
    const missingEquipment = estimateExperimentalStepperGlycogenDemandV1({
      workout: stepper({ steps: 2_000 }),
      bodyMassKg: 80,
      equipment: null,
    });
    for (const result of [missingSteps, missingMass, missingEquipment]) {
      expect(result.availability).toBe("unavailable");
      expect(result.estimatedGlycogenDeltaKg).toBeNull();
      expect(result.reasons).toContain("missing-evidence-is-not-zero-depletion");
    }
  });

  it("does not convert active kcal into glycogen demand", () => {
    const without = estimateExperimentalStepperGlycogenDemandV1({
      workout: stepper({ steps: 2_200 }),
      bodyMassKg: 80,
      equipment,
      activeEnergyKcal: null,
    });
    const withKcal = estimateExperimentalStepperGlycogenDemandV1({
      workout: stepper({ steps: 2_200 }),
      bodyMassKg: 80,
      equipment,
      activeEnergyKcal: 999,
    });
    expect(withKcal.estimatedGlycogenDeltaKg).toBe(without.estimatedGlycogenDeltaKg);
    expect(withKcal.features.ignoredActiveEnergyKcal).toBe(999);
    expect(withKcal.features.rejectedConversions).toContain("kcal-to-glycogen");
    expect(withKcal.reasons).toContain("kcal-to-glycogen-intentionally-rejected");
  });

  it("allows strength vs stepper glycogen demand to differ at equal active kcal (C-G04, C-F05)", () => {
    const sharedKcal = 300;
    const strength = estimateExperimentalStrengthGlycogenDemandV1({
      dose: strengthDose(12),
      availableGlycogenKg: 0.5,
      activeEnergyKcal: sharedKcal,
    });
    const stepperResult = estimateExperimentalStepperGlycogenDemandV1({
      workout: stepper({ steps: 2_500, durationMinutes: 35 }),
      bodyMassKg: 80,
      equipment,
      availableGlycogenKg: 0.5,
      activeEnergyKcal: sharedKcal,
    });
    expect(strength.availability).toBe("available");
    expect(stepperResult.availability).toBe("available");
    expect(strength.estimatedGlycogenDeltaKg).not.toBe(stepperResult.estimatedGlycogenDeltaKg);
    expect(strengthAndStepperGlycogenDifferAtEqualActiveKcalV1({
      strength: { dose: strengthDose(12), availableGlycogenKg: 0.5 },
      stepper: {
        workout: stepper({ steps: 2_500, durationMinutes: 35 }),
        bodyMassKg: 80,
        equipment,
        availableGlycogenKg: 0.5,
      },
      sharedActiveEnergyKcal: sharedKcal,
    })).toBe(true);
    expect(stepperResult.features.rejectedConversions).toContain(
      "equal-active-kcal-cross-modality-identity",
    );
  });

  it("is deterministic for identical inputs", () => {
    const input = {
      workout: stepper({ steps: 2_100 }),
      bodyMassKg: 82,
      equipment,
      availableGlycogenKg: 0.4,
      activeEnergyKcal: 250,
    };
    const a = estimateExperimentalStepperGlycogenDemandV1(input);
    const b = estimateExperimentalStepperGlycogenDemandV1(input);
    expect(a).toEqual(b);
    expect(experimentalStepperGlycogenDemandV1Fingerprint(a))
      .toBe(experimentalStepperGlycogenDemandV1Fingerprint(b));
  });

  it("does not appear in production glycogen transition, TDEE, or forecast paths", () => {
    const glycogen = readFileSync("src/model/physiology-v7/glycogen-transition-v7.ts", "utf8");
    const forecast = readFileSync("src/modules/model-forecast/forecast-engine.ts", "utf8");
    const runtime = readFileSync("src/model/physiology-v7/daily-runtime-v7.ts", "utf8");
    expect(glycogen).not.toContain("estimateExperimentalStepperGlycogenDemandV1");
    expect(forecast).not.toContain("estimateExperimentalStepperGlycogenDemandV1");
    expect(runtime).not.toContain("estimateExperimentalStepperGlycogenDemandV1");
  });
});
