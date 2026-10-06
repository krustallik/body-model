import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CatalogExerciseNotFoundError,
  SessionNotEditableError,
  SessionNotFoundError,
} from "@/modules/training/training.errors";

const routeMocks = vi.hoisted(() => ({
  trainingService: {
    updateCatalogLoadAccountingConfig: vi.fn(),
    updateSessionAccountingContext: vi.fn(),
    materializeSessionAccounting: vi.fn(),
    refreshSessionAccounting: vi.fn(),
    getExerciseHistory: vi.fn(),
  },
}));

vi.mock("@/modules/training/training.service", () => ({ trainingService: routeMocks.trainingService }));

import { PATCH as updateCatalogLoadAccounting } from "@/app/api/v1/training/exercises/[id]/load-accounting/route";
import { PUT as updateSessionAccountingContext } from "@/app/api/v1/training/sessions/[id]/accounting/context/route";
import { POST as materializeSessionAccounting } from "@/app/api/v1/training/sessions/[id]/accounting/materialize/route";
import { POST as refreshSessionAccounting } from "@/app/api/v1/training/sessions/[id]/accounting/refresh/route";
import { GET as getExerciseHistory } from "@/app/api/v1/training/sessions/[id]/exercises/[exerciseId]/history/route";

const sessionParams = (id: string) => ({ params: Promise.resolve({ id }) });
const exerciseParams = (id: string, exerciseId: string) => ({ params: Promise.resolve({ id, exerciseId }) });

