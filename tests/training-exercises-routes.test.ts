import { beforeEach, describe, expect, it, vi } from "vitest";

const trainingService = vi.hoisted(() => ({
  listCatalog: vi.fn(),
}));

vi.mock("@/modules/training/training.service", () => ({ trainingService }));

import { GET } from "@/app/api/v1/training/exercises/route";

const base = "http://localhost/api/v1/training/exercises";
const exercises = [
  { id: 1, name: "Жим гантелей сидячи", isActive: true, archivedAt: null, muscleMapping: null },
];

describe("GET /api/v1/training/exercises", () => {
  beforeEach(() => {
    trainingService.listCatalog.mockReset();
  });

  it("returns active catalog exercises", async () => {
    trainingService.listCatalog.mockResolvedValue(exercises);
    const response = await GET(new Request(base));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ exercises });
    expect(trainingService.listCatalog).toHaveBeenCalledWith({ includeInactive: false });
  });

  it("forwards includeInactive=true from the query string", async () => {
    trainingService.listCatalog.mockResolvedValue(exercises);
    const response = await GET(new Request(`${base}?includeInactive=true`));
    expect(response.status).toBe(200);
    expect(trainingService.listCatalog).toHaveBeenCalledWith({ includeInactive: true });
  });

  it("rejects invalid includeInactive without calling the service", async () => {
    const response = await GET(new Request(`${base}?includeInactive=yes`));
    expect(response.status).toBe(400);
    expect(trainingService.listCatalog).not.toHaveBeenCalled();
  });

  it("maps unexpected failures to 500", async () => {
    trainingService.listCatalog.mockRejectedValue(new Error("db"));
    expect((await GET(new Request(base))).status).toBe(500);
  });
});
