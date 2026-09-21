import { prisma } from "@/lib/db/prisma";
import {
  estimateExperimentalStepperGlycogenDemandV1,
  EXPERIMENTAL_STEPPER_GLYCOGEN_DEMAND_V1_REVISION,
  experimentalStepperGlycogenDemandV1Fingerprint,
} from "@/model/physiology-v7/experimental-stepper-glycogen-demand-v1";
import { estimateExperimentalStepperActiveEnergyV1 } from "@/model/activity/experimental-stepper-active-energy-v1";
import { canonicalizeWorkoutType } from "@/model/activity/workout-energy";
import type { WorkoutEnergyEvidenceV7 } from "@/model/activity/workout-energy-v7";
import { canonicalizeWorkoutHeartRateEvidenceV7 } from "@/model/activity/workout-heart-rate-v7";
import {
  assignmentAtWorkoutStartV7,
  type StepperEquipmentAssignmentV7,
} from "@/model/activity/personal-stepper-reference-v7";
import { canonicalizeWorkoutStepperEvidenceV7 } from "@/model/activity/workout-stepper-v7";
import { StepperEquipmentRepository } from "./stepper-equipment.repository";

/**
 * Isolated experimental/shadow output for MS100 stepper glycogen demand.
 * Never an input to TDEE, production physiology, forecast, or GREEN contracts.
 */
export async function recordExperimentalStepperGlycogenDemandShadow(input: {
  workoutId: number;
  profileId?: number;
}): Promise<void> {
  const profileId = input.profileId ?? 1;
  const workout = await prisma.workout.findUnique({
    where: { id: input.workoutId },
    select: {
      id: true,
      type: true,
      startAt: true,
      endAt: true,
      durationMinutes: true,
      activeEnergyKcal: true,
      dailyHealthData: { select: { weightKg: true } },
    },
  });
  if (workout === null) return;

  const canonical = canonicalizeWorkoutType(workout.type);
  if (canonical.classification !== "stair-climbing" || canonical.canonicalType === null) return;

  const [assignments, snapshots, stepIntervals, heartRateSamples] = await Promise.all([
    new StepperEquipmentRepository(prisma).list(),
    prisma.healthSyncSnapshot.findMany({
      select: { id: true, receivedAt: true, syncedAt: true, steps: true },
    }),
    prisma.healthActivityInterval.findMany({
      where: {
        metric: "steps",
        startAt: { lt: workout.endAt },
        endAt: { gt: workout.startAt },
      },
      select: { id: true, startAt: true, endAt: true, value: true },
      orderBy: [{ startAt: "asc" }, { id: "asc" }],
    }),
    prisma.heartRateSample.findMany({
      where: {
        profileId,
        timestamp: { gte: workout.startAt, lte: workout.endAt },
      },
      select: { timestamp: true, bpm: true, source: true },
      orderBy: { timestamp: "asc" },
    }),
  ]);

  const startAt = workout.startAt.toISOString();
  const endAt = workout.endAt.toISOString();
  const heartRate = canonicalizeWorkoutHeartRateEvidenceV7({
    workoutInterval: { startAt, endAt },
    heartRate: heartRateSamples.length === 0
      ? { availability: "unavailable" }
      : {
        availability: "loaded",
        samples: heartRateSamples.map((sample) => ({
          timestamp: sample.timestamp.toISOString(),
          bpm: sample.bpm,
          provenance: { provider: sample.source, device: null },
        })),
      },
  });
  const workoutEnergy: WorkoutEnergyEvidenceV7 = {
    workoutId: workout.id,
    canonicalWorkoutType: canonical.canonicalType,
    startAt,
    endAt,
    durationMinutes: workout.durationMinutes,
    deviceEnergy: workout.activeEnergyKcal === null
      ? { availability: "unavailable", availabilityReason: "no-device-active-energy" }
      : {
        availability: "available",
        sourceValueStatus: "observed",
        valueKcal: workout.activeEnergyKcal,
        semantics: "active",
        provenance: "device-estimate",
      },
    heartRate,
  };
  const evidence = canonicalizeWorkoutStepperEvidenceV7({
    workoutEnergy,
    snapshots: snapshots.map((snapshot) => ({
      id: snapshot.id,
      receivedAt: snapshot.receivedAt.toISOString(),
      syncedAt: snapshot.syncedAt?.toISOString() ?? null,
      steps: snapshot.steps,
    })),
    stepIntervals: stepIntervals.map((interval) => ({
      id: interval.id,
      startAt: interval.startAt.toISOString(),
      endAt: interval.endAt.toISOString(),
      stepCount: interval.value.toNumber(),
    })),
  });
  const equipment = assignmentAtWorkoutStartV7(
    assignments as StepperEquipmentAssignmentV7[],
    startAt,
  );
  const bodyMassKg = workout.dailyHealthData.weightKg ?? null;
  const energyEstimate = estimateExperimentalStepperActiveEnergyV1({
    workout: evidence,
    bodyMassKg,
    equipment,
  });
  const ignoredActiveEnergyKcal = energyEstimate.availability === "available"
    ? energyEstimate.estimatedActiveKcal
    : workout.activeEnergyKcal;
  const result = estimateExperimentalStepperGlycogenDemandV1({
    workout: evidence,
    bodyMassKg,
    equipment,
    // The authoritative daily relative-debt trajectory applies the one shared
    // cap. A workout-level shadow must not read a newer production glycogen
    // row or independently consume the same headroom.
    availableGlycogenKg: null,
    activeEnergyKcal: ignoredActiveEnergyKcal,
  });
  const sourceFingerprint = experimentalStepperGlycogenDemandV1Fingerprint(result);
  await prisma.experimentalStepperGlycogenDemandShadow.upsert({
    where: { workoutId: workout.id },
    create: {
      workoutId: workout.id,
      profileId,
      sourceFingerprint,
      modelRevision: EXPERIMENTAL_STEPPER_GLYCOGEN_DEMAND_V1_REVISION,
      features: result.features,
      result,
    },
    update: {
      sourceFingerprint,
      modelRevision: EXPERIMENTAL_STEPPER_GLYCOGEN_DEMAND_V1_REVISION,
      features: result.features,
      result,
    },
  });
}

export async function recordExperimentalStepperGlycogenDemandShadowsForLocalDate(input: {
  date: string;
  profileId?: number;
}): Promise<void> {
  const profileId = input.profileId ?? 1;
  const workouts = await prisma.workout.findMany({
    where: { dailyHealthData: { date: input.date } },
    select: { id: true, type: true },
  });
  for (const workout of workouts) {
    if (canonicalizeWorkoutType(workout.type).classification !== "stair-climbing") continue;
    await recordExperimentalStepperGlycogenDemandShadow({ workoutId: workout.id, profileId });
  }
}
