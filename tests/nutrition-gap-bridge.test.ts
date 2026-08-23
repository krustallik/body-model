import { describe, expect, it } from "vitest";
import {
  bridgeNutritionGaps,
  NUTRITION_GAP_POLICY_DEFAULTS,
  type NutritionDay,
} from "@/modules/model-episodes/nutrition-gap-bridge";
import type { NutritionVector } from "@/modules/model-episodes/model-episode.types";
import { addCalendarDays } from "@/modules/model-episodes/model-calendar";

const fallback: NutritionVector = {
  caloriesKcal: 2_600,
  proteinG: 160,
  fatG: 85,
  carbsG: 280,
};

function day(
  date: string,
  caloriesKcal: number | null,
  override: Partial<NutritionDay> = {},
): NutritionDay {
  if (caloriesKcal === null) {
    return { date, caloriesKcal: null, proteinG: null, fatG: null, carbsG: null, ...override };
  }
  return {
    date,
    caloriesKcal,
    proteinG: caloriesKcal * 0.06,
    fatG: caloriesKcal * 0.03,
    carbsG: caloriesKcal * 0.1,
    ...override,
  };
}

function series(calories: Array<number | null>, start = "2026-03-25"): NutritionDay[] {
  return calories.map((value, index) => day(addCalendarDays(start, index), value));
}

