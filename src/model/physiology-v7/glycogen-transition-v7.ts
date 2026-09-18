import type { WorkoutStepperEvidenceV7 } from "@/model/activity/workout-stepper-v7";
import { KCAL_PER_GRAM } from "@/model/constants";
import type { NutritionProvenance } from "@/modules/model-episodes/model-episode.types";
import { stableSha256 } from "@/modules/model-recovery/recovery-fingerprint";
import type { ResistanceTrainingDayExposureV7 } from "./resistance-training-exposure-history-v7";
import { validatePhysiologyV7State, type PhysiologyV7State } from "./state";

/** Qualitative-only Stage-8 boundary; deliberately has no kg transition. */
export const GLYCOGEN_TRANSITION_V7_VERSION = "bodycast-glycogen-transition-v7-4" as const;

/**
 * P-H02 / C-H03: daily carbs are the carbohydrate input. Meal frequency/timing
 * is intentionally not applied at daily resolution. Absence of meal-timing
 * fields is not fasting and is not zero intake.
 */
export const GLYCOGEN_CARBOHYDRATE_TIMING_POLICY_V7 = {
  resolution: "daily-totals-only",
  mealFrequencyEffect: "intentionally-not-applied",
  mealTimingInput: "unavailable-not-zero-or-fasting",
  physiologicalEqualityClaim: "not-asserted",
  scientificDecision: "daily-resolution-policy",
  parameterId: "P-H02",
  researchAuthority: "workout-physiology-v7-audit",
} as const;

export type GlycogenCarbohydrateTimingPolicyV7 =
  typeof GLYCOGEN_CARBOHYDRATE_TIMING_POLICY_V7;

/**
 * P-H03 / C-H05: protein may be present as nutrition context, but v7 applies no
 * independent matched-energy protein→glycogen bonus and invents no protein
 * repletion math.
 */
export const GLYCOGEN_PROTEIN_BONUS_POLICY_V7 = {
  component: "independent-protein-glycogen-bonus",
  application: "intentionally-not-applied",
  numericComponent: "rejected",
  parameterId: "P-H03",
  scientificDecision: "rejected-matched-energy-independent-bonus",
  researchAuthority: "workout-physiology-v7-audit",
} as const;

export type GlycogenProteinBonusPolicyV7 = typeof GLYCOGEN_PROTEIN_BONUS_POLICY_V7;

/**
 * P-I02 / C-I05: aggregate adult literature envelope is research/context
 * metadata only. It never becomes a personal capacity, default, pass/fail
 * threshold, clamp, or scale-weight residual allocator.
 */
export const GLYCOGEN_ADULT_CAPACITY_RANGE_METADATA_V7 = {
  role: "research-context-metadata",
  literatureRangeKg: { lowerKg: 0.3, upperKg: 0.86 },
  parameterId: "P-I02",
  evidenceId: "E-I06",
  researchAuthority: "workout-physiology-v7-audit",
} as const;

export type GlycogenAdultCapacityRangeMetadataV7 =
  typeof GLYCOGEN_ADULT_CAPACITY_RANGE_METADATA_V7;

export const GLYCOGEN_ADULT_CAPACITY_CLAMP_POLICY_V7 = {
  conversion: "adult-literature-range-to-personal-glycogen-capacity",
  application: "intentionally-rejected",
  initialization: "intentionally-rejected",
  capping: "intentionally-rejected",
  clamping: "intentionally-rejected",
  overwrite: "intentionally-rejected",
  validation: "intentionally-rejected",
  personalCapacityDerivation: "intentionally-rejected",
  residualScaleWeightAllocation: "intentionally-rejected",
  claimId: "C-I05",
  scientificDecision: "adult-range-is-contextual-metadata-not-universal-clamp",
  researchAuthority: "workout-physiology-v7-audit",
  metadata: GLYCOGEN_ADULT_CAPACITY_RANGE_METADATA_V7,
} as const;

