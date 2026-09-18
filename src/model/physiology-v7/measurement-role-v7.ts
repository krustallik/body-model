import { stableSha256 } from "@/modules/model-recovery/recovery-fingerprint";
import {
  validatePhysiologyV7State,
  type PhysiologyV7State,
} from "./state";

/**
 * Measurement-role contract: classifies body-composition endpoints so lean /
 * DXA / BIA / FFM observations never become skeletalMuscleKg (C-MV02), local
 * ultrasound/CSA/thickness observations never become whole-body skeletalMuscleKg
 * (C-MV01), and acute MPS/tracer signals never become skeletalMuscleKg (C-MV03).
 */
export const MEASUREMENT_ROLE_CONTRACT_V7_VERSION =
  "bodycast-measurement-role-v7-3" as const;

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

export const LOCAL_HYPERTROPHY_NOT_WHOLE_BODY_POLICY_V7 = {
  conversion: "local-hypertrophy-to-whole-body-skeletal-muscle-kg",
  application: "intentionally-rejected",
  residualAllocation: "intentionally-rejected",
  calibrationApplication: "intentionally-rejected",
  claimId: "C-MV01",
  scientificDecision: "local-proxy-is-not-whole-body-skeletal-muscle",
  researchAuthority: "workout-physiology-v7-audit",
} as const;

export type LocalHypertrophyNotWholeBodyPolicyV7 =
  typeof LOCAL_HYPERTROPHY_NOT_WHOLE_BODY_POLICY_V7;

export const ACUTE_MPS_NOT_SKELETAL_MUSCLE_POLICY_V7 = {
  conversion: "acute-mps-to-skeletal-muscle-kg",
  application: "intentionally-rejected",
  residualAllocation: "intentionally-rejected",
  calibrationApplication: "intentionally-rejected",
  numericTransition: "intentionally-rejected",
  claimId: "C-MV03",
  scientificDecision: "acute-mps-is-not-accumulated-muscle-mass",
  researchAuthority: "workout-physiology-v7-audit",
} as const;

export type AcuteMpsNotSkeletalMusclePolicyV7 =
  typeof ACUTE_MPS_NOT_SKELETAL_MUSCLE_POLICY_V7;

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
  | "acute-mps-mechanistic-context"
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

/** Local ultrasound / CSA / thickness / fiber endpoints — local context only. */
export type LocalMuscleEndpointKindV7 =
  | "ultrasound-muscle-thickness"
  | "mri-muscle-csa"
  | "mri-muscle-volume"
  | "biopsy-fiber-csa"
  | "local-muscle-percent-change";

export type LocalMuscleObservationUnitV7 =
  | "percent-change"
  | "mm-thickness"
  | "cm2-csa"
  | "cm3-volume";

export type LocalMuscleObservationV7 = {
  endpointKind: LocalMuscleEndpointKindV7;
  site: string;
  value: number;
  unit: LocalMuscleObservationUnitV7;
};

export type LocalHypertrophyContextV7 = {
  availability: "available";
  role: "local-hypertrophy-proxy";
  endpointKind: LocalMuscleEndpointKindV7;
  site: string;
  value: number;
  unit: LocalMuscleObservationUnitV7;
  wholeBodyInterpretation: "not-whole-body-skeletal-muscle";
  mayInitializeSkeletalMuscleKg: false;
  mayOverwriteSkeletalMuscleKg: false;
  mayValidateSkeletalMuscleKg: false;
  mayCalibrateSkeletalMuscleKg: false;
};

export type RejectedSkeletalMuscleFromLocalV7 = {
  applied: false;
  target: "skeletalMuscleKg";
  policy: LocalHypertrophyNotWholeBodyPolicyV7;
  priorSkeletalMuscleKg: number | null;
  resultingSkeletalMuscleKg: number | null;
  rejectedOperations: readonly [
    "initialize",
    "overwrite",
    "validate",
    "calibrate",
    "residual-allocate",
  ];
};

