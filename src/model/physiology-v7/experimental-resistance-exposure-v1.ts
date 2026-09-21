import type { ExperimentalTrainingExposureKindV1 } from "./experimental-skeletal-muscle-delta-v1";

/**
 * Canonical, deliberately conservative evidence classifier shared by the
 * experimental muscle, cessation, FFM and glycogen shadows.  It separates an
 * observed training signal from a quantified resistance dose: an unresolved
 * workout is never evidence of rest.
 */
export type ExperimentalResistanceExposureEvidenceV1 = {
  diaryQualifiedMapped: boolean;
  diaryTrainingObserved: boolean;
  canonicalStrengthObserved: boolean;
  workoutFeedObserved: boolean | null;
};

export type ExperimentalResistanceExposureClassificationV1 = {
  kind: ExperimentalTrainingExposureKindV1;
  doseStatus: "mapped" | "unresolved-dose" | "verified-no-exposure" | "unobserved";
  reason: string;
};

export function classifyExperimentalResistanceExposureV1(
  evidence: ExperimentalResistanceExposureEvidenceV1,
): ExperimentalResistanceExposureClassificationV1 {
  if (evidence.diaryQualifiedMapped) {
    return { kind: "qualified-mapped-training", doseStatus: "mapped", reason: "bodycast-diary-mapped-dose-primary" };
  }
  if (evidence.diaryTrainingObserved || evidence.canonicalStrengthObserved) {
    return { kind: "unresolved-missing-training", doseStatus: "unresolved-dose", reason: "observed-strength-training-dose-unresolved" };
  }
  if (evidence.workoutFeedObserved === true) {
    return { kind: "verified-no-exposure", doseStatus: "verified-no-exposure", reason: "observed-workout-feed-without-strength-evidence" };
  }
  return { kind: "unresolved-missing-training", doseStatus: "unobserved", reason: "workout-feed-missing-or-unobserved" };
}
