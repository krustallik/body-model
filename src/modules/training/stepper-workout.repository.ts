import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { DEFAULT_TIME_ZONE, instantToLocalDateTime } from "@/model/time-zone";
import { MANUAL_STEPPER_SOURCE_PREFIX } from "@/modules/health/workout-source-identity";
import { episodeTimeContextForInstantV1 } from "@/modules/model-episodes/episode-time-context-v1";
import type { StepperWorkoutInput } from "./stepper-workout.schema";
import { rebaseCurrentAccountingSnapshotTimestamp } from "./rebase-current-accounting-snapshot";
import { resolveEventEnergyV1 } from "@/model/activity/canonical-activity-policy-v1";
import { adaptManualStepperEnergyV1 } from "./manual-stepper-fields-v1";
import { persistStepperReconciliationV1 } from "./stepper-reconciliation.service";
import { invalidateWorkoutEnergyInTransactionV1 } from "@/modules/activity/active-energy-invalidation";
import type { ActiveEnergyPublicationStatusV1 } from "@/modules/activity/active-energy-publication";
import { PhysiologyV7PersistenceRepository } from "@/modules/model-episodes/physiology-v7-persistence.repository";
import { enqueueTrainingSourceChangeInTransaction } from "./training-refresh-queue";
import { sha256Canonical } from "./persisted-load-accounting-v1";
import {
  activeEnergyConvergenceFenceChanged,
  isTrainingRefreshPending,
  readActiveEnergyConvergenceVisibilityFence,
  readTrainingRefreshVisibilityFence,
  trainingRefreshFenceChanged,
} from "./training-refresh-queue";

const STEPPER_TYPE = "Stair Climbing";

export class StepperCreateOperationConflictError extends Error {
  constructor() {
    super("Stepper create operation ID was already used with a different payload.");
    this.name = "StepperCreateOperationConflictError";
  }
}

export class StepperCreateOperationTombstonedError extends Error {
  constructor() {
    super("Stepper create operation is terminal because its workout was deleted.");
    this.name = "StepperCreateOperationTombstonedError";
  }
}

export type StepperCreateOperationResolution =
  | { state: "NOT_FOUND" }
  | { state: "CONFLICT" }
  | { state: "TOMBSTONED" }
  | { state: "COMMITTED"; workout: StepperWorkoutDto };

