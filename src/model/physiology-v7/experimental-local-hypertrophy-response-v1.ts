import {
  type CanonicalMuscleGroupV7,
  CANONICAL_MUSCLE_GROUPS_V7,
} from "@/model/physiology-v7/exercise-muscle-mapping-v7";
import {
  RESISTANCE_TRAINING_EXPOSURE_WEEK_WINDOW_V7,
  type ResistanceTrainingWeeklyAggregateV7,
  utcMondayWeekStart,
} from "@/model/physiology-v7/resistance-training-exposure-history-v7";
import { addCalendarDays } from "@/modules/model-episodes/model-calendar";
import { stableSha256 } from "@/modules/model-recovery/recovery-fingerprint";

/**
 * Experimental Local Hypertrophy Response V1 (shadow / EXPERIMENTAL only).
 *
 * Weekly, per-mapped-muscle expected local hypertrophy response from qualified
 * direct hard-set volume. Dimensionless saturating scale — not kg, not
 * skeletalMuscleKg, and not the whole-body SM-delta heuristic.
 *
 * C-A01: inside the supported domain, added qualified direct volume does not
 * lower group-expected local response. Global concavity is not required.
 *
 * Not production TDEE / forecast / validated v7 semantics / GREEN validation.
 */
export const EXPERIMENTAL_LOCAL_HYPERTROPHY_RESPONSE_V1_REVISION =
  "experimental-local-hypertrophy-response-v1" as const;

export const EXPERIMENTAL_LOCAL_HYPERTROPHY_RESPONSE_V1_PROVENANCE =
  "experimental-heuristic" as const;

export const EXPERIMENTAL_LOCAL_HYPERTROPHY_RESPONSE_V1_UNIT =
  "dimensionless-local-hypertrophy-response" as const;

/**
 * ENGINEERING saturating τ for weekly direct qualified hard-sets per muscle.
 * Order-of-magnitude of commonly discussed weekly set counts (~10–20/muscle);
 * not an “optimal sets” cutoff and not a scientific saturation point (P-A02).
 */
export const ENGINEERING_WEEKLY_DIRECT_SET_SCALE_TAU_V1 = 12 as const;

/** ENGINEERING slower τ → lower bound still nondecreasing in direct volume. */
export const ENGINEERING_WEEKLY_DIRECT_SET_SCALE_TAU_LOWER_V1 = 18 as const;

/** ENGINEERING faster τ → upper bound still nondecreasing in direct volume. */
export const ENGINEERING_WEEKLY_DIRECT_SET_SCALE_TAU_UPPER_V1 = 8 as const;

/** ENGINEERING indirect-only uncertainty widen scale (point unchanged). */
export const ENGINEERING_WEEKLY_INDIRECT_UNCERTAINTY_TAU_V1 = 16 as const;
export const ENGINEERING_WEEKLY_INDIRECT_UNCERTAINTY_WIDTH_V1 = 0.12 as const;

/** ENGINEERING unmapped-set extra-volume upper widen (known direct unchanged). */
export const ENGINEERING_WEEKLY_UNMAPPED_UNCERTAINTY_TAU_V1 = 20 as const;
export const ENGINEERING_WEEKLY_UNMAPPED_UNCERTAINTY_WIDTH_V1 = 0.1 as const;

export const EXPERIMENTAL_LOCAL_HYPERTROPHY_PRIORS_V1 = {
  classification: "engineering-saturating-scale-not-optimal-set-cutoff" as const,
  evidenceIds: ["E-A01", "E-A02", "E-A03"] as const,
  scientificNote:
    "Nondecrease over weekly direct qualified volume is the C-A01 claim; τ and bound widths are engineering priors, not personal or literature-fitted kg/set coefficients.",
} as const;

export type ExperimentalLocalHypertrophyAvailabilityV1 =
  | "available"
  | "unavailable";

export type ExperimentalLocalHypertrophyUnavailableReasonV1 =
  | "missing-mapped-direct-dose"
  | "incomplete-week-coverage"
  | "non-finite-inputs";

export type ExperimentalLocalMuscleResponseV1 = {
  muscleGroup: CanonicalMuscleGroupV7;
  availability: ExperimentalLocalHypertrophyAvailabilityV1;
  expectedLocalResponse: number | null;
  lowerBound: number | null;
  upperBound: number | null;
  unavailableReason: ExperimentalLocalHypertrophyUnavailableReasonV1 | null;
  directQualifiedSetCount: number | null;
  indirectQualifiedSetCount: number | null;
  doseScale: number | null;
};

