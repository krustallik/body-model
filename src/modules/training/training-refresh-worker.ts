import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { logEvent } from "@/lib/logger";
import { errorDiagnosticFields } from "@/lib/logger";
import { addCalendarDays } from "@/modules/model-episodes/model-calendar";
import { episodeTimeContextForInstantV1 } from "@/modules/model-episodes/episode-time-context-v1";
import { PhysiologyV7PersistenceRepository } from "@/modules/model-episodes/physiology-v7-persistence.repository";
import { isUnifiedGenerationCurrentV1 } from "@/modules/model-episodes/publication-generation-v1";
import { recordExperimentalFfmRetentionShadow } from "@/modules/model-episodes/experimental-ffm-retention-shadow.service";
import { recordExperimentalLocalHypertrophyResponseShadow } from "@/modules/model-episodes/experimental-local-hypertrophy-response-shadow.service";
import { recordExperimentalGlycogenStateShadow } from "@/modules/model-episodes/experimental-glycogen-state-shadow.service";
import { rebuildAuthoritativeRelativeMuscleTrajectory } from "@/modules/model-episodes/experimental-cessation-detraining-shadow.service";
import { recalculateActiveEnergyChangesV1 } from "@/modules/activity/active-energy-publication";
import { getModelStatus } from "@/modules/model-episodes/model-episode.service";
import { TrainingRepository } from "./training.repository";
import { recordExperimentalStrengthGlycogenDemandShadowBySessionId } from "./experimental-strength-glycogen-demand-shadow.service";
import { recordExperimentalStepperGlycogenDemandShadowsForLocalDate } from "@/modules/profile/experimental-stepper-glycogen-demand-shadow.service";
import {
  enqueueTrainingSourceChangeInTransaction,
  readTrainingSourceChanges,
  trainingRefreshWorkerOwnsGeneration,
} from "./training-refresh-queue";
import {
  runWithTrainingRefreshWorkerLease,
  TrainingRefreshWorkerLeaseLostError,
  type TrainingRefreshWorkerLease,
} from "./training-refresh-worker-context";
import { rebuildUnifiedExperimentalPhysiologyStateV1 } from "@/modules/model-episodes/unified-experimental-physiology-state.service";

const PROFILE_ID = 1;
const POLL_INTERVAL_MS = 1_000;
const LEASE_DURATION_SECONDS = 300;
const LEASE_HEARTBEAT_MS = 30_000;
const RETRY_BASE_SECONDS = 30;
const RETRY_MAX_SECONDS = 3_600;
const LIVENESS_AUDIT_INTERVAL_MS = 60_000;
const STUCK_AFTER_MS = 10 * 60_000;

type ClaimedTrainingRefreshJob = TrainingRefreshWorkerLease & Readonly<{
  dirtyFromDate: string | null;
  dirtyToDate: string | null;
  affectedSessionIds: number[];
  attemptCount: number;
  sourceChanges: Awaited<ReturnType<typeof readTrainingSourceChanges>>;
}>;

type QueueJobRow = {
  profileId: number;
  requestedGeneration: number;
  dirtyFromDate: string | null;
  dirtyToDate: string | null;
  affectedSessionIds: number[];
  attemptCount: number;
  leaseToken: string | null;
};

export type TrainingRefreshWorkerHooks = {
  afterClaim?: (job: ClaimedTrainingRefreshJob) => Promise<void> | void;
  afterProgressStage?: (job: ClaimedTrainingRefreshJob, stage: string) => Promise<void> | void;
  afterPublicationBeforeAcknowledge?: (job: ClaimedTrainingRefreshJob) => Promise<void> | void;
};

export function trainingRefreshJobHasStalledProgress(input: {
  lastProgressAt: Date | null;
  now?: number;
  thresholdMs?: number;
}): boolean {
  const progressAt = input.lastProgressAt?.getTime() ?? Number.NEGATIVE_INFINITY;
  return (input.now ?? Date.now()) - progressAt >= (input.thresholdMs ?? STUCK_AFTER_MS);
}

export function trainingRefreshJobShouldRevokeLease(input: {
  leaseUntil: Date | null;
  lastProgressAt: Date | null;
  now?: number;
  thresholdMs?: number;
}): boolean {
  const now = input.now ?? Date.now();
  return input.leaseUntil !== null
    && input.leaseUntil.getTime() > now
    && trainingRefreshJobHasStalledProgress({
      lastProgressAt: input.lastProgressAt,
      now,
      thresholdMs: input.thresholdMs,
    });
}

function safeErrorType(error: unknown): string {
  const name = error instanceof Error ? error.name : "UnknownError";
  return /^[A-Za-z][A-Za-z0-9_.-]{0,99}$/.test(name) ? name : "TrainingRefreshError";
}

function dateList(changes: ClaimedTrainingRefreshJob["sourceChanges"]): string[] {
  const values = changes.flatMap((change) => [...change.oldModelDates, ...change.newModelDates]);
  return [...new Set(values.filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)))].sort();
}

function instantsFromJson(value: Prisma.JsonValue | null): Date[] {
  const candidates = Array.isArray(value) ? value : value === null ? [] : [value];
  return candidates.flatMap((candidate) => {
    if (typeof candidate !== "string") return [];
    const instant = new Date(candidate);
    return Number.isFinite(instant.getTime()) ? [instant] : [];
  });
}

