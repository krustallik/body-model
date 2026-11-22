import {
  BODY_MAP_GROUP_CATALOG_V2,
  BODY_MAP_MEMBERSHIP_V2,
  type AnatomyIdV2,
  type BodyMapGroupIdV2,
} from "@/modules/training/body-map-catalog-v2";
import {
  resolveStoredExerciseAnatomySnapshotV1,
} from "@/modules/training/exercise-anatomy-mapping-v1";
import {
  EXERCISE_ANATOMY_SNAPSHOT_V2_PROPERTY,
  parseExerciseAnatomySnapshotV2,
} from "@/modules/training/exercise-anatomy-mapping-v2";
import {
  deriveBodyMapExposureV2,
  projectExerciseAnatomyToBodyMapV2,
  type ExerciseAnatomyProjectionInputV2,
  type BodyMapGroupExposureV2,
} from "@/modules/training/body-map-training-exposure-v2";

export const BODY_MAP_TRAINING_ANALYTICS_CONTRACT_V1 = "bodycast-body-map-training-analytics-v1" as const;
export type BodyMapAnalyticsWeeksV1 = 4 | 8 | 12;
export type BodyMapAnalyticsSessionIntentV1 =
  | "regular"
  | "easy-deload"
  | "strength"
  | "test"
  | "return-from-break";

export type BodyMapAnalyticsSetInputV1 = {
  id: number;
  setNumber: number;
  reps: number;
  weightKg: number | null;
  bandNominalResistanceKg: number | null;
  rir: number | null;
  restBeforeSeconds?: number | null;
  completedAt: Date | null;
};

export type BodyMapAnalyticsExerciseInputV1 = {
  id: number;
  snapshotExerciseName: string;
  sortOrder: number;
  plannedSets: number;
  plannedRepsMin: number | null;
  plannedRepsMax: number | null;
  plannedRir: number | null;
  resistanceType: string;
  muscleMappingSnapshot: unknown | null;
  sourceExerciseCatalog?: { stableKey: string | null } | null;
  sets: readonly BodyMapAnalyticsSetInputV1[];
};

export type BodyMapAnalyticsSessionInputV1 = {
  id: number;
  effectiveAccountingAt: Date | null;
  matchedWorkout: { startAt: Date } | null;
  webStartedAt: Date | null;
  createdAt: Date;
  accountingTimeZone: string | null;
  sessionIntent: BodyMapAnalyticsSessionIntentV1 | null;
  sessionLoadAssessment?: "LIGHTER" | "NOT_LIGHTER" | null;
  trainingBlockLabel: string | null;
  trainingWeekNumber: number | null;
  exercises: readonly BodyMapAnalyticsExerciseInputV1[];
};

export type BodyMapAnalyticsSetV1 = {
  id: number;
  sessionId: number;
  exerciseName: string;
  exerciseStableKey: string | null;
  resistanceType: string;
  order: number;
  setNumber: number;
  reps: number;
  weightKg: number | null;
  bandNominalResistanceKg: number | null;
  rir: number | null;
  restBeforeSeconds: number | null;
  completedAt: string | null;
  sessionDate: string;
  sessionIntent: BodyMapAnalyticsSessionIntentV1 | null;
  sessionPhaseNumber: number;
  sessionLoadStatus: BodyMapSessionLoadAssessmentV1["status"];
  trainingBlockLabel: string | null;
  trainingWeekNumber: number | null;
  plannedSets: number;
  actualExerciseSetCount: number;
  plannedRepsMin: number | null;
  plannedRepsMax: number | null;
  plannedRir: number | null;
  exerciseIndex: number;
  exercisesInSession: number;
  precedingExercises: Array<{ name: string; stableKey: string | null; loggedSets: number; groupIds: BodyMapGroupIdV2[] }>;
  exposure: "direct" | "indirect";
  anatomyIds: AnatomyIdV2[];
  directAnatomyIds: AnatomyIdV2[];
  indirectAnatomyIds: AnatomyIdV2[];
};

export type BodyMapAnalyticsAnatomyV1 = {
  anatomyId: AnatomyIdV2;
  directUniqueSetCount: number;
  indirectUniqueSetCount: number;
  totalUniqueSetCount: number;
  loggedTrainingDayCount: number;
  loggedExposureIntervals: BodyMapLoggedExposureIntervalV1[];
  mappingCoverage: "complete-for-input" | "partial";
};

export type BodyMapLoggedExposureIntervalV1 = {
  previousDate: string;
  nextDate: string;
  calendarDays: number;
};

export type BodyMapAnalyticsWeeklyV1 = {
  weekStart: string;
  loggedSessionCount: number;
  directUniqueSetCount: number;
  indirectUniqueSetCount: number;
  totalUniqueSetCount: number;
  mappingCoverage: "complete-for-input" | "partial";
};

export type BodyMapAnalyticsExerciseV1 = {
  stableKey: string | null;
  exerciseName: string;
  resistanceType: string;
  directUniqueSetCount: number;
  indirectUniqueSetCount: number;
  totalUniqueSetCount: number;
  sessions: number;
  sets: BodyMapAnalyticsSetV1[];
  performanceTrend: BodyMapAnalyticsTrendV1;
};

export type BodyMapAnalyticsCoverageSourceV1 = {
  setId: number;
  sessionId: number;
  sessionDate: string;
  exerciseName: string;
  exerciseStableKey: string | null;
  exerciseIndex: number;
  setNumber: number;
  reps: number;
  resistanceType: string;
  weightKg: number | null;
  bandNominalResistanceKg: number | null;
  rir: number | null;
  mappingCoverage: "complete" | "partial" | "unavailable";
  projectedToBodyMap: boolean;
  anatomyIds: AnatomyIdV2[];
};

type BodyMapAnalyticsTrendStatusV1 = "improving" | "declining" | "steady" | "mixed" | "insufficient-data";

