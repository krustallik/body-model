import { describe, expect, it } from "vitest";
import { buildExerciseMuscleMappingSnapshotV7 } from "@/model/physiology-v7/exercise-muscle-mapping-v7";
import {
  buildQualifiedResistanceTrainingDoseV7,
  qualifiedResistanceTrainingDoseV7Fingerprint,
} from "@/model/physiology-v7/qualified-resistance-training-dose-v7";
import {
  RESISTANCE_TRAINING_EXPOSURE_HISTORY_V7_VERSION,
  RESISTANCE_TRAINING_EXPOSURE_WEEK_WINDOW_V7,
  buildResistanceTrainingExposureHistoryV7,
  resistanceTrainingExposureHistoryV7Fingerprint,
  utcMondayWeekStart,
} from "@/model/physiology-v7/resistance-training-exposure-history-v7";
import {
  buildResistanceTrainingExposureHistoryFromSourcesV7,
} from "@/model/physiology-v7/resistance-training-exposure-history-sources-v7";
import { buildCanonicalStrengthTrainingInputV7 } from "@/modules/model-episodes/strength-training-input-v7";
import { RESISTANCE } from "@/modules/training/training.constants";
import type { StrengthSessionDto } from "@/modules/training/training.types";

function recordedSet(input: {
  id: number;
  sessionExerciseId: number;
  reps: number;
  weightKg?: number | null;
}) {
  return {
    id: input.id,
    sessionExerciseId: input.sessionExerciseId,
    setNumber: 1,
    reps: input.reps,
    weightKg: input.weightKg ?? null,
    bandNominalResistanceKg: null,
    comment: null,
    completedAt: null,
    createdAt: "2026-09-14T17:00:00.000Z",
    updatedAt: "2026-09-14T17:00:00.000Z",
  };
}

function sessionDto(input: {
  id: number;
  revision?: number;
  stableKey: "incline_dumbbell_press_30deg" | "one_arm_seated_cable_row" | null;
  reps: number;
  weightKg?: number | null;
  sets?: number;
}): StrengthSessionDto {
  const snapshot = input.stableKey == null
    ? buildExerciseMuscleMappingSnapshotV7(null)
    : buildExerciseMuscleMappingSnapshotV7(input.stableKey);
  const setCount = input.sets ?? 1;
  return {
    id: input.id,
    status: "COMPLETED",
    entryMode: "RETROSPECTIVE",
    revision: input.revision ?? 1,
    programId: 7,
    programName: "Program",
    programVersionId: 9,
    programVersionNumber: 1,
    webStartedAt: null,
    webEndedAt: null,
    matchStatus: "MATCHED",
    matchMethod: "DIRECT_BACKFILL",
    matchedAt: "2026-09-14T18:30:00.000Z",
    matchedWorkoutId: 99,
    matchedWorkout: {
      id: 99,
      type: "Strength Training",
      startAt: "2026-09-14T17:00:00.000Z",
      endAt: "2026-09-14T18:00:00.000Z",
      durationMinutes: 60,
      activeEnergyKcal: 400,
      externalId: "garmin-99",
    },
    exercises: [{
      id: 1,
      sourceExerciseCatalogId: 10,
      stableKey: input.stableKey,
      snapshotExerciseName: "Exercise",
      order: 1,
      plannedSets: setCount,
      resistanceType: RESISTANCE.EXTERNAL_WEIGHT,
      origin: "PLANNED",
      muscleMappingSnapshot: snapshot,
      sets: Array.from({ length: setCount }, (_, index) => recordedSet({
        id: 100 + index,
        sessionExerciseId: 1,
        reps: input.reps,
        weightKg: input.weightKg ?? 20,
      })),
    }],
    ordinaryTonnageKg: null,
    createdAt: "2026-09-14T17:00:00.000Z",
    updatedAt: "2026-09-14T18:30:00.000Z",
  };
}

function doseFor(session: StrengthSessionDto) {
  const input = buildCanonicalStrengthTrainingInputV7({
    session,
    heartRateSamples: null,
  });
  return buildQualifiedResistanceTrainingDoseV7(input);
}

