import { describe, expect, it } from "vitest";
import { calculateEpisodeHistory } from "@/modules/model-episodes/episode-calculation";
import { addCalendarDays } from "@/modules/model-episodes/model-calendar";
import { buildSimulationDays } from "@/modules/model-episodes/simulation-input-builder";
import {
  analyzeStateContinuity,
  unknownIntervalDurationDays,
} from "@/modules/model-episodes/unknown-intervals";
import { persistedEpisodeFixture, sourceDay } from "./model-episode-fixtures";

const missingNutrition = {
  caloriesKcal: null,
  proteinG: null,
  fatG: null,
  carbsG: null,
} as const;

function scenario(input: {
  count: number;
  missingNutritionIndexes?: number[];
  omittedIndexes?: number[];
  startDate?: string;
}) {
  const startDate = input.startDate ?? "2026-01-01";
  const episode = persistedEpisodeFixture(startDate);
  const missing = new Set(input.missingNutritionIndexes ?? []);
  const omitted = new Set(input.omittedIndexes ?? []);
  const sources = Array.from({ length: input.count }, (_, index) => (
    omitted.has(index)
      ? null
      : sourceDay(addCalendarDays(startDate, index), missing.has(index) ? missingNutrition : {})
  )).filter((day) => day !== null);
  const days = buildSimulationDays({
    from: startDate,
    to: addCalendarDays(startDate, input.count - 1),
    sources: { days: sources, snapshots: [], workIntervals: [] },
    baselineNutritionFallback: episode.baselineNutritionFallback,
    nutritionGapPolicy: { maxBridgeDays: episode.nutritionMaxBridgeDays },
  });
  return { episode, days, result: calculateEpisodeHistory({ episode, days }) };
}

