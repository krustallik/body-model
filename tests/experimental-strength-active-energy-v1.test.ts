import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  ENGINEERING_STRENGTH_NET_MET_V1,
  estimateExperimentalStrengthActiveEnergyV1,
  experimentalStrengthActiveEnergyV1Fingerprint,
  EXPERIMENTAL_STRENGTH_ACTIVE_ENERGY_V1_PROVENANCE,
  EXPERIMENTAL_STRENGTH_ACTIVE_ENERGY_V1_REVISION,
  extractExperimentalStrengthActiveEnergyFeaturesV1,
} from "@/modules/training/experimental-strength-active-energy-v1";
import { ENTRY_MODE, RESISTANCE, SESSION_STATUS } from "@/modules/training/training.constants";
import type { StrengthSessionDto } from "@/modules/training/training.types";
import { WORKOUT_RECOVERY_ENERGY_SCIENTIFIC_DECISION } from "@/model/activity/workout-energy";

function baseSession(
  overrides: Partial<StrengthSessionDto> = {},
  exercises?: StrengthSessionDto["exercises"],
): StrengthSessionDto {
  return {
    id: 1,
    status: SESSION_STATUS.COMPLETED,
    entryMode: ENTRY_MODE.LIVE,
    revision: 1,
    programId: 1,
    programName: "P",
    programVersionId: 1,
    programVersionNumber: 1,
    webStartedAt: "2026-09-18T10:00:00.000Z",
    webEndedAt: "2026-09-18T10:30:00.000Z",
    matchStatus: "MATCHED",
    matchMethod: "AUTO",
    matchedAt: null,
    matchedWorkoutId: 2,
    matchedWorkout: {
      id: 2,
      type: "strength_training",
      startAt: "2026-09-18T10:00:00.000Z",
      endAt: "2026-09-18T10:30:00.000Z",
      durationMinutes: 30,
      activeEnergyKcal: 180,
      externalId: null,
    },
    ordinaryTonnageKg: 1000,
    createdAt: "2026-09-18T10:00:00.000Z",
    updatedAt: "2026-09-18T10:30:00.000Z",
    exercises: exercises ?? [{
      id: 3,
      sourceExerciseCatalogId: 4,
      stableKey: "squat",
      snapshotExerciseName: "Squat",
      order: 1,
      plannedSets: 2,
      resistanceType: RESISTANCE.EXTERNAL_WEIGHT,
      origin: "PLANNED",
      muscleMappingSnapshot: null,
      sets: [
        {
          id: 5,
          sessionExerciseId: 3,
          setNumber: 1,
          reps: 8,
          weightKg: 50,
          bandNominalResistanceKg: null,
          rir: 2,
          comment: null,
          completedAt: "2026-09-18T10:10:00.000Z",
          createdAt: "2026-09-18T10:10:00.000Z",
          updatedAt: "2026-09-18T10:10:00.000Z",
        },
        {
          id: 6,
          sessionExerciseId: 3,
          setNumber: 2,
          reps: 8,
          weightKg: 50,
          bandNominalResistanceKg: null,
          rir: null,
          comment: null,
          completedAt: "2026-09-18T10:15:00.000Z",
          createdAt: "2026-09-18T10:15:00.000Z",
          updatedAt: "2026-09-18T10:15:00.000Z",
        },
      ],
    }],
    ...overrides,
  };
}

/**
 * EXPERIMENTAL harness — not scientific validation / GREEN oracle.
 */
