import { beforeEach, describe, expect, it, vi } from "vitest";

const trainingService = vi.hoisted(() => ({
  getActiveSession: vi.fn(),
  listRecentSessions: vi.fn(),
  getSession: vi.fn(),
  startSession: vi.fn(),
  createSet: vi.fn(),
  updateSet: vi.fn(),
  deleteSet: vi.fn(),
  finishSession: vi.fn(),
  cancelSession: vi.fn(),
}));

vi.mock("@/modules/training/training.service", () => ({ trainingService }));

import { POST as CREATE_SET } from "@/app/api/v1/training/sessions/[id]/exercises/[exerciseId]/sets/route";
import { POST as CANCEL } from "@/app/api/v1/training/sessions/[id]/cancel/route";
import { POST as FINISH } from "@/app/api/v1/training/sessions/[id]/finish/route";
import { GET as DETAIL } from "@/app/api/v1/training/sessions/[id]/route";
import { DELETE as DELETE_SET, PATCH as PATCH_SET } from "@/app/api/v1/training/sessions/[id]/sets/[setId]/route";
import { GET as ACTIVE } from "@/app/api/v1/training/sessions/active/route";
import { GET as RECENT } from "@/app/api/v1/training/sessions/recent/route";
import { POST as START } from "@/app/api/v1/training/sessions/start/route";
import {
  ActiveSessionExistsError,
  ProgramArchivedError,
  ProgramNotFoundError,
  SessionExerciseNotFoundError,
  SessionNotFoundError,
  SetNotFoundError,
  SetValidationError,
} from "@/modules/training/training.errors";
import { MATCH_STATUS, SESSION_STATUS } from "@/modules/training/training.constants";

const base = "http://localhost/api/v1/training/sessions";
const session = {
  id: 42,
  status: SESSION_STATUS.ACTIVE,
  programId: 7,
  programName: "Моє тренування",
  programVersionId: 11,
  programVersionNumber: 1,
  webStartedAt: "2026-09-17T16:00:00.000Z",
  webEndedAt: null,
  matchStatus: MATCH_STATUS.PENDING,
  matchMethod: null,
  matchedAt: null,
  matchedWorkoutId: null,
  matchedWorkout: null,
  exercises: [],
  ordinaryTonnageKg: null,
  createdAt: "2026-09-17T16:00:00.000Z",
  updatedAt: "2026-09-17T16:00:00.000Z",
};
const setDto = {
  id: 9,
  sessionExerciseId: 5,
  setNumber: 1,
  reps: 10,
  weightKg: 30,
  bandNominalResistanceKg: null,
  completedAt: "2026-09-17T16:10:00.000Z",
  createdAt: "2026-09-17T16:10:00.000Z",
  updatedAt: "2026-09-17T16:10:00.000Z",
};

