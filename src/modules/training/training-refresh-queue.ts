import { Prisma, type PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { PhysiologyV7PersistenceRepository } from "@/modules/model-episodes/physiology-v7-persistence.repository";
import { getTrainingRefreshWorkerLease } from "./training-refresh-worker-context";

export type TrainingRefreshDatabaseClient = PrismaClient | Prisma.TransactionClient;
type TransactionClient = Prisma.TransactionClient;

export type TrainingRefreshDeadlineMode = "training-debounce" | "health-fast" | "stepper-fast";

export type TrainingSourceChangeEvidence = {
  profileId: number;
  operationKind: string;
  affectedSessionIds: readonly number[];
  affectedExerciseIds?: readonly number[];
  affectedSetIds?: readonly number[];
  affectedWorkoutIds?: readonly number[];
  publicationBlockSourceKeys?: readonly string[];
  oldSourceIdentity?: Prisma.InputJsonValue;
  newSourceIdentity?: Prisma.InputJsonValue;
  oldEventInstants?: Prisma.InputJsonValue;
  newEventInstants?: Prisma.InputJsonValue;
  oldModelDates: readonly string[];
  newModelDates?: readonly string[];
  evidenceComplete?: boolean;
  /** Health-derived linked-source changes are fast and must preserve an existing Training debounce. */
  deadlineMode?: TrainingRefreshDeadlineMode;
};

function dateRange(dates: readonly string[]): { from: string | null; to: string | null } {
  const valid = [...new Set(dates.filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)))].sort();
  return { from: valid[0] ?? null, to: valid.at(-1) ?? null };
}

function intArray(values: readonly number[]): Prisma.Sql {
  return values.length === 0
    ? Prisma.sql`ARRAY[]::INTEGER[]`
    : Prisma.sql`ARRAY[${Prisma.join([...new Set(values)])}]::INTEGER[]`;
}

/**
 * Persist the source evidence and due work in the same bounded transaction as
 * the Training write. The SQL clock anchor is evaluated after the caller's
 * source/invalidation statements; the queue row is invisible until commit.
 */