function stepperCreatePayloadDigest(input: StepperWorkoutInput): string {
  return sha256Canonical({
    version: 1,
    startAt: new Date(input.startAt).toISOString(),
    durationMinutes: input.durationMinutes,
    manualStepCount: input.manualStepCount ?? null,
    manualActiveEnergyKcal: input.manualActiveEnergyKcal ?? null,
  });
}

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
  hiddenFromHistory: true,
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

  async list(options: { limit?: number; offset?: number } = {}): Promise<StepperWorkoutDto[]> {
    const trainingFence = await readTrainingRefreshVisibilityFence(this.client, 1);
    const convergenceFence = await readActiveEnergyConvergenceVisibilityFence(this.client, 1);
    const rows = await this.client.workout.findMany({
      where: { type: { equals: STEPPER_TYPE, mode: "insensitive" }, hiddenFromHistory: false },
      orderBy: [{ startAt: "desc" }, { id: "desc" }],
      take: options.limit ?? 100,
      ...(options.offset !== undefined ? { skip: Math.min(options.offset, 1_000_000) } : {}),
      select: stepperSelect,
    });
    const workouts = await attachReconciliation(this.client, rows.map(toDto));
    if (convergenceFence?.active === true
        || isTrainingRefreshPending(trainingFence)
        || await trainingRefreshFenceChanged(this.client, 1, trainingFence)
        || await activeEnergyConvergenceFenceChanged(this.client, 1, convergenceFence)) {
      return workouts.map((workout) => ({
        ...workout,
        selectedActiveEnergyKcal: null,
        selectedActiveEnergySource: "unavailable",
        selectedActiveEnergyFullCoverage: false,
      }));
    }
    return workouts;
  }

  count(): Promise<number> {
    return this.client.workout.count({
      where: {
        type: { equals: STEPPER_TYPE, mode: "insensitive" },
        hiddenFromHistory: false,
      },
    });
  }

  async create(input: StepperWorkoutInput, operationId?: string): Promise<StepperWorkoutDto> {
    const { startAt, endAt, date } = workoutDates(input);
    const sourceKey = `${MANUAL_STEPPER_SOURCE_PREFIX}${operationId ?? randomUUID()}`;
    const payloadDigest = stepperCreatePayloadDigest(input);
    const outcome = await this.client.$transaction(async (transaction) => {
      const lifecycle = new PhysiologyV7PersistenceRepository(transaction);
      await lifecycle.lockProfile(1);
      if (operationId !== undefined) {
        const inserted = await transaction.$queryRaw<Array<{ operationId: string }>>`
          INSERT INTO "StepperCreateOperation" (
            "profileId", "operationId", "payloadVersion", "payloadDigest", "state", "createdAt", "updatedAt"
          ) VALUES (1, ${operationId}, 1, ${payloadDigest}, 'PENDING', clock_timestamp(), clock_timestamp())
          ON CONFLICT ("profileId", "operationId") DO NOTHING
          RETURNING "operationId"
        `;
        if (inserted.length === 0) {
          const existing = await transaction.stepperCreateOperation.findUnique({
            where: { profileId_operationId: { profileId: 1, operationId } },
            select: { payloadDigest: true, state: true, workoutId: true },
          });
          if (!existing) throw new Error("Stepper create operation conflict was not readable after serialization.");
          if (existing.payloadDigest !== payloadDigest) throw new StepperCreateOperationConflictError();
          return {
            kind: existing.state === "TOMBSTONED" ? "tombstoned" as const : "existing" as const,
            workoutId: existing.workoutId,
          };
        }
      }
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
      const modelDate = await earliestAffectedDateV1(transaction, [], [startAt]);
      await enqueueTrainingSourceChangeInTransaction(transaction, {
        profileId: 1,
        operationKind: "stepper_workout_create",
        affectedSessionIds: [],
        affectedWorkoutIds: [created.id],
        publicationBlockSourceKeys: [String(created.id)],
        newSourceIdentity: { kind: "manual-stepper", workoutId: created.id, sourceIdentity: sourceKey },
        newEventInstants: [startAt.toISOString(), endAt.toISOString()],
        oldModelDates: [],
        // Demand shadows are keyed by the owning DailyHealthData date, while
        // physiology replay uses the episode-local date. Keep both durable so
        // a restart can rebuild the exact source row as well as its replay
        // suffix (these differ around timezone boundaries).
        newModelDates: [...new Set([date, modelDate])].sort(),
        deadlineMode: "stepper-fast",
      });
      if (operationId !== undefined) {
        await transaction.stepperCreateOperation.update({
          where: { profileId_operationId: { profileId: 1, operationId } },
          data: { workoutId: created.id, state: "COMMITTED" },
        });
      }
      return { kind: "created" as const, workoutId: created.id };
    });
    if (outcome.kind === "tombstoned" || outcome.workoutId === null) throw new StepperCreateOperationTombstonedError();
    const refreshed = await this.client.workout.findUnique({ where: { id: outcome.workoutId }, select: stepperSelect });
    if (!refreshed || refreshed.hiddenFromHistory) throw new StepperCreateOperationTombstonedError();
    const [dto] = await attachReconciliation(this.client, refreshed ? [toDto(refreshed)] : []);
    return { ...dto!, modelPublicationStatus: this.client === prisma ? "stale" : "not-run" };
  }

  async resolveCreateOperation(input: { operationId: string; payloadDigest?: string }): Promise<StepperCreateOperationResolution> {
    const operation = await this.client.stepperCreateOperation.findUnique({
      where: { profileId_operationId: { profileId: 1, operationId: input.operationId } },
      select: { payloadDigest: true, state: true, workoutId: true },
    });
    if (!operation) return { state: "NOT_FOUND" };
    if (input.payloadDigest !== undefined && operation.payloadDigest !== input.payloadDigest) return { state: "CONFLICT" };
    if (operation.state === "TOMBSTONED" || operation.workoutId === null) return { state: "TOMBSTONED" };
    const workout = await this.client.workout.findUnique({
      where: { id: operation.workoutId },
      select: stepperSelect,
    });
    if (!workout || workout.hiddenFromHistory) {
      return { state: "TOMBSTONED" };
    }
    const [dto] = await attachReconciliation(this.client, [toDto(workout)]);
    return dto ? { state: "COMMITTED", workout: dto } : { state: "TOMBSTONED" };
  }

  async update(id: number, input: StepperWorkoutInput): Promise<StepperWorkoutDto | null> {
    const { startAt, endAt, date } = workoutDates(input);
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
      const episodes = await transaction.modelEpisode.findMany({
        where: { profileId: 1 },
        orderBy: [{ startDate: "asc" }, { id: "asc" }],
        select: { id: true, startDate: true, timezone: true, active: true },
      });
      const oldModelDate = episodeTimeContextForInstantV1(episodes, existing.startAt).date;
      const newModelDate = episodeTimeContextForInstantV1(episodes, startAt).date;
      await enqueueTrainingSourceChangeInTransaction(transaction, {
        profileId: 1,
        operationKind: "stepper_workout_update",
        affectedSessionIds: linked === null ? [] : [linked.id],
        affectedWorkoutIds: [id],
        publicationBlockSourceKeys: [String(id)],
        oldSourceIdentity: { kind: "stepper", workoutId: id, sourceIdentity: existing.sourceIdentity },
        newSourceIdentity: { kind: "stepper", workoutId: id, sourceIdentity: updated.sourceIdentity },
        oldEventInstants: [existing.startAt.toISOString(), existing.endAt.toISOString()],
        newEventInstants: [startAt.toISOString(), endAt.toISOString()],
        oldModelDates: [...new Set([existing.dailyHealthData.date, oldModelDate])],
        newModelDates: [...new Set([date, newModelDate])],
        deadlineMode: "stepper-fast",
      });
      return updated.id;
    });
    if (updatedId === null) return null;
    const refreshed = await this.client.workout.findUnique({ where: { id: updatedId }, select: stepperSelect });
    if (!refreshed) return null;
    const [dto] = await attachReconciliation(this.client, [toDto(refreshed)]);
    return dto ? { ...dto, modelPublicationStatus: this.client === prisma ? "stale" : "not-run" } : null;
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
        await enqueueTrainingSourceChangeInTransaction(transaction, {
          profileId: 1,
          operationKind: "stepper_workout_delete_recovery",
          affectedSessionIds: [],
          affectedWorkoutIds: [id],
          publicationBlockSourceKeys: [String(id)],
          oldSourceIdentity: { kind: "stepper", workoutId: id },
          oldEventInstants: hidden?.startAt ? [hidden.startAt.toISOString()] : [],
          oldModelDates: [token.fromDate],
          newModelDates: [],
          deadlineMode: "stepper-fast",
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
      if (isManual) {
        await transaction.stepperCreateOperation.updateMany({
          where: { profileId: 1, workoutId: id, state: "COMMITTED" },
          data: { state: "TOMBSTONED" },
        });
      }
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
      const modelDate = await earliestAffectedDateV1(transaction, [], [existing.startAt]);
      await enqueueTrainingSourceChangeInTransaction(transaction, {
        profileId: 1,
        operationKind: "stepper_workout_delete",
        affectedSessionIds: [],
        affectedWorkoutIds: [id],
        publicationBlockSourceKeys: [String(id)],
        oldSourceIdentity: { kind: "stepper", workoutId: id, sourceIdentity: existing.sourceIdentity },
        oldEventInstants: [existing.startAt.toISOString(), existing.endAt.toISOString()],
        oldModelDates: [...new Set([date, modelDate])],
        newModelDates: [],
        deadlineMode: "stepper-fast",
      });
      return { shouldRefresh: true as const, sourceDate: date, eventAt: existing.startAt };
    });
    if (!outcome.shouldRefresh) return { deleted: false };
    return { deleted: true, modelPublicationStatus: this.client === prisma ? "stale" : "not-run" };
  }
}

export const stepperWorkoutRepository = new StepperWorkoutRepository();
