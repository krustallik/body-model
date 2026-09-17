import { beforeEach, describe, expect, it, vi } from "vitest";

const trainingService = vi.hoisted(() => ({
  createSessionFromWorkout: vi.fn(),
  bulkCreateSessionsFromWorkouts: vi.fn(),
  listHistoricalStrengthWorkouts: vi.fn(),
  changeSessionProgram: vi.fn(),
  addSessionExercise: vi.fn(),
  updateSessionExercise: vi.fn(),
  deleteSessionExercise: vi.fn(),
  reorderSessionExercises: vi.fn(),
  listProgramVersions: vi.fn(),
  deleteDiarySession: vi.fn(),
}));

vi.mock("@/modules/training/training.service", () => ({ trainingService }));

import * as FromWorkoutRoute from "@/app/api/v1/training/sessions/from-workout/route";
import * as FromWorkoutsRoute from "@/app/api/v1/training/sessions/from-workouts/route";
import * as HistoricalWorkoutsRoute from "@/app/api/v1/training/workouts/historical/route";
import * as ChangeProgramRoute from "@/app/api/v1/training/sessions/[id]/program/route";
import * as SessionExercisesRoute from "@/app/api/v1/training/sessions/[id]/exercises/route";
import * as SessionExerciseRoute from "@/app/api/v1/training/sessions/[id]/exercises/[exerciseId]/route";
import * as SessionRoute from "@/app/api/v1/training/sessions/[id]/route";
import * as ProgramVersionsRoute from "@/app/api/v1/training/programs/[id]/versions/route";
import {
  ENTRY_MODE,
  EXERCISE_ORIGIN,
  MATCH_METHOD,
  MATCH_STATUS,
  RESISTANCE,
  SESSION_STATUS,
} from "@/modules/training/training.constants";
import {
  ProgramNotFoundError,
  ProgramVersionNotFoundError,
  SessionNotEditableError,
  SessionNotFoundError,
  WorkoutNotEligibleError,
  WorkoutNotFoundError,
} from "@/modules/training/training.errors";

const session = {
  id: 88,
  status: SESSION_STATUS.COMPLETED,
  entryMode: ENTRY_MODE.RETROSPECTIVE,
  revision: 1,
  programId: 7,
  programName: "Моє тренування",
  programVersionId: 11,
  programVersionNumber: 1,
  webStartedAt: null,
  webEndedAt: null,
  matchStatus: MATCH_STATUS.MATCHED,
  matchMethod: MATCH_METHOD.DIRECT_BACKFILL,
  matchedAt: "2026-09-17T18:00:00.000Z",
  matchedWorkoutId: 501,
  matchedWorkout: {
    id: 501,
    type: "Traditional Strength Training",
    startAt: "2026-09-10T16:00:00.000Z",
    endAt: "2026-09-10T17:10:00.000Z",
    durationMinutes: 70,
    activeEnergyKcal: 220,
    externalId: "ext:old",
  },
  exercises: [{
    id: 1,
    sourceExerciseCatalogId: 3,
    snapshotExerciseName: "Жим",
    order: 0,
    plannedSets: 3,
    resistanceType: RESISTANCE.EXTERNAL_WEIGHT,
    origin: EXERCISE_ORIGIN.PLANNED,
    muscleMappingSnapshot: null,
    sets: [],
  }],
  ordinaryTonnageKg: null,
  createdAt: "2026-09-17T18:00:00.000Z",
  updatedAt: "2026-09-17T18:00:00.000Z",
};

