import { describe, expect, it } from "vitest";
import { episodeTimeContextForInstantV1 } from "@/modules/model-episodes/episode-time-context-v1";

describe("episode-owned event dates", () => {
  it.each([
    ["same timezone", "Europe/Bratislava", "2026-10-25T00:30:00.000Z", "2026-10-25"],
    ["UTC midnight", "UTC", "2026-09-23T23:59:59.000Z", "2026-09-23"],
    ["Kolkata ahead of UTC", "Asia/Kolkata", "2026-01-01T20:00:00.000Z", "2026-01-02"],
    ["Bratislava behind Kolkata boundary", "Europe/Bratislava", "2026-01-01T20:00:00.000Z", "2026-01-01"],
    ["date line east", "Pacific/Kiritimati", "2026-09-23T11:30:00.000Z", "2026-09-24"],
    ["date line west", "America/Adak", "2026-09-23T11:30:00.000Z", "2026-09-23"],
    ["DST midnight crossing", "Europe/Bratislava", "2026-03-28T23:30:00.000Z", "2026-03-29"],
  ])("uses %s for the model date", (_case, timezone, instant, expectedDate) => {
    const result = episodeTimeContextForInstantV1([{
      id: 1,
      active: true,
      startDate: "2026-01-01",
      timezone,
    }], new Date(instant));
    expect(result.date).toBe(expectedDate);
    expect(result.timeZone).toBe(timezone);
    expect(result.episode?.id).toBe(1);
  });
});
