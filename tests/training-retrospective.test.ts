import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import {
  DIARY_COMPLETENESS,
  ENTRY_MODE,
  EXERCISE_ORIGIN,
  MATCH_METHOD,
  MATCH_STATUS,
  RESISTANCE,
  SESSION_STATUS,
} from "@/modules/training/training.constants";
import {
  ExerciseHasSetsError,
  ResistanceChangeBlockedError,
  SetValidationError,
  WorkoutNotEligibleError,
} from "@/modules/training/training.errors";
import { TrainingRepository } from "@/modules/training/training.repository";
import { TrainingService } from "@/modules/training/training.service";

type MockDb = ReturnType<typeof buildDb>;

function decimal(value: number | null) {
  return value === null ? null : new Prisma.Decimal(value);
}

function buildDb() {
  const db = {
    exerciseCatalog: { findMany: vi.fn() },
    trainingProgram: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    trainingProgramVersion: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
    },
    strengthDiarySession: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    strengthDiaryProgramChange: { create: vi.fn() },
    strengthSessionExercise: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    strengthSet: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
    },
    workout: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(),
  };
  db.$transaction.mockImplementation(async (callback: (tx: typeof db) => unknown) => callback(db));
  db.strengthSessionExercise.update.mockResolvedValue({});
  db.strengthSessionExercise.create.mockResolvedValue({ id: 999 });
  db.strengthSessionExercise.delete.mockResolvedValue({});
  db.strengthDiaryProgramChange.create.mockResolvedValue({ id: 1 });
  db.strengthDiarySession.update.mockResolvedValue({ revision: 2 });
  db.strengthSet.updateMany.mockResolvedValue({ count: 0 });
  return db;
}

const catalogA = {
  id: 1,
  name: "Жим гантелей сидячи",
  isActive: true,
  muscleMapping: null,
  resistanceType: RESISTANCE.EXTERNAL_WEIGHT,
};
const catalogB = {
  id: 2,
  name: "Гіперекстензія",
  isActive: true,
  muscleMapping: null,
  resistanceType: RESISTANCE.RESISTANCE_BAND,
};
const catalogC = {
  id: 3,
  name: "Віджимання від ручок",
  isActive: true,
  muscleMapping: null,
  resistanceType: RESISTANCE.BODYWEIGHT,
};

const workoutStartAt = new Date("2026-08-12T16:04:00Z");

function strengthWorkout(overrides: Record<string, unknown> = {}) {
  return {
    id: 77,
    type: "Traditional Strength Training",
    startAt: workoutStartAt,
    endAt: new Date("2026-08-12T17:17:00Z"),
    durationMinutes: 73,
    activeEnergyKcal: 410,
    externalId: "g-1",
    matchedDiarySession: null,
    ...overrides,
  };
}

function programRecord(programId: number, currentVersionId: number, archivedAt: Date | null = null) {
  return {
    id: programId,
    name: programId === 10 ? "Моє тренування" : "Інша програма",
    archivedAt,
    currentVersionId,
  };
}

function versionRecord(
  versionId: number,
  versionNumber: number,
  exercises: Array<{ catalogId: number; name: string; plannedSets: number; resistanceType: string }>,
) {
  return {
    id: versionId,
    versionNumber,
    exercises: exercises.map((exercise, index) => ({
      exerciseCatalogId: exercise.catalogId,
      sortOrder: index,
      plannedSets: exercise.plannedSets,
      resistanceType: exercise.resistanceType,
      exerciseCatalog: { id: exercise.catalogId, name: exercise.name, muscleMapping: null },
    })),
  };
}

