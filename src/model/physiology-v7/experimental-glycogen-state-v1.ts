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
 * Deterministic multi-day relative glycogen trajectory around an explicit
 * engineering baseline/reference. Applies exercise depletion then carb
 * repletion. Never invents personal capacity from the adult literature range.
 * Glycogen-associated water is derived from the day's net glycogen change.
 *
 * Not production TDEE / forecast / validated v7 semantics.
 */
export const EXPERIMENTAL_GLYCOGEN_STATE_V1_REVISION =
  "experimental-glycogen-state-v1" as const;

export const EXPERIMENTAL_GLYCOGEN_STATE_V1_PROVENANCE =
  "experimental-heuristic" as const;

/**
 * ENGINEERING baseline/reference glycogen (kg). Explicit relative zero — not
 * a personal capacity, literature clamp, or validated individual store.
 * Motivated by common whole-body order-of-magnitude priors (Hall ~0.5 kg;
 * E-I06 contextual aggregate framing) without transferring those as capacity.
 */
export const ENGINEERING_GLYCOGEN_BASELINE_REFERENCE_KG_V1 = 0.5 as const;

export const EXPERIMENTAL_GLYCOGEN_BASELINE_REFERENCE_V1 = {
  baselineReferenceKg: ENGINEERING_GLYCOGEN_BASELINE_REFERENCE_KG_V1,
  classification: "engineering-baseline-reference" as const,
  personalCapacity: false,
  literatureClamp: false,
  scientificNote:
    "Relative deviation is measured against this explicit engineering reference. Adult literature 0.3–0.86 kg remains metadata only and never a personal capacity clamp.",
  evidenceIds: ["E-I06"] as const,
} as const;

export type ExperimentalGlycogenStateAvailabilityV1 = "available" | "unavailable";