describe("experimental strength active energy v1", () => {
  it("estimates positive active kcal for a valid LIVE session (C-K08)", () => {
    const result = estimateExperimentalStrengthActiveEnergyV1({
      session: baseSession(),
      bodyMassKg: 80,
      heartRateBpms: [120, 130, 140],
    });
    expect(result.availability).toBe("available");
    expect(result.estimatedActiveKcal!).toBeGreaterThan(0);
    expect(result.lowerBoundKcal!).toBeGreaterThan(0);
    expect(result.upperBoundKcal!).toBeGreaterThanOrEqual(result.estimatedActiveKcal!);
    expect(result.provenance).toBe(EXPERIMENTAL_STRENGTH_ACTIVE_ENERGY_V1_PROVENANCE);
    expect(result.contractVersion).toBe(EXPERIMENTAL_STRENGTH_ACTIVE_ENERGY_V1_REVISION);
    expect(result.supportedDomain).toBe("resistance-diary-session-shadow-only");
    expect(result.recoveryEnergy).toEqual(WORKOUT_RECOVERY_ENERGY_SCIENTIFIC_DECISION);
    expect(result.recoveryEnergy.addedKcal).toBeNull();
  });

  it("increases estimated energy with longer duration at matched intensity context", () => {
    const short = estimateExperimentalStrengthActiveEnergyV1({
      session: baseSession({
        webStartedAt: "2026-09-18T10:00:00.000Z",
        webEndedAt: "2026-09-18T10:20:00.000Z",
        matchedWorkout: {
          id: 2,
          type: "strength_training",
          startAt: "2026-09-18T10:00:00.000Z",
          endAt: "2026-09-18T10:20:00.000Z",
          durationMinutes: 20,
          activeEnergyKcal: null,
          externalId: null,
        },
      }),
      bodyMassKg: 80,
    });
    const long = estimateExperimentalStrengthActiveEnergyV1({
      session: baseSession({
        webStartedAt: "2026-09-18T10:00:00.000Z",
        webEndedAt: "2026-09-18T11:00:00.000Z",
        matchedWorkout: {
          id: 2,
          type: "strength_training",
          startAt: "2026-09-18T10:00:00.000Z",
          endAt: "2026-09-18T11:00:00.000Z",
          durationMinutes: 60,
          activeEnergyKcal: null,
          externalId: null,
        },
      }),
      bodyMassKg: 80,
    });
    expect(long.estimatedActiveKcal!).toBeGreaterThan(short.estimatedActiveKcal!);
  });

  it("increases estimated energy with higher body mass at matched duration", () => {
    const lighter = estimateExperimentalStrengthActiveEnergyV1({
      session: baseSession(),
      bodyMassKg: 60,
    });
    const heavier = estimateExperimentalStrengthActiveEnergyV1({
      session: baseSession(),
      bodyMassKg: 90,
    });
    expect(heavier.estimatedActiveKcal!).toBeGreaterThan(lighter.estimatedActiveKcal!);
    expect(heavier.estimatedActiveKcal! / lighter.estimatedActiveKcal!).toBeCloseTo(90 / 60, 5);
  });

  it("widens RETROSPECTIVE uncertainty and does not invent rest timing", () => {
    const live = estimateExperimentalStrengthActiveEnergyV1({
      session: baseSession({ entryMode: ENTRY_MODE.LIVE }),
      bodyMassKg: 80,
    });
    const retro = estimateExperimentalStrengthActiveEnergyV1({
      session: baseSession({
        entryMode: ENTRY_MODE.RETROSPECTIVE,
        webStartedAt: null,
        webEndedAt: null,
      }),
      bodyMassKg: 80,
    });
    expect(live.features.timingQuality).toBe("completion-times-complete");
    expect(retro.features.densityScale).toBe(1);
    expect(retro.reasons).toContain("retrospective-or-untimed-no-invented-rest-timing");
    expect(retro.features.rejectedMethods).toContain("invented-retrospective-rest-timing");
    const liveWidth = live.upperBoundKcal! - live.lowerBoundKcal!;
    const retroWidth = retro.upperBoundKcal! - retro.lowerBoundKcal!;
    expect(retroWidth).toBeGreaterThan(liveWidth);
  });

  it("treats missing evidence as unavailable, not zero kcal", () => {
    const missingMass = estimateExperimentalStrengthActiveEnergyV1({
      session: baseSession(),
      bodyMassKg: null,
    });
    const missingDuration = estimateExperimentalStrengthActiveEnergyV1({
      session: baseSession({
        webStartedAt: null,
        webEndedAt: null,
        matchedWorkout: null,
        matchedWorkoutId: null,
      }),
      bodyMassKg: 80,
    });
    const missingSets = estimateExperimentalStrengthActiveEnergyV1({
      session: baseSession({}, [{
        id: 3,
        sourceExerciseCatalogId: 4,
        stableKey: "squat",
        snapshotExerciseName: "Squat",
        order: 1,
        plannedSets: 2,
        resistanceType: RESISTANCE.EXTERNAL_WEIGHT,
        origin: "PLANNED",
        muscleMappingSnapshot: null,
        sets: [],
      }]),
      bodyMassKg: 80,
    });
    for (const result of [missingMass, missingDuration, missingSets]) {
      expect(result.availability).toBe("unavailable");
      expect(result.estimatedActiveKcal).toBeNull();
      expect(result.lowerBoundKcal).toBeNull();
      expect(result.upperBoundKcal).toBeNull();
      expect(result.reasons).toContain("missing-evidence-is-not-zero-kcal");
    }
  });

  it("keeps Garmin active kcal as optional reference and never as estimation target", () => {
    const withGarmin = estimateExperimentalStrengthActiveEnergyV1({
      session: baseSession(),
      bodyMassKg: 80,
    });
    const withoutGarmin = estimateExperimentalStrengthActiveEnergyV1({
      session: baseSession({
        matchedWorkout: {
          id: 2,
          type: "strength_training",
          startAt: "2026-09-18T10:00:00.000Z",
          endAt: "2026-09-18T10:30:00.000Z",
          durationMinutes: 30,
          activeEnergyKcal: null,
          externalId: null,
        },
      }),
      bodyMassKg: 80,
    });
    expect(withGarmin.estimatedActiveKcal).toBe(withoutGarmin.estimatedActiveKcal);
    expect(withGarmin.garminReferenceKcal).toBe(180);
    expect(withoutGarmin.garminReferenceKcal).toBeNull();
    expect(withGarmin.features.rejectedMethods).toContain("garmin-truth-calibration");
  });

  it("uses HR and RIR only as context, never as kcal drivers", () => {
    const baseline = estimateExperimentalStrengthActiveEnergyV1({
      session: baseSession(),
      bodyMassKg: 80,
    });
    const withHr = estimateExperimentalStrengthActiveEnergyV1({
      session: baseSession(),
      bodyMassKg: 80,
      heartRateBpms: [160, 170, 180, 175],
    });
    const highRir = estimateExperimentalStrengthActiveEnergyV1({
      session: baseSession({}, [{
        id: 3,
        sourceExerciseCatalogId: 4,
        stableKey: "squat",
        snapshotExerciseName: "Squat",
        order: 1,
        plannedSets: 2,
        resistanceType: RESISTANCE.EXTERNAL_WEIGHT,
        origin: "PLANNED",
        muscleMappingSnapshot: null,
        sets: [
          {
            id: 5,
            sessionExerciseId: 3,
            setNumber: 1,
            reps: 8,
            weightKg: 50,
            bandNominalResistanceKg: null,
            rir: 8,
            comment: null,
            completedAt: "2026-09-18T10:10:00.000Z",
            createdAt: "2026-09-18T10:10:00.000Z",
            updatedAt: "2026-09-18T10:10:00.000Z",
          },
          {
            id: 6,
            sessionExerciseId: 3,
            setNumber: 2,
            reps: 8,
            weightKg: 50,
            bandNominalResistanceKg: null,
            rir: 9,
            comment: null,
            completedAt: "2026-09-18T10:15:00.000Z",
            createdAt: "2026-09-18T10:15:00.000Z",
            updatedAt: "2026-09-18T10:15:00.000Z",
          },
        ],
      }]),
      bodyMassKg: 80,
    });
    expect(withHr.estimatedActiveKcal).toBe(baseline.estimatedActiveKcal);
    expect(highRir.estimatedActiveKcal).toBe(baseline.estimatedActiveKcal);
    expect(withHr.features.hrCoverage).toBe("contextual");
    expect(highRir.features.rirReportedSetCount).toBe(2);
    expect(withHr.features.rejectedMethods).toContain("hr-to-kcal-formula");
    expect(highRir.features.rejectedMethods).toContain("rir-to-kcal-coefficient");
  });

  it("does not use a tonnage-only shortcut for energy", () => {
    const lowTonnageLong = estimateExperimentalStrengthActiveEnergyV1({
      session: baseSession({
        ordinaryTonnageKg: 200,
        webStartedAt: "2026-09-18T10:00:00.000Z",
        webEndedAt: "2026-09-18T11:00:00.000Z",
        matchedWorkout: {
          id: 2,
          type: "strength_training",
          startAt: "2026-09-18T10:00:00.000Z",
          endAt: "2026-09-18T11:00:00.000Z",
          durationMinutes: 60,
          activeEnergyKcal: null,
          externalId: null,
        },
      }),
      bodyMassKg: 80,
    });
    const highTonnageShort = estimateExperimentalStrengthActiveEnergyV1({
      session: baseSession({
        ordinaryTonnageKg: 5000,
        webStartedAt: "2026-09-18T10:00:00.000Z",
        webEndedAt: "2026-09-18T10:20:00.000Z",
        matchedWorkout: {
          id: 2,
          type: "strength_training",
          startAt: "2026-09-18T10:00:00.000Z",
          endAt: "2026-09-18T10:20:00.000Z",
          durationMinutes: 20,
          activeEnergyKcal: null,
          externalId: null,
        },
      }),
      bodyMassKg: 80,
    });
    // Longer session wins despite much lower tonnage — not a tonnage coefficient.
    expect(lowTonnageLong.estimatedActiveKcal!).toBeGreaterThan(highTonnageShort.estimatedActiveKcal!);
    expect(lowTonnageLong.features.rejectedMethods).toContain("kcal-per-tonnage-coefficient");
    expect(JSON.stringify(lowTonnageLong)).not.toMatch(/kcalPerSet|kcalPerRep|tonnageCoefficient/i);
  });

  it("is deterministic for identical inputs", () => {
    const input = { session: baseSession(), bodyMassKg: 82.5, heartRateBpms: [120, 125] as const };
    const a = estimateExperimentalStrengthActiveEnergyV1(input);
    const b = estimateExperimentalStrengthActiveEnergyV1(input);
    expect(a).toEqual(b);
    expect(experimentalStrengthActiveEnergyV1Fingerprint(a))
      .toBe(experimentalStrengthActiveEnergyV1Fingerprint(b));
  });

  it("exposes engineering intensity priors without claiming scientific MET truth", () => {
    const features = extractExperimentalStrengthActiveEnergyFeaturesV1({
      session: baseSession(),
      bodyMassKg: 80,
    });
    expect(ENGINEERING_STRENGTH_NET_MET_V1.classification).toBe("engineering-session-intensity-prior");
    expect(features.netMetPoint).toBeGreaterThan(0);
    expect(features.rejectedMethods).toContain("fixed-single-met-fallback");
  });

  it("does not appear in production TDEE, forecast, or workout-energy resolver paths", () => {
    const workoutEnergy = readFileSync("src/model/activity/workout-energy.ts", "utf8");
    const forecast = readFileSync("src/modules/model-forecast/forecast-engine.ts", "utf8");
    const strengthMet = readFileSync("src/model/activity/strength.ts", "utf8");
    expect(workoutEnergy).not.toContain("estimateExperimentalStrengthActiveEnergyV1");
    expect(forecast).not.toContain("estimateExperimentalStrengthActiveEnergyV1");
    expect(strengthMet).not.toContain("estimateExperimentalStrengthActiveEnergyV1");
  });
});