export type GlycogenAdultCapacityClampPolicyV7 =
  typeof GLYCOGEN_ADULT_CAPACITY_CLAMP_POLICY_V7;

export type GlycogenAdultCapacityContextV7 = {
  availability: "available";
  role: "research-context-metadata";
  literatureRangeKg: GlycogenAdultCapacityRangeMetadataV7["literatureRangeKg"];
  policy: GlycogenAdultCapacityClampPolicyV7;
  mayInitializeGlycogenKg: false;
  mayCapGlycogenKg: false;
  mayClampGlycogenKg: false;
  mayOverwriteGlycogenKg: false;
  mayValidateGlycogenKg: false;
  mayDerivePersonalCapacity: false;
  mayAllocateResidualScaleWeight: false;
};

export type RejectedGlycogenFromAdultCapacityV7 = {
  applied: false;
  target: "glycogenKg";
  policy: GlycogenAdultCapacityClampPolicyV7;
  literatureRangeKg: GlycogenAdultCapacityRangeMetadataV7["literatureRangeKg"];
  priorGlycogenKg: number | null;
  resultingGlycogenKg: number | null;
  rejectedOperations: readonly [
    "initialize",
    "cap",
    "clamp",
    "overwrite",
    "validate",
    "derive-personal-capacity",
    "residual-allocate-from-scale-weight",
  ];
};

export function resolveAdultGlycogenCapacityContextV7(): GlycogenAdultCapacityContextV7 {
  return {
    availability: "available",
    role: "research-context-metadata",
    literatureRangeKg: GLYCOGEN_ADULT_CAPACITY_RANGE_METADATA_V7.literatureRangeKg,
    policy: GLYCOGEN_ADULT_CAPACITY_CLAMP_POLICY_V7,
    mayInitializeGlycogenKg: false,
    mayCapGlycogenKg: false,
    mayClampGlycogenKg: false,
    mayOverwriteGlycogenKg: false,
    mayValidateGlycogenKg: false,
    mayDerivePersonalCapacity: false,
    mayAllocateResidualScaleWeight: false,
  };
}

function rejectedGlycogenFromAdultCapacity(
  priorGlycogenKg: number | null,
): RejectedGlycogenFromAdultCapacityV7 {
  return {
    applied: false,
    target: "glycogenKg",
    policy: GLYCOGEN_ADULT_CAPACITY_CLAMP_POLICY_V7,
    literatureRangeKg: GLYCOGEN_ADULT_CAPACITY_RANGE_METADATA_V7.literatureRangeKg,
    priorGlycogenKg,
    resultingGlycogenKg: priorGlycogenKg,
    rejectedOperations: [
      "initialize",
      "cap",
      "clamp",
      "overwrite",
      "validate",
      "derive-personal-capacity",
      "residual-allocate-from-scale-weight",
    ],
  };
}

/** Literature range never supplies a personal glycogen default. */
export function initializeGlycogenRejectingAdultCapacityDefaultV7(): {
  glycogenKg: null;
  adultCapacityContext: GlycogenAdultCapacityContextV7;
  glycogenFromAdultCapacity: RejectedGlycogenFromAdultCapacityV7;
} {
  return {
    glycogenKg: null,
    adultCapacityContext: resolveAdultGlycogenCapacityContextV7(),
    glycogenFromAdultCapacity: rejectedGlycogenFromAdultCapacity(null),
  };
}

/**
 * Runtime clamp rejection: values below, inside, or above the literature
 * envelope are left unchanged. The range never becomes a hard personal bound.
 */
export function rejectAdultGlycogenCapacityClampV7(input: {
  glycogenKg: number | null;
}): RejectedGlycogenFromAdultCapacityV7 {
  if (input.glycogenKg !== null
      && (!Number.isFinite(input.glycogenKg) || input.glycogenKg < 0)) {
    throw new RangeError("glycogenKg must be finite and nonnegative when available");
  }
  return rejectedGlycogenFromAdultCapacity(input.glycogenKg);
}

