import { healthRetentionCutoffDate } from "./health-retention";
import { healthSyncRepository, type HealthSyncRepository } from "./health.repository";
import type { HealthSyncRequest, HealthSyncResult } from "./health.types";
import type { TimestampedHealthMetricSample } from "./normalize-shortcut-range-payload";
import { DEFAULT_TIME_ZONE } from "@/model/time-zone";
import { errorKind, logEvent } from "@/lib/logger";
import { trainingService } from "@/modules/training/training.service";
import {
  recordExperimentalStepperActiveEnergyShadowsForLocalDate,
  recordExperimentalStepperActiveEnergyShadowsForMassWindow,
} from "@/modules/profile/experimental-stepper-active-energy-shadow.service";
import { recordExperimentalStrengthEnergyShadowsForWeightDate } from "@/modules/training/experimental-strength-energy-shadow.service";
import { recordExperimentalStepperGlycogenDemandShadowsForLocalDate } from "@/modules/profile/experimental-stepper-glycogen-demand-shadow.service";
import { recordExperimentalGlycogenStateShadow } from "@/modules/model-episodes/experimental-glycogen-state-shadow.service";
import { recordExperimentalLocalHypertrophyResponseShadow } from "@/modules/model-episodes/experimental-local-hypertrophy-response-shadow.service";
import { rebuildAuthoritativeRelativeMuscleTrajectory } from "@/modules/model-episodes/experimental-cessation-detraining-shadow.service";
import { recordExperimentalFfmRetentionShadow } from "@/modules/model-episodes/experimental-ffm-retention-shadow.service";
import { publishActiveEnergyChangesV1 } from "@/modules/activity/active-energy-publication";
import { persistStepperReconciliationV1 } from "@/modules/training/stepper-reconciliation.service";
import { prisma } from "@/lib/db/prisma";

export async function syncHealthData(
  request: HealthSyncRequest,
  repository: HealthSyncRepository = healthSyncRepository,
  rawDays?: unknown[],
  receivedAt: Date = new Date(),
  metricSamplesByDate?: ReadonlyMap<string, readonly TimestampedHealthMetricSample[]>,
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
  const chronologicalDates = [...dates].sort((left, right) => left.date.localeCompare(right.date));
  const referenceDate = chronologicalDates[chronologicalDates.length - 1]!;
  const created = dates.filter((result) => result.action === "created").length;

  // A request can carry up to one calendar month; each day deserves the same
  // post-sync reconciliation instead of only processing the final array item.
  for (const date of chronologicalDates) {
  try {
    await trainingService.afterHealthSyncMatch(date.date, { timezone });
  } catch (error) {
    logEvent("warn", "training_match_after_sync_failed", {
      date: date.date,
      errorType: errorKind(error),
    });
  }

  // Unit callers inject an isolated health repository.  Shadow writers use
  // the production Prisma client, so running them there leaks outside the
  // harness and can neither validate nor affect the injected sync result.
  if (repository !== healthSyncRepository) continue;

  try {
    await persistStepperReconciliationV1(prisma, { from: date.date, to: date.date, timezone });
  } catch (error) {
    logEvent("warn", "stepper_reconciliation_after_sync_failed", {
      date: date.date,
      errorType: errorKind(error),
    });
  }

  try {
    // Resolve the BodyCast/device/manual precedence candidates after source reconciliation.
    await recordExperimentalStepperActiveEnergyShadowsForLocalDate({ date: date.date });
  } catch (error) {
    logEvent("warn", "experimental_stepper_active_energy_shadow_failed", {
      date: date.date,
      errorType: errorKind(error),
    });
  }

  try {
    await recordExperimentalStrengthEnergyShadowsForWeightDate({ date: date.date });
  } catch (error) {
    logEvent("warn", "experimental_strength_active_energy_refresh_failed", {
      date: date.date,
      errorType: errorKind(error),
    });
  }

  try {
    // Shadow-only MS100 stepper glycogen demand; never feeds TDEE/forecast.
    await recordExperimentalStepperGlycogenDemandShadowsForLocalDate({ date: date.date });
  } catch (error) {
    logEvent("warn", "experimental_stepper_glycogen_demand_shadow_failed", {
      date: date.date,
      errorType: errorKind(error),
    });
  }

  try {
    // Shadow-only FFM/slow-nonfat retention; never feeds TDEE/forecast/Hall mean.
    await recordExperimentalFfmRetentionShadow({ date: date.date });
  } catch (error) {
    logEvent("warn", "experimental_ffm_retention_shadow_failed", {
      date: date.date,
      errorType: errorKind(error),
    });
  }

  try {
    // Shadow-only weekly local hypertrophy response; never feeds TDEE/forecast.
    await recordExperimentalLocalHypertrophyResponseShadow({ date: date.date });
  } catch (error) {
    logEvent("warn", "experimental_local_hypertrophy_response_shadow_failed", {
      date: date.date,
      errorType: errorKind(error),
    });
  }
  }

  // Glycogen is a stateful suffix. All same-batch source shadows above must be
  // written before one chronological replay; replaying after each day would be
  // redundant and makes a 30-day historical batch quadratic.
  if (repository === healthSyncRepository && chronologicalDates.length > 0) {
    try {
      await recordExperimentalGlycogenStateShadow({ date: chronologicalDates[0]!.date });
    } catch (error) {
      logEvent("warn", "experimental_glycogen_state_shadow_failed", {
        date: chronologicalDates[0]!.date,
        errorType: errorKind(error),
      });
    }
  }

  // A health backfill can change exposure/coverage on an earlier date. Replay
  // the episode-local Relative Muscle trajectory once after the full batch.
  if (repository === healthSyncRepository && chronologicalDates.length > 0) {
    try {
      await rebuildAuthoritativeRelativeMuscleTrajectory({ fromDate: chronologicalDates[0]!.date });
    } catch (error) {
      logEvent("warn", "experimental_authoritative_muscle_suffix_rebuild_failed", {
        fromDate: chronologicalDates[0]!.date,
        errorType: errorKind(error),
      });
    }
  }

  if (repository === healthSyncRepository && chronologicalDates.length > 0) {
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
      logEvent("warn", "experimental_stepper_mass_window_refresh_failed", { errorType: errorKind(error) });
    }

    try {
      // Publish only after all batch mutations, reconciliation, and candidate refreshes;
      // source transactions have already left the old generation stale.
      await publishActiveEnergyChangesV1();
    } catch (error) {
      logEvent("warn", "active_energy_publication_failed", { errorType: errorKind(error) });
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
    received: dates.length,
    created,
    updated: dates.length - created,
    dates,
    retentionCutoffDate,
    prunedDays,
    prunedSnapshots,
  };
}
