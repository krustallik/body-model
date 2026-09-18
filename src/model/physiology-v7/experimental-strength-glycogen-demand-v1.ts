import type {
  CanonicalMuscleGroupV7,
} from "@/model/physiology-v7/exercise-muscle-mapping-v7";
import {
  type AvailableQualifiedResistanceTrainingDoseV7,
  type QualifiedResistanceTrainingDoseV7,
  qualifiedResistanceTrainingDoseV7Fingerprint,
} from "@/model/physiology-v7/qualified-resistance-training-dose-v7";
import { stableSha256 } from "@/modules/model-recovery/recovery-fingerprint";

/**
 * Experimental Strength Glycogen Demand V1.1 (shadow / EXPERIMENTAL only).
 *
 * Direct mapped hard-set count is the primary dose driver. Unsupported
 * per-group mass weights and fixed indirect coefficients are rejected; those
 * factors widen uncertainty / context instead of inventing precision.
 * Not scientifically validated. Never writes production TDEE / forecast / v7
 * glycogen transitions.
 */
export const EXPERIMENTAL_STRENGTH_GLYCOGEN_DEMAND_V1_REVISION =
  "experimental-strength-glycogen-demand-v1.1" as const;

export const EXPERIMENTAL_STRENGTH_GLYCOGEN_DEMAND_V1_PROVENANCE =
  "experimental-heuristic" as const;

/**
 * ENGINEERING PRIOR — saturating scale τ for direct hard-set count.
 * Not derived from E-F01 protocols; chosen so modest sessions stay below the
 * reference magnitude envelope without a hard linear divisor/cap.
 */
export const ENGINEERING_DIRECT_SET_SCALE_TAU_V1 = 8 as const;

/**
 * ENGINEERING PRIOR — coarse taxonomy only (not continuous mass fractions).
 * Used to classify recruitment context for uncertainty envelopes, never as
 * per-group kg weights.
 */
export const ENGINEERING_LARGE_MUSCLE_GROUPS_V1 = [
  "hip_extensors",
  "back",
  "spinal_extensors",
  "chest",
] as const satisfies readonly CanonicalMuscleGroupV7[];

const LARGE_MUSCLE_GROUP_SET: ReadonlySet<CanonicalMuscleGroupV7> = new Set(
  ENGINEERING_LARGE_MUSCLE_GROUPS_V1,
);

/**
 * Bounded whole-body glycogen depletion magnitudes (kg) for a saturated
 * direct-hard-set session envelope.
 *
 * Scientific basis for *having* a wide uncertain band: E-F01 local
 * concentration change (~−104 mmol/kg dry mass; ~21% local mean) shows
 * recruited muscle can deplete, but active mass / anatomical aggregation to
 * whole-body kg is unknown (prediction interval crosses zero; high I²).
 *
 * The numeric endpoints are ENGINEERING order-of-magnitude priors for an
 * experimental heuristic — not personal coefficients and not the rejected
 * −11.2 mmol/kgdm/set ecological slope.
 */
export const EXPERIMENTAL_REFERENCE_DEMAND_KG_V1 = {
  /** ENGINEERING midpoint of the uncertain whole-body aggregation band. */
  pointMagnitudeKg: 0.025,
  /** ENGINEERING less-depletion edge of the band. */
  lowerMagnitudeKg: 0.005,
  /** ENGINEERING more-depletion edge of the band. */
  upperMagnitudeKg: 0.1,
  evidenceIds: ["E-F01", "E-F02", "E-F03", "E-F04"] as const,
  pointClassification: "engineering-midpoint" as const,
  boundClassification: "engineering-order-of-magnitude-band" as const,
  scientificNote:
    "E-F01 supports local depletion existence/sign; whole-body kg endpoints remain engineering priors under unknown recruited mass.",
} as const;

export type ExperimentalRecruitmentClassV1 =
  | "includes-large-direct"
  | "small-direct-only";

export type ExperimentalStrengthGlycogenDemandAvailabilityV1 =
  | "available"
  | "unavailable";

export type ExperimentalStrengthGlycogenDemandUnavailableReasonV1 =
  | "dose-unavailable"
  | "no-qualified-mapped-hard-sets"
  | "unresolved-effort-only"
  | "non-finite-available-glycogen";

