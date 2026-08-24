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
import { weightedQuantile } from "../../src/modules/model-recovery/recovery-math";
import { recoverHistoricalTrajectories } from "../../src/modules/model-recovery/trajectory-recovery";

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
  return new Date(Date.UTC(2035, 0, 1 + offset)).toISOString().slice(0, 10);
}

function day(input: PhysiologicalDailyInput, observed = true): BuiltSimulationDay {
  return {
    input,
    sourceQuality: observed ? quality : {
      ...quality,
      status: "missing-nutrition",
      issues: ["caloriesKcal", "proteinG", "fatG", "carbsG"],
      sourceObservationFields: [],
      nutrition: { ...quality.nutrition, source: "missing", dependency: "imputed-downstream" },
    },
  };
}

function completeInput(input: {
  offset: number;
  caloriesKcal: number;
  carbsG: number;
  walkingKm: number;
  strengthMinutes: number;
  workHours: number;
}): PhysiologicalDailyInput {
  return {
    date: date(input.offset),
    caloriesKcal: input.caloriesKcal,
    proteinG: 145,
    fatG: 75,
    carbsG: input.carbsG,
    outsideWorkWalkingDistanceKm: input.walkingKm,
    averageWalkingSpeedKmh: input.walkingKm > 0 ? 5 : null,
    strengthTrainingMinutes: input.strengthMinutes,
    occupationalActivity: input.workHours > 0
      ? { category: "manualModerate", durationHours: input.workHours }
      : { category: null, durationHours: 0, intervals: [] },
    sodiumChangeMgPerDay: null,
    measuredWeightKg: null,
  };
}

function complete(result: ReturnType<typeof simulateDays>[number]): CompleteSimulationDay {
  if (result.status !== "complete") throw new Error(`Synthetic truth failed on ${result.date}.`);
  return result;
}

export type SupportValidationResult = {
  scenarioCount: number;
  coverage: Record<"bodyWeightKg" | "fatMassKg" | "glycogenKg", {
    central50: number;
    high90: number;
  }>;
  statusCounts: Record<string, number>;
  supportCases: {
    workerToNoWorkCount: number;
    sedentaryToHighActivityCount: number;
  };
  failures: Array<{
    scenario: string;
    quantity: string;
    interval: "central50" | "high90";
    truth: number;
    lower: number;
    upper: number;
  }>;
  byGap: Record<string, {
    runCount: number;
    degradedCount: number;
    degenerateCount: number;
    medianNormalizedEss: number;
    medianMaximumWeight: number;
    medianWeightIntervalWidthKg: number;
    medianLogWeightStandardDeviation: number;
    minimumValidParticleFraction: number;
    truthOutsideFinitePriorSupportCount: number;
    truthInPriorTailCount: number;
    truthOutsideFinitePosteriorSupportCount: number;
  }>;
};

