import { beforeEach, describe, expect, it, vi } from "vitest";

const { checkHealth } = vi.hoisted(() => ({ checkHealth: vi.fn() }));

vi.mock("@/modules/health/service", () => ({ checkHealth }));

import { GET } from "@/app/api/health/route";

describe("GET /api/health", () => {
  beforeEach(() => checkHealth.mockReset());

  // Wiring smoke: the route is intentionally a thin JSON passthrough for liveness.
  it("returns the service payload as HTTP 200 without remapping", async () => {
    checkHealth.mockReturnValue({ status: "ok" });
    const response = await GET();

    expect(checkHealth).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });
});
