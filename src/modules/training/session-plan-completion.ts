export type IncompletePlannedExercise = {
  name: string;
  loggedSets: number;
  plannedSets: number;
};

export type SessionPlanCompletion = {
  loggedSets: number;
  plannedSets: number;
  /** Null when the snapshot has no planned sets. May exceed 100. */
  percent: number | null;
  incompleteExercises: IncompletePlannedExercise[];
};

export function sessionPlanCompletion(
  exercises: ReadonlyArray<{
    snapshotExerciseName: string;
    plannedSets: number;
    sets: ReadonlyArray<unknown> | { length: number };
  }>,
): SessionPlanCompletion {
  const loggedSets = exercises.reduce((sum, exercise) => sum + exercise.sets.length, 0);
  const plannedSets = exercises.reduce((sum, exercise) => sum + exercise.plannedSets, 0);
  const percent = plannedSets <= 0 ? null : Math.round((100 * loggedSets) / plannedSets);
  const incompleteExercises = exercises
    .filter((exercise) => exercise.sets.length < exercise.plannedSets)
    .map((exercise) => ({
      name: exercise.snapshotExerciseName,
      loggedSets: exercise.sets.length,
      plannedSets: exercise.plannedSets,
    }));
  return { loggedSets, plannedSets, percent, incompleteExercises };
}
