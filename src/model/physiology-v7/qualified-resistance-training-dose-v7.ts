import {
  type CanonicalMuscleGroupV7,
  CANONICAL_MUSCLE_GROUPS_V7,
} from "@/model/physiology-v7/exercise-muscle-mapping-v7";
import type { CanonicalStrengthTrainingInputV7 } from "@/modules/model-episodes/strength-training-input-v7";
import { RESISTANCE, type ResistanceType } from "@/modules/training/training.constants";
import { stableSha256 } from "@/modules/model-recovery/recovery-fingerprint";

export const QUALIFIED_RESISTANCE_TRAINING_DOSE_V7_VERSION =
  "bodycast-qualified-resistance-training-dose-v7-3" as const;

export const HARD_SET_QUALIFICATION_ASSUMPTION_V7 =
  "assumed-near-failure" as const;

/**
 * Product annotation that recorded sets are generally hard / near failure.
 * This is an ENGINEERING ASSUMPTION (P-A04), not an observed RIR/RPE/failure.
 * Used when StrengthSet.rir is null.
 */
export type AssumedHardSetQualificationV7 = {
  status: "qualified-by-product-assumption";
  assumption: typeof HARD_SET_QUALIFICATION_ASSUMPTION_V7;
};

/**
 * User-reported RIR that the audited contract can classify as qualifying
 * hard-set effort evidence (C-A04 / P-A04).
 *
 * Supported observed classifications only:
 * - RIR 0 → momentary-failure
 * - RIR 1 → near-failure (reps-in-reserve)
 *
 * Provenance only — never a dose coefficient or failure bonus.
 * No RIR≤N exclusion/qualification curve is approved (P-A04).
 */
export type ObservedRirHardSetQualificationV7 = {
  status: "qualified-by-user-reported-rir";
  provenance: "user-reported-rir";
  rir: 0 | 1;
  reportedProximity: "momentary-failure" | "reps-in-reserve";
};

/**
 * Observed RIR exists, but v7 has no approved numeric hard-set threshold
 * (P-A04: DEFER numeric RIR coefficient). Must not fall back to
 * assumed-near-failure and must not invent RIR≤3-style cutoffs.
 */
export type UnresolvedObservedRirEffortV7 = {
  status: "observed-rir-qualification-unresolved";
  provenance: "user-reported-rir";
  rir: number;
  reason: "no-approved-rir-hard-set-threshold";
};

export type HardSetQualificationV7 =
  | AssumedHardSetQualificationV7
  | ObservedRirHardSetQualificationV7;

export type SetEffortEvidenceV7 =
  | HardSetQualificationV7
  | UnresolvedObservedRirEffortV7;

export type QualifiedResistanceSetEffortEvidenceV7 = {
  strengthSetId: number;
  setNumber: number;
  evidence: SetEffortEvidenceV7;
};

export function isHardSetQualifiedEffort(evidence: SetEffortEvidenceV7): boolean {
  return (
    evidence.status === "qualified-by-product-assumption"
    || evidence.status === "qualified-by-user-reported-rir"
  );
}

/**
 * Per-set effort evidence from optional StrengthSet.rir.
 *
 * - null → product assumption (never invent RIR=0)
 * - 0 / 1 → supported observed hard-set classifications for C-A04
 * - other observed integers → preserve observation; qualification unresolved
 */
export function effortEvidenceFromRir(rir: number | null): SetEffortEvidenceV7 {
  if (rir == null) {
    return {
      status: "qualified-by-product-assumption",
      assumption: HARD_SET_QUALIFICATION_ASSUMPTION_V7,
    };
  }
  if (rir === 0) {
    return {
      status: "qualified-by-user-reported-rir",
      provenance: "user-reported-rir",
      rir: 0,
      reportedProximity: "momentary-failure",
    };
  }
  if (rir === 1) {
    return {
      status: "qualified-by-user-reported-rir",
      provenance: "user-reported-rir",
      rir: 1,
      reportedProximity: "reps-in-reserve",
    };
  }
  return {
    status: "observed-rir-qualification-unresolved",
    provenance: "user-reported-rir",
    rir,
    reason: "no-approved-rir-hard-set-threshold",
  };
}