export type LocalHypertrophyMeasurementHandlingV7 = {
  contractVersion: typeof MEASUREMENT_ROLE_CONTRACT_V7_VERSION;
  localContext: LocalHypertrophyContextV7 | {
    availability: "unavailable";
    reason: "missing-local-muscle-observation";
  };
  skeletalMuscleFromLocal: RejectedSkeletalMuscleFromLocalV7;
};

export function classifyLocalMuscleEndpointRoleV7(
  endpointKind: LocalMuscleEndpointKindV7,
): {
  role: "local-hypertrophy-proxy";
  mayInitializeSkeletalMuscleKg: false;
  mayOverwriteSkeletalMuscleKg: false;
  mayValidateSkeletalMuscleKg: false;
  mayCalibrateSkeletalMuscleKg: false;
  wholeBodyInterpretation: "not-whole-body-skeletal-muscle";
  endpointKind: LocalMuscleEndpointKindV7;
} {
  return {
    role: "local-hypertrophy-proxy",
    mayInitializeSkeletalMuscleKg: false,
    mayOverwriteSkeletalMuscleKg: false,
    mayValidateSkeletalMuscleKg: false,
    mayCalibrateSkeletalMuscleKg: false,
    wholeBodyInterpretation: "not-whole-body-skeletal-muscle",
    endpointKind,
  };
}

export function resolveLocalMuscleObservationV7(
  observation: LocalMuscleObservationV7,
): LocalHypertrophyContextV7 {
  if (!Number.isFinite(observation.value)) {
    throw new RangeError("local muscle observation value must be finite");
  }
  if (observation.site.trim().length === 0) {
    throw new RangeError("local muscle observation site must be non-empty");
  }
  const classification = classifyLocalMuscleEndpointRoleV7(observation.endpointKind);
  return {
    availability: "available",
    role: classification.role,
    endpointKind: observation.endpointKind,
    site: observation.site,
    value: observation.value,
    unit: observation.unit,
    wholeBodyInterpretation: classification.wholeBodyInterpretation,
    mayInitializeSkeletalMuscleKg: false,
    mayOverwriteSkeletalMuscleKg: false,
    mayValidateSkeletalMuscleKg: false,
    mayCalibrateSkeletalMuscleKg: false,
  };
}

function rejectedSkeletalMuscleFromLocal(
  priorSkeletalMuscleKg: number | null,
): RejectedSkeletalMuscleFromLocalV7 {
  return {
    applied: false,
    target: "skeletalMuscleKg",
    policy: LOCAL_HYPERTROPHY_NOT_WHOLE_BODY_POLICY_V7,
    priorSkeletalMuscleKg,
    resultingSkeletalMuscleKg: priorSkeletalMuscleKg,
    rejectedOperations: [
      "initialize",
      "overwrite",
      "validate",
      "calibrate",
      "residual-allocate",
    ],
  };
}

/**
 * Observation handling: local ultrasound/CSA/thickness informs local context
 * only; skeletalMuscleKg is never initialized, overwritten, validated, or
 * calibrated from the local value, and no local→kg conversion is applied.
 */
export function applyLocalMuscleObservationToPhysiologyV7State(input: {
  state: PhysiologyV7State;
  localObservation: LocalMuscleObservationV7;
}): {
  state: PhysiologyV7State;
  localContext: LocalHypertrophyContextV7;
  skeletalMuscleFromLocal: RejectedSkeletalMuscleFromLocalV7;
} {
  validatePhysiologyV7State(input.state);
  const localContext = resolveLocalMuscleObservationV7(input.localObservation);
  const state = validatePhysiologyV7State({ ...input.state });
  return {
    state,
    localContext,
    skeletalMuscleFromLocal: rejectedSkeletalMuscleFromLocal(state.skeletalMuscleKg),
  };
}

/**
 * Initialization seam: a local percent/CSA/thickness change never seeds
 * whole-body skeletalMuscleKg.
 */
