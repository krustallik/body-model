import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { DEFAULT_TIME_ZONE, instantToLocalDateTime } from "@/model/time-zone";
import { MANUAL_STEPPER_SOURCE_PREFIX } from "@/modules/health/workout-source-identity";
import type { StepperWorkoutInput } from "./stepper-workout.schema";
import { resolveEventEnergyV1 } from "@/model/activity/canonical-activity-policy-v1";
import { adaptManualStepperEnergyV1 } from "./manual-stepper-fields-v1";

const STEPPER_TYPE = "Stair Climbing";

export type StepperWorkoutDto = {
  id: number;
  type: string;
  startAt: string;
  endAt: string;
  durationMinutes: number | null;
  activeEnergyKcal: number | null;
  manualStepCount: number | null;
  manualActiveEnergyKcal: number | null;
  selectedActiveEnergyKcal: number | null;
  selectedActiveEnergySource: string;
  selectedActiveEnergyFullCoverage: boolean;
  source: "manual" | "health";
  syncProtected: boolean;
  editable: boolean;
};

const stepperSelect = {
  id: true,
  type: true,
  startAt: true,
  endAt: true,
  durationMinutes: true,
  activeEnergyKcal: true,
  manualStepCount: true,
  manualActiveEnergyKcal: true,
  sourceIdentity: true,
  syncProtected: true,
  matchedDiarySession: { select: { id: true } },
  dailyHealthData: { select: { weightKg: true } },
} as const;

function toDto(row: {
  id: number;
  type: string;
  startAt: Date;
  endAt: Date;
  durationMinutes: number | null;
  activeEnergyKcal: number | null;
  manualStepCount: number | null;
  manualActiveEnergyKcal: number | null;
  sourceIdentity: string;
  syncProtected: boolean;
  matchedDiarySession: { id: number } | null;
  dailyHealthData: { weightKg: number | null };
}): StepperWorkoutDto {
  const source = row.sourceIdentity.startsWith(MANUAL_STEPPER_SOURCE_PREFIX) ? "manual" : "health";
  const adapted = adaptManualStepperEnergyV1({
    manualStepCount: row.manualStepCount,
    manualActiveEnergyKcal: row.manualActiveEnergyKcal,
    bodyMassKg: row.dailyHealthData.weightKg,
  });
  const selected = resolveEventEnergyV1({
    classification: "stair-climbing",
    activeEnergyKcal: row.activeEnergyKcal,
    manualActiveKcalPresent: adapted.manualKcalPresent,
    manualActiveKcal: adapted.manualKcal,
    mechanicalStepperKcal: adapted.mechanicalKcal,
  });
  return {
    id: row.id,
    type: row.type,
    startAt: row.startAt.toISOString(),
    endAt: row.endAt.toISOString(),
    durationMinutes: row.durationMinutes,
    activeEnergyKcal: row.activeEnergyKcal,
    manualStepCount: row.manualStepCount,
    manualActiveEnergyKcal: row.manualActiveEnergyKcal,
    selectedActiveEnergyKcal: selected.selectedKcal,
    selectedActiveEnergySource: selected.source,
    selectedActiveEnergyFullCoverage: selected.fullCoverage,
    source,
    syncProtected: row.syncProtected,
    editable: source === "manual" || row.matchedDiarySession === null,
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
      where: { type: { equals: STEPPER_TYPE, mode: "insensitive" }, hiddenFromHistory: false },
      orderBy: [{ startAt: "desc" }, { id: "desc" }],
      take: 100,
      select: stepperSelect,
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
          manualStepCount: input.manualStepCount ?? null,
          manualActiveEnergyKcal: input.manualActiveEnergyKcal ?? null,
        },
        select: stepperSelect,
      });
    });
    return toDto(row);
  }

  async update(id: number, input: StepperWorkoutInput): Promise<StepperWorkoutDto | null> {
    const { startAt, endAt, date } = workoutDates(input);
    return this.client.$transaction(async (transaction) => {
      const existing = await transaction.workout.findFirst({
        where: { id, type: { equals: STEPPER_TYPE, mode: "insensitive" }, hiddenFromHistory: false },
        select: {
          id: true, sourceIdentity: true, dailyHealthDataId: true, externalId: true,
          type: true, startAt: true, endAt: true, durationMinutes: true,
          energyKcal: true, activeEnergyKcal: true,
          matchedDiarySession: { select: { id: true } },
        },
      });
      if (existing === null) return null;
      const isManual = existing.sourceIdentity.startsWith(MANUAL_STEPPER_SOURCE_PREFIX);
      if (!isManual && existing.matchedDiarySession !== null) return null;
      const day = await transaction.dailyHealthData.upsert({
        where: { date },
        create: { date, rawPayload: { source: "manual-stepper-training" } },
        update: {},
        select: { id: true },
      });
      if (!isManual && day.id !== existing.dailyHealthDataId) {
        // Keep the original source identity in its original sync day so a
        // later Apple Health replay is absorbed by this hidden tombstone.
        await transaction.workout.create({
          data: {
            dailyHealthDataId: existing.dailyHealthDataId,
            externalId: existing.externalId,
            sourceIdentity: existing.sourceIdentity,
            type: existing.type,
            startAt: existing.startAt,
            endAt: existing.endAt,
            durationMinutes: existing.durationMinutes,
            energyKcal: existing.energyKcal,
            activeEnergyKcal: existing.activeEnergyKcal,
            syncProtected: true,
            hiddenFromHistory: true,
          },
        });
      }
      const updated = await transaction.workout.update({
        where: { id },
        data: {
          dailyHealthDataId: day.id,
          startAt,
          endAt,
          durationMinutes: input.durationMinutes,
          manualStepCount: input.manualStepCount ?? null,
          manualActiveEnergyKcal: input.manualActiveEnergyKcal ?? null,
          ...(isManual ? {} : { syncProtected: true }),
        },
        select: stepperSelect,
      });
      return toDto(updated);
    });
  }

  async delete(id: number): Promise<boolean> {
    const healthRow = await this.client.workout.findFirst({
      where: { id, type: { equals: STEPPER_TYPE, mode: "insensitive" }, NOT: { sourceIdentity: { startsWith: MANUAL_STEPPER_SOURCE_PREFIX } }, matchedDiarySession: { is: null }, hiddenFromHistory: false },
      select: { id: true },
    });
    if (healthRow) {
      const result = await this.client.workout.updateMany({
        where: { id: healthRow.id },
        data: { syncProtected: true, hiddenFromHistory: true },
      });
      return result.count === 1;
    }
    const result = await this.client.workout.deleteMany({
      where: {
        id,
        type: { equals: STEPPER_TYPE, mode: "insensitive" },
        sourceIdentity: { startsWith: MANUAL_STEPPER_SOURCE_PREFIX },
        matchedDiarySession: { is: null },
        hiddenFromHistory: false,
      },
    });
    return result.count === 1;
  }
}

export const stepperWorkoutRepository = new StepperWorkoutRepository();