export type ExperimentalLocalHypertrophyResponseV1 = {
  contractVersion: typeof EXPERIMENTAL_LOCAL_HYPERTROPHY_RESPONSE_V1_REVISION;
  provenance: typeof EXPERIMENTAL_LOCAL_HYPERTROPHY_RESPONSE_V1_PROVENANCE;
  supportedDomain: "weekly-mapped-local-hypertrophy-response-shadow-only";
  unit: typeof EXPERIMENTAL_LOCAL_HYPERTROPHY_RESPONSE_V1_UNIT;
  weekStartDate: string;
  weekEndDate: string;
  weekWindowKind: typeof RESISTANCE_TRAINING_EXPOSURE_WEEK_WINDOW_V7;
  muscleResponses: ExperimentalLocalMuscleResponseV1[];
  features: {
    unmappedSetCount: number;
    sessionCount: number;
    daysUnobserved: number;
    daysUnresolvedDose: number;
    daysObservedMappedExposure: number;
    daysObservedNoExposure: number;
    frequencyMultiplierApplied: false;
    skeletalMuscleKg: null;
    wholeBodySkeletalMuscleDeltaKg: null;
    rejectedConversions: readonly [
      "kg-per-set",
      "skeletalMuscleKg",
      "whole-body-skeletal-muscle-delta",
      "linear-volume-to-hypertrophy",
      "optimal-weekly-set-cutoff",
      "indirect-as-direct-set-credit",
      "frequency-hypertrophy-multiplier",
    ];
  };
  reasons: string[];
  fingerprint: string;
};

function rejectedConversions(): ExperimentalLocalHypertrophyResponseV1["features"]["rejectedConversions"] {
  return [
    "kg-per-set",
    "skeletalMuscleKg",
    "whole-body-skeletal-muscle-delta",
    "linear-volume-to-hypertrophy",
    "optimal-weekly-set-cutoff",
    "indirect-as-direct-set-credit",
    "frequency-hypertrophy-multiplier",
  ] as const;
}

