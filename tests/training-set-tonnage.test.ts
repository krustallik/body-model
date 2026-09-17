import { describe, expect, it } from "vitest";
import { CANONICAL_EXERCISE_IDENTITIES } from "@/modules/training/canonical-exercise-identity";
import {
  approvedExternalLoadAccountingCoverageV1,
  externalWeightEntryLabel,
  lookupExternalLoadAccountingV1,
} from "@/modules/training/external-load-accounting";
import { RESISTANCE } from "@/modules/training/training.constants";
import { ordinaryExternalWeightTonnageKg } from "@/modules/training/training.tonnage";
import { validateSetFields } from "@/modules/training/training.set-validation";
import { buildExerciseMuscleMappingSnapshotV7 } from "@/model/physiology-v7/exercise-muscle-mapping-v7";
import {
  buildQualifiedResistanceTrainingDoseV7,
  qualifiedResistanceTrainingDoseV7Fingerprint,
} from "@/model/physiology-v7/qualified-resistance-training-dose-v7";
import { buildCanonicalStrengthTrainingInputV7 } from "@/modules/model-episodes/strength-training-input-v7";
import type { StrengthSessionDto } from "@/modules/training/training.types";

describe("validateSetFields", () => {
  it("accepts EXTERNAL_WEIGHT with weightKg and null band", () => {
    expect(validateSetFields(RESISTANCE.EXTERNAL_WEIGHT, {
      reps: 10,
      weightKg: 30,
      bandNominalResistanceKg: null,
    rir: null,
    })).toEqual({
      ok: true,
      reps: 10,
      weightKg: 30,
      bandNominalResistanceKg: null,
    rir: null,
    });
  });

  it("accepts RESISTANCE_BAND with band only", () => {
    expect(validateSetFields(RESISTANCE.RESISTANCE_BAND, {
      reps: 10,
      weightKg: null,
      bandNominalResistanceKg: 108,
    rir: null,
    })).toEqual({
      ok: true,
      reps: 10,
      weightKg: null,
      bandNominalResistanceKg: 108,
    rir: null,
    });
  });

  it("accepts BODYWEIGHT with reps only", () => {
    expect(validateSetFields(RESISTANCE.BODYWEIGHT, {
      reps: 20,
      weightKg: null,
      bandNominalResistanceKg: null,
    rir: null,
    })).toEqual({
      ok: true,
      reps: 20,
      weightKg: null,
      bandNominalResistanceKg: null,
    rir: null,
    });
  });

  it("rejects mixed weight and band", () => {
    expect(validateSetFields(RESISTANCE.EXTERNAL_WEIGHT, {
      reps: 8,
      weightKg: 40,
      bandNominalResistanceKg: 108,
    rir: null,
    }).ok).toBe(false);
  });

  it("rejects weightKg on BODYWEIGHT (no fake 0 kg)", () => {
    expect(validateSetFields(RESISTANCE.BODYWEIGHT, {
      reps: 12,
      weightKg: 0,
    }).ok).toBe(false);
  });

  it("rejects band on EXTERNAL_WEIGHT and weight on RESISTANCE_BAND", () => {
    expect(validateSetFields(RESISTANCE.EXTERNAL_WEIGHT, {
      reps: 8,
      bandNominalResistanceKg: 50,
    rir: null,
    }).ok).toBe(false);
    expect(validateSetFields(RESISTANCE.RESISTANCE_BAND, {
      reps: 8,
      weightKg: 50,
    }).ok).toBe(false);
  });
});

