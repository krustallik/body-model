import { calculateDynamicDailyExpenditure } from "@/model/dynamic-daily-expenditure";
import { simulateDays, type PhysiologicalDailyInput } from "@/model/physiological-simulator";
import { reconstructBodyWeightKg } from "@/model/body-composition/state";
import { prepareEpisodeInitialization } from "@/modules/model-episodes/episode-initialization";
import { deriveEnergyHomeostasisReference } from "@/modules/model-episodes/initialization-bootstrap";
import { addCalendarDays } from "@/modules/model-episodes/model-calendar";
import type { HistoricalModelSources, ModelHealthDaySource } from "@/modules/model-episodes/model-episode.types";

const profile = { id: 1, sex: "male" as const, dateOfBirth: "1990-05-10", heightCm: 180 };
const endDate = "2035-12-31";
const count = 140;
const startDate = addCalendarDays(endDate, -(count - 1));
const noise = [0, .04, -.03, .02, -.02];
type Scenario = { name: string; offset: number | null; ambiguous?: boolean; mutate?: (day: PhysiologicalDailyInput, i: number) => void;
  report?: (day: ModelHealthDaySource, i: number) => void; water?: (i: number) => number; count?: number;
  /** Exact simulator index where the generating regime changes. */
  changeIndex?: number };

const scenarios: Scenario[] = [
  { name: "maintenance", offset: 0 },
  { name: "deficit", offset: 0, mutate: (d) => { d.caloriesKcal = 2050; d.carbsG = 150; } },
  { name: "surplus", offset: 0, mutate: (d) => { d.caloriesKcal = 2850; d.carbsG = 330; } },
  { name: "offset +150", offset: 150 }, { name: "offset -150", offset: -150 },
  { name: "low-carb transition", offset: 0, ambiguous: true, changeIndex: 100, mutate: (d, i) => { if (i >= 100) d.carbsG = 70; } },
  { name: "high-carb transition", offset: 0, ambiguous: true, changeIndex: 100, mutate: (d, i) => { if (i >= 100) d.carbsG = 420; } },
  { name: "already-adapted deficit", offset: 0, ambiguous: true, mutate: (d) => { d.caloriesKcal = 2050; } },
  { name: "already-adapted surplus", offset: 0, ambiguous: true, mutate: (d) => { d.caloriesKcal = 2850; } },
  { name: "calories down + activity up", offset: 0, ambiguous: true, changeIndex: 100, mutate: (d, i) => { if (i >= 100) { d.caloriesKcal = 1950; d.outsideWorkWalkingDistanceKm = 10; } } },
  { name: "calories up + activity down", offset: 0, ambiguous: true, changeIndex: 100, mutate: (d, i) => { if (i >= 100) { d.caloriesKcal = 2950; d.outsideWorkWalkingDistanceKm = 1; } } },
  { name: "activity-only intervention", offset: 0, ambiguous: true, changeIndex: 100, mutate: (d, i) => { if (i >= 100) d.outsideWorkWalkingDistanceKm = 10; } },
  { name: "no pre-carb history", offset: 0, ambiguous: true, report: (d, i) => { if (i < 100) d.carbsG = null; } },
  { name: "short AT pre-roll", offset: 0, ambiguous: true, count: 42 },
  { name: "uncertain initial glycogen", offset: 0, ambiguous: true, count: 35,
    mutate: (d, i) => { if (i < 112) d.carbsG = i % 2 ? 40 : 450; } },
  { name: "persistent water retention", offset: 0, ambiguous: true, water: (i) => i >= 105 ? 1 : 0 },
  { name: "persistent water release", offset: 0, ambiguous: true, water: (i) => i >= 105 ? -1 : 0 },
  { name: "food under-reporting", offset: 0, ambiguous: true, report: (d) => { d.caloriesKcal! -= 350; } },
  { name: "missing activity", offset: 0, ambiguous: true, report: (d, i) => { if (i >= 105) d.walkingDistanceKm = null; } },
  { name: "large scale outlier", offset: 0, ambiguous: true, water: (i) => i === 112 ? 3 : 0 },
  { name: "regime change in long interval", offset: 0, ambiguous: true, changeIndex: 75, mutate: (d, i) => { if (i >= 75) d.caloriesKcal = 1900; } },
  { name: "insufficient history", offset: null, ambiguous: true, count: 20 },
  { name: "historical composition differs", offset: 150 },
];

