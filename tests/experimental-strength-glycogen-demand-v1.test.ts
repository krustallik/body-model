import { describe, expect, it } from "vitest";
import { buildExerciseMuscleMappingSnapshotV7 } from "@/model/physiology-v7/exercise-muscle-mapping-v7";
import {
  estimateExperimentalStrengthGlycogenDemandV1,
  experimentalStrengthGlycogenDemandV1Fingerprint,
  EXPERIMENTAL_STRENGTH_GLYCOGEN_DEMAND_V1_PROVENANCE,
  EXPERIMENTAL_STRENGTH_GLYCOGEN_DEMAND_V1_REVISION,
} from "@/model/physiology-v7/experimental-strength-glycogen-demand-v1";
import { buildQualifiedResistanceTrainingDoseV7 } from "@/model/physiology-v7/qualified-resistance-training-dose-v7";
import { buildCanonicalStrengthTrainingInputV7 } from "@/modules/model-episodes/strength-training-input-v7";
import { RESISTANCE } from "@/modules/training/training.constants";
import type { StrengthSessionDto } from "@/modules/training/training.types";
import { readFileSync } from "node:fs";

function baseSession(
  exercises: StrengthSessionDto["exercises"],
  overrides: Partial<StrengthSessionDto> = {},
): StrengthSessionDto {
  return {
    id: 42,
    status: "COMPLETED",
    entryMode: "RETROSPECTIVE",
    revision: 3,
    programId: 7,
    programName: "Program",
    programVersionId: 9,
    programVersionNumber: 1,
    webStartedAt: null,
    webEndedAt: null,
    matchStatus: "MATCHED",
    matchMethod: "DIRECT_BACKFILL",
    matchedAt: "2026-09-17T18:30:00.000Z",
    matchedWorkoutId: 99,
    matchedWorkout: {
      id: 99,
      type: "Strength Training",
      startAt: "2026-09-17T17:00:00.000Z",
      endAt: "2026-09-17T18:00:00.000Z",
      durationMinutes: 60,
      activeEnergyKcal: 400,
      externalId: "garmin-99",
    },
    exercises,
    ordinaryTonnageKg: null,
    createdAt: "2026-09-17T17:00:00.000Z",
    updatedAt: "2026-09-17T18:30:00.000Z",
    ...overrides,
  };
}

function set(input: {
  id: number;
  sessionExerciseId: number;
  setNumber: number;
  reps?: number;
  weightKg?: number | null;
  rir?: number | null;
}) {
  return {
    id: input.id,
    sessionExerciseId: input.sessionExerciseId,
    setNumber: input.setNumber,
    reps: input.reps ?? 8,
    weightKg: input.weightKg === undefined ? 40 : input.weightKg,
    bandNominalResistanceKg: null,
    rir: input.rir === undefined ? null : input.rir,
    comment: null,
    completedAt: null,
    createdAt: "2026-09-17T17:00:00.000Z",
    updatedAt: "2026-09-17T17:00:00.000Z",
  };
}

function doseFor(
  exercises: StrengthSessionDto["exercises"],
  overrides: Partial<StrengthSessionDto> = {},
) {
  return buildQualifiedResistanceTrainingDoseV7(
    buildCanonicalStrengthTrainingInputV7({
      session: baseSession(exercises, overrides),
      heartRateSamples: null,
    }),
  );
}

function hyperextensionSets(count: number, startId = 100) {
  return Array.from({ length: count }, (_, index) => set({
    id: startId + index,
    sessionExerciseId: 1,
    setNumber: index + 1,
  }));
}

function curlSets(count: number, startId = 200) {
  return Array.from({ length: count }, (_, index) => set({
    id: startId + index,
    sessionExerciseId: 2,
    setNumber: index + 1,
    weightKg: 12,
  }));
}

/**
 * EXPERIMENTAL harness — not scientific validation / GREEN oracle.
 */
