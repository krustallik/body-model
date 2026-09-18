import { describe, expect, it } from "vitest";
import {
  estimateExperimentalStrengthActiveEnergyV1,
  extractExperimentalStrengthActiveEnergyFeaturesV1,
} from "@/modules/training/experimental-strength-active-energy-v1";
import { ENTRY_MODE, RESISTANCE, SESSION_STATUS } from "@/modules/training/training.constants";
import type { StrengthSessionDto } from "@/modules/training/training.types";

const session = {
  id: 1, status: SESSION_STATUS.COMPLETED, entryMode: ENTRY_MODE.LIVE, revision: 1,
  programId: 1, programName: "P", programVersionId: 1, programVersionNumber: 1,
  webStartedAt: "2026-09-18T10:00:00.000Z", webEndedAt: "2026-09-18T10:30:00.000Z",
  matchStatus: "MATCHED", matchMethod: "AUTO", matchedAt: null, matchedWorkoutId: 2,
  matchedWorkout: { id: 2, type: "strength_training", startAt: "2026-09-18T10:00:00.000Z", endAt: "2026-09-18T10:30:00.000Z", durationMinutes: 30, activeEnergyKcal: 180, externalId: null },
  ordinaryTonnageKg: 1000, createdAt: "2026-09-18T10:00:00.000Z", updatedAt: "2026-09-18T10:30:00.000Z",
  exercises: [{ id: 3, sourceExerciseCatalogId: 4, stableKey: "squat", snapshotExerciseName: "Squat", order: 1, plannedSets: 2, resistanceType: RESISTANCE.EXTERNAL_WEIGHT, origin: "PLANNED", muscleMappingSnapshot: null, sets: [
    { id: 5, sessionExerciseId: 3, setNumber: 1, reps: 8, weightKg: 50, bandNominalResistanceKg: null, rir: 2, comment: null, completedAt: "2026-09-18T10:10:00.000Z", createdAt: "2026-09-18T10:10:00.000Z", updatedAt: "2026-09-18T10:10:00.000Z" },
    { id: 6, sessionExerciseId: 3, setNumber: 2, reps: 8, weightKg: 50, bandNominalResistanceKg: null, rir: null, comment: null, completedAt: "2026-09-18T10:15:00.000Z", createdAt: "2026-09-18T10:15:00.000Z", updatedAt: "2026-09-18T10:15:00.000Z" },
  ] }],
} satisfies StrengthSessionDto;

describe("experimental strength energy shadow compatibility", () => {
  it("preserves source coverage and estimates via V1 without treating missing as zero", () => {
    const features = extractExperimentalStrengthActiveEnergyFeaturesV1({
      session,
      bodyMassKg: 80,
      heartRateBpms: [120, 130, 140],
    });
    const result = estimateExperimentalStrengthActiveEnergyV1({
      session,
      bodyMassKg: 80,
      heartRateBpms: [120, 130, 140],
    });
    expect(features.timingQuality).toBe("completion-times-complete");
    expect(features.interCompletionMedianSeconds).toBe(300);
    expect(result.availability).toBe("available");
    expect(result.estimatedActiveKcal).toBeGreaterThan(0);
    expect(result.garminReferenceKcal).toBe(180);
    expect(estimateExperimentalStrengthActiveEnergyV1({
      session,
      bodyMassKg: null,
    }).estimatedActiveKcal).toBeNull();
  });
});
