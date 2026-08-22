import { describe, expect, it } from "vitest";
import {
  normalizeShortcutNumericValues,
  parseShortcutNumber,
} from "@/modules/health/normalize-shortcut-numeric-values";

describe("parseShortcutNumber", () => {
  it.each([
    [89.4, 89.4],
    ["89.4", 89.4],
    ["89,4", 89.4],
    [0, 0],
    ["0", 0],
    ["0.0", 0],
    ["0,0", 0],
    [" 27,4 ", 27.4],
  ])("normalizes %j to %s", (input, expected) => {
    expect(parseShortcutNumber(input)).toBe(expected);
  });

  it.each([
    "",
    " ",
    "abc",
    "27abc",
    "abc27",
    "27%",
    "89kg",
    "89 kg",
    "4.5 km",
    "27,4%",
    "NaN",
    "Infinity",
    "--12",
    "1,234,56",
    "1.234,56",
  ])("leaves invalid string %j unchanged for Zod", (input) => {
    expect(parseShortcutNumber(input)).toBe(input);
  });

  it.each([null, undefined, [], {}, true])("leaves non-string value %j unchanged", (input) => {
    expect(parseShortcutNumber(input)).toEqual(input);
  });
});

describe("normalizeShortcutNumericValues", () => {
  it("normalizes all supported day and workout numeric fields", () => {
    expect(normalizeShortcutNumericValues({ days: [{
      date: "2026-08-22",
      weightKg: "89,4",
      bodyFatPercent: "27,4",
      caloriesKcal: "587,5",
      proteinG: "59,7",
      fatG: "15,3",
      carbsG: "56,8",
      steps: "10234",
      activeEnergyKcal: "400,5",
      averageWalkingSpeedKmh: "4,72",
      walkingDistanceKm: "7,35",
      strengthTrainingMinutes: "65,5",
      workouts: [{ durationMinutes: "60,5", energyKcal: "300,25" }],
    }] })).toEqual({ days: [{
      date: "2026-08-22",
      weightKg: 89.4,
      bodyFatPercent: 27.4,
      caloriesKcal: 587.5,
      proteinG: 59.7,
      fatG: 15.3,
      carbsG: 56.8,
      steps: 10234,
      activeEnergyKcal: 400.5,
      averageWalkingSpeedKmh: 4.72,
      walkingDistanceKm: 7.35,
      strengthTrainingMinutes: 65.5,
      workouts: [{ durationMinutes: 60.5, energyKcal: 300.25 }],
    }] });
  });
});
