import {
  DEFAULT_ADAPTIVE_THERMOGENESIS_BETA,
  DEFAULT_ADAPTIVE_THERMOGENESIS_TIME_CONSTANT_DAYS,
  initializeAdaptiveThermogenesisState,
} from "@/model/adaptive-thermogenesis";
import { calculateAge } from "@/model/age";
import { estimateInitialBodyFatPercent } from "@/model/body-composition/bia-estimate";
import { selectRecentBiaObservations } from "@/model/body-composition/bia-observation-selection";
import { calculateGlycogenAssociatedMassKg } from "@/model/body-composition/state";
import { estimateInitialExtracellularFluid } from "@/model/body-composition/extracellular-fluid";
import { createGlycogenParameters } from "@/model/body-composition/glycogen";
import { initializeBodyComposition } from "@/model/body-composition/initialization";
import { createDynamicRmrParameters } from "@/model/dynamic-rmr";
import { calculateRmr } from "@/model/rmr";
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
  ModelProfileSource,
  PreparedEpisodeInitialization,
} from "./model-episode.types";
import { CURRENT_MODEL_VERSION } from "./model-version";
import { deriveMaintenanceBaseline, type BaselineDerivationConfig } from "./maintenance-baseline";
import { NUTRITION_GAP_POLICY_DEFAULTS } from "./nutrition-gap-bridge";

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
  startDate: string;
  timezone?: string;
  baselineConfig?: BaselineDerivationConfig;
}): PreparedEpisodeInitialization {
  if (!input.profile) throw new EpisodeInitializationError("profile-missing");
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
    const glycogenParameters = createGlycogenParameters({
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

    return {
      profileId: input.profile.id,
      startDate: input.startDate,
      timezone: input.timezone ?? DEFAULT_TIME_ZONE,
      modelVersion: CURRENT_MODEL_VERSION,
      ecfPolicy: "hold-ecf",
      baseline,
      initialState: {
        fatMassKg: observedComposition.observedFatMassKg,
        leanTissueKg: initialLeanTissueKg,
        glycogenKg: glycogenParameters.initialGlycogenKg,
        baselineExtracellularFluidLiters:
          baselineEcf.estimatedExtracellularFluidLiters,
        extracellularFluidDeviationLiters: 0,
        ...initializeAdaptiveThermogenesisState(),
        weightFilterState,
      },
      simulatorParameters: {
        rmrParameters,
        glycogenParameters,
        baselineEnergyIntakeKcalPerDay: baseline.baselineEnergyIntakeKcalPerDay,
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
    };
  } catch (error) {
    if (error instanceof EpisodeInitializationError) throw error;
    throw new EpisodeInitializationError("invalid-initial-state");
  }
}
