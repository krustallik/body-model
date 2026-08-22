import { describe, expect, it } from "vitest";
import { HealthSyncRequestSchema } from "@/modules/health/health.schema";

const validDay = { date: "2026-08-21" };
const validWorkout = {
  type: "strength_training",
  startAt: "2026-08-21T17:10:00+02:00",
  endAt: "2026-08-21T18:15:00+02:00",
  durationMinutes: 65,
  energyKcal: 340,
};

const parse = (days: unknown[]) => HealthSyncRequestSchema.safeParse({ days });

describe("HealthSyncRequestSchema", () => {
  it("accepts one day with missing optional values", () => {
    expect(parse([validDay]).success).toBe(true);
  });

  it("accepts seven unique calendar days", () => {
    const days = Array.from({ length: 7 }, (_, index) => ({ date: `2026-08-${15 + index}` }));
    expect(parse(days).success).toBe(true);
  });

  it("accepts null optional values and an empty workout list", () => {
    expect(
      parse([{
        ...validDay,
        weightKg: null,
        bodyFatPercent: null,
        steps: null,
        activeEnergyKcal: null,
        averageWalkingSpeedKmh: null,
        walkingDistanceKm: null,
        strengthTrainingMinutes: null,
        workouts: [],
      }]).success,
    ).toBe(true);
  });

  it.each([0, 65, 65.5, 600])("accepts strengthTrainingMinutes value %s", (strengthTrainingMinutes) => {
    expect(parse([{ ...validDay, strengthTrainingMinutes }]).success).toBe(true);
  });

  it.each([-0.01, 600.01])("rejects out-of-range strengthTrainingMinutes value %s", (strengthTrainingMinutes) => {
    expect(parse([{ ...validDay, strengthTrainingMinutes }]).success).toBe(false);
  });

  it.each([
    ["bodyFatPercent", 18.73],
    ["averageWalkingSpeedKmh", 5.2],
    ["averageWalkingSpeedKmh", 0],
    ["walkingDistanceKm", 7.8],
    ["walkingDistanceKm", 0],
  ])("accepts valid %s value %s without rounding", (field, value) => {
    const result = parse([{ ...validDay, [field]: value }]);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.days[0]?.[field as keyof typeof result.data.days[0]]).toBe(value);
  });

  it.each([
    ["bodyFatPercent", -0.01],
    ["bodyFatPercent", 70.01],
    ["averageWalkingSpeedKmh", -0.01],
    ["averageWalkingSpeedKmh", 20.01],
    ["walkingDistanceKm", -0.01],
    ["walkingDistanceKm", 200.01],
  ])("rejects out-of-range %s value %s", (field, value) => {
    expect(parse([{ ...validDay, [field]: value }]).success).toBe(false);
  });

  it.each([
    ["empty days", []],
    ["more than seven days", Array.from({ length: 8 }, (_, index) => ({ date: `2026-08-${10 + index}` }))],
  ])("rejects %s", (_name, days) => {
    expect(parse(days).success).toBe(false);
  });

  it("rejects duplicate dates", () => {
    expect(parse([validDay, validDay]).success).toBe(false);
  });

  it.each(["21-08-2026", "2026-8-21", "2026-08-21T00:00:00Z", "2026-99-99"])(
    "rejects invalid date format/value %s",
    (date) => expect(parse([{ date }]).success).toBe(false),
  );

  it.each(["2026-02-29", "2026-04-31", "2026-00-10", "2026-01-00"])(
    "rejects nonexistent calendar date %s",
    (date) => expect(parse([{ date }]).success).toBe(false),
  );

  it("accepts leap day when it exists", () => {
    expect(parse([{ date: "2028-02-29" }]).success).toBe(true);
  });

  it.each([
    ["caloriesKcal", -1],
    ["proteinG", -1],
    ["fatG", -1],
    ["carbsG", -1],
    ["steps", -1],
    ["activeEnergyKcal", -1],
  ])("rejects invalid negative %s", (field, value) => {
    expect(parse([{ ...validDay, [field]: value }]).success).toBe(false);
  });

  it("rejects fractional steps", () => {
    expect(parse([{ ...validDay, steps: 1.5 }]).success).toBe(false);
  });

  it.each([19.999, 400.001])("rejects weight outside boundaries: %s", (weightKg) => {
    expect(parse([{ ...validDay, weightKg }]).success).toBe(false);
  });

  it.each([20, 400])("accepts weight boundary: %s", (weightKg) => {
    expect(parse([{ ...validDay, weightKg }]).success).toBe(true);
  });

  it.each([
    ["caloriesKcal", 20000],
    ["proteinG", 2000],
    ["steps", 200000],
    ["activeEnergyKcal", 10000],
  ])("accepts maximum %s", (field, value) => {
    expect(parse([{ ...validDay, [field]: value }]).success).toBe(true);
  });

  it.each([
    ["caloriesKcal", 20000.01],
    ["proteinG", 2000.01],
    ["steps", 200001],
    ["activeEnergyKcal", 10000.01],
  ])("rejects huge %s", (field, value) => {
    expect(parse([{ ...validDay, [field]: value }]).success).toBe(false);
  });

  it("accepts workout timestamps with different offsets when chronological", () => {
    const workout = {
      ...validWorkout,
      startAt: "2026-08-21T23:30:00-04:00",
      endAt: "2026-08-22T05:00:00+01:00",
    };
    expect(parse([{ ...validDay, workouts: [workout] }]).success).toBe(true);
  });

  it.each(["not-a-date", "2026-08-21 17:10:00", "2026-08-21T17:10:00"])(
    "rejects invalid or timezone-less workout timestamp %s",
    (startAt) => {
      expect(parse([{ ...validDay, workouts: [{ ...validWorkout, startAt }] }]).success).toBe(false);
    },
  );

  it("rejects endAt earlier than startAt after offset normalization", () => {
    const workout = {
      ...validWorkout,
      startAt: "2026-08-21T18:00:00+02:00",
      endAt: "2026-08-21T15:59:59Z",
    };
    expect(parse([{ ...validDay, workouts: [workout] }]).success).toBe(false);
  });

  it("accepts equal startAt and endAt with zero duration", () => {
    const workout = { ...validWorkout, endAt: validWorkout.startAt, durationMinutes: 0 };
    expect(parse([{ ...validDay, workouts: [workout] }]).success).toBe(true);
  });

  it("rejects unknown fields instead of silently losing raw payload data", () => {
    expect(parse([{ ...validDay, mysteryMetric: 42 }]).success).toBe(false);
  });
});