async function resolveDirtyDate(job: ClaimedTrainingRefreshJob): Promise<string> {
  const dates = dateList(job.sourceChanges);
  if (job.dirtyFromDate !== null && /^\d{4}-\d{2}-\d{2}$/.test(job.dirtyFromDate)) dates.push(job.dirtyFromDate);
  if (dates.length > 0) return dates.sort()[0]!;

  const episodes = await prisma.modelEpisode.findMany({
    where: { profileId: job.profileId },
    select: { id: true, startDate: true, timezone: true, active: true },
    orderBy: [{ startDate: "asc" }, { id: "asc" }],
  });
  for (const change of job.sourceChanges) {
    for (const instant of [
      ...instantsFromJson(change.oldEventInstants),
      ...instantsFromJson(change.newEventInstants),
    ]) {
      dates.push(episodeTimeContextForInstantV1(episodes, instant).date);
    }
  }
  if (dates.length > 0) return dates.sort()[0]!;

  // A date-less but otherwise complete source record is conservatively replayed
  // from the earliest episode boundary; no missing source identity is inferred.
  const earliestEpisode = episodes[0];
  if (earliestEpisode) return earliestEpisode.startDate;
  throw new Error("Training refresh has no model episode or recoverable dirty date");
}

async function claimNextTrainingRefreshJob(): Promise<ClaimedTrainingRefreshJob | null> {
  const leaseToken = randomUUID();
  return prisma.$transaction(async (tx) => {
    // Match source writers' lock order: profile advisory lock, then job row.
    await new PhysiologyV7PersistenceRepository(tx).lockProfile(PROFILE_ID);
    const rows = await tx.$queryRaw<QueueJobRow[]>`
      SELECT "profileId", "requestedGeneration", "dirtyFromDate", "dirtyToDate",
        "affectedSessionIds", "attemptCount", "leaseToken"
      FROM "TrainingRefreshJob"
      WHERE "profileId" = ${PROFILE_ID}
        AND "requestedGeneration" > "completedGeneration"
        AND "dueAt" <= clock_timestamp()
        AND "nextAttemptAt" <= clock_timestamp()
        AND ("leaseUntil" IS NULL OR "leaseUntil" <= clock_timestamp())
      FOR UPDATE SKIP LOCKED
    `;
    const row = rows[0];
    if (!row) return null;
    const claimed = await tx.$queryRaw<QueueJobRow[]>`
      UPDATE "TrainingRefreshJob"
      SET "leaseToken" = ${leaseToken},
          "leaseUntil" = clock_timestamp() + (${LEASE_DURATION_SECONDS} * INTERVAL '1 second'),
          "attemptCount" = "attemptCount" + 1,
          "lastAttemptAt" = clock_timestamp(),
          "lastProgressStage" = 'claimed',
          "lastProgressAt" = clock_timestamp(),
          "updatedAt" = clock_timestamp()
      WHERE "profileId" = ${PROFILE_ID}
        AND "requestedGeneration" = ${row.requestedGeneration}
        AND "requestedGeneration" > "completedGeneration"
        AND "dueAt" <= clock_timestamp()
        AND "nextAttemptAt" <= clock_timestamp()
        AND ("leaseUntil" IS NULL OR "leaseUntil" <= clock_timestamp())
      RETURNING "profileId", "requestedGeneration", "dirtyFromDate", "dirtyToDate",
        "affectedSessionIds", "attemptCount", "leaseToken"
    `;
    const claimedRow = claimed[0];
    if (!claimedRow) return null;
    const sourceChanges = await readTrainingSourceChanges(tx, claimedRow.profileId, claimedRow.requestedGeneration);
    return {
      profileId: claimedRow.profileId,
      requestedGeneration: claimedRow.requestedGeneration,
      dirtyFromDate: claimedRow.dirtyFromDate,
      dirtyToDate: claimedRow.dirtyToDate,
      affectedSessionIds: claimedRow.affectedSessionIds,
      attemptCount: claimedRow.attemptCount,
      leaseToken,
      sourceChanges,
    };
  }, { maxWait: 10_000, timeout: 15_000 });
}

/**
 * Before the durable Training journal existed, a Stepper mutation could commit
 * a UnifiedPublicationBlock and then crash before its inline refresh cleared
 * it. Preserve that exact numeric source key/date as journal evidence so the
 * new worker can recover it. Non-numeric keys are deliberately left blocked
 * and diagnosed rather than guessed.
 */
