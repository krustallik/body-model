import { stableSha256 } from "@/modules/model-recovery/recovery-fingerprint";
import {
  describeExerciseMuscleMappingSnapshotV7,
  parseExerciseMuscleMappingSnapshotV7,
  type ExerciseMuscleMappingDiagnosticsV7,
} from "@/model/physiology-v7/exercise-muscle-mapping-v7";
import type { ResistanceType } from "@/modules/training/training.constants";
import type { StrengthSessionDto, StrengthSetDto } from "@/modules/training/training.types";

export const CANONICAL_STRENGTH_TRAINING_INPUT_V7_VERSION =
  "bodycast-physiology-v7-strength-input-v3" as const;

export type CanonicalStrengthTrainingHeartRateSampleV7 = {
  timestamp: string;
  bpm: number;
  /** Retained raw-source label; this contract does not relabel it as Garmin. */
  source: string;
};

/**
 * A stored StrengthSet row is a recorded set. completedAt may be string | null;
 * null does NOT mean the set was unperformed. Planned-but-unrecorded sets never
 * appear here.
 */
export type CanonicalRecordedStrengthSetV7 = {
  strengthSetId: number;
  setNumber: number;
  reps: number;
  resistanceType: ResistanceType;
  /** EXTERNAL_WEIGHT external load context; null for band/bodyweight. */
  weightKg: number | null;
  /** RESISTANCE_BAND nominal resistance only — never iron-equivalent. */
  bandNominalResistanceKg: number | null;
  /**
   * Optional user-reported repetitions in reserve.
   * Null = not reported (legacy / omitted). Null is never RIR 0.
   */
  rir: number | null;
  /** Preserved as stored; never inferred into a performed/unperformed boolean. */
  completedAt: string | null;
};

export type CanonicalStrengthTrainingExerciseV7 = {
  strengthDiarySessionExerciseId: number;
  order: number;
  origin: "PLANNED" | "EXTRA";
  plannedSets: number;
  /** Count of stored StrengthSet rows only — not derived from completedAt. */
  recordedSetCount: number;
  resistanceType: ResistanceType;
  /** Portable scientific identity from the immutable mapping snapshot when available. */
  stableKey: string | null;
  mapping: ExerciseMuscleMappingDiagnosticsV7;
  /** Immutable snapshot as stored on the session exercise (or null if never snapshotted). */
  muscleMappingSnapshot: ReturnType<typeof parseExerciseMuscleMappingSnapshotV7>;
  sets: CanonicalRecordedStrengthSetV7[];
};

export type CanonicalStrengthTrainingInputV7 = {
  contractVersion: typeof CANONICAL_STRENGTH_TRAINING_INPUT_V7_VERSION;
  strengthDiarySessionId: number;
  sessionRevision: number;
  program: { programId: number; programVersionId: number; programVersionNumber: number };
  exercises: CanonicalStrengthTrainingExerciseV7[];
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

function toRecordedSet(
  set: StrengthSetDto,
  resistanceType: ResistanceType,
): CanonicalRecordedStrengthSetV7 {
  return {
    strengthSetId: set.id,
    setNumber: set.setNumber,
    reps: set.reps,
    resistanceType,
    weightKg: set.weightKg,
    bandNominalResistanceKg: set.bandNominalResistanceKg,
    rir: set.rir,
    completedAt: set.completedAt,
  };
}

/**
 * Builds a provenance-only input from immutable diary snapshots and optionally
 * loaded Garmin HR samples. No source record is changed and no dose is inferred.
 *
 * Scientific identity uses stableKey + immutable mapping snapshot. Display names
 * and catalog SERIAL ids are intentionally excluded from this contract.
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
      .map((exercise) => {
        const muscleMappingSnapshot = parseExerciseMuscleMappingSnapshotV7(
          exercise.muscleMappingSnapshot,
        );
        const mapping = describeExerciseMuscleMappingSnapshotV7(exercise.muscleMappingSnapshot);
        return {
          strengthDiarySessionExerciseId: exercise.id,
          order: exercise.order,
          origin: exercise.origin,
          plannedSets: exercise.plannedSets,
          recordedSetCount: exercise.sets.length,
          resistanceType: exercise.resistanceType,
          stableKey: mapping.stableKey,
          mapping,
          muscleMappingSnapshot,
          sets: [...exercise.sets]
            .sort((left, right) => left.setNumber - right.setNumber)
            .map((set) => toRecordedSet(set, exercise.resistanceType)),
        };
      }),
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
