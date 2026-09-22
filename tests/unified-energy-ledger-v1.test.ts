import { describe, expect, it } from "vitest";
import { buildUnifiedEnergyLedgerV1 } from "@/model/unified-experimental-physiology-v1";

const production = {
  dynamicRmrKcalPerDay: 1_800,
  tefKcalPerDay: 220,
  walkingKcalPerDay: 200,
  occupationalKcalPerDay: 150,
  workoutKcalPerDay: 500,
  stepperKcalPerDay: 300,
  activityKcalPerDay: 1_150,
  adaptiveThermogenesisKcalPerDay: -40,
  personalOffsetKcalPerDay: 25,
  productionTdeeKcalPerDay: 3_155,
};

describe("Unified V1 energy ledger", () => {
  it("selects production activity exactly once and keeps alternatives diagnostic", () => {
    const ledger = buildUnifiedEnergyLedgerV1({
      production,
      activities: [
        { doseKey: "workout:1", kind: "workout", garminActiveKcal: 500, bodyCastEstimateKcal: 430 },
        { doseKey: "stepper:2", kind: "stepper", garminActiveKcal: 300, bodyCastEstimateKcal: 280 },
      ],
    });
    expect(ledger.selectedActivityKcal).toBe(1_150);
    expect(ledger.selectedDoseKeys).toEqual(["workout:1", "stepper:2"]);
    expect(ledger.entries.filter((entry) => entry.status === "selected").map((entry) => entry.kind))
      .toEqual(["dynamic-rmr", "tef", "walking", "occupational", "workout", "stepper", "adaptive-thermogenesis", "personal-offset"]);
    expect(ledger.entries.filter((entry) => entry.status === "diagnostic").map((entry) => entry.kind))
      .toEqual(["garmin-device", "strength-shadow", "garmin-device", "stepper-shadow"]);
  });

  it("does not turn missing activity into zero or apply hidden EPOC", () => {
    const ledger = buildUnifiedEnergyLedgerV1({
      production: { ...production, activityKcalPerDay: null, walkingKcalPerDay: null },
      activities: [],
      epocApplied: true,
    });
    expect(ledger.selectedActivityKcal).toBeNull();
    expect(ledger.quality).toBe("partial");
    expect(ledger.entries.find((entry) => entry.kind === "epoc-context")?.valueKcal).toBeNull();
  });
});
