import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import {
  ENTRY_MODE,
  EXERCISE_ORIGIN,
  MATCH_METHOD,
  MATCH_STATUS,
  RESISTANCE,
  SESSION_STATUS,
} from "@/modules/training/training.constants";
import {
  ActiveSessionExistsError,
  WorkoutAlreadyMatchedError,
} from "@/modules/training/training.errors";
import { TrainingRepository } from "@/modules/training/training.repository";
import { TrainingService } from "@/modules/training/training.service";

type MockDb = {
  exerciseCatalog: {
    findMany: ReturnType<typeof vi.fn>;
  };
  trainingProgram: {
    findMany: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  trainingProgramVersion: {
    create: ReturnType<typeof vi.fn>;
  };
  strengthDiarySession: {
    findFirst: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  strengthSessionExercise: {
    findFirst: ReturnType<typeof vi.fn>;
  };
  strengthSet: {
    findFirst: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  workout: {
    findMany: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
  };
  $transaction: ReturnType<typeof vi.fn>;
};

function decimal(value: number | null) {
  return value === null ? null : new Prisma.Decimal(value);
}

function buildDb(): MockDb {
  const db: MockDb = {
    exerciseCatalog: { findMany: vi.fn() },
    trainingProgram: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    trainingProgramVersion: { create: vi.fn() },
    strengthDiarySession: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    strengthSessionExercise: { findFirst: vi.fn() },
    strengthSet: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    workout: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(),
  };
  db.$transaction.mockImplementation(async (callback: (tx: MockDb) => unknown) => callback(db));
  return db;
}

const catalogA = { id: 1, name: "Жим гантелей сидячи", isActive: true, muscleMapping: null };
const catalogB = { id: 2, name: "Гіперекстензія", isActive: true, muscleMapping: null };
const catalogC = { id: 3, name: "Віджимання від ручок", isActive: true, muscleMapping: null };

function programRecord(versionNumber: number, exercises: Array<{
  catalogId: number;
  name: string;
  plannedSets: number;
  resistanceType: string;
  sortOrder: number;
}>) {
  return {
    id: 10,
    name: "Моє тренування",
    archivedAt: null,
    currentVersionId: 100 + versionNumber,
    createdAt: new Date("2026-09-01T10:00:00Z"),
    updatedAt: new Date("2026-09-01T10:00:00Z"),
    currentVersion: {
      id: 100 + versionNumber,
      versionNumber,
      exercises: exercises.map((exercise, index) => ({
        id: 1000 + index,
        exerciseCatalogId: exercise.catalogId,
        sortOrder: exercise.sortOrder,
        plannedSets: exercise.plannedSets,
        resistanceType: exercise.resistanceType,
        exerciseCatalog: { id: exercise.catalogId, name: exercise.name },
      })),
      _count: { exercises: exercises.length },
    },
  };
}

function sessionDetail(overrides: Record<string, unknown> = {}) {
  return {
    id: 50,
    status: SESSION_STATUS.ACTIVE,
    entryMode: ENTRY_MODE.LIVE,
    revision: 1,
    programId: 10,
    programVersionId: 101,
    webStartedAt: new Date("2026-09-17T16:02:00Z") as Date | null,
    webEndedAt: null as Date | null,
    matchStatus: MATCH_STATUS.PENDING,
    matchMethod: null as string | null,
    matchedAt: null as Date | null,
    matchedWorkoutId: null as number | null,
    createdAt: new Date("2026-09-17T16:02:00Z"),
    updatedAt: new Date("2026-09-17T16:02:00Z"),
    program: { id: 10, name: "Моє тренування" },
    programVersion: { id: 101, versionNumber: 1 },
    matchedWorkout: null,
    exercises: [
      {
        id: 501,
        sourceExerciseCatalogId: 1,
        snapshotExerciseName: "Жим гантелей сидячи",
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
        snapshotExerciseName: "Гіперекстензія",
        sortOrder: 1,
        plannedSets: 3,
        resistanceType: RESISTANCE.RESISTANCE_BAND,
        origin: EXERCISE_ORIGIN.PLANNED,
        muscleMappingSnapshot: null,
        sets: [],
      },
      {
        id: 503,
        sourceExerciseCatalogId: 3,
        snapshotExerciseName: "Віджимання від ручок",
        sortOrder: 2,
        plannedSets: 3,
        resistanceType: RESISTANCE.BODYWEIGHT,
        origin: EXERCISE_ORIGIN.PLANNED,
        muscleMappingSnapshot: null,
        sets: [],
      },
    ],
    ...overrides,
  };
}

describe("TrainingService programs", () => {
  let db: MockDb;
  let service: TrainingService;

  beforeEach(() => {
    db = buildDb();
    service = new TrainingService(db as never, new TrainingRepository(db as never));
  });

  it("creates a program with version 1, order, planned sets, and resistance types", async () => {
    db.exerciseCatalog.findMany.mockResolvedValue([catalogA, catalogB, catalogC]);
    db.trainingProgram.create.mockResolvedValue({ id: 10 });
    db.trainingProgramVersion.create.mockResolvedValue({ id: 101 });
    db.trainingProgram.update.mockResolvedValue({});
    db.trainingProgram.findFirst.mockResolvedValue(programRecord(1, [
      { catalogId: 1, name: catalogA.name, plannedSets: 3, resistanceType: RESISTANCE.EXTERNAL_WEIGHT, sortOrder: 0 },
      { catalogId: 2, name: catalogB.name, plannedSets: 4, resistanceType: RESISTANCE.RESISTANCE_BAND, sortOrder: 1 },
      { catalogId: 3, name: catalogC.name, plannedSets: 3, resistanceType: RESISTANCE.BODYWEIGHT, sortOrder: 2 },
    ]));

    const program = await service.createProgram({
      name: "Моє тренування",
      exercises: [
        { catalogId: 1, plannedSets: 3, resistanceType: RESISTANCE.EXTERNAL_WEIGHT },
        { catalogId: 2, plannedSets: 4, resistanceType: RESISTANCE.RESISTANCE_BAND },
        { catalogId: 3, plannedSets: 3, resistanceType: RESISTANCE.BODYWEIGHT },
      ],
    });

    expect(program.currentVersionNumber).toBe(1);
    expect(program.exercises.map((e) => e.order)).toEqual([0, 1, 2]);
    expect(program.exercises.map((e) => e.resistanceType)).toEqual([
      RESISTANCE.EXTERNAL_WEIGHT,
      RESISTANCE.RESISTANCE_BAND,
      RESISTANCE.BODYWEIGHT,
    ]);
    expect(db.trainingProgramVersion.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ versionNumber: 1 }),
    }));
  });

  it("edits by creating a new version and never mutates old version exercises", async () => {
    db.trainingProgram.findFirst
      .mockResolvedValueOnce(programRecord(1, [
        { catalogId: 1, name: catalogA.name, plannedSets: 3, resistanceType: RESISTANCE.EXTERNAL_WEIGHT, sortOrder: 0 },
        { catalogId: 2, name: catalogB.name, plannedSets: 3, resistanceType: RESISTANCE.RESISTANCE_BAND, sortOrder: 1 },
      ]))
      .mockResolvedValueOnce({
        id: 10,
        name: "Моє тренування",
        currentVersionId: 101,
        currentVersion: {
          versionNumber: 1,
          exercises: [
            {
              exerciseCatalogId: 1,
              sortOrder: 0,
              plannedSets: 3,
              resistanceType: RESISTANCE.EXTERNAL_WEIGHT,
            },
            {
              exerciseCatalogId: 2,
              sortOrder: 1,
              plannedSets: 3,
              resistanceType: RESISTANCE.RESISTANCE_BAND,
            },
          ],
        },
      })
      .mockResolvedValueOnce(programRecord(2, [
        { catalogId: 2, name: catalogB.name, plannedSets: 2, resistanceType: RESISTANCE.RESISTANCE_BAND, sortOrder: 0 },
        { catalogId: 1, name: catalogA.name, plannedSets: 4, resistanceType: RESISTANCE.EXTERNAL_WEIGHT, sortOrder: 1 },
      ]));
    db.exerciseCatalog.findMany.mockResolvedValue([catalogA, catalogB]);
    db.trainingProgramVersion.create.mockResolvedValue({ id: 102 });
    db.trainingProgram.update.mockResolvedValue({});

    const updated = await service.updateProgram(10, {
      exercises: [
        { catalogId: 2, plannedSets: 2, resistanceType: RESISTANCE.RESISTANCE_BAND, order: 0 },
        { catalogId: 1, plannedSets: 4, resistanceType: RESISTANCE.EXTERNAL_WEIGHT, order: 1 },
      ],
    });

    expect(updated.currentVersionNumber).toBe(2);
    expect(updated.exercises.map((e) => ({ catalogId: e.catalogId, plannedSets: e.plannedSets, order: e.order }))).toEqual([
      { catalogId: 2, plannedSets: 2, order: 0 },
      { catalogId: 1, plannedSets: 4, order: 1 },
    ]);
    expect(db.trainingProgramVersion.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ versionNumber: 2 }),
    }));
  });

  it("archives a program without hard delete", async () => {
    db.trainingProgram.findFirst
      .mockResolvedValueOnce({ id: 10, archivedAt: null })
      .mockResolvedValueOnce({
        ...programRecord(1, [
          { catalogId: 1, name: catalogA.name, plannedSets: 3, resistanceType: RESISTANCE.EXTERNAL_WEIGHT, sortOrder: 0 },
        ]),
        archivedAt: new Date("2026-09-17T12:00:00Z"),
      });
    db.trainingProgram.update.mockResolvedValue({});

    const archived = await service.archiveProgram(10);
    expect(archived.archivedAt).toBe("2026-09-17T12:00:00.000Z");
    expect(db.trainingProgram.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ archivedAt: expect.any(Date) }),
    }));
  });
});

