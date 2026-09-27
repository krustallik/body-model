import { finiteNonNegative } from "@/model/activity/canonical-activity-policy-v1";
import {
  ENGINEERING_MS100_STEP_HEIGHT_M_V1,
  ENGINEERING_NET_VERTICAL_WORK_EFFICIENCY_V1,
  activeKcalFromMechanicalWorkV1,
  mechanicalVerticalWorkJoulesV1,
} from "@/model/activity/experimental-stepper-active-energy-v1";

export type ManualStepperFieldsV1 = {
  manualStepCount: number | null;
  manualActiveEnergyKcal: number | null;
};

export function parseManualStepperFieldsV1(input: {
  manualStepCount?: number | null;
  manualActiveEnergyKcal?: number | null;
}): ManualStepperFieldsV1 {
  const steps = input.manualStepCount ?? null;
  if (steps !== null && (!Number.isInteger(steps) || steps < 0)) {
    throw new RangeError("manual steps must be a nonnegative integer or absent");
  }
  const kcal = input.manualActiveEnergyKcal ?? null;
  if (kcal !== null && (finiteNonNegative(kcal) === null)) {
    throw new RangeError("manual active kcal must be finite and nonnegative or absent");
  }
  return { manualStepCount: steps, manualActiveEnergyKcal: kcal };
}

/**
 * Declared steps never enter the Apple step denominator.
 * Declared kcal is kept as entered. Steps-only uses the existing MS100
 * mechanical conversion and does not invent a Garmin snapshot.
 */
export function adaptManualStepperEnergyV1(input: ManualStepperFieldsV1 & {
  bodyMassKg: number | null;
}): {
  manualKcalPresent: boolean;
  manualKcal: number | null;
  mechanicalKcal: number | null;
  appleDenominatorSteps: null;
} {
  const fields = parseManualStepperFieldsV1(input);
  if (fields.manualActiveEnergyKcal !== null) {
    return {
      manualKcalPresent: true,
      manualKcal: fields.manualActiveEnergyKcal,
      mechanicalKcal: null,
      appleDenominatorSteps: null,
    };
  }
  if (fields.manualStepCount === null || fields.manualStepCount === 0) {
    return {
      manualKcalPresent: false,
      manualKcal: null,
      mechanicalKcal: null,
      appleDenominatorSteps: null,
    };
  }
  const mass = finiteNonNegative(input.bodyMassKg);
  if (mass === null || mass <= 0) {
    return {
      manualKcalPresent: false,
      manualKcal: null,
      mechanicalKcal: null,
      appleDenominatorSteps: null,
    };
  }
  const mechanicalKcal = activeKcalFromMechanicalWorkV1({
    mechanicalWorkJ: mechanicalVerticalWorkJoulesV1({
      bodyMassKg: mass,
      stepHeightM: ENGINEERING_MS100_STEP_HEIGHT_M_V1.pointMeters,
      stepCount: fields.manualStepCount,
    }),
    efficiencyFraction: ENGINEERING_NET_VERTICAL_WORK_EFFICIENCY_V1.pointFraction,
  });
  return {
    manualKcalPresent: false,
    manualKcal: null,
    mechanicalKcal,
    appleDenominatorSteps: null,
  };
}
