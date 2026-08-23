import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import { createGlycogenParameters } from "@/model/body-composition/glycogen";
import { reconstructBodyWeightKg } from "@/model/body-composition/state";
import { calculateDynamicDailyExpenditure } from "@/model/dynamic-daily-expenditure";
import { createDynamicRmrParameters } from "@/model/dynamic-rmr";
import {
  simulateDays,
  simulateOneDay,
  type CompleteSimulationDay,
  type PhysiologicalDailyInput,
  type PhysiologicalSimulatorParameters,
  type PhysiologicalSimulatorState,
  type SimulationDayResult,
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

const rmrParameters = createDynamicRmrParameters({
  initialRmrKcalPerDay: 1_600,
  initialFatMassKg: 20,
  initialLeanTissueKg: 40,
});

const baselineOrdinaryExpenditure = 2_998.025;

const parameters: PhysiologicalSimulatorParameters = {
  rmrParameters,
  glycogenParameters: createGlycogenParameters({ baselineCarbIntakeG: 200 }),
  baselineEnergyIntakeKcalPerDay: baselineOrdinaryExpenditure,
  adaptiveThermogenesis: { beta: 0.14, timeConstantDays: 14 },
  weightFilter: {
    processNoiseVarianceKg2PerDay: 0.01,
    measurementNoiseVarianceKg2: 0.25,
  },
};

const day = (
  date: string,
  override: Partial<PhysiologicalDailyInput> = {},
): PhysiologicalDailyInput => ({
  date,
  caloriesKcal: 2_500,
  proteinG: 150,
  fatG: 70,
  carbsG: 200,
  outsideWorkWalkingDistanceKm: 5,
  averageWalkingSpeedKmh: 5,
  strengthTrainingMinutes: 60,
  occupationalActivity: { category: "standingLightModerate", durationHours: 4 },
  sodiumChangeMgPerDay: 0,
  measuredWeightKg: null,
  ...override,
});

function requireComplete(result: SimulationDayResult): CompleteSimulationDay {
  expect(result.status).toBe("complete");
  if (result.status !== "complete") throw new Error("expected a complete day");
  return result;
}

function sequentialDays(count: number, input: PhysiologicalDailyInput) {
  return Array.from({ length: count }, (_, index) => ({
    ...input,
    occupationalActivity: { ...input.occupationalActivity },
    date: new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10),
  }));
}

