import {
  GLYCOGEN_ADULT_CAPACITY_CLAMP_POLICY_V7,
  GLYCOGEN_ADULT_CAPACITY_RANGE_METADATA_V7,
  GLYCOGEN_CARBOHYDRATE_TIMING_POLICY_V7,
  GLYCOGEN_PROTEIN_BONUS_POLICY_V7,
  rejectAdultGlycogenCapacityAsPersonalCapacityV7,
  rejectAdultGlycogenCapacityClampV7,
  type GlycogenAdultCapacityClampPolicyV7,
  type GlycogenCarbohydrateTimingPolicyV7,
  type GlycogenProteinBonusPolicyV7,
} from "@/model/physiology-v7/glycogen-transition-v7";
import { stableSha256 } from "@/modules/model-recovery/recovery-fingerprint";

/**
 * Experimental Glycogen Repletion V1 (shadow / EXPERIMENTAL only).
 *
 * Daily carbohydrate → bounded nonnegative glycogen repletion demand.
 * Enforces store headroom only when a defensible headroom is supplied
 * (e.g. today's exercise-depletion refill opportunity). Never invents a
 * personal capacity from the adult literature range (C-I05 / C-H02).
 */
export const EXPERIMENTAL_GLYCOGEN_REPLETION_V1_REVISION =
  "experimental-glycogen-repletion-v1" as const;

export const EXPERIMENTAL_GLYCOGEN_REPLETION_V1_PROVENANCE =
  "experimental-heuristic" as const;

/**
 * ENGINEERING PRIOR — saturating scale τ for daily carbohydrate (g).
 * Softens high-carb diminishing returns; not a personal synthesis rate.
 */
export const ENGINEERING_CARB_REPLETION_SCALE_TAU_G_V1 = 200 as const;

/**
 * ENGINEERING PRIOR — daily repletion demand envelope (kg glycogen) for a
 * saturated high-carb recovery day. Wide OOM band; not personal capacity.
 *
 * Scientific motivation for nonnegative carb-responsive repletion: E-H01,
 * E-H02, E-H05. Endpoints remain engineering.
 */
export const EXPERIMENTAL_REPLETION_ENVELOPE_KG_V1 = {
  pointMagnitudeKg: 0.05,
  lowerMagnitudeKg: 0.01,
  upperMagnitudeKg: 0.15,
  evidenceIds: ["E-H01", "E-H02", "E-H05"] as const,
  pointClassification: "engineering-midpoint" as const,
  boundClassification: "engineering-order-of-magnitude-band" as const,
  scientificNote:
    "Carb-responsive repletion is evidence-backed; whole-body daily kg endpoints are engineering priors under unknown personal capacity.",
} as const;

export type ExperimentalGlycogenRepletionAvailabilityV1 =
  | "available"
  | "unavailable";

export type ExperimentalGlycogenRepletionUnavailableReasonV1 =
  | "missing-carbohydrate"
  | "non-finite-inputs";

export type ExperimentalGlycogenRepletionFeaturesV1 = {
  carbsG: number | null;
  proteinG: number | null;
  currentGlycogenKg: number | null;
  storeHeadroomKg: number | null;
  headroomSource: "exercise-depletion-refill" | "explicit" | "unavailable";
  carbScale: number;
  storeBoundApplied: boolean;
  literatureCapacityClampRejected: true;
  ignoredProteinG: number | null;
  ignoredActiveEnergyKcal: number | null;
  rejectedConversions: readonly [
    "protein-glycogen-bonus",
    "meal-frequency-timing-math",
    "kcal-to-glycogen",
    "scale-weight-residual",
    "adult-literature-personal-capacity-clamp",
  ];
};

export type ExperimentalGlycogenRepletionResultV1 = {
  contractVersion: typeof EXPERIMENTAL_GLYCOGEN_REPLETION_V1_REVISION;
  provenance: typeof EXPERIMENTAL_GLYCOGEN_REPLETION_V1_PROVENANCE;
  supportedDomain: "daily-carb-repletion-shadow-only";
  availability: ExperimentalGlycogenRepletionAvailabilityV1;
  /** Repletion delta (kg). Always ≥ 0 when available. */
  estimatedGlycogenDeltaKg: number | null;
  lowerBoundKg: number | null;
  upperBoundKg: number | null;
  unavailableReason: ExperimentalGlycogenRepletionUnavailableReasonV1 | null;
  features: ExperimentalGlycogenRepletionFeaturesV1;
  reasons: string[];
  carbohydrateTimingPolicy: GlycogenCarbohydrateTimingPolicyV7;
  proteinBonusPolicy: GlycogenProteinBonusPolicyV7;
  adultCapacityClampPolicy: GlycogenAdultCapacityClampPolicyV7;
};