export function initializePhysiologyV7StateRejectingLocalAsWholeBodyV7(input: {
  localObservation: LocalMuscleObservationV7;
  priorState?: PhysiologyV7State | null;
}): {
  state: PhysiologyV7State;
  localContext: LocalHypertrophyContextV7;
  skeletalMuscleFromLocal: RejectedSkeletalMuscleFromLocalV7;
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
  return applyLocalMuscleObservationToPhysiologyV7State({
    state: prior,
    localObservation: input.localObservation,
  });
}

/** Residual allocation rejector: local remainder is never written into skeletalMuscleKg. */
export function rejectResidualLocalAsSkeletalMuscleV7(input: {
  state: PhysiologyV7State;
  residualLocalValue: number;
}): RejectedSkeletalMuscleFromLocalV7 {
  validatePhysiologyV7State(input.state);
  if (!Number.isFinite(input.residualLocalValue)) {
    throw new RangeError("residualLocalValue must be finite");
  }
  return rejectedSkeletalMuscleFromLocal(input.state.skeletalMuscleKg);
}

/** Validation rejector: local proxies cannot confirm or refute skeletalMuscleKg. */
export function rejectLocalMuscleAsSkeletalMuscleValidatorV7(input: {
  skeletalMuscleKg: number | null;
  localObservation: LocalMuscleObservationV7;
}): {
  accepted: false;
  reason: "local-hypertrophy-is-not-whole-body-skeletal-muscle-validator";
  policy: LocalHypertrophyNotWholeBodyPolicyV7;
  skeletalMuscleKg: number | null;
  localObservation: LocalMuscleObservationV7;
} {
  resolveLocalMuscleObservationV7(input.localObservation);
  if (input.skeletalMuscleKg !== null
      && (!Number.isFinite(input.skeletalMuscleKg) || input.skeletalMuscleKg < 0)) {
    throw new RangeError("skeletalMuscleKg must be finite and nonnegative when available");
  }
  return {
    accepted: false,
    reason: "local-hypertrophy-is-not-whole-body-skeletal-muscle-validator",
    policy: LOCAL_HYPERTROPHY_NOT_WHOLE_BODY_POLICY_V7,
    skeletalMuscleKg: input.skeletalMuscleKg,
    localObservation: structuredClone(input.localObservation),
  };
}

/** Calibration rejector: local percent/CSA never calibrates skeletalMuscleKg. */
export function rejectLocalMuscleAsSkeletalMuscleCalibratorV7(input: {
  skeletalMuscleKg: number | null;
  localObservation: LocalMuscleObservationV7;
}): {
  accepted: false;
  reason: "local-hypertrophy-is-not-whole-body-skeletal-muscle-calibrator";
  policy: LocalHypertrophyNotWholeBodyPolicyV7;
  skeletalMuscleKg: number | null;
  localObservation: LocalMuscleObservationV7;
} {
  resolveLocalMuscleObservationV7(input.localObservation);
  if (input.skeletalMuscleKg !== null
      && (!Number.isFinite(input.skeletalMuscleKg) || input.skeletalMuscleKg < 0)) {
    throw new RangeError("skeletalMuscleKg must be finite and nonnegative when available");
  }
  return {
    accepted: false,
    reason: "local-hypertrophy-is-not-whole-body-skeletal-muscle-calibrator",
    policy: LOCAL_HYPERTROPHY_NOT_WHOLE_BODY_POLICY_V7,
    skeletalMuscleKg: input.skeletalMuscleKg,
    localObservation: structuredClone(input.localObservation),
  };
}

export function handleLocalMuscleMeasurementForPhysiologyV7(input: {
  state: PhysiologyV7State;
  localObservation: LocalMuscleObservationV7 | null;
}): LocalHypertrophyMeasurementHandlingV7 {
  validatePhysiologyV7State(input.state);
  if (input.localObservation === null) {
    return {
      contractVersion: MEASUREMENT_ROLE_CONTRACT_V7_VERSION,
      localContext: {
        availability: "unavailable",
        reason: "missing-local-muscle-observation",
      },
      skeletalMuscleFromLocal: rejectedSkeletalMuscleFromLocal(input.state.skeletalMuscleKg),
    };
  }
  const applied = applyLocalMuscleObservationToPhysiologyV7State({
    state: input.state,
    localObservation: input.localObservation,
  });
  return {
    contractVersion: MEASUREMENT_ROLE_CONTRACT_V7_VERSION,
    localContext: applied.localContext,
    skeletalMuscleFromLocal: applied.skeletalMuscleFromLocal,
  };
}

