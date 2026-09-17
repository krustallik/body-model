import {
  type CanonicalMuscleGroupV7,
  CANONICAL_MUSCLE_GROUPS_V7,
} from "@/model/physiology-v7/exercise-muscle-mapping-v7";
import {
  type QualifiedResistanceTrainingDoseV7,
  qualifiedResistanceTrainingDoseV7Fingerprint,
} from "@/model/physiology-v7/qualified-resistance-training-dose-v7";
import {
  type WorkoutExposureObservation,
  workoutExposureObservation,
} from "@/model/physiology-v7/contracts";
import { addCalendarDays, enumerateCalendarDates } from "@/modules/model-episodes/model-calendar";
import { stableSha256 } from "@/modules/model-recovery/recovery-fingerprint";

/**
 * Recent / weekly resistance-training exposure history.
 * Built from QualifiedResistanceTrainingDoseV7 + workout-feed observation.
 * No tissue response, detraining decay, or muscle-memory multipliers.
 */
export const RESISTANCE_TRAINING_EXPOSURE_HISTORY_V7_VERSION =
  "bodycast-resistance-training-exposure-history-v7-1" as const;

/**
 * ENGINEERING aggregation window only — not a biological adaptation timescale.
 * Weeks are UTC Monday–Sunday calendar weeks (ISO-8601 weekday numbering).
 */
export const RESISTANCE_TRAINING_EXPOSURE_WEEK_WINDOW_V7 =
  "engineering-utc-calendar-week-monday-start" as const;

export type ResistanceTrainingProgramContextV7 = {
  programId: number;
  programVersionId: number;
  programVersionNumber: number;
};

export type ResistanceTrainingSessionExposureV7 = {
  strengthDiarySessionId: number;
  sessionRevision: number;
  occurrenceStartAt: string | null;
  matchedWorkoutId: number | null;
  program: ResistanceTrainingProgramContextV7 | null;
  dose: QualifiedResistanceTrainingDoseV7;
  doseFingerprint: string;
};

/**
 * Day-level resistance exposure. Distinguishes:
 * - validated mapped loading
 * - verified observed no-exposure (feed observed, no qualifying sessions)
 * - unresolved dose (sessions present but dose unavailable / unmapped)
 * - unobserved feed (never treated as rest or cessation)
 */
export type ResistanceTrainingDayExposureKindV7 =
  | "observed-mapped-exposure"
  | "observed-no-exposure"
  | "unresolved-dose"
  | "unobserved";

export type ResistanceTrainingDayExposureV7 = {
  date: string;
  workoutFeedObserved: boolean | null;
  /** Feed-level observation reused from the Stage-5 contract. */
  sourceObservation: WorkoutExposureObservation;
  kind: ResistanceTrainingDayExposureKindV7;
  /**
   * Complete cessation is never inferred from unobserved feed or from
   * validated nonzero mapped loading (C-C03 / P-C01 / P-C02).
   */
  completeCessation: false | "verified-observed-no-exposure";
  sessions: ResistanceTrainingSessionExposureV7[];
  mappedSetCount: number;
  recordedSetCount: number;
  unmappedSetCount: number;
  muscleGroups: {
    muscleGroup: CanonicalMuscleGroupV7;
    directMappedSetCount: number;
    indirectMappedSetCount: number;
  }[];
};

export type ResistanceTrainingWeeklyAggregateV7 = {
  /** Inclusive UTC Monday–Sunday engineering window. */
  windowKind: typeof RESISTANCE_TRAINING_EXPOSURE_WEEK_WINDOW_V7;
  weekStartDate: string;
  weekEndDate: string;
  totalMappedSetCount: number;
  totalRecordedSetCount: number;
  totalUnmappedSetCount: number;
  muscleGroups: {
    muscleGroup: CanonicalMuscleGroupV7;
    directMappedSetCount: number;
    indirectMappedSetCount: number;
  }[];
  /** Context only — not an anabolic multiplier (C-A02 / P-A03). */
  sessionCount: number;
  distinctExposureDayCount: number;
  occurrenceDates: string[];
  daysObservedMappedExposure: number;
  daysObservedNoExposure: number;
  daysUnresolvedDose: number;
  daysUnobserved: number;
  programContexts: ResistanceTrainingProgramContextV7[];
};

export type ResistanceTrainingResumptionEventV7 = {
  resumedOnDate: string;
  /** Contiguous verified observed-no-exposure dates immediately before resumption. */
  verifiedNoExposureDates: string[];
  resumedSessionIds: number[];
  resumedMappedSetCount: number;
  resumedDoseFingerprints: string[];
  /**
   * Explicitly absent. Resumption restores ordinary qualified dose only
   * (C-C06 / P-C05) — no muscle-memory / retraining acceleration.
   */
  quantitativeMemoryBonus: null;
};

