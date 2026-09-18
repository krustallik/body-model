import { stableSha256 } from "@/modules/model-recovery/recovery-fingerprint";

/**
 * Experimental Glycogen-Associated Water V1 (shadow / EXPERIMENTAL only).
 *
 * Converts an experimental glycogen delta into a same-sign water delta for
 * weight-accounting shadows. Uses the audited human literature co-variation
 * range (≈3–4 kg water / kg glycogen). Rejects the legacy fixed 2.7 Hall
 * coefficient as this contract's sole ratio, ECF substitution, transient
 * exercise-water mixing, and scale-weight residual fitting.
 *
 * Not production TDEE / forecast / validated v7 glycogen-water semantics.
 */
export const EXPERIMENTAL_GLYCOGEN_ASSOCIATED_WATER_V1_REVISION =
  "experimental-glycogen-associated-water-v1" as const;

export const EXPERIMENTAL_GLYCOGEN_ASSOCIATED_WATER_V1_PROVENANCE =
  "experimental-heuristic" as const;

/**
 * Scientific literature co-variation range (kg water / kg glycogen).
 *
 * E-I01 Olsson & Saltin (1970): ≈3–4 g water / g glycogen from TBW + biopsy.
 * E-I04 Fernández-Elías et al. (2015): ~3:1 under restricted rehydration;
 *   higher ratios include non-associated water and must not inflate this
 *   associated-water contract.
 * E-I05 Shiose et al. (2023): human water rises ≈3–4-fold with glycogen;
 *   direct molecular binding was not measured.
 * E-I07 Chan et al. (1982): glycogen-obligated water framing.
 *
 * Legacy Hall/NIDDK 2.7 is intentionally not the sole experimental ratio
 * (engineering model coefficient elsewhere; not independently selected here).
 */
export const SCIENTIFIC_GLYCOGEN_ASSOCIATED_WATER_RATIO_KG_PER_KG_V1 = {
  lowerKgPerKg: 3,
  /** Midpoint of the scientific 3–4 range — not a validated personal constant. */
  pointKgPerKg: 3.5,
  upperKgPerKg: 4,
  rangeClassification: "scientific-literature-range" as const,
  pointClassification: "engineering-midpoint-of-scientific-range" as const,
  evidenceIds: ["E-I01", "E-I04", "E-I05", "E-I07"] as const,
  rejectedLegacyFixedRatioKgPerKg: 2.7,
  scientificNote:
    "3–4 kg/kg is the audited human co-variation prior; it is not a molecular constant, personal clamp, or hard GREEN bound. Point 3.5 is the engineering midpoint of that scientific range.",
} as const;

export type ExperimentalGlycogenAssociatedWaterAvailabilityV1 =
  | "available"
  | "unavailable";

export type ExperimentalGlycogenAssociatedWaterUnavailableReasonV1 =
  | "missing-glycogen-delta"
  | "non-finite-inputs";

export type ExperimentalGlycogenAssociatedWaterFeaturesV1 = {
  glycogenDeltaKg: number | null;
  glycogenDeltaLowerKg: number | null;
  glycogenDeltaUpperKg: number | null;
  currentGlycogenWaterKg: number | null;
  ratioLowerKgPerKg: number;
  ratioPointKgPerKg: number;
  ratioUpperKgPerKg: number;
  storeFloorApplied: boolean;
  rejectedLegacyFixedRatioKgPerKg: 2.7;
  rejectedConversions: readonly [
    "legacy-fixed-2.7-sole-ratio",
    "scale-weight-residual",
    "ecf-substitution",
    "transient-exercise-water-mixing",
    "hard-personal-ratio-clamp",
  ];
};

export type ExperimentalGlycogenAssociatedWaterResultV1 = {
  contractVersion: typeof EXPERIMENTAL_GLYCOGEN_ASSOCIATED_WATER_V1_REVISION;
  provenance: typeof EXPERIMENTAL_GLYCOGEN_ASSOCIATED_WATER_V1_PROVENANCE;
  supportedDomain: "glycogen-associated-water-shadow-only";
  availability: ExperimentalGlycogenAssociatedWaterAvailabilityV1;
  /** Water delta (kg). Same sign as glycogen delta when available. */
  estimatedGlycogenWaterDeltaKg: number | null;
  lowerBoundKg: number | null;
  upperBoundKg: number | null;
  unavailableReason: ExperimentalGlycogenAssociatedWaterUnavailableReasonV1 | null;
  features: ExperimentalGlycogenAssociatedWaterFeaturesV1;
  reasons: string[];
  compartmentSeparation: {
    glycogenAssociatedWater: "separate-compartment";
    ecfDeviation: "not-a-fallback-or-residual";
    transientExerciseWater: "not-mixed";
  };
};

