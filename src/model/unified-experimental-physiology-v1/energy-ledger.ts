import type {
  UnifiedAvailabilityV1,
  UnifiedEnergyLedgerEntryV1,
  UnifiedEnergyLedgerV1,
} from "./contracts";

export type UnifiedEnergyProductionInputV1 = {
  dynamicRmrKcalPerDay: number | null;
  tefKcalPerDay: number | null;
  walkingKcalPerDay: number | null;
  occupationalKcalPerDay: number | null;
  workoutKcalPerDay: number | null;
  stepperKcalPerDay: number | null;
  activityKcalPerDay: number | null;
  adaptiveThermogenesisKcalPerDay: number | null;
  personalOffsetKcalPerDay: number | null;
  productionTdeeKcalPerDay: number | null;
};

export type UnifiedEnergyActivityEvidenceV1 = {
  doseKey: string;
  kind: "workout" | "stepper";
  garminActiveKcal: number | null;
  bodyCastEstimateKcal: number | null;
};

function status(value: number | null, preferred: "selected" | "reference" | "diagnostic" = "reference"): UnifiedEnergyLedgerEntryV1["status"] {
  return value === null ? "unavailable" : preferred;
}

function entry(
  kind: UnifiedEnergyLedgerEntryV1["kind"],
  valueKcal: number | null,
  source: string,
  selected: boolean,
  replacesOrOverlaps: string[] = [],
  reason: string | null = null,
  statusOverride?: Exclude<UnifiedEnergyLedgerEntryV1["status"], "unavailable">,
): UnifiedEnergyLedgerEntryV1 {
  return { kind, valueKcal, source, status: status(valueKcal, statusOverride ?? (selected ? "selected" : "reference")), replacesOrOverlaps, reason };
}

/**
 * Selects one production-owned energy ledger. Experimental alternatives are
 * retained for comparison but never added to the selected production dose.
 */
export function buildUnifiedEnergyLedgerV1(input: {
  production: UnifiedEnergyProductionInputV1;
  activities: readonly UnifiedEnergyActivityEvidenceV1[];
  epocApplied?: boolean;
}): UnifiedEnergyLedgerV1 {
  const production = input.production;
  const entries: UnifiedEnergyLedgerEntryV1[] = [
    entry("dynamic-rmr", production.dynamicRmrKcalPerDay, "production-dynamic-rmr", true),
    entry("tef", production.tefKcalPerDay, "production-tef", true),
    entry("walking", production.walkingKcalPerDay, "production-activity", true),
    entry("occupational", production.occupationalKcalPerDay, "production-activity", true),
    entry("workout", production.workoutKcalPerDay, "production-workout-activity", true, ["strength-shadow", "garmin-device"]),
    entry("stepper", production.stepperKcalPerDay, "production-stepper-activity", true, ["stepper-shadow", "garmin-device"]),
    entry("adaptive-thermogenesis", production.adaptiveThermogenesisKcalPerDay, "production-adaptive-thermogenesis", true),
    entry("personal-offset", production.personalOffsetKcalPerDay, "production-personal-offset", true),
  ];
  const selectedDoseKeys: string[] = [];
  for (const activity of input.activities) {
    selectedDoseKeys.push(activity.doseKey);
    if (activity.garminActiveKcal !== null) {
      entries.push(entry("garmin-device", activity.garminActiveKcal, "device-active-energy", false, [activity.kind], null, "diagnostic"));
    }
    if (activity.bodyCastEstimateKcal !== null) {
      entries.push(entry(activity.kind === "workout" ? "strength-shadow" : "stepper-shadow", activity.bodyCastEstimateKcal, "bodycast-experimental-estimate", false, [activity.kind, "garmin-device"], "diagnostic alternative; never additive", "diagnostic"));
    }
  }
  entries.push(entry("epoc-context", null, "epoc-not-applied", false, ["workout", "stepper"], input.epocApplied ? "EPOC application is forbidden in Unified V1" : null));
  const activityValues = [production.walkingKcalPerDay, production.occupationalKcalPerDay, production.workoutKcalPerDay, production.stepperKcalPerDay];
  const quality: UnifiedAvailabilityV1 = production.activityKcalPerDay === null || activityValues.some((value) => value === null)
    ? "partial"
    : "available";
  return {
    selectedActivityKcal: production.activityKcalPerDay,
    productionTdeeKcal: production.productionTdeeKcalPerDay,
    entries,
    selectedDoseKeys,
    quality,
  };
}