type BodyMapAnalyticsTrendSummaryV1 = {
  status: BodyMapAnalyticsTrendStatusV1;
  comparableSessionCount: number;
  comparedSetPairs: number;
  note: string;
  evidence: Array<{
    previousSessionId: number;
    currentSessionId: number;
    previousDate: string;
    currentDate: string;
    setNumber: number;
    resistanceType: string;
    previousWeightKg: number | null;
    currentWeightKg: number | null;
    previousBandNominalResistanceKg: number | null;
    currentBandNominalResistanceKg: number | null;
    previousReps: number;
    currentReps: number;
    rir: number;
  }>;
};

export type BodyMapAnalyticsTrendSegmentV1 = BodyMapAnalyticsTrendSummaryV1 & {
  phaseNumber: number;
  blockLabel: string | null;
  sessionIntent: BodyMapAnalyticsSessionIntentV1 | null;
  fromDate: string;
  toDate: string;
};

export type BodyMapSessionLoadAssessmentV1 = {
  status: "lighter" | "not-lighter" | "uncertain";
  source: "automatic" | "manual" | "unavailable";
  reason: "reduced-volume" | "higher-reported-rir" | "usual-pattern" | "mixed-signals" | "insufficient-history" | "manual-response" | "other-session-context";
  actualSetCount: number;
  comparableActualSetCount: number | null;
  typicalSetCount: number | null;
  reportedRirSetCount: number;
  medianRir: number | null;
  typicalMedianRir: number | null;
  comparableExerciseCount: number;
  canAskForManualAssessment: boolean;
};

export type BodyMapAnalyticsTrendV1 = BodyMapAnalyticsTrendSummaryV1 & {
  /** Retained for API compatibility; automatic comparison currently uses one evidence-based series. */
  segments: BodyMapAnalyticsTrendSegmentV1[];
};

export type BodyMapTrainingAnalyticsV1 = {
  contract: typeof BODY_MAP_TRAINING_ANALYTICS_CONTRACT_V1;
  weeks: BodyMapAnalyticsWeeksV1;
  period: { from: string; to: string };
  coverage: {
    completedSessionCount: number;
    recordedSetCount: number;
    mappedSetCount: number;
    partiallyMappedSetCount: number;
    unmappedSetCount: number;
    mapping: "complete-for-input" | "partial" | "unknown";
    note: string;
    sources: BodyMapAnalyticsCoverageSourceV1[];
  };
  sessions: Array<{
    id: number;
    sessionDate: string;
    phaseNumber: number;
    sessionIntent: BodyMapAnalyticsSessionIntentV1 | null;
    trainingBlockLabel: string | null;
    trainingWeekNumber: number | null;
    loadAssessment: BodyMapSessionLoadAssessmentV1;
    exerciseCount: number;
    recordedSetCount: number;
  }>;
  groups: Array<BodyMapGroupExposureV2 & {
    loggedTrainingDayCount: number;
    loggedExposureIntervals: BodyMapLoggedExposureIntervalV1[];
    reportedRirSetCount: number;
    unreportedRirSetCount: number;
    rirCounts: Array<{ rir: number; uniqueSetCount: number }>;
    anatomy: BodyMapAnalyticsAnatomyV1[];
    weekly: BodyMapAnalyticsWeeklyV1[];
    exercises: BodyMapAnalyticsExerciseV1[];
  }>;
};

export type BodyMapTrainingSessionContextV1 = {
  sessionId: number;
  sessionDate: string;
  timeZone: string | null;
  sleep: null | {
    status: "recorded";
    sleepDate: string;
    totalSleepMinutes: number;
    segmentCount: number;
    source: string[];
    dateAttribution: string;
  };
  nutrition: {
    status: "recorded" | "unavailable";
    date: string;
    caloriesKcal: number | null;
    proteinG: number | null;
    source: "daily-health-record" | null;
    updatedAt: string | null;
  };
};

export type BodyMapTrainingAnalyticsResponseV1 = BodyMapTrainingAnalyticsV1 & {
  sessionContexts: BodyMapTrainingSessionContextV1[];
};

type MappingSnapshot = ExerciseAnatomyProjectionInputV2;

function mappingFromSnapshot(value: unknown): MappingSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(record, EXERCISE_ANATOMY_SNAPSHOT_V2_PROPERTY)
    && record[EXERCISE_ANATOMY_SNAPSHOT_V2_PROPERTY] !== null) {
    const snapshot = parseExerciseAnatomySnapshotV2(record[EXERCISE_ANATOMY_SNAPSHOT_V2_PROPERTY]);
    return snapshot ? {
      stableKey: snapshot.stableKey,
      mappingVersion: snapshot.mappingVersion,
      targets: snapshot.targets,
    } : null;
  }
  const snapshot = resolveStoredExerciseAnatomySnapshotV1(value);
  return snapshot.availability === "available" ? {
    stableKey: snapshot.stableKey,
    mappingVersion: snapshot.mappingVersion,
    targets: snapshot.targets,
  } : null;
}

export function bodyMapLocalDateV1(instant: Date, timeZone: string | null): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timeZone || "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(instant);
    const value = (key: string) => parts.find((part) => part.type === key)?.value ?? "";
    return `${value("year")}-${value("month")}-${value("day")}`;
  } catch {
    return instant.toISOString().slice(0, 10);
  }
}

function mondayOf(date: string): string {
  const utc = new Date(`${date}T00:00:00.000Z`);
  const day = utc.getUTCDay();
  utc.setUTCDate(utc.getUTCDate() - ((day + 6) % 7));
  return utc.toISOString().slice(0, 10);
}

function loggedExposureIntervals(dates: Iterable<string>): BodyMapLoggedExposureIntervalV1[] {
  const ordered = [...new Set(dates)].sort();
  return ordered.slice(1).map((nextDate, index) => {
    const previousDate = ordered[index]!;
    return {
      previousDate,
      nextDate,
      calendarDays: (Date.parse(`${nextDate}T00:00:00.000Z`) - Date.parse(`${previousDate}T00:00:00.000Z`)) / 86_400_000,
    };
  });
}

