import { stableSha256 } from "@/modules/model-recovery/recovery-fingerprint";

export const EXPERIMENTAL_TRANSIENT_EXERCISE_WATER_V2_REVISION =
  "experimental-transient-exercise-water-v2-impulse-ledger" as const;
export const EXPERIMENTAL_TRANSIENT_EXERCISE_WATER_V2_REPLAY_REVISION =
  "transient-water-v2-model-day-impulse-age-coherent-branches" as const;

export const TRANSIENT_WATER_V2_SET_SCALE_TAU = 8 as const;
export const TRANSIENT_WATER_V2_MAGNITUDE_KG = {
  point: 0.15,
  lower: 0.04,
  upper: 0.45,
} as const;

export const TRANSIENT_WATER_V2_HORIZONS_DAYS = {
  accustomed: { point: 1, lower: 0.75, upper: 1.5 },
  "novel-or-unknown": { point: 3.5, lower: 2, upper: 5 },
} as const;

export type TransientWaterV2ExposureClass = keyof typeof TRANSIENT_WATER_V2_HORIZONS_DAYS;
export type TransientWaterV2Branch = "point" | "lower" | "upper";

export const TRANSIENT_WATER_V2_EXPOSURE_LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000;
export const TRANSIENT_WATER_V2_ACCUSTOMED_SESSION_FLOOR = 2;

export function resolveTransientWaterV2CanonicalEventInstant(input: {
  matchedWorkout?: { startAt: Date } | null;
  effectiveAccountingAt?: Date | null;
  webStartedAt?: Date | null;
  createdAt: Date;
}): Date {
  const instant = input.matchedWorkout?.startAt
    ?? input.effectiveAccountingAt
    ?? input.webStartedAt
    ?? input.createdAt;
  if (!Number.isFinite(instant.getTime())) throw new TypeError("canonical Strength event instant is invalid");
  return instant;
}

export type TransientWaterV2ExposureEvent = {
  strengthDiarySessionId: number;
  eventInstant: Date;
  sourceFingerprint: string;
};

export function resolveTransientWaterV2Exposure(input: {
  event: TransientWaterV2ExposureEvent;
  completedEvents: readonly TransientWaterV2ExposureEvent[];
}): {
  exposureClass: TransientWaterV2ExposureClass;
  dependencies: TransientWaterV2ExposureEvent[];
  dependencyFingerprint: string;
} {
  const eventMs = input.event.eventInstant.getTime();
  if (!Number.isFinite(eventMs)) throw new TypeError("exposure anchor instant is invalid");
  const lowerInclusive = eventMs - TRANSIENT_WATER_V2_EXPOSURE_LOOKBACK_MS;
  const dependencies = input.completedEvents
    .filter((candidate) => candidate.strengthDiarySessionId !== input.event.strengthDiarySessionId
      && Number.isFinite(candidate.eventInstant.getTime())
      && candidate.eventInstant.getTime() >= lowerInclusive
      && candidate.eventInstant.getTime() < eventMs)
    .sort((left, right) => left.eventInstant.getTime() - right.eventInstant.getTime()
      || left.strengthDiarySessionId - right.strengthDiarySessionId);
  const exposureClass = dependencies.length >= TRANSIENT_WATER_V2_ACCUSTOMED_SESSION_FLOOR
    ? "accustomed"
    : "novel-or-unknown";
  return {
    exposureClass,
    dependencies,
    dependencyFingerprint: stableSha256({
      interval: { startInclusive: new Date(lowerInclusive).toISOString(), endExclusive: input.event.eventInstant.toISOString() },
      dependencies,
      exposureClass,
    }),
  };
}

