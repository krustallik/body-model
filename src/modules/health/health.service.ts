import { healthRetentionCutoffDate } from "./health-retention";
import { healthSyncRepository, type HealthSyncRepository } from "./health.repository";
import type { HealthSyncRequest, HealthSyncResult } from "./health.types";
import type { TimestampedHealthMetricSample } from "./normalize-shortcut-range-payload";
import { DEFAULT_TIME_ZONE } from "@/model/time-zone";
import { errorKind, logEvent } from "@/lib/logger";
import { trainingService } from "@/modules/training/training.service";
import { recordExperimentalStepperActiveEnergyShadowsForLocalDate } from "@/modules/profile/experimental-stepper-active-energy-shadow.service";
import { recordExperimentalStepperGlycogenDemandShadowsForLocalDate } from "@/modules/profile/experimental-stepper-glycogen-demand-shadow.service";
import { recordExperimentalGlycogenRepletionShadow } from "@/modules/model-episodes/experimental-glycogen-repletion-shadow.service";
import { recordExperimentalGlycogenAssociatedWaterShadow } from "@/modules/model-episodes/experimental-glycogen-associated-water-shadow.service";
import { recordExperimentalGlycogenStateShadow } from "@/modules/model-episodes/experimental-glycogen-state-shadow.service";
import { recordExperimentalSkeletalMuscleDeltaShadow } from "@/modules/model-episodes/experimental-skeletal-muscle-delta-shadow.service";
import { recordExperimentalLocalHypertrophyResponseShadow } from "@/modules/model-episodes/experimental-local-hypertrophy-response-shadow.service";
import { recordExperimentalCessationDetrainingShadow } from "@/modules/model-episodes/experimental-cessation-detraining-shadow.service";
import { recordExperimentalFfmRetentionShadow } from "@/modules/model-episodes/experimental-ffm-retention-shadow.service";

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
  const referenceDate = dates[dates.length - 1]!;
  const created = dates.filter((result) => result.action === "created").length;

  // A request can carry up to one calendar month; each day deserves the same
  // post-sync reconciliation instead of only processing the final array item.
  for (const date of dates) {
  try {
    await trainingService.afterHealthSyncMatch(date.date, { timezone });
  } catch (error) {
    logEvent("warn", "training_match_after_sync_failed", {
      date: date.date,
      errorType: errorKind(error),
    });
  }

  try {
    // Shadow-only MS100 stepper energy; never feeds TDEE/forecast.
    await recordExperimentalStepperActiveEnergyShadowsForLocalDate({ date: date.date });
  } catch (error) {
    logEvent("warn", "experimental_stepper_active_energy_shadow_failed", {
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
    // Shadow-only daily glycogen repletion; never feeds TDEE/forecast.
    await recordExperimentalGlycogenRepletionShadow({ date: date.date });
  } catch (error) {
    logEvent("warn", "experimental_glycogen_repletion_shadow_failed", {
      date: date.date,
      errorType: errorKind(error),
    });
  }

  try {
    // Shadow-only glycogen-associated water; never feeds TDEE/forecast.
    await recordExperimentalGlycogenAssociatedWaterShadow({ date: date.date });
  } catch (error) {
    logEvent("warn", "experimental_glycogen_associated_water_shadow_failed", {
      date: date.date,
      errorType: errorKind(error),
    });
  }

  try {
    // Shadow-only multi-day glycogen state; never feeds TDEE/forecast.
    await recordExperimentalGlycogenStateShadow({ date: date.date });
  } catch (error) {
    logEvent("warn", "experimental_glycogen_state_shadow_failed", {
      date: date.date,
      errorType: errorKind(error),
    });
  }

  try {
    // Shadow-only relative skeletal-muscle delta; never feeds TDEE/forecast.
    await recordExperimentalSkeletalMuscleDeltaShadow({ date: date.date });
  } catch (error) {
    logEvent("warn", "experimental_skeletal_muscle_delta_shadow_failed", {
      date: date.date,
      errorType: errorKind(error),
    });
  }

  try {
    // Shadow-only cessation/detraining; never feeds TDEE/forecast.
    await recordExperimentalCessationDetrainingShadow({ date: date.date });
  } catch (error) {
    logEvent("warn", "experimental_cessation_detraining_shadow_failed", {
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
