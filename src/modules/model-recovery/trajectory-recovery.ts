import { reconstructBodyWeightKg } from "@/model/body-composition/state";
import { missingPhysiologicalTransitionFields, simulateOneDay, type PhysiologicalSimulatorState } from "@/model/physiological-simulator";
import { predictWeightFilterState, updateWeightFilterWithMeasurement, type WeightFilterState } from "@/model/weight-observation-filter";
import { effectiveSampleSize, logImportanceWeight, normalizeLogWeights, SeededRandom, studentTLogDensity, weightedSummary } from "./recovery-math";
import { observedRecoveryDonors, sampleRecoveryDay } from "./recovery-proposal";
import {
  fitAdaptiveRegimeProposal,
  logPriorRecoveryRegimeDensity,
  sampleDefensiveRegimeMixture,
  samplePriorRecoveryRegime,
  type RegimeProposalDraw,
} from "./recovery-regime-proposal";
import {
  DEFAULT_RECOVERY_CONFIG,
  RECOVERY_ALGORITHM_VERSION,
  type RecoveryConfig,
  type RecoveryParticle,
  type RecoveryQuality,
  type RecoveryStateSummary,
  type TrajectoryRecoveryInput,
  type TrajectoryRecoveryResult,
} from "./recovery.types";

function validateConfig(config: RecoveryConfig): void {
  const positive = [
    config.particleCount,
    config.donorLookbackDays,
    config.donorRecencyHalfLifeDays,
    config.sameWeekdayMultiplier,
    config.nutritionLogStandardDeviationFloor,
    config.nutritionLogStandardDeviationCeiling,
    config.vacationSpreadMultiplier,
    config.nutritionRegimeLogStandardDeviation,
    config.walkingLogStandardDeviation,
    config.activityExplorationLogStandardDeviation,
    config.minimumWalkingReferenceKm,
    config.strengthExplorationMedianMinutes,
    config.strengthExplorationLogStandardDeviation,
    config.macroCompositionLogStandardDeviation,
    config.adaptivePilotParticleCount,
    config.adaptivePilotLikelihoodTemperature,
    config.adaptivePriorMixtureWeight,
    config.adaptiveVarianceInflation,
    config.adaptiveVarianceRegularization,
    config.observationDegreesOfFreedom,
    config.observationResidualVarianceKg2,
    config.healthyNormalizedEssThreshold,
    config.degenerateNormalizedEssThreshold,
    config.healthyMaximumWeightThreshold,
    config.degenerateMaximumWeightThreshold,
    config.healthyValidParticleFractionThreshold,
    config.degenerateValidParticleFractionThreshold,
  ];
  if (positive.some((value) => !Number.isFinite(value) || value <= 0)) {
    throw new Error("Recovery configuration values must be finite and positive.");
  }
  if (!Number.isInteger(config.particleCount) || config.particleCount > 20_000
      || !Number.isInteger(config.adaptivePilotParticleCount)
      || config.adaptivePilotParticleCount > 20_000) {
    throw new Error("Recovery particle counts must be integers no greater than 20,000.");
  }
  if (config.observationDegreesOfFreedom <= 2) {
    throw new Error("Recovery observation degrees of freedom must exceed two.");
  }
  const probabilities = [
    config.activityExplorationProbability,
    config.strengthNoTrainingPriorProbability,
    config.strengthExplorationProbability,
    config.noOccupationalWorkPriorProbability,
  ];
  if (probabilities.some((value) => !Number.isFinite(value) || value <= 0 || value >= 1)) {
    throw new Error("Recovery prior mixture probabilities must be strictly between zero and one.");
  }
  if (config.adaptivePilotLikelihoodTemperature > 1
      || config.adaptivePriorMixtureWeight >= 1) {
    throw new Error("Recovery adaptive proposal controls are outside their valid ranges.");
  }
  if (!(config.degenerateNormalizedEssThreshold < config.healthyNormalizedEssThreshold
      && config.healthyMaximumWeightThreshold < config.degenerateMaximumWeightThreshold
      && config.degenerateValidParticleFractionThreshold
        < config.healthyValidParticleFractionThreshold)) {
    throw new Error("Recovery diagnostic thresholds must have a valid severe-to-healthy order.");
  }
  if (!(config.lowerQuantile >= 0 && config.lowerQuantile < 0.5
      && config.upperQuantile > 0.5 && config.upperQuantile <= 1)) {
    throw new Error("Recovery quantiles must bracket the median.");
  }
}

function cloneState(state: PhysiologicalSimulatorState): PhysiologicalSimulatorState {
  return { ...state, weightFilterState: { ...state.weightFilterState } };
}

