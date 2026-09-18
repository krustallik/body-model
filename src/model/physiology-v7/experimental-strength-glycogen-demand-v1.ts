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
 * Experimental Strength Glycogen Demand V1 (shadow / EXPERIMENTAL only).
 *
 * Estimates a bounded whole-body glycogen depletion demand from a completed
 * resistance session using qualified mapped dose + recruitment context.
 * Not scientifically validated. Never writes production TDEE / forecast / v7
 * glycogen transitions.
 */
export const EXPERIMENTAL_STRENGTH_GLYCOGEN_DEMAND_V1_REVISION =
  "experimental-strength-glycogen-demand-v1" as const;

export const EXPERIMENTAL_STRENGTH_GLYCOGEN_DEMAND_V1_PROVENANCE =
  "experimental-heuristic" as const;

/**
 * Relative anatomical recruitment weights for canonical mapping groups.
 * Engineering prior for ordinal/scaled demand — not measured muscle mass.
 */
export const EXPERIMENTAL_MUSCLE_RECRUITMENT_WEIGHT_V1: Readonly<
  Record<CanonicalMuscleGroupV7, number>
> = {
  hip_extensors: 1.0,
  back: 0.95,
  spinal_extensors: 0.7,
  chest: 0.65,
  deltoids: 0.45,
  triceps: 0.35,
  biceps: 0.3,
  forearms: 0.15,
};

/** Indirect mapped sets contribute less than direct (engineering relative prior). */
export const EXPERIMENTAL_INDIRECT_SET_WEIGHT_V1 = 0.35 as const;

/**
 * Reference session ≈ 8 effective direct hard-set units on large musculature.
 * Used only to normalize the relative dose scale.
 */
export const EXPERIMENTAL_REFERENCE_EFFECTIVE_UNITS_V1 = 8 as const;

/**
 * Soft scale ceiling — prevents unbounded extrapolation; not a physiology clamp.
 */
export const EXPERIMENTAL_MAX_DOSE_SCALE_V1 = 2.5 as const;

/**
 * Bounded whole-body glycogen depletion magnitudes (kg) for a reference
 * resistance session. Order-of-magnitude prior from E-F01 local concentration
 * change (~−104 mmol/kg dry mass; ~21% local mean) with unknown recruited
 * active mass / anatomical aggregation — explicit uncertainty, not a personal
 * coefficient. Must not be treated as the −11.2 mmol/kgdm/set ecological slope.
 */
export const EXPERIMENTAL_REFERENCE_SESSION_DEMAND_KG_V1 = {
  pointMagnitudeKg: 0.025,
  /** Less depletion → upper (less negative) delta bound. */
  lowerMagnitudeKg: 0.008,
  /** More depletion → lower (more negative) delta bound. */
  upperMagnitudeKg: 0.07,
  evidenceIds: ["E-F01", "E-F02", "E-F03", "E-F04"] as const,
  scientificNote:
    "Local vastus-lateralis concentration evidence only; whole-body kg is an uncertain heuristic aggregation.",
} as const;

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
  effectiveRecruitmentUnits: number;
  doseScale: number;
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

export function computeExperimentalRecruitmentUnitsV1(
  dose: AvailableQualifiedResistanceTrainingDoseV7,
): { units: number; muscleGroupsUsed: CanonicalMuscleGroupV7[] } {
  let units = 0;
  const muscleGroupsUsed: CanonicalMuscleGroupV7[] = [];
  for (const bucket of dose.muscleGroups) {
    const weight = EXPERIMENTAL_MUSCLE_RECRUITMENT_WEIGHT_V1[bucket.muscleGroup];
    const contribution = (
      bucket.directMappedSetCount
      + EXPERIMENTAL_INDIRECT_SET_WEIGHT_V1 * bucket.indirectMappedSetCount
    ) * weight;
    if (contribution > 0) {
      units += contribution;
      muscleGroupsUsed.push(bucket.muscleGroup);
    }
  }
  return { units, muscleGroupsUsed: muscleGroupsUsed.sort() };
}

function doseScaleFromUnits(units: number): number {
  if (!(units > 0)) return 0;
  return Math.min(
    EXPERIMENTAL_MAX_DOSE_SCALE_V1,
    units / EXPERIMENTAL_REFERENCE_EFFECTIVE_UNITS_V1,
  );
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
  ] as const;
}

