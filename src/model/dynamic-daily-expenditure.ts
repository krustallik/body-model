import { calculateStrengthActivity } from "./activity/strength";
import { calculateWalkingActivity } from "./activity/walking";
import {
  reconstructBodyWeightKg,
  type BodyCompositionState,
} from "./body-composition/state";
import {
  calculateDynamicRmr,
  type DynamicRmrParameters,
} from "./dynamic-rmr";
import {
  calculateOccupationalActivity,
  type OccupationalCategory,
} from "./occupational-activity";
import { calculateTef, type TefInput } from "./tef";

type OptionalMeasurement = number | null | undefined;

export type OccupationalActivityIntervalInput = {
  category: OccupationalCategory | null | undefined;
  durationHours: OptionalMeasurement;
};

export type DynamicDailyExpenditureInput = {
  bodyComposition: BodyCompositionState;
  rmrParameters: DynamicRmrParameters;
  macros: TefInput;
  outsideWorkWalking: {
    distanceKm: OptionalMeasurement;
    averageSpeedKmh: OptionalMeasurement;
  };
  strength: {
    durationMinutes: OptionalMeasurement;
  };
  occupational: {
    category: OccupationalCategory | null | undefined;
    durationHours: OptionalMeasurement;
    /** Optional non-overlapping intervals; when supplied, the legacy pair is ignored. */
    intervals?: readonly OccupationalActivityIntervalInput[];
  };
  adaptiveThermogenesisKcalPerDay: OptionalMeasurement;
  personalization?: ExpenditurePersonalization;
};

export type ExpenditurePersonalization = {
  /** Effective residual expenditure correction; not a direct metabolic measurement. */
  personalOffsetKcalPerDay: number;
  /** Applied once to total modeled net Activity. */
  activityCalibration: number;
};

export const DEFAULT_EXPENDITURE_PERSONALIZATION: Readonly<ExpenditurePersonalization> = {
  personalOffsetKcalPerDay: 0,
  activityCalibration: 1,
};

export type DynamicDailyExpenditureResult = {
  currentPredictedWeightKg: number;
  dynamicRmrKcalPerDay: number;
  tefKcalPerDay: number | null;
  outsideWorkWalkingActivityKcalPerDay: number | null;
  strengthActivityKcalPerDay: number | null;
  occupationalActivityKcalPerDay: number | null;
  /** Uncalibrated sum of walking, strength, and occupational net Activity. */
  activityKcalPerDay: number | null;
  calibratedActivityKcalPerDay: number | null;
  adaptiveThermogenesisKcalPerDay: number | null;
  modelTdeeBeforePersonalizationKcalPerDay: number | null;
  personalOffsetKcalPerDay: number;
  activityCalibration: number;
  personalizedTdeeKcalPerDay: number | null;
};

function normalizeOptionalFinite(
  name: string,
  value: OptionalMeasurement,
): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
  return value;
}

function calculateOccupationalComponent(input: {
  category: OccupationalCategory | null | undefined;
  durationHours: OptionalMeasurement;
  intervals?: readonly OccupationalActivityIntervalInput[];
  weightKg: number;
  rmrKcalPerDay: number;
}): number | null {
  if (input.intervals !== undefined) {
    let totalDurationHours = 0;
    let totalActivityKcal = 0;
    for (const [index, interval] of input.intervals.entries()) {
      const durationHours = normalizeOptionalFinite(
        `occupational.intervals.${index}.durationHours`,
        interval.durationHours,
      );
      if (durationHours === null) return null;
      totalDurationHours += durationHours;
      if (totalDurationHours > 24) {
        throw new RangeError("total occupational durationHours must not exceed 24");
      }
      if (durationHours === 0) continue;
      if (interval.category === null || interval.category === undefined) return null;
      totalActivityKcal += calculateOccupationalActivity({
        category: interval.category,
        durationHours,
        weightKg: input.weightKg,
        rmrKcalPerDay: input.rmrKcalPerDay,
      });
    }
    return totalActivityKcal;
  }
  const durationHours = normalizeOptionalFinite("occupational.durationHours", input.durationHours);
  if (durationHours === null) return null;
  if (durationHours === 0) return 0;
  if (input.category === null || input.category === undefined) return null;
  return calculateOccupationalActivity({
    category: input.category,
    durationHours,
    weightKg: input.weightKg,
    rmrKcalPerDay: input.rmrKcalPerDay,
  });
}

/**
 * Composes one simulated day's expenditure from the current latent state.
 * Walking distance is explicitly outside work, preserving overlap protection.
 */