const seedDays: ModelHealthDaySource[] = Array.from({ length: count }, (_, i) => ({
  date: addCalendarDays(startDate, i), weightKg: 80, bodyFatPercent: 20, caloriesKcal: 2450,
  proteinG: 150, fatG: 75, carbsG: 240, averageWalkingSpeedKmh: 5,
  walkingDistanceKm: 5, strengthTrainingMinutes: 30, workoutFeedObserved: null,
}));
const seed = prepareEpisodeInitialization({ profile, days: seedDays, startDate: endDate,
  baselineConfig: { windowDays: 84, lookbackDays: 90, minimumCompleteNutritionDays: 63,
    minimumWeightObservations: 42, minimumWeightSpanDays: 63, maximumAbsoluteWeightTrendPercentPerWeek: .25 } });
const activity = calculateDynamicDailyExpenditure({ bodyComposition: seed.initialState,
  rmrParameters: seed.simulatorParameters.rmrParameters, macros: seed.baseline.fallbackNutrition,
  outsideWorkWalking: { distanceKm: 5, averageSpeedKmh: 5 }, strength: { durationMinutes: 30 },
  occupational: { category: null, durationHours: 0 }, adaptiveThermogenesisKcalPerDay: 0 }).activityKcalPerDay!;
const neutral = deriveEnergyHomeostasisReference({ rmrKcalPerDay: seed.initialRmrKcalPerDay,
  referenceActivityKcalPerDay: activity, personalOffsetKcalPerDay: 0,
  observedReferenceNutrition: seed.baseline.fallbackNutrition }).energyKcalPerDay;

function random(seed: number) { let state = seed || 1; return () => ((state = state * 1664525 + 1013904223 >>> 0) / 2 ** 32); }
function dataset(s: Scenario, seedValue = 0): HistoricalModelSources {
  const rng = random(seedValue + 17); const interventionShift = seedValue === 0 ? 0 : seedValue % 7 - 3;
  const n = s.count ?? count; const offsetStart = count - n;
  const inputs: PhysiologicalDailyInput[] = Array.from({ length: count }, (_, i) => {
    const day: PhysiologicalDailyInput = { date: addCalendarDays(startDate, i), caloriesKcal: neutral,
      proteinG: 150, fatG: 75, carbsG: 240, outsideWorkWalkingDistanceKm: 5,
      averageWalkingSpeedKmh: 5, strengthTrainingMinutes: 30,
      occupationalActivity: { category: null, durationHours: 0 }, sodiumChangeMgPerDay: null,
      measuredWeightKg: null };
    s.mutate?.(day, i + interventionShift);
    day.caloriesKcal! += (rng() - .5) * (seedValue === 0 ? 0 : 180);
    day.carbsG! = Math.max(1, day.carbsG! + (rng() - .5) * (seedValue === 0 ? 0 : 30));
    day.outsideWorkWalkingDistanceKm! = Math.max(0, day.outsideWorkWalkingDistanceKm!
      + (rng() - .5) * (seedValue === 0 ? 0 : 2));
    return day;
  });
  const generatedInitial = structuredClone(seed.initialState);
  if (seedValue !== 0) generatedInitial.glycogenKg = .2 + rng() * .6;
  generatedInitial.weightFilterState.estimatedWeightKg = reconstructBodyWeightKg(generatedInitial);
  const generated = simulateDays({ initialState: generatedInitial,
    parameters: { ...seed.simulatorParameters, baselineEnergyIntakeKcalPerDay: neutral }, days: inputs,
    options: { ecfPolicy: "hold-ecf" }, personalization: { personalOffsetKcalPerDay: s.offset ?? 0, activityCalibration: 1 } });
  const days = generated.slice(offsetStart).map((result, j): ModelHealthDaySource => {
    if (result.status !== "complete") throw new Error(result.status);
    const i = offsetStart + j; const scaleNoise = seedValue === 0 ? noise[i % noise.length] : (rng() - .5) * .18;
    const weight = reconstructBodyWeightKg(result.endState) + scaleNoise + (s.water?.(i) ?? 0);
    const day: ModelHealthDaySource = { date: inputs[i].date, weightKg: weight,
      bodyFatPercent: (seedValue === 0 || i % (2 + seedValue % 4) === 0 || i === count - 1)
        ? result.endState.fatMassKg / reconstructBodyWeightKg(result.endState) * 100
          + (seedValue === 0 ? 0 : (rng() - .5) * .8) : null,
      caloriesKcal: inputs[i].caloriesKcal!, proteinG: inputs[i].proteinG!, fatG: inputs[i].fatG!, carbsG: inputs[i].carbsG!,
      averageWalkingSpeedKmh: inputs[i].averageWalkingSpeedKmh!, walkingDistanceKm: inputs[i].outsideWorkWalkingDistanceKm!,
      strengthTrainingMinutes: inputs[i].strengthTrainingMinutes!, workoutFeedObserved: null };
    if (seedValue !== 0 && i % (7 + seedValue % 3) === 1) day.weightKg = null;
    s.report?.(day, i); return day;
  });
  return { days, snapshots: [], workIntervals: [] };
}

