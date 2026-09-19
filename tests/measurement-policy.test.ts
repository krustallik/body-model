import { Prisma, type PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import {
  ABSENT_ZERO_MEASUREMENT_FIELDS,
  ACTIVITY_PRESERVE_ZERO_FIELDS,
  normalizeDailyMeasurements,
  prepareDailyMeasurementsForWrite,
  roundDailyMetricFractions,
} from "@/modules/days/measurement-policy";
import { HealthDaySchema } from "@/modules/health/health.schema";
import { CreateDailyMetricSchema, UpdateDailyMetricSchema } from "@/modules/days/day.schema";
import { DailyMetricRepository } from "@/modules/days/day.repository";
import { ModelEpisodeRepository } from "@/modules/model-episodes/model-episode.repository";
import { buildSimulationDays } from "@/modules/model-episodes/simulation-input-builder";

describe("field-specific zero measurement semantics", () => {
  it.each(ABSENT_ZERO_MEASUREMENT_FIELDS)("collapses nutrition/weight zero for %s", (field) => {
    const date = "2026-09-15";
    expect(HealthDaySchema.parse({ date, [field]: 0 })).toEqual({ date, [field]: null });
    expect(CreateDailyMetricSchema.parse({ date, [field]: "0,0" })).toEqual({ date, [field]: null });
    expect(UpdateDailyMetricSchema.parse({ [field]: 0 })).toEqual({ [field]: null });
    expect(normalizeDailyMeasurements({ [field]: 0 })).toEqual({ [field]: null });
  });

  it.each(ACTIVITY_PRESERVE_ZERO_FIELDS)("preserves observed activity zero for %s", (field) => {
    const date = "2026-09-15";
    expect(HealthDaySchema.parse({ date, [field]: 0 })).toEqual({ date, [field]: 0 });
    expect(CreateDailyMetricSchema.parse({ date, [field]: "0" })).toEqual({ date, [field]: 0 });
    expect(CreateDailyMetricSchema.parse({ date, [field]: "0.0" })).toEqual({ date, [field]: 0 });
    expect(UpdateDailyMetricSchema.parse({ [field]: 0 })).toEqual({ [field]: 0 });
    expect(normalizeDailyMeasurements({ [field]: 0 })).toEqual({ [field]: 0 });
  });

  it("treats absent activity keys as missing, not zero", () => {
    const date = "2026-09-15";
    expect(HealthDaySchema.parse({ date })).toEqual({ date });
    expect(normalizeDailyMeasurements({ date, caloriesKcal: 2_000 })).not.toHaveProperty("walkingDistanceKm");
    expect(normalizeDailyMeasurements({ date, caloriesKcal: 2_000 })).not.toHaveProperty("strengthTrainingMinutes");
  });

  it("preserves omitted fields, positive measurements, and unrelated zeros", () => {
    const input = {
      steps: 0,
      walkingDistanceKm: new Prisma.Decimal(0),
      proteinG: 12,
      breakMinutes: 0,
      rawPayload: { steps: 0 },
    };
    expect(normalizeDailyMeasurements(input)).toEqual(input);
    expect(normalizeDailyMeasurements({ caloriesKcal: 0, proteinG: 0 })).toEqual({
      caloriesKcal: null,
      proteinG: null,
    });
  });

  it("rounds fractional daily metrics to hundredths on write preparation", () => {
    expect(roundDailyMetricFractions({
      weightKg: 89.456,
      averageWalkingSpeedKmh: 4.7963,
      walkingDistanceKm: 9.915,
      steps: 8_432,
      proteinG: 176.004,
    })).toEqual({
      weightKg: 89.46,
      averageWalkingSpeedKmh: 4.8,
      walkingDistanceKm: 9.92,
      steps: 8_432,
      proteinG: 176,
    });
    expect(prepareDailyMeasurementsForWrite({
      weightKg: 0,
      walkingDistanceKm: 3.333,
      steps: 0,
    })).toEqual({
      weightKg: null,
      walkingDistanceKm: 3.33,
      steps: 0,
    });
  });

  it("keeps full precision and strict weight bounds during schema parse", () => {
    expect(HealthDaySchema.parse({ date: "2026-09-15", walkingDistanceKm: 3.713 })).toEqual({
      date: "2026-09-15",
      walkingDistanceKm: 3.713,
    });
    expect(HealthDaySchema.safeParse({ date: "2026-09-15", weightKg: 19.999 }).success).toBe(false);
    expect(HealthDaySchema.safeParse({ date: "2026-09-15", weightKg: 400.001 }).success).toBe(false);
  });

  it("reads nutrition zeros as absent while preserving activity zeros from storage", async () => {
    const date = "2026-09-15";
    const day = {
      date,
      weightKg: 0,
      bodyFatPercent: new Prisma.Decimal(0),
      caloriesKcal: 0,
      proteinG: 0,
      fatG: 0,
      carbsG: 0,
      steps: 0,
      activeEnergyKcal: 0,
      averageWalkingSpeedKmh: new Prisma.Decimal(0),
      walkingDistanceKm: new Prisma.Decimal(0),
      strengthTrainingMinutes: new Prisma.Decimal(0),
      workouts: [],
      workoutFeedObserved: true,
      updatedAt: new Date("2026-09-15T18:00:00Z"),
    };
    const client = {
      dailyHealthData: { findMany: vi.fn().mockResolvedValue([day]) },
      healthSyncSnapshot: { findMany: vi.fn().mockResolvedValue([]) },
      healthActivityInterval: { findMany: vi.fn().mockResolvedValue([]) },
      workInterval: { findMany: vi.fn().mockResolvedValue([]) },
      workout: { findMany: vi.fn().mockResolvedValue([]) },
    } as unknown as PrismaClient;
    const [dto] = await new DailyMetricRepository(client).list({ limit: 30, offset: 0 });
    expect(dto.caloriesKcal).toBeNull();
    expect(dto.proteinG).toBeNull();
    expect(dto.weightKg).toBeNull();
    expect(dto.bodyFatPercent).toBeNull();
    expect(dto.steps).toBe(0);
    expect(dto.walkingDistanceKm).toBe(0);
    expect(dto.strengthTrainingMinutes).toBe(0);
    expect(dto.averageWalkingSpeedKmh).toBe(0);
    const sources = await new ModelEpisodeRepository(client).loadSources(date, date);
    const [built] = buildSimulationDays({
      from: date,
      to: date,
      sources,
      modelVersion: "bodycast-physiology-v6",
    });
    expect(built.sourceQuality.status).toBe("missing-nutrition");
    expect(built.input.outsideWorkWalkingDistanceKm).toBe(0);
    expect(built.input.strengthTrainingMinutes).toBe(0);
    expect(day.strengthTrainingMinutes.isZero()).toBe(true);
  });

  it("recovers legacy rest-day coverage from that day's raw Shortcut payload", async () => {
    const date = "2026-09-15";
    const day = {
      date,
      weightKg: 91.1,
      bodyFatPercent: new Prisma.Decimal(28),
      caloriesKcal: 2_889,
      proteinG: 176,
      fatG: 113,
      carbsG: 293,
      averageWalkingSpeedKmh: new Prisma.Decimal(4.7963),
      walkingDistanceKm: new Prisma.Decimal(9.915),
      strengthTrainingMinutes: null,
      workoutFeedObserved: null,
      rawPayload: {
        Date: date,
        Trainingtype: "",
        Trainingactivekcal: "",
        Strengthtrainingminutes: "",
      },
    };
    const client = {
      dailyHealthData: { findMany: vi.fn().mockResolvedValue([day]) },
      healthSyncSnapshot: { findMany: vi.fn().mockResolvedValue([]) },
      healthActivityInterval: { findMany: vi.fn().mockResolvedValue([]) },
      workInterval: { findMany: vi.fn().mockResolvedValue([]) },
      workout: { findMany: vi.fn().mockResolvedValue([]) },
    } as unknown as PrismaClient;

    const sources = await new ModelEpisodeRepository(client).loadSources(date, date);
    const [built] = buildSimulationDays({
      from: date,
      to: date,
      sources,
      modelVersion: "bodycast-physiology-v6",
    });

    expect(sources.days[0].workoutFeedObserved).toBe(true);
    expect(built.input.strengthTrainingMinutes).toBe(0);
    expect(built.sourceQuality.status).toBe("complete");
  });
});
