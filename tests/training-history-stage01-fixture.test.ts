import { describe, expect, it } from "vitest";
import { CANONICAL_EXERCISE_IDENTITIES } from "@/modules/training/canonical-exercise-identity";
import {
  createTrainingHistoryStage01FixtureV1,
  TRAINING_HISTORY_STAGE01_WEEK_STARTS,
  type Stage01ExerciseFixture,
  type Stage01SessionFixture,
} from "./fixtures/training-history-stage01/fixture-v1";
import {
  EXPECTED_FIXTURE_SCHEMA_LIMITS_V1,
  EXPECTED_GOLDEN_V1,
  EXPECTED_NONLINEAR_V1,
  EXPECTED_ORDER_WEEKS_V1,
} from "./fixtures/training-history-stage01/expected-v1";

function targetExercise(session: Stage01SessionFixture): Stage01ExerciseFixture {
  const target = session.exercises.find((exercise) => exercise.stableKey === "incline_dumbbell_press_30deg");
  if (!target) throw new Error(`Missing target exercise in ${session.scenarioId} W${session.weekNumber}`);
  return target;
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
}

function rirBuckets(exercises: Stage01ExerciseFixture[]) {
  const values = exercises.flatMap((exercise) => exercise.sets.map((set) => set.rir).filter((value): value is number => value !== null));
  return {
    "0-1": values.filter((value) => value <= 1).length,
    "2-3": values.filter((value) => value >= 2 && value <= 3).length,
    "4+": values.filter((value) => value >= 4).length,
  };
}

function expectedGroupOrdinal(exercise: Stage01ExerciseFixture, muscleGroup: string, role: "direct" | "indirect"): number | null {
  return exercise.groupOrdinals.find((entry) => entry.muscleGroup === muscleGroup && entry.role === role)?.ordinal ?? null;
}

function rawPreWorkKgReps(exercises: Stage01ExerciseFixture[]): number {
  return exercises.reduce((total, exercise) => total + exercise.sets.reduce((setTotal, set) => {
    if (set.weightKg === null) return setTotal;
    return setTotal + set.weightKg * set.reps * (exercise.loadBasis === "per-side" || exercise.loadBasis === "per-implement" ? 2 : 1);
  }, 0), 0);
}

