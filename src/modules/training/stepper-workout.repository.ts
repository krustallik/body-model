import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { DEFAULT_TIME_ZONE, instantToLocalDateTime } from "@/model/time-zone";
import { MANUAL_STEPPER_SOURCE_PREFIX } from "@/modules/health/workout-source-identity";
import type { StepperWorkoutInput } from "./stepper-workout.schema";
import { rebaseCurrentAccountingSnapshotTimestamp } from "./rebase-current-accounting-snapshot";
import { resolveEventEnergyV1 } from "@/model/activity/canonical-activity-policy-v1";
import { adaptManualStepperEnergyV1 } from "./manual-stepper-fields-v1";
import { persistStepperReconciliationV1 } from "./stepper-reconciliation.service";
import { invalidateWorkoutEnergyInTransactionV1 } from "@/modules/activity/active-energy-invalidation";
import { recordExperimentalStepperActiveEnergyShadowsForLocalDate } from "@/modules/profile/experimental-stepper-active-energy-shadow.service";
import { publishActiveEnergyChangesV1 } from "@/modules/activity/active-energy-publication";
import { PhysiologyV7PersistenceRepository } from "@/modules/model-episodes/physiology-v7-persistence.repository";

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
  reconciliationStatus: "pending" | "ambiguous" | "confirmed" | null;
  reconciliationGroupId: number | null;
  reconciliationPeerWorkoutId: number | null;
  reconciliationRole: "manual" | "garmin" | null;
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
  activeEnergyAliases: {
    where: { sourceType: "workout" },
    select: { event: { select: { currentKcal: true, currentSource: true, resolutionRevision: true, isStale: true } } },
  },
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
  activeEnergyAliases: Array<{ event: { currentKcal: number | null; currentSource: string | null; resolutionRevision: number; isStale: boolean } }>;
}): StepperWorkoutDto {
  const source = row.sourceIdentity.startsWith(MANUAL_STEPPER_SOURCE_PREFIX) ? "manual" : "health";
  const adapted = adaptManualStepperEnergyV1({
    manualStepCount: null,
    manualActiveEnergyKcal: row.manualActiveEnergyKcal,
    bodyMassKg: null,
  });
  const selected = resolveEventEnergyV1({
    classification: "stair-climbing",
    activeEnergyKcal: row.activeEnergyKcal,
    manualActiveKcalPresent: adapted.manualKcalPresent,
    manualActiveKcal: adapted.manualKcal,
    mechanicalStepperKcal: null,
  });
  const canonical = row.activeEnergyAliases[0]?.event;
  const selectedActiveEnergyKcal = canonical
    ? canonical.isStale ? null : canonical.currentKcal
    : selected.selectedKcal;
  const selectedActiveEnergySource = canonical
    ? canonical.isStale ? "unavailable" : canonical.currentSource === "device-kcal" ? "garmin-fallback" : canonical.currentSource ?? "unavailable"
    : selected.source;
  return {
    id: row.id,
    type: row.type,
    startAt: row.startAt.toISOString(),
    endAt: row.endAt.toISOString(),
    durationMinutes: row.durationMinutes,
    activeEnergyKcal: row.activeEnergyKcal,
    manualStepCount: row.manualStepCount,
    manualActiveEnergyKcal: row.manualActiveEnergyKcal,
    selectedActiveEnergyKcal,
    selectedActiveEnergySource,
    selectedActiveEnergyFullCoverage: canonical
      ? !canonical.isStale && selectedActiveEnergyKcal !== null
      : selected.fullCoverage,
    reconciliationStatus: null,
    reconciliationGroupId: null,
    reconciliationPeerWorkoutId: null,
    reconciliationRole: null,
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

async function attachReconciliation(
  client: PrismaClient | import("@prisma/client").Prisma.TransactionClient,
  workouts: StepperWorkoutDto[],
): Promise<StepperWorkoutDto[]> {
  if (workouts.length === 0) return workouts;
  const ids = workouts.map((workout) => workout.id);
  const links = await client.stepperReconciliationCandidate.findMany({
    where: {
      group: { status: { in: ["pending", "ambiguous", "confirmed"] } },
      OR: [{ manualWorkoutId: { in: ids } }, { garminWorkoutId: { in: ids } }],
    },
    select: {
      manualWorkoutId: true,
      garminWorkoutId: true,
      groupId: true,
      group: { select: { id: true, status: true } },
    },
  });
  return workouts.map((workout) => {
    const link = links.find((row) => row.manualWorkoutId === workout.id || row.garminWorkoutId === workout.id);
    const status = link?.group.status;
    const role = link === undefined
      ? null
      : link.manualWorkoutId === workout.id
        ? "manual" as const
        : "garmin" as const;
    return {
      ...workout,
      reconciliationStatus: status === "pending" || status === "ambiguous" || status === "confirmed" ? status : null,
      reconciliationGroupId: link?.groupId ?? null,
      reconciliationPeerWorkoutId: link === undefined
        ? null
        : link.manualWorkoutId === workout.id
          ? link.garminWorkoutId
          : link.manualWorkoutId,
      reconciliationRole: role,
    };
  });
}

export class StepperWorkoutRepository {
  constructor(private readonly client: PrismaClient = prisma) {}

  async list(options: { limit?: number; offset?: number } = {}): Promise<StepperWorkoutDto[]> {
    const rows = await this.client.workout.findMany({
      where: { type: { equals: STEPPER_TYPE, mode: "insensitive" }, hiddenFromHistory: false },
      orderBy: [{ startAt: "desc" }, { id: "desc" }],
      take: options.limit ?? 100,
      ...(options.offset !== undefined ? { skip: Math.min(options.offset, 1_000_000) } : {}),
      select: stepperSelect,
    });
    return attachReconciliation(this.client, rows.map(toDto));
  }

  count(): Promise<number> {
    return this.client.workout.count({
      where: {
        type: { equals: STEPPER_TYPE, mode: "insensitive" },
        hiddenFromHistory: false,
      },
    });
  }

  async create(input: StepperWorkoutInput): Promise<StepperWorkoutDto> {
    const { startAt, endAt, date } = workoutDates(input);
    const row = await this.client.$transaction(async (transaction) => {
      await new PhysiologyV7PersistenceRepository(transaction).lockProfile(1);
      const day = await transaction.dailyHealthData.upsert({
        where: { date },
        create: { date, rawPayload: { source: "manual-stepper-training" } },
        update: {},
        select: { id: true },
      });
      const created = await transaction.workout.create({
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
      await invalidateWorkoutEnergyInTransactionV1({
        tx: transaction, profileId: 1, workoutIds: [created.id], affectedInstants: [startAt, endAt],
      });
      await persistStepperReconciliationV1(transaction, { from: date, to: date });
      return created;
    });
    if (this.client === prisma) {
      await recordExperimentalStepperActiveEnergyShadowsForLocalDate({ date, profileId: 1 });
      await publishActiveEnergyChangesV1();
    }
    const refreshed = await this.client.workout.findUnique({ where: { id: row.id }, select: stepperSelect });
    const [dto] = await attachReconciliation(this.client, refreshed ? [toDto(refreshed)] : []);
    return dto!;
  }

  async update(id: number, input: StepperWorkoutInput): Promise<StepperWorkoutDto | null> {
    const { startAt, endAt, date } = workoutDates(input);
    const affectedDates = new Set<string>([date]);
    const updatedId = await this.client.$transaction(async (transaction) => {
      await new PhysiologyV7PersistenceRepository(transaction).lockProfile(1);
      const existing = await transaction.workout.findFirst({
        where: { id, type: { equals: STEPPER_TYPE, mode: "insensitive" }, hiddenFromHistory: false },
        select: {
          id: true, sourceIdentity: true, dailyHealthDataId: true, externalId: true,
          dailyHealthData: { select: { date: true } },
          type: true, startAt: true, endAt: true, durationMinutes: true,
          energyKcal: true, activeEnergyKcal: true,
          matchedDiarySession: { select: { id: true } },
        },
      });
      if (existing === null) return null;
      affectedDates.add(existing.dailyHealthData.date);
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
      const linked = await transaction.strengthDiarySession.findFirst({
        where: { matchedWorkoutId: id },
        select: { id: true, effectiveAccountingAt: true, accountingTimeZone: true, accountingTimeZoneProvenance: true, webStartedAt: true, createdAt: true },
      });
      if (linked) {
        const previousEffectiveAt = linked.effectiveAccountingAt ?? linked.webStartedAt ?? linked.createdAt;
        if (previousEffectiveAt.getTime() !== startAt.getTime()) {
          const timeZone = linked.accountingTimeZone ?? DEFAULT_TIME_ZONE;
          const timeZoneProvenance = linked.accountingTimeZoneProvenance ?? "legacy-default";
          const previousLocalDate = instantToLocalDateTime(previousEffectiveAt, timeZone).date;
          const nextLocalDate = instantToLocalDateTime(startAt, timeZone).date;
          await transaction.strengthDiarySession.update({
            where: { id: linked.id },
            data: {
              effectiveAccountingAt: startAt,
              ...(previousLocalDate === nextLocalDate ? {} : {
                accountingInputRevision: { increment: 1 },
                currentSnapshotRevision: null,
              }),
            },
          });
          if (previousLocalDate === nextLocalDate) {
            await rebaseCurrentAccountingSnapshotTimestamp(transaction, {
              sessionId: linked.id,
              effectiveAccountingAt: startAt,
              effectiveLocalDate: nextLocalDate,
              timeZone,
              timeZoneProvenance,
            });
          }
        }
      }
      const reconcileFrom = existing.dailyHealthData.date < date ? existing.dailyHealthData.date : date;
      const reconcileTo = existing.dailyHealthData.date > date ? existing.dailyHealthData.date : date;
      await persistStepperReconciliationV1(transaction, { from: reconcileFrom, to: reconcileTo });
      await invalidateWorkoutEnergyInTransactionV1({
        tx: transaction,
        profileId: 1,
        workoutIds: [id],
        affectedInstants: [existing.startAt, existing.endAt, startAt, endAt],
      });
      return updated.id;
    });
    if (updatedId === null) return null;
    if (this.client === prisma) {
      for (const affectedDate of [...affectedDates].sort()) {
        await recordExperimentalStepperActiveEnergyShadowsForLocalDate({ date: affectedDate, profileId: 1 });
      }
      await publishActiveEnergyChangesV1();
    }
    const refreshed = await this.client.workout.findUnique({ where: { id: updatedId }, select: stepperSelect });
    if (!refreshed) return null;
    const [dto] = await attachReconciliation(this.client, [toDto(refreshed)]);
    return dto ?? null;
  }

  async delete(id: number): Promise<boolean> {
    let affectedDate: string | null = null;
    const deleted = await this.client.$transaction(async (transaction) => {
      await new PhysiologyV7PersistenceRepository(transaction).lockProfile(1);
      const existing = await transaction.workout.findFirst({
        where: { id, type: { equals: STEPPER_TYPE, mode: "insensitive" }, matchedDiarySession: { is: null }, hiddenFromHistory: false },
        select: { id: true, sourceIdentity: true, startAt: true, endAt: true, dailyHealthData: { select: { date: true } } },
      });
      if (!existing) return false;
      affectedDate = existing.dailyHealthData.date;
      const isManual = existing.sourceIdentity.startsWith(MANUAL_STEPPER_SOURCE_PREFIX);
      const changed = isManual
        ? await transaction.workout.deleteMany({ where: { id } })
        : await transaction.workout.updateMany({ where: { id }, data: { syncProtected: true, hiddenFromHistory: true } });
      if (changed.count !== 1) return false;
      const date = existing.dailyHealthData.date;
      await invalidateWorkoutEnergyInTransactionV1({
        tx: transaction, profileId: 1, workoutIds: [id], affectedInstants: [existing.startAt, existing.endAt],
      });
      await persistStepperReconciliationV1(transaction, { from: date, to: date });
      return true;
    });
    if (deleted && affectedDate !== null && this.client === prisma) {
      await recordExperimentalStepperActiveEnergyShadowsForLocalDate({ date: affectedDate, profileId: 1 });
      await publishActiveEnergyChangesV1();
    }
    return deleted;
  }
}

export const stepperWorkoutRepository = new StepperWorkoutRepository();
