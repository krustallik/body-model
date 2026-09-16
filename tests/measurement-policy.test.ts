import { Prisma, type PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { DAILY_MEASUREMENT_FIELDS, normalizeDailyMeasurements } from "@/modules/days/measurement-policy";
import { HealthDaySchema } from "@/modules/health/health.schema";
import { CreateDailyMetricSchema, UpdateDailyMetricSchema } from "@/modules/days/day.schema";
import { DailyMetricRepository } from "@/modules/days/day.repository";
import { ModelEpisodeRepository } from "@/modules/model-episodes/model-episode.repository";
import { buildSimulationDays } from "@/modules/model-episodes/simulation-input-builder";

describe("zero means no recorded daily measurement", () => {
  it.each(DAILY_MEASUREMENT_FIELDS)("normalizes %s in sync, create and update", (field) => {
    const date = "2026-09-15";
    expect(HealthDaySchema.parse({ date, [field]: 0 })).toEqual({ date, [field]: null });
    expect(CreateDailyMetricSchema.parse({ date, [field]: "0,0" })).toEqual({ date, [field]: null });
    expect(UpdateDailyMetricSchema.parse({ [field]: 0 })).toEqual({ [field]: null });
  });

  it("preserves omitted fields, positive measurements, raw payload and unrelated zero values", () => {
    const input = { steps: 0, walkingDistanceKm: new Prisma.Decimal(0), proteinG: 12,
      breakMinutes: 0, rawPayload: { steps: 0 } };
    expect(normalizeDailyMeasurements(input)).toEqual({ ...input, steps: null, walkingDistanceKm: null });
    expect(input.steps).toBe(0);
    expect(input.walkingDistanceKm.isZero()).toBe(true);
    expect(normalizeDailyMeasurements(input)).not.toHaveProperty("fatG");
  });

  it("reads legacy zeros as absent for UI and historical calculations without rewriting raw records", async () => {
    const date = "2026-09-15";
    const day = { date, ...Object.fromEntries(DAILY_MEASUREMENT_FIELDS.map((field) => [field, 0])),
      bodyFatPercent: new Prisma.Decimal(0), averageWalkingSpeedKmh: new Prisma.Decimal(0),
      walkingDistanceKm: new Prisma.Decimal(0), strengthTrainingMinutes: new Prisma.Decimal(0),
      workouts: [],
      updatedAt: new Date("2026-09-15T18:00:00Z") };
    const client = { dailyHealthData: { findMany: vi.fn().mockResolvedValue([day]) },
      healthSyncSnapshot: { findMany: vi.fn().mockResolvedValue([]) },
      workInterval: { findMany: vi.fn().mockResolvedValue([]) },
      workout: { findMany: vi.fn().mockResolvedValue([]) } } as unknown as PrismaClient;
    const [dto] = await new DailyMetricRepository(client).list({ limit: 30, offset: 0 });
    for (const field of DAILY_MEASUREMENT_FIELDS) expect(dto[field]).toBeNull();
    expect(dto.totalWorkoutMinutes).toBeNull();
    expect(dto.workoutSource).toBe("none");
    expect(dto.workouts).toEqual([]);
    const sources = await new ModelEpisodeRepository(client).loadSources(date, date);
    const [built] = buildSimulationDays({ from: date, to: date, sources });
    expect(built.sourceQuality.status).toBe("missing-nutrition");
    expect(built.input.strengthTrainingMinutes).toBeNull();
    expect(built.input.outsideWorkWalkingDistanceKm).toBeNull();
    expect(day.strengthTrainingMinutes.isZero()).toBe(true);
  });
});
