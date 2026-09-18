import {
  DAYS_PER_MONTH_V1,
  ENGINEERING_MAX_ABS_DAILY_SM_DELTA_KG_V1,
  type ExperimentalTrainingExposureKindV1,
} from "@/model/physiology-v7/experimental-skeletal-muscle-delta-v1";
import { stableSha256 } from "@/modules/model-recovery/recovery-fingerprint";

/**
 * Experimental Cessation / Detraining V1 (shadow / EXPERIMENTAL only).
 *
 * Bounded non-positive relative skeletal-muscle delta after a verified
 * prolonged no-exposure streak. Ordinary rest and missing workout feed are
 * never cessation. Day 0 of a cessation episode has no instant negative step.
 *
 * Not a universal scientific atrophy curve. Not production TDEE / forecast /
 * GREEN / skeletalMuscleKg.
 */
export const EXPERIMENTAL_CESSATION_DETRAINING_V1_REVISION =
  "experimental-cessation-detraining-v1" as const;

export const EXPERIMENTAL_CESSATION_DETRAINING_V1_PROVENANCE =
  "experimental-heuristic" as const;

/**
 * Consecutive verified no-exposure days after qualified training before any
 * non-positive tissue delta. P-C01 defers a scientific grace period.
 * Classification: ENGINEERING. 14d is longer than ordinary rest and shorter
 * than the 12–24 week E-C01 window (whose CI includes no loss).
 */
export const ENGINEERING_CESSATION_GRACE_DAYS_V1 = 14 as const;

/**
 * Engineering monthly relative atrophy envelope after grace (kg/month).
 * Direction (eventual non-positive risk) is literature-informed (E-C01);
 * magnitude/shape are NOT a scientific atrophy curve (P-C01 DEFERS rate).
 */
export const EXPERIMENTAL_CESSATION_ATROPHY_MONTHLY_KG_V1 = {
  lowerKgPerMonth: -0.2,
  pointKgPerMonth: -0.06,
  upperKgPerMonth: 0,
  classification: "engineering-order-of-magnitude-band-not-universal-atrophy-curve" as const,
  evidenceIds: ["E-C01", "E-C02"] as const,
  scientificNote:
    "E-C01 supports eventual size-loss risk with longer cessation in older adults; E-C02 2/4-week local CSA is not contractile kg. No approved kg/day scientific rate.",
} as const;

export const EXPERIMENTAL_CESSATION_PRIORS_V1 = {
  noSameDayNegativeStep: {
    classification: "scientific-invariant" as const,
    evidenceIds: ["E-C01", "E-C02"] as const,
    claimIds: ["C-C01"] as const,
  },
  missingFeedIsNotCessation: {
    classification: "scientific-input-contract" as const,
    evidenceIds: ["E-C01"] as const,
    parameterId: "P-C01" as const,
  },
  restDayIsNotCessation: {
    classification: "scientific-input-contract" as const,
    evidenceIds: ["E-C04", "E-C05"] as const,
    parameterId: "P-C02" as const,
  },
  longerCessationDoesNotReduceLossRisk: {
    classification: "scientific-ordering" as const,
    evidenceIds: ["E-C01", "E-C03"] as const,
    claimIds: ["C-C02"] as const,
  },
  graceDays: {
    value: ENGINEERING_CESSATION_GRACE_DAYS_V1,
    classification: "engineering" as const,
    scientificDecision: "deferred-by-P-C01",
  },
  atrophyMonthlyEnvelopeKg: {
    ...EXPERIMENTAL_CESSATION_ATROPHY_MONTHLY_KG_V1,
    scientificDecision: "deferred-by-P-C01",
  },
} as const;

export type ExperimentalCessationPhaseV1 =
  | "not-in-cessation"
  | "verified-rest-or-grace"
  | "detraining"
  | "unknown-coverage-not-cessation";

export type ExperimentalCessationStateV1 = {
  observedNoExposureStreakDays: number;
  hadPriorQualifiedTraining: boolean;
  phase: ExperimentalCessationPhaseV1;
  relativeCumulativeDeltaKg: number | null;
  absoluteSkeletalMuscleKg: null;
};