export function rejectAdultGlycogenCapacityAsValidatorV7(input: {
  glycogenKg: number | null;
}): {
  accepted: false;
  reason: "adult-literature-range-is-not-personal-glycogen-validator";
  policy: GlycogenAdultCapacityClampPolicyV7;
  glycogenKg: number | null;
  literatureRangeKg: GlycogenAdultCapacityRangeMetadataV7["literatureRangeKg"];
} {
  if (input.glycogenKg !== null
      && (!Number.isFinite(input.glycogenKg) || input.glycogenKg < 0)) {
    throw new RangeError("glycogenKg must be finite and nonnegative when available");
  }
  return {
    accepted: false,
    reason: "adult-literature-range-is-not-personal-glycogen-validator",
    policy: GLYCOGEN_ADULT_CAPACITY_CLAMP_POLICY_V7,
    glycogenKg: input.glycogenKg,
    literatureRangeKg: GLYCOGEN_ADULT_CAPACITY_RANGE_METADATA_V7.literatureRangeKg,
  };
}

export function rejectAdultGlycogenCapacityAsPersonalCapacityV7(): {
  derived: false;
  reason: "adult-literature-range-is-not-personal-glycogen-capacity";
  policy: GlycogenAdultCapacityClampPolicyV7;
  personalCapacityKg: null;
} {
  return {
    derived: false,
    reason: "adult-literature-range-is-not-personal-glycogen-capacity",
    policy: GLYCOGEN_ADULT_CAPACITY_CLAMP_POLICY_V7,
    personalCapacityKg: null,
  };
}

/** Scale-weight residual never allocates into glycogenKg via the adult range. */
export function rejectResidualScaleWeightAsGlycogenV7(input: {
  state: PhysiologyV7State;
  residualScaleWeightKg: number;
}): RejectedGlycogenFromAdultCapacityV7 {
  validatePhysiologyV7State(input.state);
  if (!Number.isFinite(input.residualScaleWeightKg)) {
    throw new RangeError("residualScaleWeightKg must be finite");
  }
  return rejectedGlycogenFromAdultCapacity(input.state.glycogenKg);
}

export type GlycogenCarbohydrateEvidenceV7 =
  | { availability: "available"; provenance: "observed"; carbsG: number }
  | { availability: "available"; provenance: "imputed"; carbsG: number }
  | { availability: "unavailable"; reason: "missing-carbohydrate" };

export type GlycogenProteinContributionV7 =
  | {
    availability: "available";
    provenance: "observed" | "imputed";
    proteinG: number;
    repletionEffect: "none";
    independentBonus: GlycogenProteinBonusPolicyV7;
  }
  | {
    availability: "unavailable";
    reason: "missing-protein";
    repletionEffect: "none";
    independentBonus: GlycogenProteinBonusPolicyV7;
  };

export type GlycogenMatchedMacroEnergyV7 = {
  carbsG: number;
  proteinG: number;
  fatG: number;
  energyKcal: number;
};

export function glycogenCarbohydrateEvidenceV7(input: {
  carbsG: number | null;
  nutrition: NutritionProvenance;
}): GlycogenCarbohydrateEvidenceV7 {
  if (input.carbsG === null) return { availability: "unavailable", reason: "missing-carbohydrate" };
  if (!Number.isFinite(input.carbsG) || input.carbsG < 0) throw new RangeError("carbsG must be finite and nonnegative when available");
  return input.nutrition.observedFields.includes("carbsG")
    ? { availability: "available", provenance: "observed", carbsG: input.carbsG }
    : { availability: "available", provenance: "imputed", carbsG: input.carbsG };
}

