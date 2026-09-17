import { describe, expect, it } from "vitest";
import { EXERCISE_ORIGIN, RESISTANCE } from "@/modules/training/training.constants";
import { planProgramExerciseReconcile } from "@/modules/training/training.program-reconcile";

describe("planProgramExerciseReconcile", () => {
  it("preserves actual sets for matching catalog + resistance exercises", () => {
    const plan = planProgramExerciseReconcile(
      [{
        id: 1,
        sourceExerciseCatalogId: 10,
        snapshotExerciseName: "X",
        sortOrder: 0,
        plannedSets: 3,
        resistanceType: RESISTANCE.EXTERNAL_WEIGHT,
        origin: EXERCISE_ORIGIN.PLANNED,
        setCount: 2,
      }],
      [{
        sourceExerciseCatalogId: 10,
        snapshotExerciseName: "X",
        sortOrder: 0,
        plannedSets: 4,
        resistanceType: RESISTANCE.EXTERNAL_WEIGHT,
        muscleMappingSnapshot: null,
      }],
    );
    expect(plan.keep).toEqual([{
      exerciseId: 1,
      sortOrder: 0,
      plannedSets: 4,
      origin: EXERCISE_ORIGIN.PLANNED,
    }]);
    expect(plan.add).toEqual([]);
  });

  it("keeps orphan exercises with sets as EXTRA instead of deleting them", () => {
    const plan = planProgramExerciseReconcile(
      [{
        id: 2,
        sourceExerciseCatalogId: 20,
        snapshotExerciseName: "Y",
        sortOrder: 0,
        plannedSets: 3,
        resistanceType: RESISTANCE.EXTERNAL_WEIGHT,
        origin: EXERCISE_ORIGIN.PLANNED,
        setCount: 1,
      }],
      [{
        sourceExerciseCatalogId: 30,
        snapshotExerciseName: "Z",
        sortOrder: 0,
        plannedSets: 3,
        resistanceType: RESISTANCE.EXTERNAL_WEIGHT,
        muscleMappingSnapshot: null,
      }],
    );
    expect(plan.add).toHaveLength(1);
    expect(plan.add[0]?.sourceExerciseCatalogId).toBe(30);
    expect(plan.keep).toEqual([{
      exerciseId: 2,
      sortOrder: 1,
      plannedSets: 3,
      origin: EXERCISE_ORIGIN.EXTRA,
    }]);
  });

  it("does not convert load semantics when resistance type differs for same catalog", () => {
    const plan = planProgramExerciseReconcile(
      [{
        id: 3,
        sourceExerciseCatalogId: 10,
        snapshotExerciseName: "X",
        sortOrder: 0,
        plannedSets: 3,
        resistanceType: RESISTANCE.EXTERNAL_WEIGHT,
        origin: EXERCISE_ORIGIN.PLANNED,
        setCount: 1,
      }],
      [{
        sourceExerciseCatalogId: 10,
        snapshotExerciseName: "X",
        sortOrder: 0,
        plannedSets: 3,
        resistanceType: RESISTANCE.RESISTANCE_BAND,
        muscleMappingSnapshot: null,
      }],
    );
    expect(plan.add).toEqual([expect.objectContaining({
      sourceExerciseCatalogId: 10,
      resistanceType: RESISTANCE.RESISTANCE_BAND,
      origin: EXERCISE_ORIGIN.PLANNED,
      sortOrder: 0,
    })]);
    expect(plan.keep).toEqual([{
      exerciseId: 3,
      sortOrder: 1,
      plannedSets: 3,
      origin: EXERCISE_ORIGIN.EXTRA,
    }]);
  });
});