export type ExperimentalCessationDetrainingResultV1 = {
  contractVersion: typeof EXPERIMENTAL_CESSATION_DETRAINING_V1_REVISION;
  provenance: typeof EXPERIMENTAL_CESSATION_DETRAINING_V1_PROVENANCE;
  supportedDomain: "relative-cessation-detraining-delta-shadow-only";
  availability: "available";
  estimatedSkeletalMuscleDeltaKg: number;
  lowerBoundKg: number;
  upperBoundKg: number;
  state: ExperimentalCessationStateV1;
  features: {
    exposureKind: ExperimentalTrainingExposureKindV1;
    observedNoExposureStreakDays: number;
    daysPastGrace: number;
    hadPriorQualifiedTraining: boolean;
    phase: ExperimentalCessationPhaseV1;
    trainingSkeletalMuscleDeltaKg: number | null;
    muscleMemoryBonusApplied: false;
    absoluteSkeletalMuscleKg: null;
    rejectedConversions: readonly [
      "universal-scientific-atrophy-curve",
      "same-day-cessation-step",
      "missing-feed-as-cessation",
      "rest-day-as-detraining",
      "strength-to-atrophy-kg",
      "local-csa-to-skeletalMuscleKg",
      "muscle-memory-numeric-bonus",
    ];
  };
  reasons: string[];
  fingerprint: string;
};

function rejectedConversions(): ExperimentalCessationDetrainingResultV1["features"]["rejectedConversions"] {
  return [
    "universal-scientific-atrophy-curve",
    "same-day-cessation-step",
    "missing-feed-as-cessation",
    "rest-day-as-detraining",
    "strength-to-atrophy-kg",
    "local-csa-to-skeletalMuscleKg",
    "muscle-memory-numeric-bonus",
  ] as const;
}

function clampDaily(deltaKg: number): number {
  if (!Number.isFinite(deltaKg)) throw new RangeError("deltaKg must be finite");
  const value = Object.is(deltaKg, -0) ? 0 : deltaKg;
  return Math.min(
    ENGINEERING_MAX_ABS_DAILY_SM_DELTA_KG_V1,
    Math.max(-ENGINEERING_MAX_ABS_DAILY_SM_DELTA_KG_V1, value),
  );
}

function dailyAtrophyEnvelope(): { lower: number; point: number; upper: number } {
  return {
    lower: clampDaily(
      EXPERIMENTAL_CESSATION_ATROPHY_MONTHLY_KG_V1.lowerKgPerMonth / DAYS_PER_MONTH_V1,
    ),
    point: clampDaily(
      EXPERIMENTAL_CESSATION_ATROPHY_MONTHLY_KG_V1.pointKgPerMonth / DAYS_PER_MONTH_V1,
    ),
    upper: clampDaily(
      EXPERIMENTAL_CESSATION_ATROPHY_MONTHLY_KG_V1.upperKgPerMonth / DAYS_PER_MONTH_V1,
    ),
  };
}

export function initialExperimentalCessationStateV1(
  priorRelativeCumulativeDeltaKg = 0,
): ExperimentalCessationStateV1 {
  return {
    observedNoExposureStreakDays: 0,
    hadPriorQualifiedTraining: false,
    phase: "not-in-cessation",
    relativeCumulativeDeltaKg: priorRelativeCumulativeDeltaKg,
    absoluteSkeletalMuscleKg: null,
  };
}

function finish(
  partial: Omit<ExperimentalCessationDetrainingResultV1, "fingerprint">,
): ExperimentalCessationDetrainingResultV1 {
  const result: ExperimentalCessationDetrainingResultV1 = { ...partial, fingerprint: "" };
  result.fingerprint = experimentalCessationDetrainingV1Fingerprint(result);
  return result;
}

/**
 * One-day cessation/detraining transition over relative SM cumulative state.
 */
