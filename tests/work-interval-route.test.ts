import { beforeEach, describe, expect, it, vi } from "vitest";

const { repository } = vi.hoisted(() => ({
  repository: {
    list: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(),
  },
}));
vi.mock("@/modules/work-intervals/work-interval.repository", () => ({
  workIntervalRepository: repository,
}));

import { DELETE, PATCH } from "@/app/api/v1/work-intervals/[id]/route";
import { GET, POST } from "@/app/api/v1/work-intervals/route";
import { WorkIntervalOverlapError } from "@/modules/work-intervals/work-interval.errors";

const valid = {
  date: "2026-08-23", startTime: "08:00", endTime: "16:00", category: "standingLight",
  breakMinutes: 30,
};
const dto = { id: 1, ...valid, timezone: "Europe/Bratislava" };
const jsonRequest = (url: string, body: unknown) => new Request(url, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});
const context = (id: string) => ({ params: Promise.resolve({ id }) });

describe("work interval routes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists intervals with an optional date", async () => {
    repository.list.mockResolvedValue([dto]);
    const response = await GET(new Request("http://localhost/api/v1/work-intervals?date=2026-08-23"));
    expect(response.status).toBe(200);
    expect(repository.list).toHaveBeenCalledWith("2026-08-23");
    await expect(response.json()).resolves.toEqual({ intervals: [dto] });
  });

  it("creates an interval", async () => {
    repository.create.mockResolvedValue(dto);
    const response = await POST(jsonRequest("http://localhost/api/v1/work-intervals", valid));
    expect(response.status).toBe(201);
    expect(repository.create).toHaveBeenCalledWith({ ...valid, timezone: "Europe/Bratislava" });
  });

  it("updates and deletes an interval", async () => {
    repository.update.mockResolvedValue(dto);
    repository.delete.mockResolvedValue(true);
    const patched = await PATCH(
      jsonRequest("http://localhost/api/v1/work-intervals/1", { category: "manualLight" }),
      context("1"),
    );
    expect(patched.status).toBe(200);
    expect(repository.update).toHaveBeenCalledWith(1, { category: "manualLight" });
    expect((await DELETE(new Request("http://localhost"), context("1"))).status).toBe(204);
  });

  it("returns 404 for nonexistent update/delete", async () => {
    repository.update.mockResolvedValue(null);
    repository.delete.mockResolvedValue(false);
    expect((await PATCH(
      jsonRequest("http://localhost/api/v1/work-intervals/9", { category: "manualLight" }),
      context("9"),
    )).status).toBe(404);
    expect((await DELETE(new Request("http://localhost"), context("9"))).status).toBe(404);
  });

  it("returns 409 for overlaps", async () => {
    repository.create.mockRejectedValue(new WorkIntervalOverlapError());
    repository.update.mockRejectedValue(new WorkIntervalOverlapError());
    expect((await POST(jsonRequest("http://localhost/api/v1/work-intervals", valid))).status).toBe(409);
    expect((await PATCH(
      jsonRequest("http://localhost/api/v1/work-intervals/1", { category: "manualLight" }),
      context("1"),
    )).status).toBe(409);
  });

  it("returns validation errors for bad query/body/id/content", async () => {
    expect((await GET(new Request("http://localhost/api/v1/work-intervals?date=no"))).status).toBe(400);
    expect((await POST(jsonRequest("http://localhost/api/v1/work-intervals", {}))).status).toBe(400);
    expect((await PATCH(jsonRequest("http://localhost", {}), context("x"))).status).toBe(400);
    expect((await DELETE(new Request("http://localhost"), context("0"))).status).toBe(400);
    expect((await POST(new Request("http://localhost", { method: "POST" }))).status).toBe(400);
  });

  it("returns safe 500 responses for unexpected repository failures", async () => {
    repository.list.mockRejectedValue(new Error("db"));
    repository.create.mockRejectedValue(new Error("db"));
    repository.update.mockRejectedValue(new Error("db"));
    repository.delete.mockRejectedValue(new Error("db"));
    expect((await GET(new Request("http://localhost/api/v1/work-intervals"))).status).toBe(500);
    expect((await POST(jsonRequest("http://localhost", valid))).status).toBe(500);
    expect((await PATCH(jsonRequest("http://localhost", { category: "manualLight" }), context("1"))).status)
      .toBe(500);
    expect((await DELETE(new Request("http://localhost"), context("1"))).status).toBe(500);
  });
});
