import {
  stepAdaptiveThermogenesis,
  type AdaptiveThermogenesisState,
  type AdaptiveThermogenesisTransition,
} from "./adaptive-thermogenesis";
import {
  partitionEnergyBalanceAfterGlycogen,
  type GlycogenAwareEnergyResult,
} from "./body-composition/energy-accounting";
import {
  stepExtracellularFluidOneDay,
  type ExtracellularFluidTransition,
} from "./body-composition/extracellular-fluid";
import {
  stepGlycogenOneDay,
  type GlycogenParameters,
  type GlycogenTransition,
} from "./body-composition/glycogen";
import {
  reconstructBodyWeightKg,
  type BodyCompositionState,
} from "./body-composition/state";
import {
  calculateDynamicDailyExpenditure,
  type DynamicDailyExpenditureResult,
} from "./dynamic-daily-expenditure";
import type { DynamicRmrParameters } from "./dynamic-rmr";
import type { OccupationalCategory } from "./occupational-activity";
import {
  predictWeightFilterState,
  updateWeightFilterWithMeasurement,
  type WeightFilterState,
  type WeightFilterUpdate,
} from "./weight-observation-filter";

type OptionalMeasurement = number | null | undefined;

export type EcfSimulationPolicy =
  | "full"
  | "assume-unchanged-sodium"
  | "hold-ecf";

export type PhysiologicalSimulatorState = BodyCompositionState
  & AdaptiveThermogenesisState
  & { weightFilterState: WeightFilterState };

export type PhysiologicalSimulatorParameters = {
  rmrParameters: DynamicRmrParameters;
  glycogenParameters: GlycogenParameters;
  baselineEnergyIntakeKcalPerDay: number;
  adaptiveThermogenesis: {
    beta: number;
    timeConstantDays: number;
  };
  weightFilter: {
    processNoiseVarianceKg2PerDay: number;
    measurementNoiseVarianceKg2: number;
  };
};

export type PhysiologicalSimulatorOptions = {
  /** Required explicitly because sodium is not currently synced reliably. */
  ecfPolicy: EcfSimulationPolicy;
};

export type PhysiologicalDailyInput = {
  date: string;
  caloriesKcal: OptionalMeasurement;
  proteinG: OptionalMeasurement;
  fatG: OptionalMeasurement;
  carbsG: OptionalMeasurement;
  outsideWorkWalkingDistanceKm: OptionalMeasurement;
  averageWalkingSpeedKmh: OptionalMeasurement;
  strengthTrainingMinutes: OptionalMeasurement;
  occupationalActivity: {
    category: OccupationalCategory | null | undefined;
    durationHours: OptionalMeasurement;
  };
  sodiumChangeMgPerDay: OptionalMeasurement;
  measuredWeightKg: OptionalMeasurement;
};

export type CompleteDayCalculations = {
  startWeightKg: number;
  expenditure: DynamicDailyExpenditureResult;
  adaptiveThermogenesisTransition: AdaptiveThermogenesisTransition;
  glycogenTransition: GlycogenTransition;
  energyBalanceKcal: number;
  tissueEnergy: GlycogenAwareEnergyResult;
  ecfPolicy: EcfSimulationPolicy;
  ecfTransition: ExtracellularFluidTransition | null;
  deltaExtracellularFluidLiters: number;
  endWeightKg: number;
  predictedPhysiologicalWeightKg: number;
  weightFilterPrediction: WeightFilterState;
  weightFilterUpdate: WeightFilterUpdate;
  filteredObservedWeightKg: number;
};

export type CompleteSimulationDay = {
  status: "complete";
  date: string;
  startState: PhysiologicalSimulatorState;
  calculations: CompleteDayCalculations;
  endState: PhysiologicalSimulatorState;
};

export type IncompleteSimulationDay = {
  status: "incomplete";
  date: string;
  startState: PhysiologicalSimulatorState;
  missingFields: string[];
  calculations: null;
  endState: null;
};

export type BlockedSimulationDay = {
  status: "blocked";
  date: string;
  blockedByDate: string;
  startState: null;
  calculations: null;
  endState: null;
};

export type SimulationDayResult =
  | CompleteSimulationDay
  | IncompleteSimulationDay
  | BlockedSimulationDay;

function cloneState(state: PhysiologicalSimulatorState): PhysiologicalSimulatorState {
  return {
    fatMassKg: state.fatMassKg,
    leanTissueKg: state.leanTissueKg,
    glycogenKg: state.glycogenKg,
    baselineExtracellularFluidLiters: state.baselineExtracellularFluidLiters,
    extracellularFluidDeviationLiters: state.extracellularFluidDeviationLiters,
    adaptiveThermogenesisKcalPerDay: state.adaptiveThermogenesisKcalPerDay,
    weightFilterState: { ...state.weightFilterState },
  };
}