/** Detail row shape returned by sessionDetailSelect. */
function retrospectiveDetail(overrides: Record<string, unknown> = {}) {
  return {
    id: 50,
    status: SESSION_STATUS.COMPLETED,
    entryMode: ENTRY_MODE.RETROSPECTIVE,
    revision: 1,
    programId: 10,
    programVersionId: 101,
    webStartedAt: null as Date | null,
    webEndedAt: null as Date | null,
    matchStatus: MATCH_STATUS.MATCHED,
    matchMethod: MATCH_METHOD.DIRECT_BACKFILL as string | null,
    matchedAt: new Date("2026-09-17T12:00:00Z"),
    matchedWorkoutId: 77 as number | null,
    createdAt: new Date("2026-09-17T12:00:00Z"),
    updatedAt: new Date("2026-09-17T12:00:00Z"),
    program: { id: 10, name: "Моє тренування" },
    programVersion: { id: 101, versionNumber: 1 },
    matchedWorkout: {
      id: 77,
      type: "Traditional Strength Training",
      startAt: workoutStartAt,
      endAt: new Date("2026-08-12T17:17:00Z"),
      durationMinutes: 73,
      activeEnergyKcal: 410,
      externalId: "g-1",
    },
    exercises: [
      {
        id: 501,
        sourceExerciseCatalogId: 1,
        snapshotExerciseName: catalogA.name,
        sortOrder: 0,
        plannedSets: 3,
        resistanceType: RESISTANCE.EXTERNAL_WEIGHT,
        origin: EXERCISE_ORIGIN.PLANNED,
        muscleMappingSnapshot: null,
        sets: [],
      },
      {
        id: 502,
        sourceExerciseCatalogId: 2,
        snapshotExerciseName: catalogB.name,
        sortOrder: 1,
        plannedSets: 3,
        resistanceType: RESISTANCE.RESISTANCE_BAND,
        origin: EXERCISE_ORIGIN.PLANNED,
        muscleMappingSnapshot: null,
        sets: [],
      },
    ],
    ...overrides,
  };
}

/** Row shape returned by findSessionForEdit. */
function sessionForEdit(overrides: Record<string, unknown> = {}) {
  return {
    id: 50,
    status: SESSION_STATUS.COMPLETED,
    entryMode: ENTRY_MODE.RETROSPECTIVE,
    revision: 1,
    programId: 10,
    programVersionId: 101,
    webStartedAt: null as Date | null,
    matchedWorkout: { id: 77, startAt: workoutStartAt },
    exercises: [
      {
        id: 501,
        sourceExerciseCatalogId: 1,
        snapshotExerciseName: catalogA.name,
        sortOrder: 0,
        plannedSets: 3,
        resistanceType: RESISTANCE.EXTERNAL_WEIGHT,
        origin: EXERCISE_ORIGIN.PLANNED,
        _count: { sets: 2 },
      },
      {
        id: 502,
        sourceExerciseCatalogId: 2,
        snapshotExerciseName: catalogB.name,
        sortOrder: 1,
        plannedSets: 3,
        resistanceType: RESISTANCE.RESISTANCE_BAND,
        origin: EXERCISE_ORIGIN.PLANNED,
        _count: { sets: 1 },
      },
    ],
    ...overrides,
  };
}

function makeService(db: MockDb) {
  return new TrainingService(db as never, new TrainingRepository(db as never));
}

