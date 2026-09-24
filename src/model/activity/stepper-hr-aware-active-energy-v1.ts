import { estimateExperimentalStepperActiveEnergyV1, type ExperimentalStepperActiveEnergyResultV1 } from "./experimental-stepper-active-energy-v1";
import { FIXED_STEPPER_EQUIPMENT_V7 } from "./personal-stepper-reference-v7";
import type { WorkoutStepperEvidenceV7 } from "./workout-stepper-v7";

export const STEPPER_HR_AWARE_ACTIVE_ENERGY_V1_VERSION =
  "bodycast-stepper-hr-aware-active-energy-v1" as const;

/**
 * A calibration may be registered only after same-person, same-MS100 HR/VO2
 * measurements have been independently checked against held-out indirect
 * calorimetry. The ranges and gap policy come from that validation protocol;
 * this module supplies no population defaults for them.
 */
export type StepperHeartRateEnergyCalibrationV1 = {
  contractVersion: "bodycast-ms100-hr-vo2-calibration-v1";
  validation: {
    status: "independent-holdout-validated";
    referenceMethod: "indirect-calorimetry";
    heldOutWorkoutCount: number;
  };
  equipment: { machineFamily: "DOMYOS_MS100"; configuration: "fixed" };
  heartRateSource: { provider: string; device: string | null };
  effectiveFrom: string;
  effectiveUntil: string | null;
  model: {
    /** VO2 in mL·kg⁻¹·min⁻¹ = intercept + slope × bpm. */
    vo2InterceptMlKgMin: number;
    vo2SlopeMlKgMinPerBpm: number;
    /** Individually measured resting VO2, subtracted for active energy. */
    restingVo2MlKgMin: number;
    acceptedHeartRateBpm: { min: number; max: number };
    acceptedStepRatePerMinute: { min: number; max: number };
    acceptedDurationMinutes: { min: number; max: number };
    maximumInterSampleGapSeconds: number;
    maximumEdgeGapSeconds: number;
  };
};

export type StepperHrDecisionReasonV1 =
  | "no-personal-ms100-calibration"
  | "hr-unavailable"
  | "hr-no-interval-samples"
  | "hr-samples-invalid"
  | "hr-sample-times-ambiguous"
  | "hr-source-does-not-match-calibration"
  | "calibration-not-valid-for-workout-date"
  | "calibration-not-holdout-validated"
  | "calibration-invalid"
  | "missing-body-mass"
  | "missing-step-rate"
  | "outside-calibrated-step-rate-range"
  | "outside-calibrated-duration-range"
  | "outside-calibrated-heart-rate-range"
  | "hr-edge-gap-exceeds-calibrated-limit"
  | "hr-gap-exceeds-calibrated-limit"
  | "missing-mechanical-and-device-energy";

export type StepperHrAwareActiveEnergyResultV1 = {
  modelVersion: typeof STEPPER_HR_AWARE_ACTIVE_ENERGY_V1_VERSION;
  provenance: "experimental-ms100-hr-vo2-calibration";
  mechanicalBaseline: Pick<
    ExperimentalStepperActiveEnergyResultV1,
    "availability" | "estimatedActiveKcal" | "lowerBoundKcal" | "upperBoundKcal" | "unavailableReason" | "contractVersion"
  >;
  heartRate: {
    availability: "unavailable" | "loaded";
    sampleCount: number;
    sampleMeanBpm: number | null;
    maxObservedBpm: number | null;
    sampledCoveragePercent: number | null;
    largestInterSampleGapSeconds: number | null;
    leadingGapSeconds: number | null;
    trailingGapSeconds: number | null;
    quality: "unavailable" | "context-only" | "data-rejected" | "calibration-accepted" | "calibration-rejected";
    decisionReason: StepperHrDecisionReasonV1 | null;
  };
  hrAwareEstimate: {
    availability: "available";
    activeKcal: number;
    timeWeightedMeanBpm: number;
    timeWeightedMeanVo2MlKgMin: number;
    conversionKcalPerLiterO2: 5;
    calibrationContractVersion: StepperHeartRateEnergyCalibrationV1["contractVersion"];
  } | {
    availability: "unavailable";
    reason: StepperHrDecisionReasonV1;
  };
  selected: {
    availability: "available";
    source: "hr-calibrated-ms100" | "mechanical-ms100" | "device-active-energy-fallback";
    valueKcal: number;
    impactVsMechanicalKcal: number | null;
  } | {
    availability: "unavailable";
    source: "none";
    valueKcal: null;
    impactVsMechanicalKcal: null;
    reason: "missing-mechanical-and-device-energy";
  };
};

