import { stableSha256 } from "@/modules/model-recovery/recovery-fingerprint";
import {
  resolveSleepObservationV7,
  type SleepObservationV7,
} from "./sleep-hrv-context-v7";

/**
 * Experimental Chronic Sleep / Anabolic Context V1 (shadow only).
 *
 * Classifies repeated observed low-sleep context around an existing relative
 * skeletal-muscle estimate. It does not supply a sleep→muscle coefficient,
 * interpret consumer stages as body composition, or rewrite physiology.
 */
export const EXPERIMENTAL_CHRONIC_SLEEP_ANABOLIC_CONTEXT_V1_REVISION =
  "experimental-chronic-sleep-anabolic-context-v1" as const;
export const EXPERIMENTAL_CHRONIC_SLEEP_ANABOLIC_CONTEXT_V1_PROVENANCE =
  "experimental-heuristic" as const;

/** Engineering context labels only, not clinical thresholds or muscle rates. */
export const EXPERIMENTAL_CHRONIC_SLEEP_ANABOLIC_CONTEXT_V1_PRIORS = {
  lowSleepContextMinutes: 360,
  repeatedObservedLowSleepNights: 3,
  sustainedRestrictionUncertaintyWidthMultiplier: 1.2,
  classification: "engineering-repeated-sleep-context-thresholds-not-anabolic-coefficients" as const,
  scientificDecision: "no-exact-daily-or-chronic-sleep-to-muscle-kg-rule",
  centralEstimateTreatment: "unchanged" as const,
} as const;

export type RelativeSkeletalMuscleDeltaEvidenceForSleepV1 = {
  estimatedSkeletalMuscleDeltaKg: number | null;
  lowerBoundKg: number | null;
  upperBoundKg: number | null;
  supportedDomain: string;
};

export type ExperimentalChronicSleepAnabolicContextStateV1 = {
  consecutiveObservedLowSleepNights: number;
};

export type ExperimentalChronicSleepAnabolicContextResultV1 = {
  contractVersion: typeof EXPERIMENTAL_CHRONIC_SLEEP_ANABOLIC_CONTEXT_V1_REVISION;
  provenance: typeof EXPERIMENTAL_CHRONIC_SLEEP_ANABOLIC_CONTEXT_V1_PROVENANCE;
  supportedDomain: "chronic-sleep-anabolic-context-shadow-only";
  availability: "available" | "unavailable";
  sleepContextStatus:
    | "unknown-sleep-coverage"
    | "one-low-sleep-night-context"
    | "observed-no-sustained-restriction"
    | "sustained-observed-low-sleep-context";
  state: ExperimentalChronicSleepAnabolicContextStateV1;
  sleepSource: "wearable-consumer" | "manual-log" | null;
  wearableSleepIsNotPsg: boolean;
  measurementUncertainty: "retained" | "unavailable";
  uncertaintyWidthMultiplier: number | null;
  underlyingRelativeSkeletalMuscleDeltaKg: number | null;
  sleepAdjustedPointEstimateKg: number | null;
  sleepAdjustedLowerBoundKg: number | null;
  sleepAdjustedUpperBoundKg: number | null;
  centralEstimateModified: false;
  positiveAnabolicBonusFromSleep: 0;
  sleepStageDrivenBodyComposition: false;
  trainingProteinEnergyMathChanged: false;
  absoluteSkeletalMuscleKg: null;
  rejectedConversions: readonly [
    "sleep-to-skeletalMuscleKg",
    "sleep-stage-to-body-composition",
    "wearable-sleep-as-psg",
    "one-poor-night-daily-anabolic-multiplier",
    "chronic-sleep-anabolic-coefficient",
  ];
  reasons: string[];
  fingerprint: string;
};

function initialState(): ExperimentalChronicSleepAnabolicContextStateV1 {
  return { consecutiveObservedLowSleepNights: 0 };
}

function rejectedConversions(): ExperimentalChronicSleepAnabolicContextResultV1["rejectedConversions"] {
  return [
    "sleep-to-skeletalMuscleKg",
    "sleep-stage-to-body-composition",
    "wearable-sleep-as-psg",
    "one-poor-night-daily-anabolic-multiplier",
    "chronic-sleep-anabolic-coefficient",
  ] as const;
}