export async function reconcileLegacyStepperPublicationBlocksForRecovery(): Promise<void> {
  const blocks = await prisma.unifiedPublicationBlock.findMany({
    where: { source: "stepper" },
    orderBy: [{ profileId: "asc" }, { createdAt: "asc" }, { sourceKey: "asc" }],
    select: { profileId: true, sourceKey: true, fromDate: true },
  });
  for (const candidate of blocks) {
    if (!/^[1-9][0-9]*$/.test(candidate.sourceKey)) {
      logEvent("error", "training_refresh_legacy_stepper_block_unrecoverable", {
        profileId: candidate.profileId,
        sourceKey: candidate.sourceKey,
        fromDate: candidate.fromDate,
        reason: "source_key_not_numeric_workout_id",
      });
      continue;
    }
    const workoutId = Number(candidate.sourceKey);
    if (!Number.isSafeInteger(workoutId) || workoutId <= 0) {
      logEvent("error", "training_refresh_legacy_stepper_block_unrecoverable", {
        profileId: candidate.profileId,
        sourceKey: candidate.sourceKey,
        fromDate: candidate.fromDate,
        reason: "source_key_outside_safe_integer_range",
      });
      continue;
    }
    const recovered = await prisma.$transaction(async (tx) => {
      await new PhysiologyV7PersistenceRepository(tx).lockProfile(candidate.profileId);
      const block = await tx.unifiedPublicationBlock.findUnique({
        where: {
          profileId_source_sourceKey: {
            profileId: candidate.profileId,
            source: "stepper",
            sourceKey: candidate.sourceKey,
          },
        },
        select: { fromDate: true },
      });
      if (!block) return { recovered: false, workoutStillExists: null };
      const journal = await tx.trainingSourceChange.findFirst({
        where: {
          profileId: candidate.profileId,
          publicationBlockSourceKeys: { has: candidate.sourceKey },
          acknowledgedAt: null,
        },
        select: { sourceChangeId: true },
      });
      if (journal) return { recovered: false, workoutStillExists: null };

      const workout = await tx.workout.findUnique({
        where: { id: workoutId },
        select: {
          startAt: true,
          endAt: true,
          dailyHealthData: { select: { date: true } },
          matchedDiarySession: { select: { id: true } },
        },
      });
      const priorEvidence = await tx.trainingSourceChange.findMany({
        where: { profileId: candidate.profileId, publicationBlockSourceKeys: { has: candidate.sourceKey } },
        select: { affectedSessionIds: true, oldModelDates: true, newModelDates: true },
      });
      const affectedSessionIds = [...new Set([
        ...(workout?.matchedDiarySession ? [workout.matchedDiarySession.id] : []),
        ...priorEvidence.flatMap((change) => change.affectedSessionIds),
      ])].filter((id) => Number.isSafeInteger(id) && id > 0).sort((a, b) => a - b);
      const instants = workout ? [workout.startAt, workout.endAt] : [];
      const episodes = instants.length === 0 ? [] : await tx.modelEpisode.findMany({
        where: { profileId: candidate.profileId },
        select: { id: true, startDate: true, timezone: true, active: true },
        orderBy: [{ startDate: "asc" }, { id: "asc" }],
      });
      const currentDates = instants.map((instant) => episodeTimeContextForInstantV1(episodes, instant).date);
      await enqueueTrainingSourceChangeInTransaction(tx, {
        profileId: candidate.profileId,
        operationKind: "stepper_workout_legacy_block_recovery",
        affectedSessionIds,
        affectedWorkoutIds: [workoutId],
        publicationBlockSourceKeys: [candidate.sourceKey],
        ...(instants.length > 0 ? { newEventInstants: instants.map((instant) => instant.toISOString()) } : {}),
        oldModelDates: [...new Set([
          block.fromDate,
          ...(workout ? [workout.dailyHealthData.date] : []),
          ...priorEvidence.flatMap((change) => [...change.oldModelDates, ...change.newModelDates]),
        ])].filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)).sort(),
        newModelDates: currentDates,
        deadlineMode: "stepper-fast",
      });
      return { recovered: true, workoutStillExists: workout !== null };
    }, { maxWait: 10_000, timeout: 15_000 });
    if (recovered.recovered) {
      logEvent("warn", "training_refresh_legacy_stepper_block_recovered", {
        profileId: candidate.profileId,
        workoutId,
        fromDate: candidate.fromDate,
        workoutStillExists: recovered.workoutStillExists,
      });
    }
  }
}

/** Recover a committed convergence fence even when no Training/Health caller queued work. */
export async function reconcileOrphanActiveEnergyConvergenceBlocks(): Promise<void> {
  const blocks = await prisma.unifiedPublicationBlock.findMany({
    where: { source: "active_energy", sourceKey: "convergence" },
    orderBy: [{ profileId: "asc" }],
    select: { profileId: true, sourceKey: true, fromDate: true, revision: true },
  });
  for (const candidate of blocks) {
    const recovered = await prisma.$transaction(async (tx) => {
      await new PhysiologyV7PersistenceRepository(tx).lockProfile(candidate.profileId);
      const block = await tx.unifiedPublicationBlock.findUnique({
        where: { profileId_source_sourceKey: {
          profileId: candidate.profileId,
          source: "active_energy",
          sourceKey: candidate.sourceKey,
        } },
        select: { revision: true, fromDate: true, ownerToken: true, ownerLeaseUntil: true },
      });
      if (!block || block.revision !== candidate.revision || block.fromDate !== candidate.fromDate) return false;
      const activeOwner = await tx.$queryRaw<Array<{ active: boolean }>>`
        SELECT EXISTS (
          SELECT 1 FROM "UnifiedPublicationBlock"
          WHERE "profileId" = ${candidate.profileId}
            AND "source" = 'active_energy'
            AND "sourceKey" = ${candidate.sourceKey}
            AND "revision" = ${candidate.revision}
            AND "ownerToken" = ${block.ownerToken}
            AND "ownerLeaseUntil" > clock_timestamp()
        ) AS active
      `;
      if (activeOwner[0]?.active === true) return false;
      const queue = await tx.trainingRefreshJob.findUnique({
        where: { profileId: candidate.profileId },
        select: { requestedGeneration: true, completedGeneration: true },
      });
      if (queue && queue.requestedGeneration > queue.completedGeneration) return false;
      const healthQueue = await tx.healthSyncRefreshJob.findUnique({
        where: { profileId: candidate.profileId },
        select: { requestedGeneration: true, completedGeneration: true },
      });
      if (healthQueue && healthQueue.requestedGeneration > healthQueue.completedGeneration) return false;

      await enqueueTrainingSourceChangeInTransaction(tx, {
        profileId: candidate.profileId,
        operationKind: "active_energy_convergence_recovery",
        affectedSessionIds: [],
        affectedWorkoutIds: [],
        publicationBlockSourceKeys: [candidate.sourceKey],
        oldModelDates: [block.fromDate],
        deadlineMode: "stepper-fast",
      });
      return true;
    }, { maxWait: 10_000, timeout: 15_000 });
    if (recovered) logEvent("warn", "training_refresh_active_energy_convergence_recovered", {
      profileId: candidate.profileId,
      fromDate: candidate.fromDate,
      revision: candidate.revision,
    });
  }
}

