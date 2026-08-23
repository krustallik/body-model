import { describe, expect, it } from "vitest";
import {
  DEFAULT_ADAPTIVE_THERMOGENESIS_BETA,
  DEFAULT_ADAPTIVE_THERMOGENESIS_TIME_CONSTANT_DAYS,
  initializeAdaptiveThermogenesisState,
  stepAdaptiveThermogenesis,
} from "@/model/adaptive-thermogenesis";

const step = (
  currentAdaptiveThermogenesisKcalPerDay: number,
  currentEnergyIntakeKcalPerDay: number | null | undefined,
  baselineEnergyIntakeKcalPerDay: number | null | undefined = 2_500,
  elapsedDays = 1,
) => stepAdaptiveThermogenesis({
  currentAdaptiveThermogenesisKcalPerDay,
  currentEnergyIntakeKcalPerDay,
  baselineEnergyIntakeKcalPerDay,
  elapsedDays,
});

function repeatDays(currentIntake: number, days: number, initialAt = 0): number {
  let currentAt = initialAt;
  for (let day = 0; day < days; day += 1) {
    currentAt = step(currentAt, currentIntake)!.adaptiveThermogenesisKcalPerDay;
  }
  return currentAt;
}

describe("adaptive thermogenesis state transition", () => {
  it("initializes baseline adaptive thermogenesis at zero", () => {
    expect(initializeAdaptiveThermogenesisState()).toEqual({
      adaptiveThermogenesisKcalPerDay: 0,
    });
  });

  it("preserves baseline equilibrium", () => {
    expect(step(0, 2_500)).toMatchObject({
      adaptiveThermogenesisKcalPerDay: 0,
      deltaAdaptiveThermogenesisKcalPerDay: 0,
      deltaEnergyIntakeKcalPerDay: 0,
      targetAdaptiveThermogenesisKcalPerDay: 0,
    });
  });

  it("matches the golden analytic one-day deficit example", () => {
    const result = step(0, 2_000)!;
    const expectedDecay = Math.exp(-1 / 14);
    const expectedAt = -70 + 70 * expectedDecay;
    expect(DEFAULT_ADAPTIVE_THERMOGENESIS_BETA).toBe(0.14);
    expect(DEFAULT_ADAPTIVE_THERMOGENESIS_TIME_CONSTANT_DAYS).toBe(14);
    expect(result.deltaEnergyIntakeKcalPerDay).toBe(-500);
    expect(result.targetAdaptiveThermogenesisKcalPerDay).toBe(-70);
    expect(result.decayFactor).toBeCloseTo(expectedDecay, 14);
    expect(result.adaptiveThermogenesisKcalPerDay).toBeCloseTo(expectedAt, 12);
    expect(result.adaptiveThermogenesisKcalPerDay).toBeGreaterThan(-70);
    expect(result.adaptiveThermogenesisKcalPerDay).toBeLessThan(0);
  });

  it("moves progressively toward the target during sustained deficit", () => {
    const day1 = repeatDays(2_000, 1);
    const day7 = repeatDays(2_000, 7);
    const day14 = repeatDays(2_000, 14);
    expect(day7).toBeLessThan(day1);
    expect(day14).toBeLessThan(day7);
    expect(day14).toBeCloseTo(-70 * (1 - Math.exp(-1)), 12);
    expect(day14).toBeGreaterThan(-70);
  });

  it("uses the positive sign during sustained surplus", () => {
    const day1 = step(0, 3_000)!;
    expect(day1.deltaEnergyIntakeKcalPerDay).toBe(500);
    expect(day1.targetAdaptiveThermogenesisKcalPerDay).toBe(70);
    expect(day1.adaptiveThermogenesisKcalPerDay).toBeGreaterThan(0);
    expect(day1.adaptiveThermogenesisKcalPerDay).toBeLessThan(70);
    expect(repeatDays(3_000, 14)).toBeCloseTo(70 * (1 - Math.exp(-1)), 12);
  });

  it("returns gradually to zero when intake returns to baseline", () => {
    const restrictedAt = repeatDays(2_000, 42);
    const recoveryDay1 = step(restrictedAt, 2_500)!.adaptiveThermogenesisKcalPerDay;
    const recoveryDay14 = step(restrictedAt, 2_500, 2_500, 14)!.adaptiveThermogenesisKcalPerDay;
    expect(recoveryDay1).toBeGreaterThan(restrictedAt);
    expect(recoveryDay1).toBeLessThan(0);
    expect(recoveryDay14).toBeCloseTo(restrictedAt * Math.exp(-1), 12);
  });

  it("continues from current state when intake changes before equilibrium", () => {
    const restrictedAt = repeatDays(2_000, 5);
    const changed = step(restrictedAt, 2_300)!;
    expect(changed.previousAdaptiveThermogenesisKcalPerDay).toBe(restrictedAt);
    expect(changed.targetAdaptiveThermogenesisKcalPerDay).toBeCloseTo(-28, 12);
    expect(changed.adaptiveThermogenesisKcalPerDay).not.toBeCloseTo(
      step(0, 2_300)!.adaptiveThermogenesisKcalPerDay,
      12,
    );
  });

  it("accepts decimal intake and explicit zero intake", () => {
    expect(step(0, 2_123.45)?.adaptiveThermogenesisKcalPerDay).toBeLessThan(0);
    const zero = step(0, 0)!;
    expect(zero.deltaEnergyIntakeKcalPerDay).toBe(-2_500);
    expect(zero.targetAdaptiveThermogenesisKcalPerDay).toBeCloseTo(-350, 12);
  });

  it.each([null, undefined])("returns unavailable for missing current intake: %s", (current) => {
    expect(stepAdaptiveThermogenesis({
      currentAdaptiveThermogenesisKcalPerDay: 0,
      currentEnergyIntakeKcalPerDay: current,
      baselineEnergyIntakeKcalPerDay: 2_500,
    })).toBeNull();
  });

  it.each([null, undefined])("returns unavailable for missing baseline intake: %s", (baseline) => {
    expect(stepAdaptiveThermogenesis({
      currentAdaptiveThermogenesisKcalPerDay: 0,
      currentEnergyIntakeKcalPerDay: 2_000,
      baselineEnergyIntakeKcalPerDay: baseline,
    })).toBeNull();
  });

  it("converges toward beta times delta intake in the long run", () => {
    expect(repeatDays(2_000, 365)).toBeCloseTo(-70, 9);
    expect(repeatDays(3_000, 365)).toBeCloseTo(70, 9);
  });

  it("is time-step consistent under constant intake", () => {
    const oneTwoDayStep = step(0, 2_000, 2_500, 2)!.adaptiveThermogenesisKcalPerDay;
    const twoOneDaySteps = repeatDays(2_000, 2);
    expect(oneTwoDayStep).toBeCloseTo(twoOneDaySteps, 12);
  });

  it("supports configurable beta and time constant", () => {
    const result = stepAdaptiveThermogenesis({
      currentAdaptiveThermogenesisKcalPerDay: -10,
      currentEnergyIntakeKcalPerDay: 2_000,
      baselineEnergyIntakeKcalPerDay: 2_500,
      betaAdaptiveThermogenesis: 0.1,
      timeConstantDays: 7,
      elapsedDays: 0,
    })!;
    expect(result).toMatchObject({
      adaptiveThermogenesisKcalPerDay: -10,
      targetAdaptiveThermogenesisKcalPerDay: -50,
      decayFactor: 1,
      betaAdaptiveThermogenesis: 0.1,
      timeConstantDays: 7,
      elapsedDays: 0,
    });
  });

  it.each([
    { currentAdaptiveThermogenesisKcalPerDay: Number.NaN },
    { currentAdaptiveThermogenesisKcalPerDay: Number.POSITIVE_INFINITY },
    { betaAdaptiveThermogenesis: -0.1 },
    { betaAdaptiveThermogenesis: Number.NaN },
    { betaAdaptiveThermogenesis: Number.POSITIVE_INFINITY },
    { timeConstantDays: 0 },
    { timeConstantDays: -1 },
    { timeConstantDays: Number.NaN },
    { timeConstantDays: Number.POSITIVE_INFINITY },
    { elapsedDays: -1 },
    { elapsedDays: Number.NaN },
    { currentEnergyIntakeKcalPerDay: -1 },
    { currentEnergyIntakeKcalPerDay: Number.POSITIVE_INFINITY },
    { baselineEnergyIntakeKcalPerDay: -1 },
    { baselineEnergyIntakeKcalPerDay: Number.POSITIVE_INFINITY },
    {
      currentEnergyIntakeKcalPerDay: 1e308,
      baselineEnergyIntakeKcalPerDay: 0,
      betaAdaptiveThermogenesis: 2,
    },
  ])("rejects invalid input: $currentAdaptiveThermogenesisKcalPerDay/$betaAdaptiveThermogenesis/$timeConstantDays", (overrides) => {
    expect(() => stepAdaptiveThermogenesis({
      currentAdaptiveThermogenesisKcalPerDay: 0,
      currentEnergyIntakeKcalPerDay: 2_000,
      baselineEnergyIntakeKcalPerDay: 2_500,
      ...overrides,
    })).toThrow();
  });

  it("never produces NaN or Infinity across valid repeated transitions", () => {
    let currentAt = 0;
    for (let day = 0; day < 10_000; day += 1) {
      const intake = 2_500 + Math.sin(day / 30) * 750;
      const result = step(currentAt, intake)!;
      currentAt = result.adaptiveThermogenesisKcalPerDay;
      expect(Number.isFinite(currentAt)).toBe(true);
      expect(Number.isFinite(result.deltaAdaptiveThermogenesisKcalPerDay)).toBe(true);
    }
  });
});
