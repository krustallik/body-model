import type { ExperimentalFfmRetentionResultV1 } from "@/model/physiology-v7/experimental-ffm-retention-v1";
import type { ExperimentalSkeletalMuscleDeltaResultV1 } from "@/model/physiology-v7/experimental-skeletal-muscle-delta-v1";
import type { FatWeightShadowStateV1 } from "@/model/physiology-v7/fat-weight-shadow-v1";
import { stableSha256 } from "@/modules/model-recovery/recovery-fingerprint";

/**
 * Experimental Body Recomposition V1 (shadow / EXPERIMENTAL only).
 *
 * A longitudinal evidence classifier, not a body-compartment allocator. It
 * compares read-only FatWeightShadowV1 fat states with the relative (never
 * absolute) skeletal-muscle trajectory. FFM retention is explanatory context
 * only and is never converted into skeletalMuscleKg.
 */
export const EXPERIMENTAL_BODY_RECOMPOSITION_V1_REVISION =
  "experimental-body-recomposition-v1" as const;

export const EXPERIMENTAL_BODY_RECOMPOSITION_V1_PROVENANCE =
  "experimental-heuristic" as const;

export const EXPERIMENTAL_BODY_RECOMPOSITION_V1_PRIORS = {
  classification: "evidence-compatibility-heuristic-not-personal-body-composition-truth" as const,
  fatLossAndPositiveRelativeSm: {
    evidenceStrength: "strong" as const,
    classification: "experimental-compatible-evidence",
  },
  fatLossAndMaintainedRelativeSm: {
    evidenceStrength: "supportive" as const,
    classification: "experimental-compatible-evidence-without-muscle-gain-claim",
  },
  fatLossAndNegativeRelativeSm: {
    classification: "not-positive-recomposition",
  },
  ffmRetention: {
    classification: "context-only-not-skeletal-muscle-conversion" as const,
  },
  missingInputsAreNotZero: {
    classification: "scientific-input-contract" as const,
  },
} as const;

export type ExperimentalBodyRecompositionStatusV1 = "available" | "unavailable";

export type ExperimentalBodyRecompositionClassificationV1 =
  | "positive-recomposition-supported"
  | "recomposition-maintenance-supported"
  | "not-positive-recomposition-muscle-loss"
  | "not-recomposition-fat-not-lost"
  | "insufficient-evidence";

export type ExperimentalBodyRecompositionEvidenceStrengthV1 =
  | "strong"
  | "supportive"
  | "none";

type RelativeSmSnapshot = Pick<
  ExperimentalSkeletalMuscleDeltaResultV1,
  "availability" | "state"
>;

type FfmRetentionContext = Pick<
  ExperimentalFfmRetentionResultV1,
  "availability" | "retentionEffect" | "relativeSlowNonFatLossDifferenceKg"
>;

export type ExperimentalBodyRecompositionResultV1 = {
  modelRevision: typeof EXPERIMENTAL_BODY_RECOMPOSITION_V1_REVISION;
  provenance: typeof EXPERIMENTAL_BODY_RECOMPOSITION_V1_PROVENANCE;
  supportedDomain: "relative-body-recomposition-evidence-shadow-only";
  status: ExperimentalBodyRecompositionStatusV1;
  classification: ExperimentalBodyRecompositionClassificationV1;
  evidenceStrength: ExperimentalBodyRecompositionEvidenceStrengthV1;
  fatDeltaKg: number | null;
  relativeSkeletalMuscleDeltaKg: number | null;
  /** Context only; no FFM/lean value is used to derive a muscle value. */
  ffmRetentionContext: {
    availability: "available" | "unavailable" | "not-provided";
    retentionEffectPoint: number | null;
    relativeSlowNonFatLossDifferenceKg: number | null;
  };
  absoluteSkeletalMuscleKg: null;
  unallocatedResidualKg: null;
  unavailableReason: "missing-fat-evidence" | "missing-relative-skeletal-muscle-evidence" | null;
  features: {
    fatEvidenceAvailable: boolean;
    relativeSkeletalMuscleEvidenceAvailable: boolean;
    fatLossObservedInShadow: boolean | null;
    relativeSkeletalMuscleDirection: "positive" | "maintained" | "negative" | "unavailable";
    ffmRetentionUsedForClassification: false;
    rejectedConversions: readonly [
      "ffm-lean-to-skeletalMuscleKg",
      "bia-dxa-to-skeletalMuscleKg",
      "scale-residual-allocation",
      "fat-muscle-residual-balancing",
      "surplus-required-for-recomposition",
    ];
  };
  reasons: string[];
  fingerprint: string;
};

function rejectedConversions(): ExperimentalBodyRecompositionResultV1["features"]["rejectedConversions"] {
  return [
    "ffm-lean-to-skeletalMuscleKg",
    "bia-dxa-to-skeletalMuscleKg",
    "scale-residual-allocation",
    "fat-muscle-residual-balancing",
    "surplus-required-for-recomposition",
  ] as const;
}

