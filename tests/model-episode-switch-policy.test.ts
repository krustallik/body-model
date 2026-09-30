import { describe, expect, it } from "vitest";
import {
  episodeReadinessFromCalculation,
  shouldSwitchModelEpisode,
  type EpisodeSwitchReadiness,
} from "@/modules/model-episodes/episode-switch-policy";

const readiness = (
  latestModeledDate: string | null,
  currentEstimateAvailable: boolean,
  usableModeledCoverageDays: number,
): EpisodeSwitchReadiness => ({
  latestModeledDate,
  currentEstimateAvailable,
  usableModeledCoverageDays,
});

describe("automatic model episode switch policy", () => {
  it("rejects a 28/28 available episode for a 4/4 candidate without a current estimate", () => {
    expect(shouldSwitchModelEpisode(
      readiness("2026-09-28", true, 28),
      readiness("2026-09-28", false, 4),
    )).toBe(false);
  });

  it("accepts a candidate that strictly improves coverage without regressing the other criteria", () => {
    expect(shouldSwitchModelEpisode(
      readiness("2026-09-28", true, 24),
      readiness("2026-09-28", true, 28),
    )).toBe(true);
  });

  it("rejects a full tie", () => {
    expect(shouldSwitchModelEpisode(
      readiness("2026-09-28", true, 28),
      readiness("2026-09-28", true, 28),
    )).toBe(false);
  });

  it("rejects better coverage when latest modeled date regresses", () => {
    expect(shouldSwitchModelEpisode(
      readiness("2026-09-28", true, 20),
      readiness("2026-09-27", true, 28),
    )).toBe(false);
  });

  it("rejects a candidate that loses the current estimate even when its other criteria improve", () => {
    expect(shouldSwitchModelEpisode(
      readiness("2026-09-27", true, 20),
      readiness("2026-09-28", false, 28),
    )).toBe(false);
  });

  it("marks a 4/4 candidate with an open gap as unavailable under Diagnostics rules", () => {
    const calculation = {
      latestModeledDate: "2026-09-28",
      unknownIntervals: [{ startDate: "2026-09-29" }],
      dailyStates: Array.from({ length: 4 }, (_, index) => ({
        date: new Date(Date.UTC(2026, 8, index + 25)).toISOString().slice(0, 10),
        status: "complete" as const,
        endWeightKg: 80,
      })),
    };
    expect(episodeReadinessFromCalculation({
      calculation: calculation as never,
      startDate: "2026-09-25",
    })).toEqual(readiness("2026-09-28", false, 4));
  });

  it("projects candidate coverage from the same trailing Diagnostics window", () => {
    const calculation = {
      latestModeledDate: "2026-09-28",
      unknownIntervals: [],
      dailyStates: Array.from({ length: 28 }, (_, index) => ({
        date: new Date(Date.UTC(2026, 8, index + 1)).toISOString().slice(0, 10),
        status: "complete" as const,
        endWeightKg: 80,
      })),
    };
    expect(episodeReadinessFromCalculation({
      calculation: calculation as never,
      startDate: "2026-09-01",
    })).toEqual(readiness("2026-09-28", true, 28));
  });
});