import { stableSha256 } from "@/modules/model-recovery/recovery-fingerprint";

/**
 * Experimental Age-Related Maintenance Uncertainty V1 (shadow only).
 *
 * Age is context for uncertainty around an already-estimated relative
 * skeletal-muscle delta. It never changes the point estimate, creates a
 * negative delta, or derives skeletal muscle from lean/FFM measurements.
 */
export const EXPERIMENTAL_AGE_RELATED_MAINTENANCE_UNCERTAINTY_V1_REVISION =
  "experimental-age-related-maintenance-uncertainty-v1" as const;
export const EXPERIMENTAL_AGE_RELATED_MAINTENANCE_UNCERTAINTY_V1_PROVENANCE =
  "experimental-heuristic" as const;

/**
 * Smooth, bounded engineering uncertainty context, not a sarcopenia rate.
 * `1 + 0.25 × age / (age + 50)` has no age cutoff or discontinuity and is
 * applied only to an existing interval width, never to the central delta.
 */
export const EXPERIMENTAL_AGE_RELATED_MAINTENANCE_UNCERTAINTY_V1_PRIORS = {
  maximumAdditionalUncertaintyFraction: 0.25,
  smoothingAgeYears: 50,
  multiplierFormula: "1 + 0.25 * ageYears / (ageYears + 50)",
  classification: "engineering-smooth-age-context-uncertainty-not-sarcopenia-rate" as const,
  scientificDecision: "no-universal-age-cutoff-or-daily-annual-muscle-loss-coefficient" as const,
  centralEstimateTreatment: "unchanged" as const,
} as const;

export type RelativeSkeletalMuscleDeltaEvidenceV1 = {
  estimatedSkeletalMuscleDeltaKg: number | null;
  lowerBoundKg: number | null;
  upperBoundKg: number | null;
  supportedDomain: string;
};

export type ExperimentalAgeRelatedMaintenanceUncertaintyResultV1 = {
  contractVersion: typeof EXPERIMENTAL_AGE_RELATED_MAINTENANCE_UNCERTAINTY_V1_REVISION;
  provenance: typeof EXPERIMENTAL_AGE_RELATED_MAINTENANCE_UNCERTAINTY_V1_PROVENANCE;
  supportedDomain: "age-related-maintenance-uncertainty-shadow-only";
  availability: "available" | "unavailable";
  ageContextStatus: "age-context-applied" | "age-unavailable" | "underlying-delta-unavailable";
  ageYears: number | null;
  uncertaintyWidthMultiplier: number | null;
  underlyingRelativeSkeletalMuscleDeltaKg: number | null;
  ageAdjustedPointEstimateKg: number | null;
  ageAdjustedLowerBoundKg: number | null;
  ageAdjustedUpperBoundKg: number | null;
  centralEstimateModified: false;
  ageGeneratedNegativeDelta: false;
  trainingProteinMathChanged: false;
  absoluteSkeletalMuscleKg: null;
  rejectedConversions: readonly [
    "universal-daily-or-annual-sarcopenia-coefficient",
    "hard-age-cutoff",
    "age-to-automatic-negative-muscle-delta",
    "lean-or-ffm-to-skeletalMuscleKg",
    "scale-residual-allocation",
  ];
  reasons: string[];
  fingerprint: string;
};

function rejectedConversions(): ExperimentalAgeRelatedMaintenanceUncertaintyResultV1["rejectedConversions"] {
  return [
    "universal-daily-or-annual-sarcopenia-coefficient",
    "hard-age-cutoff",
    "age-to-automatic-negative-muscle-delta",
    "lean-or-ffm-to-skeletalMuscleKg",
    "scale-residual-allocation",
  ] as const;
}

function finish(
  partial: Omit<ExperimentalAgeRelatedMaintenanceUncertaintyResultV1, "fingerprint">,
): ExperimentalAgeRelatedMaintenanceUncertaintyResultV1 {
  const result: ExperimentalAgeRelatedMaintenanceUncertaintyResultV1 = { ...partial, fingerprint: "" };
  result.fingerprint = experimentalAgeRelatedMaintenanceUncertaintyV1Fingerprint(result);
  return result;
}

function ageUncertaintyMultiplier(ageYears: number): number {
  if (!Number.isFinite(ageYears) || ageYears < 0) {
    throw new RangeError("ageYears must be finite and nonnegative when provided");
  }
  const prior = EXPERIMENTAL_AGE_RELATED_MAINTENANCE_UNCERTAINTY_V1_PRIORS;
  return 1 + prior.maximumAdditionalUncertaintyFraction * ageYears / (ageYears + prior.smoothingAgeYears);
}

