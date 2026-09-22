import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { latestCompletedLocalDate, addCalendarDays } from "@/modules/model-episodes/model-calendar";
import { ModelEpisodeRepository } from "@/modules/model-episodes/model-episode.repository";
import type { ModelHealthDaySource } from "@/modules/model-episodes/model-episode.types";
import type {
  UnifiedExperimentalPhysiologyDayResultV1,
} from "@/model/unified-experimental-physiology-v1/contracts";
import type { ExpenditurePersonalization } from "@/model/dynamic-daily-expenditure";
import type { ForecastModelRequest } from "@/modules/model-forecast/model-forecast.schema";
import type { ForecastResult } from "@/modules/model-forecast/forecast.types";
import {
  cloneForecastWorkoutActivity,
  strengthMinutesForWorkoutActivity,
  type ForecastWorkoutActivity,
} from "@/modules/model-forecast/forecast-workout-scenario";
import { runExperimentalForecast, type ExperimentalForecastBehavior } from "./engine";
import {
  DEFAULT_EXPERIMENTAL_FORECAST_CONFIG,
  EXPERIMENTAL_FORECAST_V1_REVISION,
  type ExperimentalForecastInitialState,
  type ExperimentalForecastScenario,
  type ExperimentalForecastResult,
} from "./contracts";

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
}

function rangeFrom(value: number, spread = 0) {
  return { point: value, lower: value - spread, upper: value + spread, representation: "engineering-range" as const };
}

function unifiedResult(row: {
  profileId: number;
  date: string;
  modelRevision: string;
  sourceFingerprint: string;
  priorStateFingerprint: string | null;
  resultFingerprint: string;
  qualityStatus: string;
  gapSeverity: string;
  state: unknown;
  deltas: unknown;
  uncertainty: unknown;
  reconciliation: unknown;
  energyLedger: unknown;
  sourceLineage: unknown;
  diagnostics: unknown;
}): UnifiedExperimentalPhysiologyDayResultV1 {
  return {
    contractVersion: row.modelRevision as UnifiedExperimentalPhysiologyDayResultV1["contractVersion"],
    profileId: row.profileId,
    date: row.date,
    priorStateFingerprint: row.priorStateFingerprint ?? "initial-state",
    sourceFingerprint: row.sourceFingerprint,
    state: row.state as UnifiedExperimentalPhysiologyDayResultV1["state"],
    deltas: row.deltas as UnifiedExperimentalPhysiologyDayResultV1["deltas"],
    energyLedger: row.energyLedger as UnifiedExperimentalPhysiologyDayResultV1["energyLedger"],
    quality: {
      availability: row.qualityStatus as UnifiedExperimentalPhysiologyDayResultV1["quality"]["availability"],
      gapSeverity: row.gapSeverity as UnifiedExperimentalPhysiologyDayResultV1["quality"]["gapSeverity"],
      sourceQuality: "observed",
      missingFields: [],
      reasons: [],
      modeledGapBridge: row.gapSeverity !== "none",
    },
    uncertainty: row.uncertainty as UnifiedExperimentalPhysiologyDayResultV1["uncertainty"],
    reconciliation: row.reconciliation as UnifiedExperimentalPhysiologyDayResultV1["reconciliation"],
    sourceLineage: row.sourceLineage as UnifiedExperimentalPhysiologyDayResultV1["sourceLineage"],
    diagnostics: row.diagnostics as UnifiedExperimentalPhysiologyDayResultV1["diagnostics"],
    resultFingerprint: row.resultFingerprint,
  };
}

function behaviorFromDay(day: ModelHealthDaySource | undefined, fallbackCalories: number): ExperimentalForecastBehavior {
  return {
    caloriesKcal: day?.caloriesKcal ?? fallbackCalories,
    proteinG: day?.proteinG ?? 0,
    fatG: day?.fatG ?? 0,
    carbsG: day?.carbsG ?? 0,
    outsideWorkWalkingDistanceKm: day?.walkingDistanceKm ?? 0,
    averageWalkingSpeedKmh: day?.averageWalkingSpeedKmh ?? 5,
    strengthTrainingMinutes: day?.strengthTrainingMinutes ?? 0,
    stepperMinutes: 0,
    occupation: [],
  };
}