describe("ResistanceTrainingExposureHistoryV7", () => {
  it("classifies observed exposure, observed no-exposure, and unobserved days", () => {
    const dose = doseFor(sessionDto({
      id: 1,
      stableKey: "incline_dumbbell_press_30deg",
      reps: 8,
    }));
    const history = buildResistanceTrainingExposureHistoryV7({
      fromDate: "2026-09-14",
      toDate: "2026-09-16",
      days: [
        {
          date: "2026-09-14",
          workoutFeedObserved: true,
          sessions: [{
            strengthDiarySessionId: 1,
            sessionRevision: 1,
            dose,
            program: { programId: 7, programVersionId: 9, programVersionNumber: 1 },
          }],
        },
        {
          date: "2026-09-15",
          workoutFeedObserved: true,
          sessions: [],
        },
      ],
    });

    expect(history.contractVersion).toBe(RESISTANCE_TRAINING_EXPOSURE_HISTORY_V7_VERSION);
    expect(history.weekWindowKind).toBe(RESISTANCE_TRAINING_EXPOSURE_WEEK_WINDOW_V7);
    expect(history.days).toHaveLength(3);
    expect(history.days[0]).toMatchObject({
      date: "2026-09-14",
      kind: "observed-mapped-exposure",
      completeCessation: false,
      mappedSetCount: 1,
    });
    expect(history.days[1]).toMatchObject({
      date: "2026-09-15",
      kind: "observed-no-exposure",
      completeCessation: "verified-observed-no-exposure",
      mappedSetCount: 0,
    });
    expect(history.days[2]).toMatchObject({
      date: "2026-09-16",
      kind: "unobserved",
      workoutFeedObserved: null,
      completeCessation: false,
    });
    expect(history.days[2]!.sourceObservation).toEqual({
      availability: "unavailable",
      observation: "unobserved",
    });
  });

  it("does not treat missing feed as rest or cessation", () => {
    const history = buildResistanceTrainingExposureHistoryV7({
      fromDate: "2026-09-14",
      toDate: "2026-09-14",
      days: [{ date: "2026-09-14", workoutFeedObserved: null, sessions: [] }],
    });
    expect(history.days[0]!.kind).toBe("unobserved");
    expect(history.days[0]!.completeCessation).toBe(false);
    expect(history.days[0]!.kind).not.toBe("observed-no-exposure");
  });

  it("does not convert unresolved / unmapped dose into zero training", () => {
    const unresolved = doseFor(sessionDto({
      id: 2,
      stableKey: null,
      reps: 10,
    }));
    expect(unresolved.availability).toBe("unavailable");

    const history = buildResistanceTrainingExposureHistoryV7({
      fromDate: "2026-09-14",
      toDate: "2026-09-14",
      days: [{
        date: "2026-09-14",
        workoutFeedObserved: true,
        sessions: [{
          strengthDiarySessionId: 2,
          sessionRevision: 1,
          dose: unresolved,
        }],
      }],
    });

    expect(history.days[0]!.kind).toBe("unresolved-dose");
    expect(history.days[0]!.completeCessation).toBe(false);
    expect(history.days[0]!.mappedSetCount).toBe(0);
    expect(history.days[0]!.recordedSetCount).toBe(1);
  });

  it("treats legacy strength Workout without diary details as unresolved, not rest", () => {
    const history = buildResistanceTrainingExposureHistoryV7({
      fromDate: "2026-09-14",
      toDate: "2026-09-14",
      days: [{
        date: "2026-09-14",
        workoutFeedObserved: true,
        sessions: [],
        legacyStrengthWorkouts: [{
          workoutId: 501,
          localDate: "2026-09-14",
          matchedStrengthDiarySessionId: null,
        }],
      }],
    });

    expect(history.days[0]!.kind).toBe("unresolved-dose");
    expect(history.days[0]!.kind).not.toBe("observed-no-exposure");
    expect(history.days[0]!.completeCessation).toBe(false);
    expect(history.days[0]!.legacyStrengthWorkouts).toEqual([{
      workoutId: 501,
      localDate: "2026-09-14",
      matchedStrengthDiarySessionId: null,
    }]);
    expect(history.days[0]!.sourceObservation).toEqual({
      availability: "available",
      observation: "observed-exposure",
    });
    expect(history.resumptionEvents).toEqual([]);
  });

  it("does not let legacy strength without diary create false cessation before resumption", () => {
    const dose = doseFor(sessionDto({
      id: 8,
      stableKey: "incline_dumbbell_press_30deg",
      reps: 8,
    }));
    const history = buildResistanceTrainingExposureHistoryV7({
      fromDate: "2026-09-14",
      toDate: "2026-09-17",
      days: [
        {
          date: "2026-09-14",
          workoutFeedObserved: true,
          sessions: [{ strengthDiarySessionId: 8, sessionRevision: 1, dose }],
        },
        {
          date: "2026-09-15",
          workoutFeedObserved: true,
          sessions: [],
          legacyStrengthWorkouts: [{
            workoutId: 777,
            localDate: "2026-09-15",
            matchedStrengthDiarySessionId: null,
          }],
        },
        {
          date: "2026-09-16",
          workoutFeedObserved: true,
          sessions: [{ strengthDiarySessionId: 9, sessionRevision: 1, dose }],
        },
      ],
    });

    expect(history.days[1]!.kind).toBe("unresolved-dose");
    expect(history.days[1]!.completeCessation).toBe(false);
    // Legacy unresolved breaks the verified no-exposure chain — not cessation.
    expect(history.resumptionEvents).toEqual([]);
  });

  it("groups engineering weeks by profile-local date, not UTC startAt", () => {
    // Europe/Bratislava: 2026-09-13T22:30:00.000Z = local Mon 2026-09-14 00:30.
    // UTC calendar date of the instant is Sunday 2026-09-13 (previous week).
    const occurrenceStartAt = "2026-09-13T22:30:00.000Z";
    const localDate = "2026-09-14";
    const utcDateOfInstant = occurrenceStartAt.slice(0, 10);
    expect(utcDateOfInstant).toBe("2026-09-13");
    expect(utcMondayWeekStart(localDate)).toBe("2026-09-14");
    expect(utcMondayWeekStart(utcDateOfInstant)).toBe("2026-09-07");

    const dose = doseFor(sessionDto({
      id: 20,
      stableKey: "incline_dumbbell_press_30deg",
      reps: 8,
    }));
    const history = buildResistanceTrainingExposureHistoryV7({
      fromDate: "2026-09-07",
      toDate: "2026-09-20",
      days: [{
        date: localDate,
        workoutFeedObserved: true,
        sessions: [{
          strengthDiarySessionId: 20,
          sessionRevision: 1,
          occurrenceStartAt,
          matchedWorkoutId: 88,
          dose,
        }],
      }],
    });

    const week = history.weeklyAggregates.find((entry) => entry.weekStartDate === "2026-09-14");
    const wrongUtcWeek = history.weeklyAggregates.find((entry) => entry.weekStartDate === "2026-09-07");
    expect(week?.totalMappedSetCount).toBe(1);
    expect(week?.occurrenceDates).toEqual([localDate]);
    expect(wrongUtcWeek?.totalMappedSetCount ?? 0).toBe(0);
  });

  it("aggregates weekly mapped dose while keeping direct/indirect separate", () => {
    const press = doseFor(sessionDto({
      id: 1,
      stableKey: "incline_dumbbell_press_30deg",
      reps: 8,
      sets: 2,
    }));
    const row = doseFor(sessionDto({
      id: 2,
      stableKey: "one_arm_seated_cable_row",
      reps: 8,
      sets: 1,
    }));

    // Monday + Wednesday in the same UTC week
    expect(utcMondayWeekStart("2026-09-14")).toBe("2026-09-14");
    const history = buildResistanceTrainingExposureHistoryV7({
      fromDate: "2026-09-14",
      toDate: "2026-09-20",
      days: [
        {
          date: "2026-09-14",
          workoutFeedObserved: true,
          sessions: [{
            strengthDiarySessionId: 1,
            sessionRevision: 1,
            dose: press,
            program: { programId: 7, programVersionId: 9, programVersionNumber: 1 },
          }],
        },
        {
          date: "2026-09-16",
          workoutFeedObserved: true,
          sessions: [{
            strengthDiarySessionId: 2,
            sessionRevision: 1,
            dose: row,
            program: { programId: 7, programVersionId: 9, programVersionNumber: 1 },
          }],
        },
        { date: "2026-09-15", workoutFeedObserved: true, sessions: [] },
      ],
    });

    expect(history.weeklyAggregates).toHaveLength(1);
    const week = history.weeklyAggregates[0]!;
    expect(week.windowKind).toBe(RESISTANCE_TRAINING_EXPOSURE_WEEK_WINDOW_V7);
    expect(week.totalMappedSetCount).toBe(3);
    expect(week.sessionCount).toBe(2);
    expect(week.distinctExposureDayCount).toBe(2);
    expect(week.daysObservedNoExposure).toBe(1);
    expect(week.daysUnobserved).toBeGreaterThan(0);
    expect(week.muscleGroups.find((g) => g.muscleGroup === "chest")).toEqual({
      muscleGroup: "chest",
      directMappedSetCount: 2,
      indirectMappedSetCount: 0,
    });
    expect(week.muscleGroups.find((g) => g.muscleGroup === "back")).toEqual({
      muscleGroup: "back",
      directMappedSetCount: 1,
      indirectMappedSetCount: 0,
    });
    expect(week).not.toHaveProperty("frequencyMultiplier");
    expect(week).not.toHaveProperty("hypertrophyScore");
    expect(week.programContexts).toEqual([{
      programId: 7,
      programVersionId: 9,
      programVersionNumber: 1,
    }]);
  });

  it("equates weekly mapped dose across different session frequencies without a frequency bonus", () => {
    const fourSetsOneSession = doseFor(sessionDto({
      id: 10,
      stableKey: "incline_dumbbell_press_30deg",
      reps: 8,
      sets: 4,
    }));
    const twoSets = doseFor(sessionDto({
      id: 11,
      stableKey: "incline_dumbbell_press_30deg",
      reps: 8,
      sets: 2,
    }));

    const lowFrequency = buildResistanceTrainingExposureHistoryV7({
      fromDate: "2026-09-14",
      toDate: "2026-09-20",
      days: [{
        date: "2026-09-14",
        workoutFeedObserved: true,
        sessions: [{
          strengthDiarySessionId: 10,
          sessionRevision: 1,
          dose: fourSetsOneSession,
        }],
      }],
    });
    const highFrequency = buildResistanceTrainingExposureHistoryV7({
      fromDate: "2026-09-14",
      toDate: "2026-09-20",
      days: [
        {
          date: "2026-09-14",
          workoutFeedObserved: true,
          sessions: [{
            strengthDiarySessionId: 11,
            sessionRevision: 1,
            dose: twoSets,
          }],
        },
        {
          date: "2026-09-16",
          workoutFeedObserved: true,
          sessions: [{
            strengthDiarySessionId: 12,
            sessionRevision: 1,
            dose: twoSets,
          }],
        },
      ],
    });

    const lowWeek = lowFrequency.weeklyAggregates[0]!;
    const highWeek = highFrequency.weeklyAggregates[0]!;
    expect(lowWeek.totalMappedSetCount).toBe(4);
    expect(highWeek.totalMappedSetCount).toBe(4);
    expect(lowWeek.sessionCount).toBe(1);
    expect(highWeek.sessionCount).toBe(2);
    expect(lowWeek.muscleGroups).toEqual(highWeek.muscleGroups);
    expect(lowWeek).not.toHaveProperty("frequencyMultiplier");
    expect(highWeek).not.toHaveProperty("anabolicFrequencyBonus");
  });

  it("never classifies validated nonzero loading as complete cessation", () => {
    const dose = doseFor(sessionDto({
      id: 3,
      stableKey: "incline_dumbbell_press_30deg",
      reps: 8,
    }));
    const history = buildResistanceTrainingExposureHistoryV7({
      fromDate: "2026-09-14",
      toDate: "2026-09-14",
      days: [{
        date: "2026-09-14",
        workoutFeedObserved: true,
        sessions: [{
          strengthDiarySessionId: 3,
          sessionRevision: 1,
          dose,
        }],
      }],
    });
    expect(history.days[0]!.mappedSetCount).toBeGreaterThan(0);
    expect(history.days[0]!.completeCessation).toBe(false);
    expect(history.days[0]!.kind).toBe("observed-mapped-exposure");
  });

  it("detects verified interruption then resumption without a memory bonus", () => {
    const dose = doseFor(sessionDto({
      id: 4,
      stableKey: "incline_dumbbell_press_30deg",
      reps: 8,
      sets: 2,
    }));
    const history = buildResistanceTrainingExposureHistoryV7({
      fromDate: "2026-09-14",
      toDate: "2026-09-18",
      days: [
        {
          date: "2026-09-14",
          workoutFeedObserved: true,
          sessions: [{
            strengthDiarySessionId: 4,
            sessionRevision: 1,
            dose,
          }],
        },
        { date: "2026-09-15", workoutFeedObserved: true, sessions: [] },
        { date: "2026-09-16", workoutFeedObserved: true, sessions: [] },
        {
          date: "2026-09-17",
          workoutFeedObserved: true,
          sessions: [{
            strengthDiarySessionId: 5,
            sessionRevision: 1,
            dose,
          }],
        },
      ],
    });

    expect(history.resumptionEvents).toEqual([{
      resumedOnDate: "2026-09-17",
      verifiedNoExposureDates: ["2026-09-15", "2026-09-16"],
      resumedSessionIds: [5],
      resumedMappedSetCount: 2,
      resumedDoseFingerprints: [
        qualifiedResistanceTrainingDoseV7Fingerprint(dose),
      ],
      quantitativeMemoryBonus: null,
    }]);
    const resumedDay = history.days.find((day) => day.date === "2026-09-17")!;
    expect(resumedDay.kind).toBe("observed-mapped-exposure");
    expect(resumedDay.mappedSetCount).toBe(2);
    expect(history).not.toHaveProperty("muscleMemoryMultiplier");
  });

  it("keeps program identity as context only", () => {
    const dose = doseFor(sessionDto({
      id: 6,
      stableKey: "incline_dumbbell_press_30deg",
      reps: 8,
    }));
    const history = buildResistanceTrainingExposureHistoryV7({
      fromDate: "2026-09-14",
      toDate: "2026-09-14",
      days: [{
        date: "2026-09-14",
        workoutFeedObserved: true,
        sessions: [{
          strengthDiarySessionId: 6,
          sessionRevision: 1,
          dose,
          program: { programId: 3, programVersionId: 4, programVersionNumber: 2 },
        }],
      }],
    });
    expect(history.weeklyAggregates[0]!.programContexts).toEqual([{
      programId: 3,
      programVersionId: 4,
      programVersionNumber: 2,
    }]);
    expect(history.weeklyAggregates[0]!).not.toHaveProperty("noveltyBonus");
  });

  it("is deterministic and changes when historical dose edits change the fingerprint", () => {
    const baseDose = doseFor(sessionDto({
      id: 7,
      stableKey: "incline_dumbbell_press_30deg",
      reps: 8,
      sets: 1,
      revision: 1,
    }));
    const editedDose = doseFor(sessionDto({
      id: 7,
      stableKey: "incline_dumbbell_press_30deg",
      reps: 8,
      sets: 3,
      revision: 2,
    }));

    const base = buildResistanceTrainingExposureHistoryV7({
      fromDate: "2026-09-14",
      toDate: "2026-09-14",
      days: [{
        date: "2026-09-14",
        workoutFeedObserved: true,
        sessions: [{
          strengthDiarySessionId: 7,
          sessionRevision: 1,
          dose: baseDose,
        }],
      }],
    });
    const again = buildResistanceTrainingExposureHistoryV7({
      fromDate: "2026-09-14",
      toDate: "2026-09-14",
      days: [{
        date: "2026-09-14",
        workoutFeedObserved: true,
        sessions: [{
          strengthDiarySessionId: 7,
          sessionRevision: 1,
          dose: baseDose,
        }],
      }],
    });
    const edited = buildResistanceTrainingExposureHistoryV7({
      fromDate: "2026-09-14",
      toDate: "2026-09-14",
      days: [{
        date: "2026-09-14",
        workoutFeedObserved: true,
        sessions: [{
          strengthDiarySessionId: 7,
          sessionRevision: 2,
          dose: editedDose,
        }],
      }],
    });

    expect(resistanceTrainingExposureHistoryV7Fingerprint(base))
      .toBe(resistanceTrainingExposureHistoryV7Fingerprint(again));
    expect(resistanceTrainingExposureHistoryV7Fingerprint(edited))
      .not.toBe(resistanceTrainingExposureHistoryV7Fingerprint(base));
    expect(edited.days[0]!.mappedSetCount).toBe(3);
    expect(base.days[0]!.mappedSetCount).toBe(1);
  });
});

