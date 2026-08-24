import { describe, expect, it } from "vitest";
import { createGlycogenParameters } from "@/model/body-composition/glycogen";
import { createDynamicRmrParameters } from "@/model/dynamic-rmr";
import {
  simulateDays,
  type CompleteSimulationDay,
  type PhysiologicalDailyInput,
  type PhysiologicalSimulatorParameters,
  type PhysiologicalSimulatorState,
} from "@/model/physiological-simulator";
import type { BuiltSimulationDay, ModelDaySourceQuality } from "@/modules/model-episodes/model-episode.types";
import { DEFAULT_RECOVERY_CONFIG } from "@/modules/model-recovery/recovery.types";
import { recoverHistoricalTrajectories } from "@/modules/model-recovery/trajectory-recovery";

const initialState: PhysiologicalSimulatorState = {
  fatMassKg: 20,
  leanTissueKg: 40,
  glycogenKg: 0.5,
  baselineExtracellularFluidLiters: 15,
  extracellularFluidDeviationLiters: 0,
  adaptiveThermogenesisKcalPerDay: 0,
  weightFilterState: { estimatedWeightKg: 76.85, varianceKg2: 0.25 },
};

const parameters: PhysiologicalSimulatorParameters = {
  rmrParameters: createDynamicRmrParameters({
    initialRmrKcalPerDay: 1_600,
    initialFatMassKg: 20,
    initialLeanTissueKg: 40,
  }),
  glycogenParameters: createGlycogenParameters({ baselineCarbIntakeG: 220 }),
  baselineEnergyIntakeKcalPerDay: 2_700,
  adaptiveThermogenesis: { beta: 0.14, timeConstantDays: 14 },
  weightFilter: {
    processNoiseVarianceKg2PerDay: 0.01,
    measurementNoiseVarianceKg2: 0.25,
  },
};

function date(day: number): string {
  return new Date(Date.UTC(2026, 0, day)).toISOString().slice(0, 10);
}

function completeInput(day: number, caloriesKcal: number): PhysiologicalDailyInput {
  const factor = caloriesKcal / 2_700;
  return {
    date: date(day),
    caloriesKcal,
    proteinG: 150 * factor,
    fatG: 90 * factor,
    carbsG: 220 * factor,
    outsideWorkWalkingDistanceKm: day % 2 === 0 ? 4 : 8,
    averageWalkingSpeedKmh: 5,
    strengthTrainingMinutes: day % 3 === 0 ? 60 : 0,
    occupationalActivity: {
      category: "standingLightModerate",
      durationHours: day % 2 === 0 ? 8 : 0,
    },
    sodiumChangeMgPerDay: null,
    measuredWeightKg: null,
  };
}

const observedQuality: ModelDaySourceQuality = {
  status: "complete",
  issues: [],
  workIntervalCount: 1,
  workWalkingDistanceKm: 0,
  outsideWorkWalkingDistanceKm: 4,
  sourceObservationFields: ["caloriesKcal", "walkingDistanceKm", "workIntervals"],
  nutrition: {
    source: "observed",
    method: null,
    referenceDayCount: 0,
    gapLength: 0,
    referenceDates: [],
    observedFields: ["caloriesKcal", "proteinG", "fatG", "carbsG"],
    imputedFields: [],
    referenceCaloriesMedian: null,
    referenceCaloriesMad: null,
    referenceMacroMadG: null,
    dependency: "observed",
  },
};

function built(input: PhysiologicalDailyInput, observed = true): BuiltSimulationDay {
  return {
    input,
    sourceQuality: observed ? observedQuality : {
      ...observedQuality,
      status: "missing-nutrition",
      issues: ["caloriesKcal", "proteinG", "fatG", "carbsG"],
      sourceObservationFields: [],
      nutrition: { ...observedQuality.nutrition, source: "missing", dependency: "imputed-downstream" },
    },
  };
}

function requireComplete(result: ReturnType<typeof simulateDays>[number]): CompleteSimulationDay {
  if (result.status !== "complete") throw new Error(`Expected complete truth day ${result.date}.`);
  return result;
}