/**
 * Preserves the underlying point estimate and widens only its existing bounds.
 * Training, protein, energy, and training-status effects remain in the source
 * delta contract and are intentionally not recomputed here.
 */
export function evaluateExperimentalAgeRelatedMaintenanceUncertaintyV1(input: {
  ageYears: number | null;
  underlying: RelativeSkeletalMuscleDeltaEvidenceV1;
}): ExperimentalAgeRelatedMaintenanceUncertaintyResultV1 {
  const underlying = input.underlying;
  const base = {
    contractVersion: EXPERIMENTAL_AGE_RELATED_MAINTENANCE_UNCERTAINTY_V1_REVISION,
    provenance: EXPERIMENTAL_AGE_RELATED_MAINTENANCE_UNCERTAINTY_V1_PROVENANCE,
    supportedDomain: "age-related-maintenance-uncertainty-shadow-only" as const,
    ageYears: input.ageYears,
    underlyingRelativeSkeletalMuscleDeltaKg: underlying.estimatedSkeletalMuscleDeltaKg,
    centralEstimateModified: false as const,
    ageGeneratedNegativeDelta: false as const,
    trainingProteinMathChanged: false as const,
    absoluteSkeletalMuscleKg: null,
    rejectedConversions: rejectedConversions(),
  };
  if (underlying.estimatedSkeletalMuscleDeltaKg === null
    || underlying.lowerBoundKg === null
    || underlying.upperBoundKg === null) {
    return finish({
      ...base,
      availability: "unavailable",
      ageContextStatus: "underlying-delta-unavailable",
      uncertaintyWidthMultiplier: null,
      ageAdjustedPointEstimateKg: null,
      ageAdjustedLowerBoundKg: null,
      ageAdjustedUpperBoundKg: null,
      reasons: [
        "underlying-relative-skeletal-muscle-delta-is-unavailable",
        "missing-underlying-evidence-is-not-zero-age-effect",
        "age-context-does-not-create-a-muscle-delta",
      ],
    });
  }
  if (input.ageYears === null) {
    return finish({
      ...base,
      availability: "unavailable",
      ageContextStatus: "age-unavailable",
      uncertaintyWidthMultiplier: null,
      ageAdjustedPointEstimateKg: underlying.estimatedSkeletalMuscleDeltaKg,
      ageAdjustedLowerBoundKg: null,
      ageAdjustedUpperBoundKg: null,
      reasons: [
        "missing-age-is-not-zero-age-effect",
        "age-context-uncertainty-remains-unavailable",
        "underlying-training-protein-energy-and-status-math-is-preserved",
      ],
    });
  }
  const multiplier = ageUncertaintyMultiplier(input.ageYears);
  const point = underlying.estimatedSkeletalMuscleDeltaKg;
  const lower = point - (point - underlying.lowerBoundKg) * multiplier;
  const upper = point + (underlying.upperBoundKg - point) * multiplier;
  return finish({
    ...base,
    availability: "available",
    ageContextStatus: "age-context-applied",
    uncertaintyWidthMultiplier: multiplier,
    ageAdjustedPointEstimateKg: point,
    ageAdjustedLowerBoundKg: Math.min(lower, point, upper),
    ageAdjustedUpperBoundKg: Math.max(lower, point, upper),
    reasons: [
      "age-smoothly-widens-existing-uncertainty-without-shifting-central-delta",
      "no-hard-age-cutoff-or-universal-sarcopenia-rate",
      "older-age-does-not-automatically-create-negative-muscle-delta",
      "underlying-training-protein-energy-and-status-math-is-preserved",
    ],
  });
}

/** Deterministic rebuild of date-keyed shadow uncertainty rows. */
export function rebuildExperimentalAgeRelatedMaintenanceUncertaintyTrajectoryV1(input: {
  days: readonly {
    date: string;
    ageYears: number | null;
    underlying: RelativeSkeletalMuscleDeltaEvidenceV1;
  }[];
}): Array<{ date: string; result: ExperimentalAgeRelatedMaintenanceUncertaintyResultV1 }> {
  return input.days.slice().sort((a, b) => a.date.localeCompare(b.date)).map((day) => ({
    date: day.date,
    result: evaluateExperimentalAgeRelatedMaintenanceUncertaintyV1({
      ageYears: day.ageYears,
      underlying: day.underlying,
    }),
  }));
}

export function experimentalAgeRelatedMaintenanceUncertaintyV1Fingerprint(
  result: Omit<ExperimentalAgeRelatedMaintenanceUncertaintyResultV1, "fingerprint"> & {
    fingerprint?: string;
  },
): string {
  const rest = { ...result };
  delete rest.fingerprint;
  return stableSha256(rest);
}
