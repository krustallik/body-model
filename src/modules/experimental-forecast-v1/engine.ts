import { addCalendarDays } from "@/modules/model-episodes/model-calendar";
import { GLYCOGEN_WATER_KG_PER_KG } from "@/model/body-composition/constants";
import { hasExplicitStrengthWorkouts } from "@/model/activity/workout-energy";
import { estimateExperimentalTransientExerciseWaterV1 } from "@/model/physiology-v7/experimental-transient-exercise-water-v1";
import {
  simulateOneDay,
  type PhysiologicalDailyInput,
  type PhysiologicalSimulatorParameters,
  type PhysiologicalSimulatorState,
} from "@/model/physiological-simulator";
import { reconstructBodyWeightKg } from "@/model/body-composition/state";
import type { ExpenditurePersonalization } from "@/model/dynamic-daily-expenditure";
import {
  createForecastWorkoutEvent,
  toProductionWorkoutActivity,
  type ForecastWorkoutActivity,
} from "@/modules/model-forecast/forecast-workout-scenario";
import {
  DEFAULT_EXPERIMENTAL_FORECAST_CONFIG,
  EXPERIMENTAL_FORECAST_V1_REVISION,
  type ExperimentalEngineeringRange,
  type ExperimentalForecastConfig,
  type ExperimentalForecastDate,
  type ExperimentalForecastInitialState,
  type ExperimentalForecastResult,
  type ExperimentalForecastScenario,
} from "./contracts";
import { experimentalForecastScenarioFingerprint } from "./fingerprint";
import { resolveScenario } from "./scenario";

export type ExperimentalForecastBehavior = {
  caloriesKcal: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
  outsideWorkWalkingDistanceKm: number;
  averageWalkingSpeedKmh: number;
  strengthTrainingMinutes: number;
  stepperMinutes: number;
  workoutActivity?: ForecastWorkoutActivity;
  occupation: PhysiologicalDailyInput["occupationalActivity"]["intervals"];
};

export type ExperimentalForecastEngineInput = {
  initial: ExperimentalForecastInitialState;
  simulatorState: PhysiologicalSimulatorState;
  parameters: PhysiologicalSimulatorParameters;
  personalization: ExpenditurePersonalization;
  ecfPolicy: "full" | "assume-unchanged-sodium" | "hold-ecf";
  baseline: ExperimentalForecastBehavior;
  scenario: ExperimentalForecastScenario;
  startDate: string;
  horizonDays: number;
  seed: number;
  config?: Partial<ExperimentalForecastConfig>;
  behaviorForDate?: (date: string, dayIndex: number) => ExperimentalForecastBehavior;
};

function config(input?: Partial<ExperimentalForecastConfig>): ExperimentalForecastConfig {
  return { ...DEFAULT_EXPERIMENTAL_FORECAST_CONFIG, ...input };
}

function range(value: number, uncertainty: number): ExperimentalEngineeringRange {
  const spread = Math.max(0, uncertainty);
  return {
    median: value,
    lower: value - spread,
    upper: value + spread,
    representation: "engineering-range",
  };
}

function scenarioBehavior(
  baseline: ExperimentalForecastBehavior,
  scenario: ExperimentalForecastScenario,
  initial: ExperimentalForecastInitialState,
): { behavior: ExperimentalForecastBehavior; assumedDoseKeys: string[] } {
  const resolved = resolveScenario(scenario);
  const baselineMaintenance = initial.typicalMaintenanceKcalPerDay
    ?? baseline.caloriesKcal;
  const calories = resolved.mode === "target-calories" || resolved.mode === "explicit-plan"
    ? resolved.caloriesKcal ?? baseline.caloriesKcal
    : resolved.mode === "target-deficit"
      ? baselineMaintenance + (resolved.deltaCaloriesKcal ?? -300)
      : resolved.mode === "target-surplus"
        ? baselineMaintenance + (resolved.deltaCaloriesKcal ?? 300)
        : resolved.mode === "maintain-current" || resolved.mode === "typical-recent-activity"
          ? baseline.caloriesKcal
          : baseline.caloriesKcal;
  const explicitActivity = resolved.mode === "explicit-plan";
  const activity = resolved.activityReplacement === "additive" ? "additive" : "replace";
  const behavior: ExperimentalForecastBehavior = {
    ...baseline,
    caloriesKcal: calories,
    proteinG: resolved.proteinG ?? baseline.proteinG,
    fatG: resolved.fatG ?? baseline.fatG,
    carbsG: resolved.carbsG ?? baseline.carbsG,
    outsideWorkWalkingDistanceKm: resolved.outsideWorkWalkingDistanceKm === undefined || activity === "additive"
      ? baseline.outsideWorkWalkingDistanceKm + (resolved.outsideWorkWalkingDistanceKm ?? 0)
      : resolved.outsideWorkWalkingDistanceKm,
    averageWalkingSpeedKmh: resolved.averageWalkingSpeedKmh ?? baseline.averageWalkingSpeedKmh,
    strengthTrainingMinutes: resolved.strengthTrainingMinutes === undefined || activity === "additive"
      ? baseline.strengthTrainingMinutes + (resolved.strengthTrainingMinutes ?? 0)
      : resolved.strengthTrainingMinutes,
    stepperMinutes: resolved.stepperMinutes === undefined || activity === "additive"
      ? baseline.stepperMinutes + (resolved.stepperMinutes ?? 0)
      : resolved.stepperMinutes,
  };
  const assumedDoseKeys = ["baseline:rmr", "baseline:tef", "baseline:activity"];
  if (explicitActivity || resolved.mode === "target-deficit" || resolved.mode === "target-surplus") {
    assumedDoseKeys.push("scenario:intake");
  }
  if (behavior.strengthTrainingMinutes > 0) assumedDoseKeys.push("activity:strength");
  if (behavior.stepperMinutes > 0) assumedDoseKeys.push("activity:stepper");
  if (behavior.workoutActivity?.events.some((event) => event.classification === "traditional-strength-training")
    && !assumedDoseKeys.includes("activity:strength")) {
    assumedDoseKeys.push("activity:strength");
  }
  if (behavior.workoutActivity?.events.some((event) => event.classification === "stair-climbing")
    && !assumedDoseKeys.includes("activity:stepper")) {
    assumedDoseKeys.push("activity:stepper");
  }
  if (behavior.outsideWorkWalkingDistanceKm > 0) assumedDoseKeys.push("activity:walking");
  return { behavior, assumedDoseKeys };
}