function validateCalendarDate(date: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new RangeError("date must use YYYY-MM-DD");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1
      || parsed.getUTCDate() !== day) {
    throw new RangeError("date must be a real calendar date");
  }
  return parsed.getTime() / 86_400_000;
}

function validateEcfPolicy(policy: EcfSimulationPolicy): void {
  if (policy !== "full" && policy !== "assume-unchanged-sodium" && policy !== "hold-ecf") {
    throw new RangeError("unknown ECF simulation policy");
  }
}

function missingFields(
  input: PhysiologicalDailyInput,
  ecfPolicy: EcfSimulationPolicy,
): string[] {
  const missing: string[] = [];
  const require = (name: string, value: unknown) => {
    if (value === null || value === undefined) missing.push(name);
  };
  require("caloriesKcal", input.caloriesKcal);
  require("proteinG", input.proteinG);
  require("fatG", input.fatG);
  require("carbsG", input.carbsG);
  require("outsideWorkWalkingDistanceKm", input.outsideWorkWalkingDistanceKm);
  if (input.outsideWorkWalkingDistanceKm !== null
      && input.outsideWorkWalkingDistanceKm !== undefined
      && input.outsideWorkWalkingDistanceKm !== 0) {
    require("averageWalkingSpeedKmh", input.averageWalkingSpeedKmh);
  }
  require("strengthTrainingMinutes", input.strengthTrainingMinutes);
  require("occupationalActivity.durationHours", input.occupationalActivity.durationHours);
  if (input.occupationalActivity.durationHours !== null
      && input.occupationalActivity.durationHours !== undefined
      && input.occupationalActivity.durationHours !== 0) {
    require("occupationalActivity.category", input.occupationalActivity.category);
  }
  if (ecfPolicy === "full") {
    require("sodiumChangeMgPerDay", input.sodiumChangeMgPerDay);
  }
  return missing;
}

function calculateEcfTransition(input: {
  state: PhysiologicalSimulatorState;
  day: PhysiologicalDailyInput;
  parameters: PhysiologicalSimulatorParameters;
  policy: EcfSimulationPolicy;
}): ExtracellularFluidTransition | null {
  if (input.policy === "hold-ecf") return null;
  return stepExtracellularFluidOneDay({
    baselineExtracellularFluidLiters: input.state.baselineExtracellularFluidLiters,
    currentExtracellularFluidDeviationLiters:
      input.state.extracellularFluidDeviationLiters,
    carbIntakeG: input.day.carbsG,
    baselineCarbIntakeG: input.parameters.glycogenParameters.baselineCarbIntakeG,
    sodiumChangeMgPerDay: input.policy === "assume-unchanged-sodium"
      ? 0
      : input.day.sodiumChangeMgPerDay,
  });
}