function unavailableResult(input: {
  dose: QualifiedResistanceTrainingDoseV7;
  availableGlycogenKg: number | null;
  ignoredActiveEnergyKcal: number | null;
  reason: ExperimentalStrengthGlycogenDemandUnavailableReasonV1;
  reasons: string[];
  effectiveRecruitmentUnits?: number;
  doseScale?: number;
  muscleGroupsUsed?: CanonicalMuscleGroupV7[];
}): ExperimentalStrengthGlycogenDemandResultV1 {
  const dose = input.dose;
  return {
    contractVersion: EXPERIMENTAL_STRENGTH_GLYCOGEN_DEMAND_V1_REVISION,
    provenance: EXPERIMENTAL_STRENGTH_GLYCOGEN_DEMAND_V1_PROVENANCE,
    supportedDomain: "strength-resistance-shadow-only",
    availability: "unavailable",
    estimatedGlycogenDeltaKg: null,
    lowerBoundKg: null,
    upperBoundKg: null,
    unavailableReason: input.reason,
    features: {
      doseFingerprint: qualifiedResistanceTrainingDoseV7Fingerprint(dose),
      doseAvailability: dose.availability,
      qualifiedHardSetCount: dose.qualifiedHardSetCount,
      mappedSetCount: dose.mappedSetCount,
      unresolvedEffortMappedSetCount: dose.unresolvedEffortMappedSetCount,
      effectiveRecruitmentUnits: input.effectiveRecruitmentUnits ?? 0,
      doseScale: input.doseScale ?? 0,
      muscleGroupsUsed: input.muscleGroupsUsed ?? [],
      availableGlycogenKg: input.availableGlycogenKg,
      storeBoundApplied: false,
      ignoredActiveEnergyKcal: input.ignoredActiveEnergyKcal,
      rejectedConversions: rejectedConversions(),
    },
    reasons: input.reasons,
  };
}

/**
 * Experimental heuristic: bounded nonpositive glycogen demand from qualified
 * resistance dose + muscle mapping. Missing dose/mapping ≠ zero demand.
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

  const { units, muscleGroupsUsed } = computeExperimentalRecruitmentUnitsV1(dose);
  const scale = doseScaleFromUnits(units);
  if (!(scale > 0) || muscleGroupsUsed.length === 0) {
    return unavailableResult({
      dose,
      availableGlycogenKg,
      ignoredActiveEnergyKcal,
      reason: "no-qualified-mapped-hard-sets",
      reasons: [
        "recruitment-units-zero",
        "missing-muscle-mapping-contribution-is-not-zero-depletion",
      ],
      effectiveRecruitmentUnits: units,
      doseScale: scale,
      muscleGroupsUsed,
    });
  }

  const rawEstimated = -EXPERIMENTAL_REFERENCE_SESSION_DEMAND_KG_V1.pointMagnitudeKg * scale;
  const rawLower = -EXPERIMENTAL_REFERENCE_SESSION_DEMAND_KG_V1.upperMagnitudeKg * scale;
  const rawUpper = -EXPERIMENTAL_REFERENCE_SESSION_DEMAND_KG_V1.lowerMagnitudeKg * scale;

  const estimatedGlycogenDeltaKg = clampToStore(rawEstimated, availableGlycogenKg);
  const lowerBoundKg = Math.min(
    clampToStore(rawLower, availableGlycogenKg),
    estimatedGlycogenDeltaKg,
  );
  const upperBoundKg = Math.max(
    clampToStore(rawUpper, availableGlycogenKg),
    estimatedGlycogenDeltaKg,
  );
  const storeBoundApplied = availableGlycogenKg !== null;

  const reasons = [
    "experimental-heuristic-bounded-prior",
    "qualified-hard-set-recruitment-scaled",
    "muscle-mapping-weighted",
    "exercise-only-delta-nonpositive",
    ...(storeBoundApplied
      ? ["store-bounded-to-available-glycogen"]
      : ["store-bound-not-applied-glycogen-unavailable"]),
    "kcal-to-glycogen-intentionally-rejected",
    "ecological-mmol-per-set-coefficient-intentionally-rejected",
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
      doseFingerprint: qualifiedResistanceTrainingDoseV7Fingerprint(dose),
      doseAvailability: dose.availability,
      qualifiedHardSetCount: dose.qualifiedHardSetCount,
      mappedSetCount: dose.mappedSetCount,
      unresolvedEffortMappedSetCount: dose.unresolvedEffortMappedSetCount,
      effectiveRecruitmentUnits: units,
      doseScale: scale,
      muscleGroupsUsed,
      availableGlycogenKg,
      storeBoundApplied,
      ignoredActiveEnergyKcal,
      rejectedConversions: rejectedConversions(),
    },
    reasons,
  };
}

export function experimentalStrengthGlycogenDemandV1Fingerprint(
  result: ExperimentalStrengthGlycogenDemandResultV1,
): string {
  return stableSha256(result);
}
