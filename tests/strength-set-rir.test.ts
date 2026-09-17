import { describe, expect, it } from "vitest";
import {
  effortEvidenceFromRir,
  buildQualifiedResistanceTrainingDoseV7,
  qualifiedResistanceTrainingDoseV7Fingerprint,
} from "@/model/physiology-v7/qualified-resistance-training-dose-v7";
import { buildExerciseMuscleMappingSnapshotV7 } from "@/model/physiology-v7/exercise-muscle-mapping-v7";
import {
  buildCanonicalStrengthTrainingInputV7,
  canonicalStrengthTrainingInputV7Fingerprint,
} from "@/modules/model-episodes/strength-training-input-v7";
import { RESISTANCE, TRAINING_LIMITS } from "@/modules/training/training.constants";
import { validateRir, validateSetFields } from "@/modules/training/training.set-validation";
import type { StrengthSessionDto } from "@/modules/training/training.types";

function sessionWithSets(
  sets: StrengthSessionDto["exercises"][number]["sets"],
): StrengthSessionDto {
  return {
    id: 42,
    status: "COMPLETED",
    entryMode: "RETROSPECTIVE",
    revision: 1,
    programId: 7,
    programName: "Program",
    programVersionId: 9,
    programVersionNumber: 1,
    webStartedAt: null,
    webEndedAt: null,
    matchStatus: "MATCHED",
    matchMethod: "DIRECT_BACKFILL",
    matchedAt: "2026-09-14T18:30:00.000Z",
    matchedWorkoutId: 99,
    matchedWorkout: {
      id: 99,
      type: "Strength Training",
      startAt: "2026-09-14T17:00:00.000Z",
      endAt: "2026-09-14T18:00:00.000Z",
      durationMinutes: 60,
      activeEnergyKcal: 400,
      externalId: "garmin-99",
    },
    exercises: [{
      id: 1,
      sourceExerciseCatalogId: 10,
      stableKey: "seated_dumbbell_press",
      snapshotExerciseName: "Press",
      order: 1,
      plannedSets: 3,
      resistanceType: RESISTANCE.EXTERNAL_WEIGHT,
      origin: "PLANNED",
      muscleMappingSnapshot: buildExerciseMuscleMappingSnapshotV7("seated_dumbbell_press"),
      sets,
    }],
    ordinaryTonnageKg: null,
    createdAt: "2026-09-14T17:00:00.000Z",
    updatedAt: "2026-09-14T18:30:00.000Z",
  };
}

function set(partial: {
  id: number;
  reps?: number;
  weightKg?: number | null;
  rir?: number | null;
}) {
  return {
    id: partial.id,
    sessionExerciseId: 1,
    setNumber: partial.id,
    reps: partial.reps ?? 8,
    weightKg: partial.weightKg === undefined ? 20 : partial.weightKg,
    bandNominalResistanceKg: null,
    rir: partial.rir === undefined ? null : partial.rir,
    comment: null,
    completedAt: null,
    createdAt: "2026-09-14T17:00:00.000Z",
    updatedAt: "2026-09-14T17:00:00.000Z",
  };
}

