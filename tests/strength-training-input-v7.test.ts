import { describe, expect, it } from "vitest";
import { RESISTANCE } from "@/modules/training/training.constants";
import {
  buildCanonicalStrengthTrainingInputV7,
  canonicalStrengthTrainingInputV7Fingerprint,
} from "@/modules/model-episodes/strength-training-input-v7";
import { buildExerciseMuscleMappingSnapshotV7 } from "@/model/physiology-v7/exercise-muscle-mapping-v7";
import type { StrengthSessionDto } from "@/modules/training/training.types";

const availablePress = buildExerciseMuscleMappingSnapshotV7("seated_dumbbell_press");
const availableRow = buildExerciseMuscleMappingSnapshotV7("one_arm_seated_cable_row");

function session(overrides: Partial<StrengthSessionDto> = {}): StrengthSessionDto {
  return {
    id: 42,
    status: "COMPLETED",
    entryMode: "RETROSPECTIVE",
    revision: 3,
    programId: 7,
    programName: "Upper",
    programVersionId: 9,
    programVersionNumber: 2,
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
      endAt: "2026-09-17T18:15:00.000Z",
      durationMinutes: 75,
      activeEnergyKcal: 562,
      externalId: "garmin-99",
    },
    exercises: [
      {
        id: 1,
        sourceExerciseCatalogId: 10,
        snapshotExerciseName: "Press",
        order: 2,
        plannedSets: 3,
        resistanceType: RESISTANCE.EXTERNAL_WEIGHT,
        origin: "PLANNED",
        muscleMappingSnapshot: availablePress,
        sets: [{
          id: 11,
          sessionExerciseId: 1,
          setNumber: 1,
          reps: 8,
          weightKg: 30,
          bandNominalResistanceKg: null,
          comment: null,
          completedAt: null,
          createdAt: "2026-09-17T17:00:00.000Z",
          updatedAt: "2026-09-17T17:00:00.000Z",
        }],
      },
      {
        id: 2,
        sourceExerciseCatalogId: 11,
        snapshotExerciseName: "Band row",
        order: 3,
        plannedSets: 4,
        resistanceType: RESISTANCE.RESISTANCE_BAND,
        origin: "PLANNED",
        muscleMappingSnapshot: availableRow,
        sets: [{
          id: 12,
          sessionExerciseId: 2,
          setNumber: 1,
          reps: 12,
          weightKg: null,
          bandNominalResistanceKg: 15,
          comment: null,
          completedAt: "2026-09-17T17:10:00.000Z",
          createdAt: "2026-09-17T17:00:00.000Z",
          updatedAt: "2026-09-17T17:00:00.000Z",
        }],
      },
      {
        id: 3,
        sourceExerciseCatalogId: null,
        snapshotExerciseName: "Push-up",
        order: 4,
        plannedSets: 2,
        resistanceType: RESISTANCE.BODYWEIGHT,
        origin: "EXTRA",
        muscleMappingSnapshot: buildExerciseMuscleMappingSnapshotV7(null),
        sets: [{
          id: 13,
          sessionExerciseId: 3,
          setNumber: 1,
          reps: 15,
          weightKg: null,
          bandNominalResistanceKg: null,
          comment: null,
          completedAt: null,
          createdAt: "2026-09-17T17:00:00.000Z",
          updatedAt: "2026-09-17T17:00:00.000Z",
        }],
      },
    ],
    ordinaryTonnageKg: null,
    createdAt: "2026-09-17T17:00:00.000Z",
    updatedAt: "2026-09-17T18:30:00.000Z",
    ...overrides,
  };
}

