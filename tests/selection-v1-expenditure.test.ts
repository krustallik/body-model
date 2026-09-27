import { describe, expect, it } from "vitest";
import { resolveExplicitWorkoutActivityKcal, canonicalizeWorkoutType } from "@/model/activity/workout-energy";
import { STAIR_CLIMBING_TYPE, TRADITIONAL_STRENGTH_TRAINING_TYPE } from "@/modules/health/expand-training-workouts";
import type { WorkoutStepperEvidenceV7 } from "@/model/activity/workout-stepper-v7";

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

function stairEvidence(steps: number): WorkoutStepperEvidenceV7 {
  return {
    workoutEnergy: {
      workoutId: 9,
      canonicalWorkoutType: STAIR_CLIMBING_TYPE,
      startAt: "2026-09-23T09:00:00.000Z",
      endAt: "2026-09-23T10:00:00.000Z",
      durationMinutes: 60,
      deviceEnergy: {
        availability: "available",
        sourceValueStatus: "observed",
        valueKcal: 400,
        semantics: "active",
        provenance: "device-estimate",
      },
      heartRate: {
        availability: "unavailable",
        availabilityReason: "no-hr-source",
        workoutInterval: { startAt: "2026-09-23T09:00:00.000Z", endAt: "2026-09-23T10:00:00.000Z" },
        samples: null,
        sampleCount: null,
        distinctSources: null,
        samplingTopology: null,
        summary: null,
      },
    },
    bracketedSteps: {
      availability: "available",
      before: null,
      after: null,
      preGapSeconds: null,
      postGapSeconds: null,
      derivedStepDelta: {
        value: steps,
        provenance: "health-step-interval-overlap",
      },
      intervalCoveragePercent: 100,
      observedIntervalStepCount: steps,
      derivedStepRatePerMinute: {
        value: steps / 60,
        provenance: "derived-from-health-step-interval-overlap-and-workout-duration",
      },
    },
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

  it("prefers BodyCast mechanical over Garmin active kcal for stair events", () => {
    const canonical = canonicalizeWorkoutType(STAIR_CLIMBING_TYPE);
    const result = resolveExplicitWorkoutActivityKcal({
      selectionPolicy: "bodycast-active-energy-selection-v1",
      weightKg: 80,
      rmrKcalPerDay: 1600,
      events: [{
        type: STAIR_CLIMBING_TYPE,
        canonicalType: canonical.canonicalType,
        classification: canonical.classification,
        startAt: "2026-09-23T09:00:00.000Z",
        endAt: "2026-09-23T10:00:00.000Z",
        durationMinutes: 60,
        activeEnergyKcal: 400,
        stepperEvidence: stairEvidence(2000),
      }],
    });
    expect(result.deviceActiveEnergyKcal).toBe(0);
    expect(result.bodyCastStepperActiveEnergyKcal).toBeGreaterThan(0);
    expect(result.bodyCastStepperActiveEnergyKcal).not.toBe(400);
    expect(result.perEvent[0]?.source).toBe("mechanical-stepper");
  });

  it("rejects a present-but-stale BodyCast strength shadow", () => {
    const result = resolveExplicitWorkoutActivityKcal({
      selectionPolicy: "bodycast-active-energy-selection-v1",
      weightKg: 80,
      rmrKcalPerDay: 1600,
      events: [strengthEvent({
        activeEnergyKcal: 400,
        bodyCastEstimateKcal: 250,
        bodyCastEstimateFresh: false,
        strengthSessionCompleted: true,
      })],
    });
    expect(result.workoutActivityKcal).toBe(400);
    expect(result.perEvent[0]?.source).toBe("device-active-kcal");
  });
});
