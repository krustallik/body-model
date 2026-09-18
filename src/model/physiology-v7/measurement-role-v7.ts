import { stableSha256 } from "@/modules/model-recovery/recovery-fingerprint";
import {
  validatePhysiologyV7State,
  type PhysiologyV7State,
} from "./state";

/**
 * Measurement-role contract: classifies body-composition endpoints so lean /
 * DXA / BIA / FFM observations never become skeletalMuscleKg (C-MV02).
 */
export const MEASUREMENT_ROLE_CONTRACT_V7_VERSION =
  "bodycast-measurement-role-v7-1" as const;

export const LEAN_MASS_NOT_SKELETAL_MUSCLE_POLICY_V7 = {
  conversion: "lean-mass-to-skeletal-muscle-kg",
  application: "intentionally-rejected",
  residualAllocation: "intentionally-rejected",
  claimId: "C-MV02",
  scientificDecision: "lean-proxy-is-not-skeletal-muscle-tissue",
  researchAuthority: "workout-physiology-v7-audit",
} as const;

export type LeanMassNotSkeletalMusclePolicyV7 =
  typeof LEAN_MASS_NOT_SKELETAL_MUSCLE_POLICY_V7;

/** Lean / proxy endpoints that may inform aggregate lean context only. */
export type LeanMassEndpointKindV7 =
  | "dxa-lean-soft-tissue"
  | "bia-lean-mass"
  | "fat-free-mass"
  | "generic-lean-tissue"
  | "device-reported-skeletal-muscle-proxy";

export type MeasurementRoleV7 =
  | "aggregate-lean-context"
  | "skeletal-muscle-kg"
  | "local-hypertrophy-proxy"
  | "body-weight-total-mass";

export type LeanMassObservationV7 = {
  endpointKind: LeanMassEndpointKindV7;
  valueKg: number;
};

export type AggregateLeanContextV7 = {
  availability: "available";
  role: "aggregate-lean-context";
  endpointKind: LeanMassEndpointKindV7;
  valueKg: number;
  skeletalMuscleInterpretation: "not-skeletal-muscle";
  mayInitializeSkeletalMuscleKg: false;
  mayOverwriteSkeletalMuscleKg: false;
  mayValidateSkeletalMuscleKg: false;
};

export type RejectedSkeletalMuscleFromLeanV7 = {
  applied: false;
  target: "skeletalMuscleKg";
  policy: LeanMassNotSkeletalMusclePolicyV7;
  priorSkeletalMuscleKg: number | null;
  resultingSkeletalMuscleKg: number | null;
  rejectedOperations: readonly [
    "initialize",
    "overwrite",
    "validate",
    "residual-allocate",
  ];
};

export type LeanMassMeasurementHandlingV7 = {
  contractVersion: typeof MEASUREMENT_ROLE_CONTRACT_V7_VERSION;
  leanContext: AggregateLeanContextV7 | {
    availability: "unavailable";
    reason: "missing-lean-mass-observation";
  };
  skeletalMuscleFromLean: RejectedSkeletalMuscleFromLeanV7;
};

export function classifyLeanMassEndpointRoleV7(
  endpointKind: LeanMassEndpointKindV7,
): {
  role: "aggregate-lean-context";
  mayInitializeSkeletalMuscleKg: false;
  mayOverwriteSkeletalMuscleKg: false;
  mayValidateSkeletalMuscleKg: false;
  skeletalMuscleInterpretation: "not-skeletal-muscle";
  endpointKind: LeanMassEndpointKindV7;
} {
  return {
    role: "aggregate-lean-context",
    mayInitializeSkeletalMuscleKg: false,
    mayOverwriteSkeletalMuscleKg: false,
    mayValidateSkeletalMuscleKg: false,
    skeletalMuscleInterpretation: "not-skeletal-muscle",
    endpointKind,
  };
}

export function resolveLeanMassObservationV7(
  observation: LeanMassObservationV7,
): AggregateLeanContextV7 {
  if (!Number.isFinite(observation.valueKg) || observation.valueKg < 0) {
    throw new RangeError("lean mass observation valueKg must be finite and nonnegative");
  }
  const classification = classifyLeanMassEndpointRoleV7(observation.endpointKind);
  return {
    availability: "available",
    role: classification.role,
    endpointKind: observation.endpointKind,
    valueKg: observation.valueKg,
    skeletalMuscleInterpretation: classification.skeletalMuscleInterpretation,
    mayInitializeSkeletalMuscleKg: false,
    mayOverwriteSkeletalMuscleKg: false,
    mayValidateSkeletalMuscleKg: false,
  };
}

function rejectedSkeletalMuscleFromLean(
  priorSkeletalMuscleKg: number | null,
): RejectedSkeletalMuscleFromLeanV7 {
  return {
    applied: false,
    target: "skeletalMuscleKg",
    policy: LEAN_MASS_NOT_SKELETAL_MUSCLE_POLICY_V7,
    priorSkeletalMuscleKg,
    resultingSkeletalMuscleKg: priorSkeletalMuscleKg,
    rejectedOperations: [
      "initialize",
      "overwrite",
      "validate",
      "residual-allocate",
    ],
  };
}

