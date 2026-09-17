import { describe, expect, it } from "vitest";
import { buildExerciseMuscleMappingSnapshotV7 } from "@/model/physiology-v7/exercise-muscle-mapping-v7";
import {
  buildQualifiedResistanceTrainingDoseV7,
  qualifiedResistanceTrainingDoseV7Fingerprint,
} from "@/model/physiology-v7/qualified-resistance-training-dose-v7";
import { buildCanonicalStrengthTrainingInputV7 } from "@/modules/model-episodes/strength-training-input-v7";
import { RESISTANCE } from "@/modules/training/training.constants";
import type { StrengthSessionDto } from "@/modules/training/training.types";

function baseSession(
  exercises: StrengthSessionDto["exercises"],
  overrides: Partial<StrengthSessionDto> = {},
): StrengthSessionDto {
  return {
    id: 42,
    status: "COMPLETED",
    entryMode: "RETROSPECTIVE",
    revision: 3,
    programId: 7,
    programName: "Program",
    programVersionId: 9,
    programVersionNumber: 1,
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
      endAt: "2026-09-17T18:00:00.000Z",
      durationMinutes: 60,
      activeEnergyKcal: 400,
      externalId: "garmin-99",
    },
    exercises,
    ordinaryTonnageKg: null,
    createdAt: "2026-09-17T17:00:00.000Z",
    updatedAt: "2026-09-17T18:30:00.000Z",
    ...overrides,
  };
}

function recordedSet(input: {
  id: number;
  sessionExerciseId: number;
  reps: number;
  weightKg?: number | null;
  bandNominalResistanceKg?: number | null;
  completedAt?: string | null;
}) {
  return {
    id: input.id,
    sessionExerciseId: input.sessionExerciseId,
    setNumber: 1,
    reps: input.reps,
    weightKg: input.weightKg ?? null,
    bandNominalResistanceKg: input.bandNominalResistanceKg ?? null,
    rir: null,
    comment: null,
    completedAt: input.completedAt === undefined ? null : input.completedAt,
    createdAt: "2026-09-17T17:00:00.000Z",
    updatedAt: "2026-09-17T17:00:00.000Z",
  };
}