function summarize(particles: readonly RecoveryParticle[], config: RecoveryConfig): RecoveryStateSummary {
  const weights = particles.map((particle) => particle.normalizedWeight);
  const field = (select: (particle: RecoveryParticle) => number) => weightedSummary({
    values: particles.map(select),
    weights,
    lowerProbability: config.lowerQuantile,
    upperProbability: config.upperQuantile,
  });
  return {
    bodyWeightKg: field((particle) => particle.bodyWeightKg),
    fatMassKg: field((particle) => particle.state.fatMassKg),
    leanTissueKg: field((particle) => particle.state.leanTissueKg),
    glycogenKg: field((particle) => particle.state.glycogenKg),
    extracellularFluidDeviationLiters: field((particle) => particle.state.extracellularFluidDeviationLiters),
    adaptiveThermogenesisKcalPerDay: field((particle) => particle.state.adaptiveThermogenesisKcalPerDay),
  };
}

function quality(input: {
  observationCount: number;
  normalizedEss: number;
  maximumWeight: number;
  validParticleFraction: number;
  config: RecoveryConfig;
}): { status: RecoveryQuality; reasons: string[] } {
  if (input.observationCount === 0) {
    return { status: "awaiting-observations", reasons: ["no-weight-observations"] };
  }
  const severeReasons = [
    ...(input.normalizedEss < input.config.degenerateNormalizedEssThreshold
      ? ["normalized-ess-below-degenerate-threshold"] : []),
    ...(input.maximumWeight > input.config.degenerateMaximumWeightThreshold
      ? ["maximum-weight-above-degenerate-threshold"] : []),
    ...(input.validParticleFraction < input.config.degenerateValidParticleFractionThreshold
      ? ["valid-particle-fraction-below-degenerate-threshold"] : []),
  ];
  if (severeReasons.length > 0) return { status: "degenerate", reasons: severeReasons };
  const degradedReasons = [
    ...(input.normalizedEss < input.config.healthyNormalizedEssThreshold
      ? ["normalized-ess-below-healthy-threshold"] : []),
    ...(input.maximumWeight > input.config.healthyMaximumWeightThreshold
      ? ["maximum-weight-above-healthy-threshold"] : []),
    ...(input.validParticleFraction < input.config.healthyValidParticleFractionThreshold
      ? ["valid-particle-fraction-below-healthy-threshold"] : []),
  ];
  return degradedReasons.length > 0
    ? { status: "degraded", reasons: degradedReasons }
    : { status: "recovered", reasons: [] };
}

