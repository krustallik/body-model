import { stableSha256 } from "@/modules/model-recovery/recovery-fingerprint";
import {
  validatePhysiologyV7State,
  type PhysiologyV7State,
} from "./state";

/**
 * Sleep / HRV context + provenance seam (C-M03, C-M05, C-M06, C-M07, C-L05).
 * Observations may be retained for audit; they never invent sleep→muscle/fat
 * coefficients, stage-driven body-composition transitions, wearable→PSG
 * equivalence, or HRV→hypertrophy multipliers. Acute sleep-related MPS
 * conversion is rejected via the measurement-role seam (C-M02 / C-MV03).
 */
export const SLEEP_HRV_CONTEXT_CONTRACT_V7_VERSION =
  "bodycast-sleep-hrv-context-v7-2" as const;

/** C-M05: missing sleep is unknown, never zero, never an automatic penalty. */
export const MISSING_SLEEP_POLICY_V7 = {
  missingSleepInterpretation: "unknown-not-zero",
  automaticPhysiologyPenalty: "intentionally-rejected",
  claimId: "C-M05",
  scientificDecision: "missing-sleep-is-unknown",
  researchAuthority: "workout-physiology-v7-audit",
} as const;

export type MissingSleepPolicyV7 = typeof MISSING_SLEEP_POLICY_V7;

/** C-M06: consumer REM/Core/Deep never drive body-composition transitions. */
export const SLEEP_STAGE_PHYSIOLOGY_POLICY_V7 = {
  component: "consumer-sleep-stage-body-composition-driver",
  application: "intentionally-rejected",
  claimId: "C-M06",
  scientificDecision: "consumer-stages-do-not-drive-v7-physiology",
  researchAuthority: "workout-physiology-v7-audit",
} as const;

export type SleepStagePhysiologyPolicyV7 = typeof SLEEP_STAGE_PHYSIOLOGY_POLICY_V7;

/** C-M07: wearable sleep retains device provenance; never PSG-equivalent. */
export const WEARABLE_SLEEP_PROVENANCE_POLICY_V7 = {
  wearableIsNotPsg: true as const,
  psgEquivalenceClaim: "intentionally-rejected",
  groundTruthLabel: "not-psg",
  claimId: "C-M07",
  scientificDecision: "wearable-sleep-is-not-psg",
  researchAuthority: "workout-physiology-v7-audit",
} as const;

export type WearableSleepProvenancePolicyV7 =
  typeof WEARABLE_SLEEP_PROVENANCE_POLICY_V7;

/** C-L05: no validated HRV→hypertrophy / muscle-kg coefficient. */
export const HRV_HYPERTROPHY_COEFFICIENT_POLICY_V7 = {
  component: "independent-hrv-hypertrophy-coefficient",
  application: "intentionally-rejected",
  numericComponent: "rejected",
  skeletalMuscleTransition: "intentionally-rejected",
  claimId: "C-L05",
  scientificDecision: "hrv-has-no-validated-v7-hypertrophy-coefficient",
  researchAuthority: "workout-physiology-v7-audit",
} as const;

export type HrvHypertrophyCoefficientPolicyV7 =
  typeof HRV_HYPERTROPHY_COEFFICIENT_POLICY_V7;

/**
 * C-M03: isolated low sleep duration / stages never apply an exact daily
 * anabolic or body-composition multiplier without a validated model.
 */
export const SLEEP_DAILY_ANABOLIC_MULTIPLIER_POLICY_V7 = {
  component: "isolated-low-sleep-daily-muscle-fat-coefficient",
  application: "intentionally-rejected",
  numericComponent: "rejected",
  claimId: "C-M03",
  scientificDecision: "one-poor-night-has-no-exact-daily-multiplier",
  researchAuthority: "workout-physiology-v7-audit",
} as const;

export type SleepDailyAnabolicMultiplierPolicyV7 =
  typeof SLEEP_DAILY_ANABOLIC_MULTIPLIER_POLICY_V7;

