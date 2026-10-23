import { beforeEach, describe, expect, it, vi } from "vitest";

const trainingService = vi.hoisted(() => ({
  getActiveSession: vi.fn(),
  listRecentSessions: vi.fn(),
  countRecentSessions: vi.fn(),
  getSession: vi.fn(),
  getSetForSession: vi.fn(),
  startSession: vi.fn(),
  startDynamicSession: vi.fn(),
  createSet: vi.fn(),
  getSetCreateOperation: vi.fn(),
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
import { DELETE as DELETE_SET, GET as GET_SET, PATCH as PATCH_SET } from "@/app/api/v1/training/sessions/[id]/sets/[setId]/route";
import { GET as ACTIVE } from "@/app/api/v1/training/sessions/active/route";
import { GET as RECENT } from "@/app/api/v1/training/sessions/recent/route";
import { POST as START } from "@/app/api/v1/training/sessions/start/route";
import { POST as START_DYNAMIC } from "@/app/api/v1/training/sessions/start-dynamic/route";
import { GET as GET_SET_CREATE_OPERATION } from "@/app/api/v1/training/set-create-operations/[operationId]/route";
import {
  ActiveSessionExistsError,
  ProgramArchivedError,
  ProgramNotFoundError,
  SessionExerciseNotFoundError,
  SessionNotFoundError,
  SetNotFoundError,
  SetValidationError,
  StaleStrengthEnergySourceError,
} from "@/modules/training/training.errors";
import { MATCH_STATUS, SESSION_STATUS } from "@/modules/training/training.constants";

const base = "http://localhost/api/v1/training/sessions";
const testOperationId = "00000000-0000-4000-8000-000000000096";
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
    headers: {
      "content-type": "application/json",
      ...(method === "POST" && url.endsWith("/sets") ? { "Idempotency-Key": testOperationId } : {}),
    },
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
  it("routes background energy reads through the read-only service contract", async () => {
    trainingService.getSession.mockResolvedValue(session);
    const result = await DETAIL(new Request(`${base}/42?readOnly=true`), sessionCtx("42"));
    expect(result.status).toBe(200);
    expect(trainingService.getSession).toHaveBeenCalledWith(42, 1, { readOnly: true });
  });
  beforeEach(() => {
    Object.values(trainingService).forEach((mock) => mock.mockReset());
  });

  it("maps a durably rejected set-create operation to a terminal 409", async () => {
    trainingService.getSetCreateOperation.mockResolvedValue({ state: "REJECTED" });
    const response = await GET_SET_CREATE_OPERATION(
      new Request(`http://localhost/api/v1/training/set-create-operations/${testOperationId}`),
      { params: Promise.resolve({ operationId: testOperationId }) },
    );
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      operationId: testOperationId,
      state: "REJECTED",
      error: "set_create_operation_rejected",
    });
    expect(trainingService.getSetCreateOperation).toHaveBeenCalledWith(testOperationId, undefined, undefined);
  });

  it("returns the active session payload", async () => {
    trainingService.getActiveSession.mockResolvedValue(session);
    const response = await ACTIVE();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ session });
  });

  it("lists recent sessions with optional limit", async () => {
    trainingService.listRecentSessions.mockResolvedValue([session]);
    trainingService.countRecentSessions.mockResolvedValue(17);
    const response = await RECENT(new Request(`${base}/recent?limit=5&offset=10`));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ sessions: [session], totalCount: 17 });
    expect(trainingService.listRecentSessions).toHaveBeenCalledWith({ limit: 5, offset: 10 });
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
    expect(trainingService.startSession).toHaveBeenCalledWith(7, undefined, undefined);
  });

  it("starts a dynamic live session without a program and preserves the supplied time zone", async () => {
    const dynamicSession = {
      ...session,
      programId: null,
      programName: null,
      programVersionId: null,
      programVersionNumber: null,
      exercises: [],
    };
    trainingService.startDynamicSession.mockResolvedValue(dynamicSession);
    const response = await START_DYNAMIC(jsonRequest(`${base}/start-dynamic`, "POST", { timeZone: "Europe/Bratislava" }));
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ session: dynamicSession });
    expect(trainingService.startDynamicSession).toHaveBeenCalledWith(undefined, "Europe/Bratislava");
  });

  it("rejects invalid dynamic-session time zones without mutation", async () => {
    const response = await START_DYNAMIC(jsonRequest(`${base}/start-dynamic`, "POST", { timeZone: "Not/AZone" }));
    expect(response.status).toBe(400);
    expect(trainingService.startDynamicSession).not.toHaveBeenCalled();
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
    await expect(response.json()).resolves.toEqual({ operationId: testOperationId, state: "COMMITTED", set: setDto });
    expect(trainingService.createSet).toHaveBeenCalledWith(42, 5, {
      reps: 10,
      weightKg: 30,
    }, undefined, testOperationId);
  });

  it("fails closed for legacy set-create requests without an idempotency key", async () => {
    const request = new Request(`${base}/42/exercises/5/sets`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reps: 10, weightKg: 30 }),
    });
    const response = await CREATE_SET(request, exerciseCtx("42", "5"));
    expect(response.status).toBe(428);
    await expect(response.json()).resolves.toEqual({ error: "idempotency_key_required" });
    expect(trainingService.createSet).not.toHaveBeenCalled();
  });

  it("passes BODYWEIGHT additional-load overrides through create, read, and update", async () => {
    const loadedSet = {
      ...setDto,
      weightKg: null,
      bandNominalResistanceKg: null,
      loadAccountingOverride: {
        additionalLoadKg: 15,
        reps: { kind: "asymmetric-per-side", left: 6, right: 4 },
        equipmentSetupId: "rings",
      },
    };
    trainingService.createSet.mockResolvedValue(loadedSet);
    const createResponse = await CREATE_SET(
      jsonRequest(`${base}/42/exercises/5/sets`, "POST", {
        reps: 10,
        weightKg: null,
        bandNominalResistanceKg: null,
        loadAccountingOverride: loadedSet.loadAccountingOverride,
      }),
      exerciseCtx("42", "5"),
    );
    expect(createResponse.status).toBe(201);
    await expect(createResponse.json()).resolves.toEqual({
      operationId: testOperationId,
      state: "COMMITTED",
      set: loadedSet,
    });
    expect(trainingService.createSet).toHaveBeenCalledWith(42, 5, {
      reps: 10,
      weightKg: null,
      bandNominalResistanceKg: null,
      loadAccountingOverride: loadedSet.loadAccountingOverride,
    }, undefined, testOperationId);

    trainingService.getSetForSession.mockResolvedValue(loadedSet);
    const readResponse = await GET_SET(new Request(`${base}/42/sets/9`), setCtx("42", "9"));
    expect(readResponse.status).toBe(200);
    await expect(readResponse.json()).resolves.toEqual({ set: loadedSet });

    const updatedOverride = {
      additionalLoadKg: 17.5,
      reps: { kind: "asymmetric-per-side", left: 6, right: 4 },
      equipmentSetupId: "rings",
    };
    trainingService.updateSet.mockResolvedValue({
      ...loadedSet,
      loadAccountingOverride: updatedOverride,
    });
    const updateResponse = await PATCH_SET(
      jsonRequest(`${base}/42/sets/9`, "PATCH", {
        reps: 10,
        loadAccountingOverride: updatedOverride,
      }),
      setCtx("42", "9"),
    );
    expect(updateResponse.status).toBe(200);
    await expect(updateResponse.json()).resolves.toEqual({
      set: { ...loadedSet, loadAccountingOverride: updatedOverride },
    });
    expect(trainingService.updateSet).toHaveBeenCalledWith(42, 9, {
      reps: 10,
      loadAccountingOverride: updatedOverride,
    });
  });

  it("accepts the maximum override and rejects out-of-range or overflowing POST/PATCH inputs", async () => {
    trainingService.createSet.mockResolvedValue(setDto);
    const acceptedCreate = await CREATE_SET(
      jsonRequest(`${base}/42/exercises/5/sets`, "POST", {
        reps: 10_000,
        weightKg: null,
        loadAccountingOverride: { additionalLoadKg: 2_000 },
      }),
      exerciseCtx("42", "5"),
    );
    expect(acceptedCreate.status).toBe(201);

    trainingService.updateSet.mockResolvedValue(setDto);
    const acceptedUpdate = await PATCH_SET(
      jsonRequest(`${base}/42/sets/9`, "PATCH", {
        loadAccountingOverride: { additionalLoadKg: 2_000 },
      }),
      setCtx("42", "9"),
    );
    expect(acceptedUpdate.status).toBe(200);

    for (const [method, payload] of [
      ["POST", { reps: 10, loadAccountingOverride: { additionalLoadKg: 2_000.01 } }],
      ["POST", { reps: 10, loadAccountingOverride: { additionalLoadKg: 1e308 } }],
      ["POST", { reps: 10, loadAccountingOverride: { assistanceLoadKg: 2_000.01 } }],
      ["PATCH", { loadAccountingOverride: { additionalLoadKg: -1 } }],
      ["PATCH", { loadAccountingOverride: { additionalLoadKg: 2_000.01 } }],
      ["PATCH", { loadAccountingOverride: { additionalLoadKg: 1e308 } }],
      ["PATCH", { loadAccountingOverride: { assistanceLoadKg: 2_000.01 } }],
    ] as const) {
      const response = method === "POST"
        ? await CREATE_SET(jsonRequest(`${base}/42/exercises/5/sets`, method, payload), exerciseCtx("42", "5"))
        : await PATCH_SET(jsonRequest(`${base}/42/sets/9`, method, payload), setCtx("42", "9"));
      expect(response.status).toBe(400);
    }

    const parsedInfinity = await CREATE_SET(
      new Request(`${base}/42/exercises/5/sets`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: '{"reps":10,"loadAccountingOverride":{"additionalLoadKg":1e400}}',
      }),
      exerciseCtx("42", "5"),
    );
    expect(parsedInfinity.status).toBe(400);
    expect(trainingService.createSet).toHaveBeenCalledTimes(1);
    expect(trainingService.updateSet).toHaveBeenCalledTimes(1);
  });

  it("keeps stored historical overrides readable without applying write bounds", async () => {
    const historical = { ...setDto, loadAccountingOverride: { additionalLoadKg: 1e308 } };
    trainingService.getSetForSession.mockResolvedValue(historical);
    const response = await GET_SET(new Request(`${base}/42/sets/9`), setCtx("42", "9"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ set: historical });
  });

  it("preserves a legacy raw override when PATCH omits it and GET returns the stored value", async () => {
    const rawOverride = {
      additionalLoadKg: 2_500,
      equipmentSetupId: "rings",
      inventoryCount: 2,
    };
    const historical = { ...setDto, rir: 2, comment: "before", loadAccountingOverride: rawOverride };
    trainingService.updateSet.mockResolvedValue({ ...historical, rir: 3, comment: "after" });

    const patchResponse = await PATCH_SET(
      jsonRequest(`${base}/42/sets/9`, "PATCH", { rir: 3, comment: "after" }),
      setCtx("42", "9"),
    );

    expect(patchResponse.status).toBe(200);
    expect(trainingService.updateSet).toHaveBeenCalledWith(42, 9, { rir: 3, comment: "after" });
    trainingService.getSetForSession.mockResolvedValue({ ...historical, rir: 3, comment: "after" });
    const getResponse = await GET_SET(new Request(`${base}/42/sets/9`), setCtx("42", "9"));
    expect(getResponse.status).toBe(200);
    await expect(getResponse.json()).resolves.toEqual({
      set: { ...historical, rir: 3, comment: "after" },
    });

    const zeroHistorical = {
      ...setDto,
      rir: 2,
      comment: "zero remains raw",
      loadAccountingOverride: { additionalLoadKg: 0 },
    };
    trainingService.updateSet.mockResolvedValue({ ...zeroHistorical, rir: 3 });
    const zeroPatchResponse = await PATCH_SET(
      jsonRequest(`${base}/42/sets/9`, "PATCH", { rir: 3 }),
      setCtx("42", "9"),
    );
    expect(zeroPatchResponse.status).toBe(200);
    expect(trainingService.updateSet).toHaveBeenLastCalledWith(42, 9, { rir: 3 });
    trainingService.getSetForSession.mockResolvedValue({ ...zeroHistorical, rir: 3 });
    const zeroGetResponse = await GET_SET(new Request(`${base}/42/sets/9`), setCtx("42", "9"));
    expect(zeroGetResponse.status).toBe(200);
    await expect(zeroGetResponse.json()).resolves.toEqual({
      set: {
        ...zeroHistorical,
        rir: 3,
        completedAt: setDto.completedAt,
        createdAt: setDto.createdAt,
        updatedAt: setDto.updatedAt,
      },
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
    await expect(response.json()).resolves.toEqual({ set: { ...setDto, reps: 8 } });
    expect(trainingService.updateSet).toHaveBeenCalledWith(42, 9, { reps: 8 });
  });

  it("reads a set for mutation reconciliation without using session detail", async () => {
    trainingService.getSetForSession.mockResolvedValue(setDto);
    const response = await GET_SET(new Request(`${base}/42/sets/9`), setCtx("42", "9"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ set: setDto });
    expect(trainingService.getSetForSession).toHaveBeenCalledWith(42, 9);
    expect(trainingService.getSession).not.toHaveBeenCalled();
  });

  it("returns the domain conflict without model-publication UI status", async () => {
    trainingService.updateSet.mockRejectedValue(new StaleStrengthEnergySourceError());
    const response = await PATCH_SET(
      jsonRequest(`${base}/42/sets/9`, "PATCH", { reps: 8 }),
      setCtx("42", "9"),
    );
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "strength_energy_source_stale" });
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
