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
import { buildSimulationDays, eligibleHistoricalDonors } from "@/modules/model-episodes/simulation-input-builder";
import { analyzeStateContinuity } from "@/modules/model-episodes/unknown-intervals";
import { ModelRecoveryRepository } from "@/modules/model-recovery/model-recovery.repository";
import {
  recoverySourceFingerprint,
  resolvedRecoveryConfig,
} from "@/modules/model-recovery/recovery-fingerprint";
import type { RecoveryParticle, RecoveryQuality } from "@/modules/model-recovery/recovery.types";
import { forecastScenarioFingerprint, forecastSourceFingerprint } from "./forecast-fingerprint";
import { runForecastWithInternalArtifacts, type ForecastInternalArtifacts } from "./forecast-engine";
import type { ForecastModelRequest } from "./model-forecast.schema";
import { UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V4_REVISION } from "@/model/unified-experimental-physiology-v1/contracts";
import { calculateGlycogenAssociatedWaterKg } from "@/model/body-composition/state";
import {
  DEFAULT_FORECAST_CONFIG,
  EXPERIMENTAL_FORECAST_V2_VERSION,
  type ForecastBehaviorDay,
  type ForecastBlockedResult,
  type ForecastConfig,
  type ForecastInitialParticle,
  type ForecastResult,
  type ForecastScenario,
  type ForecastVariabilityEvidence,
} from "./forecast.types";

const finiteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const recordValue = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value)
  ? value as Record<string, unknown>
  : {};

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

/** Projects a complete historical simulation day into a forecast donor behavior day. */
export function projectReliableForecastBehaviorDay(day: BuiltSimulationDay): ForecastBehaviorDay | null {
  if (day.sourceQuality.nutrition.source !== "observed"
      || day.sourceQuality.nutrition.dependency !== "observed"
      || day.sourceQuality.status !== "complete"
      || missingPhysiologicalTransitionFields(day.input, "hold-ecf").length > 0) return null;
  // Partial workout-energy coverage must not seed forecast as if energy were complete.
  if (day.sourceQuality.selectionV1?.energyCoverage?.fullCoverage === false) return null;
  if (day.sourceQuality.selectionV1?.historicalDonorEligible === false) return null;
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
  const strengthTrainingMinutes = day.input.strengthTrainingMinutes;
  if (strengthTrainingMinutes === null || strengthTrainingMinutes === undefined) return null;
  const workoutActivity = day.input.workoutActivity === undefined
    ? undefined
    : {
      events: day.input.workoutActivity.events.map((event) => ({
        ...event,
        energyProvenance: event.activeEnergyKcal !== null && event.activeEnergyKcal > 0
          ? "device-estimate" as const
          : event.classification === "traditional-strength-training"
            ? "strength-met-fallback" as const
            : "unspecified" as const,
      })),
    };
  return {
    nutrition: {
      caloriesKcal: day.input.caloriesKcal!,
      proteinG: day.input.proteinG!,
      fatG: day.input.fatG!,
      carbsG: day.input.carbsG!,
    },
    outsideWorkWalkingDistanceKm: day.input.outsideWorkWalkingDistanceKm!,
    averageWalkingSpeedKmh: day.input.averageWalkingSpeedKmh ?? 5,
    strengthTrainingMinutes,
    occupation: occupation as ForecastBehaviorDay["occupation"],
    ...(workoutActivity === undefined ? {} : { workoutActivity }),
    workoutFeedObserved: day.sourceQuality.workoutFeedObserved ?? null,
  };
}

