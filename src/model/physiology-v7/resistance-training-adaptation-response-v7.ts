import type { SetEffortEvidenceV7 } from "@/model/physiology-v7/qualified-resistance-training-dose-v7";
import { buildQualifiedResistanceTrainingDoseV7 } from "@/model/physiology-v7/qualified-resistance-training-dose-v7";
import {
  type ResistanceTrainingDayExposureV7,
  type ResistanceTrainingExposureHistoryV7,
  buildResistanceTrainingExposureHistoryV7,
} from "@/model/physiology-v7/resistance-training-exposure-history-v7";
import {
  buildSkeletalMuscleResponseCalibrationV7,
  type SkeletalMuscleResponseCalibrationV7,
} from "@/model/physiology-v7/skeletal-muscle-response-calibration-v7";
import { buildExerciseMuscleMappingSnapshotV7 } from "@/model/physiology-v7/exercise-muscle-mapping-v7";
import { buildCanonicalStrengthTrainingInputV7 } from "@/modules/model-episodes/strength-training-input-v7";
import { stableSha256 } from "@/modules/model-recovery/recovery-fingerprint";
import { RESISTANCE } from "@/modules/training/training.constants";
import type { StrengthSessionDto } from "@/modules/training/training.types";

/**
 * Qualitative seam between recorded resistance-training evidence and a future,
 * separately calibrated skeletal-muscle transition. It deliberately produces no
 * tissue-mass estimate, dose-response coefficient, or nutrition modifier.
 */
export const RESISTANCE_TRAINING_ADAPTATION_RESPONSE_V7_VERSION =
  "bodycast-resistance-training-adaptation-response-v7-3" as const;

/**
 * P-A07 / C-A06: no approved universal sets/session or sets/week cutoff.
 * Level-1 expected local adaptation must not become zero or negative solely
 * because a fixed set count was crossed.
 */
export const RESISTANCE_TRAINING_VOLUME_CAP_POLICY_V7 = {
  component: "universal-set-count-cutoff",
  application: "intentionally-not-applied",
  parameterId: "P-A07",
  scientificDecision: "deferred-insufficient-evidence-for-hard-cap",
  researchAuthority: "workout-physiology-v7-audit",
  forcesZeroOrNegativeSolelyByCrossing: false,
} as const;

export type ResistanceTrainingVolumeCapPolicyV7 =
  typeof RESISTANCE_TRAINING_VOLUME_CAP_POLICY_V7;

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

/**
 * Level-1 qualitative expected local adaptation. Not a kg model and not a
 * numeric hypertrophy formula — polarity only, with explicit non-application
 * of a universal set cutoff (P-A07).
 */
export type Level1ExpectedLocalAdaptationV7 =
  | {
    availability: "available";
    responseLevel: "level-1-qualitative-constraints";
    expectedPolarity: "nonnegative-stimulus-evidence";
    qualifiedHardSetCount: number;
    volumeCapPolicy: ResistanceTrainingVolumeCapPolicyV7;
    cutoffForcedZeroOrNegative: false;
  }
  | {
    availability: "unavailable";
    reason: "no-qualified-mapped-training-dose" | "no-qualified-hard-sets";
    expectedPolarity: "no-qualified-stimulus";
    volumeCapPolicy: ResistanceTrainingVolumeCapPolicyV7;
    cutoffForcedZeroOrNegative: false;
  };