describe("canonical v7 strength-training input", () => {
  it("preserves recorded-set resistance semantics and mapping diagnostics without inventing completion", () => {
    const input = buildCanonicalStrengthTrainingInputV7({ session: session(), heartRateSamples: null });
    expect(input.contractVersion).toBe("bodycast-physiology-v7-strength-input-v2");
    expect(input.program).toEqual({ programId: 7, programVersionId: 9, programVersionNumber: 2 });
    expect(input.exercises.map((exercise) => exercise.stableKey)).toEqual([
      "seated_dumbbell_press",
      "one_arm_seated_cable_row",
      null,
    ]);
    expect(input.exercises[0]).toMatchObject({
      resistanceType: "EXTERNAL_WEIGHT",
      plannedSets: 3,
      recordedSetCount: 1,
      mapping: expect.objectContaining({ mappingAvailability: "available" }),
    });
    expect(input.exercises[0]?.sets[0]).toMatchObject({
      reps: 8,
      weightKg: 30,
      bandNominalResistanceKg: null,
      completedAt: null,
      resistanceType: "EXTERNAL_WEIGHT",
    });
    expect(input.exercises[1]?.sets[0]).toMatchObject({
      reps: 12,
      weightKg: null,
      bandNominalResistanceKg: 15,
      completedAt: "2026-09-17T17:10:00.000Z",
      resistanceType: "RESISTANCE_BAND",
    });
    expect(input.exercises[2]).toMatchObject({
      origin: "EXTRA",
      stableKey: null,
      mapping: expect.objectContaining({ mappingAvailability: "unavailable" }),
    });
    expect(input.exercises[2]?.sets[0]).toMatchObject({
      reps: 15,
      weightKg: null,
      bandNominalResistanceKg: null,
      resistanceType: "BODYWEIGHT",
    });
    expect(input.workout).toEqual(expect.objectContaining({
      workoutId: 99,
      occurrenceStartAt: "2026-09-17T17:00:00.000Z",
      durationMinutes: 75,
      activeEnergyKcal: 562,
      activeEnergyProvenance: "garmin-device-estimate",
    }));
    expect(input.heartRate).toBeNull();
  });

  it("does not emit planned-but-unrecorded sets as recorded sets", () => {
    const input = buildCanonicalStrengthTrainingInputV7({ session: session(), heartRateSamples: [] });
    expect(input.exercises[0]?.plannedSets).toBe(3);
    expect(input.exercises[0]?.recordedSetCount).toBe(1);
    expect(input.exercises[0]?.sets).toHaveLength(1);
  });

  it("fingerprints revision/mapping/set changes but ignores display-name and program-template renames", () => {
    const base = buildCanonicalStrengthTrainingInputV7({ session: session(), heartRateSamples: [] });
    const changedRevision = buildCanonicalStrengthTrainingInputV7({
      session: { ...session(), revision: 4 },
      heartRateSamples: [],
    });
    const renamedTemplate = buildCanonicalStrengthTrainingInputV7({
      session: { ...session(), programName: "Renamed template" },
      heartRateSamples: [],
    });
    const renamedExerciseDisplay = buildCanonicalStrengthTrainingInputV7({
      session: {
        ...session(),
        exercises: session().exercises.map((exercise, index) => (
          index === 0
            ? { ...exercise, snapshotExerciseName: "Totally renamed press label" }
            : exercise
        )),
      },
      heartRateSamples: [],
    });
    const changedMapping = buildCanonicalStrengthTrainingInputV7({
      session: {
        ...session(),
        exercises: session().exercises.map((exercise, index) => (
          index === 0
            ? {
                ...exercise,
                muscleMappingSnapshot: buildExerciseMuscleMappingSnapshotV7("flat_dumbbell_fly"),
              }
            : exercise
        )),
      },
      heartRateSamples: [],
    });

    expect(base.heartRate).toEqual({
      availability: "loaded",
      intervalStartAt: "2026-09-17T17:00:00.000Z",
      intervalEndAt: "2026-09-17T18:15:00.000Z",
      samples: [],
    });
    expect(canonicalStrengthTrainingInputV7Fingerprint(changedRevision))
      .not.toBe(canonicalStrengthTrainingInputV7Fingerprint(base));
    expect(canonicalStrengthTrainingInputV7Fingerprint(renamedTemplate))
      .toBe(canonicalStrengthTrainingInputV7Fingerprint(base));
    expect(canonicalStrengthTrainingInputV7Fingerprint(renamedExerciseDisplay))
      .toBe(canonicalStrengthTrainingInputV7Fingerprint(base));
    expect(canonicalStrengthTrainingInputV7Fingerprint(changedMapping))
      .not.toBe(canonicalStrengthTrainingInputV7Fingerprint(base));
  });
});