function finish(
  partial: Omit<ExperimentalChronicSleepAnabolicContextResultV1, "fingerprint">,
): ExperimentalChronicSleepAnabolicContextResultV1 {
  const result: ExperimentalChronicSleepAnabolicContextResultV1 = { ...partial, fingerprint: "" };
  result.fingerprint = experimentalChronicSleepAnabolicContextV1Fingerprint(result);
  return result;
}

function widenBounds(input: {
  point: number;
  lower: number;
  upper: number;
  multiplier: number;
}): { lower: number; upper: number } {
  const lower = input.point - (input.point - input.lower) * input.multiplier;
  const upper = input.point + (input.upper - input.point) * input.multiplier;
  return { lower: Math.min(lower, input.point, upper), upper: Math.max(lower, input.point, upper) };
}

/**
 * One daily context transition. Missing sleep clears the verified observed
 * streak: unknown coverage cannot establish chronic restriction.
 */
export function transitionExperimentalChronicSleepAnabolicContextV1(input: {
  sleepObservation: SleepObservationV7 | null;
  underlying: RelativeSkeletalMuscleDeltaEvidenceForSleepV1;
  prior?: ExperimentalChronicSleepAnabolicContextStateV1 | null;
}): ExperimentalChronicSleepAnabolicContextResultV1 {
  const prior = input.prior ?? initialState();
  const sleep = resolveSleepObservationV7(input.sleepObservation);
  const base = {
    contractVersion: EXPERIMENTAL_CHRONIC_SLEEP_ANABOLIC_CONTEXT_V1_REVISION,
    provenance: EXPERIMENTAL_CHRONIC_SLEEP_ANABOLIC_CONTEXT_V1_PROVENANCE,
    supportedDomain: "chronic-sleep-anabolic-context-shadow-only" as const,
    underlyingRelativeSkeletalMuscleDeltaKg: input.underlying.estimatedSkeletalMuscleDeltaKg,
    centralEstimateModified: false as const,
    positiveAnabolicBonusFromSleep: 0 as const,
    sleepStageDrivenBodyComposition: false as const,
    trainingProteinEnergyMathChanged: false as const,
    absoluteSkeletalMuscleKg: null,
    rejectedConversions: rejectedConversions(),
  };
  if (sleep.availability === "unavailable") {
    return finish({
      ...base,
      availability: "unavailable",
      sleepContextStatus: "unknown-sleep-coverage",
      state: initialState(),
      sleepSource: null,
      wearableSleepIsNotPsg: false,
      measurementUncertainty: "unavailable",
      uncertaintyWidthMultiplier: null,
      sleepAdjustedPointEstimateKg: input.underlying.estimatedSkeletalMuscleDeltaKg,
      sleepAdjustedLowerBoundKg: null,
      sleepAdjustedUpperBoundKg: null,
      reasons: [
        "missing-sleep-is-unknown-not-zero",
        "unknown-sleep-coverage-does-not-establish-chronic-restriction",
        "missing-sleep-does-not-alter-underlying-muscle-point-estimate",
      ],
    });
  }

  const isLow = sleep.durationMinutes <= EXPERIMENTAL_CHRONIC_SLEEP_ANABOLIC_CONTEXT_V1_PRIORS.lowSleepContextMinutes;
  const streak = isLow ? prior.consecutiveObservedLowSleepNights + 1 : 0;
  const sustained = streak >= EXPERIMENTAL_CHRONIC_SLEEP_ANABOLIC_CONTEXT_V1_PRIORS.repeatedObservedLowSleepNights;
  const multiplier = sustained
    ? EXPERIMENTAL_CHRONIC_SLEEP_ANABOLIC_CONTEXT_V1_PRIORS.sustainedRestrictionUncertaintyWidthMultiplier
    : 1;
  const point = input.underlying.estimatedSkeletalMuscleDeltaKg;
  const lower = input.underlying.lowerBoundKg;
  const upper = input.underlying.upperBoundKg;
  const hasUnderlyingInterval = point !== null && lower !== null && upper !== null;
  const adjusted = hasUnderlyingInterval
    ? widenBounds({ point, lower, upper, multiplier })
    : null;
  const sleepContextStatus = sustained
    ? "sustained-observed-low-sleep-context" as const
    : isLow
      ? "one-low-sleep-night-context" as const
      : "observed-no-sustained-restriction" as const;
  return finish({
    ...base,
    availability: hasUnderlyingInterval ? "available" : "unavailable",
    sleepContextStatus,
    state: { consecutiveObservedLowSleepNights: streak },
    sleepSource: sleep.source,
    wearableSleepIsNotPsg: sleep.provenance.psgEquivalence === "intentionally-rejected",
    measurementUncertainty: "retained",
    uncertaintyWidthMultiplier: hasUnderlyingInterval ? multiplier : null,
    sleepAdjustedPointEstimateKg: point,
    sleepAdjustedLowerBoundKg: adjusted?.lower ?? null,
    sleepAdjustedUpperBoundKg: adjusted?.upper ?? null,
    reasons: [
      sustained
        ? "repeated-observed-low-sleep-context-widens-uncertainty-only"
        : isLow
          ? "one-low-sleep-night-is-context-not-a-daily-anabolic-penalty"
          : "observed-sleep-does-not-establish-sustained-restriction",
      "wearable-sleep-uncertainty-retained-not-psg-truth",
      "sleep-stages-do-not-drive-body-composition",
      "sleep-does-not-create-positive-anabolic-bonus",
      "underlying-training-protein-energy-math-is-preserved",
    ],
  });
}