describe("retrospective diary creation from historical workouts", () => {
  let db: MockDb;
  let service: TrainingService;

  beforeEach(() => {
    db = buildDb();
    service = makeService(db);
  });

  function arrangeProgram(archivedAt: Date | null = null) {
    db.trainingProgram.findFirst.mockResolvedValue(programRecord(10, 101, archivedAt));
    db.trainingProgramVersion.findFirst.mockResolvedValue(versionRecord(101, 1, [
      { catalogId: 1, name: catalogA.name, plannedSets: 3, resistanceType: RESISTANCE.EXTERNAL_WEIGHT },
      { catalogId: 2, name: catalogB.name, plannedSets: 3, resistanceType: RESISTANCE.RESISTANCE_BAND },
    ]));
  }

  it("creates a COMPLETED RETROSPECTIVE session directly linked to the workout", async () => {
    db.workout.findUnique.mockResolvedValue(strengthWorkout());
    arrangeProgram();
    db.strengthDiarySession.create.mockResolvedValue({ id: 50 });
    db.strengthDiarySession.findFirst.mockResolvedValue(retrospectiveDetail());

    const session = await service.createSessionFromWorkout({ workoutId: 77, programId: 10 });

    expect(db.strengthDiarySession.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: SESSION_STATUS.COMPLETED,
        entryMode: ENTRY_MODE.RETROSPECTIVE,
        webStartedAt: null,
        webEndedAt: null,
        matchStatus: MATCH_STATUS.MATCHED,
        matchMethod: MATCH_METHOD.DIRECT_BACKFILL,
        matchedWorkoutId: 77,
      }),
    }));
    expect(session.entryMode).toBe(ENTRY_MODE.RETROSPECTIVE);
    expect(session.status).toBe(SESSION_STATUS.COMPLETED);
    expect(session.webStartedAt).toBeNull();
    expect(session.matchMethod).toBe(MATCH_METHOD.DIRECT_BACKFILL);
    expect(session.matchedWorkout?.startAt).toBe(workoutStartAt.toISOString());
    expect(session.exercises.map((exercise) => exercise.origin)).toEqual([
      EXERCISE_ORIGIN.PLANNED,
      EXERCISE_ORIGIN.PLANNED,
    ]);
  });

  it("snapshots program exercises as PLANNED without running the fuzzy matcher", async () => {
    db.workout.findUnique.mockResolvedValue(strengthWorkout());
    arrangeProgram();
    db.strengthDiarySession.create.mockResolvedValue({ id: 50 });
    db.strengthDiarySession.findFirst.mockResolvedValue(retrospectiveDetail());

    await service.createSessionFromWorkout({ workoutId: 77, programId: 10 });

    expect(db.strengthDiarySession.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        exercises: {
          create: [
            expect.objectContaining({
              snapshotExerciseName: catalogA.name,
              origin: EXERCISE_ORIGIN.PLANNED,
            }),
            expect.objectContaining({
              snapshotExerciseName: catalogB.name,
              origin: EXERCISE_ORIGIN.PLANNED,
            }),
          ],
        },
      }),
    }));
    // Candidate search is the fuzzy matcher's only data source.
    expect(db.workout.findMany).not.toHaveBeenCalled();
  });

  it("allows an archived program for historical backfill", async () => {
    db.workout.findUnique.mockResolvedValue(strengthWorkout());
    arrangeProgram(new Date("2026-09-01T00:00:00Z"));
    db.strengthDiarySession.create.mockResolvedValue({ id: 50 });
    db.strengthDiarySession.findFirst.mockResolvedValue(retrospectiveDetail());

    await expect(service.createSessionFromWorkout({ workoutId: 77, programId: 10 }))
      .resolves.toMatchObject({ id: 50 });
  });

  it("rejects a stepper workout without writing a session", async () => {
    db.workout.findUnique.mockResolvedValue(strengthWorkout({
      type: "Stair Climbing",
      externalId: "stair-1",
    }));

    await expect(service.createSessionFromWorkout({ workoutId: 77, programId: 10 }))
      .rejects.toBeInstanceOf(WorkoutNotEligibleError);
    expect(db.strengthDiarySession.create).not.toHaveBeenCalled();
  });

  it("returns the existing session instead of creating a duplicate", async () => {
    db.workout.findUnique.mockResolvedValue(strengthWorkout({
      matchedDiarySession: {
        id: 50,
        status: SESSION_STATUS.COMPLETED,
        entryMode: ENTRY_MODE.RETROSPECTIVE,
        program: { id: 10, name: "Моє тренування" },
        exercises: [],
      },
    }));
    db.strengthDiarySession.findFirst.mockResolvedValue(retrospectiveDetail());

    const session = await service.createSessionFromWorkout({ workoutId: 77, programId: 10 });

    expect(session.id).toBe(50);
    expect(db.strengthDiarySession.create).not.toHaveBeenCalled();
  });

  it("reports created versus existing sessions in a bulk backfill", async () => {
    db.workout.findUnique
      .mockResolvedValueOnce(strengthWorkout({ id: 77 }))
      .mockResolvedValueOnce(strengthWorkout({
        id: 78,
        matchedDiarySession: {
          id: 51,
          status: SESSION_STATUS.COMPLETED,
          entryMode: ENTRY_MODE.RETROSPECTIVE,
          program: { id: 10, name: "Моє тренування" },
          exercises: [],
        },
      }))
      .mockResolvedValueOnce(strengthWorkout({ id: 79, type: "Stair Climbing" }));
    arrangeProgram();
    db.strengthDiarySession.create.mockResolvedValue({ id: 50 });
    db.strengthDiarySession.findFirst
      .mockResolvedValueOnce(retrospectiveDetail())
      .mockResolvedValueOnce(retrospectiveDetail({ id: 51, matchedWorkoutId: 78 }));

    const result = await service.bulkCreateSessionsFromWorkouts({
      workoutIds: [77, 78, 79],
      programId: 10,
    });

    expect(result.createdSessionIds).toEqual([50]);
    expect(result.existingSessionIds).toEqual([51]);
    expect(result.rejected).toEqual([{ workoutId: 79, error: "workout_not_eligible" }]);
    expect(db.strengthDiarySession.create).toHaveBeenCalledTimes(1);
  });

  it("coexists with an ACTIVE live session (no single-session guard)", async () => {
    db.workout.findUnique.mockResolvedValue(strengthWorkout());
    arrangeProgram();
    db.strengthDiarySession.create.mockResolvedValue({ id: 50 });
    db.strengthDiarySession.findFirst.mockResolvedValue(retrospectiveDetail());

    await expect(service.createSessionFromWorkout({ workoutId: 77, programId: 10 }))
      .resolves.toMatchObject({ entryMode: ENTRY_MODE.RETROSPECTIVE });

    const activeLookups = db.strengthDiarySession.findFirst.mock.calls.filter(
      ([args]) => (args as { where?: { status?: string } }).where?.status === SESSION_STATUS.ACTIVE,
    );
    expect(activeLookups).toHaveLength(0);
  });
});

