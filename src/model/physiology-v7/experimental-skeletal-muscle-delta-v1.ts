import { stableSha256 } from "@/modules/model-recovery/recovery-fingerprint";

/**
 * Experimental Skeletal Muscle Delta V1 (shadow / EXPERIMENTAL only).
 *
 * Bounded relative skeletal-muscle change from resistance-training stimulus.
 * Uses monthly adaptation-rate envelopes converted to a daily transition with a
 * saturating dose scale. Absolute skeletalMuscleKg remains unavailable unless a
 * defensible baseline is supplied; otherwise only cumulative relative delta.
 *
 * Not production TDEE / forecast / validated v7 semantics / GREEN validation.
 */
export const EXPERIMENTAL_SKELETAL_MUSCLE_DELTA_V1_REVISION =
  "experimental-skeletal-muscle-delta-v1" as const;

export const EXPERIMENTAL_SKELETAL_MUSCLE_DELTA_V1_PROVENANCE =
  "experimental-heuristic" as const;

export const DAYS_PER_MONTH_V1 = 30.437 as const;

/** ENGINEERING saturating τ for daily qualified hard-set count. */
export const ENGINEERING_DAILY_HARD_SET_SCALE_TAU_V1 = 10 as const;

/**
 * Literature-informed monthly whole-body skeletal-muscle rate envelopes (kg/month).
 * Not personal validated rates (C-B02). Classification: literature-informed
 * engineering order-of-magnitude priors with wide uncertainty.
 */
export const EXPERIMENTAL_MONTHLY_SM_RATE_KG_V1 = {
  novice: {
    lowerKgPerMonth: 0.05,
    pointKgPerMonth: 0.25,
    upperKgPerMonth: 0.6,
  },
  intermediate: {
    lowerKgPerMonth: 0.0,
    pointKgPerMonth: 0.12,
    upperKgPerMonth: 0.35,
  },
  advanced: {
    lowerKgPerMonth: -0.05,
    pointKgPerMonth: 0.05,
    upperKgPerMonth: 0.2,
  },
  unknown: {
    lowerKgPerMonth: -0.05,
    pointKgPerMonth: 0.1,
    upperKgPerMonth: 0.5,
  },
  classification: "literature-informed-engineering-order-of-magnitude-band" as const,
  evidenceIds: ["E-B01", "E-B04", "E-B05", "E-A01"] as const,
  scientificNote:
    "Status shifts a group prior with wide bands; categories do not determine exact personal kg/month.",
} as const;

/** Max |daily| SM change — blocks impossible jumps. */
export const ENGINEERING_MAX_ABS_DAILY_SM_DELTA_KG_V1 = 0.04 as const;

export type ExperimentalTrainingStatusV1 =
  | "novice"
  | "intermediate"
  | "advanced"
  | "unknown";

export type ExperimentalTrainingExposureKindV1 =
  | "qualified-mapped-training"
  | "verified-no-exposure"
  | "unresolved-missing-training";

export type ExperimentalSkeletalMuscleDeltaAvailabilityV1 =
  | "available"
  | "unavailable";

export type ExperimentalSkeletalMuscleDeltaUnavailableReasonV1 =
  | "missing-training-exposure"
  | "missing-protein"
  | "missing-energy-balance"
  | "non-finite-inputs";

export type ExperimentalSkeletalMuscleDeltaFeaturesV1 = {
  qualifiedHardSetCount: number | null;
  mappedMuscleGroupCount: number | null;
  trainingStatus: ExperimentalTrainingStatusV1;
  trainingExposureKind: ExperimentalTrainingExposureKindV1;
  proteinGPerKg: number | null;
  energyBalanceKcal: number | null;
  bodyMassKg: number | null;
  doseScale: number;
  proteinScale: number | null;
  energyScale: number | null;
  monthlyRatePointKg: number | null;
  absoluteSkeletalMuscleKg: null;
  relativeCumulativeDeltaKg: number | null;
  rejectedConversions: readonly [
    "acute-mps-to-kg",
    "strength-to-kg",
    "lean-mass-to-skeletalMuscleKg",
    "bia-dxa-ultrasound-as-sm-truth",
    "scale-weight-residual",
    "novelty-tissue-bonus",
    "muscle-memory-numeric-bonus",
    "protein-timing-coefficient",
    "linear-kcal-to-muscle",
    "symmetric-deficit-surplus-multiplier",
  ];
};

