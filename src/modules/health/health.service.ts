import { healthRetentionCutoffDate } from "./health-retention";
import { healthSyncRepository, type HealthSyncRepository } from "./health.repository";
import type { HealthSyncRequest, HealthSyncResult } from "./health.types";
import type { TimestampedHealthMetricSample } from "./normalize-shortcut-range-payload";
import { DEFAULT_TIME_ZONE } from "@/model/time-zone";
import { errorDiagnosticFields, errorKind, logEvent } from "@/lib/logger";
import { trainingService } from "@/modules/training/training.service";
import {
  recordExperimentalStepperActiveEnergyShadowsForLocalDate,
  recordExperimentalStepperActiveEnergyShadowsForMassWindow,
} from "@/modules/profile/experimental-stepper-active-energy-shadow.service";
import { recordExperimentalStrengthShadowsForWeightDate } from "@/modules/training/training.service";
import { recordExperimentalStepperGlycogenDemandShadowsForLocalDate } from "@/modules/profile/experimental-stepper-glycogen-demand-shadow.service";
import { recordExperimentalGlycogenStateShadow } from "@/modules/model-episodes/experimental-glycogen-state-shadow.service";
import { recordExperimentalLocalHypertrophyResponseShadow } from "@/modules/model-episodes/experimental-local-hypertrophy-response-shadow.service";
import { rebuildAuthoritativeRelativeMuscleTrajectory } from "@/modules/model-episodes/experimental-cessation-detraining-shadow.service";
import { recordExperimentalFfmRetentionShadow } from "@/modules/model-episodes/experimental-ffm-retention-shadow.service";
import { publishActiveEnergyChangesV1 } from "@/modules/activity/active-energy-publication";
import { persistStepperReconciliationV1 } from "@/modules/training/stepper-reconciliation.service";
import { PhysiologyV7PersistenceRepository } from "@/modules/model-episodes/physiology-v7-persistence.repository";
import { prisma } from "@/lib/db/prisma";

export async function reconcileHealthUnifiedPublicationBlocksV1(input: {
  dates: readonly string[];
  tokens: ReadonlyMap<string, { revision: number; fromDate: string } | null>;
  failedDates: ReadonlySet<string>;
  lifecycle: Pick<PhysiologyV7PersistenceRepository, "blockUnifiedPublication" | "clearUnifiedPublicationBlock">;
}): Promise<boolean> {
  let readyToPublish = input.failedDates.size === 0;
  for (const date of input.dates) {
    const token = input.tokens.get(date);
    if (input.failedDates.has(date) || token === null || token === undefined) {
      await input.lifecycle.blockUnifiedPublication({ profileId: 1, fromDate: date, source: "health", sourceKey: date });
      readyToPublish = false;
      continue;
    }
    if (!await input.lifecycle.clearUnifiedPublicationBlock({
      profileId: 1,
      source: "health",
      sourceKey: date,
      expectedRevision: token.revision,
      expectedFromDate: token.fromDate,
    })) readyToPublish = false;
  }
  return readyToPublish;
}

async function restoreHealthUnifiedPublicationBlocksV1(input: {
  dates: readonly string[];
  tokens: ReadonlyMap<string, { revision: number; fromDate: string } | null>;
  lifecycle: Pick<PhysiologyV7PersistenceRepository, "blockUnifiedPublication">;
}): Promise<void> {
  for (const date of input.dates) {
    const token = input.tokens.get(date);
    if (token === null || token === undefined) continue;
    await input.lifecycle.blockUnifiedPublication({
      profileId: 1,
      fromDate: token.fromDate,
      source: "health",
      sourceKey: date,
    });
  }
}