function eventInstant(session: BodyMapAnalyticsSessionInputV1): Date {
  return session.effectiveAccountingAt
    ?? session.matchedWorkout?.startAt
    ?? session.webStartedAt
    ?? session.createdAt;
}

type ExerciseLoadObservation = { setCount: number; rirs: number[] };
type LoadSignals = { volume: "lower" | "usual" | "higher" | "unknown"; effort: "lighter" | "usual" | "unknown"; typicalSetCount: number | null; typicalMedianRir: number | null; comparableExerciseCount: number };

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
}

function loadObservations(session: BodyMapAnalyticsSessionInputV1): Map<string, ExerciseLoadObservation> {
  const occurrences = new Map<string, number>();
  const observations = new Map<string, ExerciseLoadObservation>();
  for (const exercise of [...session.exercises].sort((left, right) => left.sortOrder - right.sortOrder || left.id - right.id)) {
    const stableKey = exercise.sourceExerciseCatalog?.stableKey
      ?? mappingFromSnapshot(exercise.muscleMappingSnapshot)?.stableKey
      ?? null;
    if (!stableKey) continue;
    const baseKey = `${stableKey}:${exercise.resistanceType}`;
    const occurrence = occurrences.get(baseKey) ?? 0;
    occurrences.set(baseKey, occurrence + 1);
    observations.set(`${baseKey}:${occurrence}`, {
      setCount: exercise.sets.length,
      rirs: exercise.sets.flatMap(({ rir }) => rir === null ? [] : [rir]),
    });
  }
  return observations;
}

function inferSessionLoadAssessment(
  session: BodyMapAnalyticsSessionInputV1,
  earlierSessions: readonly BodyMapAnalyticsSessionInputV1[],
  earlierAssessments: ReadonlyMap<number, BodyMapSessionLoadAssessmentV1>,
): BodyMapSessionLoadAssessmentV1 {
  const observations = loadObservations(session);
  const actualSetCount = session.exercises.reduce((total, exercise) => total + exercise.sets.length, 0);
  const allRirs = session.exercises.flatMap((exercise) => exercise.sets.flatMap(({ rir }) => rir === null ? [] : [rir]));
  const medianRir = median(allRirs);
  const normalHistory = earlierSessions.filter((earlier) => {
    return earlierAssessments.get(earlier.id)?.status === "not-lighter";
  });
  const volumeComparisons: Array<{ actual: number; typical: number }> = [];
  const rirComparisons: Array<{ actual: number; typical: number }> = [];

  for (const [key, current] of observations) {
    const prior = normalHistory.flatMap((pastSession) => {
      const value = loadObservations(pastSession).get(key);
      return value ? [value] : [];
    }).slice(-4);
    if (prior.length >= 2) {
      const typical = median(prior.map(({ setCount }) => setCount));
      if (typical !== null) volumeComparisons.push({ actual: current.setCount, typical });
    }
    const priorRirs = prior.flatMap(({ rirs }) => rirs.length >= 2 ? [median(rirs)!] : []);
    const currentRir = current.rirs.length >= 2 ? median(current.rirs) : null;
    if (priorRirs.length >= 2 && currentRir !== null) {
      const typical = median(priorRirs);
      if (typical !== null) rirComparisons.push({ actual: currentRir, typical });
    }
  }

  const enoughVolumeCoverage = observations.size > 0
    && volumeComparisons.length >= (observations.size === 1 ? 1 : Math.max(2, Math.ceil(observations.size * 0.6)));
  // Conservative diary heuristics only: a 20% volume shift needs two prior
  // exercise occurrences; RIR remains a self-report and is never an effort score.
  const typicalSetCount = enoughVolumeCoverage
    ? volumeComparisons.reduce((total, value) => total + value.typical, 0)
    : null;
  const comparableActualSetCount = enoughVolumeCoverage
    ? volumeComparisons.reduce((total, value) => total + value.actual, 0)
    : null;
  const setChange = typicalSetCount !== null && comparableActualSetCount !== null
    ? comparableActualSetCount - typicalSetCount
    : null;
  const reductionRatio = typicalSetCount && setChange !== null ? -setChange / typicalSetCount : 0;
  const volume: LoadSignals["volume"] = !enoughVolumeCoverage || typicalSetCount === null || comparableActualSetCount === null
    ? "unknown"
    : setChange! <= -1 && reductionRatio >= 0.2 ? "lower"
      : setChange! >= 1 && setChange! / typicalSetCount >= 0.2 ? "higher"
        : reductionRatio >= -0.1 ? "usual" : "unknown";

  const typicalMedianRir = rirComparisons.length > 0
    ? median(rirComparisons.map(({ typical }) => typical))
    : null;
  const currentComparableMedianRir = rirComparisons.length > 0
    ? median(rirComparisons.map(({ actual }) => actual))
    : null;
  const rirDelta = currentComparableMedianRir !== null && typicalMedianRir !== null
    ? currentComparableMedianRir - typicalMedianRir
    : null;
  const reportsRirForMostSets = allRirs.length >= 2 && allRirs.length / Math.max(1, actualSetCount) >= 0.6;
  const clearlyHighReportedRir = reportsRirForMostSets && medianRir !== null && medianRir >= 4;
  const clearlyNearFailure = reportsRirForMostSets && medianRir !== null && medianRir <= 2;
  const effort: LoadSignals["effort"] = clearlyHighReportedRir
    || (rirDelta !== null && rirDelta >= 2 && currentComparableMedianRir !== null && currentComparableMedianRir >= 3)
    ? "lighter"
    : clearlyNearFailure || (rirDelta !== null && rirDelta < 2) ? "usual" : "unknown";

  const loadSignals: LoadSignals = {
    volume,
    effort,
    typicalSetCount,
    typicalMedianRir,
    comparableExerciseCount: volumeComparisons.length,
  };
  const automatic: BodyMapSessionLoadAssessmentV1 = {
    status: volume === "lower" || (effort === "lighter" && volume !== "higher")
      ? "lighter"
      : volume === "higher" && effort === "lighter" ? "uncertain"
        : (effort === "usual" && (volume === "usual" || volume === "higher" || clearlyNearFailure)) ? "not-lighter"
            : "uncertain",
    source: "automatic",
    reason: volume === "lower" ? "reduced-volume"
      : effort === "lighter" && volume !== "higher" ? "higher-reported-rir"
        : volume === "higher" && effort === "lighter" ? "mixed-signals"
            : (effort === "usual" && (volume === "usual" || volume === "higher" || clearlyNearFailure)) ? "usual-pattern"
            : "insufficient-history",
    actualSetCount,
    comparableActualSetCount,
    typicalSetCount: loadSignals.typicalSetCount,
    reportedRirSetCount: allRirs.length,
    medianRir,
    typicalMedianRir: loadSignals.typicalMedianRir,
    comparableExerciseCount: loadSignals.comparableExerciseCount,
    canAskForManualAssessment: false,
  };

  if (session.sessionLoadAssessment === "LIGHTER" || session.sessionLoadAssessment === "NOT_LIGHTER") {
    return {
      ...automatic,
      status: session.sessionLoadAssessment === "LIGHTER" ? "lighter" : "not-lighter",
      source: "manual",
      reason: "manual-response",
    };
  }
  if (automatic.status !== "uncertain") return automatic;
  return {
    ...automatic,
    source: "unavailable",
    canAskForManualAssessment: true,
    reason: "insufficient-history",
  };
}

