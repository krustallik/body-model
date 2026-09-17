import { describe, expect, it } from "vitest";
import { formatDateTime, formatMetric } from "@/modules/days/metric-format";

describe("dashboard metric formatting", () => {
  it("renders missing metrics as an em dash instead of zero", () => {
    expect(formatMetric(null)).toBe("—");
  });

  it("displays zero as a missing record", () => {
    expect(formatMetric(0)).toBe("—");
  });

  it("formats positive metrics with locale-aware digits", () => {
    expect(formatMetric(72.5, "en-US")).toBe("72.5");
    expect(formatMetric(1_234.5678, "en-US")).toBe("1,234.57");
    expect(formatMetric(8_000, "uk-UA")).toMatch(/8.?000/);
  });

  it("formats a concrete timestamp instead of inventing a placeholder", () => {
    const formatted = formatDateTime("2026-09-16T10:30:00.000Z", "en-US");
    expect(formatted).not.toBe("—");
    expect(formatted).toMatch(/2026/);
    expect(formatted).toMatch(/Sep/);
  });

  it("renders a missing timestamp as an em dash", () => {
    expect(formatDateTime(null)).toBe("—");
  });
});
