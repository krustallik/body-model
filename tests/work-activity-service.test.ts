import { Prisma, type PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import {
  estimateWorkActivityForDay,
  getWorkActivityDiagnosticsForDay,
} from "@/modules/work-intervals/work-activity.service";

function clientFixture(options: { missingDay?: boolean; useReceivedAt?: boolean } = {}) {
  const times = ["08:05", "16:05", "22:00"];
  const steps = [1_200, 4_700, 7_200];
  const distances = [0.8, 3.3, 5.1];
  return {
    profile: {
      findUnique: vi.fn().mockResolvedValue({
        sex: "male",
        dateOfBirth: new Date("1990-05-12T00:00:00Z"),
        heightCm: new Prisma.Decimal("180"),
      }),
    },
    dailyHealthData: {
      findUnique: vi.fn().mockResolvedValue(options.missingDay ? null : {
        weightKg: 80,
        walkingDistanceKm: new Prisma.Decimal("5.1"),
        averageWalkingSpeedKmh: new Prisma.Decimal("5.2"),
        strengthTrainingMinutes: new Prisma.Decimal("30"),
      }),
    },
    healthSyncSnapshot: {
      findMany: vi.fn().mockResolvedValue(times.map((time, index) => ({
        receivedAt: new Date(`2026-08-23T${time}:00Z`),
        syncedAt: options.useReceivedAt ? null : new Date(`2026-08-23T${time}:00Z`),
        steps: steps[index],
        walkingDistanceKm: new Prisma.Decimal(String(distances[index])),
      }))),
    },
    workInterval: {
      findMany: vi.fn().mockResolvedValue([{
        id: 1,
        startAt: new Date("2026-08-23T08:00:00Z"),
        endAt: new Date("2026-08-23T16:00:00Z"),
        category: "standingLight",
        breakMinutes: 30,
      }]),
    },
  } as unknown as PrismaClient;
}

describe("daily work activity orchestration", () => {
  it("uses sync timestamps, subtracts work walking, and combines activity once", async () => {
    const result = await estimateWorkActivityForDay({
      date: "2026-08-23", weightKg: 80, rmrKcalPerDay: 1_800,
    }, clientFixture());
    expect(result.snapshotTimestampPolicy).toBe("syncedAt-or-receivedAt");
    expect(result.walking.workWalkingDistanceKm).toBeCloseTo(2.5, 12);
    expect(result.walking.outsideWorkWalkingDistanceKm).toBeCloseTo(2.6, 12);
    expect(result.occupationalIntervals[0]).toMatchObject({
      id: 1, durationHours: 8, category: "standingLight",
      method: "hybrid-walking-residual", workWalkingDistanceKm: 2.5,
      walkingSpeedKmh: 5.2, fallbackReason: null,
      clockDurationMinutes: 480, breakMinutes: 30, breakSource: "user-entered",
      activeWorkMinutes: 450,
    });
    expect(result.occupationalIntervals[0].activityKcal).toBeCloseTo(
      result.occupationalIntervals[0].walkingActivityKcal!
      + result.occupationalIntervals[0].residualActivityKcal!,
      12,
    );
    expect(result.activity).not.toBeNull();
    expect(result.activity!.totalActivityKcal).toBeCloseTo(
      result.activity!.occupationalActivityKcal
      + result.activity!.outsideWorkWalkingActivityKcal
      + result.activity!.strengthActivityKcal,
      12,
    );
  });

  it("exposes legacy break provenance without silently applying the UI default", async () => {
    const client = clientFixture() as unknown as {
      workInterval: { findMany: ReturnType<typeof vi.fn> };
    };
    client.workInterval.findMany.mockResolvedValue([{
      id: 1,
      startAt: new Date("2026-08-23T08:00:00Z"),
      endAt: new Date("2026-08-23T16:00:00Z"),
      category: "standingLight",
      breakMinutes: null,
    }]);
    const result = await estimateWorkActivityForDay({
      date: "2026-08-23", weightKg: 80, rmrKcalPerDay: 1_800,
    }, client as unknown as PrismaClient);
    expect(result.occupationalIntervals[0]).toMatchObject({
      breakMinutes: null,
      breakDurationHours: null,
      breakSource: "legacy-unreported",
      activeWorkMinutes: 480,
    });
  });

  it("falls back to server receivedAt when the iPhone sent no explicit sync time", async () => {
    const result = await estimateWorkActivityForDay({
      date: "2026-08-23", weightKg: 80, rmrKcalPerDay: 1_800,
    }, clientFixture({ useReceivedAt: true }));
    expect(result.walking.workWalkingDistanceKm).toBeCloseTo(2.5, 12);
  });

  it("returns unavailable activity when the daily aggregate is missing", async () => {
    const result = await estimateWorkActivityForDay({
      date: "2026-08-23", weightKg: 80, rmrKcalPerDay: 1_800,
    }, clientFixture({ missingDay: true }));
    expect(result.walking.outsideWorkWalkingDistanceKm).toBeNull();
    expect(result.activity).toBeNull();
  });

  it("labels a category-only fallback when boundary reconstruction is unavailable", async () => {
    const client = clientFixture() as unknown as {
      healthSyncSnapshot: { findMany: ReturnType<typeof vi.fn> };
    };
    client.healthSyncSnapshot.findMany.mockResolvedValue([]);
    const result = await estimateWorkActivityForDay({
      date: "2026-08-23", weightKg: 80, rmrKcalPerDay: 1_800,
    }, client as unknown as PrismaClient);
    expect(result.occupationalIntervals[0]).toMatchObject({
      method: "category-only-fallback",
      fallbackReason: "work-walking-unavailable",
      workWalkingDistanceKm: null,
    });
    expect(result.walking.outsideWorkWalkingDistanceKm).toBeNull();
    expect(result.activity).toBeNull();
  });

  it("keeps explicit zero work walking distinct from unavailable", async () => {
    const client = clientFixture() as unknown as {
      healthSyncSnapshot: { findMany: ReturnType<typeof vi.fn> };
    };
    client.healthSyncSnapshot.findMany.mockResolvedValue([
      { receivedAt: new Date("2026-08-23T08:05:00Z"), syncedAt: null,
        steps: 1_200, walkingDistanceKm: new Prisma.Decimal("0.8") },
      { receivedAt: new Date("2026-08-23T16:05:00Z"), syncedAt: null,
        steps: 4_700, walkingDistanceKm: new Prisma.Decimal("0.8") },
      { receivedAt: new Date("2026-08-23T22:00:00Z"), syncedAt: null,
        steps: 7_200, walkingDistanceKm: new Prisma.Decimal("5.1") },
    ]);
    const result = await estimateWorkActivityForDay({
      date: "2026-08-23", weightKg: 80, rmrKcalPerDay: 1_800,
    }, client as unknown as PrismaClient);
    expect(result.walking.workWalkingDistanceKm).toBe(0);
    expect(result.occupationalIntervals[0]).toMatchObject({
      method: "hybrid-walking-residual", workWalkingDistanceKm: 0,
      walkingDurationHours: 0, walkingActivityKcal: 0,
    });
  });

  it("derives RMR from profile and daily weight for the UI endpoint", async () => {
    const result = await getWorkActivityDiagnosticsForDay("2026-08-23", clientFixture());
    expect(result.unavailableReason).toBeNull();
    expect(result.diagnostics?.date).toBe("2026-08-23");
    expect(result.diagnostics?.activity).not.toBeNull();
  });

  it("reports missing profile or daily weight without manufacturing kcal", async () => {
    const missingProfile = clientFixture() as unknown as {
      profile: { findUnique: ReturnType<typeof vi.fn> };
    };
    missingProfile.profile.findUnique.mockResolvedValue(null);
    await expect(getWorkActivityDiagnosticsForDay(
      "2026-08-23", missingProfile as unknown as PrismaClient,
    )).resolves.toMatchObject({ diagnostics: null, unavailableReason: "profile-or-weight-missing" });
    await expect(getWorkActivityDiagnosticsForDay(
      "2026-08-23", clientFixture({ missingDay: true }),
    )).resolves.toMatchObject({ diagnostics: null, unavailableReason: "profile-or-weight-missing" });
  });
});