/** Recreate a missing queue row from the source-change journal without a new debounce. */
async function reconcileOrphanTrainingRefreshJobs(): Promise<void> {
  const profiles = await prisma.trainingSourceChange.groupBy({
    by: ["profileId"],
    where: { acknowledgedAt: null },
  });
  for (const { profileId } of profiles) {
    const inserted = await prisma.$transaction(async (tx) => {
      await new PhysiologyV7PersistenceRepository(tx).lockProfile(profileId);
      return tx.$executeRaw`
        INSERT INTO "TrainingRefreshJob" (
          "profileId", "requestedGeneration", "completedGeneration", "dueAt",
          "dirtyFromDate", "dirtyToDate", "affectedSessionIds", "nextAttemptAt",
          "attemptCount", "lastProgressStage", "lastProgressAt", "createdAt", "updatedAt"
        )
        SELECT pending."profileId", pending."maxGeneration", pending."minGeneration" - 1,
          clock_timestamp(),
          (SELECT MIN(sourceDate)::text
            FROM "TrainingSourceChange" change
            CROSS JOIN LATERAL unnest(change."oldModelDates" || change."newModelDates") AS source(sourceDate)
            WHERE change."profileId" = pending."profileId" AND change."acknowledgedAt" IS NULL
              AND sourceDate ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
          (SELECT MAX(sourceDate)::text
            FROM "TrainingSourceChange" change
            CROSS JOIN LATERAL unnest(change."oldModelDates" || change."newModelDates") AS source(sourceDate)
            WHERE change."profileId" = pending."profileId" AND change."acknowledgedAt" IS NULL
              AND sourceDate ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
          ARRAY(SELECT DISTINCT sessionId
            FROM "TrainingSourceChange" change
            CROSS JOIN LATERAL unnest(change."affectedSessionIds") AS affected(sessionId)
            WHERE change."profileId" = pending."profileId" AND change."acknowledgedAt" IS NULL
            ORDER BY sessionId),
          clock_timestamp(), 0, 'recovered-from-source-journal', clock_timestamp(), clock_timestamp(), clock_timestamp()
        FROM (
          SELECT "profileId", MIN("generation") AS "minGeneration", MAX("generation") AS "maxGeneration"
          FROM "TrainingSourceChange"
          WHERE "profileId" = ${profileId} AND "acknowledgedAt" IS NULL
          GROUP BY "profileId"
        ) pending
        WHERE NOT EXISTS (
          SELECT 1 FROM "TrainingRefreshJob" job WHERE job."profileId" = pending."profileId"
        )
        ON CONFLICT ("profileId") DO NOTHING
      `;
    }, { maxWait: 10_000, timeout: 15_000 });
    if (inserted > 0) logEvent("warn", "training_refresh_orphan_job_recovered", { profileId });
  }
}

async function renewTrainingRefreshLease(job: ClaimedTrainingRefreshJob): Promise<boolean> {
  const changed = await prisma.$executeRaw`
    UPDATE "TrainingRefreshJob"
    SET "leaseUntil" = clock_timestamp() + (${LEASE_DURATION_SECONDS} * INTERVAL '1 second'),
        "updatedAt" = clock_timestamp()
    WHERE "profileId" = ${job.profileId}
      AND "requestedGeneration" = ${job.requestedGeneration}
      AND "leaseToken" = ${job.leaseToken}
      AND "leaseUntil" > clock_timestamp()
  `;
  return changed === 1;
}

async function assertTrainingRefreshLease(job: ClaimedTrainingRefreshJob): Promise<void> {
  const rows = await prisma.$queryRaw<Array<{ owned: boolean }>>`
    SELECT EXISTS (
      SELECT 1 FROM "TrainingRefreshJob"
      WHERE "profileId" = ${job.profileId}
        AND "requestedGeneration" = ${job.requestedGeneration}
        AND "leaseToken" = ${job.leaseToken}
        AND "leaseUntil" > clock_timestamp()
    ) AS owned
  `;
  if (rows[0]?.owned !== true) throw new TrainingRefreshWorkerLeaseLostError();
}

async function markTrainingRefreshProgress(
  job: ClaimedTrainingRefreshJob,
  stage: string,
  hooks: TrainingRefreshWorkerHooks = {},
): Promise<void> {
  const changed = await prisma.$executeRaw`
    UPDATE "TrainingRefreshJob"
    SET "lastProgressStage" = ${stage}, "lastProgressAt" = clock_timestamp(), "updatedAt" = clock_timestamp()
    WHERE "profileId" = ${job.profileId}
      AND "requestedGeneration" = ${job.requestedGeneration}
      AND "leaseToken" = ${job.leaseToken}
      AND "leaseUntil" > clock_timestamp()
  `;
  if (changed !== 1) throw new TrainingRefreshWorkerLeaseLostError();
  await hooks.afterProgressStage?.(job, stage);
}

