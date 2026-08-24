import { afterEach, describe, expect, it, vi } from "vitest";
import { forecastQaNow } from "@/app/api/forecast/qa-now";

describe("forecast browser-QA clock", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is unavailable unless explicitly enabled outside production", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("BODYCAST_QA_MODE", "0");
    vi.stubEnv("BODYCAST_QA_NOW", "2026-10-20T10:00:00.000Z");
    expect(forecastQaNow()).toBeUndefined();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("BODYCAST_QA_MODE", "1");
    expect(forecastQaNow()).toBeUndefined();
  });

  it("returns the deterministic QA clock only when explicitly enabled", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("BODYCAST_QA_MODE", "1");
    vi.stubEnv("BODYCAST_QA_NOW", "2026-10-20T10:00:00.000Z");
    expect(forecastQaNow()?.toISOString()).toBe("2026-10-20T10:00:00.000Z");
  });

  it("rejects invalid QA timestamps", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("BODYCAST_QA_MODE", "1");
    vi.stubEnv("BODYCAST_QA_NOW", "not-a-date");
    expect(() => forecastQaNow()).toThrow(/ISO timestamp/);
  });
});
