import { describe, expect, it } from "vitest";
import { formatDurationClock, formatDurationMinutes } from "@/modules/days/metric-format";

describe("sleep duration formatting", () => {
  it("formats Ukrainian durations and missing values", () => {
    expect(formatDurationMinutes(468, "uk")).toBe("7 год 48 хв");
    expect(formatDurationMinutes(21, "uk")).toBe("21 хв");
    expect(formatDurationMinutes(null, "uk")).toBe("—");
    expect(formatDurationMinutes(0, "uk")).toBe("—");
    expect(formatDurationClock(468)).toBe("7:48");
    expect(formatDurationClock(null)).toBe("—");
  });
});
