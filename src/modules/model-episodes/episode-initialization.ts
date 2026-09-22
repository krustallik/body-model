import {
  DEFAULT_ADAPTIVE_THERMOGENESIS_BETA,
  DEFAULT_ADAPTIVE_THERMOGENESIS_TIME_CONSTANT_DAYS,
  initializeAdaptiveThermogenesisState,
} from "@/model/adaptive-thermogenesis";
import { calculateAge } from "@/model/age";
import { estimateInitialBodyFatPercent } from "@/model/body-composition/bia-estimate";
import { selectRecentBiaObservations } from "@/model/body-composition/bia-observation-selection";
import { calculateGlycogenAssociatedMassKg, reconstructBodyWeightKg } from "@/model/body-composition/state";
import { estimateInitialExtracellularFluid } from "@/model/body-composition/extracellular-fluid";
import { createGlycogenParameters } from "@/model/body-composition/glycogen";
import { initializeBodyComposition } from "@/model/body-composition/initialization";
import { createDynamicRmrParameters } from "@/model/dynamic-rmr";
import { calculateRmr } from "@/model/rmr";
import { calculateDynamicDailyExpenditure } from "@/model/dynamic-daily-expenditure";
import { calibratePersonalization, type CalibrationDay } from "@/model/personalization-calibration";
import { simulateDays, type PhysiologicalSimulatorState } from "@/model/physiological-simulator";
import { DEFAULT_TIME_ZONE } from "@/model/time-zone";
import {
  DEFAULT_INITIAL_PREDICTION_VARIANCE_KG2,
  DEFAULT_WEIGHT_MEASUREMENT_NOISE_VARIANCE_KG2,
  DEFAULT_WEIGHT_PROCESS_NOISE_VARIANCE_KG2_PER_DAY,
  initializeWeightFilterState,
} from "@/model/weight-observation-filter";
import { EpisodeInitializationError } from "./model-episode.errors";
import type {
  ModelHealthDaySource,
  HistoricalModelSources,
  ModelProfileSource,
  PreparedEpisodeInitialization,
} from "./model-episode.types";
import { CURRENT_MODEL_VERSION } from "./model-version";
import { deriveMaintenanceBaseline, type BaselineDerivationConfig } from "./maintenance-baseline";
import { NUTRITION_GAP_POLICY_DEFAULTS } from "./nutrition-gap-bridge";
import { buildSimulationDays } from "./simulation-input-builder";
import { addCalendarDays, calendarDayIndex } from "./model-calendar";
import {
  deriveEnergyHomeostasisReference,
  detectInitializationRegimeChange,
  detectInternalRegimeChange,
  detectPersistentWaterDisturbance,
  glycogenInitialStateInfluence,
  remainingAdaptiveThermogenesisInfluence,
  summarizeOffsetSensitivity,
} from "./initialization-bootstrap";

type AnchoredBodyState = {
  state: PhysiologicalSimulatorState;
  rmrParameters: ReturnType<typeof createDynamicRmrParameters>;
  rmrKcalPerDay: number;
  biaObservationCount: number;
  biaSpreadPercent: number;
};