describe("Training History Stage 01 deterministic fixtures", () => {
  it("is deterministic, fixed-date, versioned, and covers every canonical identity", () => {
    const first = createTrainingHistoryStage01FixtureV1();
    const second = createTrainingHistoryStage01FixtureV1();
    expect(first).toEqual(second);
    expect(first.namespace).toBe("bodycast-training-history-stage01:v1");
    expect(first.timezone).toBe("Europe/Bratislava");
    expect(first.sessions.filter((session) => session.weekNumber !== null)).toHaveLength(48);
    expect([...new Set(first.sessions.filter((session) => session.weekNumber !== null).map((session) => session.scenarioId))]).toEqual([
      "progress", "regression", "plateau", "exercise-order",
    ]);
    expect(TRAINING_HISTORY_STAGE01_WEEK_STARTS).toHaveLength(12);
    expect(TRAINING_HISTORY_STAGE01_WEEK_STARTS[0]).toBe("2026-01-05");
    expect(TRAINING_HISTORY_STAGE01_WEEK_STARTS[11]).toBe("2026-03-23");
    for (let index = 0; index < TRAINING_HISTORY_STAGE01_WEEK_STARTS.length; index += 1) {
      expect(new Date(`${TRAINING_HISTORY_STAGE01_WEEK_STARTS[index]}T12:00:00Z`).getUTCDay()).toBe(1);
    }

    const canonicalKeys = CANONICAL_EXERCISE_IDENTITIES.map((entry) => entry.stableKey).sort();
    for (const profile of first.profiles) {
      expect(first.catalogExercises.filter((exercise) => exercise.profileId === profile.id && exercise.kind === "canonical")
        .map((exercise) => exercise.stableKey).sort()).toEqual(canonicalKeys);
    }
    expect(first.catalogExercises.filter((exercise) => exercise.kind === "custom-mapped")).toHaveLength(1);
    expect(first.catalogExercises.filter((exercise) => exercise.kind === "custom-unmapped")).toHaveLength(1);
    expect(new Set(first.sessions.flatMap((session) => session.exercises.flatMap((exercise) => [exercise.id, ...exercise.sets.map((set) => set.id)]))).size)
      .toBe(first.sessions.reduce((count, session) => count + session.exercises.reduce((sum, exercise) => sum + 1 + exercise.sets.length, 0), 0));
    expect(first.programVersions).toHaveLength(19);
    expect(first.programChanges).toHaveLength(12);
    expect(first.sessions.flatMap((session) => session.exercises).every((exercise) => exercise.equipmentPersisted === false)).toBe(true);
  });

  it("matches all explicit nonlinear inputs, independent weekly kg-reps, medians, and raw RIR buckets", () => {
    const fixture = createTrainingHistoryStage01FixtureV1();
    for (const scenario of ["progress", "regression", "plateau"] as const) {
      const sessions = fixture.sessions.filter((session) => session.scenarioId === scenario).sort((a, b) => a.weekNumber! - b.weekNumber!);
      const expected = EXPECTED_NONLINEAR_V1[scenario];
      expect(sessions).toHaveLength(12);
      expect(fixture.comparisonInputs[scenario]).toHaveLength(12);
      const observedKgReps: number[] = [];
      for (let weekIndex = 0; weekIndex < 12; weekIndex += 1) {
        const expectedWeek = expected.weeks[weekIndex]!;
        const input = fixture.comparisonInputs[scenario][weekIndex]!;
        const exercise = targetExercise(sessions[weekIndex]!);
        expect(sessions[weekIndex]!.date).toBe(TRAINING_HISTORY_STAGE01_WEEK_STARTS[weekIndex]);
        expect(exercise.actualPosition).toBe(exercise.sortOrder + 1);
        expect(exercise.sets).toHaveLength(3);
        expect(exercise.sets.map((set) => ({ weightKg: set.weightKg, reps: set.reps, rir: set.rir }))).toEqual(
          expectedWeek.rawRir.map((rir) => ({ weightKg: expectedWeek.weightKg, reps: expectedWeek.reps, rir })),
        );
        expect(input).toMatchObject({ weightKg: expectedWeek.weightKg, reps: expectedWeek.reps, rawRir: expectedWeek.rawRir });
        const independentKgReps = expectedWeek.weightKg * expectedWeek.reps * 3 * 2;
        expect(independentKgReps).toBe(expectedWeek.kgReps);
        observedKgReps.push(independentKgReps);
      }
      expect(median(observedKgReps.slice(0, 3))).toBe(expected.firstThreeMedianKgReps);
      expect(median(observedKgReps.slice(-3))).toBe(expected.lastThreeMedianKgReps);
      expect(rirBuckets(sessions.map(targetExercise))).toEqual(expected.rirBuckets);
    }

    const progressWeekEight = fixture.sessions.find((session) => session.scenarioId === "progress" && session.weekNumber === 8)!;
    expect(rawPreWorkKgReps(progressWeekEight.exercises.filter((exercise) => exercise.actualPosition < targetExercise(progressWeekEight).actualPosition))).toBe(600);
    const regressionWeekTen = fixture.sessions.find((session) => session.scenarioId === "regression" && session.weekNumber === 10)!;
    const regressionPriorRows = regressionWeekTen.exercises.filter((exercise) => exercise.actualPosition < targetExercise(regressionWeekTen).actualPosition);
    expect(regressionPriorRows).toHaveLength(1);
    expect(regressionPriorRows[0]!.sets).toHaveLength(1);
    expect(rawPreWorkKgReps(regressionPriorRows)).toBe(450);
    const plateauWeekFour = fixture.sessions.find((session) => session.scenarioId === "plateau" && session.weekNumber === 4)!;
    expect(rawPreWorkKgReps(plateauWeekFour.exercises.filter((exercise) => exercise.actualPosition < targetExercise(plateauWeekFour).actualPosition))).toBe(600);
  });

  it("retains real ordered exposure rows, custom snapshots, and cross-history order comparisons", () => {
    const fixture = createTrainingHistoryStage01FixtureV1();
    const orderSessions = fixture.sessions.filter((session) => session.scenarioId === "exercise-order").sort((a, b) => a.weekNumber! - b.weekNumber!);
    for (const expected of EXPECTED_ORDER_WEEKS_V1) {
      const session = orderSessions[expected.week - 1]!;
      const target = targetExercise(session);
      expect(target.actualPosition).toBe(expected.absolutePosition);
      expect(target.sets.map((set) => ({ weightKg: set.weightKg, reps: set.reps, rir: set.rir }))).toEqual(
        expected.rawRir.map((rir) => ({ weightKg: expected.weightKg, reps: expected.reps, rir })),
      );
      expect(target.sets[0]!.weightKg! * target.sets[0]!.reps * target.sets.length * 2).toBe(expected.kgReps);
      expect(expectedGroupOrdinal(target, "chest", "direct")).toBe(expected.chestOrdinal);
      expect(expectedGroupOrdinal(target, "deltoids", "direct")).toBe(expected.deltoidOrdinal);
      expect(expectedGroupOrdinal(target, "triceps", "indirect")).toBe(expected.tricepsIndirectOrdinal);
      expect(session.priorExposure.map((entry) => [entry.stableKey, entry.muscleGroup, entry.role])).toEqual(expected.priorExposure);
      expect(session.exercises.map((exercise) => exercise.actualPosition)).toEqual(session.exercises.map((_, index) => index + 1));
    }

    const orderWeekFour = orderSessions[3]!;
    expect(orderWeekFour.exercises.filter((exercise) => exercise.actualPosition < 3).map((exercise) => exercise.sets.length)).toEqual([2, 2]);
    const progressWeekEight = fixture.sessions.find((session) => session.scenarioId === "progress" && session.weekNumber === 8)!;
    const progressTarget = targetExercise(progressWeekEight);
    const orderTargetAtTwo = targetExercise(orderSessions[6]!);
    expect(progressTarget.actualPosition).toBe(orderTargetAtTwo.actualPosition);
    expect(expectedGroupOrdinal(progressTarget, "chest", "direct")).toBe(2);
    expect(expectedGroupOrdinal(orderTargetAtTwo, "chest", "direct")).toBe(1);

    const customMapped = orderSessions[10]!.exercises.find((exercise) => exercise.stableKey === null && exercise.snapshotStableKey === "seated_dumbbell_press")!;
    const customUnmapped = orderSessions[10]!.exercises.find((exercise) => exercise.stableKey === null && exercise.snapshotStableKey === null)!;
    expect(customMapped.muscleMappingSnapshot.anatomyMappingSnapshotV1.availability).toBe("available");
    expect(customMapped.muscleMappingSnapshot.anatomyMappingSnapshotV1.provenance).toBe("retrospective-interpretation");
    const unavailableAnatomy = customUnmapped.muscleMappingSnapshot.anatomyMappingSnapshotV1;
    expect(unavailableAnatomy.availability).toBe("unavailable");
    if (unavailableAnatomy.availability === "unavailable") expect(unavailableAnatomy.reason).toBe("missing-stable-key");
    expect(customUnmapped.sets[0]!.weightKg).toBeNull();
    expect(customUnmapped.sets[0]!.rir).toBeNull();

    const progressBadDay = fixture.sessions.find((session) => session.scenarioId === "progress" && session.weekNumber === 5)!;
    expect(targetExercise(progressBadDay).sets.map((set) => set.rir)).toEqual([1, 1, 1]);
    expect(targetExercise(fixture.sessions.find((session) => session.scenarioId === "progress" && session.weekNumber === 10)!).sets.map((set) => set.rir)).toEqual([4, 4, 3]);
    expect(targetExercise(fixture.sessions.find((session) => session.scenarioId === "regression" && session.weekNumber === 7)!).sets.map((set) => set.rir)).toEqual([4, 4, 3]);
  });

  it("verifies each supplied golden row and keeps load domains separate", () => {
    const fixture = createTrainingHistoryStage01FixtureV1();
    for (const side of ["pull", "push"] as const) {
      const expected = EXPECTED_GOLDEN_V1[side];
      const session = fixture.sessions.find((row) => row.scenarioId === `golden-${side}`)!;
      expect(session.date).toBe(expected.date);
      const byKey = Object.fromEntries(session.exercises.map((exercise) => [exercise.stableKey, exercise])) as Record<string, Stage01ExerciseFixture>;
      const counts = Object.fromEntries(session.exercises.map((exercise) => [exercise.stableKey, exercise.sets.length]));
      expect(counts).toEqual(expected.setCounts);
      expect(session.exercises.flatMap((exercise) => exercise.sets.map((set) => set.rir))).toEqual(
        session.exercises.flatMap((exercise) => exercise.sets.map(() => null)),
      );
      expect(expected.allRirValues).toBeNull();
      const perExerciseTotals: Record<string, number> = Object.fromEntries(session.exercises.flatMap((exercise) => {
        if (exercise.loadBasis === "bodyweight-reference-separate" || exercise.loadBasis === "full-system") return [];
        if (exercise.loadBasis === "band-nominal-per-logged-side") return [];
        const multiplier = exercise.loadBasis === "per-side" || exercise.loadBasis === "per-implement" ? 2 : 1;
        return [[exercise.stableKey!, exercise.sets.reduce((sum, set) => sum + set.weightKg! * set.reps * multiplier, 0)]];
      }));
      const bandTotal = session.exercises.filter((exercise) => exercise.loadBasis === "band-nominal-per-logged-side")
        .flatMap((exercise) => exercise.sets).reduce((sum, set) => sum + set.bandNominalResistanceKg! * set.reps, 0);
      expect(bandTotal).toBe(expected.bandNominalPerLoggedSideKgReps);
      if (side === "pull") {
        const pullExpected = EXPECTED_GOLDEN_V1.pull;
        expect(perExerciseTotals).toEqual(pullExpected.exerciseKgReps);
        const dumbbellSubtotal = Object.values(perExerciseTotals).reduce((sum, value) => sum + value, 0);
        const hyperextension = byKey.hyperextension!.sets.reduce((sum, set) => sum + set.weightKg! * set.reps, 0);
        expect(dumbbellSubtotal).toBe(pullExpected.perHandExternalSubtotalKgReps);
        expect(hyperextension).toBe(pullExpected.hyperextensionFullSystemKgReps);
        expect(dumbbellSubtotal + hyperextension).toBe(pullExpected.externalTotalKgReps);
        expect(byKey.pull_up!.sets.reduce((sum, set) => sum + set.reps, 0)).toBe(pullExpected.pullUpReps);
        expect(pullExpected.bodyweightReference.massKg * pullExpected.bodyweightReference.reps).toBe(pullExpected.bodyweightReference.kgReps);
      } else {
        const pushExpected = EXPECTED_GOLDEN_V1.push;
        expect(perExerciseTotals).toEqual(pushExpected.exerciseKgReps);
        expect(Object.values(perExerciseTotals).reduce((sum, value) => sum + value, 0)).toBe(pushExpected.externalTotalKgReps);
        expect(byKey.pushup_handles!.sets.reduce((sum, set) => sum + set.reps, 0)).toBe(pushExpected.pushupHandlesReps);
      }
      expect(session.matchedWorkoutId).not.toBeNull();
    }
    expect(EXPECTED_FIXTURE_SCHEMA_LIMITS_V1).toMatchObject({
      equipmentPersisted: false,
      independentRepsPerSidePersisted: false,
      bodyweightReferenceWhenMassMissing: null,
      rIRNullMeans: "unreported",
    });
  });

  it("represents unavailable events and nullable source measures without fabricating zeroes", () => {
    const fixture = createTrainingHistoryStage01FixtureV1();
    const emptyDiary = fixture.sessions.find((session) => session.scenarioId === "edge-cases")!;
    expect(emptyDiary.exercises).toEqual([]);
    expect(emptyDiary.matchedWorkoutId).not.toBeNull();
    expect(fixture.dailyHealthRows.every((day) => day.weightKg === null && day.steps === null)).toBe(true);
    expect(fixture.workouts.filter((workout) => workout.scenario === "ms100-boundary")).toHaveLength(2);
    const ms100 = fixture.workouts.filter((workout) => workout.scenario === "ms100-boundary");
    expect(new Date(ms100[0]!.endAt).getTime()).toBeGreaterThan(new Date(ms100[0]!.startAt).getTime());
    expect(new Date(ms100[1]!.startAt).getTime()).toBeLessThan(new Date(ms100[0]!.endAt).getTime());
    const localDate = (date: string) => new Intl.DateTimeFormat("en-CA", { timeZone: fixture.timezone }).format(new Date(date));
    expect(localDate(ms100[0]!.startAt)).toBe("2026-09-24");
    expect(localDate(ms100[0]!.endAt)).toBe("2026-09-25");
    expect(ms100[1]!.manualStepCount).toBe(100);
    expect(ms100.every((workout) => workout.matchedDiarySessionId === null)).toBe(true);
    expect(fixture.workouts.filter((workout) => workout.date === "2026-09-26")).toEqual([]);
    expect(fixture.workouts.filter((workout) => workout.externalId !== null).every((workout) => workout.sourceIdentity === `ext:${workout.externalId}`)).toBe(true);
    expect(fixture.dailyHealthRows.some((day) => day.date === "2026-09-26")).toBe(false);
  });
});