describe("TrainingService snapshot immutability", () => {
  it("keeps session snapshot after program version bump", async () => {
    const db = buildDb();
    const service = new TrainingService(db as never, new TrainingRepository(db as never));

    const snapshotted = sessionDetail({
      status: SESSION_STATUS.COMPLETED,
      webEndedAt: new Date("2026-09-17T17:18:00Z"),
      programVersionId: 101,
      programVersion: { id: 101, versionNumber: 1 },
      exercises: [
        {
          id: 501,
          sourceExerciseCatalogId: 1,
          snapshotExerciseName: "Жим гантелей сидячи",
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
          snapshotExerciseName: "Гіперекстензія",
          sortOrder: 1,
          plannedSets: 3,
          resistanceType: RESISTANCE.RESISTANCE_BAND,
          origin: EXERCISE_ORIGIN.PLANNED,
          muscleMappingSnapshot: null,
          sets: [],
        },
      ],
    });

    db.strengthDiarySession.findFirst.mockResolvedValue(snapshotted);
    const session = await service.getSession(50);
    expect(session?.programVersionNumber).toBe(1);
    expect(session?.exercises.map((e) => e.plannedSets)).toEqual([3, 3]);
    expect(session?.exercises.map((e) => e.snapshotExerciseName)).toEqual([
      "Жим гантелей сидячи",
      "Гіперекстензія",
    ]);
  });
});