export function runRecoverySupportValidation(input: {
  particleCount?: number;
  baseScenarioCount?: number;
  seeds?: number[];
} = {}): SupportValidationResult {
  const particleCount = input.particleCount ?? 256;
  const baseScenarioCount = input.baseScenarioCount ?? 24;
  const seeds = input.seeds ?? [101, 907];
  const quantities = ["bodyWeightKg", "fatMassKg", "glycogenKg"] as const;
  const hits = Object.fromEntries(quantities.map((quantity) => [quantity, {
    central50: 0, high90: 0,
  }])) as Record<typeof quantities[number], { central50: number; high90: number }>;
  const failures: SupportValidationResult["failures"] = [];
  const statusCounts: Record<string, number> = {};
  let workerToNoWorkCount = 0;
  let sedentaryToHighActivityCount = 0;
  const runDiagnostics: Array<{
    gapDays: number; status: string; normalizedEss: number; maximumWeight: number;
    weightIntervalWidthKg: number; logWeightStandardDeviation: number;
    validParticleFraction: number; outsidePriorSupport: boolean;
    inPriorTail: boolean; outsidePosteriorSupport: boolean;
  }> = [];

  for (let scenarioIndex = 0; scenarioIndex < baseScenarioCount; scenarioIndex += 1) {
    const gapDays = [7, 14, 30][scenarioIndex % 3];
    const caloriesKcal = [1_900, 2_700, 3_500][Math.floor(scenarioIndex / 3) % 3];
    const carbsG = [100, 220, 380][Math.floor(scenarioIndex / 8) % 3];
    const walkingKm = [1, 6, 14][(scenarioIndex * 2) % 3];
    const strengthMinutes = scenarioIndex % 2 === 0 ? 0 : 75;
    const truthWorkHours = scenarioIndex % 4 === 0 ? 0 : 8;
    const historyWorkHours = scenarioIndex % 2 === 0 ? 8 : 0;
    const historyWalkingKm = scenarioIndex % 5 === 0 ? 1 : 6;
    if (historyWorkHours > 0 && truthWorkHours === 0) workerToNoWorkCount += seeds.length;
    if (historyWalkingKm <= 1 && walkingKm >= 14) sedentaryToHighActivityCount += seeds.length;

    const donors = Array.from({ length: 42 }, (_, index) => day(completeInput({
      offset: index,
      caloriesKcal: scenarioIndex % 6 < 3 ? 2_000 + (index % 3) * 80 : 2_700,
      carbsG: 180 + (index % 4) * 25,
      walkingKm: historyWalkingKm,
      strengthMinutes: historyWalkingKm <= 1 ? 0 : index % 3 === 0 ? 45 : 0,
      workHours: historyWorkHours,
    })));
    const hidden = Array.from({ length: gapDays }, (_, index) => completeInput({
      offset: 42 + index, caloriesKcal, carbsG, walkingKm, strengthMinutes,
      workHours: truthWorkHours,
    }));
    const postGap = Array.from({ length: 7 }, (_, index) => completeInput({
      offset: 42 + gapDays + index,
      caloriesKcal: 2_700, carbsG: 220, walkingKm: 6,
      strengthMinutes: index % 3 === 0 ? 45 : 0, workHours: index < 5 ? 8 : 0,
    }));
    const truth = simulateDays({
      initialState, parameters, days: [...hidden, ...postGap],
      options: { ecfPolicy: "hold-ecf" },
    }).map(complete);
    const truthEnd = truth.at(-1)!;

    for (const seed of seeds) {
      const recoveryDays = [...hidden, ...postGap].map((value, index) => {
        const measuredWeightKg = index >= gapDays && (index - gapDays) % 2 === 1
          ? truth[index].calculations.endWeightKg
          : null;
        return index < gapDays
          ? day({
              ...value,
              caloriesKcal: null, proteinG: null, fatG: null, carbsG: null,
              outsideWorkWalkingDistanceKm: null, averageWalkingSpeedKmh: null,
              strengthTrainingMinutes: null,
              occupationalActivity: { category: null, durationHours: null },
              measuredWeightKg,
            }, false)
          : day({ ...value, measuredWeightKg });
      });
      const result = recoverHistoricalTrajectories({
        seed, initialState, parameters, ecfPolicy: "hold-ecf",
        days: recoveryDays, donorDays: donors, config: { particleCount },
      });
      statusCounts[result.status] = (statusCounts[result.status] ?? 0) + 1;
      const weights = result.ensemble.map(({ normalizedWeight }) => normalizedWeight);
      const values = {
        bodyWeightKg: result.ensemble.map(({ bodyWeightKg }) => bodyWeightKg),
        fatMassKg: result.ensemble.map(({ state }) => state.fatMassKg),
        glycogenKg: result.ensemble.map(({ state }) => state.glycogenKg),
      };
      const truths = {
        bodyWeightKg: truthEnd.calculations.endWeightKg,
        fatMassKg: truthEnd.endState.fatMassKg,
        glycogenKg: truthEnd.endState.glycogenKg,
      };
      const priorDays = structuredClone(recoveryDays);
      priorDays.forEach((value) => { value.input.measuredWeightKg = null; });
      const prior = recoverHistoricalTrajectories({
        seed, initialState, parameters, ecfPolicy: "hold-ecf",
        days: priorDays, donorDays: donors,
        config: { particleCount, adaptiveProposalEnabled: false },
      });
      const priorWeights = prior.ensemble.map(({ normalizedWeight }) => normalizedWeight);
      const priorWeightValues = prior.ensemble.map(({ bodyWeightKg }) => bodyWeightKg);
      const posteriorWeightValues = result.ensemble.map(({ bodyWeightKg }) => bodyWeightKg);
      const truthWeight = truths.bodyWeightKg;
      const priorMinimum = Math.min(...priorWeightValues);
      const priorMaximum = Math.max(...priorWeightValues);
      const posteriorMinimum = Math.min(...posteriorWeightValues);
      const posteriorMaximum = Math.max(...posteriorWeightValues);
      const priorHighLower = weightedQuantile(priorWeightValues, priorWeights, 0.005);
      const priorHighUpper = weightedQuantile(priorWeightValues, priorWeights, 0.995);
      runDiagnostics.push({
        gapDays, status: result.status,
        normalizedEss: result.normalizedEffectiveSampleSize,
        maximumWeight: result.maximumWeight,
        weightIntervalWidthKg: result.posteriorSummary.bodyWeightKg.upper
          - result.posteriorSummary.bodyWeightKg.lower,
        logWeightStandardDeviation: result.diagnostics.logWeightDistribution.standardDeviation,
        validParticleFraction: result.diagnostics.validParticleFraction,
        outsidePriorSupport: truthWeight < priorMinimum || truthWeight > priorMaximum,
        inPriorTail: truthWeight >= priorMinimum && truthWeight <= priorMaximum
          && (truthWeight < priorHighLower || truthWeight > priorHighUpper),
        outsidePosteriorSupport: truthWeight < posteriorMinimum || truthWeight > posteriorMaximum,
      });
      for (const quantity of quantities) {
        for (const [interval, probabilities] of Object.entries({
          central50: [0.25, 0.75], high90: [0.05, 0.95],
        }) as Array<["central50" | "high90", [number, number]]>) {
          const lower = weightedQuantile(values[quantity], weights, probabilities[0]);
          const upper = weightedQuantile(values[quantity], weights, probabilities[1]);
          if (truths[quantity] >= lower && truths[quantity] <= upper) {
            hits[quantity][interval] += 1;
          } else if (interval === "high90") {
            failures.push({
              scenario: `scenario-${scenarioIndex}-seed-${seed}-gap-${gapDays}`,
              quantity, interval, truth: truths[quantity], lower, upper,
            });
          }
        }
      }
    }
  }

  const scenarioCount = baseScenarioCount * seeds.length;
  const median = (values: number[]) => [...values].sort((left, right) => left - right)[
    Math.floor(values.length / 2)
  ];
  const byGap = Object.fromEntries([7, 14, 30].map((gapDays) => {
    const runs = runDiagnostics.filter((run) => run.gapDays === gapDays);
    return [String(gapDays), {
      runCount: runs.length,
      degradedCount: runs.filter(({ status }) => status === "degraded").length,
      degenerateCount: runs.filter(({ status }) => status === "degenerate").length,
      medianNormalizedEss: median(runs.map(({ normalizedEss }) => normalizedEss)),
      medianMaximumWeight: median(runs.map(({ maximumWeight }) => maximumWeight)),
      medianWeightIntervalWidthKg: median(runs.map(({ weightIntervalWidthKg }) => weightIntervalWidthKg)),
      medianLogWeightStandardDeviation: median(runs.map(({ logWeightStandardDeviation }) => logWeightStandardDeviation)),
      minimumValidParticleFraction: Math.min(...runs.map(({ validParticleFraction }) => validParticleFraction)),
      truthOutsideFinitePriorSupportCount: runs.filter(({ outsidePriorSupport }) => outsidePriorSupport).length,
      truthInPriorTailCount: runs.filter(({ inPriorTail }) => inPriorTail).length,
      truthOutsideFinitePosteriorSupportCount: runs.filter(({ outsidePosteriorSupport }) => outsidePosteriorSupport).length,
    }];
  })) as SupportValidationResult["byGap"];
  return {
    scenarioCount,
    coverage: Object.fromEntries(quantities.map((quantity) => [quantity, {
      central50: hits[quantity].central50 / scenarioCount,
      high90: hits[quantity].high90 / scenarioCount,
    }])) as SupportValidationResult["coverage"],
    statusCounts,
    supportCases: { workerToNoWorkCount, sedentaryToHighActivityCount },
    failures,
    byGap,
  };
}