export function calculateDynamicDailyExpenditure(
  input: DynamicDailyExpenditureInput,
): DynamicDailyExpenditureResult {
  const personalization = input.personalization ?? DEFAULT_EXPENDITURE_PERSONALIZATION;
  if (!Number.isFinite(personalization.personalOffsetKcalPerDay)) {
    throw new TypeError("personalOffsetKcalPerDay must be finite");
  }
  if (!Number.isFinite(personalization.activityCalibration)) {
    throw new TypeError("activityCalibration must be finite");
  }
  if (personalization.activityCalibration < 0) {
    throw new RangeError("activityCalibration must be nonnegative");
  }
  const currentPredictedWeightKg = reconstructBodyWeightKg(input.bodyComposition);
  const dynamicRmrKcalPerDay = calculateDynamicRmr({
    fatMassKg: input.bodyComposition.fatMassKg,
    leanTissueKg: input.bodyComposition.leanTissueKg,
    parameters: input.rmrParameters,
  });
  const tefKcalPerDay = calculateTef(input.macros);
  const outsideWorkWalkingActivityKcalPerDay = calculateWalkingActivity({
    weightKg: currentPredictedWeightKg,
    rmrKcalPerDay: dynamicRmrKcalPerDay,
    distanceKm: input.outsideWorkWalking.distanceKm,
    averageSpeedKmh: input.outsideWorkWalking.averageSpeedKmh,
  });
  const strengthActivityKcalPerDay = calculateStrengthActivity({
    weightKg: currentPredictedWeightKg,
    rmrKcalPerDay: dynamicRmrKcalPerDay,
    durationMinutes: input.strength.durationMinutes,
  });
  const occupationalActivityKcalPerDay = calculateOccupationalComponent({
    ...input.occupational,
    weightKg: currentPredictedWeightKg,
    rmrKcalPerDay: dynamicRmrKcalPerDay,
  });
  const adaptiveThermogenesisKcalPerDay = normalizeOptionalFinite(
    "adaptiveThermogenesisKcalPerDay",
    input.adaptiveThermogenesisKcalPerDay,
  );

  const activityComponents = [
    outsideWorkWalkingActivityKcalPerDay,
    strengthActivityKcalPerDay,
    occupationalActivityKcalPerDay,
  ];
  const activityKcalPerDay = activityComponents.some((value) => value === null)
    ? null
    : activityComponents.reduce<number>((total, value) => total + (value as number), 0);
  const calibratedActivityKcalPerDay = activityKcalPerDay === null
    ? null
    : activityKcalPerDay * personalization.activityCalibration;
  if (calibratedActivityKcalPerDay !== null
      && !Number.isFinite(calibratedActivityKcalPerDay)) {
    throw new RangeError("calibrated Activity exceeds finite numeric precision");
  }

  const requiredComponents = [
    tefKcalPerDay,
    activityKcalPerDay,
    adaptiveThermogenesisKcalPerDay,
  ];
  const modelTdeeBeforePersonalizationKcalPerDay = requiredComponents.some(
    (value) => value === null,
  )
    ? null
    : dynamicRmrKcalPerDay
      + (tefKcalPerDay as number)
      + (activityKcalPerDay as number)
      + (adaptiveThermogenesisKcalPerDay as number);
  if (modelTdeeBeforePersonalizationKcalPerDay !== null
      && (!Number.isFinite(modelTdeeBeforePersonalizationKcalPerDay)
        || modelTdeeBeforePersonalizationKcalPerDay <= 0)) {
    throw new RangeError("model expenditure must be positive and finite");
  }
  const personalizedRequiredComponents = [
    tefKcalPerDay,
    calibratedActivityKcalPerDay,
    adaptiveThermogenesisKcalPerDay,
  ];
  const personalizedTdeeKcalPerDay = personalizedRequiredComponents.some(
    (value) => value === null,
  )
    ? null
    : dynamicRmrKcalPerDay
      + (tefKcalPerDay as number)
      + (calibratedActivityKcalPerDay as number)
      + (adaptiveThermogenesisKcalPerDay as number)
      + personalization.personalOffsetKcalPerDay;
  if (personalizedTdeeKcalPerDay !== null
      && (!Number.isFinite(personalizedTdeeKcalPerDay)
        || personalizedTdeeKcalPerDay <= 0)) {
    throw new RangeError("personalized model expenditure must be positive and finite");
  }

  return {
    currentPredictedWeightKg,
    dynamicRmrKcalPerDay,
    tefKcalPerDay,
    outsideWorkWalkingActivityKcalPerDay,
    strengthActivityKcalPerDay,
    occupationalActivityKcalPerDay,
    activityKcalPerDay,
    calibratedActivityKcalPerDay,
    adaptiveThermogenesisKcalPerDay,
    modelTdeeBeforePersonalizationKcalPerDay,
    personalOffsetKcalPerDay: personalization.personalOffsetKcalPerDay,
    activityCalibration: personalization.activityCalibration,
    personalizedTdeeKcalPerDay,
  };
}
