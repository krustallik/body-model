import { describe, expect, it } from "vitest";
import {
  calculateExtracellularFluidLiters,
  calculateExtracellularFluidMassKg,
  calculateGlycogenAssociatedMassKg,
  calculateGlycogenAssociatedWaterKg,
  reconstructBodyWeightKg,
  type BodyCompositionState,
} from "@/model/body-composition/state";
import {
  createGlycogenParameters,
  stepGlycogenOneDay,
} from "@/model/body-composition/glycogen";
import {
  missingPhysiologicalTransitionFields,
  type PhysiologicalDailyInput,
} from "@/model/physiological-simulator";
import {
  resolveExplicitWorkoutActivityKcal,
  type ExplicitWorkoutActivityEvent,
} from "@/model/activity/workout-energy";
import {
  resolveWorkoutEnergyEvidenceV7,
  type WorkoutEnergyEvidenceV7,
} from "@/model/activity/workout-energy-v7";
import { canonicalizeWorkoutHeartRateEvidenceV7 } from "@/model/activity/workout-heart-rate-v7";
import { buildExerciseMuscleMappingSnapshotV7 } from "@/model/physiology-v7/exercise-muscle-mapping-v7";
import {
  buildQualifiedResistanceTrainingDoseV7,
  qualifiedResistanceTrainingDoseV7Fingerprint,
} from "@/model/physiology-v7/qualified-resistance-training-dose-v7";
import {
  buildCanonicalStrengthTrainingInputV7,
} from "@/modules/model-episodes/strength-training-input-v7";
import { RESISTANCE } from "@/modules/training/training.constants";
import type { StrengthSessionDto } from "@/modules/training/training.types";

const completeDay: PhysiologicalDailyInput = {
  date: "2026-09-17",
  caloriesKcal: 2_400,
  proteinG: 140,
  fatG: 80,
  carbsG: 280,
  outsideWorkWalkingDistanceKm: 0,
  averageWalkingSpeedKmh: null,
  strengthTrainingMinutes: 0,
  occupationalActivity: { category: null, durationHours: 0 },
  sodiumChangeMgPerDay: 0,
  measuredWeightKg: null,
};

function stairEvent(activeEnergyKcal: number): ExplicitWorkoutActivityEvent {
  return {
    type: "Stair Climbing",
    canonicalType: "Stair Climbing",
    classification: "stair-climbing",
    startAt: "2026-09-17T16:00:00.000Z",
    endAt: "2026-09-17T16:20:00.000Z",
    durationMinutes: 20,
    activeEnergyKcal,
  };
}

function v7EnergyEvidence(input: Partial<WorkoutEnergyEvidenceV7> = {}): WorkoutEnergyEvidenceV7 {
  return {
    workoutId: 1,
    canonicalWorkoutType: "Traditional Strength Training",
    startAt: "2026-09-17T16:00:00.000Z",
    endAt: "2026-09-17T16:30:00.000Z",
    durationMinutes: 30,
    deviceEnergy: { availability: "unavailable", availabilityReason: "no-device-active-energy" },
    heartRate: canonicalizeWorkoutHeartRateEvidenceV7({
      workoutInterval: { startAt: "2026-09-17T16:00:00.000Z", endAt: "2026-09-17T16:30:00.000Z" },
      heartRate: { availability: "loaded", samples: [{ timestamp: "2026-09-17T16:01:00.000Z", bpm: 170, provenance: { provider: "shortcut", device: null } }] },
    }),
    ...input,
  };
}

