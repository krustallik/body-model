import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { isOccupationalCategory } from "@/model/occupational-activity";
import {
  missingPhysiologicalTransitionFields,
  simulateDays,
  type PhysiologicalSimulatorState,
} from "@/model/physiological-simulator";
import {
  ModelEpisodeNotFoundError,
  NoActiveModelEpisodeError,
} from "@/modules/model-episodes/model-episode.errors";
import { ModelEpisodeRepository } from "@/modules/model-episodes/model-episode.repository";
import type { BuiltSimulationDay, PersistedEpisode } from "@/modules/model-episodes/model-episode.types";
import { addCalendarDays, latestCompletedLocalDate } from "@/modules/model-episodes/model-calendar";
import { buildSimulationDays } from "@/modules/model-episodes/simulation-input-builder";
import { analyzeStateContinuity } from "@/modules/model-episodes/unknown-intervals";
import { ModelRecoveryRepository } from "@/modules/model-recovery/model-recovery.repository";
import {
  recoverySourceFingerprint,
  resolvedRecoveryConfig,
} from "@/modules/model-recovery/recovery-fingerprint";
import type { RecoveryParticle, RecoveryQuality } from "@/modules/model-recovery/recovery.types";
import { forecastScenarioFingerprint, forecastSourceFingerprint } from "./forecast-fingerprint";
import { runForecast } from "./forecast-engine";
import type { ForecastModelRequest } from "./model-forecast.schema";
import {
  DEFAULT_FORECAST_CONFIG,
  FORECAST_ALGORITHM_VERSION,
  type ForecastBehaviorDay,
  type ForecastBlockedResult,
  type ForecastConfig,
  type ForecastInitialParticle,
  type ForecastResult,
  type ForecastScenario,
  type ForecastVariabilityEvidence,
} from "./forecast.types";

function resolvedForecastConfig(config?: Partial<ForecastConfig>): ForecastConfig {
  return { ...DEFAULT_FORECAST_CONFIG, ...config };
}

function robustLogSpread(values: readonly number[], fallback: number): number {
  const logs = values.filter((value) => Number.isFinite(value) && value > 0).map(Math.log).sort((a, b) => a - b);
  if (logs.length < 7) return fallback;
  const median = logs[Math.floor(logs.length / 2)];
  const deviations = logs.map((value) => Math.abs(value - median)).sort((a, b) => a - b);
  return Math.min(1, Math.max(0.03, 1.4826 * deviations[Math.floor(deviations.length / 2)]));
}

function behaviorFromReliableDay(day: BuiltSimulationDay): ForecastBehaviorDay | null {
  if (day.sourceQuality.nutrition.source !== "observed"
      || day.sourceQuality.nutrition.dependency !== "observed"
      || day.sourceQuality.status !== "complete"
      || missingPhysiologicalTransitionFields(day.input, "hold-ecf").length > 0) return null;
  const occupation = (day.input.occupationalActivity.intervals ?? []).map((interval) => {
        if (!interval.category || !isOccupationalCategory(interval.category)
            || interval.durationHours === null || interval.durationHours === undefined) return null;
        return {
          category: interval.category,
          durationHours: interval.durationHours,
          breakDurationHours: interval.breakDurationHours ?? null,
          workWalkingDistanceKm: interval.workWalkingDistanceKm ?? null,
          averageWalkingSpeedKmh: interval.averageWalkingSpeedKmh ?? null,
        };
      });
  if (occupation.some((interval) => interval === null)) return null;
  return {
    nutrition: {
      caloriesKcal: day.input.caloriesKcal!,
      proteinG: day.input.proteinG!,
      fatG: day.input.fatG!,
      carbsG: day.input.carbsG!,
    },
    outsideWorkWalkingDistanceKm: day.input.outsideWorkWalkingDistanceKm!,
    averageWalkingSpeedKmh: day.input.averageWalkingSpeedKmh ?? 5,
    strengthTrainingMinutes: day.input.strengthTrainingMinutes!,
    occupation: occupation as ForecastBehaviorDay["occupation"],
  };
}

