import {
  FAT_WEIGHT_SHADOW_V1_VERSION,
  transitionFatWeightShadowV1,
  type FatWeightShadowStateV1,
} from "@/model/physiology-v7/fat-weight-shadow-v1";
import { stableSha256 } from "@/modules/model-recovery/recovery-fingerprint";

/**
 * Experimental Fat/Weight Uncertainty V1 (shadow / EXPERIMENTAL only).
 *
 * Adds explicit lower/point/upper envelopes around FatWeightShadowV1 mean
 * trajectories. The Hall/Forbes mean transition is unchanged. Scale weight and
 * BIA may calibrate or widen uncertainty only — never overwrite fat/lean state
 * and never allocate scale−model residual into any compartment.
 *
 * Not production TDEE / forecast / validated v7 semantics.
 */
export const EXPERIMENTAL_FAT_WEIGHT_UNCERTAINTY_V1_REVISION =
  "experimental-fat-weight-uncertainty-v1" as const;

export const EXPERIMENTAL_FAT_WEIGHT_UNCERTAINTY_V1_PROVENANCE =
  "experimental-heuristic" as const;

/**
 * ENGINEERING prior — day-to-day scale biological/measurement half-width (kg).
 * Motivated by ~0.5% body-weight day-to-day SD framing (classic weighing studies)
 * and free-living short-term weight noise dominated by non-fat mass.
 */
export const ENGINEERING_SCALE_WEIGHT_HALFWIDTH_KG_V1 = 0.5 as const;

/**
 * ENGINEERING prior — fat-mass composition half-width (kg) without personal
 * calibration. Wider than scale noise because composition is not identified by
 * weight alone; BIA remains noisy context (E-MV05–E-MV07 framing).
 */
export const ENGINEERING_FAT_COMPOSITION_HALFWIDTH_KG_V1 = 2.0 as const;

export const EXPERIMENTAL_FAT_WEIGHT_UNCERTAINTY_PRIORS_V1 = {
  scaleWeightHalfWidthKg: ENGINEERING_SCALE_WEIGHT_HALFWIDTH_KG_V1,
  fatCompositionHalfWidthKg: ENGINEERING_FAT_COMPOSITION_HALFWIDTH_KG_V1,
  gapWidenPerMissingScaleDayKg: 0.15,
  gapWidenPerMissingEnergyDayKg: 0.1,
  compatibleShrinkFactor: 0.85,
  minWeightHalfWidthKg: 0.35,
  maxWeightHalfWidthKg: 5.0,
  minFatHalfWidthKg: 1.0,
  maxFatHalfWidthKg: 8.0,
  compatibleScaleResidualKg: 2.5,
  biaDiscordWidenKg: 0.75,
  scaleClassification: "engineering-order-of-magnitude-band" as const,
  fatClassification: "engineering-order-of-magnitude-band" as const,
  scientificNote:
    "Scale day-to-day noise motivates a ~0.5 kg engineering half-width; fat composition remains more uncertain without a validated personal oracle. Priors are not scientifically validated personal SDs.",
} as const;

export type ExperimentalFatWeightUncertaintyAvailabilityV1 =
  | "available"
  | "unavailable";

export type ExperimentalFatWeightUncertaintyStateV1 = {
  availability: ExperimentalFatWeightUncertaintyAvailabilityV1;
  /** Carried epistemic half-widths — missing observations widen these; never zero-by-default. */
  weightHalfWidthKg: number | null;
  fatHalfWidthKg: number | null;
  consecutiveCompatibleScaleDays: number;
  daysSinceScaleObservation: number;
  daysSinceEnergyBalance: number;
};

export type ExperimentalFatWeightUncertaintyBoundV1 = {
  lowerKg: number | null;
  pointKg: number | null;
  upperKg: number | null;
};

