import {
  estimateExperimentalGlycogenAssociatedWaterV1,
  type ExperimentalGlycogenAssociatedWaterResultV1,
} from "@/model/physiology-v7/experimental-glycogen-associated-water-v1";
import {
  estimateExperimentalGlycogenRepletionV1,
  type ExperimentalGlycogenRepletionResultV1,
} from "@/model/physiology-v7/experimental-glycogen-repletion-v1";
import {
  GLYCOGEN_ADULT_CAPACITY_CLAMP_POLICY_V7,
  GLYCOGEN_ADULT_CAPACITY_RANGE_METADATA_V7,
  rejectAdultGlycogenCapacityAsPersonalCapacityV7,
  rejectAdultGlycogenCapacityClampV7,
  type GlycogenAdultCapacityClampPolicyV7,
} from "@/model/physiology-v7/glycogen-transition-v7";
import { stableSha256 } from "@/modules/model-recovery/recovery-fingerprint";

/**
 * Experimental Glycogen State V1 (shadow / EXPERIMENTAL only).
 *
 * Exercise-induced relative depletion-debt trajectory:
 * - baseline/reference = 0 relative debt (not an absolute kg store);
 * - exercise moves state negative;
 * - repletion moves it back toward 0;
 * - without defensible personal capacity, state never goes positive
 *   (no invented supercompensation / no 0.5 kg absolute store).
 *
 * Absolute personal glycogen mass remains unavailable. Adult literature
 * capacity is never a clamp. Water derives from the net relative change.
 *
 * Not production TDEE / forecast / validated v7 semantics.
 */
export const EXPERIMENTAL_GLYCOGEN_STATE_V1_REVISION =
  "experimental-glycogen-state-v1" as const;

export const EXPERIMENTAL_GLYCOGEN_STATE_V1_PROVENANCE =
  "experimental-heuristic" as const;

/**
 * Relative baseline = zero exercise-induced depletion debt.
 * Explicitly NOT an absolute glycogen mass and NOT personal capacity.
 */
export const EXPERIMENTAL_GLYCOGEN_RELATIVE_BASELINE_V1 = {
  relativeDeviationKg: 0,
  meaning: "zero-exercise-induced-depletion-debt",
  classification: "relative-depletion-debt-baseline" as const,
  absoluteStore: "unavailable" as const,
  personalCapacity: false,
  literatureClamp: false,
  scientificNote:
    "State is a relative depletion debt around 0. Absolute glycogen kg and personal capacity remain unavailable; adult 0.3–0.86 kg is metadata only.",
  evidenceIds: ["E-I06"] as const,
} as const;

export type ExperimentalGlycogenStateAvailabilityV1 = "available" | "unavailable";

export type ExperimentalGlycogenStateV1 = {
  availability: ExperimentalGlycogenStateAvailabilityV1;
  /**
   * Relative depletion debt (kg glycogen-equivalent).
   * 0 = no debt; negative = depleted vs relative baseline.
   * Never positive without a defensible personal capacity (which is not invented).
   */
  relativeDeviationKg: number | null;
  relativeDeviationLowerKg: number | null;
  relativeDeviationUpperKg: number | null;
  /**
   * Absolute personal glycogen mass — intentionally unavailable.
   * Never fabricated from a 0.5 kg engineering store or literature range.
   */
  absoluteGlycogenKg: null;
  absoluteGlycogenLowerKg: null;
  absoluteGlycogenUpperKg: null;
  /** Always null — personal capacity is intentionally not invented. */
  personalCapacityKg: null;
  uncertainty: "experimental-relative-depletion-debt";
};

export type ExperimentalGlycogenExerciseCoverageV1 =
  | "applied-from-exercise-shadows"
  | "observed-rest-zero-depletion"
  | "unresolved-missing-workout-feed";

export type ExperimentalGlycogenRepletionCoverageV1 =
  | "applied"
  | "skipped-missing-carbohydrate"
  | "skipped-unavailable-repletion";