export function localHypertrophyMeasurementHandlingV7Fingerprint(
  handling: LocalHypertrophyMeasurementHandlingV7,
): string {
  return stableSha256(handling);
}

/** Acute MPS / tracer / FSR endpoints — mechanistic context only. */
export type AcuteMpsEndpointKindV7 =
  | "isotope-tracer-fsr"
  | "acute-mps-percent-response"
  | "biopsy-fractional-synthesis"
  | "reported-acute-synthesis-signal";

export type AcuteMpsObservationUnitV7 =
  | "percent-per-hour"
  | "percent-change"
  | "fractional-synthesis-rate";

export type AcuteMpsObservationV7 = {
  endpointKind: AcuteMpsEndpointKindV7;
  value: number;
  unit: AcuteMpsObservationUnitV7;
  tissueSite?: string;
};

export type AcuteMpsContextV7 = {
  availability: "available";
  role: "acute-mps-mechanistic-context";
  endpointKind: AcuteMpsEndpointKindV7;
  value: number;
  unit: AcuteMpsObservationUnitV7;
  tissueSite: string | null;
  skeletalMuscleInterpretation: "not-accumulated-skeletal-muscle-kg";
  mayInitializeSkeletalMuscleKg: false;
  mayOverwriteSkeletalMuscleKg: false;
  mayValidateSkeletalMuscleKg: false;
  mayCalibrateSkeletalMuscleKg: false;
  mayNumericallyTransitionSkeletalMuscleKg: false;
};

export type RejectedSkeletalMuscleFromMpsV7 = {
  applied: false;
  target: "skeletalMuscleKg";
  policy: AcuteMpsNotSkeletalMusclePolicyV7;
  priorSkeletalMuscleKg: number | null;
  resultingSkeletalMuscleKg: number | null;
  rejectedOperations: readonly [
    "initialize",
    "overwrite",
    "validate",
    "calibrate",
    "numeric-transition",
    "residual-allocate",
  ];
};

export type AcuteMpsMeasurementHandlingV7 = {
  contractVersion: typeof MEASUREMENT_ROLE_CONTRACT_V7_VERSION;
  mpsContext: AcuteMpsContextV7 | {
    availability: "unavailable";
    reason: "missing-acute-mps-observation";
  };
  skeletalMuscleFromMps: RejectedSkeletalMuscleFromMpsV7;
};

export function classifyAcuteMpsEndpointRoleV7(
  endpointKind: AcuteMpsEndpointKindV7,
): {
  role: "acute-mps-mechanistic-context";
  mayInitializeSkeletalMuscleKg: false;
  mayOverwriteSkeletalMuscleKg: false;
  mayValidateSkeletalMuscleKg: false;
  mayCalibrateSkeletalMuscleKg: false;
  mayNumericallyTransitionSkeletalMuscleKg: false;
  skeletalMuscleInterpretation: "not-accumulated-skeletal-muscle-kg";
  endpointKind: AcuteMpsEndpointKindV7;
} {
  return {
    role: "acute-mps-mechanistic-context",
    mayInitializeSkeletalMuscleKg: false,
    mayOverwriteSkeletalMuscleKg: false,
    mayValidateSkeletalMuscleKg: false,
    mayCalibrateSkeletalMuscleKg: false,
    mayNumericallyTransitionSkeletalMuscleKg: false,
    skeletalMuscleInterpretation: "not-accumulated-skeletal-muscle-kg",
    endpointKind,
  };
}