function dailyInput(date: string, behavior: ExperimentalForecastBehavior): PhysiologicalDailyInput {
  const workoutActivity = behavior.workoutActivity ?? {
    events: [
      ...(behavior.strengthTrainingMinutes > 0 ? [createForecastWorkoutEvent({
        type: "Traditional Strength Training",
        durationMinutes: behavior.strengthTrainingMinutes,
      })] : []),
      ...(behavior.stepperMinutes > 0 ? [createForecastWorkoutEvent({
        type: "Stair Climbing",
        durationMinutes: behavior.stepperMinutes,
      })] : []),
    ],
  };
  return {
    date,
    caloriesKcal: behavior.caloriesKcal,
    proteinG: behavior.proteinG,
    fatG: behavior.fatG,
    carbsG: behavior.carbsG,
    outsideWorkWalkingDistanceKm: behavior.outsideWorkWalkingDistanceKm,
    averageWalkingSpeedKmh: behavior.averageWalkingSpeedKmh,
    strengthTrainingMinutes: behavior.workoutActivity ? behavior.strengthTrainingMinutes : 0,
    workoutActivity: toProductionWorkoutActivity(workoutActivity),
    occupationalActivity: {
      category: null,
      durationHours: behavior.occupation?.length ? 0 : 0,
      intervals: behavior.occupation,
    },
    sodiumChangeMgPerDay: 0,
    measuredWeightKg: null,
  };
}

function energyState(intake: number, expenditure: number): ExperimentalForecastDate["energyState"] {
  const delta = intake - expenditure;
  return delta > 75 ? "surplus" : delta < -75 ? "deficit" : "maintenance";
}

