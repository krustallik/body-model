import { beforeEach, describe, expect, it, vi } from "vitest";

const authAccess = vi.hoisted(() => ({
  getSessionPrincipal: vi.fn(),
}));
const analyticsRepository = vi.hoisted(() => ({
  readBodyMapTrainingAnalyticsV1: vi.fn(),
}));

vi.mock("@/modules/auth/access", () => authAccess);
vi.mock("@/modules/training/body-map-training-analytics.repository", () => analyticsRepository);

import { GET } from "@/app/api/v1/training/body-map/analytics/route";

const base = "http://localhost/api/v1/training/body-map/analytics";

describe("GET /api/v1/training/body-map/analytics", () => {
  beforeEach(() => {
    authAccess.getSessionPrincipal.mockReset();
    analyticsRepository.readBodyMapTrainingAnalyticsV1.mockReset();
  });

  it("reads only the authenticated profile and requested supported window", async () => {
    authAccess.getSessionPrincipal.mockResolvedValue({ profileId: 41, userId: "u41", method: "session" });
    const analytics = { contract: "bodycast-body-map-training-analytics-v1" };
    analyticsRepository.readBodyMapTrainingAnalyticsV1.mockResolvedValue(analytics);

    const response = await GET(new Request(`${base}?weeks=12`));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("private");
    expect(response.headers.get("cache-control")).toContain("no-store");
    await expect(response.json()).resolves.toEqual({ analytics });
    expect(analyticsRepository.readBodyMapTrainingAnalyticsV1).toHaveBeenCalledWith(41, 12, expect.any(Date), undefined);
  });

  it("maps calendar month windows onto the backwards-compatible weeks argument", async () => {
    authAccess.getSessionPrincipal.mockResolvedValue({ profileId: 41, userId: "u41", method: "session" });
    analyticsRepository.readBodyMapTrainingAnalyticsV1.mockResolvedValue({ contract: "bodycast-body-map-training-analytics-v1" });

    const response = await GET(new Request(`${base}?months=6`));

    expect(response.status).toBe(200);
    expect(analyticsRepository.readBodyMapTrainingAnalyticsV1).toHaveBeenCalledWith(41, 24, expect.any(Date), 6);
  });

  it("rejects unsupported windows without querying the diary", async () => {
    authAccess.getSessionPrincipal.mockResolvedValue({ profileId: 41, userId: "u41", method: "session" });

    const response = await GET(new Request(`${base}?weeks=6`));

    expect(response.status).toBe(400);
    expect(analyticsRepository.readBodyMapTrainingAnalyticsV1).not.toHaveBeenCalled();
  });

  it("requires a session and does not return cacheable responses", async () => {
    authAccess.getSessionPrincipal.mockResolvedValue(null);

    const response = await GET(new Request(base));

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(analyticsRepository.readBodyMapTrainingAnalyticsV1).not.toHaveBeenCalled();
  });
});