type MutableGroup = {
  sets: Map<string, BodyMapAnalyticsSetV1>;
  direct: Set<string>;
  indirect: Set<string>;
  days: Set<string>;
  anatomy: Map<AnatomyIdV2, { direct: Set<string>; indirect: Set<string>; days: Set<string>; partial: boolean }>;
  exercises: Map<string, {
    stableKey: string | null;
    exerciseName: string;
    resistanceType: string;
    direct: Set<string>;
    indirect: Set<string>;
    sets: BodyMapAnalyticsSetV1[];
  }>;
  weeklyEvents: Map<string, { sessions: Set<number>; events: Set<string>; unmapped: boolean }>;
};

function compareSetPair(
  previous: BodyMapAnalyticsSetV1,
  current: BodyMapAnalyticsSetV1,
): -1 | 0 | 1 | null {
  if (previous.rir === null || current.rir === null || previous.rir !== current.rir) return null;
  if (previous.restBeforeSeconds === null || current.restBeforeSeconds === null
    || previous.restBeforeSeconds !== current.restBeforeSeconds) return null;
  if (previous.resistanceType === "BODYWEIGHT") return null;
  const previousLoad = previous.resistanceType === "RESISTANCE_BAND"
    ? previous.bandNominalResistanceKg : previous.weightKg;
  const currentLoad = current.resistanceType === "RESISTANCE_BAND"
    ? current.bandNominalResistanceKg : current.weightKg;
  if (previousLoad === null || currentLoad === null) return null;
  const loadDelta = currentLoad - previousLoad;
  const repsDelta = current.reps - previous.reps;
  if (loadDelta === 0) return repsDelta === 0 ? 0 : repsDelta > 0 ? 1 : -1;
  if (repsDelta === 0) return loadDelta > 0 ? 1 : -1;
  if (loadDelta > 0 && repsDelta > 0) return 1;
  if (loadDelta < 0 && repsDelta < 0) return -1;
  return null;
}