type HrSegment = { startMs: number; endMs: number; startBpm: number; endBpm: number };

function observedHrMetrics(workout: WorkoutStepperEvidenceV7) {
  const hr = workout.workoutEnergy.heartRate;
  if (hr.availability === "unavailable" || hr.samples.length === 0) {
    return { coveragePercent: null, largestGapSeconds: null, leadingGapSeconds: null, trailingGapSeconds: null };
  }
  const startMs = Date.parse(workout.workoutEnergy.startAt);
  const endMs = Date.parse(workout.workoutEnergy.endAt);
  const firstMs = Date.parse(hr.samples[0].timestamp);
  const lastMs = Date.parse(hr.samples.at(-1)!.timestamp);
  const gaps = hr.samples.slice(1).map((sample, index) => (
    (Date.parse(sample.timestamp) - Date.parse(hr.samples[index].timestamp)) / 1_000
  ));
  return {
    coveragePercent: endMs > startMs
      ? Math.max(0, Math.min(100, (lastMs - firstMs) / (endMs - startMs) * 100))
      : null,
    largestGapSeconds: gaps.length > 0 ? Math.max(...gaps) : null,
    leadingGapSeconds: Math.max(0, firstMs - startMs) / 1_000,
    trailingGapSeconds: Math.max(0, endMs - lastMs) / 1_000,
  };
}

function finitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function rangeIsValid(range: { min: number; max: number }, allowZero = false): boolean {
  const minOkay = allowZero ? Number.isFinite(range.min) && range.min >= 0 : finitePositive(range.min);
  return minOkay && finitePositive(range.max) && range.max >= range.min;
}

function calibrationIsValid(calibration: StepperHeartRateEnergyCalibrationV1): boolean {
  const { model } = calibration;
  return calibration.contractVersion === "bodycast-ms100-hr-vo2-calibration-v1"
    && calibration.validation.status === "independent-holdout-validated"
    && calibration.validation.referenceMethod === "indirect-calorimetry"
    && Number.isInteger(calibration.validation.heldOutWorkoutCount)
    && calibration.validation.heldOutWorkoutCount > 0
    && calibration.equipment.machineFamily === FIXED_STEPPER_EQUIPMENT_V7.machineFamily
    && calibration.equipment.configuration === FIXED_STEPPER_EQUIPMENT_V7.configuration
    && calibration.heartRateSource.provider.trim().length > 0
    && Number.isFinite(model.vo2InterceptMlKgMin)
    && finitePositive(model.vo2SlopeMlKgMinPerBpm)
    && finitePositive(model.restingVo2MlKgMin)
    && rangeIsValid(model.acceptedHeartRateBpm)
    && rangeIsValid(model.acceptedStepRatePerMinute, true)
    && rangeIsValid(model.acceptedDurationMinutes)
    && finitePositive(model.maximumInterSampleGapSeconds)
    && finitePositive(model.maximumEdgeGapSeconds)
    && Number.isFinite(Date.parse(calibration.effectiveFrom))
    && (calibration.effectiveUntil === null
      || Number.isFinite(Date.parse(calibration.effectiveUntil))
        && Date.parse(calibration.effectiveUntil) > Date.parse(calibration.effectiveFrom));
}