export type ExperimentalGlycogenStateV1 = {
  availability: ExperimentalGlycogenStateAvailabilityV1;
  baselineReferenceKg: number;
  /** Deviation from baseline (kg). Negative = depleted vs reference. */
  relativeDeviationKg: number | null;
  relativeDeviationLowerKg: number | null;
  relativeDeviationUpperKg: number | null;
  /**
   * Derived absolute = baseline + relative when available.
   * Floored at 0 when the absolute store is treated as defensible.
   * Never equals an invented personal capacity.
   */
  absoluteGlycogenKg: number | null;
  absoluteGlycogenLowerKg: number | null;
  absoluteGlycogenUpperKg: number | null;
  /** Always null — personal capacity is intentionally not invented. */
  personalCapacityKg: null;
  uncertainty: "experimental-relative-heuristic";
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
  supportedDomain: "multi-day-relative-glycogen-state-shadow-only";
  state: ExperimentalGlycogenStateV1;
  priorState: ExperimentalGlycogenStateV1;
  netGlycogenDeltaKg: number | null;
  netGlycogenDeltaLowerKg: number | null;
  netGlycogenDeltaUpperKg: number | null;
  depletionDeltaKg: number | null;
  repletionDeltaKg: number | null;
  exerciseCoverage: ExperimentalGlycogenExerciseCoverageV1;
  repletionCoverage: ExperimentalGlycogenRepletionCoverageV1;
  storeFloorApplied: boolean;
  literatureCapacityClampRejected: true;
  glycogenAssociatedWater: ExperimentalGlycogenAssociatedWaterResultV1 | null;
  repletionEstimate: ExperimentalGlycogenRepletionResultV1 | null;
  adultCapacityClampPolicy: GlycogenAdultCapacityClampPolicyV7;
  compartmentSeparation: {
    glycogenAssociatedWater: "derived-from-glycogen-delta";
    ecfDeviation: "not-a-fallback-or-residual";
    transientExerciseWater: "not-mixed";
  };
  features: {
    carbsG: number | null;
    workoutFeedObserved: boolean | null;
    baselineReferenceKg: number;
    rejectedConversions: readonly [
      "scale-weight-residual",
      "adult-literature-personal-capacity-clamp",
      "invented-personal-capacity",
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
    "ecf-substitution",
    "transient-exercise-water-mixing",
    "independent-water-fit",
  ] as const;
}

function finiteOrThrow(name: string, value: number): number {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite`);
  return Object.is(value, -0) ? 0 : value;
}

/** Explicit relative-zero state at the engineering baseline/reference. */
export function initialExperimentalGlycogenStateV1(
  baselineReferenceKg: number = ENGINEERING_GLYCOGEN_BASELINE_REFERENCE_KG_V1,
): ExperimentalGlycogenStateV1 {
  if (!Number.isFinite(baselineReferenceKg) || baselineReferenceKg <= 0) {
    throw new RangeError("baselineReferenceKg must be finite and positive");
  }
  return {
    availability: "available",
    baselineReferenceKg,
    relativeDeviationKg: 0,
    relativeDeviationLowerKg: 0,
    relativeDeviationUpperKg: 0,
    absoluteGlycogenKg: baselineReferenceKg,
    absoluteGlycogenLowerKg: baselineReferenceKg,
    absoluteGlycogenUpperKg: baselineReferenceKg,
    personalCapacityKg: null,
    uncertainty: "experimental-relative-heuristic",
  };
}

function absoluteFromRelative(
  baselineReferenceKg: number,
  relativeDeviationKg: number,
): { absoluteKg: number; relativeKg: number; storeFloorApplied: boolean } {
  const rawAbsolute = baselineReferenceKg + relativeDeviationKg;
  if (rawAbsolute < 0) {
    return {
      absoluteKg: 0,
      relativeKg: -baselineReferenceKg,
      storeFloorApplied: true,
    };
  }
  return {
    absoluteKg: finiteOrThrow("absoluteKg", rawAbsolute),
    relativeKg: finiteOrThrow("relativeKg", relativeDeviationKg),
    storeFloorApplied: false,
  };
}

function packState(
  baselineReferenceKg: number,
  relativePoint: number,
  relativeLower: number,
  relativeUpper: number,
): { state: ExperimentalGlycogenStateV1; storeFloorApplied: boolean } {
  const point = absoluteFromRelative(baselineReferenceKg, relativePoint);
  const lower = absoluteFromRelative(baselineReferenceKg, relativeLower);
  const upper = absoluteFromRelative(baselineReferenceKg, relativeUpper);
  const relatives = [point.relativeKg, lower.relativeKg, upper.relativeKg];
  const absolutes = [point.absoluteKg, lower.absoluteKg, upper.absoluteKg];
  return {
    storeFloorApplied: point.storeFloorApplied || lower.storeFloorApplied || upper.storeFloorApplied,
    state: {
      availability: "available",
      baselineReferenceKg,
      relativeDeviationKg: point.relativeKg,
      relativeDeviationLowerKg: Math.min(...relatives),
      relativeDeviationUpperKg: Math.max(...relatives),
      absoluteGlycogenKg: point.absoluteKg,
      absoluteGlycogenLowerKg: Math.min(...absolutes),
      absoluteGlycogenUpperKg: Math.max(...absolutes),
      personalCapacityKg: null,
      uncertainty: "experimental-relative-heuristic",
    },
  };
}

/**
 * One-day experimental glycogen state transition.
 *
 * Order: carry prior → apply exercise depletion → apply carb repletion →
 * derive associated water from net glycogen change.
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
  const capacityRejection = rejectAdultGlycogenCapacityClampV7({
    glycogenKg: input.prior.absoluteGlycogenKg,
  });
  if (capacityRejection.resultingGlycogenKg !== input.prior.absoluteGlycogenKg) {
    throw new Error("experimental glycogen state must not mutate via adult capacity");
  }

  const baselineReferenceKg = input.prior.baselineReferenceKg
    || ENGINEERING_GLYCOGEN_BASELINE_REFERENCE_KG_V1;
  const reasons: string[] = [
    "experimental-heuristic-relative-glycogen-state",
    "deterministic-depletion-then-repletion-order",
    "adult-literature-personal-capacity-clamp-intentionally-rejected",
    `adult-literature-range-metadata-only-${GLYCOGEN_ADULT_CAPACITY_RANGE_METADATA_V7.literatureRangeKg.lowerKg}-${GLYCOGEN_ADULT_CAPACITY_RANGE_METADATA_V7.literatureRangeKg.upperKg}-kg`,
    "scale-weight-residual-intentionally-rejected",
  ];

  const prior = input.prior.availability === "available"
    && input.prior.relativeDeviationKg !== null
    ? input.prior
    : initialExperimentalGlycogenStateV1(baselineReferenceKg);

  if (input.prior.availability !== "available" || input.prior.relativeDeviationKg === null) {
    reasons.push("prior-unavailable-initialized-at-engineering-baseline-reference");
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
    if (!(depletionLower <= depletionPoint && depletionPoint <= depletionUpper)
        && !(depletionUpper <= depletionPoint && depletionPoint <= depletionLower)) {
      // Allow either ordering; normalize so lower ≤ point ≤ upper after abs floor.
    }
    if (depletionLower > 0 || depletionUpper > 0) {
      throw new RangeError("exercise depletion bounds must be ≤ 0");
    }
    exerciseCoverage = "applied-from-exercise-shadows";
    reasons.push("exercise-depletion-applied");
  } else if (input.workoutFeedObserved === true) {
    exerciseCoverage = "observed-rest-zero-depletion";
    reasons.push("observed-workout-feed-rest-zero-depletion");
  } else {
    // false or null feed with no depletion deltas — never invent rest/zero burn.
    exerciseCoverage = "unresolved-missing-workout-feed";
    reasons.push("missing-workout-feed-is-not-rest");
    reasons.push("unresolved-exercise-depletion-not-applied-as-zero");
  }

  const afterDep = packState(
    baselineReferenceKg,
    priorRel + depletionPoint,
    priorRelLower + Math.min(depletionLower, depletionUpper, depletionPoint),
    priorRelUpper + Math.max(depletionLower, depletionUpper, depletionPoint),
  );
  let storeFloorApplied = afterDep.storeFloorApplied;
  if (storeFloorApplied) reasons.push("absolute-store-floor-applied-at-zero");

  let repletionCoverage: ExperimentalGlycogenRepletionCoverageV1;
  let repletionEstimate: ExperimentalGlycogenRepletionResultV1 | null = null;
  let repletionPoint = 0;
  let repletionLower = 0;
  let repletionUpper = 0;

  // Headroom: today's applied exercise refill opportunity only — never literature capacity.
  const exerciseHeadroomKg = exerciseCoverage === "applied-from-exercise-shadows"
    ? Math.max(0, -depletionPoint)
    : null;

  if (input.carbsG === null) {
    repletionCoverage = "skipped-missing-carbohydrate";
    reasons.push("missing-carbohydrate-is-not-zero-repletion");
  } else {
    repletionEstimate = estimateExperimentalGlycogenRepletionV1({
      carbsG: input.carbsG,
      proteinG: input.proteinG ?? null,
      currentGlycogenKg: afterDep.state.absoluteGlycogenKg,
      storeHeadroomKg: exerciseHeadroomKg,
      headroomSource: exerciseHeadroomKg === null ? "unavailable" : "exercise-depletion-refill",
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
      if (exerciseHeadroomKg === null) {
        reasons.push("no-invented-personal-capacity-upper-clamp");
      }
    }
  }

  const afterRep = packState(
    baselineReferenceKg,
    afterDep.state.relativeDeviationKg! + repletionPoint,
    (afterDep.state.relativeDeviationLowerKg ?? afterDep.state.relativeDeviationKg!)
      + Math.min(repletionLower, repletionUpper, repletionPoint),
    (afterDep.state.relativeDeviationUpperKg ?? afterDep.state.relativeDeviationKg!)
      + Math.max(repletionLower, repletionUpper, repletionPoint),
  );
  storeFloorApplied = storeFloorApplied || afterRep.storeFloorApplied;

  const netPoint = afterRep.state.absoluteGlycogenKg! - prior.absoluteGlycogenKg!;
  const netLower = afterRep.state.absoluteGlycogenLowerKg! - (prior.absoluteGlycogenUpperKg ?? prior.absoluteGlycogenKg!);
  const netUpper = afterRep.state.absoluteGlycogenUpperKg! - (prior.absoluteGlycogenLowerKg ?? prior.absoluteGlycogenKg!);
  const orderedNetLower = Math.min(netLower, netPoint, netUpper);
  const orderedNetUpper = Math.max(netLower, netPoint, netUpper);

  const glycogenAssociatedWater = estimateExperimentalGlycogenAssociatedWaterV1({
    glycogenDeltaKg: netPoint,
    glycogenDeltaLowerKg: orderedNetLower,
    glycogenDeltaUpperKg: orderedNetUpper,
    currentGlycogenWaterKg: null,
  });
  reasons.push("glycogen-associated-water-derived-from-net-glycogen-delta");

  const result: ExperimentalGlycogenStateTransitionResultV1 = {
    contractVersion: EXPERIMENTAL_GLYCOGEN_STATE_V1_REVISION,
    provenance: EXPERIMENTAL_GLYCOGEN_STATE_V1_PROVENANCE,
    supportedDomain: "multi-day-relative-glycogen-state-shadow-only",
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
    storeFloorApplied,
    literatureCapacityClampRejected: true,
    glycogenAssociatedWater,
    repletionEstimate,
    adultCapacityClampPolicy: GLYCOGEN_ADULT_CAPACITY_CLAMP_POLICY_V7,
    compartmentSeparation: {
      glycogenAssociatedWater: "derived-from-glycogen-delta",
      ecfDeviation: "not-a-fallback-or-residual",
      transientExerciseWater: "not-mixed",
    },
    features: {
      carbsG: input.carbsG,
      workoutFeedObserved: input.workoutFeedObserved,
      baselineReferenceKg,
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
