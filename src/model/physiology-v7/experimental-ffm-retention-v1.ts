import { partitionEnergyBalance } from "@/model/body-composition/partition";
import type { ExperimentalTrainingExposureKindV1 } from "@/model/physiology-v7/experimental-skeletal-muscle-delta-v1";
import { stableSha256 } from "@/modules/model-recovery/recovery-fingerprint";

/**
 * Experimental FFM Retention V1 (shadow / EXPERIMENTAL only).
 *
 * Bounded relative fat-free / slow-nonfat retention modifier during energy
 * deficit from observed protein intake and verified resistance-training
 * exposure. Hall/Forbes FatWeightShadowV1 mean is reference context only —
 * this module never rewrites production fat/lean state.
 *
 * Not skeletalMuscleKg. Not production TDEE / forecast / GREEN.
 */
export const EXPERIMENTAL_FFM_RETENTION_V1_REVISION =
  "experimental-ffm-retention-v1" as const;

export const EXPERIMENTAL_FFM_RETENTION_V1_PROVENANCE =
  "experimental-heuristic" as const;

/**
 * Literature-informed engineering protein adequacy window (g/kg).
 * Floor/plateau span the E-D01 population range and E-D05/E-D06 deficit
 * contrasts (≈1.0–1.2 vs 2.3–2.4). Not a 1.62 switch. P-D02 DEFERS the curve.
 */
export const LITERATURE_INFORMED_FFM_PROTEIN_WINDOW_G_PER_KG_V1 = {
  floorGPerKg: 0.8,
  plateauGPerKg: 2.2,
  classification: "literature-informed-engineering-window-not-personal-switch" as const,
  evidenceIds: ["E-D01", "E-D04", "E-D05", "E-D06", "E-D10"] as const,
} as const;

/** Engineering mix weights for the dimensionless retention modifier. P-D02/P-E02 DEFER magnitude. */
export const ENGINEERING_FFM_RETENTION_WEIGHTS_V1 = {
  protein: 0.35,
  resistanceTraining: 0.4,
  classification: "engineering-order-of-magnitude-weights" as const,
} as const;

/**
 * Engineering deficit-severity reference (kcal/day). ~40% severe-trial context
 * (E-D05/E-D06) is not a production cutoff. Deeper deficit must not improve retention.
 */
export const ENGINEERING_FFM_DEFICIT_REFERENCE_KCAL_V1 = 1000 as const;
export const ENGINEERING_FFM_DEFICIT_CAPACITY_SLOPE_V1 = 0.35 as const;

/** Never claim complete FFM preservation or muscle gain. */
export const ENGINEERING_MAX_FFM_RETENTION_EFFECT_V1 = 0.85 as const;
export const ENGINEERING_FFM_RETENTION_LOWER_SCALE_V1 = 0.25 as const;
export const ENGINEERING_FFM_RETENTION_UPPER_PAD_V1 = 0.2 as const;

export const EXPERIMENTAL_FFM_RETENTION_PRIORS_V1 = {
  proteinWindowGPerKg: LITERATURE_INFORMED_FFM_PROTEIN_WINDOW_G_PER_KG_V1,
  mixWeights: ENGINEERING_FFM_RETENTION_WEIGHTS_V1,
  deficitReferenceKcal: {
    value: ENGINEERING_FFM_DEFICIT_REFERENCE_KCAL_V1,
    slope: ENGINEERING_FFM_DEFICIT_CAPACITY_SLOPE_V1,
    classification: "engineering" as const,
    scientificDecision: "deferred-by-P-D02-and-P-E01",
  },
  maxRetentionEffect: {
    value: ENGINEERING_MAX_FFM_RETENTION_EFFECT_V1,
    classification: "engineering" as const,
  },
  proteinDoesNotWorsenRetention: {
    classification: "scientific-ordering" as const,
    evidenceIds: ["E-D04", "E-D05", "E-D06", "E-D07", "E-D10"] as const,
    claimIds: ["C-D02"] as const,
  },
  deeperDeficitDoesNotImproveRetention: {
    classification: "scientific-ordering" as const,
    evidenceIds: ["E-E01", "E-E04"] as const,
  },
  resistanceTrainingDoesNotWorsenFfmRetention: {
    classification: "scientific-ordering" as const,
    evidenceIds: ["E-E02"] as const,
    claimIds: ["C-E03"] as const,
  },
  missingInputsAreNotZero: {
    classification: "scientific-input-contract" as const,
  },
  hallForbesMeanIsReferenceOnly: {
    classification: "engineering-reference-context" as const,
    scientificDecision: "do-not-rewrite-production-fat-lean-state",
  },
} as const;