export type ResistanceTrainingAdaptationResponseV7 = {
  contractVersion: typeof RESISTANCE_TRAINING_ADAPTATION_RESPONSE_V7_VERSION;
  date: string;
  trainingStimulus: ResistanceTrainingStimulusV7;
  /**
   * Level-1 expected local adaptation derived from qualified dose. Never forced
   * to zero/negative by a universal set-count cutoff.
   */
  expectedLocalAdaptation: Level1ExpectedLocalAdaptationV7;
  /** Recent training facts only; no detraining curve, threshold, or bonus. */
  recentExposureHistory: Pick<ResistanceTrainingExposureHistoryV7, "weekWindowKind" | "weeklyAggregates" | "resumptionEvents">;
  proteinContext: ResistanceTrainingProteinContextV7;
  energyBalanceContext: ResistanceTrainingEnergyBalanceContextV7;
  trainingExperience: { availability: "unavailable"; reason: "no-defensible-training-status-source" };
  programNovelty: { availability: "unavailable"; reason: "no-approved-program-novelty-response" };
  calibration: SkeletalMuscleResponseCalibrationV7;
  muscleMassTransition: SkeletalMuscleResponseCalibrationV7["quantitativeTransition"];
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

/**
 * Runtime Level-1 evaluation: qualified set dose yields nonnegative stimulus
 * evidence at any count. No threshold zeroes or negates expected adaptation.
 */
export function evaluateLevel1ExpectedLocalAdaptationV7(
  stimulus: ResistanceTrainingStimulusV7,
): Level1ExpectedLocalAdaptationV7 {
  if (stimulus.availability === "available") {
    if (stimulus.qualifiedHardSetCount <= 0) {
      return {
        availability: "unavailable",
        reason: "no-qualified-hard-sets",
        expectedPolarity: "no-qualified-stimulus",
        volumeCapPolicy: RESISTANCE_TRAINING_VOLUME_CAP_POLICY_V7,
        cutoffForcedZeroOrNegative: false,
      };
    }
    return {
      availability: "available",
      responseLevel: "level-1-qualitative-constraints",
      expectedPolarity: "nonnegative-stimulus-evidence",
      qualifiedHardSetCount: stimulus.qualifiedHardSetCount,
      volumeCapPolicy: RESISTANCE_TRAINING_VOLUME_CAP_POLICY_V7,
      cutoffForcedZeroOrNegative: false,
    };
  }
  return {
    availability: "unavailable",
    reason: "no-qualified-mapped-training-dose",
    expectedPolarity: "no-qualified-stimulus",
    volumeCapPolicy: RESISTANCE_TRAINING_VOLUME_CAP_POLICY_V7,
    cutoffForcedZeroOrNegative: false,
  };
}

function doseWithQualifiedSetCount(setCount: number) {
  if (!Number.isInteger(setCount) || setCount < 1) {
    throw new RangeError("setCount must be an integer >= 1");
  }
  const snapshot = buildExerciseMuscleMappingSnapshotV7("incline_dumbbell_press_30deg");
  const sets = Array.from({ length: setCount }, (_, index) => ({
    id: index + 1,
    sessionExerciseId: 1,
    setNumber: index + 1,
    reps: 8,
    weightKg: 20,
    bandNominalResistanceKg: null,
    rir: null as number | null,
    comment: null,
    completedAt: null,
    createdAt: "2026-09-18T17:00:00.000Z",
    updatedAt: "2026-09-18T17:00:00.000Z",
  }));
  const session: StrengthSessionDto = {
    id: 1,
    status: "COMPLETED",
    entryMode: "RETROSPECTIVE",
    revision: 1,
    programId: 7,
    programName: "Press",
    programVersionId: 9,
    programVersionNumber: 1,
    webStartedAt: null,
    webEndedAt: null,
    matchStatus: "MATCHED",
    matchMethod: "DIRECT_BACKFILL",
    matchedAt: "2026-09-18T18:30:00.000Z",
    matchedWorkoutId: 99,
    matchedWorkout: {
      id: 99,
      type: "Strength Training",
      startAt: "2026-09-18T17:00:00.000Z",
      endAt: "2026-09-18T18:00:00.000Z",
      durationMinutes: 60,
      activeEnergyKcal: 400,
      externalId: "garmin-a06",
    },
    ordinaryTonnageKg: 20 * 8 * setCount,
    createdAt: "2026-09-18T00:00:00.000Z",
    updatedAt: "2026-09-18T00:00:00.000Z",
    exercises: [{
      id: 1,
      sourceExerciseCatalogId: 10,
      stableKey: "incline_dumbbell_press_30deg",
      snapshotExerciseName: "Incline DB press",
      order: 1,
      plannedSets: setCount,
      resistanceType: RESISTANCE.EXTERNAL_WEIGHT,
      origin: "PLANNED",
      muscleMappingSnapshot: snapshot,
      sets,
    }],
  };
  return buildQualifiedResistanceTrainingDoseV7(
    buildCanonicalStrengthTrainingInputV7({ session, heartRateSamples: null }),
  );
}

/**
 * Executable C-A06 scenario seam: increasing valid set dose through the real
 * qualified-dose → exposure → Level-1 adaptation path.
 */
export function buildIncreasingQualifiedSetDoseAdaptationSeriesV7(
  setCounts: readonly number[],
): Array<{
  qualifiedHardSetCount: number;
  response: ResistanceTrainingAdaptationResponseV7;
  expectedLocalAdaptation: Level1ExpectedLocalAdaptationV7;
}> {
  return setCounts.map((setCount) => {
    const dose = doseWithQualifiedSetCount(setCount);
    const exposureHistory = buildResistanceTrainingExposureHistoryV7({
      fromDate: "2026-09-18",
      toDate: "2026-09-18",
      days: [{
        date: "2026-09-18",
        workoutFeedObserved: true,
        sessions: [{ strengthDiarySessionId: 1, sessionRevision: 1, dose }],
        legacyStrengthWorkouts: [],
      }],
    });
    const response = buildResistanceTrainingAdaptationResponseV7({
      date: "2026-09-18",
      exposureHistory,
    });
    return {
      qualifiedHardSetCount: setCount,
      response,
      expectedLocalAdaptation: response.expectedLocalAdaptation,
    };
  });
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
  const calibration = buildSkeletalMuscleResponseCalibrationV7();
  const trainingStimulus = stimulusFromDay(day);
  return {
    contractVersion: RESISTANCE_TRAINING_ADAPTATION_RESPONSE_V7_VERSION,
    date: input.date,
    trainingStimulus,
    expectedLocalAdaptation: evaluateLevel1ExpectedLocalAdaptationV7(trainingStimulus),
    recentExposureHistory: {
      weekWindowKind: input.exposureHistory.weekWindowKind,
      weeklyAggregates: input.exposureHistory.weeklyAggregates.map((week) => ({ ...week })),
      resumptionEvents: input.exposureHistory.resumptionEvents.map((event) => ({ ...event })),
    },
    proteinContext: input.proteinContext ?? { availability: "unavailable", reason: "missing-protein-source" },
    energyBalanceContext: input.energyBalanceContext ?? { availability: "unavailable", reason: "missing-energy-balance-source" },
    trainingExperience: { availability: "unavailable", reason: "no-defensible-training-status-source" },
    programNovelty: { availability: "unavailable", reason: "no-approved-program-novelty-response" },
    calibration,
    muscleMassTransition: calibration.quantitativeTransition,
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
    expectedLocalAdaptation: response.expectedLocalAdaptation,
    exposureHistoryFingerprint: stableSha256({
      weekWindowKind: response.recentExposureHistory.weekWindowKind,
      weeklyAggregates: response.recentExposureHistory.weeklyAggregates,
      resumptionEvents: response.recentExposureHistory.resumptionEvents,
    }),
    proteinContext: response.proteinContext,
    energyBalanceContext: response.energyBalanceContext,
    calibration: response.calibration,
    muscleMassTransition: response.muscleMassTransition,
  });
}
