import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { logEvent } from "@/lib/logger";
import { DEFAULT_TIME_ZONE, instantToLocalDateTime } from "@/model/time-zone";
import { MANUAL_STEPPER_SOURCE_PREFIX } from "@/modules/health/workout-source-identity";
import { episodeTimeContextForInstantV1 } from "@/modules/model-episodes/episode-time-context-v1";
import type { StepperWorkoutInput } from "./stepper-workout.schema";
import { rebaseCurrentAccountingSnapshotTimestamp } from "./rebase-current-accounting-snapshot";
import { resolveEventEnergyV1 } from "@/model/activity/canonical-activity-policy-v1";
import { adaptManualStepperEnergyV1 } from "./manual-stepper-fields-v1";
import { persistStepperReconciliationV1 } from "./stepper-reconciliation.service";
import { invalidateWorkoutEnergyInTransactionV1 } from "@/modules/activity/active-energy-invalidation";
import { recordExperimentalStepperActiveEnergyShadowsForLocalDate } from "@/modules/profile/experimental-stepper-active-energy-shadow.service";
import { recordExperimentalStepperGlycogenDemandShadowsForLocalDate } from "@/modules/profile/experimental-stepper-glycogen-demand-shadow.service";
import { recordExperimentalGlycogenStateShadow } from "@/modules/model-episodes/experimental-glycogen-state-shadow.service";
import { publishActiveEnergyChangesV1 } from "@/modules/activity/active-energy-publication";
import type { ActiveEnergyPublicationStatusV1 } from "@/modules/activity/active-energy-publication";
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
  /** Source persistence can succeed while dependent model publication stays fail-closed. */
  modelPublicationStatus?: ActiveEnergyPublicationStatusV1;
};