describe("TrainingService live session", () => {
  let db: MockDb;
  let service: TrainingService;

  beforeEach(() => {
    db = buildDb();
    service = new TrainingService(db as never, new TrainingRepository(db as never));
  });

  it("enforces one ACTIVE session", async () => {
    db.strengthDiarySession.findFirst.mockResolvedValue(sessionDetail());
    await expect(service.startSession(10)).rejects.toBeInstanceOf(ActiveSessionExistsError);
  });

  it("starts a session by snapshotting current program exercises", async () => {
    db.strengthDiarySession.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(sessionDetail());
    db.trainingProgram.findFirst.mockResolvedValue({
      id: 10,
      name: "Моє тренування",
      archivedAt: null,
      currentVersionId: 101,
      currentVersion: {
        id: 101,
        versionNumber: 1,
        exercises: [
          {
            exerciseCatalogId: 1,
            sortOrder: 0,
            plannedSets: 3,
            resistanceType: RESISTANCE.EXTERNAL_WEIGHT,
            exerciseCatalog: catalogA,
          },
          {
            exerciseCatalogId: 2,
            sortOrder: 1,
            plannedSets: 3,
            resistanceType: RESISTANCE.RESISTANCE_BAND,
            exerciseCatalog: catalogB,
          },
          {
            exerciseCatalogId: 3,
            sortOrder: 2,
            plannedSets: 3,
            resistanceType: RESISTANCE.BODYWEIGHT,
            exerciseCatalog: catalogC,
          },
        ],
      },
    });
    db.strengthDiarySession.create.mockResolvedValue({ id: 50 });

    const session = await service.startSession(10);
    expect(session.status).toBe(SESSION_STATUS.ACTIVE);
    expect(session.exercises).toHaveLength(3);
    expect(db.strengthDiarySession.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: SESSION_STATUS.ACTIVE,
        exercises: expect.objectContaining({
          create: expect.arrayContaining([
            expect.objectContaining({
              snapshotExerciseName: catalogA.name,
              plannedSets: 3,
              resistanceType: RESISTANCE.EXTERNAL_WEIGHT,
            }),
          ]),
        }),
      }),
    }));
  });

  it("supports set CRUD on active session exercises", async () => {
    db.strengthSessionExercise.findFirst.mockResolvedValue({
      id: 501,
      sessionId: 50,
      resistanceType: RESISTANCE.EXTERNAL_WEIGHT,
      session: { id: 50, status: SESSION_STATUS.ACTIVE },
      sets: [],
    });
    db.strengthSet.create.mockResolvedValue({
      id: 900,
      sessionExerciseId: 501,
      setNumber: 1,
      reps: 12,
      weightKg: decimal(30),
      bandNominalResistanceKg: null,
      completedAt: new Date("2026-09-17T16:10:00Z"),
      createdAt: new Date("2026-09-17T16:10:00Z"),
      updatedAt: new Date("2026-09-17T16:10:00Z"),
    });

    const created = await service.createSet(50, 501, { reps: 12, weightKg: 30 });
    expect(created.weightKg).toBe(30);
    expect(created.bandNominalResistanceKg).toBeNull();

    db.strengthSet.findFirst.mockResolvedValue({
      id: 900,
      reps: 12,
      weightKg: decimal(30),
      bandNominalResistanceKg: null,
      completedAt: new Date("2026-09-17T16:10:00Z"),
      sessionExercise: {
        id: 501,
        resistanceType: RESISTANCE.EXTERNAL_WEIGHT,
        session: { id: 50, status: SESSION_STATUS.ACTIVE },
      },
    });
    db.strengthSet.update.mockResolvedValue({
      id: 900,
      sessionExerciseId: 501,
      setNumber: 1,
      reps: 10,
      weightKg: decimal(32.5),
      bandNominalResistanceKg: null,
      completedAt: new Date("2026-09-17T16:10:00Z"),
      createdAt: new Date("2026-09-17T16:10:00Z"),
      updatedAt: new Date("2026-09-17T16:12:00Z"),
    });

    const updated = await service.updateSet(50, 900, { reps: 10, weightKg: 32.5 });
    expect(updated.reps).toBe(10);
    expect(updated.weightKg).toBe(32.5);

    db.strengthSet.findFirst.mockResolvedValue({
      id: 900,
      reps: 10,
      weightKg: decimal(32.5),
      bandNominalResistanceKg: null,
      completedAt: new Date("2026-09-17T16:10:00Z"),
      sessionExercise: {
        id: 501,
        resistanceType: RESISTANCE.EXTERNAL_WEIGHT,
        session: { id: 50, status: SESSION_STATUS.ACTIVE },
      },
    });
    db.strengthSet.delete.mockResolvedValue({});
    await service.deleteSet(50, 900);
    expect(db.strengthSet.delete).toHaveBeenCalledWith({ where: { id: 900 } });
  });

  it("finish is idempotent and keeps PENDING when no candidate", async () => {
    const completed = sessionDetail({
      status: SESSION_STATUS.COMPLETED,
      webEndedAt: new Date("2026-09-17T17:18:00Z"),
      matchStatus: MATCH_STATUS.PENDING,
    });
    db.strengthDiarySession.findFirst.mockResolvedValue(completed);
    db.workout.findMany.mockResolvedValue([]);

    const first = await service.finishSession(50);
    const second = await service.finishSession(50);
    expect(first.status).toBe(SESSION_STATUS.COMPLETED);
    expect(first.matchStatus).toBe(MATCH_STATUS.PENDING);
    expect(second.matchStatus).toBe(MATCH_STATUS.PENDING);
    expect(db.strengthDiarySession.update).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: SESSION_STATUS.COMPLETED }),
    }));
  });
});