export type ExperimentalStrengthGlycogenDemandFeaturesV1 = {
  doseFingerprint: string;
  doseAvailability: QualifiedResistanceTrainingDoseV7["availability"];
  qualifiedHardSetCount: number;
  mappedSetCount: number;
  unresolvedEffortMappedSetCount: number;
  /** Primary driver: unique qualified hard-set count (not per-group sum). */
  directMappedHardSetUnits: number;
  indirectMappedSetCount: number;
  /**
   * Indirect work is context only — never a fixed dose coefficient.
   * When present, only the more-depleted bound is widened.
   */
  indirectPolicy: "uncertainty-only-not-dose-coefficient";
  doseScale: number;
  recruitmentClass: ExperimentalRecruitmentClassV1 | null;
  muscleGroupsUsed: CanonicalMuscleGroupV7[];
  availableGlycogenKg: number | null;
  storeBoundApplied: boolean;
  ignoredActiveEnergyKcal: number | null;
  rejectedConversions: readonly [
    "kcal-to-glycogen",
    "universal-substrate-percent",
    "scale-weight-residual",
    "literature-personal-capacity",
    "ecological-mmol-per-set-coefficient",
    "fixed-indirect-set-coefficient",
    "continuous-muscle-group-mass-weights",
  ];
};

export type ExperimentalStrengthGlycogenDemandResultV1 = {
  contractVersion: typeof EXPERIMENTAL_STRENGTH_GLYCOGEN_DEMAND_V1_REVISION;
  provenance: typeof EXPERIMENTAL_STRENGTH_GLYCOGEN_DEMAND_V1_PROVENANCE;
  supportedDomain: "strength-resistance-shadow-only";
  availability: ExperimentalStrengthGlycogenDemandAvailabilityV1;
  /**
   * Exercise-only glycogen delta (kg). Always ≤ 0 when available.
   * Null when inputs are insufficient — never coerced to 0.
   */
  estimatedGlycogenDeltaKg: number | null;
  /** More-depleted bound (≤ estimated). */
  lowerBoundKg: number | null;
  /** Less-depleted bound (≥ estimated, ≤ 0). */
  upperBoundKg: number | null;
  unavailableReason: ExperimentalStrengthGlycogenDemandUnavailableReasonV1 | null;
  features: ExperimentalStrengthGlycogenDemandFeaturesV1;
  reasons: string[];
};

function finiteNonnegativeOrNull(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError("availableGlycogenKg must be finite and nonnegative when provided");
  }
  return value;
}

/** Saturating ENGINEERING scale in (0, 1); monotonic in direct set count. */
export function engineeringDirectSetScaleV1(directMappedHardSetUnits: number): number {
  if (!(directMappedHardSetUnits > 0)) return 0;
  return 1 - Math.exp(-directMappedHardSetUnits / ENGINEERING_DIRECT_SET_SCALE_TAU_V1);
}

export function computeExperimentalRecruitmentContextV1(
  dose: AvailableQualifiedResistanceTrainingDoseV7,
): {
  directMappedHardSetUnits: number;
  indirectMappedSetCount: number;
  muscleGroupsUsed: CanonicalMuscleGroupV7[];
  recruitmentClass: ExperimentalRecruitmentClassV1 | null;
} {
  // Primary driver is unique qualified hard sets (not sum across groups, which
  // would double-count multi-group exercises).
  const directMappedHardSetUnits = dose.qualifiedHardSetCount;
  let indirectMappedSetCount = 0;
  const muscleGroupsUsed: CanonicalMuscleGroupV7[] = [];
  let hasLargeDirect = false;
  let hasSmallDirect = false;

  for (const bucket of dose.muscleGroups) {
    indirectMappedSetCount += bucket.indirectMappedSetCount;
    if (bucket.directMappedSetCount > 0 || bucket.indirectMappedSetCount > 0) {
      muscleGroupsUsed.push(bucket.muscleGroup);
    }
    if (bucket.directMappedSetCount > 0) {
      if (LARGE_MUSCLE_GROUP_SET.has(bucket.muscleGroup)) hasLargeDirect = true;
      else hasSmallDirect = true;
    }
  }

  const recruitmentClass: ExperimentalRecruitmentClassV1 | null = directMappedHardSetUnits <= 0
    ? null
    : hasLargeDirect
      ? "includes-large-direct"
      : hasSmallDirect
        ? "small-direct-only"
        : null;

  return {
    directMappedHardSetUnits,
    indirectMappedSetCount,
    muscleGroupsUsed: muscleGroupsUsed.sort(),
    recruitmentClass,
  };
}

function clampToStore(deltaKg: number, availableGlycogenKg: number | null): number {
  if (availableGlycogenKg === null) return deltaKg;
  const clamped = Math.max(deltaKg, -availableGlycogenKg);
  return Object.is(clamped, -0) ? 0 : clamped;
}