async function completeTrainingRefreshJob(job: ClaimedTrainingRefreshJob): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    await new PhysiologyV7PersistenceRepository(tx).lockProfile(job.profileId);
    const changed = await tx.$executeRaw`
      UPDATE "TrainingRefreshJob"
      SET "completedGeneration" = ${job.requestedGeneration},
          "dueAt" = NULL,
          "dirtyFromDate" = NULL,
          "dirtyToDate" = NULL,
          "affectedSessionIds" = ARRAY[]::INTEGER[],
          "leaseToken" = NULL,
          "leaseUntil" = NULL,
          "nextAttemptAt" = clock_timestamp(),
          "attemptCount" = 0,
          "lastAttemptAt" = NULL,
          "lastErrorType" = NULL,
          "lastErrorAt" = NULL,
          "lastProgressStage" = 'completed',
          "lastProgressAt" = clock_timestamp(),
          "updatedAt" = clock_timestamp()
      WHERE "profileId" = ${job.profileId}
        AND "requestedGeneration" = ${job.requestedGeneration}
        AND "leaseToken" = ${job.leaseToken}
        AND "leaseUntil" > clock_timestamp()
        AND "completedGeneration" < ${job.requestedGeneration}
    `;
    if (changed !== 1) return false;
    await tx.$executeRaw`
      UPDATE "TrainingSourceChange"
      SET "acknowledgedAt" = clock_timestamp()
      WHERE "profileId" = ${job.profileId}
        AND "generation" <= ${job.requestedGeneration}
        AND "acknowledgedAt" IS NULL
    `;
    return true;
  }, { maxWait: 10_000, timeout: 15_000 });
}

async function retryTrainingRefreshJob(job: ClaimedTrainingRefreshJob, error: unknown): Promise<void> {
  const delaySeconds = Math.min(RETRY_MAX_SECONDS, RETRY_BASE_SECONDS * (2 ** Math.min(job.attemptCount - 1, 7)));
  await prisma.$executeRaw`
    UPDATE "TrainingRefreshJob"
    SET "leaseToken" = NULL,
        "leaseUntil" = NULL,
        "nextAttemptAt" = clock_timestamp() + (${delaySeconds} * INTERVAL '1 second'),
        "lastErrorType" = ${safeErrorType(error)},
        "lastErrorAt" = clock_timestamp(),
        "lastProgressStage" = 'retry-wait',
        "lastProgressAt" = clock_timestamp(),
        "updatedAt" = clock_timestamp()
    WHERE "profileId" = ${job.profileId}
      AND "requestedGeneration" = ${job.requestedGeneration}
      AND "leaseToken" = ${job.leaseToken}
      AND "leaseUntil" > clock_timestamp()
  `;
}

function uniqueIntegers(values: readonly number[]): number[] {
  return [...new Set(values.filter((value) => Number.isSafeInteger(value) && value > 0))].sort((a, b) => a - b);
}

function enumerateDates(fromDate: string, toDate: string): string[] {
  const dates: string[] = [];
  for (let date = fromDate; date <= toDate; date = addCalendarDays(date, 1)) dates.push(date);
  return dates;
}