function behaviorFromReliableDay(day: BuiltSimulationDay): ForecastBehaviorDay | null {
  return projectReliableForecastBehaviorDay(day);
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

function latestObservedWeightKg(days: readonly BuiltSimulationDay[]): number | null {
  for (let index = days.length - 1; index >= 0; index -= 1) {
    const weightKg = days[index]?.input.measuredWeightKg;
    if (typeof weightKg === "number" && Number.isFinite(weightKg) && weightKg > 0) return weightKg;
  }
  return null;
}

function latestSourceWeightKg(days: readonly { weightKg: number | null }[]): number | null {
  for (let index = days.length - 1; index >= 0; index -= 1) {
    const weightKg = days[index]?.weightKg;
    if (typeof weightKg === "number" && Number.isFinite(weightKg) && weightKg > 0) return weightKg;
  }
  return null;
}

function blocked(input: {
  episode: PersistedEpisode;
  recoveryVersion: string | null;
  quality: "awaiting" | "degenerate";
  reason: string;
}): ForecastBlockedResult {
  return {
    status: input.quality === "degenerate" ? "initial-state-unreliable" : "initial-state-unavailable",
    forecastVersion: EXPERIMENTAL_FORECAST_V2_VERSION,
    modelVersion: input.episode.modelVersion,
    recoveryVersion: input.recoveryVersion,
    initialStateQuality: input.quality,
    reason: input.reason,
  };
}

function blockedV2(input: {
  episode: PersistedEpisode;
  reasonCode: NonNullable<ForecastBlockedResult["reasonCode"]>;
  reason: string;
}): ForecastBlockedResult {
  return {
    status: "initial-state-unavailable",
    forecastVersion: EXPERIMENTAL_FORECAST_V2_VERSION,
    modelVersion: input.episode.modelVersion,
    recoveryVersion: null,
    initialStateQuality: "awaiting",
    reasonCode: input.reasonCode,
    reason: input.reason,
  };
}

export type ForecastModelEpisodeInternalResult = ForecastInternalArtifacts | ForecastBlockedResult;

export async function forecastModelEpisodeWithInternalArtifacts(
  request: ForecastModelRequest & { now?: Date },
  client: PrismaClient = prisma,
): Promise<ForecastModelEpisodeInternalResult> {
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
  const lifecycle = await client.physiologyV7Lifecycle.findUnique({
    where: { profileId: episode.profileId },
    select: {
      invalidationGeneration: true,
      staleFromDate: true,
      productionStaleFromDate: true,
      productionPublishedGeneration: true,
      unifiedPublishedGeneration: true,
      unifiedTargetRevision: true,
      unifiedRolloutEpoch: true,
      unifiedPublishedRolloutEpoch: true,
    },
  });
  const v4IsCurrent = lifecycle !== null
    && lifecycle.unifiedTargetRevision === UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V4_REVISION
    && lifecycle.unifiedRolloutEpoch > 0
    && lifecycle.unifiedPublishedRolloutEpoch === lifecycle.unifiedRolloutEpoch
    && lifecycle.productionStaleFromDate === null
    && lifecycle.productionPublishedGeneration === lifecycle.invalidationGeneration
    && lifecycle.unifiedPublishedGeneration === lifecycle.invalidationGeneration
    && (lifecycle.staleFromDate === null
      || lifecycle.staleFromDate < episode.startDate
      || lifecycle.staleFromDate > latestCompletedDate);
  if (!v4IsCurrent) return blockedV2({
    episode,
    reasonCode: "unified-v4-not-current",
    reason: "Unified V4 is not current for the production generation and rollout epoch.",
  });
  const latestUnifiedRow = await client.unifiedExperimentalPhysiologyStateV2.findUnique({
    where: { profileId_modelEpisodeId_date: { profileId: episode.profileId, modelEpisodeId: episode.id, date: latestCompletedDate } },
    select: { modelRevision: true, resultFingerprint: true, state: true },
  });
  if (latestUnifiedRow?.modelRevision !== UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V4_REVISION) return blockedV2({
    episode,
    reasonCode: "unified-v4-not-current",
    reason: "The active episode has no exact V4 row at the latest completed model boundary.",
  });
  const physicalGlycogen = recordValue(recordValue(latestUnifiedRow.state).glycogen);
  const physicalWater = recordValue(recordValue(latestUnifiedRow.state).glycogenWater);
  const physicalGlycogenKg = physicalGlycogen.physicalKg;
  const physicalGlycogenWaterKg = physicalWater.physicalKg;
  if (physicalGlycogen.physicalAvailability === "blocked") return blockedV2({
    episode,
    reasonCode: "production-glycogen-null",
    reason: "The current production row explicitly has null physical glycogen; episode initial state cannot replace it.",
  });
  if (physicalGlycogen.physicalAvailability !== "available"
      || !finiteNumber(physicalGlycogenKg) || physicalGlycogenKg < 0
      || !finiteNumber(physicalGlycogenWaterKg)
      || Math.abs(physicalGlycogenWaterKg - calculateGlycogenAssociatedWaterKg(physicalGlycogenKg)) > 1e-9) {
    return blockedV2({
      episode,
      reasonCode: "physical-glycogen-unavailable",
      reason: "Unified V4 does not contain valid physical glycogen and matching canonical 2.7x associated water.",
    });
  }
  const historyTo = episode.startDate > latestCompletedDate ? episode.startDate : latestCompletedDate;
  const sources = await episodes.loadSources(episode.startDate, historyTo);
  const builtDays = episode.startDate > latestCompletedDate ? [] : buildSimulationDays({
    from: episode.startDate,
    to: latestCompletedDate,
    sources,
    baselineNutritionFallback: episode.baselineNutritionFallback,
    nutritionGapPolicy: { maxBridgeDays: episode.nutritionMaxBridgeDays },
    modelVersion: episode.modelVersion,
  });
  const continuity = analyzeStateContinuity(builtDays, episode.ecfPolicy);
  // A current-day scale measurement may anchor the future level, but its
  // incomplete food/activity row remains excluded from historical replay.
  const currentDate = addCalendarDays(latestCompletedDate, 1);
  const currentSources = await episodes.loadSources(currentDate, currentDate);
  const observedAnchorWeightKg = latestSourceWeightKg(currentSources.days)
    ?? latestObservedWeightKg(builtDays);
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
    modelVersion: episode.modelVersion,
  });
  const reliableDonors = eligibleHistoricalDonors(episode.modelVersion, behaviorDonorDays)
    .map(behaviorFromReliableDay).filter((day): day is ForecastBehaviorDay => day !== null);
  const evidence = variabilityEvidence({ scenario, donors: reliableDonors, config });
  const fallbackNutrition = episode.baselineNutritionFallback;
  const engineeringFallbackDay: ForecastBehaviorDay | null = fallbackNutrition === null ? null : {
    nutrition: {
      caloriesKcal: fallbackNutrition.caloriesKcal,
      proteinG: fallbackNutrition.proteinG,
      fatG: fallbackNutrition.fatG,
      carbsG: fallbackNutrition.carbsG,
    },
    outsideWorkWalkingDistanceKm: 0,
    averageWalkingSpeedKmh: 5,
    strengthTrainingMinutes: 0,
    occupation: [],
    workoutFeedObserved: null,
  };
  if (scenario.mode === "recent-behavior" && reliableDonors.length === 0 && engineeringFallbackDay === null) {
    return blockedV2({
      episode,
      reasonCode: "nutrition-evidence-unavailable",
      reason: "No complete recent nutrition donor or existing episode engineering fallback is available.",
    });
  }

  let initialParticles: ForecastInitialParticle[];
  let initialStateQuality: "deterministic" | "recovered" | "degraded";
  let recoveryVersion: string | null = null;
  let recoveryFingerprint: string | null = null;
  let startDate: string;
  let currentStateSource: unknown;
  if (continuity.unknownIntervals.length === 0) {
    const state = { ...replayResolvedState(episode, continuity.resolvedDays), glycogenKg: physicalGlycogenKg };
    initialParticles = [{ state, weight: 1 }];
    initialStateQuality = "deterministic";
    startDate = addCalendarDays(latestCompletedDate, 1);
    currentStateSource = { latestCompletedDate, observedAnchorWeightKg, builtDays, state, unifiedResultFingerprint: latestUnifiedRow.resultFingerprint, fallbackNutrition };
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
    const recoveryDonorDays = eligibleHistoricalDonors(episode.modelVersion, buildSimulationDays({
      from: recoveryDonorFrom,
      to: recoveryDonorTo,
      sources: recoveryDonorSources,
      baselineNutritionFallback: episode.baselineNutritionFallback,
      nutritionGapPolicy: { maxBridgeDays: episode.nutritionMaxBridgeDays },
      modelVersion: episode.modelVersion,
    }));
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
    initialParticles = particles.map((particle) => ({
      ...particle,
      state: { ...particle.state, glycogenKg: physicalGlycogenKg },
    }));
    initialStateQuality = recovery.status as Extract<RecoveryQuality, "recovered" | "degraded">;
    recoveryFingerprint = recovery.sourceFingerprint;
    startDate = addCalendarDays(recovery.latestRecoveredDate, 1);
    currentStateSource = { recoveryId: recovery.id, recoveryFingerprint, observedAnchorWeightKg, particleCount: particles.length, unifiedResultFingerprint: latestUnifiedRow.resultFingerprint, physicalGlycogenKg, fallbackNutrition };
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
  const artifacts = runForecastWithInternalArtifacts({
    seed: request.seed,
    startDate,
    horizonDays: request.horizonDays,
    modelVersion: episode.modelVersion,
    recoveryVersion,
    sourceFingerprint,
    scenarioFingerprint,
    initialStateQuality,
    initialParticles,
    anchorWeightKg: observedAnchorWeightKg,
    parameters: episode.simulatorParameters,
    personalization,
    ecfPolicy: episode.ecfPolicy,
    scenario,
    reliableDonorDays: reliableDonors,
    engineeringFallbackDay,
    variabilityEvidence: evidence,
    config,
  });
  const finalLifecycle = await client.physiologyV7Lifecycle.findUnique({
    where: { profileId: episode.profileId },
    select: {
      invalidationGeneration: true,
      staleFromDate: true,
      productionStaleFromDate: true,
      productionPublishedGeneration: true,
      unifiedPublishedGeneration: true,
      unifiedTargetRevision: true,
      unifiedRolloutEpoch: true,
      unifiedPublishedRolloutEpoch: true,
    },
  });
  if (!finalLifecycle || finalLifecycle.invalidationGeneration !== lifecycle.invalidationGeneration
      || finalLifecycle.unifiedPublishedGeneration !== lifecycle.unifiedPublishedGeneration
      || finalLifecycle.unifiedPublishedRolloutEpoch !== lifecycle.unifiedPublishedRolloutEpoch
      || finalLifecycle.unifiedRolloutEpoch !== lifecycle.unifiedRolloutEpoch
      || finalLifecycle.unifiedTargetRevision !== UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V4_REVISION
      || finalLifecycle.productionStaleFromDate !== null
      || finalLifecycle.productionPublishedGeneration !== finalLifecycle.invalidationGeneration
      || (finalLifecycle.staleFromDate !== null
        && finalLifecycle.staleFromDate >= episode.startDate
        && finalLifecycle.staleFromDate <= latestCompletedDate)) {
    return blockedV2({ episode, reasonCode: "unified-v4-not-current", reason: "Unified V4 became stale while the forecast was being computed." });
  }
  artifacts.result.forecastVersion = EXPERIMENTAL_FORECAST_V2_VERSION;
  artifacts.result.experimentalQuality = reliableDonors.length >= config.minimumReliableDonorDays ? "standard" : "limited-history";
  const nutritionSource = scenario.mode !== "recent-behavior"
    ? "explicit-scenario" as const
    : reliableDonors.length > 0 ? "complete-recent-donor" as const : "episode-engineering-fallback" as const;
  const transientWaterEnvelope = recordValue(recordValue(latestUnifiedRow.state).transientWater).levelKg;
  const transientWaterPoint = transientWaterEnvelope === null || transientWaterEnvelope === undefined
    ? null
    : recordValue(transientWaterEnvelope).point;
  artifacts.result.experimentalProvenance = {
    source: reliableDonors.length > 0 ? "observed-history" : "engineering-fallback",
    nutritionSource,
    nutritionFallback: nutritionSource === "episode-engineering-fallback" ? fallbackNutrition : null,
    nutritionUncertainty: {
      nutritionLogStandardDeviation: evidence.nutritionLogStandardDeviation,
      macroCompositionLogStandardDeviation: evidence.macroCompositionLogStandardDeviation,
    },
    anchor: observedAnchorWeightKg === null ? "none" : "observed-weight",
    reasons: [
      ...(reliableDonors.length === 0 ? ["no-complete-valid-recent-nutrition-donor; explicit engineering fallback retained"] : []),
      `physical-glycogen:${String(physicalGlycogen.physicalProvenance)}`,
    ],
    improvements: ["Add complete recent nutrition days to replace the explicit engineering nutrition fallback."],
  };
  artifacts.result.experimentalCurrent = {
    modeledWeightKg: observedAnchorWeightKg ?? artifacts.initialPhysiologicalBodyWeightKg,
    glycogenKg: physicalGlycogenKg,
    fatMassKg: initialParticles[0]?.state.fatMassKg ?? null,
    slowNonFatKg: initialParticles[0]?.state.leanTissueKg ?? null,
    glycogenWaterKg: physicalGlycogenWaterKg,
    transientWaterKg: finiteNumber(transientWaterPoint) ? transientWaterPoint : null,
    restingRmrKcalPerDay: null,
    typicalMaintenanceKcalPerDay: episode.baselineEnergyIntakeKcalPerDay,
    latestExpenditureKcalPerDay: null,
    eligibleDays: reliableDonors.length,
    requestedWindowDays: donorLookback,
    physicalGlycogenProvenance: physicalGlycogen.physicalProvenance as "production-daily-model-state" | "episode-initial-state",
  };
  return artifacts;
}

export async function forecastModelEpisode(
  request: ForecastModelRequest & { now?: Date },
  client: PrismaClient = prisma,
): Promise<ForecastResult | ForecastBlockedResult> {
  const result = await forecastModelEpisodeWithInternalArtifacts(request, client);
  return "result" in result ? result.result : result;
}
