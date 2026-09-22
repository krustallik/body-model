export function shouldAutoAdvanceAfterSet(input: {
  enabled: boolean;
  adding: boolean;
  exerciseOrigin: "PLANNED" | "EXTRA";
  plannedSets: number;
  previousSetCount: number;
  isLastExercise: boolean;
}): boolean {
  return input.enabled
    && input.adding
    && input.exerciseOrigin === "PLANNED"
    && input.plannedSets > 0
    && input.previousSetCount < input.plannedSets
    && input.previousSetCount + 1 >= input.plannedSets
    && !input.isLastExercise;
}