function clampNonnegativeFinite(value: number): number {
  if (!Number.isFinite(value)) {
    throw new RangeError("glycogen repletion values must be finite");
  }
  const clamped = Math.max(0, value);
  return Object.is(clamped, -0) ? 0 : clamped;
}

function rejectedConversions(): ExperimentalGlycogenRepletionFeaturesV1["rejectedConversions"] {
  return [
    "protein-glycogen-bonus",
    "meal-frequency-timing-math",
    "kcal-to-glycogen",
    "scale-weight-residual",
    "adult-literature-personal-capacity-clamp",
  ] as const;
}

/** Saturating ENGINEERING carb scale in [0, 1). */
export function engineeringCarbRepletionScaleV1(carbsG: number): number {
  if (!(carbsG > 0)) return 0;
  return 1 - Math.exp(-carbsG / ENGINEERING_CARB_REPLETION_SCALE_TAU_G_V1);
}

/**
 * Defensible refill headroom from today's exercise-only depletion deltas
 * (strength/stepper shadows). Does not invent personal capacity.
 */
export function storeHeadroomFromExerciseDepletionKgV1(
  depletionDeltasKg: readonly (number | null | undefined)[],
): number | null {
  let totalDepletion = 0;
  let saw = false;
  for (const delta of depletionDeltasKg) {
    if (delta === null || delta === undefined) continue;
    if (!Number.isFinite(delta)) {
      throw new RangeError("depletion deltas must be finite when provided");
    }
    if (delta > 0) {
      throw new RangeError("exercise depletion deltas must be ≤ 0");
    }
    totalDepletion += delta;
    saw = true;
  }
  if (!saw) return null;
  return clampNonnegativeFinite(-totalDepletion);
}

function clampToHeadroom(deltaKg: number, headroomKg: number | null): number {
  if (headroomKg === null) return deltaKg;
  return Math.min(deltaKg, headroomKg);
}

/**
 * Estimate daily carbohydrate-driven glycogen repletion (kg, ≥ 0).
 * Missing carbs ≠ 0. Literature capacity never becomes a personal clamp.
 */