/**
 * Observation handling: lean informs aggregate lean context only; skeletalMuscleKg
 * is never initialized, overwritten, or validated from the lean value.
 */
export function applyLeanMassObservationToPhysiologyV7State(input: {
  state: PhysiologyV7State;
  leanObservation: LeanMassObservationV7;
}): {
  state: PhysiologyV7State;
  leanContext: AggregateLeanContextV7;
  skeletalMuscleFromLean: RejectedSkeletalMuscleFromLeanV7;
} {
  validatePhysiologyV7State(input.state);
  const leanContext = resolveLeanMassObservationV7(input.leanObservation);
  const state = validatePhysiologyV7State({ ...input.state });
  return {
    state,
    leanContext,
    skeletalMuscleFromLean: rejectedSkeletalMuscleFromLean(state.skeletalMuscleKg),
  };
}

/**
 * Initialization seam: v6/generic lean tissue may seed aggregate lean context
 * only. skeletalMuscleKg stays unavailable unless already present on prior state.
 */
export function initializePhysiologyV7StateRejectingLeanAsSkeletalMuscleV7(input: {
  leanTissueKg: number;
  endpointKind?: LeanMassEndpointKindV7;
  priorState?: PhysiologyV7State | null;
}): {
  state: PhysiologyV7State;
  leanContext: AggregateLeanContextV7;
  skeletalMuscleFromLean: RejectedSkeletalMuscleFromLeanV7;
} {
  const prior = input.priorState ?? {
    fatMassKg: null,
    skeletalMuscleKg: null,
    otherLeanTissueKg: null,
    glycogenKg: null,
    glycogenWaterKg: null,
    ecfDeviationKg: null,
    transientExerciseWaterKg: null,
    adaptiveThermogenesisKcalPerDay: null,
    weightFilterState: null,
  };
  return applyLeanMassObservationToPhysiologyV7State({
    state: prior,
    leanObservation: {
      endpointKind: input.endpointKind ?? "generic-lean-tissue",
      valueKg: input.leanTissueKg,
    },
  });
}

/**
 * Residual allocation rejector: weight − fat (or similar remainder) is never
 * written into skeletalMuscleKg.
 */
export function rejectResidualLeanAsSkeletalMuscleV7(input: {
  state: PhysiologyV7State;
  residualLeanKg: number;
}): RejectedSkeletalMuscleFromLeanV7 {
  validatePhysiologyV7State(input.state);
  if (!Number.isFinite(input.residualLeanKg)) {
    throw new RangeError("residualLeanKg must be finite");
  }
  return rejectedSkeletalMuscleFromLean(input.state.skeletalMuscleKg);
}

/**
 * Validation rejector: lean/DXA/BIA values cannot confirm or refute skeletalMuscleKg.
 */
export function rejectLeanMassAsSkeletalMuscleValidatorV7(input: {
  skeletalMuscleKg: number | null;
  leanMassKg: number;
}): {
  accepted: false;
  reason: "lean-mass-is-not-skeletal-muscle-validator";
  policy: LeanMassNotSkeletalMusclePolicyV7;
  skeletalMuscleKg: number | null;
  leanMassKg: number;
} {
  if (!Number.isFinite(input.leanMassKg) || input.leanMassKg < 0) {
    throw new RangeError("leanMassKg must be finite and nonnegative");
  }
  if (input.skeletalMuscleKg !== null
      && (!Number.isFinite(input.skeletalMuscleKg) || input.skeletalMuscleKg < 0)) {
    throw new RangeError("skeletalMuscleKg must be finite and nonnegative when available");
  }
  return {
    accepted: false,
    reason: "lean-mass-is-not-skeletal-muscle-validator",
    policy: LEAN_MASS_NOT_SKELETAL_MUSCLE_POLICY_V7,
    skeletalMuscleKg: input.skeletalMuscleKg,
    leanMassKg: input.leanMassKg,
  };
}

export function handleLeanMassMeasurementForPhysiologyV7(input: {
  state: PhysiologyV7State;
  leanObservation: LeanMassObservationV7 | null;
}): LeanMassMeasurementHandlingV7 {
  validatePhysiologyV7State(input.state);
  if (input.leanObservation === null) {
    return {
      contractVersion: MEASUREMENT_ROLE_CONTRACT_V7_VERSION,
      leanContext: {
        availability: "unavailable",
        reason: "missing-lean-mass-observation",
      },
      skeletalMuscleFromLean: rejectedSkeletalMuscleFromLean(input.state.skeletalMuscleKg),
    };
  }
  const applied = applyLeanMassObservationToPhysiologyV7State({
    state: input.state,
    leanObservation: input.leanObservation,
  });
  return {
    contractVersion: MEASUREMENT_ROLE_CONTRACT_V7_VERSION,
    leanContext: applied.leanContext,
    skeletalMuscleFromLean: applied.skeletalMuscleFromLean,
  };
}

export function leanMassMeasurementHandlingV7Fingerprint(
  handling: LeanMassMeasurementHandlingV7,
): string {
  return stableSha256(handling);
}