function rejectedConversions(): ExperimentalStrengthGlycogenDemandFeaturesV1["rejectedConversions"] {
  return [
    "kcal-to-glycogen",
    "universal-substrate-percent",
    "scale-weight-residual",
    "literature-personal-capacity",
    "ecological-mmol-per-set-coefficient",
    "fixed-indirect-set-coefficient",
    "continuous-muscle-group-mass-weights",
  ] as const;
}

function emptyFeatures(input: {
  dose: QualifiedResistanceTrainingDoseV7;
  availableGlycogenKg: number | null;
  ignoredActiveEnergyKcal: number | null;
  directMappedHardSetUnits?: number;
  indirectMappedSetCount?: number;
  doseScale?: number;
  recruitmentClass?: ExperimentalRecruitmentClassV1 | null;
  muscleGroupsUsed?: CanonicalMuscleGroupV7[];
}): ExperimentalStrengthGlycogenDemandFeaturesV1 {
  const dose = input.dose;
  return {
    doseFingerprint: qualifiedResistanceTrainingDoseV7Fingerprint(dose),
    doseAvailability: dose.availability,
    qualifiedHardSetCount: dose.qualifiedHardSetCount,
    mappedSetCount: dose.mappedSetCount,
    unresolvedEffortMappedSetCount: dose.unresolvedEffortMappedSetCount,
    directMappedHardSetUnits: input.directMappedHardSetUnits ?? 0,
    indirectMappedSetCount: input.indirectMappedSetCount ?? 0,
    indirectPolicy: "uncertainty-only-not-dose-coefficient",
    doseScale: input.doseScale ?? 0,
    recruitmentClass: input.recruitmentClass ?? null,
    muscleGroupsUsed: input.muscleGroupsUsed ?? [],
    availableGlycogenKg: input.availableGlycogenKg,
    storeBoundApplied: false,
    ignoredActiveEnergyKcal: input.ignoredActiveEnergyKcal,
    rejectedConversions: rejectedConversions(),
  };
}

function unavailableResult(input: {
  dose: QualifiedResistanceTrainingDoseV7;
  availableGlycogenKg: number | null;
  ignoredActiveEnergyKcal: number | null;
  reason: ExperimentalStrengthGlycogenDemandUnavailableReasonV1;
  reasons: string[];
  directMappedHardSetUnits?: number;
  indirectMappedSetCount?: number;
  doseScale?: number;
  recruitmentClass?: ExperimentalRecruitmentClassV1 | null;
  muscleGroupsUsed?: CanonicalMuscleGroupV7[];
}): ExperimentalStrengthGlycogenDemandResultV1 {
  return {
    contractVersion: EXPERIMENTAL_STRENGTH_GLYCOGEN_DEMAND_V1_REVISION,
    provenance: EXPERIMENTAL_STRENGTH_GLYCOGEN_DEMAND_V1_PROVENANCE,
    supportedDomain: "strength-resistance-shadow-only",
    availability: "unavailable",
    estimatedGlycogenDeltaKg: null,
    lowerBoundKg: null,
    upperBoundKg: null,
    unavailableReason: input.reason,
    features: emptyFeatures(input),
    reasons: input.reasons,
  };
}

/**
 * Experimental heuristic: bounded nonpositive glycogen demand from qualified
 * resistance dose + muscle-mapping context. Missing dose/mapping ≠ zero demand.
 */
