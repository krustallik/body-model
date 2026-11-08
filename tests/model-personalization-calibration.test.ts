import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import { createGlycogenParameters } from "@/model/body-composition/glycogen";
import { createDynamicRmrParameters } from "@/model/dynamic-rmr";
import {
  calibratePersonalization,
  createPersonalizationCalibrationConfig,
  evaluatePersonalization,
  type CalibrationDay,
  type PersonalizationCalibrationConfig,
} from "@/model/personalization-calibration";
import {
  simulateDays,
  type CompleteSimulationDay,
  type PhysiologicalDailyInput,
  type PhysiologicalSimulatorParameters,
  type PhysiologicalSimulatorState,
} from "@/model/physiological-simulator";

const initialState: PhysiologicalSimulatorState = {
  fatMassKg: 20,
  leanTissueKg: 40,
  glycogenKg: 0.5,
  baselineExtracellularFluidLiters: 15,
  extracellularFluidDeviationLiters: 0,
  adaptiveThermogenesisKcalPerDay: 0,
  weightFilterState: { estimatedWeightKg: 76.85, varianceKg2: 1 },
};

const simulatorParameters: PhysiologicalSimulatorParameters = {
  rmrParameters: createDynamicRmrParameters({
    initialRmrKcalPerDay: 1_600,
    initialFatMassKg: 20,
    initialLeanTissueKg: 40,
  }),
  glycogenParameters: createGlycogenParameters({ baselineCarbIntakeG: 200 }),
  baselineEnergyIntakeKcalPerDay: 2_900,
  adaptiveThermogenesis: { beta: 0.14, timeConstantDays: 14 },
  weightFilter: {
    processNoiseVarianceKg2PerDay: 0.0025,
    measurementNoiseVarianceKg2: 0.04,
  },
};

const dateAt = (index: number) => new Date(Date.UTC(2026, 0, index + 1))
  .toISOString().slice(0, 10);

function activityFor(index: number, varied: boolean) {
  if (!varied) {
    return {
      outsideWorkWalkingDistanceKm: 5,
      averageWalkingSpeedKmh: 5,
      strengthTrainingMinutes: 45,
      occupationalActivity: { category: "standingLight" as const, durationHours: 4 },
    };
  }
  // A sustained ramp excites trajectory curvature; merely alternating around
  // one weekly mean remains almost perfectly confounded with an offset.
  const distance = 1 + index * 0.08;
  const strength = Math.min(120, index * 0.75);
  const workHours = Math.min(9, 1 + index * 0.05);
  return {
    outsideWorkWalkingDistanceKm: distance,
    averageWalkingSpeedKmh: distance === 0 ? null : 5,
    strengthTrainingMinutes: strength,
    occupationalActivity: {
      category: workHours === 0 ? null : "manualModerate" as const,
      durationHours: workHours,
    },
  };
}

function baseDays(count: number, varied: boolean, caloriesKcal = 2_750) {
  return Array.from({ length: count }, (_, index): PhysiologicalDailyInput => ({
    date: dateAt(index),
    caloriesKcal,
    proteinG: 150,
    fatG: 70,
    carbsG: 200,
    ...activityFor(index, varied),
    sodiumChangeMgPerDay: null,
    measuredWeightKg: null,
  }));
}

function complete(result: ReturnType<typeof simulateDays>[number]): CompleteSimulationDay {
  if (result.status !== "complete") throw new Error(`unexpected ${result.status} day`);
  return result;
}