export type WearableSleepStageMinutesV7 = {
  remMinutes: number | null;
  coreMinutes: number | null;
  deepMinutes: number | null;
};

export type SleepObservationV7 =
  | {
    availability: "unavailable";
    reason: "missing-sleep-record";
  }
  | {
    availability: "available";
    durationMinutes: number;
    source: "wearable-consumer" | "manual-log";
    stages?: WearableSleepStageMinutesV7 | null;
  };

export type HrvObservationV7 =
  | {
    availability: "unavailable";
    reason: "missing-hrv-observation";
  }
  | {
    availability: "available";
    valueMs: number;
    readinessScore?: number | null;
  };

export type ResolvedSleepContextV7 =
  | {
    availability: "unavailable";
    reason: "missing-sleep-record";
    role: "sleep-context";
    interpretation: "unknown-not-zero";
    missingSleepPolicy: MissingSleepPolicyV7;
    mayPenalizePhysiology: false;
    mayAssumeZeroSleep: false;
  }
  | {
    availability: "available";
    role: "sleep-context";
    durationMinutes: number;
    source: "wearable-consumer" | "manual-log";
    stages: WearableSleepStageMinutesV7 | null;
    provenance: {
      deviceKind: "wearable-consumer" | "manual-log";
      measurementUncertainty: "retained";
      psgEquivalence: "intentionally-rejected";
      policy: WearableSleepProvenancePolicyV7;
    };
    stagePhysiologyPolicy: SleepStagePhysiologyPolicyV7;
    dailyAnabolicMultiplierPolicy: SleepDailyAnabolicMultiplierPolicyV7;
    mayDriveBodyCompositionTransitions: false;
    mayApplyMuscleOrFatCoefficient: false;
    mayApplyExactDailyAnabolicMultiplier: false;
  };

export type ResolvedHrvContextV7 =
  | {
    availability: "unavailable";
    reason: "missing-hrv-observation";
    role: "hrv-context";
    hypertrophyCoefficientPolicy: HrvHypertrophyCoefficientPolicyV7;
    mayMultiplyTrainingStimulus: false;
    mayConvertToSkeletalMuscleKg: false;
  }
  | {
    availability: "available";
    role: "hrv-context";
    valueMs: number;
    readinessScore: number | null;
    hypertrophyCoefficientPolicy: HrvHypertrophyCoefficientPolicyV7;
    mayMultiplyTrainingStimulus: false;
    mayConvertToSkeletalMuscleKg: false;
  };

export type SleepHrvContextHandlingV7 = {
  contractVersion: typeof SLEEP_HRV_CONTEXT_CONTRACT_V7_VERSION;
  sleepContext: ResolvedSleepContextV7;
  hrvContext: ResolvedHrvContextV7;
  physiologyEffect: {
    applied: false;
    skeletalMuscleKgUnchanged: true;
    fatMassKgUnchanged: true;
    adaptationPenaltyApplied: false;
    sleepStageDrivenTransitionApplied: false;
    sleepDailyAnabolicMultiplierApplied: false;
    hrvHypertrophyCoefficientApplied: false;
  };
  priorSkeletalMuscleKg: number | null;
  resultingSkeletalMuscleKg: number | null;
  priorFatMassKg: number | null;
  resultingFatMassKg: number | null;
};