export type ExperimentalGlycogenStateTransitionResultV1 = {
  contractVersion: typeof EXPERIMENTAL_GLYCOGEN_STATE_V1_REVISION;
  provenance: typeof EXPERIMENTAL_GLYCOGEN_STATE_V1_PROVENANCE;
  supportedDomain: "multi-day-relative-glycogen-depletion-debt-shadow-only";
  state: ExperimentalGlycogenStateV1;
  priorState: ExperimentalGlycogenStateV1;
  /** Net relative glycogen change this day (same units as relativeDeviationKg). */
  netGlycogenDeltaKg: number | null;
  netGlycogenDeltaLowerKg: number | null;
  netGlycogenDeltaUpperKg: number | null;
  depletionDeltaKg: number | null;
  repletionDeltaKg: number | null;
  exerciseCoverage: ExperimentalGlycogenExerciseCoverageV1;
  repletionCoverage: ExperimentalGlycogenRepletionCoverageV1;
  /** True when repletion was capped so relative state does not go above 0. */
  debtCeilingApplied: boolean;
  literatureCapacityClampRejected: true;
  absoluteStoreFabricationRejected: true;
  glycogenAssociatedWater: ExperimentalGlycogenAssociatedWaterResultV1 | null;
  repletionEstimate: ExperimentalGlycogenRepletionResultV1 | null;
  adultCapacityClampPolicy: GlycogenAdultCapacityClampPolicyV7;
  compartmentSeparation: {
    glycogenAssociatedWater: "derived-from-net-relative-glycogen-delta";
    ecfDeviation: "not-a-fallback-or-residual";
    transientExerciseWater: "not-mixed";
  };
  features: {
    carbsG: number | null;
    workoutFeedObserved: boolean | null;
    relativeBaselineDebtKg: 0;
    debtHeadroomKg: number | null;
    rejectedConversions: readonly [
      "scale-weight-residual",
      "adult-literature-personal-capacity-clamp",
      "invented-personal-capacity",
      "invented-absolute-0.5kg-store",
      "positive-supercompensation-without-capacity",
      "ecf-substitution",
      "transient-exercise-water-mixing",
      "independent-water-fit",
    ];
  };
  reasons: string[];
  fingerprint: string;
};

function rejectedConversions(): ExperimentalGlycogenStateTransitionResultV1["features"]["rejectedConversions"] {
  return [
    "scale-weight-residual",
    "adult-literature-personal-capacity-clamp",
    "invented-personal-capacity",
    "invented-absolute-0.5kg-store",
    "positive-supercompensation-without-capacity",
    "ecf-substitution",
    "transient-exercise-water-mixing",
    "independent-water-fit",
  ] as const;
}