function syntheticHistory(input: {
  count: number;
  varied: boolean;
  personalOffsetKcalPerDay: number;
  activityCalibration: number;
  noise?: readonly number[];
  trueCaloriesKcal?: number;
  reportedCaloriesKcal?: number;
}): CalibrationDay[] {
  const days = baseDays(input.count, input.varied, input.trueCaloriesKcal ?? 2_750);
  const generated = simulateDays({
    initialState,
    parameters: simulatorParameters,
    days,
    options: { ecfPolicy: "hold-ecf" },
    personalization: {
      personalOffsetKcalPerDay: input.personalOffsetKcalPerDay,
      activityCalibration: input.activityCalibration,
    },
  }).map(complete);
  return days.map((day, index) => {
    const simulatorInput: CalibrationDay["simulatorInput"] = {
      caloriesKcal: input.reportedCaloriesKcal ?? day.caloriesKcal,
      proteinG: day.proteinG,
      fatG: day.fatG,
      carbsG: day.carbsG,
      outsideWorkWalkingDistanceKm: day.outsideWorkWalkingDistanceKm,
      averageWalkingSpeedKmh: day.averageWalkingSpeedKmh,
      strengthTrainingMinutes: day.strengthTrainingMinutes,
      occupationalActivity: { ...day.occupationalActivity },
      sodiumChangeMgPerDay: day.sodiumChangeMgPerDay,
    };
    return {
      date: day.date,
      simulatorInput,
      measuredWeightKg: generated[index].calculations.endWeightKg
        + (input.noise?.[index % input.noise.length] ?? 0),
    };
  });
}

const context = (history: readonly CalibrationDay[]) => ({
  initialState,
  simulatorParameters,
  history,
  ecfPolicy: "hold-ecf" as const,
});

