import { describe, expect, it } from "vitest";
import { classifyExperimentalResistanceExposureV1 } from "@/model/physiology-v7/experimental-resistance-exposure-v1";
import { transitionExperimentalCessationDetrainingV1 } from "@/model/physiology-v7/experimental-cessation-detraining-v1";
import { resolveExperimentalStrengthActiveEnergyV1, type ExperimentalStrengthActiveEnergyResultV1 } from "@/modules/training/experimental-strength-active-energy-v1";

describe("Experimental resistance exposure V1", () => {
  it("keeps BodyCast mapped diary dose primary without Garmin", () => {
    expect(classifyExperimentalResistanceExposureV1({ diaryQualifiedMapped: true, diaryTrainingObserved: true, canonicalStrengthObserved: false, workoutFeedObserved: true })).toMatchObject({ kind: "qualified-mapped-training", doseStatus: "mapped" });
  });

  it("does not turn Garmin-only strength into rest", () => {
    expect(classifyExperimentalResistanceExposureV1({ diaryQualifiedMapped: false, diaryTrainingObserved: false, canonicalStrengthObserved: true, workoutFeedObserved: true })).toMatchObject({ kind: "unresolved-missing-training", doseStatus: "unresolved-dose" });
  });

  it("does not turn an unmatched live session into rest", () => {
    expect(classifyExperimentalResistanceExposureV1({ diaryQualifiedMapped: false, diaryTrainingObserved: true, canonicalStrengthObserved: false, workoutFeedObserved: true })).toMatchObject({ kind: "unresolved-missing-training", doseStatus: "unresolved-dose" });
  });

  it("recognizes only an observed feed without strength evidence as rest", () => {
    expect(classifyExperimentalResistanceExposureV1({ diaryQualifiedMapped: false, diaryTrainingObserved: false, canonicalStrengthObserved: false, workoutFeedObserved: true })).toMatchObject({ kind: "verified-no-exposure" });
    expect(classifyExperimentalResistanceExposureV1({ diaryQualifiedMapped: false, diaryTrainingObserved: false, canonicalStrengthObserved: false, workoutFeedObserved: null })).toMatchObject({ kind: "unresolved-missing-training", doseStatus: "unobserved" });
  });

  it("does not advance a verified cessation streak on unresolved training", () => {
    const trained = transitionExperimentalCessationDetrainingV1({ exposureKind: "qualified-mapped-training", trainingSkeletalMuscleDeltaKg: 0 });
    const rest = transitionExperimentalCessationDetrainingV1({ exposureKind: "verified-no-exposure", prior: trained.state });
    const unresolved = transitionExperimentalCessationDetrainingV1({ exposureKind: "unresolved-missing-training", prior: rest.state });
    expect(unresolved.state.observedNoExposureStreakDays).toBe(rest.state.observedNoExposureStreakDays);
    expect(unresolved.state.phase).toBe("unknown-coverage-not-cessation");
  });

  it("uses Garmin active kcal only when the diary estimator is unavailable", () => {
    const unavailable = { availability: "unavailable", estimatedActiveKcal: null } as ExperimentalStrengthActiveEnergyResultV1;
    expect(resolveExperimentalStrengthActiveEnergyV1({ bodycast: unavailable, matchedGarminActiveKcal: 123 })).toMatchObject({ source: "device-estimate-fallback", provenance: "device-estimate", estimatedActiveKcal: 123 });
  });
});