function variabilityEvidence(input: {
  scenario: ForecastScenario;
  donors: readonly ForecastBehaviorDay[];
  config: ForecastConfig;
}): ForecastVariabilityEvidence {
  if (input.scenario.mode === "fixed") {
    return {
      donorDayCount: input.donors.length,
      source: "explicit-scenario",
      nutritionLogStandardDeviation: 0,
      macroCompositionLogStandardDeviation: 0,
      walkingLogStandardDeviation: 0,
    };
  }
  const enough = input.donors.length >= input.config.minimumReliableDonorDays;
  const nutritionSd = enough
    ? robustLogSpread(input.donors.map(({ nutrition }) => nutrition.caloriesKcal), input.config.fallbackNutritionLogStandardDeviation)
    : input.config.fallbackNutritionLogStandardDeviation;
  const macroRatios = input.donors.flatMap(({ nutrition }) => [
    nutrition.proteinG / nutrition.caloriesKcal,
    nutrition.fatG / nutrition.caloriesKcal,
    nutrition.carbsG / nutrition.caloriesKcal,
  ]);
  const macroSd = enough
    ? robustLogSpread(macroRatios, input.config.fallbackMacroCompositionLogStandardDeviation)
    : input.config.fallbackMacroCompositionLogStandardDeviation;
  const walkingSd = enough
    ? robustLogSpread(input.donors.map((day) => day.outsideWorkWalkingDistanceKm).filter((value) => value > 0), input.config.fallbackWalkingLogStandardDeviation)
    : input.config.fallbackWalkingLogStandardDeviation;
  const allExplicit = input.scenario.mode === "target-centered"
    && input.scenario.variability?.nutritionLogStandardDeviation !== undefined
    && input.scenario.variability.macroCompositionLogStandardDeviation !== undefined
    && input.scenario.variability.walkingLogStandardDeviation !== undefined;
  return {
    donorDayCount: input.donors.length,
    source: allExplicit ? "explicit-scenario" : enough ? "observed-history" : "engineering-fallback",
    nutritionLogStandardDeviation: nutritionSd,
    macroCompositionLogStandardDeviation: macroSd,
    walkingLogStandardDeviation: walkingSd,
  };
}

function recoveryParticles(value: Prisma.JsonValue): ForecastInitialParticle[] | null {
  if (!Array.isArray(value)) return null;
  const result: ForecastInitialParticle[] = [];
  let totalWeight = 0;
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const particle = item as unknown as RecoveryParticle;
    const state = particle.state;
    if (!Number.isFinite(particle.normalizedWeight) || particle.normalizedWeight < 0 || !state
        || !Number.isFinite(state.fatMassKg) || state.fatMassKg <= 0
        || !Number.isFinite(state.leanTissueKg) || state.leanTissueKg <= 0
        || !Number.isFinite(state.glycogenKg) || state.glycogenKg < 0
        || !Number.isFinite(state.baselineExtracellularFluidLiters)
        || state.baselineExtracellularFluidLiters < 0
        || !Number.isFinite(state.extracellularFluidDeviationLiters)
        || state.baselineExtracellularFluidLiters + state.extracellularFluidDeviationLiters <= 0
        || !Number.isFinite(state.adaptiveThermogenesisKcalPerDay)
        || !state.weightFilterState
        || !Number.isFinite(state.weightFilterState.estimatedWeightKg)
        || state.weightFilterState.estimatedWeightKg <= 0
        || !Number.isFinite(state.weightFilterState.varianceKg2)
        || state.weightFilterState.varianceKg2 < 0) return null;
    totalWeight += particle.normalizedWeight;
    result.push({
      state: particle.state,
      weight: particle.normalizedWeight,
      sourceParticleIndex: particle.particleIndex,
    });
  }
  return totalWeight > 0 ? result : null;
}