function mapScenario(request: ForecastModelRequest): ExperimentalForecastScenario {
  const mode = request.scenario.mode;
  if (mode === "recent-behavior") return { mode: "typical-recent-activity" };
  const schedule = request.scenario.schedule;
  const day = schedule.defaultDay;
  return {
    mode: mode === "fixed" ? "explicit-plan" : "target-calories",
    caloriesKcal: day.nutrition.caloriesKcal,
    proteinG: day.nutrition.proteinG,
    fatG: day.nutrition.fatG,
    carbsG: day.nutrition.carbsG,
    activityReplacement: "replace",
  };
}

type ScheduledForecastScenario = Extract<
  ForecastModelRequest["scenario"],
  { mode: "fixed" | "target-centered" }
>;

function calendarWeekday(date: string): 0 | 1 | 2 | 3 | 4 | 5 | 6 {
  return new Date(`${date}T12:00:00Z`).getUTCDay() as 0 | 1 | 2 | 3 | 4 | 5 | 6;
}

function behaviorFromSchedule(
  date: string,
  schedule: ScheduledForecastScenario["schedule"],
): ExperimentalForecastBehavior {
  const defaultDay = schedule.defaultDay;
  const dateOverride = schedule.byDate?.[date];
  const nutrition = dateOverride?.nutrition ?? defaultDay.nutrition;
  let behavior: ExperimentalForecastBehavior = {
    caloriesKcal: nutrition.caloriesKcal,
    proteinG: nutrition.proteinG,
    fatG: nutrition.fatG,
    carbsG: nutrition.carbsG,
    outsideWorkWalkingDistanceKm: dateOverride?.outsideWorkWalkingDistanceKm
      ?? defaultDay.outsideWorkWalkingDistanceKm,
    averageWalkingSpeedKmh: dateOverride?.averageWalkingSpeedKmh
      ?? defaultDay.averageWalkingSpeedKmh,
    strengthTrainingMinutes: dateOverride?.strengthTrainingMinutes
      ?? defaultDay.strengthTrainingMinutes,
    stepperMinutes: 0,
    occupation: (dateOverride?.occupation ?? defaultDay.occupation).map((interval) => ({ ...interval })),
    workoutActivity: cloneForecastWorkoutActivity(
      dateOverride && Object.prototype.hasOwnProperty.call(dateOverride, "workoutActivity")
        ? dateOverride.workoutActivity
        : defaultDay.workoutActivity,
    ),
  };

  const weekday = calendarWeekday(date);
  const weekdayWorkouts = schedule.workoutsByWeekday?.[weekday];
  if (weekdayWorkouts !== undefined) {
    const workoutActivity: ForecastWorkoutActivity = cloneForecastWorkoutActivity(weekdayWorkouts)
      ?? { events: [] };
    behavior = {
      ...behavior,
      workoutActivity,
      strengthTrainingMinutes: strengthMinutesForWorkoutActivity(
        workoutActivity,
        behavior.strengthTrainingMinutes,
      ),
    };
  }

  const scheduledStrength = schedule.strengthByWeekday?.[weekday];
  if (scheduledStrength !== undefined) {
    behavior = {
      ...behavior,
      strengthTrainingMinutes: strengthMinutesForWorkoutActivity(
        behavior.workoutActivity,
        scheduledStrength,
      ),
    };
  }
  return behavior;
}

