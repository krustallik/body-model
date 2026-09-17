import { stableSha256 } from "@/modules/model-recovery/recovery-fingerprint";
import type { ResistanceType } from "@/modules/training/training.constants";
import type { StrengthSessionDto } from "@/modules/training/training.types";

export const CANONICAL_STRENGTH_TRAINING_INPUT_V7_VERSION =
  "bodycast-physiology-v7-strength-input-v1" as const;

export type CanonicalStrengthTrainingHeartRateSampleV7 = {
  timestamp: string;
  bpm: number;
  /** Retained raw-source label; this contract does not relabel it as Garmin. */
  source: string;
};

export type CanonicalStrengthTrainingInputV7 = {
  contractVersion: typeof CANONICAL_STRENGTH_TRAINING_INPUT_V7_VERSION;
  strengthDiarySessionId: number;
  sessionRevision: number;
  program: { programId: number; programVersionId: number; programVersionNumber: number };
  exercises: Array<{
    strengthDiarySessionExerciseId: number;
    exerciseCatalogId: number | null;
    snapshotExerciseName: string;
    order: number;
    origin: "PLANNED" | "EXTRA";
    plannedSets: number;
    actualCompletedSets: number;
    resistanceType: ResistanceType;
    sets: Array<{
      strengthSetId: number;
      setNumber: number;
      reps: number;
      weightKg: number | null;
      bandNominalResistanceKg: number | null;
    }>;
  }>;
  /** Garmin is the occurrence source only when a diary session is linked to it. */
  workout: {
    source: "garmin-workout";
    workoutId: number;
    externalId: string | null;
    occurrenceStartAt: string;
    occurrenceEndAt: string;
    durationMinutes: number | null;
    activeEnergyKcal: number | null;
    activeEnergyProvenance: "garmin-device-estimate" | null;
  } | null;
  /** null = source interval was not loaded, [] = loaded and no samples existed. */
  heartRate: {
    availability: "loaded";
    intervalStartAt: string | null;
    intervalEndAt: string | null;
    samples: CanonicalStrengthTrainingHeartRateSampleV7[];
  } | null;
};

/**
 * Builds a provenance-only input from immutable diary snapshots and optionally
 * loaded Garmin HR samples. No source record is changed and no dose is inferred.
 */
export function buildCanonicalStrengthTrainingInputV7(input: {
  session: StrengthSessionDto;
  heartRateSamples: readonly CanonicalStrengthTrainingHeartRateSampleV7[] | null;
}): CanonicalStrengthTrainingInputV7 {
  const { session } = input;
  return {
    contractVersion: CANONICAL_STRENGTH_TRAINING_INPUT_V7_VERSION,
    strengthDiarySessionId: session.id,
    sessionRevision: session.revision,
    // Deliberately excludes mutable program template metadata such as its name.
    program: {
      programId: session.programId,
      programVersionId: session.programVersionId,
      programVersionNumber: session.programVersionNumber,
    },
    exercises: [...session.exercises]
      .sort((left, right) => left.order - right.order)
      .map((exercise) => ({
        strengthDiarySessionExerciseId: exercise.id,
        exerciseCatalogId: exercise.sourceExerciseCatalogId,
        snapshotExerciseName: exercise.snapshotExerciseName,
        order: exercise.order,
        origin: exercise.origin,
        plannedSets: exercise.plannedSets,
        actualCompletedSets: exercise.sets.length,
        resistanceType: exercise.resistanceType,
        sets: [...exercise.sets]
          .sort((left, right) => left.setNumber - right.setNumber)
          .map((set) => ({
            strengthSetId: set.id,
            setNumber: set.setNumber,
            reps: set.reps,
            weightKg: set.weightKg,
            bandNominalResistanceKg: set.bandNominalResistanceKg,
          })),
      })),
    workout: session.matchedWorkout === null ? null : {
      source: "garmin-workout",
      workoutId: session.matchedWorkout.id,
      externalId: session.matchedWorkout.externalId,
      occurrenceStartAt: session.matchedWorkout.startAt,
      occurrenceEndAt: session.matchedWorkout.endAt,
      durationMinutes: session.matchedWorkout.durationMinutes,
      activeEnergyKcal: session.matchedWorkout.activeEnergyKcal,
      activeEnergyProvenance: session.matchedWorkout.activeEnergyKcal === null
        ? null
        : "garmin-device-estimate",
    },
    heartRate: input.heartRateSamples === null ? null : {
      availability: "loaded",
      intervalStartAt: session.matchedWorkout?.startAt ?? null,
      intervalEndAt: session.matchedWorkout?.endAt ?? null,
      samples: input.heartRateSamples.map((sample) => ({ ...sample })),
    },
  };
}

export function canonicalStrengthTrainingInputV7Fingerprint(
  input: CanonicalStrengthTrainingInputV7,
): string {
  return stableSha256(input);
}