describe("scientific v7 contract — currently reachable audited behavior", () => {
  it("missing protein remains unavailable rather than becoming measured zero", () => {
    const missing = missingPhysiologicalTransitionFields(
      { ...completeDay, proteinG: null },
      "full",
    );
    const measuredZero = missingPhysiologicalTransitionFields(
      { ...completeDay, proteinG: 0 },
      "full",
    );

    expect(missing).toContain("proteinG");
    expect(measuredZero).not.toContain("proteinG");
  });

  it("more carbohydrate from the same depleted state does not reduce glycogen restoration", () => {
    const parameters = createGlycogenParameters({ baselineCarbIntakeG: 250 });
    const lower = stepGlycogenOneDay({
      currentGlycogenKg: 0.3,
      carbIntakeG: 150,
      parameters,
    });
    const higher = stepGlycogenOneDay({
      currentGlycogenKg: 0.3,
      carbIntakeG: 300,
      parameters,
    });

    expect(lower).not.toBeNull();
    expect(higher).not.toBeNull();
    expect(higher!.glycogenKg).toBeGreaterThanOrEqual(lower!.glycogenKg);
  });

  it("glycogen-associated water co-moves without asserting a universal ratio", () => {
    const lower = calculateGlycogenAssociatedWaterKg(0.3);
    const higher = calculateGlycogenAssociatedWaterKg(0.4);

    expect(lower).toBeGreaterThanOrEqual(0);
    expect(higher).toBeGreaterThan(lower);
  });

  it("body-weight reconstruction counts glycogen-associated mass exactly once", () => {
    const state: BodyCompositionState = {
      fatMassKg: 18,
      leanTissueKg: 46,
      glycogenKg: 0.4,
      baselineExtracellularFluidLiters: 12,
      extracellularFluidDeviationLiters: 0.2,
    };
    const expectedComponentSum = state.fatMassKg
      + state.leanTissueKg
      + calculateGlycogenAssociatedMassKg(state.glycogenKg)
      + calculateExtracellularFluidMassKg(calculateExtracellularFluidLiters(state));

    expect(reconstructBodyWeightKg(state)).toBe(expectedComponentSum);
  });

  it("changing glycogen-associated mass does not change lean tissue", () => {
    const lower: BodyCompositionState = {
      fatMassKg: 18,
      leanTissueKg: 46,
      glycogenKg: 0.3,
      baselineExtracellularFluidLiters: 12,
      extracellularFluidDeviationLiters: 0,
    };
    const higher: BodyCompositionState = { ...lower, glycogenKg: 0.4 };

    expect(higher.leanTissueKg).toBe(lower.leanTissueKg);
    expect(reconstructBodyWeightKg(higher)).toBeGreaterThan(reconstructBodyWeightKg(lower));
  });

  it("device active energy retains estimate provenance", () => {
    const result = resolveExplicitWorkoutActivityKcal({
      events: [stairEvent(211)],
      weightKg: 80,
      rmrKcalPerDay: 1_700,
    });

    expect(result.perEvent).toEqual([{
      classification: "stair-climbing",
      source: "device-active-kcal",
      kcal: 211,
    }]);
  });

  it("maximum HR alone does not determine active energy", () => {
    const shorter = resolveWorkoutEnergyEvidenceV7(v7EnergyEvidence({ durationMinutes: 10 }));
    const longer = resolveWorkoutEnergyEvidenceV7(v7EnergyEvidence({ durationMinutes: 60 }));

    expect(shorter.activeEnergy).toEqual({
      availability: "unavailable",
      availabilityReason: "no-device-active-energy",
    });
    expect(longer.activeEnergy).toEqual(shorter.activeEnergy);
    expect(shorter.heartRateContext).toEqual(v7EnergyEvidence({ durationMinutes: 10 }).heartRate);
  });

  it("sparse HR cannot recover unobserved transitions", () => {
    const early = canonicalizeWorkoutHeartRateEvidenceV7({
      workoutInterval: { startAt: "2026-09-17T16:00:00.000Z", endAt: "2026-09-17T17:00:00.000Z" },
      heartRate: { availability: "loaded", samples: [
        { timestamp: "2026-09-17T16:05:00.000Z", bpm: 100, provenance: { provider: "shortcut", device: null } },
        { timestamp: "2026-09-17T16:10:00.000Z", bpm: 140, provenance: { provider: "shortcut", device: null } },
      ] },
    });
    const irregular = canonicalizeWorkoutHeartRateEvidenceV7({
      workoutInterval: { startAt: "2026-09-17T16:00:00.000Z", endAt: "2026-09-17T17:00:00.000Z" },
      heartRate: { availability: "loaded", samples: [
        { timestamp: "2026-09-17T16:45:00.000Z", bpm: 100, provenance: { provider: "shortcut", device: null } },
        { timestamp: "2026-09-17T16:55:00.000Z", bpm: 140, provenance: { provider: "shortcut", device: null } },
      ] },
    });

    expect(early.summary).toEqual({ sampleMeanBpm: 120, maxObservedBpm: 140, basis: "observed-samples-only" });
    expect(irregular.summary).toEqual(early.summary);
    expect(irregular.samplingTopology).not.toEqual(early.samplingTopology);

    const earlyEnergy = resolveWorkoutEnergyEvidenceV7(v7EnergyEvidence({ heartRate: early }));
    const irregularEnergy = resolveWorkoutEnergyEvidenceV7(v7EnergyEvidence({ heartRate: irregular }));
    expect(earlyEnergy.activeEnergy).toEqual({ availability: "unavailable", availabilityReason: "no-device-active-energy" });
    expect(irregularEnergy.activeEnergy).toEqual(earlyEnergy.activeEnergy);
    expect(earlyEnergy.activeEnergy).not.toHaveProperty("valueKcal");
    expect(irregularEnergy.activeEnergy).not.toHaveProperty("valueKcal");

    // P-K04 has no audited numeric adequacy threshold. Topology is exposed as
    // observation fact only: no scientific quality label or confidence upgrade.
    expect(irregular).not.toHaveProperty("coveragePercent");
    expect(irregular).not.toHaveProperty("adequacyClassification");
    expect(irregularEnergy).not.toHaveProperty("confidence");
  });

  it("v7 device active energy is available once with active semantics and estimate provenance", () => {
    const result = resolveWorkoutEnergyEvidenceV7(v7EnergyEvidence({
      deviceEnergy: {
        availability: "available",
        sourceValueStatus: "observed",
        valueKcal: 211,
        semantics: "active",
        provenance: "device-estimate",
      },
    }));

    expect(result.activeEnergy).toEqual({
      availability: "available",
      valueKcal: 211,
      semantics: "active",
      provenance: "device-estimate",
    });
  });

  it("device active energy is counted once without a resting-energy adjustment", () => {
    const result = resolveExplicitWorkoutActivityKcal({
      events: [stairEvent(211)],
      weightKg: 80,
      rmrKcalPerDay: 1_700,
    });

    expect(result.deviceActiveEnergyKcal).toBe(211);
    expect(result.strengthMetFallbackKcal).toBe(0);
    expect(result.workoutActivityKcal).toBe(211);
  });

  it("observed workout active energy receives no automatic EPOC add-on", () => {
    const result = resolveExplicitWorkoutActivityKcal({
      events: [stairEvent(211)],
      weightKg: 80,
      rmrKcalPerDay: 1_700,
    });

    expect(result.workoutActivityKcal).toBe(result.deviceActiveEnergyKcal);
  });

  it("workout energy is not multiplied by a universal EPOC percentage", () => {
    const first = resolveExplicitWorkoutActivityKcal({
      events: [stairEvent(200)],
      weightKg: 80,
      rmrKcalPerDay: 1_700,
    });
    const second = resolveExplicitWorkoutActivityKcal({
      events: [stairEvent(400)],
      weightKg: 80,
      rmrKcalPerDay: 1_700,
    });

    expect(first.workoutActivityKcal).toBe(200);
    expect(second.workoutActivityKcal).toBe(400);
  });

  it("the represented workout active-energy interval is counted exactly once", () => {
    const result = resolveExplicitWorkoutActivityKcal({
      events: [stairEvent(120), stairEvent(90)],
      weightKg: 80,
      rmrKcalPerDay: 1_700,
    });

    expect(result.workoutActivityKcal).toBe(120 + 90);
    expect(result.deviceActiveEnergyKcal).toBe(result.workoutActivityKcal);
  });

  it("hard-set dose remains available without tonnage", () => {
    const pressSnapshot = buildExerciseMuscleMappingSnapshotV7("seated_dumbbell_press");
    const pushupSnapshot = buildExerciseMuscleMappingSnapshotV7("pushup_handles");
    const rowSnapshot = buildExerciseMuscleMappingSnapshotV7("one_arm_seated_cable_row");

    function session(partial: Partial<StrengthSessionDto> & {
      exercises: StrengthSessionDto["exercises"];
    }): StrengthSessionDto {
      return {
        id: 42,
        status: "COMPLETED",
        entryMode: "RETROSPECTIVE",
        revision: 2,
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
        ordinaryTonnageKg: null,
        createdAt: "2026-09-17T17:00:00.000Z",
        updatedAt: "2026-09-17T18:30:00.000Z",
        ...partial,
      };
    }

    const externalWeight = buildCanonicalStrengthTrainingInputV7({
      session: session({
        ordinaryTonnageKg: 720,
        exercises: [{
          id: 1,
          sourceExerciseCatalogId: 10,
          stableKey: null,
          snapshotExerciseName: "Press",
          order: 1,
          plannedSets: 3,
          resistanceType: RESISTANCE.EXTERNAL_WEIGHT,
          origin: "PLANNED",
          muscleMappingSnapshot: pressSnapshot,
          sets: [{
            id: 11,
            sessionExerciseId: 1,
            setNumber: 1,
            reps: 8,
            weightKg: 30,
            bandNominalResistanceKg: null,
            comment: null,
            completedAt: null,
            createdAt: "2026-09-17T17:00:00.000Z",
            updatedAt: "2026-09-17T17:00:00.000Z",
          }],
        }],
      }),
      heartRateSamples: null,
    });
    const bodyweight = buildCanonicalStrengthTrainingInputV7({
      session: session({
        ordinaryTonnageKg: null,
        exercises: [{
          id: 2,
          sourceExerciseCatalogId: 11,
          stableKey: null,
          snapshotExerciseName: "Push-up",
          order: 1,
          plannedSets: 3,
          resistanceType: RESISTANCE.BODYWEIGHT,
          origin: "PLANNED",
          muscleMappingSnapshot: pushupSnapshot,
          sets: [{
            id: 12,
            sessionExerciseId: 2,
            setNumber: 1,
            reps: 15,
            weightKg: null,
            bandNominalResistanceKg: null,
            comment: null,
            completedAt: "2026-09-17T17:05:00.000Z",
            createdAt: "2026-09-17T17:00:00.000Z",
            updatedAt: "2026-09-17T17:00:00.000Z",
          }],
        }],
      }),
      heartRateSamples: null,
    });
    const band = buildCanonicalStrengthTrainingInputV7({
      session: session({
        ordinaryTonnageKg: null,
        exercises: [{
          id: 3,
          sourceExerciseCatalogId: 12,
          stableKey: null,
          snapshotExerciseName: "Band row",
          order: 1,
          plannedSets: 4,
          resistanceType: RESISTANCE.RESISTANCE_BAND,
          origin: "PLANNED",
          muscleMappingSnapshot: rowSnapshot,
          sets: [{
            id: 13,
            sessionExerciseId: 3,
            setNumber: 1,
            reps: 12,
            weightKg: null,
            bandNominalResistanceKg: 15,
            comment: null,
            completedAt: null,
            createdAt: "2026-09-17T17:00:00.000Z",
            updatedAt: "2026-09-17T17:00:00.000Z",
          }],
        }],
      }),
      heartRateSamples: null,
    });

    const withTonnage = buildQualifiedResistanceTrainingDoseV7(externalWeight, {
      ordinaryTonnageKg: 720,
    });
    const bodyweightDose = buildQualifiedResistanceTrainingDoseV7(bodyweight, {
      ordinaryTonnageKg: null,
    });
    const bandDose = buildQualifiedResistanceTrainingDoseV7(band, {
      ordinaryTonnageKg: null,
    });
    const tonnageRemoved = buildQualifiedResistanceTrainingDoseV7(externalWeight, {
      ordinaryTonnageKg: null,
    });

    expect(withTonnage.availability).toBe("available");
    expect(bodyweightDose.availability).toBe("available");
    expect(bandDose.availability).toBe("available");
    expect(tonnageRemoved.availability).toBe("available");
    if (
      withTonnage.availability === "available"
      && bodyweightDose.availability === "available"
      && bandDose.availability === "available"
      && tonnageRemoved.availability === "available"
    ) {
      expect(withTonnage.mappedSetCount).toBeGreaterThan(0);
      expect(bodyweightDose.mappedSetCount).toBeGreaterThan(0);
      expect(bandDose.mappedSetCount).toBeGreaterThan(0);
      expect(bodyweightDose.ordinaryTonnageKg).toBeNull();
      expect(bandDose.ordinaryTonnageKg).toBeNull();
      expect(qualifiedResistanceTrainingDoseV7Fingerprint(tonnageRemoved))
        .toBe(qualifiedResistanceTrainingDoseV7Fingerprint(withTonnage));
      expect(withTonnage.hardSetQualification).toEqual({
        status: "qualified-by-product-assumption",
        assumption: "assumed-near-failure",
      });
    }
  });

  it("missing HR does not erase strength stimulus", () => {
    const snapshot = buildExerciseMuscleMappingSnapshotV7("flat_dumbbell_fly");
    const session: StrengthSessionDto = {
      id: 55,
      status: "COMPLETED",
      entryMode: "RETROSPECTIVE",
      revision: 4,
      programId: 7,
      programName: "Chest",
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
        stableKey: null,
        snapshotExerciseName: "Fly",
        order: 1,
        plannedSets: 3,
        resistanceType: RESISTANCE.EXTERNAL_WEIGHT,
        origin: "PLANNED",
        muscleMappingSnapshot: snapshot,
        sets: [{
          id: 11,
          sessionExerciseId: 1,
          setNumber: 1,
          reps: 10,
          weightKg: 12,
          bandNominalResistanceKg: null,
          comment: null,
          completedAt: null,
          createdAt: "2026-09-17T17:00:00.000Z",
          updatedAt: "2026-09-17T17:00:00.000Z",
        }],
      }],
      ordinaryTonnageKg: 120,
      createdAt: "2026-09-17T17:00:00.000Z",
      updatedAt: "2026-09-17T18:30:00.000Z",
    };

    const withHr = buildCanonicalStrengthTrainingInputV7({
      session,
      heartRateSamples: [
        { timestamp: "2026-09-17T17:01:00.000Z", bpm: 140, source: "shortcut" },
      ],
    });
    const withoutHr = buildCanonicalStrengthTrainingInputV7({
      session,
      heartRateSamples: null,
    });

    const doseWithHr = buildQualifiedResistanceTrainingDoseV7(withHr, {
      ordinaryTonnageKg: 120,
    });
    const doseWithoutHr = buildQualifiedResistanceTrainingDoseV7(withoutHr, {
      ordinaryTonnageKg: 120,
    });

    expect(doseWithHr.availability).toBe("available");
    expect(doseWithoutHr.availability).toBe("available");
    expect(qualifiedResistanceTrainingDoseV7Fingerprint(doseWithHr))
      .toBe(qualifiedResistanceTrainingDoseV7Fingerprint(doseWithoutHr));
    if (doseWithHr.availability === "available" && doseWithoutHr.availability === "available") {
      expect(doseWithHr.heartRateContext.availability).toBe("loaded");
      expect(doseWithoutHr.heartRateContext.availability).toBe("unavailable");
      expect(doseWithHr.mappedSetCount).toBe(doseWithoutHr.mappedSetCount);
      expect(doseWithHr.muscleGroups).toEqual(doseWithoutHr.muscleGroups);
    }
  });

  it("load is not a standalone hypertrophy multiplier", () => {
    const snapshot = buildExerciseMuscleMappingSnapshotV7("incline_dumbbell_press_30deg");

    function sessionAtLoad(weightKg: number, ordinaryTonnageKg: number): StrengthSessionDto {
      return {
        id: 61,
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
          snapshotExerciseName: "Incline DB press",
          order: 1,
          plannedSets: 3,
          resistanceType: RESISTANCE.EXTERNAL_WEIGHT,
          origin: "PLANNED",
          muscleMappingSnapshot: snapshot,
          sets: [{
            id: 11,
            sessionExerciseId: 1,
            setNumber: 1,
            reps: 10,
            weightKg,
            bandNominalResistanceKg: null,
            comment: null,
            completedAt: null,
            createdAt: "2026-09-17T17:00:00.000Z",
            updatedAt: "2026-09-17T17:00:00.000Z",
          }],
        }],
        ordinaryTonnageKg,
        createdAt: "2026-09-17T17:00:00.000Z",
        updatedAt: "2026-09-17T18:30:00.000Z",
      };
    }

    const lowerLoad = buildCanonicalStrengthTrainingInputV7({
      session: sessionAtLoad(20, 400),
      heartRateSamples: null,
    });
    const higherLoad = buildCanonicalStrengthTrainingInputV7({
      session: sessionAtLoad(40, 800),
      heartRateSamples: null,
    });

    const lowerDose = buildQualifiedResistanceTrainingDoseV7(lowerLoad, { ordinaryTonnageKg: 400 });
    const higherDose = buildQualifiedResistanceTrainingDoseV7(higherLoad, { ordinaryTonnageKg: 800 });

    expect(lowerDose.availability).toBe("available");
    expect(higherDose.availability).toBe("available");
    expect(qualifiedResistanceTrainingDoseV7Fingerprint(lowerDose))
      .toBe(qualifiedResistanceTrainingDoseV7Fingerprint(higherDose));
    if (lowerDose.availability === "available" && higherDose.availability === "available") {
      expect(lowerDose.mappedSetCount).toBe(higherDose.mappedSetCount);
      expect(lowerDose.muscleGroups).toEqual(higherDose.muscleGroups);
      expect(lowerDose.hardSetQualification).toEqual(higherDose.hardSetQualification);
      expect(lowerDose.ordinaryTonnageKg).toBe(400);
      expect(higherDose.ordinaryTonnageKg).toBe(800);
      expect(lowerDose).not.toHaveProperty("loadMultiplier");
      expect(higherDose).not.toHaveProperty("hypertrophyKg");
    }
  });

  it("resistance-training HR adds no independent hypertrophy multiplier", () => {
    const snapshot = buildExerciseMuscleMappingSnapshotV7("seated_dumbbell_press");
    const session: StrengthSessionDto = {
      id: 62,
      status: "COMPLETED",
      entryMode: "RETROSPECTIVE",
      revision: 2,
      programId: 7,
      programName: "Shoulders",
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
        stableKey: "seated_dumbbell_press",
        snapshotExerciseName: "Seated DB press",
        order: 1,
        plannedSets: 3,
        resistanceType: RESISTANCE.EXTERNAL_WEIGHT,
        origin: "PLANNED",
        muscleMappingSnapshot: snapshot,
        sets: [{
          id: 11,
          sessionExerciseId: 1,
          setNumber: 1,
          reps: 8,
          weightKg: 24,
          bandNominalResistanceKg: null,
          comment: null,
          completedAt: null,
          createdAt: "2026-09-17T17:00:00.000Z",
          updatedAt: "2026-09-17T17:00:00.000Z",
        }],
      }],
      ordinaryTonnageKg: 384,
      createdAt: "2026-09-17T17:00:00.000Z",
      updatedAt: "2026-09-17T18:30:00.000Z",
    };

    const unavailableHr = buildCanonicalStrengthTrainingInputV7({
      session,
      heartRateSamples: null,
    });
    const moderateHr = buildCanonicalStrengthTrainingInputV7({
      session,
      heartRateSamples: [
        { timestamp: "2026-09-17T17:05:00.000Z", bpm: 120, source: "shortcut" },
        { timestamp: "2026-09-17T17:20:00.000Z", bpm: 130, source: "shortcut" },
      ],
    });
    const higherHr = buildCanonicalStrengthTrainingInputV7({
      session,
      heartRateSamples: [
        { timestamp: "2026-09-17T17:05:00.000Z", bpm: 150, source: "shortcut" },
        { timestamp: "2026-09-17T17:20:00.000Z", bpm: 170, source: "shortcut" },
      ],
    });

    const doseUnavailable = buildQualifiedResistanceTrainingDoseV7(unavailableHr, {
      ordinaryTonnageKg: 384,
    });
    const doseModerate = buildQualifiedResistanceTrainingDoseV7(moderateHr, {
      ordinaryTonnageKg: 384,
    });
    const doseHigher = buildQualifiedResistanceTrainingDoseV7(higherHr, {
      ordinaryTonnageKg: 384,
    });

    expect(doseUnavailable.availability).toBe("available");
    expect(doseModerate.availability).toBe("available");
    expect(doseHigher.availability).toBe("available");
    expect(qualifiedResistanceTrainingDoseV7Fingerprint(doseUnavailable))
      .toBe(qualifiedResistanceTrainingDoseV7Fingerprint(doseModerate));
    expect(qualifiedResistanceTrainingDoseV7Fingerprint(doseModerate))
      .toBe(qualifiedResistanceTrainingDoseV7Fingerprint(doseHigher));
    if (
      doseUnavailable.availability === "available"
      && doseModerate.availability === "available"
      && doseHigher.availability === "available"
    ) {
      expect(doseUnavailable.heartRateContext.availability).toBe("unavailable");
      expect(doseModerate.heartRateContext.availability).toBe("loaded");
      expect(doseHigher.heartRateContext.availability).toBe("loaded");
      expect(doseUnavailable.mappedSetCount).toBe(doseHigher.mappedSetCount);
      expect(doseUnavailable.muscleGroups).toEqual(doseHigher.muscleGroups);
      expect(doseUnavailable).not.toHaveProperty("heartRateMultiplier");
      expect(doseHigher).not.toHaveProperty("anabolicHrBonus");
    }
  });

  it("equal HR does not imply equal local stimulus", () => {
    const sharedHrSamples = [
      { timestamp: "2026-09-17T17:10:00.000Z", bpm: 140, source: "shortcut" },
      { timestamp: "2026-09-17T17:25:00.000Z", bpm: 160, source: "shortcut" },
    ] as const;

    function sessionFor(
      id: number,
      exercise: StrengthSessionDto["exercises"][number],
    ): StrengthSessionDto {
      return {
        id,
        status: "COMPLETED",
        entryMode: "RETROSPECTIVE",
        revision: 1,
        programId: 7,
        programName: "Split",
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
        exercises: [exercise],
        ordinaryTonnageKg: 240,
        createdAt: "2026-09-17T17:00:00.000Z",
        updatedAt: "2026-09-17T18:30:00.000Z",
      };
    }

    const pushSession = sessionFor(71, {
      id: 1,
      sourceExerciseCatalogId: 10,
      stableKey: "incline_dumbbell_press_30deg",
      snapshotExerciseName: "Incline DB press",
      order: 1,
      plannedSets: 3,
      resistanceType: RESISTANCE.EXTERNAL_WEIGHT,
      origin: "PLANNED",
      muscleMappingSnapshot: buildExerciseMuscleMappingSnapshotV7("incline_dumbbell_press_30deg"),
      sets: [{
        id: 11,
        sessionExerciseId: 1,
        setNumber: 1,
        reps: 8,
        weightKg: 30,
        bandNominalResistanceKg: null,
        comment: null,
        completedAt: null,
        createdAt: "2026-09-17T17:00:00.000Z",
        updatedAt: "2026-09-17T17:00:00.000Z",
      }],
    });
    const pullSession = sessionFor(72, {
      id: 2,
      sourceExerciseCatalogId: 11,
      stableKey: "one_arm_seated_cable_row",
      snapshotExerciseName: "One-arm cable row",
      order: 1,
      plannedSets: 3,
      resistanceType: RESISTANCE.EXTERNAL_WEIGHT,
      origin: "PLANNED",
      muscleMappingSnapshot: buildExerciseMuscleMappingSnapshotV7("one_arm_seated_cable_row"),
      sets: [{
        id: 21,
        sessionExerciseId: 2,
        setNumber: 1,
        reps: 8,
        weightKg: 30,
        bandNominalResistanceKg: null,
        comment: null,
        completedAt: null,
        createdAt: "2026-09-17T17:00:00.000Z",
        updatedAt: "2026-09-17T17:00:00.000Z",
      }],
    });

    const pushInput = buildCanonicalStrengthTrainingInputV7({
      session: pushSession,
      heartRateSamples: [...sharedHrSamples],
    });
    const pullInput = buildCanonicalStrengthTrainingInputV7({
      session: pullSession,
      heartRateSamples: [...sharedHrSamples],
    });

    expect(pushInput.heartRate).toEqual(pullInput.heartRate);

    const pushDose = buildQualifiedResistanceTrainingDoseV7(pushInput, { ordinaryTonnageKg: 240 });
    const pullDose = buildQualifiedResistanceTrainingDoseV7(pullInput, { ordinaryTonnageKg: 240 });

    expect(pushDose.availability).toBe("available");
    expect(pullDose.availability).toBe("available");
    expect(qualifiedResistanceTrainingDoseV7Fingerprint(pushDose))
      .not.toBe(qualifiedResistanceTrainingDoseV7Fingerprint(pullDose));
    if (pushDose.availability === "available" && pullDose.availability === "available") {
      expect(pushDose.heartRateContext).toEqual(pullDose.heartRateContext);
      expect(pushDose.mappedSetCount).toBe(pullDose.mappedSetCount);
      expect(pushDose.muscleGroups).not.toEqual(pullDose.muscleGroups);
      expect(pushDose.muscleGroups.find((g) => g.muscleGroup === "chest")?.directMappedSetCount)
        .toBeGreaterThan(0);
      expect(pullDose.muscleGroups.find((g) => g.muscleGroup === "back")?.directMappedSetCount)
        .toBeGreaterThan(0);
      expect(pushDose.muscleGroups.find((g) => g.muscleGroup === "back")?.directMappedSetCount ?? 0)
        .toBe(0);
      expect(pullDose.muscleGroups.find((g) => g.muscleGroup === "chest")?.directMappedSetCount ?? 0)
        .toBe(0);
    }
  });
});
