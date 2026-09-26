import { describe, expect, it } from "vitest";
import { resolveExplicitWorkoutActivityKcal } from "@/model/activity/workout-energy";
import { TRADITIONAL_STRENGTH_TRAINING_TYPE } from "@/modules/health/expand-training-workouts";
import { canonicalizeWorkoutType } from "@/model/activity/workout-energy";

function strengthEvent(override: {
  activeEnergyKcal: number | null;
  bodyCastEstimateKcal?: number | null;
  bodyCastEstimateFresh?: boolean;
  strengthSessionCompleted?: boolean;
}) {
  const canonical = canonicalizeWorkoutType(TRADITIONAL_STRENGTH_TRAINING_TYPE);
  return {
    type: TRADITIONAL_STRENGTH_TRAINING_TYPE,
    canonicalType: canonical.canonicalType,
    classification: canonical.classification,
    startAt: "2026-09-23T16:00:00.000Z",
    endAt: "2026-09-23T17:00:00.000Z",
    durationMinutes: 60,
    ...override,
  };
}

describe("selection v1 expenditure", () => {
  it("uses a fresh completed BodyCast estimate and does not add Garmin or MET", () => {
    const result = resolveExplicitWorkoutActivityKcal({
      selectionPolicy: "bodycast-active-energy-selection-v1",
      weightKg: 80,
      rmrKcalPerDay: 1600,
      events: [strengthEvent({
        activeEnergyKcal: 400,
        bodyCastEstimateKcal: 250,
        bodyCastEstimateFresh: true,
        strengthSessionCompleted: true,
      })],
    });
    expect(result.workoutActivityKcal).toBe(250);
    expect(result.strengthMetFallbackKcal).toBe(0);
    expect(result.deviceActiveEnergyKcal).toBe(0);
    expect(result.bodyCastStepperActiveEnergyKcal).toBe(0);
    expect(result.publishedStrengthEstimateKcal).toBe(250);
    expect(result.perEvent[0]?.source).toBe("bodycast-strength-estimate");
    expect(result.energyCoverage).toEqual({
      knownSubtotalKcal: 250,
      unknownEventCount: 0,
      fullCoverage: true,
    });
  });

  it("keeps 200 plus an unavailable workout as partial coverage", () => {
    const canonical = canonicalizeWorkoutType(TRADITIONAL_STRENGTH_TRAINING_TYPE);
    const result = resolveExplicitWorkoutActivityKcal({
      selectionPolicy: "bodycast-active-energy-selection-v1",
      weightKg: 80,
      rmrKcalPerDay: 1600,
      events: [
        strengthEvent({
          activeEnergyKcal: null,
          bodyCastEstimateKcal: 200,
          bodyCastEstimateFresh: true,
          strengthSessionCompleted: true,
        }),
        {
          type: TRADITIONAL_STRENGTH_TRAINING_TYPE,
          canonicalType: canonical.canonicalType,
          classification: canonical.classification,
          startAt: "2026-09-23T18:00:00.000Z",
          endAt: "2026-09-23T19:00:00.000Z",
          durationMinutes: 40,
          activeEnergyKcal: null,
          bodyCastEstimateKcal: null,
          bodyCastEstimateFresh: false,
          strengthSessionCompleted: true,
        },
      ],
    });
    expect(result.workoutActivityKcal).toBe(200);
    expect(result.strengthMetFallbackKcal).toBe(0);
    expect(result.energyCoverage?.unknownEventCount).toBe(1);
    expect(result.energyCoverage?.fullCoverage).toBe(false);
  });
});
