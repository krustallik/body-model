import { describe, expect, it } from "vitest";
import {
  CreateDailyMetricSchema,
  DailyMetricListQuerySchema,
  parseNullableNumericInput,
  UpdateDailyMetricSchema,
} from "@/modules/days/day.schema";

describe("daily metric input parsing", () => {
  it.each([
    ["27.4", 27.4],
    ["27,4", 27.4],
    ["0", 0],
    [0, 0],
    ["", null],
    ["   ", null],
    [null, null],
  ])("parses %j as %j", (input, expected) => {
    expect(parseNullableNumericInput(input)).toBe(expected);
  });

  it("parses create metrics while treating empty nutrition as missing and preserving activity zero", () => {
    expect(CreateDailyMetricSchema.parse({
      date: "2026-08-22",
      bodyFatPercent: "27,4",
      caloriesKcal: "",
      steps: "0",
    })).toEqual({
      date: "2026-08-22",
      bodyFatPercent: 27.4,
      caloriesKcal: null,
      steps: 0,
    });
  });

  it("rejects a date field in PATCH data", () => {
    expect(UpdateDailyMetricSchema.safeParse({ date: "2026-08-23", weightKg: 80 }).success).toBe(false);
  });

  it("requires at least one PATCH metric", () => {
    expect(UpdateDailyMetricSchema.safeParse({}).success).toBe(false);
  });

  it("accepts separately editable workouts with their own active energy", () => {
    expect(UpdateDailyMetricSchema.parse({
      workouts: [{
        type: "Traditional Strength Training",
        startAt: "2026-08-23T10:00:00.000Z",
        durationMinutes: "45",
        activeEnergyKcal: "320,5",
      }],
    })).toEqual({
      workouts: [{
        type: "Traditional Strength Training",
        startAt: "2026-08-23T10:00:00.000Z",
        durationMinutes: 45,
        activeEnergyKcal: 320.5,
      }],
    });
  });

  it("validates metric bounds and integer steps", () => {
    expect(UpdateDailyMetricSchema.safeParse({ bodyFatPercent: 101 }).success).toBe(false);
    expect(UpdateDailyMetricSchema.safeParse({ weightKg: -1 }).success).toBe(false);
    expect(UpdateDailyMetricSchema.safeParse({ steps: 1.5 }).success).toBe(false);
  });

  it("parses list pagination parameters", () => {
    expect(DailyMetricListQuerySchema.parse({ limit: "25", offset: "5" })).toMatchObject({ limit: 25, offset: 5 });
  });

  it("bounds explicit zero-fact ranges while retaining longer Health-only and unbounded-history requests", () => {
    expect(DailyMetricListQuerySchema.safeParse({ from: "2024-01-01", to: "2024-12-31" }).success).toBe(true);
    expect(DailyMetricListQuerySchema.safeParse({ from: "2025-01-01", to: "2026-01-02" }).success).toBe(false);
    expect(DailyMetricListQuerySchema.safeParse({ from: "0100-01-01", to: "9999-12-31" }).success).toBe(false);
    expect(DailyMetricListQuerySchema.safeParse({
      from: "0100-01-01",
      to: "9999-12-31",
      includeTrainingDays: "false",
    }).success).toBe(true);
    expect(DailyMetricListQuerySchema.safeParse({ from: "2026-02-30", to: "2026-03-01" }).success).toBe(false);
    expect(DailyMetricListQuerySchema.safeParse({ from: "2026-08-23", to: "2026-08-22" }).success).toBe(false);
    expect(DailyMetricListQuerySchema.safeParse({ to: "2026-08-22" }).success).toBe(true);
  });
});
