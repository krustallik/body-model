import { describe, expect, it } from "vitest";
import { CANONICAL_EXERCISE_IDENTITIES } from "@/modules/training/canonical-exercise-identity";
import {
  approvedExerciseMuscleMappingCoverageV7,
  assertMappingHasNoNumericWeights,
  buildExerciseMuscleMappingSnapshotV7,
  CANONICAL_MUSCLE_GROUPS_V7,
  describeExerciseMuscleMappingSnapshotV7,
  EXERCISE_MUSCLE_MAPPING_REGISTRY_V7,
  EXERCISE_MUSCLE_MAPPING_V7_VERSION,
  isCanonicalMuscleGroupV7,
  lookupExerciseMuscleMappingV7,
  parseExerciseMuscleMappingSnapshotV7,
} from "@/model/physiology-v7/exercise-muscle-mapping-v7";

describe("ExerciseMuscleMappingV7 registry", () => {
  it("covers all thirteen canonical stableKeys with the same mappingVersion", () => {
    const coverage = approvedExerciseMuscleMappingCoverageV7();
    expect(coverage).toEqual({ expected: 13, mapped: 13, missingStableKeys: [] });
    expect(EXERCISE_MUSCLE_MAPPING_REGISTRY_V7.size).toBe(13);

    for (const identity of CANONICAL_EXERCISE_IDENTITIES) {
      const mapping = lookupExerciseMuscleMappingV7(identity.stableKey);
      expect(mapping).not.toBeNull();
      expect(mapping!.mappingVersion).toBe(EXERCISE_MUSCLE_MAPPING_V7_VERSION);
      expect(mapping!.stableKey).toBe(identity.stableKey);
      expect(mapping!.targets.length).toBeGreaterThan(0);
      expect(mapping!.targets.every((target) => (
        target.role === "direct" || target.role === "indirect"
      ))).toBe(true);
      assertMappingHasNoNumericWeights(mapping!);
    }
  });

  it("maps standard pull-ups to back with biceps and forearms assisting", () => {
    expect(buildExerciseMuscleMappingSnapshotV7("pull_up")).toMatchObject({
      availability: "available",
      stableKey: "pull_up",
      targets: [
        { muscleGroup: "back", role: "direct" },
        { muscleGroup: "biceps", role: "indirect" },
        { muscleGroup: "forearms", role: "indirect" },
      ],
    });
  });

  it("looks up only by stableKey and never by display name", () => {
    const byKey = lookupExerciseMuscleMappingV7("flat_dumbbell_fly");
    expect(byKey?.stableKey).toBe("flat_dumbbell_fly");
    expect(lookupExerciseMuscleMappingV7("Розведення гантелей на горизонтальній лаві")).toBeNull();
    expect(lookupExerciseMuscleMappingV7(null)).toBeNull();
    expect(lookupExerciseMuscleMappingV7("unknown_custom")).toBeNull();
  });

  it("rejects unknown taxonomy groups and keeps roles categorical", () => {
    expect(isCanonicalMuscleGroupV7("chest")).toBe(true);
    expect(isCanonicalMuscleGroupV7("gluteus_maximus")).toBe(false);
    expect([...CANONICAL_MUSCLE_GROUPS_V7]).toEqual([
      "chest",
      "deltoids",
      "triceps",
      "back",
      "biceps",
      "forearms",
      "spinal_extensors",
      "hip_extensors",
    ]);

    const snapshot = buildExerciseMuscleMappingSnapshotV7("one_arm_seated_cable_row");
    expect(snapshot.availability).toBe("available");
    if (snapshot.availability === "available") {
      expect(snapshot.targets.every((target) => !("weight" in target))).toBe(true);
      expect(snapshot.provenance).toBe("approved-v7-registry");
    }
  });

  it("builds unavailable snapshots without inventing mappings", () => {
    expect(buildExerciseMuscleMappingSnapshotV7(null)).toMatchObject({
      availability: "unavailable",
      reason: "missing-stable-key",
      targets: [],
    });
    expect(buildExerciseMuscleMappingSnapshotV7("custom_unmapped")).toMatchObject({
      availability: "unavailable",
      reason: "unregistered-stable-key",
      stableKey: "custom_unmapped",
    });

    const diagnostics = describeExerciseMuscleMappingSnapshotV7(
      buildExerciseMuscleMappingSnapshotV7("hyperextension"),
    );
    expect(diagnostics).toMatchObject({
      mappingAvailability: "available",
      stableKey: "hyperextension",
      directTargets: ["spinal_extensors", "hip_extensors"],
      mappedTargetCount: 2,
    });
  });

  it("keeps historical v7.1 snapshots parseable after the v7.2 taxonomy revision", () => {
    const legacy = {
      contractVersion: "bodycast-exercise-muscle-mapping-snapshot-v7-1",
      availability: "available",
      mappingVersion: "bodycast-exercise-muscle-mapping-v7.1",
      stableKey: "hyperextension",
      provenance: "approved-v7-registry",
      targets: [{ muscleGroup: "spinal_extensors", role: "direct" }],
    };
    const parsed = parseExerciseMuscleMappingSnapshotV7(legacy);
    expect(parsed).toMatchObject({
      availability: "available",
      mappingVersion: "bodycast-exercise-muscle-mapping-v7.1",
      stableKey: "hyperextension",
      targets: [{ muscleGroup: "spinal_extensors", role: "direct" }],
    });
  });
});