export type QualifiedResistanceMuscleBucketV7 = {
  muscleGroup: CanonicalMuscleGroupV7;
  /** Count of effort-qualified mapped sets that listed this group as direct. */
  directMappedSetCount: number;
  /** Count of effort-qualified mapped sets that listed this group as indirect. */
  indirectMappedSetCount: number;
};

export type QualifiedResistanceTypeContextV7 = {
  resistanceType: ResistanceType;
  /** Effort-qualified mapped sets of this resistance type. */
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
  /**
   * Session-level null-RIR fallback policy (product assumption).
   * Per-set observed RIR lives in setEffortEvidence and must not be overwritten.
   */
  hardSetQualification: AssumedHardSetQualificationV7;
  /** Per recorded mapped set — observed RIR takes precedence over assumption. */
  setEffortEvidence: QualifiedResistanceSetEffortEvidenceV7[];
  recordedSetCount: number;
  /** Structurally mapped recorded sets (mapping available), including unresolved effort. */
  mappedSetCount: number;
  /** Mapped sets whose effort evidence qualifies as a hard set. */
  qualifiedHardSetCount: number;
  /**
   * Mapped sets with observed RIR that cannot be classified under the approved
   * contract (no invented cutoff). Not erased; not assumed-near-failure.
   */
  unresolvedEffortMappedSetCount: number;
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
  qualifiedHardSetCount: 0;
  unresolvedEffortMappedSetCount: 0;
  unmappedSetCount: number;
  heartRateContext: QualifiedResistanceHeartRateContextV7;
  ordinaryTonnageKg: number | null;
};

export type QualifiedResistanceTrainingDoseV7 =
  | AvailableQualifiedResistanceTrainingDoseV7
  | UnavailableQualifiedResistanceTrainingDoseV7;

const HARD_SET_QUALIFICATION: AssumedHardSetQualificationV7 = {
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
  let qualifiedHardSetCount = 0;
  let unresolvedEffortMappedSetCount = 0;
  let unmappedSetCount = 0;
  let mappedExerciseCount = 0;
  let unmappedExerciseCount = 0;
  const mappingVersions = new Set<string>();
  const muscleBuckets = new Map<CanonicalMuscleGroupV7, {
    directMappedSetCount: number;
    indirectMappedSetCount: number;
  }>();
  const resistanceBuckets = new Map<ResistanceType, number>();
  const setEffortEvidence: QualifiedResistanceSetEffortEvidenceV7[] = [];

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

    for (const set of exercise.sets) {
      const evidence = effortEvidenceFromRir(set.rir);
      setEffortEvidence.push({
        strengthSetId: set.strengthSetId,
        setNumber: set.setNumber,
        evidence,
      });

      if (!isHardSetQualifiedEffort(evidence)) {
        unresolvedEffortMappedSetCount += 1;
        continue;
      }

      qualifiedHardSetCount += 1;
      resistanceBuckets.set(
        exercise.resistanceType,
        (resistanceBuckets.get(exercise.resistanceType) ?? 0) + 1,
      );
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
      qualifiedHardSetCount: 0,
      unresolvedEffortMappedSetCount: 0,
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
      qualifiedHardSetCount: 0,
      unresolvedEffortMappedSetCount: 0,
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
    setEffortEvidence,
    recordedSetCount,
    mappedSetCount,
    qualifiedHardSetCount,
    unresolvedEffortMappedSetCount,
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
      sessionRevision: dose.sessionRevision,
      recordedSetCount: dose.recordedSetCount,
      unmappedSetCount: dose.unmappedSetCount,
    });
  }

  return stableSha256({
    contractVersion: dose.contractVersion,
    availability: dose.availability,
    sessionRevision: dose.sessionRevision,
    hardSetQualification: dose.hardSetQualification,
    setEffortEvidence: dose.setEffortEvidence.map(({ setNumber, evidence }) => ({
      setNumber,
      evidence,
    })),
    recordedSetCount: dose.recordedSetCount,
    mappedSetCount: dose.mappedSetCount,
    qualifiedHardSetCount: dose.qualifiedHardSetCount,
    unresolvedEffortMappedSetCount: dose.unresolvedEffortMappedSetCount,
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
