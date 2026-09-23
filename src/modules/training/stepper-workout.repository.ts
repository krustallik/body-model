import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { DEFAULT_TIME_ZONE, instantToLocalDateTime } from "@/model/time-zone";
import { MANUAL_STEPPER_SOURCE_PREFIX } from "@/modules/health/workout-source-identity";
import type { StepperWorkoutInput } from "./stepper-workout.schema";

const STEPPER_TYPE = "Stair Climbing";

export type StepperWorkoutDto = {
  id: number;
  type: string;
  startAt: string;
  endAt: string;
  durationMinutes: number | null;
  activeEnergyKcal: number | null;
  source: "manual" | "health";
};

function toDto(row: {
  id: number;
  type: string;
  startAt: Date;
  endAt: Date;
  durationMinutes: number | null;
  activeEnergyKcal: number | null;
  sourceIdentity: string;
}): StepperWorkoutDto {
  return {
    id: row.id,
    type: row.type,
    startAt: row.startAt.toISOString(),
    endAt: row.endAt.toISOString(),
    durationMinutes: row.durationMinutes,
    activeEnergyKcal: row.activeEnergyKcal,
    source: row.sourceIdentity.startsWith(MANUAL_STEPPER_SOURCE_PREFIX) ? "manual" : "health",
  };
}

function workoutDates(input: StepperWorkoutInput) {
  const startAt = new Date(input.startAt);
  const endAt = new Date(startAt.getTime() + input.durationMinutes * 60_000);
  const date = instantToLocalDateTime(startAt, DEFAULT_TIME_ZONE).date;
  return { startAt, endAt, date };
}

export class StepperWorkoutRepository {
  constructor(private readonly client: PrismaClient = prisma) {}

  async list(): Promise<StepperWorkoutDto[]> {
    const rows = await this.client.workout.findMany({
      where: { type: { equals: STEPPER_TYPE, mode: "insensitive" } },
      orderBy: [{ startAt: "desc" }, { id: "desc" }],
      take: 100,
      select: { id: true, type: true, startAt: true, endAt: true, durationMinutes: true, activeEnergyKcal: true, sourceIdentity: true },
    });
    return rows.map(toDto);
  }

  async create(input: StepperWorkoutInput): Promise<StepperWorkoutDto> {
    const { startAt, endAt, date } = workoutDates(input);
    const row = await this.client.$transaction(async (transaction) => {
      const day = await transaction.dailyHealthData.upsert({
        where: { date },
        create: { date, rawPayload: { source: "manual-stepper-training" } },
        update: {},
        select: { id: true },
      });
      return transaction.workout.create({
        data: {
          dailyHealthDataId: day.id,
          sourceIdentity: `${MANUAL_STEPPER_SOURCE_PREFIX}${randomUUID()}`,
          type: STEPPER_TYPE,
          startAt,
          endAt,
          durationMinutes: input.durationMinutes,
          energyKcal: null,
          activeEnergyKcal: null,
        },
        select: { id: true, type: true, startAt: true, endAt: true, durationMinutes: true, activeEnergyKcal: true, sourceIdentity: true },
      });
    });
    return toDto(row);
  }

  async update(id: number, input: StepperWorkoutInput): Promise<StepperWorkoutDto | null> {
    const { startAt, endAt, date } = workoutDates(input);
    return this.client.$transaction(async (transaction) => {
      const existing = await transaction.workout.findFirst({
        where: { id, type: { equals: STEPPER_TYPE, mode: "insensitive" }, sourceIdentity: { startsWith: MANUAL_STEPPER_SOURCE_PREFIX } },
        select: { id: true, sourceIdentity: true },
      });
      if (existing === null) return null;
      const day = await transaction.dailyHealthData.upsert({
        where: { date },
        create: { date, rawPayload: { source: "manual-stepper-training" } },
        update: {},
        select: { id: true },
      });
      const updated = await transaction.workout.update({
        where: { id },
        data: { dailyHealthDataId: day.id, startAt, endAt, durationMinutes: input.durationMinutes },
        select: { id: true, type: true, startAt: true, endAt: true, durationMinutes: true, activeEnergyKcal: true, sourceIdentity: true },
      });
      return toDto(updated);
    });
  }

  async delete(id: number): Promise<boolean> {
    const result = await this.client.workout.deleteMany({
      where: {
        id,
        type: { equals: STEPPER_TYPE, mode: "insensitive" },
        sourceIdentity: { startsWith: MANUAL_STEPPER_SOURCE_PREFIX },
        matchedDiarySession: { is: null },
      },
    });
    return result.count === 1;
  }
}

export const stepperWorkoutRepository = new StepperWorkoutRepository();
