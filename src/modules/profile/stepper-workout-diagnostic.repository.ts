import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { buildStepperWorkoutDiagnosticV7, type StepperWorkoutDiagnosticV7 } from "./stepper-workout-diagnostic";

export class StepperWorkoutDiagnosticRepository {
  constructor(private readonly client: PrismaClient = prisma) {}

  async get(workoutId: number): Promise<StepperWorkoutDiagnosticV7 | null | undefined> {
    const workout = await this.client.workout.findFirst({
      where: { id: workoutId, hiddenFromHistory: false },
      select: { id: true, type: true, startAt: true, endAt: true, durationMinutes: true, activeEnergyKcal: true },
    });
    if (workout === null) return undefined;
    const [snapshots, stepIntervals, heartRateSamples] = await Promise.all([
      this.client.healthSyncSnapshot.findMany({
        select: { id: true, receivedAt: true, syncedAt: true, steps: true },
      }),
      this.client.healthActivityInterval.findMany({
        where: {
          metric: "steps",
          startAt: { lt: workout.endAt },
          endAt: { gt: workout.startAt },
        },
        select: { id: true, startAt: true, endAt: true, value: true },
        orderBy: [{ startAt: "asc" }, { id: "asc" }],
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
      snapshots: snapshots.map((snapshot) => ({
        id: snapshot.id, receivedAt: snapshot.receivedAt.toISOString(), syncedAt: snapshot.syncedAt?.toISOString() ?? null, steps: snapshot.steps,
      })),
      stepIntervals: stepIntervals.map((sample) => ({
        id: sample.id,
        startAt: sample.startAt.toISOString(),
        endAt: sample.endAt.toISOString(),
        stepCount: sample.value.toNumber(),
      })),
      heartRateSamples: heartRateSamples.map((sample) => ({
        timestamp: sample.timestamp.toISOString(), bpm: sample.bpm, provenance: { provider: sample.source, device: null },
      })),
    });
  }
}

export const stepperWorkoutDiagnosticRepository = new StepperWorkoutDiagnosticRepository();