function finiteOrThrow(name: string, value: number): number {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite`);
  return Object.is(value, -0) ? 0 : value;
}

/**
 * Clamp relative debt to (-∞, 0]: no positive supercompensation without capacity.
 * Does not invent an absolute physical store floor.
 */
function clampRelativeDebt(relativeKg: number): {
  relativeKg: number;
  debtCeilingApplied: boolean;
} {
  const value = finiteOrThrow("relativeDeviationKg", relativeKg);
  if (value > 0) {
    return { relativeKg: 0, debtCeilingApplied: true };
  }
  return { relativeKg: value, debtCeilingApplied: false };
}

function packRelativeState(
  relativePoint: number,
  relativeLower: number,
  relativeUpper: number,
): { state: ExperimentalGlycogenStateV1; debtCeilingApplied: boolean } {
  const point = clampRelativeDebt(relativePoint);
  const lower = clampRelativeDebt(relativeLower);
  const upper = clampRelativeDebt(relativeUpper);
  const relatives = [point.relativeKg, lower.relativeKg, upper.relativeKg];
  return {
    debtCeilingApplied: point.debtCeilingApplied || lower.debtCeilingApplied || upper.debtCeilingApplied,
    state: {
      availability: "available",
      relativeDeviationKg: point.relativeKg,
      relativeDeviationLowerKg: Math.min(...relatives),
      relativeDeviationUpperKg: Math.max(...relatives),
      absoluteGlycogenKg: null,
      absoluteGlycogenLowerKg: null,
      absoluteGlycogenUpperKg: null,
      personalCapacityKg: null,
      uncertainty: "experimental-relative-depletion-debt",
    },
  };
}

/** Relative-zero depletion debt — no absolute glycogen mass. */
export function initialExperimentalGlycogenStateV1(): ExperimentalGlycogenStateV1 {
  return {
    availability: "available",
    relativeDeviationKg: 0,
    relativeDeviationLowerKg: 0,
    relativeDeviationUpperKg: 0,
    absoluteGlycogenKg: null,
    absoluteGlycogenLowerKg: null,
    absoluteGlycogenUpperKg: null,
    personalCapacityKg: null,
    uncertainty: "experimental-relative-depletion-debt",
  };
}

/**
 * One-day experimental glycogen depletion-debt transition.
 *
 * Order: carry prior → apply exercise depletion → apply carb repletion
 * (capped by remaining debt to 0) → derive associated water from net relative Δ.
 */
export function transitionExperimentalGlycogenStateV1(input: {
  prior: ExperimentalGlycogenStateV1;
  /**
   * Sum of available strength/stepper glycogen deltas (≤ 0).
   * Null means unresolved — never treated as rest/zero.
   */
  exerciseDepletionKg: number | null;
  exerciseDepletionLowerKg?: number | null;
  exerciseDepletionUpperKg?: number | null;
  /** true = feed observed (sessions or confirmed none); false/null ≠ rest. */
  workoutFeedObserved: boolean | null;
  carbsG: number | null;
  proteinG?: number | null;
  activeEnergyKcal?: number | null;
}): ExperimentalGlycogenStateTransitionResultV1 {
  rejectAdultGlycogenCapacityAsPersonalCapacityV7();
  // Absolute store is unavailable — capacity reject must not invent one.
  const capacityRejection = rejectAdultGlycogenCapacityClampV7({
    glycogenKg: null,
  });
  if (capacityRejection.resultingGlycogenKg !== null) {
    throw new Error("experimental glycogen state must not invent absolute glycogen via adult capacity");
  }

  const reasons: string[] = [
    "experimental-heuristic-relative-depletion-debt",
    "deterministic-depletion-then-repletion-order",
    "relative-baseline-is-zero-debt-not-absolute-store",
    "absolute-glycogen-store-intentionally-unavailable",
    "adult-literature-personal-capacity-clamp-intentionally-rejected",
    `adult-literature-range-metadata-only-${GLYCOGEN_ADULT_CAPACITY_RANGE_METADATA_V7.literatureRangeKg.lowerKg}-${GLYCOGEN_ADULT_CAPACITY_RANGE_METADATA_V7.literatureRangeKg.upperKg}-kg`,
    "scale-weight-residual-intentionally-rejected",
    "positive-supercompensation-without-capacity-intentionally-rejected",
  ];

  const prior = input.prior.availability === "available"
    && input.prior.relativeDeviationKg !== null
    ? input.prior
    : initialExperimentalGlycogenStateV1();

  if (input.prior.availability !== "available" || input.prior.relativeDeviationKg === null) {
    reasons.push("prior-unavailable-initialized-at-zero-relative-debt");
  }

  const priorRel = prior.relativeDeviationKg!;
  const priorRelLower = prior.relativeDeviationLowerKg ?? priorRel;
  const priorRelUpper = prior.relativeDeviationUpperKg ?? priorRel;

  let exerciseCoverage: ExperimentalGlycogenExerciseCoverageV1;
  let depletionPoint = 0;
  let depletionLower = 0;
  let depletionUpper = 0;

  if (input.exerciseDepletionKg !== null) {
    if (!Number.isFinite(input.exerciseDepletionKg) || input.exerciseDepletionKg > 0) {
      throw new RangeError("exerciseDepletionKg must be finite and ≤ 0 when provided");
    }
    depletionPoint = input.exerciseDepletionKg;
    depletionLower = input.exerciseDepletionLowerKg === undefined || input.exerciseDepletionLowerKg === null
      ? depletionPoint
      : input.exerciseDepletionLowerKg;
    depletionUpper = input.exerciseDepletionUpperKg === undefined || input.exerciseDepletionUpperKg === null
      ? depletionPoint
      : input.exerciseDepletionUpperKg;
    if (depletionLower > 0 || depletionUpper > 0) {
      throw new RangeError("exercise depletion bounds must be ≤ 0");
    }
    exerciseCoverage = "applied-from-exercise-shadows";
    reasons.push("exercise-depletion-applied");
  } else if (input.workoutFeedObserved === true) {
    exerciseCoverage = "observed-rest-zero-depletion";
    reasons.push("observed-workout-feed-rest-zero-depletion");
  } else {
    exerciseCoverage = "unresolved-missing-workout-feed";
    reasons.push("missing-workout-feed-is-not-rest");
    reasons.push("unresolved-exercise-depletion-not-applied-as-zero");
  }

  const afterDep = packRelativeState(
    priorRel + depletionPoint,
    priorRelLower + Math.min(depletionLower, depletionUpper, depletionPoint),
    priorRelUpper + Math.max(depletionLower, depletionUpper, depletionPoint),
  );

  let repletionCoverage: ExperimentalGlycogenRepletionCoverageV1;
  let repletionEstimate: ExperimentalGlycogenRepletionResultV1 | null = null;
  let repletionPoint = 0;
  let repletionLower = 0;
  let repletionUpper = 0;

  // Remaining debt to relative baseline 0 — not literature / personal capacity.
  const debtHeadroomKg = Math.max(0, -(afterDep.state.relativeDeviationKg ?? 0));

  if (input.carbsG === null) {
    repletionCoverage = "skipped-missing-carbohydrate";
    reasons.push("missing-carbohydrate-is-not-zero-repletion");
  } else {
    repletionEstimate = estimateExperimentalGlycogenRepletionV1({
      carbsG: input.carbsG,
      proteinG: input.proteinG ?? null,
      // Absolute store unavailable — do not pass a fabricated kg.
      currentGlycogenKg: null,
      storeHeadroomKg: debtHeadroomKg,
      headroomSource: "explicit",
      activeEnergyKcal: input.activeEnergyKcal ?? null,
    });
    if (repletionEstimate.availability !== "available"
        || repletionEstimate.estimatedGlycogenDeltaKg === null) {
      repletionCoverage = "skipped-unavailable-repletion";
      reasons.push("repletion-unavailable-not-applied-as-zero");
    } else {
      repletionCoverage = "applied";
      repletionPoint = repletionEstimate.estimatedGlycogenDeltaKg;
      repletionLower = repletionEstimate.lowerBoundKg ?? repletionPoint;
      repletionUpper = repletionEstimate.upperBoundKg ?? repletionPoint;
      reasons.push("carb-repletion-applied-after-depletion");
      reasons.push("repletion-capped-by-remaining-relative-debt-to-zero");
    }
  }

  const afterRep = packRelativeState(
    afterDep.state.relativeDeviationKg! + repletionPoint,
    (afterDep.state.relativeDeviationLowerKg ?? afterDep.state.relativeDeviationKg!)
      + Math.min(repletionLower, repletionUpper, repletionPoint),
    (afterDep.state.relativeDeviationUpperKg ?? afterDep.state.relativeDeviationKg!)
      + Math.max(repletionLower, repletionUpper, repletionPoint),
  );
  const debtCeilingApplied = afterDep.debtCeilingApplied || afterRep.debtCeilingApplied;
  if (debtCeilingApplied) {
    reasons.push("relative-debt-ceiling-applied-at-zero");
  }

  const netPoint = afterRep.state.relativeDeviationKg! - priorRel;
  const netLower = (afterRep.state.relativeDeviationLowerKg ?? afterRep.state.relativeDeviationKg!)
    - priorRelUpper;
  const netUpper = (afterRep.state.relativeDeviationUpperKg ?? afterRep.state.relativeDeviationKg!)
    - priorRelLower;
  const orderedNetLower = Math.min(netLower, netPoint, netUpper);
  const orderedNetUpper = Math.max(netLower, netPoint, netUpper);

  const glycogenAssociatedWater = estimateExperimentalGlycogenAssociatedWaterV1({
    glycogenDeltaKg: netPoint,
    glycogenDeltaLowerKg: orderedNetLower,
    glycogenDeltaUpperKg: orderedNetUpper,
    currentGlycogenWaterKg: null,
  });
  reasons.push("glycogen-associated-water-derived-from-net-relative-glycogen-delta");

  const result: ExperimentalGlycogenStateTransitionResultV1 = {
    contractVersion: EXPERIMENTAL_GLYCOGEN_STATE_V1_REVISION,
    provenance: EXPERIMENTAL_GLYCOGEN_STATE_V1_PROVENANCE,
    supportedDomain: "multi-day-relative-glycogen-depletion-debt-shadow-only",
    state: afterRep.state,
    priorState: prior,
    netGlycogenDeltaKg: netPoint,
    netGlycogenDeltaLowerKg: orderedNetLower,
    netGlycogenDeltaUpperKg: orderedNetUpper,
    depletionDeltaKg: exerciseCoverage === "applied-from-exercise-shadows"
      || exerciseCoverage === "observed-rest-zero-depletion"
      ? depletionPoint
      : null,
    repletionDeltaKg: repletionCoverage === "applied" ? repletionPoint : null,
    exerciseCoverage,
    repletionCoverage,
    debtCeilingApplied,
    literatureCapacityClampRejected: true,
    absoluteStoreFabricationRejected: true,
    glycogenAssociatedWater,
    repletionEstimate,
    adultCapacityClampPolicy: GLYCOGEN_ADULT_CAPACITY_CLAMP_POLICY_V7,
    compartmentSeparation: {
      glycogenAssociatedWater: "derived-from-net-relative-glycogen-delta",
      ecfDeviation: "not-a-fallback-or-residual",
      transientExerciseWater: "not-mixed",
    },
    features: {
      carbsG: input.carbsG,
      workoutFeedObserved: input.workoutFeedObserved,
      relativeBaselineDebtKg: 0,
      debtHeadroomKg,
      rejectedConversions: rejectedConversions(),
    },
    reasons,
    fingerprint: "",
  };
  result.fingerprint = experimentalGlycogenStateV1Fingerprint(result);
  return result;
}

/** Replay a date-ordered series from an explicit prior (historical rebuild). */
export function rebuildExperimentalGlycogenStateTrajectoryV1(input: {
  prior?: ExperimentalGlycogenStateV1;
  days: readonly {
    date: string;
    exerciseDepletionKg: number | null;
    exerciseDepletionLowerKg?: number | null;
    exerciseDepletionUpperKg?: number | null;
    workoutFeedObserved: boolean | null;
    carbsG: number | null;
    proteinG?: number | null;
    activeEnergyKcal?: number | null;
  }[];
}): ExperimentalGlycogenStateTransitionResultV1[] {
  let prior = input.prior ?? initialExperimentalGlycogenStateV1();
  const out: ExperimentalGlycogenStateTransitionResultV1[] = [];
  for (const day of input.days) {
    const transition = transitionExperimentalGlycogenStateV1({
      prior,
      exerciseDepletionKg: day.exerciseDepletionKg,
      exerciseDepletionLowerKg: day.exerciseDepletionLowerKg,
      exerciseDepletionUpperKg: day.exerciseDepletionUpperKg,
      workoutFeedObserved: day.workoutFeedObserved,
      carbsG: day.carbsG,
      proteinG: day.proteinG,
      activeEnergyKcal: day.activeEnergyKcal,
    });
    out.push(transition);
    prior = transition.state;
  }
  return out;
}

export function experimentalGlycogenStateV1Fingerprint(
  result: Omit<ExperimentalGlycogenStateTransitionResultV1, "fingerprint"> & {
    fingerprint?: string;
  },
): string {
  const { fingerprint: _ignored, ...rest } = result;
  return stableSha256(rest);
}
