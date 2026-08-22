import { Prisma, type PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { DuplicateDayError } from "@/modules/days/day.errors";
import { DailyMetricRepository } from "@/modules/days/day.repository";

const record = {
  date: "2026-08-22",
  weightKg: 89.4,
  bodyFatPercent: new Prisma.Decimal("27.4"),
  caloriesKcal: null,
  proteinG: 59,
  fatG: 15,
  carbsG: 56,
  steps: 23,
  activeEnergyKcal: null,
  averageWalkingSpeedKmh: new Prisma.Decimal("4.572"),
  walkingDistanceKm: new Prisma.Decimal("0.0125"),
  strengthTrainingMinutes: new Prisma.Decimal("75"),
  updatedAt: new Date("2026-08-22T10:00:00Z"),
};

function fixture() {
  const dailyHealthData = {
    findMany: vi.fn().mockResolvedValue([record]),
    findFirst: vi.fn().mockResolvedValue({ updatedAt: record.updatedAt }),
    create: vi.fn().mockResolvedValue(record),
    update: vi.fn().mockResolvedValue(record),
    deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
  };
  const client = { dailyHealthData } as unknown as PrismaClient;
  return { repository: new DailyMetricRepository(client), dailyHealthData };
}

describe("DailyMetricRepository", () => {
  it("lists newest records with filters and serializes Prisma decimals", async () => {
    const { repository, dailyHealthData } = fixture();
    const days = await repository.list({ from: "2026-08-01", to: "2026-08-22", limit: 30, offset: 0 });

    expect(dailyHealthData.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { date: { gte: "2026-08-01", lte: "2026-08-22" } },
      orderBy: { date: "desc" },
      take: 30,
      skip: 0,
    }));
    expect(days[0]).toMatchObject({ bodyFatPercent: 27.4, strengthTrainingMinutes: 75 });
  });

  it("marks manually created rows without inventing metric values", async () => {
    const { repository, dailyHealthData } = fixture();
    await repository.create({ date: record.date, caloriesKcal: null, steps: 0 });
    expect(dailyHealthData.create).toHaveBeenCalledWith(expect.objectContaining({
      data: { date: record.date, caloriesKcal: null, steps: 0, rawPayload: { source: "manual" } },
    }));
  });

  it("reads the latest update timestamp without mutating records", async () => {
    const { repository, dailyHealthData } = fixture();
    await expect(repository.latestUpdatedAt()).resolves.toBe("2026-08-22T10:00:00.000Z");
    expect(dailyHealthData.findFirst).toHaveBeenCalledWith({
      orderBy: { updatedAt: "desc" },
      select: { updatedAt: true },
    });
    expect(dailyHealthData.update).not.toHaveBeenCalled();
  });

  it("maps a unique-date violation to DuplicateDayError", async () => {
    const { repository, dailyHealthData } = fixture();
    dailyHealthData.create.mockRejectedValue({ code: "P2002" });
    await expect(repository.create({ date: record.date })).rejects.toBeInstanceOf(DuplicateDayError);
  });

  it("updates only supplied metrics and preserves rawPayload", async () => {
    const { repository, dailyHealthData } = fixture();
    await repository.update(record.date, { weightKg: 88.5, proteinG: null });
    expect(dailyHealthData.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { date: record.date },
      data: { weightKg: 88.5, proteinG: null },
    }));
    expect(dailyHealthData.update.mock.calls[0]?.[0].data).not.toHaveProperty("rawPayload");
  });

  it("returns null for a missing update and false for a missing delete", async () => {
    const { repository, dailyHealthData } = fixture();
    dailyHealthData.update.mockRejectedValue({ code: "P2025" });
    dailyHealthData.deleteMany.mockResolvedValue({ count: 0 });
    await expect(repository.update(record.date, { steps: 1 })).resolves.toBeNull();
    await expect(repository.delete(record.date)).resolves.toBe(false);
  });
});
