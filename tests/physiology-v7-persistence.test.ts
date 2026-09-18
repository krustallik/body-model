import { describe, expect, it } from "vitest";
import { stableSha256 } from "@/modules/model-recovery/recovery-fingerprint";
import {
  assertFiniteScientificNumbers,
  deserializePhysiologyDayResultV7,
  mergeEarliestStaleDate,
  persistedResultFingerprint,
  serializePhysiologyDayResultV7,
  versionsAreCurrent,
  currentPhysiologyV7Versions,
} from "@/modules/model-episodes/physiology-v7-persistence";
import {
  buildPhysiologyDayV7,
  runtimeStateFromStructuralStateV7,
} from "@/model/physiology-v7/daily-runtime-v7";
import { buildResistanceTrainingExposureHistoryFromSourcesV7 } from "@/model/physiology-v7/resistance-training-exposure-history-sources-v7";
import { observedNutritionProvenance } from "@/modules/model-episodes/nutrition-gap-bridge";

function result() {
  const date = "2049-01-02";
  const priorState = runtimeStateFromStructuralStateV7({
    fatMassKg: 20,
    skeletalMuscleKg: 31,
    otherLeanTissueKg: null,
    glycogenKg: null,
    glycogenWaterKg: null,
    ecfDeviationKg: null,
    transientExerciseWaterKg: null,
    adaptiveThermogenesisKcalPerDay: null,
    weightFilterState: null,
  });
  return buildPhysiologyDayV7({
    date,
    priorState,
    sources: {
      date,
      observedWeightKg: 81.2,
      observedBodyFatPercent: 20,
      nutrition: {
        caloriesKcal: 2_300, proteinG: 150, fatG: 75, carbsG: 250,
        provenance: observedNutritionProvenance(),
      },
      workoutFeedObserved: true,
      steps: 0,
      walkingRunningDistanceKm: 0,
      workouts: [],
      stepperWorkouts: [],
      context: { heartRateSampleCount: 0, restingHeartRateSampleCount: 0, sleepSegmentCount: 0 },
    },
    exposureHistory: buildResistanceTrainingExposureHistoryFromSourcesV7({
      fromDate: date, toDate: date,
      days: [{ date, workoutFeedObserved: true }], strengthWorkouts: [], sessions: [],
    }),
  });
}

describe("v7 persistence semantic contract", () => {
  it("canonical hashing ignores object key order but preserves meaningful array order", () => {
    expect(stableSha256({ a: 1, b: 2 })).toBe(stableSha256({ b: 2, a: 1 }));
    expect(stableSha256({ values: [1, 2] })).not.toBe(stableSha256({ values: [2, 1] }));
    expect(stableSha256({ values: [...new Set([2, 1])].sort() }))
      .toBe(stableSha256({ values: [...new Set([1, 2])].sort() }));
  });

  it("round-trips known, carried-forward and unavailable without null-to-zero", () => {
    const original = result();
    const restored = deserializePhysiologyDayResultV7(serializePhysiologyDayResultV7(original));
    expect(restored.resultingState.compartments.fatMassKg).toMatchObject({
      availability: "available", transitionStatus: "carried-forward", valueKg: 20,
      provenance: "carried-forward-prior-state", biologicalTransition: "not-modeled",
    });
    expect(restored.resultingState.compartments.skeletalMuscleKg).toMatchObject({
      availability: "available", transitionStatus: "carried-forward", valueKg: 31,
      stateHandling: "carry-forward-for-simulation", biologicalTransition: "not-modeled",
    });
    expect(restored.resultingState.compartments.otherLeanTissueKg).toMatchObject({
      availability: "unavailable", valueKg: null, transitionStatus: "unavailable",
    });
    expect(JSON.stringify(restored.resultingState.compartments.otherLeanTissueKg))
      .not.toContain('"valueKg":0');
  });

  it("keeps observed weight separate from unavailable reconstructed mass", () => {
    const restored = deserializePhysiologyDayResultV7(serializePhysiologyDayResultV7(result()));
    expect(restored.observations.observedWeightKg).toMatchObject({ valueKg: 81.2 });
    expect(restored.massReconstruction).toEqual({
      availability: "unavailable",
      valueKg: null,
      reason: "one-or-more-required-compartments-unavailable",
    });
  });

  it("fingerprints scientific result independently of operational metadata", () => {
    const day = result();
    expect(persistedResultFingerprint(day)).toBe(persistedResultFingerprint(structuredClone(day)));
    expect(stableSha256({ result: day, computedAt: "a" }))
      .not.toBe(stableSha256({ result: day, computedAt: "b" }));
    expect(persistedResultFingerprint(day)).toBe(persistedResultFingerprint(day));
  });

  it("distinguishes missing from observed zero source semantics", () => {
    const base = result();
    const missing = structuredClone(base);
    missing.energyNutrition.evidence.carbsG = null;
    missing.energyNutrition.evidence.provenance.source = "missing";
    const observedZero = structuredClone(base);
    observedZero.energyNutrition.evidence.carbsG = 0;
    expect(stableSha256(missing.energyNutrition.evidence))
      .not.toBe(stableSha256(observedZero.energyNutrition.evidence));
  });

  it("merges stale dates monotonically toward the past", () => {
    expect(mergeEarliestStaleDate(null, "2049-01-10")).toBe("2049-01-10");
    expect(mergeEarliestStaleDate("2049-01-10", "2049-01-14")).toBe("2049-01-10");
    expect(mergeEarliestStaleDate("2049-01-10", "2049-01-04")).toBe("2049-01-04");
  });

  it("detects runtime and normalization incompatibility", () => {
    expect(versionsAreCurrent(currentPhysiologyV7Versions)).toBe(true);
    expect(versionsAreCurrent({ ...currentPhysiologyV7Versions, dailyRuntimeVersion: "old" }))
      .toBe(false);
    expect(versionsAreCurrent({ ...currentPhysiologyV7Versions, sourceNormalizationVersion: "old" }))
      .toBe(false);
  });

  it("rejects NaN and Infinity before persistence", () => {
    expect(() => assertFiniteScientificNumbers({ value: Number.NaN })).toThrow(/non-finite/);
    expect(() => assertFiniteScientificNumbers({ value: Number.POSITIVE_INFINITY }))
      .toThrow(/non-finite/);
  });
});