export type StepperWorkoutDeleteResult = {
  deleted: boolean;
  modelPublicationStatus?: ActiveEnergyPublicationStatusV1;
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

async function earliestAffectedDateV1(
  transaction: Prisma.TransactionClient,
  sourceDates: readonly string[],
  eventInstants: readonly Date[],
): Promise<string> {
  const episodes = await transaction.modelEpisode.findMany({
    where: { profileId: 1 },
    orderBy: [{ startDate: "asc" }, { id: "asc" }],
    select: { id: true, startDate: true, timezone: true, active: true },
  });
  const dates = [
    ...sourceDates,
    ...eventInstants.filter((instant) => Number.isFinite(instant.getTime()))
      .map((instant) => episodeTimeContextForInstantV1(episodes, instant).date),
  ];
  const earliest = dates.sort()[0];
  if (earliest === undefined) throw new Error("stepper invalidation requires an affected source or model date");
  return earliest;
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

  private async refreshAndPublish(dates: string[], sourceKeys: string[], eventInstants: Date[]): Promise<ActiveEnergyPublicationStatusV1> {
    const lifecycle = new PhysiologyV7PersistenceRepository();
    const retryTokens = new Map<string, { revision: number; fromDate: string }>();
    const fallbackDates = new Set(dates);
    let dependenciesRefreshed = false;
    try {
      const episodes = await prisma.modelEpisode.findMany({
        where: { profileId: 1 }, orderBy: [{ startDate: "asc" }, { id: "asc" }],
        select: { id: true, startDate: true, timezone: true, active: true },
      });
      for (const instant of eventInstants) {
        if (Number.isFinite(instant.getTime())) fallbackDates.add(episodeTimeContextForInstantV1(episodes, instant).date);
      }
      for (const sourceKey of sourceKeys) {
        const token = await lifecycle.readUnifiedPublicationBlockToken({ profileId: 1, source: "stepper", sourceKey });
        if (token !== null) retryTokens.set(sourceKey, token);
      }
      await this.refreshStepperDependencies(dates, sourceKeys, eventInstants);
      dependenciesRefreshed = true;
      if (await lifecycle.hasUnifiedPublicationBlocks(1)) return "stale";
      if (await publishActiveEnergyChangesV1()) return "current";
    } catch (error) {
      if (dependenciesRefreshed) {
        await this.reblockStepperSourcesWhenUnblocked(lifecycle, sourceKeys, retryTokens, [...fallbackDates].sort()[0]);
      } else {
        await this.reblockStepperSources(lifecycle, sourceKeys, retryTokens, [...fallbackDates].sort()[0]);
      }
      logEvent("warn", "stepper_publication_failed_after_source_write", {
        sourceCount: sourceKeys.length,
        errorType: error instanceof Error ? error.name : "unknown",
      });
      return "stale";
    }
    await this.reblockStepperSourcesWhenUnblocked(
      lifecycle,
      sourceKeys,
      retryTokens,
      [...fallbackDates].sort()[0],
    );
    return "stale";
  }

  private async reblockStepperSourcesWhenUnblocked(
    lifecycle: PhysiologyV7PersistenceRepository,
    sourceKeys: string[],
    retryTokens: ReadonlyMap<string, { revision: number; fromDate: string }>,
    fallbackFromDate: string | undefined,
  ): Promise<void> {
    try {
      if (await lifecycle.hasUnifiedPublicationBlocks(1)) return;
    } catch {
      // Restore a retry handle if shared publication state cannot be inspected.
    }
    await this.reblockStepperSources(lifecycle, sourceKeys, retryTokens, fallbackFromDate);
  }

  private async reblockStepperSources(
    lifecycle: PhysiologyV7PersistenceRepository,
    sourceKeys: string[],
    retryTokens: ReadonlyMap<string, { revision: number; fromDate: string }>,
    fallbackFromDate: string | undefined,
  ): Promise<void> {
    if (fallbackFromDate === undefined) throw new Error("stepper publication retry has no model-day boundary");
    for (const sourceKey of sourceKeys) {
      await lifecycle.blockUnifiedPublication({
        profileId: 1,
        fromDate: retryTokens.get(sourceKey)?.fromDate ?? fallbackFromDate,
        source: "stepper",
        sourceKey,
      });
    }
  }

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
    const sourceKey = `${MANUAL_STEPPER_SOURCE_PREFIX}${randomUUID()}`;
    const row = await this.client.$transaction(async (transaction) => {
      const lifecycle = new PhysiologyV7PersistenceRepository(transaction);
      await lifecycle.lockProfile(1);
      const day = await transaction.dailyHealthData.upsert({
        where: { date },
        create: { date, rawPayload: { source: "manual-stepper-training" } },
        update: {},
        select: { id: true },
      });
      const created = await transaction.workout.create({
        data: {
          dailyHealthDataId: day.id,
          sourceIdentity: sourceKey,
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
      // The profile lock makes this source row plus its numeric-id blocker
      // visible atomically. Numeric IDs are also the key used by later update,
      // delete, and retry operations, so a failed post-commit refresh remains
      // recoverable through the same durable fence.
      await new PhysiologyV7PersistenceRepository(transaction).blockUnifiedPublication({
        profileId: 1,
        fromDate: await earliestAffectedDateV1(transaction, [date], [startAt]),
        source: "stepper",
        sourceKey: String(created.id),
      });
      await invalidateWorkoutEnergyInTransactionV1({
        tx: transaction, profileId: 1, workoutIds: [created.id], affectedInstants: [startAt, endAt],
      });
      await persistStepperReconciliationV1(transaction, { from: date, to: date });
      return created;
    });
    const modelPublicationStatus = this.client === prisma
      ? await this.refreshAndPublish([date], [String(row.id)], [startAt])
      : "not-run";
    const refreshed = await this.client.workout.findUnique({ where: { id: row.id }, select: stepperSelect });
    const [dto] = await attachReconciliation(this.client, refreshed ? [toDto(refreshed)] : []);
    return { ...dto!, modelPublicationStatus };
  }

  async update(id: number, input: StepperWorkoutInput): Promise<StepperWorkoutDto | null> {
    const { startAt, endAt, date } = workoutDates(input);
    const affectedDates = new Set<string>([date]);
    let previousStartAt: Date | null = null;
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
      previousStartAt = existing.startAt;
      affectedDates.add(existing.dailyHealthData.date);
      const isManual = existing.sourceIdentity.startsWith(MANUAL_STEPPER_SOURCE_PREFIX);
      if (!isManual && existing.matchedDiarySession !== null) return null;
      await new PhysiologyV7PersistenceRepository(transaction).blockUnifiedPublication({
        profileId: 1,
        fromDate: await earliestAffectedDateV1(
          transaction,
          [existing.dailyHealthData.date, date],
          [existing.startAt, startAt],
        ),
        source: "stepper",
        sourceKey: String(id),
      });
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
    const modelPublicationStatus = this.client === prisma
      ? await this.refreshAndPublish([...affectedDates].sort(), [String(id)], [previousStartAt ?? startAt, startAt])
      : "not-run";
    const refreshed = await this.client.workout.findUnique({ where: { id: updatedId }, select: stepperSelect });
    if (!refreshed) return null;
    const [dto] = await attachReconciliation(this.client, [toDto(refreshed)]);
    return dto ? { ...dto, modelPublicationStatus } : null;
  }

  async delete(id: number): Promise<StepperWorkoutDeleteResult> {
    const outcome = await this.client.$transaction(async (transaction) => {
      const lifecycle = new PhysiologyV7PersistenceRepository(transaction);
      await lifecycle.lockProfile(1);
      const existing = await transaction.workout.findFirst({
        where: { id, type: { equals: STEPPER_TYPE, mode: "insensitive" }, matchedDiarySession: { is: null }, hiddenFromHistory: false },
        select: { id: true, sourceIdentity: true, startAt: true, endAt: true, dailyHealthData: { select: { date: true } } },
      });
      if (!existing) {
        const token = await lifecycle.readUnifiedPublicationBlockToken({ profileId: 1, source: "stepper", sourceKey: String(id) });
        if (token === null) return { shouldRefresh: false as const, sourceDate: null, eventAt: null };
        const hidden = await transaction.workout.findFirst({
          where: { id, type: { equals: STEPPER_TYPE, mode: "insensitive" } },
          select: { startAt: true, dailyHealthData: { select: { date: true } } },
        });
        return {
          // Repeating DELETE is the retry path for a previously committed
          // source mutation whose dependent refresh failed after commit.
          shouldRefresh: true as const,
          sourceDate: hidden?.dailyHealthData.date ?? token.fromDate,
          eventAt: hidden?.startAt ?? null,
        };
      }
      const isManual = existing.sourceIdentity.startsWith(MANUAL_STEPPER_SOURCE_PREFIX);
      const changed = isManual
        ? await transaction.workout.deleteMany({ where: { id } })
        : await transaction.workout.updateMany({ where: { id }, data: { syncProtected: true, hiddenFromHistory: true } });
      if (changed.count !== 1) return { shouldRefresh: false as const, sourceDate: null, eventAt: null };
      if (!isManual) {
        // Hidden Health rows remain durable source records, but their derived
        // glycogen demand must stop contributing to the visible model state.
        await transaction.experimentalStepperGlycogenDemandShadow.deleteMany({ where: { workoutId: id } });
      }
      const date = existing.dailyHealthData.date;
      await lifecycle.blockUnifiedPublication({
        profileId: 1,
        fromDate: await earliestAffectedDateV1(transaction, [date], [existing.startAt]),
        source: "stepper",
        sourceKey: String(id),
      });
      await invalidateWorkoutEnergyInTransactionV1({
        tx: transaction, profileId: 1, workoutIds: [id], affectedInstants: [existing.startAt, existing.endAt],
      });
      await persistStepperReconciliationV1(transaction, { from: date, to: date });
      return { shouldRefresh: true as const, sourceDate: date, eventAt: existing.startAt };
    });
    if (!outcome.shouldRefresh) return { deleted: false };
    const modelPublicationStatus = this.client === prisma
      ? await this.refreshAndPublish([outcome.sourceDate!], [String(id)], outcome.eventAt ? [outcome.eventAt] : [])
      : "not-run";
    return { deleted: true, modelPublicationStatus };
  }

  private async refreshStepperDependencies(dates: string[], sourceKeys: string[], eventInstants: Date[]): Promise<void> {
    const lifecycle = new PhysiologyV7PersistenceRepository();
    const tokens = new Map<string, { revision: number; fromDate: string }>();
    const sourceDates = new Set(dates);
    const modelDates = new Set(dates);
    const episodes = await prisma.modelEpisode.findMany({
      where: { profileId: 1 }, orderBy: [{ startDate: "asc" }, { id: "asc" }],
      select: { id: true, startDate: true, timezone: true, active: true },
    });
    for (const instant of eventInstants) {
      if (Number.isFinite(instant.getTime())) modelDates.add(episodeTimeContextForInstantV1(episodes, instant).date);
    }
    for (const sourceKey of sourceKeys) {
      const token = await lifecycle.readUnifiedPublicationBlockToken({ profileId: 1, source: "stepper", sourceKey });
      if (token === null) throw new Error("stepper source is missing its durable Unified publication fence");
      tokens.set(sourceKey, token);
      // A retry may be servicing an older failed move than the event dates
      // supplied by this request. Rebuild both shadow and state suffix from
      // the durable earliest boundary before CAS clear.
      sourceDates.add(token.fromDate);
      modelDates.add(token.fromDate);
      const numericId = Number(sourceKey);
      const current = Number.isSafeInteger(numericId) && String(numericId) === sourceKey
        ? await prisma.workout.findUnique({ where: { id: numericId }, select: { startAt: true, dailyHealthData: { select: { date: true } } } })
        : await prisma.workout.findFirst({ where: { sourceIdentity: sourceKey }, select: { startAt: true, dailyHealthData: { select: { date: true } } } });
      if (current) {
        sourceDates.add(current.dailyHealthData.date);
        modelDates.add(episodeTimeContextForInstantV1(episodes, current.startAt).date);
      }
    }
    for (const date of [...sourceDates].sort()) {
      await recordExperimentalStepperActiveEnergyShadowsForLocalDate({ date, profileId: 1 });
      await recordExperimentalStepperGlycogenDemandShadowsForLocalDate({ date, profileId: 1 });
    }
    const modelFromDate = [...modelDates].sort()[0];
    if (modelFromDate !== undefined) await recordExperimentalGlycogenStateShadow({ date: modelFromDate, profileId: 1 });
    for (const sourceKey of sourceKeys) {
      const token = tokens.get(sourceKey)!;
      if (!await lifecycle.clearUnifiedPublicationBlock({
        profileId: 1, source: "stepper", sourceKey, expectedRevision: token.revision,
        expectedFromDate: token.fromDate,
      })) throw new Error("stepper source changed during dependent-shadow refresh; Unified remains blocked");
    }
  }
}

export const stepperWorkoutRepository = new StepperWorkoutRepository();