function finite(value: number | null): value is number {
  return value !== null && Number.isFinite(value);
}

function ffmContext(ffm: FfmRetentionContext | null | undefined) {
  if (ffm === undefined || ffm === null) {
    return {
      availability: "not-provided" as const,
      retentionEffectPoint: null,
      relativeSlowNonFatLossDifferenceKg: null,
    };
  }
  return {
    availability: ffm.availability,
    retentionEffectPoint: ffm.retentionEffect.point,
    relativeSlowNonFatLossDifferenceKg: ffm.relativeSlowNonFatLossDifferenceKg.point,
  };
}

function finish(partial: Omit<ExperimentalBodyRecompositionResultV1, "fingerprint">) {
  const result: ExperimentalBodyRecompositionResultV1 = { ...partial, fingerprint: "" };
  result.fingerprint = experimentalBodyRecompositionV1Fingerprint(result);
  return result;
}

/**
 * Compare two already-computed shadow snapshots.
 *
 * fatDeltaKg = end.fatMassKg - start.fatMassKg
 * relativeSkeletalMuscleDeltaKg = end.relativeCumulativeDeltaKg
 *   - start.relativeCumulativeDeltaKg
 *
 * No energy-surplus predicate appears in the decision rule. No residual is
 * inferred or distributed among fat, muscle, glycogen, water, or ECF.
 */