export function estimateExperimentalGlycogenRepletionV1(input: {
  carbsG: number | null;
  /** Context only — never a glycogen bonus (C-H05). */
  proteinG?: number | null;
  currentGlycogenKg?: number | null;
  /**
   * Defensible store headroom (kg). Prefer exercise-depletion refill.
   * Null → emit demand without fabricating a capacity clamp.
   */
  storeHeadroomKg?: number | null;
  headroomSource?: ExperimentalGlycogenRepletionFeaturesV1["headroomSource"];
  /** Explicitly ignored — never kcal→glycogen. */
  activeEnergyKcal?: number | null;
}): ExperimentalGlycogenRepletionResultV1 {
  const carbsG = input.carbsG;
  const proteinG = input.proteinG === undefined ? null : input.proteinG;
  const currentGlycogenKg = input.currentGlycogenKg === undefined
    ? null
    : input.currentGlycogenKg;
  const storeHeadroomKg = input.storeHeadroomKg === undefined
    ? null
    : input.storeHeadroomKg;
  const ignoredActiveEnergyKcal = input.activeEnergyKcal === undefined
    ? null
    : input.activeEnergyKcal;
  const headroomSource = input.headroomSource
    ?? (storeHeadroomKg === null ? "unavailable" : "explicit");

  // Prove literature range never mutates glycogen state / never becomes capacity.
  rejectAdultGlycogenCapacityAsPersonalCapacityV7();
  const capacityRejection = rejectAdultGlycogenCapacityClampV7({
    glycogenKg: currentGlycogenKg,
  });
  if (capacityRejection.resultingGlycogenKg !== currentGlycogenKg) {
    throw new Error("experimental repletion must not mutate glycogen via adult capacity");
  }

  if (carbsG !== null && (!Number.isFinite(carbsG) || carbsG < 0)) {
    throw new RangeError("carbsG must be finite and nonnegative when provided");
  }
  if (proteinG !== null && (!Number.isFinite(proteinG) || proteinG < 0)) {
    throw new RangeError("proteinG must be finite and nonnegative when provided");
  }
  if (currentGlycogenKg !== null
      && (!Number.isFinite(currentGlycogenKg) || currentGlycogenKg < 0)) {
    throw new RangeError("currentGlycogenKg must be finite and nonnegative when provided");
  }
  if (storeHeadroomKg !== null
      && (!Number.isFinite(storeHeadroomKg) || storeHeadroomKg < 0)) {
    throw new RangeError("storeHeadroomKg must be finite and nonnegative when provided");
  }
  if (ignoredActiveEnergyKcal !== null && !Number.isFinite(ignoredActiveEnergyKcal)) {
    throw new RangeError("activeEnergyKcal must be finite when provided");
  }

  const baseFeatures: ExperimentalGlycogenRepletionFeaturesV1 = {
    carbsG,
    proteinG,
    currentGlycogenKg,
    storeHeadroomKg,
    headroomSource,
    carbScale: 0,
    storeBoundApplied: false,
    literatureCapacityClampRejected: true,
    ignoredProteinG: proteinG,
    ignoredActiveEnergyKcal,
    rejectedConversions: rejectedConversions(),
  };

  if (carbsG === null) {
    return {
      contractVersion: EXPERIMENTAL_GLYCOGEN_REPLETION_V1_REVISION,
      provenance: EXPERIMENTAL_GLYCOGEN_REPLETION_V1_PROVENANCE,
      supportedDomain: "daily-carb-repletion-shadow-only",
      availability: "unavailable",
      estimatedGlycogenDeltaKg: null,
      lowerBoundKg: null,
      upperBoundKg: null,
      unavailableReason: "missing-carbohydrate",
      features: baseFeatures,
      reasons: [
        "missing-carbohydrate-is-not-zero-repletion",
        "missing-evidence-is-not-zero-glycogen-delta",
      ],
      carbohydrateTimingPolicy: GLYCOGEN_CARBOHYDRATE_TIMING_POLICY_V7,
      proteinBonusPolicy: GLYCOGEN_PROTEIN_BONUS_POLICY_V7,
      adultCapacityClampPolicy: GLYCOGEN_ADULT_CAPACITY_CLAMP_POLICY_V7,
    };
  }

  const carbScale = engineeringCarbRepletionScaleV1(carbsG);
  const ref = EXPERIMENTAL_REPLETION_ENVELOPE_KG_V1;
  let point = clampNonnegativeFinite(ref.pointMagnitudeKg * carbScale);
  let lower = clampNonnegativeFinite(ref.lowerMagnitudeKg * carbScale);
  let upper = clampNonnegativeFinite(ref.upperMagnitudeKg * carbScale);

  const storeBoundApplied = storeHeadroomKg !== null;
  if (storeBoundApplied) {
    point = clampToHeadroom(point, storeHeadroomKg);
    lower = clampToHeadroom(lower, storeHeadroomKg);
    upper = clampToHeadroom(upper, storeHeadroomKg);
  }

  const orderedLower = Math.min(lower, point);
  const orderedUpper = Math.max(upper, point);

  return {
    contractVersion: EXPERIMENTAL_GLYCOGEN_REPLETION_V1_REVISION,
    provenance: EXPERIMENTAL_GLYCOGEN_REPLETION_V1_PROVENANCE,
    supportedDomain: "daily-carb-repletion-shadow-only",
    availability: "available",
    estimatedGlycogenDeltaKg: point,
    lowerBoundKg: orderedLower,
    upperBoundKg: orderedUpper,
    unavailableReason: null,
    features: {
      ...baseFeatures,
      carbScale,
      storeBoundApplied,
    },
    reasons: [
      "experimental-heuristic-carb-saturating-repletion",
      "repletion-delta-nonnegative",
      "daily-totals-only-no-meal-timing-math",
      "protein-bonus-intentionally-rejected",
      "kcal-to-glycogen-intentionally-rejected",
      "adult-literature-personal-capacity-clamp-intentionally-rejected",
      `adult-literature-range-metadata-only-${GLYCOGEN_ADULT_CAPACITY_RANGE_METADATA_V7.literatureRangeKg.lowerKg}-${GLYCOGEN_ADULT_CAPACITY_RANGE_METADATA_V7.literatureRangeKg.upperKg}-kg`,
      ...(storeBoundApplied
        ? ["store-headroom-bound-applied-defensible-headroom"]
        : ["no-defensible-headroom-demand-emitted-without-fake-capacity-clamp"]),
      ...(headroomSource === "exercise-depletion-refill"
        ? ["headroom-from-exercise-depletion-refill-opportunity"]
        : headroomSource === "explicit"
          ? ["headroom-explicitly-provided"]
          : ["headroom-unavailable"]),
    ],
    carbohydrateTimingPolicy: GLYCOGEN_CARBOHYDRATE_TIMING_POLICY_V7,
    proteinBonusPolicy: GLYCOGEN_PROTEIN_BONUS_POLICY_V7,
    adultCapacityClampPolicy: GLYCOGEN_ADULT_CAPACITY_CLAMP_POLICY_V7,
  };
}

export function experimentalGlycogenRepletionV1Fingerprint(
  result: ExperimentalGlycogenRepletionResultV1,
): string {
  return stableSha256(result);
}