describe("long unknown interval continuity", () => {
  it("leaves a complete history resolved", () => {
    const { result } = scenario({ count: 14 });
    expect(result.dailyStates).toHaveLength(14);
    expect(result.unknownIntervals).toEqual([]);
    expect(result.continuityStatus).toBe("resolved");
  });

  it("counts interval duration by local calendar date", () => {
    expect(unknownIntervalDurationDays({
      startDate: "2026-03-29",
      lastUnknownDate: "2026-04-04",
    })).toBe(7);
  });

  it.each([1, 2])("preserves the Phase 13.1 bridge for a %i-day nutrition gap", (length) => {
    const indexes = Array.from({ length }, (_, index) => index + 4);
    const { result } = scenario({ count: 12, missingNutritionIndexes: indexes });
    expect(result.dailyStates).toHaveLength(12);
    expect(result.unknownIntervals).toEqual([]);
    expect(indexes.map((index) => result.dailyStates[index].nutrition.source))
      .toEqual(Array.from({ length }, () => "imputed-local"));
  });

  it.each([3, 7, 14, 30, 90])(
    "freezes before a %i-day nutrition gap without manufacturing states",
    (length) => {
      const anchorLength = 3;
      const { result } = scenario({
        count: anchorLength + length,
        missingNutritionIndexes: Array.from({ length }, (_, index) => anchorLength + index),
      });
      expect(result.dailyStates).toHaveLength(anchorLength);
      expect(result.latestModeledDate).toBe("2026-01-03");
      expect(result.unknownIntervals).toEqual([expect.objectContaining({
        startDate: "2026-01-04",
        lastUnknownDate: addCalendarDays("2026-01-04", length - 1),
        endDate: null,
        anchorDate: "2026-01-03",
        recoveryRequired: true,
      })]);
    },
  );

  it("recognizes seven entirely absent source rows without converting them to zeros", () => {
    const { days, result } = scenario({
      count: 15,
      omittedIndexes: [3, 4, 5, 6, 7, 8, 9],
    });
    expect(days.slice(3, 10).every(({ input }) => (
      input.caloriesKcal === null
      && input.proteinG === null
      && input.fatG === null
      && input.carbsG === null
      && input.outsideWorkWalkingDistanceKm === null
      && input.strengthTrainingMinutes === null
      && input.occupationalActivity.durationHours === null
      && input.occupationalActivity.intervals === undefined
      && input.measuredWeightKg === null
    ))).toBe(true);
    expect(result.dailyStates).toHaveLength(3);
    expect(result.unknownIntervals[0]).toMatchObject({
      startDate: "2026-01-04",
      lastUnknownDate: "2026-01-10",
      endDate: "2026-01-10",
      firstPostGapObservationDate: "2026-01-11",
      postGapObservedDayCount: 5,
    });
    expect(result.unknownIntervals[0].missingTransitionFields).toEqual(expect.arrayContaining([
      "caloriesKcal", "proteinG", "fatG", "carbsG",
      "outsideWorkWalkingDistanceKm", "strengthTrainingMinutes",
      "occupationalActivity.durationHours",
    ]));
  });

  it("does not treat absent weight measurements as an unknown transition", () => {
    const startDate = "2026-01-01";
    const episode = persistedEpisodeFixture(startDate);
    const sources = Array.from({ length: 14 }, (_, index) => sourceDay(
      addCalendarDays(startDate, index),
      { weightKg: null },
    ));
    const days = buildSimulationDays({
      from: startDate,
      to: addCalendarDays(startDate, 13),
      sources: { days: sources, snapshots: [], workIntervals: [] },
      baselineNutritionFallback: episode.baselineNutritionFallback,
    });
    expect(analyzeStateContinuity(days, episode.ecfPolicy).unknownIntervals).toEqual([]);
    expect(calculateEpisodeHistory({ episode, days }).dailyStates).toHaveLength(14);
  });

  it("preserves explicit observed zeros as valid inputs instead of missing data", () => {
    const startDate = "2026-01-01";
    const episode = persistedEpisodeFixture(startDate);
    const days = buildSimulationDays({
      from: startDate,
      to: startDate,
      sources: {
        days: [sourceDay(startDate, {
          caloriesKcal: 0, proteinG: 0, fatG: 0, carbsG: 0,
          walkingDistanceKm: 0, averageWalkingSpeedKmh: null,
          strengthTrainingMinutes: 0,
        })],
        snapshots: [],
        workIntervals: [],
      },
      baselineNutritionFallback: episode.baselineNutritionFallback,
    });
    const result = calculateEpisodeHistory({ episode, days });
    expect(result.unknownIntervals).toEqual([]);
    expect(result.dailyStates[0]).toMatchObject({
      status: "complete",
      energyIntakeKcal: 0,
      sourceQuality: { outsideWorkWalkingDistanceKm: 0 },
    });
  });

  it("retains post-gap observations while keeping the pre-gap anchor frozen", () => {
    const { result } = scenario({
      count: 12,
      missingNutritionIndexes: [3, 4, 5],
    });
    expect(result.dailyStates).toHaveLength(3);
    expect(result.unknownIntervals[0]).toMatchObject({
      startDate: "2026-01-04",
      lastUnknownDate: "2026-01-06",
      endDate: "2026-01-06",
      anchorDate: "2026-01-03",
      firstPostGapObservationDate: "2026-01-07",
      postGapObservedDayCount: 6,
      postGapObservationDates: [
        "2026-01-07", "2026-01-08", "2026-01-09",
        "2026-01-10", "2026-01-11", "2026-01-12",
      ],
    });
  });

  it("records multiple gaps without starting a new episode or advancing the anchor", () => {
    const { result } = scenario({
      count: 16,
      missingNutritionIndexes: [3, 4, 5, 10, 11, 12],
    });
    expect(result.dailyStates).toHaveLength(3);
    expect(result.unknownIntervals).toHaveLength(2);
    expect(result.unknownIntervals.map(({ anchorDate }) => anchorDate))
      .toEqual(["2026-01-03", "2026-01-03"]);
    expect(result.unknownIntervals.map(({ startDate, endDate }) => ({ startDate, endDate })))
      .toEqual([
        { startDate: "2026-01-04", endDate: "2026-01-06" },
        { startDate: "2026-01-11", endDate: "2026-01-13" },
      ]);
  });

  it("fully heals after complete backfill and recomputes one continuous trajectory", () => {
    const gapped = scenario({ count: 10, missingNutritionIndexes: [3, 4, 5] });
    const healed = scenario({ count: 10 });
    expect(gapped.result.dailyStates).toHaveLength(3);
    expect(healed.result.dailyStates).toHaveLength(10);
    expect(healed.result.unknownIntervals).toEqual([]);
    expect(healed.result.latestModeledDate).toBe("2026-01-10");
  });

  it("heals a former three-day gap when one backfilled day splits it into bridgeable gaps", () => {
    const original = scenario({ count: 10, missingNutritionIndexes: [3, 4, 5] });
    const splitByBackfill = scenario({ count: 10, missingNutritionIndexes: [3, 5] });
    expect(original.result.unknownIntervals).toHaveLength(1);
    expect(splitByBackfill.result.unknownIntervals).toEqual([]);
    expect(splitByBackfill.result.dailyStates).toHaveLength(10);
    expect(splitByBackfill.result.dailyStates[3].nutrition.source).toBe("imputed-local");
    expect(splitByBackfill.result.dailyStates[4].nutrition.source).toBe("observed");
    expect(splitByBackfill.result.dailyStates[5].nutrition.source).toBe("imputed-local");
  });

  it("remains unresolved after partial backfill", () => {
    const { result } = scenario({ count: 10, missingNutritionIndexes: [4, 5, 6] });
    expect(result.dailyStates).toHaveLength(4);
    expect(result.unknownIntervals[0]).toMatchObject({
      startDate: "2026-01-05",
      anchorDate: "2026-01-04",
    });
  });

  it("uses calendar dates continuously across Bratislava DST boundaries", () => {
    const { days, result } = scenario({
      startDate: "2026-03-27",
      count: 7,
      missingNutritionIndexes: [2, 3, 4],
    });
    expect(days.map(({ input }) => input.date)).toEqual([
      "2026-03-27", "2026-03-28", "2026-03-29", "2026-03-30",
      "2026-03-31", "2026-04-01", "2026-04-02",
    ]);
    expect(result.unknownIntervals[0]).toMatchObject({
      startDate: "2026-03-29",
      lastUnknownDate: "2026-03-31",
      firstPostGapObservationDate: "2026-04-01",
    });
  });
});
