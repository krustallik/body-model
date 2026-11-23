import { describe, expect, it } from "vitest";
import { recordRefactorObservation } from "./refactor-comparator/capture";
import { trainingExerciseMappingSnapshotJsonV1 } from "@/modules/training/exercise-mapping-snapshot";
import { buildBodyMapTrainingAnalyticsV1, type BodyMapAnalyticsSessionInputV1 } from "@/modules/training/body-map-training-analytics-v1";
import { assessBodyMapMusclePerformanceV1 } from "@/modules/training/body-map-training-performance-v1";

type ExerciseFixture = {
  stableKey: string;
  name: string;
  sortOrder: number;
  resistanceType?: string;
  weightKg?: number | null;
  bandKg?: number | null;
  reps?: number;
  rir?: number | null;
  setCount?: number;
  setValues?: Array<{ setNumber?: number; reps?: number; weightKg?: number | null; bandKg?: number; rir?: number | null; restBeforeSeconds?: number | null }>;
};

function session(input: {
  id: number;
  date: string;
  exercises?: ExerciseFixture[];
  lighter?: boolean;
  uncertain?: boolean;
  block?: string | null;
}): BodyMapAnalyticsSessionInputV1 {
  const at = new Date(`${input.date}T17:00:00.000Z`);
  return {
    id: input.id,
    effectiveAccountingAt: at,
    matchedWorkout: null,
    webStartedAt: at,
    createdAt: at,
    accountingTimeZone: "UTC",
    sessionIntent: "regular",
    sessionLoadAssessment: input.uncertain ? null : input.lighter ? "LIGHTER" : "NOT_LIGHTER",
    trainingBlockLabel: input.block ?? null,
    trainingWeekNumber: null,
    exercises: (input.exercises ?? []).map((exercise) => ({
      id: input.id * 10 + exercise.sortOrder,
      snapshotExerciseName: exercise.name,
      sortOrder: exercise.sortOrder,
      plannedSets: 3,
      plannedRepsMin: 8,
      plannedRepsMax: 12,
      plannedRir: 2,
      resistanceType: exercise.resistanceType ?? "EXTERNAL_WEIGHT",
      muscleMappingSnapshot: trainingExerciseMappingSnapshotJsonV1(exercise.stableKey),
      sourceExerciseCatalog: { stableKey: exercise.stableKey },
      sets: (exercise.setValues ?? Array.from(
        { length: exercise.setCount ?? 3 },
        () => ({} as NonNullable<ExerciseFixture["setValues"]>[number]),
      )).map((set, index) => {
        const weightKg = set.weightKg === undefined ? exercise.weightKg : set.weightKg;
        const rir = set.rir === undefined ? exercise.rir : set.rir;
        return {
          id: input.id * 100 + exercise.sortOrder * 10 + index,
          setNumber: set.setNumber ?? index + 1,
          reps: set.reps ?? exercise.reps ?? 8,
          weightKg: exercise.resistanceType === "BODYWEIGHT" || weightKg === null ? null : weightKg ?? 20,
          bandNominalResistanceKg: exercise.resistanceType === "RESISTANCE_BAND" ? set.bandKg ?? exercise.bandKg ?? 10 : null,
          rir: rir === undefined ? 2 : rir,
          restBeforeSeconds: set.restBeforeSeconds === undefined ? 90 : set.restBeforeSeconds,
          completedAt: at,
        };
      }),
    })),
  };
}

const dates = ["2026-06-20", "2026-07-05", "2026-07-20", "2026-08-05", "2026-08-20", "2026-09-05"];

function pressSession(id: number, weightKg: number, options: { reps?: number; rir?: number | null; block?: string | null; lighter?: boolean; uncertain?: boolean; date?: string; setValues?: ExerciseFixture["setValues"] } = {}) {
  return session({
    id,
    date: options.date ?? dates[id - 1]!,
    lighter: options.lighter,
    uncertain: options.uncertain,
    exercises: [{
      stableKey: "flat_dumbbell_bench_press",
      name: "Жим гантелей лежачи на горизонтальній лаві (0°)",
      sortOrder: 1,
      weightKg,
      reps: options.reps,
      rir: options.rir,
      setValues: options.setValues,
    }],
    block: options.block,
  });
}

