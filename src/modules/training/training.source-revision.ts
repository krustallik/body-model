/**
 * Future v7 invalidation / rebuild seam for Training Diary source edits.
 *
 * Historical diary mutations increment StrengthDiarySession.revision.
 * That revision (and StrengthDiaryProgramChange rows) are durable source
 * provenance that a future latest-model fingerprint must include when
 * diary-derived inputs participate in physiology.
 *
 * This module intentionally does NOT call model recalculation and does NOT
 * alter v6 numerical behavior. It documents the contract for later wiring.
 */

export type TrainingSourceChangeHint = {
  sessionId: number;
  revision: number;
  /** Calendar date of the linked Garmin workout when known (YYYY-MM-DD). */
  workoutLocalDate: string | null;
  reason:
    | "retrospective_create"
    | "program_change"
    | "exercise_mutation"
    | "set_mutation";
};

/**
 * Hook point for future rebuild invalidation.
 * Currently a no-op documented seam — call sites may invoke after durable writes.
 */
export function noteTrainingSourceChange(hint: TrainingSourceChangeHint): void {
  void hint;
  // Intentionally empty until v7 diary-aware fingerprints land.
}
