import { describe, expect, it } from "vitest";
import {
  BASELINE_DERIVATION_DEFAULTS,
  deriveMaintenanceBaseline,
} from "@/modules/model-episodes/maintenance-baseline";
import { stableSourceDays } from "./model-episode-fixtures";

describe("maintenance baseline derivation", () => {
  it("uses the newest eligible window, medians, and robust weight trend", () => {
    const days = stableSourceDays();
    const before = structuredClone(days);
    const result = deriveMaintenanceBaseline({ days, referenceDate: "2026-08-22" });
    expect(result).toMatchObject({
      baselineEnergyIntakeKcalPerDay: 2_450,
      baselineCarbIntakeG: 240,
      fallbackNutrition: {
        caloriesKcal: 2_450,
        proteinG: 150,
        fatG: 75,
        carbsG: 240,
      },
      diagnostics: {
        method: "median-with-theil-sen-weight-stability",
        windowStartDate: "2026-07-26",
        windowEndDate: "2026-08-22",
        windowDays: 28,
        completeNutritionDayCount: 28,
        weightObservationCount: 28,
      },
    });
    expect(Math.abs(result!.diagnostics.weightTrendPercentPerWeek)).toBeLessThan(0.25);
    expect(days).toEqual(before);
  });

  it("rejects insufficient complete nutrition without turning null into zero", () => {
    const days = stableSourceDays({
      override: (index) => index % 2 === 0 ? { proteinG: null } : {},
    });
    expect(deriveMaintenanceBaseline({ days, referenceDate: "2026-08-22" })).toBeNull();
  });

  it("derives its joint fallback only from complete observed source days", () => {
    const days = stableSourceDays({
      override: (index) => index === 70
        ? { caloriesKcal: null, proteinG: null, fatG: null, carbsG: null }
        : {},
    });
    const result = deriveMaintenanceBaseline({ days, referenceDate: "2026-08-22" });
    expect(result).not.toBeNull();
    expect(result!.diagnostics.completeNutritionDayCount).toBe(27);
    expect(result!.fallbackNutrition).not.toEqual({
      caloriesKcal: null, proteinG: null, fatG: null, carbsG: null,
    });
  });

  it("rejects insufficient weight evidence", () => {
    const days = stableSourceDays({
      override: (index) => index % 3 === 0 ? {} : { weightKg: null },
    });
    expect(deriveMaintenanceBaseline({ days, referenceDate: "2026-08-22" })).toBeNull();
  });

  it("rejects an obvious sustained loss while resisting one scale outlier", () => {
    const losing = stableSourceDays({
      override: (index) => ({ weightKg: 84 - index * 0.08 }),
    });
    expect(deriveMaintenanceBaseline({ days: losing, referenceDate: "2026-08-22" })).toBeNull();

    const stable = stableSourceDays();
    stable.at(-10)!.weightKg! += 3;
    expect(deriveMaintenanceBaseline({ days: stable, referenceDate: "2026-08-22" }))
      .not.toBeNull();
  });

  it("searches backward for a stable window and preserves explicit nutrition zero", () => {
    const days = stableSourceDays({
      override: (index) => index >= 62 ? { weightKg: 80 - (index - 62) * 0.1 } : {},
    });
    days[20].caloriesKcal = 0;
    days[20].carbsG = 0;
    const result = deriveMaintenanceBaseline({ days, referenceDate: "2026-08-22" });
    expect(result).not.toBeNull();
    expect(result!.diagnostics.windowEndDate.localeCompare("2026-08-22"))
      .toBeLessThan(0);
    expect(result!.baselineEnergyIntakeKcalPerDay).toBeGreaterThan(0);
  });

  it("rejects inconsistent or invalid configuration", () => {
    expect(BASELINE_DERIVATION_DEFAULTS.lookbackDays).toBe(90);
    const invalid = [
      { ...BASELINE_DERIVATION_DEFAULTS, windowDays: 0 },
      { ...BASELINE_DERIVATION_DEFAULTS, lookbackDays: 20 },
      { ...BASELINE_DERIVATION_DEFAULTS, minimumCompleteNutritionDays: 29 },
      { ...BASELINE_DERIVATION_DEFAULTS, minimumWeightSpanDays: 29 },
      { ...BASELINE_DERIVATION_DEFAULTS, maximumAbsoluteWeightTrendPercentPerWeek: -1 },
      { ...BASELINE_DERIVATION_DEFAULTS, maximumAbsoluteWeightTrendPercentPerWeek: Number.NaN },
    ];
    for (const config of invalid) {
      expect(() => deriveMaintenanceBaseline({
        days: [], referenceDate: "2026-08-22", config,
      })).toThrow();
    }
  });
});
