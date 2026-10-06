import { beforeEach, describe, expect, it, vi } from "vitest";

const routeMocks = vi.hoisted(() => ({
  sleepRepository: { summaryForDate: vi.fn() },
  isLocalDemoMode: vi.fn(),
  localDemoSleepForDate: vi.fn(),
}));

vi.mock("@/modules/health/sleep.repository", () => ({ sleepRepository: routeMocks.sleepRepository }));
vi.mock("@/modules/demo/local-demo-mode", () => ({ isLocalDemoMode: routeMocks.isLocalDemoMode }));
vi.mock("@/modules/demo/local-demo-data", () => ({ localDemoSleepForDate: routeMocks.localDemoSleepForDate }));

import { GET } from "@/app/api/v1/sleep/route";

describe("sleep summary route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    routeMocks.isLocalDemoMode.mockReturnValue(false);
    routeMocks.sleepRepository.summaryForDate.mockResolvedValue(null);
    routeMocks.localDemoSleepForDate.mockReturnValue(null);
  });

  it("returns the validation error DTO for missing and malformed dates", async () => {
    for (const [url, expectedCode] of [
      ["http://localhost/api/v1/sleep", "invalid_type"],
      ["http://localhost/api/v1/sleep?date=not-a-date", "custom"],
    ]) {
      const response = await GET(new Request(url));
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe("validation_error");
      expect(body.details).toEqual([
        expect.objectContaining({ path: [], code: expectedCode }),
      ]);
    }
    expect(routeMocks.sleepRepository.summaryForDate).not.toHaveBeenCalled();
  });

  it("returns an unavailable null sleep value instead of a zero-valued summary", async () => {
    const response = await GET(new Request("http://localhost/api/v1/sleep?date=2026-10-06"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ date: "2026-10-06", sleep: null });
    expect(routeMocks.sleepRepository.summaryForDate).toHaveBeenCalledExactlyOnceWith("2026-10-06");
  });

  it("serves local demo sleep without querying persisted sleep data", async () => {
    const demoSleep = { totalSleepMinutes: 405, sleepEfficiency: null, segments: [] };
    routeMocks.isLocalDemoMode.mockReturnValue(true);
    routeMocks.localDemoSleepForDate.mockReturnValue(demoSleep);

    const response = await GET(new Request("http://localhost/api/v1/sleep?date=2026-10-06"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ date: "2026-10-06", sleep: demoSleep });
    expect(routeMocks.localDemoSleepForDate).toHaveBeenCalledExactlyOnceWith("2026-10-06");
    expect(routeMocks.sleepRepository.summaryForDate).not.toHaveBeenCalled();
  });

  it("surfaces repository failure as an error rather than confirming zero sleep", async () => {
    routeMocks.sleepRepository.summaryForDate.mockRejectedValueOnce(new Error("database unavailable"));

    const response = await GET(new Request("http://localhost/api/v1/sleep?date=2026-10-06"));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "internal_error" });
  });
});