export type ExperimentalSkeletalMuscleDeltaResultV1 = {
  contractVersion: typeof EXPERIMENTAL_SKELETAL_MUSCLE_DELTA_V1_REVISION;
  provenance: typeof EXPERIMENTAL_SKELETAL_MUSCLE_DELTA_V1_PROVENANCE;
  supportedDomain: "relative-skeletal-muscle-delta-shadow-only";
  availability: ExperimentalSkeletalMuscleDeltaAvailabilityV1;
  estimatedSkeletalMuscleDeltaKg: number | null;
  lowerBoundKg: number | null;
  upperBoundKg: number | null;
  unavailableReason: ExperimentalSkeletalMuscleDeltaUnavailableReasonV1 | null;
  state: {
    absoluteSkeletalMuscleKg: null;
    relativeCumulativeDeltaKg: number | null;
  };
  features: ExperimentalSkeletalMuscleDeltaFeaturesV1;
  reasons: string[];
  fingerprint: string;
};

function rejectedConversions(): ExperimentalSkeletalMuscleDeltaFeaturesV1["rejectedConversions"] {
  return [
    "acute-mps-to-kg",
    "strength-to-kg",
    "lean-mass-to-skeletalMuscleKg",
    "bia-dxa-ultrasound-as-sm-truth",
    "scale-weight-residual",
    "novelty-tissue-bonus",
    "muscle-memory-numeric-bonus",
    "protein-timing-coefficient",
    "linear-kcal-to-muscle",
    "symmetric-deficit-surplus-multiplier",
  ] as const;
}