const strategies = [28, 42, 56, 70, 84, "variable"] as const;
type ValidationRow = { scenario: string; strategy: typeof strategies[number]; trueOffset: number | null;
  inferredOffset: number; signedError: number | null; absoluteError: number | null; interval: number | null;
  spread: number | null; alternatives?: unknown[]; confidence: string; reasons: unknown; pass: boolean;
  crossesKnownRegimeChange: boolean; detectedInternalRegimeChange: boolean };
type InitializationDiagnostics = { reason?: string; ci0?: { status?: string };
  offsetSensitivity?: { spreadKcalPerDay?: number; alternatives?: unknown[] };
  internalRegime?: { detected?: boolean } };
function crossesKnownRegimeChange(scenario: Scenario, interval: number | null, seedValue = 0): boolean {
  if (scenario.changeIndex === undefined || interval === null) return false;
  const interventionShift = seedValue === 0 ? 0 : seedValue % 7 - 3;
  const actualChangeIndex = scenario.changeIndex - interventionShift;
  const firstFittingIndex = count - interval;
  return firstFittingIndex <= actualChangeIndex && actualChangeIndex < count - 1;
}
const rows: ValidationRow[] = [];
for (const s of scenarios) for (const strategy of strategies) {
  try {
    const sources = dataset(s);
    const config = strategy === "variable" ? undefined : { windowDays: strategy, lookbackDays: 90,
      minimumCompleteNutritionDays: Math.ceil(strategy * .75), minimumWeightObservations: Math.ceil(strategy * .5),
      minimumWeightSpanDays: Math.ceil(strategy * .75), maximumAbsoluteWeightTrendPercentPerWeek: .25 };
    const result = prepareEpisodeInitialization({ profile, days: sources.days, sources, startDate: endDate, baselineConfig: config });
    const diag = result.initializationDiagnostics as InitializationDiagnostics | undefined;
    const inferred = result.initialPersonalOffsetKcalPerDay ?? 0;
    const error = s.offset === null ? null : inferred - s.offset;
    rows.push({ scenario: s.name, strategy, trueOffset: s.offset, inferredOffset: inferred,
      signedError: error, absoluteError: error === null ? null : Math.abs(error),
      interval: result.baseline.diagnostics.windowDays, spread: diag?.offsetSensitivity?.spreadKcalPerDay ?? null,
      alternatives: diag?.offsetSensitivity?.alternatives ?? [],
      confidence: result.initializationStatus ?? "insufficient", reasons: diag?.reason ?? diag?.ci0?.status ?? null,
      pass: s.ambiguous ? result.initializationStatus !== "strong" : error !== null && Math.abs(error) <= 40,
      crossesKnownRegimeChange: crossesKnownRegimeChange(s, result.baseline.diagnostics.windowDays),
      detectedInternalRegimeChange: diag?.internalRegime?.detected ?? false });
  } catch (error) {
    rows.push({ scenario: s.name, strategy, trueOffset: s.offset, inferredOffset: 0,
      signedError: s.offset === null ? null : -s.offset, absoluteError: s.offset === null ? null : Math.abs(s.offset),
      interval: null, spread: null, confidence: "insufficient", reasons: error instanceof Error ? error.message : String(error),
      pass: s.ambiguous === true, crossesKnownRegimeChange: false, detectedInternalRegimeChange: false });
  }
}
const median = (v: number[]) => { const x = [...v].sort((a,b)=>a-b); return x.length ? x[Math.floor(x.length/2)] : 0; };
const benchmark = strategies.map((strategy) => { const r = rows.filter(x=>x.strategy===strategy); const clean=r.flatMap(x=>!scenarios.find(s=>s.name===x.scenario)!.ambiguous && x.absoluteError!==null && x.signedError!==null
  ? [{ absoluteError: x.absoluteError, signedError: x.signedError }] : []);
  return { strategy, medianAbsoluteError: median(clean.map(x=>x.absoluteError)), meanBias: clean.reduce((a,x)=>a+x.signedError,0)/Math.max(clean.length,1),
    worstCleanError: Math.max(0,...clean.map(x=>x.absoluteError)), falseStrongRate: r.filter(x=>scenarios.find(s=>s.name===x.scenario)!.ambiguous&&x.confidence==="strong").length/r.length,
    weakRate:r.filter(x=>x.confidence==="weak").length/r.length, insufficientRate:r.filter(x=>x.confidence==="insufficient").length/r.length,
    regimeContaminationRate: r.filter(x=>x.crossesKnownRegimeChange).length/r.length,
    detectedContaminationRate: r.filter(x=>x.detectedInternalRegimeChange).length/r.length,
    medianSpread:median(r.flatMap(x=>x.spread===null?[]:[x.spread])) }; });
