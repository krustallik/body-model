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
  workouts: [],
  updatedAt: new Date("2026-08-22T10:00:00Z"),
};

function fixture() {
  const dailyHealthData = {
    findMany: vi.fn().mockResolvedValue([record]),
    findFirst: vi.fn().mockResolvedValue({ updatedAt: record.updatedAt }),
    findUnique: vi.fn().mockResolvedValue({ id: 42 }),
    create: vi.fn().mockResolvedValue(record),
    update: vi.fn().mockResolvedValue(record),
    delete: vi.fn().mockResolvedValue(record),
    deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
  };
  const workout = {
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
  };
  const client = {
    dailyHealthData,
    workout,
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback({
      dailyHealthData,
      workout,
    })),
  } as unknown as PrismaClient;
  return { repository: new DailyMetricRepository(client), dailyHealthData, workout, client };
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
    expect(days[0]).toMatchObject({
      bodyFatPercent: 27.4,
      strengthTrainingMinutes: 75,
      totalWorkoutMinutes: 75,
      workoutSource: "legacy-strength",
      workouts: [],
    });
    expect(dailyHealthData.findMany).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({
        workouts: expect.objectContaining({
          orderBy: { startAt: "asc" },
        }),
      }),
    }));
  });

  it("adds an unmatched diary session to History with its shadow energy, without creating a device workout", async () => {
    const { repository, client } = fixture();
    const strengthDiarySession = {
      findMany: vi.fn().mockResolvedValue([{
        id: 4,
        webStartedAt: new Date("2026-08-22T08:44:00.000Z"),
        webEndedAt: new Date("2026-08-22T09:46:00.000Z"),
        program: { name: "Push A" },
        experimentalStrengthEnergyShadow: {
          result: {
            activeEnergyResolution: {
              estimatedActiveKcal: 311,
              source: "bodycast-diary-estimate",
            },
          },
        },
      }]),
    };
    Object.assign(client as object, { strengthDiarySession });

    const [day] = await repository.list({ from: "2026-08-22", to: "2026-08-22", limit: 30, offset: 0 });

    expect(strengthDiarySession.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: "COMPLETED", matchedWorkoutId: null }),
    }));
    expect(day?.workouts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: undefined,
        type: "Traditional Strength Training",
        startAt: "2026-08-22T08:44:00.000Z",
        endAt: "2026-08-22T09:46:00.000Z",
        durationMinutes: 62,
        activeEnergyKcal: 311,
        energySource: "shadow-diary-estimate",
        diaryOnly: true,
        linkedTrainingSessionId: 4,
        linkedTrainingProgramName: "Push A",
      }),
    ]));
    expect(day?.totalWorkoutMinutes).toBe(62);
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

  it("replaces explicit workouts while clearing legacy daily workout aggregates", async () => {
    const { repository, dailyHealthData } = fixture();
    await repository.update(record.date, {
      workouts: [{
        type: "Strength training",
        startAt: "2026-08-22T10:00:00.000Z",
        durationMinutes: 45,
        activeEnergyKcal: 280,
      }],
    });
    expect(dailyHealthData.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        strengthTrainingMinutes: null,
        activeEnergyKcal: null,
        workouts: {
          deleteMany: {},
          create: [expect.objectContaining({
            type: "Strength training",
            durationMinutes: 45,
            activeEnergyKcal: 280,
            startAt: new Date("2026-08-22T10:00:00.000Z"),
            endAt: new Date("2026-08-22T10:45:00.000Z"),
          })],
        },
      }),
    }));
  });

  it("returns null for a missing update and false for a missing delete", async () => {
    const { repository, dailyHealthData } = fixture();
    dailyHealthData.update.mockRejectedValue({ code: "P2025" });
    dailyHealthData.findUnique.mockResolvedValue(null);
    await expect(repository.update(record.date, { steps: 1 })).resolves.toBeNull();
    await expect(repository.delete(record.date)).resolves.toBe(false);
  });

  it("deletes workouts explicitly before deleting the day row", async () => {
    const { repository, dailyHealthData, workout } = fixture();
    await expect(repository.delete(record.date)).resolves.toBe(true);
    expect(workout.deleteMany).toHaveBeenCalledWith({ where: { dailyHealthDataId: 42 } });
    expect(dailyHealthData.delete).toHaveBeenCalledWith({ where: { id: 42 } });
  });
});
