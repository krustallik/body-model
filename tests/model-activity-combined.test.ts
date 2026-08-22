import { describe, expect, it } from "vitest";
import { calculateActivity, type ActivityComponents } from "@/model/activity/activity";

describe("calculateActivity", () => {
  it.each([
    ["walking only", { walkingActivityKcal: 224, strengthActivityKcal: 0 }, 224],
    ["strength only", { walkingActivityKcal: 0, strengthActivityKcal: 100 }, 100],
    ["walking and strength", { walkingActivityKcal: 224, strengthActivityKcal: 100 }, 324],
    ["explicit zeros", { walkingActivityKcal: 0, strengthActivityKcal: 0 }, 0],
  ])("combines %s when both component states are known", (_label, input, expected) => {
    expect(calculateActivity(input)).toBe(expected);
  });

  it.each([
    { walkingActivityKcal: null, strengthActivityKcal: 100 },
    { walkingActivityKcal: 224, strengthActivityKcal: null },
    { walkingActivityKcal: undefined, strengthActivityKcal: 0 },
  ])("preserves unavailable component semantics", (input) => {
    expect(calculateActivity(input)).toBeNull();
  });

  it("does not add steps to distance-derived walking activity", () => {
    const diagnostics = {
      walkingActivityKcal: 224,
      strengthActivityKcal: 100,
      steps: 20_000,
    } satisfies ActivityComponents & { steps: number };
    expect(calculateActivity(diagnostics)).toBe(324);
  });

  it.each([
    ["negative", -1],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
  ])("rejects %s component kcal", (_label, value) => {
    expect(() => calculateActivity({ walkingActivityKcal: value, strengthActivityKcal: 0 })).toThrow();
  });
});
