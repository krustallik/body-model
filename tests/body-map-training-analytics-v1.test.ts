import { describe, expect, it } from "vitest";
import { trainingExerciseMappingSnapshotJsonV1 } from "@/modules/training/exercise-mapping-snapshot";
import { buildExerciseAnatomySnapshotV1 } from "@/modules/training/exercise-anatomy-mapping-v1";
import { buildExerciseMuscleMappingSnapshotV7 } from "@/model/physiology-v7/exercise-muscle-mapping-v7";
import {
  buildBodyMapTrainingAnalyticsV1,
  type BodyMapAnalyticsSessionInputV1,
} from "@/modules/training/body-map-training-analytics-v1";

function session(input: {
  id: number;
  date: string;
  weightKg: number;
  restBeforeSeconds?: number | null;
  restBeforeSecondsBySet?: Array<number | null>;
  setCount?: number;
  reps?: number;
  exerciseIndex?: number;
  rir?: number | null;
  sessionIntent?: BodyMapAnalyticsSessionInputV1["sessionIntent"];
  sessionLoadAssessment?: BodyMapAnalyticsSessionInputV1["sessionLoadAssessment"];
  trainingBlockLabel?: string | null;
  trainingWeekNumber?: number | null;
}): BodyMapAnalyticsSessionInputV1 {
  const at = new Date(`${input.date}T17:00:00.000Z`);
  return {
    id: input.id,
    effectiveAccountingAt: at,
    matchedWorkout: null,
    webStartedAt: at,
    createdAt: at,
    accountingTimeZone: "UTC",
    sessionIntent: input.sessionIntent === undefined ? null : input.sessionIntent,
    sessionLoadAssessment: input.sessionLoadAssessment === undefined ? "NOT_LIGHTER" : input.sessionLoadAssessment,
    trainingBlockLabel: input.trainingBlockLabel === undefined ? "Base" : input.trainingBlockLabel,
    trainingWeekNumber: input.trainingWeekNumber === undefined ? input.id : input.trainingWeekNumber,
    exercises: [{
      id: input.id * 10,
      snapshotExerciseName: "Incline dumbbell press",
      sortOrder: input.exerciseIndex ?? 0,
      plannedSets: 3,
      plannedRepsMin: 8,
      plannedRepsMax: 10,
      plannedRir: 2,
      resistanceType: "EXTERNAL_WEIGHT",
      muscleMappingSnapshot: trainingExerciseMappingSnapshotJsonV1("incline_dumbbell_press_30deg"),
      sourceExerciseCatalog: { stableKey: "incline_dumbbell_press_30deg" },
      sets: Array.from({ length: input.setCount ?? input.restBeforeSecondsBySet?.length ?? 1 }, (_, index) => ({
        id: input.id * 100 + index,
        setNumber: index + 1,
        reps: input.reps ?? 8,
        weightKg: input.weightKg,
        bandNominalResistanceKg: null,
        rir: input.rir === undefined ? 2 : input.rir,
        restBeforeSeconds: input.restBeforeSecondsBySet
          ? input.restBeforeSecondsBySet[index] ?? null
          : input.restBeforeSeconds ?? null,
        completedAt: at,
      })),
    }],
  };
}