export type TransientExerciseWaterImpulseV2 = {
  contractVersion: typeof EXPERIMENTAL_TRANSIENT_EXERCISE_WATER_V2_REVISION;
  replayRevision: typeof EXPERIMENTAL_TRANSIENT_EXERCISE_WATER_V2_REPLAY_REVISION;
  strengthDiarySessionId: number;
  canonicalEventInstant: string;
  modelEpisodeId: number;
  modelDate: string;
  sessionRevision: number;
  doseInputFingerprint: string;
  doseAvailability: "available" | "unavailable";
  doseProvenance: string;
  qualifiedHardSetCount: number;
  exposureClass: TransientWaterV2ExposureClass;
  exposureDependencyFingerprint: string;
  exposureDependencies: Array<{ strengthDiarySessionId: number; eventInstant: string; sourceFingerprint: string }>;
  sourceFingerprint: string;
  branches: Record<TransientWaterV2Branch, {
    amplitudeKg: number;
    horizonDays: number;
  }>;
};

export type ActiveTransientExerciseWaterImpulseV2 = {
  impulse: TransientExerciseWaterImpulseV2;
  /** Count of completed model-day transitions since the impulse's event day. */
  ageModelDays: number;
};

export type TransientWaterV2Levels = Record<TransientWaterV2Branch, number>;
export type TransientWaterV2Deltas = Record<TransientWaterV2Branch, number>;

export type TransientWaterV2DayInput = {
  episodeId: number;
  modelDate: string;
  boundaryInstant: string;
  impulses: readonly TransientExerciseWaterImpulseV2[];
};

export type TransientWaterV2DayResult = {
  episodeId: number;
  modelDate: string;
  boundaryInstant: string;
  startOfDayLevelKg: TransientWaterV2Levels;
  endOfDayLevelKg: TransientWaterV2Levels;
  branchDeltaKg: TransientWaterV2Deltas;
  dailyDeltaKg: {
    point: number;
    lower: number;
    upper: number;
    numericLowerBranch: TransientWaterV2Branch;
    numericUpperBranch: TransientWaterV2Branch;
  };
  activeImpulseSessionIds: number[];
  sourceFingerprint: string;
};

const BRANCHES: readonly TransientWaterV2Branch[] = ["point", "lower", "upper"];