export function resolveAcuteMpsObservationV7(
  observation: AcuteMpsObservationV7,
): AcuteMpsContextV7 {
  if (!Number.isFinite(observation.value)) {
    throw new RangeError("acute MPS observation value must be finite");
  }
  const classification = classifyAcuteMpsEndpointRoleV7(observation.endpointKind);
  return {
    availability: "available",
    role: classification.role,
    endpointKind: observation.endpointKind,
    value: observation.value,
    unit: observation.unit,
    tissueSite: observation.tissueSite?.trim() ? observation.tissueSite.trim() : null,
    skeletalMuscleInterpretation: classification.skeletalMuscleInterpretation,
    mayInitializeSkeletalMuscleKg: false,
    mayOverwriteSkeletalMuscleKg: false,
    mayValidateSkeletalMuscleKg: false,
    mayCalibrateSkeletalMuscleKg: false,
    mayNumericallyTransitionSkeletalMuscleKg: false,
  };
}

function rejectedSkeletalMuscleFromMps(
  priorSkeletalMuscleKg: number | null,
): RejectedSkeletalMuscleFromMpsV7 {
  return {
    applied: false,
    target: "skeletalMuscleKg",
    policy: ACUTE_MPS_NOT_SKELETAL_MUSCLE_POLICY_V7,
    priorSkeletalMuscleKg,
    resultingSkeletalMuscleKg: priorSkeletalMuscleKg,
    rejectedOperations: [
      "initialize",
      "overwrite",
      "validate",
      "calibrate",
      "numeric-transition",
      "residual-allocate",
    ],
  };
}

/**
 * Observation handling: acute MPS/tracer informs mechanistic context only;
 * skeletalMuscleKg is never initialized, overwritten, validated, calibrated, or
 * numerically transitioned from the MPS value.
 */
export function applyAcuteMpsObservationToPhysiologyV7State(input: {
  state: PhysiologyV7State;
  mpsObservation: AcuteMpsObservationV7;
}): {
  state: PhysiologyV7State;
  mpsContext: AcuteMpsContextV7;
  skeletalMuscleFromMps: RejectedSkeletalMuscleFromMpsV7;
} {
  validatePhysiologyV7State(input.state);
  const mpsContext = resolveAcuteMpsObservationV7(input.mpsObservation);
  const state = validatePhysiologyV7State({ ...input.state });
  return {
    state,
    mpsContext,
    skeletalMuscleFromMps: rejectedSkeletalMuscleFromMps(state.skeletalMuscleKg),
  };
}

export function initializePhysiologyV7StateRejectingMpsAsSkeletalMuscleV7(input: {
  mpsObservation: AcuteMpsObservationV7;
  priorState?: PhysiologyV7State | null;
}): {
  state: PhysiologyV7State;
  mpsContext: AcuteMpsContextV7;
  skeletalMuscleFromMps: RejectedSkeletalMuscleFromMpsV7;
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
  return applyAcuteMpsObservationToPhysiologyV7State({
    state: prior,
    mpsObservation: input.mpsObservation,
  });
}

export function rejectResidualMpsAsSkeletalMuscleV7(input: {
  state: PhysiologyV7State;
  residualMpsValue: number;
}): RejectedSkeletalMuscleFromMpsV7 {
  validatePhysiologyV7State(input.state);
  if (!Number.isFinite(input.residualMpsValue)) {
    throw new RangeError("residualMpsValue must be finite");
  }
  return rejectedSkeletalMuscleFromMps(input.state.skeletalMuscleKg);
}

export function rejectAcuteMpsAsSkeletalMuscleValidatorV7(input: {
  skeletalMuscleKg: number | null;
  mpsObservation: AcuteMpsObservationV7;
}): {
  accepted: false;
  reason: "acute-mps-is-not-accumulated-skeletal-muscle-validator";
  policy: AcuteMpsNotSkeletalMusclePolicyV7;
  skeletalMuscleKg: number | null;
  mpsObservation: AcuteMpsObservationV7;
} {
  resolveAcuteMpsObservationV7(input.mpsObservation);
  if (input.skeletalMuscleKg !== null
      && (!Number.isFinite(input.skeletalMuscleKg) || input.skeletalMuscleKg < 0)) {
    throw new RangeError("skeletalMuscleKg must be finite and nonnegative when available");
  }
  return {
    accepted: false,
    reason: "acute-mps-is-not-accumulated-skeletal-muscle-validator",
    policy: ACUTE_MPS_NOT_SKELETAL_MUSCLE_POLICY_V7,
    skeletalMuscleKg: input.skeletalMuscleKg,
    mpsObservation: structuredClone(input.mpsObservation),
  };
}