export function glycogenProteinContributionV7(input: {
  proteinG: number | null;
  nutrition: NutritionProvenance;
}): GlycogenProteinContributionV7 {
  if (input.proteinG === null) {
    return {
      availability: "unavailable",
      reason: "missing-protein",
      repletionEffect: "none",
      independentBonus: GLYCOGEN_PROTEIN_BONUS_POLICY_V7,
    };
  }
  if (!Number.isFinite(input.proteinG) || input.proteinG < 0) {
    throw new RangeError("proteinG must be finite and nonnegative when available");
  }
  return {
    availability: "available",
    provenance: input.nutrition.observedFields.includes("proteinG") ? "observed" : "imputed",
    proteinG: input.proteinG,
    repletionEffect: "none",
    independentBonus: GLYCOGEN_PROTEIN_BONUS_POLICY_V7,
  };
}

/** Atwater accounting for matched-energy protein↔fat substitution scenarios only. */
export function resolveEnergyMatchedMacroSubstitutionV7(input: {
  carbsG: number;
  proteinG: number;
  energyKcal: number;
}): GlycogenMatchedMacroEnergyV7 {
  if (![input.carbsG, input.proteinG, input.energyKcal].every((value) => Number.isFinite(value) && value >= 0)) {
    throw new RangeError("matched macro inputs must be finite and nonnegative");
  }
  const carbohydrateKcal = input.carbsG * KCAL_PER_GRAM.carbs;
  const proteinKcal = input.proteinG * KCAL_PER_GRAM.protein;
  const residualFatKcal = input.energyKcal - carbohydrateKcal - proteinKcal;
  if (residualFatKcal < 0) {
    throw new RangeError("energyKcal is insufficient for the requested carbohydrate and protein");
  }
  const fatG = residualFatKcal / KCAL_PER_GRAM.fat;
  return {
    carbsG: input.carbsG,
    proteinG: input.proteinG,
    fatG,
    energyKcal: carbohydrateKcal + proteinKcal + fatG * KCAL_PER_GRAM.fat,
  };
}

export type GlycogenExerciseEvidenceV7 = {
  strength: "qualified-depletion-pressure" | "unresolved" | "observed-no-exposure" | "unobserved";
  stepper: "endurance-depletion-pressure" | "observed-no-stepper" | "unobserved";
};

function strengthEvidence(day: ResistanceTrainingDayExposureV7 | null, workoutFeedObserved: boolean | null): GlycogenExerciseEvidenceV7["strength"] {
  if (day === null) return workoutFeedObserved === true ? "observed-no-exposure" : "unobserved";
  if (day.kind === "unobserved") return "unobserved";
  if (day.kind === "unresolved-dose") return "unresolved";
  if (day.kind === "observed-no-exposure") return "observed-no-exposure";
  return day.mappedSetCount > 0 ? "qualified-depletion-pressure" : "unresolved";
}

function stepperEvidence(input: {
  workoutFeedObserved: boolean | null;
  stepperWorkouts: readonly WorkoutStepperEvidenceV7[];
}): GlycogenExerciseEvidenceV7["stepper"] {
  if (input.workoutFeedObserved !== true) return "unobserved";
  return input.stepperWorkouts.some((workout) => workout.workoutEnergy.canonicalWorkoutType === "Stair Climbing")
    ? "endurance-depletion-pressure"
    : "observed-no-stepper";
}