/** Deterministic chronological rebuild of the context-only shadow trajectory. */
export function rebuildExperimentalChronicSleepAnabolicContextTrajectoryV1(input: {
  days: readonly {
    date: string;
    sleepObservation: SleepObservationV7 | null;
    underlying: RelativeSkeletalMuscleDeltaEvidenceForSleepV1;
  }[];
}): Array<{ date: string; result: ExperimentalChronicSleepAnabolicContextResultV1 }> {
  let state = initialState();
  let priorDate: string | null = null;
  // A feed may duplicate a single night.  It is one chronological night, not
  // repeated evidence.  The stable tie-breaker also makes shuffled imports
  // replay identically; it does not confer extra confidence on either copy.
  const onePerCalendarNight = new Map<string, (typeof input.days)[number]>();
  for (const day of input.days) {
    const candidateKey = stableSha256({
      source: day.sleepObservation?.availability === "available" ? day.sleepObservation.source : null,
      minutes: day.sleepObservation?.availability === "available" ? day.sleepObservation.durationMinutes : null,
      underlying: day.underlying,
    });
    const existing = onePerCalendarNight.get(day.date);
    const existingKey = existing === undefined ? null : stableSha256({
      source: existing.sleepObservation?.availability === "available" ? existing.sleepObservation.source : null,
      minutes: existing.sleepObservation?.availability === "available" ? existing.sleepObservation.durationMinutes : null,
      underlying: existing.underlying,
    });
    if (existingKey === null || candidateKey < existingKey) onePerCalendarNight.set(day.date, day);
  }
  return [...onePerCalendarNight.values()].sort((a, b) => a.date.localeCompare(b.date)).map((day) => {
    if (priorDate !== null && calendarDayDistance(priorDate, day.date) !== 1) state = initialState();
    const result = transitionExperimentalChronicSleepAnabolicContextV1({
      sleepObservation: day.sleepObservation,
      underlying: day.underlying,
      prior: state,
    });
    state = result.state;
    priorDate = day.date;
    return { date: day.date, result };
  });
}

function calendarDayDistance(from: string, to: string): number {
  const fromMs = Date.parse(`${from}T00:00:00.000Z`);
  const toMs = Date.parse(`${to}T00:00:00.000Z`);
  return Number.isFinite(fromMs) && Number.isFinite(toMs) ? Math.round((toMs - fromMs) / 86_400_000) : Number.NaN;
}

export function experimentalChronicSleepAnabolicContextV1Fingerprint(
  result: Omit<ExperimentalChronicSleepAnabolicContextResultV1, "fingerprint"> & { fingerprint?: string },
): string {
  const rest = { ...result };
  delete rest.fingerprint;
  return stableSha256(rest);
}