export function runExperimentalForecast(input: ExperimentalForecastEngineInput): ExperimentalForecastResult {
  if (!Number.isInteger(input.horizonDays) || input.horizonDays < 1 || input.horizonDays > 365) {
    throw new RangeError("Experimental Forecast V1 supports horizons from 1 to 365 days");
  }
  const resolvedConfig = config(input.config);
  const resolvedScenario = resolveScenario(input.scenario);
  const scenarioFingerprint = experimentalForecastScenarioFingerprint({
    initialStateFingerprint: input.initial.unifiedFingerprint,
    scenario: resolvedScenario,
    horizonDays: input.horizonDays,
    seed: input.seed,
    config: resolvedConfig,
  });
  const dates: ExperimentalForecastDate[] = [];
  let state = input.simulatorState;
  let transientWaterPoint = input.initial.transientWaterKg?.point ?? null;
  const latentAnchorWeightKg = reconstructBodyWeightKg(input.simulatorState);
  const initialFat = input.initial.fatMassKg;
  const initialSlowNonFat = input.initial.slowNonFatKg;
  for (let dayIndex = 0; dayIndex < input.horizonDays; dayIndex += 1) {
    const date = addCalendarDays(input.startDate, dayIndex);
    const dayScenario = scenarioBehavior(
      input.behaviorForDate?.(date, dayIndex) ?? input.baseline,
      resolvedScenario,
      input.initial,
    );
    const result = simulateOneDay({
      state,
      parameters: input.parameters,
      day: dailyInput(date, dayScenario.behavior),
      options: { ecfPolicy: input.ecfPolicy },
      personalization: input.personalization,
    });
    if (result.status !== "complete") {
      throw new Error(`experimental forecast incomplete: ${result.missingFields.join(",")}`);
    }
    state = result.endState;
    const transient = estimateExperimentalTransientExerciseWaterV1({
      priorTransientWaterKg: transientWaterPoint,
      daysElapsed: 1,
      resistanceSession: dayScenario.behavior.strengthTrainingMinutes > 0
        || (dayScenario.behavior.workoutActivity !== undefined
          && hasExplicitStrengthWorkouts(dayScenario.behavior.workoutActivity.events))
        ? { qualifiedHardSetCount: 0, exposureContext: "novel-or-unknown" }
        : null,
    });
    transientWaterPoint = transient.resultingTransientWaterKg.point;
    const transientChange = transientWaterPoint === null || input.initial.transientWaterKg?.point === null
      ? 0
      : transientWaterPoint - (input.initial.transientWaterKg?.point ?? 0);
    const anchorWeightKg = input.initial.anchorWeightKg ?? latentAnchorWeightKg;
    const expectedWeight = anchorWeightKg
      + (result.calculations.endWeightKg - latentAnchorWeightKg)
      + transientChange;
    const modeledChange = expectedWeight - anchorWeightKg;
    const uncertainty = resolvedConfig.horizonUncertaintyPerDayKg * Math.sqrt(dayIndex + 1)
      + (input.initial.quality === "limited-history" ? 0.5 : input.initial.quality === "bootstrap" ? 1 : 0);
    const fat = range(state.fatMassKg, uncertainty * 0.3);
    const slowNonFat = range(state.leanTissueKg, uncertainty * 0.2);
    const glycogen = range(state.glycogenKg, uncertainty * 0.2);
    const glycogenWater = range(state.glycogenKg * GLYCOGEN_WATER_KG_PER_KG, uncertainty * 0.25);
    const transientWater = transient.resultingTransientWaterKg.point === null
      ? null
      : range(transient.resultingTransientWaterKg.point, uncertainty * 0.35);
    const weight = input.initial.anchorWeightKg === null ? null : range(expectedWeight, uncertainty);
    dates.push({
      date,
      expectedWeightKg: input.initial.anchorWeightKg === null ? null : expectedWeight,
      weightChangeFromAnchorKg: range(modeledChange, uncertainty),
      weightKg: weight,
      fatMassKg: initialFat === null ? null : fat,
      slowNonFatKg: initialSlowNonFat === null ? null : slowNonFat,
      glycogenKg: glycogen,
      glycogenWaterKg: glycogenWater,
      transientWaterKg: transientWater,
      expenditureKcalPerDay: range(result.calculations.expenditure.personalizedTdeeKcalPerDay!, uncertainty * 20),
      intakeKcal: range(dayScenario.behavior.caloriesKcal, uncertainty * 15),
      activityKcalPerDay: range(result.calculations.expenditure.calibratedActivityKcalPerDay ?? 0, uncertainty * 15),
      energyState: energyState(dayScenario.behavior.caloriesKcal, result.calculations.expenditure.personalizedTdeeKcalPerDay!),
      selectedDoseKeys: dayScenario.assumedDoseKeys,
      quality: input.initial.quality,
      uncertaintyReasons: [
        ...(input.initial.uncertaintyReasons),
        ...(input.initial.quality === "limited-history" ? ["limited-history"] : input.initial.quality === "bootstrap" ? ["profile-bootstrap"] : []),
        "horizon-engineering-range",
      ],
    });
  }
  const limited = input.initial.quality === "limited-history";
  const bootstrap = input.initial.quality === "bootstrap";
  return {
    status: bootstrap ? "bootstrap" : limited ? "limited-history" : input.initial.quality === "degraded" ? "degraded" : "ok",
    forecastRevision: EXPERIMENTAL_FORECAST_V1_REVISION,
    horizonDays: input.horizonDays,
    anchorDate: input.initial.anchorDate,
    anchorWeightKg: input.initial.anchorWeightKg,
    initialStateQuality: input.initial.quality,
    initialStateFingerprint: input.initial.unifiedFingerprint,
    scenarioFingerprint,
    seed: input.seed,
    scenario: resolvedScenario,
    coverage: { eligibleDays: input.initial.eligibleDays, requestedWindowDays: input.initial.requestedWindowDays },
    current: {
      modeledWeightKg: input.initial.anchorWeightKg,
      fatMassKg: input.initial.fatMassKg,
      slowNonFatKg: input.initial.slowNonFatKg,
      glycogenWaterKg: input.initial.glycogenWaterKg?.point ?? null,
      transientWaterKg: input.initial.transientWaterKg?.point ?? null,
      restingRmrKcalPerDay: input.initial.restingRmrKcalPerDay,
      typicalMaintenanceKcalPerDay: input.initial.typicalMaintenanceKcalPerDay,
      latestExpenditureKcalPerDay: input.initial.latestExpenditureKcalPerDay,
    },
    dates,
    diagnostics: {
      generatedPathCount: 1,
      validPathCount: 1,
      uncertaintySources: {
        initialState: input.initial.quality !== "standard",
        futureInputs: true,
        model: true,
        horizon: true,
        missingAssumptions: limited || bootstrap,
      },
      notes: ["engineering ranges are not confidence intervals", "future scenario inputs are assumptions, never observations", "relative muscle and unexplained residual are excluded from mass"],
    },
  };
}
