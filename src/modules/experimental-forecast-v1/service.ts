import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V3_REVISION } from "@/model/unified-experimental-physiology-v1/contracts";
import { latestCompletedLocalDate, addCalendarDays } from "@/modules/model-episodes/model-calendar";
import { ModelEpisodeRepository } from "@/modules/model-episodes/model-episode.repository";
import type { ModelHealthDaySource, NutritionVector } from "@/modules/model-episodes/model-episode.types";
import { stableSha256 } from "@/modules/model-recovery/recovery-fingerprint";
import type {
  UnifiedExperimentalPhysiologyDayResultV1,
} from "@/model/unified-experimental-physiology-v1/contracts";
import type { ExpenditurePersonalization } from "@/model/dynamic-daily-expenditure";
import type { ForecastModelRequest } from "@/modules/model-forecast/model-forecast.schema";
import type { ForecastResult } from "@/modules/model-forecast/forecast.types";
import { ForecastScenarioEvidenceError } from "@/modules/model-forecast/model-forecast.errors";
import {
  cloneForecastWorkoutActivity,
  strengthMinutesForWorkoutActivity,
  type ForecastWorkoutActivity,
} from "@/modules/model-forecast/forecast-workout-scenario";
import { runExperimentalForecast, type ExperimentalForecastBehavior } from "./engine";
import { isUnifiedGenerationCurrentV1 } from "@/modules/model-episodes/publication-generation-v1";
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

function latestObservedWeightKg(days: readonly { weightKg: number | null }[]): number | null {
  for (let index = days.length - 1; index >= 0; index -= 1) {
    const weightKg = days[index]?.weightKg;
    if (typeof weightKg === "number" && Number.isFinite(weightKg) && weightKg > 0) return weightKg;
  }
  return null;
}

function rangeFrom(value: number, spread = 0) {
  return { point: value, lower: value - spread, upper: value + spread, representation: "engineering-range" as const };
}