export type ResistanceTrainingExposureHistoryV7 = {
  contractVersion: typeof RESISTANCE_TRAINING_EXPOSURE_HISTORY_V7_VERSION;
  fromDate: string;
  toDate: string;
  weekWindowKind: typeof RESISTANCE_TRAINING_EXPOSURE_WEEK_WINDOW_V7;
  days: ResistanceTrainingDayExposureV7[];
  weeklyAggregates: ResistanceTrainingWeeklyAggregateV7[];
  resumptionEvents: ResistanceTrainingResumptionEventV7[];
};

export type ResistanceTrainingExposureHistoryDayInputV7 = {
  date: string;
  workoutFeedObserved: boolean | null;
  sessions?: readonly ResistanceTrainingExposureHistorySessionInputV7[];
};

export type ResistanceTrainingExposureHistorySessionInputV7 = {
  strengthDiarySessionId: number;
  sessionRevision: number;
  occurrenceStartAt?: string | null;
  matchedWorkoutId?: number | null;
  program?: ResistanceTrainingProgramContextV7 | null;
  dose: QualifiedResistanceTrainingDoseV7;
};

function emptyMuscleBuckets(): Map<CanonicalMuscleGroupV7, {
  directMappedSetCount: number;
  indirectMappedSetCount: number;
}> {
  const buckets = new Map<CanonicalMuscleGroupV7, {
    directMappedSetCount: number;
    indirectMappedSetCount: number;
  }>();
  for (const group of CANONICAL_MUSCLE_GROUPS_V7) {
    buckets.set(group, { directMappedSetCount: 0, indirectMappedSetCount: 0 });
  }
  return buckets;
}

function muscleBucketsToList(
  buckets: Map<CanonicalMuscleGroupV7, {
    directMappedSetCount: number;
    indirectMappedSetCount: number;
  }>,
) {
  return CANONICAL_MUSCLE_GROUPS_V7
    .map((muscleGroup) => {
      const bucket = buckets.get(muscleGroup)!;
      return {
        muscleGroup,
        directMappedSetCount: bucket.directMappedSetCount,
        indirectMappedSetCount: bucket.indirectMappedSetCount,
      };
    })
    .filter((bucket) => (
      bucket.directMappedSetCount > 0 || bucket.indirectMappedSetCount > 0
    ));
}

function addDoseMuscleBuckets(
  buckets: Map<CanonicalMuscleGroupV7, {
    directMappedSetCount: number;
    indirectMappedSetCount: number;
  }>,
  dose: QualifiedResistanceTrainingDoseV7,
): void {
  if (dose.availability !== "available") return;
  for (const entry of dose.muscleGroups) {
    const bucket = buckets.get(entry.muscleGroup);
    if (!bucket) continue;
    bucket.directMappedSetCount += entry.directMappedSetCount;
    bucket.indirectMappedSetCount += entry.indirectMappedSetCount;
  }
}

/** UTC Monday of the calendar week containing `date` (YYYY-MM-DD). */
export function utcMondayWeekStart(date: string): string {
  const parsed = Date.parse(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== date) {
    throw new RangeError("date must be a real calendar date in YYYY-MM-DD format");
  }
  const weekday = new Date(parsed).getUTCDay(); // 0=Sun … 6=Sat
  const daysFromMonday = weekday === 0 ? 6 : weekday - 1;
  return addCalendarDays(date, -daysFromMonday);
}

function classifyDay(input: {
  date: string;
  workoutFeedObserved: boolean | null;
  sessions: ResistanceTrainingSessionExposureV7[];
}): ResistanceTrainingDayExposureV7 {
  const sourceObservation = workoutExposureObservation({
    workoutFeedObserved: input.workoutFeedObserved,
    workoutCount: input.sessions.length,
  });

  const muscleBuckets = emptyMuscleBuckets();
  let mappedSetCount = 0;
  let recordedSetCount = 0;
  let unmappedSetCount = 0;
  let availableMappedSessions = 0;
  let unresolvedSessions = 0;

  for (const session of input.sessions) {
    recordedSetCount += session.dose.recordedSetCount;
    unmappedSetCount += session.dose.unmappedSetCount;
    if (session.dose.availability === "available" && session.dose.mappedSetCount > 0) {
      availableMappedSessions += 1;
      mappedSetCount += session.dose.mappedSetCount;
      addDoseMuscleBuckets(muscleBuckets, session.dose);
    } else {
      unresolvedSessions += 1;
    }
  }

  let kind: ResistanceTrainingDayExposureKindV7;
  let completeCessation: false | "verified-observed-no-exposure";

  if (input.workoutFeedObserved !== true) {
    kind = "unobserved";
    completeCessation = false;
  } else if (availableMappedSessions > 0) {
    kind = "observed-mapped-exposure";
    completeCessation = false;
  } else if (unresolvedSessions > 0) {
    // Sessions exist but dose is unavailable/unmapped — not zero training.
    kind = "unresolved-dose";
    completeCessation = false;
  } else {
    kind = "observed-no-exposure";
    completeCessation = "verified-observed-no-exposure";
  }

  return {
    date: input.date,
    workoutFeedObserved: input.workoutFeedObserved,
    sourceObservation,
    kind,
    completeCessation,
    sessions: input.sessions,
    mappedSetCount,
    recordedSetCount,
    unmappedSetCount,
    muscleGroups: muscleBucketsToList(muscleBuckets),
  };
}