describe("buildResistanceTrainingExposureHistoryFromSourcesV7", () => {
  it("supplies unmatched traditional strength Workouts as legacy unresolved-dose", () => {
    const history = buildResistanceTrainingExposureHistoryFromSourcesV7({
      fromDate: "2026-09-14",
      toDate: "2026-09-14",
      days: [{ date: "2026-09-14", workoutFeedObserved: true }],
      strengthWorkouts: [{
        workoutId: 9001,
        localDate: "2026-09-14",
        type: "Traditional Strength Training",
        matchedStrengthDiarySessionId: null,
      }],
      sessions: [],
    });

    expect(history.days[0]!.kind).toBe("unresolved-dose");
    expect(history.days[0]!.completeCessation).toBe(false);
    expect(history.days[0]!.legacyStrengthWorkouts).toEqual([{
      workoutId: 9001,
      localDate: "2026-09-14",
      matchedStrengthDiarySessionId: null,
    }]);
  });

  it("does not double-count a workout already linked to a provided diary session", () => {
    const dose = doseFor(sessionDto({
      id: 30,
      stableKey: "incline_dumbbell_press_30deg",
      reps: 8,
      sets: 2,
    }));
    const history = buildResistanceTrainingExposureHistoryFromSourcesV7({
      fromDate: "2026-09-14",
      toDate: "2026-09-14",
      days: [{ date: "2026-09-14", workoutFeedObserved: true }],
      strengthWorkouts: [{
        workoutId: 44,
        localDate: "2026-09-14",
        type: "Traditional Strength Training",
        matchedStrengthDiarySessionId: 30,
      }],
      sessions: [{
        localDate: "2026-09-14",
        strengthDiarySessionId: 30,
        sessionRevision: 1,
        matchedWorkoutId: 44,
        dose,
      }],
    });

    expect(history.days[0]!.kind).toBe("observed-mapped-exposure");
    expect(history.days[0]!.mappedSetCount).toBe(2);
    expect(history.days[0]!.legacyStrengthWorkouts).toEqual([]);
    expect(history.days[0]!.sessions).toHaveLength(1);
  });

  it("ignores non-strength workouts and keeps missing feed unobserved", () => {
    const history = buildResistanceTrainingExposureHistoryFromSourcesV7({
      fromDate: "2026-09-14",
      toDate: "2026-09-15",
      days: [
        { date: "2026-09-14", workoutFeedObserved: true },
        { date: "2026-09-15", workoutFeedObserved: null },
      ],
      strengthWorkouts: [
        {
          workoutId: 1,
          localDate: "2026-09-14",
          type: "Stair Climbing",
          matchedStrengthDiarySessionId: null,
        },
        {
          workoutId: 2,
          localDate: "2026-09-15",
          type: "Traditional Strength Training",
          matchedStrengthDiarySessionId: null,
        },
      ],
    });

    expect(history.days[0]!.kind).toBe("observed-no-exposure");
    expect(history.days[0]!.legacyStrengthWorkouts).toEqual([]);
    expect(history.days[1]!.kind).toBe("unobserved");
    expect(history.days[1]!.completeCessation).toBe(false);
  });
});
