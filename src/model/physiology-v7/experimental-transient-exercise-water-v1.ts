import {
  ACUTE_SWELLING_NOT_SKELETAL_MUSCLE_POLICY_V7,
  rejectAcuteSwellingAsSkeletalMuscleV7,
} from "@/model/physiology-v7/transient-exercise-water-ecf-transition-v7";
import { stableSha256 } from "@/modules/model-recovery/recovery-fingerprint";

/**
 * Experimental Transient Exercise Water V1 (shadow / EXPERIMENTAL only).
 *
 * Resistance-training acute swelling impulse + finite decay toward baseline.
 * No scientific half-life claim; no skeletalMuscleKg conversion; no scale-weight
 * residual fitting. Not production TDEE / forecast / validated v7 semantics.
 */
export const EXPERIMENTAL_TRANSIENT_EXERCISE_WATER_V1_REVISION =
  "experimental-transient-exercise-water-v1" as const;

export const EXPERIMENTAL_TRANSIENT_EXERCISE_WATER_V1_PROVENANCE =
  "experimental-heuristic" as const;

/**
 * ENGINEERING PRIOR — saturating scale τ for qualified hard-set count.
 * Normalizes acute impulse; not a measured edema-per-set coefficient.
 */
export const ENGINEERING_ACUTE_SET_SCALE_TAU_V1 = 8 as const;

/**
 * ENGINEERING order-of-magnitude acute whole-body transient-water impulse (kg)
 * for a saturated resistance session.
 *
 * Scientific basis for a nonnegative post-resistance water/edema process:
 * E-J01–E-J07 (local thickness/CSA/T2). Whole-body kg aggregation remains an
 * engineering prior — local imaging is not a validated kg conversion.
 */
export const EXPERIMENTAL_ACUTE_TRANSIENT_WATER_KG_V1 = {
  pointMagnitudeKg: 0.15,
  lowerMagnitudeKg: 0.04,
  upperMagnitudeKg: 0.45,
  pointClassification: "engineering-midpoint" as const,
  boundClassification: "engineering-order-of-magnitude-band" as const,
  evidenceIds: ["E-J01", "E-J02", "E-J03", "E-J04", "E-J05", "E-J06", "E-J07"] as const,
  scientificNote:
    "Local post-resistance edema/swelling is evidence-backed; kg endpoints are engineering priors under unknown anatomical aggregation.",
} as const;

/**
 * ENGINEERING finite resolution horizons (days) — not scientific half-lives.
 * Accustomed: permit resolution about next day (C-J04 / E-J06).
 * Novel: permit multi-day elevation without extreme-study tails (C-J05).
 */
export const ENGINEERING_RESOLUTION_HORIZON_DAYS_V1 = {
  accustomed: {
    pointDays: 1,
    /** Faster resolution edge. */
    lowerDays: 0.75,
    /** Slower resolution edge still within ~next-day domain. */
    upperDays: 1.5,
  },
  "novel-or-unknown": {
    pointDays: 3.5,
    lowerDays: 2,
    upperDays: 5,
  },
  classification: "engineering-finite-resolution-horizon" as const,
  scientificNote:
    "Horizons encode permitted time-course domains from E-J03–E-J07; they are not fitted half-lives.",
} as const;

export type ExperimentalExposureContextV1 =
  | "accustomed"
  | "novel-or-unknown"
  | "unavailable";

export type ExperimentalTransientExerciseWaterAvailabilityV1 =
  | "available"
  | "unavailable";

export type ExperimentalTransientExerciseWaterUnavailableReasonV1 =
  | "missing-resistance-evidence-and-prior-state"
  | "non-finite-prior-or-timing";

export type ExperimentalResistanceSessionEvidenceV1 = {
  qualifiedHardSetCount: number;
  /**
   * Exposure/novelty context. Affects resolution-horizon domain / uncertainty
   * only — never an exact repeated-bout amplitude coefficient (C-J03).
   */
  exposureContext: Exclude<ExperimentalExposureContextV1, "unavailable">;
};

