import { createGlycogenParameters } from "../../src/model/body-composition/glycogen";
import { createDynamicRmrParameters } from "../../src/model/dynamic-rmr";
import {
  simulateDays,
  type CompleteSimulationDay,
  type PhysiologicalDailyInput,
  type PhysiologicalSimulatorParameters,
  type PhysiologicalSimulatorState,
} from "../../src/model/physiological-simulator";
import type {
  BuiltSimulationDay,
  ModelDaySourceQuality,
} from "../../src/modules/model-episodes/model-episode.types";
import {
  SeededRandom,
  studentTSample,
  weightedQuantile,
} from "../../src/modules/model-recovery/recovery-math";
import {
  sampleRecoveryDay,
  sampleRecoveryTrajectoryRegime,
} from "../../src/modules/model-recovery/recovery-proposal";
import {
  DEFAULT_RECOVERY_CONFIG,
  type RecoveryConfig,
} from "../../src/modules/model-recovery/recovery.types";
import { recoverHistoricalTrajectories } from "../../src/modules/model-recovery/trajectory-recovery";

const initialState: PhysiologicalSimulatorState = {
  fatMassKg: 20, leanTissueKg: 40, glycogenKg: 0.5,
  baselineExtracellularFluidLiters: 15, extracellularFluidDeviationLiters: 0,
  adaptiveThermogenesisKcalPerDay: 0,
  weightFilterState: { estimatedWeightKg: 76.85, varianceKg2: 0.25 },
};
const parameters: PhysiologicalSimulatorParameters = {
  rmrParameters: createDynamicRmrParameters({
    initialRmrKcalPerDay: 1_600, initialFatMassKg: 20, initialLeanTissueKg: 40,
  }),
  glycogenParameters: createGlycogenParameters({ baselineCarbIntakeG: 220 }),
  baselineEnergyIntakeKcalPerDay: 2_700,
  adaptiveThermogenesis: { beta: 0.14, timeConstantDays: 14 },
  weightFilter: { processNoiseVarianceKg2PerDay: 0.01, measurementNoiseVarianceKg2: 0.25 },
};
const quality: ModelDaySourceQuality = {
  status: "complete", issues: [], workIntervalCount: 1,
  workWalkingDistanceKm: 0, outsideWorkWalkingDistanceKm: 5,
  sourceObservationFields: ["caloriesKcal", "walkingDistanceKm", "workIntervals"],
  nutrition: {
    source: "observed", method: null, referenceDayCount: 0, gapLength: 0,
    referenceDates: [], observedFields: ["caloriesKcal", "proteinG", "fatG", "carbsG"],
    imputedFields: [], referenceCaloriesMedian: null, referenceCaloriesMad: null,
    referenceMacroMadG: null, dependency: "observed",
  },
};

function date(offset: number): string {
  return new Date(Date.UTC(2037, 0, 1 + offset)).toISOString().slice(0, 10);
}

function built(input: PhysiologicalDailyInput, observed = true): BuiltSimulationDay {
  return {
    input,
    sourceQuality: observed ? quality : {
      ...quality, status: "missing-nutrition",
      issues: ["caloriesKcal", "proteinG", "fatG", "carbsG"],
      sourceObservationFields: [],
      nutrition: { ...quality.nutrition, source: "missing", dependency: "imputed-downstream" },
    },
  };
}

function completeInput(offset: number): PhysiologicalDailyInput {
  const caloriesKcal = [2_050, 2_350, 2_700, 3_050, 3_350][offset % 5];
  return {
    date: date(offset), caloriesKcal,
    proteinG: [130, 150, 170][offset % 3],
    fatG: [60, 80, 105][offset % 3],
    carbsG: [130, 210, 310, 390][offset % 4],
    outsideWorkWalkingDistanceKm: [1, 4, 7, 11][offset % 4],
    averageWalkingSpeedKmh: 5,
    strengthTrainingMinutes: [0, 0, 45, 75][offset % 4],
    occupationalActivity: offset % 7 < 5
      ? { category: "standingLightModerate", durationHours: 8 }
      : { category: null, durationHours: 0, intervals: [] },
    sodiumChangeMgPerDay: null, measuredWeightKg: null,
  };
}

