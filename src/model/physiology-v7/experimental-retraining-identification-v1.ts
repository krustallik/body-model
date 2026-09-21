import {
  ENGINEERING_CESSATION_GRACE_DAYS_V1,
  rebuildExperimentalCessationDetrainingTrajectoryV1,
  type ExperimentalCessationDetrainingResultV1,
  type ExperimentalCessationStateV1,
} from "./experimental-cessation-detraining-v1";
import type { ExperimentalTrainingExposureKindV1 } from "./experimental-skeletal-muscle-delta-v1";
import { stableSha256 } from "@/modules/model-recovery/recovery-fingerprint";

/**
 * Experimental Retraining Identification V1 (shadow only).
 *
 * Identifies qualified training that follows a verified, grace-qualified
 * cessation/detraining episode. It is a label over the cessation trajectory:
 * it never changes protein, energy, training-status, or skeletal-muscle math.
 */
export const EXPERIMENTAL_RETRAINING_IDENTIFICATION_V1_REVISION =
  "experimental-retraining-identification-v1" as const;
export const EXPERIMENTAL_RETRAINING_IDENTIFICATION_V1_PROVENANCE =
  "experimental-heuristic" as const;

export const EXPERIMENTAL_RETRAINING_IDENTIFICATION_V1_PRIORS = {
  qualifyingVerifiedNoExposureDays: ENGINEERING_CESSATION_GRACE_DAYS_V1,
  classification: "engineering-reused-cessation-identification-threshold-not-universal" as const,
  scientificDecision: "no-universal-retraining-duration-threshold-claimed" as const,
  noQuantitativeMemoryBonus: true,
} as const;

export type ExperimentalRetrainingStatusV1 =
  | "experimental-identified"
  | "not-identified"
  | "insufficient-evidence";

export type ExperimentalRetrainingIdentificationResultV1 = {
  contractVersion: typeof EXPERIMENTAL_RETRAINING_IDENTIFICATION_V1_REVISION;
  provenance: typeof EXPERIMENTAL_RETRAINING_IDENTIFICATION_V1_PROVENANCE;
  supportedDomain: "retraining-identification-shadow-only";
  availability: "available" | "unavailable";
  retrainingStatus: ExperimentalRetrainingStatusV1;
  qualifyingCessationDays: number | null;
  retrainingLabelApplied: boolean;
  skeletalMuscleDeltaKgUnchanged: number;
  skeletalMuscleDeltaModificationKg: 0;
  quantitativeMemoryBonus: null;
  acceleratedGrowthCoefficient: null;
  trainingStatusMathChanged: false;
  proteinEnergyMathChanged: false;
  reasons: string[];
  fingerprint: string;
};

function finish(
  partial: Omit<ExperimentalRetrainingIdentificationResultV1, "fingerprint">,
): ExperimentalRetrainingIdentificationResultV1 {
  const result: ExperimentalRetrainingIdentificationResultV1 = { ...partial, fingerprint: "" };
  result.fingerprint = experimentalRetrainingIdentificationV1Fingerprint(result);
  return result;
}

/**
 * Labels only a qualified training resumption immediately following verified
 * `detraining`. `detraining` itself is emitted by the existing cessation
 * contract only after its explicit engineering grace threshold.
 */
export function identifyExperimentalRetrainingV1(input: {
  priorCessation: ExperimentalCessationDetrainingResultV1 | null;
  currentCessation: ExperimentalCessationDetrainingResultV1;
}): ExperimentalRetrainingIdentificationResultV1 {
  const currentExposure = input.currentCessation.features.exposureKind;
  const unchangedDelta = input.currentCessation.estimatedSkeletalMuscleDeltaKg;
  const base = {
    contractVersion: EXPERIMENTAL_RETRAINING_IDENTIFICATION_V1_REVISION,
    provenance: EXPERIMENTAL_RETRAINING_IDENTIFICATION_V1_PROVENANCE,
    supportedDomain: "retraining-identification-shadow-only" as const,
    retrainingLabelApplied: false as const,
    skeletalMuscleDeltaKgUnchanged: unchangedDelta,
    skeletalMuscleDeltaModificationKg: 0 as const,
    quantitativeMemoryBonus: null,
    acceleratedGrowthCoefficient: null,
    trainingStatusMathChanged: false as const,
    proteinEnergyMathChanged: false as const,
  };
  if (currentExposure !== "qualified-mapped-training") {
    return finish({
      ...base,
      availability: currentExposure === "unresolved-missing-training" ? "unavailable" : "available",
      retrainingStatus: currentExposure === "unresolved-missing-training"
        ? "insufficient-evidence"
        : "not-identified",
      qualifyingCessationDays: null,
      reasons: [
        "retraining-requires-qualified-training-resumption",
        "missing-workout-feed-does-not-establish-retraining",
        "retraining-label-does-not-modify-skeletal-muscle-delta",
      ],
    });
  }
  if (input.priorCessation === null
    || input.priorCessation.state.phase === "unknown-coverage-not-cessation") {
    return finish({
      ...base,
      availability: "unavailable",
      retrainingStatus: "insufficient-evidence",
      qualifyingCessationDays: null,
      reasons: [
        "missing-or-unknown-coverage-does-not-establish-retraining",
        "retraining-label-does-not-modify-skeletal-muscle-delta",
      ],
    });
  }
  if (input.priorCessation.state.phase !== "detraining") {
    return finish({
      ...base,
      availability: "available",
      retrainingStatus: "not-identified",
      qualifyingCessationDays: input.priorCessation.state.observedNoExposureStreakDays,
      reasons: [
        "ordinary-rest-or-short-verified-gap-is-not-retraining",
        "engineering-cessation-threshold-not-universal-retraining-claim",
        "retraining-label-does-not-modify-skeletal-muscle-delta",
      ],
    });
  }
  return finish({
    ...base,
    availability: "available",
    retrainingStatus: "experimental-identified",
    retrainingLabelApplied: true,
    qualifyingCessationDays: input.priorCessation.state.observedNoExposureStreakDays,
    reasons: [
      "qualified-training-follows-verified-grace-qualified-detraining",
      "engineering-cessation-threshold-not-universal-retraining-claim",
      "no-numeric-muscle-memory-bonus-or-accelerated-growth-coefficient",
      "retraining-label-does-not-modify-skeletal-muscle-delta",
    ],
  });
}

/** Deterministic chronological rebuild using the existing cessation transition unchanged. */
export function rebuildExperimentalRetrainingIdentificationTrajectoryV1(input: {
  prior?: ExperimentalCessationStateV1 | null;
  days: readonly {
    date: string;
    exposureKind: ExperimentalTrainingExposureKindV1;
    trainingSkeletalMuscleDeltaKg?: number | null;
  }[];
}): Array<{
  date: string;
  cessation: ExperimentalCessationDetrainingResultV1;
  retraining: ExperimentalRetrainingIdentificationResultV1;
}> {
  const cessation = rebuildExperimentalCessationDetrainingTrajectoryV1(input);
  return cessation.map((current, index) => ({
    date: input.days[index]!.date,
    cessation: current,
    retraining: identifyExperimentalRetrainingV1({
      priorCessation: index === 0 ? null : cessation[index - 1]!,
      currentCessation: current,
    }),
  }));
}

export function experimentalRetrainingIdentificationV1Fingerprint(
  result: Omit<ExperimentalRetrainingIdentificationResultV1, "fingerprint"> & { fingerprint?: string },
): string {
  const rest = { ...result };
  delete rest.fingerprint;
  return stableSha256(rest);
}