function trendForPhase(sets: BodyMapAnalyticsSetV1[]): BodyMapAnalyticsTrendSummaryV1 {
  const precedingSequence = (set: BodyMapAnalyticsSetV1) => JSON.stringify(
    set.precedingExercises.map((exercise) => [
      exercise.stableKey ?? `name:${exercise.name}`,
      exercise.loggedSets,
    ]),
  );
  const bySessionPosition = new Map<string, BodyMapAnalyticsSetV1[]>();
  for (const set of sets) {
    if (set.sessionLoadStatus !== "not-lighter") continue;
    const key = `${set.sessionId}:${set.exerciseIndex}`;
    bySessionPosition.set(key, [...(bySessionPosition.get(key) ?? []), set]);
  }
  const sessions = [...bySessionPosition.values()]
    .map((rows) => rows.sort((a, b) => a.setNumber - b.setNumber))
    .sort((a, b) => a[0]!.sessionDate.localeCompare(b[0]!.sessionDate) || a[0]!.exerciseIndex - b[0]!.exerciseIndex);
  const sessionIds = new Set<number>();
  const comparableSessionDates = new Map<number, string>();
  const directions: Array<-1 | 0 | 1> = [];
  const evidence: BodyMapAnalyticsTrendSummaryV1["evidence"] = [];
  for (let index = 1; index < sessions.length; index += 1) {
    const previous = sessions[index - 1]!;
    const current = sessions[index]!;
    const left = previous[0]!;
    const right = current[0]!;
    if (left.sessionId === right.sessionId
      || left.exerciseStableKey === null || left.exerciseStableKey !== right.exerciseStableKey
      || left.resistanceType !== right.resistanceType
      || left.exerciseIndex !== right.exerciseIndex
      || left.precedingExercises.length !== right.precedingExercises.length
      || precedingSequence(left) !== precedingSequence(right)
      || left.plannedSets !== right.plannedSets
      || left.plannedRepsMin !== right.plannedRepsMin
      || left.plannedRepsMax !== right.plannedRepsMax
      || left.plannedRir !== right.plannedRir) continue;
    const priorByNumber = new Map(previous.map((set) => [set.setNumber, set]));
    const pairDirections = current.flatMap((set) => {
      const prior = priorByNumber.get(set.setNumber);
      if (!prior || prior.rir === null || set.rir === null || prior.rir !== set.rir) return [];
      const direction = compareSetPair(prior, set);
      if (direction === null) return [];
      evidence.push({
        previousSessionId: prior.sessionId,
        currentSessionId: set.sessionId,
        previousDate: prior.sessionDate,
        currentDate: set.sessionDate,
        setNumber: set.setNumber,
        resistanceType: set.resistanceType,
        previousWeightKg: prior.weightKg,
        currentWeightKg: set.weightKg,
        previousBandNominalResistanceKg: prior.bandNominalResistanceKg,
        currentBandNominalResistanceKg: set.bandNominalResistanceKg,
        previousReps: prior.reps,
        currentReps: set.reps,
        rir: set.rir,
      });
      return [direction];
    });
    if (pairDirections.length === 0) continue;
    sessionIds.add(left.sessionId);
    sessionIds.add(right.sessionId);
    comparableSessionDates.set(left.sessionId, left.sessionDate);
    comparableSessionDates.set(right.sessionId, right.sessionDate);
    directions.push(...pairDirections);
  }
  const sessionDates = [...comparableSessionDates.values()].sort();
  const spanDays = sessionDates.length > 1
    ? (Date.parse(`${sessionDates.at(-1)}T00:00:00Z`) - Date.parse(`${sessionDates[0]}T00:00:00Z`)) / 86_400_000
    : 0;
  if (sessionIds.size < 3 || spanDays < 28 || directions.length < 2) {
    return {
      status: "insufficient-data",
      comparableSessionCount: sessionIds.size,
      comparedSetPairs: directions.length,
      note: "At least three comparable non-light sessions across four weeks are required; values remain traceable to the set log.",
      evidence: evidence.slice(-5),
    };
  }
  if (directions.every((direction) => direction > 0)) return {
    status: "improving",
    comparableSessionCount: sessionIds.size,
    comparedSetPairs: directions.length,
    note: "Recorded load or repetitions increased with the same exercise order, plan, preceding sequence, rest, and reported RIR; lighter or uncertain sessions are excluded.",
    evidence: evidence.slice(-5),
  };
  if (directions.every((direction) => direction < 0)) return {
    status: "declining",
    comparableSessionCount: sessionIds.size,
    comparedSetPairs: directions.length,
    note: "Recorded load or repetitions decreased with the same exercise order, plan, preceding sequence, rest, and reported RIR; lighter or uncertain sessions are excluded.",
    evidence: evidence.slice(-5),
  };
  if (directions.every((direction) => direction === 0)) return {
    status: "steady",
    comparableSessionCount: sessionIds.size,
    comparedSetPairs: directions.length,
    note: "Recorded load and repetitions were unchanged in the compared sets.",
    evidence: evidence.slice(-5),
  };
  return {
    status: "mixed",
    comparableSessionCount: sessionIds.size,
    comparedSetPairs: directions.length,
    note: "Comparable set records changed in more than one direction.",
    evidence: evidence.slice(-5),
  };
}

function trendForExercise(
  sets: BodyMapAnalyticsSetV1[],
  phaseBySession: ReadonlyMap<number, number>,
  phaseContext: ReadonlyMap<number, Pick<BodyMapAnalyticsTrendSegmentV1, "blockLabel" | "sessionIntent">>,
): BodyMapAnalyticsTrendV1 {
  const setsByPhase = new Map<number, BodyMapAnalyticsSetV1[]>();
  for (const set of sets) {
    const phase = phaseBySession.get(set.sessionId) ?? 0;
    setsByPhase.set(phase, [...(setsByPhase.get(phase) ?? []), set]);
  }
  const segments = [...setsByPhase.entries()].sort(([left], [right]) => left - right).map(([phase, phaseSets]) => {
    const dates = phaseSets.map(({ sessionDate }) => sessionDate).sort();
    return {
      phaseNumber: phase + 1,
      blockLabel: phaseContext.get(phase)?.blockLabel ?? null,
      sessionIntent: phaseContext.get(phase)?.sessionIntent ?? null,
      fromDate: dates[0]!,
      toDate: dates.at(-1)!,
      ...trendForPhase(phaseSets),
    };
  });
  const latest = segments.at(-1);
  const fallback: BodyMapAnalyticsTrendSummaryV1 = {
    status: "insufficient-data",
    comparableSessionCount: 0,
    comparedSetPairs: 0,
    note: "At least three comparable non-light sessions across four weeks are required; values remain traceable to the set log.",
    evidence: [],
  };
  if (!latest) return { ...fallback, segments };
  return {
    status: latest.status,
    comparableSessionCount: latest.comparableSessionCount,
    comparedSetPairs: latest.comparedSetPairs,
    note: segments.length > 1
      ? "The summary reflects the latest stored training phase; older phases remain separate. Easier or uncertain sessions are still excluded from trend comparisons."
      : latest.note,
    evidence: latest.evidence,
    segments,
  };
}