function jsonRequest(url: string, method: string, body?: unknown): Request {
  return new Request(url, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const idCtx = (id: string) => ({ params: Promise.resolve({ id }) });
const exerciseCtx = (id: string, exerciseId: string) => ({
  params: Promise.resolve({ id, exerciseId }),
});

describe("Training retrospective API contracts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("POST /sessions/from-workout", () => {
    it("creates a retrospective session", async () => {
      trainingService.createSessionFromWorkout.mockResolvedValue(session);
      const response = await FromWorkoutRoute.POST(jsonRequest(
        "http://localhost/api/v1/training/sessions/from-workout",
        "POST",
        { workoutId: 501, programId: 7 },
      ));
      expect(response.status).toBe(201);
      expect(trainingService.createSessionFromWorkout).toHaveBeenCalledWith({
        workoutId: 501,
        programId: 7,
      });
      const body = await response.json();
      expect(body.session.entryMode).toBe(ENTRY_MODE.RETROSPECTIVE);
      expect(body.session.matchedWorkoutId).toBe(501);
    });

    it("rejects invalid body without mutation", async () => {
      const response = await FromWorkoutRoute.POST(jsonRequest(
        "http://localhost/api/v1/training/sessions/from-workout",
        "POST",
        { workoutId: 501 },
      ));
      expect(response.status).toBe(400);
      expect(trainingService.createSessionFromWorkout).not.toHaveBeenCalled();
    });

    it("maps workout not found to 404", async () => {
      trainingService.createSessionFromWorkout.mockRejectedValue(new WorkoutNotFoundError());
      const response = await FromWorkoutRoute.POST(jsonRequest(
        "http://localhost/api/v1/training/sessions/from-workout",
        "POST",
        { workoutId: 999, programId: 7 },
      ));
      expect(response.status).toBe(404);
    });

    it("maps non-strength workout to 400", async () => {
      trainingService.createSessionFromWorkout.mockRejectedValue(new WorkoutNotEligibleError());
      const response = await FromWorkoutRoute.POST(jsonRequest(
        "http://localhost/api/v1/training/sessions/from-workout",
        "POST",
        { workoutId: 12, programId: 7 },
      ));
      expect(response.status).toBe(400);
    });

    it("maps missing program version to 404", async () => {
      trainingService.createSessionFromWorkout.mockRejectedValue(new ProgramVersionNotFoundError());
      const response = await FromWorkoutRoute.POST(jsonRequest(
        "http://localhost/api/v1/training/sessions/from-workout",
        "POST",
        { workoutId: 501, programId: 7, programVersionId: 404 },
      ));
      expect(response.status).toBe(404);
    });
  });

  describe("GET /workouts/historical", () => {
    it("lists historical strength workouts", async () => {
      trainingService.listHistoricalStrengthWorkouts.mockResolvedValue([{
        workoutId: 501,
        type: "Traditional Strength Training",
        startAt: "2026-09-10T16:00:00.000Z",
        endAt: "2026-09-10T17:10:00.000Z",
        durationMinutes: 70,
        activeEnergyKcal: 220,
        linkedSessionId: null,
        linkedProgramName: null,
        diaryCompleteness: "NO_DIARY",
      }]);
      const response = await HistoricalWorkoutsRoute.GET(new Request(
        "http://localhost/api/v1/training/workouts/historical?limit=20",
      ));
      expect(response.status).toBe(200);
      expect(trainingService.listHistoricalStrengthWorkouts).toHaveBeenCalledWith({
        limit: 20,
        cursor: undefined,
        onlyMissingDiary: false,
      });
    });

    it("rejects invalid query without service call", async () => {
      const response = await HistoricalWorkoutsRoute.GET(new Request(
        "http://localhost/api/v1/training/workouts/historical?limit=0",
      ));
      expect(response.status).toBe(400);
      expect(trainingService.listHistoricalStrengthWorkouts).not.toHaveBeenCalled();
    });
  });

  describe("POST /sessions/:id/program", () => {
    it("changes program", async () => {
      trainingService.changeSessionProgram.mockResolvedValue({ ...session, revision: 2, programId: 9 });
      const response = await ChangeProgramRoute.POST(
        jsonRequest("http://localhost/api/v1/training/sessions/88/program", "POST", {
          programId: 9,
          programVersionId: 22,
        }),
        idCtx("88"),
      );
      expect(response.status).toBe(200);
      expect(trainingService.changeSessionProgram).toHaveBeenCalledWith(88, {
        programId: 9,
        programVersionId: 22,
      });
    });

    it("rejects invalid body without mutation", async () => {
      const response = await ChangeProgramRoute.POST(
        jsonRequest("http://localhost/api/v1/training/sessions/88/program", "POST", {}),
        idCtx("88"),
      );
      expect(response.status).toBe(400);
      expect(trainingService.changeSessionProgram).not.toHaveBeenCalled();
    });

    it("maps session not found to 404", async () => {
      trainingService.changeSessionProgram.mockRejectedValue(new SessionNotFoundError());
      const response = await ChangeProgramRoute.POST(
        jsonRequest("http://localhost/api/v1/training/sessions/88/program", "POST", { programId: 9 }),
        idCtx("88"),
      );
      expect(response.status).toBe(404);
    });
  });

  describe("session exercise edits", () => {
    it("adds an exercise", async () => {
      trainingService.addSessionExercise.mockResolvedValue(session);
      const response = await SessionExercisesRoute.POST(
        jsonRequest("http://localhost/api/v1/training/sessions/88/exercises", "POST", {
          catalogId: 4,
          plannedSets: 3,
          resistanceType: RESISTANCE.BODYWEIGHT,
        }),
        idCtx("88"),
      );
      expect(response.status).toBe(201);
      expect(trainingService.addSessionExercise).toHaveBeenCalled();
    });

    it("rejects invalid create payload without mutation", async () => {
      const response = await SessionExercisesRoute.POST(
        jsonRequest("http://localhost/api/v1/training/sessions/88/exercises", "POST", {
          catalogId: 4,
        }),
        idCtx("88"),
      );
      expect(response.status).toBe(400);
      expect(trainingService.addSessionExercise).not.toHaveBeenCalled();
    });

    it("patches an exercise", async () => {
      trainingService.updateSessionExercise.mockResolvedValue(session);
      const response = await SessionExerciseRoute.PATCH(
        jsonRequest("http://localhost/api/v1/training/sessions/88/exercises/1", "PATCH", {
          plannedSets: 4,
        }),
        exerciseCtx("88", "1"),
      );
      expect(response.status).toBe(200);
      expect(trainingService.updateSessionExercise).toHaveBeenCalledWith(88, 1, { plannedSets: 4 });
    });

    it("deletes an exercise with confirm", async () => {
      trainingService.deleteSessionExercise.mockResolvedValue(session);
      const response = await SessionExerciseRoute.DELETE(
        jsonRequest("http://localhost/api/v1/training/sessions/88/exercises/1", "DELETE", {
          confirm: true,
        }),
        exerciseCtx("88", "1"),
      );
      expect(response.status).toBe(200);
      expect(trainingService.deleteSessionExercise).toHaveBeenCalledWith(88, 1, { confirm: true });
    });

    it("reorders exercises", async () => {
      trainingService.reorderSessionExercises.mockResolvedValue(session);
      const response = await SessionExercisesRoute.PATCH(
        jsonRequest("http://localhost/api/v1/training/sessions/88/exercises", "PATCH", {
          exerciseIds: [2, 1],
        }),
        idCtx("88"),
      );
      expect(response.status).toBe(200);
    });
  });

  describe("bulk + versions", () => {
    it("bulk creates from workouts", async () => {
      trainingService.bulkCreateSessionsFromWorkouts.mockResolvedValue({
        sessions: [session],
        createdSessionIds: [88],
        existingSessionIds: [],
        rejected: [],
      });
      const response = await FromWorkoutsRoute.POST(jsonRequest(
        "http://localhost/api/v1/training/sessions/from-workouts",
        "POST",
        { workoutIds: [501, 502], programId: 7 },
      ));
      expect(response.status).toBe(201);
    });

    it("lists program versions", async () => {
      trainingService.listProgramVersions.mockResolvedValue([{
        id: 11,
        programId: 7,
        versionNumber: 1,
        exerciseCount: 3,
        createdAt: "2026-09-01T10:00:00.000Z",
      }]);
      const response = await ProgramVersionsRoute.GET(
        new Request("http://localhost/api/v1/training/programs/7/versions"),
        idCtx("7"),
      );
      expect(response.status).toBe(200);
      expect(trainingService.listProgramVersions).toHaveBeenCalledWith(7);
    });

    it("maps missing program on versions to 404", async () => {
      trainingService.listProgramVersions.mockRejectedValue(new ProgramNotFoundError());
      const response = await ProgramVersionsRoute.GET(
        new Request("http://localhost/api/v1/training/programs/999/versions"),
        idCtx("999"),
      );
      expect(response.status).toBe(404);
    });
  });

  describe("DELETE /sessions/:id", () => {
    it("deletes the diary and returns the linked workout id", async () => {
      trainingService.deleteDiarySession.mockResolvedValue({ matchedWorkoutId: 501 });
      const response = await SessionRoute.DELETE(
        new Request("http://localhost/api/v1/training/sessions/88", { method: "DELETE" }),
        idCtx("88"),
      );
      expect(response.status).toBe(200);
      expect(trainingService.deleteDiarySession).toHaveBeenCalledWith(88);
      await expect(response.json()).resolves.toEqual({ deleted: true, matchedWorkoutId: 501 });
    });

    it("maps missing session to 404", async () => {
      trainingService.deleteDiarySession.mockRejectedValue(new SessionNotFoundError());
      const response = await SessionRoute.DELETE(
        new Request("http://localhost/api/v1/training/sessions/999", { method: "DELETE" }),
        idCtx("999"),
      );
      expect(response.status).toBe(404);
    });

    it("refuses ACTIVE sessions with 400", async () => {
      trainingService.deleteDiarySession.mockRejectedValue(new SessionNotEditableError());
      const response = await SessionRoute.DELETE(
        new Request("http://localhost/api/v1/training/sessions/88", { method: "DELETE" }),
        idCtx("88"),
      );
      expect(response.status).toBe(400);
    });
  });
});
