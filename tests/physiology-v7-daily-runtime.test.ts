import { describe, expect, it } from "vitest";
import { PHYSIOLOGY_V7_DAILY_TRANSITION_ORDER } from "@/model/physiology-v7/contracts";
import {
  buildPhysiologyDayV7,
  createUnavailablePhysiologyRuntimeStateV7,
  runtimeStateFromStructuralStateV7,
} from "@/model/physiology-v7/daily-runtime-v7";
import { rebuildPhysiologyRangeV7 } from "@/model/physiology-v7/rebuild-v7";
import { buildResistanceTrainingExposureHistoryFromSourcesV7 } from "@/model/physiology-v7/resistance-training-exposure-history-sources-v7";
import type { PhysiologyV7State } from "@/model/physiology-v7/state";
import { observedNutritionProvenance } from "@/modules/model-episodes/nutrition-gap-bridge";

const completeNutrition = {
  caloriesKcal: 2_300,
  proteinG: 150,
  fatG: 75,
  carbsG: 250,
  provenance: observedNutritionProvenance(),
};

const unavailableStructuralState: PhysiologyV7State = {
  fatMassKg: null,
  skeletalMuscleKg: null,
  otherLeanTissueKg: null,
  glycogenKg: null,
  glycogenWaterKg: null,
  ecfDeviationKg: null,
  transientExerciseWaterKg: null,
  adaptiveThermogenesisKcalPerDay: null,
  weightFilterState: null,
};

const sources = (date: string, overrides: Record<string, unknown> = {}) => ({
  date,
  observedWeightKg: 80,
  observedBodyFatPercent: 20,
  nutrition: structuredClone(completeNutrition),
  workoutFeedObserved: true,
  steps: 8_000,
  walkingRunningDistanceKm: 6,
  workouts: [],
  stepperWorkouts: [],
  context: {
    heartRateSampleCount: 0,
    restingHeartRateSampleCount: 0,
    sleepSegmentCount: 0,
  },
  ...overrides,
});

const exposure = (date: string, workoutFeedObserved = true) =>
  buildResistanceTrainingExposureHistoryFromSourcesV7({
    fromDate: date,
    toDate: date,
    days: [{ date, workoutFeedObserved }],
    strengthWorkouts: [],
    sessions: [],
  });