function initialStateFrom(input: {
  latest: UnifiedExperimentalPhysiologyDayResultV1;
  episode: Awaited<ReturnType<ModelEpisodeRepository["getActive"]>>;
  eligibleDays: number;
  requestedWindowDays: number;
  typicalMaintenance: number | null;
  latestRmr: number | null;
  latestExpenditure: number | null;
}): ExperimentalForecastInitialState | null {
  if (!input.episode) return null;
  const state = input.latest.state;
  const fatMassKg = numberValue(state.slowTissue.fatMassKg);
  const slowNonFatKg = numberValue(state.slowTissue.slowNonFatKg);
  const reconciliation = input.latest.reconciliation;
  const anchorWeightKg = numberValue(reconciliation.observedWeightKg)
    ?? numberValue(reconciliation.anchorWeightKg);
  if (fatMassKg === null || slowNonFatKg === null) return null;
  const quality = input.eligibleDays < input.requestedWindowDays
    ? "limited-history" as const
    : input.latest.quality.availability === "available" ? "standard" as const : "degraded" as const;
  return {
    unified: state,
    anchorDate: input.latest.date,
    anchorWeightKg,
    fatMassKg,
    slowNonFatKg,
    glycogenRelativeKg: state.glycogen.relativeDeviationKg,
    glycogenWaterKg: state.glycogenWater.deltaKg,
    transientWaterKg: state.transientWater.relativeKg,
    restingRmrKcalPerDay: input.latestRmr,
    typicalMaintenanceKcalPerDay: input.typicalMaintenance,
    latestExpenditureKcalPerDay: input.latestExpenditure,
    quality,
    eligibleDays: input.eligibleDays,
    requestedWindowDays: input.requestedWindowDays,
    uncertaintyReasons: [
      ...(quality === "limited-history" ? [`coverage:${input.eligibleDays}/${input.requestedWindowDays}`] : []),
      ...input.latest.uncertainty.model,
      ...input.latest.uncertainty.gap,
    ],
    unifiedFingerprint: input.latest.resultFingerprint,
    sourceResult: input.latest,
  };
}

function toLegacySummary(value: { median?: number; point?: number | null; lower: number; upper: number }) {
  const medianValue = value.median ?? value.point ?? 0;
  return { mean: medianValue, p05: value.lower, p25: value.lower, median: medianValue, p75: value.upper, p95: value.upper };
}