export function transitionExperimentalCessationDetrainingV1(input: {
  exposureKind: ExperimentalTrainingExposureKindV1;
  prior?: ExperimentalCessationStateV1 | null;
  /** SM-delta V1 training-day point; ignored unless qualified training. */
  trainingSkeletalMuscleDeltaKg?: number | null;
  muscleMemoryBonus?: number | null;
  strengthDelta?: number | null;
}): ExperimentalCessationDetrainingResultV1 {
  const prior = input.prior ?? initialExperimentalCessationStateV1();
  const priorCumulative = prior.relativeCumulativeDeltaKg ?? 0;
  const reasons = [
    "experimental-heuristic-cessation-detraining",
    "absolute-skeletalMuscleKg-intentionally-unavailable",
    "universal-scientific-atrophy-curve-intentionally-rejected",
    "muscle-memory-numeric-bonus-intentionally-rejected",
  ];
  if (input.muscleMemoryBonus != null && input.muscleMemoryBonus !== 0) {
    reasons.push("muscle-memory-bonus-ignored");
  }
  if (input.strengthDelta != null) {
    reasons.push("strength-delta-not-converted-to-atrophy");
  }

  if (input.exposureKind === "qualified-mapped-training") {
    const trainingDelta = input.trainingSkeletalMuscleDeltaKg ?? 0;
    if (!Number.isFinite(trainingDelta)) {
      throw new RangeError("trainingSkeletalMuscleDeltaKg must be finite when provided");
    }
    const resumed = prior.phase === "detraining" || prior.phase === "verified-rest-or-grace";
    if (resumed) reasons.push("training-resumption-stops-detraining-without-memory-bonus");
    reasons.push("qualified-nonzero-loading-is-not-cessation");
    const cumulative = priorCumulative + trainingDelta;
    return finish({
      contractVersion: EXPERIMENTAL_CESSATION_DETRAINING_V1_REVISION,
      provenance: EXPERIMENTAL_CESSATION_DETRAINING_V1_PROVENANCE,
      supportedDomain: "relative-cessation-detraining-delta-shadow-only",
      availability: "available",
      estimatedSkeletalMuscleDeltaKg: trainingDelta,
      lowerBoundKg: trainingDelta,
      upperBoundKg: trainingDelta,
      state: {
        observedNoExposureStreakDays: 0,
        hadPriorQualifiedTraining: true,
        phase: "not-in-cessation",
        relativeCumulativeDeltaKg: cumulative,
        absoluteSkeletalMuscleKg: null,
      },
      features: {
        exposureKind: input.exposureKind,
        observedNoExposureStreakDays: 0,
        daysPastGrace: 0,
        hadPriorQualifiedTraining: true,
        phase: "not-in-cessation",
        trainingSkeletalMuscleDeltaKg: trainingDelta,
        muscleMemoryBonusApplied: false,
        absoluteSkeletalMuscleKg: null,
        rejectedConversions: rejectedConversions(),
      },
      reasons,
    });
  }

  if (input.exposureKind === "unresolved-missing-training") {
    reasons.push("missing-workout-feed-is-not-cessation");
    reasons.push("no-exposure-streak-does-not-increment-on-unknown-coverage");
    return finish({
      contractVersion: EXPERIMENTAL_CESSATION_DETRAINING_V1_REVISION,
      provenance: EXPERIMENTAL_CESSATION_DETRAINING_V1_PROVENANCE,
      supportedDomain: "relative-cessation-detraining-delta-shadow-only",
      availability: "available",
      estimatedSkeletalMuscleDeltaKg: 0,
      lowerBoundKg: 0,
      upperBoundKg: 0,
      state: {
        observedNoExposureStreakDays: prior.observedNoExposureStreakDays,
        hadPriorQualifiedTraining: prior.hadPriorQualifiedTraining,
        phase: "unknown-coverage-not-cessation",
        relativeCumulativeDeltaKg: priorCumulative,
        absoluteSkeletalMuscleKg: null,
      },
      features: {
        exposureKind: input.exposureKind,
        observedNoExposureStreakDays: prior.observedNoExposureStreakDays,
        daysPastGrace: Math.max(0, prior.observedNoExposureStreakDays - ENGINEERING_CESSATION_GRACE_DAYS_V1),
        hadPriorQualifiedTraining: prior.hadPriorQualifiedTraining,
        phase: "unknown-coverage-not-cessation",
        trainingSkeletalMuscleDeltaKg: null,
        muscleMemoryBonusApplied: false,
        absoluteSkeletalMuscleKg: null,
        rejectedConversions: rejectedConversions(),
      },
      reasons,
    });
  }

  // verified-no-exposure
  if (!prior.hadPriorQualifiedTraining) {
    reasons.push("rest-day-is-not-cessation-without-prior-qualified-training");
    return finish({
      contractVersion: EXPERIMENTAL_CESSATION_DETRAINING_V1_REVISION,
      provenance: EXPERIMENTAL_CESSATION_DETRAINING_V1_PROVENANCE,
      supportedDomain: "relative-cessation-detraining-delta-shadow-only",
      availability: "available",
      estimatedSkeletalMuscleDeltaKg: 0,
      lowerBoundKg: 0,
      upperBoundKg: 0,
      state: {
        observedNoExposureStreakDays: 0,
        hadPriorQualifiedTraining: false,
        phase: "not-in-cessation",
        relativeCumulativeDeltaKg: priorCumulative,
        absoluteSkeletalMuscleKg: null,
      },
      features: {
        exposureKind: input.exposureKind,
        observedNoExposureStreakDays: 0,
        daysPastGrace: 0,
        hadPriorQualifiedTraining: false,
        phase: "not-in-cessation",
        trainingSkeletalMuscleDeltaKg: null,
        muscleMemoryBonusApplied: false,
        absoluteSkeletalMuscleKg: null,
        rejectedConversions: rejectedConversions(),
      },
      reasons,
    });
  }

  const streak = prior.observedNoExposureStreakDays + 1;
  const daysPastGrace = Math.max(0, streak - ENGINEERING_CESSATION_GRACE_DAYS_V1);

  if (daysPastGrace <= 0) {
    reasons.push("verified-cessation-day-zero-or-grace-has-no-negative-sm-step");
    reasons.push("ordinary-rest-or-grace-is-not-detraining");
    const cumulative = priorCumulative + 0;
    return finish({
      contractVersion: EXPERIMENTAL_CESSATION_DETRAINING_V1_REVISION,
      provenance: EXPERIMENTAL_CESSATION_DETRAINING_V1_PROVENANCE,
      supportedDomain: "relative-cessation-detraining-delta-shadow-only",
      availability: "available",
      estimatedSkeletalMuscleDeltaKg: 0,
      lowerBoundKg: 0,
      upperBoundKg: 0,
      state: {
        observedNoExposureStreakDays: streak,
        hadPriorQualifiedTraining: true,
        phase: "verified-rest-or-grace",
        relativeCumulativeDeltaKg: cumulative,
        absoluteSkeletalMuscleKg: null,
      },
      features: {
        exposureKind: input.exposureKind,
        observedNoExposureStreakDays: streak,
        daysPastGrace: 0,
        hadPriorQualifiedTraining: true,
        phase: "verified-rest-or-grace",
        trainingSkeletalMuscleDeltaKg: null,
        muscleMemoryBonusApplied: false,
        absoluteSkeletalMuscleKg: null,
        rejectedConversions: rejectedConversions(),
      },
      reasons,
    });
  }

  const envelope = dailyAtrophyEnvelope();
  const orderedLower = Math.min(envelope.lower, envelope.point, envelope.upper);
  const orderedUpper = Math.max(envelope.lower, envelope.point, envelope.upper);
  const orderedPoint = Math.min(Math.max(envelope.point, orderedLower), orderedUpper);
  if (orderedPoint > 0 || orderedUpper > 0) {
    throw new RangeError("detraining daily envelope must be non-positive");
  }
  reasons.push("prolonged-verified-no-exposure-applies-bounded-nonpositive-delta");
  reasons.push("engineering-atrophy-rate-not-universal-scientific-curve");
  const cumulative = priorCumulative + orderedPoint;
  return finish({
    contractVersion: EXPERIMENTAL_CESSATION_DETRAINING_V1_REVISION,
    provenance: EXPERIMENTAL_CESSATION_DETRAINING_V1_PROVENANCE,
    supportedDomain: "relative-cessation-detraining-delta-shadow-only",
    availability: "available",
    estimatedSkeletalMuscleDeltaKg: orderedPoint,
    lowerBoundKg: orderedLower,
    upperBoundKg: orderedUpper,
    state: {
      observedNoExposureStreakDays: streak,
      hadPriorQualifiedTraining: true,
      phase: "detraining",
      relativeCumulativeDeltaKg: cumulative,
      absoluteSkeletalMuscleKg: null,
    },
    features: {
      exposureKind: input.exposureKind,
      observedNoExposureStreakDays: streak,
      daysPastGrace,
      hadPriorQualifiedTraining: true,
      phase: "detraining",
      trainingSkeletalMuscleDeltaKg: null,
      muscleMemoryBonusApplied: false,
      absoluteSkeletalMuscleKg: null,
      rejectedConversions: rejectedConversions(),
    },
    reasons,
  });
}

export function rebuildExperimentalCessationDetrainingTrajectoryV1(input: {
  prior?: ExperimentalCessationStateV1 | null;
  days: readonly {
    date: string;
    exposureKind: ExperimentalTrainingExposureKindV1;
    trainingSkeletalMuscleDeltaKg?: number | null;
  }[];
}): ExperimentalCessationDetrainingResultV1[] {
  let state = input.prior ?? initialExperimentalCessationStateV1();
  const out: ExperimentalCessationDetrainingResultV1[] = [];
  for (const day of input.days) {
    const step = transitionExperimentalCessationDetrainingV1({
      exposureKind: day.exposureKind,
      prior: state,
      trainingSkeletalMuscleDeltaKg: day.trainingSkeletalMuscleDeltaKg,
    });
    out.push(step);
    state = step.state;
  }
  return out;
}

export function experimentalCessationDetrainingV1Fingerprint(
  result: Omit<ExperimentalCessationDetrainingResultV1, "fingerprint"> & {
    fingerprint?: string;
  },
): string {
  const rest = { ...result };
  delete rest.fingerprint;
  return stableSha256(rest);
}