export function estimateExperimentalStrengthGlycogenDemandV1(input: {
  dose: QualifiedResistanceTrainingDoseV7;
  availableGlycogenKg?: number | null;
  /** Explicitly ignored — never converted to glycogen. */
  activeEnergyKcal?: number | null;
}): ExperimentalStrengthGlycogenDemandResultV1 {
  const availableGlycogenKg = finiteNonnegativeOrNull(input.availableGlycogenKg ?? null);
  const ignoredActiveEnergyKcal = input.activeEnergyKcal === undefined
    ? null
    : input.activeEnergyKcal;
  if (ignoredActiveEnergyKcal !== null && !Number.isFinite(ignoredActiveEnergyKcal)) {
    throw new RangeError("activeEnergyKcal must be finite when provided");
  }

  const dose = input.dose;
  if (dose.availability === "unavailable") {
    return unavailableResult({
      dose,
      availableGlycogenKg,
      ignoredActiveEnergyKcal,
      reason: "dose-unavailable",
      reasons: [
        "qualified-resistance-dose-unavailable",
        "missing-mapped-dose-is-not-zero-depletion",
      ],
    });
  }

  if (dose.qualifiedHardSetCount === 0) {
    const reason = dose.unresolvedEffortMappedSetCount > 0
      ? "unresolved-effort-only" as const
      : "no-qualified-mapped-hard-sets" as const;
    return unavailableResult({
      dose,
      availableGlycogenKg,
      ignoredActiveEnergyKcal,
      reason,
      reasons: [
        reason,
        "missing-qualified-hard-sets-is-not-zero-depletion",
      ],
    });
  }

  const context = computeExperimentalRecruitmentContextV1(dose);
  const doseScale = engineeringDirectSetScaleV1(context.directMappedHardSetUnits);
  if (!(doseScale > 0) || context.recruitmentClass === null) {
    return unavailableResult({
      dose,
      availableGlycogenKg,
      ignoredActiveEnergyKcal,
      reason: "no-qualified-mapped-hard-sets",
      reasons: [
        "direct-mapped-hard-set-units-zero",
        "missing-muscle-mapping-contribution-is-not-zero-depletion",
      ],
      ...context,
      doseScale,
    });
  }

  const ref = EXPERIMENTAL_REFERENCE_DEMAND_KG_V1;
  // Point + nominal bounds from direct sets only.
  let estimatedGlycogenDeltaKg = -ref.pointMagnitudeKg * doseScale;
  let lowerBoundKg = -ref.upperMagnitudeKg * doseScale;
  let upperBoundKg = -ref.lowerMagnitudeKg * doseScale;

  // Small-muscle-only sessions: do not invent continuous weights. Move the
  // point/less-depleted edge to the engineering lower-magnitude prior while
  // keeping the more-depleted bound wide (asymmetric uncertainty).
  if (context.recruitmentClass === "small-direct-only") {
    estimatedGlycogenDeltaKg = -ref.lowerMagnitudeKg * doseScale;
    upperBoundKg = -ref.lowerMagnitudeKg * doseScale;
    // lowerBoundKg unchanged at -upperMagnitudeKg * doseScale
  }

  // Indirect mapped work: widen more-depleted bound only (binary context bit,
  // not a 0.35·n coefficient).
  if (context.indirectMappedSetCount > 0) {
    const widenedLowerScale = engineeringDirectSetScaleV1(
      context.directMappedHardSetUnits + 1,
    );
    lowerBoundKg = Math.min(lowerBoundKg, -ref.upperMagnitudeKg * widenedLowerScale);
  }

  estimatedGlycogenDeltaKg = clampToStore(estimatedGlycogenDeltaKg, availableGlycogenKg);
  lowerBoundKg = Math.min(
    clampToStore(lowerBoundKg, availableGlycogenKg),
    estimatedGlycogenDeltaKg,
  );
  upperBoundKg = Math.max(
    clampToStore(upperBoundKg, availableGlycogenKg),
    estimatedGlycogenDeltaKg,
  );
  // Keep upper ≤ 0 after asymmetric small-muscle pull.
  upperBoundKg = Math.min(0, upperBoundKg);

  const storeBoundApplied = availableGlycogenKg !== null;

  const reasons = [
    "experimental-heuristic-bounded-prior",
    "direct-mapped-hard-sets-primary-driver",
    "muscle-mapping-context-not-continuous-weights",
    "exercise-only-delta-nonpositive",
    ...(context.recruitmentClass === "small-direct-only"
      ? ["small-direct-only-asymmetric-uncertainty"]
      : ["includes-large-direct-full-envelope"]),
    ...(context.indirectMappedSetCount > 0
      ? ["indirect-mapping-widens-lower-bound-only"]
      : ["no-indirect-mapping-context"]),
    ...(storeBoundApplied
      ? ["store-bounded-to-available-glycogen"]
      : ["store-bound-not-applied-glycogen-unavailable"]),
    "kcal-to-glycogen-intentionally-rejected",
    "ecological-mmol-per-set-coefficient-intentionally-rejected",
    "fixed-indirect-set-coefficient-intentionally-rejected",
    "continuous-muscle-group-mass-weights-intentionally-rejected",
  ];

  return {
    contractVersion: EXPERIMENTAL_STRENGTH_GLYCOGEN_DEMAND_V1_REVISION,
    provenance: EXPERIMENTAL_STRENGTH_GLYCOGEN_DEMAND_V1_PROVENANCE,
    supportedDomain: "strength-resistance-shadow-only",
    availability: "available",
    estimatedGlycogenDeltaKg,
    lowerBoundKg,
    upperBoundKg,
    unavailableReason: null,
    features: {
      ...emptyFeatures({
        dose,
        availableGlycogenKg,
        ignoredActiveEnergyKcal,
        ...context,
        doseScale,
      }),
      storeBoundApplied,
    },
    reasons,
  };
}

export function experimentalStrengthGlycogenDemandV1Fingerprint(
  result: ExperimentalStrengthGlycogenDemandResultV1,
): string {
  return stableSha256(result);
}