function jsonRequest(url: string, method: string, body: unknown): Request {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const sessionCtx = (id: string) => ({ params: Promise.resolve({ id }) });
const exerciseCtx = (id: string, exerciseId: string) => ({
  params: Promise.resolve({ id, exerciseId }),
});
const setCtx = (id: string, setId: string) => ({
  params: Promise.resolve({ id, setId }),
});

describe("/api/v1/training/sessions", () => {
  beforeEach(() => {
    Object.values(trainingService).forEach((mock) => mock.mockReset());
  });

  it("returns the active session payload", async () => {
    trainingService.getActiveSession.mockResolvedValue(session);
    const response = await ACTIVE();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ session });
  });

  it("lists recent sessions with optional limit", async () => {
    trainingService.listRecentSessions.mockResolvedValue([session]);
    const response = await RECENT(new Request(`${base}/recent?limit=5`));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ sessions: [session] });
    expect(trainingService.listRecentSessions).toHaveBeenCalledWith({ limit: 5 });
  });

  it("rejects invalid recent limit without service call", async () => {
    const response = await RECENT(new Request(`${base}/recent?limit=0`));
    expect(response.status).toBe(400);
    expect(trainingService.listRecentSessions).not.toHaveBeenCalled();
  });

  it("returns session detail", async () => {
    trainingService.getSession.mockResolvedValue(session);
    const response = await DETAIL(new Request(`${base}/42`), sessionCtx("42"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ session });
    expect(trainingService.getSession).toHaveBeenCalledWith(42);
  });

  it("returns 404 for missing session detail", async () => {
    trainingService.getSession.mockResolvedValue(null);
    const response = await DETAIL(new Request(`${base}/42`), sessionCtx("42"));
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "not_found" });
  });

  it("starts a session", async () => {
    trainingService.startSession.mockResolvedValue(session);
    const response = await START(jsonRequest(`${base}/start`, "POST", { programId: 7 }));
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ session });
    expect(trainingService.startSession).toHaveBeenCalledWith(7);
  });

  it("rejects invalid start body without mutation", async () => {
    const response = await START(jsonRequest(`${base}/start`, "POST", { programId: "x" }));
    expect(response.status).toBe(400);
    expect(trainingService.startSession).not.toHaveBeenCalled();
  });

  it("maps second-active conflict to 409 with activeSessionId", async () => {
    trainingService.startSession.mockRejectedValue(new ActiveSessionExistsError(42));
    const response = await START(jsonRequest(`${base}/start`, "POST", { programId: 7 }));
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "active_session_exists",
      activeSessionId: 42,
    });
  });

  it.each([
    { error: new ProgramNotFoundError(), code: "program_not_found" },
    { error: new ProgramArchivedError(), code: "program_archived" },
  ])("maps $code on start to 404", async ({ error, code }) => {
    trainingService.startSession.mockRejectedValue(error);
    const response = await START(jsonRequest(`${base}/start`, "POST", { programId: 7 }));
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: code });
  });

  it("creates a set", async () => {
    trainingService.createSet.mockResolvedValue(setDto);
    const response = await CREATE_SET(
      jsonRequest(`${base}/42/exercises/5/sets`, "POST", { reps: 10, weightKg: 30 }),
      exerciseCtx("42", "5"),
    );
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ set: setDto });
    expect(trainingService.createSet).toHaveBeenCalledWith(42, 5, {
      reps: 10,
      weightKg: 30,
    });
  });

  it("rejects invalid create-set payload without mutation", async () => {
    const response = await CREATE_SET(
      jsonRequest(`${base}/42/exercises/5/sets`, "POST", { reps: 0, weightKg: 30 }),
      exerciseCtx("42", "5"),
    );
    expect(response.status).toBe(400);
    expect(trainingService.createSet).not.toHaveBeenCalled();
  });

  it("maps set validation failure to 400 with message", async () => {
    trainingService.createSet.mockRejectedValue(
      new SetValidationError("bandNominalResistanceKg is required for RESISTANCE_BAND"),
    );
    const response = await CREATE_SET(
      jsonRequest(`${base}/42/exercises/5/sets`, "POST", {
        reps: 10,
        bandNominalResistanceKg: 108,
      }),
      exerciseCtx("42", "5"),
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "set_validation_error",
      message: "bandNominalResistanceKg is required for RESISTANCE_BAND",
    });
  });

  it("maps missing session exercise to 404", async () => {
    trainingService.createSet.mockRejectedValue(new SessionExerciseNotFoundError());
    const response = await CREATE_SET(
      jsonRequest(`${base}/42/exercises/5/sets`, "POST", { reps: 10, weightKg: 30 }),
      exerciseCtx("42", "5"),
    );
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "session_exercise_not_found" });
  });

  it("patches a set", async () => {
    trainingService.updateSet.mockResolvedValue({ ...setDto, reps: 8 });
    const response = await PATCH_SET(
      jsonRequest(`${base}/42/sets/9`, "PATCH", { reps: 8 }),
      setCtx("42", "9"),
    );
    expect(response.status).toBe(200);
    expect(trainingService.updateSet).toHaveBeenCalledWith(42, 9, { reps: 8 });
  });

  it("rejects empty patch body without mutation", async () => {
    const response = await PATCH_SET(
      jsonRequest(`${base}/42/sets/9`, "PATCH", {}),
      setCtx("42", "9"),
    );
    expect(response.status).toBe(400);
    expect(trainingService.updateSet).not.toHaveBeenCalled();
  });

  it("deletes a set", async () => {
    trainingService.deleteSet.mockResolvedValue(undefined);
    const response = await DELETE_SET(
      new Request(`${base}/42/sets/9`, { method: "DELETE" }),
      setCtx("42", "9"),
    );
    expect(response.status).toBe(204);
    expect(trainingService.deleteSet).toHaveBeenCalledWith(42, 9);
  });

  it("maps missing set on delete to 404", async () => {
    trainingService.deleteSet.mockRejectedValue(new SetNotFoundError());
    const response = await DELETE_SET(
      new Request(`${base}/42/sets/9`, { method: "DELETE" }),
      setCtx("42", "9"),
    );
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "set_not_found" });
  });

  it("finishes a session", async () => {
    const completed = {
      ...session,
      status: SESSION_STATUS.COMPLETED,
      webEndedAt: "2026-09-17T17:00:00.000Z",
      matchStatus: MATCH_STATUS.PENDING,
    };
    trainingService.finishSession.mockResolvedValue(completed);
    const response = await FINISH(new Request(`${base}/42/finish`, { method: "POST" }), sessionCtx("42"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ session: completed });
    expect(trainingService.finishSession).toHaveBeenCalledWith(42);
  });

  it("repeated finish stays a successful contract call (idempotent service semantics)", async () => {
    const completed = {
      ...session,
      status: SESSION_STATUS.COMPLETED,
      webEndedAt: "2026-09-17T17:00:00.000Z",
      matchStatus: MATCH_STATUS.PENDING,
    };
    trainingService.finishSession.mockResolvedValue(completed);
    const first = await FINISH(new Request(`${base}/42/finish`, { method: "POST" }), sessionCtx("42"));
    const second = await FINISH(new Request(`${base}/42/finish`, { method: "POST" }), sessionCtx("42"));
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(trainingService.finishSession).toHaveBeenCalledTimes(2);
    await expect(second.json()).resolves.toEqual({ session: completed });
  });

  it("cancels a session", async () => {
    const cancelled = { ...session, status: SESSION_STATUS.CANCELLED };
    trainingService.cancelSession.mockResolvedValue(cancelled);
    const response = await CANCEL(new Request(`${base}/42/cancel`, { method: "POST" }), sessionCtx("42"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ session: cancelled });
    expect(trainingService.cancelSession).toHaveBeenCalledWith(42);
  });

  it("maps finish/cancel not-found to 404", async () => {
    trainingService.finishSession.mockRejectedValue(new SessionNotFoundError());
    trainingService.cancelSession.mockRejectedValue(new SessionNotFoundError());
    expect((await FINISH(new Request(`${base}/42/finish`, { method: "POST" }), sessionCtx("42"))).status)
      .toBe(404);
    expect((await CANCEL(new Request(`${base}/42/cancel`, { method: "POST" }), sessionCtx("42"))).status)
      .toBe(404);
  });
});
