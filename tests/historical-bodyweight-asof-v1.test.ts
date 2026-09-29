import { describe, expect, it } from "vitest";
import { addCalendarDays } from "@/modules/model-episodes/model-calendar";
import type { HistoricalModelSources } from "@/modules/model-episodes/model-episode.types";
import { calculateHistoricalBodyweightAsOfV1 } from "@/modules/model-episodes/historical-bodyweight-asof-v1";
import { prepareEpisodeInitialization } from "@/modules/model-episodes/episode-initialization";
import { persistedEpisodeFixture, modelProfile, sourceDay, stableSourceDays } from "./model-episode-fixtures";

function sources(localDate: string): HistoricalModelSources {
  return {
    days: [sourceDay(localDate)],
    snapshots: [],
    activityIntervals: [],
    workIntervals: [],
    workouts: [],
    heartRateSamples: [],
    webOnlyStrengthSessions: [],
    reconciliationLinks: [],
  };
}

function asOfSafeEpisode(startDate: string) {
  const days = stableSourceDays({
    endDate: addCalendarDays(startDate, -1),
    override: () => ({ bodyFatPercent: 20 }),
  });
  const inputSources: HistoricalModelSources = {
    days, snapshots: [], activityIntervals: [], workIntervals: [], workouts: [],
    heartRateSamples: [], webOnlyStrengthSessions: [], reconciliationLinks: [],
  };
  const prepared = prepareEpisodeInitialization({
    profile: modelProfile, days, sources: inputSources, startDate,
  });
  const base = persistedEpisodeFixture(startDate);
  return {
    ...base,
    profileId: prepared.profileId,
    timezone: prepared.timezone,
    modelVersion: prepared.modelVersion,
    ecfPolicy: prepared.ecfPolicy,
    baselineEnergyIntakeKcalPerDay: prepared.baseline.baselineEnergyIntakeKcalPerDay,
    baselineCarbIntakeG: prepared.baseline.baselineCarbIntakeG,
    baselineNutritionFallback: prepared.baseline.fallbackNutrition,
    baselineWindowStartDate: prepared.baseline.diagnostics.windowStartDate,
    baselineWindowEndDate: prepared.baseline.diagnostics.windowEndDate,
    baselineNutritionDayCount: prepared.baseline.diagnostics.completeNutritionDayCount,
    baselineWeightObservationCount: prepared.baseline.diagnostics.weightObservationCount,
    baselineWeightTrendKgPerWeek: prepared.baseline.diagnostics.weightTrendKgPerWeek,
    baselineWeightTrendPercentPerWeek: prepared.baseline.diagnostics.weightTrendPercentPerWeek,
    nutritionMaxBridgeDays: prepared.nutritionMaxBridgeDays,
    initialState: prepared.initialState,
    simulatorParameters: prepared.simulatorParameters,
    initialRmrKcalPerDay: prepared.initialRmrKcalPerDay,
    initializationStatus: prepared.initializationStatus,
    initializationDiagnostics: prepared.initializationDiagnostics,
  };
}

describe("read-only historical bodyweight as-of adapter", () => {
  it("replays only the target prefix and produces a model system-weight estimate", () => {
    const localDate = "2026-08-22";
    const episode = asOfSafeEpisode(localDate);
    const baseline = sources(localDate);
    const result = calculateHistoricalBodyweightAsOfV1({ episode, sources: baseline, localDate });
    expect(result.status).toBe("available");
    expect(result.valueKg).toBeGreaterThan(0);
    expect(result.modelVersion).toBe(episode.modelVersion);

    const futureDate = addCalendarDays(localDate, 1);
    const futurePoisoned = sources(localDate);
    futurePoisoned.days.push(sourceDay(futureDate, {
      weightKg: 250,
      caloriesKcal: 10_000,
      proteinG: 900,
      fatG: 800,
      carbsG: 1_000,
    }));
    futurePoisoned.snapshots?.push({
      id: 900, date: futureDate, receivedAt: new Date(futureDate + "T20:00:00Z"),
      syncedAt: new Date(futureDate + "T20:00:00Z"), steps: 100_000, walkingDistanceKm: 100,
    });
    const withFutureRows = calculateHistoricalBodyweightAsOfV1({
      episode, sources: futurePoisoned, localDate,
    });
    expect(withFutureRows).toEqual(result);

    const changedSameDayMeasurement = sources(localDate);
    changedSameDayMeasurement.days[0] = sourceDay(localDate, { weightKg: 250 });
    expect(calculateHistoricalBodyweightAsOfV1({
      episode, sources: changedSameDayMeasurement, localDate,
    })).toEqual(result);
  });

  it("fails closed for unproven initialization, invalid dates, and replay beyond the bound", () => {
    const localDate = "2026-08-22";
    const episode = asOfSafeEpisode(localDate);
    expect(calculateHistoricalBodyweightAsOfV1({
      episode: { ...episode, initializationDiagnostics: { reason: "unknown" } },
      sources: sources(localDate), localDate,
    })).toMatchObject({ status: "unavailable", reason: "unsafe-initial-state" });
    expect(calculateHistoricalBodyweightAsOfV1({
      episode, sources: sources(localDate), localDate: "2026-02-30",
    })).toMatchObject({ status: "unavailable", reason: "invalid-date" });
    const beyondBound = addCalendarDays(localDate, 366);
    expect(calculateHistoricalBodyweightAsOfV1({
      episode, sources: sources(localDate), localDate: beyondBound,
    })).toMatchObject({ status: "unavailable", reason: "replay-limit" });
  });

  it("accepts the maximum 366-day replay without truncating its requested cutoff", () => {
    const startDate = "2026-08-22";
    const localDate = addCalendarDays(startDate, 365);
    const episode = asOfSafeEpisode(startDate);
    const input = sources(startDate);
    input.days = Array.from({ length: 366 }, (_, index) => (
      sourceDay(addCalendarDays(startDate, index))
    ));
    const result = calculateHistoricalBodyweightAsOfV1({ episode, sources: input, localDate });
    expect(result.localDate).toBe(localDate);
    expect(result.status).toBe("available");
    expect(result.valueKg).toBeGreaterThan(0);
  });
});
