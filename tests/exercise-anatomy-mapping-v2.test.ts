import { describe, expect, it } from "vitest";
import { projectStoredExerciseMappingToBodyMapV2 } from "@/modules/training/body-map-training-exposure-v2";
import {
  EXERCISE_ANATOMY_MAPPING_REGISTRY_V2,
  EXERCISE_ANATOMY_SNAPSHOT_V2_PROPERTY,
  parseExerciseAnatomySnapshotV2,
} from "@/modules/training/exercise-anatomy-mapping-v2";
import {
  EXERCISE_ANATOMY_SNAPSHOT_PROPERTY,
  exerciseMappingSnapshotWithAnatomyV1,
} from "@/modules/training/exercise-anatomy-mapping-v1";
import { parseExerciseMuscleMappingSnapshotV7 } from "@/model/physiology-v7/exercise-muscle-mapping-v7";

const expectedKeys = [
  "bulgarian_split_squat",
  "forward_dumbbell_lunge",
  "goblet_squat",
  "dumbbell_crunch",
  "dumbbell_russian_twist",
] as const;

describe("exercise anatomy mapping v2", () => {
  it("adds partial, evidenced Body Map targets without changing the V7 physiology snapshot", () => {
    expect(Object.keys(EXERCISE_ANATOMY_MAPPING_REGISTRY_V2).sort()).toEqual([...expectedKeys].sort());
    for (const stableKey of expectedKeys) {
      const combined = exerciseMappingSnapshotWithAnatomyV1(stableKey);
      expect(parseExerciseMuscleMappingSnapshotV7(combined)).toMatchObject({
        stableKey,
        availability: "unavailable",
        targets: [],
      });
      expect(combined[EXERCISE_ANATOMY_SNAPSHOT_PROPERTY]).toMatchObject({
        availability: "unavailable",
        stableKey,
      });
      const snapshot = combined[EXERCISE_ANATOMY_SNAPSHOT_V2_PROPERTY];
      expect(snapshot).not.toBeNull();
      expect(parseExerciseAnatomySnapshotV2(snapshot)).toEqual(snapshot);
      expect(parseExerciseAnatomySnapshotV2(JSON.parse(JSON.stringify(snapshot)))).toEqual(snapshot);
      expect(snapshot?.coverage).toBe("partial");
      expect(snapshot?.targets.length).toBeGreaterThan(0);
      expect(snapshot?.evidence.length).toBeGreaterThan(0);
    }
  });

  it("projects the persisted v2 snapshot to Body Map groups while preserving primary/secondary roles", () => {
    const squat = exerciseMappingSnapshotWithAnatomyV1("goblet_squat");
    const projected = projectStoredExerciseMappingToBodyMapV2("set-1", squat);
    expect(projected).toEqual(expect.arrayContaining([
      expect.objectContaining({ groupId: "quadriceps", exposure: "direct", physicalSetId: "set-1" }),
      expect.objectContaining({ groupId: "gluteals", exposure: "direct", physicalSetId: "set-1" }),
      expect.objectContaining({ groupId: "core", exposure: "indirect", physicalSetId: "set-1" }),
    ]));

    const twist = exerciseMappingSnapshotWithAnatomyV1("dumbbell_russian_twist");
    expect(projectStoredExerciseMappingToBodyMapV2("set-2", twist)).toEqual(expect.arrayContaining([
      expect.objectContaining({ groupId: "core", exposure: "direct", physicalSetId: "set-2" }),
    ]));
  });

  it("fails closed for malformed v2 snapshot and keeps existing v1 snapshots projectable", () => {
    const malformed = exerciseMappingSnapshotWithAnatomyV1("goblet_squat") as Record<string, unknown>;
    malformed[EXERCISE_ANATOMY_SNAPSHOT_V2_PROPERTY] = { contractVersion: "wrong" };
    expect(projectStoredExerciseMappingToBodyMapV2("bad-set", malformed)).toEqual([]);

    const existing = exerciseMappingSnapshotWithAnatomyV1("pull_up");
    expect(projectStoredExerciseMappingToBodyMapV2("old-set", existing)).not.toEqual([]);
  });
});
