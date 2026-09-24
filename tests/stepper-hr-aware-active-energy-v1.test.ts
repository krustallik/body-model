import { describe, expect, it } from "vitest";
import { canonicalizeWorkoutHeartRateEvidenceV7 } from "@/model/activity/workout-heart-rate-v7";
import { canonicalizeWorkoutStepperEvidenceV7 } from "@/model/activity/workout-stepper-v7";
import {
  estimateHrAwareStepperActiveEnergyV1,
  STEPPER_HR_AWARE_ACTIVE_ENERGY_V1_VERSION,
  type StepperHeartRateEnergyCalibrationV1,
} from "@/model/activity/stepper-hr-aware-active-energy-v1";
import { resolveExplicitWorkoutActivityKcal } from "@/model/activity/workout-energy";
import type { WorkoutHeartRateSampleV7 } from "@/model/activity/workout-heart-rate-v7";

const startAt = "2026-09-23T18:00:00.000Z";
const endAt = "2026-09-23T18:10:00.000Z";
const startMs = Date.parse(startAt);

function hrSample(offsetSeconds: number, bpm: number): WorkoutHeartRateSampleV7 {
  return {
    timestamp: new Date(startMs + offsetSeconds * 1_000).toISOString(),
    bpm,
    provenance: { provider: "garmin-connect", device: null },
  };
}

function evidence(samples: readonly WorkoutHeartRateSampleV7[] | null = [
  hrSample(0, 100), hrSample(300, 120), hrSample(600, 140),
]) {
  const heartRate = canonicalizeWorkoutHeartRateEvidenceV7({
    workoutInterval: { startAt, endAt },
    heartRate: samples === null ? { availability: "unavailable" } : { availability: "loaded", samples },
  });
  return canonicalizeWorkoutStepperEvidenceV7({
    workoutEnergy: {
      workoutId: 61,
      canonicalWorkoutType: "Stair Climbing",
      startAt,
      endAt,
      durationMinutes: 10,
      deviceEnergy: { availability: "available", sourceValueStatus: "observed", valueKcal: 356, semantics: "active", provenance: "device-estimate" },
      heartRate,
    },
    snapshots: [],
    stepIntervals: [{ id: 2, startAt, endAt, stepCount: 750 }],
  });
}

const calibration: StepperHeartRateEnergyCalibrationV1 = {
  contractVersion: "bodycast-ms100-hr-vo2-calibration-v1",
  validation: { status: "independent-holdout-validated", referenceMethod: "indirect-calorimetry", heldOutWorkoutCount: 2 },
  equipment: { machineFamily: "DOMYOS_MS100", configuration: "fixed" },
  heartRateSource: { provider: "garmin-connect", device: null },
  effectiveFrom: "2026-01-01T00:00:00.000Z",
  effectiveUntil: null,
  model: {
    vo2InterceptMlKgMin: 0,
    vo2SlopeMlKgMinPerBpm: 0.2,
    restingVo2MlKgMin: 3.5,
    acceptedHeartRateBpm: { min: 90, max: 150 },
    acceptedStepRatePerMinute: { min: 60, max: 90 },
    acceptedDurationMinutes: { min: 8, max: 15 },
    maximumInterSampleGapSeconds: 360,
    maximumEdgeGapSeconds: 60,
  },
};