function jsonRequest(method: string, body: unknown, url = "http://localhost/api/v1/training") {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const materializedSession = {
  id: 73,
  activeEnergyKcal: null,
  exercises: [{ id: 19, externalLoadVolumeKgReps: null, accountingQuality: "unavailable" }],
};

describe("training accounting and exercise history routes", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    routeMocks.trainingService.updateCatalogLoadAccountingConfig.mockResolvedValue(undefined);
    routeMocks.trainingService.updateSessionAccountingContext.mockResolvedValue(materializedSession);
    routeMocks.trainingService.materializeSessionAccounting.mockResolvedValue(materializedSession);
    routeMocks.trainingService.refreshSessionAccounting.mockResolvedValue(materializedSession);
    routeMocks.trainingService.getExerciseHistory.mockResolvedValue([]);
  });

  it("validates load-accounting resource IDs and config, then preserves explicit null config", async () => {
    const invalidId = await updateCatalogLoadAccounting(
      jsonRequest("PATCH", { loadAccountingConfig: null }),
      { params: Promise.resolve({ id: "0" }) },
    );
    expect(invalidId.status).toBe(400);
    await expect(invalidId.json()).resolves.toMatchObject({
      error: "validation_error",
      details: [expect.objectContaining({ path: ["id"], code: "too_small" })],
    });

    const invalidConfig = await updateCatalogLoadAccounting(
      jsonRequest("PATCH", { loadAccountingConfig: { accountingKind: "unknown" } }),
      { params: Promise.resolve({ id: "12" }) },
    );
    expect(invalidConfig.status).toBe(400);
    await expect(invalidConfig.json()).resolves.toMatchObject({ error: "validation_error" });
    expect(routeMocks.trainingService.updateCatalogLoadAccountingConfig).not.toHaveBeenCalled();

    const response = await updateCatalogLoadAccounting(
      jsonRequest("PATCH", { loadAccountingConfig: null }),
      { params: Promise.resolve({ id: "12" }) },
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(routeMocks.trainingService.updateCatalogLoadAccountingConfig)
      .toHaveBeenCalledExactlyOnceWith(12, { loadAccountingConfig: null });
  });

  it("maps a missing catalog exercise to its route error contract", async () => {
    routeMocks.trainingService.updateCatalogLoadAccountingConfig
      .mockRejectedValueOnce(new CatalogExerciseNotFoundError());

    const response = await updateCatalogLoadAccounting(
      jsonRequest("PATCH", { loadAccountingConfig: null }),
      { params: Promise.resolve({ id: "12" }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "catalog_not_found" });
  });

  it("requires accounting context input and returns the exact updated nullable session DTO", async () => {
    const invalid = await updateSessionAccountingContext(
      jsonRequest("PUT", {}, "http://localhost/api/v1/training/sessions/73/accounting/context"),
      sessionParams("73"),
    );
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toMatchObject({
      error: "validation_error",
      details: [expect.objectContaining({ code: "custom", message: "provide effectiveAccountingAt or timeZone" })],
    });
    expect(routeMocks.trainingService.updateSessionAccountingContext).not.toHaveBeenCalled();

    const input = {
      effectiveAccountingAt: "2026-10-06T08:30:00+02:00",
      timeZone: "Europe/Bratislava",
    };
    const response = await updateSessionAccountingContext(
      jsonRequest("PUT", input, "http://localhost/api/v1/training/sessions/73/accounting/context"),
      sessionParams("73"),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ session: materializedSession });
    expect(routeMocks.trainingService.updateSessionAccountingContext)
      .toHaveBeenCalledExactlyOnceWith(73, input);
  });

  it("maps a missing session from accounting-context updates to 404", async () => {
    routeMocks.trainingService.updateSessionAccountingContext
      .mockRejectedValueOnce(new SessionNotFoundError());

    const response = await updateSessionAccountingContext(
      jsonRequest("PUT", { timeZone: "Europe/Bratislava" }),
      sessionParams("73"),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "session_not_found" });
  });

  it("keeps the bodyless legacy materialize request and nullable values intact", async () => {
    const response = await materializeSessionAccounting(
      new Request("http://localhost/api/v1/training/sessions/73/accounting/materialize", { method: "POST" }),
      sessionParams("73"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ session: materializedSession });
    expect(routeMocks.trainingService.materializeSessionAccounting)
      .toHaveBeenCalledExactlyOnceWith(73, undefined, undefined);
  });

  it("validates materialize idempotency payloads and reports non-editable sessions", async () => {
    const invalid = await materializeSessionAccounting(
      jsonRequest("POST", { idempotencyKey: "request-73", activate: true }),
      sessionParams("73"),
    );
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toMatchObject({ error: "validation_error" });
    expect(routeMocks.trainingService.materializeSessionAccounting).not.toHaveBeenCalled();

    routeMocks.trainingService.materializeSessionAccounting
      .mockRejectedValueOnce(new SessionNotEditableError());
    const response = await materializeSessionAccounting(
      jsonRequest("POST", { idempotencyKey: "request-73" }),
      sessionParams("73"),
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "session_not_editable" });
    expect(routeMocks.trainingService.materializeSessionAccounting)
      .toHaveBeenCalledExactlyOnceWith(73, undefined, "request-73");
  });

  it("forwards refresh idempotency keys and maps a missing session", async () => {
    const success = await refreshSessionAccounting(
      jsonRequest("POST", { idempotencyKey: "refresh-73" }),
      sessionParams("73"),
    );
    expect(success.status).toBe(200);
    await expect(success.json()).resolves.toEqual({ session: materializedSession });
    expect(routeMocks.trainingService.refreshSessionAccounting)
      .toHaveBeenCalledExactlyOnceWith(73, undefined, "refresh-73");

    routeMocks.trainingService.refreshSessionAccounting.mockReset();
    routeMocks.trainingService.refreshSessionAccounting.mockRejectedValueOnce(new SessionNotFoundError());
    const missing = await refreshSessionAccounting(
      jsonRequest("POST", { idempotencyKey: "refresh-73" }),
      sessionParams("73"),
    );
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toEqual({ error: "session_not_found" });
  });

  it("returns exercise-history nulls unchanged and scopes the read to both route IDs", async () => {
    const entries = [{
      sessionDate: "2026-10-05",
      exerciseName: "Pull-up",
      topSetLoadKg: null,
      totalRepetitions: 12,
      externalLoadVolumeKgReps: null,
    }];
    routeMocks.trainingService.getExerciseHistory.mockResolvedValueOnce(entries);

    const response = await getExerciseHistory(
      new Request("http://localhost/api/v1/training/sessions/73/exercises/19/history"),
      exerciseParams("73", "19"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ entries });
    expect(routeMocks.trainingService.getExerciseHistory).toHaveBeenCalledExactlyOnceWith(73, 19);
    expect(entries[0]?.topSetLoadKg).toBeNull();
    expect(entries[0]?.externalLoadVolumeKgReps).toBeNull();
  });

  it("rejects malformed exercise-history IDs and maps missing session exercises", async () => {
    const invalid = await getExerciseHistory(
      new Request("http://localhost/api/v1/training/sessions/x/exercises/0/history"),
      exerciseParams("x", "0"),
    );
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toMatchObject({ error: "validation_error" });
    expect(routeMocks.trainingService.getExerciseHistory).not.toHaveBeenCalled();

    routeMocks.trainingService.getExerciseHistory.mockRejectedValueOnce(new SessionNotFoundError());
    const missing = await getExerciseHistory(
      new Request("http://localhost/api/v1/training/sessions/73/exercises/19/history"),
      exerciseParams("73", "19"),
    );
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toEqual({ error: "session_not_found" });
  });
});