describe("deterministic nutrition gap bridging", () => {
  it("leaves fully observed history and explicit zero untouched", () => {
    const days = [
      day("2026-01-01", 2_000),
      day("2026-01-02", 0, { proteinG: 0, fatG: 0, carbsG: 0 }),
    ];
    const result = bridgeNutritionGaps({ days, fallbackNutrition: fallback });
    expect(result.map(({ caloriesKcal }) => caloriesKcal)).toEqual([2_000, 0]);
    expect(result.every(({ provenance }) => provenance.source === "observed")).toBe(true);
  });

  it("bridges the required one-day example with a local joint donor", () => {
    const result = bridgeNutritionGaps({
      days: series([1_980, 2_050, null, 2_010, 1_990]),
      fallbackNutrition: fallback,
    });
    expect(result[2]).toMatchObject({
      caloriesKcal: 2_010,
      provenance: {
        source: "imputed-local",
        method: "local-joint-donor",
        referenceDayCount: 4,
        gapLength: 1,
        dependency: "imputed-direct",
      },
    });
    expect(result.slice(3).every(({ provenance }) => (
      provenance.dependency === "imputed-downstream"
    ))).toBe(true);
  });

  it("bridges two consecutive days and rejects three at the default maximum", () => {
    const two = bridgeNutritionGaps({
      days: series([2_000, 2_050, null, null, 1_980, 2_010]),
      fallbackNutrition: fallback,
    });
    expect(two.slice(2, 4).map(({ provenance }) => provenance.source))
      .toEqual(["imputed-local", "imputed-local"]);
    expect(two.slice(2, 4).map(({ provenance }) => provenance.gapLength)).toEqual([2, 2]);

    const three = bridgeNutritionGaps({
      days: series([2_000, 2_050, null, null, null, 1_980]),
      fallbackNutrition: fallback,
    });
    expect(three.slice(2, 5).map(({ provenance }) => provenance.source))
      .toEqual(["missing", "missing", "missing"]);
    expect(three.slice(2, 5).every(({ caloriesKcal }) => caloriesKcal === null)).toBe(true);
  });

  it("honors an explicitly configured maximum and never imputes an unlimited run", () => {
    const bridged = bridgeNutritionGaps({
      days: series([2_000, null, null, null, 2_050]),
      fallbackNutrition: fallback,
      policy: { maxBridgeDays: 3 },
    });
    expect(bridged.slice(1, 4).every(({ provenance }) => (
      provenance.source === "imputed-local"
    ))).toBe(true);
    const seven = bridgeNutritionGaps({
      days: series([2_000, ...Array(7).fill(null), 2_050]),
      fallbackNutrition: fallback,
    });
    expect(seven.filter(({ provenance }) => provenance.source === "missing")).toHaveLength(7);
  });

  it("uses recent one-sided context for a tail gap", () => {
    const result = bridgeNutritionGaps({
      days: series([2_000, 2_050, 1_980, null]),
      fallbackNutrition: fallback,
    });
    expect(result[3]).toMatchObject({
      caloriesKcal: 2_000,
      provenance: { source: "imputed-local", referenceDayCount: 3 },
    });
  });

  it("stays in the recent diet regime instead of using the older maintenance prior", () => {
    const result = bridgeNutritionGaps({
      days: series([2_600, 2_550, 2_650, 1_950, 2_000, null, 2_020, 1_980]),
      fallbackNutrition: fallback,
    });
    expect(result[5].provenance.source).toBe("imputed-local");
    expect(result[5].caloriesKcal).toBe(2_000);
    expect(result[5].caloriesKcal).toBeLessThan(2_200);
  });

  it("uses a robust donor around a refeed instead of linear interpolation", () => {
    const result = bridgeNutritionGaps({
      days: series([2_000, 1_950, null, 2_800, 2_000]),
      fallbackNutrition: fallback,
    });
    expect(result[2].caloriesKcal).toBe(2_000);
    expect(result[2].caloriesKcal).not.toBe(2_375);
  });

  it("preserves observed partial fields and conditionally fills only missing fields", () => {
    const partial = series([2_000, 2_100, null, 2_050, 1_980]);
    partial[2] = day(partial[2].date, 2_020, {
      proteinG: 125,
      fatG: null,
      carbsG: 210,
    });
    const result = bridgeNutritionGaps({ days: partial, fallbackNutrition: fallback });
    expect(result[2]).toMatchObject({
      caloriesKcal: 2_020,
      proteinG: 125,
      carbsG: 210,
      provenance: {
        source: "imputed-local",
        observedFields: ["caloriesKcal", "proteinG", "carbsG"],
        imputedFields: ["fatG"],
      },
    });
    expect(result[2].fatG).not.toBeNull();
  });

  it.each([
    ["missing calories", { caloriesKcal: null }],
    ["missing protein", { proteinG: null }],
    ["missing carbs", { carbsG: null }],
  ])("bridges %s from a coherent donor", (_name, override) => {
    const days = series([2_000, 2_050, 2_010, 1_990]);
    days[2] = { ...days[2], ...override };
    const result = bridgeNutritionGaps({ days, fallbackNutrition: fallback });
    expect(result[2].provenance.source).toBe("imputed-local");
    expect(result[2].provenance.imputedFields).toHaveLength(1);
  });

  it("refuses a pathological partial log rather than treating it as a severe deficit", () => {
    const days = series([2_000, 2_050, null, 1_980]);
    days[2] = day(days[2].date, 200, { proteinG: null, fatG: null, carbsG: null });
    const result = bridgeNutritionGaps({ days, fallbackNutrition: fallback });
    expect(result[2].provenance.source).toBe("missing");
    expect(result[2].caloriesKcal).toBe(200);
  });

  it("uses the frozen joint fallback only when local evidence is insufficient", () => {
    const result = bridgeNutritionGaps({
      days: series([null, 2_000]),
      fallbackNutrition: fallback,
    });
    expect(result[0]).toMatchObject({
      ...fallback,
      provenance: {
        source: "imputed-fallback",
        method: "frozen-baseline-joint-donor",
        referenceDayCount: 1,
      },
    });
  });

  it("is deterministic, immutable, DST-agnostic, and validates policy", () => {
    const days = series([2_000, null, 1_980], "2026-03-28");
    const before = structuredClone(days);
    expect(bridgeNutritionGaps({ days, fallbackNutrition: fallback }))
      .toEqual(bridgeNutritionGaps({ days, fallbackNutrition: fallback }));
    expect(days).toEqual(before);
    expect(bridgeNutritionGaps({ days, fallbackNutrition: fallback })[1].date)
      .toBe("2026-03-29");
    expect(NUTRITION_GAP_POLICY_DEFAULTS.maxBridgeDays).toBe(2);
    expect(() => bridgeNutritionGaps({ days, policy: { maxBridgeDays: 8 } })).toThrow();
    expect(() => bridgeNutritionGaps({
      days,
      policy: { maxBridgeDays: 2, minimumLocalReferenceDays: 0 },
    })).toThrow();
  });
});