function assertFiniteNonnegativeOptional(name: string, value: number | null): void {
  if (value === null) return;
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be finite and nonnegative when provided`);
  }
}

function rejectedConversions(): ExperimentalGlycogenAssociatedWaterFeaturesV1["rejectedConversions"] {
  return [
    "legacy-fixed-2.7-sole-ratio",
    "scale-weight-residual",
    "ecf-substitution",
    "transient-exercise-water-mixing",
    "hard-personal-ratio-clamp",
  ] as const;
}

function applyStoreFloor(
  deltaKg: number,
  currentGlycogenWaterKg: number | null,
): { deltaKg: number; applied: boolean } {
  if (currentGlycogenWaterKg === null || !(deltaKg < 0)) {
    return { deltaKg, applied: false };
  }
  const floored = Math.max(deltaKg, -currentGlycogenWaterKg);
  return {
    deltaKg: Object.is(floored, -0) ? 0 : floored,
    applied: floored !== deltaKg,
  };
}

/**
 * ΔW = r · ΔG with scientific ratio band [3, 4] and point 3.5.
 * Bounds are ordered so lowerBoundKg ≤ point ≤ upperBoundKg for either sign of ΔG.
 */
export function estimateExperimentalGlycogenAssociatedWaterV1(input: {
  glycogenDeltaKg: number | null;
  /** Optional glycogen uncertainty envelope (same units kg). */
  glycogenDeltaLowerKg?: number | null;
  glycogenDeltaUpperKg?: number | null;
  /** When known, depletion water cannot drive glycogenWaterKg below 0. */
  currentGlycogenWaterKg?: number | null;
}): ExperimentalGlycogenAssociatedWaterResultV1 {
  const glycogenDeltaKg = input.glycogenDeltaKg;
  const glycogenDeltaLowerKg = input.glycogenDeltaLowerKg === undefined
    ? null
    : input.glycogenDeltaLowerKg;
  const glycogenDeltaUpperKg = input.glycogenDeltaUpperKg === undefined
    ? null
    : input.glycogenDeltaUpperKg;
  const currentGlycogenWaterKg = input.currentGlycogenWaterKg === undefined
    ? null
    : input.currentGlycogenWaterKg;

  const ratio = SCIENTIFIC_GLYCOGEN_ASSOCIATED_WATER_RATIO_KG_PER_KG_V1;
  const baseFeatures: ExperimentalGlycogenAssociatedWaterFeaturesV1 = {
    glycogenDeltaKg,
    glycogenDeltaLowerKg,
    glycogenDeltaUpperKg,
    currentGlycogenWaterKg,
    ratioLowerKgPerKg: ratio.lowerKgPerKg,
    ratioPointKgPerKg: ratio.pointKgPerKg,
    ratioUpperKgPerKg: ratio.upperKgPerKg,
    storeFloorApplied: false,
    rejectedLegacyFixedRatioKgPerKg: 2.7,
    rejectedConversions: rejectedConversions(),
  };

  if (glycogenDeltaKg === null) {
    return {
      contractVersion: EXPERIMENTAL_GLYCOGEN_ASSOCIATED_WATER_V1_REVISION,
      provenance: EXPERIMENTAL_GLYCOGEN_ASSOCIATED_WATER_V1_PROVENANCE,
      supportedDomain: "glycogen-associated-water-shadow-only",
      availability: "unavailable",
      estimatedGlycogenWaterDeltaKg: null,
      lowerBoundKg: null,
      upperBoundKg: null,
      unavailableReason: "missing-glycogen-delta",
      features: baseFeatures,
      reasons: [
        "missing-glycogen-delta-is-not-zero-water",
        "missing-evidence-is-not-zero-glycogen-water-delta",
      ],
      compartmentSeparation: {
        glycogenAssociatedWater: "separate-compartment",
        ecfDeviation: "not-a-fallback-or-residual",
        transientExerciseWater: "not-mixed",
      },
    };
  }

  if (!Number.isFinite(glycogenDeltaKg)) {
    throw new RangeError("glycogenDeltaKg must be finite when provided");
  }
  if (glycogenDeltaLowerKg !== null && !Number.isFinite(glycogenDeltaLowerKg)) {
    throw new RangeError("glycogenDeltaLowerKg must be finite when provided");
  }
  if (glycogenDeltaUpperKg !== null && !Number.isFinite(glycogenDeltaUpperKg)) {
    throw new RangeError("glycogenDeltaUpperKg must be finite when provided");
  }
  assertFiniteNonnegativeOptional("currentGlycogenWaterKg", currentGlycogenWaterKg);

  const gLower = glycogenDeltaLowerKg ?? glycogenDeltaKg;
  const gUpper = glycogenDeltaUpperKg ?? glycogenDeltaKg;
  const glycogenCandidates = [gLower, glycogenDeltaKg, gUpper];
  const ratioCandidates = [ratio.lowerKgPerKg, ratio.pointKgPerKg, ratio.upperKgPerKg];

  const waterCandidates: number[] = [];
  for (const g of glycogenCandidates) {
    for (const r of ratioCandidates) {
      waterCandidates.push(r * g);
    }
  }

  let point = ratio.pointKgPerKg * glycogenDeltaKg;
  let lower = Math.min(...waterCandidates);
  let upper = Math.max(...waterCandidates);

  const pointFloor = applyStoreFloor(point, currentGlycogenWaterKg);
  const lowerFloor = applyStoreFloor(lower, currentGlycogenWaterKg);
  const upperFloor = applyStoreFloor(upper, currentGlycogenWaterKg);
  point = pointFloor.deltaKg;
  lower = lowerFloor.deltaKg;
  upper = upperFloor.deltaKg;
  const storeFloorApplied = pointFloor.applied || lowerFloor.applied || upperFloor.applied;

  // Re-order after floor so lower ≤ point ≤ upper still holds.
  const orderedLower = Math.min(lower, point, upper);
  const orderedUpper = Math.max(lower, point, upper);
  const orderedPoint = Math.min(Math.max(point, orderedLower), orderedUpper);

  if (glycogenDeltaKg !== 0 && Math.sign(orderedPoint) !== Math.sign(glycogenDeltaKg)
      && orderedPoint !== 0) {
    throw new Error("glycogen-associated water delta must follow glycogen sign");
  }

  return {
    contractVersion: EXPERIMENTAL_GLYCOGEN_ASSOCIATED_WATER_V1_REVISION,
    provenance: EXPERIMENTAL_GLYCOGEN_ASSOCIATED_WATER_V1_PROVENANCE,
    supportedDomain: "glycogen-associated-water-shadow-only",
    availability: "available",
    estimatedGlycogenWaterDeltaKg: orderedPoint,
    lowerBoundKg: orderedLower,
    upperBoundKg: orderedUpper,
    unavailableReason: null,
    features: {
      ...baseFeatures,
      storeFloorApplied,
    },
    reasons: [
      "experimental-heuristic-glycogen-associated-water-ratio-band",
      "water-delta-follows-glycogen-sign",
      "scientific-literature-ratio-range-3-to-4",
      "legacy-fixed-2.7-sole-ratio-intentionally-rejected",
      "ecf-substitution-intentionally-rejected",
      "transient-exercise-water-mixing-intentionally-rejected",
      "scale-weight-residual-intentionally-rejected",
      ...(storeFloorApplied
        ? ["glycogen-water-store-floor-applied"]
        : ["glycogen-water-store-floor-not-required"]),
    ],
    compartmentSeparation: {
      glycogenAssociatedWater: "separate-compartment",
      ecfDeviation: "not-a-fallback-or-residual",
      transientExerciseWater: "not-mixed",
    },
  };
}

export function experimentalGlycogenAssociatedWaterV1Fingerprint(
  result: ExperimentalGlycogenAssociatedWaterResultV1,
): string {
  return stableSha256(result);
}