describe("QualifiedResistanceTrainingDoseV7", () => {
  it("keeps direct/indirect buckets separate and includes EXTRA mapped sets", () => {
    const input = buildCanonicalStrengthTrainingInputV7({
      session: baseSession([
        {
          id: 1,
          sourceExerciseCatalogId: 10,
          stableKey: null,
          snapshotExerciseName: "Press",
          order: 1,
          plannedSets: 3,
          resistanceType: RESISTANCE.EXTERNAL_WEIGHT,
          origin: "PLANNED",
          muscleMappingSnapshot: buildExerciseMuscleMappingSnapshotV7("seated_dumbbell_press"),
          sets: [recordedSet({ id: 11, sessionExerciseId: 1, reps: 8, weightKg: 30 })],
        },
        {
          id: 2,
          sourceExerciseCatalogId: 11,
          stableKey: null,
          snapshotExerciseName: "Extra curl",
          order: 2,
          plannedSets: 2,
          resistanceType: RESISTANCE.EXTERNAL_WEIGHT,
          origin: "EXTRA",
          muscleMappingSnapshot: buildExerciseMuscleMappingSnapshotV7("one_arm_concentration_curl"),
          sets: [recordedSet({ id: 12, sessionExerciseId: 2, reps: 10, weightKg: 12, completedAt: null })],
        },
      ]),
      heartRateSamples: null,
    });

    const dose = buildQualifiedResistanceTrainingDoseV7(input);
    expect(dose.availability).toBe("available");
    if (dose.availability === "available") {
      expect(dose.mappedSetCount).toBe(2);
      expect(dose.recordedSetCount).toBe(2);
      expect(dose.muscleGroups.find((g) => g.muscleGroup === "deltoids")).toEqual({
        muscleGroup: "deltoids",
        directMappedSetCount: 1,
        indirectMappedSetCount: 0,
      });
      expect(dose.muscleGroups.find((g) => g.muscleGroup === "triceps")).toEqual({
        muscleGroup: "triceps",
        directMappedSetCount: 0,
        indirectMappedSetCount: 1,
      });
      expect(dose.muscleGroups.find((g) => g.muscleGroup === "biceps")).toEqual({
        muscleGroup: "biceps",
        directMappedSetCount: 1,
        indirectMappedSetCount: 0,
      });
      expect(dose.hardSetQualification).toEqual({
        status: "qualified-by-product-assumption",
        assumption: "assumed-near-failure",
      });
    }
  });

  it("preserves unmapped diagnostics and excludes planned-only sets", () => {
    const input = buildCanonicalStrengthTrainingInputV7({
      session: baseSession([
        {
          id: 1,
          sourceExerciseCatalogId: 10,
          stableKey: null,
          snapshotExerciseName: "Mapped",
          order: 1,
          plannedSets: 5,
          resistanceType: RESISTANCE.BODYWEIGHT,
          origin: "PLANNED",
          muscleMappingSnapshot: buildExerciseMuscleMappingSnapshotV7("pushup_handles"),
          sets: [recordedSet({ id: 11, sessionExerciseId: 1, reps: 12 })],
        },
        {
          id: 2,
          sourceExerciseCatalogId: 99,
          stableKey: null,
          snapshotExerciseName: "Custom",
          order: 2,
          plannedSets: 3,
          resistanceType: RESISTANCE.BODYWEIGHT,
          origin: "EXTRA",
          muscleMappingSnapshot: buildExerciseMuscleMappingSnapshotV7(null),
          sets: [recordedSet({ id: 12, sessionExerciseId: 2, reps: 10 })],
        },
      ]),
      heartRateSamples: [],
    });

    const dose = buildQualifiedResistanceTrainingDoseV7(input, { ordinaryTonnageKg: null });
    expect(dose.availability).toBe("available");
    if (dose.availability === "available") {
      expect(dose.mappedSetCount).toBe(1);
      expect(dose.unmappedSetCount).toBe(1);
      expect(dose.mappingCoverage).toMatchObject({
        mappedExerciseCount: 1,
        unmappedExerciseCount: 1,
      });
      expect(dose.recordedSetCount).toBe(2);
    }
  });

  it("is unchanged by display-name edits and changes with mapping or revision", () => {
    const sets = [recordedSet({ id: 11, sessionExerciseId: 1, reps: 8, weightKg: 20 })];
    const base = buildCanonicalStrengthTrainingInputV7({
      session: baseSession([{
        id: 1,
        sourceExerciseCatalogId: 10,
        stableKey: null,
        snapshotExerciseName: "Press",
        order: 1,
        plannedSets: 3,
        resistanceType: RESISTANCE.EXTERNAL_WEIGHT,
        origin: "PLANNED",
        muscleMappingSnapshot: buildExerciseMuscleMappingSnapshotV7("seated_dumbbell_press"),
        sets,
      }]),
      heartRateSamples: null,
    });
    const renamed = buildCanonicalStrengthTrainingInputV7({
      session: baseSession([{
        id: 1,
        sourceExerciseCatalogId: 10,
        stableKey: null,
        snapshotExerciseName: "Renamed display",
        order: 1,
        plannedSets: 3,
        resistanceType: RESISTANCE.EXTERNAL_WEIGHT,
        origin: "PLANNED",
        muscleMappingSnapshot: buildExerciseMuscleMappingSnapshotV7("seated_dumbbell_press"),
        sets,
      }], { programName: "Renamed program", revision: 3 }),
      heartRateSamples: null,
    });
    const remapped = buildCanonicalStrengthTrainingInputV7({
      session: baseSession([{
        id: 1,
        sourceExerciseCatalogId: 10,
        stableKey: null,
        snapshotExerciseName: "Press",
        order: 1,
        plannedSets: 3,
        resistanceType: RESISTANCE.EXTERNAL_WEIGHT,
        origin: "PLANNED",
        muscleMappingSnapshot: buildExerciseMuscleMappingSnapshotV7("flat_dumbbell_fly"),
        sets,
      }]),
      heartRateSamples: null,
    });
    const revised = buildCanonicalStrengthTrainingInputV7({
      session: baseSession([{
        id: 1,
        sourceExerciseCatalogId: 10,
        stableKey: null,
        snapshotExerciseName: "Press",
        order: 1,
        plannedSets: 3,
        resistanceType: RESISTANCE.EXTERNAL_WEIGHT,
        origin: "PLANNED",
        muscleMappingSnapshot: buildExerciseMuscleMappingSnapshotV7("seated_dumbbell_press"),
        sets,
      }], { revision: 9 }),
      heartRateSamples: null,
    });

    const baseDose = buildQualifiedResistanceTrainingDoseV7(base);
    expect(qualifiedResistanceTrainingDoseV7Fingerprint(baseDose))
      .toBe(qualifiedResistanceTrainingDoseV7Fingerprint(buildQualifiedResistanceTrainingDoseV7(renamed)));
    expect(qualifiedResistanceTrainingDoseV7Fingerprint(baseDose))
      .not.toBe(qualifiedResistanceTrainingDoseV7Fingerprint(buildQualifiedResistanceTrainingDoseV7(remapped)));
    expect(qualifiedResistanceTrainingDoseV7Fingerprint(baseDose))
      .not.toBe(qualifiedResistanceTrainingDoseV7Fingerprint(buildQualifiedResistanceTrainingDoseV7(revised)));
  });
});