function finiteOrThrow(name: string, value: number): number {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite`);
  return Object.is(value, -0) ? 0 : value;
}

function clamp01(value: number): number {
  return Math.min(0.999, Math.max(0, value));
}

/** Saturating [0, 1) scale. Zero at 0 sets; never a hard cutoff to zero at high volume. */
export function engineeringWeeklyDirectSetScaleV1(
  qualifiedDirectSetCount: number,
  tau: number = ENGINEERING_WEEKLY_DIRECT_SET_SCALE_TAU_V1,
): number {
  if (!(qualifiedDirectSetCount > 0)) return 0;
  if (!(tau > 0) || !Number.isFinite(tau)) {
    throw new RangeError("tau must be finite and positive");
  }
  return 1 - Math.exp(-qualifiedDirectSetCount / tau);
}

function orderedBounds(lower: number, point: number, upper: number): {
  lower: number;
  point: number;
  upper: number;
} {
  const orderedLower = Math.min(lower, point, upper);
  const orderedUpper = Math.max(lower, point, upper);
  const orderedPoint = Math.min(Math.max(point, orderedLower), orderedUpper);
  return { lower: orderedLower, point: orderedPoint, upper: orderedUpper };
}

export type ExperimentalLocalMuscleDoseInputV1 = {
  muscleGroup: CanonicalMuscleGroupV7;
  /** Weekly direct qualified hard sets; null = missing ≠ 0. */
  directQualifiedSetCount: number | null;
  indirectQualifiedSetCount?: number | null;
};

function baseReasons(): string[] {
  return [
    "experimental-heuristic-weekly-saturating-local-response",
    "kg-per-set-intentionally-rejected",
    "skeletalMuscleKg-intentionally-rejected",
    "whole-body-skeletal-muscle-delta-intentionally-rejected",
    "optimal-weekly-set-cutoff-intentionally-rejected",
    "indirect-not-credited-as-direct-volume",
    "frequency-multiplier-intentionally-not-applied",
  ];
}

function unavailableMuscle(
  muscleGroup: CanonicalMuscleGroupV7,
  reason: ExperimentalLocalHypertrophyUnavailableReasonV1,
  directQualifiedSetCount: number | null,
  indirectQualifiedSetCount: number | null,
): ExperimentalLocalMuscleResponseV1 {
  return {
    muscleGroup,
    availability: "unavailable",
    expectedLocalResponse: null,
    lowerBound: null,
    upperBound: null,
    unavailableReason: reason,
    directQualifiedSetCount,
    indirectQualifiedSetCount,
    doseScale: null,
  };
}

function respondForMuscle(input: {
  muscleGroup: CanonicalMuscleGroupV7;
  directQualifiedSetCount: number;
  indirectQualifiedSetCount: number;
  unmappedSetCount: number;
}): ExperimentalLocalMuscleResponseV1 {
  const direct = finiteOrThrow("directQualifiedSetCount", input.directQualifiedSetCount);
  const indirect = finiteOrThrow("indirectQualifiedSetCount", input.indirectQualifiedSetCount);
  if (direct < 0 || indirect < 0) {
    throw new RangeError("set counts must be nonnegative when provided");
  }

  const doseScale = engineeringWeeklyDirectSetScaleV1(direct);
  const point = engineeringWeeklyDirectSetScaleV1(
    direct,
    ENGINEERING_WEEKLY_DIRECT_SET_SCALE_TAU_V1,
  );
  let lower = engineeringWeeklyDirectSetScaleV1(
    direct,
    ENGINEERING_WEEKLY_DIRECT_SET_SCALE_TAU_LOWER_V1,
  );
  let upper = engineeringWeeklyDirectSetScaleV1(
    direct,
    ENGINEERING_WEEKLY_DIRECT_SET_SCALE_TAU_UPPER_V1,
  );

  if (indirect > 0) {
    const widen = ENGINEERING_WEEKLY_INDIRECT_UNCERTAINTY_WIDTH_V1
      * engineeringWeeklyDirectSetScaleV1(
        indirect,
        ENGINEERING_WEEKLY_INDIRECT_UNCERTAINTY_TAU_V1,
      );
    lower = clamp01(lower - widen);
    upper = clamp01(upper + widen);
  }
  if (input.unmappedSetCount > 0) {
    const widen = ENGINEERING_WEEKLY_UNMAPPED_UNCERTAINTY_WIDTH_V1
      * engineeringWeeklyDirectSetScaleV1(
        input.unmappedSetCount,
        ENGINEERING_WEEKLY_UNMAPPED_UNCERTAINTY_TAU_V1,
      );
    upper = clamp01(upper + widen);
  }

  const ordered = orderedBounds(lower, point, upper);
  return {
    muscleGroup: input.muscleGroup,
    availability: "available",
    expectedLocalResponse: ordered.point,
    lowerBound: ordered.lower,
    upperBound: ordered.upper,
    unavailableReason: null,
    directQualifiedSetCount: direct,
    indirectQualifiedSetCount: indirect,
    doseScale,
  };
}

/**
 * Estimate weekly per-muscle local hypertrophy response (dimensionless).
 */
export function estimateExperimentalLocalHypertrophyResponseV1(input: {
  weekStartDate: string;
  weekEndDate?: string;
  muscleGroups: readonly ExperimentalLocalMuscleDoseInputV1[];
  unmappedSetCount?: number;
  sessionCount?: number;
  daysUnobserved?: number;
  daysUnresolvedDose?: number;
  daysObservedMappedExposure?: number;
  daysObservedNoExposure?: number;
}): ExperimentalLocalHypertrophyResponseV1 {
  const weekStartDate = utcMondayWeekStart(input.weekStartDate);
  if (weekStartDate !== input.weekStartDate) {
    throw new RangeError("weekStartDate must be a Monday (engineering UTC calendar week)");
  }
  const weekEndDate = input.weekEndDate ?? addCalendarDays(weekStartDate, 6);
  const unmappedSetCount = input.unmappedSetCount ?? 0;
  const sessionCount = input.sessionCount ?? 0;
  const daysUnobserved = input.daysUnobserved ?? 0;
  const daysUnresolvedDose = input.daysUnresolvedDose ?? 0;
  const daysObservedMappedExposure = input.daysObservedMappedExposure ?? 0;
  const daysObservedNoExposure = input.daysObservedNoExposure ?? 0;

  if (unmappedSetCount < 0 || sessionCount < 0 || daysUnobserved < 0
      || daysUnresolvedDose < 0 || daysObservedMappedExposure < 0
      || daysObservedNoExposure < 0) {
    throw new RangeError("week coverage counts must be nonnegative");
  }

  const byGroup = new Map<CanonicalMuscleGroupV7, ExperimentalLocalMuscleDoseInputV1>();
  for (const row of input.muscleGroups) {
    byGroup.set(row.muscleGroup, row);
  }

  const incompleteCoverage = daysUnobserved > 0 || daysUnresolvedDose > 0 || unmappedSetCount > 0;
  const muscleResponses = CANONICAL_MUSCLE_GROUPS_V7.map((muscleGroup) => {
    const row = byGroup.get(muscleGroup);
    const direct = row?.directQualifiedSetCount ?? null;
    const indirect = row?.indirectQualifiedSetCount === undefined
      ? 0
      : row.indirectQualifiedSetCount;

    if (direct === null) {
      return unavailableMuscle(
        muscleGroup,
        incompleteCoverage && daysObservedMappedExposure === 0 && daysObservedNoExposure < 7
          ? "incomplete-week-coverage"
          : "missing-mapped-direct-dose",
        null,
        indirect,
      );
    }
    if (direct === 0 && (indirect === null || indirect === 0) && incompleteCoverage) {
      return unavailableMuscle(
        muscleGroup,
        daysUnobserved > 0 && daysObservedMappedExposure === 0 && daysObservedNoExposure < 7
          ? "incomplete-week-coverage"
          : "missing-mapped-direct-dose",
        direct,
        indirect,
      );
    }
    return respondForMuscle({
      muscleGroup,
      directQualifiedSetCount: direct,
      indirectQualifiedSetCount: indirect ?? 0,
      unmappedSetCount,
    });
  });

  const reasons = [
    ...baseReasons(),
    "dose-saturating-weekly-direct-hard-set-scale",
    "added-direct-volume-does-not-lower-local-response",
  ];
  if (input.muscleGroups.some((row) => row.directQualifiedSetCount === null)) {
    reasons.push("missing-mapped-direct-dose-is-not-zero-response");
  }
  if (incompleteCoverage) {
    reasons.push("incomplete-or-unmapped-volume-widens-or-unavailables-not-zero");
  }

  const result: ExperimentalLocalHypertrophyResponseV1 = {
    contractVersion: EXPERIMENTAL_LOCAL_HYPERTROPHY_RESPONSE_V1_REVISION,
    provenance: EXPERIMENTAL_LOCAL_HYPERTROPHY_RESPONSE_V1_PROVENANCE,
    supportedDomain: "weekly-mapped-local-hypertrophy-response-shadow-only",
    unit: EXPERIMENTAL_LOCAL_HYPERTROPHY_RESPONSE_V1_UNIT,
    weekStartDate,
    weekEndDate,
    weekWindowKind: RESISTANCE_TRAINING_EXPOSURE_WEEK_WINDOW_V7,
    muscleResponses,
    features: {
      unmappedSetCount,
      sessionCount,
      daysUnobserved,
      daysUnresolvedDose,
      daysObservedMappedExposure,
      daysObservedNoExposure,
      frequencyMultiplierApplied: false,
      skeletalMuscleKg: null,
      wholeBodySkeletalMuscleDeltaKg: null,
      rejectedConversions: rejectedConversions(),
    },
    reasons,
    fingerprint: "",
  };
  result.fingerprint = experimentalLocalHypertrophyResponseV1Fingerprint(result);
  return result;
}

/** Map an existing exposure-history weekly aggregate into the experimental response. */
export function estimateExperimentalLocalHypertrophyFromWeeklyAggregateV1(
  week: ResistanceTrainingWeeklyAggregateV7,
): ExperimentalLocalHypertrophyResponseV1 {
  const incomplete = week.daysUnobserved > 0
    || week.daysUnresolvedDose > 0
    || week.totalUnmappedSetCount > 0;
  const muscleGroups = CANONICAL_MUSCLE_GROUPS_V7.map((muscleGroup) => {
    const bucket = week.muscleGroups.find((row) => row.muscleGroup === muscleGroup);
    const direct = bucket?.directMappedSetCount ?? 0;
    const indirect = bucket?.indirectMappedSetCount ?? 0;
    if (direct === 0 && indirect === 0 && incomplete) {
      return {
        muscleGroup,
        directQualifiedSetCount: null,
        indirectQualifiedSetCount: null,
      };
    }
    return {
      muscleGroup,
      directQualifiedSetCount: direct,
      indirectQualifiedSetCount: indirect,
    };
  });
  return estimateExperimentalLocalHypertrophyResponseV1({
    weekStartDate: week.weekStartDate,
    weekEndDate: week.weekEndDate,
    muscleGroups,
    unmappedSetCount: week.totalUnmappedSetCount,
    sessionCount: week.sessionCount,
    daysUnobserved: week.daysUnobserved,
    daysUnresolvedDose: week.daysUnresolvedDose,
    daysObservedMappedExposure: week.daysObservedMappedExposure,
    daysObservedNoExposure: week.daysObservedNoExposure,
  });
}

/** Deterministic multi-week rebuild. */
export function rebuildExperimentalLocalHypertrophyResponseTrajectoryV1(
  weeks: readonly Parameters<typeof estimateExperimentalLocalHypertrophyResponseV1>[0][],
): ExperimentalLocalHypertrophyResponseV1[] {
  return weeks.map((week) => estimateExperimentalLocalHypertrophyResponseV1(week));
}

export function experimentalLocalHypertrophyResponseV1Fingerprint(
  result: Omit<ExperimentalLocalHypertrophyResponseV1, "fingerprint"> & {
    fingerprint?: string;
  },
): string {
  const rest = { ...result };
  delete rest.fingerprint;
  return stableSha256(rest);
}