describe("historical strength workout listing", () => {
  let db: MockDb;
  let service: TrainingService;

  beforeEach(() => {
    db = buildDb();
    service = makeService(db);
  });

  it("classifies backfill progress and excludes non-strength types", async () => {
    db.workout.findMany.mockResolvedValue([
      { ...strengthWorkout({ id: 77 }), matchedDiarySession: null },
      {
        ...strengthWorkout({ id: 78 }),
        matchedDiarySession: {
          id: 50,
          program: { name: "Моє тренування" },
          exercises: [{ _count: { sets: 0 } }, { _count: { sets: 0 } }],
        },
      },
      {
        ...strengthWorkout({ id: 79 }),
        matchedDiarySession: {
          id: 51,
          program: { name: "Моє тренування" },
          exercises: [{ _count: { sets: 3 } }, { _count: { sets: 0 } }],
        },
      },
      {
        ...strengthWorkout({ id: 80 }),
        matchedDiarySession: {
          id: 52,
          program: { name: "Моє тренування" },
          exercises: [{ _count: { sets: 3 } }],
        },
      },
      { ...strengthWorkout({ id: 81, type: "Stair Climbing" }), matchedDiarySession: null },
    ]);

    const rows = await service.listHistoricalStrengthWorkouts({ limit: 10 });

    expect(rows.map((row) => row.workoutId)).toEqual([77, 78, 79, 80]);
    expect(rows.map((row) => row.diaryCompleteness)).toEqual([
      DIARY_COMPLETENESS.NO_DIARY,
      DIARY_COMPLETENESS.DIARY_EMPTY,
      DIARY_COMPLETENESS.DIARY_PARTIAL,
      DIARY_COMPLETENESS.DIARY_WITH_SETS,
    ]);
    expect(db.workout.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        type: { equals: "Traditional Strength Training", mode: "insensitive" },
      }),
    }));
  });
});

