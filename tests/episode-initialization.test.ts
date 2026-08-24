import { describe, expect, it } from "vitest";
import { reconstructBodyWeightKg } from "@/model/body-composition/state";
import { prepareEpisodeInitialization } from "@/modules/model-episodes/episode-initialization";
import { EpisodeInitializationError } from "@/modules/model-episodes/model-episode.errors";
import { modelProfile, stableSourceDays } from "./model-episode-fixtures";

describe("model episode initialization", () => {
  it("freezes successful initialization with Bratislava timezone and provenance", () => {
    const days = stableSourceDays();
    const before = structuredClone(days);
    const result = prepareEpisodeInitialization({
      profile: modelProfile,
      days,
      startDate: "2026-08-22",
    });
    expect(result).toMatchObject({
      profileId: 1,
      startDate: "2026-08-22",
      timezone: "Europe/Bratislava",
      modelVersion: "bodycast-physiology-v4",
      ecfPolicy: "hold-ecf",
      bodyFatObservationCount: 7,
      nutritionMaxBridgeDays: 2,
      baseline: {
        baselineEnergyIntakeKcalPerDay: 2_450,
        baselineCarbIntakeG: 240,
        fallbackNutrition: {
          caloriesKcal: 2_450, proteinG: 150, fatG: 75, carbsG: 240,
        },
      },
    });
    expect(reconstructBodyWeightKg(result.initialState))
      .toBeCloseTo(result.initialState.weightFilterState.estimatedWeightKg, 12);
    expect(result.initialState.fatMassKg).toBeGreaterThan(0);
    expect(result.initialState.leanTissueKg).toBeGreaterThan(0);
    expect(days).toEqual(before);
  });

  it("returns explicit failures for profile, baseline, and BIA insufficiency", () => {
    const complete = stableSourceDays();
    expect(() => prepareEpisodeInitialization({
      profile: null, days: complete, startDate: "2026-08-22",
    })).toThrow(new EpisodeInitializationError("profile-missing"));
    expect(() => prepareEpisodeInitialization({
      profile: modelProfile,
      days: complete.slice(-10),
      startDate: "2026-08-22",
    })).toThrow(new EpisodeInitializationError("insufficient-baseline-data"));
    expect(() => prepareEpisodeInitialization({
      profile: modelProfile,
      days: complete.map((day) => ({ ...day, bodyFatPercent: null })),
      startDate: "2026-08-22",
    })).toThrow(new EpisodeInitializationError("insufficient-weight-bia"));
  });

  it("rejects a raw boundary BIA that cannot initialize latent state", () => {
    const days = stableSourceDays({
      override: (index) => index >= 83 ? { bodyFatPercent: 0 } : {},
    });
    expect(() => prepareEpisodeInitialization({
      profile: modelProfile, days, startDate: "2026-08-22",
    })).toThrow(new EpisodeInitializationError("invalid-initial-state"));
  });

  it("allows an explicit valid timezone without consulting server timezone", () => {
    expect(prepareEpisodeInitialization({
      profile: modelProfile,
      days: stableSourceDays(),
      startDate: "2026-08-22",
      timezone: "Europe/Prague",
    }).timezone).toBe("Europe/Prague");
  });
});