describe("MS100 HR-aware energy v1", () => {
  it("keeps the mechanical baseline identical with and without an HR series", () => {
    const noHr = estimateHrAwareStepperActiveEnergyV1({ workout: evidence(null), bodyMassKg: 75, calibration: null, deviceActiveEnergyKcal: 356 });
    const withHr = estimateHrAwareStepperActiveEnergyV1({ workout: evidence(), bodyMassKg: 75, calibration: null, deviceActiveEnergyKcal: 356 });
    expect(noHr.modelVersion).toBe(STEPPER_HR_AWARE_ACTIVE_ENERGY_V1_VERSION);
    expect(withHr.mechanicalBaseline).toEqual(noHr.mechanicalBaseline);
    expect(withHr.selected).toMatchObject({ source: "mechanical-ms100", valueKcal: noHr.mechanicalBaseline.estimatedActiveKcal, impactVsMechanicalKcal: 0 });
  });

  it("integrates the time series through a validated personal calibration and replaces the mechanical baseline", () => {
    const result = estimateHrAwareStepperActiveEnergyV1({ workout: evidence(), bodyMassKg: 75, calibration, deviceActiveEnergyKcal: 356 });
    expect(result.hrAwareEstimate).toMatchObject({ availability: "available", timeWeightedMeanBpm: 120, timeWeightedMeanVo2MlKgMin: 24, conversionKcalPerLiterO2: 5 });
    expect(result.hrAwareEstimate.availability === "available" && result.hrAwareEstimate.activeKcal).toBeCloseTo(76.875);
    expect(result.selected.source).toBe("hr-calibrated-ms100");
    expect(result.selected.valueKcal).toBeCloseTo(76.875);
    expect(result.selected.valueKcal).not.toBe(356 + (result.mechanicalBaseline.estimatedActiveKcal ?? 0));
    expect(result.selected.impactVsMechanicalKcal).toBeCloseTo(76.875 - (result.mechanicalBaseline.estimatedActiveKcal ?? 0));
    expect(result.heartRate.quality).toBe("calibration-accepted");
  });

  it("uses the mechanical fallback when no personal calibration is registered", () => {
    const result = estimateHrAwareStepperActiveEnergyV1({ workout: evidence(), bodyMassKg: 75, calibration: null, deviceActiveEnergyKcal: 356 });
    expect(result.hrAwareEstimate).toEqual({ availability: "unavailable", reason: "no-personal-ms100-calibration" });
    expect(result.heartRate.quality).toBe("context-only");
    expect(result.selected.source).toBe("mechanical-ms100");
  });

  it("falls back for a large temporal gap, bad BPM, mismatched HR source, and unvalidated calibration", () => {
    const sparse = evidence([hrSample(0, 100), hrSample(600, 140)]);
    const gap = estimateHrAwareStepperActiveEnergyV1({ workout: sparse, bodyMassKg: 75, calibration: { ...calibration, model: { ...calibration.model, maximumInterSampleGapSeconds: 400 } }, deviceActiveEnergyKcal: 356 });
    expect(gap.hrAwareEstimate).toEqual({ availability: "unavailable", reason: "hr-gap-exceeds-calibrated-limit" });
    expect(gap.selected.source).toBe("mechanical-ms100");

    const anomalous = estimateHrAwareStepperActiveEnergyV1({ workout: evidence([hrSample(0, 100), hrSample(300, Number.NaN), hrSample(600, 140)]), bodyMassKg: 75, calibration, deviceActiveEnergyKcal: 356 });
    expect(anomalous.hrAwareEstimate).toEqual({ availability: "unavailable", reason: "hr-samples-invalid" });

    const wrongSource = estimateHrAwareStepperActiveEnergyV1({ workout: evidence([hrSample(0, 100), { ...hrSample(300, 120), provenance: { provider: "apple-health", device: null } }, hrSample(600, 140)]), bodyMassKg: 75, calibration, deviceActiveEnergyKcal: 356 });
    expect(wrongSource.hrAwareEstimate).toEqual({ availability: "unavailable", reason: "hr-source-does-not-match-calibration" });

    const unvalidated = estimateHrAwareStepperActiveEnergyV1({ workout: evidence(), bodyMassKg: 75, calibration: { ...calibration, validation: { ...calibration.validation, status: "experimental" as "independent-holdout-validated", heldOutWorkoutCount: 0 } }, deviceActiveEnergyKcal: 356 });
    expect(unvalidated.hrAwareEstimate.availability).toBe("unavailable");
    expect(unvalidated.selected.source).toBe("mechanical-ms100");
  });

  it("preserves device active energy as a distinct fallback when mechanical evidence is missing", () => {
    const missingSteps = canonicalizeWorkoutStepperEvidenceV7({
      workoutEnergy: evidence().workoutEnergy,
      snapshots: [],
      stepIntervals: [],
    });
    const result = estimateHrAwareStepperActiveEnergyV1({ workout: missingSteps, bodyMassKg: 75, calibration, deviceActiveEnergyKcal: 356 });
    expect(result.selected).toMatchObject({ source: "device-active-energy-fallback", valueKcal: 356, impactVsMechanicalKcal: null });
  });

  it("is deterministic and keeps the production resolver from double-counting device kcal", () => {
    const stepper = evidence();
    const event = {
      workoutId: 61,
      type: "Stair Climbing",
      canonicalType: "Stair Climbing" as const,
      classification: "stair-climbing" as const,
      startAt,
      endAt,
      durationMinutes: 10,
      activeEnergyKcal: 356,
      stepperEvidence: stepper,
      stepperHeartRateCalibration: calibration,
    };
    const first = resolveExplicitWorkoutActivityKcal({ events: [event], weightKg: 75, rmrKcalPerDay: 1_800 });
    const second = resolveExplicitWorkoutActivityKcal({ events: [event], weightKg: 75, rmrKcalPerDay: 1_800 });
    expect(first).toEqual(second);
    expect(first.perEvent[0]).toMatchObject({ source: "hr-calibrated-stepper", kcal: 76.875 });
    expect(first.workoutActivityKcal).toBeCloseTo(76.875);
    expect(first.deviceActiveEnergyKcal).toBe(0);
    expect(first.bodyCastStepperActiveEnergyKcal).toBeCloseTo(76.875);
    expect(first.perEvent[0].stepperEnergy?.modelVersion).toBe(STEPPER_HR_AWARE_ACTIVE_ENERGY_V1_VERSION);
  });

  it("exposes an available fixed-machine baseline", () => {
    const result = estimateHrAwareStepperActiveEnergyV1({ workout: evidence(), bodyMassKg: 75, calibration: null, deviceActiveEnergyKcal: null });
    expect(result.mechanicalBaseline.availability).toBe("available");
  });
});
