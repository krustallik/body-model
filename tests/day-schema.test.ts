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

  it("parses create metrics while preserving empty and explicit zero", () => {
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

  it("validates metric bounds and integer steps", () => {
    expect(UpdateDailyMetricSchema.safeParse({ bodyFatPercent: 101 }).success).toBe(false);
    expect(UpdateDailyMetricSchema.safeParse({ weightKg: -1 }).success).toBe(false);
    expect(UpdateDailyMetricSchema.safeParse({ steps: 1.5 }).success).toBe(false);
  });

  it("parses list pagination parameters", () => {
    expect(DailyMetricListQuerySchema.parse({ limit: "25", offset: "5" })).toMatchObject({ limit: 25, offset: 5 });
  });
});
