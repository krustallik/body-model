import { describe, expect, it } from "vitest";
import { calculateWalkingActivity, walkingMetForSpeed } from "@/model/activity/walking";

describe("calculateWalkingActivity", () => {
  // Scientific regression: 2024 Adult Compendium level-walking MET bands.
  // https://pacompendium.com/walking/
  it("returns zero for an explicit zero distance without inventing speed", () => {
    expect(calculateWalkingActivity({ weightKg: 80, rmrKcalPerDay: 1_920, distanceKm: 0, averageSpeedKmh: null })).toBe(0);
  });

  it.each([
    ["slow", { weightKg: 80, rmrKcalPerDay: 1_920, distanceKm: 3, averageSpeedKmh: 3 }, 104],
    ["normal", { weightKg: 80, rmrKcalPerDay: 1_920, distanceKm: 5, averageSpeedKmh: 5 }, 224],
    ["brisk", { weightKg: 80, rmrKcalPerDay: 1_920, distanceKm: 6, averageSpeedKmh: 6 }, 304],
  ])("calculates representative %s level walking", (_label, input, expected) => {
    expect(calculateWalkingActivity(input)).toBeCloseTo(expected, 10);
  });

  it("preserves decimal weight, distance and speed", () => {
    expect(calculateWalkingActivity({
      weightKg: 72.5,
      rmrKcalPerDay: 1_740,
      distanceKm: 4.75,
      averageSpeedKmh: 4.75,
    })).toBeCloseTo(145, 10);
  });

  it("returns unavailable for positive distance with missing speed", () => {
    expect(calculateWalkingActivity({ weightKg: 80, rmrKcalPerDay: 1_920, distanceKm: 2, averageSpeedKmh: null })).toBeNull();
  });

  it("returns unavailable for missing distance", () => {
    expect(calculateWalkingActivity({ weightKg: 80, rmrKcalPerDay: 1_920, distanceKm: undefined, averageSpeedKmh: 5 })).toBeNull();
  });

  it.each([
    ["negative distance", { weightKg: 80, rmrKcalPerDay: 1_920, distanceKm: -1, averageSpeedKmh: 5 }],
    ["negative speed", { weightKg: 80, rmrKcalPerDay: 1_920, distanceKm: 1, averageSpeedKmh: -1 }],
    ["zero speed with positive distance", { weightKg: 80, rmrKcalPerDay: 1_920, distanceKm: 1, averageSpeedKmh: 0 }],
    ["unsupported walking speed", { weightKg: 80, rmrKcalPerDay: 1_920, distanceKm: 1, averageSpeedKmh: 9 }],
    ["invalid weight", { weightKg: 0, rmrKcalPerDay: 1_920, distanceKm: 1, averageSpeedKmh: 5 }],
    ["invalid RMR", { weightKg: 80, rmrKcalPerDay: 0, distanceKm: 0, averageSpeedKmh: null }],
  ])("rejects %s", (_label, input) => {
    expect(() => calculateWalkingActivity(input)).toThrow(RangeError);
  });

  it.each([
    ["weightKg", Number.NaN],
    ["weightKg", Number.POSITIVE_INFINITY],
    ["distanceKm", Number.NaN],
    ["distanceKm", Number.POSITIVE_INFINITY],
    ["averageSpeedKmh", Number.NaN],
    ["averageSpeedKmh", Number.NEGATIVE_INFINITY],
  ])("rejects non-finite %s", (field, value) => {
    expect(() => calculateWalkingActivity({
      weightKg: field === "weightKg" ? value : 80,
      rmrKcalPerDay: 1_920,
      distanceKm: field === "distanceKm" ? value : 5,
      averageSpeedKmh: field === "averageSpeedKmh" ? value : 5,
    })).toThrow(TypeError);
  });
});

describe("walkingMetForSpeed", () => {
  it.each([
    [3.1999, 2.3],
    [3.2, 2.8],
    [4.0, 3.0],
    [4.8, 3.8],
    [5.6, 4.8],
    [6.4, 5.5],
    [7.2, 7.0],
    [8.0, 8.5],
    [8.9, 8.5],
  ])("selects the MET band at %s km/h", (speed, met) => {
    expect(walkingMetForSpeed(speed)).toBe(met);
  });
});
