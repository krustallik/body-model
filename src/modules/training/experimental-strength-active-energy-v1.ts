import {
  WORKOUT_RECOVERY_ENERGY_SCIENTIFIC_DECISION,
  type WorkoutRecoveryEnergyScientificDecision,
} from "@/model/activity/workout-energy";
import { stableSha256 } from "@/modules/model-recovery/recovery-fingerprint";
import type { StrengthSessionDto } from "./training.types";

/**
 * Experimental Strength Active Energy V1 (shadow / EXPERIMENTAL only).
 *
 * Session-level heuristic: body mass × elapsed duration × engineering net
 * intensity prior, optionally modulated by LIVE work/rest density and
 * exercise-class mix. No kcal/set, kcal/rep, kcal/tonnage, HR→kcal, RIR→kcal,
 * Garmin→truth, or EPOC add-on.
 */
export const EXPERIMENTAL_STRENGTH_ACTIVE_ENERGY_V1_REVISION =
  "experimental-strength-active-energy-v1" as const;

export const EXPERIMENTAL_STRENGTH_ACTIVE_ENERGY_V1_PROVENANCE =
  "experimental-heuristic" as const;

/**
 * ENGINEERING PRIOR — session-level net (active-above-rest) MET-equivalent
 * intensity for varied multi-exercise resistance training.
 *
 * Anchored loosely to Compendium-style resistance ranges after subtracting the
 * standard 1-MET resting convention; endpoints are wide engineering priors,
 * not a validated personal coefficient and not a production fixed-MET fallback.
 */
export const ENGINEERING_STRENGTH_NET_MET_V1 = {
  point: 2.5,
  lower: 1.5,
  upper: 5.0,
  classification: "engineering-session-intensity-prior" as const,
  scientificNote:
    "Session-level intensity band only; rejects universal kcal/set, kcal/rep, and kcal/tonnage coefficients.",
} as const;

/**
 * ENGINEERING PRIOR — LIVE density scale bounds from observed set-completion
 * timing. Neutral 1.0 when timing is unavailable; never invents rest timing
 * for RETROSPECTIVE sessions.
 */
export const ENGINEERING_LIVE_DENSITY_SCALE_V1 = {
  /** Reference inter-completion gap (seconds) treated as neutral density. */
  referenceMedianGapSeconds: 150,
  minScale: 0.85,
  maxScale: 1.2,
  classification: "engineering-timing-density-scale" as const,
} as const;

/**
 * ENGINEERING PRIOR — widen RETROSPECTIVE uncertainty when rest timing cannot
 * be observed (do not invent rest intervals).
 */
export const ENGINEERING_RETROSPECTIVE_BOUND_FACTORS_V1 = {
  lowerShrink: 0.75,
  upperExpand: 1.35,
  classification: "engineering-retrospective-uncertainty" as const,
} as const;

export type ExperimentalStrengthActiveEnergyAvailabilityV1 =
  | "available"
  | "unavailable";

export type ExperimentalStrengthActiveEnergyUnavailableReasonV1 =
  | "missing-body-mass"
  | "missing-elapsed-duration"
  | "missing-completed-sets"
  | "non-finite-inputs";

export type ExperimentalStrengthActiveEnergyFeaturesV1 = {
  sessionId: number;
  entryMode: "LIVE" | "RETROSPECTIVE";
  bodyMassKg: number | null;
  elapsedMinutes: number | null;
  completedSetCount: number;
  totalReps: number;
  loadedSetCount: number;
  bodyweightSetCount: number;
  bandSetCount: number;
  ordinaryTonnageKg: number | null;
  rirReportedSetCount: number;
  timingQuality: "unavailable" | "partial" | "completion-times-complete";
  interCompletionMedianSeconds: number | null;
  densityScale: number;
  exerciseClassScale: number;
  netMetPoint: number;
  hrCoverage: "unavailable" | "sparse" | "contextual";
  hrSampleCount: number;
  averageHrBpm: number | null;
  garminReferenceKcal: number | null;
  rejectedMethods: readonly [
    "kcal-per-set-coefficient",
    "kcal-per-rep-coefficient",
    "kcal-per-tonnage-coefficient",
    "hr-to-kcal-formula",
    "rir-to-kcal-coefficient",
    "garmin-truth-calibration",
    "fixed-single-met-fallback",
    "epoc-recovery-add-on",
    "invented-retrospective-rest-timing",
  ];
};