describe("historical program reassignment", () => {
  let db: MockDb;
  let service: TrainingService;

  beforeEach(() => {
    db = buildDb();
    service = makeService(db);
  });

  function arrangeChangeTo(exercises: Array<{
    catalogId: number;
    name: string;
    plannedSets: number;
    resistanceType: string;
  }>) {
    db.strengthDiarySession.findFirst
      .mockResolvedValueOnce(sessionForEdit())
      .mockResolvedValueOnce(retrospectiveDetail({ programId: 20, programVersionId: 201 }));
    db.trainingProgram.findFirst.mockResolvedValue(programRecord(20, 201));
    db.trainingProgramVersion.findFirst.mockResolvedValue(versionRecord(201, 1, exercises));
  }

  it("preserves recorded sets for exercises matching on catalog + resistance type", async () => {
    arrangeChangeTo([
      { catalogId: 1, name: catalogA.name, plannedSets: 4, resistanceType: RESISTANCE.EXTERNAL_WEIGHT },
      { catalogId: 3, name: catalogC.name, plannedSets: 3, resistanceType: RESISTANCE.BODYWEIGHT },
    ]);

    await service.changeSessionProgram(50, { programId: 20 });

    expect(db.strengthSessionExercise.delete).not.toHaveBeenCalled();
    expect(db.strengthSessionExercise.update).toHaveBeenCalledWith({
      where: { id: 501 },
      data: { sortOrder: 0, plannedSets: 4, origin: EXERCISE_ORIGIN.PLANNED },
    });
    expect(db.strengthDiaryProgramChange.create).toHaveBeenCalledWith({
      data: {
        sessionId: 50,
        fromProgramId: 10,
        fromProgramVersionId: 101,
        toProgramId: 20,
        toProgramVersionId: 201,
      },
    });
    expect(db.strengthDiarySession.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 50 },
      data: expect.objectContaining({
        programId: 20,
        programVersionId: 201,
        revision: { increment: 1 },
      }),
    }));
  });

  it("keeps an orphan exercise as EXTRA instead of deleting its sets", async () => {
    arrangeChangeTo([
      { catalogId: 1, name: catalogA.name, plannedSets: 4, resistanceType: RESISTANCE.EXTERNAL_WEIGHT },
      { catalogId: 3, name: catalogC.name, plannedSets: 3, resistanceType: RESISTANCE.BODYWEIGHT },
    ]);

    await service.changeSessionProgram(50, { programId: 20 });

    expect(db.strengthSessionExercise.delete).not.toHaveBeenCalled();
    expect(db.strengthSessionExercise.update).toHaveBeenCalledWith({
      where: { id: 502 },
      data: { sortOrder: 2, plannedSets: 3, origin: EXERCISE_ORIGIN.EXTRA },
    });
    expect(db.strengthSessionExercise.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        sourceExerciseCatalogId: 3,
        sortOrder: 1,
        origin: EXERCISE_ORIGIN.PLANNED,
      }),
    }));
  });

  it("never silently converts loads when the resistance type differs", async () => {
    arrangeChangeTo([
      { catalogId: 1, name: catalogA.name, plannedSets: 3, resistanceType: RESISTANCE.RESISTANCE_BAND },
    ]);

    await service.changeSessionProgram(50, { programId: 20 });

    expect(db.strengthSessionExercise.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        sourceExerciseCatalogId: 1,
        resistanceType: RESISTANCE.RESISTANCE_BAND,
        origin: EXERCISE_ORIGIN.PLANNED,
        sortOrder: 0,
      }),
    }));
    expect(db.strengthSessionExercise.update).toHaveBeenCalledWith({
      where: { id: 501 },
      data: { sortOrder: 1, plannedSets: 3, origin: EXERCISE_ORIGIN.EXTRA },
    });
    expect(db.strengthSet.updateMany).not.toHaveBeenCalled();
    expect(db.strengthSet.delete).not.toHaveBeenCalled();
  });
});