function trainingPhases(sessions: readonly BodyMapAnalyticsSessionInputV1[]): {
  phaseBySession: Map<number, number>;
  phaseContext: Map<number, Pick<BodyMapAnalyticsTrendSegmentV1, "blockLabel" | "sessionIntent">>;
} {
  const phaseBySession = new Map<number, number>();
  const phaseContext = new Map<number, Pick<BodyMapAnalyticsTrendSegmentV1, "blockLabel" | "sessionIntent">>();
  let phase = 0;
  let previous: BodyMapAnalyticsSessionInputV1 | null = null;
  let lastKnownTrainingWeekNumber: number | null = null;
  for (const session of sessions) {
    const blockOrIntentChanged = previous !== null && (
      previous.trainingBlockLabel !== session.trainingBlockLabel
      || previous.sessionIntent !== session.sessionIntent
    );
    const weekReset = !blockOrIntentChanged && lastKnownTrainingWeekNumber !== null
      && session.trainingWeekNumber !== null && session.trainingWeekNumber < lastKnownTrainingWeekNumber;
    const phaseChanged = blockOrIntentChanged || weekReset;
    if (phaseChanged) phase += 1;
    if (blockOrIntentChanged) lastKnownTrainingWeekNumber = null;
    phaseBySession.set(session.id, phase);
    phaseContext.set(phase, { blockLabel: session.trainingBlockLabel, sessionIntent: session.sessionIntent });
    if (session.trainingWeekNumber !== null) lastKnownTrainingWeekNumber = session.trainingWeekNumber;
    previous = session;
  }
  return { phaseBySession, phaseContext };
}

