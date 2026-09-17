import {
  type CanonicalMuscleGroupV7,
  CANONICAL_MUSCLE_GROUPS_V7,
} from "@/model/physiology-v7/exercise-muscle-mapping-v7";
import type { CanonicalStrengthTrainingInputV7 } from "@/modules/model-episodes/strength-training-input-v7";
import { RESISTANCE, type ResistanceType } from "@/modules/training/training.constants";
import { stableSha256 } from "@/modules/model-recovery/recovery-fingerprint";

export const QUALIFIED_RESISTANCE_TRAINING_DOSE_V7_VERSION =
  "bodycast-qualified-resistance-training-dose-v7-1" as const;

export const HARD_SET_QUALIFICATION_ASSUMPTION_V7 =
  "assumed-near-failure" as const;

/**
 * Product annotation that recorded sets are generally hard / near failure.
 * This is an ENGINEERING ASSUMPTION (P-A04), not an observed RIR/RPE/failure.
 */
export type HardSetQualificationV7 = {
  status: "qualified-by-product-assumption";
  assumption: typeof HARD_SET_QUALIFICATION_ASSUMPTION_V7;
};

export type QualifiedResistanceMuscleBucketV7 = {
  muscleGroup: CanonicalMuscleGroupV7;
  /** Count of mapped recorded sets that listed this group as direct. */
  directMappedSetCount: number;
  /** Count of mapped recorded sets that listed this group as indirect. */
  indirectMappedSetCount: number;
};

export type QualifiedResistanceTypeContextV7 = {
  resistanceType: ResistanceType;
  mappedSetCount: number;
  /** Diagnostic only — never required for dose availability. */
  ordinaryTonnageKg: number | null;
};

export type QualifiedResistanceMappingCoverageV7 = {
  mappedExerciseCount: number;
  unmappedExerciseCount: number;
  mappedSetCount: number;
  unmappedSetCount: number;
  mappingVersions: string[];
};

export type QualifiedResistanceHeartRateContextV7 = {
  /** Contextual only — never gates dose availability (C-L02). */
  availability: "loaded" | "unavailable";
};

/**
 * Mapped recorded-set dose boundary. Not muscle gain, not effective-set
 * coefficients, and not a tonnage-derived hypertrophy score.
 */
export type AvailableQualifiedResistanceTrainingDoseV7 = {
  contractVersion: typeof QUALIFIED_RESISTANCE_TRAINING_DOSE_V7_VERSION;
  availability: "available";
  strengthDiarySessionId: number;
  sessionRevision: number;
  hardSetQualification: HardSetQualificationV7;
  recordedSetCount: number;
  mappedSetCount: number;
  unmappedSetCount: number;
  muscleGroups: QualifiedResistanceMuscleBucketV7[];
  resistanceTypes: QualifiedResistanceTypeContextV7[];
  mappingCoverage: QualifiedResistanceMappingCoverageV7;
  heartRateContext: QualifiedResistanceHeartRateContextV7;
  /**
   * Optional ordinary external-weight tonnage context. Null/absent must not
   * erase mapped hard-set dose (C-A03 / P-A06).
   */
  ordinaryTonnageKg: number | null;
};

export type UnavailableQualifiedResistanceTrainingDoseV7 = {
  contractVersion: typeof QUALIFIED_RESISTANCE_TRAINING_DOSE_V7_VERSION;
  availability: "unavailable";
  reason: "no-recorded-sets" | "no-mapped-recorded-sets";
  strengthDiarySessionId: number;
  sessionRevision: number;
  recordedSetCount: number;
  mappedSetCount: 0;
  unmappedSetCount: number;
  heartRateContext: QualifiedResistanceHeartRateContextV7;
  ordinaryTonnageKg: number | null;
};

export type QualifiedResistanceTrainingDoseV7 =
  | AvailableQualifiedResistanceTrainingDoseV7
  | UnavailableQualifiedResistanceTrainingDoseV7;

