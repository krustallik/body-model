import { describe, expect, it } from "vitest";
import {
  normalizeShortcutRangePayload,
  ShortcutRangeNormalizationError,
} from "@/modules/health/normalize-shortcut-range-payload";
import { MAX_HEALTH_SYNC_CALENDAR_DAYS } from "@/modules/health/health-sync-limits";

const iso = (date: string, time: string) => `${date}T${time}+02:00`;

function payload(overrides: Record<string, unknown> = {}) {
  return {
    days: [{
      date: iso("2026-09-20", "18:44:44"),
      caloriesKcal: {
        Calories: "2341.9\\n2765.15\\n2555.4",
        // First two timestamps are deliberately glued, as with the HR feed.
        timeStamps: `${iso("2026-09-17", "08:31:00")}${iso("2026-09-18", "08:33:00")}\\n${iso("2026-09-19", "18:11:00")}`,
      },
      proteinG: {
        Protein: "174.55\\n165.663\\n196.943",
        timeStamps: `${iso("2026-09-17", "08:31:00")}\\n${iso("2026-09-18", "08:33:00")}\\n${iso("2026-09-19", "18:11:00")}`,
      },
      weightKg: JSON.stringify({
        TimeStamps: `${iso("2026-09-17", "07:00:00")}\\n${iso("2026-09-17", "20:00:00")}\\n${iso("2026-09-18", "07:10:00")}`,
        Weights: "81.4\\n81.1\\n80.9",
      }),
      bodyFatPercent: JSON.stringify({
        timeStamps: `${iso("2026-09-17", "07:00:00")}\\n${iso("2026-09-17", "20:00:00")}`,
        FatPercentage: "21.1\\n20.9",
      }),
      averageWalkingSpeedKmh: JSON.stringify({
        timeStamps: `${iso("2026-09-17", "12:00:00")}\\n${iso("2026-09-17", "18:00:00")}\\n${iso("2026-09-18", "12:00:00")}`,
        speeds: "4.5\\n5.5\\n5",
      }),
      ...overrides,
    }],
  };
}

function consecutiveDates(count: number): string[] {
  return Array.from({ length: count }, (_, index) => (
    new Date(Date.UTC(2026, 7, 21 + index)).toISOString().slice(0, 10)
  ));
}

describe("normalizeShortcutRangePayload", () => {
  it("uses HR-style timestamp recovery and builds sorted daily observations", () => {
    const result = normalizeShortcutRangePayload(payload());
    expect(result).not.toBeNull();
    expect(result?.payload).toEqual({
      syncedAt: iso("2026-09-20", "18:44:44"),
      rangePayload: true,
      days: [
        {
          date: "2026-09-17", caloriesKcal: 2341.9, proteinG: 174.55,
          weightKg: 81.1, bodyFatPercent: 20.9, averageWalkingSpeedKmh: 5,
        },
        { date: "2026-09-18", caloriesKcal: 2765.15, proteinG: 165.663, weightKg: 80.9, averageWalkingSpeedKmh: 5 },
        { date: "2026-09-19", caloriesKcal: 2555.4, proteinG: 196.943 },
      ],
    });
    expect(result?.metricSamplesByDate.get("2026-09-17")).toHaveLength(8);
  });

  it("partitions one latest-N training feed by workout date instead of copying it", () => {
    const result = normalizeShortcutRangePayload(payload({
      trainingType: "Traditional Strength Training\nStair Climbing",
      trainingActiveKcal: "593\n18",
      trainingTimestamps: [
        iso("2026-09-21", "09:45:00"),
        iso("2026-09-22", "09:00:00"),
        iso("2026-09-21", "11:03:00"),
        iso("2026-09-22", "09:12:00"),
      ].join("\n"),
    }));
    const days = (result?.payload as { days: Array<Record<string, unknown>> }).days;
    const sep21 = days.find((day) => day.date === "2026-09-21");
    const sep22 = days.find((day) => day.date === "2026-09-22");
    const sep17 = days.find((day) => day.date === "2026-09-17");

    expect(sep21?.workouts).toEqual([expect.objectContaining({
      type: "Traditional Strength Training",
      externalId: null,
      activeEnergyKcal: 593,
    })]);
    expect(sep22?.workouts).toEqual([expect.objectContaining({
      type: "Stair Climbing",
      externalId: null,
      activeEnergyKcal: 18,
    })]);
    expect(sep17).not.toHaveProperty("workouts");
    expect(sep17).not.toHaveProperty("trainingType");
    expect(sep17).not.toHaveProperty("trainingActiveKcal");
  });

  it("rejects mismatched parallel series before any daily output is produced", () => {
    expect(() => normalizeShortcutRangePayload(payload({ fatG: {
      timeStamps: iso("2026-09-17", "08:00:00"), fat: "20\\n30",
    } }))).toThrow(ShortcutRangeNormalizationError);
  });

  it("rejects malformed embedded JSON", () => {
    expect(() => normalizeShortcutRangePayload(payload({ weightKg: "{not json" }))).toThrow(ShortcutRangeNormalizationError);
  });

  it("rejects more than one nutrition value for a calendar day", () => {
    expect(() => normalizeShortcutRangePayload(payload({ carbsG: {
      timeStamps: `${iso("2026-09-17", "08:00:00")}\\n${iso("2026-09-17", "20:00:00")}`,
      carboHydrates: "50\\n70",
    } }))).toThrow(/exactly one value/);
  });

  it("accepts timestamped backfill for a full calendar month", () => {
    const dates = consecutiveDates(MAX_HEALTH_SYNC_CALENDAR_DAYS);
    const result = normalizeShortcutRangePayload(payload({
      weightKg: JSON.stringify({
        TimeStamps: dates.map((date) => iso(date, "07:00:00")).join("\n"),
        Weights: dates.map(() => "81.4").join("\n"),
      }),
    }));

    expect((result?.payload as { days: unknown[] }).days).toHaveLength(MAX_HEALTH_SYNC_CALENDAR_DAYS);
  });

  it("rejects timestamped backfill beyond one calendar month", () => {
    const dates = consecutiveDates(MAX_HEALTH_SYNC_CALENDAR_DAYS + 1);
    expect(() => normalizeShortcutRangePayload(payload({
      weightKg: JSON.stringify({
        TimeStamps: dates.map((date) => iso(date, "07:00:00")).join("\n"),
        Weights: dates.map(() => "81.4").join("\n"),
      }),
    }))).toThrow(`at most ${MAX_HEALTH_SYNC_CALENDAR_DAYS} calendar days`);
  });

  it("leaves legacy daily payloads to the existing normalizer", () => {
    expect(normalizeShortcutRangePayload({ days: [{ date: "2026-09-20", weightKg: 80 }] })).toBeNull();
  });
});
