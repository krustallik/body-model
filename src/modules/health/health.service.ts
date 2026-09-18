import { healthRetentionCutoffDate } from "./health-retention";
import { healthSyncRepository, type HealthSyncRepository } from "./health.repository";
import type { HealthSyncRequest, HealthSyncResult } from "./health.types";
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

export async function syncHealthData(
  request: HealthSyncRequest,
  repository: HealthSyncRepository = healthSyncRepository,
  rawDays?: unknown[],
  receivedAt: Date = new Date(),
): Promise<HealthSyncResult> {
  const day = request.days[0];
  const timezone = request.timezone ?? DEFAULT_TIME_ZONE;
  const date = await repository.syncDay(day, rawDays?.[0] ?? day, {
    timezone,
    receivedAt,
    syncedAt: request.syncedAt ?? null,
  });
  const created = date.action === "created" ? 1 : 0;

  try {
    await trainingService.afterHealthSyncMatch(day.date, { timezone });
  } catch (error) {
    logEvent("warn", "training_match_after_sync_failed", {
      date: day.date,
      errorType: errorKind(error),
    });
  }

  try {
    // Shadow-only MS100 stepper energy; never feeds TDEE/forecast.
    await recordExperimentalStepperActiveEnergyShadowsForLocalDate({ date: day.date });
  } catch (error) {
    logEvent("warn", "experimental_stepper_active_energy_shadow_failed", {
      date: day.date,
      errorType: errorKind(error),
    });
  }

  try {
    // Shadow-only MS100 stepper glycogen demand; never feeds TDEE/forecast.
    await recordExperimentalStepperGlycogenDemandShadowsForLocalDate({ date: day.date });
  } catch (error) {
    logEvent("warn", "experimental_stepper_glycogen_demand_shadow_failed", {
      date: day.date,
      errorType: errorKind(error),
    });
  }

  try {
    // Shadow-only daily glycogen repletion; never feeds TDEE/forecast.
    await recordExperimentalGlycogenRepletionShadow({ date: day.date });
  } catch (error) {
    logEvent("warn", "experimental_glycogen_repletion_shadow_failed", {
      date: day.date,
      errorType: errorKind(error),
    });
  }

  try {
    // Shadow-only glycogen-associated water; never feeds TDEE/forecast.
    await recordExperimentalGlycogenAssociatedWaterShadow({ date: day.date });
  } catch (error) {
    logEvent("warn", "experimental_glycogen_associated_water_shadow_failed", {
      date: day.date,
      errorType: errorKind(error),
    });
  }

  try {
    // Shadow-only multi-day glycogen state; never feeds TDEE/forecast.
    await recordExperimentalGlycogenStateShadow({ date: day.date });
  } catch (error) {
    logEvent("warn", "experimental_glycogen_state_shadow_failed", {
      date: day.date,
      errorType: errorKind(error),
    });
  }

  try {
    // Shadow-only relative skeletal-muscle delta; never feeds TDEE/forecast.
    await recordExperimentalSkeletalMuscleDeltaShadow({ date: day.date });
  } catch (error) {
    logEvent("warn", "experimental_skeletal_muscle_delta_shadow_failed", {
      date: day.date,
      errorType: errorKind(error),
    });
  }

  try {
    // Shadow-only cessation/detraining; never feeds TDEE/forecast.
    await recordExperimentalCessationDetrainingShadow({ date: day.date });
  } catch (error) {
    logEvent("warn", "experimental_cessation_detraining_shadow_failed", {
      date: day.date,
      errorType: errorKind(error),
    });
  }

  try {
    // Shadow-only weekly local hypertrophy response; never feeds TDEE/forecast.
    await recordExperimentalLocalHypertrophyResponseShadow({ date: day.date });
  } catch (error) {
    logEvent("warn", "experimental_local_hypertrophy_response_shadow_failed", {
      date: day.date,
      errorType: errorKind(error),
    });
  }

  const retentionCutoffDate = healthRetentionCutoffDate(day.date);
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
        referenceDate: day.date,
      });
    }
  } catch (error) {
    logEvent("warn", "health_sync_retention_prune_failed", {
      retentionCutoffDate,
      referenceDate: day.date,
      errorType: errorKind(error),
    });
  }

  return {
    status: "ok",
    received: 1,
    created,
    updated: 1 - created,
    dates: [date],
    retentionCutoffDate,
    prunedDays,
    prunedSnapshots,
  };
}