const HARD_SET_QUALIFICATION: HardSetQualificationV7 = {
  status: "qualified-by-product-assumption",
  assumption: HARD_SET_QUALIFICATION_ASSUMPTION_V7,
};

function heartRateContextOf(
  input: CanonicalStrengthTrainingInputV7,
): QualifiedResistanceHeartRateContextV7 {
  return {
    availability: input.heartRate === null ? "unavailable" : "loaded",
  };
}

function ordinaryExternalWeightTonnageKg(
  input: CanonicalStrengthTrainingInputV7,
  override: number | null | undefined,
): number | null {
  if (override !== undefined) return override;
  let total = 0;
  let saw = false;
  for (const exercise of input.exercises) {
    if (exercise.resistanceType !== RESISTANCE.EXTERNAL_WEIGHT) continue;
    for (const set of exercise.sets) {
      if (set.weightKg == null) continue;
      total += set.weightKg * set.reps;
      saw = true;
    }
  }
  return saw ? total : null;
}

/**
 * Builds mapped hard-set dose from immutable canonical session input.
 * Planned-but-unrecorded sets never enter. completedAt is never a performed flag.
 */
export function buildQualifiedResistanceTrainingDoseV7(
  input: CanonicalStrengthTrainingInputV7,
  options: { ordinaryTonnageKg?: number | null } = {},
): QualifiedResistanceTrainingDoseV7 {
  const ordinaryTonnageKg = ordinaryExternalWeightTonnageKg(input, options.ordinaryTonnageKg);
  const hr = heartRateContextOf(input);

  let recordedSetCount = 0;
  let mappedSetCount = 0;
  let unmappedSetCount = 0;
  let mappedExerciseCount = 0;
  let unmappedExerciseCount = 0;
  const mappingVersions = new Set<string>();
  const muscleBuckets = new Map<CanonicalMuscleGroupV7, {
    directMappedSetCount: number;
    indirectMappedSetCount: number;
  }>();
  const resistanceBuckets = new Map<ResistanceType, number>();

  for (const group of CANONICAL_MUSCLE_GROUPS_V7) {
    muscleBuckets.set(group, { directMappedSetCount: 0, indirectMappedSetCount: 0 });
  }

  for (const exercise of input.exercises) {
    const setCount = exercise.sets.length;
    recordedSetCount += setCount;
    const snapshot = exercise.muscleMappingSnapshot;
    const mapped = snapshot?.availability === "available";

    if (!mapped) {
      unmappedExerciseCount += 1;
      unmappedSetCount += setCount;
      continue;
    }

    mappedExerciseCount += 1;
    mappedSetCount += setCount;
    mappingVersions.add(snapshot.mappingVersion);
    resistanceBuckets.set(
      exercise.resistanceType,
      (resistanceBuckets.get(exercise.resistanceType) ?? 0) + setCount,
    );

    for (let i = 0; i < setCount; i += 1) {
      for (const target of snapshot.targets) {
        const bucket = muscleBuckets.get(target.muscleGroup)!;
        if (target.role === "direct") bucket.directMappedSetCount += 1;
        else bucket.indirectMappedSetCount += 1;
      }
    }
  }

  if (recordedSetCount === 0) {
    return {
      contractVersion: QUALIFIED_RESISTANCE_TRAINING_DOSE_V7_VERSION,
      availability: "unavailable",
      reason: "no-recorded-sets",
      strengthDiarySessionId: input.strengthDiarySessionId,
      sessionRevision: input.sessionRevision,
      recordedSetCount: 0,
      mappedSetCount: 0,
      unmappedSetCount: 0,
      heartRateContext: hr,
      ordinaryTonnageKg,
    };
  }

  if (mappedSetCount === 0) {
    return {
      contractVersion: QUALIFIED_RESISTANCE_TRAINING_DOSE_V7_VERSION,
      availability: "unavailable",
      reason: "no-mapped-recorded-sets",
      strengthDiarySessionId: input.strengthDiarySessionId,
      sessionRevision: input.sessionRevision,
      recordedSetCount,
      mappedSetCount: 0,
      unmappedSetCount,
      heartRateContext: hr,
      ordinaryTonnageKg,
    };
  }

  const muscleGroups = CANONICAL_MUSCLE_GROUPS_V7
    .map((muscleGroup) => {
      const bucket = muscleBuckets.get(muscleGroup)!;
      return {
        muscleGroup,
        directMappedSetCount: bucket.directMappedSetCount,
        indirectMappedSetCount: bucket.indirectMappedSetCount,
      };
    })
    .filter((bucket) => (
      bucket.directMappedSetCount > 0 || bucket.indirectMappedSetCount > 0
    ));

  const resistanceTypes: QualifiedResistanceTypeContextV7[] = (
    [
      RESISTANCE.EXTERNAL_WEIGHT,
      RESISTANCE.RESISTANCE_BAND,
      RESISTANCE.BODYWEIGHT,
    ] as const
  )
    .filter((resistanceType) => (resistanceBuckets.get(resistanceType) ?? 0) > 0)
    .map((resistanceType) => ({
      resistanceType,
      mappedSetCount: resistanceBuckets.get(resistanceType) ?? 0,
      ordinaryTonnageKg: resistanceType === RESISTANCE.EXTERNAL_WEIGHT
        ? ordinaryTonnageKg
        : null,
    }));

  return {
    contractVersion: QUALIFIED_RESISTANCE_TRAINING_DOSE_V7_VERSION,
    availability: "available",
    strengthDiarySessionId: input.strengthDiarySessionId,
    sessionRevision: input.sessionRevision,
    hardSetQualification: HARD_SET_QUALIFICATION,
    recordedSetCount,
    mappedSetCount,
    unmappedSetCount,
    muscleGroups,
    resistanceTypes,
    mappingCoverage: {
      mappedExerciseCount,
      unmappedExerciseCount,
      mappedSetCount,
      unmappedSetCount,
      mappingVersions: [...mappingVersions].sort((a, b) => a.localeCompare(b)),
    },
    heartRateContext: hr,
    ordinaryTonnageKg,
  };
}