describe("external load accounting + ordinary tonnage", () => {
  it("covers every canonical stableKey with explicit load-accounting semantics", () => {
    const coverage = approvedExternalLoadAccountingCoverageV1();
    expect(coverage).toEqual({ expected: 12, mapped: 12, missingStableKeys: [] });
    for (const identity of CANONICAL_EXERCISE_IDENTITIES) {
      expect(lookupExternalLoadAccountingV1(identity.stableKey)).not.toBeNull();
    }
  });

  it("applies per-implement and per-side factor 2 for the supported catalog", () => {
    expect(ordinaryExternalWeightTonnageKg([{
      resistanceType: RESISTANCE.EXTERNAL_WEIGHT,
      stableKey: "incline_dumbbell_press_30deg",
      weightKg: 10,
      reps: 5,
    }])).toBe(100);
    expect(ordinaryExternalWeightTonnageKg([{
      resistanceType: RESISTANCE.EXTERNAL_WEIGHT,
      stableKey: "flat_dumbbell_fly",
      weightKg: 10,
      reps: 5,
    }])).toBe(100);
    expect(ordinaryExternalWeightTonnageKg([{
      resistanceType: RESISTANCE.EXTERNAL_WEIGHT,
      stableKey: "seated_dumbbell_press",
      weightKg: 10,
      reps: 5,
    }])).toBe(100);
    expect(ordinaryExternalWeightTonnageKg([{
      resistanceType: RESISTANCE.EXTERNAL_WEIGHT,
      stableKey: "one_arm_lateral_raise",
      weightKg: 10,
      reps: 5,
    }])).toBe(100);
    expect(ordinaryExternalWeightTonnageKg([{
      resistanceType: RESISTANCE.EXTERNAL_WEIGHT,
      stableKey: "one_arm_seated_cable_row",
      weightKg: 20,
      reps: 8,
    }])).toBe(320);
    expect(ordinaryExternalWeightTonnageKg([{
      resistanceType: RESISTANCE.EXTERNAL_WEIGHT,
      stableKey: "one_arm_concentration_curl",
      weightKg: 12,
      reps: 10,
    }])).toBe(240);
  });

  it("excludes bodyweight, band, unknown custom, and not-applicable entries", () => {
    expect(ordinaryExternalWeightTonnageKg([{
      resistanceType: RESISTANCE.BODYWEIGHT,
      stableKey: "pushup_handles",
      weightKg: null,
      reps: 10,
    }])).toBeNull();
    expect(ordinaryExternalWeightTonnageKg([{
      resistanceType: RESISTANCE.RESISTANCE_BAND,
      stableKey: "one_arm_seated_cable_row",
      weightKg: null,
      reps: 10,
    }])).toBeNull();
    expect(ordinaryExternalWeightTonnageKg([{
      resistanceType: RESISTANCE.EXTERNAL_WEIGHT,
      stableKey: "custom_unknown",
      weightKg: 10,
      reps: 5,
    }])).toBeNull();
    expect(ordinaryExternalWeightTonnageKg([{
      resistanceType: RESISTANCE.EXTERNAL_WEIGHT,
      stableKey: null,
      weightKg: 10,
      reps: 5,
    }])).toBeNull();
    expect(ordinaryExternalWeightTonnageKg([{
      resistanceType: RESISTANCE.EXTERNAL_WEIGHT,
      stableKey: "hyperextension",
      weightKg: 10,
      reps: 5,
    }])).toBeNull();
  });

  it("supports explicit total-load factor 1 without guessing for unknowns", () => {
    expect(ordinaryExternalWeightTonnageKg([{
      resistanceType: RESISTANCE.EXTERNAL_WEIGHT,
      stableKey: null,
      ordinaryTonnageFactor: 1,
      weightKg: 10,
      reps: 5,
    }])).toBe(50);
  });

  it("sums a mixed session using each exercise stableKey", () => {
    expect(ordinaryExternalWeightTonnageKg([
      {
        resistanceType: RESISTANCE.EXTERNAL_WEIGHT,
        stableKey: "incline_dumbbell_press_30deg",
        weightKg: 10,
        reps: 5,
      },
      {
        resistanceType: RESISTANCE.EXTERNAL_WEIGHT,
        stableKey: "one_arm_lateral_raise",
        weightKg: 10,
        reps: 5,
      },
      {
        resistanceType: RESISTANCE.BODYWEIGHT,
        stableKey: "pushup_handles",
        weightKg: null,
        reps: 12,
      },
      {
        resistanceType: RESISTANCE.RESISTANCE_BAND,
        stableKey: "one_arm_seated_cable_row",
        weightKg: null,
        reps: 10,
      },
    ])).toBe(100 + 100);
  });

  it("labels weight entry from load-accounting semantics", () => {
    expect(externalWeightEntryLabel("incline_dumbbell_press_30deg", true)).toBe("Вага на гантелю, кг");
    expect(externalWeightEntryLabel("incline_dumbbell_press_30deg", false)).toBe("Weight per dumbbell, kg");
    expect(externalWeightEntryLabel("one_arm_lateral_raise", true)).toBe("Вага на сторону, кг");
    expect(externalWeightEntryLabel("one_arm_lateral_raise", false)).toBe("Weight per side, kg");
  });

  it("does not change QualifiedResistanceTrainingDoseV7 fingerprints when only tonnage accounting changes", () => {
    const session: StrengthSessionDto = {
      id: 42,
      status: "COMPLETED",
      entryMode: "RETROSPECTIVE",
      revision: 3,
      programId: 7,
      programName: "Upper",
      programVersionId: 9,
      programVersionNumber: 1,
      webStartedAt: null,
      webEndedAt: null,
      matchStatus: "MATCHED",
      matchMethod: "DIRECT_BACKFILL",
      matchedAt: "2026-09-17T18:30:00.000Z",
      matchedWorkoutId: 99,
      matchedWorkout: {
        id: 99,
        type: "Strength Training",
        startAt: "2026-09-17T17:00:00.000Z",
        endAt: "2026-09-17T18:00:00.000Z",
        durationMinutes: 60,
        activeEnergyKcal: 400,
        externalId: "garmin-99",
      },
      exercises: [{
        id: 1,
        sourceExerciseCatalogId: 10,
        stableKey: "incline_dumbbell_press_30deg",
        snapshotExerciseName: "Press",
        order: 1,
        plannedSets: 3,
        resistanceType: RESISTANCE.EXTERNAL_WEIGHT,
        origin: "PLANNED",
        muscleMappingSnapshot: buildExerciseMuscleMappingSnapshotV7("incline_dumbbell_press_30deg"),
        sets: [{
          id: 11,
          sessionExerciseId: 1,
          setNumber: 1,
          reps: 5,
          weightKg: 10,
          bandNominalResistanceKg: null,
          rir: null,
          comment: null,
          completedAt: null,
          createdAt: "2026-09-17T17:00:00.000Z",
          updatedAt: "2026-09-17T17:00:00.000Z",
        }],
      }],
      ordinaryTonnageKg: 50,
      createdAt: "2026-09-17T17:00:00.000Z",
      updatedAt: "2026-09-17T18:30:00.000Z",
    };

    const input = buildCanonicalStrengthTrainingInputV7({ session, heartRateSamples: null });
    const withOldTonnage = buildQualifiedResistanceTrainingDoseV7(input, { ordinaryTonnageKg: 50 });
    const withCorrectedTonnage = buildQualifiedResistanceTrainingDoseV7(input, { ordinaryTonnageKg: 100 });
    expect(qualifiedResistanceTrainingDoseV7Fingerprint(withOldTonnage))
      .toBe(qualifiedResistanceTrainingDoseV7Fingerprint(withCorrectedTonnage));
    expect(withCorrectedTonnage.availability).toBe("available");
  });
});