function scenario(observationIndexes: number[]) {
  const donors = Array.from({ length: 14 }, (_, index) => (
    built(completeInput(index + 1, index % 3 === 0 ? 3_300 : 2_200))
  ));
  const truthInputs = Array.from({ length: 14 }, (_, index) => (
    completeInput(index + 15, index < 8 ? 3_350 : 2_700)
  ));
  const truth = simulateDays({
    initialState,
    parameters,
    days: truthInputs,
    options: { ecfPolicy: "hold-ecf" },
  }).map(requireComplete);
  const recoveryDays = truthInputs.map((dayInput, index) => {
    const measuredWeightKg = observationIndexes.includes(index)
      ? truth[index].calculations.endWeightKg
      : null;
    if (index < 8) {
      return built({
        ...dayInput,
        caloriesKcal: null,
        proteinG: null,
        fatG: null,
        carbsG: null,
        outsideWorkWalkingDistanceKm: null,
        averageWalkingSpeedKmh: null,
        strengthTrainingMinutes: null,
        occupationalActivity: { category: null, durationHours: null },
        measuredWeightKg,
      }, false);
    }
    return built({ ...dayInput, measuredWeightKg });
  });
  return { donors, recoveryDays, truthEndWeightKg: truth.at(-1)!.calculations.endWeightKg };
}

function recover(observationIndexes: number[], seed = 123) {
  const fixture = scenario(observationIndexes);
  return {
    fixture,
    result: recoverHistoricalTrajectories({
      seed,
      initialState,
      parameters,
      ecfPolicy: "hold-ecf",
      days: fixture.recoveryDays,
      donorDays: fixture.donors,
      config: { particleCount: 256 },
    }),
  };
}

function diverseSyntheticScenario(kind: string) {
  const donors = Array.from({ length: 42 }, (_, index) => {
    const donor = completeInput(index + 1, [1_950, 2_350, 2_700, 3_100, 3_450][index % 5]);
    donor.carbsG = [100, 160, 220, 300, 380][index % 5];
    donor.proteinG = [125, 145, 160][index % 3];
    donor.fatG = [55, 75, 95, 115][index % 4];
    donor.outsideWorkWalkingDistanceKm = [1, 4, 8, 12][index % 4];
    donor.strengthTrainingMinutes = [0, 0, 45, 75][index % 4];
    donor.occupationalActivity = index % 8 === 0 || index % 8 === 3
      ? { category: "manualModerate", durationHours: 8 }
      : index % 2 === 0
        ? { category: "standingLightModerate", durationHours: 8 }
        : { category: null, durationHours: 0 };
    return built(donor);
  });
  const hidden = Array.from({ length: 7 }, (_, index) => {
    const value = completeInput(43 + index, 2_700);
    if (kind === "surplus") value.caloriesKcal = 3_350;
    if (kind === "deficit") value.caloriesKcal = 2_000;
    if (kind === "high-carb") value.carbsG = 370;
    if (kind === "low-carb") value.carbsG = 105;
    if (kind === "lower-activity") {
      value.outsideWorkWalkingDistanceKm = 1;
      value.strengthTrainingMinutes = 0;
      value.occupationalActivity = { category: null, durationHours: 0 };
    }
    if (kind === "higher-activity") {
      value.outsideWorkWalkingDistanceKm = 12;
      value.strengthTrainingMinutes = 75;
      value.occupationalActivity = { category: "manualModerate", durationHours: 8 };
    }
    return value;
  });
  const postGap = Array.from({ length: 7 }, (_, index) => completeInput(50 + index, 2_700));
  const truth = simulateDays({
    initialState,
    parameters,
    days: [...hidden, ...postGap],
    options: { ecfPolicy: "hold-ecf" },
  }).map(requireComplete);
  const recoveryDays = [...hidden, ...postGap].map((input, index) => {
    const measuredWeightKg = index >= 7 && index % 2 === 1
      ? truth[index].calculations.endWeightKg
      : null;
    return index < 7
      ? built({
          ...input,
          caloriesKcal: null, proteinG: null, fatG: null, carbsG: null,
          outsideWorkWalkingDistanceKm: null, averageWalkingSpeedKmh: null,
          strengthTrainingMinutes: null,
          occupationalActivity: { category: null, durationHours: null },
          measuredWeightKg,
        }, false)
      : built({ ...input, measuredWeightKg });
  });
  return { donors, recoveryDays, truth: truth.at(-1)!, truthDays: truth };
}

