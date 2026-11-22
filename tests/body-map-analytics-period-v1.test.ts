import { describe, expect, it } from "vitest";
import {
  bodyMapAnalyticsWeeksForMonthsV1,
  bodyMapAnalyticsWindowStartV1,
} from "@/modules/training/body-map-training-analytics-v1";

describe("Body Map analysis windows", () => {
  it("uses exact calendar months and clamps at month end", () => {
    const start = bodyMapAnalyticsWindowStartV1({
      now: new Date("2026-03-31T16:45:00.000Z"),
      weeks: 4,
      months: 1,
    });
    expect(start.toISOString()).toBe("2026-02-28T16:45:00.000Z");
  });

  it("supports all requested period values while retaining legacy weeks aliases", () => {
    expect([1, 2, 3, 6].map((months) => bodyMapAnalyticsWeeksForMonthsV1(months as 1 | 2 | 3 | 6))).toEqual([4, 8, 12, 24]);
  });

  it("preserves existing fixed-week windows when older clients use weeks", () => {
    expect(bodyMapAnalyticsWindowStartV1({ now: new Date("2026-09-10T00:00:00.000Z"), weeks: 8 }).toISOString())
      .toBe("2026-07-16T00:00:00.000Z");
  });
});
