import { describe, expect, it } from "vitest";
import { calculateBaseTdee } from "@/model/base-tdee";

describe("calculateBaseTdee", () => {
  it("adds RMR, TEF and net Activity", () => {
    expect(calculateBaseTdee({ rmrKcal: 1_750, tefKcal: 222.6, activityKcal: 438.1666666667 }))
      .toBeCloseTo(2_410.7666666667, 10);
  });

  it("preserves explicit zero TEF and Activity", () => {
    expect(calculateBaseTdee({ rmrKcal: 1_750, tefKcal: 0, activityKcal: 0 })).toBe(1_750);
  });

  it.each([
    { rmrKcal: 1_750, tefKcal: null, activityKcal: 100 },
    { rmrKcal: 1_750, tefKcal: 200, activityKcal: null },
    { rmrKcal: 1_750, tefKcal: undefined, activityKcal: 0 },
  ])("returns unavailable when a required component is missing", (input) => {
    expect(calculateBaseTdee(input)).toBeNull();
  });

  it.each([
    ["zero RMR", { rmrKcal: 0, tefKcal: 0, activityKcal: 0 }],
    ["negative TEF", { rmrKcal: 1_750, tefKcal: -1, activityKcal: 0 }],
    ["negative Activity", { rmrKcal: 1_750, tefKcal: 0, activityKcal: -1 }],
  ])("rejects %s", (_label, input) => {
    expect(() => calculateBaseTdee(input)).toThrow(RangeError);
  });

  it.each([
    ["RMR", { rmrKcal: Number.NaN, tefKcal: 0, activityKcal: 0 }],
    ["TEF", { rmrKcal: 1_750, tefKcal: Number.POSITIVE_INFINITY, activityKcal: 0 }],
    ["Activity", { rmrKcal: 1_750, tefKcal: 0, activityKcal: Number.NaN }],
  ])("rejects non-finite %s", (_label, input) => {
    expect(() => calculateBaseTdee(input)).toThrow(TypeError);
  });
});