export function recoverHistoricalTrajectories(input: TrajectoryRecoveryInput): TrajectoryRecoveryResult {
  const config = { ...DEFAULT_RECOVERY_CONFIG, ...input.config };
  validateConfig(config);
  if (input.days.length === 0) throw new Error("Historical recovery requires at least one day.");
  const donors = observedRecoveryDonors({ days: input.donorDays, ecfPolicy: input.ecfPolicy });
  if (donors.length === 0) throw new Error("Historical recovery requires a complete observed donor day.");
  const unknownDayCount = input.days.filter(({ input: day }) => (
    missingPhysiologicalTransitionFields(day, input.ecfPolicy).length > 0
  )).length;
  if (unknownDayCount === 0) throw new Error("Historical recovery was requested without an unknown day.");

  const observations = input.days.flatMap(({ input: day }) => (
    day.measuredWeightKg === null || day.measuredWeightKg === undefined
      ? []
      : [{ date: day.date, weightKg: day.measuredWeightKg }]
  ));
  const random = new SeededRandom(input.seed);
  const invalidProposalReasons: Record<string, number> = {};
  const observationVariance = config.observationResidualVarianceKg2;
  const observationScale = Math.sqrt(
    observationVariance * (config.observationDegreesOfFreedom - 2)
      / config.observationDegreesOfFreedom,
  );

  const simulateCandidate = (
    draw: RegimeProposalDraw,
    particleIndex: number,
    invalidReasons: Record<string, number>,
  ): Omit<RecoveryParticle, "normalizedWeight"> | null => {
    let state = cloneState(input.initialState);
    let auxiliaryWeightFilterState: WeightFilterState = {
      ...input.initialState.weightFilterState,
    };
    let logLikelihood = 0;
    let invalidReason: string | null = null;
    for (const builtDay of input.days) {
      const isUnknown = missingPhysiologicalTransitionFields(builtDay.input, input.ecfPolicy).length > 0;
      let day;
      try {
        day = isUnknown
          ? sampleRecoveryDay({ target: builtDay.input, donors, random, config, regime: draw.regime })
          : { ...builtDay.input, measuredWeightKg: null };
        const result = simulateOneDay({
          state,
          parameters: input.parameters,
          day,
          options: { ecfPolicy: input.ecfPolicy },
          personalization: input.personalization,
        });
        if (result.status !== "complete") {
          invalidReason = `incomplete:${result.missingFields.join(",")}`;
          break;
        }
        state = result.endState;
        const measuredWeightKg = builtDay.input.measuredWeightKg;
        const auxiliaryPrediction = predictWeightFilterState({
          state: auxiliaryWeightFilterState,
          predictedWeightKg: result.calculations.predictedPhysiologicalWeightKg,
          elapsedDays: 1,
          processNoiseVarianceKg2PerDay:
            input.parameters.weightFilter.processNoiseVarianceKg2PerDay,
        });
        auxiliaryWeightFilterState = updateWeightFilterWithMeasurement({
          predictedState: auxiliaryPrediction,
          measuredWeightKg: measuredWeightKg ?? null,
          measurementNoiseVarianceKg2:
            input.parameters.weightFilter.measurementNoiseVarianceKg2,
        }).state;
        if (measuredWeightKg !== null && measuredWeightKg !== undefined) {
          logLikelihood += studentTLogDensity({
            observation: measuredWeightKg,
            location: result.calculations.predictedPhysiologicalWeightKg,
            scale: observationScale,
            degreesOfFreedom: config.observationDegreesOfFreedom,
          });
        }
      } catch (error) {
        invalidReason = error instanceof Error ? error.message : "unknown-proposal-error";
        break;
      }
    }
    if (invalidReason !== null || !Number.isFinite(logLikelihood)) {
      const reason = invalidReason ?? "non-finite-log-likelihood";
      invalidReasons[reason] = (invalidReasons[reason] ?? 0) + 1;
      return null;
    }
    return {
      particleIndex,
      logLikelihood,
      bodyWeightKg: reconstructBodyWeightKg(state),
      state: { ...cloneState(state), weightFilterState: { ...auxiliaryWeightFilterState } },
      proposal: {
        component: draw.component,
        logPriorDensity: draw.logPriorDensity,
        logProposalDensity: draw.logProposalDensity,
        logImportanceCorrection: draw.logPriorDensity - draw.logProposalDensity,
        regime: draw.regime,
      },
    };
  };

  const priorDraw = (): RegimeProposalDraw => {
    const regime = samplePriorRecoveryRegime(random, config);
    const density = logPriorRecoveryRegimeDensity(regime, config);
    return {
      regime, component: "prior", logPriorDensity: density, logProposalDensity: density,
    };
  };
  const useAdaptive = config.adaptiveProposalEnabled && observations.length > 0;
  const pilotInvalidReasons: Record<string, number> = {};
  const pilot = useAdaptive
    ? Array.from({ length: config.adaptivePilotParticleCount }, (_, particleIndex) => (
        simulateCandidate(priorDraw(), particleIndex, pilotInvalidReasons)
      )).filter((candidate): candidate is Omit<RecoveryParticle, "normalizedWeight"> => (
        candidate !== null
      ))
    : [];
  if (useAdaptive && pilot.length === 0) {
    throw new Error("All adaptive recovery pilot proposals were physiologically invalid.");
  }
  const adaptive = useAdaptive ? fitAdaptiveRegimeProposal({
    regimes: pilot.map((candidate) => candidate.proposal.regime),
    logLikelihoods: pilot.map((candidate) => candidate.logLikelihood),
    config,
  }) : null;
  const valid = Array.from({ length: config.particleCount }, (_, particleIndex) => {
    const draw = adaptive
      ? sampleDefensiveRegimeMixture({ random, adaptive, config })
      : priorDraw();
    return simulateCandidate(draw, particleIndex, invalidProposalReasons);
  }).filter((candidate): candidate is Omit<RecoveryParticle, "normalizedWeight"> => (
    candidate !== null
  ));
  if (valid.length === 0) {
    throw new Error("All historical recovery proposals were physiologically invalid.");
  }

  const logWeights = valid.map((particle) => logImportanceWeight({
    logLikelihood: particle.logLikelihood,
    logPriorDensity: particle.proposal.logPriorDensity,
    logProposalDensity: particle.proposal.logProposalDensity,
  }));
  const weights = observations.length === 0
    ? valid.map(() => 1 / valid.length)
    : normalizeLogWeights(logWeights).weights;
  const ensemble: RecoveryParticle[] = valid.map((particle, index) => ({
    ...particle,
    normalizedWeight: weights[index],
  }));
  const ess = effectiveSampleSize(weights);
  const normalizedEss = ess / ensemble.length;
  const maximumWeight = Math.max(...weights);
  const validParticleFraction = ensemble.length / config.particleCount;
  const qualityResult = quality({
    observationCount: observations.length,
    normalizedEss,
    maximumWeight,
    validParticleFraction,
    config,
  });
  const pilotWeights = pilot.length > 0
    ? normalizeLogWeights(pilot.map((candidate) => candidate.logLikelihood)).weights
    : [];
  const sortedLogWeights = [...logWeights].sort((left, right) => left - right);
  const logWeightMean = logWeights.reduce((sum, value) => sum + value, 0) / logWeights.length;
  const logWeightStandardDeviation = Math.sqrt(logWeights.reduce((sum, value) => (
    sum + (value - logWeightMean) ** 2
  ), 0) / logWeights.length);
  const topParticleOrigins = [...ensemble]
    .sort((left, right) => right.normalizedWeight - left.normalizedWeight)
    .slice(0, 5)
    .map((particle) => ({
      particleIndex: particle.particleIndex,
      normalizedWeight: particle.normalizedWeight,
      logLikelihood: particle.logLikelihood,
      logImportanceCorrection: particle.proposal.logImportanceCorrection,
      component: particle.proposal.component,
      nutritionMultiplier: particle.proposal.regime.nutritionMultiplier,
      walkingMultiplier: particle.proposal.regime.walkingMultiplier,
      useActivityExploration: particle.proposal.regime.useActivityExploration,
      forceNoOccupationalWork: particle.proposal.regime.forceNoOccupationalWork,
    }));
  const donorNoWorkCount = donors.filter(({ input: donor }) => (
    donor.occupationalActivity.intervals?.length === 0
      || donor.occupationalActivity.durationHours === 0
  )).length;
  const supportWarnings = [
    ...(donorNoWorkCount === 0
      ? ["no-empirical-no-work-donor; structural-no-work-prior-mixture-used"] : []),
    ...(donors.every(({ input: donor }) => (donor.outsideWorkWalkingDistanceKm ?? 0) === 0)
      ? ["no-positive-walking-donor; activity-exploration-prior-used"] : []),
  ];
  return {
    algorithmVersion: RECOVERY_ALGORITHM_VERSION,
    seed: input.seed,
    status: qualityResult.status,
    generatedParticleCount: config.particleCount,
    validParticleCount: ensemble.length,
    invalidParticleCount: config.particleCount - ensemble.length,
    observationCount: observations.length,
    observationDates: observations.map(({ date }) => date),
    effectiveSampleSize: ess,
    normalizedEffectiveSampleSize: normalizedEss,
    maximumWeight,
    posteriorSummary: summarize(ensemble, config),
    ensemble,
    diagnostics: {
      donorDayCount: donors.length,
      unknownDayCount,
      invalidProposalReasons,
      likelihood: observations.length > 0
        ? "student-t-physiological-end-weight"
        : "none-prior-predictive",
      importanceSampling: {
        target: "posterior-over-unknown-histories",
        proposal: adaptive ? "defensive-adaptive-regime-mixture" : "generative-prior",
        priorProposalCorrectionApplied: adaptive !== null,
        logWeightEquation: adaptive
          ? "log_likelihood+log_prior-log_proposal"
          : "log_likelihood",
      },
      pilot: {
        generatedParticleCount: useAdaptive ? config.adaptivePilotParticleCount : 0,
        validParticleCount: pilot.length,
        invalidParticleCount: useAdaptive ? config.adaptivePilotParticleCount - pilot.length : 0,
        normalizedEffectiveSampleSize: pilot.length > 0
          ? effectiveSampleSize(pilotWeights) / pilot.length
          : null,
        maximumWeight: pilotWeights.length > 0 ? Math.max(...pilotWeights) : null,
      },
      logWeightDistribution: {
        minimum: sortedLogWeights[0],
        median: sortedLogWeights[Math.floor(sortedLogWeights.length / 2)],
        maximum: sortedLogWeights.at(-1)!,
        standardDeviation: logWeightStandardDeviation,
      },
      topParticleOrigins,
      downstreamQualityContract: {
        forecastInitialization: qualityResult.status === "degenerate"
          ? "refuse-degenerate"
          : qualityResult.status === "awaiting-observations"
            ? "prior-predictive-only"
            : "allowed-with-quality-label",
        posteriorIntervalsTrustworthy: qualityResult.status !== "degenerate",
      },
      observationResidualVarianceKg2: config.observationResidualVarianceKg2,
      observationResidualVarianceRole: "effective-scale-to-physiology-residual",
      auxiliaryWeightFilterSemantics:
        "separate-observation-replay-after-physiological-inference",
      validParticleFraction,
      qualityReasons: qualityResult.reasons,
      supportWarnings,
      biaUsed: false,
      observationAssimilationInsideSimulator: false,
      resamplingUsed: false,
      ecfPolicyLimitation: input.ecfPolicy === "hold-ecf"
        ? "ECF is held constant; hydration-driven scale changes are not reconstructed."
        : null,
    },
  };
}
