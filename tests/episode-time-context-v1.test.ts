import { describe, expect, it } from "vitest";
import { DEFAULT_TIME_ZONE } from "@/model/time-zone";
import { episodeTimeContextForInstantV1 } from "@/modules/model-episodes/episode-time-context-v1";

describe("episode-owned model date resolution", () => {
  it("uses the episode timezone even when the caller fallback has a different offset", () => {
    const context = episodeTimeContextForInstantV1([{
      startDate: "2026-01-01",
      timezone: "Europe/Bratislava",
      active: true,
    }], new Date("2025-12-31T23:30:00.000Z"), "Asia/Kolkata");

    expect(context).toMatchObject({ date: "2026-01-01", timeZone: "Europe/Bratislava" });
  });

  it("resolves the same instant to the prior local date under a western episode timezone", () => {
    const context = episodeTimeContextForInstantV1([{
      startDate: "2025-01-01",
      timezone: "America/Los_Angeles",
      active: true,
    }], new Date("2026-01-01T00:30:00.000Z"), "Asia/Kolkata");

    expect(context).toMatchObject({ date: "2025-12-31", timeZone: "America/Los_Angeles" });
  });

  it("uses the stable model default when no episode owns the event instant", () => {
    const context = episodeTimeContextForInstantV1([], new Date("2026-01-01T00:30:00.000Z"));

    expect(context).toMatchObject({ date: "2026-01-01", timeZone: DEFAULT_TIME_ZONE, episode: null });
  });
});
