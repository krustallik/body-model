import { beforeEach, describe, expect, it, vi } from "vitest";

const { checkHealth } = vi.hoisted(() => ({ checkHealth: vi.fn() }));

vi.mock("@/modules/health/service", () => ({ checkHealth }));

import { GET } from "@/app/api/health/route";

describe("GET /api/health", () => {
  beforeEach(() => checkHealth.mockReset());

  it("returns 200 and the connected database status", async () => {
    checkHealth.mockResolvedValue({ status: "ok", database: "connected" });
    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok", database: "connected" });
  });

  it("returns 503 when the database is unavailable", async () => {
    checkHealth.mockResolvedValue({ status: "error", database: "unavailable" });
    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ status: "error", database: "unavailable" });
  });
});