function deriveSegments(input: {
  workout: WorkoutStepperEvidenceV7;
  calibration: StepperHeartRateEnergyCalibrationV1;
}): { segments: HrSegment[]; reason: StepperHrDecisionReasonV1 | null; coveragePercent: number | null; largestGapSeconds: number | null; leadingGapSeconds: number | null; trailingGapSeconds: number | null } {
  const hr = input.workout.workoutEnergy.heartRate;
  const startMs = Date.parse(input.workout.workoutEnergy.startAt);
  const endMs = Date.parse(input.workout.workoutEnergy.endAt);
  const durationMs = endMs - startMs;
  if (hr.availability === "unavailable") {
    return { segments: [], reason: "hr-unavailable", coveragePercent: null, largestGapSeconds: null, leadingGapSeconds: null, trailingGapSeconds: null };
  }
  const samples = hr.samples;
  if (samples.length === 0) {
    return { segments: [], reason: "hr-no-interval-samples", coveragePercent: null, largestGapSeconds: null, leadingGapSeconds: null, trailingGapSeconds: null };
  }
  if (samples.some((sample) => !finitePositive(sample.bpm))) {
    return { segments: [], reason: "hr-samples-invalid", coveragePercent: null, largestGapSeconds: null, leadingGapSeconds: null, trailingGapSeconds: null };
  }
  for (let index = 1; index < samples.length; index += 1) {
    if (Date.parse(samples[index].timestamp) <= Date.parse(samples[index - 1].timestamp)) {
      return { segments: [], reason: "hr-sample-times-ambiguous", coveragePercent: null, largestGapSeconds: null, leadingGapSeconds: null, trailingGapSeconds: null };
    }
  }
  const firstMs = Date.parse(samples[0].timestamp);
  const lastMs = Date.parse(samples.at(-1)!.timestamp);
  const leadingGapSeconds = Math.max(0, firstMs - startMs) / 1_000;
  const trailingGapSeconds = Math.max(0, endMs - lastMs) / 1_000;
  const interSampleGaps = samples.slice(1).map((sample, index) => (
    (Date.parse(sample.timestamp) - Date.parse(samples[index].timestamp)) / 1_000
  ));
  const largestGapSeconds = interSampleGaps.length ? Math.max(...interSampleGaps) : null;
  const sampledCoveragePercent = durationMs > 0
    ? Math.max(0, Math.min(100, (lastMs - firstMs) / durationMs * 100))
    : null;
  if (leadingGapSeconds > input.calibration.model.maximumEdgeGapSeconds
      || trailingGapSeconds > input.calibration.model.maximumEdgeGapSeconds) {
    return { segments: [], reason: "hr-edge-gap-exceeds-calibrated-limit", coveragePercent: sampledCoveragePercent, largestGapSeconds, leadingGapSeconds, trailingGapSeconds };
  }
  if (interSampleGaps.some((gap) => gap > input.calibration.model.maximumInterSampleGapSeconds)) {
    return { segments: [], reason: "hr-gap-exceeds-calibrated-limit", coveragePercent: sampledCoveragePercent, largestGapSeconds, leadingGapSeconds, trailingGapSeconds };
  }
  const segments: HrSegment[] = [];
  if (leadingGapSeconds > 0) {
    segments.push({ startMs, endMs: firstMs, startBpm: samples[0].bpm, endBpm: samples[0].bpm });
  }
  for (let index = 1; index < samples.length; index += 1) {
    segments.push({
      startMs: Date.parse(samples[index - 1].timestamp),
      endMs: Date.parse(samples[index].timestamp),
      startBpm: samples[index - 1].bpm,
      endBpm: samples[index].bpm,
    });
  }
  if (trailingGapSeconds > 0) {
    const last = samples.at(-1)!;
    segments.push({ startMs: lastMs, endMs, startBpm: last.bpm, endBpm: last.bpm });
  }
  return { segments, reason: null, coveragePercent: sampledCoveragePercent, largestGapSeconds, leadingGapSeconds, trailingGapSeconds };
}