describe("session-level exercise edits", () => {
  let db: MockDb;
  let service: TrainingService;

  beforeEach(() => {
    db = buildDb();
    service = makeService(db);
  });

  it("adds a manual EXTRA exercise without touching the program template", async () => {
    db.strengthDiarySession.findFirst
      .mockResolvedValueOnce(sessionForEdit())
      .mockResolvedValueOnce(retrospectiveDetail());
    db.exerciseCatalog.findMany.mockResolvedValue([catalogC]);
    db.strengthSessionExercise.create.mockResolvedValue({ id: 503 });

    await service.addSessionExercise(50, {
      catalogId: 3,
      plannedSets: 3,
      resistanceType: RESISTANCE.BODYWEIGHT,
    });

    expect(db.strengthSessionExercise.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        sessionId: 50,
        sourceExerciseCatalogId: 3,
        snapshotExerciseName: catalogC.name,
        sortOrder: 2,
        plannedSets: 3,
        resistanceType: RESISTANCE.BODYWEIGHT,
        origin: EXERCISE_ORIGIN.EXTRA,
      }),
    }));
    expect(db.trainingProgramVersion.create).not.toHaveBeenCalled();
    expect(db.trainingProgram.update).not.toHaveBeenCalled();
    expect(db.strengthDiarySession.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { revision: { increment: 1 } },
    }));
  });

  it("refuses to remove an exercise with recorded sets unless confirmed", async () => {
    db.strengthDiarySession.findFirst.mockResolvedValue(sessionForEdit());
    db.strengthSessionExercise.findFirst.mockResolvedValue({
      id: 501,
      sessionId: 50,
      sortOrder: 0,
      plannedSets: 3,
      resistanceType: RESISTANCE.EXTERNAL_WEIGHT,
      origin: EXERCISE_ORIGIN.PLANNED,
      sets: [
        { id: 900, weightKg: decimal(30), bandNominalResistanceKg: null },
        { id: 901, weightKg: decimal(32.5), bandNominalResistanceKg: null },
      ],
    });

    await expect(service.deleteSessionExercise(50, 501))
      .rejects.toBeInstanceOf(ExerciseHasSetsError);
    expect(db.strengthSessionExercise.delete).not.toHaveBeenCalled();
  });

  it("removes an exercise with recorded sets once confirmed", async () => {
    db.strengthDiarySession.findFirst
      .mockResolvedValueOnce(sessionForEdit())
      .mockResolvedValueOnce(retrospectiveDetail());
    db.strengthSessionExercise.findFirst.mockResolvedValue({
      id: 501,
      sessionId: 50,
      sortOrder: 0,
      plannedSets: 3,
      resistanceType: RESISTANCE.EXTERNAL_WEIGHT,
      origin: EXERCISE_ORIGIN.PLANNED,
      sets: [{ id: 900, weightKg: decimal(30), bandNominalResistanceKg: null }],
    });

    await service.deleteSessionExercise(50, 501, { confirm: true });

    expect(db.strengthSessionExercise.delete).toHaveBeenCalledWith({ where: { id: 501 } });
    expect(db.strengthSessionExercise.update).toHaveBeenCalledWith({
      where: { id: 502 },
      data: { sortOrder: 0 },
    });
  });

  it("blocks a resistance-type change that would strand recorded loads", async () => {
    db.strengthDiarySession.findFirst.mockResolvedValue(sessionForEdit());
    db.strengthSessionExercise.findFirst.mockResolvedValue({
      id: 501,
      sessionId: 50,
      sortOrder: 0,
      plannedSets: 3,
      resistanceType: RESISTANCE.EXTERNAL_WEIGHT,
      origin: EXERCISE_ORIGIN.PLANNED,
      sets: [{ id: 900, weightKg: decimal(30), bandNominalResistanceKg: null }],
    });

    await expect(
      service.updateSessionExercise(50, 501, { resistanceType: RESISTANCE.RESISTANCE_BAND }),
    ).rejects.toBeInstanceOf(ResistanceChangeBlockedError);
    expect(db.strengthSet.updateMany).not.toHaveBeenCalled();
  });

  it("clears — never converts — incompatible loads on a confirmed resistance change", async () => {
    db.strengthDiarySession.findFirst
      .mockResolvedValueOnce(sessionForEdit())
      .mockResolvedValueOnce(retrospectiveDetail());
    db.strengthSessionExercise.findFirst.mockResolvedValue({
      id: 501,
      sessionId: 50,
      sortOrder: 0,
      plannedSets: 3,
      resistanceType: RESISTANCE.EXTERNAL_WEIGHT,
      origin: EXERCISE_ORIGIN.PLANNED,
      sets: [{ id: 900, weightKg: decimal(30), bandNominalResistanceKg: null }],
    });

    await service.updateSessionExercise(50, 501, {
      resistanceType: RESISTANCE.RESISTANCE_BAND,
      confirmResistanceChange: true,
    });

    expect(db.strengthSet.updateMany).toHaveBeenCalledWith({
      where: { sessionExerciseId: 501 },
      data: { weightKg: null },
    });
  });

  it("reorders session exercises and bumps the diary revision", async () => {
    db.strengthDiarySession.findFirst
      .mockResolvedValueOnce(sessionForEdit())
      .mockResolvedValueOnce(retrospectiveDetail());

    await service.reorderSessionExercises(50, { exerciseIds: [502, 501] });

    expect(db.strengthSessionExercise.update).toHaveBeenCalledWith({
      where: { id: 502 },
      data: { sortOrder: 0 },
    });
    expect(db.strengthSessionExercise.update).toHaveBeenCalledWith({
      where: { id: 501 },
      data: { sortOrder: 1 },
    });
    expect(db.strengthDiarySession.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { revision: { increment: 1 } },
    }));
  });
});