describe("TrainingService matching cases", () => {
  let db: MockDb;
  let service: TrainingService;

  beforeEach(() => {
    db = buildDb();
    service = new TrainingService(db as never, new TrainingRepository(db as never));
  });

  function completedPending() {
    return sessionDetail({
      status: SESSION_STATUS.COMPLETED,
      webEndedAt: new Date("2026-09-17T17:18:00Z"),
      matchStatus: MATCH_STATUS.PENDING,
      matchMethod: null,
      matchedWorkoutId: null,
      matchedWorkout: null,
    });
  }

  it("case 1/3: finish with unique strong Garmin strength → MATCHED AUTO", async () => {
    const active = sessionDetail();
    const matched = sessionDetail({
      status: SESSION_STATUS.COMPLETED,
      webEndedAt: new Date("2026-09-17T17:18:00Z"),
      matchStatus: MATCH_STATUS.MATCHED,
      matchMethod: MATCH_METHOD.AUTO,
      matchedWorkoutId: 77,
      matchedAt: new Date("2026-09-17T18:00:00Z"),
      matchedWorkout: {
        id: 77,
        type: "Traditional Strength Training",
        startAt: new Date("2026-09-17T16:04:00Z"),
        endAt: new Date("2026-09-17T17:17:00Z"),
        durationMinutes: 73,
        activeEnergyKcal: 410,
        externalId: "g-1",
      },
    });

    db.strengthDiarySession.findFirst
      .mockResolvedValueOnce(active)
      .mockResolvedValueOnce(sessionDetail({
        status: SESSION_STATUS.COMPLETED,
        webEndedAt: new Date("2026-09-17T17:18:00Z"),
      }))
      .mockResolvedValueOnce(matched);
    db.workout.findMany.mockResolvedValue([{
      id: 77,
      type: "Traditional Strength Training",
      startAt: new Date("2026-09-17T16:04:00Z"),
      endAt: new Date("2026-09-17T17:17:00Z"),
      durationMinutes: 73,
      activeEnergyKcal: 410,
      externalId: "g-1",
      matchedDiarySession: null,
    }]);
    db.strengthDiarySession.update.mockResolvedValue({});

    const result = await service.finishSession(50);
    expect(result.matchStatus).toBe(MATCH_STATUS.MATCHED);
    expect(result.matchMethod).toBe(MATCH_METHOD.AUTO);
    expect(result.matchedWorkoutId).toBe(77);
  });

  it("case 2: delayed sync matches PENDING completed session", async () => {
    db.strengthDiarySession.findMany.mockResolvedValue([{
      id: 50,
      webStartedAt: new Date("2026-09-17T16:02:00Z"),
      webEndedAt: new Date("2026-09-17T17:18:00Z"),
      matchMethod: null,
      matchedWorkoutId: null,
    }]);
    db.strengthDiarySession.findFirst
      .mockResolvedValueOnce(completedPending())
      .mockResolvedValueOnce(sessionDetail({
        status: SESSION_STATUS.COMPLETED,
        webEndedAt: new Date("2026-09-17T17:18:00Z"),
        matchStatus: MATCH_STATUS.MATCHED,
        matchMethod: MATCH_METHOD.AUTO,
        matchedWorkoutId: 77,
        matchedWorkout: {
          id: 77,
          type: "Traditional Strength Training",
          startAt: new Date("2026-09-17T16:04:00Z"),
          endAt: new Date("2026-09-17T17:17:00Z"),
          durationMinutes: 73,
          activeEnergyKcal: 410,
          externalId: "g-1",
        },
      }));
    db.workout.findMany.mockResolvedValue([{
      id: 77,
      type: "Traditional Strength Training",
      startAt: new Date("2026-09-17T16:04:00Z"),
      endAt: new Date("2026-09-17T17:17:00Z"),
      durationMinutes: 73,
      activeEnergyKcal: 410,
      externalId: "g-1",
      matchedDiarySession: null,
    }]);
    db.strengthDiarySession.update.mockResolvedValue({});

    await service.afterHealthSyncMatch("2026-09-17", { timezone: "UTC" });
    expect(db.strengthDiarySession.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        matchStatus: MATCH_STATUS.MATCHED,
        matchMethod: MATCH_METHOD.AUTO,
        matchedWorkoutId: 77,
      }),
    }));
  });

  it("case 5: stepper is excluded from auto-match candidates", async () => {
    db.strengthDiarySession.findFirst.mockResolvedValue(completedPending());
    db.workout.findMany.mockResolvedValue([{
      id: 88,
      type: "Stair Climbing",
      startAt: new Date("2026-09-17T16:02:00Z"),
      endAt: new Date("2026-09-17T17:18:00Z"),
      durationMinutes: 76,
      activeEnergyKcal: 200,
      externalId: "stair-1",
      matchedDiarySession: null,
    }]);
    db.strengthDiarySession.update.mockResolvedValue({});

    await service.finishSession(50);
    expect(db.strengthDiarySession.update).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ matchStatus: MATCH_STATUS.MATCHED }),
    }));
  });

  it("case 6: MANUAL match is sticky and skipped by later AUTO sync", async () => {
    db.strengthDiarySession.findMany.mockResolvedValue([{
      id: 50,
      webStartedAt: new Date("2026-09-17T16:02:00Z"),
      webEndedAt: new Date("2026-09-17T17:18:00Z"),
      matchMethod: MATCH_METHOD.MANUAL,
      matchedWorkoutId: 77,
    }]);
    // afterHealthSyncMatch filters matchMethod !== MANUAL in query; still guard in tryAutoMatch
    db.strengthDiarySession.findFirst.mockResolvedValue(sessionDetail({
      status: SESSION_STATUS.COMPLETED,
      webEndedAt: new Date("2026-09-17T17:18:00Z"),
      matchStatus: MATCH_STATUS.MATCHED,
      matchMethod: MATCH_METHOD.MANUAL,
      matchedWorkoutId: 77,
    }));
    db.workout.findMany.mockResolvedValue([{
      id: 99,
      type: "Traditional Strength Training",
      startAt: new Date("2026-09-17T16:04:00Z"),
      endAt: new Date("2026-09-17T17:17:00Z"),
      durationMinutes: 73,
      activeEnergyKcal: 500,
      externalId: "other",
      matchedDiarySession: null,
    }]);

    await service.afterHealthSyncMatch("2026-09-17", { timezone: "UTC" });
    // Query already excludes MANUAL; no auto overwrite update for MATCHED MANUAL.
    expect(db.strengthDiarySession.update).not.toHaveBeenCalled();
  });

  it("case 7: same Garmin workout cannot link to two diary sessions", async () => {
    db.strengthDiarySession.findFirst.mockResolvedValue(sessionDetail({
      status: SESSION_STATUS.COMPLETED,
      webEndedAt: new Date("2026-09-17T17:18:00Z"),
      matchStatus: MATCH_STATUS.AMBIGUOUS,
    }));
    db.workout.findUnique.mockResolvedValue({
      id: 77,
      type: "Traditional Strength Training",
      startAt: new Date("2026-09-17T16:04:00Z"),
      endAt: new Date("2026-09-17T17:17:00Z"),
      matchedDiarySession: { id: 51 },
    });

    await expect(service.manualMatch(50, { workoutId: 77 })).rejects.toBeInstanceOf(
      WorkoutAlreadyMatchedError,
    );
  });

  it("case 8: repeated match apply stays 1:1 (idempotent MATCHED)", async () => {
    const matched = sessionDetail({
      status: SESSION_STATUS.COMPLETED,
      webEndedAt: new Date("2026-09-17T17:18:00Z"),
      matchStatus: MATCH_STATUS.MATCHED,
      matchMethod: MATCH_METHOD.AUTO,
      matchedWorkoutId: 77,
      matchedWorkout: {
        id: 77,
        type: "Traditional Strength Training",
        startAt: new Date("2026-09-17T16:04:00Z"),
        endAt: new Date("2026-09-17T17:17:00Z"),
        durationMinutes: 73,
        activeEnergyKcal: 410,
        externalId: "g-1",
      },
    });
    db.strengthDiarySession.findFirst.mockResolvedValue(matched);
    db.workout.findMany.mockResolvedValue([{
      id: 77,
      type: "Traditional Strength Training",
      startAt: new Date("2026-09-17T16:04:00Z"),
      endAt: new Date("2026-09-17T17:17:00Z"),
      durationMinutes: 73,
      activeEnergyKcal: 410,
      externalId: "g-1",
      matchedDiarySession: { id: 50 },
    }]);

    const again = await service.finishSession(50);
    expect(again.matchedWorkoutId).toBe(77);
    expect(db.strengthDiarySession.update).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ matchedWorkoutId: 77 }),
    }));
  });

  it("case 9: finish without candidate stays PENDING not UNMATCHED", async () => {
    const active = sessionDetail();
    const pending = sessionDetail({
      status: SESSION_STATUS.COMPLETED,
      webEndedAt: new Date("2026-09-17T17:18:00Z"),
      matchStatus: MATCH_STATUS.PENDING,
    });
    db.strengthDiarySession.findFirst
      .mockResolvedValueOnce(active)
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce(pending);
    db.workout.findMany.mockResolvedValue([]);
    db.strengthDiarySession.update.mockResolvedValue({});

    const result = await service.finishSession(50);
    expect(result.matchStatus).toBe(MATCH_STATUS.PENDING);
    expect(result.matchMethod).toBeNull();
  });

  it("source separation: diary DTO keeps snapshot/sets separate from matched workout fields", async () => {
    db.strengthDiarySession.findFirst.mockResolvedValue(sessionDetail({
      status: SESSION_STATUS.COMPLETED,
      webEndedAt: new Date("2026-09-17T17:18:00Z"),
      matchStatus: MATCH_STATUS.MATCHED,
      matchMethod: MATCH_METHOD.AUTO,
      matchedWorkoutId: 77,
      matchedWorkout: {
        id: 77,
        type: "Traditional Strength Training",
        startAt: new Date("2026-09-17T16:04:00Z"),
        endAt: new Date("2026-09-17T17:17:00Z"),
        durationMinutes: 73,
        activeEnergyKcal: 410,
        externalId: "g-1",
      },
      exercises: [
        {
          id: 501,
          sourceExerciseCatalogId: 1,
          snapshotExerciseName: "Жим гантелей сидячи",
          sortOrder: 0,
          plannedSets: 3,
          resistanceType: RESISTANCE.EXTERNAL_WEIGHT,
          origin: EXERCISE_ORIGIN.PLANNED,
          muscleMappingSnapshot: null,
          sets: [{
            id: 900,
            sessionExerciseId: 501,
            setNumber: 1,
            reps: 12,
            weightKg: decimal(30),
            bandNominalResistanceKg: null,
            completedAt: new Date("2026-09-17T16:10:00Z"),
            createdAt: new Date("2026-09-17T16:10:00Z"),
            updatedAt: new Date("2026-09-17T16:10:00Z"),
          }],
        },
      ],
    }));

    const session = await service.getSession(50);
    expect(session?.webStartedAt).toBe("2026-09-17T16:02:00.000Z");
    expect(session?.exercises[0]?.sets[0]?.weightKg).toBe(30);
    expect(session?.matchedWorkout?.activeEnergyKcal).toBe(410);
    expect(session?.matchedWorkout?.startAt).toBe("2026-09-17T16:04:00.000Z");
    expect(session?.ordinaryTonnageKg).toBe(360);
  });
});