function integrateMean(input: { segments: readonly HrSegment[]; startMs: number; endMs: number }): number | null {
  let bpmMilliseconds = 0;
  let coveredMilliseconds = 0;
  for (const segment of input.segments) {
    const duration = segment.endMs - segment.startMs;
    if (!(duration > 0)) continue;
    bpmMilliseconds += (segment.startBpm + segment.endBpm) / 2 * duration;
    coveredMilliseconds += duration;
  }
  if (!(input.endMs > input.startMs) || coveredMilliseconds !== input.endMs - input.startMs) return null;
  return bpmMilliseconds / coveredMilliseconds;
}

function rejectedResult(input: {
  mechanical: ExperimentalStepperActiveEnergyResultV1;
  heartRate: StepperHrAwareActiveEnergyResultV1["heartRate"];
  reason: StepperHrDecisionReasonV1;
  deviceActiveEnergyKcal: number | null;
}): StepperHrAwareActiveEnergyResultV1 {
  const { mechanical, heartRate, reason, deviceActiveEnergyKcal } = input;
  const unavailableHr = { availability: "unavailable" as const, reason };
  if (mechanical.availability === "available" && mechanical.estimatedActiveKcal !== null) {
    return {
      modelVersion: STEPPER_HR_AWARE_ACTIVE_ENERGY_V1_VERSION,
      provenance: "experimental-ms100-hr-vo2-calibration",
      mechanicalBaseline: {
        availability: mechanical.availability,
        estimatedActiveKcal: mechanical.estimatedActiveKcal,
        lowerBoundKcal: mechanical.lowerBoundKcal,
        upperBoundKcal: mechanical.upperBoundKcal,
        unavailableReason: mechanical.unavailableReason,
        contractVersion: mechanical.contractVersion,
      },
      heartRate,
      hrAwareEstimate: unavailableHr,
      selected: { availability: "available", source: "mechanical-ms100", valueKcal: mechanical.estimatedActiveKcal, impactVsMechanicalKcal: 0 },
    };
  }
  if (deviceActiveEnergyKcal !== null && deviceActiveEnergyKcal > 0) {
    return {
      modelVersion: STEPPER_HR_AWARE_ACTIVE_ENERGY_V1_VERSION,
      provenance: "experimental-ms100-hr-vo2-calibration",
      mechanicalBaseline: {
        availability: mechanical.availability,
        estimatedActiveKcal: mechanical.estimatedActiveKcal,
        lowerBoundKcal: mechanical.lowerBoundKcal,
        upperBoundKcal: mechanical.upperBoundKcal,
        unavailableReason: mechanical.unavailableReason,
        contractVersion: mechanical.contractVersion,
      },
      heartRate,
      hrAwareEstimate: unavailableHr,
      selected: { availability: "available", source: "device-active-energy-fallback", valueKcal: deviceActiveEnergyKcal, impactVsMechanicalKcal: null },
    };
  }
  return {
    modelVersion: STEPPER_HR_AWARE_ACTIVE_ENERGY_V1_VERSION,
    provenance: "experimental-ms100-hr-vo2-calibration",
    mechanicalBaseline: {
      availability: mechanical.availability,
      estimatedActiveKcal: mechanical.estimatedActiveKcal,
      lowerBoundKcal: mechanical.lowerBoundKcal,
      upperBoundKcal: mechanical.upperBoundKcal,
      unavailableReason: mechanical.unavailableReason,
      contractVersion: mechanical.contractVersion,
    },
    heartRate,
    hrAwareEstimate: unavailableHr,
    selected: {
      availability: "unavailable",
      source: "none",
      valueKcal: null,
      impactVsMechanicalKcal: null,
      reason: "missing-mechanical-and-device-energy",
    },
  };
}

/**
 * HR is integrated over the entire workout from the ordered time series. A
 * validated personal MS100 calibration can replace (never add to) the
 * mechanical estimate. With no calibration, the baseline is returned exactly
 * as-is; Garmin is only a fallback when that baseline cannot be computed.
 */
