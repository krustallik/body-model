import { describe, expect, it } from "vitest";
import {
  normalizeShortcutRangePayload,
  ShortcutRangeNormalizationError,
} from "@/modules/health/normalize-shortcut-range-payload";

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

  it("leaves legacy daily payloads to the existing normalizer", () => {
    expect(normalizeShortcutRangePayload({ days: [{ date: "2026-09-20", weightKg: 80 }] })).toBeNull();
  });
});