function unknownTarget(offset: number): PhysiologicalDailyInput {
  return {
    date: date(offset), caloriesKcal: null, proteinG: null, fatG: null, carbsG: null,
    outsideWorkWalkingDistanceKm: null, averageWalkingSpeedKmh: null,
    strengthTrainingMinutes: null,
    occupationalActivity: { category: null, durationHours: null },
    sodiumChangeMgPerDay: null, measuredWeightKg: null,
  };
}

function requireComplete(day: ReturnType<typeof simulateDays>[number]): CompleteSimulationDay {
  if (day.status !== "complete") throw new Error(`Generative truth failed on ${day.date}.`);
  return day;
}

function wilsonInterval(hits: number, count: number): { lower: number; upper: number } {
  const z = 1.959963984540054;
  const proportion = hits / count;
  const denominator = 1 + z ** 2 / count;
  const center = (proportion + z ** 2 / (2 * count)) / denominator;
  const radius = z * Math.sqrt(
    proportion * (1 - proportion) / count + z ** 2 / (4 * count ** 2),
  ) / denominator;
  return {
    lower: hits === 0 ? 0 : Math.max(0, center - radius),
    upper: hits === count ? 1 : Math.min(1, center + radius),
  };
}

type Quantity = "bodyWeightKg" | "fatMassKg" | "glycogenKg" | "leanTissueKg";
type Interval = "central50" | "high90";

export type GenerativeValidationResult = {
  scenarioCount: number;
  coverage: Record<Quantity, Record<Interval, {
    empirical: number;
    binomial95: { lower: number; upper: number };
  }>>;
  rankHistograms: Record<Quantity, number[]>;
  rankKolmogorovDistance: Record<Quantity, number>;
  statusCounts: Record<string, number>;
  medianNormalizedEss: number;
  medianMaximumWeight: number;
  byGap: Record<string, {
    scenarioCount: number;
    degradedCount: number;
    degenerateCount: number;
    medianNormalizedEss: number;
    medianMaximumWeight: number;
  }>;
};

