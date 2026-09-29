import { describe, expect, it } from "vitest";
import { createLocalDemoDataset } from "@/modules/demo/local-demo-data";

describe("local demo data", () => {
  it("creates a deterministic 90-day dataset with visible but intentional gaps", () => {
    const first = createLocalDemoDataset("2026-09-28");
    const second = createLocalDemoDataset("2026-09-28");

    expect(first).toEqual(second);
    expect(first.days).toHaveLength(90);
    expect(first.days[0]?.date).toBe("2026-07-01");
    expect(first.days.at(-1)?.date).toBe("2026-09-28");
    expect(first.days.some((day) => day.weightKg === null)).toBe(true);
    expect(first.days.some((day) => day.bodyFatPercent === null)).toBe(true);
    expect(first.days.some((day) => day.sleep === null)).toBe(true);
    expect(first.days.some((day) => day.heartRate?.sampleCount === 0)).toBe(true);
    expect(first.days.some((day) => day.steps === null)).toBe(true);
    expect(first.days.at(-1)?.weightKg).toEqual(expect.any(Number));
    expect(first.days.at(-1)?.steps).toEqual(expect.any(Number));
  });

  it("keeps workout facts and nightly sleep segments internally consistent", () => {
    const { days, trainingDays } = createLocalDemoDataset("2026-09-28");

    for (const day of days) {
      expect(day.trainingDayFact).toEqual(trainingDays.find((fact) => fact.date === day.date));
      expect(day.trainingDayFact?.eventCount).toBe(day.workouts.length);
      expect(day.totalWorkoutMinutes).toBe(day.workouts.reduce((total, workout) => total + (workout.durationMinutes ?? 0), 0));
      if (day.sleep) {
        expect(day.sleep.segments).toHaveLength(day.sleep.segmentCount);
        expect(day.sleep.coreMinutes + day.sleep.deepMinutes + day.sleep.remMinutes).toBe(day.sleep.totalSleepMinutes);
        expect(day.sleep.timeInBedMinutes).toBe(day.sleep.totalSleepMinutes + day.sleep.awakeMinutes);
        for (const segment of day.sleep.segments) {
          expect(Date.parse(segment.endAt)).toBeGreaterThan(Date.parse(segment.startAt));
        }
      }
    }
  });
});
