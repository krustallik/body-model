import { describe, expect, it } from "vitest";
import { buildSimulationDays } from "@/modules/model-episodes/simulation-input-builder";
import type { HistoricalModelSources } from "@/modules/model-episodes/model-episode.types";
import { sourceDay } from "./model-episode-fixtures";
import { addCalendarDays } from "@/modules/model-episodes/model-calendar";

const date = "2026-08-22";
const instant = (time: string) => new Date(`2026-08-22T${time}:00+02:00`);

function sources(
  override: Partial<HistoricalModelSources> = {},
): HistoricalModelSources {
  return {
    days: [sourceDay(date, { walkingDistanceKm: 5.1 })],
    snapshots: [],
    workIntervals: [],
    ...override,
  };
}

describe("historical simulation input builder", () => {
  it("uses full daily walking on a no-work day", () => {
    const result = buildSimulationDays({ from: date, to: date, sources: sources() });
    expect(result[0].input.outsideWorkWalkingDistanceKm).toBe(5.1);
    expect(result[0].input.occupationalActivity.intervals).toEqual([]);
    expect(result[0].sourceQuality).toMatchObject({ status: "complete", workIntervalCount: 0 });
  });

  it("distinguishes an absent day from an explicitly tracked no-work day", () => {
    const result = buildSimulationDays({
      from: date,
      to: addCalendarDays(date, 1),
      sources: sources(),
    });
    expect(result[0].input.occupationalActivity).toMatchObject({
      durationHours: 0,
      intervals: [],
    });
    expect(result[1].input.occupationalActivity).toEqual({
      category: null,
      durationHours: null,
      intervals: undefined,
    });
    expect(result[1].sourceQuality.issues).toContain("occupationalActivity.durationHours");
  });

  it("marks walking speed unavailable when observed walking distance is positive", () => {
    const result = buildSimulationDays({
      from: date,
      to: date,
      sources: sources({ days: [sourceDay(date, {
        walkingDistanceKm: 5,
        averageWalkingSpeedKmh: null,
      })] }),
    });
    expect(result[0].sourceQuality.issues).toContain("averageWalkingSpeedKmh");
  });

  it("subtracts reconstructed work walking from full daily walking", () => {
    const input = sources({
      snapshots: [
        { id: 1, date, receivedAt: instant("08:05"), syncedAt: null, steps: 1_200,
          walkingDistanceKm: 0.8 },
        { id: 2, date, receivedAt: instant("16:05"), syncedAt: null, steps: 4_700,
          walkingDistanceKm: 3.3 },
      ],
      workIntervals: [{
        id: 1, date, startAt: instant("08:00"), endAt: instant("16:00"),
        timezone: "Europe/Bratislava", category: "manualModerate", breakMinutes: 30,
      }],
    });
    const before = structuredClone(input);
    const result = buildSimulationDays({ from: date, to: date, sources: input });
    expect(result[0].sourceQuality).toMatchObject({
      status: "complete",
      workWalkingDistanceKm: 2.5,
      outsideWorkWalkingDistanceKm: 2.5999999999999996,
    });
    expect(result[0].input.outsideWorkWalkingDistanceKm).toBeCloseTo(2.6, 12);
    expect(result[0].input.occupationalActivity.intervals).toEqual([{
      category: "manualModerate", durationHours: 8,
      breakDurationHours: 0.5,
      workWalkingDistanceKm: 2.5, averageWalkingSpeedKmh: 5,
    }]);
    expect(result[0].sourceQuality.workBreaks).toEqual([{
      intervalId: 1, breakMinutes: 30, source: "user-entered",
    }]);
    expect(input).toEqual(before);
  });

  it("supports multiple work intervals and categories", () => {
    const result = buildSimulationDays({
      from: date,
      to: date,
      sources: sources({
        snapshots: [
          { id: 1, date, receivedAt: instant("08:00"), syncedAt: null, steps: 1_000,
            walkingDistanceKm: 0.5 },
          { id: 2, date, receivedAt: instant("12:00"), syncedAt: null, steps: 3_000,
            walkingDistanceKm: 2 },
          { id: 3, date, receivedAt: instant("13:00"), syncedAt: null, steps: 3_500,
            walkingDistanceKm: 2.5 },
          { id: 4, date, receivedAt: instant("17:00"), syncedAt: null, steps: 5_500,
            walkingDistanceKm: 4 },
        ],
        workIntervals: [
          { id: 2, date, startAt: instant("13:00"), endAt: instant("17:00"),
            timezone: "Europe/Bratislava", category: "manualModerate", breakMinutes: null },
          { id: 1, date, startAt: instant("08:00"), endAt: instant("12:00"),
            timezone: "Europe/Bratislava", category: "standingLight", breakMinutes: 0 },
        ],
      }),
    });
    expect(result[0].input.outsideWorkWalkingDistanceKm).toBeCloseTo(2.1, 12);
    expect(result[0].input.occupationalActivity.intervals).toEqual([
      { category: "standingLight", durationHours: 4,
        breakDurationHours: 0,
        workWalkingDistanceKm: 1.5, averageWalkingSpeedKmh: 5 },
      { category: "manualModerate", durationHours: 4,
        breakDurationHours: null,
        workWalkingDistanceKm: 1.5, averageWalkingSpeedKmh: 5 },
    ]);
  });

  it.each([
    [5.1, 0],
    [0.1, 5],
  ])("preserves the work/outside partition for %s km at work", (workKm, outsideKm) => {
    const result = buildSimulationDays({
      from: date,
      to: date,
      sources: sources({
        snapshots: [
          { id: 1, date, receivedAt: instant("08:00"), syncedAt: null,
            steps: 0, walkingDistanceKm: 0 },
          { id: 2, date, receivedAt: instant("16:00"), syncedAt: null,
            steps: 10_000, walkingDistanceKm: workKm },
        ],
        workIntervals: [{ id: 1, date, startAt: instant("08:00"), endAt: instant("16:00"),
          timezone: "Europe/Bratislava", category: "manualLight", breakMinutes: null }],
      }),
    });
    expect(result[0].sourceQuality.workWalkingDistanceKm).toBeCloseTo(workKm, 12);
    expect(result[0].input.outsideWorkWalkingDistanceKm).toBeCloseTo(outsideKm, 12);
    expect(result[0].input.occupationalActivity.intervals?.[0].workWalkingDistanceKm)
      .toBeCloseTo(workKm, 12);
  });

  it("marks work reconstruction unavailable when a boundary gap is too large", () => {
    const result = buildSimulationDays({
      from: date,
      to: date,
      sources: sources({
        snapshots: [{ id: 1, date, receivedAt: instant("09:00"), syncedAt: null,
          steps: 1_000, walkingDistanceKm: 1 }],
        workIntervals: [{ id: 1, date, startAt: instant("08:00"), endAt: instant("16:00"),
          timezone: "Europe/Bratislava", category: "manualLight", breakMinutes: null }],
      }),
    });
    expect(result[0].sourceQuality.status).toBe("work-reconstruction-unavailable");
    expect(result[0].sourceQuality.workWalkingReconstruction).toEqual([{
      intervalId: 1, distanceKm: null, reason: "gap-too-large",
      startMethod: null, endMethod: null,
    }]);
    expect(result[0].input.outsideWorkWalkingDistanceKm).toBeNull();
  });

  it("propagates a decreasing work-distance counter without clamping", () => {
    const result = buildSimulationDays({
      from: date,
      to: date,
      sources: sources({
        snapshots: [
          { id: 1, date, receivedAt: instant("08:00"), syncedAt: null,
            steps: 2_000, walkingDistanceKm: 2 },
          { id: 2, date, receivedAt: instant("16:00"), syncedAt: null,
            steps: 1_000, walkingDistanceKm: 1 },
        ],
        workIntervals: [{ id: 1, date, startAt: instant("08:00"), endAt: instant("16:00"),
          timezone: "Europe/Bratislava", category: "manualLight", breakMinutes: null }],
      }),
    });
    expect(result[0].sourceQuality.status).toBe("work-reconstruction-unavailable");
    expect(result[0].sourceQuality.workWalkingReconstruction?.[0]).toMatchObject({
      distanceKm: null, reason: "counter-decreased",
    });
    expect(result[0].input.occupationalActivity.intervals?.[0].workWalkingDistanceKm)
      .toBeNull();
  });

  it("preserves explicit strength zero and missing measured weight", () => {
    const result = buildSimulationDays({
      from: date,
      to: date,
      sources: sources({ days: [sourceDay(date, {
        weightKg: null, strengthTrainingMinutes: 0, walkingDistanceKm: 0,
        averageWalkingSpeedKmh: null,
      })] }),
    });
    expect(result[0].input.strengthTrainingMinutes).toBe(0);
    expect(result[0].input.measuredWeightKg).toBeNull();
    expect(result[0].sourceQuality.status).toBe("complete");
  });

  it("distinguishes missing activity and missing nutrition", () => {
    const missingActivity = buildSimulationDays({
      from: date, to: date,
      sources: sources({ days: [sourceDay(date, { walkingDistanceKm: null })] }),
    });
    expect(missingActivity[0].sourceQuality.status).toBe("missing-activity");
    const missingNutrition = buildSimulationDays({
      from: date, to: date,
      sources: sources({ days: [sourceDay(date, { caloriesKcal: null })] }),
    });
    expect(missingNutrition[0].sourceQuality.status).toBe("missing-nutrition");
  });

  it("represents a missing calendar day explicitly", () => {
    const result = buildSimulationDays({
      from: "2026-08-21", to: date, sources: sources(),
    });
    expect(result.map(({ input }) => input.date)).toEqual(["2026-08-21", date]);
    expect(result[0].sourceQuality.status).toBe("missing-nutrition");
    expect(result[0].input.caloriesKcal).toBeNull();
  });

  it("marks an unknown occupational category unavailable", () => {
    const result = buildSimulationDays({
      from: date,
      to: date,
      sources: sources({
        snapshots: [
          { id: 1, date, receivedAt: instant("08:00"), syncedAt: null, steps: 0,
            walkingDistanceKm: 0 },
          { id: 2, date, receivedAt: instant("09:00"), syncedAt: null, steps: 0,
            walkingDistanceKm: 0 },
        ],
        workIntervals: [{ id: 1, date, startAt: instant("08:00"), endAt: instant("09:00"),
          timezone: "Europe/Bratislava", category: "unknown", breakMinutes: null }],
      }),
    });
    expect(result[0].sourceQuality.status).toBe("work-reconstruction-unavailable");
    expect(result[0].input.occupationalActivity.intervals?.[0].category).toBeNull();
  });

  it("bridges a short nutrition gap and keeps later days simulatable", () => {
    const start = "2026-08-18";
    const calories = [1_980, 2_050, null, 2_010, 1_990] as const;
    const days = calories.map((value, index) => sourceDay(addCalendarDays(start, index), value === null
      ? { caloriesKcal: null, proteinG: null, fatG: null, carbsG: null }
      : { caloriesKcal: value }));
    const result = buildSimulationDays({
      from: start,
      to: addCalendarDays(start, 4),
      sources: { days, snapshots: [], workIntervals: [] },
    });
    expect(result.map(({ sourceQuality }) => sourceQuality.status))
      .toEqual(["complete", "complete", "complete", "complete", "complete"]);
    expect(result[2].sourceQuality.nutrition.source).toBe("imputed-local");
    expect(result.slice(3).map(({ sourceQuality }) => sourceQuality.nutrition.dependency))
      .toEqual(["imputed-downstream", "imputed-downstream"]);
  });

  it("keeps a gap beyond policy explicit and does not manufacture zeros", () => {
    const start = "2026-08-15";
    const days = Array.from({ length: 9 }, (_, index) => sourceDay(
      addCalendarDays(start, index),
      index > 0 && index < 8
        ? { caloriesKcal: null, proteinG: null, fatG: null, carbsG: null }
        : {},
    ));
    const result = buildSimulationDays({
      from: start,
      to: addCalendarDays(start, 8),
      sources: { days, snapshots: [], workIntervals: [] },
      baselineNutritionFallback: {
        caloriesKcal: 2_500, proteinG: 150, fatG: 75, carbsG: 250,
      },
    });
    expect(result.slice(1, 8).every(({ sourceQuality }) => (
      sourceQuality.status === "missing-nutrition"
      && sourceQuality.nutrition.source === "missing"
    ))).toBe(true);
    expect(result.slice(1, 8).every(({ input }) => input.caloriesKcal === null)).toBe(true);
  });
});