export async function syncHealthData(
  request: HealthSyncRequest,
  repository: HealthSyncRepository = healthSyncRepository,
  rawDays?: unknown[],
  receivedAt: Date = new Date(),
  metricSamplesByDate?: ReadonlyMap<string, readonly TimestampedHealthMetricSample[]>,
  options: {
    publicationNow?: Date;
    publicationLifecycle?: Pick<
      PhysiologyV7PersistenceRepository,
      "readUnifiedPublicationBlockToken" | "blockUnifiedPublication" | "clearUnifiedPublicationBlock" | "hasUnifiedPublicationBlocks"
    >;
  } = {},
): Promise<HealthSyncResult> {
  const timezone = request.timezone ?? DEFAULT_TIME_ZONE;
  const dates = [];
  for (const [index, day] of request.days.entries()) {
    dates.push(await repository.syncDay(day, rawDays?.[index] ?? day, {
      timezone,
      receivedAt,
      syncedAt: request.syncedAt ?? null,
    }, metricSamplesByDate?.get(day.date)));
  }
  // Sync providers may return a historical batch in either direction.  Shadow
  // predecessors are calendar-state, not transport-order state.
  // Multiple raw observations for one calendar date are applied in request
  // order above, but that date owns exactly one durable publication fence.
  // Reconcile the final persisted state once so a duplicate cannot CAS-clear
  // the same block twice and falsely leave a successful batch stale.
  const chronologicalDates = [...new Map(dates.map((result) => [result.date, result])).values()]
    .sort((left, right) => left.date.localeCompare(right.date));
  const referenceDate = chronologicalDates[chronologicalDates.length - 1]!;
  const created = dates.filter((result) => result.action === "created").length;
  // Unified consumes persisted production and child-shadow rows.  If any
  // refresh in this publication chain fails, leave the already-invalidated
  // generation stale instead of publishing a candidate over old child state.
  let requiredPublicationRefreshFailed = false;
  const failedPublicationDates = new Set<string>();
  let modelPublicationStatus: HealthSyncResult["modelPublicationStatus"] = "not-run";
  const markRequiredFailure = (date: string) => {
    requiredPublicationRefreshFailed = true;
    failedPublicationDates.add(date);
  };
  const healthBlockTokens = new Map<string, { revision: number; fromDate: string } | null>();
  const healthPublicationLifecycle = repository === healthSyncRepository
    ? options.publicationLifecycle ?? new PhysiologyV7PersistenceRepository(prisma)
    : null;
  if (healthPublicationLifecycle !== null) {
    for (const date of chronologicalDates) {
      const token = await healthPublicationLifecycle.readUnifiedPublicationBlockToken({
        profileId: 1, source: "health", sourceKey: date.date,
      });
      healthBlockTokens.set(date.date, token);
      if (token === null) markRequiredFailure(date.date);
    }
  }

  // A request can carry up to one calendar month; each day deserves the same
  // post-sync reconciliation instead of only processing the final array item.
  for (const date of chronologicalDates) {
  try {
    const matchPublicationReady = await trainingService.afterHealthSyncMatch(date.date, { timezone });
    if (!matchPublicationReady) markRequiredFailure(date.date);
  } catch (error) {
    markRequiredFailure(date.date);
    logEvent("warn", "training_match_after_sync_failed", {
      stage: "training-match-after-health-sync",
      ...errorDiagnosticFields(error),
    });
  }

  // Unit callers inject an isolated health repository.  Shadow writers use
  // the production Prisma client, so running them there leaks outside the
  // harness and can neither validate nor affect the injected sync result.
  if (repository !== healthSyncRepository) continue;

  try {
    await persistStepperReconciliationV1(prisma, { from: date.date, to: date.date, timezone });
  } catch (error) {
    markRequiredFailure(date.date);
    logEvent("warn", "stepper_reconciliation_after_sync_failed", {
      stage: "stepper-reconciliation-after-health-sync",
      ...errorDiagnosticFields(error),
    });
  }

  try {
    // Resolve the BodyCast/device/manual precedence candidates after source reconciliation.
    await recordExperimentalStepperActiveEnergyShadowsForLocalDate({ date: date.date });
  } catch (error) {
    markRequiredFailure(date.date);
    logEvent("warn", "experimental_stepper_active_energy_shadow_failed", {
      stage: "stepper-active-energy-shadow",
      ...errorDiagnosticFields(error),
    });
  }

  try {
    await recordExperimentalStrengthShadowsForWeightDate({
      date: date.date,
      refreshHistoricalAsOfFallback: date.weightSourceChanged === true,
    });
  } catch (error) {
    markRequiredFailure(date.date);
    logEvent("warn", "experimental_strength_active_energy_refresh_failed", {
      stage: "strength-active-energy-shadow-refresh",
      ...errorDiagnosticFields(error),
    });
  }

  try {
    // Shadow-only MS100 stepper glycogen demand; never feeds TDEE/forecast.
    await recordExperimentalStepperGlycogenDemandShadowsForLocalDate({ date: date.date });
  } catch (error) {
    markRequiredFailure(date.date);
    logEvent("warn", "experimental_stepper_glycogen_demand_shadow_failed", {
      stage: "stepper-glycogen-demand-shadow",
      ...errorDiagnosticFields(error),
    });
  }

  try {
    // Shadow-only FFM/slow-nonfat retention; never feeds TDEE/forecast/Hall mean.
    await recordExperimentalFfmRetentionShadow({ date: date.date });
  } catch (error) {
    logEvent("warn", "experimental_ffm_retention_shadow_failed", {
      stage: "ffm-retention-shadow",
      ...errorDiagnosticFields(error),
    });
  }

  try {
    // Shadow-only weekly local hypertrophy response; never feeds TDEE/forecast.
    await recordExperimentalLocalHypertrophyResponseShadow({ date: date.date });
  } catch (error) {
    logEvent("warn", "experimental_local_hypertrophy_response_shadow_failed", {
      stage: "local-hypertrophy-response-shadow",
      ...errorDiagnosticFields(error),
    });
  }
  }

  // Glycogen is a stateful suffix. All same-batch source shadows above must be
  // written before one chronological replay; replaying after each day would be
  // redundant and makes a 30-day historical batch quadratic.
  if (healthPublicationLifecycle !== null && chronologicalDates.length > 0) {
    try {
      await recordExperimentalGlycogenStateShadow({ date: chronologicalDates[0]!.date });
    } catch (error) {
      markRequiredFailure(chronologicalDates[0]!.date);
      logEvent("warn", "experimental_glycogen_state_shadow_failed", {
        stage: "glycogen-state-shadow-rebuild",
        ...errorDiagnosticFields(error),
      });
    }
  }

  // A health backfill can change exposure/coverage on an earlier date. Replay
  // the episode-local Relative Muscle trajectory once after the full batch.
  if (healthPublicationLifecycle !== null && chronologicalDates.length > 0) {
    try {
      await rebuildAuthoritativeRelativeMuscleTrajectory({ fromDate: chronologicalDates[0]!.date });
    } catch (error) {
      markRequiredFailure(chronologicalDates[0]!.date);
      logEvent("warn", "experimental_authoritative_muscle_suffix_rebuild_failed", {
        stage: "relative-muscle-suffix-rebuild",
        ...errorDiagnosticFields(error),
      });
    }
  }

  if (healthPublicationLifecycle !== null && chronologicalDates.length > 0) {
    let healthBlocksClearedForPublication = false;
    let healthBlockRestoreAttempted = false;
    try {
      const measurementDates = request.days
        .filter((day) => day.weightKg !== undefined && day.weightKg !== null)
        .map((day) => day.date);
      const measurementInstants = [...(metricSamplesByDate?.values() ?? [])]
        .flat()
        .filter((sample) => sample.metric === "weight-kg")
        .map((sample) => new Date(sample.timestamp))
        .filter((instant) => Number.isFinite(instant.getTime()));
      await recordExperimentalStepperActiveEnergyShadowsForMassWindow({ measurementDates, measurementInstants });
    } catch (error) {
      markRequiredFailure(chronologicalDates[0]!.date);
      logEvent("warn", "experimental_stepper_mass_window_refresh_failed", {
        stage: "stepper-mass-window-refresh",
        ...errorDiagnosticFields(error),
      });
    }

    try {
      // Reconcile successful dates even when another date failed. Otherwise a
      // successful child refresh can leave a permanent blocker after the
      // failed date is retried on its own.
      const blocksReady = await reconcileHealthUnifiedPublicationBlocksV1({
        dates: chronologicalDates.map(({ date }) => date),
        tokens: healthBlockTokens,
        failedDates: failedPublicationDates,
        lifecycle: healthPublicationLifecycle,
      });
      if (requiredPublicationRefreshFailed || !blocksReady) {
        requiredPublicationRefreshFailed = true;
        modelPublicationStatus = "stale";
        logEvent("warn", "active_energy_publication_blocked_by_dependency_refresh", {
          reason: blocksReady ? "required-source-shadow-refresh-failed" : "source-changed-during-dependent-refresh",
        });
      } else {
        healthBlocksClearedForPublication = true;
        // Another source may still have an unresolved durable fence. The
        // Health dependencies are now refreshed and its exact fence is safe
        // to clear; let the remaining source retry the shared candidate.
        if (await healthPublicationLifecycle.hasUnifiedPublicationBlocks(1)) {
          modelPublicationStatus = "stale";
        } else {
          // Publish only after all batch mutations, reconciliation, and
          // candidate refreshes; source transactions left the old generation
          // stale before this attempt.
          const published = await publishActiveEnergyChangesV1(options.publicationNow === undefined ? {} : { now: options.publicationNow });
          modelPublicationStatus = published ? "current" : "stale";
          if (!published && !await healthPublicationLifecycle.hasUnifiedPublicationBlocks(1)) {
            healthBlockRestoreAttempted = true;
            await restoreHealthUnifiedPublicationBlocksV1({
              dates: chronologicalDates.map(({ date }) => date),
              tokens: healthBlockTokens,
              lifecycle: healthPublicationLifecycle,
            });
          }
        }
      }
    } catch (error) {
      modelPublicationStatus = "stale";
      logEvent("warn", "active_energy_publication_failed", {
        stage: "health-active-energy-publication",
        ...errorDiagnosticFields(error),
      });
      let anotherBlockRemains: boolean | null = null;
      try {
        anotherBlockRemains = await healthPublicationLifecycle.hasUnifiedPublicationBlocks(1);
      } catch {
        // An unreadable aggregate state does not prove another source owns a
        // retry handle. Restore this batch's exact date fences conservatively.
      }
      if (healthBlocksClearedForPublication && !healthBlockRestoreAttempted && anotherBlockRemains !== true) {
        try {
          healthBlockRestoreAttempted = true;
          await restoreHealthUnifiedPublicationBlocksV1({
            dates: chronologicalDates.map(({ date }) => date),
            tokens: healthBlockTokens,
            lifecycle: healthPublicationLifecycle,
          });
        } catch (restoreError) {
          logEvent("error", "health_publication_retry_fence_restore_failed", {
            stage: "health-publication-retry-fence-restore",
            ...errorDiagnosticFields(restoreError),
          });
        }
      }
    }
  }

  const retentionCutoffDate = healthRetentionCutoffDate(referenceDate.date);
  let prunedDays = 0;
  let prunedSnapshots = 0;
  try {
    // Retention is a no-op for durable canonical sources (including snapshots).
    const pruned = await repository.pruneOlderThan(retentionCutoffDate);
    prunedDays = pruned.deletedDays;
    prunedSnapshots = pruned.deletedSnapshots;
    if (prunedDays > 0 || prunedSnapshots > 0) {
      logEvent("info", "health_sync_retention_pruned", {
        retentionCutoffDate,
        prunedDays,
        prunedSnapshots,
        referenceDate: referenceDate.date,
      });
    }
  } catch (error) {
    logEvent("warn", "health_sync_retention_prune_failed", {
      retentionCutoffDate,
      referenceDate: referenceDate.date,
      errorType: errorKind(error),
    });
  }

  return {
    status: "ok",
    modelPublicationStatus,
    received: dates.length,
    created,
    updated: dates.length - created,
    dates: dates.map(({ date, action }) => ({ date, action })),
    retentionCutoffDate,
    prunedDays,
    prunedSnapshots,
  };
}