export type ExperimentalFatWeightUncertaintyResultV1 = {
  contractVersion: typeof EXPERIMENTAL_FAT_WEIGHT_UNCERTAINTY_V1_REVISION;
  provenance: typeof EXPERIMENTAL_FAT_WEIGHT_UNCERTAINTY_V1_PROVENANCE;
  supportedDomain: "fat-weight-uncertainty-shadow-only";
  availability: ExperimentalFatWeightUncertaintyAvailabilityV1;
  meanModelVersion: typeof FAT_WEIGHT_SHADOW_V1_VERSION;
  /** Point estimates — identical to FatWeightShadowV1 mean when available. */
  fatMassKg: ExperimentalFatWeightUncertaintyBoundV1;
  modeledWeightKg: ExperimentalFatWeightUncertaintyBoundV1;
  slowNonFatKgPoint: number | null;
  uncertaintyState: ExperimentalFatWeightUncertaintyStateV1;
  observation: {
    scaleWeightKg: number | null;
    bodyFatPercent: number | null;
    scaleResidualKg: number | null;
    scaleHandling: "noisy-uncertainty-calibration-only";
    biaHandling: "noisy-context-not-truth";
    residualAllocation: "intentionally-rejected";
  };
  features: {
    compatibleScaleObservation: boolean;
    scaleObservationMissing: boolean;
    energyBalanceMissing: boolean;
    biaDiscordWidened: boolean;
    meanStateUnchangedByObservations: true;
    rejectedConversions: readonly [
      "scale-weight-residual-into-fat",
      "scale-weight-residual-into-muscle",
      "scale-weight-residual-into-glycogen",
      "scale-weight-residual-into-water",
      "scale-weight-residual-into-ecf",
      "bia-body-fat-as-truth",
      "missing-observation-as-zero-uncertainty",
    ];
  };
  reasons: string[];
  fingerprint: string;
};