export function runRecoveryGenerativeValidation(input: {
  scenarioCount?: number;
  particleCount?: number;
  config?: Partial<RecoveryConfig>;
} = {}): GenerativeValidationResult {
  const scenarioCount = input.scenarioCount ?? 96;
  const particleCount = input.particleCount ?? 256;
  const config = { ...DEFAULT_RECOVERY_CONFIG, ...input.config, particleCount };
  const quantities: Quantity[] = ["bodyWeightKg", "fatMassKg", "glycogenKg", "leanTissueKg"];
  const hits = Object.fromEntries(quantities.map((quantity) => [quantity, {
    central50: 0, high90: 0,
  }])) as Record<Quantity, Record<Interval, number>>;
  const rankHistograms = Object.fromEntries(quantities.map((quantity) => (
    [quantity, Array.from({ length: 10 }, () => 0)]
  ))) as Record<Quantity, number[]>;
  const ranks: Record<Quantity, number[]> = {
    bodyWeightKg: [], fatMassKg: [], glycogenKg: [], leanTissueKg: [],
  };
  const statusCounts: Record<string, number> = {};
  const normalizedEss: number[] = [];
  const maximumWeights: number[] = [];
  const qualityRuns: Array<{
    gapDays: number; status: string; normalizedEss: number; maximumWeight: number;
  }> = [];
  const donors = Array.from({ length: 42 }, (_, index) => built(completeInput(index)));
  const observationScale = Math.sqrt(config.observationResidualVarianceKg2
    * (config.observationDegreesOfFreedom - 2) / config.observationDegreesOfFreedom);

  for (let scenario = 0; scenario < scenarioCount; scenario += 1) {
    const gapDays = scenario % 2 === 0 ? 7 : 14;
    const truthRandom = new SeededRandom(100_000 + scenario);
    const regime = sampleRecoveryTrajectoryRegime(truthRandom, config);
    const hidden = Array.from({ length: gapDays }, (_, index) => sampleRecoveryDay({
      target: unknownTarget(42 + index), donors, random: truthRandom, config, regime,
    }));
    const postGap = Array.from({ length: 7 }, (_, index) => completeInput(42 + gapDays + index));
    const truth = simulateDays({
      initialState, parameters, days: [...hidden, ...postGap], options: { ecfPolicy: "hold-ecf" },
    }).map(requireComplete);
    const observationRandom = new SeededRandom(200_000 + scenario);
    const recoveryDays = [...hidden, ...postGap].map((day, index) => {
      const useObservation = index >= gapDays && [1, 3, 5, 6].includes(index - gapDays);
      const measuredWeightKg = useObservation ? studentTSample({
        random: observationRandom,
        location: truth[index].calculations.predictedPhysiologicalWeightKg,
        scale: observationScale,
        degreesOfFreedom: config.observationDegreesOfFreedom,
      }) : null;
      return index < gapDays
        ? built({ ...unknownTarget(42 + index), measuredWeightKg }, false)
        : built({ ...day, measuredWeightKg });
    });
    const result = recoverHistoricalTrajectories({
      seed: 300_000 + scenario, initialState, parameters, ecfPolicy: "hold-ecf",
      days: recoveryDays, donorDays: donors, config,
    });
    statusCounts[result.status] = (statusCounts[result.status] ?? 0) + 1;
    normalizedEss.push(result.normalizedEffectiveSampleSize);
    maximumWeights.push(result.maximumWeight);
    qualityRuns.push({
      gapDays, status: result.status,
      normalizedEss: result.normalizedEffectiveSampleSize,
      maximumWeight: result.maximumWeight,
    });
    const truthEnd = truth.at(-1)!;
    const values: Record<Quantity, number[]> = {
      bodyWeightKg: result.ensemble.map(({ bodyWeightKg }) => bodyWeightKg),
      fatMassKg: result.ensemble.map(({ state }) => state.fatMassKg),
      glycogenKg: result.ensemble.map(({ state }) => state.glycogenKg),
      leanTissueKg: result.ensemble.map(({ state }) => state.leanTissueKg),
    };
    const truths: Record<Quantity, number> = {
      bodyWeightKg: truthEnd.calculations.endWeightKg,
      fatMassKg: truthEnd.endState.fatMassKg,
      glycogenKg: truthEnd.endState.glycogenKg,
      leanTissueKg: truthEnd.endState.leanTissueKg,
    };
    const weights = result.ensemble.map(({ normalizedWeight }) => normalizedWeight);
    for (const quantity of quantities) {
      const rank = values[quantity].reduce((sum, value, index) => (
        sum + (value <= truths[quantity] ? weights[index] : 0)
      ), 0);
      ranks[quantity].push(rank);
      rankHistograms[quantity][Math.min(9, Math.floor(rank * 10))] += 1;
      for (const [interval, limits] of Object.entries({
        central50: [0.25, 0.75], high90: [0.05, 0.95],
      }) as Array<[Interval, [number, number]]>) {
        const lower = weightedQuantile(values[quantity], weights, limits[0]);
        const upper = weightedQuantile(values[quantity], weights, limits[1]);
        if (truths[quantity] >= lower && truths[quantity] <= upper) hits[quantity][interval] += 1;
      }
    }
  }

  const median = (values: number[]) => [...values].sort((left, right) => left - right)[
    Math.floor(values.length / 2)
  ];
  const rankKolmogorovDistance = Object.fromEntries(quantities.map((quantity) => {
    const sorted = [...ranks[quantity]].sort((left, right) => left - right);
    const distance = sorted.reduce((maximum, value, index) => Math.max(
      maximum,
      Math.abs(value - index / sorted.length),
      Math.abs(value - (index + 1) / sorted.length),
    ), 0);
    return [quantity, distance];
  })) as Record<Quantity, number>;
  const byGap = Object.fromEntries([7, 14].map((gapDays) => {
    const runs = qualityRuns.filter((run) => run.gapDays === gapDays);
    return [String(gapDays), {
      scenarioCount: runs.length,
      degradedCount: runs.filter(({ status }) => status === "degraded").length,
      degenerateCount: runs.filter(({ status }) => status === "degenerate").length,
      medianNormalizedEss: median(runs.map(({ normalizedEss: value }) => value)),
      medianMaximumWeight: median(runs.map(({ maximumWeight: value }) => value)),
    }];
  })) as GenerativeValidationResult["byGap"];
  return {
    scenarioCount,
    coverage: Object.fromEntries(quantities.map((quantity) => [quantity,
      Object.fromEntries((["central50", "high90"] as Interval[]).map((interval) => [interval, {
        empirical: hits[quantity][interval] / scenarioCount,
        binomial95: wilsonInterval(hits[quantity][interval], scenarioCount),
      }]))])) as GenerativeValidationResult["coverage"],
    rankHistograms,
    rankKolmogorovDistance,
    statusCounts,
    medianNormalizedEss: median(normalizedEss),
    medianMaximumWeight: median(maximumWeights),
    byGap,
  };
}