export type GlycogenTransitionV7 = {
  contractVersion: typeof GLYCOGEN_TRANSITION_V7_VERSION;
  transitionSlot: "glycogen-transition-slot";
  quantitativeState: {
    availability: "unavailable";
    reason: "no-approved-quantitative-glycogen-transition" | "no-defensible-initial-glycogen-source";
    stateHandling: "carry-forward-for-simulation" | "state-remains-unavailable";
    carriedForwardGlycogenKg: number | null;
    biologicalTransition: "not-modeled";
  };
  carbohydrateEvidence: GlycogenCarbohydrateEvidenceV7;
  /**
   * Explicit daily-resolution timing policy (C-H03). Records that meal-frequency
   * is not applied; does not invent meal-timing physiology or hourly precision.
   */
  carbohydrateTimingPolicy: GlycogenCarbohydrateTimingPolicyV7;
  /**
   * Protein may be observed as nutrition context (C-H05 / P-H03). Repletion is
   * never improved by protein; the independent matched-energy bonus is rejected.
   */
  proteinContribution: GlycogenProteinContributionV7;
  /**
   * Adult literature envelope (C-I05 / P-I02). Research/context metadata only;
   * never initializes, caps, clamps, overwrites, or validates glycogenKg.
   */
  adultCapacityContext: GlycogenAdultCapacityContextV7;
  glycogenFromAdultCapacity: RejectedGlycogenFromAdultCapacityV7;
  exerciseEvidence: GlycogenExerciseEvidenceV7;
  depletionEvidence: "present" | "absent" | "unresolved";
  repletionEvidence: "present-observed" | "present-imputed" | "unavailable";
  sourceCoverage: "complete-for-qualitative-boundary" | "partial" | "unresolved";
  /** Replay identity contains only source evidence relevant to this boundary. */
  provenance: {
    workoutFeedObserved: boolean | null;
    resistance: { date: string; kind: ResistanceTrainingDayExposureV7["kind"]; mappedSetCount: number; recordedSetCount: number; unmappedSetCount: number; legacyStrengthWorkoutCount: number } | null;
    stepper: Array<{ workoutId: number; canonicalWorkoutType: string | null; startAt: string; endAt: string; durationMinutes: number | null; bracketedStepAvailability: "available" | "unavailable" }>;
  };
  blockers: Array<
    | "no-approved-quantitative-glycogen-transition"
    | "no-defensible-initial-glycogen-source"
    | "missing-carbohydrate"
    | "unresolved-workout-evidence"
  >;
};