function finiteNonnegativeOrNull(value: number | null | undefined, label: string): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be finite and nonnegative when available`);
  }
  return value;
}

export function resolveSleepObservationV7(
  observation: SleepObservationV7 | null | undefined,
): ResolvedSleepContextV7 {
  if (observation == null || observation.availability === "unavailable") {
    return {
      availability: "unavailable",
      reason: "missing-sleep-record",
      role: "sleep-context",
      interpretation: "unknown-not-zero",
      missingSleepPolicy: MISSING_SLEEP_POLICY_V7,
      mayPenalizePhysiology: false,
      mayAssumeZeroSleep: false,
    };
  }
  if (!Number.isFinite(observation.durationMinutes) || observation.durationMinutes < 0) {
    throw new RangeError("sleep durationMinutes must be finite and nonnegative");
  }
  const stages = observation.stages == null
    ? null
    : {
      remMinutes: finiteNonnegativeOrNull(observation.stages.remMinutes, "remMinutes"),
      coreMinutes: finiteNonnegativeOrNull(observation.stages.coreMinutes, "coreMinutes"),
      deepMinutes: finiteNonnegativeOrNull(observation.stages.deepMinutes, "deepMinutes"),
    };
  return {
    availability: "available",
    role: "sleep-context",
    durationMinutes: observation.durationMinutes,
    source: observation.source,
    stages,
    provenance: {
      deviceKind: observation.source,
      measurementUncertainty: "retained",
      psgEquivalence: "intentionally-rejected",
      policy: WEARABLE_SLEEP_PROVENANCE_POLICY_V7,
    },
    stagePhysiologyPolicy: SLEEP_STAGE_PHYSIOLOGY_POLICY_V7,
    dailyAnabolicMultiplierPolicy: SLEEP_DAILY_ANABOLIC_MULTIPLIER_POLICY_V7,
    mayDriveBodyCompositionTransitions: false,
    mayApplyMuscleOrFatCoefficient: false,
    mayApplyExactDailyAnabolicMultiplier: false,
  };
}

export function resolveHrvObservationV7(
  observation: HrvObservationV7 | null | undefined,
): ResolvedHrvContextV7 {
  if (observation == null || observation.availability === "unavailable") {
    return {
      availability: "unavailable",
      reason: "missing-hrv-observation",
      role: "hrv-context",
      hypertrophyCoefficientPolicy: HRV_HYPERTROPHY_COEFFICIENT_POLICY_V7,
      mayMultiplyTrainingStimulus: false,
      mayConvertToSkeletalMuscleKg: false,
    };
  }
  if (!Number.isFinite(observation.valueMs) || observation.valueMs < 0) {
    throw new RangeError("HRV valueMs must be finite and nonnegative");
  }
  const readinessScore = observation.readinessScore === undefined
    ? null
    : finiteNonnegativeOrNull(observation.readinessScore, "readinessScore");
  return {
    availability: "available",
    role: "hrv-context",
    valueMs: observation.valueMs,
    readinessScore,
    hypertrophyCoefficientPolicy: HRV_HYPERTROPHY_COEFFICIENT_POLICY_V7,
    mayMultiplyTrainingStimulus: false,
    mayConvertToSkeletalMuscleKg: false,
  };
}

export function rejectMissingSleepAsZeroPenaltyV7(input: {
  sleepObservation: SleepObservationV7 | null | undefined;
}): {
  accepted: false;
  reason: "missing-sleep-is-not-zero-and-creates-no-automatic-penalty";
  policy: MissingSleepPolicyV7;
  sleepContext: ResolvedSleepContextV7;
} {
  const sleepContext = resolveSleepObservationV7(input.sleepObservation);
  return {
    accepted: false,
    reason: "missing-sleep-is-not-zero-and-creates-no-automatic-penalty",
    policy: MISSING_SLEEP_POLICY_V7,
    sleepContext,
  };
}

export function rejectSleepStagesAsBodyCompositionDriverV7(input: {
  sleepObservation: SleepObservationV7;
}): {
  accepted: false;
  reason: "consumer-sleep-stages-do-not-drive-v7-physiology";
  policy: SleepStagePhysiologyPolicyV7;
  sleepContext: ResolvedSleepContextV7;
} {
  const sleepContext = resolveSleepObservationV7(input.sleepObservation);
  return {
    accepted: false,
    reason: "consumer-sleep-stages-do-not-drive-v7-physiology",
    policy: SLEEP_STAGE_PHYSIOLOGY_POLICY_V7,
    sleepContext,
  };
}

export function rejectWearableSleepAsPsgV7(input: {
  sleepObservation: Extract<SleepObservationV7, { availability: "available" }>;
}): {
  accepted: false;
  reason: "wearable-sleep-is-not-psg";
  policy: WearableSleepProvenancePolicyV7;
  sleepContext: Extract<ResolvedSleepContextV7, { availability: "available" }>;
} {
  const sleepContext = resolveSleepObservationV7(input.sleepObservation);
  if (sleepContext.availability !== "available") {
    throw new RangeError("wearable PSG rejection requires an available sleep observation");
  }
  return {
    accepted: false,
    reason: "wearable-sleep-is-not-psg",
    policy: WEARABLE_SLEEP_PROVENANCE_POLICY_V7,
    sleepContext,
  };
}

export function rejectHrvAsHypertrophyCoefficientV7(input: {
  hrvObservation: HrvObservationV7 | null | undefined;
}): {
  accepted: false;
  reason: "hrv-has-no-validated-v7-hypertrophy-coefficient";
  policy: HrvHypertrophyCoefficientPolicyV7;
  hrvContext: ResolvedHrvContextV7;
} {
  const hrvContext = resolveHrvObservationV7(input.hrvObservation);
  return {
    accepted: false,
    reason: "hrv-has-no-validated-v7-hypertrophy-coefficient",
    policy: HRV_HYPERTROPHY_COEFFICIENT_POLICY_V7,
    hrvContext,
  };
}

export function rejectIsolatedLowSleepAsDailyMultiplierV7(input: {
  sleepObservation: SleepObservationV7 | null | undefined;
}): {
  accepted: false;
  reason: "isolated-low-sleep-has-no-exact-daily-anabolic-multiplier";
  policy: SleepDailyAnabolicMultiplierPolicyV7;
  sleepContext: ResolvedSleepContextV7;
} {
  const sleepContext = resolveSleepObservationV7(input.sleepObservation);
  return {
    accepted: false,
    reason: "isolated-low-sleep-has-no-exact-daily-anabolic-multiplier",
    policy: SLEEP_DAILY_ANABOLIC_MULTIPLIER_POLICY_V7,
    sleepContext,
  };
}

/**
 * Runtime handling: sleep/HRV inform context + provenance only. State
 * compartments are never rewritten from sleep duration, stages, or HRV.
 */
export function handleSleepHrvContextForPhysiologyV7(input: {
  state: PhysiologyV7State;
  sleepObservation?: SleepObservationV7 | null;
  hrvObservation?: HrvObservationV7 | null;
}): SleepHrvContextHandlingV7 {
  validatePhysiologyV7State(input.state);
  const sleepContext = resolveSleepObservationV7(input.sleepObservation);
  const hrvContext = resolveHrvObservationV7(input.hrvObservation);
  return {
    contractVersion: SLEEP_HRV_CONTEXT_CONTRACT_V7_VERSION,
    sleepContext,
    hrvContext,
    physiologyEffect: {
      applied: false,
      skeletalMuscleKgUnchanged: true,
      fatMassKgUnchanged: true,
      adaptationPenaltyApplied: false,
      sleepStageDrivenTransitionApplied: false,
      sleepDailyAnabolicMultiplierApplied: false,
      hrvHypertrophyCoefficientApplied: false,
    },
    priorSkeletalMuscleKg: input.state.skeletalMuscleKg,
    resultingSkeletalMuscleKg: input.state.skeletalMuscleKg,
    priorFatMassKg: input.state.fatMassKg,
    resultingFatMassKg: input.state.fatMassKg,
  };
}

export function sleepHrvContextHandlingV7Fingerprint(
  handling: SleepHrvContextHandlingV7,
): string {
  return stableSha256(handling);
}