const validationSet = process.env.BODYCAST_VALIDATION_SET === "final-holdout"
  ? "final-holdout" : "development";
// These disjoint deterministic seeds are frozen before the final holdout is run.
const validationSeeds = validationSet === "final-holdout"
  ? [1001, 1002, 1003, 1004, 1005, 1006, 1007, 1008, 1009, 1010]
  : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const replicateRows = validationSeeds.flatMap((seedValue) =>
  scenarios.map((scenario) => {
    try {
      const sources = dataset(scenario, seedValue);
      const result = prepareEpisodeInitialization({ profile, days: sources.days, sources, startDate: endDate });
      const diagnostics = result.initializationDiagnostics as { offsetSensitivity?: unknown;
        persistentWater?: unknown; evidenceOutcome?: unknown; candidateSelection?: unknown };
      const inferred = result.initialPersonalOffsetKcalPerDay ?? 0;
      const signedError = scenario.offset === null ? null : inferred - scenario.offset;
      return { set: validationSet, seed: seedValue, scenario: scenario.name, trueOffset: scenario.offset, inferred,
        signedError, absoluteError: signedError === null ? null : Math.abs(signedError),
        appliedOffset: result.appliedPersonalOffsetKcalPerDay ?? 0,
        diagnostics,
        confidence: result.initializationStatus ?? "insufficient",
        selectionWindow: result.baseline.diagnostics.windowDays,
        crossesKnownRegimeChange: crossesKnownRegimeChange(scenario, result.baseline.diagnostics.windowDays, seedValue),
        detectedInternalRegimeChange: Boolean((diagnostics as { internalRegime?: { detected?: boolean } }).internalRegime?.detected) };
    } catch (error) {
      return { set: validationSet, seed: seedValue, scenario: scenario.name, trueOffset: scenario.offset, inferred: 0,
        signedError: null, absoluteError: null, confidence: "insufficient", selectionWindow: null,
        appliedOffset: 0, crossesKnownRegimeChange: false, detectedInternalRegimeChange: false,
        error: error instanceof Error ? error.message : String(error) };
    }
  }));
const percentile = (values: number[], p: number) => { const x=[...values].sort((a,b)=>a-b); return x[Math.min(x.length-1,Math.floor(p*x.length))] ?? 0; };
const distributions = [validationSet].map(set => { const relevant=replicateRows.filter(r=>r.set===set && r.absoluteError!==null && !scenarios.find(s=>s.name===r.scenario)!.ambiguous);
  const errors=relevant.flatMap(r=>r.absoluteError===null?[]:[r.absoluteError]); const signed=relevant.flatMap(r=>r.signedError===null?[]:[r.signedError]);
  const cleanStrong = relevant.filter(r=>r.confidence==="strong").length;
  const cleanSupported = relevant.filter(r=>r.confidence!=="insufficient").length;
  return { set, count: errors.length, median: percentile(errors,.5), p75:percentile(errors,.75), p90:percentile(errors,.9), p95:percentile(errors,.95), worst:Math.max(...errors), bias:signed.reduce((a,b)=>a+b,0)/signed.length,
    strongCoverage: replicateRows.filter(r=>r.set===set&&r.confidence==="strong").length/replicateRows.filter(r=>r.set===set).length,
    weakCoverage: replicateRows.filter(r=>r.set===set&&r.confidence==="weak").length/replicateRows.filter(r=>r.set===set).length,
    insufficientCoverage: replicateRows.filter(r=>r.set===set&&r.confidence==="insufficient").length/replicateRows.filter(r=>r.set===set).length,
    cleanStrongCoverage: cleanStrong/relevant.length, cleanSupportedCoverage: cleanSupported/relevant.length,
    ambiguousFalseStrong: replicateRows.filter(r=>r.set===set&&scenarios.find(s=>s.name===r.scenario)!.ambiguous&&r.confidence==="strong").length,
    ambiguousFalseApplied: replicateRows.filter(r=>r.set===set&&scenarios.find(s=>s.name===r.scenario)!.ambiguous&&r.appliedOffset!==0).length,
    selectorContaminationRate: replicateRows.filter(r=>r.set===set&&r.crossesKnownRegimeChange).length/replicateRows.filter(r=>r.set===set).length,
    selectedIntervalCount: new Set(replicateRows.filter(r=>r.set===set).flatMap(r=>r.selectionWindow===null?[]:[r.selectionWindow])).size } });
