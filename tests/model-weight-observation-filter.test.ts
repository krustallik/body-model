import { describe, expect, it } from "vitest";
import {
  DEFAULT_WEIGHT_MEASUREMENT_NOISE_VARIANCE_KG2,
  initializeWeightFilterState,
  predictWeightFilterState,
  updateWeightFilterWithMeasurement,
  type WeightFilterState,
} from "@/model/weight-observation-filter";

function filterSeries(values: Array<number | null>, initial?: WeightFilterState) {
  let state = initial ?? initializeWeightFilterState({ measuredWeightKg: values[0] });
  const states = [state];
  for (const measuredWeightKg of values.slice(initial ? 0 : 1)) {
    const prediction = predictWeightFilterState({ state });
    state = updateWeightFilterWithMeasurement({ predictedState: prediction, measuredWeightKg }).state;
    states.push(state);
  }
  return states;
}

describe("weight observation filter", () => {
  it("initializes from the first valid measurement", () => {
    expect(initializeWeightFilterState({ measuredWeightKg: 80.25 })).toEqual({
      estimatedWeightKg: 80.25,
      varianceKg2: DEFAULT_WEIGHT_MEASUREMENT_NOISE_VARIANCE_KG2,
    });
  });

  it("initializes from an external physiological prediction without fake history", () => {
    expect(initializeWeightFilterState({ measuredWeightKg: null, predictedWeightKg: 80.4 })).toEqual({
      estimatedWeightKg: 80.4,
      varianceKg2: 1,
    });
  });

  it("combines an initial prediction and measurement probabilistically", () => {
    const state = initializeWeightFilterState({
      measuredWeightKg: 81,
      predictedWeightKg: 80,
      initialPredictionVarianceKg2: 1,
      measurementNoiseVarianceKg2: 0.25,
    });
    expect(state.estimatedWeightKg).toBeCloseTo(80.8, 12);
    expect(state.varianceKg2).toBeCloseTo(0.2, 12);
  });

  it("keeps stable repeated weights stable while reducing uncertainty", () => {
    const states = filterSeries([80.2, 80.2, 80.2, 80.2]);
    expect(states.at(-1)?.estimatedWeightKg).toBeCloseTo(80.2, 12);
    expect(states.at(-1)!.varianceKg2).toBeLessThan(states[0].varianceKg2);
  });

  it("does not let one isolated outlier dominate the latent estimate", () => {
    const states = filterSeries([80.2, 80.1, 80.3, 82, 80.4]);
    const beforeOutlier = states[2].estimatedWeightKg;
    const afterOutlier = states[3].estimatedWeightKg;
    expect(afterOutlier).toBeGreaterThan(beforeOutlier);
    expect(afterOutlier).toBeLessThan(81);
    expect(82 - afterOutlier).toBeGreaterThan(afterOutlier - beforeOutlier);
    expect(states.at(-1)!.estimatedWeightKg).toBeLessThan(afterOutlier);
  });

  it("follows a gradual real downward trend", () => {
    const states = filterSeries([80, 79.8, 79.6, 79.4, 79.2]);
    expect(states.at(-1)!.estimatedWeightKg).toBeLessThan(79.6);
    expect(states.slice(1).every((state, index) => state.estimatedWeightKg < states[index].estimatedWeightKg)).toBe(true);
  });

  it("follows a gradual real upward trend", () => {
    const states = filterSeries([80, 80.2, 80.4, 80.6, 80.8]);
    expect(states.at(-1)!.estimatedWeightKg).toBeGreaterThan(80.4);
    expect(states.slice(1).every((state, index) => state.estimatedWeightKg > states[index].estimatedWeightKg)).toBe(true);
  });

  it("performs prediction only for a missing measurement", () => {
    const state = { estimatedWeightKg: 80.2, varianceKg2: 0.25 };
    const prediction = predictWeightFilterState({ state });
    const update = updateWeightFilterWithMeasurement({ predictedState: prediction, measuredWeightKg: null });
    expect(update).toMatchObject({ measurementApplied: false, kalmanGain: null, innovationKg: null });
    expect(update.state).toEqual(prediction);
    expect(update.state.estimatedWeightKg).toBe(80.2);
  });

  it("accumulates uncertainty over several consecutive missing days", () => {
    const states = filterSeries([80, null, null, null]);
    expect(states.at(-1)!.estimatedWeightKg).toBe(80);
    expect(states.at(-1)!.varianceKg2).toBeCloseTo(0.28, 12);
  });

  it("accepts an external predicted weight during prediction", () => {
    const prediction = predictWeightFilterState({
      state: { estimatedWeightKg: 80, varianceKg2: 0.25 },
      predictedWeightKg: 79.7,
      elapsedDays: 2,
    });
    expect(prediction).toEqual({ estimatedWeightKg: 79.7, varianceKg2: 0.27 });
  });

  it("matches a fully worked scalar Kalman example", () => {
    const prediction = predictWeightFilterState({
      state: { estimatedWeightKg: 80, varianceKg2: 0.25 },
      processNoiseVarianceKg2PerDay: 0.01,
    });
    const update = updateWeightFilterWithMeasurement({
      predictedState: prediction,
      measuredWeightKg: 80.8,
      measurementNoiseVarianceKg2: 0.04,
    });
    expect(prediction.varianceKg2).toBeCloseTo(0.26, 12);
    expect(update.innovationKg).toBeCloseTo(0.8, 12);
    expect(update.innovationVarianceKg2).toBeCloseTo(0.3, 12);
    expect(update.kalmanGain).toBeCloseTo(0.8666666666666667, 12);
    expect(update.state.estimatedWeightKg).toBeCloseTo(80.69333333333333, 12);
    expect(update.state.varianceKg2).toBeCloseTo(0.034666666666666665, 12);
  });

  it("measurement updates reduce predicted uncertainty and predictions do not reduce it", () => {
    let state = initializeWeightFilterState({ measuredWeightKg: 80 });
    for (const measuredWeightKg of [80.1, 79.9, 80.05, 80]) {
      const prediction = predictWeightFilterState({ state });
      expect(prediction.varianceKg2).toBeGreaterThanOrEqual(state.varianceKg2);
      const update = updateWeightFilterWithMeasurement({ predictedState: prediction, measuredWeightKg });
      expect(update.state.varianceKg2).toBeGreaterThanOrEqual(0);
      expect(update.state.varianceKg2).toBeLessThan(prediction.varianceKg2);
      expect(Number.isFinite(update.state.estimatedWeightKg)).toBe(true);
      expect(Number.isFinite(update.state.varianceKg2)).toBe(true);
      state = update.state;
    }
  });

  it.each([
    () => initializeWeightFilterState({ measuredWeightKg: null }),
    () => initializeWeightFilterState({ measuredWeightKg: 0 }),
    () => initializeWeightFilterState({ measuredWeightKg: Number.NaN }),
    () => initializeWeightFilterState({ measuredWeightKg: Number.POSITIVE_INFINITY }),
    () => initializeWeightFilterState({ measuredWeightKg: 80, measurementNoiseVarianceKg2: 0 }),
    () => initializeWeightFilterState({ measuredWeightKg: null, predictedWeightKg: 80, initialPredictionVarianceKg2: -1 }),
    () => predictWeightFilterState({ state: { estimatedWeightKg: 0, varianceKg2: 1 } }),
    () => predictWeightFilterState({ state: { estimatedWeightKg: 80, varianceKg2: -1 } }),
    () => predictWeightFilterState({ state: { estimatedWeightKg: 80, varianceKg2: 1 }, elapsedDays: -1 }),
    () => predictWeightFilterState({ state: { estimatedWeightKg: 80, varianceKg2: 1 }, elapsedDays: Number.NaN }),
    () => predictWeightFilterState({ state: { estimatedWeightKg: 80, varianceKg2: 1 }, processNoiseVarianceKg2PerDay: -1 }),
    () => predictWeightFilterState({ state: { estimatedWeightKg: 80, varianceKg2: 1 }, predictedWeightKg: Number.POSITIVE_INFINITY }),
    () => updateWeightFilterWithMeasurement({ predictedState: { estimatedWeightKg: 80, varianceKg2: 1 }, measuredWeightKg: 0 }),
    () => updateWeightFilterWithMeasurement({ predictedState: { estimatedWeightKg: 80, varianceKg2: 1 }, measuredWeightKg: 80, measurementNoiseVarianceKg2: Number.NaN }),
  ])("rejects invalid values", (operation) => {
    expect(operation).toThrow();
  });

  it("never emits NaN or Infinity for valid decimal inputs", () => {
    let state = initializeWeightFilterState({ measuredWeightKg: 79.875 });
    for (let day = 1; day <= 1_000; day += 1) {
      const prediction = predictWeightFilterState({ state, elapsedDays: 0.25 });
      state = updateWeightFilterWithMeasurement({
        predictedState: prediction,
        measuredWeightKg: 79.875 + Math.sin(day) * 0.25,
      }).state;
      expect(Number.isFinite(state.estimatedWeightKg)).toBe(true);
      expect(Number.isFinite(state.varianceKg2)).toBe(true);
      expect(state.varianceKg2).toBeGreaterThanOrEqual(0);
    }
  });
});