export function estimateHrAwareStepperActiveEnergyV1(input: {
  workout: WorkoutStepperEvidenceV7;
  bodyMassKg: number | null;
  calibration: StepperHeartRateEnergyCalibrationV1 | null;
  deviceActiveEnergyKcal: number | null;
}): StepperHrAwareActiveEnergyResultV1 {
  const mechanical = estimateExperimentalStepperActiveEnergyV1({
    workout: input.workout,
    bodyMassKg: input.bodyMassKg,
    equipment: FIXED_STEPPER_EQUIPMENT_V7,
  });
  const hrEvidence = input.workout.workoutEnergy.heartRate;
  const observedMetrics = observedHrMetrics(input.workout);
  const hr: StepperHrAwareActiveEnergyResultV1["heartRate"] = {
    availability: hrEvidence.availability,
    sampleCount: hrEvidence.availability === "loaded" ? hrEvidence.sampleCount : 0,
    sampleMeanBpm: hrEvidence.availability === "loaded" ? hrEvidence.summary?.sampleMeanBpm ?? null : null,
    maxObservedBpm: hrEvidence.availability === "loaded" ? hrEvidence.summary?.maxObservedBpm ?? null : null,
    sampledCoveragePercent: observedMetrics.coveragePercent,
    largestInterSampleGapSeconds: observedMetrics.largestGapSeconds,
    leadingGapSeconds: observedMetrics.leadingGapSeconds,
    trailingGapSeconds: observedMetrics.trailingGapSeconds,
    quality: (hrEvidence.availability === "loaded" && hrEvidence.sampleCount > 0
      ? "context-only" as const
      : "unavailable" as const),
    decisionReason: null as StepperHrDecisionReasonV1 | null,
  };

  const reject = (reason: StepperHrDecisionReasonV1) => {
    hr.quality = hrEvidence.availability === "unavailable" || hrEvidence.sampleCount === 0
      ? "unavailable"
      : reason === "no-personal-ms100-calibration"
        ? "context-only"
        : reason === "hr-samples-invalid" || reason === "hr-sample-times-ambiguous"
          ? "data-rejected"
        : "calibration-rejected";
    hr.decisionReason = reason;
    return rejectedResult({ mechanical, heartRate: hr, reason, deviceActiveEnergyKcal: input.deviceActiveEnergyKcal });
  };

  if (input.bodyMassKg === null || !Number.isFinite(input.bodyMassKg) || input.bodyMassKg <= 0) return reject("missing-body-mass");
  if (input.workout.bracketedSteps.availability !== "available") return reject("missing-step-rate");
  const stepRate = input.workout.bracketedSteps.derivedStepRatePerMinute?.value;
  if (stepRate === undefined || !finitePositive(stepRate)) return reject("missing-step-rate");
  if (hrEvidence.availability === "loaded"
      && hrEvidence.samples.some((sample) => !finitePositive(sample.bpm))) return reject("hr-samples-invalid");
  if (hrEvidence.availability === "loaded"
      && hrEvidence.samples.some((sample, index) => index > 0
        && Date.parse(sample.timestamp) <= Date.parse(hrEvidence.samples[index - 1].timestamp))) return reject("hr-sample-times-ambiguous");
  if (input.calibration === null) return reject(hrEvidence.availability === "unavailable" ? "hr-unavailable" : hrEvidence.sampleCount === 0 ? "hr-no-interval-samples" : "no-personal-ms100-calibration");
  if (!calibrationIsValid(input.calibration)) return reject(input.calibration.validation.status !== "independent-holdout-validated" || input.calibration.validation.heldOutWorkoutCount <= 0 ? "calibration-not-holdout-validated" : "calibration-invalid");

  const calibration = input.calibration;
  const startAt = input.workout.workoutEnergy.startAt;
  const endAt = input.workout.workoutEnergy.endAt;
  const startMs = Date.parse(startAt);
  const endMs = Date.parse(endAt);
  const workoutDate = startMs;
  if (workoutDate < Date.parse(calibration.effectiveFrom)
      || (calibration.effectiveUntil !== null && workoutDate >= Date.parse(calibration.effectiveUntil))) {
    return reject("calibration-not-valid-for-workout-date");
  }
  if (input.workout.workoutEnergy.durationMinutes === null
      || input.workout.workoutEnergy.durationMinutes < calibration.model.acceptedDurationMinutes.min
      || input.workout.workoutEnergy.durationMinutes > calibration.model.acceptedDurationMinutes.max) {
    return reject("outside-calibrated-duration-range");
  }
  if (stepRate < calibration.model.acceptedStepRatePerMinute.min
      || stepRate > calibration.model.acceptedStepRatePerMinute.max) {
    return reject("outside-calibrated-step-rate-range");
  }
  if (hrEvidence.availability === "unavailable") return reject("hr-unavailable");
  if (hrEvidence.samples.length === 0) return reject("hr-no-interval-samples");
  if (hrEvidence.samples.some((sample) => sample.provenance.provider !== calibration.heartRateSource.provider
      || sample.provenance.device !== calibration.heartRateSource.device)) return reject("hr-source-does-not-match-calibration");
  if (hrEvidence.samples.some((sample) => sample.bpm < calibration.model.acceptedHeartRateBpm.min
      || sample.bpm > calibration.model.acceptedHeartRateBpm.max)) return reject("outside-calibrated-heart-rate-range");

  const derived = deriveSegments({ workout: input.workout, calibration });
  hr.sampledCoveragePercent = derived.coveragePercent;
  hr.largestInterSampleGapSeconds = derived.largestGapSeconds;
  hr.leadingGapSeconds = derived.leadingGapSeconds;
  hr.trailingGapSeconds = derived.trailingGapSeconds;
  if (derived.reason !== null) return reject(derived.reason);
  const timeWeightedMeanBpm = integrateMean({ segments: derived.segments, startMs, endMs });
  if (timeWeightedMeanBpm === null) return reject("hr-samples-invalid");
  const vo2 = calibration.model.vo2InterceptMlKgMin
    + calibration.model.vo2SlopeMlKgMinPerBpm * timeWeightedMeanBpm;
  if (!Number.isFinite(vo2) || vo2 < calibration.model.restingVo2MlKgMin) return reject("calibration-invalid");
  // Halsey et al. use 1 L O2 ≈ 5 kcal; subtract individually measured resting
  // VO2 so the result has active (net), not gross, energy semantics.
  const activeKcal = (vo2 - calibration.model.restingVo2MlKgMin)
    * input.bodyMassKg / 1_000
    * (input.workout.workoutEnergy.durationMinutes ?? 0)
    * 5;
  if (!Number.isFinite(activeKcal) || activeKcal < 0) return reject("calibration-invalid");

  const mechanicalKcal = mechanical.availability === "available" ? mechanical.estimatedActiveKcal : null;
  hr.quality = "calibration-accepted";
  hr.decisionReason = null;
  return {
    modelVersion: STEPPER_HR_AWARE_ACTIVE_ENERGY_V1_VERSION,
    provenance: "experimental-ms100-hr-vo2-calibration",
    mechanicalBaseline: {
      availability: mechanical.availability,
      estimatedActiveKcal: mechanical.estimatedActiveKcal,
      lowerBoundKcal: mechanical.lowerBoundKcal,
      upperBoundKcal: mechanical.upperBoundKcal,
      unavailableReason: mechanical.unavailableReason,
      contractVersion: mechanical.contractVersion,
    },
    heartRate: hr,
    hrAwareEstimate: {
      availability: "available",
      activeKcal,
      timeWeightedMeanBpm,
      timeWeightedMeanVo2MlKgMin: vo2,
      conversionKcalPerLiterO2: 5,
      calibrationContractVersion: calibration.contractVersion,
    },
    selected: {
      availability: "available",
      source: "hr-calibrated-ms100",
      valueKcal: activeKcal,
      impactVsMechanicalKcal: mechanicalKcal === null ? null : activeKcal - mechanicalKcal,
    },
  };
}
