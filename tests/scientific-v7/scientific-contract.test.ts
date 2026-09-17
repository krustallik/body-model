import { describe, expect, it } from "vitest";
import {
  calculateExtracellularFluidLiters,
  calculateExtracellularFluidMassKg,
  calculateGlycogenAssociatedMassKg,
  calculateGlycogenAssociatedWaterKg,
  reconstructBodyWeightKg,
  type BodyCompositionState,
} from "@/model/body-composition/state";
import {
  createGlycogenParameters,
  stepGlycogenOneDay,
} from "@/model/body-composition/glycogen";
import {
  missingPhysiologicalTransitionFields,
  type PhysiologicalDailyInput,
} from "@/model/physiological-simulator";
import {
  resolveExplicitWorkoutActivityKcal,
  type ExplicitWorkoutActivityEvent,
} from "@/model/activity/workout-energy";

const completeDay: PhysiologicalDailyInput = {
  date: "2026-09-17",
  caloriesKcal: 2_400,
  proteinG: 140,
  fatG: 80,
  carbsG: 280,
  outsideWorkWalkingDistanceKm: 0,
  averageWalkingSpeedKmh: null,
  strengthTrainingMinutes: 0,
  occupationalActivity: { category: null, durationHours: 0 },
  sodiumChangeMgPerDay: 0,
  measuredWeightKg: null,
};

function stairEvent(activeEnergyKcal: number): ExplicitWorkoutActivityEvent {
  return {
    type: "Stair Climbing",
    canonicalType: "Stair Climbing",
    classification: "stair-climbing",
    startAt: "2026-09-17T16:00:00.000Z",
    endAt: "2026-09-17T16:20:00.000Z",
    durationMinutes: 20,
    activeEnergyKcal,
  };
}

describe("scientific v7 contract — currently reachable audited behavior", () => {
  it("missing protein remains unavailable rather than becoming measured zero", () => {
    const missing = missingPhysiologicalTransitionFields(
      { ...completeDay, proteinG: null },
      "full",
    );
    const measuredZero = missingPhysiologicalTransitionFields(
      { ...completeDay, proteinG: 0 },
      "full",
    );

    expect(missing).toContain("proteinG");
    expect(measuredZero).not.toContain("proteinG");
  });

  it("more carbohydrate from the same depleted state does not reduce glycogen restoration", () => {
    const parameters = createGlycogenParameters({ baselineCarbIntakeG: 250 });
    const lower = stepGlycogenOneDay({
      currentGlycogenKg: 0.3,
      carbIntakeG: 150,
      parameters,
    });
    const higher = stepGlycogenOneDay({
      currentGlycogenKg: 0.3,
      carbIntakeG: 300,
      parameters,
    });

    expect(lower).not.toBeNull();
    expect(higher).not.toBeNull();
    expect(higher!.glycogenKg).toBeGreaterThanOrEqual(lower!.glycogenKg);
  });

  it("glycogen-associated water co-moves without asserting a universal ratio", () => {
    const lower = calculateGlycogenAssociatedWaterKg(0.3);
    const higher = calculateGlycogenAssociatedWaterKg(0.4);

    expect(lower).toBeGreaterThanOrEqual(0);
    expect(higher).toBeGreaterThan(lower);
  });

  it("body-weight reconstruction counts glycogen-associated mass exactly once", () => {
    const state: BodyCompositionState = {
      fatMassKg: 18,
      leanTissueKg: 46,
      glycogenKg: 0.4,
      baselineExtracellularFluidLiters: 12,
      extracellularFluidDeviationLiters: 0.2,
    };
    const expectedComponentSum = state.fatMassKg
      + state.leanTissueKg
      + calculateGlycogenAssociatedMassKg(state.glycogenKg)
      + calculateExtracellularFluidMassKg(calculateExtracellularFluidLiters(state));

    expect(reconstructBodyWeightKg(state)).toBe(expectedComponentSum);
  });

  it("changing glycogen-associated mass does not change lean tissue", () => {
    const lower: BodyCompositionState = {
      fatMassKg: 18,
      leanTissueKg: 46,
      glycogenKg: 0.3,
      baselineExtracellularFluidLiters: 12,
      extracellularFluidDeviationLiters: 0,
    };
    const higher: BodyCompositionState = { ...lower, glycogenKg: 0.4 };

    expect(higher.leanTissueKg).toBe(lower.leanTissueKg);
    expect(reconstructBodyWeightKg(higher)).toBeGreaterThan(reconstructBodyWeightKg(lower));
  });

  it("device active energy retains estimate provenance", () => {
    const result = resolveExplicitWorkoutActivityKcal({
      events: [stairEvent(211)],
      weightKg: 80,
      rmrKcalPerDay: 1_700,
    });

    expect(result.perEvent).toEqual([{
      classification: "stair-climbing",
      source: "device-active-kcal",
      kcal: 211,
    }]);
  });

  it("device active energy is counted once without a resting-energy adjustment", () => {
    const result = resolveExplicitWorkoutActivityKcal({
      events: [stairEvent(211)],
      weightKg: 80,
      rmrKcalPerDay: 1_700,
    });

    expect(result.deviceActiveEnergyKcal).toBe(211);
    expect(result.strengthMetFallbackKcal).toBe(0);
    expect(result.workoutActivityKcal).toBe(211);
  });

  it("observed workout active energy receives no automatic EPOC add-on", () => {
    const result = resolveExplicitWorkoutActivityKcal({
      events: [stairEvent(211)],
      weightKg: 80,
      rmrKcalPerDay: 1_700,
    });

    expect(result.workoutActivityKcal).toBe(result.deviceActiveEnergyKcal);
  });

  it("workout energy is not multiplied by a universal EPOC percentage", () => {
    const first = resolveExplicitWorkoutActivityKcal({
      events: [stairEvent(200)],
      weightKg: 80,
      rmrKcalPerDay: 1_700,
    });
    const second = resolveExplicitWorkoutActivityKcal({
      events: [stairEvent(400)],
      weightKg: 80,
      rmrKcalPerDay: 1_700,
    });

    expect(first.workoutActivityKcal).toBe(200);
    expect(second.workoutActivityKcal).toBe(400);
  });

  it("the represented workout active-energy interval is counted exactly once", () => {
    const result = resolveExplicitWorkoutActivityKcal({
      events: [stairEvent(120), stairEvent(90)],
      weightKg: 80,
      rmrKcalPerDay: 1_700,
    });

    expect(result.workoutActivityKcal).toBe(120 + 90);
    expect(result.deviceActiveEnergyKcal).toBe(result.workoutActivityKcal);
  });
});
