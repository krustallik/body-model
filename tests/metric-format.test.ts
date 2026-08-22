import { describe, expect, it } from "vitest";
import { formatDateTime, formatMetric } from "@/modules/days/metric-format";

describe("dashboard metric formatting", () => {
  it("renders missing metrics as an em dash instead of zero", () => {
    expect(formatMetric(null)).toBe("—");
  });

  it("preserves explicit zero", () => {
    expect(formatMetric(0)).toBe("0");
  });

  it("renders a missing timestamp as an em dash", () => {
    expect(formatDateTime(null)).toBe("—");
  });
});