export function estimateExperimentalBodyRecompositionV1(input: {
  fatStart: FatWeightShadowStateV1;
  fatEnd: FatWeightShadowStateV1;
  skeletalMuscleStart: RelativeSmSnapshot;
  skeletalMuscleEnd: RelativeSmSnapshot;
  ffmRetentionContext?: FfmRetentionContext | null;
  /** Explicitly ignored measurement/residual context. */
  leanMassKg?: number | null;
  biaOrDxaFfmKg?: number | null;
  scaleWeightResidualKg?: number | null;
}): ExperimentalBodyRecompositionResultV1 {
  const ffm = ffmContext(input.ffmRetentionContext);
  const reasons = [
    "experimental-heuristic-compatible-evidence-classifier",
    "fatWeightShadowV1-used-as-read-only-fat-evidence",
    "relative-skeletal-muscle-delta-used-without-absolute-skeletalMuscleKg",
    "ffm-retention-is-context-only-not-skeletal-muscle-evidence",
    "no-residual-allocation-or-body-compartment-balancing",
    "surplus-not-required-for-recomposition-classification",
  ];
  if (input.leanMassKg != null) reasons.push("lean-mass-context-ignored");
  if (input.biaOrDxaFfmKg != null) reasons.push("bia-dxa-ffm-context-ignored");
  if (input.scaleWeightResidualKg != null) reasons.push("scale-weight-residual-context-ignored");

  const fatAvailable = input.fatStart.availability === "available"
    && input.fatEnd.availability === "available"
    && finite(input.fatStart.fatMassKg)
    && finite(input.fatEnd.fatMassKg);
  const smAvailable = input.skeletalMuscleStart.availability === "available"
    && input.skeletalMuscleEnd.availability === "available"
    && finite(input.skeletalMuscleStart.state.relativeCumulativeDeltaKg)
    && finite(input.skeletalMuscleEnd.state.relativeCumulativeDeltaKg);
  const baseFeatures = {
    fatEvidenceAvailable: fatAvailable,
    relativeSkeletalMuscleEvidenceAvailable: smAvailable,
    fatLossObservedInShadow: null,
    relativeSkeletalMuscleDirection: "unavailable" as const,
    ffmRetentionUsedForClassification: false as const,
    rejectedConversions: rejectedConversions(),
  };

  if (!fatAvailable) {
    return finish({
      modelRevision: EXPERIMENTAL_BODY_RECOMPOSITION_V1_REVISION,
      provenance: EXPERIMENTAL_BODY_RECOMPOSITION_V1_PROVENANCE,
      supportedDomain: "relative-body-recomposition-evidence-shadow-only",
      status: "unavailable",
      classification: "insufficient-evidence",
      evidenceStrength: "none",
      fatDeltaKg: null,
      relativeSkeletalMuscleDeltaKg: null,
      ffmRetentionContext: ffm,
      absoluteSkeletalMuscleKg: null,
      unallocatedResidualKg: null,
      unavailableReason: "missing-fat-evidence",
      features: baseFeatures,
      reasons: [...reasons, "missing-fat-evidence-is-not-no-recomposition"],
    });
  }
  if (!smAvailable) {
    return finish({
      modelRevision: EXPERIMENTAL_BODY_RECOMPOSITION_V1_REVISION,
      provenance: EXPERIMENTAL_BODY_RECOMPOSITION_V1_PROVENANCE,
      supportedDomain: "relative-body-recomposition-evidence-shadow-only",
      status: "unavailable",
      classification: "insufficient-evidence",
      evidenceStrength: "none",
      fatDeltaKg: input.fatEnd.fatMassKg! - input.fatStart.fatMassKg!,
      relativeSkeletalMuscleDeltaKg: null,
      ffmRetentionContext: ffm,
      absoluteSkeletalMuscleKg: null,
      unallocatedResidualKg: null,
      unavailableReason: "missing-relative-skeletal-muscle-evidence",
      features: {
        ...baseFeatures,
        fatLossObservedInShadow: input.fatEnd.fatMassKg! < input.fatStart.fatMassKg!,
      },
      reasons: [...reasons, "missing-relative-skeletal-muscle-evidence-is-not-no-recomposition"],
    });
  }

  const fatDeltaKg = input.fatEnd.fatMassKg! - input.fatStart.fatMassKg!;
  const relativeSkeletalMuscleDeltaKg = input.skeletalMuscleEnd.state.relativeCumulativeDeltaKg!
    - input.skeletalMuscleStart.state.relativeCumulativeDeltaKg!;
  const fatLost = fatDeltaKg < 0;
  const direction = relativeSkeletalMuscleDeltaKg > 0
    ? "positive" as const
    : relativeSkeletalMuscleDeltaKg < 0
      ? "negative" as const
      : "maintained" as const;

  if (fatLost && direction === "positive") {
    return finish({
      modelRevision: EXPERIMENTAL_BODY_RECOMPOSITION_V1_REVISION,
      provenance: EXPERIMENTAL_BODY_RECOMPOSITION_V1_PROVENANCE,
      supportedDomain: "relative-body-recomposition-evidence-shadow-only",
      status: "available",
      classification: "positive-recomposition-supported",
      evidenceStrength: "strong",
      fatDeltaKg,
      relativeSkeletalMuscleDeltaKg,
      ffmRetentionContext: ffm,
      absoluteSkeletalMuscleKg: null,
      unallocatedResidualKg: null,
      unavailableReason: null,
      features: { ...baseFeatures, fatLossObservedInShadow: true, relativeSkeletalMuscleDirection: direction },
      reasons: [...reasons, "fat-loss-plus-positive-relative-skeletal-muscle-delta-supports-positive-recomposition"],
    });
  }
  if (fatLost && direction === "maintained") {
    return finish({
      modelRevision: EXPERIMENTAL_BODY_RECOMPOSITION_V1_REVISION,
      provenance: EXPERIMENTAL_BODY_RECOMPOSITION_V1_PROVENANCE,
      supportedDomain: "relative-body-recomposition-evidence-shadow-only",
      status: "available",
      classification: "recomposition-maintenance-supported",
      evidenceStrength: "supportive",
      fatDeltaKg,
      relativeSkeletalMuscleDeltaKg,
      ffmRetentionContext: ffm,
      absoluteSkeletalMuscleKg: null,
      unallocatedResidualKg: null,
      unavailableReason: null,
      features: { ...baseFeatures, fatLossObservedInShadow: true, relativeSkeletalMuscleDirection: direction },
      reasons: [...reasons, "fat-loss-plus-maintained-relative-skeletal-muscle-supports-weaker-recomposition-evidence"],
    });
  }
  const muscleLoss = fatLost && direction === "negative";
  return finish({
    modelRevision: EXPERIMENTAL_BODY_RECOMPOSITION_V1_REVISION,
    provenance: EXPERIMENTAL_BODY_RECOMPOSITION_V1_PROVENANCE,
    supportedDomain: "relative-body-recomposition-evidence-shadow-only",
    status: "available",
    classification: muscleLoss ? "not-positive-recomposition-muscle-loss" : "not-recomposition-fat-not-lost",
    evidenceStrength: "none",
    fatDeltaKg,
    relativeSkeletalMuscleDeltaKg,
    ffmRetentionContext: ffm,
    absoluteSkeletalMuscleKg: null,
    unallocatedResidualKg: null,
    unavailableReason: null,
    features: { ...baseFeatures, fatLossObservedInShadow: fatLost, relativeSkeletalMuscleDirection: direction },
    reasons: [...reasons, muscleLoss
      ? "fat-loss-plus-negative-relative-skeletal-muscle-delta-is-not-positive-recomposition"
      : "fat-not-lost-in-read-only-fat-shadow"],
  });
}

/** Deterministic historical rebuild over supplied, already-computed shadow snapshots. */
export function rebuildExperimentalBodyRecompositionTrajectoryV1(input: {
  days: readonly (Parameters<typeof estimateExperimentalBodyRecompositionV1>[0] & {
    date: string;
  })[];
}): ExperimentalBodyRecompositionResultV1[] {
  return input.days.map((day) => estimateExperimentalBodyRecompositionV1(day));
}

export function experimentalBodyRecompositionV1Fingerprint(
  result: Omit<ExperimentalBodyRecompositionResultV1, "fingerprint"> & { fingerprint?: string },
): string {
  const rest = { ...result };
  delete rest.fingerprint;
  return stableSha256(rest);
}