export async function enqueueTrainingSourceChangeInTransaction(
  tx: TransactionClient,
  input: TrainingSourceChangeEvidence,
): Promise<number> {
  // Keep the same lock order as worker claim/finalization and all physiology
  // writers: profile advisory lock before the durable queue row.
  await new PhysiologyV7PersistenceRepository(tx).lockProfile(input.profileId);
  const dates = dateRange([...input.oldModelDates, ...(input.newModelDates ?? [])]);
  const affectedSessionIds = [...new Set(input.affectedSessionIds)].sort((a, b) => a - b);
  const affectedExerciseIds = [...new Set(input.affectedExerciseIds ?? [])].sort((a, b) => a - b);
  const affectedSetIds = [...new Set(input.affectedSetIds ?? [])].sort((a, b) => a - b);
  const affectedWorkoutIds = [...new Set(input.affectedWorkoutIds ?? [])].sort((a, b) => a - b);
  const publicationBlockSourceKeys = [...new Set(input.publicationBlockSourceKeys ?? [])].sort();
  const fast = input.deadlineMode === "health-fast" || input.deadlineMode === "stepper-fast";
  const insertDueAt = fast
    ? Prisma.sql`clock_timestamp()`
    : Prisma.sql`clock_timestamp() + INTERVAL '120 seconds'`;
  const conflictDueAt = fast
    ? Prisma.sql`CASE
        WHEN existing."requestedGeneration" > existing."completedGeneration" AND existing."dueAt" IS NOT NULL THEN existing."dueAt"
        ELSE clock_timestamp()
      END`
    : Prisma.sql`clock_timestamp() + INTERVAL '120 seconds'`;

  const [job] = await tx.$queryRaw<Array<{ requestedGeneration: number }>>(Prisma.sql`
    INSERT INTO "TrainingRefreshJob" AS existing (
      "profileId", "requestedGeneration", "completedGeneration", "dueAt",
      "dirtyFromDate", "dirtyToDate", "affectedSessionIds", "nextAttemptAt",
      "attemptCount", "lastProgressStage", "lastProgressAt", "createdAt", "updatedAt"
    ) VALUES (
      ${input.profileId}, 1, 0, ${insertDueAt},
      ${dates.from}, ${dates.to}, ${intArray(affectedSessionIds)}, clock_timestamp(),
      0, 'queued', clock_timestamp(), clock_timestamp(), clock_timestamp()
    )
    ON CONFLICT ("profileId") DO UPDATE SET
      "requestedGeneration" = existing."requestedGeneration" + 1,
      "dueAt" = ${conflictDueAt},
      "dirtyFromDate" = CASE
        WHEN existing."dirtyFromDate" IS NULL THEN EXCLUDED."dirtyFromDate"
        WHEN EXCLUDED."dirtyFromDate" IS NULL THEN existing."dirtyFromDate"
        ELSE LEAST(existing."dirtyFromDate", EXCLUDED."dirtyFromDate")
      END,
      "dirtyToDate" = CASE
        WHEN existing."dirtyToDate" IS NULL THEN EXCLUDED."dirtyToDate"
        WHEN EXCLUDED."dirtyToDate" IS NULL THEN existing."dirtyToDate"
        ELSE GREATEST(existing."dirtyToDate", EXCLUDED."dirtyToDate")
      END,
      "affectedSessionIds" = ARRAY(
        SELECT DISTINCT affectedSessionId
        FROM unnest(existing."affectedSessionIds" || EXCLUDED."affectedSessionIds") AS affected(affectedSessionId)
        ORDER BY affectedSessionId
      ),
      "leaseToken" = NULL,
      "leaseUntil" = NULL,
      "nextAttemptAt" = clock_timestamp(),
      "attemptCount" = 0,
      "lastAttemptAt" = NULL,
      "lastErrorType" = NULL,
      "lastErrorAt" = NULL,
      "lastProgressStage" = 'queued',
      "lastProgressAt" = clock_timestamp(),
      "updatedAt" = clock_timestamp()
    RETURNING "requestedGeneration"
  `);
  if (!job) throw new Error("Training refresh queue upsert returned no generation");

  await tx.trainingSourceChange.create({
    data: {
      sourceChangeId: randomUUID(),
      profileId: input.profileId,
      generation: job.requestedGeneration,
      operationKind: input.operationKind,
      evidenceComplete: input.evidenceComplete ?? true,
      affectedSessionIds,
      affectedExerciseIds,
      affectedSetIds,
      affectedWorkoutIds,
      publicationBlockSourceKeys,
      ...(input.oldSourceIdentity === undefined ? {} : { oldSourceIdentity: input.oldSourceIdentity }),
      ...(input.newSourceIdentity === undefined ? {} : { newSourceIdentity: input.newSourceIdentity }),
      ...(input.oldEventInstants === undefined ? {} : { oldEventInstants: input.oldEventInstants }),
      ...(input.newEventInstants === undefined ? {} : { newEventInstants: input.newEventInstants }),
      oldModelDates: [...new Set(input.oldModelDates)].sort(),
      newModelDates: [...new Set(input.newModelDates ?? [])].sort(),
    },
  });
  return job.requestedGeneration;
}

export type PendingTrainingRefresh = {
  requestedGeneration: number;
  completedGeneration: number;
  dirtyFromDate: string | null;
  dirtyToDate: string | null;
  affectedSessionIds: number[];
  attemptCount: number;
  leaseToken: string;
  lastProgressAt: Date | null;
  lastProgressStage: string | null;
};

export type TrainingRefreshVisibilityFence = {
  requestedGeneration: number;
  completedGeneration: number;
  dirtyFromDate: string | null;
  dirtyToDate: string | null;
};

export type ActiveEnergyConvergenceVisibilityFence = {
  active: boolean;
  revision: number | null;
  fromDate: string | null;
  lifecycleUpdatedAt: string | null;
} | null;