export type ExperimentalFfmRetentionAvailabilityV1 = "available" | "unavailable";

export type ExperimentalFfmRetentionUnavailableReasonV1 =
  | "missing-energy-balance"
  | "missing-protein"
  | "missing-training-exposure"
  | "non-finite-inputs";

export type ExperimentalFfmRetentionBoundV1 = {
  lower: number | null;
  point: number | null;
  upper: number | null;
};

export type ExperimentalFfmRetentionResultV1 = {
  contractVersion: typeof EXPERIMENTAL_FFM_RETENTION_V1_REVISION;
  provenance: typeof EXPERIMENTAL_FFM_RETENTION_V1_PROVENANCE;
  supportedDomain: "relative-ffm-slow-nonfat-retention-shadow-only";
  availability: ExperimentalFfmRetentionAvailabilityV1;
  unavailableReason: ExperimentalFfmRetentionUnavailableReasonV1 | null;
  /** Dimensionless FFM/slow-nonfat retention modifier in [0, max]. Not skeletalMuscleKg. */
  retentionEffect: ExperimentalFfmRetentionBoundV1;
  /**
   * Optional kg of Hall/Forbes slow-nonfat loss spared vs unmodified mean.
   * Null when fat-mass reference is absent. Never written back to FatWeightShadowV1.
   */
  relativeSlowNonFatLossDifferenceKg: ExperimentalFfmRetentionBoundV1;
  hallForbesUnmodifiedSlowNonFatDeltaKg: number | null;
  skeletalMuscleKg: null;
  muscleGainGuaranteed: false;
  features: {
    energyBalanceKcal: number | null;
    proteinGPerKg: number | null;
    proteinAdequacy: number | null;
    trainingExposureKind: ExperimentalTrainingExposureKindV1 | null;
    resistanceTrainingScale: number | null;
    deficitSeverity: number | null;
    deficitRetentionCapacity: number | null;
    inDeficit: boolean | null;
    hallForbesMeanUnchanged: true;
    absoluteSkeletalMuscleKg: null;
    rejectedConversions: readonly [
      "lean-to-skeletalMuscleKg",
      "ffm-to-skeletalMuscleKg",
      "bia-dxa-as-ffm-truth",
      "scale-weight-residual-fit",
      "hall-forbes-production-rewrite",
      "protein-without-observed-intake",
      "rt-without-observed-exposure",
      "surplus-required-for-retention",
      "guaranteed-muscle-gain",
    ];
  };
  reasons: string[];
  fingerprint: string;
};

