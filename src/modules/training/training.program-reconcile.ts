import type { ResistanceType } from "./training.constants";
import { EXERCISE_ORIGIN, type ExerciseOrigin } from "./training.constants";

export type ReconcileExistingExercise = {
  id: number;
  sourceExerciseCatalogId: number | null;
  snapshotExerciseName: string;
  sortOrder: number;
  plannedSets: number;
  resistanceType: ResistanceType;
  origin: ExerciseOrigin;
  setCount: number;
};

export type ReconcileProgramExercise = {
  sourceExerciseCatalogId: number;
  snapshotExerciseName: string;
  sortOrder: number;
  plannedSets: number;
  resistanceType: ResistanceType;
  muscleMappingSnapshot: unknown | null;
};

export type ReconcileKeep = {
  exerciseId: number;
  sortOrder: number;
  plannedSets: number;
  origin: ExerciseOrigin;
};

export type ReconcileAdd = {
  sourceExerciseCatalogId: number;
  snapshotExerciseName: string;
  sortOrder: number;
  plannedSets: number;
  resistanceType: ResistanceType;
  origin: ExerciseOrigin;
  muscleMappingSnapshot: unknown | null;
};

export type ProgramReconcilePlan = {
  keep: ReconcileKeep[];
  add: ReconcileAdd[];
};

/**
 * Conservative program-change reconciliation.
 * Matches by ExerciseCatalog id + identical resistanceType only.
 * Never deletes existing exercises/sets; orphans become EXTRA.
 * Resistance mismatch keeps the old exercise as EXTRA and adds a new PLANNED row
 * (no silent weightKg ↔ bandNominalResistanceKg conversion).
 */
export function planProgramExerciseReconcile(
  existing: readonly ReconcileExistingExercise[],
  programExercises: readonly ReconcileProgramExercise[],
): ProgramReconcilePlan {
  const unused = existing
    .slice()
    .sort((a, b) => {
      if (b.setCount !== a.setCount) return b.setCount - a.setCount;
      return a.sortOrder - b.sortOrder;
    });

  const keep: ReconcileKeep[] = [];
  const add: ReconcileAdd[] = [];
  let nextOrder = 0;

  for (const planned of programExercises) {
    const matchIndex = unused.findIndex(
      (exercise) =>
        exercise.sourceExerciseCatalogId === planned.sourceExerciseCatalogId
        && exercise.resistanceType === planned.resistanceType,
    );

    if (matchIndex >= 0) {
      const [matched] = unused.splice(matchIndex, 1);
      keep.push({
        exerciseId: matched!.id,
        sortOrder: nextOrder,
        plannedSets: planned.plannedSets,
        origin: EXERCISE_ORIGIN.PLANNED,
      });
      nextOrder += 1;
      continue;
    }

    add.push({
      sourceExerciseCatalogId: planned.sourceExerciseCatalogId,
      snapshotExerciseName: planned.snapshotExerciseName,
      sortOrder: nextOrder,
      plannedSets: planned.plannedSets,
      resistanceType: planned.resistanceType,
      origin: EXERCISE_ORIGIN.PLANNED,
      muscleMappingSnapshot: planned.muscleMappingSnapshot,
    });
    nextOrder += 1;
  }

  const leftovers = unused.slice().sort((a, b) => a.sortOrder - b.sortOrder);
  for (const orphan of leftovers) {
    keep.push({
      exerciseId: orphan.id,
      sortOrder: nextOrder,
      plannedSets: orphan.plannedSets,
      origin: EXERCISE_ORIGIN.EXTRA,
    });
    nextOrder += 1;
  }

  return { keep, add };
}
