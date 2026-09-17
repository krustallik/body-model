/**
 * Keep focus on a stable sessionExerciseId across reorder / program changes.
 */
export function resolveFocusedExerciseId(
  exercises: ReadonlyArray<{ id: number }>,
  preferredId: number | null,
): number | null {
  if (exercises.length === 0) return null;
  if (preferredId != null && exercises.some((exercise) => exercise.id === preferredId)) {
    return preferredId;
  }
  return exercises[0]!.id;
}

export function indexOfExerciseId(
  exercises: ReadonlyArray<{ id: number }>,
  exerciseId: number | null,
): number {
  if (exerciseId == null) return 0;
  const index = exercises.findIndex((exercise) => exercise.id === exerciseId);
  return index >= 0 ? index : 0;
}

export function neighborExerciseId(
  exercises: ReadonlyArray<{ id: number }>,
  currentId: number | null,
  delta: -1 | 1,
): number | null {
  if (exercises.length === 0 || currentId == null) return null;
  const index = indexOfExerciseId(exercises, currentId);
  const next = index + delta;
  if (next < 0 || next >= exercises.length) return null;
  return exercises[next]!.id;
}