const distributionGroups = [
  { name: "true offset 0", scenarios: ["maintenance", "deficit", "surplus"] },
  { name: "true offset +150", scenarios: ["offset +150", "historical composition differs"] },
  { name: "true offset -150", scenarios: ["offset -150"] },
  { name: "clean deficit", scenarios: ["deficit"] },
  { name: "clean surplus", scenarios: ["surplus"] },
  { name: "glycogen transitions", scenarios: ["low-carb transition", "high-carb transition"] },
].map((group) => {
  const relevant = replicateRows.filter((row) => group.scenarios.includes(row.scenario)
    && row.absoluteError !== null && row.signedError !== null);
  const errors = relevant.map((row) => row.absoluteError!);
  const signed = relevant.map((row) => row.signedError!);
  return { group: group.name, count: relevant.length, median: percentile(errors, .5),
    p75: percentile(errors, .75), p90: percentile(errors, .9), p95: percentile(errors, .95),
    worst: Math.max(0, ...errors), bias: signed.reduce((sum, value) => sum + value, 0) / Math.max(1, signed.length) };
});

/** Engineering policy derived from development synthetic validation; frozen before final holdout. */
const FROZEN_HOLDOUT_GATES = {
  medianAbsoluteErrorKcalPerDay: 40,
  p90AbsoluteErrorKcalPerDay: 60,
  p95AbsoluteErrorKcalPerDay: 65,
  worstCleanErrorKcalPerDay: 75,
  positive150P95ErrorKcalPerDay: 70,
  negative150P95ErrorKcalPerDay: 55,
  absoluteBiasKcalPerDay: 15,
  minimumCleanStrongCoverage: 0.03,
  minimumCleanSupportedCoverage: 0.75,
  maximumAmbiguousFalseStrong: 0,
  maximumAmbiguousFalseApplied: 0,
  maximumSelectorContaminationRate: 0,
  minimumDistinctSelectedIntervals: 3,
} as const;
const distribution = distributions[0];
const positive150 = distributionGroups.find(({ group }) => group === "true offset +150")!;
const negative150 = distributionGroups.find(({ group }) => group === "true offset -150")!;
const holdoutAssessment = validationSet !== "final-holdout" ? null : {
  gates: FROZEN_HOLDOUT_GATES,
  checks: {
    median: distribution.median <= FROZEN_HOLDOUT_GATES.medianAbsoluteErrorKcalPerDay,
    p90: distribution.p90 <= FROZEN_HOLDOUT_GATES.p90AbsoluteErrorKcalPerDay,
    p95: distribution.p95 <= FROZEN_HOLDOUT_GATES.p95AbsoluteErrorKcalPerDay,
    worst: distribution.worst <= FROZEN_HOLDOUT_GATES.worstCleanErrorKcalPerDay,
    positive150Recovery: positive150.p95 <= FROZEN_HOLDOUT_GATES.positive150P95ErrorKcalPerDay,
    negative150Recovery: negative150.p95 <= FROZEN_HOLDOUT_GATES.negative150P95ErrorKcalPerDay,
    bias: Math.abs(distribution.bias) <= FROZEN_HOLDOUT_GATES.absoluteBiasKcalPerDay,
    cleanStrongCoverage: distribution.cleanStrongCoverage >= FROZEN_HOLDOUT_GATES.minimumCleanStrongCoverage,
    cleanSupportedCoverage: distribution.cleanSupportedCoverage >= FROZEN_HOLDOUT_GATES.minimumCleanSupportedCoverage,
    ambiguousFalseStrong: distribution.ambiguousFalseStrong <= FROZEN_HOLDOUT_GATES.maximumAmbiguousFalseStrong,
    ambiguousFalseApplied: distribution.ambiguousFalseApplied <= FROZEN_HOLDOUT_GATES.maximumAmbiguousFalseApplied,
    selectorContamination: distribution.selectorContaminationRate <= FROZEN_HOLDOUT_GATES.maximumSelectorContaminationRate,
    intervalDiversity: distribution.selectedIntervalCount >= FROZEN_HOLDOUT_GATES.minimumDistinctSelectedIntervals,
  },
};
console.log(JSON.stringify({ rows, benchmark, replicateRows, distributions, distributionGroups, holdoutAssessment }, null, 2));