async function rebuildClaimedGeneration(job: ClaimedTrainingRefreshJob, hooks: TrainingRefreshWorkerHooks): Promise<void> {
  if (job.sourceChanges.length === 0) throw new Error("Training refresh generation has no durable source-change evidence");
  if (job.sourceChanges.some((change) => change.schemaVersion !== 1 || !change.evidenceComplete)) {
    throw new Error("Training refresh source-change evidence is incomplete or unsupported");
  }
  const dirtyFromDate = await resolveDirtyDate(job);
  const affectedSessionIds = uniqueIntegers([
    ...job.affectedSessionIds,
    ...job.sourceChanges.flatMap((change) => change.affectedSessionIds),
  ]);
  const affectedWorkoutIds = uniqueIntegers(job.sourceChanges.flatMap((change) => change.affectedWorkoutIds));
  const hasScopedEvidence = job.sourceChanges.length > 0
    || job.affectedSessionIds.length > 0
    || affectedWorkoutIds.length > 0;
  const candidateScope = hasScopedEvidence && job.sourceChanges.every((change) =>
    change.affectedSessionIds.length > 0 || change.affectedWorkoutIds.length > 0)
    ? { strengthSessionIds: affectedSessionIds, workoutIds: affectedWorkoutIds }
    : undefined;
  const publicationBlockSourceKeys = [...new Set(job.sourceChanges.flatMap((change) => change.publicationBlockSourceKeys))].sort();
  const stepperChanges = job.sourceChanges.filter((change) => change.operationKind.startsWith("stepper_workout_"));
  const stepperPublicationBlockSourceKeys = [...new Set(stepperChanges.flatMap((change) => change.publicationBlockSourceKeys))].sort();
  const stepperSourceDates = [...new Set(stepperChanges.flatMap((change) => [
    ...change.oldModelDates,
    ...change.newModelDates,
  ]).filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)))].sort();
  const healthWeightSourceDates = dateList(job.sourceChanges.filter((change) =>
    change.operationKind === "health_weight_accounting_refresh"));
  const lifecycle = new PhysiologyV7PersistenceRepository();
  // A day edit can arrive without creating another Training generation. Keep
  // its token from before dependency computation, never adopt a newer fence
  // observed after those dependencies have already been rebuilt.
  const healthDayBlockTokens = new Map<string, { revision: number; fromDate: string } | null>();
  for (const date of healthWeightSourceDates) {
    await assertTrainingRefreshLease(job);
    healthDayBlockTokens.set(date, await lifecycle.readUnifiedPublicationBlockToken({
      profileId: job.profileId, source: "day", sourceKey: date,
    }));
  }

  await markTrainingRefreshProgress(job, "invalidate-replay-suffix", hooks);
  await new PhysiologyV7PersistenceRepository().invalidate(job.profileId, dirtyFromDate);

  await markTrainingRefreshProgress(job, "active-energy-production-convergence", hooks);
  const production = await recalculateActiveEnergyChangesV1({
    requireDependentStages: true,
    ...(candidateScope === undefined ? {} : { activeEnergyCandidateScope: candidateScope }),
    onLifecycleFenceChanged: async () => {
      await markTrainingRefreshProgress(job, "active-energy-production-convergence");
    },
    onCandidateProcessed: async () => {
      await markTrainingRefreshProgress(job, "active-energy-candidate-refresh");
    },
  });
  if (production === null) {
    const [current, lifecycle, ownsGeneration] = await Promise.all([
      getModelStatus(),
      prisma.physiologyV7Lifecycle.findUnique({
        where: { profileId: job.profileId },
        select: {
          invalidationGeneration: true,
          productionStaleFromDate: true,
          productionPublishedGeneration: true,
        },
      }),
      trainingRefreshWorkerOwnsGeneration(prisma, job.profileId, job.requestedGeneration),
    ]);
    logEvent("error", "training_refresh_production_generation_not_current", {
      generation: job.requestedGeneration,
      ownsGeneration,
      productionCurrent: current?.productionCurrent ?? false,
      latestModeledDate: current?.latestModeledDate ?? null,
      invalidationGeneration: lifecycle?.invalidationGeneration ?? null,
      productionPublishedGeneration: lifecycle?.productionPublishedGeneration ?? null,
      productionStaleFromDate: lifecycle?.productionStaleFromDate ?? null,
    });
    throw new Error("production model is unavailable after Training source change");
  }
  const earliestAffectedDate = dirtyFromDate < production.effectiveReplayFromDate
    ? dirtyFromDate
    : production.effectiveReplayFromDate;
  const replayFromDate = earliestAffectedDate < production.episodeStartDate
    ? production.episodeStartDate
    : earliestAffectedDate;
  const rebuiltThroughDate = production.latestModeledDate;

  await markTrainingRefreshProgress(job, "training-glycogen-demand", hooks);
  const trainingRepository = new TrainingRepository(prisma);
  for (const sessionId of affectedSessionIds) {
    await assertTrainingRefreshLease(job);
    const session = await trainingRepository.getSession(sessionId, job.profileId);
    if (session?.status === "COMPLETED") {
      await recordExperimentalStrengthGlycogenDemandShadowBySessionId({ sessionId, profileId: job.profileId });
    }
    await markTrainingRefreshProgress(job, "training-glycogen-demand");
  }

  // Stepper source writes share the durable Training queue. Rebuild their
  // date-scoped dependent demand from the journaled old/new dates before the
  // glycogen suffix is replayed; a deleted Workout still has durable dates.
  for (const date of [...new Set([...stepperSourceDates, ...healthWeightSourceDates])].sort()) {
    await assertTrainingRefreshLease(job);
    await recordExperimentalStepperGlycogenDemandShadowsForLocalDate({ date, profileId: job.profileId });
    await markTrainingRefreshProgress(job, "stepper-glycogen-demand");
  }

  await markTrainingRefreshProgress(job, "glycogen-state-suffix", hooks);
  await recordExperimentalGlycogenStateShadow({
    date: replayFromDate,
    profileId: job.profileId,
    onCandidateCommitted: async () => {
      await markTrainingRefreshProgress(job, "glycogen-state-replay");
    },
  });

  await markTrainingRefreshProgress(job, "relative-muscle-suffix", hooks);
  let relativeMuscleCandidateCount = 0;
  await rebuildAuthoritativeRelativeMuscleTrajectory({
    profileId: job.profileId,
    fromDate: replayFromDate,
    onCandidateProcessed: async () => {
      relativeMuscleCandidateCount += 1;
      // A long historical suffix must renew observable progress as well as
      // its lease, or liveness recovery could revoke a healthy worker.
      if (relativeMuscleCandidateCount % 50 === 0) {
        await markTrainingRefreshProgress(job, "relative-muscle-suffix-replay", hooks);
      }
    },
  });
  await markTrainingRefreshProgress(job, "relative-muscle-suffix-published", hooks);

  await markTrainingRefreshProgress(job, "ffm-hypertrophy-suffix", hooks);
  // Source days and modeled days have different horizons: an in-progress
  // Health day is a valid dependency input although production intentionally
  // models only completed local days. Its date-scoped shadows accept missing
  // model state and will be rebuilt normally when that day becomes modelable.
  const replayDates = [...new Set([
    ...enumerateDates(replayFromDate, rebuiltThroughDate),
    ...healthWeightSourceDates,
  ])].sort();
  const hypertrophyWeeks = new Set<string>();
  for (const date of replayDates) {
    await assertTrainingRefreshLease(job);
    await recordExperimentalFfmRetentionShadow({ date, profileId: job.profileId });
    // The hypertrophy writer is week-scoped; call once per affected week.
    const weekStart = new Date(`${date}T00:00:00.000Z`);
    const mondayOffset = (weekStart.getUTCDay() + 6) % 7;
    weekStart.setUTCDate(weekStart.getUTCDate() - mondayOffset);
    const weekStartDate = weekStart.toISOString().slice(0, 10);
    if (!hypertrophyWeeks.has(weekStartDate)) {
      hypertrophyWeeks.add(weekStartDate);
      await recordExperimentalLocalHypertrophyResponseShadow({ date, profileId: job.profileId });
    }
    await markTrainingRefreshProgress(job, "ffm-hypertrophy-suffix");
  }

  await markTrainingRefreshProgress(job, "clear-exact-training-blocks", hooks);
  for (const sourceKey of publicationBlockSourceKeys) {
    await assertTrainingRefreshLease(job);
    const token = await lifecycle.readUnifiedPublicationBlockToken({
      profileId: job.profileId,
      source: "training",
      sourceKey,
    });
    if (token === null) continue;
    const cleared = await lifecycle.clearUnifiedPublicationBlock({
      profileId: job.profileId,
      source: "training",
      sourceKey,
      expectedRevision: token.revision,
      expectedFromDate: token.fromDate,
    });
    if (!cleared) throw new Error("Training publication block changed before exact-token clear");
  }
  for (const sourceKey of stepperPublicationBlockSourceKeys) {
    await assertTrainingRefreshLease(job);
    const token = await lifecycle.readUnifiedPublicationBlockToken({
      profileId: job.profileId,
      source: "stepper",
      sourceKey,
    });
    if (token === null) continue;
    const cleared = await lifecycle.clearUnifiedPublicationBlock({
      profileId: job.profileId,
      source: "stepper",
      sourceKey,
      expectedRevision: token.revision,
      expectedFromDate: token.fromDate,
    });
    if (!cleared) throw new Error("Stepper publication block changed before exact-token clear");
  }
  // A Health weight refresh may synchronously rebuild completed-session
  // accounting after committing the raw Health source. That creates a fast
  // Training journal entry, and its worker owns the final suffix publication.
  // Date-scoped source dependencies above also cover days outside the modeled
  // suffix. Clear only the token captured before that work; a concurrent/newer
  // day edit keeps its own revision and remains blocked.
  for (const date of healthWeightSourceDates) {
    await assertTrainingRefreshLease(job);
    const token = healthDayBlockTokens.get(date);
    if (token == null) continue;
    const cleared = await lifecycle.clearUnifiedPublicationBlock({
      profileId: job.profileId,
      source: "day",
      sourceKey: date,
      expectedRevision: token.revision,
      expectedFromDate: token.fromDate,
    });
    if (!cleared) throw new Error("Health day publication block changed before exact-token clear");
  }

  await markTrainingRefreshProgress(job, "unified-publication", hooks);
  await rebuildUnifiedExperimentalPhysiologyStateV1({
    profileId: job.profileId,
    fromDate: replayFromDate,
    toDate: rebuiltThroughDate,
    onProgress: async () => {
      await markTrainingRefreshProgress(job, "unified-publication-candidate-computation");
    },
  });

  const lifecycleState = await prisma.physiologyV7Lifecycle.findUnique({
    where: { profileId: job.profileId },
    select: {
      invalidationGeneration: true,
      productionStaleFromDate: true,
      productionPublishedGeneration: true,
      unifiedPublishedGeneration: true,
      unifiedTargetRevision: true,
      unifiedRolloutEpoch: true,
      unifiedPublishedRolloutEpoch: true,
      unifiedPublicationBlockedFromDate: true,
    },
  });
  if (!isUnifiedGenerationCurrentV1(lifecycleState)
      || lifecycleState?.unifiedPublishedRolloutEpoch !== lifecycleState?.unifiedRolloutEpoch
      || lifecycleState?.unifiedPublicationBlockedFromDate !== null) {
    throw new Error("Training dependency pipeline did not publish one complete current generation");
  }
}

