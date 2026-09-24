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
    findMany: vi.fn().mockResolvedValue([]),
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
  };
  const strengthDiarySession = {
    findMany: vi.fn().mockResolvedValue([]),
  };
  const client = {
    dailyHealthData,
    workout,
    strengthDiarySession,
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback({
      dailyHealthData,
      workout,
    })),
  } as unknown as PrismaClient;
  const shadowReplayer = { replayFrom: vi.fn().mockResolvedValue(undefined) };
  return {
    repository: new DailyMetricRepository(client, shadowReplayer),
    dailyHealthData,
    workout,
    strengthDiarySession,
    client,
    shadowReplayer,
  };
}

describe("DailyMetricRepository", () => {
  it("lists newest records with filters and serializes Prisma decimals", async () => {
    const { repository, dailyHealthData } = fixture();
    const days = await repository.list({ from: "2026-08-01", to: "2026-08-22", limit: 30, offset: 0, includeTrainingDays: true });

    expect(dailyHealthData.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { date: { gte: "2026-08-01", lte: "2026-08-22" } },
      orderBy: { date: "desc" },
      take: 30,
      skip: 0,
    }));
    expect(days[0]).toMatchObject({
      bodyFatPercent: 27.4,
      strengthTrainingMinutes: 75,
      totalWorkoutMinutes: 0,
      workoutSource: "none",
      trainingDayFact: { eventCount: 0, durationMinutes: 0 },
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
        status: "COMPLETED",
        entryMode: "LIVE",
        webStartedAt: new Date("2026-08-22T08:44:00.000Z"),
        webEndedAt: new Date("2026-08-22T09:46:00.000Z"),
        program: { name: "Push A" },
        exercises: [{ _count: { sets: 1 } }],
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

    const [day] = await repository.list({ from: "2026-08-22", to: "2026-08-22", limit: 30, offset: 0, includeTrainingDays: true });

    expect(strengthDiarySession.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ entryMode: "LIVE", matchedWorkoutId: null }),
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

  it("returns a Workout event independently of a DailyHealthData row", async () => {
    const { repository, dailyHealthData, workout } = fixture();
    dailyHealthData.findMany.mockResolvedValue([]);
    workout.findMany.mockResolvedValue([{
      id: 77,
      sourceIdentity: "ext:garmin-77",
      type: "Traditional Strength Training",
      startAt: new Date("2026-08-22T22:30:00.000Z"),
      endAt: new Date("2026-08-22T23:30:00.000Z"),
      durationMinutes: 60,
      activeEnergyKcal: null,
      hiddenFromHistory: false,
      matchedDiarySession: null,
    }]);

    const result = await repository.listWithTrainingFacts({
      from: "2026-08-23",
      to: "2026-08-23",
      limit: 30,
      offset: 0,
      includeTrainingDays: true,
    });

    expect(result.days).toEqual([]);
    expect(result.trainingDays).toMatchObject([{
      date: "2026-08-23",
      eventCount: 1,
      durationMinutes: 60,
      events: [{ workoutId: 77, exerciseDetailAvailability: "unavailable", loggedSetCount: null }],
    }]);
  });

  it("returns explicit zero facts for every requested calendar date", async () => {
    const { repository, dailyHealthData } = fixture();
    dailyHealthData.findMany.mockResolvedValue([]);

    const result = await repository.listWithTrainingFacts({
      from: "2026-08-22",
      to: "2026-08-24",
      limit: 30,
      offset: 0,
      includeTrainingDays: true,
    });

    expect(result.trainingDays.map((fact) => [fact.date, fact.eventCount, fact.durationMinutes])).toEqual([
      ["2026-08-24", 0, 0],
      ["2026-08-23", 0, 0],
      ["2026-08-22", 0, 0],
    ]);
  });

  it("materializes the maximum supported range with one fact query, not one query per date", async () => {
    const { repository, dailyHealthData, workout, strengthDiarySession } = fixture();
    dailyHealthData.findMany.mockResolvedValue([]);

    const result = await repository.listWithTrainingFacts({
      from: "2024-01-01",
      to: "2024-12-31",
      limit: 100,
      offset: 0,
      includeTrainingDays: true,
    });

    expect(result.trainingDays).toHaveLength(366);
    expect(result.trainingDays[0]).toMatchObject({ date: "2024-12-31", eventCount: 0, durationMinutes: 0 });
    expect(result.trainingDays.at(-1)).toMatchObject({ date: "2024-01-01", eventCount: 0, durationMinutes: 0 });
    expect(workout.findMany).toHaveBeenCalledTimes(1);
    expect(strengthDiarySession.findMany).toHaveBeenCalledTimes(1);
  });

  it("keeps long Health-only pages bounded and rejects oversized direct zero-fact materialization", async () => {
    const { repository, dailyHealthData, workout, strengthDiarySession } = fixture();
    dailyHealthData.findMany.mockResolvedValue([record]);

    const healthOnly = await repository.listWithTrainingFacts({
      from: "0100-01-01",
      to: "9999-12-31",
      limit: 100,
      offset: 0,
      includeTrainingDays: false,
    });
    expect(healthOnly.days).toHaveLength(1);
    expect(healthOnly.days[0]?.weightKg).toBe(89.4);
    expect(healthOnly.trainingDays).toEqual([]);
    expect(workout.findMany).toHaveBeenCalledTimes(1);
    expect(strengthDiarySession.findMany).toHaveBeenCalledTimes(1);

    await expect(repository.trainingDayFactsForRange("2025-01-01", "2026-01-02"))
      .rejects.toThrow(/must not exceed 366 calendar days/);
    expect(workout.findMany).toHaveBeenCalledTimes(1);
  });

  it("limits later paginated fact reads to page dates and skips empty terminal pages", async () => {
    const { repository, dailyHealthData, workout } = fixture();
    const page = await repository.listWithTrainingFacts({
      from: "2026-08-01",
      to: "2026-08-31",
      limit: 30,
      offset: 30,
      includeTrainingDays: false,
    });

    expect(workout.findMany).toHaveBeenCalledTimes(1);
    expect(workout.findMany.mock.calls[0]?.[0]).toMatchObject({
      where: { startAt: { gte: new Date("2026-08-21T22:00:00.000Z"), lt: new Date("2026-08-22T22:00:00.000Z") } },
    });
    expect(page.trainingDays).toEqual([]);

    dailyHealthData.findMany.mockResolvedValue([]);
    await repository.listWithTrainingFacts({
      to: "2026-08-31",
      limit: 30,
      offset: 100,
      includeTrainingDays: false,
    });
    expect(workout.findMany).toHaveBeenCalledTimes(1);
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
    const { repository, dailyHealthData, shadowReplayer } = fixture();
    await repository.update(record.date, { weightKg: 88.5, proteinG: null });
    expect(dailyHealthData.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { date: record.date },
      data: { weightKg: 88.5, proteinG: null },
    }));
    expect(dailyHealthData.update.mock.calls[0]?.[0].data).not.toHaveProperty("rawPayload");
    expect(shadowReplayer.replayFrom).toHaveBeenCalledWith(record.date);
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
          deleteMany: { hiddenFromHistory: false },
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
    const { repository, dailyHealthData, workout, shadowReplayer } = fixture();
    await expect(repository.delete(record.date)).resolves.toBe(true);
    expect(workout.deleteMany).toHaveBeenCalledWith({ where: { dailyHealthDataId: 42 } });
    expect(dailyHealthData.delete).toHaveBeenCalledWith({ where: { id: 42 } });
    expect(shadowReplayer.replayFrom).toHaveBeenCalledWith(record.date);
  });
});