function finiteOrThrow(name: string, value: number): number {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite`);
  return Object.is(value, -0) ? 0 : value;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function engineeringDailyHardSetScaleV1(qualifiedHardSetCount: number): number {
  if (!(qualifiedHardSetCount > 0)) return 0;
  return 1 - Math.exp(-qualifiedHardSetCount / ENGINEERING_DAILY_HARD_SET_SCALE_TAU_V1);
}

/**
 * Protein modifier in [0.55, 1]. Higher protein never lowers the scale (C-D01).
 * Not a hard 1.62 switch.
 */
export function engineeringProteinScaleV1(proteinGPerKg: number): number {
  if (!(proteinGPerKg >= 0) || !Number.isFinite(proteinGPerKg)) {
    throw new RangeError("proteinGPerKg must be finite and nonnegative");
  }
  if (proteinGPerKg < 0.8) return 0.55;
  if (proteinGPerKg < 1.2) return 0.7;
  if (proteinGPerKg < 1.6) return 0.88;
  return 1;
}

/**
 * Energy modifier — asymmetric (C-E06). Larger deficit does not improve gain (C-E01).
 * Surplus boost is bounded (C-E05). Maintenance need not force zero (C-E04).
 */
export function engineeringEnergyScaleV1(energyBalanceKcal: number): {
  pointScale: number;
  lowerScale: number;
  upperScale: number;
} {
  if (!Number.isFinite(energyBalanceKcal)) {
    throw new RangeError("energyBalanceKcal must be finite");
  }
  if (energyBalanceKcal <= -750) {
    return { pointScale: 0.45, lowerScale: 0.25, upperScale: 0.7 };
  }
  if (energyBalanceKcal <= -250) {
    return { pointScale: 0.7, lowerScale: 0.45, upperScale: 0.95 };
  }
  if (energyBalanceKcal < 250) {
    return { pointScale: 1, lowerScale: 0.85, upperScale: 1.1 };
  }
  if (energyBalanceKcal < 750) {
    return { pointScale: 1.08, lowerScale: 0.95, upperScale: 1.2 };
  }
  // Large surplus: bounded, not linear kcal→muscle.
  return { pointScale: 1.12, lowerScale: 1.0, upperScale: 1.25 };
}

function monthlyRates(status: ExperimentalTrainingStatusV1) {
  return EXPERIMENTAL_MONTHLY_SM_RATE_KG_V1[status];
}

function clampDaily(deltaKg: number): number {
  return clamp(
    finiteOrThrow("deltaKg", deltaKg),
    -ENGINEERING_MAX_ABS_DAILY_SM_DELTA_KG_V1,
    ENGINEERING_MAX_ABS_DAILY_SM_DELTA_KG_V1,
  );
}

/**
 * Estimate one-day relative skeletal-muscle delta (kg).
 */
export function estimateExperimentalSkeletalMuscleDeltaV1(input: {
  /** Qualified hard sets today; null = unresolved training (≠ rest/zero). */
  qualifiedHardSetCount: number | null;
  mappedMuscleGroupCount?: number | null;
  /** verified-no-exposure when workout feed observed no RT. */
  trainingExposureKind: ExperimentalTrainingExposureKindV1;
  trainingStatus?: ExperimentalTrainingStatusV1;
  /** g/kg/day; null = missing ≠ 0. */
  proteinGPerKg: number | null;
  energyBalanceKcal: number | null;
  bodyMassKg?: number | null;
  /** Explicitly ignored / rejected inputs. */
  acuteMpsPercent?: number | null;
  strengthDelta?: number | null;
  leanMassKg?: number | null;
  biaOrDxaSkeletalMuscleKg?: number | null;
  programNoveltyBonus?: number | null;
  muscleMemoryBonus?: number | null;
  proteinTimingCoefficient?: number | null;
  priorRelativeCumulativeDeltaKg?: number | null;
}): ExperimentalSkeletalMuscleDeltaResultV1 {
  const trainingStatus = input.trainingStatus ?? "unknown";
  const mappedMuscleGroupCount = input.mappedMuscleGroupCount === undefined
    ? null
    : input.mappedMuscleGroupCount;
  const bodyMassKg = input.bodyMassKg === undefined ? null : input.bodyMassKg;
  const priorCumulative = input.priorRelativeCumulativeDeltaKg === undefined
    ? 0
    : input.priorRelativeCumulativeDeltaKg;

  const baseFeatures: ExperimentalSkeletalMuscleDeltaFeaturesV1 = {
    qualifiedHardSetCount: input.qualifiedHardSetCount,
    mappedMuscleGroupCount,
    trainingStatus,
    trainingExposureKind: input.trainingExposureKind,
    proteinGPerKg: input.proteinGPerKg,
    energyBalanceKcal: input.energyBalanceKcal,
    bodyMassKg,
    doseScale: 0,
    proteinScale: null,
    energyScale: null,
    monthlyRatePointKg: null,
    absoluteSkeletalMuscleKg: null,
    relativeCumulativeDeltaKg: priorCumulative,
    rejectedConversions: rejectedConversions(),
  };

  const reasons: string[] = [
    "experimental-heuristic-monthly-rate-to-daily-transition",
    "absolute-skeletalMuscleKg-intentionally-unavailable",
    "acute-mps-to-kg-intentionally-rejected",
    "strength-to-kg-intentionally-rejected",
    "lean-mass-to-skeletalMuscleKg-intentionally-rejected",
    "bia-dxa-ultrasound-as-sm-truth-intentionally-rejected",
    "scale-weight-residual-intentionally-rejected",
    "novelty-tissue-bonus-intentionally-rejected",
    "muscle-memory-numeric-bonus-intentionally-rejected",
    "protein-timing-coefficient-intentionally-rejected",
  ];

  if (input.acuteMpsPercent != null) reasons.push("acute-mps-context-ignored");
  if (input.strengthDelta != null) reasons.push("strength-delta-context-ignored");
  if (input.leanMassKg != null) reasons.push("lean-mass-context-ignored");
  if (input.biaOrDxaSkeletalMuscleKg != null) reasons.push("bia-dxa-context-ignored");
  if (input.programNoveltyBonus != null && input.programNoveltyBonus !== 0) {
    reasons.push("novelty-bonus-ignored");
  }
  if (input.muscleMemoryBonus != null && input.muscleMemoryBonus !== 0) {
    reasons.push("muscle-memory-bonus-ignored");
  }
  if (input.proteinTimingCoefficient != null) {
    reasons.push("protein-timing-coefficient-ignored");
  }

  if (input.trainingExposureKind === "unresolved-missing-training"
      || (input.qualifiedHardSetCount === null
        && input.trainingExposureKind !== "verified-no-exposure")) {
    return unavailable("missing-training-exposure", baseFeatures, reasons, priorCumulative);
  }
  if (input.proteinGPerKg === null) {
    return unavailable("missing-protein", baseFeatures, [
      ...reasons,
      "missing-protein-is-not-zero",
    ], priorCumulative);
  }
  if (input.energyBalanceKcal === null) {
    return unavailable("missing-energy-balance", baseFeatures, [
      ...reasons,
      "missing-energy-balance-is-not-zero-or-neutral",
    ], priorCumulative);
  }

  if (input.qualifiedHardSetCount !== null
      && (!Number.isFinite(input.qualifiedHardSetCount) || input.qualifiedHardSetCount < 0)) {
    throw new RangeError("qualifiedHardSetCount must be finite and nonnegative when provided");
  }
  if (!Number.isFinite(input.proteinGPerKg) || input.proteinGPerKg < 0) {
    throw new RangeError("proteinGPerKg must be finite and nonnegative when provided");
  }
  if (mappedMuscleGroupCount !== null
      && (!Number.isFinite(mappedMuscleGroupCount) || mappedMuscleGroupCount < 0)) {
    throw new RangeError("mappedMuscleGroupCount must be finite and nonnegative when provided");
  }
  if (bodyMassKg !== null && (!Number.isFinite(bodyMassKg) || bodyMassKg <= 0)) {
    throw new RangeError("bodyMassKg must be finite and positive when provided");
  }
  if (priorCumulative !== null && !Number.isFinite(priorCumulative)) {
    throw new RangeError("priorRelativeCumulativeDeltaKg must be finite when provided");
  }

  const rates = monthlyRates(trainingStatus);
  const proteinScale = engineeringProteinScaleV1(input.proteinGPerKg);
  const energy = engineeringEnergyScaleV1(input.energyBalanceKcal);

  // Verified no exposure / rest: no same-day cessation atrophy step (C-C01).
  if (input.trainingExposureKind === "verified-no-exposure"
      || (input.qualifiedHardSetCount ?? 0) <= 0) {
    const zero = 0;
    const cumulative = (priorCumulative ?? 0) + zero;
    reasons.push("verified-no-exposure-zero-delta-not-same-day-atrophy");
    reasons.push("training-status-shifts-prior-without-exact-kg-rate");
    const result: ExperimentalSkeletalMuscleDeltaResultV1 = {
      contractVersion: EXPERIMENTAL_SKELETAL_MUSCLE_DELTA_V1_REVISION,
      provenance: EXPERIMENTAL_SKELETAL_MUSCLE_DELTA_V1_PROVENANCE,
      supportedDomain: "relative-skeletal-muscle-delta-shadow-only",
      availability: "available",
      estimatedSkeletalMuscleDeltaKg: zero,
      lowerBoundKg: zero,
      upperBoundKg: zero,
      unavailableReason: null,
      state: {
        absoluteSkeletalMuscleKg: null,
        relativeCumulativeDeltaKg: cumulative,
      },
      features: {
        ...baseFeatures,
        qualifiedHardSetCount: input.qualifiedHardSetCount ?? 0,
        doseScale: 0,
        proteinScale,
        energyScale: energy.pointScale,
        monthlyRatePointKg: rates.pointKgPerMonth,
        relativeCumulativeDeltaKg: cumulative,
      },
      reasons,
      fingerprint: "",
    };
    result.fingerprint = experimentalSkeletalMuscleDeltaV1Fingerprint(result);
    return result;
  }

  const sets = input.qualifiedHardSetCount!;
  const doseScale = engineeringDailyHardSetScaleV1(sets);
  // Missing mapped exposure widens uncertainty only (not a per-group kg coefficient).
  const mappingWiden = mappedMuscleGroupCount !== null && mappedMuscleGroupCount > 0
    ? 1
    : 1.15;

  const dailyPointBase = rates.pointKgPerMonth / DAYS_PER_MONTH_V1;
  const dailyLowerBase = rates.lowerKgPerMonth / DAYS_PER_MONTH_V1;
  const dailyUpperBase = rates.upperKgPerMonth / DAYS_PER_MONTH_V1;

  const point = clampDaily(dailyPointBase * doseScale * proteinScale * energy.pointScale);
  let lower = clampDaily(dailyLowerBase * doseScale * proteinScale * energy.lowerScale);
  let upper = clampDaily(dailyUpperBase * doseScale * proteinScale * energy.upperScale);
  if (mappingWiden > 1) {
    lower = clampDaily(point - (point - lower) * mappingWiden);
    upper = clampDaily(point + (upper - point) * mappingWiden);
  }

  // Ensure ordered bounds; advanced/unknown lower can be negative.
  const orderedLower = Math.min(lower, point, upper);
  const orderedUpper = Math.max(lower, point, upper);
  const orderedPoint = Math.min(Math.max(point, orderedLower), orderedUpper);

  const cumulative = (priorCumulative ?? 0) + orderedPoint;
  reasons.push("dose-saturating-monthly-rate-daily-transition");
  reasons.push("training-status-shifts-prior-without-exact-kg-rate");
  reasons.push("protein-scale-non-worsening-with-intake");
  reasons.push("energy-scale-asymmetric-deficit-surplus");
  reasons.push("daily-change-clamped-against-impossible-jumps");

  const result: ExperimentalSkeletalMuscleDeltaResultV1 = {
    contractVersion: EXPERIMENTAL_SKELETAL_MUSCLE_DELTA_V1_REVISION,
    provenance: EXPERIMENTAL_SKELETAL_MUSCLE_DELTA_V1_PROVENANCE,
    supportedDomain: "relative-skeletal-muscle-delta-shadow-only",
    availability: "available",
    estimatedSkeletalMuscleDeltaKg: orderedPoint,
    lowerBoundKg: orderedLower,
    upperBoundKg: orderedUpper,
    unavailableReason: null,
    state: {
      absoluteSkeletalMuscleKg: null,
      relativeCumulativeDeltaKg: cumulative,
    },
    features: {
      ...baseFeatures,
      qualifiedHardSetCount: sets,
      doseScale,
      proteinScale,
      energyScale: energy.pointScale,
      monthlyRatePointKg: rates.pointKgPerMonth,
      relativeCumulativeDeltaKg: cumulative,
    },
    reasons,
    fingerprint: "",
  };
  result.fingerprint = experimentalSkeletalMuscleDeltaV1Fingerprint(result);
  return result;
}

function unavailable(
  reason: ExperimentalSkeletalMuscleDeltaUnavailableReasonV1,
  features: ExperimentalSkeletalMuscleDeltaFeaturesV1,
  reasons: string[],
  priorCumulative: number | null,
): ExperimentalSkeletalMuscleDeltaResultV1 {
  const result: ExperimentalSkeletalMuscleDeltaResultV1 = {
    contractVersion: EXPERIMENTAL_SKELETAL_MUSCLE_DELTA_V1_REVISION,
    provenance: EXPERIMENTAL_SKELETAL_MUSCLE_DELTA_V1_PROVENANCE,
    supportedDomain: "relative-skeletal-muscle-delta-shadow-only",
    availability: "unavailable",
    estimatedSkeletalMuscleDeltaKg: null,
    lowerBoundKg: null,
    upperBoundKg: null,
    unavailableReason: reason,
    state: {
      absoluteSkeletalMuscleKg: null,
      relativeCumulativeDeltaKg: priorCumulative,
    },
    features: {
      ...features,
      relativeCumulativeDeltaKg: priorCumulative,
    },
    reasons: [...reasons, `${reason}-is-not-zero-delta`],
    fingerprint: "",
  };
  result.fingerprint = experimentalSkeletalMuscleDeltaV1Fingerprint(result);
  return result;
}

/** Deterministic multi-day relative trajectory rebuild. */
export function rebuildExperimentalSkeletalMuscleDeltaTrajectoryV1(input: {
  priorRelativeCumulativeDeltaKg?: number;
  days: readonly {
    date: string;
    qualifiedHardSetCount: number | null;
    mappedMuscleGroupCount?: number | null;
    trainingExposureKind: ExperimentalTrainingExposureKindV1;
    trainingStatus?: ExperimentalTrainingStatusV1;
    proteinGPerKg: number | null;
    energyBalanceKcal: number | null;
    bodyMassKg?: number | null;
  }[];
}): ExperimentalSkeletalMuscleDeltaResultV1[] {
  let cumulative = input.priorRelativeCumulativeDeltaKg ?? 0;
  const out: ExperimentalSkeletalMuscleDeltaResultV1[] = [];
  for (const day of input.days) {
    const step = estimateExperimentalSkeletalMuscleDeltaV1({
      ...day,
      priorRelativeCumulativeDeltaKg: cumulative,
    });
    out.push(step);
    if (step.availability === "available" && step.state.relativeCumulativeDeltaKg !== null) {
      cumulative = step.state.relativeCumulativeDeltaKg;
    }
  }
  return out;
}

export function experimentalSkeletalMuscleDeltaV1Fingerprint(
  result: Omit<ExperimentalSkeletalMuscleDeltaResultV1, "fingerprint"> & {
    fingerprint?: string;
  },
): string {
  const rest = { ...result };
  delete rest.fingerprint;
  return stableSha256(rest);
}
