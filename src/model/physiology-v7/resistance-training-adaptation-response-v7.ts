import type { SetEffortEvidenceV7 } from "@/model/physiology-v7/qualified-resistance-training-dose-v7";
import {
  type ResistanceTrainingDayExposureV7,
  type ResistanceTrainingExposureHistoryV7,
} from "@/model/physiology-v7/resistance-training-exposure-history-v7";
import { stableSha256 } from "@/modules/model-recovery/recovery-fingerprint";

/**
 * Qualitative seam between recorded resistance-training evidence and a future,
 * separately calibrated skeletal-muscle transition. It deliberately produces no
 * tissue-mass estimate, dose-response coefficient, or nutrition modifier.
 */
export const RESISTANCE_TRAINING_ADAPTATION_RESPONSE_V7_VERSION =
  "bodycast-resistance-training-adaptation-response-v7-1" as const;

export type ResistanceTrainingProteinContextV7 =
  | { availability: "available"; proteinG: number; provenance: "observed" | "imputed-local" | "imputed-fallback" }
  | { availability: "unavailable"; reason: "missing-protein-source" };

export type ResistanceTrainingEnergyBalanceContextV7 =
  | { availability: "available"; energyBalanceKcal: number; provenance: "derived-model-state" }
  | { availability: "unavailable"; reason: "missing-energy-balance-source" };

export type ResistanceTrainingStimulusV7 =
  | {
    availability: "available";
    status: "qualified-mapped-training-dose";
    qualifiedHardSetCount: number;
    muscleGroups: ResistanceTrainingDayExposureV7["muscleGroups"];
    setEffortEvidence: SetEffortEvidenceV7[];
  }
  | {
    availability: "unavailable";
    status: "unresolved-training-dose";
    reason: "legacy-or-unqualified-training-evidence";
    /** Present when an unresolved diary set carried observed effort evidence. */
    setEffortEvidence: SetEffortEvidenceV7[];
  }
  | { availability: "unavailable"; status: "verified-observed-no-exposure"; reason: "no-resistance-training-exposure-observed" }
  | { availability: "unavailable"; status: "unobserved-source-coverage"; reason: "workout-feed-unobserved" };

export type ResistanceTrainingAdaptationResponseV7 = {
  contractVersion: typeof RESISTANCE_TRAINING_ADAPTATION_RESPONSE_V7_VERSION;
  date: string;
  trainingStimulus: ResistanceTrainingStimulusV7;
  /** Recent training facts only; no detraining curve, threshold, or bonus. */
  recentExposureHistory: Pick<ResistanceTrainingExposureHistoryV7, "weekWindowKind" | "weeklyAggregates" | "resumptionEvents">;
  proteinContext: ResistanceTrainingProteinContextV7;
  energyBalanceContext: ResistanceTrainingEnergyBalanceContextV7;
  trainingExperience: { availability: "unavailable"; reason: "no-defensible-training-status-source" };
  programNovelty: { availability: "unavailable"; reason: "no-approved-program-novelty-response" };
  muscleMassTransition: { availability: "unavailable"; reason: "no-approved-whole-body-calibration" };
};

function stimulusFromDay(day: ResistanceTrainingDayExposureV7): ResistanceTrainingStimulusV7 {
  if (day.kind === "observed-mapped-exposure") {
    const doses = day.sessions.map(({ dose }) => dose).filter((dose) => dose.availability === "available");
    return {
      availability: "available",
      status: "qualified-mapped-training-dose",
      qualifiedHardSetCount: day.mappedSetCount,
      muscleGroups: day.muscleGroups.map((group) => ({ ...group })),
      setEffortEvidence: doses.flatMap((dose) => dose.setEffortEvidence.map(({ evidence }) => ({ ...evidence }))),
    };
  }
  if (day.kind === "unresolved-dose") {
    return {
      availability: "unavailable",
      status: "unresolved-training-dose",
      reason: "legacy-or-unqualified-training-evidence",
      setEffortEvidence: day.sessions.flatMap(({ dose }) => (
        dose.availability === "available"
          ? dose.setEffortEvidence.map(({ evidence }) => ({ ...evidence }))
          : []
      )),
    };
  }
  if (day.kind === "observed-no-exposure") {
    return { availability: "unavailable", status: "verified-observed-no-exposure", reason: "no-resistance-training-exposure-observed" };
  }
  return { availability: "unavailable", status: "unobserved-source-coverage", reason: "workout-feed-unobserved" };
}

/** Pure rebuild from durable training history and explicitly supplied context. */
export function buildResistanceTrainingAdaptationResponseV7(input: {
  date: string;
  exposureHistory: ResistanceTrainingExposureHistoryV7;
  proteinContext?: ResistanceTrainingProteinContextV7;
  energyBalanceContext?: ResistanceTrainingEnergyBalanceContextV7;
}): ResistanceTrainingAdaptationResponseV7 {
  const day = input.exposureHistory.days.find((candidate) => candidate.date === input.date);
  if (!day) throw new RangeError("date must be within exposureHistory");
  return {
    contractVersion: RESISTANCE_TRAINING_ADAPTATION_RESPONSE_V7_VERSION,
    date: input.date,
    trainingStimulus: stimulusFromDay(day),
    recentExposureHistory: {
      weekWindowKind: input.exposureHistory.weekWindowKind,
      weeklyAggregates: input.exposureHistory.weeklyAggregates.map((week) => ({ ...week })),
      resumptionEvents: input.exposureHistory.resumptionEvents.map((event) => ({ ...event })),
    },
    proteinContext: input.proteinContext ?? { availability: "unavailable", reason: "missing-protein-source" },
    energyBalanceContext: input.energyBalanceContext ?? { availability: "unavailable", reason: "missing-energy-balance-source" },
    trainingExperience: { availability: "unavailable", reason: "no-defensible-training-status-source" },
    programNovelty: { availability: "unavailable", reason: "no-approved-program-novelty-response" },
    muscleMassTransition: { availability: "unavailable", reason: "no-approved-whole-body-calibration" },
  };
}

/** Excludes display metadata, ordinary tonnage, and HR because none is a response input. */
export function resistanceTrainingAdaptationResponseV7Fingerprint(
  response: ResistanceTrainingAdaptationResponseV7,
): string {
  return stableSha256({
    contractVersion: response.contractVersion,
    date: response.date,
    trainingStimulus: response.trainingStimulus,
    exposureHistoryFingerprint: stableSha256({
      weekWindowKind: response.recentExposureHistory.weekWindowKind,
      weeklyAggregates: response.recentExposureHistory.weeklyAggregates,
      resumptionEvents: response.recentExposureHistory.resumptionEvents,
    }),
    proteinContext: response.proteinContext,
    energyBalanceContext: response.energyBalanceContext,
    muscleMassTransition: response.muscleMassTransition,
  });
}
