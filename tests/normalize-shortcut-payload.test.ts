import { describe, expect, it } from "vitest";
import {
  normalizeShortcutPayload,
  ShortcutNormalizationError,
} from "@/modules/health/normalize-shortcut-payload";

describe("normalizeShortcutPayload", () => {
  it.each(["date", "Date", "DATE"])("normalizes date variant %s", (key) => {
    expect(normalizeShortcutPayload({ days: [{ [key]: "2026-08-22" }] }).payload).toEqual({
      days: [{ date: "2026-08-22" }],
    });
  });

  it.each(["weightKg", "WeightKg", "Weightkg", "weightkg", "WEIGHTKG"])(
    "normalizes weightKg variant %s",
    (key) => {
      expect(normalizeShortcutPayload({ days: [{ [key]: 89 }] }).payload).toEqual({ days: [{ weightKg: 89 }] });
    },
  );

  it.each(["steps", "Steps", "STEPS"])("normalizes steps variant %s", (key) => {
    expect(normalizeShortcutPayload({ days: [{ [key]: 10000 }] }).payload).toEqual({ days: [{ steps: 10000 }] });
  });

  it.each(["activeEnergyKcal", "ActiveEnergyKcal", "Activeenergykcal", "ACTIVEENERGYKCAL"])(
    "normalizes activeEnergyKcal variant %s",
    (key) => {
      expect(normalizeShortcutPayload({ days: [{ [key]: 600 }] }).payload).toEqual({
        days: [{ activeEnergyKcal: 600 }],
      });
    },
  );

  it("normalizes every canonical day and workout field case-insensitively", () => {
    const result = normalizeShortcutPayload({
      DAYS: [{
        DATE: "2026-08-22", WEIGHTKG: 89, BODYFATPERCENT: 18.7, CALORIESKCAL: 2000, PROTEING: 150, FATG: 70,
        CARBSG: 220, STEPS: 10000, ACTIVEENERGYKCAL: 600,
        AVERAGEWALKINGSPEEDKMH: 5.2, WALKINGDISTANCEKM: 7.8,
        STRENGTHTRAININGMINUTES: 65.5,
        WORKOUTS: [{ EXTERNALID: "w-1", TYPE: "strength_training", STARTAT: "2026-08-22T17:00:00+02:00",
          ENDAT: "2026-08-22T18:00:00+02:00", DURATIONMINUTES: 60, ENERGYKCAL: 300 }],
      }],
    });

    expect(result.payload).toEqual({ days: [{
      date: "2026-08-22", weightKg: 89, bodyFatPercent: 18.7, caloriesKcal: 2000, proteinG: 150, fatG: 70,
      carbsG: 220, steps: 10000, activeEnergyKcal: 600,
      averageWalkingSpeedKmh: 5.2, walkingDistanceKm: 7.8,
      strengthTrainingMinutes: 65.5,
      workouts: [{ externalId: "w-1", type: "strength_training", startAt: "2026-08-22T17:00:00+02:00",
        endAt: "2026-08-22T18:00:00+02:00", durationMinutes: 60, energyKcal: 300 }],
    }] });
  });

  it.each([
    "Strengthtrainingminutes",
    "StrengthTrainingMinutes",
    "STRENGTHTRAININGMINUTES",
    "strengthtrainingminutes",
  ])("normalizes strength training key variant %s", (key) => {
    expect(normalizeShortcutPayload({ days: [{ [key]: "65,5" }] }).payload).toEqual({
      days: [{ strengthTrainingMinutes: "65,5" }],
    });
  });

  it("normalizes Apple Shortcuts casing for body composition and walking metrics", () => {
    expect(normalizeShortcutPayload({ Days: [{
      Date: "2026-08-22",
      Bodyfatpercent: 18.7,
      Averagewalkingspeedkmh: 5.2,
      Walkingdistancekm: 7.8,
    }] }).payload).toEqual({ days: [{
      date: "2026-08-22",
      bodyFatPercent: 18.7,
      averageWalkingSpeedKmh: 5.2,
      walkingDistanceKm: 7.8,
    }] });
  });

  it("preserves canonical payloads and the original day object", () => {
    const day = { date: "2026-08-22", steps: 10000 };
    const result = normalizeShortcutPayload({ days: [day] });
    expect(result.payload).toEqual({ days: [day] });
    expect(result.originalDays).toEqual([day]);
  });

  it.each(["banana", "weigthKg"])("leaves unknown or typo key %s for strict validation", (key) => {
    expect(normalizeShortcutPayload({ days: [{ [key]: 89 }] }).payload).toEqual({ days: [{ [key]: 89 }] });
  });

  it("rejects collisions instead of silently choosing a value", () => {
    expect(() => normalizeShortcutPayload({ days: [{ weightKg: 89, Weightkg: 90 }] })).toThrow(
      ShortcutNormalizationError,
    );
  });
});