function replayResolvedState(episode: PersistedEpisode, days: readonly BuiltSimulationDay[]): PhysiologicalSimulatorState {
  if (days.length === 0) return episode.initialState;
  const replay = simulateDays({
    initialState: episode.initialState,
    parameters: episode.simulatorParameters,
    days: days.map(({ input }) => input),
    options: { ecfPolicy: episode.ecfPolicy },
    personalization: {
      personalOffsetKcalPerDay: episode.personalOffsetKcalPerDay,
      activityCalibration: episode.activityCalibration,
    },
  });
  const latest = replay.at(-1);
  if (!latest || latest.status !== "complete") throw new Error("deterministic forecast anchor could not be replayed");
  return latest.endState;
}

function blocked(input: {
  episode: PersistedEpisode;
  recoveryVersion: string | null;
  quality: "awaiting" | "degenerate";
  reason: string;
}): ForecastBlockedResult {
  return {
    status: input.quality === "degenerate" ? "initial-state-unreliable" : "initial-state-unavailable",
    forecastVersion: FORECAST_ALGORITHM_VERSION,
    modelVersion: input.episode.modelVersion,
    recoveryVersion: input.recoveryVersion,
    initialStateQuality: input.quality,
    reason: input.reason,
  };
}

export async function forecastModelEpisode(
  request: ForecastModelRequest & { now?: Date },
  client: PrismaClient = prisma,
): Promise<ForecastResult | ForecastBlockedResult> {
  const episodes = new ModelEpisodeRepository(client);
  const recoveryRepository = new ModelRecoveryRepository(client);
  const episode = request.episodeId === undefined
    ? await episodes.getActive() : await episodes.getById(request.episodeId);
  if (!episode) {
    if (request.episodeId === undefined) throw new NoActiveModelEpisodeError();
    throw new ModelEpisodeNotFoundError();
  }
  const now = request.now ?? new Date();
  const latestCompletedDate = latestCompletedLocalDate(now, episode.timezone);
  const historyTo = episode.startDate > latestCompletedDate ? episode.startDate : latestCompletedDate;
  const sources = await episodes.loadSources(episode.startDate, historyTo);
  const builtDays = episode.startDate > latestCompletedDate ? [] : buildSimulationDays({
    from: episode.startDate,
    to: latestCompletedDate,
    sources,
    baselineNutritionFallback: episode.baselineNutritionFallback,
    nutritionGapPolicy: { maxBridgeDays: episode.nutritionMaxBridgeDays },
  });
  const continuity = analyzeStateContinuity(builtDays, episode.ecfPolicy);
  const config = resolvedForecastConfig(request.config);
  const scenario = request.scenario as ForecastScenario;
  const donorLookback = scenario.mode === "recent-behavior"
    ? scenario.donorLookbackDays ?? config.recentDonorLookbackDays
    : config.recentDonorLookbackDays;
  const donorFrom = addCalendarDays(latestCompletedDate, -(donorLookback - 1));
  const behaviorDonorDays = buildSimulationDays({
    from: donorFrom,
    to: latestCompletedDate,
    sources: await episodes.loadSources(donorFrom, latestCompletedDate),
    baselineNutritionFallback: episode.baselineNutritionFallback,
    nutritionGapPolicy: { maxBridgeDays: episode.nutritionMaxBridgeDays },
  });
  const reliableDonors = behaviorDonorDays
    .map(behaviorFromReliableDay).filter((day): day is ForecastBehaviorDay => day !== null);
  const evidence = variabilityEvidence({ scenario, donors: reliableDonors, config });

  let initialParticles: ForecastInitialParticle[];
  let initialStateQuality: "deterministic" | "recovered" | "degraded";
  let recoveryVersion: string | null = null;
  let recoveryFingerprint: string | null = null;
  let startDate: string;
  let currentStateSource: unknown;
  if (continuity.unknownIntervals.length === 0) {
    const state = replayResolvedState(episode, continuity.resolvedDays);
    initialParticles = [{ state, weight: 1 }];
    initialStateQuality = "deterministic";
    startDate = addCalendarDays(latestCompletedDate, 1);
    currentStateSource = { latestCompletedDate, builtDays, state };
  } else {
    const recovery = await recoveryRepository.loadCurrentEnsemble(episode.id);
    if (!recovery) return blocked({
      episode, recoveryVersion: null, quality: "awaiting",
      reason: "Historical continuity is unresolved and no current conditioned recovery ensemble exists.",
    });
    recoveryVersion = recovery.algorithmVersion;
    if (recovery.status === "degenerate") return blocked({
      episode, recoveryVersion, quality: "degenerate",
      reason: "The current recovery posterior is degenerate and cannot initialize a trustworthy conditioned forecast.",
    });
    if (recovery.status === "awaiting-observations") return blocked({
      episode, recoveryVersion, quality: "awaiting",
      reason: "Recovery is prior-predictive only; a conditioned current state is not available.",
    });
    const firstUnknownDate = continuity.unknownIntervals[0].startDate;
    const recoveryConfig = resolvedRecoveryConfig(recovery.config as Partial<ReturnType<typeof resolvedRecoveryConfig>>);
    const recoveryDonorFrom = addCalendarDays(firstUnknownDate, -recoveryConfig.donorLookbackDays);
    const recoveryDonorTo = addCalendarDays(firstUnknownDate, -1);
    const recoveryDonorSources = await episodes.loadSources(recoveryDonorFrom, recoveryDonorTo);
    const recoveryDonorDays = buildSimulationDays({
      from: recoveryDonorFrom,
      to: recoveryDonorTo,
      sources: recoveryDonorSources,
      baselineNutritionFallback: episode.baselineNutritionFallback,
      nutritionGapPolicy: { maxBridgeDays: episode.nutritionMaxBridgeDays },
    });
    const expectedRecoveryFingerprint = recoverySourceFingerprint({ episode, days: builtDays, donorDays: recoveryDonorDays });
    if (recovery.latestRecoveredDate !== latestCompletedDate
        || recovery.sourceFingerprint !== expectedRecoveryFingerprint) return blocked({
      episode, recoveryVersion, quality: "awaiting",
      reason: "The recovery ensemble no longer matches current history and must be rerun before forecasting.",
    });
    const particles = recoveryParticles(recovery.ensemble);
    if (!particles || particles.length === 0) return blocked({
      episode, recoveryVersion, quality: "awaiting",
      reason: "The persisted recovery ensemble is unavailable or invalid.",
    });
    initialParticles = particles;
    initialStateQuality = recovery.status as Extract<RecoveryQuality, "recovered" | "degraded">;
    recoveryFingerprint = recovery.sourceFingerprint;
    startDate = addCalendarDays(recovery.latestRecoveredDate, 1);
    currentStateSource = { recoveryId: recovery.id, recoveryFingerprint, particleCount: particles.length };
  }
  const personalization = {
    personalOffsetKcalPerDay: episode.personalOffsetKcalPerDay,
    activityCalibration: episode.activityCalibration,
  };
  const scenarioFingerprint = forecastScenarioFingerprint({
    scenario, seed: request.seed, horizonDays: request.horizonDays, config,
  });
  const sourceFingerprint = forecastSourceFingerprint({
    modelVersion: episode.modelVersion,
    recoveryVersion,
    recoverySourceFingerprint: recoveryFingerprint,
    currentStateSource,
    personalization,
    parameters: episode.simulatorParameters,
  });
  return runForecast({
    seed: request.seed,
    startDate,
    horizonDays: request.horizonDays,
    modelVersion: episode.modelVersion,
    recoveryVersion,
    sourceFingerprint,
    scenarioFingerprint,
    initialStateQuality,
    initialParticles,
    parameters: episode.simulatorParameters,
    personalization,
    ecfPolicy: episode.ecfPolicy,
    scenario,
    reliableDonorDays: reliableDonors,
    variabilityEvidence: evidence,
    config,
  });
}
