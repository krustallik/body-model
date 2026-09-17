import { beforeEach, describe, expect, it, vi } from "vitest";

const trainingService = vi.hoisted(() => ({
  listPrograms: vi.fn(),
  createProgram: vi.fn(),
  getProgram: vi.fn(),
  updateProgram: vi.fn(),
  archiveProgram: vi.fn(),
}));

vi.mock("@/modules/training/training.service", () => ({ trainingService }));

import { GET as GET_PROGRAM, PATCH } from "@/app/api/v1/training/programs/[id]/route";
import { POST as ARCHIVE } from "@/app/api/v1/training/programs/[id]/archive/route";
import { GET as LIST, POST as CREATE } from "@/app/api/v1/training/programs/route";
import {
  CatalogExerciseNotFoundError,
  ProgramNotFoundError,
} from "@/modules/training/training.errors";
import { RESISTANCE } from "@/modules/training/training.constants";

const base = "http://localhost/api/v1/training/programs";
const program = {
  id: 7,
  name: "Моє тренування",
  archivedAt: null,
  currentVersionId: 11,
  currentVersionNumber: 1,
  exercises: [{
    id: 1,
    catalogId: 3,
    catalogName: "Віджимання від ручок",
    order: 0,
    plannedSets: 3,
    resistanceType: RESISTANCE.BODYWEIGHT,
  }],
  createdAt: "2026-09-17T10:00:00.000Z",
  updatedAt: "2026-09-17T10:00:00.000Z",
};

function jsonRequest(url: string, method: string, body: unknown): Request {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe("/api/v1/training/programs", () => {
  beforeEach(() => {
    Object.values(trainingService).forEach((mock) => mock.mockReset());
  });

  it("lists programs", async () => {
    trainingService.listPrograms.mockResolvedValue([{ id: 7, name: "Моє тренування" }]);
    const response = await LIST();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      programs: [{ id: 7, name: "Моє тренування" }],
    });
    expect(trainingService.listPrograms).toHaveBeenCalledOnce();
  });

  it("creates a valid program", async () => {
    trainingService.createProgram.mockResolvedValue(program);
    const body = {
      name: "Моє тренування",
      exercises: [{
        catalogId: 3,
        plannedSets: 3,
        resistanceType: RESISTANCE.BODYWEIGHT,
      }],
    };
    const response = await CREATE(jsonRequest(base, "POST", body));
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ program });
    expect(trainingService.createProgram).toHaveBeenCalledWith(body);
  });

  it.each([
    {
      name: "empty exercises",
      body: { name: "X", exercises: [] },
    },
    {
      name: "missing name",
      body: { exercises: [{ catalogId: 1, plannedSets: 3, resistanceType: RESISTANCE.EXTERNAL_WEIGHT }] },
    },
    {
      name: "invalid resistance",
      body: {
        name: "X",
        exercises: [{ catalogId: 1, plannedSets: 3, resistanceType: "CABLE" }],
      },
    },
  ])("rejects create ($name) without mutation", async ({ body }) => {
    const response = await CREATE(jsonRequest(base, "POST", body));
    expect(response.status).toBe(400);
    expect(trainingService.createProgram).not.toHaveBeenCalled();
  });

  it("maps catalog miss on create to 400", async () => {
    trainingService.createProgram.mockRejectedValue(new CatalogExerciseNotFoundError());
    const response = await CREATE(jsonRequest(base, "POST", {
      name: "X",
      exercises: [{ catalogId: 99, plannedSets: 3, resistanceType: RESISTANCE.EXTERNAL_WEIGHT }],
    }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "catalog_not_found" });
  });

  it("gets a program by id", async () => {
    trainingService.getProgram.mockResolvedValue(program);
    const response = await GET_PROGRAM(new Request(`${base}/7`), ctx("7"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ program });
    expect(trainingService.getProgram).toHaveBeenCalledWith(7);
  });

  it("returns 404 when program is missing", async () => {
    trainingService.getProgram.mockResolvedValue(null);
    const response = await GET_PROGRAM(new Request(`${base}/7`), ctx("7"));
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "not_found" });
  });

  it("rejects invalid program id without calling the service", async () => {
    const response = await GET_PROGRAM(new Request(`${base}/abc`), ctx("abc"));
    expect(response.status).toBe(400);
    expect(trainingService.getProgram).not.toHaveBeenCalled();
  });

  it("updates a program", async () => {
    trainingService.updateProgram.mockResolvedValue({ ...program, name: "День А" });
    const response = await PATCH(
      jsonRequest(`${base}/7`, "PATCH", { name: "День А" }),
      ctx("7"),
    );
    expect(response.status).toBe(200);
    expect(trainingService.updateProgram).toHaveBeenCalledWith(7, { name: "День А" });
  });

  it("rejects empty update body without mutation", async () => {
    const response = await PATCH(jsonRequest(`${base}/7`, "PATCH", {}), ctx("7"));
    expect(response.status).toBe(400);
    expect(trainingService.updateProgram).not.toHaveBeenCalled();
  });

  it("maps ProgramNotFoundError on update to 404", async () => {
    trainingService.updateProgram.mockRejectedValue(new ProgramNotFoundError());
    const response = await PATCH(
      jsonRequest(`${base}/7`, "PATCH", { name: "День А" }),
      ctx("7"),
    );
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "program_not_found" });
  });

  it("archives a program", async () => {
    trainingService.archiveProgram.mockResolvedValue({
      ...program,
      archivedAt: "2026-09-17T12:00:00.000Z",
    });
    const response = await ARCHIVE(new Request(`${base}/7/archive`, { method: "POST" }), ctx("7"));
    expect(response.status).toBe(200);
    expect(trainingService.archiveProgram).toHaveBeenCalledWith(7);
  });

  it("maps archive not-found to 404", async () => {
    trainingService.archiveProgram.mockRejectedValue(new ProgramNotFoundError());
    const response = await ARCHIVE(new Request(`${base}/7/archive`, { method: "POST" }), ctx("7"));
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "program_not_found" });
  });
});