export function buildGlycogenTransitionV7(input: {
  priorGlycogenKg: number | null;
  carbohydrate: GlycogenCarbohydrateEvidenceV7;
  protein?: GlycogenProteinContributionV7;
  resistanceExposure: ResistanceTrainingDayExposureV7 | null;
  workoutFeedObserved: boolean | null;
  stepperWorkouts: readonly WorkoutStepperEvidenceV7[];
}): GlycogenTransitionV7 {
  if (input.priorGlycogenKg !== null && (!Number.isFinite(input.priorGlycogenKg) || input.priorGlycogenKg < 0)) {
    throw new RangeError("priorGlycogenKg must be finite and nonnegative when available");
  }
  const proteinContribution = input.protein ?? {
    availability: "unavailable" as const,
    reason: "missing-protein" as const,
    repletionEffect: "none" as const,
    independentBonus: GLYCOGEN_PROTEIN_BONUS_POLICY_V7,
  };
  const exerciseEvidence = {
    strength: strengthEvidence(input.resistanceExposure, input.workoutFeedObserved),
    stepper: stepperEvidence(input),
  } as const;
  const depletionEvidence = exerciseEvidence.strength === "qualified-depletion-pressure"
    || exerciseEvidence.stepper === "endurance-depletion-pressure"
    ? "present"
    : exerciseEvidence.strength === "unresolved" || exerciseEvidence.strength === "unobserved" || exerciseEvidence.stepper === "unobserved"
      ? "unresolved"
      : "absent";
  // Repletion is carbohydrate-driven only; proteinContribution never upgrades this.
  const repletionEvidence = input.carbohydrate.availability === "unavailable"
    ? "unavailable"
    : input.carbohydrate.provenance === "observed" ? "present-observed" : "present-imputed";
  const blockers: GlycogenTransitionV7["blockers"] = ["no-approved-quantitative-glycogen-transition"];
  if (input.priorGlycogenKg === null) blockers.push("no-defensible-initial-glycogen-source");
  if (input.carbohydrate.availability === "unavailable") blockers.push("missing-carbohydrate");
  if (depletionEvidence === "unresolved") blockers.push("unresolved-workout-evidence");
  const adultCapacityContext = resolveAdultGlycogenCapacityContextV7();
  // Literature range never clamps, caps, or rewrites the carried-forward store.
  const glycogenFromAdultCapacity = rejectAdultGlycogenCapacityClampV7({
    glycogenKg: input.priorGlycogenKg,
  });
  if (glycogenFromAdultCapacity.resultingGlycogenKg !== input.priorGlycogenKg) {
    throw new Error("adult glycogen capacity policy violated: literature range mutated glycogenKg");
  }
  const provenance: GlycogenTransitionV7["provenance"] = {
    workoutFeedObserved: input.workoutFeedObserved,
    resistance: input.resistanceExposure === null ? null : {
      date: input.resistanceExposure.date,
      kind: input.resistanceExposure.kind,
      mappedSetCount: input.resistanceExposure.mappedSetCount,
      recordedSetCount: input.resistanceExposure.recordedSetCount,
      unmappedSetCount: input.resistanceExposure.unmappedSetCount,
      legacyStrengthWorkoutCount: input.resistanceExposure.legacyStrengthWorkouts.length,
    },
    stepper: input.stepperWorkouts.map((workout) => ({
      workoutId: workout.workoutEnergy.workoutId,
      canonicalWorkoutType: workout.workoutEnergy.canonicalWorkoutType,
      startAt: workout.workoutEnergy.startAt,
      endAt: workout.workoutEnergy.endAt,
      durationMinutes: workout.workoutEnergy.durationMinutes,
      bracketedStepAvailability: workout.bracketedSteps.availability,
    })),
  };
  return {
    contractVersion: GLYCOGEN_TRANSITION_V7_VERSION,
    transitionSlot: "glycogen-transition-slot",
    quantitativeState: input.priorGlycogenKg === null
      ? { availability: "unavailable", reason: "no-defensible-initial-glycogen-source", stateHandling: "state-remains-unavailable", carriedForwardGlycogenKg: null, biologicalTransition: "not-modeled" }
      : { availability: "unavailable", reason: "no-approved-quantitative-glycogen-transition", stateHandling: "carry-forward-for-simulation", carriedForwardGlycogenKg: input.priorGlycogenKg, biologicalTransition: "not-modeled" },
    carbohydrateEvidence: structuredClone(input.carbohydrate),
    carbohydrateTimingPolicy: GLYCOGEN_CARBOHYDRATE_TIMING_POLICY_V7,
    proteinContribution: structuredClone(proteinContribution),
    adultCapacityContext,
    glycogenFromAdultCapacity,
    exerciseEvidence,
    depletionEvidence,
    repletionEvidence,
    sourceCoverage: input.carbohydrate.availability === "unavailable" || depletionEvidence === "unresolved"
      ? "unresolved"
      : "complete-for-qualitative-boundary",
    provenance,
    blockers,
  };
}

/**
 * Runtime exposure for C-H05: same carbohydrate and total energy, different
 * protein (fat residual adjusts). Glycogen repletion outcomes must not improve
 * with higher protein.
 */