function assessment(sessions: BodyMapAnalyticsSessionInputV1[]) {
  const analytics = buildBodyMapTrainingAnalyticsV1({ weeks: 12, now: new Date("2026-09-10T00:00:00.000Z"), sessions });
  const chest = analytics.groups.find(({ groupId }) => groupId === "chest")!;
  return assessBodyMapMusclePerformanceV1({ groupReport: chest, anatomyId: null });
}

describe("Body Map robust performance assessment", () => {
  it.each([
    { label: "steady step-up", values: [20, 20, 22, 22, 24, 24], expected: "progress" },
    { label: "steady decline", values: [30, 28, 26, 24, 22, 20], expected: "regression" },
    { label: "unchanged plateau", values: [20, 20, 20, 20, 20, 20], expected: "stable" },
    { label: "gradual improvement with session noise", values: [20, 22, 21, 23, 22, 24], expected: "progress" },
    { label: "single unusually high middle session", values: [20, 20, 40, 20, 20, 20], expected: "ambiguous" },
    { label: "single unusually low middle session", values: [20, 20, 5, 20, 20, 20], expected: "ambiguous" },
    { label: "alternating good and poor sessions", values: [20, 24, 20, 24, 20, 24], expected: "ambiguous" },
    { label: "small repeated fluctuations without a direction", values: [20, 21, 20, 21, 20, 21], expected: "ambiguous" },
  ])("assigns $label to $expected", ({ values, expected }) => {
    const result = assessment(values.map((weight, index) => pressSession(index + 1, weight)));
    expect(result.status, JSON.stringify(result.exercises[0])).toBe(expected);
    expect(result.exercises[0]?.status).toBe(expected);
  });

  it("detects repeated progress from per-session medians and whole-window agreement", () => {
    const result = assessment([20, 20, 22, 22, 24, 24].map((weight, index) => pressSession(index + 1, weight)));
    recordRefactorObservation("BODYMAP-PERFORMANCE-01/repeated-progress", result);
    expect(result.status).toBe("progress");
    expect(result.exercises[0]).toMatchObject({ status: "progress", usableSessionCount: 6 });
    expect(result.exercises[0]?.early?.loadKg).toBe(20);
    expect(result.exercises[0]?.late?.loadKg).toBe(24);
  });

  it("detects a repeated decline without describing muscle loss", () => {
    const result = assessment([30, 28, 26, 24, 22, 20].map((weight, index) => pressSession(index + 1, weight)));
    expect(result.status).toBe("regression");
  });

  it("treats a stable plateau as stable", () => {
    const result = assessment(Array.from({ length: 6 }, (_, index) => pressSession(index + 1, 20)));
    expect(result.status).toBe("stable");
  });

  it("keeps program phases in the comparison and marks the context change", () => {
    const result = assessment([20, 22, 24, 26, 28, 30].map((weight, index) => pressSession(index + 1, weight, { block: index < 3 ? "Base" : "Volume" })));
    expect(result.status).toBe("progress");
    expect(result.exercises[0]?.hasProgramChange).toBe(true);
  });

  it("does not let one unusually good session create a progress trend", () => {
    const result = assessment([20, 20, 20, 20, 20, 40].map((weight, index) => pressSession(index + 1, weight)));
    expect(result.status).toBe("stable");
  });

  it("does not let one unusually poor session create a regression trend", () => {
    const result = assessment([20, 20, 20, 20, 20, 5].map((weight, index) => pressSession(index + 1, weight)));
    expect(result.status).toBe("stable");
  });

  it("does not turn opposite changes at different set positions into a synthetic improvement", () => {
    const early = [
      { setNumber: 1, weightKg: 50, reps: 12, rir: 2 },
      { setNumber: 2, weightKg: 60, reps: 8, rir: 2 },
    ];
    const late = [
      { setNumber: 1, weightKg: 50, reps: 8, rir: 2 },
      { setNumber: 2, weightKg: 70, reps: 12, rir: 2 },
    ];
    const result = assessment(dates.map((date, index) =>
      pressSession(index + 1, 50, { date, setValues: index < 3 ? early : late })));

    expect(result.status).toBe("ambiguous");
    expect(result.exercises[0]?.status).toBe("ambiguous");
  });

  it("lowers confidence when logged set positions do not sufficiently overlap", () => {
    const sessions = dates.map((date, index) => pressSession(index + 1, index < 3 ? 20 : 25, {
      date,
      setValues: Array.from({ length: index < 3 ? 3 : 1 }, (_, setIndex) => ({
        setNumber: setIndex + 1,
        weightKg: index < 3 ? 20 : 25,
        reps: 8,
        rir: 2,
      })),
    }));
    const result = assessment(sessions);

    expect(result.status).toBe("ambiguous");
    expect(result.exercises[0]?.hasSetCountChange).toBe(true);
  });

  it("keeps conflicting set-level RIR changes from disappearing inside a median", () => {
    const early = [
      { setNumber: 1, weightKg: 20, reps: 8, rir: 0 },
      { setNumber: 2, weightKg: 20, reps: 8, rir: 4 },
    ];
    const late = [
      { setNumber: 1, weightKg: 20, reps: 8, rir: 4 },
      { setNumber: 2, weightKg: 20, reps: 8, rir: 0 },
    ];
    const result = assessment(dates.map((date, index) =>
      pressSession(index + 1, 20, { date, setValues: index < 3 ? early : late })));

    expect(result.status).toBe("ambiguous");
    expect(result.exercises[0]?.hasEffortMismatch).toBe(true);
  });

  it("does not call higher output progress when matched sets used different rest periods", () => {
    const sessions = dates.map((date, index) => pressSession(index + 1, index < 3 ? 20 : 24, {
      date,
      setValues: Array.from({ length: 3 }, (_, setIndex) => ({
        setNumber: setIndex + 1,
        weightKg: index < 3 ? 20 : 24,
        reps: 8,
        rir: 2,
        restBeforeSeconds: index < 3 ? 90 : 180,
      })),
    }));
    const result = assessment(sessions);

    expect(result.status).toBe("ambiguous");
    expect(result.exercises[0]?.hasRestMismatch).toBe(true);
  });

  it("keeps rising load with consistently lower RIR from becoming a progress claim", () => {
    const sessions = dates.map((date, index) => pressSession(index + 1, 20 + index * 2, {
      date,
      rir: index < 3 ? 4 : 0,
    }));
    const result = assessment(sessions);

    expect(result.status).toBe("ambiguous");
    expect(result.exercises[0]?.hasEffortMismatch).toBe(true);
  });

  it("recognizes more repetitions at bodyweight when set context stays comparable", () => {
    const sessions = dates.map((date, index) => session({
      id: index + 1,
      date,
      exercises: [{
        stableKey: "pushup_handles", name: "Push-up", sortOrder: 1,
        resistanceType: "BODYWEIGHT", reps: 8 + index,
      }],
    }));
    const result = assessment(sessions);

    expect(result.status).toBe("progress");
    expect(result.exercises[0]).toMatchObject({ status: "progress", resistanceType: "BODYWEIGHT" });
  });

  it("does not compare changed band ratings as if they were measured load", () => {
    const sessions = dates.map((date, index) => session({
      id: index + 1,
      date,
      exercises: [{
        stableKey: "pushup_handles", name: "Band chest press", sortOrder: 1,
        resistanceType: "RESISTANCE_BAND", weightKg: null,
        // The nominal label changed between blocks; it is not a force measurement.
        bandKg: index < 3 ? 10 : 15,
      }],
    }));
    const result = assessment(sessions);

    expect(result.status).toBe("ambiguous");
  });

  it("does not treat a long break as an ordinary continuous trend", () => {
    const gapDates = ["2026-06-20", "2026-06-25", "2026-07-01", "2026-08-25", "2026-09-01", "2026-09-05"];
    const result = assessment(gapDates.map((date, index) => pressSession(index + 1, index < 3 ? 20 : 30, { date })));
    expect(result.status).toBe("ambiguous");
    expect(result.exercises[0]?.hasLongGap).toBe(true);
  });

  it("does not bridge an over-six-week gap just because both separate blocks improved", () => {
    const gapDates = ["2026-06-20", "2026-06-25", "2026-07-01", "2026-08-25", "2026-09-01", "2026-09-05"];
    const result = assessment(gapDates.map((date, index) =>
      pressSession(index + 1, index < 3 ? 18 + index : 28 + (index - 3), { date })));

    expect(result.status).toBe("ambiguous");
    expect(result.exercises[0]).toMatchObject({ status: "ambiguous", hasLongGap: true });
  });

  it("excludes workouts with unresolved load context from the directional estimate", () => {
    const result = assessment([
      pressSession(1, 20), pressSession(2, 22),
      pressSession(3, 24, { date: "2026-08-05" }),
      pressSession(4, 28, { date: "2026-08-20", uncertain: true, rir: null }),
      pressSession(5, 30, { date: "2026-08-30" }),
      pressSession(6, 32, { date: "2026-09-05" }),
    ]);
    expect(result.status).toBe("progress");
    expect(result.exercises[0]).toMatchObject({ usableSessionCount: 5, hasUncertainSessionLoad: true });
  });

  it("keeps a missed workout from deciding the trend when the remaining history is continuous", () => {
    const missedWorkoutDates = ["2026-08-01", "2026-08-08", "2026-08-22", "2026-08-29", "2026-09-05"];
    const sessions = [20, 22, 26, 28, 30].map((weight, index) =>
      pressSession(index + 1, weight, { date: missedWorkoutDates[index]! }));
    const result = assessment(sessions);

    expect(result.status).toBe("progress");
    expect(result.exercises[0]).toMatchObject({ status: "progress", usableSessionCount: 5, hasLongGap: false });
  });

  it("reports mixed results when different exercises move in opposite directions", () => {
    const sessions = dates.map((date, index) => session({
      id: index + 1,
      date,
      exercises: [
        { stableKey: "flat_dumbbell_bench_press", name: "Bench press", sortOrder: 1, weightKg: 20 + index * 2 },
        { stableKey: "flat_dumbbell_fly", name: "Dumbbell fly", sortOrder: 2, weightKg: 30 - index * 2 },
      ],
    }));
    const result = assessment(sessions);
    expect(result.status).toBe("mixed");
    expect(result.progressExerciseCount).toBe(1);
    expect(result.regressionExerciseCount).toBe(1);
  });

  it("marks a trend ambiguous when the target exercise moves behind different prior muscle work", () => {
    const sessions = dates.map((date, index) => session({
      id: index + 1,
      date,
      exercises: index < 3
        ? [{ stableKey: "flat_dumbbell_fly", name: "Fly", sortOrder: 1, weightKg: 20 }, { stableKey: "flat_dumbbell_bench_press", name: "Bench", sortOrder: 2, weightKg: 20 + index * 3 }]
        : [{ stableKey: "flat_dumbbell_bench_press", name: "Bench", sortOrder: 1, weightKg: 29 + index * 2 }],
    }));
    const result = assessment(sessions);
    expect(result.status).toBe("ambiguous");
    expect(result.exercises.find(({ stableKey }) => stableKey === "flat_dumbbell_bench_press")?.hasOrderShift).toBe(true);
  });

  it("treats even one changed preceding target-muscle set as a different fatigue context", () => {
    const sessions = dates.map((date, index) => session({
      id: index + 1,
      date,
      exercises: [
        { stableKey: "flat_dumbbell_fly", name: "Fly", sortOrder: 1, weightKg: 20, setCount: index < 3 ? 1 : 2 },
        { stableKey: "flat_dumbbell_bench_press", name: "Bench", sortOrder: 2, weightKg: 20 + index * 2 },
      ],
    }));
    const result = assessment(sessions);
    expect(result.exercises.find(({ stableKey }) => stableKey === "flat_dumbbell_bench_press"))
      .toMatchObject({ status: "ambiguous", hasOrderShift: true });
  });

  it("excludes duplicate occurrences of the same exercise in one workout instead of merging their sets", () => {
    const closeDates = ["2026-07-01", "2026-07-08", "2026-07-15", "2026-07-22", "2026-07-29", "2026-08-05"];
    const baselineSessions = closeDates.map((date, index) => pressSession(index + 1, 20 + Math.floor(index / 2) * 2, { date }));
    const repeatedMovementSession = session({
      id: 3,
      date: closeDates[2]!,
      exercises: [
        { stableKey: "flat_dumbbell_bench_press", name: "Bench", sortOrder: 1, weightKg: 24 },
        { stableKey: "flat_dumbbell_fly", name: "Fly", sortOrder: 2, weightKg: 12 },
        { stableKey: "flat_dumbbell_bench_press", name: "Bench", sortOrder: 3, weightKg: 100 },
      ],
    });
    const result = assessment(baselineSessions.map((item) => item.id === 3 ? repeatedMovementSession : item));
    const press = result.exercises.find(({ stableKey }) => stableKey === "flat_dumbbell_bench_press");

    expect(press).toMatchObject({
      status: "progress", hasDuplicateOccurrences: true, usableSessionCount: 5,
      early: { loadKg: 20 }, late: { loadKg: 24 },
    });
    expect(press?.points.some(({ sessionId }) => sessionId === 3)).toBe(false);
  });

  it("keeps load and reps that change in opposite directions incomparable", () => {
    const result = assessment([20, 22, 24, 26, 28, 30].map((weight, index) => pressSession(index + 1, weight, { reps: 12 - index })));
    expect(result.status).toBe("ambiguous");
    expect(result.exercises[0]?.hasConflictingLoadAndReps).toBe(true);
  });

  it("does not interpret an explicitly lighter session as a decline", () => {
    const result = assessment([
      pressSession(1, 20), pressSession(2, 22),
      pressSession(3, 10, { lighter: true }),
      pressSession(4, 24), pressSession(5, 26), pressSession(6, 28),
    ]);
    expect(result.status).toBe("progress");
    expect(result.exercises[0]?.lighterSessionCount).toBe(1);
  });

  it("does not merge external weight, bodyweight, and band resistance into one series", () => {
    const sessions = dates.flatMap((date, index) => [
      session({ id: index * 2 + 1, date, exercises: [{ stableKey: "pushup_handles", name: "Push-up", sortOrder: 1, resistanceType: "BODYWEIGHT", reps: 10 + index }] }),
      session({ id: index * 2 + 2, date, exercises: [{ stableKey: "pushup_handles", name: "Push-up", sortOrder: 1, resistanceType: "EXTERNAL_WEIGHT", weightKg: 5 + index, reps: 10 }] }),
    ]);
    const result = assessment(sessions);
    expect(result.exercises.filter(({ stableKey }) => stableKey === "pushup_handles")).toHaveLength(2);
    expect(new Set(result.exercises.filter(({ stableKey }) => stableKey === "pushup_handles").map(({ resistanceType }) => resistanceType))).toEqual(new Set(["BODYWEIGHT", "EXTERNAL_WEIGHT"]));
  });

  it("requires repeated dates and a span across the period", () => {
    const tooFew = assessment([pressSession(1, 20), pressSession(2, 22)]);
    expect(tooFew.status).toBe("insufficient-data");
    const sameDay = assessment(["2026-08-01", "2026-08-01", "2026-08-01", "2026-08-01"].map((date, index) => pressSession(index + 1, 20 + index, { date })));
    expect(sameDay.status).toBe("insufficient-data");
  });
});
