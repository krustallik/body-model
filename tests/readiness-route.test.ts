import { beforeEach, describe, expect, it, vi } from "vitest";

const { checkReadiness } = vi.hoisted(() => ({ checkReadiness: vi.fn() }));
vi.mock("@/modules/health/service", () => ({ checkReadiness }));

import { GET } from "@/app/api/readiness/route";

describe("GET /api/readiness", () => {
  beforeEach(() => checkReadiness.mockReset());

  it("returns 200 when PostgreSQL is available", async () => {
    checkReadiness.mockResolvedValue({ status: "ok", database: "connected" });
    const response = await GET();
    expect(response.status).toBe(200);
  });

  it("returns a safe 503 without database error details", async () => {
    checkReadiness.mockResolvedValue({ status: "error", database: "unavailable" });
    const response = await GET();
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ status: "error", database: "unavailable" });
  });
});
