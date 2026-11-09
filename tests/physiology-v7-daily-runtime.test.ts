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

const sources = (date: string, overrides: Record<string, unknown> = {}) => {
  const observedWeightKg = Object.hasOwn(overrides, "observedWeightKg")
    ? overrides.observedWeightKg as number | null
    : 80;
  return {
    date,
    observedWeightKg,
    weightFilterObservation: typeof observedWeightKg === "number"
      ? { snapshotId: 1, weightKg: observedWeightKg, receivedAt: `${date}T12:00:00.000Z` }
      : null,
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
  };
};

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
    expect(result.resultingState.weightFilterState?.estimatedWeightKg).toBe(80);
    expect(result.observations.weightFilterObservation).toEqual({
      snapshotId: 1,
      valueKg: 80,
      receivedAt: `${date}T12:00:00.000Z`,
      provenance: "immutable-health-sync-snapshot",
    });
  });

  it("assimilates scale observations into the separate filter without changing V7 compartments", () => {
    const date = "2026-09-01";
    const prior = runtimeStateFromStructuralStateV7({
      fatMassKg: 24,
      skeletalMuscleKg: 31,
      otherLeanTissueKg: 19,
      glycogenKg: 0.5,
      glycogenWaterKg: 1.35,
      ecfDeviationKg: 0,
      transientExerciseWaterKg: 0,
      adaptiveThermogenesisKcalPerDay: 0,
      weightFilterState: { estimatedWeightKg: 80, varianceKg2: 0.25 },
    });
    const input = {
      date,
      priorState: prior,
      exposureHistory: exposure(date),
      sources: sources(date, { observedWeightKg: 80 }),
    };
    const baseline = buildPhysiologyDayV7(input);
    const withNewScaleObservation = buildPhysiologyDayV7({
      ...input,
      sources: sources(date, { observedWeightKg: 88 }),
    });

    expect(withNewScaleObservation.observations.observedWeightKg).toMatchObject({
      availability: "available",
      valueKg: 88,
    });
    expect(withNewScaleObservation.resultingState.compartments)
      .toEqual(baseline.resultingState.compartments);
    expect(baseline.resultingState.weightFilterState?.estimatedWeightKg).toBe(80);
    expect(withNewScaleObservation.resultingState.weightFilterState?.estimatedWeightKg)
      .toBeGreaterThan(baseline.resultingState.weightFilterState!.estimatedWeightKg);
    expect(withNewScaleObservation.resultingState.weightFilterState?.estimatedWeightKg)
      .toBeLessThan(88);
    expect(withNewScaleObservation.resultingState.weightFilterState?.varianceKg2)
      .toBeLessThan(prior.weightFilterState!.varianceKg2);
  });

  it("carries a new weighing forward causally and only changes observation uncertainty between weigh-ins", () => {
    const fromDate = "2026-09-01";
    const dates = [fromDate, "2026-09-02", "2026-09-03"];
    const result = rebuildPhysiologyRangeV7({
      fromDate,
      toDate: dates.at(-1)!,
      initialState: runtimeStateFromStructuralStateV7({
        fatMassKg: 24,
        skeletalMuscleKg: 31,
        otherLeanTissueKg: 19,
        glycogenKg: 0.5,
        glycogenWaterKg: 1.35,
        ecfDeviationKg: 0,
        transientExerciseWaterKg: 0,
        adaptiveThermogenesisKcalPerDay: 0,
        weightFilterState: { estimatedWeightKg: 80, varianceKg2: 0.25 },
      }),
      sources: {
        days: [
          sources(dates[0]!, { observedWeightKg: 80.5 }),
          sources(dates[1]!, { observedWeightKg: null }),
          sources(dates[2]!, { observedWeightKg: 81 }),
        ],
        exposure: {
          historyFromDate: fromDate,
          days: dates.map((date) => ({ date, workoutFeedObserved: true })),
          strengthWorkouts: [],
          sessions: [],
        },
      },
    });

    const [first, noWeighIn, nextWeighIn] = result.days;
    expect(first!.resultingState.weightFilterState!.estimatedWeightKg).toBeGreaterThan(80);
    expect(first!.resultingState.weightFilterState!.estimatedWeightKg).toBeLessThan(80.5);
    expect(noWeighIn!.resultingState.weightFilterState!.estimatedWeightKg)
      .toBe(first!.resultingState.weightFilterState!.estimatedWeightKg);
    expect(noWeighIn!.resultingState.weightFilterState!.varianceKg2)
      .toBeGreaterThan(first!.resultingState.weightFilterState!.varianceKg2);
    expect(nextWeighIn!.resultingState.weightFilterState!.estimatedWeightKg)
      .toBeGreaterThan(noWeighIn!.resultingState.weightFilterState!.estimatedWeightKg);
    expect(result.days.map((day) => day.resultingState.compartments))
      .toEqual([first!.resultingState.compartments, first!.resultingState.compartments, first!.resultingState.compartments]);
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

  it("keeps database surrogate ids outside scientific source identity", () => {
    const date = "2026-09-01";
    const workout = {
      type: "Traditional Strength Training",
      startAt: "2026-09-01T16:00:00.000Z",
      endAt: "2026-09-01T17:00:00.000Z",
      durationMinutes: 60,
      activeEnergyKcal: 300,
    };
    const build = (workoutId: number) => buildPhysiologyDayV7({
      date,
      priorState: createUnavailablePhysiologyRuntimeStateV7(),
      sources: sources(date, { workouts: [{ workoutId, ...workout }] }),
      exposureHistory: buildResistanceTrainingExposureHistoryFromSourcesV7({
        fromDate: date,
        toDate: date,
        days: [{ date, workoutFeedObserved: true }],
        strengthWorkouts: [{
          workoutId,
          localDate: date,
          type: workout.type,
          matchedStrengthDiarySessionId: null,
        }],
        sessions: [],
      }),
    });
    expect(build(10).inputSourceFingerprint).toBe(build(999).inputSourceFingerprint);
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
