import { describe, expect, it } from "vitest";
import { buildUnifiedEnergySummaryV1 } from "@/model/unified-experimental-physiology-v1/energy-summary";

describe("unified energy summary v1", () => {
  it("keeps resting, typical maintenance and today/latest labels separate", () => {
    const days = Array.from({ length: 28 }, (_, index) => ({ date: `2026-09-${String(index + 1).padStart(2, "0")}`, dynamicRmrKcalPerDay: 1800, productionTdeeKcalPerDay: 3000 + index }));
    const result = buildUnifiedEnergySummaryV1({ days, todayDate: "2026-09-28" });
    expect(result.restingRmrKcalPerDay).toBe(1800);
    expect(result.recentTypicalMaintenanceKcalPerDay).toBe(3013.5);
    expect(result.todayEstimatedExpenditureKcalPerDay).toBe(3027);
    expect(result.latestModeledExpenditureKcalPerDay).toBe(3027);
  });

  it("does not invent typical maintenance with fewer than fourteen eligible days", () => {
    const result = buildUnifiedEnergySummaryV1({ days: [{ date: "2026-09-22", dynamicRmrKcalPerDay: 1700, productionTdeeKcalPerDay: 2800 }] });
    expect(result.recentTypicalMaintenanceKcalPerDay).toBeNull();
    expect(result.typicalMaintenanceEligibleDays).toBe(1);
  });
});
