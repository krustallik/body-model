import { describe, expect, it } from "vitest";
import { healthRetentionCutoffDate } from "@/modules/health/health-retention";

describe("health retention cutoff", () => {
  it("keeps the last 30 calendar days inclusive of the reference date", () => {
    // Older than 30 days relative to 2026-09-16 means before 2026-08-17.
    expect(healthRetentionCutoffDate("2026-09-16")).toBe("2026-08-17");
  });
});
