import { describe, expect, it } from "vitest";
import { buildExerciseMuscleMappingSnapshotV7 } from "@/model/physiology-v7/exercise-muscle-mapping-v7";
import { buildQualifiedResistanceTrainingDoseV7 } from "@/model/physiology-v7/qualified-resistance-training-dose-v7";
import { buildResistanceTrainingAdaptationResponseV7, resistanceTrainingAdaptationResponseV7Fingerprint } from "@/model/physiology-v7/resistance-training-adaptation-response-v7";
import { buildResistanceTrainingExposureHistoryV7 } from "@/model/physiology-v7/resistance-training-exposure-history-v7";
import { buildCanonicalStrengthTrainingInputV7 } from "@/modules/model-episodes/strength-training-input-v7";
import { RESISTANCE } from "@/modules/training/training.constants";
import type { StrengthSessionDto } from "@/modules/training/training.types";

function dose(rir: number | null = null, name = "Press", weightKg = 20) {
  const session: StrengthSessionDto = { id: 1, status: "COMPLETED", entryMode: "RETROSPECTIVE", revision: 1, programId: 7, programName: "Program", programVersionId: 9, programVersionNumber: 1, webStartedAt: null, webEndedAt: null, matchStatus: "UNMATCHED", matchMethod: null, matchedAt: null, matchedWorkoutId: null, matchedWorkout: null, ordinaryTonnageKg: weightKg * 8, createdAt: "2026-09-18T00:00:00.000Z", updatedAt: "2026-09-18T00:00:00.000Z", exercises: [{ id: 1, sourceExerciseCatalogId: 1, stableKey: "seated_dumbbell_press", snapshotExerciseName: name, order: 1, plannedSets: 1, resistanceType: RESISTANCE.EXTERNAL_WEIGHT, origin: "PLANNED", muscleMappingSnapshot: buildExerciseMuscleMappingSnapshotV7("seated_dumbbell_press"), sets: [{ id: 1, sessionExerciseId: 1, setNumber: 1, reps: 8, weightKg, bandNominalResistanceKg: null, rir, comment: null, completedAt: null, createdAt: "2026-09-18T00:00:00.000Z", updatedAt: "2026-09-18T00:00:00.000Z" }] }] };
  return buildQualifiedResistanceTrainingDoseV7(buildCanonicalStrengthTrainingInputV7({ session, heartRateSamples: null }));
}

function history(kind: "qualified" | "unresolved" | "none" | "unobserved", rir: number | null = null) {
  const d = dose(rir);
  return buildResistanceTrainingExposureHistoryV7({ fromDate: "2026-09-18", toDate: "2026-09-18", days: [{ date: "2026-09-18", workoutFeedObserved: kind === "unobserved" ? null : true, sessions: kind === "qualified" || kind === "unresolved" ? [{ strengthDiarySessionId: 1, sessionRevision: 1, dose: kind === "unresolved" ? dose(2) : d }] : [], legacyStrengthWorkouts: kind === "unresolved" ? [{ workoutId: 2, localDate: "2026-09-18", matchedStrengthDiarySessionId: null }] : [] }] });
}

describe("ResistanceTrainingAdaptationResponseV7", () => {
  it("exposes qualified local stimulus without a muscle-mass transition or numeric score", () => {
    const response = buildResistanceTrainingAdaptationResponseV7({ date: "2026-09-18", exposureHistory: history("qualified"), proteinContext: { availability: "available", proteinG: 130, provenance: "observed" }, energyBalanceContext: { availability: "available", energyBalanceKcal: -250, provenance: "derived-model-state" } });
    expect(response.trainingStimulus).toMatchObject({ availability: "available", status: "qualified-mapped-training-dose", qualifiedHardSetCount: 1 });
    expect(response.trainingStimulus).toHaveProperty("muscleGroups");
    expect(response.muscleMassTransition).toMatchObject({ availability: "unavailable", reason: "no-approved-whole-body-calibration" });
    expect(response.calibration.highestSupportedResponseLevel).toBe("level-1-qualitative-constraints");
    expect(JSON.stringify(response)).not.toMatch(/skeletalMuscleDeltaKg|anabolicSignal|growthScore|kg\/day/i);
  });

  it("keeps unresolved legacy evidence, observed no-exposure, and unobserved coverage distinct", () => {
    expect(buildResistanceTrainingAdaptationResponseV7({ date: "2026-09-18", exposureHistory: history("unresolved") }).trainingStimulus.status).toBe("unresolved-training-dose");
    expect(buildResistanceTrainingAdaptationResponseV7({ date: "2026-09-18", exposureHistory: history("none") }).trainingStimulus.status).toBe("verified-observed-no-exposure");
    expect(buildResistanceTrainingAdaptationResponseV7({ date: "2026-09-18", exposureHistory: history("unobserved") }).trainingStimulus.status).toBe("unobserved-source-coverage");
  });

  it("preserves RIR provenance without a failure bonus or a high-RIR fallback", () => {
    const zero = buildResistanceTrainingAdaptationResponseV7({ date: "2026-09-18", exposureHistory: history("qualified", 0) });
    const one = buildResistanceTrainingAdaptationResponseV7({ date: "2026-09-18", exposureHistory: history("qualified", 1) });
    const high = buildResistanceTrainingAdaptationResponseV7({ date: "2026-09-18", exposureHistory: history("unresolved", 2) });
    expect(zero.trainingStimulus).toMatchObject({ qualifiedHardSetCount: 1 });
    expect(one.trainingStimulus).toMatchObject({ qualifiedHardSetCount: 1 });
    expect(high.trainingStimulus).toMatchObject({
      status: "unresolved-training-dose",
      setEffortEvidence: [{ status: "observed-rir-qualification-unresolved", rir: 2 }],
    });
  });

  it("keeps missing nutrition and energy unavailable rather than zero, and is deterministic", () => {
    const first = buildResistanceTrainingAdaptationResponseV7({ date: "2026-09-18", exposureHistory: history("qualified") });
    const second = buildResistanceTrainingAdaptationResponseV7({ date: "2026-09-18", exposureHistory: history("qualified") });
    expect(first.proteinContext).toEqual({ availability: "unavailable", reason: "missing-protein-source" });
    expect(first.energyBalanceContext).toEqual({ availability: "unavailable", reason: "missing-energy-balance-source" });
    expect(resistanceTrainingAdaptationResponseV7Fingerprint(first)).toBe(resistanceTrainingAdaptationResponseV7Fingerprint(second));
  });

  it("does not fingerprint display name, ordinary tonnage, or HR context through the scientific dose fingerprint", () => {
    const base = buildResistanceTrainingExposureHistoryV7({ fromDate: "2026-09-18", toDate: "2026-09-18", days: [{ date: "2026-09-18", workoutFeedObserved: true, sessions: [{ strengthDiarySessionId: 1, sessionRevision: 1, dose: dose(null, "Press", 20) }] }] });
    const renamed = buildResistanceTrainingExposureHistoryV7({ fromDate: "2026-09-18", toDate: "2026-09-18", days: [{ date: "2026-09-18", workoutFeedObserved: true, sessions: [{ strengthDiarySessionId: 1, sessionRevision: 1, dose: dose(null, "Renamed", 50) }] }] });
    expect(resistanceTrainingAdaptationResponseV7Fingerprint(buildResistanceTrainingAdaptationResponseV7({ date: "2026-09-18", exposureHistory: base }))).toBe(resistanceTrainingAdaptationResponseV7Fingerprint(buildResistanceTrainingAdaptationResponseV7({ date: "2026-09-18", exposureHistory: renamed })));
  });
});