describe("deterministic physiological simulator", () => {
  it("supports multiple occupational intervals without changing their equations", () => {
    const result = requireComplete(simulateOneDay({
      state: initialState,
      parameters,
      day: day("2026-01-01", {
        occupationalActivity: {
          category: null,
          durationHours: 0,
          intervals: [
            { category: "standingLight", durationHours: 4 },
            { category: "manualModerate", durationHours: 4 },
          ],
        },
      }),
      options: { ecfPolicy: "full" },
    }));
    expect(result.calculations.expenditure.occupationalActivityKcalPerDay)
      .toBeGreaterThan(0);
  });

  it("reports missing fields within occupational interval lists", () => {
    const missingDuration = simulateOneDay({
      state: initialState,
      parameters,
      day: day("2026-01-01", {
        occupationalActivity: {
          category: null, durationHours: 0,
          intervals: [{ category: "manualLight", durationHours: null }],
        },
      }),
      options: { ecfPolicy: "full" },
    });
    expect(missingDuration).toMatchObject({
      status: "incomplete",
      missingFields: ["occupationalActivity.intervals.0.durationHours"],
    });
    const missingCategory = simulateOneDay({
      state: initialState,
      parameters,
      day: day("2026-01-01", {
        occupationalActivity: {
          category: null, durationHours: 0,
          intervals: [{ category: null, durationHours: 1 }],
        },
      }),
      options: { ecfPolicy: "full" },
    });
    expect(missingCategory).toMatchObject({
      status: "incomplete",
      missingFields: ["occupationalActivity.intervals.0.category"],
    });
    expect(simulateOneDay({
      state: initialState,
      parameters,
      day: day("2026-01-01", {
        occupationalActivity: {
          category: null, durationHours: 0,
          intervals: [{ category: null, durationHours: 0 }],
        },
      }),
      options: { ecfPolicy: "full" },
    }).status).toBe("complete");
  });
  it("uses start-of-day tissue for today's RMR and end tissue for tomorrow", () => {
    const results = simulateDays({
      initialState,
      parameters,
      days: [day("2026-01-01"), day("2026-01-02")],
      options: { ecfPolicy: "full" },
    });
    const first = requireComplete(results[0]);
    const second = requireComplete(results[1]);
    expect(first.calculations.expenditure.dynamicRmrKcalPerDay).toBe(1_600);
    expect(first.endState.fatMassKg).toBeLessThan(first.startState.fatMassKg);
    expect(second.startState.fatMassKg).toBe(first.endState.fatMassKg);
    expect(second.calculations.expenditure.dynamicRmrKcalPerDay).toBeLessThan(1_600);
  });

  it("uses the exact interval-mean AT for today's expenditure", () => {
    const result = requireComplete(simulateOneDay({
      state: initialState,
      parameters,
      day: day("2026-01-01"),
      options: { ecfPolicy: "full" },
    }));
    const transition = result.calculations.adaptiveThermogenesisTransition;
    expect(transition.meanAdaptiveThermogenesisKcalPerDay).toBeLessThan(0);
    expect(transition.meanAdaptiveThermogenesisKcalPerDay)
      .toBeGreaterThan(transition.adaptiveThermogenesisKcalPerDay);
    expect(result.calculations.expenditure.adaptiveThermogenesisKcalPerDay)
      .toBe(transition.meanAdaptiveThermogenesisKcalPerDay);
    expect(result.endState.adaptiveThermogenesisKcalPerDay)
      .toBe(transition.adaptiveThermogenesisKcalPerDay);
  });

  it("matches the explicit three-day golden trajectory", () => {
    const results = simulateDays({
      initialState,
      parameters,
      days: [day("2026-01-01"), day("2026-01-02"), day("2026-01-03")],
      options: { ecfPolicy: "full" },
    }).map(requireComplete);

    const expected = [
      {
        startWeight: 76.85,
        rmr: 1_600,
        activity: 1_175.4249999999997,
        atMean: -2.431880089708031,
        energyBalance: -495.59311991029153,
        deltaFat: -0.04638715769833158,
        deltaLean: -0.024121322003132422,
        remodeling: -13.84962652886133,
        endWeight: 76.77949152029854,
      },
      {
        startWeight: 76.77949152029854,
        rmr: 1_599.3208920112966,
        activity: 1_174.149353163296,
        atMean: -7.070777315537008,
        energyBalance: -488.9994678590556,
        deltaFat: -0.04575940374267342,
        deltaLean: -0.02385020711211255,
        remodeling: -13.674892838105428,
        endWeight: 76.70988190944375,
      },
      {
        startWeight: 76.70988190944375,
        rmr: 1_598.6497573628535,
        activity: 1_172.8901398028834,
        atMean: -11.389881861378605,
        energyBalance: -482.7500153043584,
        deltaFat: -0.04516423591312895,
        deltaLean: -0.023594108473130305,
        remodeling: -13.509445762201674,
        endWeight: 76.64112356505748,
      },
    ];
    for (let index = 0; index < results.length; index += 1) {
      expect(results[index].calculations.startWeightKg).toBeCloseTo(
        expected[index].startWeight,
        10,
      );
      expect(results[index].calculations.expenditure.dynamicRmrKcalPerDay).toBeCloseTo(
        expected[index].rmr,
        10,
      );
      expect(results[index].calculations.expenditure.tefKcalPerDay).toBeCloseTo(222.6, 12);
      expect(results[index].calculations.expenditure.activityKcalPerDay)
        .toBeCloseTo(expected[index].activity, 10);
      expect(results[index].calculations.adaptiveThermogenesisTransition
        .meanAdaptiveThermogenesisKcalPerDay).toBeCloseTo(expected[index].atMean, 10);
      expect(results[index].calculations.energyBalanceKcal)
        .toBeCloseTo(expected[index].energyBalance, 10);
      expect(results[index].calculations.glycogenTransition.deltaGlycogenKg)
        .toBeCloseTo(0, 12);
      expect(results[index].calculations.tissueEnergy.deltaFatMassKg)
        .toBeCloseTo(expected[index].deltaFat, 10);
      expect(results[index].calculations.tissueEnergy.deltaLeanTissueKg)
        .toBeCloseTo(expected[index].deltaLean, 10);
      expect(results[index].calculations.tissueEnergy.totalRemodelingEnergyKcal)
        .toBeCloseTo(expected[index].remodeling, 10);
      expect(results[index].calculations.deltaExtracellularFluidLiters).toBeCloseTo(0, 12);
      expect(results[index].calculations.endWeightKg)
        .toBeCloseTo(expected[index].endWeight, 10);
    }
  });

  it("holds a true configured equilibrium across consecutive days", () => {
    const equilibriumDay = day("2026-02-01", {
      caloriesKcal: baselineOrdinaryExpenditure,
    });
    const results = simulateDays({
      initialState,
      parameters,
      days: sequentialDays(3, equilibriumDay),
      options: { ecfPolicy: "full" },
    }).map(requireComplete);
    for (const result of results) {
      expect(result.calculations.energyBalanceKcal).toBeCloseTo(0, 12);
      expect(result.calculations.glycogenTransition.deltaGlycogenKg).toBeCloseTo(0, 12);
      expect(result.calculations.tissueEnergy.deltaFatMassKg).toBeCloseTo(0, 12);
      expect(result.calculations.tissueEnergy.deltaLeanTissueKg).toBeCloseTo(0, 12);
      expect(result.calculations.deltaExtracellularFluidLiters).toBeCloseTo(0, 12);
      expect(result.calculations.endWeightKg).toBeCloseTo(76.85, 12);
    }
  });

  it("produces expected deficit trends without requiring water-monotonic scale weight", () => {
    const results = simulateDays({
      initialState,
      parameters,
      days: [day("2026-03-01"), day("2026-03-02"), day("2026-03-03")],
      options: { ecfPolicy: "full" },
    }).map(requireComplete);
    expect(results[0].endState.fatMassKg).toBeLessThan(initialState.fatMassKg);
    expect(results[2].endState.fatMassKg).toBeLessThan(results[0].endState.fatMassKg);
    expect(results[2].endState.leanTissueKg).toBeLessThan(initialState.leanTissueKg);
    expect(results[2].endState.adaptiveThermogenesisKcalPerDay)
      .toBeLessThan(results[0].endState.adaptiveThermogenesisKcalPerDay);
    expect(results[2].calculations.expenditure.dynamicRmrKcalPerDay)
      .toBeLessThan(results[0].calculations.expenditure.dynamicRmrKcalPerDay);
  });

  it("produces positive storage and rising dynamic RMR during surplus", () => {
    const results = simulateDays({
      initialState,
      parameters,
      days: [
        day("2026-04-01", { caloriesKcal: 3_400 }),
        day("2026-04-02", { caloriesKcal: 3_400 }),
        day("2026-04-03", { caloriesKcal: 3_400 }),
      ],
      options: { ecfPolicy: "full" },
    }).map(requireComplete);
    expect(results[0].calculations.tissueEnergy.partitionableEnergyKcal).toBeGreaterThan(0);
    expect(results[2].endState.fatMassKg).toBeGreaterThan(initialState.fatMassKg);
    expect(results[2].endState.leanTissueKg).toBeGreaterThan(initialState.leanTissueKg);
    expect(results[2].endState.adaptiveThermogenesisKcalPerDay).toBeGreaterThan(0);
    expect(results[2].calculations.expenditure.dynamicRmrKcalPerDay).toBeGreaterThan(1_600);
  });

  it("allows water/glycogen mass change without Fat/Lean energy storage", () => {
    const highCarbGlycogen = createGlycogenParameters({ baselineCarbIntakeG: 200 });
    const highCarbExpenditure = calculateDynamicDailyExpenditure({
      bodyComposition: initialState,
      rmrParameters,
      macros: { proteinG: 150, carbsG: 300, fatG: 70 },
      outsideWorkWalking: { distanceKm: 5, averageSpeedKmh: 5 },
      strength: { durationMinutes: 60 },
      occupational: { category: "standingLightModerate", durationHours: 4 },
      adaptiveThermogenesisKcalPerDay: 0,
    }).modelTdeeBeforePersonalizationKcalPerDay!;
    const probe = requireComplete(simulateOneDay({
      state: initialState,
      parameters: {
        ...parameters,
        glycogenParameters: highCarbGlycogen,
        baselineEnergyIntakeKcalPerDay: highCarbExpenditure,
      },
      day: day("2026-05-01", { caloriesKcal: highCarbExpenditure, carbsG: 300 }),
      options: { ecfPolicy: "hold-ecf" },
    }));
    const balancedCalories = highCarbExpenditure
      + probe.calculations.glycogenTransition.glycogenStorageEnergyKcal;
    const result = requireComplete(simulateOneDay({
      state: initialState,
      parameters: {
        ...parameters,
        glycogenParameters: highCarbGlycogen,
        baselineEnergyIntakeKcalPerDay: balancedCalories,
      },
      day: day("2026-05-01", { caloriesKcal: balancedCalories, carbsG: 300 }),
      options: { ecfPolicy: "hold-ecf" },
    }));
    expect(result.calculations.tissueEnergy.deltaFatMassKg).toBeCloseTo(0, 10);
    expect(result.calculations.tissueEnergy.deltaLeanTissueKg).toBeCloseTo(0, 10);
    expect(result.calculations.glycogenTransition.deltaGlycogenAssociatedMassKg)
      .toBeGreaterThan(0);
    expect(result.calculations.endWeightKg).toBeGreaterThan(result.calculations.startWeightKg);
  });

  it("allows ECF mass change without chemical-energy or tissue change", () => {
    const result = requireComplete(simulateOneDay({
      state: initialState,
      parameters,
      day: day("2026-05-02", {
        caloriesKcal: baselineOrdinaryExpenditure,
        sodiumChangeMgPerDay: 1_000,
      }),
      options: { ecfPolicy: "full" },
    }));
    expect(result.calculations.energyBalanceKcal).toBeCloseTo(0, 12);
    expect(result.calculations.tissueEnergy.deltaFatMassKg).toBeCloseTo(0, 12);
    expect(result.calculations.tissueEnergy.deltaLeanTissueKg).toBeCloseTo(0, 12);
    expect(result.calculations.glycogenTransition.deltaGlycogenKg).toBeCloseTo(0, 12);
    expect(result.calculations.deltaExtracellularFluidLiters).toBeGreaterThan(0);
    expect(result.calculations.endWeightKg).toBeGreaterThan(result.calculations.startWeightKg);
  });

  it("enforces each explicit ECF policy", () => {
    const missingSodium = day("2026-06-01", { sodiumChangeMgPerDay: null });
    const full = simulateOneDay({
      state: initialState, parameters, day: missingSodium, options: { ecfPolicy: "full" },
    });
    expect(full.status).toBe("incomplete");
    if (full.status === "incomplete") {
      expect(full.missingFields).toContain("sodiumChangeMgPerDay");
    }
    const assumed = requireComplete(simulateOneDay({
      state: initialState,
      parameters,
      day: missingSodium,
      options: { ecfPolicy: "assume-unchanged-sodium" },
    }));
    expect(assumed.calculations.ecfTransition?.sodiumChangeMgPerDay).toBe(0);
    const held = requireComplete(simulateOneDay({
      state: initialState,
      parameters,
      day: missingSodium,
      options: { ecfPolicy: "hold-ecf" },
    }));
    expect(held.calculations.ecfTransition).toBeNull();
    expect(held.endState.extracellularFluidDeviationLiters)
      .toBe(initialState.extracellularFluidDeviationLiters);
  });

  it.each([
    { caloriesKcal: null, field: "caloriesKcal" },
    { proteinG: null, field: "proteinG" },
    { fatG: undefined, field: "fatG" },
    { carbsG: null, field: "carbsG" },
    { outsideWorkWalkingDistanceKm: null, field: "outsideWorkWalkingDistanceKm" },
    { averageWalkingSpeedKmh: null, field: "averageWalkingSpeedKmh" },
    { strengthTrainingMinutes: null, field: "strengthTrainingMinutes" },
    {
      occupationalActivity: { category: null, durationHours: 4 },
      field: "occupationalActivity.category",
    },
    {
      occupationalActivity: { category: "standingLight" as const, durationHours: null },
      field: "occupationalActivity.durationHours",
    },
  ])("marks missing $field as incomplete", ({ field, ...override }) => {
    const result = simulateOneDay({
      state: initialState,
      parameters,
      day: day("2026-07-01", override),
      options: { ecfPolicy: "hold-ecf" },
    });
    expect(result.status).toBe("incomplete");
    if (result.status === "incomplete") expect(result.missingFields).toContain(field);
  });

  it("accepts explicit zero activity without speed or occupational category", () => {
    const result = requireComplete(simulateOneDay({
      state: initialState,
      parameters,
      day: day("2026-07-02", {
        outsideWorkWalkingDistanceKm: 0,
        averageWalkingSpeedKmh: null,
        strengthTrainingMinutes: 0,
        occupationalActivity: { category: null, durationHours: 0 },
      }),
      options: { ecfPolicy: "hold-ecf" },
    }));
    expect(result.calculations.expenditure.activityKcalPerDay).toBe(0);
  });

  it("uses the Kalman filter only as an observation layer", () => {
    const measured = requireComplete(simulateOneDay({
      state: initialState,
      parameters,
      day: day("2026-08-01", { measuredWeightKg: 80 }),
      options: { ecfPolicy: "hold-ecf" },
    }));
    const missing = requireComplete(simulateOneDay({
      state: initialState,
      parameters,
      day: day("2026-08-01", { measuredWeightKg: null }),
      options: { ecfPolicy: "hold-ecf" },
    }));
    expect(measured.calculations.weightFilterUpdate.measurementApplied).toBe(true);
    expect(missing.calculations.weightFilterUpdate.measurementApplied).toBe(false);
    expect(measured.calculations.filteredObservedWeightKg)
      .not.toBe(measured.calculations.predictedPhysiologicalWeightKg);
    expect(measured.endState.fatMassKg).toBe(missing.endState.fatMassKg);
    expect(measured.endState.leanTissueKg).toBe(missing.endState.leanTissueKg);
    expect(measured.endState.glycogenKg).toBe(missing.endState.glycogenKg);
    expect(measured.endState.extracellularFluidDeviationLiters)
      .toBe(missing.endState.extracellularFluidDeviationLiters);
  });

  it("applies personalization before tissue closure and preserves energy", () => {
    const result = requireComplete(simulateOneDay({
      state: initialState,
      parameters,
      day: day("2026-08-02"),
      options: { ecfPolicy: "hold-ecf" },
      personalization: { personalOffsetKcalPerDay: 120, activityCalibration: 0.8 },
    }));
    const expenditure = result.calculations.expenditure;
    expect(expenditure.calibratedActivityKcalPerDay)
      .toBeCloseTo(expenditure.activityKcalPerDay! * 0.8, 12);
    expect(result.calculations.energyBalanceKcal).toBeCloseTo(
      2_500 - expenditure.personalizedTdeeKcalPerDay!,
      12,
    );
    const tissue = result.calculations.tissueEnergy;
    expect(tissue.glycogenStorageEnergyKcal
      + tissue.fatStorageEnergyKcal
      + tissue.leanTissueStorageEnergyKcal
      + tissue.totalRemodelingEnergyKcal).toBeCloseTo(
      result.calculations.energyBalanceKcal,
      9,
    );
  });

  it("does not mutate state, parameters, inputs, or prior returned states", () => {
    const stateBefore = structuredClone(initialState);
    const parametersBefore = structuredClone(parameters);
    const days = [day("2026-09-01"), day("2026-09-02")];
    const daysBefore = structuredClone(days);
    const results = simulateDays({
      initialState,
      parameters,
      days,
      options: { ecfPolicy: "hold-ecf" },
    });
    const first = requireComplete(results[0]);
    const firstEndBefore = structuredClone(first.endState);
    requireComplete(results[1]).endState.fatMassKg += 1;
    expect(initialState).toEqual(stateBefore);
    expect(parameters).toEqual(parametersBefore);
    expect(days).toEqual(daysBefore);
    expect(first.endState).toEqual(firstEndBefore);
    expect(first.startState).not.toBe(initialState);
    expect(first.endState.weightFilterState).not.toBe(first.startState.weightFilterState);
  });

  it("reports an incomplete day and blocks all later transitions", () => {
    const results = simulateDays({
      initialState,
      parameters,
      days: [
        day("2026-10-01"),
        day("2026-10-02", { caloriesKcal: null }),
        day("2026-10-03"),
      ],
      options: { ecfPolicy: "hold-ecf" },
    });
    expect(results.map((result) => result.status)).toEqual(["complete", "incomplete", "blocked"]);
    expect(results[2]).toMatchObject({ blockedByDate: "2026-10-02", startState: null });
  });

  it.each([
    [day("2026-01-02"), day("2026-01-01")],
    [day("2026-01-01"), day("2026-01-01")],
  ])("rejects duplicate or out-of-order dates", (...days) => {
    expect(() => simulateDays({
      initialState,
      parameters,
      days,
      options: { ecfPolicy: "hold-ecf" },
    })).toThrow(/strictly chronological/);
  });

  it("rejects an implicit calendar gap", () => {
    expect(() => simulateDays({
      initialState,
      parameters,
      days: [day("2026-01-01"), day("2026-01-03")],
      options: { ecfPolicy: "hold-ecf" },
    })).toThrow(/consecutive/);
  });

  it.each(["2026-02-30", "01-01-2026"])("rejects invalid date %s", (date) => {
    expect(() => simulateOneDay({
      state: initialState,
      parameters,
      day: day(date),
      options: { ecfPolicy: "hold-ecf" },
    })).toThrow(/date/);
  });

  it("rejects an unknown ECF policy", () => {
    expect(() => simulateOneDay({
      state: initialState,
      parameters,
      day: day("2026-11-01"),
      options: { ecfPolicy: "guess-sodium" as "full" },
    })).toThrow(/unknown ECF/);
  });

  it.each([
    { caloriesKcal: -1 },
    { proteinG: Number.NaN },
    { outsideWorkWalkingDistanceKm: -1 },
    { measuredWeightKg: 0 },
  ])("rejects invalid supplied measurements", (override) => {
    expect(() => simulateOneDay({
      state: initialState,
      parameters,
      day: day("2026-11-01", override),
      options: { ecfPolicy: "hold-ecf" },
    })).toThrow();
  });

  it("rejects a transition that would produce nonpositive tissue mass", () => {
    expect(() => simulateOneDay({
      state: {
        ...initialState,
        fatMassKg: 0.001,
        leanTissueKg: 0.001,
        weightFilterState: { estimatedWeightKg: 16.852, varianceKg2: 1 },
      },
      parameters,
      day: day("2026-11-02", {
        caloriesKcal: 0,
        proteinG: 0,
        fatG: 0,
        carbsG: 0,
        outsideWorkWalkingDistanceKm: 0,
        averageWalkingSpeedKmh: null,
        strengthTrainingMinutes: 0,
        occupationalActivity: { category: null, durationHours: 0 },
      }),
      options: { ecfPolicy: "hold-ecf" },
    })).toThrow(/leanTissueKg/);
  });

  it("preserves chemical-energy and mass identities on every complete day", () => {
    const results = simulateDays({
      initialState,
      parameters,
      days: [
        day("2026-12-01", { caloriesKcal: 2_300, carbsG: 150 }),
        day("2026-12-02", { caloriesKcal: 2_700, carbsG: 250 }),
        day("2026-12-03", { caloriesKcal: 3_200, carbsG: 300 }),
      ],
      options: { ecfPolicy: "assume-unchanged-sodium" },
    }).map(requireComplete);
    for (const result of results) {
      const energy = result.calculations.tissueEnergy;
      expect(energy.glycogenStorageEnergyKcal
        + energy.fatStorageEnergyKcal
        + energy.leanTissueStorageEnergyKcal
        + energy.totalRemodelingEnergyKcal).toBeCloseTo(
        result.calculations.energyBalanceKcal,
        9,
      );
      expect(reconstructBodyWeightKg(result.endState))
        .toBeCloseTo(result.calculations.endWeightKg, 12);
      expect(Object.values(result.endState).flatMap((value) => (
        typeof value === "object" ? Object.values(value) : [value]
      )).every(Number.isFinite)).toBe(true);
    }
  });

  it.each([30, 90, 365])("remains finite and stable for %s deterministic days", (count) => {
    const template = day("2026-01-01");
    const started = performance.now();
    const results = simulateDays({
      initialState,
      parameters,
      days: sequentialDays(count, template),
      options: { ecfPolicy: "hold-ecf" },
    });
    const elapsedMs = performance.now() - started;
    expect(results).toHaveLength(count);
    expect(results.every((result) => result.status === "complete")).toBe(true);
    let cumulativeEnergyResidualKcal = 0;
    for (const result of results.map(requireComplete)) {
      const energy = result.calculations.tissueEnergy;
      cumulativeEnergyResidualKcal += result.calculations.energyBalanceKcal
        - energy.glycogenStorageEnergyKcal
        - energy.fatStorageEnergyKcal
        - energy.leanTissueStorageEnergyKcal
        - energy.totalRemodelingEnergyKcal;
      expect(result.endState.fatMassKg).toBeGreaterThan(0);
      expect(result.endState.leanTissueKg).toBeGreaterThan(0);
      expect(result.endState.glycogenKg).toBeGreaterThanOrEqual(0);
      expect(reconstructBodyWeightKg(result.endState))
        .toBeCloseTo(result.calculations.endWeightKg, 12);
    }
    expect(cumulativeEnergyResidualKcal).toBeCloseTo(0, 8);
    const final = requireComplete(results.at(-1)!);
    expect(final.endState.fatMassKg).toBeGreaterThan(0);
    expect(final.endState.leanTissueKg).toBeGreaterThan(0);
    expect(final.endState.glycogenKg).toBeGreaterThanOrEqual(0);
    expect(reconstructBodyWeightKg(final.endState)).toBeGreaterThan(0);
    expect(elapsedMs).toBeLessThan(5_000);
  });
});
