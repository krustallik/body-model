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

type BodyMapAnalyticsTrendStatusV1 = "improving" | "declining" | "steady" | "mixed" | "insufficient-data";

type BodyMapAnalyticsTrendSummaryV1 = {
  status: BodyMapAnalyticsTrendStatusV1;
  comparableSessionCount: number;
  comparedSetPairs: number;
  note: string;
};

export type BodyMapAnalyticsTrendSegmentV1 = BodyMapAnalyticsTrendSummaryV1 & {
  phaseNumber: number;
  blockLabel: string | null;
  sessionIntent: BodyMapAnalyticsSessionIntentV1 | null;
  fromDate: string;
  toDate: string;
};

export type BodyMapAnalyticsTrendV1 = BodyMapAnalyticsTrendSummaryV1 & {
  /** Every contiguous block/intent phase is reported separately. The summary is the latest phase only. */
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
  };
  sessions: Array<{
    id: number;
    sessionDate: string;
    sessionIntent: BodyMapAnalyticsSessionIntentV1 | null;
    trainingBlockLabel: string | null;
    trainingWeekNumber: number | null;
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
    const key = `${set.sessionId}:${set.exerciseIndex}`;
    bySessionPosition.set(key, [...(bySessionPosition.get(key) ?? []), set]);
  }
  const sessions = [...bySessionPosition.values()]
    .map((rows) => rows.sort((a, b) => a.setNumber - b.setNumber))
    .sort((a, b) => a[0]!.sessionDate.localeCompare(b[0]!.sessionDate) || a[0]!.exerciseIndex - b[0]!.exerciseIndex);
  const sessionIds = new Set<number>();
  const comparableSessionDates = new Map<number, string>();
  const directions: Array<-1 | 0 | 1> = [];
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
      || left.sessionIntent !== right.sessionIntent
      || left.trainingBlockLabel !== right.trainingBlockLabel
      || left.plannedSets !== right.plannedSets
      || left.plannedRepsMin !== right.plannedRepsMin
      || left.plannedRepsMax !== right.plannedRepsMax
      || left.plannedRir !== right.plannedRir) continue;
    const priorByNumber = new Map(previous.map((set) => [set.setNumber, set]));
    const pairDirections = current.flatMap((set) => {
      const prior = priorByNumber.get(set.setNumber);
      if (!prior || prior.rir === null || set.rir === null || prior.rir !== set.rir) return [];
      const direction = compareSetPair(prior, set);
      return direction === null ? [] : [direction];
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
      note: "At least three comparable logged sessions across four weeks are required; values remain available in the set log.",
    };
  }
  if (directions.every((direction) => direction > 0)) return {
    status: "improving",
    comparableSessionCount: sessionIds.size,
    comparedSetPairs: directions.length,
    note: "Recorded load or repetitions increased with the same preceding exercise sequence, order, plan, block, intent, recorded rest before each compared set, and reported RIR.",
  };
  if (directions.every((direction) => direction < 0)) return {
    status: "declining",
    comparableSessionCount: sessionIds.size,
    comparedSetPairs: directions.length,
    note: "Recorded load or repetitions decreased with the same preceding exercise sequence, order, plan, block, intent, recorded rest before each compared set, and reported RIR.",
  };
  if (directions.every((direction) => direction === 0)) return {
    status: "steady",
    comparableSessionCount: sessionIds.size,
    comparedSetPairs: directions.length,
    note: "Recorded load and repetitions were unchanged in the compared sets.",
  };
  return {
    status: "mixed",
    comparableSessionCount: sessionIds.size,
    comparedSetPairs: directions.length,
    note: "Comparable set records changed in more than one direction; review the raw exercise history.",
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
    note: "At least three comparable logged sessions across four weeks are required; values remain available in the set log.",
  };
  if (!latest) return { ...fallback, segments };
  return {
    status: latest.status,
    comparableSessionCount: latest.comparableSessionCount,
    comparedSetPairs: latest.comparedSetPairs,
    note: segments.length > 1
      ? "The summary reflects the latest training phase; earlier block and return-from-break phases are shown separately."
      : latest.note,
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
  const sessions = input.sessions
    .filter((session) => {
      const occurredAt = eventInstant(session);
      return occurredAt >= from && occurredAt <= to;
    })
    .sort((left, right) => eventInstant(left).getTime() - eventInstant(right).getTime() || left.id - right.id);
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
        if (!mapping || mapping.targets.length === 0) {
          unmappedSetCount += 1;
          weeklyIncomplete.add(weekStart);
          continue;
        }
        if (mapping.targets.some((target) => target.coverage !== "supported")) {
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
          };
          const groupSet = group.sets.get(physicalSetId);
          if (groupSet) {
            groupSet.anatomyIds = [...new Set([...groupSet.anatomyIds, row.anatomyId])];
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
        const direct = new Set(weekGroupSets.filter((set) => set.exposure === "direct").map((set) => String(set.id)));
        const indirect = new Set(weekGroupSets.filter((set) => set.exposure === "indirect").map((set) => String(set.id)));
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
      sessionIntent: session.sessionIntent,
      trainingBlockLabel: session.trainingBlockLabel,
      trainingWeekNumber: session.trainingWeekNumber,
      exerciseCount: session.exercises.length,
      recordedSetCount: session.exercises.reduce((sum, exercise) => sum + exercise.sets.length, 0),
    })),
    groups: groupReports,
  };
}

export function bodyMapAnatomyBelongsToGroupV1(anatomyId: AnatomyIdV2, groupId: BodyMapGroupIdV2): boolean {
  return BODY_MAP_MEMBERSHIP_V2.some((membership) => membership.anatomyId === anatomyId && membership.groupId === groupId);
}