/** Builds state from measurements available on or before its own date. */
function buildAnchoredBodyState(input: {
  profile: ModelProfileSource;
  observations: readonly ModelHealthDaySource[];
  referenceDate: string;
  glycogenParameters: ReturnType<typeof createGlycogenParameters>;
}): AnchoredBodyState | null {
  const selected = selectRecentBiaObservations({
    observations: input.observations, referenceDate: input.referenceDate,
  });
  const bodyFat = estimateInitialBodyFatPercent(selected.map(({ bodyFatPercent }) => bodyFatPercent));
  if (selected.length === 0 || !bodyFat) return null;
  const weightKg = median(selected.map(({ weightKg }) => weightKg));
  const composition = initializeBodyComposition({ weightKg, estimatedBodyFatPercent: bodyFat.estimatePercent });
  const ageYears = calculateAge(input.profile.dateOfBirth, input.referenceDate);
  const ecf = estimateInitialExtracellularFluid({ sex: input.profile.sex, ageYears,
    heightCm: input.profile.heightCm, weightKg });
  const leanTissueKg = weightKg - composition.observedFatMassKg - ecf.estimatedExtracellularFluidLiters
    - calculateGlycogenAssociatedMassKg(input.glycogenParameters.initialGlycogenKg);
  if (!Number.isFinite(leanTissueKg) || leanTissueKg <= 0) return null;
  const rmrKcalPerDay = calculateRmr({ sex: input.profile.sex, ageYears,
    heightCm: input.profile.heightCm, weightKg });
  return {
    state: {
      fatMassKg: composition.observedFatMassKg, leanTissueKg,
      glycogenKg: input.glycogenParameters.initialGlycogenKg,
      baselineExtracellularFluidLiters: ecf.estimatedExtracellularFluidLiters,
      extracellularFluidDeviationLiters: 0,
      ...initializeAdaptiveThermogenesisState(),
      weightFilterState: initializeWeightFilterState({ measuredWeightKg: weightKg,
        measurementNoiseVarianceKg2: DEFAULT_WEIGHT_MEASUREMENT_NOISE_VARIANCE_KG2,
        initialPredictionVarianceKg2: DEFAULT_INITIAL_PREDICTION_VARIANCE_KG2 }),
    },
    rmrParameters: createDynamicRmrParameters({ initialRmrKcalPerDay: rmrKcalPerDay,
      initialFatMassKg: composition.observedFatMassKg, initialLeanTissueKg: leanTissueKg }),
    rmrKcalPerDay, biaObservationCount: bodyFat.observationCount,
    biaSpreadPercent: bodyFat.spreadPercent,
  };
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Prepares frozen episode assumptions using only pure model primitives. */
export function prepareEpisodeInitialization(input: {
  profile: ModelProfileSource | null;
  days: readonly ModelHealthDaySource[];
  sources?: HistoricalModelSources;
  startDate: string;
  timezone?: string;
  baselineConfig?: BaselineDerivationConfig;
}): PreparedEpisodeInitialization {
  if (!input.profile) throw new EpisodeInitializationError("profile-missing");
  if (!input.baselineConfig && input.sources) {
    const candidates = [28, 42, 56, 70, 84].flatMap((windowDays) => {
      try {
        const prepared = prepareEpisodeInitialization({ ...input, baselineConfig: {
          windowDays, lookbackDays: 90,
          minimumCompleteNutritionDays: Math.ceil(windowDays * 0.75),
          minimumWeightObservations: Math.ceil(windowDays * 0.5),
          minimumWeightSpanDays: Math.ceil(windowDays * 0.75),
          maximumAbsoluteWeightTrendPercentPerWeek: 0.25,
        } });
        const diagnostics = prepared.initializationDiagnostics as {
          calibration?: { validationNis?: number | null; observationCount?: number };
          offsetSensitivity?: { spreadKcalPerDay?: number };
          internalRegime?: { detected?: boolean };
          regime?: { classification?: string; carbChanged?: boolean };
          persistentWater?: { preFit?: { detected?: boolean }; postFit?: { detected?: boolean } };
        };
        const confidenceScore = prepared.initializationStatus === "strong" ? 3
          : prepared.initializationStatus === "weak" ? 2 : 1;
        const externalRegimeChange = diagnostics.regime?.classification !== "none"
          || diagnostics.regime?.carbChanged === true;
        return [{ prepared, diagnostics, rank: [
          diagnostics.internalRegime?.detected ? 0 : 1,
          diagnostics.persistentWater?.preFit?.detected || diagnostics.persistentWater?.postFit?.detected ? 0 : 1,
          externalRegimeChange ? -windowDays : 0,
          confidenceScore,
          -(diagnostics.offsetSensitivity?.spreadKcalPerDay ?? 1_000_000_000),
          -(diagnostics.calibration?.validationNis ?? 1_000_000_000),
          diagnostics.calibration?.observationCount ?? 0,
          prepared.baseline.diagnostics.windowEndDate === input.startDate ? 1 : 0,
          -windowDays,
        ] }];
      } catch { return []; }
    });
    if (candidates.length === 0) throw new EpisodeInitializationError("insufficient-baseline-data");
    candidates.sort((left, right) => {
      for (let index = 0; index < left.rank.length; index += 1) {
        if (left.rank[index] !== right.rank[index]) return right.rank[index] - left.rank[index];
      }
      return 0;
    });
    const selected = candidates[0].prepared;
    return { ...selected, initializationDiagnostics: {
      ...(selected.initializationDiagnostics as Record<string, unknown>),
      candidateSelection: {
        selectedFittingDays: selected.baseline.diagnostics.windowDays,
        candidates: candidates.map(({ prepared, rank, diagnostics }) => ({
          fittingDays: prepared.baseline.diagnostics.windowDays,
          windowStartDate: prepared.baseline.diagnostics.windowStartDate,
          windowEndDate: prepared.baseline.diagnostics.windowEndDate,
          confidence: prepared.initializationStatus,
          sensitivitySpreadKcalPerDay: diagnostics.offsetSensitivity?.spreadKcalPerDay ?? null,
          validationNis: diagnostics.calibration?.validationNis ?? null,
          internalRegimeContamination: diagnostics.internalRegime?.detected ?? false,
          preRollToFittingRegimeChange: diagnostics.regime?.classification !== "none"
            || diagnostics.regime?.carbChanged === true,
          rank,
        })),
      },
    } };
  }
  const baseline = deriveMaintenanceBaseline({
    days: input.days,
    referenceDate: input.startDate,
    config: input.baselineConfig,
  });
  if (!baseline) throw new EpisodeInitializationError("insufficient-baseline-data");

  const selectedBia = selectRecentBiaObservations({
    observations: input.days,
    referenceDate: input.startDate,
  });
  const bodyFat = estimateInitialBodyFatPercent(
    selectedBia.map(({ bodyFatPercent }) => bodyFatPercent),
  );
  if (selectedBia.length === 0 || !bodyFat) {
    throw new EpisodeInitializationError("insufficient-weight-bia");
  }

  try {
    const initialWeightKg = median(selectedBia.map(({ weightKg }) => weightKg));
    const observedComposition = initializeBodyComposition({
      weightKg: initialWeightKg,
      estimatedBodyFatPercent: bodyFat.estimatePercent,
    });
    const ageYears = calculateAge(input.profile.dateOfBirth, input.startDate);
    const baselineEcf = estimateInitialExtracellularFluid({
      sex: input.profile.sex,
      ageYears,
      heightCm: input.profile.heightCm,
      weightKg: initialWeightKg,
    });
    let glycogenReferenceCarbIntakeG = baseline.baselineCarbIntakeG;
    let glycogenParameters = createGlycogenParameters({
      baselineCarbIntakeG: baseline.baselineCarbIntakeG,
    });
    const initialLeanTissueKg = initialWeightKg
      - observedComposition.observedFatMassKg
      - baselineEcf.estimatedExtracellularFluidLiters
      - calculateGlycogenAssociatedMassKg(glycogenParameters.initialGlycogenKg);
    if (!Number.isFinite(initialLeanTissueKg) || initialLeanTissueKg <= 0) {
      throw new RangeError("initial decomposition cannot produce positive lean tissue");
    }
    const initialRmrKcalPerDay = calculateRmr({
      sex: input.profile.sex,
      ageYears,
      heightCm: input.profile.heightCm,
      weightKg: initialWeightKg,
    });
    const rmrParameters = createDynamicRmrParameters({
      initialRmrKcalPerDay,
      initialFatMassKg: observedComposition.observedFatMassKg,
      initialLeanTissueKg,
    });
    const weightFilterState = initializeWeightFilterState({
      measuredWeightKg: initialWeightKg,
      measurementNoiseVarianceKg2: DEFAULT_WEIGHT_MEASUREMENT_NOISE_VARIANCE_KG2,
      initialPredictionVarianceKg2: DEFAULT_INITIAL_PREDICTION_VARIANCE_KG2,
    });
    const initialState: PhysiologicalSimulatorState = {
      fatMassKg: observedComposition.observedFatMassKg,
      leanTissueKg: initialLeanTissueKg,
      glycogenKg: glycogenParameters.initialGlycogenKg,
      baselineExtracellularFluidLiters: baselineEcf.estimatedExtracellularFluidLiters,
      extracellularFluidDeviationLiters: 0,
      ...initializeAdaptiveThermogenesisState(),
      weightFilterState,
    };
    let initialPersonalOffsetKcalPerDay = 0;
    let initializationStatus: "strong" | "weak" | "insufficient" = "insufficient";
    let initializationDiagnostics: Record<string, unknown> = {
      reason: "historical-sources-unavailable",
    };
    let appliedPersonalOffsetKcalPerDay = 0;
    let initializationApplicationReason: NonNullable<PreparedEpisodeInitialization["initializationApplicationReason"]>
      = "insufficient-not-applied";
    let energyHomeostasisReferenceKcalPerDay = baseline.baselineEnergyIntakeKcalPerDay;

    if (input.sources) {
      const requestedPreRollStart = addCalendarDays(baseline.diagnostics.windowStartDate, -42);
      const earliestSourceDate = [...input.sources.days]
        .sort((left, right) => left.date.localeCompare(right.date))[0]?.date;
      const preRollStart = earliestSourceDate && earliestSourceDate > requestedPreRollStart
        ? earliestSourceDate : requestedPreRollStart;
      const built = buildSimulationDays({
        from: preRollStart,
        to: baseline.diagnostics.windowEndDate,
        sources: input.sources,
        baselineNutritionFallback: null,
        nutritionGapPolicy: { maxBridgeDays: 0 },
        modelVersion: CURRENT_MODEL_VERSION,
      });
      // Calibration starts after the pre-roll. Its state must be anchored at
      // the beginning of this historical interval, never at episode start.
      const preRollDays = Math.max(0, calendarDayIndex(baseline.diagnostics.windowStartDate)
        - calendarDayIndex(preRollStart));
      const preRoll = built.slice(0, preRollDays);
      const fitting = built.slice(preRollDays);
      const historicalAnchor = buildAnchoredBodyState({
        profile: input.profile,
        observations: input.sources.days,
        referenceDate: preRollStart,
        glycogenParameters,
      });
      if (!historicalAnchor) {
        initializationDiagnostics = {
          reason: "historical-body-state-anchor-unavailable",
          anchorDate: preRollStart,
          precedence: ["nearby-historical-weight-and-bia", "pre-roll-state", "existing-compartment-estimates", "fallback-insufficient"],
        };
      } else {
      const activityByDay = built.map(({ input: day }) => {
        try {
          const result = calculateDynamicDailyExpenditure({
            bodyComposition: historicalAnchor.state,
            rmrParameters: historicalAnchor.rmrParameters,
            macros: day,
            outsideWorkWalking: {
              distanceKm: day.outsideWorkWalkingDistanceKm,
              averageSpeedKmh: day.averageWalkingSpeedKmh,
            },
            strength: { durationMinutes: day.strengthTrainingMinutes },
            workoutActivity: day.workoutActivity,
            occupational: day.occupationalActivity,
            adaptiveThermogenesisKcalPerDay: 0,
          });
          return result.activityKcalPerDay;
        } catch { return null; }
      });
      const activityValues = activityByDay.filter((value): value is number => value !== null);
      const preRollActivity = activityByDay.slice(0, preRoll.length)
        .filter((value): value is number => value !== null);
      const fittingActivity = activityByDay.slice(preRoll.length)
        .filter((value): value is number => value !== null);
      const regime = detectInitializationRegimeChange({
        beforeNutritionKcal: preRoll.flatMap(({ input: day }) => day.caloriesKcal === null || day.caloriesKcal === undefined ? [] : [day.caloriesKcal]),
        afterNutritionKcal: fitting.flatMap(({ input: day }) => day.caloriesKcal === null || day.caloriesKcal === undefined ? [] : [day.caloriesKcal]),
        beforeActivityKcal: preRollActivity, afterActivityKcal: fittingActivity,
        beforeCarbsG: preRoll.flatMap(({ input: day }) => day.carbsG === null || day.carbsG === undefined ? [] : [day.carbsG]),
        afterCarbsG: fitting.flatMap(({ input: day }) => day.carbsG === null || day.carbsG === undefined ? [] : [day.carbsG]),
      });
      const referenceActivityKcalPerDay = regime.classification === "simultaneous"
        && preRollActivity.length >= 7 ? median(preRollActivity)
        : activityValues.length === 0 ? null : median(activityValues);
      if (referenceActivityKcalPerDay !== null) {
        const internalRegime = detectInternalRegimeChange({
          nutritionKcal: fitting.flatMap(({ input: day }) => day.caloriesKcal == null ? [] : [day.caloriesKcal]),
          activityKcal: fittingActivity,
          carbsG: fitting.flatMap(({ input: day }) => day.carbsG == null ? [] : [day.carbsG]),
        });
        const preRollCarbs = preRoll.flatMap(({ input: day }) => (
          day.carbsG !== null && day.carbsG !== undefined && day.carbsG > 0 ? [day.carbsG] : []
        ));
        if (preRollCarbs.length === preRoll.length && preRollCarbs.length > 0) {
          glycogenReferenceCarbIntakeG = median(preRollCarbs);
          glycogenParameters = createGlycogenParameters({
            baselineCarbIntakeG: glycogenReferenceCarbIntakeG,
          });
        }
        const ci0Supported = preRollCarbs.length === preRoll.length && preRollCarbs.length > 0;
        const reference = deriveEnergyHomeostasisReference({
          rmrKcalPerDay: historicalAnchor.rmrKcalPerDay,
          referenceActivityKcalPerDay,
          personalOffsetKcalPerDay: 0,
          observedReferenceNutrition: baseline.fallbackNutrition,
        });
        energyHomeostasisReferenceKcalPerDay = reference.energyKcalPerDay;
        const baseParameters = {
          rmrParameters,
          glycogenParameters,
          baselineEnergyIntakeKcalPerDay: reference.energyKcalPerDay,
          adaptiveThermogenesis: {
            beta: DEFAULT_ADAPTIVE_THERMOGENESIS_BETA,
            timeConstantDays: DEFAULT_ADAPTIVE_THERMOGENESIS_TIME_CONSTANT_DAYS,
          },
          weightFilter: {
            processNoiseVarianceKg2PerDay: DEFAULT_WEIGHT_PROCESS_NOISE_VARIANCE_KG2_PER_DAY,
            measurementNoiseVarianceKg2: DEFAULT_WEIGHT_MEASUREMENT_NOISE_VARIANCE_KG2,
          },
        };
        const calibrationDays: CalibrationDay[] = fitting.map(({ input: day }) => ({
          date: day.date,
          measuredWeightKg: day.measuredWeightKg ?? null,
          simulatorInput: { ...day, date: undefined, measuredWeightKg: undefined } as never,
        }));
        const calibration = calibratePersonalization({
          initialState: historicalAnchor.state,
          simulatorParameters: baseParameters,
          history: calibrationDays,
          ecfPolicy: "hold-ecf",
          fitMode: "offset-only",
          prepareCandidateContext: (candidate, context) => {
            const candidateReference = deriveEnergyHomeostasisReference({
              rmrKcalPerDay: historicalAnchor.rmrKcalPerDay,
              referenceActivityKcalPerDay,
              personalOffsetKcalPerDay: candidate.personalOffsetKcalPerDay,
              observedReferenceNutrition: baseline.fallbackNutrition,
            });
            const parameters = {
              ...context.simulatorParameters,
              baselineEnergyIntakeKcalPerDay: candidateReference.energyKcalPerDay,
            };
            if (preRoll.length === 0) return { initialState: context.initialState, simulatorParameters: parameters };
            const warmed = simulateDays({
              initialState: context.initialState,
              parameters,
              days: preRoll.map(({ input: day }) => day),
              options: { ecfPolicy: "hold-ecf" },
              personalization: candidate,
            });
            const final = warmed.at(-1);
            return {
              initialState: final?.status === "complete" ? final.endState : context.initialState,
              simulatorParameters: parameters,
            };
          },
        });
        const runSensitivity = (id: string, overrides: {
          positiveBeta?: number;
          initialAdaptiveThermogenesisKcalPerDay?: number;
          initialGlycogenKg?: number;
          referenceActivityKcalPerDay?: number;
          glycogenReferenceCarbIntakeG?: number;
        }): { id: string; offsetKcalPerDay: number | null } => {
          const scenarioActivityReference = overrides.referenceActivityKcalPerDay
            ?? referenceActivityKcalPerDay;
          const scenarioGlycogenParameters = overrides.glycogenReferenceCarbIntakeG === undefined
            ? glycogenParameters : createGlycogenParameters({
              baselineCarbIntakeG: overrides.glycogenReferenceCarbIntakeG,
            });
          const scenarioState: PhysiologicalSimulatorState = {
            ...historicalAnchor.state,
            adaptiveThermogenesisKcalPerDay:
              overrides.initialAdaptiveThermogenesisKcalPerDay
              ?? historicalAnchor.state.adaptiveThermogenesisKcalPerDay,
            glycogenKg: overrides.initialGlycogenKg ?? historicalAnchor.state.glycogenKg,
            leanTissueKg: historicalAnchor.state.leanTissueKg,
            weightFilterState: { ...historicalAnchor.state.weightFilterState },
          };
          if (overrides.initialGlycogenKg !== undefined) {
            scenarioState.weightFilterState.estimatedWeightKg = reconstructBodyWeightKg(scenarioState);
          }
          const scenario = calibratePersonalization({
            initialState: scenarioState,
            simulatorParameters: { ...baseParameters, glycogenParameters: scenarioGlycogenParameters,
              adaptiveThermogenesis: {
              ...baseParameters.adaptiveThermogenesis, positiveBeta: overrides.positiveBeta,
            } },
            history: calibrationDays, ecfPolicy: "hold-ecf", fitMode: "offset-only",
            prepareCandidateContext: (candidate, context) => {
              const candidateReference = deriveEnergyHomeostasisReference({
                rmrKcalPerDay: historicalAnchor.rmrKcalPerDay,
                referenceActivityKcalPerDay: scenarioActivityReference,
                personalOffsetKcalPerDay: candidate.personalOffsetKcalPerDay,
                observedReferenceNutrition: baseline.fallbackNutrition,
              });
              const parameters = { ...context.simulatorParameters,
                baselineEnergyIntakeKcalPerDay: candidateReference.energyKcalPerDay };
              const warmed = preRoll.length === 0 ? [] : simulateDays({
                initialState: context.initialState, parameters,
                days: preRoll.map(({ input: day }) => day), options: { ecfPolicy: "hold-ecf" },
                personalization: candidate,
              });
              const end = warmed.at(-1);
              return { initialState: end?.status === "complete" ? end.endState : context.initialState,
                simulatorParameters: parameters };
            },
          });
          return { id, offsetKcalPerDay: scenario.status === "offset-only"
            || scenario.status === "defaults-retained"
            ? scenario.parameters.personalOffsetKcalPerDay : null };
        };
        const preRollEnergy = preRoll.flatMap(({ input: day }) => day.caloriesKcal === null
          || day.caloriesKcal === undefined ? [] : [day.caloriesKcal]);
        const observedInitialAt = preRollEnergy.length === 0 ? 0
          : DEFAULT_ADAPTIVE_THERMOGENESIS_BETA
            * (median(preRollEnergy) - reference.energyKcalPerDay);
        const alternatives = [
          runSensitivity("at-initial-observed-regime-equilibrium", {
            initialAdaptiveThermogenesisKcalPerDay: observedInitialAt,
          }),
          runSensitivity("glycogen-initial-low", { initialGlycogenKg: 0.2 }),
          runSensitivity("glycogen-initial-high", { initialGlycogenKg: 0.8 }),
        ];
        if (regime.classification === "simultaneous" && fittingActivity.length >= 7) {
          alternatives.push(runSensitivity("activity-reference-post-change", {
            referenceActivityKcalPerDay: median(fittingActivity),
          }));
        }
        if (!ci0Supported) {
          const observedFittingCarbs = fitting.flatMap(({ input: day }) => day.carbsG == null
            || day.carbsG <= 0 ? [] : [day.carbsG]);
          if (observedFittingCarbs.length >= 14) {
            const half = Math.floor(observedFittingCarbs.length / 2);
            alternatives.push(
              runSensitivity("ci0-observed-early-regime", {
                glycogenReferenceCarbIntakeG: median(observedFittingCarbs.slice(0, half)),
              }),
              runSensitivity("ci0-observed-late-regime", {
                glycogenReferenceCarbIntakeG: median(observedFittingCarbs.slice(half)),
              }),
            );
          } else {
            alternatives.push({ id: "ci0-unidentified", offsetKcalPerDay: null });
          }
        }
        if (baseline.diagnostics.weightTrendDirection === "gain") {
          alternatives.push(
            runSensitivity("surplus-at-beta-0.07", { positiveBeta: 0.07 }),
            runSensitivity("surplus-at-beta-0", { positiveBeta: 0 }),
          );
        }
        const sensitivity = summarizeOffsetSensitivity(
          calibration.status === "offset-only" ? calibration.parameters.personalOffsetKcalPerDay : 0,
          alternatives,
        );
        const componentSensitivity = Object.fromEntries([
          ["atInitialState", alternatives.filter(({ id }) => id.startsWith("at-initial"))],
          ["glycogenInitialState", alternatives.filter(({ id }) => id.startsWith("glycogen-initial"))],
          ["ci0", alternatives.filter(({ id }) => id.startsWith("ci0-"))],
          ["activityReference", alternatives.filter(({ id }) => id.startsWith("activity-reference"))],
          ["surplusBeta", alternatives.filter(({ id }) => id.startsWith("surplus-at"))],
        ].map(([component, scenarios]) => {
          const values = (scenarios as typeof alternatives).flatMap(({ offsetKcalPerDay }) =>
            offsetKcalPerDay === null ? [] : [offsetKcalPerDay]);
          const base = calibration.status === "offset-only"
            ? calibration.parameters.personalOffsetKcalPerDay : 0;
          return [component, { scenarios, spreadKcalPerDay: values.length === 0 ? null
            : Math.max(base, ...values) - Math.min(base, ...values) }];
        }));
        const defaultWarmed = simulateDays({ initialState: historicalAnchor.state,
          parameters: baseParameters, days: preRoll.map(({ input: day }) => day),
          options: { ecfPolicy: "hold-ecf" },
          personalization: { personalOffsetKcalPerDay: 0, activityCalibration: 1 } });
        const defaultWarmEnd = defaultWarmed.at(-1);
        const defaultFittingStart = defaultWarmEnd?.status === "complete"
          ? defaultWarmEnd.endState : historicalAnchor.state;
        const defaultPredicted = simulateDays({ initialState: defaultFittingStart,
          parameters: baseParameters, days: fitting.map(({ input: day }) => day),
          options: { ecfPolicy: "hold-ecf" },
          personalization: { personalOffsetKcalPerDay: 0, activityCalibration: 1 } })
          .map((day) => day.status === "complete"
            ? day.calculations.predictedPhysiologicalWeightKg : null);
        const preFitWater = detectPersistentWaterDisturbance({
          measuredWeightKg: [...preRoll, ...fitting].map(({ input: day }) => day.measuredWeightKg),
          predictedWeightKg: [
            ...defaultWarmed.map((day) => day.status === "complete"
              ? day.calculations.predictedPhysiologicalWeightKg : null),
            ...defaultPredicted,
          ],
        });
        let basePredicted: Array<number | null> = fitting.map(() => null);
        if (calibration.status === "offset-only") {
          const acceptedReference = deriveEnergyHomeostasisReference({
            rmrKcalPerDay: historicalAnchor.rmrKcalPerDay, referenceActivityKcalPerDay,
            personalOffsetKcalPerDay: calibration.parameters.personalOffsetKcalPerDay,
            observedReferenceNutrition: baseline.fallbackNutrition,
          });
          const acceptedParameters = { ...baseParameters,
            baselineEnergyIntakeKcalPerDay: acceptedReference.energyKcalPerDay };
          const warmed = simulateDays({ initialState: historicalAnchor.state,
            parameters: acceptedParameters, days: preRoll.map(({ input: day }) => day),
            options: { ecfPolicy: "hold-ecf" }, personalization: calibration.parameters });
          const warmEnd = warmed.at(-1);
          const fittingStart = warmEnd?.status === "complete" ? warmEnd.endState : historicalAnchor.state;
          basePredicted = simulateDays({ initialState: fittingStart, parameters: acceptedParameters,
            days: fitting.map(({ input: day }) => day), options: { ecfPolicy: "hold-ecf" },
            personalization: calibration.parameters }).map((day) => day.status === "complete"
              ? day.calculations.predictedPhysiologicalWeightKg : null);
        }
        const postFitWater = detectPersistentWaterDisturbance({
          measuredWeightKg: fitting.map(({ input: day }) => day.measuredWeightKg),
          predictedWeightKg: basePredicted,
        });
        if (calibration.status === "offset-only") {
          initialPersonalOffsetKcalPerDay = calibration.parameters.personalOffsetKcalPerDay;
          energyHomeostasisReferenceKcalPerDay = deriveEnergyHomeostasisReference({
            rmrKcalPerDay: historicalAnchor.rmrKcalPerDay,
            referenceActivityKcalPerDay,
            personalOffsetKcalPerDay: initialPersonalOffsetKcalPerDay,
            observedReferenceNutrition: baseline.fallbackNutrition,
          }).energyKcalPerDay;
        }
        const glycogenInfluence = glycogenInitialStateInfluence({
          parameters: glycogenParameters,
          carbsG: preRoll.flatMap(({ input: day }) => (
            day.carbsG === null || day.carbsG === undefined ? [] : [day.carbsG]
          )),
        });
        const atInfluence = remainingAdaptiveThermogenesisInfluence(
          preRoll.length, DEFAULT_ADAPTIVE_THERMOGENESIS_TIME_CONSTANT_DAYS,
        );
        const validatedDefault = calibration.status === "defaults-retained"
          && calibration.diagnostics.observationCount >= 20
          && calibration.diagnostics.observationSpanDays >= 28
          && calibration.diagnostics.defaultValidationNis !== null
          && calibration.diagnostics.defaultValidationNis <= 1.5;
        const hasSupportedEstimate = calibration.status === "offset-only" || validatedDefault;
        const hasExtremeScaleOutlier = calibration.diagnostics.minimumObservationWeight !== null
          && calibration.diagnostics.minimumObservationWeight < 0.1;
        initializationStatus = !hasSupportedEstimate || sensitivity.confidenceCap === "insufficient" || preFitWater.detected || postFitWater.detected
          || (!ci0Supported && regime.carbChanged)
          ? "insufficient"
          : sensitivity.confidenceCap === "weak" || !glycogenInfluence.converged || atInfluence >= 0.15
              || internalRegime.detected || regime.classification !== "none" || regime.carbChanged
              || hasExtremeScaleOutlier
            ? "weak" : "strong";
        initializationDiagnostics = {
          calibration: calibration.diagnostics,
          preRollDays: preRoll.length,
          fittingDays: fitting.length,
          referenceActivityKcalPerDay,
          bodyStateAnchorDate: preRollStart,
          fittingInterval: { startDate: baseline.diagnostics.windowStartDate,
            endDate: baseline.diagnostics.windowEndDate, days: fitting.length },
          preRollInterval: { startDate: preRollStart,
            endDate: preRoll.at(-1)?.input.date ?? null, days: preRoll.length },
          bodyStateAnchorBiaObservationCount: historicalAnchor.biaObservationCount,
          atInitialStateInfluence: atInfluence,
          glycogenInitialStateInfluenceKg: glycogenInfluence.associatedMassDifferenceKg,
          offsetSensitivity: {
            baseOffsetKcalPerDay: calibration.status === "offset-only"
              ? calibration.parameters.personalOffsetKcalPerDay : 0,
            alternatives, ...sensitivity,
            components: componentSensitivity,
          },
          regime,
          internalRegime,
          ci0: ci0Supported ? { status: "supported-pre-transition", referenceCarbsG: glycogenReferenceCarbIntakeG }
            : regime.carbChanged ? { status: "unidentified-transition", reason: "no-reliable-pre-transition-carb-history" }
              : { status: "stable-regime-sensitivity-only", referenceCarbsG: glycogenReferenceCarbIntakeG },
          evidenceOutcome: validatedDefault ? "validated-default" : calibration.status,
          extremeScaleOutlier: hasExtremeScaleOutlier,
          persistentWater: { preFit: preFitWater, postFit: postFitWater },
        };
        appliedPersonalOffsetKcalPerDay = initializationStatus === "strong"
          ? initialPersonalOffsetKcalPerDay : 0;
        initializationApplicationReason = validatedDefault && initialPersonalOffsetKcalPerDay === 0
          ? "validated-default-zero"
          : initializationStatus === "strong" ? "strong-estimate-applied"
            : initializationStatus === "weak" ? "weak-estimate-not-applied"
              : "insufficient-not-applied";
        initializationDiagnostics = {
          ...initializationDiagnostics,
          application: { estimatedOffsetKcalPerDay: initialPersonalOffsetKcalPerDay,
            estimatedConfidence: initializationStatus,
            appliedOffsetKcalPerDay: appliedPersonalOffsetKcalPerDay,
            reason: initializationApplicationReason },
        };
      }
      }
    }

    return {
      profileId: input.profile.id,
      startDate: input.startDate,
      timezone: input.timezone ?? DEFAULT_TIME_ZONE,
      modelVersion: CURRENT_MODEL_VERSION,
      ecfPolicy: "hold-ecf",
      baseline,
      initialState,
      simulatorParameters: {
        rmrParameters,
        glycogenParameters,
        baselineEnergyIntakeKcalPerDay: energyHomeostasisReferenceKcalPerDay,
        adaptiveThermogenesis: {
          beta: DEFAULT_ADAPTIVE_THERMOGENESIS_BETA,
          timeConstantDays: DEFAULT_ADAPTIVE_THERMOGENESIS_TIME_CONSTANT_DAYS,
        },
        weightFilter: {
          processNoiseVarianceKg2PerDay:
            DEFAULT_WEIGHT_PROCESS_NOISE_VARIANCE_KG2_PER_DAY,
          measurementNoiseVarianceKg2:
            DEFAULT_WEIGHT_MEASUREMENT_NOISE_VARIANCE_KG2,
        },
      },
      initialRmrKcalPerDay,
      bodyFatObservationCount: bodyFat.observationCount,
      bodyFatSpreadPercent: bodyFat.spreadPercent,
      nutritionMaxBridgeDays: NUTRITION_GAP_POLICY_DEFAULTS.maxBridgeDays,
      observedReferenceNutrition: baseline.fallbackNutrition,
      energyHomeostasisReferenceKcalPerDay,
      glycogenReferenceCarbIntakeG,
      initialPersonalOffsetKcalPerDay,
      appliedPersonalOffsetKcalPerDay,
      initializationApplicationReason,
      initializationStatus,
      initializationDiagnostics,
    };
  } catch (error) {
    if (error instanceof EpisodeInitializationError) throw error;
    throw new EpisodeInitializationError("invalid-initial-state");
  }
}

/**
 * Explicit low-history initialization used by the UI bootstrap action.
 *
 * This keeps raw health rows untouched and stores the fallback nutrition/body
 * composition only as auditable episode assumptions. The resulting episode is
 * deliberately marked `insufficient`, so it can power the full surface while
 * clearly communicating that it has not been personalized yet.
 */
export function prepareBootstrapEpisodeInitialization(input: {
  profile: ModelProfileSource | null;
  days: readonly ModelHealthDaySource[];
  sources?: HistoricalModelSources;
  startDate: string;
  timezone?: string;
}): PreparedEpisodeInitialization {
  if (!input.profile) throw new EpisodeInitializationError("profile-missing");
  const weightedDays = input.days
    .filter((day) => day.weightKg !== null && Number.isFinite(day.weightKg) && day.weightKg > 0)
    .sort((left, right) => left.date.localeCompare(right.date));
  const anchor = weightedDays.at(-1);
  if (!anchor?.weightKg) throw new EpisodeInitializationError("insufficient-baseline-data");

  const nutritionDonor = [...input.days].reverse().find((day) => (
    [day.caloriesKcal, day.proteinG, day.fatG, day.carbsG]
      .every((value) => typeof value === "number" && Number.isFinite(value) && value > 0)
  ));
  const fallbackNutrition = nutritionDonor
    ? {
        caloriesKcal: nutritionDonor.caloriesKcal!,
        proteinG: nutritionDonor.proteinG!,
        fatG: nutritionDonor.fatG!,
        carbsG: nutritionDonor.carbsG!,
      }
    : {
        caloriesKcal: Math.max(1_600, Math.round(anchor.weightKg * 28)),
        proteinG: Math.max(40, Math.round(anchor.weightKg * 1.6)),
        fatG: Math.max(30, Math.round(anchor.weightKg * 0.8)),
        carbsG: Math.max(50, Math.round((Math.max(1_600, Math.round(anchor.weightKg * 28))
          - Math.max(40, Math.round(anchor.weightKg * 1.6)) * 4
          - Math.max(30, Math.round(anchor.weightKg * 0.8)) * 9) / 4)),
      };
  const fallbackBodyFat = input.profile.sex === "female" ? 32 : 25;
  const bootstrapDays = input.days.map((day) => {
    const hasWeight = day.weightKg !== null && Number.isFinite(day.weightKg) && day.weightKg > 0;
    return {
      ...day,
      bodyFatPercent: hasWeight
        ? day.bodyFatPercent !== null && day.bodyFatPercent !== undefined
          && Number.isFinite(day.bodyFatPercent) && day.bodyFatPercent >= 0 && day.bodyFatPercent <= 100
          ? day.bodyFatPercent : fallbackBodyFat
        : day.bodyFatPercent,
      caloriesKcal: day.caloriesKcal !== null && day.caloriesKcal !== undefined && day.caloriesKcal > 0
        ? day.caloriesKcal : fallbackNutrition.caloriesKcal,
      proteinG: day.proteinG !== null && day.proteinG !== undefined && day.proteinG > 0
        ? day.proteinG : fallbackNutrition.proteinG,
      fatG: day.fatG !== null && day.fatG !== undefined && day.fatG > 0
        ? day.fatG : fallbackNutrition.fatG,
      carbsG: day.carbsG !== null && day.carbsG !== undefined && day.carbsG > 0
        ? day.carbsG : fallbackNutrition.carbsG,
    };
  });
  const startDate = input.startDate > anchor.date ? anchor.date : input.startDate;
  const prepared = prepareEpisodeInitialization({
    ...input,
    days: bootstrapDays,
    startDate,
    baselineConfig: {
      windowDays: 1,
      lookbackDays: 90,
      minimumCompleteNutritionDays: 1,
      minimumWeightObservations: 1,
      minimumWeightSpanDays: 1,
      maximumAbsoluteWeightTrendPercentPerWeek: 0.25,
    },
  });
  const actualBodyFatObservations = input.days.filter((day) => (
    day.weightKg !== null && day.weightKg !== undefined && day.weightKg > 0
    && day.bodyFatPercent !== null && day.bodyFatPercent !== undefined
    && Number.isFinite(day.bodyFatPercent) && day.bodyFatPercent >= 0 && day.bodyFatPercent <= 100
  )).length;
  return {
    ...prepared,
    bodyFatObservationCount: actualBodyFatObservations,
    bodyFatSpreadPercent: actualBodyFatObservations > 1 ? prepared.bodyFatSpreadPercent : 0,
    initializationStatus: "insufficient",
    initializationApplicationReason: "insufficient-not-applied",
    initialPersonalOffsetKcalPerDay: 0,
    appliedPersonalOffsetKcalPerDay: 0,
    initializationDiagnostics: {
      ...(prepared.initializationDiagnostics && typeof prepared.initializationDiagnostics === "object"
        ? prepared.initializationDiagnostics : {}),
      bootstrap: {
        mode: "insufficient-history",
        fallbackBodyFatPercent: actualBodyFatObservations === 0 ? fallbackBodyFat : null,
        fallbackNutrition,
        actualBodyFatObservationCount: actualBodyFatObservations,
      },
    },
  };
}