export type ExperimentalTransientExerciseWaterFeaturesV1 = {
  priorTransientWaterKg: number | null;
  daysElapsed: number;
  resistanceSessionPresent: boolean;
  qualifiedHardSetCount: number | null;
  exposureContext: ExperimentalExposureContextV1;
  acuteScale: number;
  resolutionHorizonPointDays: number | null;
  acuteImpulsePointKg: number;
  acuteImpulseLowerKg: number;
  acuteImpulseUpperKg: number;
  skeletalMuscleRejected: true;
  rejectedConversions: readonly [
    "transient-water-to-skeletal-muscle-kg",
    "scale-weight-residual",
    "scientific-half-life-coefficient",
    "exact-repeated-bout-attenuation-coefficient",
  ];
};

export type ExperimentalTransientExerciseWaterResultV1 = {
  contractVersion: typeof EXPERIMENTAL_TRANSIENT_EXERCISE_WATER_V1_REVISION;
  provenance: typeof EXPERIMENTAL_TRANSIENT_EXERCISE_WATER_V1_PROVENANCE;
  supportedDomain: "resistance-transient-water-shadow-only";
  availability: ExperimentalTransientExerciseWaterAvailabilityV1;
  /**
   * Net change in transientExerciseWaterKg for this step (may be negative when
   * decaying). Acute impulse contribution alone is always ≥ 0 when a session
   * is present.
   */
  transientWaterDeltaKg: {
    point: number | null;
    lower: number | null;
    upper: number | null;
  };
  /** Resulting compartment estimate (≥ 0 when available). */
  resultingTransientWaterKg: {
    point: number | null;
    lower: number | null;
    upper: number | null;
  };
  acuteImpulseKg: {
    point: number;
    lower: number;
    upper: number;
  };
  unavailableReason: ExperimentalTransientExerciseWaterUnavailableReasonV1 | null;
  features: ExperimentalTransientExerciseWaterFeaturesV1;
  reasons: string[];
  swellingNotSkeletalMusclePolicy: typeof ACUTE_SWELLING_NOT_SKELETAL_MUSCLE_POLICY_V7;
};

function engineeringAcuteScaleV1(qualifiedHardSetCount: number): number {
  if (!(qualifiedHardSetCount > 0)) return 0;
  return 1 - Math.exp(-qualifiedHardSetCount / ENGINEERING_ACUTE_SET_SCALE_TAU_V1);
}

/**
 * Finite linear pull toward baseline. Not a scientific half-life:
 * after `horizonDays`, remaining mass is 0.
 */
export function engineeringFiniteDecayFactorV1(
  daysElapsed: number,
  horizonDays: number,
): number {
  if (!(daysElapsed > 0)) return 1;
  if (!(horizonDays > 0)) return 0;
  return Math.max(0, 1 - daysElapsed / horizonDays);
}

function clampNonnegative(value: number): number {
  if (!Number.isFinite(value)) {
    throw new RangeError("transient water values must be finite");
  }
  const clamped = Math.max(0, value);
  return Object.is(clamped, -0) ? 0 : clamped;
}

function rejectedConversions(): ExperimentalTransientExerciseWaterFeaturesV1["rejectedConversions"] {
  return [
    "transient-water-to-skeletal-muscle-kg",
    "scale-weight-residual",
    "scientific-half-life-coefficient",
    "exact-repeated-bout-attenuation-coefficient",
  ] as const;
}

function unavailable(input: {
  reason: ExperimentalTransientExerciseWaterUnavailableReasonV1;
  reasons: string[];
  priorTransientWaterKg: number | null;
  daysElapsed: number;
  resistanceSession: ExperimentalResistanceSessionEvidenceV1 | null;
  skeletalMuscleKg: number | null;
}): ExperimentalTransientExerciseWaterResultV1 {
  rejectAcuteSwellingAsSkeletalMuscleV7({
    skeletalMuscleKg: input.skeletalMuscleKg,
  });
  return {
    contractVersion: EXPERIMENTAL_TRANSIENT_EXERCISE_WATER_V1_REVISION,
    provenance: EXPERIMENTAL_TRANSIENT_EXERCISE_WATER_V1_PROVENANCE,
    supportedDomain: "resistance-transient-water-shadow-only",
    availability: "unavailable",
    transientWaterDeltaKg: { point: null, lower: null, upper: null },
    resultingTransientWaterKg: { point: null, lower: null, upper: null },
    acuteImpulseKg: { point: 0, lower: 0, upper: 0 },
    unavailableReason: input.reason,
    features: {
      priorTransientWaterKg: input.priorTransientWaterKg,
      daysElapsed: input.daysElapsed,
      resistanceSessionPresent: input.resistanceSession !== null,
      qualifiedHardSetCount: input.resistanceSession?.qualifiedHardSetCount ?? null,
      exposureContext: input.resistanceSession?.exposureContext ?? "unavailable",
      acuteScale: 0,
      resolutionHorizonPointDays: null,
      acuteImpulsePointKg: 0,
      acuteImpulseLowerKg: 0,
      acuteImpulseUpperKg: 0,
      skeletalMuscleRejected: true,
      rejectedConversions: rejectedConversions(),
    },
    reasons: input.reasons,
    swellingNotSkeletalMusclePolicy: ACUTE_SWELLING_NOT_SKELETAL_MUSCLE_POLICY_V7,
  };
}