export function buildBodyMapTrainingAnalyticsV1(input: {
  sessions: readonly BodyMapAnalyticsSessionInputV1[];
  weeks: BodyMapAnalyticsWeeksV1;
  now: Date;
}): BodyMapTrainingAnalyticsV1 {
  const to = input.now;
  const from = new Date(to.getTime() - input.weeks * 7 * 86_400_000);
  const assessmentLookback = new Date(to.getTime() - 12 * 7 * 86_400_000);
  const sourceSessions = input.sessions
    .filter((session) => {
      const occurredAt = eventInstant(session);
      return occurredAt >= assessmentLookback && occurredAt <= to;
    })
    .sort((left, right) => eventInstant(left).getTime() - eventInstant(right).getTime() || left.id - right.id);
  const loadAssessmentBySession = new Map<number, BodyMapSessionLoadAssessmentV1>();
  for (const [index, session] of sourceSessions.entries()) {
    loadAssessmentBySession.set(session.id, inferSessionLoadAssessment(session, sourceSessions.slice(0, index), loadAssessmentBySession));
  }
  const sessions = sourceSessions.filter((session) => eventInstant(session) >= from);
  const { phaseBySession, phaseContext } = trainingPhases(sessions);
  const events: Parameters<typeof deriveBodyMapExposureV2>[0]["events"][number][] = [];
  const groups = new Map<BodyMapGroupIdV2, MutableGroup>();
  const makeGroup = (): MutableGroup => ({
    sets: new Map(), direct: new Set(), indirect: new Set(), days: new Set(),
    anatomy: new Map(), exercises: new Map(), weeklyEvents: new Map(),
  });
  for (const group of BODY_MAP_GROUP_CATALOG_V2) groups.set(group.id, makeGroup());
  let recordedSetCount = 0;
  let mappedSetCount = 0;
  let unmappedSetCount = 0;
  let partialMappingSetCount = 0;
  const weeklyIncomplete = new Set<string>();
  const coverageSources: BodyMapAnalyticsCoverageSourceV1[] = [];

  for (const session of sessions) {
    const occurredAt = eventInstant(session);
    const sessionDate = bodyMapLocalDateV1(occurredAt, session.accountingTimeZone);
    const weekStart = mondayOf(sessionDate);
    const orderedExercises = [...session.exercises].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
    for (const [exercisePosition, exercise] of orderedExercises.entries()) {
      const mapping = mappingFromSnapshot(exercise.muscleMappingSnapshot);
      const stableKey = mapping?.stableKey ?? exercise.sourceExerciseCatalog?.stableKey ?? null;
      for (const set of exercise.sets) {
        recordedSetCount += 1;
        const physicalSetId = String(set.id);
        const exerciseIndex = exercisePosition + 1;
        if (!mapping || mapping.targets.length === 0) {
          unmappedSetCount += 1;
          weeklyIncomplete.add(weekStart);
          coverageSources.push({
            setId: set.id,
            sessionId: session.id,
            sessionDate,
            exerciseName: exercise.snapshotExerciseName,
            exerciseStableKey: stableKey,
            exerciseIndex,
            setNumber: set.setNumber,
            reps: set.reps,
            resistanceType: exercise.resistanceType,
            weightKg: set.weightKg,
            bandNominalResistanceKg: set.bandNominalResistanceKg,
            rir: set.rir,
            mappingCoverage: "unavailable",
            projectedToBodyMap: false,
            anatomyIds: [],
          });
          continue;
        }
        const hasPartialMapping = mapping.targets.some((target) => target.coverage !== "supported");
        if (hasPartialMapping) {
          partialMappingSetCount += 1;
        }
        const mappingEvent = {
          kind: "strength-set" as const,
          physicalSetId,
          exerciseStableKey: mapping.stableKey,
          mapping,
        };
        events.push(mappingEvent);
        const projected = projectExerciseAnatomyToBodyMapV2(physicalSetId, mapping);
        if (projected.length === 0) {
          unmappedSetCount += 1;
          weeklyIncomplete.add(weekStart);
        } else {
          mappedSetCount += 1;
        }
        coverageSources.push({
          setId: set.id,
          sessionId: session.id,
          sessionDate,
          exerciseName: exercise.snapshotExerciseName,
          exerciseStableKey: stableKey,
          exerciseIndex,
          setNumber: set.setNumber,
          reps: set.reps,
          resistanceType: exercise.resistanceType,
          weightKg: set.weightKg,
          bandNominalResistanceKg: set.bandNominalResistanceKg,
          rir: set.rir,
          mappingCoverage: hasPartialMapping ? "partial" : "complete",
          projectedToBodyMap: projected.length > 0,
          anatomyIds: [...new Set(projected.map((row) => row.anatomyId))],
        });
        for (const row of projected) {
          const group = groups.get(row.groupId)!;
          const week = group.weeklyEvents.get(weekStart) ?? { sessions: new Set<number>(), events: new Set<string>(), unmapped: false };
          week.sessions.add(session.id);
          week.events.add(physicalSetId);
          week.unmapped ||= mapping.targets.some((target) => target.anatomyId === row.anatomyId && target.coverage !== "supported");
          group.weeklyEvents.set(weekStart, week);
          group.days.add(sessionDate);
          const setRow: BodyMapAnalyticsSetV1 = {
            id: set.id,
            sessionId: session.id,
            exerciseName: exercise.snapshotExerciseName,
            exerciseStableKey: stableKey,
            resistanceType: exercise.resistanceType,
            order: exercise.sortOrder,
            setNumber: set.setNumber,
            reps: set.reps,
            weightKg: set.weightKg,
            bandNominalResistanceKg: set.bandNominalResistanceKg,
            rir: set.rir,
            restBeforeSeconds: set.restBeforeSeconds ?? null,
            completedAt: set.completedAt?.toISOString() ?? null,
            sessionDate,
            sessionIntent: session.sessionIntent,
            sessionPhaseNumber: (phaseBySession.get(session.id) ?? 0) + 1,
            sessionLoadStatus: loadAssessmentBySession.get(session.id)?.status ?? "uncertain",
            trainingBlockLabel: session.trainingBlockLabel,
            trainingWeekNumber: session.trainingWeekNumber,
            plannedSets: exercise.plannedSets,
            actualExerciseSetCount: exercise.sets.length,
            plannedRepsMin: exercise.plannedRepsMin,
            plannedRepsMax: exercise.plannedRepsMax,
            plannedRir: exercise.plannedRir,
            exerciseIndex: exercisePosition + 1,
            exercisesInSession: orderedExercises.length,
            precedingExercises: orderedExercises.slice(0, exercisePosition)
              .map((candidate) => {
                const previousMapping = mappingFromSnapshot(candidate.muscleMappingSnapshot);
                const previousGroupIds = previousMapping
                  ? [...new Set(projectExerciseAnatomyToBodyMapV2("context", previousMapping).map((target) => target.groupId))]
                  : [];
                return {
                  name: candidate.snapshotExerciseName,
                  stableKey: previousMapping?.stableKey ?? candidate.sourceExerciseCatalog?.stableKey ?? null,
                  loggedSets: candidate.sets.length,
                  groupIds: previousGroupIds,
                };
              }),
            exposure: row.exposure,
            anatomyIds: [row.anatomyId],
            directAnatomyIds: row.exposure === "direct" ? [row.anatomyId] : [],
            indirectAnatomyIds: row.exposure === "indirect" ? [row.anatomyId] : [],
          };
          const groupSet = group.sets.get(physicalSetId);
          if (groupSet) {
            groupSet.anatomyIds = [...new Set([...groupSet.anatomyIds, row.anatomyId])];
            if (row.exposure === "direct") groupSet.directAnatomyIds = [...new Set([...groupSet.directAnatomyIds, row.anatomyId])];
            else groupSet.indirectAnatomyIds = [...new Set([...groupSet.indirectAnatomyIds, row.anatomyId])];
            if (row.exposure === "direct") groupSet.exposure = "direct";
          } else group.sets.set(physicalSetId, setRow);
          (row.exposure === "direct" ? group.direct : group.indirect).add(physicalSetId);

          const anatomy = group.anatomy.get(row.anatomyId) ?? { direct: new Set<string>(), indirect: new Set<string>(), days: new Set<string>(), partial: false };
          (row.exposure === "direct" ? anatomy.direct : anatomy.indirect).add(physicalSetId);
          anatomy.days.add(sessionDate);
          anatomy.partial ||= mapping.targets.some((target) => target.anatomyId === row.anatomyId && target.coverage !== "supported");
          group.anatomy.set(row.anatomyId, anatomy);

          const exerciseKey = `${mapping.stableKey}:${exercise.resistanceType}`;
          const contribution = group.exercises.get(exerciseKey) ?? {
            stableKey,
            exerciseName: exercise.snapshotExerciseName,
            resistanceType: exercise.resistanceType,
            direct: new Set<string>(),
            indirect: new Set<string>(),
            sets: [],
          };
          (row.exposure === "direct" ? contribution.direct : contribution.indirect).add(physicalSetId);
          const existingSet = contribution.sets.find((candidate) => candidate.id === set.id && candidate.sessionId === session.id);
          if (existingSet) {
            existingSet.anatomyIds = [...new Set([...existingSet.anatomyIds, row.anatomyId])];
            if (row.exposure === "direct") existingSet.directAnatomyIds = [...new Set([...existingSet.directAnatomyIds, row.anatomyId])];
            else existingSet.indirectAnatomyIds = [...new Set([...existingSet.indirectAnatomyIds, row.anatomyId])];
            if (row.exposure === "direct") existingSet.exposure = "direct";
          }
          else contribution.sets.push(setRow);
          group.exercises.set(exerciseKey, contribution);
        }
      }
    }
  }

  const mapping = sessions.length === 0 ? "unknown"
    : unmappedSetCount > 0 || partialMappingSetCount > 0 ? "partial" : "complete-for-input";
  const exposures = deriveBodyMapExposureV2({
    source: sessions.length === 0 ? "unavailable" : "canonical-analytics-contract",
    events,
    mappingCoverage: sessions.length === 0 ? "unknown" : unmappedSetCount > 0 ? "partial" : "complete-for-input",
  });
  const groupReports = BODY_MAP_GROUP_CATALOG_V2.map((catalogGroup) => {
    const group = groups.get(catalogGroup.id)!;
    const exposure = exposures.find(({ groupId }) => groupId === catalogGroup.id)!;
    const sets = [...group.sets.values()];
    const rirCounts = new Map<number, Set<string>>();
    for (const set of sets) if (set.rir !== null) {
      const ids = rirCounts.get(set.rir) ?? new Set<string>();
      ids.add(String(set.id));
      rirCounts.set(set.rir, ids);
    }
    const weekly = [...group.weeklyEvents.entries()]
      .map(([weekStart, week]) => {
        const weekGroupSets = sets.filter((set) => mondayOf(set.sessionDate) === weekStart);
        const direct = new Set(weekGroupSets.filter((set) => set.directAnatomyIds.length > 0).map((set) => String(set.id)));
        const indirect = new Set(weekGroupSets.filter((set) => set.indirectAnatomyIds.length > 0).map((set) => String(set.id)));
        const groupExposure = deriveBodyMapExposureV2({
          source: "canonical-analytics-contract",
          events: events.filter((event) => week.events.has(event.physicalSetId)),
          mappingCoverage: week.unmapped ? "partial" : "complete-for-input",
        }).find(({ groupId }) => groupId === catalogGroup.id)!;
        return {
          weekStart,
          loggedSessionCount: week.sessions.size,
          directUniqueSetCount: direct.size,
          indirectUniqueSetCount: indirect.size,
          totalUniqueSetCount: groupExposure.totalUniqueSetCount ?? 0,
          mappingCoverage: groupExposure.mappingCoverage === "partial" || weeklyIncomplete.has(weekStart)
            ? "partial" as const : "complete-for-input" as const,
        };
      })
      .sort((left, right) => left.weekStart.localeCompare(right.weekStart));
    const exercises = [...group.exercises.values()]
      .map((exercise) => ({
        stableKey: exercise.stableKey,
        exerciseName: exercise.exerciseName,
        resistanceType: exercise.resistanceType,
        directUniqueSetCount: exercise.direct.size,
        indirectUniqueSetCount: exercise.indirect.size,
        totalUniqueSetCount: new Set([...exercise.direct, ...exercise.indirect]).size,
        sessions: new Set(exercise.sets.map((set) => set.sessionId)).size,
        sets: exercise.sets.sort((left, right) => left.sessionDate.localeCompare(right.sessionDate)
          || left.exerciseIndex - right.exerciseIndex || left.setNumber - right.setNumber),
        performanceTrend: trendForExercise(exercise.sets, phaseBySession, phaseContext),
      }))
      .sort((left, right) => right.totalUniqueSetCount - left.totalUniqueSetCount || left.exerciseName.localeCompare(right.exerciseName));
    return {
      ...exposure,
      loggedTrainingDayCount: group.days.size,
      loggedExposureIntervals: loggedExposureIntervals(group.days),
      reportedRirSetCount: [...rirCounts.values()].reduce((sum, ids) => sum + ids.size, 0),
      unreportedRirSetCount: Math.max(0, sets.length - [...rirCounts.values()].reduce((sum, ids) => sum + ids.size, 0)),
      rirCounts: [...rirCounts.entries()].map(([rir, ids]) => ({ rir, uniqueSetCount: ids.size })).sort((a, b) => a.rir - b.rir),
      anatomy: [...group.anatomy.entries()].map(([anatomyId, values]) => ({
        anatomyId,
        directUniqueSetCount: values.direct.size,
        indirectUniqueSetCount: values.indirect.size,
        totalUniqueSetCount: new Set([...values.direct, ...values.indirect]).size,
        loggedTrainingDayCount: values.days.size,
        loggedExposureIntervals: loggedExposureIntervals(values.days),
        mappingCoverage: values.partial || unmappedSetCount > 0 ? "partial" as const : "complete-for-input" as const,
      })),
      weekly,
      exercises,
    };
  });

  return {
    contract: BODY_MAP_TRAINING_ANALYTICS_CONTRACT_V1,
    weeks: input.weeks,
    period: { from: from.toISOString(), to: to.toISOString() },
    coverage: {
      completedSessionCount: sessions.length,
      recordedSetCount,
      mappedSetCount,
      partiallyMappedSetCount: partialMappingSetCount,
      unmappedSetCount,
      mapping,
      sources: coverageSources,
      note: sessions.length === 0
        ? "No completed diary sessions were logged in this window; absence of a diary record does not prove that no workout occurred."
        : unmappedSetCount > 0 && partialMappingSetCount > 0
          ? "Counts include supported projections from completed diary sessions; some sets are unmapped and others have partial anatomy mapping."
          : unmappedSetCount > 0
            ? "Counts include supported projections from completed diary sessions; some recorded sets lack a usable anatomy mapping."
            : mapping === "partial"
              ? "Counts include supported projections from completed diary sessions; some mapped sets have partial anatomy coverage."
          : "Counts describe mapped sets in completed diary sessions only, not muscle activation or proof of inactivity.",
    },
    sessions: sessions.map((session) => ({
      id: session.id,
      sessionDate: bodyMapLocalDateV1(eventInstant(session), session.accountingTimeZone),
      phaseNumber: (phaseBySession.get(session.id) ?? 0) + 1,
      sessionIntent: session.sessionIntent,
      trainingBlockLabel: session.trainingBlockLabel,
      trainingWeekNumber: session.trainingWeekNumber,
      loadAssessment: loadAssessmentBySession.get(session.id) ?? {
        status: "uncertain",
        source: "unavailable",
        reason: "insufficient-history",
        actualSetCount: 0,
        comparableActualSetCount: null,
        typicalSetCount: null,
        reportedRirSetCount: 0,
        medianRir: null,
        typicalMedianRir: null,
        comparableExerciseCount: 0,
        canAskForManualAssessment: false,
      },
      exerciseCount: session.exercises.length,
      recordedSetCount: session.exercises.reduce((sum, exercise) => sum + exercise.sets.length, 0),
    })),
    groups: groupReports,
  };
}

export function bodyMapAnatomyBelongsToGroupV1(anatomyId: AnatomyIdV2, groupId: BodyMapGroupIdV2): boolean {
  return BODY_MAP_MEMBERSHIP_V2.some((membership) => membership.anatomyId === anatomyId && membership.groupId === groupId);
}