function rejectedConversions(): ExperimentalFfmRetentionResultV1["features"]["rejectedConversions"] {
  return [
    "lean-to-skeletalMuscleKg",
    "ffm-to-skeletalMuscleKg",
    "bia-dxa-as-ffm-truth",
    "scale-weight-residual-fit",
    "hall-forbes-production-rewrite",
    "protein-without-observed-intake",
    "rt-without-observed-exposure",
    "surplus-required-for-retention",
    "guaranteed-muscle-gain",
  ] as const;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function finiteOrThrow(name: string, value: number): number {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite`);
  return Object.is(value, -0) ? 0 : value;
}

/**
 * Monotonic protein adequacy in [0, 1]. Higher intake never lowers the scale.
 * Plateau is not a personal switch.
 */
export function engineeringFfmProteinAdequacyV1(proteinGPerKg: number): number {
  const protein = finiteOrThrow("proteinGPerKg", proteinGPerKg);
  if (protein < 0) throw new RangeError("proteinGPerKg must be nonnegative");
  const { floorGPerKg, plateauGPerKg } = LITERATURE_INFORMED_FFM_PROTEIN_WINDOW_G_PER_KG_V1;
  if (protein <= floorGPerKg) return 0;
  if (protein >= plateauGPerKg) return 1;
  return (protein - floorGPerKg) / (plateauGPerKg - floorGPerKg);
}

function boundRetention(point: number): ExperimentalFfmRetentionBoundV1 {
  const clampedPoint = clamp(point, 0, ENGINEERING_MAX_FFM_RETENTION_EFFECT_V1);
  const lower = clamp(
    clampedPoint * ENGINEERING_FFM_RETENTION_LOWER_SCALE_V1,
    0,
    clampedPoint,
  );
  const upper = clamp(
    clampedPoint + ENGINEERING_FFM_RETENTION_UPPER_PAD_V1,
    clampedPoint,
    ENGINEERING_MAX_FFM_RETENTION_EFFECT_V1,
  );
  return { lower, point: clampedPoint, upper };
}

function emptyBound(): ExperimentalFfmRetentionBoundV1 {
  return { lower: null, point: null, upper: null };
}

function finish(
  partial: Omit<ExperimentalFfmRetentionResultV1, "fingerprint">,
): ExperimentalFfmRetentionResultV1 {
  const result: ExperimentalFfmRetentionResultV1 = { ...partial, fingerprint: "" };
  result.fingerprint = experimentalFfmRetentionV1Fingerprint(result);
  return result;
}

function unavailable(
  reason: ExperimentalFfmRetentionUnavailableReasonV1,
  features: ExperimentalFfmRetentionResultV1["features"],
  extraReasons: string[],
): ExperimentalFfmRetentionResultV1 {
  return finish({
    contractVersion: EXPERIMENTAL_FFM_RETENTION_V1_REVISION,
    provenance: EXPERIMENTAL_FFM_RETENTION_V1_PROVENANCE,
    supportedDomain: "relative-ffm-slow-nonfat-retention-shadow-only",
    availability: "unavailable",
    unavailableReason: reason,
    retentionEffect: emptyBound(),
    relativeSlowNonFatLossDifferenceKg: emptyBound(),
    hallForbesUnmodifiedSlowNonFatDeltaKg: null,
    skeletalMuscleKg: null,
    muscleGainGuaranteed: false,
    features,
    reasons: [
      "experimental-heuristic-ffm-retention",
      "absolute-skeletalMuscleKg-intentionally-unavailable",
      "hall-forbes-production-state-not-rewritten",
      ...extraReasons,
    ],
  });
}

function hallForbesReferenceDeltaKg(
  energyBalanceKcal: number,
  fatMassKg: number | null | undefined,
): number | null {
  if (fatMassKg == null || !(fatMassKg > 0) || !Number.isFinite(fatMassKg)) return null;
  try {
    return partitionEnergyBalance({
      availableEnergyKcal: energyBalanceKcal,
      fatMassKg,
    }).deltaLeanTissueKg;
  } catch {
    return null;
  }
}

function sparedLossBound(
  hallDeltaKg: number | null,
  retention: ExperimentalFfmRetentionBoundV1,
): ExperimentalFfmRetentionBoundV1 {
  if (hallDeltaKg == null || hallDeltaKg >= 0) return emptyBound();
  const lossKg = -hallDeltaKg;
  return {
    lower: lossKg * (retention.lower ?? 0),
    point: lossKg * (retention.point ?? 0),
    upper: lossKg * (retention.upper ?? 0),
  };
}

/**
 * One-day experimental FFM / slow-nonfat retention estimate.
 * Hall/Forbes mean is read-only reference context.
 */
export function estimateExperimentalFfmRetentionV1(input: {
  energyBalanceKcal: number | null;
  proteinGPerKg: number | null;
  trainingExposureKind: ExperimentalTrainingExposureKindV1 | null;
  hallForbesReferenceFatMassKg?: number | null;
  leanMassKg?: number | null;
  biaOrDxaFfmKg?: number | null;
  scaleWeightResidualKg?: number | null;
  skeletalMuscleKg?: number | null;
}): ExperimentalFfmRetentionResultV1 {
  const reasons = [
    "experimental-heuristic-ffm-retention",
    "absolute-skeletalMuscleKg-intentionally-unavailable",
    "hall-forbes-production-state-not-rewritten",
    "muscle-gain-not-guaranteed",
  ];
  if (input.leanMassKg != null) reasons.push("lean-mass-not-converted-to-skeletalMuscleKg");
  if (input.biaOrDxaFfmKg != null) reasons.push("bia-dxa-ffm-ignored-as-truth");
  if (input.scaleWeightResidualKg != null) reasons.push("scale-weight-residual-not-fitted");
  if (input.skeletalMuscleKg != null) reasons.push("input-skeletalMuscleKg-ignored");

  const baseFeatures = {
    energyBalanceKcal: input.energyBalanceKcal,
    proteinGPerKg: input.proteinGPerKg,
    proteinAdequacy: null as number | null,
    trainingExposureKind: input.trainingExposureKind,
    resistanceTrainingScale: null as number | null,
    deficitSeverity: null as number | null,
    deficitRetentionCapacity: null as number | null,
    inDeficit: null as boolean | null,
    hallForbesMeanUnchanged: true as const,
    absoluteSkeletalMuscleKg: null,
    rejectedConversions: rejectedConversions(),
  };

  if (input.energyBalanceKcal === null) {
    return unavailable("missing-energy-balance", baseFeatures, [
      ...reasons,
      "missing-energy-balance-is-not-zero-or-neutral",
    ]);
  }
  if (input.proteinGPerKg === null) {
    return unavailable("missing-protein", baseFeatures, [
      ...reasons,
      "missing-protein-is-not-zero",
    ]);
  }
  if (
    input.trainingExposureKind === null
    || input.trainingExposureKind === "unresolved-missing-training"
  ) {
    return unavailable("missing-training-exposure", baseFeatures, [
      ...reasons,
      "missing-training-exposure-is-not-diet-only-zero",
    ]);
  }

  const energy = finiteOrThrow("energyBalanceKcal", input.energyBalanceKcal);
  const proteinAdequacy = engineeringFfmProteinAdequacyV1(input.proteinGPerKg);
  const rtScale = input.trainingExposureKind === "qualified-mapped-training" ? 1 : 0;
  const inDeficit = energy < 0;
  const deficitSeverity = inDeficit
    ? clamp(-energy / ENGINEERING_FFM_DEFICIT_REFERENCE_KCAL_V1, 0, 1)
    : 0;
  const deficitRetentionCapacity = inDeficit
    ? 1 - ENGINEERING_FFM_DEFICIT_CAPACITY_SLOPE_V1 * deficitSeverity
    : 0;

  const raw = inDeficit
    ? (
      ENGINEERING_FFM_RETENTION_WEIGHTS_V1.protein * proteinAdequacy
      + ENGINEERING_FFM_RETENTION_WEIGHTS_V1.resistanceTraining * rtScale
    ) * deficitRetentionCapacity
    : 0;
  const retentionEffect = boundRetention(raw);
  const hallDelta = hallForbesReferenceDeltaKg(energy, input.hallForbesReferenceFatMassKg);
  if (hallDelta != null) reasons.push("hall-forbes-mean-used-as-reference-context-only");
  if (!inDeficit) reasons.push("retention-effect-is-deficit-construct-surplus-not-required");
  if (rtScale === 1) reasons.push("verified-resistance-training-may-improve-ffm-retention-vs-diet-only");
  else reasons.push("verified-no-exposure-is-diet-only-retention");
  reasons.push("higher-protein-does-not-worsen-deficit-retention");
  reasons.push("deeper-deficit-does-not-improve-retention");

  return finish({
    contractVersion: EXPERIMENTAL_FFM_RETENTION_V1_REVISION,
    provenance: EXPERIMENTAL_FFM_RETENTION_V1_PROVENANCE,
    supportedDomain: "relative-ffm-slow-nonfat-retention-shadow-only",
    availability: "available",
    unavailableReason: null,
    retentionEffect,
    relativeSlowNonFatLossDifferenceKg: sparedLossBound(hallDelta, retentionEffect),
    hallForbesUnmodifiedSlowNonFatDeltaKg: hallDelta,
    skeletalMuscleKg: null,
    muscleGainGuaranteed: false,
    features: {
      ...baseFeatures,
      proteinAdequacy,
      resistanceTrainingScale: rtScale,
      deficitSeverity,
      deficitRetentionCapacity,
      inDeficit,
    },
    reasons,
  });
}

export function rebuildExperimentalFfmRetentionTrajectoryV1(input: {
  days: readonly {
    date: string;
    energyBalanceKcal: number | null;
    proteinGPerKg: number | null;
    trainingExposureKind: ExperimentalTrainingExposureKindV1 | null;
    hallForbesReferenceFatMassKg?: number | null;
  }[];
}): ExperimentalFfmRetentionResultV1[] {
  return input.days.map((day) => estimateExperimentalFfmRetentionV1({
    energyBalanceKcal: day.energyBalanceKcal,
    proteinGPerKg: day.proteinGPerKg,
    trainingExposureKind: day.trainingExposureKind,
    hallForbesReferenceFatMassKg: day.hallForbesReferenceFatMassKg,
  }));
}

export function experimentalFfmRetentionV1Fingerprint(
  result: Omit<ExperimentalFfmRetentionResultV1, "fingerprint"> & {
    fingerprint?: string;
  },
): string {
  const rest = { ...result };
  delete rest.fingerprint;
  return stableSha256(rest);
}
