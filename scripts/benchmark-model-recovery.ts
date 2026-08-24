import { performance } from "node:perf_hooks";
import { createGlycogenParameters } from "../src/model/body-composition/glycogen";
import { createDynamicRmrParameters } from "../src/model/dynamic-rmr";
import type { PhysiologicalDailyInput, PhysiologicalSimulatorParameters, PhysiologicalSimulatorState } from "../src/model/physiological-simulator";
import type { BuiltSimulationDay, ModelDaySourceQuality, NutritionProvenance } from "../src/modules/model-episodes/model-episode.types";
import { recoverHistoricalTrajectories } from "../src/modules/model-recovery/trajectory-recovery";

const state: PhysiologicalSimulatorState = {
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
const nutrition: NutritionProvenance = {
  source: "observed", method: null, referenceDayCount: 0, gapLength: 0,
  referenceDates: [], observedFields: ["caloriesKcal", "proteinG", "fatG", "carbsG"],
  imputedFields: [], referenceCaloriesMedian: null, referenceCaloriesMad: null,
  referenceMacroMadG: null, dependency: "observed",
};
const quality: ModelDaySourceQuality = {
  status: "complete", issues: [], workIntervalCount: 0, workWalkingDistanceKm: 0,
  outsideWorkWalkingDistanceKm: 5, sourceObservationFields: ["caloriesKcal"],
  nutrition,
};
const calendarDate = (offset: number) => new Date(Date.UTC(2026, 0, 1 + offset))
  .toISOString().slice(0, 10);
function day(offset: number, complete: boolean): BuiltSimulationDay {
  const input: PhysiologicalDailyInput = {
    date: calendarDate(offset),
    caloriesKcal: complete ? 2_200 + (offset % 4) * 350 : null,
    proteinG: complete ? 150 : null,
    fatG: complete ? 80 : null,
    carbsG: complete ? 220 : null,
    outsideWorkWalkingDistanceKm: complete ? 4 + offset % 6 : null,
    averageWalkingSpeedKmh: complete ? 5 : null,
    strengthTrainingMinutes: complete ? (offset % 3 === 0 ? 45 : 0) : null,
    occupationalActivity: complete
      ? { category: "standingLightModerate", durationHours: offset % 2 === 0 ? 8 : 0 }
      : { category: null, durationHours: null },
    sodiumChangeMgPerDay: null,
    measuredWeightKg: null,
  };
  return {
    input,
    sourceQuality: complete ? quality : {
      ...quality,
      status: "missing-nutrition",
      issues: ["caloriesKcal"],
      sourceObservationFields: [],
      nutrition: { ...nutrition, source: "missing", dependency: "imputed-downstream" },
    },
  };
}

const donors = Array.from({ length: 42 }, (_, index) => day(index, true));
const gapRunDiagnostics: Record<number, ReturnType<typeof recoverHistoricalTrajectories>["diagnostics"]> = {};
const results = [7, 14, 30, 90].map((gapDays) => {
  const recoveryDays = [
    ...Array.from({ length: gapDays }, (_, index) => day(42 + index, false)),
    ...Array.from({ length: 3 }, (_, index) => {
      const value = day(42 + gapDays + index, true);
      value.input.measuredWeightKg = 77 + index * 0.05;
      return value;
    }),
  ];
  const heapBefore = process.memoryUsage().heapUsed;
  const started = performance.now();
  const result = recoverHistoricalTrajectories({
    seed: 20_260_824,
    initialState: state,
    parameters,
    ecfPolicy: "hold-ecf",
    days: recoveryDays,
    donorDays: donors,
  });
  gapRunDiagnostics[gapDays] = result.diagnostics;
  return {
    gapDays,
    particles: result.generatedParticleCount,
    transitions: (result.generatedParticleCount
      + result.diagnostics.pilot.generatedParticleCount) * recoveryDays.length,
    elapsedMs: Number((performance.now() - started).toFixed(1)),
    heapDeltaMb: Number(Math.max(0, process.memoryUsage().heapUsed - heapBefore)
      .toFixed(0)) / 1_048_576,
    validParticles: result.validParticleCount,
    normalizedEss: Number(result.normalizedEffectiveSampleSize.toFixed(4)),
    maximumWeight: Number(result.maximumWeight.toFixed(4)),
    pilotEss: result.diagnostics.pilot.normalizedEffectiveSampleSize === null ? null
      : Number(result.diagnostics.pilot.normalizedEffectiveSampleSize.toFixed(4)),
    logWeightSd: Number(result.diagnostics.logWeightDistribution.standardDeviation.toFixed(3)),
  };
});

console.table(results);
console.log(JSON.stringify({
  representativeOrigins: Object.fromEntries([7, 14].map((gapDays) => [gapDays, {
    pilot: gapRunDiagnostics[gapDays].pilot,
    logWeightDistribution: gapRunDiagnostics[gapDays].logWeightDistribution,
    topParticleOrigins: gapRunDiagnostics[gapDays].topParticleOrigins,
  }])),
}, null, 2));

const sensitivityDays = [
  ...Array.from({ length: 14 }, (_, index) => day(42 + index, false)),
  ...Array.from({ length: 3 }, (_, index) => {
    const value = day(56 + index, true);
    value.input.measuredWeightKg = 77 + index * 0.05;
    return value;
  }),
];
const sensitivity = [128, 512, 2_048].map((particleCount) => {
  const started = performance.now();
  const result = recoverHistoricalTrajectories({
    seed: 20_260_824,
    initialState: state,
    parameters,
    ecfPolicy: "hold-ecf",
    days: sensitivityDays,
    donorDays: donors,
    config: { particleCount },
  });
  return {
    particleCount,
    elapsedMs: Number((performance.now() - started).toFixed(1)),
    medianWeightKg: Number(result.posteriorSummary.bodyWeightKg.median.toFixed(4)),
    intervalWidthKg: Number((result.posteriorSummary.bodyWeightKg.upper
      - result.posteriorSummary.bodyWeightKg.lower).toFixed(4)),
    normalizedEss: Number(result.normalizedEffectiveSampleSize.toFixed(4)),
    maximumWeight: Number(result.maximumWeight.toFixed(4)),
  };
});
console.table(sensitivity);

const canonicalBase = [
  ...Array.from({ length: 7 }, (_, index) => day(42 + index, false)),
  ...Array.from({ length: 8 }, (_, index) => day(49 + index, true)),
];
function canonicalRun(
  observations: "none" | "one" | "repeated" | "outlier",
  config: Parameters<typeof recoverHistoricalTrajectories>[0]["config"] = undefined,
  seed = 20_260_824,
) {
  const days = structuredClone(canonicalBase);
  for (let index = 7; index < days.length; index += 1) {
    const use = observations === "repeated" || observations === "outlier"
      || (observations === "one" && index === days.length - 1);
    if (use) days[index].input.measuredWeightKg = 77 + (index - 7) * 0.05;
  }
  if (observations === "outlier") days[10].input.measuredWeightKg! += 2.5;
  return recoverHistoricalTrajectories({
    seed,
    initialState: state,
    parameters,
    ecfPolicy: "hold-ecf",
    days,
    donorDays: donors,
    config,
  });
}
const canonical = ["none", "one", "repeated", "outlier"].map((label) => {
  const result = canonicalRun(label as "none" | "one" | "repeated" | "outlier");
  return {
    observations: label,
    count: result.observationCount,
    status: result.status,
    normalizedEss: Number(result.normalizedEffectiveSampleSize.toFixed(4)),
    maximumWeight: Number(result.maximumWeight.toFixed(4)),
    medianWeightKg: Number(result.posteriorSummary.bodyWeightKg.median.toFixed(4)),
    weightIntervalKg: `${result.posteriorSummary.bodyWeightKg.lower.toFixed(4)}–${result.posteriorSummary.bodyWeightKg.upper.toFixed(4)}`,
    fatIntervalKg: `${result.posteriorSummary.fatMassKg.lower.toFixed(4)}–${result.posteriorSummary.fatMassKg.upper.toFixed(4)}`,
    glycogenIntervalKg: `${result.posteriorSummary.glycogenKg.lower.toFixed(4)}–${result.posteriorSummary.glycogenKg.upper.toFixed(4)}`,
  };
});
console.table(canonical);

const strategyCases = [
  { strategy: "prior-SNIS", particleCount: 512, adaptiveProposalEnabled: false },
  { strategy: "prior-SNIS-more-N", particleCount: 2_048, adaptiveProposalEnabled: false },
  { strategy: "adaptive-log-nutrition", particleCount: 512, adaptiveProposalEnabled: true },
  { strategy: "adaptive-log-nutrition-more-N", particleCount: 2_048, adaptiveProposalEnabled: true },
] as const;
const strategyComparison = strategyCases.map((item) => {
  const started = performance.now();
  const result = canonicalRun("repeated", {
    particleCount: item.particleCount,
    adaptiveProposalEnabled: item.adaptiveProposalEnabled,
  });
  return {
    strategy: item.strategy,
    particleCount: item.particleCount,
    pilotParticleCount: result.diagnostics.pilot.generatedParticleCount,
    elapsedMs: Number((performance.now() - started).toFixed(1)),
    normalizedEss: Number(result.normalizedEffectiveSampleSize.toFixed(4)),
    absoluteEss: Number(result.effectiveSampleSize.toFixed(1)),
    maximumWeight: Number(result.maximumWeight.toFixed(4)),
    medianWeightKg: Number(result.posteriorSummary.bodyWeightKg.median.toFixed(4)),
  };
});
console.table(strategyComparison);

const referenceStarted = performance.now();
const reference = canonicalRun("repeated", {
  particleCount: 8_192, adaptivePilotParticleCount: 2_048,
});
const referenceElapsedMs = performance.now() - referenceStarted;
const referenceComparison = [512, 2_048].map((particleCount) => {
  const result = canonicalRun("repeated", { particleCount });
  const difference = (field: keyof typeof result.posteriorSummary) => ({
    median: result.posteriorSummary[field].median - reference.posteriorSummary[field].median,
    lower: result.posteriorSummary[field].lower - reference.posteriorSummary[field].lower,
    upper: result.posteriorSummary[field].upper - reference.posteriorSummary[field].upper,
  });
  return {
    particleCount,
    normalizedEss: Number(result.normalizedEffectiveSampleSize.toFixed(4)),
    weightDifference: difference("bodyWeightKg"),
    fatDifference: difference("fatMassKg"),
    glycogenDifference: difference("glycogenKg"),
  };
});
console.log(JSON.stringify({
  highComputeReference: {
    particleCount: reference.generatedParticleCount,
    pilotParticleCount: reference.diagnostics.pilot.generatedParticleCount,
    elapsedMs: Number(referenceElapsedMs.toFixed(1)),
    normalizedEss: reference.normalizedEffectiveSampleSize,
    maximumWeight: reference.maximumWeight,
    posteriorSummary: reference.posteriorSummary,
  },
  defaultComparison: referenceComparison,
}, null, 2));

const seedStability = [101, 907, 20_260_824, 1_234_567].map((seed) => {
  const result = canonicalRun("repeated", { particleCount: 512 }, seed);
  return {
    seed,
    status: result.status,
    normalizedEss: Number(result.normalizedEffectiveSampleSize.toFixed(4)),
    maximumWeight: Number(result.maximumWeight.toFixed(4)),
    medianWeightKg: Number(result.posteriorSummary.bodyWeightKg.median.toFixed(4)),
    lowerWeightKg: Number(result.posteriorSummary.bodyWeightKg.lower.toFixed(4)),
    upperWeightKg: Number(result.posteriorSummary.bodyWeightKg.upper.toFixed(4)),
  };
});
console.table(seedStability);
console.table([7, 14].flatMap((gapDays) => gapRunDiagnostics[gapDays].topParticleOrigins
  .slice(0, 3)
  .map((origin, rank) => ({
    gapDays, rank: rank + 1, component: origin.component,
    normalizedWeight: Number(origin.normalizedWeight.toFixed(4)),
    logLikelihood: Number(origin.logLikelihood.toFixed(3)),
    correction: Number(origin.logImportanceCorrection.toFixed(3)),
    nutritionMultiplier: Number(origin.nutritionMultiplier.toFixed(3)),
    walkingMultiplier: Number(origin.walkingMultiplier.toFixed(3)),
    activityExploration: origin.useActivityExploration,
    noWork: origin.forceNoOccupationalWork,
  }))));