function finiteNonnegative(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${label} must be finite and nonnegative`);
  return value;
}

export function transientWaterV2DoseScale(qualifiedHardSetCount: number): number {
  finiteNonnegative(qualifiedHardSetCount, "qualifiedHardSetCount");
  return qualifiedHardSetCount === 0
    ? 0
    : 1 - Math.exp(-qualifiedHardSetCount / TRANSIENT_WATER_V2_SET_SCALE_TAU);
}

export function buildTransientExerciseWaterImpulseV2(input: {
  strengthDiarySessionId: number;
  canonicalEventInstant: Date;
  modelEpisodeId: number;
  modelDate: string;
  sessionRevision: number;
  doseInputFingerprint: string;
  doseAvailability: "available" | "unavailable";
  doseProvenance: string;
  qualifiedHardSetCount: number;
  exposureClass: TransientWaterV2ExposureClass;
  exposureDependencyFingerprint: string;
  exposureDependencies: Array<{ strengthDiarySessionId: number; eventInstant: string; sourceFingerprint: string }>;
  sourceFingerprint: string;
}): TransientExerciseWaterImpulseV2 {
  if (!Number.isInteger(input.strengthDiarySessionId) || input.strengthDiarySessionId <= 0) {
    throw new RangeError("strengthDiarySessionId must be a positive integer");
  }
  if (!Number.isInteger(input.modelEpisodeId) || input.modelEpisodeId <= 0) {
    throw new RangeError("modelEpisodeId must be a positive integer");
  }
  if (!Number.isFinite(input.canonicalEventInstant.getTime())) throw new TypeError("canonical event instant is invalid");
  if (!Number.isInteger(input.sessionRevision) || input.sessionRevision < 0) throw new RangeError("sessionRevision is invalid");
  if (input.doseInputFingerprint.length === 0) throw new TypeError("doseInputFingerprint is required");
  const doseCount = finiteNonnegative(input.qualifiedHardSetCount, "qualifiedHardSetCount");
  const numericCount = input.doseAvailability === "available" ? doseCount : 0;
  const scale = transientWaterV2DoseScale(numericCount);
  const horizons = TRANSIENT_WATER_V2_HORIZONS_DAYS[input.exposureClass];
  const branches = Object.fromEntries(BRANCHES.map((branch) => [branch, {
    amplitudeKg: TRANSIENT_WATER_V2_MAGNITUDE_KG[branch] * scale,
    horizonDays: horizons[branch],
  }])) as TransientExerciseWaterImpulseV2["branches"];
  const impulse = {
    contractVersion: EXPERIMENTAL_TRANSIENT_EXERCISE_WATER_V2_REVISION,
    replayRevision: EXPERIMENTAL_TRANSIENT_EXERCISE_WATER_V2_REPLAY_REVISION,
    strengthDiarySessionId: input.strengthDiarySessionId,
    canonicalEventInstant: input.canonicalEventInstant.toISOString(),
    modelEpisodeId: input.modelEpisodeId,
    modelDate: input.modelDate,
    sessionRevision: input.sessionRevision,
    doseInputFingerprint: input.doseInputFingerprint,
    doseAvailability: input.doseAvailability,
    doseProvenance: input.doseProvenance,
    qualifiedHardSetCount: numericCount,
    exposureClass: input.exposureClass,
    exposureDependencyFingerprint: input.exposureDependencyFingerprint,
    exposureDependencies: [...input.exposureDependencies],
    sourceFingerprint: input.sourceFingerprint,
    branches,
  } satisfies TransientExerciseWaterImpulseV2;
  return impulse;
}

export function transientWaterV2ContributionKg(
  impulse: TransientExerciseWaterImpulseV2,
  branch: TransientWaterV2Branch,
  ageModelDays: number,
): number {
  if (!Number.isInteger(ageModelDays) || ageModelDays < 0) throw new RangeError("ageModelDays must be a nonnegative integer");
  const trajectory = impulse.branches[branch];
  if (!Number.isFinite(trajectory.amplitudeKg) || trajectory.amplitudeKg < 0
      || !Number.isFinite(trajectory.horizonDays) || trajectory.horizonDays <= 0) {
    throw new RangeError("impulse trajectory is invalid");
  }
  return trajectory.amplitudeKg * Math.max(0, 1 - ageModelDays / trajectory.horizonDays);
}

function levelsOf(active: readonly ActiveTransientExerciseWaterImpulseV2[]): TransientWaterV2Levels {
  return Object.fromEntries(BRANCHES.map((branch) => [branch,
    active.reduce((sum, entry) => sum + transientWaterV2ContributionKg(entry.impulse, branch, entry.ageModelDays), 0),
  ])) as TransientWaterV2Levels;
}

function orderedEnvelope(values: TransientWaterV2Deltas): TransientWaterV2DayResult["dailyDeltaKg"] {
  const ranked = BRANCHES.map((branch) => ({ branch, value: values[branch] }));
  ranked.sort((left, right) => left.value - right.value || BRANCHES.indexOf(left.branch) - BRANCHES.indexOf(right.branch));
  return {
    point: values.point,
    lower: ranked[0]!.value,
    upper: ranked[ranked.length - 1]!.value,
    numericLowerBranch: ranked[0]!.branch,
    numericUpperBranch: ranked[ranked.length - 1]!.branch,
  };
}

export function replayTransientExerciseWaterV2(input: {
  days: readonly TransientWaterV2DayInput[];
  initialActiveImpulses?: readonly ActiveTransientExerciseWaterImpulseV2[];
}): { days: TransientWaterV2DayResult[]; activeImpulses: ActiveTransientExerciseWaterImpulseV2[] } {
  let active = [...(input.initialActiveImpulses ?? [])].map((entry) => ({ ...entry }));
  const seenDayKeys = new Set<string>();
  let previousBoundaryMs = Number.NEGATIVE_INFINITY;
  const results: TransientWaterV2DayResult[] = [];

  for (const day of input.days) {
    const boundaryMs = Date.parse(day.boundaryInstant);
    if (!Number.isFinite(boundaryMs) || boundaryMs <= previousBoundaryMs) {
      throw new RangeError("transient model-day boundaries must be valid and strictly increasing");
    }
    previousBoundaryMs = boundaryMs;
    const dayKey = `${day.episodeId}|${day.modelDate}`;
    if (seenDayKeys.has(dayKey)) throw new RangeError("duplicate transient model-day identity");
    seenDayKeys.add(dayKey);

    const impulses = [...day.impulses].sort((left, right) =>
      left.canonicalEventInstant.localeCompare(right.canonicalEventInstant)
      || left.strengthDiarySessionId - right.strengthDiarySessionId,
    );
    if (impulses.some((impulse) => impulse.modelEpisodeId !== day.episodeId
        || impulse.modelDate !== day.modelDate
        || Date.parse(impulse.canonicalEventInstant) < boundaryMs)) {
      throw new RangeError("transient impulse does not belong to its episode model day");
    }
    if (new Set(impulses.map((impulse) => impulse.strengthDiarySessionId)).size !== impulses.length) {
      throw new RangeError("one Strength session cannot create more than one transient impulse per model day");
    }
    const impulseIds = new Set(active.map((entry) => entry.impulse.strengthDiarySessionId));
    if (impulses.some((impulse) => impulseIds.has(impulse.strengthDiarySessionId))) {
      throw new RangeError("transient impulse is already present in the initial ledger");
    }

    const startLedger = active.map((entry) => ({ ...entry }));
    const startLevels = levelsOf(startLedger);
    const advanced = active.map((entry) => ({ ...entry, ageModelDays: entry.ageModelDays + 1 }));
    const dayImpulses = impulses.map((impulse) => ({ impulse, ageModelDays: 0 }));
    const allEndEntries = [...advanced, ...dayImpulses];
    const endLevels = levelsOf(allEndEntries);
    const branchDeltaKg = Object.fromEntries(BRANCHES.map((branch) => [branch,
      endLevels[branch] - startLevels[branch],
    ])) as TransientWaterV2Deltas;
    const activeAfterDay = allEndEntries.filter((entry) => BRANCHES.some((branch) =>
      transientWaterV2ContributionKg(entry.impulse, branch, entry.ageModelDays) > 0,
    ));
    active = activeAfterDay;
    results.push({
      episodeId: day.episodeId,
      modelDate: day.modelDate,
      boundaryInstant: day.boundaryInstant,
      startOfDayLevelKg: startLevels,
      endOfDayLevelKg: endLevels,
      branchDeltaKg,
      dailyDeltaKg: orderedEnvelope(branchDeltaKg),
      activeImpulseSessionIds: active.map((entry) => entry.impulse.strengthDiarySessionId).sort((a, b) => a - b),
      sourceFingerprint: stableSha256({
        revision: EXPERIMENTAL_TRANSIENT_EXERCISE_WATER_V2_REVISION,
        replayRevision: EXPERIMENTAL_TRANSIENT_EXERCISE_WATER_V2_REPLAY_REVISION,
        day: { episodeId: day.episodeId, modelDate: day.modelDate, boundaryInstant: day.boundaryInstant },
        startLedger: startLedger.map((entry) => ({
          sessionId: entry.impulse.strengthDiarySessionId,
          ageModelDays: entry.ageModelDays,
          sourceFingerprint: entry.impulse.sourceFingerprint,
        })),
        addedImpulses: impulses,
        branchDeltaKg,
      }),
    });
  }
  return { days: results, activeImpulses: active };
}

export function transientExerciseWaterV2Fingerprint(value: unknown): string {
  return stableSha256(value);
}
