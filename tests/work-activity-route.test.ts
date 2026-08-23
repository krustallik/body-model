import { beforeEach, describe, expect, it, vi } from "vitest";

const { getDiagnostics } = vi.hoisted(() => ({ getDiagnostics: vi.fn() }));
vi.mock("@/modules/work-intervals/work-activity.service", () => ({
  getWorkActivityDiagnosticsForDay: getDiagnostics,
}));

import { GET } from "@/app/api/v1/work-activity/route";

describe("GET /api/v1/work-activity", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns backend-calculated diagnostics", async () => {
    getDiagnostics.mockResolvedValue({ date: "2026-08-23", diagnostics: { activity: {} } });
    const response = await GET(new Request("http://localhost/api/v1/work-activity?date=2026-08-23"));
    expect(response.status).toBe(200);
    expect(getDiagnostics).toHaveBeenCalledWith("2026-08-23");
  });

  it("validates date and handles server errors", async () => {
    expect((await GET(new Request("http://localhost/api/v1/work-activity?date=no"))).status).toBe(400);
    expect((await GET(new Request("http://localhost/api/v1/work-activity"))).status).toBe(400);
    getDiagnostics.mockRejectedValue(new Error("db"));
    expect((await GET(new Request("http://localhost/api/v1/work-activity?date=2026-08-23"))).status)
      .toBe(500);
  });
});