export function mapExperimentalForecastToLegacy(result: ExperimentalForecastResult, modelVersion: string): ForecastResult {
  return {
    status: result.status === "ok" ? "ok" : result.status === "unavailable" ? "insufficient-scenario-evidence" : "degraded",
    forecastVersion: EXPERIMENTAL_FORECAST_V1_REVISION,
    modelVersion,
    recoveryVersion: null,
    sourceFingerprint: result.initialStateFingerprint,
    scenarioFingerprint: result.scenarioFingerprint,
    initialStateQuality: result.initialStateQuality === "standard" ? "deterministic" : "degraded",
    experimentalQuality: result.initialStateQuality,
    experimentalCurrent: {
      modeledWeightKg: result.current.modeledWeightKg,
      fatMassKg: result.current.fatMassKg,
      slowNonFatKg: result.current.slowNonFatKg,
      glycogenWaterKg: result.current.glycogenWaterKg,
      transientWaterKg: result.current.transientWaterKg,
      restingRmrKcalPerDay: result.current.restingRmrKcalPerDay,
      typicalMaintenanceKcalPerDay: result.current.typicalMaintenanceKcalPerDay,
      latestExpenditureKcalPerDay: result.current.latestExpenditureKcalPerDay,
      eligibleDays: result.coverage.eligibleDays,
      requestedWindowDays: result.coverage.requestedWindowDays,
    },
    horizonDays: result.horizonDays,
    scenarioProvenance: {
      mode: result.scenario.mode === "typical-recent-activity" ? "recent-behavior" : result.scenario.mode === "explicit-plan" ? "fixed" : "target-centered",
      nutrition: result.scenario.mode === "typical-recent-activity" ? "observed-joint-block-resampling" : "fixed",
      activity: result.scenario.mode === "typical-recent-activity" ? "observed-joint-block-resampling" : "fixed-scheduled",
      donorEvidence: {
        donorDayCount: result.coverage.eligibleDays,
        source: result.initialStateQuality === "limited-history" ? "engineering-fallback" : "observed-history",
        nutritionLogStandardDeviation: 0,
        macroCompositionLogStandardDeviation: 0,
        walkingLogStandardDeviation: 0,
      },
    },
    dates: result.dates.map((day) => ({
      date: day.date,
      physiologicalBodyWeightKg: toLegacySummary(day.weightKg ?? day.weightChangeFromAnchorKg),
      fatMassKg: toLegacySummary(day.fatMassKg ?? rangeFrom(0)),
      leanTissueKg: toLegacySummary(day.slowNonFatKg ?? rangeFrom(0)),
      glycogenKg: toLegacySummary(day.glycogenKg ?? rangeFrom(0)),
      glycogenWaterKg: toLegacySummary(day.glycogenWaterKg ?? rangeFrom(0)),
      glycogenAssociatedMassKg: toLegacySummary({ median: (day.glycogenKg?.median ?? 0) + (day.glycogenWaterKg?.median ?? 0), lower: (day.glycogenKg?.lower ?? 0) + (day.glycogenWaterKg?.lower ?? 0), upper: (day.glycogenKg?.upper ?? 0) + (day.glycogenWaterKg?.upper ?? 0) }),
      extracellularFluidDeviationLiters: toLegacySummary(rangeFrom(0)),
      adaptiveThermogenesisKcalPerDay: toLegacySummary(rangeFrom(0)),
      dynamicRmrKcalPerDay: toLegacySummary(day.expenditureKcalPerDay),
      tdeeKcalPerDay: toLegacySummary(day.expenditureKcalPerDay),
      energyIntakeKcal: toLegacySummary(day.intakeKcal),
      netActivityKcalPerDay: toLegacySummary(day.activityKcalPerDay),
    })),
    diagnostics: {
      seed: result.seed,
      generatedPathCount: result.diagnostics.generatedPathCount,
      validPathCount: result.diagnostics.validPathCount,
      invalidPathCount: 0,
      invalidPathReasons: {},
      startingParticleCount: 1,
      startingParticleResampling: "none-single-state",
      uncertaintySources: {
        initialState: result.diagnostics.uncertaintySources.initialState,
        futureBehavior: result.diagnostics.uncertaintySources.futureInputs,
        measurement: false,
        modelParameters: false,
      },
      ecfPolicy: "hold-ecf",
      ecfLimitation: "Experimental Forecast V1 keeps ECF context-only unless a quantitative Unified contract is available.",
      latentPhysiologicalWeightOnly: true,
      current: true,
      numericalQuality: {
        classification: result.horizonDays > 180 ? "limited-long-horizon" : "standard",
        pathCount: result.diagnostics.generatedPathCount,
        recommendedMinimumPathCount: 1,
        pathCountAdequateForHorizon: true,
        uniqueStartingStateCount: 1,
        availableStartingStateCount: 1,
        outerQuantileRankStandardErrorProbability: 0,
        note: "Engineering ranges are deterministic bounds, not confidence intervals.",
      },
    },
  };
}