describe("Physiology v7 daily runtime contract", () => {
  it("executes the canonical Stage-5 transition order with Stage 7 and Stage 8 slots", () => {
    const date = "2026-09-01";
    const result = buildPhysiologyDayV7({
      date,
      priorState: createUnavailablePhysiologyRuntimeStateV7(),
      sources: sources(date),
      exposureHistory: exposure(date),
    });

    expect(result.transitionOrder).toEqual(PHYSIOLOGY_V7_DAILY_TRANSITION_ORDER);
    expect(result.trainingAdaptation.transitionSlot).toBe("training-adaptation-transition-slot");
    expect(result.fluidWater.glycogen.transitionSlot).toBe("glycogen-transition-slot");
    expect(result.fluidWater.glycogenWater.transitionSlot).toBe("fluid-water-transition-slot");
    expect(result.fluidWater.transientExerciseWaterEcf.transitionSlot)
      .toBe("fluid-water-transition-slot");
  });

  it("preserves a wholly unavailable initial state without null-to-zero substitution", () => {
    const date = "2026-09-01";
    const result = buildPhysiologyDayV7({
      date,
      priorState: runtimeStateFromStructuralStateV7(unavailableStructuralState),
      sources: sources(date),
      exposureHistory: exposure(date),
    });

    expect(Object.values(result.resultingState.compartments)
      .every((value) => value.availability === "unavailable")).toBe(true);
    expect(result.massReconstruction).toEqual({
      availability: "unavailable",
      valueKg: null,
      reason: "one-or-more-required-compartments-unavailable",
    });
    expect(result.observations.observedWeightKg).toEqual({
      availability: "available",
      valueKg: 80,
      provenance: "daily-health-data-observation",
    });
  });

  it("carries a prior muscle number only as simulation bookkeeping", () => {
    const date = "2026-09-01";
    const prior = runtimeStateFromStructuralStateV7({
      ...unavailableStructuralState,
      skeletalMuscleKg: 31,
    });
    const result = buildPhysiologyDayV7({
      date,
      priorState: prior,
      sources: sources(date),
      exposureHistory: exposure(date),
    });

    expect(result.resultingState.compartments.skeletalMuscleKg).toMatchObject({
      availability: "available",
      valueKg: 31,
      transitionStatus: "carried-forward",
      stateHandling: "carry-forward-for-simulation",
      biologicalTransition: "not-modeled",
    });
  });

  it("keeps missing carbohydrate unknown even when other nutrition is observed", () => {
    const date = "2026-09-01";
    const nutrition = {
      ...completeNutrition,
      carbsG: null,
      provenance: {
        ...completeNutrition.provenance,
        source: "missing" as const,
        observedFields: ["caloriesKcal", "proteinG", "fatG"] as const,
        imputedFields: ["carbsG"] as const,
      },
    };
    const result = buildPhysiologyDayV7({
      date,
      priorState: createUnavailablePhysiologyRuntimeStateV7(),
      sources: sources(date, { nutrition }),
      exposureHistory: exposure(date),
    });
    expect(result.fluidWater.glycogen.carbohydrateEvidence).toMatchObject({
      availability: "unavailable",
    });
    expect(result.fluidWater.state.glycogenKg).toBeNull();
  });

  it("keeps contextual HR and display metadata outside scientific results", () => {
    const date = "2026-09-01";
    const base = {
      date,
      priorState: createUnavailablePhysiologyRuntimeStateV7(),
      sources: sources(date),
      exposureHistory: exposure(date),
    };
    const changed = {
      ...base,
      sources: sources(date, {
        context: {
          heartRateSampleCount: 99,
          restingHeartRateSampleCount: 4,
          sleepSegmentCount: 3,
          displayMetadata: { workoutName: "Renamed only" },
        },
      }),
    };
    const left = buildPhysiologyDayV7(base);
    const right = buildPhysiologyDayV7(changed);
    expect(right.scientificFingerprint).toBe(left.scientificFingerprint);
    expect(right.resultingState).toEqual(left.resultingState);
  });
});

describe("Physiology v7 deterministic rebuild", () => {
  it("is deterministic and changes only the corrected day and downstream chain", () => {
    const range = {
      fromDate: "2026-09-01",
      toDate: "2026-09-03",
      initialState: createUnavailablePhysiologyRuntimeStateV7(),
      sources: {
        days: [
          sources("2026-09-01"),
          sources("2026-09-02"),
          sources("2026-09-03"),
        ],
        exposure: {
          historyFromDate: "2026-09-01",
          days: [
            { date: "2026-09-01", workoutFeedObserved: true },
            { date: "2026-09-02", workoutFeedObserved: true },
            { date: "2026-09-03", workoutFeedObserved: true },
          ],
          strengthWorkouts: [],
          sessions: [],
        },
      },
    };
    const first = rebuildPhysiologyRangeV7(range);
    const repeat = rebuildPhysiologyRangeV7(structuredClone(range));
    expect(repeat).toEqual(first);

    const corrected = structuredClone(range);
    corrected.sources.days[1]!.nutrition.carbsG = 275;
    const after = rebuildPhysiologyRangeV7(corrected);
    expect(after.days[0]!.fingerprint).toBe(first.days[0]!.fingerprint);
    expect(after.days[1]!.fingerprint).not.toBe(first.days[1]!.fingerprint);
    expect(after.days[2]!.priorStateFingerprint)
      .not.toBe(first.days[2]!.priorStateFingerprint);
  });
});