describe("retrospective trajectory recovery", () => {
  it("is exactly reproducible for the same source, configuration, and seed", () => {
    const first = recover([13], 99).result;
    const second = recover([13], 99).result;
    expect(second).toEqual(first);
  });

  it("retains a prior-predictive ensemble when no post-gap weight exists", () => {
    const { result } = recover([]);
    expect(result.status).toBe("awaiting-observations");
    expect(result.observationCount).toBe(0);
    expect(result.effectiveSampleSize).toBeCloseTo(result.validParticleCount, 10);
    expect(result.maximumWeight).toBeCloseTo(1 / result.validParticleCount, 14);
    expect(result.diagnostics.likelihood).toBe("none-prior-predictive");
    expect(result.diagnostics.importanceSampling).toMatchObject({
      proposal: "generative-prior", priorProposalCorrectionApplied: false,
      logWeightEquation: "log_likelihood",
    });
    expect(result.diagnostics.pilot.generatedParticleCount).toBe(0);
    expect(result.ensemble.every(({ proposal }) => (
      proposal.logImportanceCorrection === 0 && proposal.component === "prior"
    ))).toBe(true);
    expect(result.diagnostics.downstreamQualityContract).toEqual({
      forecastInitialization: "prior-predictive-only",
      posteriorIntervalsTrustworthy: true,
    });
  });

  it("uses raw scale weights once for physiology and separately reconstructs the auxiliary filter", () => {
    const { result } = recover([9, 11, 13]);
    expect(result.observationCount).toBe(3);
    expect(result.diagnostics.observationAssimilationInsideSimulator).toBe(false);
    expect(result.diagnostics.biaUsed).toBe(false);
    expect(result.diagnostics.resamplingUsed).toBe(false);
    expect(result.diagnostics.importanceSampling).toEqual({
      target: "posterior-over-unknown-histories",
      proposal: "defensive-adaptive-regime-mixture",
      priorProposalCorrectionApplied: true,
      logWeightEquation: "log_likelihood+log_prior-log_proposal",
    });
    expect(result.diagnostics.pilot.generatedParticleCount)
      .toBe(DEFAULT_RECOVERY_CONFIG.adaptivePilotParticleCount);
    expect(result.diagnostics.topParticleOrigins).toHaveLength(5);
    expect(result.ensemble.some(({ proposal }) => (
      Math.abs(proposal.logImportanceCorrection) > 1e-12
    ))).toBe(true);
    expect(result.diagnostics.auxiliaryWeightFilterSemantics)
      .toBe("separate-observation-replay-after-physiological-inference");
    expect(result.ensemble.every(({ state }) => (
      state.weightFilterState.varianceKg2 < initialState.weightFilterState.varianceKg2
    ))).toBe(true);
  });

  it("auxiliary observation replay changes no physiological compartment or proposal", () => {
    const priorFixture = scenario([]);
    const conditionedFixture = scenario([9, 11, 13]);
    const run = (days: BuiltSimulationDay[]) => recoverHistoricalTrajectories({
      seed: 333, initialState, parameters, ecfPolicy: "hold-ecf", days,
      donorDays: priorFixture.donors,
      config: { particleCount: 256, adaptiveProposalEnabled: false },
    });
    const prior = run(priorFixture.recoveryDays);
    const conditioned = run(conditionedFixture.recoveryDays);
    expect(conditioned.ensemble).toHaveLength(prior.ensemble.length);
    for (let index = 0; index < prior.ensemble.length; index += 1) {
      const before = prior.ensemble[index];
      const after = conditioned.ensemble[index];
      expect(after.particleIndex).toBe(before.particleIndex);
      expect({ ...after.state, weightFilterState: undefined }).toEqual({
        ...before.state,
        weightFilterState: undefined,
      });
      expect(after.bodyWeightKg).toBe(before.bodyWeightKg);
    }
    expect(conditioned.ensemble.some((particle, index) => (
      particle.state.weightFilterState.estimatedWeightKg
        !== prior.ensemble[index].state.weightFilterState.estimatedWeightKg
    ))).toBe(true);
  });

  it("moves the posterior endpoint toward a held-out synthetic truth", () => {
    const prior = recover([]);
    const posterior = recover([9, 11, 13]);
    const truth = posterior.fixture.truthEndWeightKg;
    const priorError = Math.abs(prior.result.posteriorSummary.bodyWeightKg.median - truth);
    const posteriorError = Math.abs(posterior.result.posteriorSummary.bodyWeightKg.median - truth);
    expect(posteriorError).toBeLessThan(priorError);
    expect(truth).toBeGreaterThanOrEqual(posterior.result.posteriorSummary.bodyWeightKg.lower);
    expect(truth).toBeLessThanOrEqual(posterior.result.posteriorSummary.bodyWeightKg.upper);
  });

  it("uses repeated post-gap weights as distinct observations without collapsing uncertainty", () => {
    const one = recover([13]).result;
    const repeated = recover([9, 11, 13]).result;
    expect(one.observationCount).toBe(1);
    expect(repeated.observationCount).toBe(3);
    expect(repeated.posteriorSummary.bodyWeightKg.upper
      - repeated.posteriorSummary.bodyWeightKg.lower)
      .toBeLessThanOrEqual(one.posteriorSummary.bodyWeightKg.upper
        - one.posteriorSummary.bodyWeightKg.lower);
    expect(repeated.normalizedEffectiveSampleSize).toBeGreaterThan(0);
    expect(repeated.status).not.toBe("degenerate");
  });

  it("does not let one isolated scale outlier dictate the retrospective state", () => {
    const clean = scenario([9, 11, 13]);
    const contaminated = scenario([9, 11, 13]);
    contaminated.recoveryDays[11].input.measuredWeightKg! += 5;
    const run = (days: BuiltSimulationDay[]) => recoverHistoricalTrajectories({
      seed: 456,
      initialState,
      parameters,
      ecfPolicy: "hold-ecf",
      days,
      donorDays: clean.donors,
      config: { particleCount: 1_024, lowerQuantile: 0.025, upperQuantile: 0.975 },
    });
    const cleanMedian = run(clean.recoveryDays).posteriorSummary.bodyWeightKg.median;
    const contaminatedMedian = run(contaminated.recoveryDays).posteriorSummary.bodyWeightKg.median;
    expect(Math.abs(contaminatedMedian - cleanMedian)).toBeLessThan(0.5);
  });

  it("keeps an explicitly wide uncertainty interval for an ambiguous vacation gap", () => {
    const { result } = recover([13]);
    expect(result.posteriorSummary.bodyWeightKg.upper - result.posteriorSummary.bodyWeightKg.lower)
      .toBeGreaterThan(0.15);
    expect(result.validParticleCount).toBe(256);
  });

  it("covers held-out synthetic truths across nutrition, glycogen, and activity regimes", () => {
    const kinds = [
      "near-baseline", "surplus", "deficit", "high-carb", "low-carb",
      "lower-activity", "higher-activity",
    ];
    const covered = kinds.filter((kind) => {
      const fixture = diverseSyntheticScenario(kind);
      const result = recoverHistoricalTrajectories({
        seed: 700 + kind.length,
        initialState,
        parameters,
        ecfPolicy: "hold-ecf",
        days: fixture.recoveryDays,
        donorDays: fixture.donors,
        config: { particleCount: 1_024, lowerQuantile: 0.005, upperQuantile: 0.995 },
      });
      const truthWeight = fixture.truth.calculations.endWeightKg;
      return truthWeight >= result.posteriorSummary.bodyWeightKg.lower
        && truthWeight <= result.posteriorSummary.bodyWeightKg.upper;
    });
    // This fixed synthetic panel is a coverage-frequency check, not a promise
    // that every novel regime is identified by scale weight alone.
    expect(covered.length).toBeGreaterThanOrEqual(6);
  }, 15_000);

  it("retains tissue-versus-glycogen ambiguity among particles with similar scale weight", () => {
    const fixture = diverseSyntheticScenario("near-baseline");
    const recoveryDays = fixture.recoveryDays.slice(0, 8);
    recoveryDays.forEach((day) => { day.input.measuredWeightKg = null; });
    recoveryDays.at(-1)!.input.measuredWeightKg = fixture.truthDays[7].calculations.endWeightKg;
    const result = recoverHistoricalTrajectories({
      seed: 909,
      initialState,
      parameters,
      ecfPolicy: "hold-ecf",
      days: recoveryDays,
      donorDays: fixture.donors,
      config: { particleCount: 1_024 },
    });
    const center = result.posteriorSummary.bodyWeightKg.median;
    const similarWeight = result.ensemble.filter((particle) => (
      Math.abs(particle.bodyWeightKg - center) < 0.05
    ));
    expect(similarWeight.length).toBeGreaterThan(5);
    const fatRange = Math.max(...similarWeight.map(({ state }) => state.fatMassKg))
      - Math.min(...similarWeight.map(({ state }) => state.fatMassKg));
    const glycogenRange = Math.max(...similarWeight.map(({ state }) => state.glycogenKg))
      - Math.min(...similarWeight.map(({ state }) => state.glycogenKg));
    expect(fatRange).toBeGreaterThan(0.01);
    expect(glycogenRange).toBeGreaterThan(0.005);
  });

  it("propagates multiple unknown intervals chronologically in one coherent ensemble", () => {
    const fixture = scenario([13]);
    for (const index of [10, 11]) {
      fixture.recoveryDays[index] = built({
        ...fixture.recoveryDays[index].input,
        caloriesKcal: null, proteinG: null, fatG: null, carbsG: null,
        outsideWorkWalkingDistanceKm: null, averageWalkingSpeedKmh: null,
        strengthTrainingMinutes: null,
        occupationalActivity: { category: null, durationHours: null },
      }, false);
    }
    const result = recoverHistoricalTrajectories({
      seed: 808,
      initialState,
      parameters,
      ecfPolicy: "hold-ecf",
      days: fixture.recoveryDays,
      donorDays: fixture.donors,
      config: { particleCount: 128 },
    });
    expect(result.diagnostics.unknownDayCount).toBe(10);
    expect(result.validParticleCount).toBe(128);
  });

  it("changes stochastic trajectories when the seed changes", () => {
    const first = recover([13], 100).result;
    const second = recover([13], 101).result;
    expect(second.ensemble.map(({ bodyWeightKg }) => bodyWeightKg))
      .not.toEqual(first.ensemble.map(({ bodyWeightKg }) => bodyWeightKg));
  });

  it("keeps the central seven-day posterior stable across deterministic seeds", () => {
    const medians = [101, 907, 1_234, 20_260_824].map((seed) => recover([9, 11, 13], seed)
      .result.posteriorSummary.bodyWeightKg.median);
    expect(Math.max(...medians) - Math.min(...medians)).toBeLessThan(0.15);
  });

  it("rejects recovery when no coherent observed donor exists", () => {
    const fixture = scenario([13]);
    expect(() => recoverHistoricalTrajectories({
      seed: 1,
      initialState,
      parameters,
      ecfPolicy: "hold-ecf",
      days: fixture.recoveryDays,
      donorDays: fixture.donors.map((day) => built(day.input, false)),
      config: { particleCount: 32 },
    })).toThrow(/complete observed donor/);
  });

  it.each([
    [{ particleCount: 0 }, /finite and positive/],
    [{ particleCount: 32.5 }, /integer/],
    [{ particleCount: 20_001 }, /20,000/],
    [{ observationDegreesOfFreedom: 2 }, /degrees of freedom/],
    [{ activityExplorationProbability: 1.1 }, /probabilities/],
    [{ macroCompositionLogStandardDeviation: -0.1 }, /finite and positive/],
    [{ degenerateNormalizedEssThreshold: 0.6, healthyNormalizedEssThreshold: 0.5 }, /diagnostic thresholds/],
    [{ lowerQuantile: 0.6 }, /quantiles/],
    [{ adaptivePilotParticleCount: 32.5 }, /particle counts/],
    [{ adaptivePilotLikelihoodTemperature: 1.1 }, /adaptive proposal controls/],
    [{ adaptivePriorMixtureWeight: 1 }, /adaptive proposal controls/],
  ])("rejects invalid direct engine configuration %#", (config, expected) => {
    const fixture = scenario([13]);
    expect(() => recoverHistoricalTrajectories({
      seed: 1, initialState, parameters, ecfPolicy: "hold-ecf",
      days: fixture.recoveryDays, donorDays: fixture.donors, config,
    })).toThrow(expected);
  });

  it("requires both a recovery interval and at least one unknown transition", () => {
    const fixture = scenario([13]);
    expect(() => recoverHistoricalTrajectories({
      seed: 1, initialState, parameters, ecfPolicy: "hold-ecf",
      days: [], donorDays: fixture.donors, config: { particleCount: 32 },
    })).toThrow(/at least one day/);
    expect(() => recoverHistoricalTrajectories({
      seed: 1, initialState, parameters, ecfPolicy: "hold-ecf",
      days: fixture.donors, donorDays: fixture.donors, config: { particleCount: 32 },
    })).toThrow(/without an unknown day/);
  });

  it("fails honestly when every sampled proposal is invalid", () => {
    const fixture = scenario([13]);
    const invalidDonors = fixture.donors.map((day) => built({
      ...day.input, caloriesKcal: -100, proteinG: -10, fatG: -10, carbsG: -10,
    }));
    expect(() => recoverHistoricalTrajectories({
      seed: 1, initialState, parameters, ecfPolicy: "hold-ecf",
      days: fixture.recoveryDays, donorDays: invalidDonors, config: { particleCount: 32 },
    })).toThrow(/All (adaptive recovery pilot|historical recovery) proposals/);
  });

  it("reports structural-support fallbacks when history contains only work and zero walking", () => {
    const fixture = scenario([]);
    const narrowDonors = fixture.donors.map((day) => built({
      ...day.input,
      outsideWorkWalkingDistanceKm: 0,
      occupationalActivity: { category: "standingLightModerate", durationHours: 8 },
    }));
    const result = recoverHistoricalTrajectories({
      seed: 3, initialState, parameters, ecfPolicy: "hold-ecf",
      days: fixture.recoveryDays, donorDays: narrowDonors, config: { particleCount: 32 },
    });
    expect(result.diagnostics.supportWarnings).toEqual([
      "no-empirical-no-work-donor; structural-no-work-prior-mixture-used",
      "no-positive-walking-donor; activity-exploration-prior-used",
    ]);
  });

  it.each([7, 14, 30, 90])("propagates a %i-day gap without fake state zeros", (gapDays) => {
    const donorDays = Array.from({ length: 14 }, (_, index) => built(completeInput(index + 1, 2_700)));
    const days = [
      ...Array.from({ length: gapDays }, (_, index) => built({
        ...completeInput(index + 15, 2_700),
        caloriesKcal: null, proteinG: null, fatG: null, carbsG: null,
        outsideWorkWalkingDistanceKm: null, averageWalkingSpeedKmh: null,
        strengthTrainingMinutes: null,
        occupationalActivity: { category: null, durationHours: null },
      }, false)),
      built({ ...completeInput(gapDays + 15, 2_700), measuredWeightKg: 77 }),
    ];
    const result = recoverHistoricalTrajectories({
      seed: 900 + gapDays, initialState, parameters, ecfPolicy: "hold-ecf",
      days, donorDays,
      config: { particleCount: 32, adaptivePilotParticleCount: 32 },
    });
    expect(result.diagnostics.unknownDayCount).toBe(gapDays);
    expect(result.validParticleCount).toBeGreaterThan(0);
    expect(result.ensemble.every(({ state, bodyWeightKg }) => (
      bodyWeightKg > 0 && state.fatMassKg > 0 && state.leanTissueKg > 0
        && state.glycogenKg > 0
    ))).toBe(true);
  });

  it("uses a separate configurable observation residual and exposes severe diagnostics", () => {
    const fixture = scenario([9, 11, 13]);
    const run = (observationResidualVarianceKg2: number) => recoverHistoricalTrajectories({
      seed: 44, initialState, parameters, ecfPolicy: "hold-ecf",
      days: fixture.recoveryDays, donorDays: fixture.donors,
      config: {
        particleCount: 128, observationResidualVarianceKg2,
        degenerateNormalizedEssThreshold: 0.99,
        healthyNormalizedEssThreshold: 0.999,
        healthyMaximumWeightThreshold: 0.99,
        degenerateMaximumWeightThreshold: 1,
        degenerateValidParticleFractionThreshold: 0.5,
        healthyValidParticleFractionThreshold: 0.9,
      },
    });
    const narrow = run(0.02);
    const broad = run(4);
    expect(narrow.diagnostics.observationResidualVarianceKg2).toBe(0.02);
    expect(narrow.status).toBe("degenerate");
    expect(narrow.diagnostics.qualityReasons)
      .toContain("normalized-ess-below-degenerate-threshold");
    expect(narrow.diagnostics.downstreamQualityContract).toEqual({
      forecastInitialization: "refuse-degenerate",
      posteriorIntervalsTrustworthy: false,
    });
    expect(narrow.ensemble.map(({ normalizedWeight }) => normalizedWeight))
      .not.toEqual(broad.ensemble.map(({ normalizedWeight }) => normalizedWeight));
    expect(DEFAULT_RECOVERY_CONFIG.observationResidualVarianceKg2)
      .toBe(parameters.weightFilter.measurementNoiseVarianceKg2);
  });
});
