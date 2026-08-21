import { beforeEach, describe, expect, it, vi } from "vitest";

const { syncHealthData } = vi.hoisted(() => ({ syncHealthData: vi.fn() }));
vi.mock("@/modules/health/health.service", () => ({ syncHealthData }));

import { POST } from "@/app/api/v1/health/sync/route";

const apiKey = "a-long-test-secret";
const url = "http://localhost/api/v1/health/sync";

function request(body: unknown, key: string | null = apiKey): Request {
  const headers = new Headers({ "content-type": "application/json" });
  if (key !== null) headers.set("x-api-key", key);
  return new Request(url, { method: "POST", headers, body: JSON.stringify(body) });
}

describe("POST /api/v1/health/sync", () => {
  beforeEach(() => {
    process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
    process.env.IOS_SHORTCUT_API_KEY = apiKey;
    syncHealthData.mockReset();
  });

  it.each([[null], ["wrong-key"], [""]])("returns 401 for an unauthorized key: %s", async (key) => {
    const response = await POST(request({ days: [{ date: "2026-08-21" }] }, key));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "unauthorized" });
    expect(syncHealthData).not.toHaveBeenCalled();
  });

  it("returns the service result for a valid request", async () => {
    const result = {
      status: "ok",
      received: 1,
      created: 1,
      updated: 0,
      dates: [{ date: "2026-08-21", action: "created" }],
    };
    syncHealthData.mockResolvedValue(result);
    const response = await POST(request({ days: [{ date: "2026-08-21", steps: 10000 }] }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(result);
  });

  it("returns safe validation details for invalid payload", async () => {
    const response = await POST(request({ days: [] }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "validation_error" });
  });

  it("returns 400 for malformed JSON", async () => {
    const response = await POST(
      new Request(url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": apiKey },
        body: "{broken",
      }),
    );
    expect(response.status).toBe(400);
  });

  it("returns 400 for a non-JSON content type", async () => {
    const response = await POST(
      new Request(url, {
        method: "POST",
        headers: { "content-type": "text/plain", "x-api-key": apiKey },
        body: JSON.stringify({ days: [{ date: "2026-08-21" }] }),
      }),
    );
    expect(response.status).toBe(400);
    expect(syncHealthData).not.toHaveBeenCalled();
  });

  it("does not expose database errors", async () => {
    syncHealthData.mockRejectedValue(new Error("postgres password=super-secret"));
    const response = await POST(request({ days: [{ date: "2026-08-21" }] }));
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "internal_error" });
  });
});
