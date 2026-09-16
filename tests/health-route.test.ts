import { beforeEach, describe, expect, it, vi } from "vitest";

const { checkHealth } = vi.hoisted(() => ({ checkHealth: vi.fn() }));

vi.mock("@/modules/health/service", () => ({ checkHealth }));

import { GET } from "@/app/api/health/route";

describe("GET /api/health", () => {
  beforeEach(() => checkHealth.mockReset());

  it("returns a cheap liveness response without checking dependencies", async () => {
    checkHealth.mockReturnValue({ status: "ok" });
    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });
});