export async function readActiveEnergyConvergenceVisibilityFence(
  client: TrainingRefreshDatabaseClient,
  profileId: number,
): Promise<ActiveEnergyConvergenceVisibilityFence> {
  const delegate = (client as unknown as {
    unifiedPublicationBlock?: { findUnique?: unknown };
  }).unifiedPublicationBlock;
  if (typeof delegate?.findUnique !== "function") return null;
  const lifecycleDelegate = (client as unknown as {
    physiologyV7Lifecycle?: { findUnique?: unknown };
  }).physiologyV7Lifecycle;
  const [block, lifecycle] = await Promise.all([
    client.unifiedPublicationBlock.findUnique({
      where: { profileId_source_sourceKey: { profileId, source: "active_energy", sourceKey: "convergence" } },
      select: { revision: true, fromDate: true },
    }),
    typeof lifecycleDelegate?.findUnique === "function"
      ? client.physiologyV7Lifecycle.findUnique({ where: { profileId }, select: { updatedAt: true } })
      : Promise.resolve(null),
  ]);
  return {
    active: block !== null,
    revision: block?.revision ?? null,
    fromDate: block?.fromDate ?? null,
    lifecycleUpdatedAt: lifecycle?.updatedAt instanceof Date ? lifecycle.updatedAt.toISOString() : null,
  };
}

export async function activeEnergyConvergenceFenceChanged(
  client: TrainingRefreshDatabaseClient,
  profileId: number,
  before: ActiveEnergyConvergenceVisibilityFence,
): Promise<boolean> {
  const after = await readActiveEnergyConvergenceVisibilityFence(client, profileId);
  return before?.active !== after?.active
    || before?.revision !== after?.revision
    || before?.fromDate !== after?.fromDate
    || before?.lifecycleUpdatedAt !== after?.lifecycleUpdatedAt;
}

export async function readTrainingRefreshVisibilityFence(
  client: TrainingRefreshDatabaseClient,
  profileId: number,
): Promise<TrainingRefreshVisibilityFence | null> {
  const delegate = (client as unknown as {
    trainingRefreshJob?: { findUnique?: unknown };
  }).trainingRefreshJob;
  if (typeof delegate?.findUnique !== "function") return null;
  const job = await client.trainingRefreshJob.findUnique({
    where: { profileId },
    select: { requestedGeneration: true, completedGeneration: true, dirtyFromDate: true, dirtyToDate: true },
  });
  return job === null ? null : job;
}

export function isTrainingRefreshPending(fence: TrainingRefreshVisibilityFence | null): boolean {
  return fence !== null && fence.requestedGeneration > fence.completedGeneration;
}

/** Only the live worker holding this exact DB lease may read its in-progress generation. */
export async function trainingRefreshWorkerOwnsGeneration(
  client: TrainingRefreshDatabaseClient,
  profileId: number,
  requestedGeneration: number | null | undefined,
): Promise<boolean> {
  const lease = getTrainingRefreshWorkerLease();
  if (!lease || lease.profileId !== profileId || lease.requestedGeneration !== requestedGeneration) return false;
  const rows = await client.$queryRaw<Array<{ owned: boolean }>>(Prisma.sql`
    SELECT EXISTS (
      SELECT 1 FROM "TrainingRefreshJob"
      WHERE "profileId" = ${lease.profileId}
        AND "requestedGeneration" = ${lease.requestedGeneration}
        AND "leaseToken" = ${lease.leaseToken}
        AND "leaseUntil" > clock_timestamp()
    ) AS owned
  `);
  return rows[0]?.owned === true;
}

/** Revalidate a read which spans multiple queries before returning model data. */
export async function trainingRefreshFenceChanged(
  client: TrainingRefreshDatabaseClient,
  profileId: number,
  before: TrainingRefreshVisibilityFence | null,
): Promise<boolean> {
  const after = await readTrainingRefreshVisibilityFence(client, profileId);
  return before?.requestedGeneration !== after?.requestedGeneration
    || before?.completedGeneration !== after?.completedGeneration;
}

export async function readTrainingSourceChanges(
  client: PrismaClient | TransactionClient,
  profileId: number,
  throughGeneration: number,
) {
  return client.trainingSourceChange.findMany({
    where: {
      profileId,
      generation: { lte: throughGeneration },
      acknowledgedAt: null,
    },
    orderBy: [{ generation: "asc" }, { createdAt: "asc" }, { sourceChangeId: "asc" }],
  });
}