function unifiedResult(row: {
  profileId: number;
  modelEpisodeId: number;
  date: string;
  boundaryAt: Date;
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
    modelEpisodeId: row.modelEpisodeId,
    date: row.date,
    boundaryAt: row.boundaryAt.toISOString(),
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

function behaviorFromDay(day: ModelHealthDaySource | undefined, fallbackNutrition: NutritionVector | null, fallbackSpeed = 5): ExperimentalForecastBehavior {
  const observedNutrition = [day?.caloriesKcal, day?.proteinG, day?.fatG, day?.carbsG]
    .every((value) => typeof value === "number" && Number.isFinite(value) && value > 0);
  const nutrition = observedNutrition ? day : fallbackNutrition;
  if (!nutrition) throw new ForecastScenarioEvidenceError("No complete nutrition donor or explicit engineering fallback is available.");
  return {
    caloriesKcal: nutrition.caloriesKcal!,
    proteinG: nutrition.proteinG!,
    fatG: nutrition.fatG!,
    carbsG: nutrition.carbsG!,
    outsideWorkWalkingDistanceKm: day?.walkingDistanceKm ?? 0,
    averageWalkingSpeedKmh: day?.averageWalkingSpeedKmh ?? fallbackSpeed,
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
    transientWaterKg: state.transientWater.levelKg ?? null,
    transientWaterActiveImpulses: numberValue(state.transientWater.levelKg?.point) !== null
      && Array.isArray(state.transientWater.activeImpulses)
      ? state.transientWater.activeImpulses as unknown as NonNullable<ExperimentalForecastInitialState["transientWaterActiveImpulses"]>
      : null,
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
    initialStateQuality: result.initialStateQuality === "standard" ? "deterministic" : result.initialStateQuality === "bootstrap" ? "bootstrap" : "degraded",
    experimentalQuality: result.initialStateQuality,
    ...(result.provenance ? { experimentalProvenance: result.provenance } : {}),
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
        source: result.initialStateQuality === "limited-history" || result.initialStateQuality === "bootstrap" ? "engineering-fallback" : "observed-history",
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
      glycogenKg: day.glycogenKg === null ? null : toLegacySummary(day.glycogenKg),
      glycogenWaterKg: day.glycogenWaterKg === null ? null : toLegacySummary(day.glycogenWaterKg),
      glycogenAssociatedMassKg: day.glycogenKg === null || day.glycogenWaterKg === null ? null : toLegacySummary({ median: day.glycogenKg.median + day.glycogenWaterKg.median, lower: day.glycogenKg.lower + day.glycogenWaterKg.lower, upper: day.glycogenKg.upper + day.glycogenWaterKg.upper }),
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
  if (!client || typeof (client as unknown as { unifiedExperimentalPhysiologyStateV2?: unknown }).unifiedExperimentalPhysiologyStateV2 !== "object") {
    return null;
  }
  const episodes = new ModelEpisodeRepository(client);
  const episode = request.episodeId === undefined ? await episodes.getActive() : await episodes.getById(request.episodeId);
  if (!episode) {
    if (request.episodeId !== undefined) return null;
    return null;
  }
  const now = request.now ?? new Date();
  const latestDate = latestCompletedLocalDate(now, episode.timezone);
  const lifecycle = await client.physiologyV7Lifecycle.findUnique({
    where: { profileId: episode.profileId },
    select: {
      invalidationGeneration: true,
      productionStaleFromDate: true,
      productionPublishedGeneration: true,
      unifiedPublishedGeneration: true,
    },
  });
  if (!isUnifiedGenerationCurrentV1(lifecycle)) return null;
  const expectedGeneration = lifecycle.invalidationGeneration;
  const unifiedRow = await readLatestUnifiedExperimentalPhysiologyV3ForEpisode(client, {
    profileId: episode.profileId,
    modelEpisodeId: episode.id,
    throughDate: latestDate,
  });
  // Existing production episodes without a rebuilt Unified row continue
  // through the frozen production engine. The API orchestration rebuilds the
  // Unified state before normal requests; direct read-only callers must not
  // mutate history merely to obtain a forecast.
  if (!unifiedRow) return null;
  if (unifiedRow.modelEpisodeId !== episode.id
      || !Number.isFinite(unifiedRow.boundaryAt.getTime())
      || unifiedRow.date > latestDate) return null;
  const latest = unifiedResult(unifiedRow);
  const requestedWindowDays = DEFAULT_EXPERIMENTAL_FORECAST_CONFIG.limitedHistoryRequestedWindowDays;
  const windowFrom = addCalendarDays(latest.date, -(requestedWindowDays - 1));
  const sources = await episodes.loadSources(windowFrom, latest.date);
  const currentObservedDate = addCalendarDays(latestCompletedLocalDate(now, episode.timezone), 1);
  const currentSources = await episodes.loadSources(currentObservedDate, currentObservedDate);
  const currentObservedWeightKg = latestObservedWeightKg(currentSources.days);
  const validDays = sources.days.filter((day) => day.caloriesKcal !== null && day.proteinG !== null && day.fatG !== null && day.carbsG !== null);
  const ledgers = (await client.unifiedExperimentalPhysiologyStateV2.findMany({
    where: { profileId: episode.profileId, modelEpisodeId: episode.id, date: { gte: windowFrom, lte: latest.date }, modelRevision: UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V3_REVISION },
    select: { energyLedger: true }, orderBy: { boundaryAt: "asc" },
  })).map((row) => object(row.energyLedger));
  const maintenanceValues = ledgers.map((ledger) => numberValue(ledger.productionTdeeKcal)).filter((value): value is number => value !== null);
  const latestLedger = object(latest.energyLedger);
  const latestRmr = numberValue((Array.isArray(latestLedger.entries) ? latestLedger.entries : []).find((entry) => object(entry).kind === "dynamic-rmr") ? object((Array.isArray(latestLedger.entries) ? latestLedger.entries : []).find((entry) => object(entry).kind === "dynamic-rmr")).valueKcal : null);
  const typicalMaintenance = median(maintenanceValues);
  const latestExpenditure = numberValue(latestLedger.productionTdeeKcal);
  const initialBase = initialStateFrom({ latest, episode, eligibleDays: validDays.length, requestedWindowDays, typicalMaintenance, latestRmr, latestExpenditure });
  const initial = initialBase && currentObservedWeightKg !== null
    ? {
      ...initialBase,
      anchorWeightKg: currentObservedWeightKg,
      unifiedFingerprint: stableSha256({ base: initialBase.unifiedFingerprint, currentObservedWeightKg }),
    }
    : initialBase;
  if (!initial || initial.fatMassKg === null || initial.slowNonFatKg === null) return null;
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
  const recentSpeed = median(sources.days
    .map((day) => day.averageWalkingSpeedKmh)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0)) ?? 5;
  const baseline = behaviorFromDay(sources.days.at(-1), episode.baselineNutritionFallback, recentSpeed);
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
    timeZone: episode.timezone,
    episodeId: episode.id,
    horizonDays: request.horizonDays,
    seed: request.seed,
  });
  const finalLifecycle = await client.physiologyV7Lifecycle.findUnique({
    where: { profileId: episode.profileId },
    select: {
      invalidationGeneration: true,
      productionStaleFromDate: true,
      productionPublishedGeneration: true,
      unifiedPublishedGeneration: true,
    },
  });
  if (!isUnifiedGenerationCurrentV1(finalLifecycle)
      || finalLifecycle.invalidationGeneration !== expectedGeneration
      || finalLifecycle.productionPublishedGeneration !== expectedGeneration
      || finalLifecycle.unifiedPublishedGeneration !== expectedGeneration) return null;
  return mapExperimentalForecastToLegacy(experimental, episode.modelVersion);
}

/** The Forecast V1 donor is episode-local and latest by absolute model boundary. */
export function readLatestUnifiedExperimentalPhysiologyV3ForEpisode(
  client: PrismaClient,
  input: { profileId: number; modelEpisodeId: number; throughDate: string },
) {
  return client.unifiedExperimentalPhysiologyStateV2.findFirst({
    where: {
      profileId: input.profileId,
      modelEpisodeId: input.modelEpisodeId,
      date: { lte: input.throughDate },
      modelRevision: UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V3_REVISION,
    },
    orderBy: { boundaryAt: "desc" },
  });
}

/** @deprecated V2 rows are no longer current; retained as a source-compatible alias. */
export const readLatestUnifiedExperimentalPhysiologyV2ForEpisode = readLatestUnifiedExperimentalPhysiologyV3ForEpisode;