/**
 * One experimental step: decay prior toward baseline, then optionally add a
 * nonnegative acute resistance impulse. Missing evidence ≠ zero state.
 */
export function estimateExperimentalTransientExerciseWaterV1(input: {
  priorTransientWaterKg?: number | null;
  /** Days since the prior state snapshot (≥ 0). */
  daysElapsed?: number;
  resistanceSession?: ExperimentalResistanceSessionEvidenceV1 | null;
  /** Passed only to prove SM is never written from swelling. */
  skeletalMuscleKg?: number | null;
}): ExperimentalTransientExerciseWaterResultV1 {
  const prior = input.priorTransientWaterKg === undefined
    ? null
    : input.priorTransientWaterKg;
  const daysElapsed = input.daysElapsed ?? 0;
  const resistanceSession = input.resistanceSession ?? null;
  const skeletalMuscleKg = input.skeletalMuscleKg === undefined
    ? null
    : input.skeletalMuscleKg;

  if (prior !== null && (!Number.isFinite(prior) || prior < 0)) {
    throw new RangeError("priorTransientWaterKg must be finite and nonnegative when provided");
  }
  if (!Number.isFinite(daysElapsed) || daysElapsed < 0) {
    throw new RangeError("daysElapsed must be finite and nonnegative");
  }
  if (skeletalMuscleKg !== null
      && (!Number.isFinite(skeletalMuscleKg) || skeletalMuscleKg < 0)) {
    throw new RangeError("skeletalMuscleKg must be finite and nonnegative when provided");
  }
  if (resistanceSession !== null) {
    if (!Number.isFinite(resistanceSession.qualifiedHardSetCount)
        || resistanceSession.qualifiedHardSetCount < 0) {
      throw new RangeError("qualifiedHardSetCount must be finite and nonnegative");
    }
  }

  const smRejection = rejectAcuteSwellingAsSkeletalMuscleV7({
    skeletalMuscleKg,
    swellingSignal: resistanceSession === null
      ? null
      : { localThicknessChangePercent: null, bodyWeightRiseKg: null },
  });
  if (smRejection.resultingSkeletalMuscleKg !== skeletalMuscleKg) {
    throw new Error("experimental transient water must not mutate skeletalMuscleKg");
  }

  if (prior === null && resistanceSession === null) {
    return unavailable({
      reason: "missing-resistance-evidence-and-prior-state",
      reasons: [
        "missing-evidence-is-not-zero-transient-water",
        "no-resistance-session-and-no-prior-state",
      ],
      priorTransientWaterKg: prior,
      daysElapsed,
      resistanceSession,
      skeletalMuscleKg,
    });
  }

  const exposureContext: ExperimentalExposureContextV1 = resistanceSession?.exposureContext
    ?? (prior !== null ? "novel-or-unknown" : "unavailable");
  const horizonKey = exposureContext === "accustomed" ? "accustomed" : "novel-or-unknown";
  const horizon = ENGINEERING_RESOLUTION_HORIZON_DAYS_V1[horizonKey];

  const priorPoint = prior ?? 0;
  // Bound envelopes: faster horizon → less remaining water (lower envelope);
  // slower horizon → more remaining (upper envelope).
  const decayedPoint = clampNonnegative(
    priorPoint * engineeringFiniteDecayFactorV1(daysElapsed, horizon.pointDays),
  );
  const decayedLower = clampNonnegative(
    priorPoint * engineeringFiniteDecayFactorV1(daysElapsed, horizon.lowerDays),
  );
  const decayedUpper = clampNonnegative(
    priorPoint * engineeringFiniteDecayFactorV1(daysElapsed, horizon.upperDays),
  );

  let acutePoint = 0;
  let acuteLower = 0;
  let acuteUpper = 0;
  let acuteScale = 0;
  if (resistanceSession !== null && resistanceSession.qualifiedHardSetCount > 0) {
    acuteScale = engineeringAcuteScaleV1(resistanceSession.qualifiedHardSetCount);
    const ref = EXPERIMENTAL_ACUTE_TRANSIENT_WATER_KG_V1;
    acutePoint = ref.pointMagnitudeKg * acuteScale;
    acuteLower = ref.lowerMagnitudeKg * acuteScale;
    acuteUpper = ref.upperMagnitudeKg * acuteScale;
  } else if (resistanceSession !== null && resistanceSession.qualifiedHardSetCount === 0) {
    // Session present but no qualified sets: not a zero edema assertion — leave
    // acute at 0 with explicit reason (decay-only step still available).
    acuteScale = 0;
  }

  // Ensure bound ordering: lower ≤ point ≤ upper for resulting levels.
  const resultingLower = clampNonnegative(Math.min(decayedLower, decayedPoint) + acuteLower);
  const resultingPoint = clampNonnegative(decayedPoint + acutePoint);
  const resultingUpper = clampNonnegative(Math.max(decayedUpper, decayedPoint) + acuteUpper);

  const orderedLower = Math.min(resultingLower, resultingPoint);
  const orderedUpper = Math.max(resultingUpper, resultingPoint);

  const deltaPoint = resultingPoint - priorPoint;
  const deltaLower = orderedLower - priorPoint;
  const deltaUpper = orderedUpper - priorPoint;

  const reasons = [
    "experimental-heuristic-finite-decay",
    "acute-impulse-nonnegative-when-session-qualified",
    "transient-water-never-negative",
    "swelling-routes-to-transient-water-not-skeletal-muscle",
    "no-scientific-half-life-asserted",
    "exposure-context-affects-resolution-horizon-only",
    ...(resistanceSession === null
      ? ["decay-only-no-new-resistance-cause"]
      : resistanceSession.qualifiedHardSetCount > 0
        ? ["resistance-acute-impulse-applied"]
        : ["resistance-session-without-qualified-sets-no-acute-impulse"]),
    ...(exposureContext === "accustomed"
      ? ["accustomed-resolution-horizon-domain"]
      : exposureContext === "novel-or-unknown"
        ? ["novel-or-unknown-resolution-horizon-domain"]
        : ["exposure-context-unavailable"]),
    "scale-weight-residual-intentionally-rejected",
    "exact-repeated-bout-attenuation-coefficient-intentionally-rejected",
  ];

  return {
    contractVersion: EXPERIMENTAL_TRANSIENT_EXERCISE_WATER_V1_REVISION,
    provenance: EXPERIMENTAL_TRANSIENT_EXERCISE_WATER_V1_PROVENANCE,
    supportedDomain: "resistance-transient-water-shadow-only",
    availability: "available",
    transientWaterDeltaKg: {
      point: deltaPoint,
      lower: Math.min(deltaLower, deltaPoint),
      upper: Math.max(deltaUpper, deltaPoint),
    },
    resultingTransientWaterKg: {
      point: resultingPoint,
      lower: orderedLower,
      upper: orderedUpper,
    },
    acuteImpulseKg: {
      point: acutePoint,
      lower: acuteLower,
      upper: acuteUpper,
    },
    unavailableReason: null,
    features: {
      priorTransientWaterKg: prior,
      daysElapsed,
      resistanceSessionPresent: resistanceSession !== null,
      qualifiedHardSetCount: resistanceSession?.qualifiedHardSetCount ?? null,
      exposureContext,
      acuteScale,
      resolutionHorizonPointDays: horizon.pointDays,
      acuteImpulsePointKg: acutePoint,
      acuteImpulseLowerKg: acuteLower,
      acuteImpulseUpperKg: acuteUpper,
      skeletalMuscleRejected: true,
      rejectedConversions: rejectedConversions(),
    },
    reasons,
    swellingNotSkeletalMusclePolicy: ACUTE_SWELLING_NOT_SKELETAL_MUSCLE_POLICY_V7,
  };
}

export function experimentalTransientExerciseWaterV1Fingerprint(
  result: ExperimentalTransientExerciseWaterResultV1,
): string {
  return stableSha256(result);
}