/** Scientific resistance-dose identity excludes display metadata and HR samples. */
export function qualifiedResistanceTrainingDoseV7Fingerprint(
  dose: QualifiedResistanceTrainingDoseV7,
): string {
  if (dose.availability !== "available") {
    return stableSha256({
      contractVersion: dose.contractVersion,
      availability: dose.availability,
      reason: dose.reason,
      strengthDiarySessionId: dose.strengthDiarySessionId,
      sessionRevision: dose.sessionRevision,
      recordedSetCount: dose.recordedSetCount,
      unmappedSetCount: dose.unmappedSetCount,
    });
  }

  return stableSha256({
    contractVersion: dose.contractVersion,
    availability: dose.availability,
    strengthDiarySessionId: dose.strengthDiarySessionId,
    sessionRevision: dose.sessionRevision,
    hardSetQualification: dose.hardSetQualification,
    recordedSetCount: dose.recordedSetCount,
    mappedSetCount: dose.mappedSetCount,
    unmappedSetCount: dose.unmappedSetCount,
    muscleGroups: dose.muscleGroups,
    resistanceTypes: dose.resistanceTypes.map((entry) => ({
      resistanceType: entry.resistanceType,
      mappedSetCount: entry.mappedSetCount,
    })),
    mappingCoverage: {
      mappedExerciseCount: dose.mappingCoverage.mappedExerciseCount,
      unmappedExerciseCount: dose.mappingCoverage.unmappedExerciseCount,
      mappedSetCount: dose.mappingCoverage.mappedSetCount,
      unmappedSetCount: dose.mappingCoverage.unmappedSetCount,
      mappingVersions: dose.mappingCoverage.mappingVersions,
    },
  });
}