describe("set edits on a completed retrospective session", () => {
  let db: MockDb;
  let service: TrainingService;

  beforeEach(() => {
    db = buildDb();
    service = makeService(db);
  });

  const completedSession = {
    id: 50,
    status: SESSION_STATUS.COMPLETED,
    entryMode: ENTRY_MODE.RETROSPECTIVE,
    matchedWorkout: { startAt: workoutStartAt },
  };

  it("bumps the diary revision when a completed set is edited", async () => {
    db.strengthSet.findFirst.mockResolvedValue({
      id: 900,
      reps: 10,
      weightKg: decimal(30),
      bandNominalResistanceKg: null,
      completedAt: workoutStartAt,
      sessionExercise: {
        id: 501,
        resistanceType: RESISTANCE.EXTERNAL_WEIGHT,
        session: completedSession,
      },
    });
    db.strengthSet.update.mockResolvedValue({
      id: 900,
      sessionExerciseId: 501,
      setNumber: 1,
      reps: 8,
      weightKg: decimal(30),
      bandNominalResistanceKg: null,
      completedAt: workoutStartAt,
      createdAt: workoutStartAt,
      updatedAt: new Date("2026-09-17T12:30:00Z"),
    });

    const updated = await service.updateSet(50, 900, { reps: 8 });

    expect(updated.reps).toBe(8);
    expect(db.strengthDiarySession.update).toHaveBeenCalledWith({
      where: { id: 50 },
      data: { revision: { increment: 1 } },
      select: { revision: true },
    });
  });

  it("does not bump the revision while logging a live ACTIVE session", async () => {
    db.strengthSessionExercise.findFirst.mockResolvedValue({
      id: 501,
      sessionId: 50,
      resistanceType: RESISTANCE.EXTERNAL_WEIGHT,
      session: {
        id: 50,
        status: SESSION_STATUS.ACTIVE,
        entryMode: ENTRY_MODE.LIVE,
        matchedWorkout: null,
      },
      sets: [],
    });
    db.strengthSet.create.mockResolvedValue({
      id: 900,
      sessionExerciseId: 501,
      setNumber: 1,
      reps: 12,
      weightKg: decimal(30),
      bandNominalResistanceKg: null,
      completedAt: workoutStartAt,
      createdAt: workoutStartAt,
      updatedAt: workoutStartAt,
    });

    await service.createSet(50, 501, { reps: 12, weightKg: 30 });
    expect(db.strengthDiarySession.update).not.toHaveBeenCalled();
  });

  it("keeps bodyweight semantics: no load columns allowed", async () => {
    db.strengthSessionExercise.findFirst.mockResolvedValue({
      id: 503,
      sessionId: 50,
      resistanceType: RESISTANCE.BODYWEIGHT,
      session: completedSession,
      sets: [],
    });

    await expect(service.createSet(50, 503, { reps: 12, weightKg: 30 }))
      .rejects.toBeInstanceOf(SetValidationError);
    expect(db.strengthSet.create).not.toHaveBeenCalled();
  });

  it("keeps band semantics: bandNominalResistanceKg instead of weightKg", async () => {
    db.strengthSessionExercise.findFirst.mockResolvedValue({
      id: 502,
      sessionId: 50,
      resistanceType: RESISTANCE.RESISTANCE_BAND,
      session: completedSession,
      sets: [],
    });

    await expect(service.createSet(50, 502, { reps: 15, weightKg: 20 }))
      .rejects.toBeInstanceOf(SetValidationError);

    db.strengthSet.create.mockResolvedValue({
      id: 901,
      sessionExerciseId: 502,
      setNumber: 1,
      reps: 15,
      weightKg: null,
      bandNominalResistanceKg: decimal(108),
      completedAt: workoutStartAt,
      createdAt: workoutStartAt,
      updatedAt: workoutStartAt,
    });

    const created = await service.createSet(50, 502, { reps: 15, bandNominalResistanceKg: 108 });
    expect(created.weightKg).toBeNull();
    expect(created.bandNominalResistanceKg).toBe(108);
  });
});

