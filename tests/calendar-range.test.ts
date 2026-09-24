import { describe, expect, it } from "vitest";
import { localCalendarRangeInstants, todayInCalendarTimeZone } from "@/modules/days/calendar-range";

describe("Bratislava local calendar ranges", () => {
  it("uses a half-open 23-hour interval on the spring DST transition", () => {
    const range = localCalendarRangeInstants({ from: "2026-03-29", to: "2026-03-29" });
    expect(range.gte?.toISOString()).toBe("2026-03-28T23:00:00.000Z");
    expect(range.lt?.toISOString()).toBe("2026-03-29T22:00:00.000Z");
    expect((range.lt!.getTime() - range.gte!.getTime()) / 3_600_000).toBe(23);
  });

  it("uses a half-open 25-hour interval on the autumn DST transition", () => {
    const range = localCalendarRangeInstants({ from: "2026-10-25", to: "2026-10-25" });
    expect(range.gte?.toISOString()).toBe("2026-10-24T22:00:00.000Z");
    expect(range.lt?.toISOString()).toBe("2026-10-25T23:00:00.000Z");
    expect((range.lt!.getTime() - range.gte!.getTime()) / 3_600_000).toBe(25);
  });

  it("chooses the Bratislava day when UTC and local dates differ", () => {
    expect(todayInCalendarTimeZone(new Date("2026-09-23T22:30:00.000Z"))).toBe("2026-09-24");
  });
});