/** Simulates one calendar day without mutating state, parameters, or input. */
export function simulateOneDay(input: {
  state: PhysiologicalSimulatorState;
  parameters: PhysiologicalSimulatorParameters;
  day: PhysiologicalDailyInput;
  options: PhysiologicalSimulatorOptions;
}): CompleteSimulationDay | IncompleteSimulationDay {
  validateCalendarDate(input.day.date);
  validateEcfPolicy(input.options.ecfPolicy);
  const startState = cloneState(input.state);
  reconstructBodyWeightKg(startState);
  const missing = missingFields(input.day, input.options.ecfPolicy);
  if (missing.length > 0) {
    return {
      status: "incomplete",
      date: input.day.date,
      startState,
      missingFields: missing,
      calculations: null,
      endState: null,
    };
  }

  const adaptiveThermogenesisTransition = stepAdaptiveThermogenesis({
    currentAdaptiveThermogenesisKcalPerDay:
      startState.adaptiveThermogenesisKcalPerDay,
    currentEnergyIntakeKcalPerDay: input.day.caloriesKcal,
    baselineEnergyIntakeKcalPerDay: input.parameters.baselineEnergyIntakeKcalPerDay,
    betaAdaptiveThermogenesis: input.parameters.adaptiveThermogenesis.beta,
    timeConstantDays: input.parameters.adaptiveThermogenesis.timeConstantDays,
    elapsedDays: 1,
  })!;
  const expenditure = calculateDynamicDailyExpenditure({
    bodyComposition: startState,
    rmrParameters: input.parameters.rmrParameters,
    macros: {
      proteinG: input.day.proteinG,
      carbsG: input.day.carbsG,
      fatG: input.day.fatG,
    },
    outsideWorkWalking: {
      distanceKm: input.day.outsideWorkWalkingDistanceKm,
      averageSpeedKmh: input.day.averageWalkingSpeedKmh,
    },
    strength: { durationMinutes: input.day.strengthTrainingMinutes },
    occupational: input.day.occupationalActivity,
    adaptiveThermogenesisKcalPerDay:
      adaptiveThermogenesisTransition.meanAdaptiveThermogenesisKcalPerDay,
  });
  const glycogenTransition = stepGlycogenOneDay({
    currentGlycogenKg: startState.glycogenKg,
    carbIntakeG: input.day.carbsG,
    parameters: input.parameters.glycogenParameters,
  })!;
  const energyBalanceKcal = input.day.caloriesKcal!
    - expenditure.modelTdeeBeforePersonalizationKcalPerDay!;
  const tissueEnergy = partitionEnergyBalanceAfterGlycogen({
    totalEnergyBalanceKcal: energyBalanceKcal,
    glycogenStorageEnergyKcal: glycogenTransition.glycogenStorageEnergyKcal,
    fatMassKg: startState.fatMassKg,
  });
  const ecfTransition = calculateEcfTransition({
    state: startState,
    day: input.day,
    parameters: input.parameters,
    policy: input.options.ecfPolicy,
  });
  const endBodyComposition: BodyCompositionState = {
    fatMassKg: startState.fatMassKg + tissueEnergy.deltaFatMassKg,
    leanTissueKg: startState.leanTissueKg + tissueEnergy.deltaLeanTissueKg,
    glycogenKg: glycogenTransition.glycogenKg,
    baselineExtracellularFluidLiters: startState.baselineExtracellularFluidLiters,
    extracellularFluidDeviationLiters: ecfTransition?.extracellularFluidDeviationLiters
      ?? startState.extracellularFluidDeviationLiters,
  };
  const endWeightKg = reconstructBodyWeightKg(endBodyComposition);
  const weightFilterPrediction = predictWeightFilterState({
    state: startState.weightFilterState,
    predictedWeightKg: endWeightKg,
    elapsedDays: 1,
    processNoiseVarianceKg2PerDay:
      input.parameters.weightFilter.processNoiseVarianceKg2PerDay,
  });
  const weightFilterUpdate = updateWeightFilterWithMeasurement({
    predictedState: weightFilterPrediction,
    measuredWeightKg: input.day.measuredWeightKg ?? null,
    measurementNoiseVarianceKg2:
      input.parameters.weightFilter.measurementNoiseVarianceKg2,
  });
  const endState: PhysiologicalSimulatorState = {
    ...endBodyComposition,
    adaptiveThermogenesisKcalPerDay:
      adaptiveThermogenesisTransition.adaptiveThermogenesisKcalPerDay,
    weightFilterState: { ...weightFilterUpdate.state },
  };

  return {
    status: "complete",
    date: input.day.date,
    startState,
    calculations: {
      startWeightKg: expenditure.currentPredictedWeightKg,
      expenditure,
      adaptiveThermogenesisTransition,
      glycogenTransition,
      energyBalanceKcal,
      tissueEnergy,
      ecfPolicy: input.options.ecfPolicy,
      ecfTransition,
      deltaExtracellularFluidLiters: ecfTransition?.deltaExtracellularFluidLiters ?? 0,
      endWeightKg,
      predictedPhysiologicalWeightKg: endWeightKg,
      weightFilterPrediction,
      weightFilterUpdate,
      filteredObservedWeightKg: weightFilterUpdate.state.estimatedWeightKg,
    },
    endState,
  };
}

/** Processes already chronological dates; ambiguity is rejected rather than reordered. */
export function simulateDays(input: {
  initialState: PhysiologicalSimulatorState;
  parameters: PhysiologicalSimulatorParameters;
  days: readonly PhysiologicalDailyInput[];
  options: PhysiologicalSimulatorOptions;
}): SimulationDayResult[] {
  let previousEpochDay: number | null = null;
  for (let index = 0; index < input.days.length; index += 1) {
    const epochDay = validateCalendarDate(input.days[index].date);
    if (index > 0 && input.days[index].date <= input.days[index - 1].date) {
      throw new RangeError("simulation days must be unique and strictly chronological");
    }
    if (previousEpochDay !== null && epochDay !== previousEpochDay + 1) {
      throw new RangeError("simulation days must be consecutive; represent missing days explicitly");
    }
    previousEpochDay = epochDay;
  }

  const results: SimulationDayResult[] = [];
  let state = cloneState(input.initialState);
  let blockedByDate: string | null = null;
  for (const day of input.days) {
    if (blockedByDate !== null) {
      results.push({
        status: "blocked",
        date: day.date,
        blockedByDate,
        startState: null,
        calculations: null,
        endState: null,
      });
      continue;
    }
    const result = simulateOneDay({
      state,
      parameters: input.parameters,
      day,
      options: input.options,
    });
    results.push(result);
    if (result.status === "incomplete") {
      blockedByDate = result.date;
    } else {
      state = cloneState(result.endState);
    }
  }
  return results;
}
