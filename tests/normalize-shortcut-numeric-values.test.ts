import { describe, expect, it } from "vitest";
import {
  normalizeShortcutNumericValues,
  parseShortcutNumber,
  parseShortcutStrengthTrainingMinutes,
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

describe("parseShortcutStrengthTrainingMinutes", () => {
  it.each([
    ["21. 8. 2026, 13:01 21. 8. 2026, 14:16", 75],
    ["21.8.2026, 13:01 → 21.8.2026, 14:16", 75],
    ["21. 8. 2026, 18:00 - 21. 8. 2026, 18:45", 45],
  ])("calculates a same-day workout from %j", (input, expected) => {
    expect(parseShortcutStrengthTrainingMinutes(input, "2026-08-21")).toBe(expected);
  });

  it("returns zero when the latest workout started on another day", () => {
    expect(
      parseShortcutStrengthTrainingMinutes(
        "21. 8. 2026, 13:01 21. 8. 2026, 14:16",
        "2026-08-22",
      ),
    ).toBe(0);
  });

  it.each(["", " ", "\t\n"])("treats an empty workout value %j as no workout today", (input) => {
    expect(parseShortcutStrengthTrainingMinutes(input, "2026-08-22")).toBe(0);
  });

  it.each([
    "not a workout",
    "21. 8. 2026, 13:01",
    "21. 8. 2026, 14:16 21. 8. 2026, 13:01",
    "32. 8. 2026, 13:01 32. 8. 2026, 14:16",
  ])("leaves malformed workout value %j for Zod", (input) => {
    expect(parseShortcutStrengthTrainingMinutes(input, "2026-08-21")).toBe(input);
  });

  it.each([[65, 65], ["65", 65], ["65,5", 65.5], [null, null]])(
    "retains backward-compatible numeric value %j",
    (input, expected) => {
      expect(parseShortcutStrengthTrainingMinutes(input, "2026-08-21")).toBe(expected);
    },
  );
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

  it("derives strength training duration using the canonical day date", () => {
    expect(normalizeShortcutNumericValues({
      days: [{
        date: "2026-08-21",
        strengthTrainingMinutes: "21. 8. 2026, 13:01 21. 8. 2026, 14:16",
      }],
    })).toEqual({ days: [{ date: "2026-08-21", strengthTrainingMinutes: 75 }] });
  });
});