function toSessionExposure(
  session: ResistanceTrainingExposureHistorySessionInputV7,
): ResistanceTrainingSessionExposureV7 {
  return {
    strengthDiarySessionId: session.strengthDiarySessionId,
    sessionRevision: session.sessionRevision,
    occurrenceStartAt: session.occurrenceStartAt ?? null,
    matchedWorkoutId: session.matchedWorkoutId ?? null,
    program: session.program ?? null,
    dose: session.dose,
    doseFingerprint: qualifiedResistanceTrainingDoseV7Fingerprint(session.dose),
  };
}

function aggregateWeek(
  weekStartDate: string,
  days: readonly ResistanceTrainingDayExposureV7[],
): ResistanceTrainingWeeklyAggregateV7 {
  const weekEndDate = addCalendarDays(weekStartDate, 6);
  const muscleBuckets = emptyMuscleBuckets();
  let totalMappedSetCount = 0;
  let totalRecordedSetCount = 0;
  let totalUnmappedSetCount = 0;
  let sessionCount = 0;
  let daysObservedMappedExposure = 0;
  let daysObservedNoExposure = 0;
  let daysUnresolvedDose = 0;
  let daysUnobserved = 0;
  const occurrenceDates: string[] = [];
  const programKeys = new Map<string, ResistanceTrainingProgramContextV7>();

  for (const day of days) {
    totalMappedSetCount += day.mappedSetCount;
    totalRecordedSetCount += day.recordedSetCount;
    totalUnmappedSetCount += day.unmappedSetCount;
    sessionCount += day.sessions.length;

    for (const bucket of day.muscleGroups) {
      const target = muscleBuckets.get(bucket.muscleGroup)!;
      target.directMappedSetCount += bucket.directMappedSetCount;
      target.indirectMappedSetCount += bucket.indirectMappedSetCount;
    }

    if (day.kind === "observed-mapped-exposure") {
      daysObservedMappedExposure += 1;
      occurrenceDates.push(day.date);
    } else if (day.kind === "observed-no-exposure") {
      daysObservedNoExposure += 1;
    } else if (day.kind === "unresolved-dose") {
      daysUnresolvedDose += 1;
    } else {
      daysUnobserved += 1;
    }

    for (const session of day.sessions) {
      if (!session.program) continue;
      const key = [
        session.program.programId,
        session.program.programVersionId,
        session.program.programVersionNumber,
      ].join(":");
      programKeys.set(key, session.program);
    }
  }

  return {
    windowKind: RESISTANCE_TRAINING_EXPOSURE_WEEK_WINDOW_V7,
    weekStartDate,
    weekEndDate,
    totalMappedSetCount,
    totalRecordedSetCount,
    totalUnmappedSetCount,
    muscleGroups: muscleBucketsToList(muscleBuckets),
    sessionCount,
    distinctExposureDayCount: daysObservedMappedExposure,
    occurrenceDates,
    daysObservedMappedExposure,
    daysObservedNoExposure,
    daysUnresolvedDose,
    daysUnobserved,
    programContexts: [...programKeys.values()].sort((left, right) => (
      left.programId - right.programId
      || left.programVersionId - right.programVersionId
      || left.programVersionNumber - right.programVersionNumber
    )),
  };
}

function detectResumptionEvents(
  days: readonly ResistanceTrainingDayExposureV7[],
): ResistanceTrainingResumptionEventV7[] {
  const events: ResistanceTrainingResumptionEventV7[] = [];
  let pendingNoExposure: string[] = [];

  for (const day of days) {
    if (day.kind === "observed-no-exposure") {
      pendingNoExposure.push(day.date);
      continue;
    }
    if (day.kind === "observed-mapped-exposure" && pendingNoExposure.length > 0) {
      events.push({
        resumedOnDate: day.date,
        verifiedNoExposureDates: [...pendingNoExposure],
        resumedSessionIds: day.sessions.map((session) => session.strengthDiarySessionId),
        resumedMappedSetCount: day.mappedSetCount,
        resumedDoseFingerprints: day.sessions.map((session) => session.doseFingerprint),
        quantitativeMemoryBonus: null,
      });
      pendingNoExposure = [];
      continue;
    }
    if (day.kind === "observed-mapped-exposure") {
      pendingNoExposure = [];
      continue;
    }
    // unobserved / unresolved break the verified no-exposure chain without
    // inventing cessation or a retraining duration threshold.
    if (day.kind === "unobserved" || day.kind === "unresolved-dose") {
      pendingNoExposure = [];
    }
  }

  return events;
}