export async function processNextTrainingRefreshJob(hooks: TrainingRefreshWorkerHooks = {}): Promise<boolean> {
  await reconcileLegacyStepperPublicationBlocksForRecovery();
  await reconcileOrphanActiveEnergyConvergenceBlocks();
  await reconcileOrphanTrainingRefreshJobs();
  const job = await claimNextTrainingRefreshJob();
  if (!job) return false;
  await hooks.afterClaim?.(job);
  const startedAt = performance.now();
  let heartbeatRunning = false;
  const heartbeat = setInterval(() => {
    if (heartbeatRunning) return;
    heartbeatRunning = true;
    void renewTrainingRefreshLease(job)
      .then((renewed) => {
        if (!renewed) logEvent("error", "training_refresh_worker_lease_lost", { attempt: job.attemptCount });
      })
      .catch((error: unknown) => logEvent("warn", "training_refresh_worker_lease_renewal_failed", {
        attempt: job.attemptCount,
        errorType: safeErrorType(error),
      }))
      .finally(() => { heartbeatRunning = false; });
  }, LEASE_HEARTBEAT_MS);
  heartbeat.unref();

  logEvent("info", "training_refresh_worker_started", {
    generation: job.requestedGeneration,
    attempt: job.attemptCount,
    sourceChangeCount: job.sourceChanges.length,
  });
  try {
    const completed = await runWithTrainingRefreshWorkerLease(job, async () => {
      await rebuildClaimedGeneration(job, hooks);
      await markTrainingRefreshProgress(job, "acknowledge-generation", hooks);
      await hooks.afterPublicationBeforeAcknowledge?.(job);
      return completeTrainingRefreshJob(job);
    });
    if (!completed) throw new TrainingRefreshWorkerLeaseLostError();
    logEvent("info", "training_refresh_worker_completed", {
      generation: job.requestedGeneration,
      attempt: job.attemptCount,
      durationMs: Math.round(performance.now() - startedAt),
    });
  } catch (error) {
    let failedStage: string | null = null;
    try {
      const failedJob = await prisma.trainingRefreshJob.findUnique({
        where: { profileId: job.profileId },
        select: { requestedGeneration: true, lastProgressStage: true },
      });
      if (failedJob?.requestedGeneration === job.requestedGeneration) {
        failedStage = failedJob.lastProgressStage;
      }
    } catch {
      // Queue retry remains authoritative; missing diagnostics do not change it.
    }
    try {
      await retryTrainingRefreshJob(job, error);
    } catch (queueError) {
      logEvent("error", "training_refresh_worker_retry_persist_failed", {
        generation: job.requestedGeneration,
        errorType: safeErrorType(queueError),
      });
    }
    if (!(error instanceof TrainingRefreshWorkerLeaseLostError)) {
      logEvent("error", "training_refresh_worker_failed", {
        generation: job.requestedGeneration,
        attempt: job.attemptCount,
        failedStage,
        errorType: safeErrorType(error),
        ...errorDiagnosticFields(error),
      });
    }
  } finally {
    clearInterval(heartbeat);
  }
  return true;
}