describe("Body Map training analytics v1", () => {
  it("infers lighter sessions from personal set-volume and reported-RIR patterns", () => {
    const result = buildBodyMapTrainingAnalyticsV1({
      weeks: 12,
      now: new Date("2026-09-10T00:00:00Z"),
      sessions: [
        session({ id: 1, date: "2026-07-01", weightKg: 10, setCount: 5, rir: 1, sessionIntent: null, sessionLoadAssessment: null }),
        session({ id: 2, date: "2026-07-15", weightKg: 10, setCount: 5, rir: 1, sessionIntent: null, sessionLoadAssessment: null }),
        session({ id: 3, date: "2026-08-01", weightKg: 10, setCount: 4, rir: 1, sessionIntent: null, sessionLoadAssessment: null }),
        session({ id: 4, date: "2026-08-15", weightKg: 10, setCount: 5, rir: 5, reps: 15, sessionIntent: null, sessionLoadAssessment: null }),
        session({ id: 5, date: "2026-08-30", weightKg: 10, setCount: 5, rir: null, sessionIntent: null, sessionLoadAssessment: null }),
      ],
    });

    expect(result.sessions.find(({ id }) => id === 3)?.loadAssessment).toMatchObject({
      status: "lighter",
      source: "automatic",
      reason: "reduced-volume",
      actualSetCount: 4,
      comparableActualSetCount: 4,
      typicalSetCount: 5,
    });
    expect(result.sessions.find(({ id }) => id === 4)?.loadAssessment).toMatchObject({
      status: "lighter",
      source: "automatic",
      reason: "higher-reported-rir",
      medianRir: 5,
      typicalMedianRir: 1,
    });
    expect(result.sessions.find(({ id }) => id === 5)?.loadAssessment).toMatchObject({
      status: "uncertain",
      source: "unavailable",
      canAskForManualAssessment: true,
    });
  });

  it("does not call high-rep sets near failure a lighter session", () => {
    const result = buildBodyMapTrainingAnalyticsV1({
      weeks: 8,
      now: new Date("2026-09-10T00:00:00Z"),
      sessions: [
        session({ id: 1, date: "2026-07-01", weightKg: 10, setCount: 3, reps: 8, rir: 1, sessionIntent: null, sessionLoadAssessment: null }),
        session({ id: 2, date: "2026-07-15", weightKg: 10, setCount: 3, reps: 8, rir: 1, sessionIntent: null, sessionLoadAssessment: null }),
        session({ id: 3, date: "2026-08-01", weightKg: 10, setCount: 3, reps: 15, rir: 1, sessionIntent: null, sessionLoadAssessment: null }),
      ],
    });
    expect(result.sessions.find(({ id }) => id === 3)?.loadAssessment).toMatchObject({
      status: "not-lighter",
      source: "automatic",
      reason: "usual-pattern",
      medianRir: 1,
    });
  });

  it("counts unique direct and indirect logged sets and keeps week and session context traceable", () => {
    const result = buildBodyMapTrainingAnalyticsV1({
      weeks: 4,
      now: new Date("2026-09-10T00:00:00.000Z"),
      sessions: [
        session({ id: 1, date: "2026-08-20", weightKg: 10, restBeforeSeconds: 90 }),
        session({ id: 2, date: "2026-09-03", weightKg: 10, exerciseIndex: 1, restBeforeSeconds: 90 }),
      ],
    });
    const chest = result.groups.find(({ groupId }) => groupId === "chest")!;
    const deltoids = result.groups.find(({ groupId }) => groupId === "deltoids")!;
    const clavicularHead = chest.anatomy.find(({ anatomyId }) => anatomyId === "pectoralis_major_clavicular_head");
    expect(chest).toMatchObject({
      status: "recorded-direct",
      directUniqueSetCount: 2,
      indirectUniqueSetCount: 0,
      totalUniqueSetCount: 2,
      loggedTrainingDayCount: 2,
      reportedRirSetCount: 2,
      loggedExposureIntervals: [{ previousDate: "2026-08-20", nextDate: "2026-09-03", calendarDays: 14 }],
    });
    expect(clavicularHead).toMatchObject({
      loggedTrainingDayCount: 2,
      loggedExposureIntervals: [{ previousDate: "2026-08-20", nextDate: "2026-09-03", calendarDays: 14 }],
    });
    expect(deltoids).toMatchObject({ status: "recorded-direct", directUniqueSetCount: 2 });
    expect(chest.exercises[0]?.sets[1]).toMatchObject({
      sessionId: 2,
      exerciseIndex: 1,
      plannedRepsMin: 8,
      plannedRir: 2,
      rir: 2,
      restBeforeSeconds: 90,
    });
    expect(result.coverage).toMatchObject({ completedSessionCount: 2, recordedSetCount: 2, mappedSetCount: 2, partiallyMappedSetCount: 2, unmappedSetCount: 0, mapping: "partial" });
    expect(result.coverage.sources.find(({ setId }) => setId === 200)).toMatchObject({
      setId: 200,
      sessionId: 2,
      exerciseName: "Incline dumbbell press",
      setNumber: 1,
      reps: 8,
      weightKg: 10,
      rir: 2,
      mappingCoverage: "partial",
      projectedToBodyMap: true,
      anatomyIds: expect.arrayContaining(["pectoralis_major_clavicular_head"]),
    });
    expect(chest.mappingCoverage).toBe("partial");
    expect(deltoids.mappingCoverage).toBe("partial");
  });

  it("traces a mixed direct and indirect physical set to the correct biceps anatomy and week metrics", () => {
    const curl = session({ id: 21, date: "2026-09-01", weightKg: 12 });
    curl.exercises[0]!.snapshotExerciseName = "One-arm concentration curl";
    curl.exercises[0]!.muscleMappingSnapshot = trainingExerciseMappingSnapshotJsonV1("one_arm_concentration_curl");
    curl.exercises[0]!.sourceExerciseCatalog = { stableKey: "one_arm_concentration_curl" };

    const result = buildBodyMapTrainingAnalyticsV1({
      weeks: 4,
      now: new Date("2026-09-10T00:00:00.000Z"),
      sessions: [curl],
    });
    const biceps = result.groups.find(({ groupId }) => groupId === "biceps")!;
    const brachialis = biceps.anatomy.find(({ anatomyId }) => anatomyId === "brachialis")!;
    const curlSet = biceps.exercises.find(({ stableKey }) => stableKey === "one_arm_concentration_curl")!.sets[0]!;

    expect(biceps).toMatchObject({ directUniqueSetCount: 1, indirectUniqueSetCount: 1, totalUniqueSetCount: 1 });
    expect(brachialis).toMatchObject({ directUniqueSetCount: 0, indirectUniqueSetCount: 1, totalUniqueSetCount: 1 });
    expect(biceps.weekly[0]).toMatchObject({ directUniqueSetCount: 1, indirectUniqueSetCount: 1, totalUniqueSetCount: 1 });
    expect(curlSet.directAnatomyIds).toContain("biceps_brachii");
    expect(curlSet.indirectAnatomyIds).toContain("brachialis");
  });

  it("projects old hyperextension records with a role-unspecified v1 snapshot through the current Body Map mapping", () => {
    const historic = session({ id: 31, date: "2026-09-01", weightKg: 0 });
    historic.exercises[0]!.snapshotExerciseName = "Гіперекстензія";
    historic.exercises[0]!.sourceExerciseCatalog = { stableKey: "hyperextension" };
    historic.exercises[0]!.muscleMappingSnapshot = {
      ...buildExerciseMuscleMappingSnapshotV7("hyperextension"),
      anatomyMappingSnapshotV1: buildExerciseAnatomySnapshotV1("hyperextension"),
    };
    const before = structuredClone(historic.exercises[0]!.muscleMappingSnapshot);

    const result = buildBodyMapTrainingAnalyticsV1({
      weeks: 4,
      now: new Date("2026-09-10T00:00:00Z"),
      sessions: [historic],
    });

    expect(result.coverage).toMatchObject({ recordedSetCount: 1, mappedSetCount: 1, unmappedSetCount: 0 });
    expect(result.coverage.sources[0]).toMatchObject({
      projectedToBodyMap: true,
      anatomyIds: expect.arrayContaining(["erector_spinae", "gluteus_maximus", "hamstrings"]),
    });
    expect(result.groups.find(({ groupId }) => groupId === "spinal_extensors")).toMatchObject({
      status: "recorded-direct",
      directUniqueSetCount: 1,
    });
    expect(historic.exercises[0]!.muscleMappingSnapshot).toEqual(before);
  });

  it("uses a known canonical catalog identity when a legacy set has no saved mapping snapshot", () => {
    const legacy = session({ id: 32, date: "2026-09-01", weightKg: 10 });
    legacy.exercises[0]!.muscleMappingSnapshot = null;
    const result = buildBodyMapTrainingAnalyticsV1({
      weeks: 4,
      now: new Date("2026-09-10T00:00:00Z"),
      sessions: [legacy],
    });

    expect(result.coverage).toMatchObject({ recordedSetCount: 1, mappedSetCount: 1, unmappedSetCount: 0 });
    expect(result.coverage.sources[0]).toMatchObject({
      exerciseStableKey: "incline_dumbbell_press_30deg",
      projectedToBodyMap: true,
      anatomyIds: expect.arrayContaining(["pectoralis_major_clavicular_head"]),
    });
  });

  it("keeps records without an exercise identity unavailable instead of turning them into zero exposure", () => {
    const unmapped = session({ id: 1, date: "2026-09-01", weightKg: 10 });
    unmapped.exercises[0]!.muscleMappingSnapshot = null;
    unmapped.exercises[0]!.sourceExerciseCatalog = { stableKey: null };
    const result = buildBodyMapTrainingAnalyticsV1({ weeks: 4, now: new Date("2026-09-10T00:00:00Z"), sessions: [unmapped] });
    expect(result.coverage).toMatchObject({ recordedSetCount: 1, mappedSetCount: 0, unmappedSetCount: 1, mapping: "partial" });
    expect(result.coverage.sources[0]).toMatchObject({ mappingCoverage: "unavailable", projectedToBodyMap: false, anatomyIds: [] });
    expect(result.groups.find(({ groupId }) => groupId === "chest")).toMatchObject({ status: "partial-mapping", directUniqueSetCount: 0, mappingCoverage: "partial" });
  });

  it("keeps exercise order as raw context and respects the selected diary window", () => {
    const ordered = session({ id: 7, date: "2026-09-01", weightKg: 10, exerciseIndex: 1 });
    ordered.exercises = [
      {
        id: 70,
        snapshotExerciseName: "Flat dumbbell fly",
        sortOrder: 10,
        plannedSets: 2,
        plannedRepsMin: null,
        plannedRepsMax: null,
        plannedRir: null,
        resistanceType: "EXTERNAL_WEIGHT",
        muscleMappingSnapshot: trainingExerciseMappingSnapshotJsonV1("flat_dumbbell_fly"),
        sourceExerciseCatalog: { stableKey: "flat_dumbbell_fly" },
        sets: [{ id: 701, setNumber: 1, reps: 10, weightKg: 8, bandNominalResistanceKg: null, rir: 3, completedAt: new Date("2026-09-01T17:00:00Z") }],
      },
      ordered.exercises[0]!,
    ];
    ordered.exercises[1]!.sortOrder = 30;
    const inWindow = session({ id: 8, date: "2026-08-01", weightKg: 10 });
    const result = buildBodyMapTrainingAnalyticsV1({
      weeks: 4,
      now: new Date("2026-09-10T00:00:00.000Z"),
      sessions: [ordered, inWindow],
    });
    const press = result.groups.find(({ groupId }) => groupId === "chest")!.exercises
      .find(({ stableKey }) => stableKey === "incline_dumbbell_press_30deg")!;

    expect(result.coverage.completedSessionCount).toBe(1);
    expect(result.coverage.recordedSetCount).toBe(2);
    expect(press.sets[0]).toMatchObject({
      exerciseIndex: 2,
      exercisesInSession: 2,
      precedingExercises: [{ name: "Flat dumbbell fly", stableKey: "flat_dumbbell_fly", loggedSets: 1 }],
    });
  });

  it("requires repeated comparable sessions before describing a performance direction", () => {
    const improving = buildBodyMapTrainingAnalyticsV1({
      weeks: 12,
      now: new Date("2026-09-10T00:00:00Z"),
      sessions: [
        session({ id: 1, date: "2026-07-20", weightKg: 10, restBeforeSeconds: 90 }),
        session({ id: 2, date: "2026-08-10", weightKg: 12, restBeforeSeconds: 90 }),
        session({ id: 3, date: "2026-08-31", weightKg: 14, restBeforeSeconds: 90 }),
      ],
    });
    const exercise = improving.groups.find(({ groupId }) => groupId === "chest")!.exercises[0]!;
    expect(exercise.performanceTrend).toMatchObject({ status: "improving", comparableSessionCount: 3, comparedSetPairs: 2 });

    const easyDayChange = buildBodyMapTrainingAnalyticsV1({
      weeks: 12,
      now: new Date("2026-09-10T00:00:00Z"),
      sessions: [
        session({ id: 1, date: "2026-07-20", weightKg: 10 }),
        session({ id: 2, date: "2026-08-10", weightKg: 12 }),
        session({ id: 3, date: "2026-08-31", weightKg: 6, sessionIntent: "easy-deload", sessionLoadAssessment: "LIGHTER" }),
      ],
    });
    expect(easyDayChange.groups.find(({ groupId }) => groupId === "chest")!.exercises[0]!.performanceTrend.status).toBe("insufficient-data");
  });

  it("does not treat a pre-session training intent as the post-session load assessment", () => {
    const result = buildBodyMapTrainingAnalyticsV1({
      weeks: 8,
      now: new Date("2026-09-10T00:00:00Z"),
      sessions: [
        session({ id: 1, date: "2026-07-01", weightKg: 10, setCount: 3, rir: 2, sessionIntent: null, sessionLoadAssessment: null }),
        session({ id: 2, date: "2026-07-15", weightKg: 10, setCount: 3, rir: 2, sessionIntent: null, sessionLoadAssessment: null }),
        session({ id: 3, date: "2026-08-01", weightKg: 10, setCount: 3, rir: 2, sessionIntent: "easy-deload", sessionLoadAssessment: null }),
      ],
    });

    expect(result.sessions.find(({ id }) => id === 3)?.loadAssessment).toMatchObject({
      status: "not-lighter",
      source: "automatic",
      reason: "usual-pattern",
    });
  });

  it("uses a separate saved post-session answer only when automatic evidence is uncertain", () => {
    const result = buildBodyMapTrainingAnalyticsV1({
      weeks: 8,
      now: new Date("2026-09-10T00:00:00Z"),
      sessions: [
        session({ id: 1, date: "2026-08-01", weightKg: 10, setCount: 3, rir: null, sessionIntent: null, sessionLoadAssessment: null }),
        session({ id: 2, date: "2026-08-15", weightKg: 10, setCount: 3, rir: null, sessionIntent: null, sessionLoadAssessment: null }),
        session({ id: 3, date: "2026-08-30", weightKg: 10, setCount: 3, rir: null, sessionIntent: "easy-deload", sessionLoadAssessment: "LIGHTER" }),
      ],
    });

    expect(result.sessions.find(({ id }) => id === 3)?.loadAssessment).toMatchObject({
      status: "lighter",
      source: "manual",
      reason: "manual-response",
    });
    expect(result.sessions.find(({ id }) => id === 3)?.sessionIntent).toBe("easy-deload");
  });

  it("fails closed when RIR, plan, or preceding exercise sequence differs but ignores manual block labels", () => {
    const noRir = buildBodyMapTrainingAnalyticsV1({
      weeks: 12,
      now: new Date("2026-09-10T00:00:00Z"),
      sessions: [
        session({ id: 1, date: "2026-07-20", weightKg: 10, rir: null }),
        session({ id: 2, date: "2026-08-10", weightKg: 12, rir: null }),
        session({ id: 3, date: "2026-08-31", weightKg: 14, rir: null }),
      ],
    });
    expect(noRir.groups.find(({ groupId }) => groupId === "chest")!.exercises[0]!.performanceTrend)
      .toMatchObject({ status: "insufficient-data", comparableSessionCount: 0, comparedSetPairs: 0 });

    const changedPlan = session({ id: 3, date: "2026-08-31", weightKg: 14 });
    changedPlan.exercises[0]!.plannedSets = 4;
    const withPrecedingExercise = (id: number, date: string, weightKg: number, precedingKey: string, precedingSetCount = 1) => {
      const current = session({ id, date, weightKg });
      current.exercises[0]!.sortOrder = 20;
      current.exercises = [...current.exercises, {
        id: id * 10,
        snapshotExerciseName: precedingKey,
        sortOrder: 10,
        plannedSets: 2,
        plannedRepsMin: null,
        plannedRepsMax: null,
        plannedRir: null,
        resistanceType: "EXTERNAL_WEIGHT",
        muscleMappingSnapshot: trainingExerciseMappingSnapshotJsonV1(precedingKey),
        sourceExerciseCatalog: { stableKey: precedingKey },
        sets: Array.from({ length: precedingSetCount }, (_, index) => ({
          id: id * 1000 + index,
          setNumber: index + 1,
          reps: 10,
          weightKg: 8,
          bandNominalResistanceKg: null,
          rir: 3,
          completedAt: new Date(`${date}T17:00:00.000Z`),
        })),
      }];
      return current;
    };
    const differentPrecedingExercise = buildBodyMapTrainingAnalyticsV1({
      weeks: 12,
      now: new Date("2026-09-10T00:00:00Z"),
      sessions: [
        withPrecedingExercise(1, "2026-07-20", 10, "flat_dumbbell_fly"),
        withPrecedingExercise(2, "2026-08-10", 12, "flat_dumbbell_fly"),
        withPrecedingExercise(3, "2026-08-31", 14, "incline_dumbbell_press_30deg"),
      ],
    });
    const differentPrecedingVolume = buildBodyMapTrainingAnalyticsV1({
      weeks: 12,
      now: new Date("2026-09-10T00:00:00Z"),
      sessions: [
        withPrecedingExercise(1, "2026-07-20", 10, "flat_dumbbell_fly", 1),
        withPrecedingExercise(2, "2026-08-10", 12, "flat_dumbbell_fly", 1),
        withPrecedingExercise(3, "2026-08-31", 14, "flat_dumbbell_fly", 3),
      ],
    });

    for (const input of [
      [session({ id: 1, date: "2026-07-20", weightKg: 10 }), session({ id: 2, date: "2026-08-10", weightKg: 12 }), changedPlan],
      [session({ id: 1, date: "2026-07-20", weightKg: 10, restBeforeSeconds: 120 }), session({ id: 2, date: "2026-08-10", weightKg: 12, restBeforeSeconds: 180 }), session({ id: 3, date: "2026-09-01", weightKg: 14, restBeforeSeconds: 120 })],
    ]) {
      const result = buildBodyMapTrainingAnalyticsV1({ weeks: 12, now: new Date("2026-09-10T00:00:00Z"), sessions: input });
      expect(result.groups.find(({ groupId }) => groupId === "chest")!.exercises[0]!.performanceTrend.status).toBe("insufficient-data");
    }
    expect(differentPrecedingExercise.groups.find(({ groupId }) => groupId === "chest")!.exercises[0]!.performanceTrend.status).toBe("insufficient-data");
    expect(differentPrecedingVolume.groups.find(({ groupId }) => groupId === "chest")!.exercises
      .find(({ stableKey }) => stableKey === "incline_dumbbell_press_30deg")!.performanceTrend.status).toBe("insufficient-data");
  });

  it("requires rest to match and keeps historic phase boundaries for trend comparisons", () => {
    const changedSecondSetRest = buildBodyMapTrainingAnalyticsV1({
      weeks: 12,
      now: new Date("2026-09-10T00:00:00Z"),
      sessions: [
        session({ id: 1, date: "2026-07-20", weightKg: 10, restBeforeSecondsBySet: [null, 60] }),
        session({ id: 2, date: "2026-08-10", weightKg: 12, restBeforeSecondsBySet: [null, 60] }),
        session({ id: 3, date: "2026-08-31", weightKg: 14, restBeforeSecondsBySet: [null, 120] }),
      ],
    });
    const restTrend = changedSecondSetRest.groups.find(({ groupId }) => groupId === "chest")!.exercises[0]!.performanceTrend;
    expect(restTrend.status).toBe("insufficient-data");
    expect(restTrend.comparedSetPairs).toBe(1);

    const blockTrend = buildBodyMapTrainingAnalyticsV1({
      weeks: 12,
      now: new Date("2026-09-10T00:00:00Z"),
      sessions: [
        session({ id: 1, date: "2026-07-01", weightKg: 10, restBeforeSeconds: 90, trainingBlockLabel: "Base" }),
        session({ id: 2, date: "2026-07-16", weightKg: 12, restBeforeSeconds: 90, trainingBlockLabel: "Base" }),
        session({ id: 3, date: "2026-07-31", weightKg: 14, restBeforeSeconds: 90, trainingBlockLabel: "Base" }),
        session({ id: 4, date: "2026-08-10", weightKg: 16, restBeforeSeconds: 90, trainingBlockLabel: "Deload" }),
        session({ id: 5, date: "2026-08-25", weightKg: 14, restBeforeSeconds: 90, trainingBlockLabel: "Deload" }),
        session({ id: 6, date: "2026-09-09", weightKg: 12, restBeforeSeconds: 90, trainingBlockLabel: "Deload" }),
      ],
    });
    const trend = blockTrend.groups.find(({ groupId }) => groupId === "chest")!.exercises[0]!.performanceTrend;
    expect(trend.status).toBe("declining");
    expect(trend.segments.map(({ blockLabel, status }) => [blockLabel, status])).toEqual([
      ["Base", "improving"],
      ["Deload", "declining"],
    ]);

    const sameTrainingWeek = buildBodyMapTrainingAnalyticsV1({
      weeks: 12,
      now: new Date("2026-09-10T00:00:00Z"),
      sessions: [
        session({ id: 10, date: "2026-07-01", weightKg: 10, restBeforeSeconds: 90, trainingWeekNumber: 1 }),
        session({ id: 11, date: "2026-07-08", weightKg: 11, restBeforeSeconds: 90, trainingWeekNumber: 1 }),
        session({ id: 12, date: "2026-07-16", weightKg: 12, restBeforeSeconds: 90, trainingWeekNumber: 2 }),
        session({ id: 13, date: "2026-07-31", weightKg: 13, restBeforeSeconds: 90, trainingWeekNumber: 3 }),
      ],
    });
    expect(sameTrainingWeek.groups.find(({ groupId }) => groupId === "chest")!.exercises[0]!.performanceTrend.status).toBe("improving");

    const numberedWeekResetAfterUnknown = buildBodyMapTrainingAnalyticsV1({
      weeks: 12,
      now: new Date("2026-09-10T00:00:00Z"),
      sessions: [
        session({ id: 20, date: "2026-07-01", weightKg: 10, restBeforeSeconds: 90, trainingWeekNumber: 4 }),
        session({ id: 21, date: "2026-07-16", weightKg: 12, restBeforeSeconds: 90, trainingWeekNumber: null }),
        session({ id: 22, date: "2026-07-31", weightKg: 14, restBeforeSeconds: 90, trainingWeekNumber: 1 }),
        session({ id: 23, date: "2026-08-15", weightKg: 16, restBeforeSeconds: 90, trainingWeekNumber: 2 }),
      ],
    });
    const resetTrend = numberedWeekResetAfterUnknown.groups.find(({ groupId }) => groupId === "chest")!.exercises[0]!.performanceTrend;
    expect(resetTrend.status).toBe("insufficient-data");
    expect(resetTrend.segments.map(({ phaseNumber, status }) => [phaseNumber, status])).toEqual([
      [1, "insufficient-data"],
      [2, "insufficient-data"],
    ]);
  });

  it("keeps an empty diary window unavailable instead of claiming zero training", () => {
    const result = buildBodyMapTrainingAnalyticsV1({ weeks: 8, now: new Date("2026-09-10T00:00:00Z"), sessions: [] });
    expect(result.coverage.mapping).toBe("unknown");
    expect(result.groups.every(({ status, totalUniqueSetCount }) => status === "unavailable" && totalUniqueSetCount === null)).toBe(true);
    expect(result.groups.every(({ loggedExposureIntervals }) => loggedExposureIntervals.length === 0)).toBe(true);
  });
});
