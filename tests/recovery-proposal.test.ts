import { describe, expect, it } from "vitest";
import type { PhysiologicalDailyInput } from "@/model/physiological-simulator";
import type { BuiltSimulationDay, ModelDaySourceQuality } from "@/modules/model-episodes/model-episode.types";
import { SeededRandom } from "@/modules/model-recovery/recovery-math";
import { sampleRecoveryDay } from "@/modules/model-recovery/recovery-proposal";
import { DEFAULT_RECOVERY_CONFIG } from "@/modules/model-recovery/recovery.types";

const quality: ModelDaySourceQuality = {
  status: "complete",
  issues: [],
  workIntervalCount: 1,
  workWalkingDistanceKm: 0,
  outsideWorkWalkingDistanceKm: 5,
  sourceObservationFields: ["caloriesKcal", "walkingDistanceKm", "workIntervals"],
  nutrition: {
    source: "observed", method: null, referenceDayCount: 0, gapLength: 0,
    referenceDates: [], observedFields: ["caloriesKcal", "proteinG", "fatG", "carbsG"],
    imputedFields: [], referenceCaloriesMedian: null, referenceCaloriesMad: null,
    referenceMacroMadG: null, dependency: "observed",
  },
};

function completeDay(date: string, override: Partial<PhysiologicalDailyInput> = {}): BuiltSimulationDay {
  return {
    input: {
      date,
      caloriesKcal: 2_000,
      proteinG: 150,
      fatG: 70,
      carbsG: 200,
      outsideWorkWalkingDistanceKm: 5,
      averageWalkingSpeedKmh: 5,
      strengthTrainingMinutes: 0,
      occupationalActivity: { category: "manualModerate", durationHours: 8 },
      sodiumChangeMgPerDay: null,
      measuredWeightKg: null,
      ...override,
    },
    sourceQuality: quality,
  };
}

function unknownTarget(): PhysiologicalDailyInput {
  return {
    date: "2026-08-24",
    caloriesKcal: null, proteinG: null, fatG: null, carbsG: null,
    outsideWorkWalkingDistanceKm: null, averageWalkingSpeedKmh: null,
    strengthTrainingMinutes: null,
    occupationalActivity: { category: null, durationHours: null },
    sodiumChangeMgPerDay: null,
    measuredWeightKg: null,
  };
}

function donors(override: Partial<PhysiologicalDailyInput> = {}): BuiltSimulationDay[] {
  return Array.from({ length: 28 }, (_, index) => completeDay(
    new Date(Date.UTC(2026, 6, 27 + index)).toISOString().slice(0, 10),
    override,
  ));
}

describe("historical recovery generative prior support", () => {
  it("rejects an empty donor set at the sampling boundary", () => {
    expect(() => sampleRecoveryDay({
      target: unknownTarget(), donors: [], random: new SeededRandom(1),
      config: DEFAULT_RECOVERY_CONFIG,
    })).toThrow(/No complete observed donor/);
  });

  it("admits no-work vacation weekdays even when every empirical donor worked", () => {
    const random = new SeededRandom(71);
    const samples = Array.from({ length: 512 }, () => sampleRecoveryDay({
      target: unknownTarget(), donors: donors(), random, config: DEFAULT_RECOVERY_CONFIG,
    }));
    const noWork = samples.filter(({ occupationalActivity }) => (
      occupationalActivity.durationHours === 0
      && occupationalActivity.intervals?.length === 0
    ));
    expect(noWork.length / samples.length).toBeGreaterThan(0.18);
    expect(noWork.length / samples.length).toBeLessThan(0.32);
  });

  it("admits unusually active days from sedentary zero-activity history", () => {
    const random = new SeededRandom(72);
    const sedentaryDonors = donors({
      outsideWorkWalkingDistanceKm: 0,
      averageWalkingSpeedKmh: null,
      strengthTrainingMinutes: 0,
      occupationalActivity: { category: null, durationHours: 0, intervals: [] },
    });
    const samples = Array.from({ length: 1_024 }, () => sampleRecoveryDay({
      target: unknownTarget(), donors: sedentaryDonors, random, config: DEFAULT_RECOVERY_CONFIG,
    }));
    expect(samples.filter(({ outsideWorkWalkingDistanceKm }) => (
      (outsideWorkWalkingDistanceKm ?? 0) >= 8
    )).length).toBeGreaterThan(10);
    expect(samples.filter(({ strengthTrainingMinutes }) => (
      (strengthTrainingMinutes ?? 0) >= 30
    )).length).toBeGreaterThan(25);
  });

  it("gives deficit history support for high intake and unusual carbohydrate composition", () => {
    const random = new SeededRandom(73);
    const samples = Array.from({ length: 2_048 }, () => sampleRecoveryDay({
      target: unknownTarget(), donors: donors(), random, config: DEFAULT_RECOVERY_CONFIG,
    }));
    expect(samples.some(({ caloriesKcal }) => (caloriesKcal ?? 0) > 3_400)).toBe(true);
    expect(samples.some(({ carbsG, proteinG, fatG }) => (
      (carbsG ?? 0) / ((proteinG ?? 0) + (fatG ?? 0)) > 1.8
    ))).toBe(true);
    expect(samples.some(({ carbsG, proteinG, fatG }) => (
      (carbsG ?? 0) / ((proteinG ?? 0) + (fatG ?? 0)) < 0.55
    ))).toBe(true);
  });

  it("preserves every observed partial field exactly", () => {
    const target = unknownTarget();
    target.caloriesKcal = 2_345;
    target.carbsG = 123;
    target.outsideWorkWalkingDistanceKm = 6.7;
    target.strengthTrainingMinutes = 20;
    target.occupationalActivity = { category: "manualLight", durationHours: 5 };
    const sample = sampleRecoveryDay({
      target, donors: donors(), random: new SeededRandom(74), config: DEFAULT_RECOVERY_CONFIG,
    });
    expect(sample).toMatchObject({
      caloriesKcal: 2_345,
      carbsG: 123,
      outsideWorkWalkingDistanceKm: 6.7,
      strengthTrainingMinutes: 20,
      occupationalActivity: { category: "manualLight", durationHours: 5 },
    });
  });

  it("fills only missing fields inside observed work intervals from matching donor intervals", () => {
    const donor = completeDay("2026-08-17", {
      occupationalActivity: {
        category: "manualModerate", durationHours: 8,
        intervals: [{
          category: "manualModerate", durationHours: 8, breakDurationHours: 0.5,
          workWalkingDistanceKm: 4, averageWalkingSpeedKmh: 4.8,
        }],
      },
    });
    const target = unknownTarget();
    target.occupationalActivity = {
      category: null, durationHours: null,
      intervals: [{
        category: "manualLight", durationHours: null, breakDurationHours: null,
        workWalkingDistanceKm: null, averageWalkingSpeedKmh: null,
      }],
    };
    const sample = sampleRecoveryDay({
      target, donors: [donor], random: new SeededRandom(75), config: DEFAULT_RECOVERY_CONFIG,
    });
    expect(sample.occupationalActivity.intervals).toEqual([{
      category: "manualLight", durationHours: 8, breakDurationHours: 0.5,
      workWalkingDistanceKm: 4, averageWalkingSpeedKmh: 4.8,
    }]);
    expect(sample.measuredWeightKg).toBeNull();
  });
});