describe("conservative deterministic personalization", () => {
  it("recovers known offset and Activity multiplier from long, excited synthetic history", () => {
    const history = syntheticHistory({
      count: 180,
      varied: true,
      personalOffsetKcalPerDay: 120,
      activityCalibration: 0.88,
      noise: [0, 0.08, -0.05, 0.03, -0.07],
    });
    const result = calibratePersonalization(context(history));
    expect(result.status).toBe("fully-calibrated");
    expect(Math.abs(result.parameters.personalOffsetKcalPerDay - 120)).toBeLessThan(25);
    expect(Math.abs(result.parameters.activityCalibration - 0.88)).toBeLessThan(0.03);
    expect(result.diagnostics.twoParameterIdentifiability).toBe("adequate");
    expect(result.diagnostics.personalizationAccepted).toBe(true);
    expect(result.diagnostics.validationNis!)
      .toBeLessThan(result.diagnostics.defaultValidationNis!);
  });

  it("uses offset-only calibration for moderate history", () => {
    const result = calibratePersonalization(context(syntheticHistory({
      count: 42,
      varied: true,
      personalOffsetKcalPerDay: 140,
      activityCalibration: 1,
    })));
    expect(result.status).toBe("offset-only");
    expect(result.parameters.personalOffsetKcalPerDay).toBeCloseTo(140, -1);
    expect(result.parameters.activityCalibration).toBe(1);
  });

  it("does not fit two parameters when Activity is nearly constant", () => {
    const result = calibratePersonalization(context(syntheticHistory({
      count: 70,
      varied: false,
      personalOffsetKcalPerDay: 120,
      activityCalibration: 0.85,
    })));
    expect(result.status).toBe("offset-only");
    expect(result.parameters.activityCalibration).toBe(1);
    expect(result.diagnostics.twoParameterIdentifiability)
      .toBe("insufficient-variation");
    expect(result.diagnostics.warnings).toContain("insufficient-activity-variation");
  });

  it("retains defaults for short history instead of overfitting", () => {
    const result = calibratePersonalization(context(syntheticHistory({
      count: 14,
      varied: true,
      personalOffsetKcalPerDay: 200,
      activityCalibration: 0.8,
    })));
    expect(result).toMatchObject({
      status: "insufficient-history",
      parameters: { personalOffsetKcalPerDay: 0, activityCalibration: 1 },
    });
    expect(result.diagnostics.observationCount).toBe(14);
    expect(result.diagnostics.observationSpanDays).toBe(14);
  });

  it("uses observation span zero/one semantics before any optimization", () => {
    const none = calibratePersonalization(context([]));
    expect(none.diagnostics.observationSpanDays).toBe(0);
    const one = calibratePersonalization(context(syntheticHistory({
      count: 1,
      varied: false,
      personalOffsetKcalPerDay: 100,
      activityCalibration: 1,
    })));
    expect(one.diagnostics.observationSpanDays).toBe(1);
    expect(one.status).toBe("insufficient-history");
  });

  it("retains scientific defaults when defaults generated the observations", () => {
    const result = calibratePersonalization(context(syntheticHistory({
      count: 70,
      varied: true,
      personalOffsetKcalPerDay: 0,
      activityCalibration: 1,
      noise: [0.03, -0.02, 0, 0.01, -0.02],
    })));
    expect(result.status).toBe("defaults-retained");
    expect(result.parameters).toEqual({
      personalOffsetKcalPerDay: 0,
      activityCalibration: 1,
    });
    expect(result.diagnostics.personalizationAccepted).toBe(false);
  });

  it("limits parameter movement from one large positive scale-weight outlier", () => {
    const clean = syntheticHistory({
      count: 90,
      varied: true,
      personalOffsetKcalPerDay: 120,
      activityCalibration: 0.88,
      noise: [0, 0.08, -0.05, 0.03, -0.07],
    });
    const contaminated = structuredClone(clean);
    contaminated[30].measuredWeightKg! += 2.5;
    const cleanResult = calibratePersonalization(context(clean));
    const outlierResult = calibratePersonalization(context(contaminated));

    const gaussian = createPersonalizationCalibrationConfig({
      observationLoss: { type: "gaussian" },
    });
    const gaussianClean = calibratePersonalization({ ...context(clean), config: gaussian });
    const gaussianOutlier = calibratePersonalization({
      ...context(contaminated),
      config: gaussian,
    });
    const robustOffsetMovement = Math.abs(outlierResult.parameters.personalOffsetKcalPerDay
      - cleanResult.parameters.personalOffsetKcalPerDay);
    const robustActivityMovement = Math.abs(outlierResult.parameters.activityCalibration
      - cleanResult.parameters.activityCalibration);
    const gaussianOffsetMovement = Math.abs(gaussianOutlier.parameters.personalOffsetKcalPerDay
      - gaussianClean.parameters.personalOffsetKcalPerDay);
    const gaussianActivityMovement = Math.abs(gaussianOutlier.parameters.activityCalibration
      - gaussianClean.parameters.activityCalibration);

    // Engineering regression limits: 5% and 4% of the respective prior scales.
    expect(robustOffsetMovement).toBeLessThan(10);
    expect(robustActivityMovement).toBeLessThan(0.01);
    expect(robustOffsetMovement).toBeLessThan(gaussianOffsetMovement * 0.25);
    expect(robustActivityMovement).toBeLessThan(gaussianActivityMovement * 0.25);
    expect(outlierResult.diagnostics).toMatchObject({
      observationLossType: "student-t",
      studentTDegreesOfFreedom: 5,
    });
    expect(outlierResult.diagnostics.largestStandardizedInnovation!).toBeGreaterThan(5);
    expect(outlierResult.diagnostics.minimumObservationWeight!).toBeLessThan(0.1);
  });

  it("limits parameter movement from one large negative scale-weight outlier", () => {
    const clean = syntheticHistory({
      count: 90,
      varied: true,
      personalOffsetKcalPerDay: 120,
      activityCalibration: 0.88,
      noise: [0, 0.08, -0.05, 0.03, -0.07],
    });
    const contaminated = structuredClone(clean);
    contaminated[30].measuredWeightKg! -= 2.5;
    const cleanResult = calibratePersonalization(context(clean));
    const outlierResult = calibratePersonalization(context(contaminated));


    expect(Math.abs(outlierResult.parameters.personalOffsetKcalPerDay
      - cleanResult.parameters.personalOffsetKcalPerDay)).toBeLessThan(10);
    expect(Math.abs(outlierResult.parameters.activityCalibration
      - cleanResult.parameters.activityCalibration)).toBeLessThan(0.01);
    expect(outlierResult.diagnostics.largestStandardizedInnovation!).toBeGreaterThan(5);
    expect(outlierResult.diagnostics.minimumObservationWeight!).toBeLessThan(0.1);
  });

  it("limits parameter movement from two isolated scale-weight outliers", () => {
    const clean = syntheticHistory({
      count: 90,
      varied: true,
      personalOffsetKcalPerDay: 120,
      activityCalibration: 0.88,
      noise: [0, 0.08, -0.05, 0.03, -0.07],
    });
    const contaminated = structuredClone(clean);
    contaminated[24].measuredWeightKg! += 2.5;
    contaminated[49].measuredWeightKg! += 2.5;
    const cleanResult = calibratePersonalization(context(clean));
    const outlierResult = calibratePersonalization(context(contaminated));

    // Two same-direction retained outliers get a slightly wider but still
    // conservative limit than one isolated outlier.
    expect(Math.abs(outlierResult.parameters.personalOffsetKcalPerDay
      - cleanResult.parameters.personalOffsetKcalPerDay)).toBeLessThan(15);
    expect(Math.abs(outlierResult.parameters.activityCalibration
      - cleanResult.parameters.activityCalibration)).toBeLessThan(0.015);
  });

  it("still learns a persistent systematic expenditure mismatch", () => {
    const result = calibratePersonalization(context(syntheticHistory({
      count: 42,
      varied: true,
      personalOffsetKcalPerDay: -180,
      activityCalibration: 1,
      noise: [0, 0.04, -0.03, 0.02],
    })));

    expect(result.status).toBe("offset-only");
    expect(Math.abs(result.parameters.personalOffsetKcalPerDay + 180)).toBeLessThan(15);
    expect(result.diagnostics.personalizationAccepted).toBe(true);
  });

  it("exposes the fundamental food-error confounding without claiming metabolism", () => {
    const result = calibratePersonalization(context(syntheticHistory({
      count: 70,
      varied: false,
      personalOffsetKcalPerDay: 0,
      activityCalibration: 1,
      trueCaloriesKcal: 2_750,
      reportedCaloriesKcal: 2_550,
    })));
    expect(result.status).toBe("offset-only");
    expect(result.parameters.personalOffsetKcalPerDay).toBeLessThan(-100);
  });

  it("allows missing weight to advance simulation but not contribute loss", () => {
    const history = syntheticHistory({
      count: 50,
      varied: true,
      personalOffsetKcalPerDay: 120,
      activityCalibration: 1,
    });
    for (let index = 1; index < history.length; index += 3) {
      history[index].measuredWeightKg = null;
    }
    const evaluation = evaluatePersonalization(context(history));
    expect(evaluation.status).toBe("complete");
    expect(evaluation.observations).toHaveLength(33);
    expect(evaluation.activityKcalPerDay).toHaveLength(50);
    expect(calibratePersonalization(context(history)).status).toBe("offset-only");
  });

  it("marks an incomplete physiological day as invalid history", () => {
    const history = syntheticHistory({
      count: 35,
      varied: true,
      personalOffsetKcalPerDay: 100,
      activityCalibration: 1,
    });
    history[10].simulatorInput.caloriesKcal = null;
    const result = calibratePersonalization(context(history));
    expect(result.status).toBe("invalid-history");
    expect(result.diagnostics.invalidDayDate).toBe(dateAt(10));
    expect(result.diagnostics.missingFields).toContain("caloriesKcal");
    expect(result.diagnostics.warnings).toContain("incomplete-simulation-day");
    const gaussianResult = calibratePersonalization({
      ...context(history),
      config: createPersonalizationCalibrationConfig({
        observationLoss: { type: "gaussian" },
      }),
    });
    expect(gaussianResult.diagnostics).toMatchObject({
      observationLossType: "gaussian",
      studentTDegreesOfFreedom: null,
    });
  });

  it("returns innovation likelihood diagnostics without smoothing leakage", () => {
    const history = syntheticHistory({
      count: 2,
      varied: false,
      personalOffsetKcalPerDay: 0,
      activityCalibration: 1,
    });
    history[0].measuredWeightKg! += 1;
    history[1].measuredWeightKg = null;
    const evaluation = evaluatePersonalization(context(history));
    expect(evaluation.status).toBe("complete");
    expect(evaluation.observations).toHaveLength(1);
    const observation = evaluation.observations[0];
    expect(observation.normalizedInnovationSquared).toBeCloseTo(
      observation.innovationKg ** 2 / observation.innovationVarianceKg2,
      12,
    );
    expect(observation.absoluteStandardizedInnovation).toBeCloseTo(
      Math.abs(observation.innovationKg) / Math.sqrt(observation.innovationVarianceKg2),
      12,
    );
    const degreesOfFreedom = 5;
    const scaleSquaredKg2 = observation.innovationVarianceKg2
      * (degreesOfFreedom - 2) / degreesOfFreedom;
    const scaledSquaredResidual = observation.innovationKg ** 2
      / (degreesOfFreedom * scaleSquaredKg2);
    const gammaTwoPointFive = 3 * Math.sqrt(Math.PI) / 4;
    const gammaThree = 2;
    const expectedStudentTNll = Math.log(gammaTwoPointFive)
      - Math.log(gammaThree)
      + 0.5 * Math.log(degreesOfFreedom * Math.PI * scaleSquaredKg2)
      + (degreesOfFreedom + 1) / 2 * Math.log1p(scaledSquaredResidual);
    expect(observation.negativeLogLikelihood).toBeCloseTo(expectedStudentTNll, 12);
    expect(observation.observationWeight).toBeCloseTo(
      1 / (1 + scaledSquaredResidual),
      12,
    );
    expect(scaleSquaredKg2 * degreesOfFreedom / (degreesOfFreedom - 2))
      .toBeCloseTo(observation.innovationVarianceKg2, 12);
    expect(evaluation.meanNegativeLogLikelihood).toBe(observation.negativeLogLikelihood);

    const gaussianEvaluation = evaluatePersonalization({
      ...context(history),
      observationLoss: { type: "gaussian" },
    });
    const gaussianObservation = gaussianEvaluation.observations[0];
    expect(gaussianObservation.negativeLogLikelihood).toBeCloseTo(
      0.5 * (
        Math.log(2 * Math.PI)
        + Math.log(gaussianObservation.innovationVarianceKg2)
        + gaussianObservation.normalizedInnovationSquared
      ),
      12,
    );
    expect(gaussianObservation.observationWeight).toBe(1);
    expect(gaussianEvaluation.observationLoss).toEqual({ type: "gaussian" });
    expect(() => evaluatePersonalization({
      ...context(history),
      observationLoss: { type: "student-t", degreesOfFreedom: 2 },
    })).toThrow("degreesOfFreedom must be > 2");

    const noObservations = evaluatePersonalization(context(history.map((day) => ({
      ...day,
      measuredWeightKg: null,
    }))));
    expect(noObservations).toMatchObject({
      negativeLogLikelihood: null,
      meanNegativeLogLikelihood: null,
      meanNormalizedInnovationSquared: null,
      rootMeanSquaredErrorKg: null,
      largestStandardizedInnovation: null,
      minimumObservationWeight: null,
    });
  });

  it("flags a bound solution and refuses to present it as trustworthy", () => {
    const result = calibratePersonalization(context(syntheticHistory({
      count: 42,
      varied: false,
      personalOffsetKcalPerDay: 900,
      activityCalibration: 1,
    })));
    expect(result.status).toBe("defaults-retained");
    expect(result.diagnostics.parameterAtBound).toContain("personalOffsetKcalPerDay");
    expect(result.diagnostics.warnings).toContain("parameter-at-bound");
  });

  it("reports an attempted Activity multiplier at its bound", () => {
    const result = calibratePersonalization(context(syntheticHistory({
      count: 100,
      varied: true,
      personalOffsetKcalPerDay: 0,
      activityCalibration: 0.2,
    })));
    expect(result.status).not.toBe("fully-calibrated");
    expect(result.diagnostics.parameterAtBound).toContain("activityCalibration");
    expect(result.diagnostics.warnings).toContain("parameter-at-bound");
  });

  it("falls back when the configured local loss probe detects a ridge", () => {
    const history = syntheticHistory({
      count: 90,
      varied: true,
      personalOffsetKcalPerDay: 120,
      activityCalibration: 0.88,
    });
    const config = createPersonalizationCalibrationConfig({
      ridgeMaxMeanNllIncrease: 1_000,
    });
    const result = calibratePersonalization({ ...context(history), config });
    expect(result.status).not.toBe("fully-calibrated");
    expect(result.diagnostics.twoParameterIdentifiability).toBe("weak");
    expect(result.diagnostics.warnings).toContain("weak-two-parameter-identifiability");
  });

  it("handles ridge probes outside configured parameter bounds", () => {
    const history = syntheticHistory({
      count: 100,
      varied: true,
      personalOffsetKcalPerDay: 120,
      activityCalibration: 0.88,
    });
    const config = createPersonalizationCalibrationConfig({
      ridgeProbeActivityDelta: 10,
    });
    const result = calibratePersonalization({ ...context(history), config });
    expect(result.status).toBe("fully-calibrated");
    expect(result.diagnostics.twoParameterIdentifiability).toBe("adequate");
  });

  it("treats all-zero Activity as known but non-identifying", () => {
    const history = syntheticHistory({
      count: 70,
      varied: false,
      personalOffsetKcalPerDay: 0,
      activityCalibration: 1,
    });
    for (const day of history) {
      day.simulatorInput.outsideWorkWalkingDistanceKm = 0;
      day.simulatorInput.averageWalkingSpeedKmh = null;
      day.simulatorInput.strengthTrainingMinutes = 0;
      day.simulatorInput.occupationalActivity = { category: null, durationHours: 0 };
    }
    const result = calibratePersonalization(context(history));
    expect(result.diagnostics.activityMeanKcalPerDay).toBe(0);
    expect(result.diagnostics.activityCoefficientOfVariation).toBeNull();
    expect(result.diagnostics.twoParameterIdentifiability)
      .toBe("insufficient-variation");
  });

  it("skips numerically invalid bounded candidates without losing determinism", () => {
    const history = syntheticHistory({
      count: 42,
      varied: false,
      personalOffsetKcalPerDay: 140,
      activityCalibration: 1,
    });
    const config = createPersonalizationCalibrationConfig({
      personalOffsetMinKcalPerDay: -5_000,
      personalOffsetMaxKcalPerDay: 500,
    });
    const result = calibratePersonalization({ ...context(history), config });
    expect(result.status).toBe("offset-only");
    expect(Number.isFinite(result.loss!)).toBe(true);
  });

  it("is bit-for-bit deterministic and does not mutate inputs", () => {
    const history = syntheticHistory({
      count: 60,
      varied: true,
      personalOffsetKcalPerDay: 100,
      activityCalibration: 0.9,
    });
    const before = structuredClone(history);
    const first = calibratePersonalization(context(history));
    const second = calibratePersonalization(context(history));
    expect(second).toEqual(first);
    expect(history).toEqual(before);
  });

  it("supports configurable gates and rejects invalid configuration", () => {
    const custom = createPersonalizationCalibrationConfig({
      minOffsetObservationCount: 5,
      minOffsetObservationSpanDays: 5,
      minFullObservationCount: 10,
      minFullObservationSpanDays: 10,
      minValidationObservationCount: 2,
    });
    expect(custom.minOffsetObservationCount).toBe(5);
    expect(custom.observationLoss).toEqual({
      type: "student-t",
      degreesOfFreedom: 5,
    });
    if (custom.observationLoss.type === "student-t") {
      custom.observationLoss.degreesOfFreedom = 7;
    }
    expect(createPersonalizationCalibrationConfig().observationLoss).toEqual({
      type: "student-t",
      degreesOfFreedom: 5,
    });
    const invalidOverrides: Partial<PersonalizationCalibrationConfig>[] = [
      { minOffsetObservationCount: 0 },
      { validationFraction: 0.5 },
      { minActivityStandardDeviationKcalPerDay: -1 },
      { personalOffsetMinKcalPerDay: 500 },
      { personalOffsetMinKcalPerDay: 1 },
      { activityCalibrationMin: -1 },
      { activityCalibrationMax: 0.9 },
      { personalOffsetPriorScaleKcalPerDay: 0 },
      { ridgeProbeActivityDelta: 0 },
      { ridgeMaxMeanNllIncrease: Number.NaN },
      { observationLoss: { type: "student-t", degreesOfFreedom: 2 } },
      { observationLoss: { type: "student-t", degreesOfFreedom: Number.NaN } },
      { observationLoss: { type: "unknown" } as never },
    ];
    for (const overrides of invalidOverrides) {
      expect(() => createPersonalizationCalibrationConfig(overrides)).toThrow();
    }
  });

  it.each([30, 60, 90])("keeps deterministic calibration runtime reasonable for %s days", (count) => {
    const history = syntheticHistory({
      count,
      varied: true,
      personalOffsetKcalPerDay: 100,
      activityCalibration: 0.9,
    });
    const started = performance.now();
    const result = calibratePersonalization(context(history));
    const elapsedMs = performance.now() - started;
    expect(result.status).not.toBe("invalid-history");
    expect(elapsedMs).toBeLessThan(5_000);
  });
});
