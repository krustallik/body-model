import { describe, expect, it } from "vitest";
import {
  addCalendarDays,
  calendarDayIndex,
  enumerateCalendarDates,
  latestCompletedLocalDate,
} from "@/modules/model-episodes/model-calendar";

describe("model application calendar policy", () => {
  it("excludes the current Bratislava local day independently of server UTC date", () => {
    expect(latestCompletedLocalDate(
      new Date("2026-08-23T22:30:00.000Z"),
      "Europe/Bratislava",
    )).toBe("2026-08-23");
    expect(latestCompletedLocalDate(
      new Date("2026-01-01T23:30:00.000Z"),
      "Europe/Bratislava",
    )).toBe("2026-01-01");
  });

  it("enumerates consecutive real local calendar labels through DST", () => {
    expect(enumerateCalendarDates("2026-03-28", "2026-03-30"))
      .toEqual(["2026-03-28", "2026-03-29", "2026-03-30"]);
    expect(addCalendarDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(enumerateCalendarDates("2026-03-30", "2026-03-28")).toEqual([]);
  });

  it("rejects invalid dates, offsets, and clocks", () => {
    expect(() => calendarDayIndex("2026-02-30")).toThrow();
    expect(() => addCalendarDays("2026-08-23", 0.5)).toThrow();
    expect(() => latestCompletedLocalDate(
      new Date(Number.NaN), "Europe/Bratislava",
    )).toThrow();
  });
});