describe("matcher isolation for retrospective sessions", () => {
  let db: MockDb;
  let service: TrainingService;

  beforeEach(() => {
    db = buildDb();
    service = makeService(db);
  });

  it("returns no match candidates when there is no live web interval", async () => {
    db.strengthDiarySession.findFirst.mockResolvedValue(retrospectiveDetail());
    await expect(service.listMatchCandidates(50)).resolves.toEqual([]);
    expect(db.workout.findMany).not.toHaveBeenCalled();
  });

  it("skips DIRECT_BACKFILL sessions during delayed-sync auto matching", async () => {
    db.strengthDiarySession.findMany.mockResolvedValue([{
      id: 50,
      entryMode: ENTRY_MODE.RETROSPECTIVE,
      webStartedAt: null,
      webEndedAt: null,
      matchMethod: MATCH_METHOD.DIRECT_BACKFILL,
      matchedWorkoutId: 77,
    }]);

    await service.afterHealthSyncMatch("2026-08-12", { timezone: "UTC" });

    expect(db.workout.findMany).not.toHaveBeenCalled();
    expect(db.strengthDiarySession.update).not.toHaveBeenCalled();
  });

  it("excludes retrospective rows from the pending-overlap query", async () => {
    db.strengthDiarySession.findMany.mockResolvedValue([]);
    await service.afterHealthSyncMatch("2026-08-12", { timezone: "UTC" });

    expect(db.strengthDiarySession.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        entryMode: { not: ENTRY_MODE.RETROSPECTIVE },
        webStartedAt: expect.objectContaining({ not: null }),
      }),
    }));
  });
});
