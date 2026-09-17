import { describe, expect, it } from "vitest";
import { RESISTANCE } from "@/modules/training/training.constants";
import {
  buildCanonicalStrengthTrainingInputV7,
  canonicalStrengthTrainingInputV7Fingerprint,
} from "@/modules/model-episodes/strength-training-input-v7";
import type { StrengthSessionDto } from "@/modules/training/training.types";

function session(): StrengthSessionDto {
  return {
    id: 42, status: "COMPLETED", entryMode: "RETROSPECTIVE", revision: 3,
    programId: 7, programName: "Upper", programVersionId: 9, programVersionNumber: 2,
    webStartedAt: null, webEndedAt: null, matchStatus: "MATCHED", matchMethod: "DIRECT_BACKFILL",
    matchedAt: "2026-09-17T18:30:00.000Z", matchedWorkoutId: 99,
    matchedWorkout: { id: 99, type: "Strength Training", startAt: "2026-09-17T17:00:00.000Z", endAt: "2026-09-17T18:15:00.000Z", durationMinutes: 75, activeEnergyKcal: 562, externalId: "garmin-99" },
    exercises: [
      { id: 1, sourceExerciseCatalogId: 10, snapshotExerciseName: "Press", order: 2, plannedSets: 3, resistanceType: RESISTANCE.EXTERNAL_WEIGHT, origin: "PLANNED", muscleMappingSnapshot: null, sets: [{ id: 11, sessionExerciseId: 1, setNumber: 1, reps: 8, weightKg: 30, bandNominalResistanceKg: null, comment: null, completedAt: null, createdAt: "2026-09-17T17:00:00.000Z", updatedAt: "2026-09-17T17:00:00.000Z" }] },
      { id: 2, sourceExerciseCatalogId: 11, snapshotExerciseName: "Band row", order: 3, plannedSets: 4, resistanceType: RESISTANCE.RESISTANCE_BAND, origin: "PLANNED", muscleMappingSnapshot: null, sets: [{ id: 12, sessionExerciseId: 2, setNumber: 1, reps: 12, weightKg: null, bandNominalResistanceKg: 15, comment: null, completedAt: null, createdAt: "2026-09-17T17:00:00.000Z", updatedAt: "2026-09-17T17:00:00.000Z" }] },
      { id: 3, sourceExerciseCatalogId: null, snapshotExerciseName: "Push-up", order: 4, plannedSets: 2, resistanceType: RESISTANCE.BODYWEIGHT, origin: "EXTRA", muscleMappingSnapshot: null, sets: [{ id: 13, sessionExerciseId: 3, setNumber: 1, reps: 15, weightKg: null, bandNominalResistanceKg: null, comment: null, completedAt: null, createdAt: "2026-09-17T17:00:00.000Z", updatedAt: "2026-09-17T17:00:00.000Z" }] },
    ], ordinaryTonnageKg: null, createdAt: "2026-09-17T17:00:00.000Z", updatedAt: "2026-09-17T18:30:00.000Z",
  };
}

describe("canonical v7 strength-training input", () => {
  it("preserves the durable session snapshot, exercise order, distinct resistance semantics, and Garmin provenance", () => {
    const input = buildCanonicalStrengthTrainingInputV7({ session: session(), heartRateSamples: null });
    expect(input.program).toEqual({ programId: 7, programVersionId: 9, programVersionNumber: 2 });
    expect(input.exercises.map((exercise) => exercise.snapshotExerciseName)).toEqual(["Press", "Band row", "Push-up"]);
    expect(input.exercises[0]).toMatchObject({ resistanceType: "EXTERNAL_WEIGHT", plannedSets: 3, actualCompletedSets: 1 });
    expect(input.exercises[0]?.sets[0]).toMatchObject({ reps: 8, weightKg: 30, bandNominalResistanceKg: null });
    expect(input.exercises[1]?.sets[0]).toMatchObject({ reps: 12, weightKg: null, bandNominalResistanceKg: 15 });
    expect(input.exercises[2]).toMatchObject({ origin: "EXTRA", exerciseCatalogId: null });
    expect(input.exercises[2]?.sets[0]).toMatchObject({ reps: 15, weightKg: null, bandNominalResistanceKg: null });
    expect(input.workout).toEqual(expect.objectContaining({ workoutId: 99, occurrenceStartAt: "2026-09-17T17:00:00.000Z", durationMinutes: 75, activeEnergyKcal: 562, activeEnergyProvenance: "garmin-device-estimate" }));
    expect(input.heartRate).toBeNull();
  });

  it("keeps unknown data null and fingerprints diary edits but not unrelated program-template edits", () => {
    const base = buildCanonicalStrengthTrainingInputV7({ session: session(), heartRateSamples: [] });
    const changedRevision = buildCanonicalStrengthTrainingInputV7({ session: { ...session(), revision: 4 }, heartRateSamples: [] });
    const renamedTemplate = buildCanonicalStrengthTrainingInputV7({ session: { ...session(), programName: "Renamed template" }, heartRateSamples: [] });
    expect(base.heartRate).toEqual({ availability: "loaded", intervalStartAt: "2026-09-17T17:00:00.000Z", intervalEndAt: "2026-09-17T18:15:00.000Z", samples: [] });
    expect(canonicalStrengthTrainingInputV7Fingerprint(changedRevision)).not.toBe(canonicalStrengthTrainingInputV7Fingerprint(base));
    expect(canonicalStrengthTrainingInputV7Fingerprint(renamedTemplate)).toBe(canonicalStrengthTrainingInputV7Fingerprint(base));
  });
});