export function rejectAcuteMpsAsSkeletalMuscleCalibratorV7(input: {
  skeletalMuscleKg: number | null;
  mpsObservation: AcuteMpsObservationV7;
}): {
  accepted: false;
  reason: "acute-mps-is-not-accumulated-skeletal-muscle-calibrator";
  policy: AcuteMpsNotSkeletalMusclePolicyV7;
  skeletalMuscleKg: number | null;
  mpsObservation: AcuteMpsObservationV7;
} {
  resolveAcuteMpsObservationV7(input.mpsObservation);
  if (input.skeletalMuscleKg !== null
      && (!Number.isFinite(input.skeletalMuscleKg) || input.skeletalMuscleKg < 0)) {
    throw new RangeError("skeletalMuscleKg must be finite and nonnegative when available");
  }
  return {
    accepted: false,
    reason: "acute-mps-is-not-accumulated-skeletal-muscle-calibrator",
    policy: ACUTE_MPS_NOT_SKELETAL_MUSCLE_POLICY_V7,
    skeletalMuscleKg: input.skeletalMuscleKg,
    mpsObservation: structuredClone(input.mpsObservation),
  };
}

export function rejectAcuteMpsAsSkeletalMuscleNumericTransitionV7(input: {
  skeletalMuscleKg: number | null;
  mpsObservation: AcuteMpsObservationV7;
}): {
  applied: false;
  reason: "acute-mps-is-not-skeletal-muscle-numeric-transition";
  policy: AcuteMpsNotSkeletalMusclePolicyV7;
  priorSkeletalMuscleKg: number | null;
  resultingSkeletalMuscleKg: number | null;
} {
  resolveAcuteMpsObservationV7(input.mpsObservation);
  if (input.skeletalMuscleKg !== null
      && (!Number.isFinite(input.skeletalMuscleKg) || input.skeletalMuscleKg < 0)) {
    throw new RangeError("skeletalMuscleKg must be finite and nonnegative when available");
  }
  return {
    applied: false,
    reason: "acute-mps-is-not-skeletal-muscle-numeric-transition",
    policy: ACUTE_MPS_NOT_SKELETAL_MUSCLE_POLICY_V7,
    priorSkeletalMuscleKg: input.skeletalMuscleKg,
    resultingSkeletalMuscleKg: input.skeletalMuscleKg,
  };
}

export function handleAcuteMpsMeasurementForPhysiologyV7(input: {
  state: PhysiologyV7State;
  mpsObservation: AcuteMpsObservationV7 | null;
}): AcuteMpsMeasurementHandlingV7 {
  validatePhysiologyV7State(input.state);
  if (input.mpsObservation === null) {
    return {
      contractVersion: MEASUREMENT_ROLE_CONTRACT_V7_VERSION,
      mpsContext: {
        availability: "unavailable",
        reason: "missing-acute-mps-observation",
      },
      skeletalMuscleFromMps: rejectedSkeletalMuscleFromMps(input.state.skeletalMuscleKg),
    };
  }
  const applied = applyAcuteMpsObservationToPhysiologyV7State({
    state: input.state,
    mpsObservation: input.mpsObservation,
  });
  return {
    contractVersion: MEASUREMENT_ROLE_CONTRACT_V7_VERSION,
    mpsContext: applied.mpsContext,
    skeletalMuscleFromMps: applied.skeletalMuscleFromMps,
  };
}

export function acuteMpsMeasurementHandlingV7Fingerprint(
  handling: AcuteMpsMeasurementHandlingV7,
): string {
  return stableSha256(handling);
}