let trainingRefreshWorkerStarted = false;
let nextLivenessAuditAt = 0;

export async function auditTrainingRefreshLiveness(): Promise<number> {
  if (Date.now() < nextLivenessAuditAt) return 0;
  nextLivenessAuditAt = Date.now() + LIVENESS_AUDIT_INTERVAL_MS;
  const repairedNullDueAt = await prisma.$executeRaw`
    UPDATE "TrainingRefreshJob"
    SET "dueAt" = clock_timestamp(),
        "nextAttemptAt" = LEAST("nextAttemptAt", clock_timestamp()),
        "lastProgressStage" = 'recovered-null-due-at',
        "lastProgressAt" = clock_timestamp(),
        "updatedAt" = clock_timestamp()
    WHERE "requestedGeneration" > "completedGeneration"
      AND "dueAt" IS NULL
      AND ("leaseUntil" IS NULL OR "leaseUntil" <= clock_timestamp())
  `;
  if (repairedNullDueAt > 0) logEvent("warn", "training_refresh_null_deadline_recovered", { count: repairedNullDueAt });
  // Revoke an apparently live lease only after a long durable-progress gap.
  // Every publication-capable transaction revalidates the exact lease under
  // the profile lock, so a resumed old worker cannot commit after takeover.
  const revokedStalledLeases = await prisma.$executeRaw`
    UPDATE "TrainingRefreshJob"
    SET "leaseToken" = NULL,
        "leaseUntil" = NULL,
        "nextAttemptAt" = clock_timestamp(),
        "lastErrorType" = 'StalledWorkerProgress',
        "lastErrorAt" = clock_timestamp(),
        "lastProgressStage" = 'stalled-lease-revoked',
        "lastProgressAt" = clock_timestamp(),
        "updatedAt" = clock_timestamp()
    WHERE "requestedGeneration" > "completedGeneration"
      AND "leaseToken" IS NOT NULL
      AND "leaseUntil" > clock_timestamp()
      AND ("lastProgressAt" IS NULL
        OR "lastProgressAt" <= clock_timestamp() - (${STUCK_AFTER_MS} * INTERVAL '1 millisecond'))
  `;
  if (revokedStalledLeases > 0) {
    logEvent("error", "training_refresh_stalled_lease_revoked", { count: revokedStalledLeases });
  }
  const pending = await prisma.$queryRaw<Array<{
    profileId: number; requestedGeneration: number; completedGeneration: number; dirtyFromDate: string | null;
    leaseUntil: Date | null; nextAttemptAt: Date; retryEligible: boolean; lastErrorType: string | null; lastErrorAt: Date | null;
    lastProgressStage: string | null; lastProgressAt: Date | null;
  }>>`
    SELECT "profileId", "requestedGeneration", "completedGeneration", "dirtyFromDate",
      "leaseUntil", "nextAttemptAt", ("nextAttemptAt" <= clock_timestamp()) AS "retryEligible",
      "lastErrorType", "lastErrorAt", "lastProgressStage", "lastProgressAt"
    FROM "TrainingRefreshJob"
    WHERE "requestedGeneration" > "completedGeneration"
  `;
  const now = Date.now();
  for (const job of pending) {
    const progressAgeMs = job.lastProgressAt === null ? Number.POSITIVE_INFINITY : now - job.lastProgressAt.getTime();
    const leaseExpired = job.leaseUntil === null || job.leaseUntil.getTime() <= now;
    if (job.retryEligible && trainingRefreshJobHasStalledProgress({ lastProgressAt: job.lastProgressAt, now })) {
      logEvent("error", "training_refresh_job_stuck", {
        profileId: job.profileId,
        generation: job.requestedGeneration,
        completedGeneration: job.completedGeneration,
        dirtyFromDate: job.dirtyFromDate,
        lastProgressStage: job.lastProgressStage,
        lastErrorType: job.lastErrorType,
        progressAgeMs,
        leaseExpired,
      });
    }
  }
  return revokedStalledLeases;
}

export async function runTrainingRefreshLivenessRecovery(
  hooks: TrainingRefreshWorkerHooks = {},
): Promise<boolean> {
  await auditTrainingRefreshLiveness();
  // Always let the regular claim predicates decide whether work is ready.
  // This also recovers a worker whose lease expired before the stalled-lease
  // audit observed it, including when the serialized poll loop is still hung.
  return processNextTrainingRefreshJob(hooks);
}

export function startTrainingRefreshWorker(): void {
  if (trainingRefreshWorkerStarted || process.env.NODE_ENV !== "production") return;
  trainingRefreshWorkerStarted = true;
  logEvent("info", "training_refresh_worker_ready", { pollIntervalMs: POLL_INTERVAL_MS });
  // Keep liveness observation independent from the serialized rebuild loop so
  // an awaited or blocked stage can still raise an operational signal.
  const livenessTimer = setInterval(() => {
    // The main poll loop can be awaiting the now-fenced old worker. A
    // concurrent poller claims the released durable job and safely retries.
    void runTrainingRefreshLivenessRecovery().catch((error: unknown) => logEvent("error", "training_refresh_liveness_audit_failed", {
      errorType: safeErrorType(error),
    }));
  }, LIVENESS_AUDIT_INTERVAL_MS);
  livenessTimer.unref();
  void (async () => {
    while (true) {
      try {
        await auditTrainingRefreshLiveness();
        if (await processNextTrainingRefreshJob()) continue;
      } catch (error) {
        logEvent("error", "training_refresh_worker_poll_failed", { errorType: safeErrorType(error) });
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  })();
}