/**
 * Pure rebuild of resistance-training exposure history over a calendar range.
 * Missing input days become unobserved (feed unknown) — never rest/cessation.
 */
export function buildResistanceTrainingExposureHistoryV7(input: {
  fromDate: string;
  toDate: string;
  days?: readonly ResistanceTrainingExposureHistoryDayInputV7[];
}): ResistanceTrainingExposureHistoryV7 {
  const byDate = new Map(
    (input.days ?? []).map((day) => [day.date, day] as const),
  );
  const dates = enumerateCalendarDates(input.fromDate, input.toDate);
  const days = dates.map((date) => {
    const provided = byDate.get(date);
    const sessions = [...(provided?.sessions ?? [])]
      .map(toSessionExposure)
      .sort((left, right) => (
        left.strengthDiarySessionId - right.strengthDiarySessionId
        || left.sessionRevision - right.sessionRevision
      ));
    return classifyDay({
      date,
      workoutFeedObserved: provided?.workoutFeedObserved ?? null,
      sessions,
    });
  });

  const weekStarts: string[] = [];
  const seenWeeks = new Set<string>();
  for (const day of days) {
    const start = utcMondayWeekStart(day.date);
    if (seenWeeks.has(start)) continue;
    seenWeeks.add(start);
    weekStarts.push(start);
  }

  const weeklyAggregates = weekStarts.map((weekStartDate) => {
    const weekEndDate = addCalendarDays(weekStartDate, 6);
    const weekDays = days.filter((day) => (
      day.date >= weekStartDate && day.date <= weekEndDate
    ));
    return aggregateWeek(weekStartDate, weekDays);
  });

  return {
    contractVersion: RESISTANCE_TRAINING_EXPOSURE_HISTORY_V7_VERSION,
    fromDate: input.fromDate,
    toDate: input.toDate,
    weekWindowKind: RESISTANCE_TRAINING_EXPOSURE_WEEK_WINDOW_V7,
    days,
    weeklyAggregates,
    resumptionEvents: detectResumptionEvents(days),
  };
}

/** Scientific identity for exposure history — excludes UI display metadata. */
export function resistanceTrainingExposureHistoryV7Fingerprint(
  history: ResistanceTrainingExposureHistoryV7,
): string {
  return stableSha256({
    contractVersion: history.contractVersion,
    fromDate: history.fromDate,
    toDate: history.toDate,
    weekWindowKind: history.weekWindowKind,
    days: history.days.map((day) => ({
      date: day.date,
      workoutFeedObserved: day.workoutFeedObserved,
      sourceObservation: day.sourceObservation,
      kind: day.kind,
      completeCessation: day.completeCessation,
      mappedSetCount: day.mappedSetCount,
      recordedSetCount: day.recordedSetCount,
      unmappedSetCount: day.unmappedSetCount,
      muscleGroups: day.muscleGroups,
      sessions: day.sessions.map((session) => ({
        strengthDiarySessionId: session.strengthDiarySessionId,
        sessionRevision: session.sessionRevision,
        occurrenceStartAt: session.occurrenceStartAt,
        matchedWorkoutId: session.matchedWorkoutId,
        program: session.program,
        doseFingerprint: session.doseFingerprint,
        doseAvailability: session.dose.availability,
        mappedSetCount: session.dose.mappedSetCount,
      })),
    })),
    weeklyAggregates: history.weeklyAggregates.map((week) => ({
      windowKind: week.windowKind,
      weekStartDate: week.weekStartDate,
      weekEndDate: week.weekEndDate,
      totalMappedSetCount: week.totalMappedSetCount,
      totalRecordedSetCount: week.totalRecordedSetCount,
      totalUnmappedSetCount: week.totalUnmappedSetCount,
      muscleGroups: week.muscleGroups,
      sessionCount: week.sessionCount,
      distinctExposureDayCount: week.distinctExposureDayCount,
      occurrenceDates: week.occurrenceDates,
      daysObservedMappedExposure: week.daysObservedMappedExposure,
      daysObservedNoExposure: week.daysObservedNoExposure,
      daysUnresolvedDose: week.daysUnresolvedDose,
      daysUnobserved: week.daysUnobserved,
      programContexts: week.programContexts,
    })),
    resumptionEvents: history.resumptionEvents,
  });
}