describe("optional StrengthSet RIR", () => {
  it("accepts null and 0–10 integers; rejects invalid values", () => {
    expect(validateRir(null)).toEqual({ ok: true, rir: null });
    expect(validateRir(0)).toEqual({ ok: true, rir: 0 });
    expect(validateRir(TRAINING_LIMITS.maxRir)).toEqual({ ok: true, rir: TRAINING_LIMITS.maxRir });
    expect(validateRir(-1).ok).toBe(false);
    expect(validateRir(11).ok).toBe(false);
    expect(validateRir(1.5).ok).toBe(false);

    expect(validateSetFields(RESISTANCE.EXTERNAL_WEIGHT, {
      reps: 8,
      weightKg: 20,
      rir: 2,
    })).toMatchObject({ ok: true, rir: 2 });
    expect(validateSetFields(RESISTANCE.BODYWEIGHT, {
      reps: 10,
      rir: null,
    })).toMatchObject({ ok: true, rir: null });
  });

  it("treats null RIR as product assumption and observed RIR as user-reported provenance", () => {
    expect(effortEvidenceFromRir(null)).toEqual({
      status: "qualified-by-product-assumption",
      assumption: "assumed-near-failure",
    });
    expect(effortEvidenceFromRir(0)).toEqual({
      status: "qualified-by-user-reported-rir",
      provenance: "user-reported-rir",
      rir: 0,
      reportedProximity: "momentary-failure",
    });
    expect(effortEvidenceFromRir(2)).toEqual({
      status: "qualified-by-user-reported-rir",
      provenance: "user-reported-rir",
      rir: 2,
      reportedProximity: "reps-in-reserve",
    });
  });

  it("includes RIR in canonical input and changes fingerprint when RIR changes", () => {
    const without = buildCanonicalStrengthTrainingInputV7({
      session: sessionWithSets([set({ id: 1, rir: null })]),
      heartRateSamples: null,
    });
    const withRir = buildCanonicalStrengthTrainingInputV7({
      session: sessionWithSets([set({ id: 1, rir: 1 })]),
      heartRateSamples: null,
    });
    const failure = buildCanonicalStrengthTrainingInputV7({
      session: sessionWithSets([set({ id: 1, rir: 0 })]),
      heartRateSamples: null,
    });

    expect(without.contractVersion).toBe("bodycast-physiology-v7-strength-input-v3");
    expect(without.exercises[0]!.sets[0]!.rir).toBeNull();
    expect(withRir.exercises[0]!.sets[0]!.rir).toBe(1);
    expect(canonicalStrengthTrainingInputV7Fingerprint(without))
      .not.toBe(canonicalStrengthTrainingInputV7Fingerprint(withRir));
    expect(canonicalStrengthTrainingInputV7Fingerprint(withRir))
      .not.toBe(canonicalStrengthTrainingInputV7Fingerprint(failure));
  });

  it("supports mixed observed/null RIR sessions without inventing a failure bonus", () => {
    const dose = buildQualifiedResistanceTrainingDoseV7(
      buildCanonicalStrengthTrainingInputV7({
        session: sessionWithSets([
          set({ id: 1, rir: null }),
          set({ id: 2, rir: 0 }),
          set({ id: 3, rir: 2 }),
        ]),
        heartRateSamples: null,
      }),
    );

    expect(dose.availability).toBe("available");
    if (dose.availability === "available") {
      expect(dose.mappedSetCount).toBe(3);
      expect(dose.setEffortEvidence).toHaveLength(3);
      expect(dose.setEffortEvidence[0]!.evidence.status).toBe("qualified-by-product-assumption");
      expect(dose.setEffortEvidence[1]!.evidence).toMatchObject({
        status: "qualified-by-user-reported-rir",
        rir: 0,
        reportedProximity: "momentary-failure",
      });
      expect(dose.setEffortEvidence[2]!.evidence).toMatchObject({
        status: "qualified-by-user-reported-rir",
        rir: 2,
        reportedProximity: "reps-in-reserve",
      });
      expect(dose).not.toHaveProperty("failureBonus");
      expect(dose.hardSetQualification).toEqual({
        status: "qualified-by-product-assumption",
        assumption: "assumed-near-failure",
      });
    }
  });

  it("keeps equal mapped dose for RIR 0 vs near-failure RIR while fingerprints differ", () => {
    const failure = buildQualifiedResistanceTrainingDoseV7(
      buildCanonicalStrengthTrainingInputV7({
        session: sessionWithSets([set({ id: 1, rir: 0 })]),
        heartRateSamples: null,
      }),
    );
    const near = buildQualifiedResistanceTrainingDoseV7(
      buildCanonicalStrengthTrainingInputV7({
        session: sessionWithSets([set({ id: 1, rir: 1 })]),
        heartRateSamples: null,
      }),
    );
    expect(failure.availability).toBe("available");
    expect(near.availability).toBe("available");
    if (failure.availability === "available" && near.availability === "available") {
      expect(failure.mappedSetCount).toBe(near.mappedSetCount);
      expect(qualifiedResistanceTrainingDoseV7Fingerprint(failure))
        .not.toBe(qualifiedResistanceTrainingDoseV7Fingerprint(near));
    }
  });
});