export async function experimentalForecastModelEpisode(
  request: ForecastModelRequest & { now?: Date },
  client: PrismaClient = prisma,
): Promise<ForecastResult | null> {
  if (!client || typeof (client as unknown as { unifiedExperimentalPhysiologyState?: unknown }).unifiedExperimentalPhysiologyState !== "object") {
    return null;
  }
  const episodes = new ModelEpisodeRepository(client);
  const episode = request.episodeId === undefined ? await episodes.getActive() : await episodes.getById(request.episodeId);
  if (!episode) return null;
  const now = request.now ?? new Date();
  const latestDate = latestCompletedLocalDate(now, episode.timezone);
  const unifiedRow = await client.unifiedExperimentalPhysiologyState.findFirst({
    where: { profileId: episode.profileId, date: { lte: latestDate }, modelRevision: "unified-experimental-physiology-state-v1" },
    orderBy: { date: "desc" },
  });
  if (!unifiedRow) return null;
  const latest = unifiedResult(unifiedRow);
  const requestedWindowDays = DEFAULT_EXPERIMENTAL_FORECAST_CONFIG.limitedHistoryRequestedWindowDays;
  const windowFrom = addCalendarDays(latest.date, -(requestedWindowDays - 1));
  const sources = await episodes.loadSources(windowFrom, latest.date);
  const validDays = sources.days.filter((day) => day.caloriesKcal !== null && day.proteinG !== null && day.fatG !== null && day.carbsG !== null);
  const ledgers = (await client.unifiedExperimentalPhysiologyState.findMany({
    where: { profileId: episode.profileId, date: { gte: windowFrom, lte: latest.date }, modelRevision: "unified-experimental-physiology-state-v1" },
    select: { energyLedger: true }, orderBy: { date: "asc" },
  })).map((row) => object(row.energyLedger));
  const maintenanceValues = ledgers.map((ledger) => numberValue(ledger.productionTdeeKcal)).filter((value): value is number => value !== null);
  const latestLedger = object(latest.energyLedger);
  const latestRmr = numberValue((Array.isArray(latestLedger.entries) ? latestLedger.entries : []).find((entry) => object(entry).kind === "dynamic-rmr") ? object((Array.isArray(latestLedger.entries) ? latestLedger.entries : []).find((entry) => object(entry).kind === "dynamic-rmr")).valueKcal : null);
  const typicalMaintenance = median(maintenanceValues);
  const latestExpenditure = numberValue(latestLedger.productionTdeeKcal);
  const initial = initialStateFrom({ latest, episode, eligibleDays: validDays.length, requestedWindowDays, typicalMaintenance, latestRmr, latestExpenditure });
  if (!initial) return null;
  if (initial.fatMassKg === null || initial.slowNonFatKg === null) return null;
  const latestProduction = await client.dailyModelState.findFirst({ where: { episodeId: episode.id, date: { lte: latest.date }, status: "complete" }, orderBy: { date: "desc" }, select: { glycogenKg: true, extracellularFluidDeviationLiters: true } });
  const productionGlycogenKg = latestProduction?.glycogenKg ?? episode.initialState.glycogenKg;
  const unifiedGlycogenDeviationKg = initial.glycogenRelativeKg?.point ?? 0;
  const state = {
    ...episode.initialState,
    fatMassKg: initial.fatMassKg,
    leanTissueKg: initial.slowNonFatKg,
    glycogenKg: Math.max(0, productionGlycogenKg + unifiedGlycogenDeviationKg),
    extracellularFluidDeviationLiters: latestProduction?.extracellularFluidDeviationLiters ?? episode.initialState.extracellularFluidDeviationLiters,
    weightFilterState: { ...episode.initialState.weightFilterState, estimatedWeightKg: initial.anchorWeightKg ?? episode.initialState.weightFilterState.estimatedWeightKg },
  };
  const baseline = behaviorFromDay(sources.days.at(-1), episode.baselineEnergyIntakeKcalPerDay);
  const scenarioSchedule = request.scenario.mode === "recent-behavior"
    ? undefined
    : request.scenario.schedule;
  const experimental = runExperimentalForecast({
    initial,
    simulatorState: state,
    parameters: episode.simulatorParameters,
    personalization: { personalOffsetKcalPerDay: episode.personalOffsetKcalPerDay, activityCalibration: episode.activityCalibration } as ExpenditurePersonalization,
    ecfPolicy: "hold-ecf",
    baseline,
    scenario: mapScenario(request),
    behaviorForDate: scenarioSchedule === undefined
      ? undefined
      : (date) => behaviorFromSchedule(date, scenarioSchedule),
    startDate: addCalendarDays(latest.date, 1),
    horizonDays: request.horizonDays,
    seed: request.seed,
  });
  return mapExperimentalForecastToLegacy(experimental, episode.modelVersion);
}