function rejectedConversions(): ExperimentalFatWeightUncertaintyResultV1["features"]["rejectedConversions"] {
  return [
    "scale-weight-residual-into-fat",
    "scale-weight-residual-into-muscle",
    "scale-weight-residual-into-glycogen",
    "scale-weight-residual-into-water",
    "scale-weight-residual-into-ecf",
    "bia-body-fat-as-truth",
    "missing-observation-as-zero-uncertainty",
  ] as const;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function finiteOrThrow(name: string, value: number): number {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite`);
  return Object.is(value, -0) ? 0 : value;
}

export function initialExperimentalFatWeightUncertaintyStateV1(): ExperimentalFatWeightUncertaintyStateV1 {
  const priors = EXPERIMENTAL_FAT_WEIGHT_UNCERTAINTY_PRIORS_V1;
  return {
    availability: "available",
    weightHalfWidthKg: priors.scaleWeightHalfWidthKg,
    fatHalfWidthKg: priors.fatCompositionHalfWidthKg,
    consecutiveCompatibleScaleDays: 0,
    daysSinceScaleObservation: 0,
    daysSinceEnergyBalance: 0,
  };
}

function unavailableUncertaintyState(): ExperimentalFatWeightUncertaintyStateV1 {
  return {
    availability: "unavailable",
    weightHalfWidthKg: null,
    fatHalfWidthKg: null,
    consecutiveCompatibleScaleDays: 0,
    daysSinceScaleObservation: 0,
    daysSinceEnergyBalance: 0,
  };
}

function boundAround(pointKg: number, halfWidthKg: number): ExperimentalFatWeightUncertaintyBoundV1 {
  const half = finiteOrThrow("halfWidthKg", halfWidthKg);
  const point = finiteOrThrow("pointKg", pointKg);
  return {
    lowerKg: Math.max(0, point - half),
    pointKg: point,
    upperKg: point + half,
  };
}

/**
 * One-day experimental uncertainty step around an unchanged FatWeightShadowV1 mean.
 */
export function transitionExperimentalFatWeightUncertaintyV1(input: {
  priorMean: FatWeightShadowStateV1;
  priorUncertainty?: ExperimentalFatWeightUncertaintyStateV1;
  energyBalanceKcal: number | null;
  observedWeightKg: number | null;
  observedBodyFatPercent: number | null;
  /** Explicit fast-compartment context only — never residual-allocated. */
  fastCompartmentContextKg?: number | null;
}): ExperimentalFatWeightUncertaintyResultV1 {
  const priors = EXPERIMENTAL_FAT_WEIGHT_UNCERTAINTY_PRIORS_V1;
  const priorUncertainty = input.priorUncertainty ?? initialExperimentalFatWeightUncertaintyStateV1();
  const mean = transitionFatWeightShadowV1({
    prior: input.priorMean,
    energyBalanceKcal: input.energyBalanceKcal,
    observedWeightKg: input.observedWeightKg,
    observedBodyFatPercent: input.observedBodyFatPercent,
  });

  const reasons: string[] = [
    "experimental-heuristic-fat-weight-uncertainty",
    "mean-trajectory-from-unchanged-fat-weight-shadow-v1",
    "scale-weight-residual-allocation-intentionally-rejected",
    "bia-body-fat-not-truth",
    "fast-compartments-context-only-not-residual-sink",
  ];

  if (input.fastCompartmentContextKg !== undefined && input.fastCompartmentContextKg !== null) {
    if (!Number.isFinite(input.fastCompartmentContextKg)) {
      throw new RangeError("fastCompartmentContextKg must be finite when provided");
    }
    reasons.push("fast-compartment-context-ignored-for-state-and-residual");
  }

  if (mean.state.availability !== "available"
      || mean.state.fatMassKg === null
      || mean.state.slowNonFatKg === null) {
    reasons.push(...mean.reasons);
    reasons.push("mean-unavailable-uncertainty-unavailable-not-zero");
    const result: ExperimentalFatWeightUncertaintyResultV1 = {
      contractVersion: EXPERIMENTAL_FAT_WEIGHT_UNCERTAINTY_V1_REVISION,
      provenance: EXPERIMENTAL_FAT_WEIGHT_UNCERTAINTY_V1_PROVENANCE,
      supportedDomain: "fat-weight-uncertainty-shadow-only",
      availability: "unavailable",
      meanModelVersion: FAT_WEIGHT_SHADOW_V1_VERSION,
      fatMassKg: { lowerKg: null, pointKg: null, upperKg: null },
      modeledWeightKg: { lowerKg: null, pointKg: null, upperKg: null },
      slowNonFatKgPoint: null,
      uncertaintyState: unavailableUncertaintyState(),
      observation: {
        scaleWeightKg: input.observedWeightKg,
        bodyFatPercent: input.observedBodyFatPercent,
        scaleResidualKg: null,
        scaleHandling: "noisy-uncertainty-calibration-only",
        biaHandling: "noisy-context-not-truth",
        residualAllocation: "intentionally-rejected",
      },
      features: {
        compatibleScaleObservation: false,
        scaleObservationMissing: input.observedWeightKg === null,
        energyBalanceMissing: input.energyBalanceKcal === null,
        biaDiscordWidened: false,
        meanStateUnchangedByObservations: true,
        rejectedConversions: rejectedConversions(),
      },
      reasons,
      fingerprint: "",
    };
    result.fingerprint = experimentalFatWeightUncertaintyV1Fingerprint(result);
    return result;
  }

  const fatPoint = mean.state.fatMassKg;
  const slowPoint = mean.state.slowNonFatKg;
  const weightPoint = fatPoint + slowPoint;

  let weightHalf = priorUncertainty.availability === "available"
    && priorUncertainty.weightHalfWidthKg !== null
    ? priorUncertainty.weightHalfWidthKg
    : priors.scaleWeightHalfWidthKg;
  let fatHalf = priorUncertainty.availability === "available"
    && priorUncertainty.fatHalfWidthKg !== null
    ? priorUncertainty.fatHalfWidthKg
    : priors.fatCompositionHalfWidthKg;
  let consecutiveCompatible = priorUncertainty.consecutiveCompatibleScaleDays;
  let daysSinceScale = priorUncertainty.daysSinceScaleObservation;
  let daysSinceEnergy = priorUncertainty.daysSinceEnergyBalance;

  const energyMissing = input.energyBalanceKcal === null;
  if (energyMissing) {
    daysSinceEnergy += 1;
    weightHalf += priors.gapWidenPerMissingEnergyDayKg;
    fatHalf += priors.gapWidenPerMissingEnergyDayKg;
    reasons.push("missing-energy-balance-widens-uncertainty");
  } else {
    daysSinceEnergy = 0;
  }

  const scaleMissing = input.observedWeightKg === null;
  let scaleResidualKg: number | null = null;
  let compatibleScaleObservation = false;
  let biaDiscordWidened = false;

  if (scaleMissing) {
    daysSinceScale += 1;
    consecutiveCompatible = 0;
    weightHalf += priors.gapWidenPerMissingScaleDayKg;
    fatHalf += priors.gapWidenPerMissingScaleDayKg * 0.5;
    reasons.push("missing-scale-observation-widens-uncertainty-not-zero");
  } else {
    const observed = finiteOrThrow("observedWeightKg", input.observedWeightKg!);
    scaleResidualKg = observed - weightPoint;
    daysSinceScale = 0;
    // Residual calibrates uncertainty only — never allocated into tissue.
    if (Math.abs(scaleResidualKg) <= priors.compatibleScaleResidualKg) {
      compatibleScaleObservation = true;
      consecutiveCompatible += 1;
      weightHalf = Math.max(
        priors.minWeightHalfWidthKg,
        weightHalf * priors.compatibleShrinkFactor,
      );
      // Modest fat narrowing: weight consistency constrains total mass weakly.
      fatHalf = Math.max(
        priors.minFatHalfWidthKg,
        fatHalf * (0.5 + 0.5 * priors.compatibleShrinkFactor),
      );
      reasons.push("compatible-scale-observation-narrows-uncertainty");
    } else {
      consecutiveCompatible = 0;
      weightHalf += Math.min(1.5, Math.abs(scaleResidualKg) * 0.15);
      fatHalf += Math.min(1.0, Math.abs(scaleResidualKg) * 0.1);
      reasons.push("incompatible-scale-observation-widens-uncertainty-not-truth");
    }
  }

  if (input.observedBodyFatPercent !== null) {
    if (!Number.isFinite(input.observedBodyFatPercent) || input.observedBodyFatPercent < 0) {
      throw new RangeError("observedBodyFatPercent must be finite and nonnegative when provided");
    }
    if (input.observedWeightKg !== null) {
      const biaImpliedFat = input.observedWeightKg * (input.observedBodyFatPercent / 100);
      if (Math.abs(biaImpliedFat - fatPoint) > fatHalf) {
        fatHalf += priors.biaDiscordWidenKg;
        biaDiscordWidened = true;
        reasons.push("bia-discord-widens-fat-uncertainty-not-overwrite");
      } else {
        reasons.push("bia-present-as-noisy-context-only");
      }
    } else {
      reasons.push("bia-without-scale-is-noisy-context-only");
    }
  }

  weightHalf = clamp(weightHalf, priors.minWeightHalfWidthKg, priors.maxWeightHalfWidthKg);
  fatHalf = clamp(fatHalf, priors.minFatHalfWidthKg, priors.maxFatHalfWidthKg);

  // Gap history widens beyond shrink floor when sparse.
  if (daysSinceScale >= 3) {
    reasons.push("sparse-or-gapped-scale-history-keeps-wide-uncertainty");
  }
  if (consecutiveCompatible >= 3) {
    reasons.push("repeated-compatible-scale-observations-support-narrower-uncertainty");
  }

  const uncertaintyState: ExperimentalFatWeightUncertaintyStateV1 = {
    availability: "available",
    weightHalfWidthKg: weightHalf,
    fatHalfWidthKg: fatHalf,
    consecutiveCompatibleScaleDays: consecutiveCompatible,
    daysSinceScaleObservation: daysSinceScale,
    daysSinceEnergyBalance: daysSinceEnergy,
  };

  const result: ExperimentalFatWeightUncertaintyResultV1 = {
    contractVersion: EXPERIMENTAL_FAT_WEIGHT_UNCERTAINTY_V1_REVISION,
    provenance: EXPERIMENTAL_FAT_WEIGHT_UNCERTAINTY_V1_PROVENANCE,
    supportedDomain: "fat-weight-uncertainty-shadow-only",
    availability: "available",
    meanModelVersion: FAT_WEIGHT_SHADOW_V1_VERSION,
    fatMassKg: boundAround(fatPoint, fatHalf),
    modeledWeightKg: boundAround(weightPoint, weightHalf),
    slowNonFatKgPoint: slowPoint,
    uncertaintyState,
    observation: {
      scaleWeightKg: input.observedWeightKg,
      bodyFatPercent: input.observedBodyFatPercent,
      scaleResidualKg,
      scaleHandling: "noisy-uncertainty-calibration-only",
      biaHandling: "noisy-context-not-truth",
      residualAllocation: "intentionally-rejected",
    },
    features: {
      compatibleScaleObservation,
      scaleObservationMissing: scaleMissing,
      energyBalanceMissing: energyMissing,
      biaDiscordWidened,
      meanStateUnchangedByObservations: true,
      rejectedConversions: rejectedConversions(),
    },
    reasons,
    fingerprint: "",
  };
  result.fingerprint = experimentalFatWeightUncertaintyV1Fingerprint(result);
  return result;
}

/** Deterministic multi-day rebuild from an explicit prior mean + uncertainty. */
export function rebuildExperimentalFatWeightUncertaintyTrajectoryV1(input: {
  priorMean: FatWeightShadowStateV1;
  priorUncertainty?: ExperimentalFatWeightUncertaintyStateV1;
  days: readonly {
    date: string;
    energyBalanceKcal: number | null;
    observedWeightKg: number | null;
    observedBodyFatPercent: number | null;
    fastCompartmentContextKg?: number | null;
  }[];
}): ExperimentalFatWeightUncertaintyResultV1[] {
  let priorMean = input.priorMean;
  let priorUncertainty = input.priorUncertainty ?? initialExperimentalFatWeightUncertaintyStateV1();
  const out: ExperimentalFatWeightUncertaintyResultV1[] = [];
  for (const day of input.days) {
    const step = transitionExperimentalFatWeightUncertaintyV1({
      priorMean,
      priorUncertainty,
      energyBalanceKcal: day.energyBalanceKcal,
      observedWeightKg: day.observedWeightKg,
      observedBodyFatPercent: day.observedBodyFatPercent,
      fastCompartmentContextKg: day.fastCompartmentContextKg,
    });
    out.push(step);
    if (step.availability === "available"
        && step.fatMassKg.pointKg !== null
        && step.slowNonFatKgPoint !== null) {
      priorMean = {
        fatMassKg: step.fatMassKg.pointKg,
        slowNonFatKg: step.slowNonFatKgPoint,
        availability: "available",
        provenance: "episode-bia-derived-estimate",
        uncertainty: "personal-unavailable",
      };
      priorUncertainty = step.uncertaintyState;
    } else {
      priorMean = {
        fatMassKg: null,
        slowNonFatKg: null,
        availability: "unavailable",
        provenance: null,
        uncertainty: "personal-unavailable",
      };
      priorUncertainty = unavailableUncertaintyState();
    }
  }
  return out;
}

export function experimentalFatWeightUncertaintyV1Fingerprint(
  result: Omit<ExperimentalFatWeightUncertaintyResultV1, "fingerprint"> & {
    fingerprint?: string;
  },
): string {
  const { fingerprint: _ignored, ...rest } = result;
  return stableSha256(rest);
}