describe("experimental strength glycogen demand v1", () => {
  it("keeps exercise-only glycogen delta nonpositive (C-F01)", () => {
    const result = estimateExperimentalStrengthGlycogenDemandV1({
      dose: doseFor([{
        id: 1,
        sourceExerciseCatalogId: 10,
        stableKey: "hyperextension",
        snapshotExerciseName: "Hyperextension",
        order: 1,
        plannedSets: 8,
        resistanceType: RESISTANCE.BODYWEIGHT,
        origin: "PLANNED",
        muscleMappingSnapshot: buildExerciseMuscleMappingSnapshotV7("hyperextension"),
        sets: hyperextensionSets(8),
      }]),
      availableGlycogenKg: 0.5,
      activeEnergyKcal: 400,
    });
    expect(result.availability).toBe("available");
    expect(result.estimatedGlycogenDeltaKg).toBeLessThanOrEqual(0);
    expect(result.lowerBoundKg).toBeLessThanOrEqual(result.estimatedGlycogenDeltaKg!);
    expect(result.upperBoundKg).toBeGreaterThanOrEqual(result.estimatedGlycogenDeltaKg!);
    expect(result.upperBoundKg).toBeLessThanOrEqual(0);
    expect(result.provenance).toBe(EXPERIMENTAL_STRENGTH_GLYCOGEN_DEMAND_V1_PROVENANCE);
    expect(result.contractVersion).toBe(EXPERIMENTAL_STRENGTH_GLYCOGEN_DEMAND_V1_REVISION);
  });

  it("bounds depletion to the available glycogen store (C-F02)", () => {
    const dose = doseFor([{
      id: 1,
      sourceExerciseCatalogId: 10,
      stableKey: "hyperextension",
      snapshotExerciseName: "Hyperextension",
      order: 1,
      plannedSets: 20,
      resistanceType: RESISTANCE.BODYWEIGHT,
      origin: "PLANNED",
      muscleMappingSnapshot: buildExerciseMuscleMappingSnapshotV7("hyperextension"),
      sets: hyperextensionSets(20),
    }]);
    const unbounded = estimateExperimentalStrengthGlycogenDemandV1({
      dose,
      availableGlycogenKg: null,
      activeEnergyKcal: 900,
    });
    const bounded = estimateExperimentalStrengthGlycogenDemandV1({
      dose,
      availableGlycogenKg: 0.01,
      activeEnergyKcal: 900,
    });
    expect(unbounded.availability).toBe("available");
    expect(unbounded.estimatedGlycogenDeltaKg!).toBeLessThan(-0.01);
    expect(bounded.estimatedGlycogenDeltaKg).toBe(-0.01);
    expect(bounded.lowerBoundKg).toBe(-0.01);
    expect(bounded.upperBoundKg).toBeLessThanOrEqual(0);
    expect(bounded.features.storeBoundApplied).toBe(true);
    expect(bounded.estimatedGlycogenDeltaKg!).toBeGreaterThanOrEqual(-0.01);

    const empty = estimateExperimentalStrengthGlycogenDemandV1({
      dose,
      availableGlycogenKg: 0,
    });
    expect(empty.estimatedGlycogenDeltaKg).toBe(0);
    expect(empty.lowerBoundKg).toBe(0);
    expect(empty.upperBoundKg).toBe(0);
  });

  it("does not lower estimated demand when contained comparable work increases (C-F03)", () => {
    const lower = estimateExperimentalStrengthGlycogenDemandV1({
      dose: doseFor([{
        id: 1,
        sourceExerciseCatalogId: 10,
        stableKey: "hyperextension",
        snapshotExerciseName: "Hyperextension",
        order: 1,
        plannedSets: 4,
        resistanceType: RESISTANCE.BODYWEIGHT,
        origin: "PLANNED",
        muscleMappingSnapshot: buildExerciseMuscleMappingSnapshotV7("hyperextension"),
        sets: hyperextensionSets(4),
      }]),
      availableGlycogenKg: 0.5,
    });
    const higher = estimateExperimentalStrengthGlycogenDemandV1({
      dose: doseFor([{
        id: 1,
        sourceExerciseCatalogId: 10,
        stableKey: "hyperextension",
        snapshotExerciseName: "Hyperextension",
        order: 1,
        plannedSets: 8,
        resistanceType: RESISTANCE.BODYWEIGHT,
        origin: "PLANNED",
        muscleMappingSnapshot: buildExerciseMuscleMappingSnapshotV7("hyperextension"),
        sets: hyperextensionSets(8),
      }]),
      availableGlycogenKg: 0.5,
    });
    expect(lower.availability).toBe("available");
    expect(higher.availability).toBe("available");
    // Higher work → more depletion → more negative or equal delta (not lower demand).
    expect(higher.estimatedGlycogenDeltaKg!).toBeLessThanOrEqual(lower.estimatedGlycogenDeltaKg!);
    expect(Math.abs(higher.estimatedGlycogenDeltaKg!))
      .toBeGreaterThanOrEqual(Math.abs(lower.estimatedGlycogenDeltaKg!));
  });

  it("uses muscle mapping so equal set counts are not universal (C-F04)", () => {
    const large = estimateExperimentalStrengthGlycogenDemandV1({
      dose: doseFor([{
        id: 1,
        sourceExerciseCatalogId: 10,
        stableKey: "hyperextension",
        snapshotExerciseName: "Hyperextension",
        order: 1,
        plannedSets: 6,
        resistanceType: RESISTANCE.BODYWEIGHT,
        origin: "PLANNED",
        muscleMappingSnapshot: buildExerciseMuscleMappingSnapshotV7("hyperextension"),
        sets: hyperextensionSets(6),
      }]),
      availableGlycogenKg: 0.5,
    });
    const small = estimateExperimentalStrengthGlycogenDemandV1({
      dose: doseFor([{
        id: 2,
        sourceExerciseCatalogId: 11,
        stableKey: "one_arm_concentration_curl",
        snapshotExerciseName: "Curl",
        order: 1,
        plannedSets: 6,
        resistanceType: RESISTANCE.EXTERNAL_WEIGHT,
        origin: "PLANNED",
        muscleMappingSnapshot: buildExerciseMuscleMappingSnapshotV7("one_arm_concentration_curl"),
        sets: curlSets(6),
      }]),
      availableGlycogenKg: 0.5,
    });
    expect(large.features.muscleGroupsUsed).toEqual(
      expect.arrayContaining(["hip_extensors", "spinal_extensors"]),
    );
    expect(small.features.muscleGroupsUsed).toContain("biceps");
    expect(Math.abs(large.estimatedGlycogenDeltaKg!))
      .toBeGreaterThan(Math.abs(small.estimatedGlycogenDeltaKg!));
  });

  it("treats missing mapped dose as unavailable, not zero depletion", () => {
    const missing = estimateExperimentalStrengthGlycogenDemandV1({
      dose: doseFor([{
        id: 1,
        sourceExerciseCatalogId: 10,
        stableKey: null,
        snapshotExerciseName: "Unknown",
        order: 1,
        plannedSets: 3,
        resistanceType: RESISTANCE.EXTERNAL_WEIGHT,
        origin: "PLANNED",
        muscleMappingSnapshot: null,
        sets: [set({ id: 1, sessionExerciseId: 1, setNumber: 1 })],
      }]),
      availableGlycogenKg: 0.5,
    });
    expect(missing.availability).toBe("unavailable");
    expect(missing.estimatedGlycogenDeltaKg).toBeNull();
    expect(missing.lowerBoundKg).toBeNull();
    expect(missing.upperBoundKg).toBeNull();
    expect(missing.unavailableReason).toBe("dose-unavailable");
    expect(missing.reasons).toContain("missing-mapped-dose-is-not-zero-depletion");
  });

  it("is deterministic for identical inputs", () => {
    const input = {
      dose: doseFor([{
        id: 1,
        sourceExerciseCatalogId: 10,
        stableKey: "hyperextension",
        snapshotExerciseName: "Hyperextension",
        order: 1,
        plannedSets: 5,
        resistanceType: RESISTANCE.BODYWEIGHT,
        origin: "PLANNED",
        muscleMappingSnapshot: buildExerciseMuscleMappingSnapshotV7("hyperextension"),
        sets: hyperextensionSets(5),
      }]),
      availableGlycogenKg: 0.4,
      activeEnergyKcal: 250,
    };
    const a = estimateExperimentalStrengthGlycogenDemandV1(input);
    const b = estimateExperimentalStrengthGlycogenDemandV1(input);
    expect(a).toEqual(b);
    expect(experimentalStrengthGlycogenDemandV1Fingerprint(a))
      .toBe(experimentalStrengthGlycogenDemandV1Fingerprint(b));
  });

  it("rejects kcal, residual, substrate-percent, and personal-capacity conversions", () => {
    const withKcal = estimateExperimentalStrengthGlycogenDemandV1({
      dose: doseFor([{
        id: 1,
        sourceExerciseCatalogId: 10,
        stableKey: "hyperextension",
        snapshotExerciseName: "Hyperextension",
        order: 1,
        plannedSets: 4,
        resistanceType: RESISTANCE.BODYWEIGHT,
        origin: "PLANNED",
        muscleMappingSnapshot: buildExerciseMuscleMappingSnapshotV7("hyperextension"),
        sets: hyperextensionSets(4),
      }]),
      availableGlycogenKg: 0.5,
      activeEnergyKcal: 400,
    });
    const withoutKcal = estimateExperimentalStrengthGlycogenDemandV1({
      dose: doseFor([{
        id: 1,
        sourceExerciseCatalogId: 10,
        stableKey: "hyperextension",
        snapshotExerciseName: "Hyperextension",
        order: 1,
        plannedSets: 4,
        resistanceType: RESISTANCE.BODYWEIGHT,
        origin: "PLANNED",
        muscleMappingSnapshot: buildExerciseMuscleMappingSnapshotV7("hyperextension"),
        sets: hyperextensionSets(4),
      }]),
      availableGlycogenKg: 0.5,
      activeEnergyKcal: 0,
    });
    expect(withKcal.estimatedGlycogenDeltaKg).toBe(withoutKcal.estimatedGlycogenDeltaKg);
    expect(withKcal.features.ignoredActiveEnergyKcal).toBe(400);
    expect(withKcal.features.rejectedConversions).toEqual([
      "kcal-to-glycogen",
      "universal-substrate-percent",
      "scale-weight-residual",
      "literature-personal-capacity",
      "ecological-mmol-per-set-coefficient",
    ]);
    expect(JSON.stringify(withKcal)).not.toMatch(/residualAllocate|substratePercent|kcalToGlycogen/i);
  });

  it("does not appear in production daily-runtime or forecast glycogen paths", () => {
    const runtime = readFileSync("src/model/physiology-v7/daily-runtime-v7.ts", "utf8");
    const forecast = readFileSync("src/modules/model-forecast/forecast-engine.ts", "utf8");
    const glycogen = readFileSync("src/model/physiology-v7/glycogen-transition-v7.ts", "utf8");
    expect(runtime).not.toContain("experimental-strength-glycogen-demand");
    expect(runtime).not.toContain("estimateExperimentalStrengthGlycogenDemandV1");
    expect(forecast).not.toContain("estimateExperimentalStrengthGlycogenDemandV1");
    expect(glycogen).not.toContain("estimateExperimentalStrengthGlycogenDemandV1");
  });
});
