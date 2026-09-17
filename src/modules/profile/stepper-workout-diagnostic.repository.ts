import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import type { StepperEquipmentAssignmentV7 } from "@/model/activity/personal-stepper-reference-v7";
import { StepperEquipmentRepository } from "./stepper-equipment.repository";
import { buildStepperWorkoutDiagnosticV7, type StepperWorkoutDiagnosticV7 } from "./stepper-workout-diagnostic";

export class StepperWorkoutDiagnosticRepository {
  constructor(private readonly client: PrismaClient = prisma, private readonly equipment = new StepperEquipmentRepository(client)) {}

  async get(workoutId: number): Promise<StepperWorkoutDiagnosticV7 | null | undefined> {
    const workout = await this.client.workout.findUnique({
      where: { id: workoutId },
      select: { id: true, type: true, startAt: true, endAt: true, durationMinutes: true, activeEnergyKcal: true },
    });
    if (workout === null) return undefined;
    const [assignments, snapshots, heartRateSamples] = await Promise.all([
      this.equipment.list(),
      this.client.healthSyncSnapshot.findMany({
        select: { id: true, receivedAt: true, syncedAt: true, steps: true },
      }),
      this.client.heartRateSample.findMany({
        where: { timestamp: { gte: workout.startAt, lte: workout.endAt } },
        select: { timestamp: true, bpm: true, source: true }, orderBy: { timestamp: "asc" },
      }),
    ]);
    return buildStepperWorkoutDiagnosticV7({
      workout: {
        ...workout,
        startAt: workout.startAt.toISOString(), endAt: workout.endAt.toISOString(),
      },
      assignments: assignments as StepperEquipmentAssignmentV7[],
      snapshots: snapshots.map((snapshot) => ({
        id: snapshot.id, receivedAt: snapshot.receivedAt.toISOString(), syncedAt: snapshot.syncedAt?.toISOString() ?? null, steps: snapshot.steps,
      })),
      heartRateSamples: heartRateSamples.map((sample) => ({
        timestamp: sample.timestamp.toISOString(), bpm: sample.bpm, provenance: { provider: sample.source, device: null },
      })),
    });
  }
}

export const stepperWorkoutDiagnosticRepository = new StepperWorkoutDiagnosticRepository();
