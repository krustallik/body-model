import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { errorDiagnosticFields, logEvent } from "@/lib/logger";
import {
  UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V3_REVISION,
  UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V4_REVISION,
} from "@/model/unified-experimental-physiology-v1/contracts";
import { DEFAULT_TIME_ZONE } from "@/model/time-zone";
import { PhysiologyV7PersistenceRepository } from "@/modules/model-episodes/physiology-v7-persistence.repository";
import { runWithHealthSyncRefreshWorkerLease } from "./health-sync-worker-context";
import { pruneExpiredHealthSyncAudits } from "./health-sync-audit";
import { APPLE_HEALTH_SHORTCUT_SOURCE, healthSyncRepository } from "./health.repository";
import { syncHealthData } from "./health.service";
import type { TimestampedHealthMetricSample } from "./normalize-shortcut-range-payload";

const POLL_INTERVAL_MS = 1_000;
const LEASE_DURATION_MS = 5 * 60_000;
const LEASE_HEARTBEAT_MS = 30_000;
const MAX_RETRY_DELAY_MS = 60_000;
const AUDIT_RETENTION_CLEANUP_INTERVAL_MS = 24 * 60 * 60_000;
const AUDIT_RETENTION_RETRY_MS = 60_000;

type HealthSyncRefreshJob = {
  profileId: number;
  requestedGeneration: number;
  completedGeneration: number;
  fromDate: string | null;
  toDate: string | null;
  sourceDates: string[];
  weightSourceChangedDates: string[];
  attemptCount: number;
};

type ClaimedHealthSyncRefreshJob = HealthSyncRefreshJob & { leaseToken: string };