export type ExperimentalStrengthActiveEnergyResultV1 = {
  contractVersion: typeof EXPERIMENTAL_STRENGTH_ACTIVE_ENERGY_V1_REVISION;
  provenance: typeof EXPERIMENTAL_STRENGTH_ACTIVE_ENERGY_V1_PROVENANCE;
  supportedDomain: "resistance-diary-session-shadow-only";
  availability: ExperimentalStrengthActiveEnergyAvailabilityV1;
  estimatedActiveKcal: number | null;
  lowerBoundKcal: number | null;
  upperBoundKcal: number | null;
  unavailableReason: ExperimentalStrengthActiveEnergyUnavailableReasonV1 | null;
  features: ExperimentalStrengthActiveEnergyFeaturesV1;
  reasons: string[];
  recoveryEnergy: WorkoutRecoveryEnergyScientificDecision;
  garminReferenceKcal: number | null;
};

function minutesBetween(start: string | null, end: string | null): number | null {
  if (start === null || end === null) return null;
  const value = (Date.parse(end) - Date.parse(start)) / 60_000;
  return Number.isFinite(value) && value > 0 ? value : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clampNonnegativeFinite(value: number): number {
  if (!Number.isFinite(value)) {
    throw new RangeError("strength active energy values must be finite");
  }
  const clamped = Math.max(0, value);
  return Object.is(clamped, -0) ? 0 : clamped;
}

function rejectedMethods(): ExperimentalStrengthActiveEnergyFeaturesV1["rejectedMethods"] {
  return [
    "kcal-per-set-coefficient",
    "kcal-per-rep-coefficient",
    "kcal-per-tonnage-coefficient",
    "hr-to-kcal-formula",
    "rir-to-kcal-coefficient",
    "garmin-truth-calibration",
    "fixed-single-met-fallback",
    "epoc-recovery-add-on",
    "invented-retrospective-rest-timing",
  ] as const;
}

/**
 * LIVE density scale from observed inter-completion gaps only.
 * RETROSPECTIVE / unavailable timing → neutral 1.0 (no invented rests).
 */
export function engineeringLiveDensityScaleV1(input: {
  entryMode: "LIVE" | "RETROSPECTIVE";
  timingQuality: ExperimentalStrengthActiveEnergyFeaturesV1["timingQuality"];
  interCompletionMedianSeconds: number | null;
}): number {
  if (input.entryMode !== "LIVE") return 1;
  if (input.timingQuality === "unavailable") return 1;
  if (input.interCompletionMedianSeconds === null || !(input.interCompletionMedianSeconds > 0)) {
    return 1;
  }
  const raw = ENGINEERING_LIVE_DENSITY_SCALE_V1.referenceMedianGapSeconds
    / input.interCompletionMedianSeconds;
  return clamp(
    raw,
    ENGINEERING_LIVE_DENSITY_SCALE_V1.minScale,
    ENGINEERING_LIVE_DENSITY_SCALE_V1.maxScale,
  );
}

/**
 * Mild exercise-class context scale — not a load-to-kcal coefficient.
 */
export function engineeringExerciseClassScaleV1(input: {
  completedSetCount: number;
  loadedSetCount: number;
  bodyweightSetCount: number;
  bandSetCount: number;
}): number {
  if (!(input.completedSetCount > 0)) return 1;
  const loadedShare = input.loadedSetCount / input.completedSetCount;
  const bandShare = input.bandSetCount / input.completedSetCount;
  const bodyweightShare = input.bodyweightSetCount / input.completedSetCount;
  // ENGINEERING context only: loaded sessions slightly higher, band slightly lower.
  return clamp(1 + 0.08 * loadedShare + 0.03 * bodyweightShare - 0.06 * bandShare, 0.9, 1.1);
}

export function extractExperimentalStrengthActiveEnergyFeaturesV1(input: {
  session: StrengthSessionDto;
  bodyMassKg: number | null;
  heartRateBpms?: readonly number[];
}): ExperimentalStrengthActiveEnergyFeaturesV1 {
  const { session } = input;
  const sets = session.exercises.flatMap((exercise) =>
    exercise.sets.map((set) => ({ set, exercise })),
  );
  const completionTimes = sets
    .map(({ set }) => set.completedAt)
    .filter((value): value is string => value !== null)
    .map(Date.parse)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  const allTimed = sets.length > 0 && completionTimes.length === sets.length;
  const liveElapsed = minutesBetween(session.webStartedAt, session.webEndedAt);
  const timingQuality = session.entryMode === "LIVE" && allTimed && liveElapsed !== null
    ? "completion-times-complete" as const
    : completionTimes.length > 0
      ? "partial" as const
      : "unavailable" as const;
  const gaps = completionTimes
    .slice(1)
    .map((value, index) => (value - completionTimes[index]) / 1_000)
    .filter((value) => value > 0 && Number.isFinite(value))
    .sort((a, b) => a - b);
  const interCompletionMedianSeconds = gaps.length === 0
    ? null
    : gaps[Math.floor(gaps.length / 2)];
  const elapsedMinutes = liveElapsed
    ?? session.matchedWorkout?.durationMinutes
    ?? minutesBetween(session.matchedWorkout?.startAt ?? null, session.matchedWorkout?.endAt ?? null);
  const hr = input.heartRateBpms ?? [];
  const completedSetCount = sets.length;
  const loadedSetCount = sets.filter(({ exercise, set }) =>
    exercise.resistanceType === "EXTERNAL_WEIGHT" && set.weightKg !== null).length;
  const bodyweightSetCount = sets.filter(({ exercise }) =>
    exercise.resistanceType === "BODYWEIGHT").length;
  const bandSetCount = sets.filter(({ exercise }) =>
    exercise.resistanceType === "RESISTANCE_BAND").length;
  const densityScale = engineeringLiveDensityScaleV1({
    entryMode: session.entryMode,
    timingQuality,
    interCompletionMedianSeconds,
  });
  const exerciseClassScale = engineeringExerciseClassScaleV1({
    completedSetCount,
    loadedSetCount,
    bodyweightSetCount,
    bandSetCount,
  });
  return {
    sessionId: session.id,
    entryMode: session.entryMode,
    bodyMassKg: input.bodyMassKg,
    elapsedMinutes,
    completedSetCount,
    totalReps: sets.reduce((sum, { set }) => sum + set.reps, 0),
    loadedSetCount,
    bodyweightSetCount,
    bandSetCount,
    ordinaryTonnageKg: session.ordinaryTonnageKg,
    rirReportedSetCount: sets.filter(({ set }) => set.rir !== null).length,
    timingQuality,
    interCompletionMedianSeconds,
    densityScale,
    exerciseClassScale,
    netMetPoint: ENGINEERING_STRENGTH_NET_MET_V1.point * densityScale * exerciseClassScale,
    hrCoverage: hr.length === 0 ? "unavailable" : hr.length < 3 ? "sparse" : "contextual",
    hrSampleCount: hr.length,
    averageHrBpm: hr.length === 0 ? null : hr.reduce((sum, value) => sum + value, 0) / hr.length,
    garminReferenceKcal: session.matchedWorkout?.activeEnergyKcal ?? null,
    rejectedMethods: rejectedMethods(),
  };
}

function activeKcalFromSessionIntensityV1(input: {
  bodyMassKg: number;
  elapsedMinutes: number;
  netMet: number;
}): number {
  const hours = input.elapsedMinutes / 60;
  return clampNonnegativeFinite(input.netMet * input.bodyMassKg * hours);
}

/**
 * Estimate resistance-session active kcal from diary evidence.
 * Missing evidence ≠ 0 kcal.
 */
export function estimateExperimentalStrengthActiveEnergyV1(input: {
  session: StrengthSessionDto;
  bodyMassKg: number | null;
  heartRateBpms?: readonly number[];
}): ExperimentalStrengthActiveEnergyResultV1 {
  const features = extractExperimentalStrengthActiveEnergyFeaturesV1(input);

  if (features.bodyMassKg === null || !(features.bodyMassKg > 0) || !Number.isFinite(features.bodyMassKg)) {
    return unavailable(features, "missing-body-mass", [
      "body-mass-required-for-session-intensity-heuristic",
      "missing-evidence-is-not-zero-kcal",
    ]);
  }
  if (features.elapsedMinutes === null || !(features.elapsedMinutes > 0) || !Number.isFinite(features.elapsedMinutes)) {
    return unavailable(features, "missing-elapsed-duration", [
      "elapsed-duration-required-for-session-intensity-heuristic",
      "missing-evidence-is-not-zero-kcal",
    ]);
  }
  if (!(features.completedSetCount > 0)) {
    return unavailable(features, "missing-completed-sets", [
      "completed-sets-required-as-session-work-evidence",
      "missing-evidence-is-not-zero-kcal",
      "no-tonnage-only-shortcut",
    ]);
  }

  const met = ENGINEERING_STRENGTH_NET_MET_V1;
  const density = features.densityScale;
  const classScale = features.exerciseClassScale;

  const point = activeKcalFromSessionIntensityV1({
    bodyMassKg: features.bodyMassKg,
    elapsedMinutes: features.elapsedMinutes,
    netMet: met.point * density * classScale,
  });
  let lower = activeKcalFromSessionIntensityV1({
    bodyMassKg: features.bodyMassKg,
    elapsedMinutes: features.elapsedMinutes,
    netMet: met.lower * density * classScale,
  });
  let upper = activeKcalFromSessionIntensityV1({
    bodyMassKg: features.bodyMassKg,
    elapsedMinutes: features.elapsedMinutes,
    netMet: met.upper * density * classScale,
  });

  if (features.entryMode === "RETROSPECTIVE" || features.timingQuality === "unavailable") {
    const factors = ENGINEERING_RETROSPECTIVE_BOUND_FACTORS_V1;
    lower *= factors.lowerShrink;
    upper *= factors.upperExpand;
  }

  const orderedLower = Math.min(lower, point);
  const orderedUpper = Math.max(upper, point);

  const reasons = [
    "experimental-heuristic-session-mass-duration-intensity",
    "engineering-net-met-band-not-fixed-single-met-fallback",
    "no-kcal-per-set-rep-or-tonnage-coefficient",
    "garmin-active-kcal-reference-only-not-truth",
    "hr-context-coverage-only-not-kcal",
    "rir-context-only-not-kcal-coefficient",
    "epoc-recovery-add-on-intentionally-rejected",
    "exercise-energy-separate-from-epoc-recovery",
    ...(features.entryMode === "LIVE" && features.timingQuality !== "unavailable"
      ? ["live-observed-timing-density-modulates-intensity-prior"]
      : ["retrospective-or-untimed-no-invented-rest-timing", "retrospective-uncertainty-widened"]),
    ...(features.hrCoverage === "contextual"
      ? ["hr-coverage-contextual"]
      : features.hrCoverage === "sparse"
        ? ["hr-coverage-sparse"]
        : ["hr-coverage-unavailable"]),
  ];

  return {
    contractVersion: EXPERIMENTAL_STRENGTH_ACTIVE_ENERGY_V1_REVISION,
    provenance: EXPERIMENTAL_STRENGTH_ACTIVE_ENERGY_V1_PROVENANCE,
    supportedDomain: "resistance-diary-session-shadow-only",
    availability: "available",
    estimatedActiveKcal: point,
    lowerBoundKcal: orderedLower,
    upperBoundKcal: orderedUpper,
    unavailableReason: null,
    features,
    reasons,
    recoveryEnergy: WORKOUT_RECOVERY_ENERGY_SCIENTIFIC_DECISION,
    garminReferenceKcal: features.garminReferenceKcal,
  };
}

function unavailable(
  features: ExperimentalStrengthActiveEnergyFeaturesV1,
  reason: ExperimentalStrengthActiveEnergyUnavailableReasonV1,
  reasons: string[],
): ExperimentalStrengthActiveEnergyResultV1 {
  return {
    contractVersion: EXPERIMENTAL_STRENGTH_ACTIVE_ENERGY_V1_REVISION,
    provenance: EXPERIMENTAL_STRENGTH_ACTIVE_ENERGY_V1_PROVENANCE,
    supportedDomain: "resistance-diary-session-shadow-only",
    availability: "unavailable",
    estimatedActiveKcal: null,
    lowerBoundKcal: null,
    upperBoundKcal: null,
    unavailableReason: reason,
    features,
    reasons,
    recoveryEnergy: WORKOUT_RECOVERY_ENERGY_SCIENTIFIC_DECISION,
    garminReferenceKcal: features.garminReferenceKcal,
  };
}

export function experimentalStrengthActiveEnergyV1Fingerprint(
  result: ExperimentalStrengthActiveEnergyResultV1,
): string {
  return stableSha256(result);
}
