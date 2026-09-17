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

  it.each(["", " ", "\t\n"])("normalizes an empty metric %j to null", (input) => {
    expect(parseShortcutNumber(input)).toBeNull();
  });

  it.each([
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
  it("normalizes the production nested-JSON HR and resting-HR Shortcut representation", () => {
    const payload = { days: [{ date: "2026-09-17", bpm: JSON.stringify({
      bpm: "69\\n69\\n68", timestamps: "2026-09-15T00:00:00+02:00\\n2026-09-15T00:02:00+02:00\\n2026-09-15T00:04:00+02:00",
    }), bpminpeace: JSON.stringify({
      timestamps: "2026-09-13T00:00:00+02:00\\n2026-09-14T00:00:00+02:00", bvminpeace: "68\\n57",
    }) }] };
    expect(normalizeShortcutNumericValues(payload)).toMatchObject({ days: [{
      bpm: { timestamps: ["2026-09-15T00:00:00+02:00", "2026-09-15T00:02:00+02:00", "2026-09-15T00:04:00+02:00"], bpm: [69, 69, 68] },
      bpminpeace: { timestamps: ["2026-09-13T00:00:00+02:00", "2026-09-14T00:00:00+02:00"], bpminpeace: [68, 57] },
    }] });
  });

  it("handles a production-sized 1623-sample HR series and five resting samples", () => {
    const timestamps = Array.from({ length: 1623 }, (_, index) => `2026-09-15T00:${String(Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}+02:00`);
    const bpm = Array.from({ length: 1623 }, (_, index) => String(60 + index % 20));
    const normalized = normalizeShortcutNumericValues({ days: [{ date: "2026-09-17", bpm: JSON.stringify({ timestamps: timestamps.join("\\n"), bpm: bpm.join("\\n") }), bpminpeace: JSON.stringify({ timestamps: timestamps.slice(0, 5).join("\\n"), bvminpeace: "68\\n57\\n61\\n62\\n60" }) }] }) as { days: Array<{ bpm: { timestamps: string[]; bpm: number[] }; bpminpeace: { timestamps: string[]; bpminpeace: number[] } }> };
    expect(normalized.days[0]!.bpm.bpm).toHaveLength(1623);
    expect(normalized.days[0]!.bpminpeace.bpminpeace).toEqual([68, 57, 61, 62, 60]);
  });
  it("normalizes the real newline-separated Shortcut heart-rate payload into canonical arrays", () => {
    expect(normalizeShortcutNumericValues({ days: [{
      date: "2026-09-17",
      bpm: { timestamps: "2026-09-17T08:00:00+02:00\n\n2026-09-17T08:02:00+02:00", bpm: "61\n\n63" },
      bpminpeace: { timestamps: "2026-09-17T00:00:00+02:00", bpminpeace: "57" },
    }] })).toEqual({ days: [{
      date: "2026-09-17",
      bpm: { timestamps: ["2026-09-17T08:00:00+02:00", "2026-09-17T08:02:00+02:00"], bpm: [61, 63] },
      bpminpeace: { timestamps: ["2026-09-17T00:00:00+02:00"], bpminpeace: [57] },
    }] });
  });

  it("recovers glued ISO timestamps and unambiguously glued bpm values", () => {
    expect(normalizeShortcutNumericValues({ days: [{
      date: "2026-09-17",
      bpm: { timestamps: "2026-09-17T08:00:00+02:002026-09-17T08:02:00+02:00", bpm: "6163" },
    }] })).toEqual({ days: [{
      date: "2026-09-17",
      bpm: { timestamps: ["2026-09-17T08:00:00+02:00", "2026-09-17T08:02:00+02:00"], bpm: [61, 63] },
    }] });
  });
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

  it("normalizes empty day and workout metrics without treating them as zero", () => {
    expect(normalizeShortcutNumericValues({
      days: [{
        date: "2026-08-23",
        weightKg: "",
        averageWalkingSpeedKmh: " ",
        walkingDistanceKm: "\t",
        strengthTrainingMinutes: "",
        workouts: [{ durationMinutes: "", energyKcal: " " }],
      }],
    })).toEqual({
      days: [{
        date: "2026-08-23",
        weightKg: null,
        averageWalkingSpeedKmh: null,
        walkingDistanceKm: null,
        strengthTrainingMinutes: 0,
        workouts: [{ durationMinutes: null, energyKcal: null }],
      }],
    });
  });
});
