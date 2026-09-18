import { describe, expect, it, vi } from "vitest";
import { createUnavailablePhysiologyRuntimeStateV7 } from "@/model/physiology-v7/daily-runtime-v7";
import { PhysiologyV7RuntimeService } from "@/modules/model-episodes/physiology-v7-runtime.service";
import { observedNutritionProvenance } from "@/modules/model-episodes/nutrition-gap-bridge";

describe("PhysiologyV7RuntimeService production use case", () => {
  it("loads durable sources and invokes the real daily/runtime pipeline", async () => {
    const date = "2026-09-02";
    const loadRangeSources = vi.fn(async () => ({
      days: [{
        date,
        observedWeightKg: 79.5,
        observedBodyFatPercent: 20,
        nutrition: {
          caloriesKcal: 2_200,
          proteinG: 145,
          fatG: 70,
          carbsG: 240,
          provenance: observedNutritionProvenance(),
        },
        workoutFeedObserved: true,
        steps: 7_000,
        walkingRunningDistanceKm: 5,
        workouts: [],
        stepperWorkouts: [],
        context: {
          heartRateSampleCount: 0,
          restingHeartRateSampleCount: 0,
          sleepSegmentCount: 0,
        },
      }],
      exposure: {
        historyFromDate: date,
        days: [{ date, workoutFeedObserved: true }],
        strengthWorkouts: [],
        sessions: [],
      },
    }));
    const service = new PhysiologyV7RuntimeService({ loadRangeSources });
    const result = await service.rebuildProfileRange({
      profileId: 7,
      fromDate: date,
      toDate: date,
      timeZone: "Europe/Bratislava",
      initialState: createUnavailablePhysiologyRuntimeStateV7(),
    });

    expect(loadRangeSources).toHaveBeenCalledWith({
      profileId: 7,
      fromDate: date,
      toDate: date,
      historyFromDate: date,
      timeZone: "Europe/Bratislava",
    });
    expect(result.persistence).toBe("none-stage-9a");
    expect(result.days).toHaveLength(1);
    expect(result.days[0]!.fluidWater.contractVersion)
      .toBe("bodycast-fluid-water-transition-pipeline-v7-1");
    expect(result.days[0]!.observations.observedWeightKg).toMatchObject({
      availability: "available",
      valueKg: 79.5,
    });
  });
});