export function buildEnergyMatchedProteinSubstitutionGlycogenPairV7(input: {
  priorGlycogenKg: number | null;
  carbsG: number;
  energyKcal: number;
  lowerProteinG: number;
  higherProteinG: number;
  nutrition: NutritionProvenance;
  resistanceExposure: ResistanceTrainingDayExposureV7 | null;
  workoutFeedObserved: boolean | null;
  stepperWorkouts: readonly WorkoutStepperEvidenceV7[];
}): {
  lowerMacros: GlycogenMatchedMacroEnergyV7;
  higherMacros: GlycogenMatchedMacroEnergyV7;
  lowerProtein: GlycogenTransitionV7;
  higherProtein: GlycogenTransitionV7;
} {
  if (!(input.higherProteinG > input.lowerProteinG)) {
    throw new RangeError("higherProteinG must exceed lowerProteinG");
  }
  const lowerMacros = resolveEnergyMatchedMacroSubstitutionV7({
    carbsG: input.carbsG,
    proteinG: input.lowerProteinG,
    energyKcal: input.energyKcal,
  });
  const higherMacros = resolveEnergyMatchedMacroSubstitutionV7({
    carbsG: input.carbsG,
    proteinG: input.higherProteinG,
    energyKcal: input.energyKcal,
  });
  const carbohydrate = glycogenCarbohydrateEvidenceV7({
    carbsG: input.carbsG,
    nutrition: input.nutrition,
  });
  const shared = {
    priorGlycogenKg: input.priorGlycogenKg,
    carbohydrate,
    resistanceExposure: input.resistanceExposure,
    workoutFeedObserved: input.workoutFeedObserved,
    stepperWorkouts: input.stepperWorkouts,
  } as const;
  return {
    lowerMacros,
    higherMacros,
    lowerProtein: buildGlycogenTransitionV7({
      ...shared,
      protein: glycogenProteinContributionV7({ proteinG: lowerMacros.proteinG, nutrition: input.nutrition }),
    }),
    higherProtein: buildGlycogenTransitionV7({
      ...shared,
      protein: glycogenProteinContributionV7({ proteinG: higherMacros.proteinG, nutrition: input.nutrition }),
    }),
  };
}

/** Glycogen outcome fields used by C-H05; excludes protein amount provenance. */
export function glycogenRepletionOutcomeV7(transition: GlycogenTransitionV7) {
  return {
    carbohydrateEvidence: structuredClone(transition.carbohydrateEvidence),
    repletionEvidence: transition.repletionEvidence,
    quantitativeState: structuredClone(transition.quantitativeState),
    proteinRepletionEffect: transition.proteinContribution.repletionEffect,
    proteinIndependentBonusApplication: transition.proteinContribution.independentBonus.application,
  };
}

/** Evidence identity excludes HR, device calories, display names, and tonnage. */
export function glycogenTransitionV7Fingerprint(transition: GlycogenTransitionV7): string {
  return stableSha256({
    contractVersion: transition.contractVersion,
    carbohydrateEvidence: transition.carbohydrateEvidence,
    carbohydrateTimingPolicy: transition.carbohydrateTimingPolicy,
    proteinContribution: transition.proteinContribution,
    adultCapacityContext: transition.adultCapacityContext,
    glycogenFromAdultCapacity: transition.glycogenFromAdultCapacity,
    exerciseEvidence: transition.exerciseEvidence,
    depletionEvidence: transition.depletionEvidence,
    repletionEvidence: transition.repletionEvidence,
    sourceCoverage: transition.sourceCoverage,
    provenance: transition.provenance,
    blockers: transition.blockers,
  });
}

/** State adapter: carry-forward is bookkeeping, never a zero biological delta. */
export function applyGlycogenTransitionV7(input: {
  state: PhysiologyV7State;
  transition: GlycogenTransitionV7;
}): { state: PhysiologyV7State; transition: GlycogenTransitionV7 } {
  validatePhysiologyV7State(input.state);
  const resultingGlycogenKg = input.transition.quantitativeState.carriedForwardGlycogenKg;
  if (input.transition.glycogenFromAdultCapacity.resultingGlycogenKg !== resultingGlycogenKg) {
    throw new Error("adult glycogen capacity policy violated during apply");
  }
  if (resultingGlycogenKg !== input.state.glycogenKg) {
    throw new Error("glycogen transition mutated glycogenKg outside carry-forward contract");
  }
  return {
    state: { ...input.state, glycogenKg: resultingGlycogenKg },
    transition: structuredClone(input.transition),
  };
}