export type HealthSyncRefreshWorkerHooks = {
  /** @internal Deterministic integration coordination after the durable claim. */
  afterClaim?: (job: Readonly<ClaimedHealthSyncRefreshJob>) => Promise<void>;
  /** @internal Deterministic integration coordination after the currentness read. */
  afterCurrentnessCheck?: (job: Readonly<ClaimedHealthSyncRefreshJob>, alreadyCurrent: boolean) => Promise<void>;
  /** @internal Deterministic integration coordination after publication, before durable acknowledgement. */
  afterPublicationBeforeAcknowledge?: (job: Readonly<ClaimedHealthSyncRefreshJob>) => Promise<void>;
  /** @internal Deterministic integration coordination after lease renewal and before the first dependent write. */
  beforeDependentRefresh?: (job: Readonly<ClaimedHealthSyncRefreshJob>) => Promise<void>;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** @internal Exported so PostgreSQL integration tests can model a crash after claim. */
export async function claimNextHealthSyncRefreshJob(): Promise<ClaimedHealthSyncRefreshJob | null> {
  const now = new Date();
  return prisma.$transaction(async (transaction) => {
    const candidates = await transaction.$queryRaw<HealthSyncRefreshJob[]>`
      SELECT "profileId", "requestedGeneration", "completedGeneration", "fromDate", "toDate",
             "sourceDates", "weightSourceChangedDates", "attemptCount"
      FROM "HealthSyncRefreshJob"
      WHERE "requestedGeneration" > "completedGeneration"
        AND "nextAttemptAt" <= ${now}
        AND ("leaseUntil" IS NULL OR "leaseUntil" <= ${now})
      ORDER BY "nextAttemptAt" ASC, "updatedAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `;
    const job = candidates[0];
    if (!job) return null;
    const leaseToken = randomUUID();
    const claimed = await transaction.healthSyncRefreshJob.update({
      where: { profileId: job.profileId },
      data: {
        leaseToken,
        leaseUntil: new Date(now.getTime() + LEASE_DURATION_MS),
        attemptCount: { increment: 1 },
        lastAttemptAt: now,
      },
      select: { attemptCount: true },
    });
    return { ...job, leaseToken, attemptCount: claimed.attemptCount };
  }, { maxWait: 2_000, timeout: 5_000 });
}

async function completeHealthSyncRefreshJob(job: ClaimedHealthSyncRefreshJob): Promise<boolean> {
  const completed = await prisma.healthSyncRefreshJob.updateMany({
    where: {
      profileId: job.profileId,
      leaseToken: job.leaseToken,
      requestedGeneration: job.requestedGeneration,
      leaseUntil: { gt: new Date() },
    },
    data: {
      completedGeneration: job.requestedGeneration,
      fromDate: null,
      toDate: null,
      sourceDates: [],
      weightSourceChangedDates: [],
      leaseToken: null,
      leaseUntil: null,
      nextAttemptAt: new Date(),
      lastErrorType: null,
      lastErrorAt: null,
    },
  });
  if (completed.count === 1) return true;

  await prisma.healthSyncRefreshJob.updateMany({
    where: { profileId: job.profileId, leaseToken: job.leaseToken },
    data: { leaseToken: null, leaseUntil: null },
  });
  return false;
}

async function retryHealthSyncRefreshJob(
  job: ClaimedHealthSyncRefreshJob,
  error: unknown,
): Promise<void> {
  const now = new Date();
  const delayMs = Math.min(MAX_RETRY_DELAY_MS, 1_000 * (2 ** Math.min(job.attemptCount - 1, 6)));
  const errorType = String(errorDiagnosticFields(error).errorType ?? "UnknownError");
  const releasedCurrentGeneration = await prisma.healthSyncRefreshJob.updateMany({
    where: {
      profileId: job.profileId,
      leaseToken: job.leaseToken,
      requestedGeneration: job.requestedGeneration,
    },
    data: {
      leaseToken: null,
      leaseUntil: null,
      nextAttemptAt: new Date(now.getTime() + delayMs),
      lastErrorType: errorType,
      lastErrorAt: now,
    },
  });
  if (releasedCurrentGeneration.count === 0) {
    // A newer sync owns the queue state and its debounce time. Release only
    // our lease without overwriting that generation's retry schedule.
    await prisma.healthSyncRefreshJob.updateMany({
      where: { profileId: job.profileId, leaseToken: job.leaseToken },
      data: { leaseToken: null, leaseUntil: null },
    });
  }
  logEvent("error", "health_sync_refresh_worker_failed", {
    attempt: job.attemptCount,
    ...errorDiagnosticFields(error),
    retryDelayMs: delayMs,
  });
}

async function renewHealthSyncRefreshLease(job: ClaimedHealthSyncRefreshJob): Promise<boolean> {
  const now = new Date();
  const renewed = await prisma.healthSyncRefreshJob.updateMany({
    where: {
      profileId: job.profileId,
      leaseToken: job.leaseToken,
      requestedGeneration: job.requestedGeneration,
      leaseUntil: { gt: now },
    },
    data: { leaseUntil: new Date(now.getTime() + LEASE_DURATION_MS) },
  });
  return renewed.count === 1;
}

async function assertAndRenewHealthSyncRefreshLease(job: ClaimedHealthSyncRefreshJob): Promise<void> {
  if (!await renewHealthSyncRefreshLease(job)) {
    throw new Error("Health sync refresh worker no longer owns the current durable generation.");
  }
}

async function isUnifiedPublicationCurrentForHealthJob(job: ClaimedHealthSyncRefreshJob): Promise<boolean> {
  const lifecycle = await prisma.physiologyV7Lifecycle.findUnique({
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
  if (!lifecycle
      || lifecycle.productionStaleFromDate !== null
      || lifecycle.productionPublishedGeneration !== lifecycle.invalidationGeneration
      || lifecycle.unifiedPublishedGeneration !== lifecycle.invalidationGeneration
      || lifecycle.unifiedPublishedRolloutEpoch !== lifecycle.unifiedRolloutEpoch
      || lifecycle.unifiedPublicationBlockedFromDate !== null) return false;
  const supportedTargetEpoch = (lifecycle.unifiedTargetRevision === UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V3_REVISION
      && lifecycle.unifiedRolloutEpoch === 0)
    || (lifecycle.unifiedTargetRevision === UNIFIED_EXPERIMENTAL_PHYSIOLOGY_V4_REVISION
      && lifecycle.unifiedRolloutEpoch >= 1);
  if (!supportedTargetEpoch) return false;
  return (await prisma.unifiedPublicationBlock.count({
    where: { profileId: job.profileId, source: "health" },
  })) === 0;
}

async function refreshPendingHealthSyncWork(
  job: ClaimedHealthSyncRefreshJob,
  beforeDependentRefresh?: HealthSyncRefreshWorkerHooks["beforeDependentRefresh"],
): Promise<void> {
  if (!job.fromDate || !job.toDate) throw new Error("Health sync refresh job has no date range.");
  const dates = [...new Set(job.sourceDates)]
    .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date));
  if (dates.length === 0) throw new Error("Health sync refresh job has no valid source dates.");

  await assertAndRenewHealthSyncRefreshLease(job);
  await beforeDependentRefresh?.(job);
  const lifecycle = new PhysiologyV7PersistenceRepository(prisma);
  const lifecycleRow = await prisma.physiologyV7Lifecycle.findUnique({
    where: { profileId: job.profileId },
    select: { profileId: true },
  });
  if (!lifecycleRow) throw new Error("Health sync publication lifecycle is unavailable.");
  // The job row survives a crash even if a prior attempt cleared its Health
  // fences immediately before publication. Re-arm each source fence from the
  // queue's exact date set so that retry repeats publication safely.
  for (const date of dates) {
    await lifecycle.blockUnifiedPublication({
      profileId: job.profileId,
      fromDate: date,
      source: "health",
      sourceKey: date,
    });
  }

  const snapshots = await prisma.healthSyncSnapshot.findMany({
    where: { date: { in: dates } },
    select: { date: true, timezone: true },
    orderBy: [{ date: "asc" }, { receivedAt: "desc" }, { id: "desc" }],
  });
  const timezoneByDate = new Map<string, string>();
  for (const snapshot of snapshots) {
    if (!timezoneByDate.has(snapshot.date)) timezoneByDate.set(snapshot.date, snapshot.timezone);
  }

  const weightSourceChangedDates = job.weightSourceChangedDates.filter((date) =>
    /^\d{4}-\d{2}-\d{2}$/.test(date));
  const weightSamples = weightSourceChangedDates.length === 0
    ? []
    : await prisma.healthMetricSample.findMany({
      where: {
        date: { in: weightSourceChangedDates },
        metric: "weight-kg",
        source: APPLE_HEALTH_SHORTCUT_SOURCE,
      },
      select: { date: true, metric: true, timestamp: true, value: true },
      orderBy: [{ date: "asc" }, { timestamp: "asc" }],
    });
  const metricSamplesByDate = new Map<string, TimestampedHealthMetricSample[]>();
  for (const sample of weightSamples) {
    const samples = metricSamplesByDate.get(sample.date) ?? [];
    samples.push({
      date: sample.date,
      metric: sample.metric as TimestampedHealthMetricSample["metric"],
      timestamp: sample.timestamp.toISOString(),
      value: Number(sample.value),
    });
    metricSamplesByDate.set(sample.date, samples);
  }

  let healthDependenciesComplete = false;
  await syncHealthData(
    { days: dates.map((date) => ({ date })), timezone: DEFAULT_TIME_ZONE },
    healthSyncRepository,
    undefined,
    undefined,
    metricSamplesByDate,
    {
      persistedDates: dates.map((date) => ({
        date,
        action: "updated",
        ...(weightSourceChangedDates.includes(date) ? { weightSourceChanged: true } : {}),
      })),
      timezoneByDate,
      measurementDates: weightSourceChangedDates,
      measurementInstants: weightSamples.map(({ timestamp }) => timestamp),
      skipRetention: true,
      assertRefreshLease: () => assertAndRenewHealthSyncRefreshLease(job),
      onHealthDependenciesComplete: () => { healthDependenciesComplete = true; },
    },
  );

  await assertAndRenewHealthSyncRefreshLease(job);
  const remainingBlocks = await prisma.unifiedPublicationBlock.count({
    where: { profileId: job.profileId, source: "health" },
  });
  if (remainingBlocks > 0) throw new Error("Health sync dependent refresh remains blocked.");

  if (!await isUnifiedPublicationCurrentForHealthJob(job)) {
    await assertAndRenewHealthSyncRefreshLease(job);
    const otherSourceBlocks = await prisma.unifiedPublicationBlock.count({
      where: { profileId: job.profileId, source: { not: "health" } },
    });
    if (healthDependenciesComplete && otherSourceBlocks > 0) {
      // The service cleared this job's exact Health fences and confirmed its
      // required dependencies. Another source owns the remaining publication
      // retry, so repeating this Health work would only delay that owner.
      return;
    }

    // syncHealthData can report stale after a publication failure and its
    // best-effort fence restoration can itself fail. Do not acknowledge an
    // unblocked but stale lifecycle: leave a durable Health fence for retry.
    for (const date of dates) {
      await assertAndRenewHealthSyncRefreshLease(job);
      await lifecycle.blockUnifiedPublication({
        profileId: job.profileId,
        fromDate: date,
        source: "health",
        sourceKey: date,
      });
    }
    throw new Error("Health sync dependent refresh did not publish the current generation.");
  }
}

/** Claim, execute, and acknowledge one durable Health refresh batch. */
export async function processNextHealthSyncRefreshJob(hooks: HealthSyncRefreshWorkerHooks = {}): Promise<boolean> {
  const job = await claimNextHealthSyncRefreshJob();
  if (!job) return false;
  const startedAt = performance.now();
  let heartbeatRunning = false;
  const heartbeat = setInterval(() => {
    if (heartbeatRunning) return;
    heartbeatRunning = true;
    void renewHealthSyncRefreshLease(job)
      .then((renewed) => {
        if (!renewed) {
          logEvent("error", "health_sync_refresh_worker_lease_lost", { attempt: job.attemptCount });
        }
      })
      .catch((error: unknown) => {
        logEvent("warn", "health_sync_refresh_worker_lease_renewal_failed", {
          attempt: job.attemptCount,
          errorType: String(errorDiagnosticFields(error).errorType ?? "UnknownError"),
        });
      })
      .finally(() => { heartbeatRunning = false; });
  }, LEASE_HEARTBEAT_MS);
  heartbeat.unref();

  logEvent("info", "health_sync_refresh_worker_started", {
    attempt: job.attemptCount,
    queuedGeneration: job.requestedGeneration,
    dateCount: job.sourceDates.length,
  });
  try {
    await hooks.afterClaim?.(job);
    const alreadyCurrent = await isUnifiedPublicationCurrentForHealthJob(job);
    await hooks.afterCurrentnessCheck?.(job, alreadyCurrent);
    if (!alreadyCurrent) {
      await runWithHealthSyncRefreshWorkerLease(job,
        () => refreshPendingHealthSyncWork(job, hooks.beforeDependentRefresh));
    }
    await hooks.afterPublicationBeforeAcknowledge?.(job);
    await assertAndRenewHealthSyncRefreshLease(job);
    const completed = await completeHealthSyncRefreshJob(job);
    logEvent("info", "health_sync_refresh_worker_completed", {
      attempt: job.attemptCount,
      durationMs: Math.round(performance.now() - startedAt),
      coalesced: !completed,
      alreadyCurrent,
    });
  } catch (error) {
    try {
      await retryHealthSyncRefreshJob(job, error);
    } catch (queueError) {
      logEvent("error", "health_sync_refresh_worker_retry_persist_failed", {
        attempt: job.attemptCount,
        errorType: String(errorDiagnosticFields(queueError).errorType ?? "UnknownError"),
      });
    }
  } finally {
    clearInterval(heartbeat);
  }
  return true;
}

let healthSyncRefreshWorkerStarted = false;
let nextHealthSyncAuditCleanupAt = 0;

async function runHealthSyncAuditCleanupIfDue(): Promise<void> {
  if (Date.now() < nextHealthSyncAuditCleanupAt) return;
  const succeeded = await pruneExpiredHealthSyncAudits();
  nextHealthSyncAuditCleanupAt = Date.now()
    + (succeeded ? AUDIT_RETENTION_CLEANUP_INTERVAL_MS : AUDIT_RETENTION_RETRY_MS);
}

/** Start the durable queue poller once per Node.js server instance. */
export function startHealthSyncRefreshWorker(): void {
  if (healthSyncRefreshWorkerStarted || process.env.NODE_ENV !== "production") return;
  healthSyncRefreshWorkerStarted = true;
  logEvent("info", "health_sync_refresh_worker_ready", { pollIntervalMs: POLL_INTERVAL_MS });
  void (async () => {
    while (true) {
      try {
        await runHealthSyncAuditCleanupIfDue();
        const didWork = await processNextHealthSyncRefreshJob();
        if (didWork) continue;
      } catch (error) {
        logEvent("error", "health_sync_refresh_worker_poll_failed", {
          errorType: String(errorDiagnosticFields(error).errorType ?? "UnknownError"),
        });
      }
      await sleep(POLL_INTERVAL_MS);
    }
  })();
}
